/*
  Messages and Friends in a floating chat window, on every page.

  A speech-bubble icon in the header (beside the bell) opens it, with a
  count of unread messages. On a computer it floats in the bottom right
  corner; on a phone it floats above the bottom of the page. Three tabs:
  - Chats: conversations with friends, opening into message bubbles
  - Friends: find members, friend requests, your friends
  - MT3UK: messages from MT3UK to members

  Links to profile.html#messages, profile.html#friends and
  profile.html?with=<id>#messages (menu, bell, emails and phone
  notifications) open it too, on whatever page they're on.

  The window can be minimised to a small round bubble, and stays open or
  minimised from page to page (sessionStorage). Web addresses in messages
  become links, and photos can be attached: they're shrunk on the device
  first and only ever shown through the worker, to the two people in the
  conversation, for 90 days.

  window.mt3ukChat.open('chats' | 'friends' | 'mt3uk', friendId?) and
  window.mt3ukChat.close(). Uses the worker's /profile endpoints.
*/
(function () {
  if (window.mt3ukChat) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var SESSION_KEY = 'mt3ukMyBuildsSession';

  function session() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; } }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var secs = (Date.now() - d.getTime()) / 1000;
    var time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    if (secs < 86400 && d.toDateString() === new Date().toDateString()) return time;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }) + ', ' + time;
  }

  var CHAT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>';
  var SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>';
  var PHOTO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/></svg>';
  var LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>';
  var STATE_KEY = 'mt3ukChatState';

  // ---------- Styles ----------
  var style = document.createElement('style');
  style.textContent = [
    '.nav-chat{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:34px;border:0;background:none;color:var(--ink,#16233d);cursor:pointer;padding:0}',
    '.nav-chat:hover{opacity:.65}',
    '.nav-chat svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round}',
    '.nav-chat-count{position:absolute;top:0;right:2px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#e8542a;color:#fff;font:700 .66rem/17px "IBM Plex Sans",sans-serif;text-align:center}',
    '.nav-chat-count[hidden]{display:none}',
    '#mt3uk-chat{position:fixed;right:16px;bottom:16px;z-index:420;width:340px;height:min(500px,calc(100dvh - 120px));display:flex;flex-direction:column;background:#fff;color:#16233d;border-radius:18px;box-shadow:0 18px 50px rgba(10,16,30,.35);overflow:hidden;font-family:"IBM Plex Sans",sans-serif;opacity:0;transform:translateY(16px) scale(.98);transition:opacity .18s ease,transform .18s ease}',
    '#mt3uk-chat.is-open{opacity:1;transform:none}',
    '#mt3uk-chat[hidden]{display:none}',
    // On phones a floating card, so the page stays in view above it.
    '@media (max-width:780px){#mt3uk-chat{left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));width:auto;height:min(62dvh,520px)}}',
    '#mt3uk-chat-min{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:420;width:54px;height:54px;border-radius:50%;border:2px solid #fff;background:#e8542a;color:#fff;box-shadow:0 10px 28px rgba(10,16,30,.35);display:flex;align-items:center;justify-content:center;cursor:pointer}',
    '#mt3uk-chat-min[hidden]{display:none}',
    '#mt3uk-chat-min svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round}',
    '#mt3uk-chat-min .mc-badge{position:absolute;top:-4px;right:-4px;background:#16233d;border:2px solid #fff}',
    '.mc-head{display:flex;align-items:center;gap:8px;padding:12px 12px 10px 16px;background:#16233d;color:#fff}',
    '.mc-head{gap:6px}',
    '.mc-head h2{flex:1;margin:0;font-size:1.05rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}',
    '.mc-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;font-size:1.3rem;line-height:1;cursor:pointer}',
    '.mc-icon-btn:hover{background:rgba(255,255,255,.22)}',
    '.mc-icon-btn[hidden]{display:none}',
    '.mc-tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid rgba(22,35,61,.1)}',
    '.mc-tabs[hidden]{display:none}',
    '.mc-tab{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;border:0;border-radius:999px;background:none;color:#5b6678;font:600 .88rem "IBM Plex Sans",sans-serif;cursor:pointer}',
    '.mc-tab[aria-selected="true"]{background:#16233d;color:#fff}',
    '.mc-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e8542a;color:#fff;font:700 .68rem/18px "IBM Plex Sans",sans-serif}',
    '.mc-badge[hidden]{display:none}',
    '.mc-body{flex:1;min-height:0;overflow-y:auto;padding:10px 12px;background:#f6f7f9}',
    '.mc-view[hidden]{display:none}',
    '.mc-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
    '.mc-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(22,35,61,.06)}',
    'button.mc-row{width:100%;border:0;text-align:left;font:inherit;color:inherit;cursor:pointer}',
    'button.mc-row:hover{background:#fdf3ef}',
    '.mc-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;background:#16233d;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:700}',
    '.mc-who{flex:1;min-width:110px;display:flex;flex-direction:column;gap:1px}',
    '.mc-who strong{font-size:.95rem}',
    '.mc-who span{font-size:.84rem;color:#5b6678;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mc-row.is-unread .mc-who span{color:#16233d;font-weight:600}',
    'button.mc-row{flex-wrap:nowrap}',
    '.mc-thread-row .mc-who{min-width:0}',
    '.mc-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:.72rem;color:#7c8798;white-space:nowrap}',
    '.mc-dot{width:10px;height:10px;border-radius:50%;background:#e8542a}',
    '.mc-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;margin-left:auto}',
    '.mc-btn{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:6px 12px;border-radius:999px;border:1px solid rgba(22,35,61,.25);background:#fff;color:#16233d;font:600 .8rem "IBM Plex Sans",sans-serif;text-decoration:none;cursor:pointer}',
    '.mc-btn:hover{border-color:#e8542a;color:#e8542a}',
    '.mc-btn-primary{background:#e8542a;border-color:#e8542a;color:#fff}',
    '.mc-btn-primary:hover{color:#fff;opacity:.9}',
    '.mc-btn:disabled{opacity:.5;cursor:default}',
    '.mc-tag{font:600 .7rem "IBM Plex Mono",monospace;letter-spacing:.04em;color:#7c8798}',
    '.mc-h3{margin:14px 2px 8px;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7c8798}',
    '.mc-h3:first-child{margin-top:4px}',
    '.mc-empty{display:block;padding:18px 8px;text-align:center;color:#7c8798;font-size:.88rem;line-height:1.5}',
    '.mc-empty a,.mc-note a{color:#e8542a;text-decoration:underline}',
    '.mc-note{margin:0 2px 10px;font-size:.84rem;color:#5b6678;line-height:1.45}',
    '.mc-search{display:flex;gap:6px;margin-bottom:6px}',
    '.mc-search input{flex:1;min-width:0;border:1px solid rgba(22,35,61,.2);border-radius:999px;padding:9px 14px;font:16px "IBM Plex Sans",sans-serif;background:#fff;color:#16233d}',
    '.mc-search input:focus,.mc-compose textarea:focus{outline:none;border-color:#e8542a}',
    '.mc-status{margin:8px 2px 0;font-size:.84rem;color:#5b6678}',
    '.mc-status:empty{display:none}',
    '.mc-status.is-ok{color:#1c8a4b;font-weight:600}',
    '.mc-status.is-err{color:#c0392b;font-weight:600}',
    '.mc-bc{padding:12px 14px;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(22,35,61,.06)}',
    '.mc-bc h3{margin:0 0 2px;font-size:.95rem;display:flex;align-items:center;gap:6px}',
    '.mc-bc time{font-size:.74rem;color:#7c8798}',
    '.mc-bc p{margin:6px 0 0;font-size:.9rem;line-height:1.5;white-space:pre-wrap}',
    '.mc-bubbles{list-style:none;margin:0;padding:4px 0;display:flex;flex-direction:column;gap:10px}',
    '.mc-msg{display:flex;align-items:flex-end;gap:8px;max-width:86%}',
    '.mc-msg .mc-avatar{width:28px;height:28px;font-size:.66rem}',
    '.mc-msg.mine{align-self:flex-end;flex-direction:row-reverse}',
    '.mc-bubble{padding:9px 13px;border-radius:18px 18px 18px 4px;background:#fff;box-shadow:0 1px 2px rgba(22,35,61,.08);font-size:.93rem;line-height:1.45;white-space:pre-wrap;word-break:break-word}',
    '.mc-msg.mine .mc-bubble{border-radius:18px 18px 4px 18px;background:#e8542a;color:#fff}',
    '.mc-msg-meta{display:flex;gap:10px;margin-top:3px;padding:0 6px;font-size:.7rem;color:#7c8798}',
    '.mc-msg.mine .mc-msg-meta{justify-content:flex-end}',
    '.mc-report{border:0;background:none;padding:0;color:#7c8798;font:inherit;text-decoration:underline;cursor:pointer}',
    '.mc-report:disabled{text-decoration:none;cursor:default}',
    '.mc-compose{display:flex;align-items:flex-end;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(22,35,61,.1);background:#fff}',
    '.mc-compose[hidden]{display:none}',
    '.mc-compose textarea{flex:1;min-height:42px;max-height:120px;resize:none;border:1px solid rgba(22,35,61,.2);border-radius:21px;padding:10px 14px;font:16px/1.35 "IBM Plex Sans",sans-serif;color:#16233d;background:#f6f7f9}',
    '.mc-send{width:42px;height:42px;flex-shrink:0;border-radius:50%;border:0;background:#e8542a;color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}',
    '.mc-send:disabled{opacity:.5;cursor:default}',
    '.mc-send svg{width:20px;height:20px;fill:currentColor}',
    '.mc-tool{width:38px;height:42px;flex-shrink:0;border:0;border-radius:50%;background:none;color:#5b6678;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}',
    '.mc-tool:hover{color:#e8542a}',
    '.mc-tool svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    '.mc-attach{display:flex;align-items:center;gap:10px;padding:8px 12px 0;background:#fff;border-top:1px solid rgba(22,35,61,.1);font-size:.8rem;color:#5b6678}',
    '.mc-attach[hidden]{display:none}',
    '.mc-attach img{width:54px;height:54px;object-fit:cover;border-radius:10px}',
    '.mc-attach + .mc-compose{border-top:0}',
    '.mc-bubble a{color:#e8542a;text-decoration:underline;word-break:break-all}',
    '.mc-msg.mine .mc-bubble a{color:#fff}',
    '.mc-bubble.has-photo{padding:4px}',
    '.mc-bubble.has-photo .mc-text{padding:6px 9px 5px}',
    '.mc-photo-btn{display:block;border:0;padding:0;background:none;cursor:zoom-in;border-radius:14px;overflow:hidden}',
    '.mc-photo{display:block;width:200px;max-width:100%;height:auto;min-height:90px;max-height:260px;object-fit:cover;background:#e7e9ee}',
    '.mc-gone{font-style:italic;color:#7c8798;font-size:.84rem;padding:6px 9px}',
    '.mc-msg.mine .mc-gone{color:#fff}',
    '#mc-viewer{position:fixed;inset:0;z-index:440;background:rgba(10,16,30,.92);display:flex;align-items:center;justify-content:center;padding:16px}',
    '#mc-viewer img{max-width:94vw;max-height:88vh;border-radius:8px}',
    '#mc-viewer button{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));right:14px}',
    '.mc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.mc-signin{padding:28px 12px;text-align:center}',
    '.mc-signin p{margin:0 0 14px;color:#5b6678;line-height:1.5}',
    '@media (prefers-reduced-motion:reduce){#mt3uk-chat{transition:none}}'
  ].join('');
  document.head.appendChild(style);

  // ---------- Header icon ----------
  var icon = document.createElement('button');
  icon.type = 'button';
  icon.className = 'nav-chat';
  icon.id = 'nav-chat';
  icon.setAttribute('aria-label', 'Messages');
  icon.setAttribute('aria-controls', 'mt3uk-chat');
  icon.setAttribute('aria-expanded', 'false');
  icon.innerHTML = CHAT_ICON + '<span class="nav-chat-count" id="nav-chat-count" hidden></span>';
  function placeIcon() {
    if (icon.parentNode) return;
    var before = document.getElementById('nav-profile') || document.getElementById('nav-search');
    if (before) before.parentNode.insertBefore(icon, before);
  }
  placeIcon();
  // js/notify-bell.js adds the profile icon; keep the chat icon before it.
  document.addEventListener('DOMContentLoaded', function () {
    var profile = document.getElementById('nav-profile');
    if (profile && icon.nextElementSibling !== profile) profile.parentNode.insertBefore(icon, profile);
    else placeIcon();
  });

  function setIconCount(n) {
    var c = icon.querySelector('.nav-chat-count');
    c.hidden = !n;
    c.textContent = n > 99 ? '99+' : String(n || '');
    icon.setAttribute('aria-label', n ? 'Messages, ' + n + ' unread' : 'Messages');
  }
  // The bell's check already counts unread messages (js/notify-bell.js).
  document.addEventListener('mt3ukMessagesUnread', function (e) { setIconCount((e.detail && e.detail.count) || 0); });

  // ---------- Window ----------
  var box = document.createElement('div');
  box.id = 'mt3uk-chat';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'false');
  box.setAttribute('aria-labelledby', 'mc-title');
  box.hidden = true;
  box.innerHTML =
    '<div class="mc-head">' +
      '<button type="button" class="mc-icon-btn" id="mc-back" aria-label="Back" hidden>&lsaquo;</button>' +
      '<h2 id="mc-title">Messages</h2>' +
      '<button type="button" class="mc-icon-btn" id="mc-min" aria-label="Minimise messages">&minus;</button>' +
      '<button type="button" class="mc-icon-btn" id="mc-close" aria-label="Close messages">&times;</button>' +
    '</div>' +
    '<div class="mc-tabs" id="mc-tabs" role="tablist">' +
      '<button type="button" class="mc-tab" role="tab" data-view="chats" aria-selected="true">Chats <span class="mc-badge" id="mc-badge-chats" hidden></span></button>' +
      '<button type="button" class="mc-tab" role="tab" data-view="friends" aria-selected="false">Friends <span class="mc-badge" id="mc-badge-friends" hidden></span></button>' +
      '<button type="button" class="mc-tab" role="tab" data-view="mt3uk" aria-selected="false">MT3UK <span class="mc-badge" id="mc-badge-mt3uk" hidden></span></button>' +
    '</div>' +
    '<div class="mc-body" id="mc-body">' +
      '<div class="mc-view mc-signin" id="mc-signin" hidden>' +
        '<p>Sign in to message your friends and see messages from MT3UK.</p>' +
        '<a class="mc-btn mc-btn-primary" id="mc-signin-link" href="signin.html">Sign Up / Sign In</a>' +
      '</div>' +
      '<div class="mc-view" id="mc-view-chats"><ul class="mc-list" id="mc-threads"><li class="mc-empty">Loading&hellip;</li></ul></div>' +
      '<div class="mc-view" id="mc-view-friends" hidden>' +
        '<p class="mc-note" id="mc-need-nick" hidden>Choose a nickname in <a href="profile.html">your Profile</a> first, so friends can find you and see who you are.</p>' +
        '<form class="mc-search" id="mc-search" novalidate>' +
          '<label for="mc-search-q" class="mc-sr">Find members by nickname or name</label>' +
          '<input type="search" id="mc-search-q" placeholder="Find members by nickname or name" autocomplete="off">' +
          '<button type="submit" class="mc-btn">Search</button>' +
        '</form>' +
        '<ul class="mc-list" id="mc-results"></ul>' +
        '<div id="mc-requests"></div>' +
        '<h3 class="mc-h3">Your friends <span id="mc-friend-count"></span></h3>' +
        '<ul class="mc-list" id="mc-friends"></ul>' +
        '<p class="mc-status" id="mc-friends-status" role="status"></p>' +
      '</div>' +
      '<div class="mc-view" id="mc-view-mt3uk" hidden><ul class="mc-list" id="mc-broadcasts"></ul></div>' +
      '<div class="mc-view" id="mc-view-thread" hidden>' +
        '<ol class="mc-bubbles" id="mc-bubbles"></ol>' +
        '<p class="mc-status" id="mc-thread-status" role="status"></p>' +
      '</div>' +
    '</div>' +
    '<div class="mc-attach" id="mc-attach" hidden>' +
      '<img id="mc-attach-img" alt="Photo to send"><span>Photo ready to send</span>' +
      '<button type="button" class="mc-btn" id="mc-attach-remove">Remove</button>' +
    '</div>' +
    '<form class="mc-compose" id="mc-compose" hidden novalidate>' +
      '<button type="button" class="mc-tool" id="mc-photo-btn" aria-label="Attach a photo">' + PHOTO_ICON + '</button>' +
      '<input type="file" id="mc-photo-input" accept="image/*" hidden>' +
      '<button type="button" class="mc-tool" id="mc-link-btn" aria-label="Add a link to a website">' + LINK_ICON + '</button>' +
      '<label for="mc-compose-text" class="mc-sr">Message</label>' +
      '<textarea id="mc-compose-text" rows="1" maxlength="1000" placeholder="Message"></textarea>' +
      '<button type="submit" class="mc-send" aria-label="Send">' + SEND_ICON + '</button>' +
    '</form>';

  // The minimised window: a round bubble in the corner.
  var mini = document.createElement('button');
  mini.type = 'button';
  mini.id = 'mt3uk-chat-min';
  mini.hidden = true;
  mini.setAttribute('aria-label', 'Open messages');
  mini.innerHTML = CHAT_ICON + '<span class="mc-badge" id="mc-badge-min" hidden></span>';

  function $(id) { return document.getElementById(id); }
  function mount() {
    if (!box.parentNode) document.body.appendChild(box);
    if (!mini.parentNode) document.body.appendChild(mini);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  var profile = null;
  var view = 'chats';
  var openThreadId = null;
  var knownNames = {};
  var unreadById = {};
  var broadcastsUnread = 0;
  var directUnread = 0;

  function status(el, msg, kind) { el.textContent = msg || ''; el.className = 'mc-status' + (kind ? ' is-' + kind : ''); }
  function badge(el, n) { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n || ''); }

  // Open or minimised, and where, kept while moving between pages.
  function readState() {
    try { return JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveState(mode) {
    try {
      if (!mode) sessionStorage.removeItem(STATE_KEY);
      else sessionStorage.setItem(STATE_KEY, JSON.stringify({ mode: mode, view: view === 'thread' ? 'chats' : view, withId: view === 'thread' ? openThreadId : null }));
    } catch (e) {}
  }

  // Web addresses become links. The text is escaped piece by piece.
  function linkify(text) {
    var out = '';
    var last = 0;
    String(text || '').replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi, function (m, _u, idx) {
      var trail = (m.match(/[.,!?;:)\]'"]+$/) || [''])[0];
      var url = trail ? m.slice(0, -trail.length) : m;
      var href = /^www\./i.test(url) ? 'https://' + url : url;
      var ok = false;
      try { var u = new URL(href); ok = /^https?:$/.test(u.protocol) && u.hostname.indexOf('.') !== -1; } catch (e) {}
      out += esc(text.slice(last, idx));
      out += ok ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer nofollow ugc">' + esc(url) + '</a>' + esc(trail) : esc(m);
      last = idx + m.length;
      return m;
    });
    return out + esc(String(text || '').slice(last));
  }

  function api(method, path, body) {
    var opts = { method: method, headers: { 'X-Session-Token': session() }, cache: 'no-store' };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { showSignIn(); throw new Error('signed out'); }
        data.ok = res.ok;
        return data;
      });
    });
  }

  function showSignIn() {
    ['mc-view-chats', 'mc-view-friends', 'mc-view-mt3uk', 'mc-view-thread'].forEach(function (id) { $(id).hidden = true; });
    $('mc-tabs').hidden = true;
    $('mc-compose').hidden = true;
    $('mc-back').hidden = true;
    $('mc-title').textContent = 'Messages';
    $('mc-signin-link').href = 'signin.html?next=' + encodeURIComponent(location.pathname + location.search);
    $('mc-signin').hidden = false;
  }

  function show(name) {
    view = name;
    $('mc-signin').hidden = true;
    $('mc-tabs').hidden = name === 'thread';
    $('mc-back').hidden = name !== 'thread';
    ['chats', 'friends', 'mt3uk', 'thread'].forEach(function (v) { $('mc-view-' + v).hidden = v !== name; });
    box.querySelectorAll('.mc-tab').forEach(function (t) { t.setAttribute('aria-selected', t.dataset.view === name ? 'true' : 'false'); });
    $('mc-compose').hidden = name !== 'thread';
    if (name !== 'thread') {
      openThreadId = null;
      $('mc-title').textContent = name === 'friends' ? 'Friends' : 'Messages';
    }
    if (name === 'mt3uk') markBroadcastsRead();
    $('mc-body').scrollTop = 0;
    if (!box.hidden) saveState('open');
  }

  function updateBadges() {
    badge($('mc-badge-min'), directUnread + broadcastsUnread);
    badge($('mc-badge-chats'), directUnread);
    badge($('mc-badge-mt3uk'), broadcastsUnread);
    badge($('mc-badge-friends'), profile ? profile.incoming.length : 0);
    setIconCount(directUnread + broadcastsUnread);
  }

  // ---------- Chats and MT3UK ----------
  function loadMessages() {
    return api('GET', '/profile/messages').then(function (data) {
      if (!data.success) return;
      broadcastsUnread = data.broadcasts.filter(function (b) { return b.unread; }).length;
      $('mc-broadcasts').innerHTML = data.broadcasts.length ? data.broadcasts.map(function (b) {
        return '<li class="mc-bc"><h3>' + (b.unread ? '<span class="mc-dot" aria-label="New"></span>' : '') + esc(b.title) + '</h3>' +
          '<time datetime="' + esc(b.at) + '">' + esc(when(b.at)) + '</time><p>' + esc(b.text) + '</p></li>';
      }).join('') : '<li class="mc-empty">No messages from MT3UK yet. News for members will appear here.</li>';
      unreadById = {};
      data.threads.forEach(function (t) {
        knownNames[t.id] = t.name;
        if (t.unread) unreadById[t.id] = t.unread;
      });
      directUnread = data.threads.reduce(function (n, t) { return n + (t.unread || 0); }, 0);
      $('mc-threads').innerHTML = data.threads.length ? data.threads.map(function (t) {
        return '<li><button type="button" class="mc-row mc-thread-row' + (t.unread ? ' is-unread' : '') + '" data-id="' + esc(t.id) + '">' +
          '<span class="mc-avatar" aria-hidden="true">' + esc(initials(t.name)) + '</span>' +
          '<span class="mc-who"><strong>' + esc(t.name) + '</strong><span>' + (t.lastFromMe ? 'You: ' : '') + esc(t.lastText) + '</span></span>' +
          '<span class="mc-meta"><time datetime="' + esc(t.lastAt) + '">' + esc(when(t.lastAt)) + '</time>' + (t.unread ? '<span class="mc-dot" aria-label="New"></span>' : '') + '</span>' +
        '</button></li>';
      }).join('') : '<li class="mc-empty">No chats yet. Message a friend from <a href="#" data-mc-view="friends">Friends</a>.</li>';
      updateBadges();
      if (profile) drawFriends();
      if (view === 'mt3uk' && !box.hidden) markBroadcastsRead();
    });
  }

  function markBroadcastsRead() {
    if (!broadcastsUnread) return;
    broadcastsUnread = 0;
    updateBadges();
    api('POST', '/profile/messages/read', {}).catch(function () {});
  }

  function openThread(id) {
    openThreadId = id;
    show('thread');
    openThreadId = id;
    $('mc-title').textContent = knownNames[id] || '';
    clearPhoto();
    if (!box.hidden) saveState('open');
    $('mc-bubbles').innerHTML = '<li class="mc-empty">Loading&hellip;</li>';
    status($('mc-thread-status'), '');
    return api('GET', '/profile/messages/thread?with=' + encodeURIComponent(id)).then(function (data) {
      if (openThreadId !== id) return;
      if (!data.success) { status($('mc-thread-status'), data.message || 'Could not open this conversation.', 'err'); return; }
      knownNames[id] = data.with.name;
      $('mc-title').textContent = data.with.name + (data.with.nickname && data.with.nickname !== data.with.name ? ' (' + data.with.nickname + ')' : '');
      $('mc-compose').hidden = !data.friend;
      if (!data.friend) status($('mc-thread-status'), 'You are no longer friends, so you can read these messages but not reply.');
      drawBubbles(data.messages);
      loadMessages().catch(function () {});
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && data.friend) $('mc-compose-text').focus();
    }).catch(function () {});
  }

  function bubbleHtml(m) {
    var name = knownNames[openThreadId] || '';
    var photo = m.photo || m.localUrl
      ? '<button type="button" class="mc-photo-btn" aria-label="View photo"><img class="mc-photo" alt="Photo" data-mid="' + esc(m.id || '') + '"' + (m.localUrl ? ' src="' + esc(m.localUrl) + '"' : '') + '></button>'
      : m.photoGone ? '<div class="mc-gone">Photo no longer available</div>' : '';
    return '<li class="mc-msg' + (m.mine ? ' mine' : '') + '" data-id="' + esc(m.id || '') + '">' +
      (m.mine ? '' : '<span class="mc-avatar" aria-hidden="true">' + esc(initials(name)) + '</span>') +
      '<div><div class="mc-bubble' + (photo ? ' has-photo' : '') + '">' + photo + (m.text ? (photo ? '<div class="mc-text">' + linkify(m.text) + '</div>' : linkify(m.text)) : '') + '</div>' +
      '<div class="mc-msg-meta"><time datetime="' + esc(m.at) + '">' + esc(when(m.at)) + '</time>' +
      (m.mine ? '' : '<button type="button" class="mc-report">Report</button>') + '</div></div></li>';
  }

  function drawBubbles(messages) {
    $('mc-bubbles').innerHTML = messages.length ? messages.map(bubbleHtml).join('') : '<li class="mc-empty">No messages yet. Say hello.</li>';
    var body = $('mc-body');
    body.scrollTop = body.scrollHeight;
    loadPhotos();
  }

  // Photos come from the worker with the sign-in, so only the two people in
  // the conversation can see them. Kept for this page once loaded.
  var photoUrls = {};
  function loadPhotos() {
    var id = openThreadId;
    $('mc-bubbles').querySelectorAll('img.mc-photo:not([src])').forEach(function (img) {
      var mid = img.getAttribute('data-mid');
      if (photoUrls[mid]) { img.src = photoUrls[mid]; return; }
      fetch(API + '/profile/messages/photo?with=' + encodeURIComponent(id) + '&m=' + encodeURIComponent(mid), { headers: { 'X-Session-Token': session() } })
        .then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          return res.blob();
        })
        .then(function (blob) {
          photoUrls[mid] = URL.createObjectURL(blob);
          img.src = photoUrls[mid];
          img.addEventListener('load', function () {
            var body = $('mc-body');
            if (body.scrollHeight - body.scrollTop - body.clientHeight < 400) body.scrollTop = body.scrollHeight;
          }, { once: true });
        })
        .catch(function () {
          var btn = img.closest('.mc-photo-btn');
          if (btn) btn.outerHTML = '<div class="mc-gone">Photo no longer available</div>';
        });
    });
  }

  function viewPhoto(src) {
    var v = document.createElement('div');
    v.id = 'mc-viewer';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-label', 'Photo');
    v.innerHTML = '<img alt="Photo" src="' + esc(src) + '"><button type="button" class="mc-icon-btn" aria-label="Close photo">&times;</button>';
    function shut() { v.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); shut(); } }
    v.addEventListener('click', shut);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(v);
    v.querySelector('button').focus();
  }

  // ---------- Friends ----------
  function who(card, extra) {
    var nick = card.nickname && card.nickname !== card.name ? '<span>' + esc(card.nickname) + '</span>' : '';
    return '<span class="mc-avatar" aria-hidden="true">' + esc(initials(card.name)) + '</span>' +
      '<span class="mc-who"><strong>' + esc(card.name) + '</strong>' + nick + (extra || '') + '</span>';
  }

  function drawFriends() {
    var req = '';
    if (profile.incoming.length) {
      req += '<h3 class="mc-h3">Friend requests</h3><ul class="mc-list">' + profile.incoming.map(function (c) {
        return '<li class="mc-row">' + who(c, '<span>wants to be friends</span>') + '<span class="mc-actions">' +
          '<button type="button" class="mc-btn mc-btn-primary mc-fr" data-action="accept" data-id="' + esc(c.id) + '">Accept</button>' +
          '<button type="button" class="mc-btn mc-fr" data-action="decline" data-id="' + esc(c.id) + '">Decline</button></span></li>';
      }).join('') + '</ul>';
    }
    if (profile.outgoing.length) {
      req += '<h3 class="mc-h3">Requests you&rsquo;ve sent</h3><ul class="mc-list">' + profile.outgoing.map(function (c) {
        return '<li class="mc-row">' + who(c, '<span>waiting for them to accept</span>') + '<span class="mc-actions">' +
          '<button type="button" class="mc-btn mc-fr" data-action="cancel" data-id="' + esc(c.id) + '">Cancel</button></span></li>';
      }).join('') + '</ul>';
    }
    $('mc-requests').innerHTML = req;
    $('mc-need-nick').hidden = !!profile.nickname;
    profile.friends.forEach(function (c) { knownNames[c.id] = c.name; });
    $('mc-friend-count').textContent = profile.friends.length ? '(' + profile.friends.length + ')' : '';
    $('mc-friends').innerHTML = profile.friends.length ? profile.friends.map(function (c) {
      var builds = c.builds && c.builds.length;
      var unread = unreadById[c.id] || 0;
      return '<li class="mc-row">' + who(c, unread ? '<span class="mc-tag">' + unread + ' NEW</span>' : '') + '<span class="mc-actions">' +
        '<button type="button" class="mc-btn mc-btn-primary mc-msg-btn" data-id="' + esc(c.id) + '">Message</button>' +
        (builds ? '<a class="mc-btn" href="gallery.html?only=' + encodeURIComponent(c.builds.join(',')) + '">Builds (' + builds + ')</a>' : '') +
        '<button type="button" class="mc-btn mc-fr" data-action="remove" data-id="' + esc(c.id) + '">Remove</button></span></li>';
    }).join('') : '<li class="mc-empty">No friends yet. Find members by their nickname above.</li>';
    updateBadges();
  }

  function loadProfile() {
    return api('GET', '/profile').then(function (data) {
      if (!data.success) return;
      profile = data;
      drawFriends();
    });
  }

  function friendAction(action, idOrNick, btn) {
    if (action === 'remove' && !window.confirm('Remove this friend? You can add them again later.')) return;
    var body = { action: action };
    if (action === 'request') body.nickname = idOrNick; else body.id = idOrNick;
    if (btn) btn.disabled = true;
    api('POST', '/profile/friends', body).then(function (data) {
      if (!data.success) { if (btn) btn.disabled = false; status($('mc-friends-status'), data.message || 'Something went wrong, please try again.', 'err'); return; }
      status($('mc-friends-status'), {
        request: data.status === 'requested' ? 'Friend request sent.' : 'You are now friends.',
        accept: 'You are now friends.', decline: 'Request declined.', cancel: 'Request cancelled.', remove: 'Friend removed.'
      }[action], 'ok');
      if (action === 'request' && btn) btn.textContent = 'Requested';
      loadProfile();
    }).catch(function () { if (btn) btn.disabled = false; });
  }

  // ---------- Events ----------
  box.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('.mc-photo-btn'))) { var img = t.querySelector('img'); if (img && img.src) viewPhoto(img.src); return; }
    if ((t = e.target.closest('.mc-tab'))) { show(t.dataset.view); return; }
    if ((t = e.target.closest('[data-mc-view]'))) { e.preventDefault(); show(t.getAttribute('data-mc-view')); return; }
    if ((t = e.target.closest('.mc-thread-row'))) { openThread(t.getAttribute('data-id')); return; }
    if ((t = e.target.closest('.mc-msg-btn'))) { openThread(t.getAttribute('data-id')); return; }
    if ((t = e.target.closest('.mc-fr'))) { friendAction(t.getAttribute('data-action'), t.getAttribute('data-id') || t.getAttribute('data-nick'), t); return; }
    if ((t = e.target.closest('.mc-report')) && openThreadId) {
      var msg = t.closest('.mc-msg');
      var reason = window.prompt('Report this message to MT3UK? Add a reason if you like:', '');
      if (reason === null) return;
      t.disabled = true;
      api('POST', '/profile/messages/report', { with: openThreadId, messageId: msg.getAttribute('data-id'), reason: reason }).then(function (data) {
        if (!data.success) { t.disabled = false; status($('mc-thread-status'), data.message || 'Could not report, please try again.', 'err'); return; }
        t.textContent = 'Reported';
        status($('mc-thread-status'), 'Thanks, MT3UK will take a look. You can also remove this friend in Friends.', 'ok');
      }).catch(function () { t.disabled = false; });
    }
  });

  $('mc-close').addEventListener('click', function () { close(); });
  $('mc-back').addEventListener('click', function () { show('chats'); loadMessages().catch(function () {}); });

  $('mc-search').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('mc-search-q').value.trim();
    if (q.length < 2) { $('mc-results').innerHTML = '<li class="mc-empty">Type at least 2 letters of a nickname or name.</li>'; return; }
    api('GET', '/profile/search?q=' + encodeURIComponent(q)).then(function (data) {
      var results = (data && data.results) || [];
      var canAdd = profile && profile.nickname;
      $('mc-results').innerHTML = results.length ? results.map(function (c) {
        var action = c.status === 'friend' ? '<span class="mc-tag">FRIENDS</span>'
          : c.status === 'requested' ? '<span class="mc-tag">REQUESTED</span>'
          : c.status === 'incoming' ? '<button type="button" class="mc-btn mc-btn-primary mc-fr" data-action="accept" data-id="' + esc(c.id) + '">Accept</button>'
          : '<button type="button" class="mc-btn mc-btn-primary mc-fr" data-action="request" data-nick="' + esc(c.nickname) + '"' + (canAdd ? '' : ' disabled title="Choose a nickname first"') + '>Add friend</button>';
        return '<li class="mc-row">' + who(c) + '<span class="mc-actions">' + action + '</span></li>';
      }).join('') : '<li class="mc-empty">No members with a nickname or name like that.</li>';
    }).catch(function () {});
  });

  var compose = $('mc-compose-text');
  compose.addEventListener('input', function () {
    compose.style.height = 'auto';
    compose.style.height = Math.min(compose.scrollHeight + 2, 120) + 'px';
  });
  // On a computer, Return sends and Shift+Return starts a new line.
  compose.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    e.preventDefault();
    var form = $('mc-compose');
    if (form.requestSubmit) form.requestSubmit(); else form.querySelector('button').click();
  });
  // ----- Photos: shrunk on the device (longest side 1280px) before sending.
  var pendingPhoto = null;
  var pendingUrl = null;
  function clearPhoto() {
    pendingPhoto = null;
    if (pendingUrl) { URL.revokeObjectURL(pendingUrl); pendingUrl = null; }
    $('mc-attach').hidden = true;
    $('mc-photo-input').value = '';
  }
  function shrink(file) {
    var MAX = 1280;
    function draw(src, w, h) {
      var scale = Math.min(1, MAX / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('blob')); }, 'image/jpeg', 0.8);
      });
    }
    function viaImg() {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); draw(img, img.naturalWidth, img.naturalHeight).then(resolve, reject); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('img')); };
        img.src = url;
      });
    }
    // An animated GIF would lose its movement, so small ones go as they are.
    if (file.type === 'image/gif' && file.size < 2 * 1024 * 1024) return Promise.resolve(file);
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(function (bmp) { return draw(bmp, bmp.width, bmp.height); })
        .catch(viaImg);
    }
    return viaImg();
  }
  $('mc-photo-btn').addEventListener('click', function () { $('mc-photo-input').click(); });
  $('mc-photo-input').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { status($('mc-thread-status'), 'Please choose a photo.', 'err'); return; }
    status($('mc-thread-status'), 'Getting your photo ready\u2026');
    shrink(file).then(function (blob) {
      clearPhoto();
      pendingPhoto = blob;
      pendingUrl = URL.createObjectURL(blob);
      $('mc-attach-img').src = pendingUrl;
      $('mc-attach').hidden = false;
      status($('mc-thread-status'), '');
      compose.focus({ preventScroll: true });
    }).catch(function () { status($('mc-thread-status'), 'That photo couldn\u2019t be used. Try another, or a screenshot of it.', 'err'); });
  });
  $('mc-attach-remove').addEventListener('click', clearPhoto);

  // ----- Links: asks for a web address and adds it to the message.
  $('mc-link-btn').addEventListener('click', function () {
    var input = window.prompt('Add a link to a website', 'https://');
    if (input === null) return;
    var url = input.trim();
    if (!url || url === 'https://') return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    var ok = false;
    try { var u = new URL(url); ok = /^https?:$/.test(u.protocol) && u.hostname.indexOf('.') !== -1; } catch (e) {}
    if (!ok) { status($('mc-thread-status'), 'That doesn\u2019t look like a web address. Try something like mt3uk.com.', 'err'); return; }
    status($('mc-thread-status'), '');
    var at = typeof compose.selectionStart === 'number' ? compose.selectionStart : compose.value.length;
    var before = compose.value.slice(0, at);
    var after = compose.value.slice(at);
    var add = (before && !/\s$/.test(before) ? ' ' : '') + url + (after && !/^\s/.test(after) ? ' ' : '');
    compose.value = before + add + after;
    compose.dispatchEvent(new Event('input'));
    compose.focus();
    try { compose.setSelectionRange(at + add.length, at + add.length); } catch (e) {}
  });

  $('mc-compose').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = compose.value.trim();
    var id = openThreadId;
    var photo = pendingPhoto;
    var localUrl = pendingUrl;
    if ((!text && !photo) || !id) return;
    var btn = e.target.querySelector('.mc-send');
    btn.disabled = true;
    var sending;
    if (photo) {
      var form = new FormData();
      form.append('with', id);
      form.append('text', text);
      form.append('photo', photo, photo.type === 'image/gif' ? 'photo.gif' : 'photo.jpg');
      status($('mc-thread-status'), 'Sending photo\u2026');
      sending = fetch(API + '/profile/messages/send', { method: 'POST', headers: { 'X-Session-Token': session() }, body: form, cache: 'no-store' })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.status === 401) { showSignIn(); throw new Error('signed out'); }
            return data;
          });
        });
    } else {
      sending = api('POST', '/profile/messages/send', { with: id, text: text });
    }
    sending.then(function (data) {
      btn.disabled = false;
      if (!data.success) { status($('mc-thread-status'), data.message || 'Could not send, please try again.', 'err'); return; }
      compose.value = '';
      compose.style.height = '';
      status($('mc-thread-status'), '');
      if (photo) {
        // The photo on screen stays; the preview is just hidden.
        pendingPhoto = null;
        pendingUrl = null;
        $('mc-attach').hidden = true;
        $('mc-photo-input').value = '';
        if (data.message && data.message.id) photoUrls[data.message.id] = localUrl;
      }
      if (openThreadId !== id) return;
      var list = $('mc-bubbles');
      if (list.querySelector('.mc-empty')) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', bubbleHtml({ id: data.message.id, text: data.message.text, at: data.message.at, mine: true, localUrl: photo ? localUrl : null }));
      $('mc-body').scrollTop = $('mc-body').scrollHeight;
      loadMessages().catch(function () {});
    }).catch(function (err) { btn.disabled = false; if (err.message !== 'signed out') status($('mc-thread-status'), 'Network error, please try again.', 'err'); });
  });

  // ---------- Open and close ----------
  var lastFocus = null;

  var loadedHere = false;

  function reveal() {
    mount();
    mini.hidden = true;
    box.hidden = false;
    requestAnimationFrame(function () { box.classList.add('is-open'); });
    icon.setAttribute('aria-expanded', 'true');
  }

  function open(which, withId) {
    lastFocus = document.activeElement;
    reveal();
    if (!session()) { showSignIn(); $('mc-close').focus(); return; }
    loadedHere = true;
    show(which === 'friends' || which === 'mt3uk' ? which : 'chats');
    saveState('open');
    if (withId) openThread(withId);
    $('mc-close').focus({ preventScroll: true });
    Promise.all([loadProfile(), loadMessages()]).then(function () {
      if (which === 'mt3uk' && view === 'mt3uk') markBroadcastsRead();
    }).catch(function () {});
  }

  // Minimise: the window shrinks to the round bubble, just as it was.
  function minimise() {
    box.classList.remove('is-open');
    box.hidden = true;
    mini.hidden = false;
    icon.setAttribute('aria-expanded', 'false');
    saveState('min');
    try { mini.focus({ preventScroll: true }); } catch (e) {}
  }

  function restore() {
    var st = readState() || {};
    if (loadedHere) {
      reveal();
      saveState('open');
      if (view === 'thread') loadPhotos();
      $('mc-min').focus({ preventScroll: true });
    } else {
      open(st.view, st.withId);
    }
  }

  function close() {
    box.classList.remove('is-open');
    box.hidden = true;
    mini.hidden = true;
    icon.setAttribute('aria-expanded', 'false');
    saveState(null);
    clearPhoto();
    openThreadId = null;
    if (/#(messages|friends)$/.test(location.hash)) {
      try { history.replaceState(null, '', location.pathname + location.search.replace(/[?&]with=[^&]*/, '').replace(/^&/, '?')); } catch (e) {}
    }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
  }

  $('mc-min').addEventListener('click', minimise);
  mini.addEventListener('click', restore);

  icon.addEventListener('click', function () {
    if (!box.hidden) { close(); return; }
    if (!mini.hidden) { restore(); return; }
    // Open where there's something new.
    open(!directUnread && broadcastsUnread ? 'mt3uk' : 'chats');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !box.hidden) close();
  });

  // Menu, bell, email and notification links to Messages and Friends open
  // the window here instead of going to the Profile page.
  function target(url) {
    var u;
    try { u = new URL(url, location.href); } catch (e) { return null; }
    if (u.origin !== location.origin || !/(^|\/)profile\.html$/.test(u.pathname)) return null;
    if (u.hash === '#friends') return { view: 'friends' };
    if (u.hash === '#messages') return { view: 'chats', withId: u.searchParams.get('with') };
    return null;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    var t = target(a.href);
    if (!t) return;
    e.preventDefault();
    var bell = document.getElementById('nav-bell-panel');
    if (bell && !bell.hidden && bell.contains(a)) document.getElementById('nav-bell-btn').click();
    open(t.view, t.withId);
  });

  // Arriving at a Messages or Friends link opens the window; otherwise it
  // comes back open or minimised as it was on the last page.
  function openFromUrl() {
    if (!session()) { saveState(null); return; }
    var t = target(location.href);
    if (t) { open(t.view, t.withId); return; }
    var st = readState();
    if (st && st.mode === 'open') open(st.view, st.withId);
    else if (st && st.mode === 'min') { mount(); mini.hidden = false; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openFromUrl);
  else openFromUrl();

  window.mt3ukChat = { open: open, close: close };
})();
