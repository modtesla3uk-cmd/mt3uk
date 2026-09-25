/* MT3UK Owner Interviews: comments.
   Usage on an interview page:
     <div class="ic" id="comments" data-thread="richard"></div>
     <script src="js/interview-comments.js" defer></script>
   Uses the same comments system as the Gallery Feed (vote worker), stored under "interview:<thread>".
   Only signed-in members (My Garage) can post. Anyone can read, like and report.
   On localhost (or with ?comments=demo) it runs in local preview mode: nothing is sent to the
   live site, comments are kept in this browser only. Add ?comments=live to use the real system locally. */
(function () {
  var root = document.querySelector('.ic[data-thread]');
  if (!root) return;

  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var thread = 'interview:' + root.getAttribute('data-thread');
  var DEMO = !/[?&]comments=live\b/.test(location.search) && (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]comments=demo\b/.test(location.search));

  var voterId = null;
  try {
    voterId = localStorage.getItem('mt3ukVoterId');
    if (!voterId) {
      voterId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('v' + Date.now() + Math.random().toString(36).slice(2));
      localStorage.setItem('mt3ukVoterId', voterId);
    }
  } catch (e) { voterId = 'anon-' + Date.now(); }
  function session() { try { return localStorage.getItem('mt3ukMyBuildsSession'); } catch (e) { return null; } }

  var reported = [];
  try { reported = JSON.parse(localStorage.getItem('mt3ukReportedComments') || '[]'); } catch (e) {}

  /* ---------- styles ---------- */
  var css = [
    '.ic{clear:both;margin:48px 0 0;padding-top:28px;border-top:1px solid var(--ink,#16233d);scroll-margin-top:90px}',
    '.ic-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}',
    '.ic-title{font-family:"Archivo Expanded",sans-serif;font-size:1.25rem;margin:0;color:var(--charcoal,#1c1c1c)}',
    '.ic-count{font-family:"IBM Plex Mono",monospace;font-size:.74rem;letter-spacing:.06em;color:#56606f;text-transform:uppercase}',
    '.ic-demo{font-family:"IBM Plex Mono",monospace;font-size:.72rem;line-height:1.5;background:#fff4d6;border:1px dashed #b98900;color:#5c4400;padding:8px 12px;margin-bottom:16px}',
    '.ic-form{display:flex;flex-direction:column;gap:8px;margin-bottom:24px}',
    '.ic-as{font-family:"IBM Plex Mono",monospace;font-size:.72rem;color:#56606f;margin:0}',
    '.ic-form textarea{width:100%;min-height:92px;box-sizing:border-box;padding:12px;border:1px solid var(--ink,#16233d);background:#fff;font:inherit;font-size:.95rem;color:var(--charcoal,#1c1c1c);resize:vertical}',
    '.ic-form textarea:focus{outline:2px solid var(--orange,#e8542a);outline-offset:1px}',
    '.ic-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
    '.ic-left{font-family:"IBM Plex Mono",monospace;font-size:.68rem;color:#56606f}',
    '.ic-btn{min-height:44px;padding:10px 20px;border:0;background:#c8431d;color:#fff;font-family:"IBM Plex Mono",monospace;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}',
    '.ic-btn:hover{background:#a93814}.ic-btn[disabled]{opacity:.5;cursor:default}',
    '.ic-btn-quiet{background:transparent;color:var(--ink,#16233d);border:1px solid var(--ink,#16233d)}',
    '.ic-btn-quiet:hover{background:var(--paper-2,#e9e5d8)}',
    '.ic-error{color:#b3261e;font-family:"IBM Plex Mono",monospace;font-size:.72rem;margin:0}',
    '.ic-signin{background:var(--ink,#16233d);color:#f3f1ea;padding:18px 20px;margin-bottom:24px;display:flex;flex-direction:column;gap:10px}',
    '.ic-signin p{margin:0;color:#d3d8e2;font-size:.92rem}',
    '.ic-signin strong{color:#fff}',
    '.ic-signin .ic-links{display:flex;gap:10px;flex-wrap:wrap}',
    '.ic-signin a{display:inline-flex;align-items:center;min-height:44px;padding:10px 18px;font-family:"IBM Plex Mono",monospace;font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;text-decoration:none}',
    '.ic-signin a.ic-primary{background:#c8431d;color:#fff}',
    '.ic-signin a.ic-secondary{border:1px solid rgba(255,255,255,.55);color:#fff}',
    '.ic-list,.ic-replies{list-style:none;margin:0;padding:0}',
    '.ic-replies{margin:12px 0 0 18px;padding-left:14px;border-left:2px solid var(--paper-2,#e9e5d8)}',
    '.ic-item{padding:14px 0;border-bottom:1px solid rgba(22,35,61,.12)}',
    '.ic-replies .ic-item{border-bottom:0;padding:10px 0 0}',
    '.ic-meta{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
    '.ic-name{font-weight:600;color:var(--charcoal,#1c1c1c)}',
    '.ic-when{font-family:"IBM Plex Mono",monospace;font-size:.68rem;color:#56606f}',
    '.ic-text{margin:6px 0 8px;white-space:pre-line;color:var(--ink-2,#223257);font-size:.95rem;line-height:1.55}',
    '.ic-actions{display:flex;gap:4px;flex-wrap:wrap;align-items:center}',
    '.ic-act{min-height:36px;padding:6px 10px;background:none;border:0;font-family:"IBM Plex Mono",monospace;font-size:.7rem;letter-spacing:.04em;color:#56606f;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '.ic-act:hover{color:var(--ink,#16233d)}',
    '.ic-act[aria-pressed="true"]{color:#c8431d}',
    '.ic-act svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2}',
    '.ic-act[aria-pressed="true"] svg{fill:currentColor}',
    '.ic-act[disabled]{opacity:.55;cursor:default}',
    '.ic-empty{padding:18px 0;color:#56606f;font-size:.92rem}',
    '.ic-reply-slot{margin-top:8px}',
    '.ic-reply-slot .ic-form{margin-bottom:6px}',
    '.ic-reply-slot textarea{min-height:64px}'
  ].join('');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear();
  }
  function nameFromEmail(email) {
    var local = (email.split('@')[0] || 'guest').replace(/[._+-]+/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').trim();
    return local ? local.split(' ').filter(Boolean).map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }).join(' ').slice(0, 40) : 'Guest';
  }

  /* ---------- data layer: live worker, or local preview store ---------- */
  var DEMO_KEY = 'mt3ukDemoComments:' + thread;
  var DEMO_EMAIL = 'you@mt3uk-preview.local';
  function demoLoad() { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; } }
  function demoSave(list) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(list)); } catch (e) {} }
  function demoPublic(c) { return { id: c.id, parentId: c.parentId, name: c.name, text: c.text, createdAt: c.createdAt, likes: c.likes || 0, liked: !!c.liked, mine: c.email === DEMO_EMAIL }; }

  var store = DEMO ? {
    me: function () { return Promise.resolve(DEMO_EMAIL); },
    list: function () { return Promise.resolve(demoLoad().filter(function (c) { return !c.hidden; }).map(demoPublic)); },
    post: function (email, text, parentId) {
      var list = demoLoad();
      list.push({ id: 'd' + Date.now(), parentId: parentId || null, name: 'You (preview)', email: email, text: text, createdAt: new Date().toISOString(), likes: 0 });
      demoSave(list); return Promise.resolve({ success: true });
    },
    like: function (id) {
      var list = demoLoad(); var c = list.filter(function (x) { return x.id === id; })[0];
      if (c) { c.liked = !c.liked; c.likes = Math.max(0, (c.likes || 0) + (c.liked ? 1 : -1)); demoSave(list); }
      return Promise.resolve({ success: true, liked: c && c.liked, likes: c && c.likes });
    },
    report: function () { return Promise.resolve({ success: true }); },
    remove: function (id) { demoSave(demoLoad().filter(function (c) { return c.id !== id && c.parentId !== id; })); return Promise.resolve({ success: true }); }
  } : {
    me: function () {
      var token = session();
      if (!token) return Promise.resolve(null);
      return fetch(API + '/my-builds', { headers: { 'X-Session-Token': token }, cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) { return (d && d.success && d.email) || null; })
        .catch(function () { return null; });
    },
    list: function () {
      var h = { 'X-Voter-Id': voterId }; var t = session(); if (t) h['X-Session-Token'] = t;
      return fetch(API + '/comments?file=' + encodeURIComponent(thread), { headers: h, cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (!d || !d.success) throw new Error('load'); return d.comments || []; });
    },
    post: function (email, text, parentId) {
      return fetch(API + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Voter-Id': voterId, 'X-Session-Token': session() || '' },
        body: JSON.stringify({ file: thread, email: email, text: text, parentId: parentId || null })
      }).then(function (r) { return r.json(); });
    },
    like: function (id) {
      return fetch(API + '/comments/like', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voter-Id': voterId },
        body: JSON.stringify({ file: thread, id: id })
      }).then(function (r) { return r.json(); });
    },
    report: function (id) {
      return fetch(API + '/comments/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voter-Id': voterId },
        body: JSON.stringify({ file: thread, id: id })
      }).then(function (r) { return r.json(); });
    },
    remove: function (id) {
      return fetch(API + '/comments/mine?file=' + encodeURIComponent(thread) + '&id=' + encodeURIComponent(id), {
        method: 'DELETE', headers: { 'X-Session-Token': session() || '' }
      }).then(function (r) { return r.json(); });
    }
  };

  /* ---------- rendering ---------- */
  var myEmail = null;
  var comments = [];
  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-10.2-9.3C-0.2 8 1.4 3.9 5.3 3.2 7.7 2.8 10 3.9 12 6.4c2-2.5 4.3-3.6 6.7-3.2 3.9.7 5.5 4.8 3.5 8.5C19.5 16.4 12 21 12 21z"/></svg>';

  root.innerHTML =
    '<div class="ic-head"><h2 class="ic-title">Comments</h2><span class="ic-count" id="ic-count"></span></div>' +
    (DEMO ? '<p class="ic-demo">Local preview: comments you post here are saved in this browser only and are not sent to the live site. On mt3uk.com they go through the normal comments system.</p>' : '') +
    '<div id="ic-compose"></div>' +
    '<ul class="ic-list" id="ic-list"><li class="ic-empty">Loading comments&hellip;</li></ul>';
  var composeEl = root.querySelector('#ic-compose');
  var listEl = root.querySelector('#ic-list');
  var countEl = root.querySelector('#ic-count');

  function formHtml(parentId) {
    return '<form class="ic-form" data-parent="' + esc(parentId || '') + '">' +
      (parentId ? '' : '<p class="ic-as">Commenting as ' + esc(DEMO ? 'You (preview)' : nameFromEmail(myEmail)) + '</p>') +
      '<label class="ic-sr" style="position:absolute;left:-9999px" for="ic-t-' + esc(parentId || 'root') + '">' + (parentId ? 'Reply' : 'Comment') + '</label>' +
      '<textarea id="ic-t-' + esc(parentId || 'root') + '" maxlength="500" required placeholder="' + (parentId ? 'Write a reply…' : 'What did you think? Ask the owner a question…') + '"></textarea>' +
      '<p class="ic-error" hidden></p>' +
      '<div class="ic-row"><span class="ic-left">500 characters max</span>' +
      '<span>' + (parentId ? '<button type="button" class="ic-btn ic-btn-quiet ic-cancel">Cancel</button> ' : '') +
      '<button type="submit" class="ic-btn">' + (parentId ? 'Post reply' : 'Post comment') + '</button></span></div>' +
      '</form>';
  }

  function renderCompose() {
    if (myEmail) { composeEl.innerHTML = formHtml(null); return; }
    composeEl.innerHTML =
      '<div class="ic-signin"><p><strong>Comments are for MT3UK members.</strong> Add your car to My Garage (it&rsquo;s free) and you can join the conversation.</p>' +
      '<div class="ic-links"><a class="ic-primary" href="my-builds.html#build-upload">Add your car</a>' +
      '<a class="ic-secondary" href="my-builds.html">Sign in</a></div></div>';
  }

  function tree(list) {
    var byId = {}; var roots = [];
    list.forEach(function (c) { byId[c.id] = Object.assign({}, c, { children: [] }); });
    list.forEach(function (c) { var n = byId[c.id]; if (c.parentId && byId[c.parentId]) byId[c.parentId].children.push(n); else roots.push(n); });
    return roots;
  }

  function nodeHtml(c) {
    var isReported = reported.indexOf(c.id) !== -1;
    return '<li class="ic-item" data-id="' + esc(c.id) + '">' +
      '<div class="ic-meta"><span class="ic-name">' + esc(c.name) + '</span><span class="ic-when">' + esc(when(c.createdAt)) + '</span></div>' +
      '<p class="ic-text">' + esc(c.text) + '</p>' +
      '<div class="ic-actions">' +
        '<button type="button" class="ic-act ic-like" aria-pressed="' + (c.liked ? 'true' : 'false') + '" aria-label="Like comment">' + HEART + '<span>' + (c.likes || 0) + '</span></button>' +
        (myEmail ? '<button type="button" class="ic-act ic-reply">Reply</button>' : '') +
        (c.mine ? '<button type="button" class="ic-act ic-delete">Delete</button>' : '<button type="button" class="ic-act ic-report"' + (isReported ? ' disabled' : '') + '>' + (isReported ? 'Reported' : 'Report') + '</button>') +
      '</div>' +
      '<div class="ic-reply-slot" hidden></div>' +
      (c.children.length ? '<ul class="ic-replies">' + c.children.map(nodeHtml).join('') + '</ul>' : '') +
      '</li>';
  }

  function renderList() {
    var n = comments.length;
    countEl.textContent = n ? n + (n === 1 ? ' comment' : ' comments') : '';
    listEl.innerHTML = n ? tree(comments).map(nodeHtml).join('') : '<li class="ic-empty">No comments yet. Be the first to say something.</li>';
  }

  function load() {
    return store.list().then(function (list) {
      comments = list.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
      renderList();
    }).catch(function () { listEl.innerHTML = '<li class="ic-empty">Comments couldn&rsquo;t be loaded right now.</li>'; });
  }

  root.addEventListener('submit', function (e) {
    var form = e.target.closest('.ic-form'); if (!form) return;
    e.preventDefault();
    var ta = form.querySelector('textarea'); var err = form.querySelector('.ic-error'); var btn = form.querySelector('button[type="submit"]');
    var text = ta.value.trim(); if (!text) return;
    btn.disabled = true; err.hidden = true;
    store.post(myEmail, text, form.getAttribute('data-parent') || null).then(function (res) {
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not post your comment.');
      ta.value = '';
      var slot = form.closest('.ic-reply-slot'); if (slot) { slot.hidden = true; slot.innerHTML = ''; }
      return load();
    }).catch(function (ex) { err.textContent = ex.message || 'Could not post your comment.'; err.hidden = false; })
      .then(function () { btn.disabled = false; });
  });

  root.addEventListener('click', function (e) {
    var li = e.target.closest('.ic-item'); var id = li && li.getAttribute('data-id');
    var b;
    if ((b = e.target.closest('.ic-like')) && id) {
      var liked = b.getAttribute('aria-pressed') !== 'true'; var span = b.querySelector('span');
      b.setAttribute('aria-pressed', liked ? 'true' : 'false');
      span.textContent = String(Math.max(0, parseInt(span.textContent, 10) + (liked ? 1 : -1)));
      store.like(id).then(function (r) { if (r && typeof r.likes === 'number') span.textContent = String(r.likes); }).catch(function () {});
      return;
    }
    if ((b = e.target.closest('.ic-reply')) && id) {
      var slot = li.querySelector(':scope > .ic-reply-slot');
      if (!slot.hidden) { slot.hidden = true; slot.innerHTML = ''; return; }
      slot.innerHTML = formHtml(id); slot.hidden = false; slot.querySelector('textarea').focus();
      return;
    }
    if ((b = e.target.closest('.ic-cancel'))) {
      var s = b.closest('.ic-reply-slot'); s.hidden = true; s.innerHTML = ''; return;
    }
    if ((b = e.target.closest('.ic-report')) && id && !b.disabled) {
      b.disabled = true; b.textContent = 'Reported';
      reported.push(id); try { localStorage.setItem('mt3ukReportedComments', JSON.stringify(reported)); } catch (x) {}
      store.report(id).catch(function () {});
      return;
    }
    if ((b = e.target.closest('.ic-delete')) && id) {
      if (!b.classList.contains('ic-confirm')) {
        b.classList.add('ic-confirm'); b.textContent = 'Confirm delete?';
        setTimeout(function () { b.classList.remove('ic-confirm'); b.textContent = 'Delete'; }, 4000);
        return;
      }
      b.disabled = true; b.textContent = 'Deleting…';
      store.remove(id).then(load).catch(function () { b.disabled = false; b.textContent = 'Delete'; });
    }
  });

  store.me().then(function (email) { myEmail = email; renderCompose(); return load(); });
})();
