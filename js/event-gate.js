/* Event page gate. Every event is an entry in data/event-pages.json, shown at
   event.html?e=<slug>. An entry is a draft or has a publish date (UK time).
   Until it is published, the page shows a "Coming soon" card instead of the
   event, with a way in for people the admin has shared the link with:

   - Anyone with the link can have a one-time code emailed, like Sign In and
     the Owner Interviews. A correct code opens the event in that browser for
     7 days, and signs them in (the worker makes them an MT3UK member if they
     were not one already; the card says so). The events admin page lists who
     has opened each event and can revoke access.
   - The admin uses Preview on events-admin.html, which makes a one-time link
     (?preview=<token>) that keeps the preview open until End preview.

   There is no countdown. Loaded in the <head> of event.html (not deferred), so
   the page is hidden before anything shows. On localhost the gate is off, so
   pages can be checked while writing them; add ?gate=on to try it. */
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  if (!/event\.html$/.test(location.pathname)) return;
  var slug = ((location.search.match(/[?&]e=([A-Za-z0-9-]{1,60})(?:&|$)/) || [])[1] || '').toLowerCase();
  if (!slug) return;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local && !/[?&]gate=on\b/.test(location.search)) return;

  var STORE = 'mt3ukEventPreview:' + slug;
  var linkToken = (location.search.match(/[?&]preview=([A-Za-z0-9_-]{16,128})/) || [])[1] || '';
  if (linkToken) {
    try {
      var cleaned = location.search.replace(/([?&])preview=[^&]*&?/, '$1').replace(/[?&]$/, '');
      history.replaceState(null, '', location.pathname + cleaned + location.hash);
    } catch (e) {}
  }
  var root = document.documentElement;
  root.classList.add('ev-gate-wait');
  var style = document.createElement('style');
  style.textContent =
    'html.ev-gate-wait body{visibility:hidden}' +
    'html.ev-gated body>*:not(header):not(#ev-gate){display:none!important}' +
    '#ev-gate{min-height:calc(100svh - 70px);display:flex;align-items:center;justify-content:center;padding:48px 16px;background:#16233d;color:#fff;font-family:"IBM Plex Sans",Arial,sans-serif}' +
    '#ev-gate .evg-card{width:100%;max-width:440px;border:1px solid rgba(255,255,255,.2);padding:28px 24px;background:rgba(255,255,255,.04)}' +
    '#ev-gate .evg-eyebrow{font-family:"IBM Plex Sans",Arial,sans-serif;font-size:.78rem;color:#e8542a;margin:0 0 10px}' +
    '#ev-gate .evg-title{font-family:"Archivo Expanded",Arial,sans-serif;font-size:1.5rem;font-weight:800;line-height:1.25;margin:0 0 12px;color:#fff}' +
    '#ev-gate p{color:rgba(255,255,255,.8);line-height:1.5;margin:0 0 16px;font-size:.98rem}' +
    '#ev-gate .evg-msg{min-height:1.4em;margin:12px 0 0;font-size:.9rem;color:#ffb199}' +
    '#ev-gate .evg-back{display:inline-block;margin-top:6px;color:#fff;font-size:.9rem}' +
    '.evg-pill{border-radius:10px;position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;background:#16233d;color:#fff;border:1px solid rgba(255,255,255,.25);border-left:4px solid #e8542a;padding:8px 12px;font-family:"IBM Plex Sans",Arial,sans-serif;font-size:.75rem;white-space:nowrap;max-width:calc(100% - 24px)}' +
    '.evg-pill button{background:none;border:1px solid rgba(255,255,255,.4);border-radius:8px;color:#fff;font:inherit;padding:5px 10px;cursor:pointer}' +
    '.evg-pill .evg-x{border:0;font-size:1rem;padding:0 4px}' +
    '@media (max-width:780px){.evg-pill{bottom:78px}}' +
    '#ev-gate .evg-card{border-radius:10px}' +
    '#ev-gate label{display:block;font-size:.86rem;color:rgba(255,255,255,.8);margin:0 0 6px}' +
    '#ev-gate input{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;font-size:16px;font-family:inherit;border:1px solid rgba(255,255,255,.35);background:#fff;color:#16233d;border-radius:8px;margin:0 0 12px}' +
    '#ev-gate input.evg-code{letter-spacing:.4em;text-align:center}' +
    '#ev-gate button[type=submit]{width:100%;min-height:44px;border:0;border-radius:10px;background:#e8542a;color:#fff;font-family:inherit;font-size:.95rem;font-weight:600;cursor:pointer}' +
    '#ev-gate button:disabled{opacity:.6;cursor:default}' +
    '#ev-gate .evg-link{background:none;border:0;padding:0;margin-top:14px;color:rgba(255,255,255,.75);text-decoration:underline;font-family:inherit;font-size:.9rem;cursor:pointer}' +
    '#ev-gate .evg-join{font-size:.88rem;border-left:3px solid #e8542a;padding:8px 0 8px 12px;background:rgba(232,84,42,.08)}' +
    '#ev-gate .evg-join a{color:#fff}' +
    '#ev-gate .evg-junk{font-size:.86rem;border-left:3px solid #e8542a;padding:8px 10px;background:rgba(255,255,255,.06)}' +
    '#ev-gate .evg-msg.ok{color:#9fe0b0}' +
    '.evg-notice{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:70;width:calc(100% - 32px);max-width:560px;box-sizing:border-box;background:#16233d;color:#fff;border:1px solid rgba(255,255,255,.25);border-left:4px solid #e8542a;border-radius:10px;padding:14px 44px 14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:"IBM Plex Sans",Arial,sans-serif;font-size:.95rem;line-height:1.45}' +
    '.evg-notice strong{display:block;margin-bottom:4px}' +
    '.evg-notice p{margin:6px 0 0;color:rgba(255,255,255,.85)}' +
    '.evg-notice a{color:#fff}' +
    '.evg-notice .evg-x{position:absolute;top:6px;right:6px;width:36px;height:36px}';
  document.head.appendChild(style);

  function show() { root.classList.remove('ev-gate-wait'); }

  function open() {
    root.classList.remove('ev-gated');
    var gate = document.getElementById('ev-gate');
    if (gate) gate.parentNode.removeChild(gate);
    show();
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function todayUK() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  }

  function niceDate(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function saved() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }
  function save(v) {
    try { if (v) localStorage.setItem(STORE, JSON.stringify(v)); else localStorage.removeItem(STORE); } catch (e) {}
  }

  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { data.ok = res.ok; return data; }); });
  }

  // A code or a link worked: keep the access, sign in (unless already signed
  // in here), then reload so the page opens.
  function granted(data, email) {
    save({ token: data.token, expires: data.expires, joined: !!data.joined });
    try {
      if (data.session && !localStorage.getItem('mt3ukMyBuildsSession')) {
        localStorage.setItem('mt3ukMyBuildsSession', data.session);
        localStorage.setItem('mt3ukMyBuildsEmail', data.email || email);
      }
      // New members are asked for a nickname (js/account-bar.js).
      if (data.joined) localStorage.setItem('mt3ukAskNickname', '1');
    } catch (e) {}
    // In the app, ask about notifications now (js/account-bar.js).
    if (window.mt3ukAutoPush) window.mt3ukAutoPush();
    location.reload();
  }

  var CLOSE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var BACK_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';

  function drawGate(entry, firstMessage) {
    root.classList.add('ev-gated');
    var gate = document.createElement('div');
    gate.id = 'ev-gate';
    var header = document.querySelector('body > header');
    if (header && header.nextSibling) header.parentNode.insertBefore(gate, header.nextSibling);
    else document.body.insertBefore(gate, document.body.firstChild);
    var email = '';
    var eyebrow = 'MT3UK event &middot; ' + (entry && entry.publish && !entry.draft ? 'Coming ' + esc(niceDate(entry.publish)) : 'Coming soon');
    var title = esc((entry && entry.title) || 'Event details coming soon');

    function step1(msg) {
      gate.innerHTML =
        '<div class="evg-card">' +
          '<p class="evg-eyebrow">' + eyebrow + '</p>' +
          '<p class="evg-title" role="heading" aria-level="1">' + title + '</p>' +
          '<p>This event page isn&rsquo;t live yet. Been sent the link for an early look? Enter your email and we&rsquo;ll send you a one-time code. It opens the page for 7 days.</p>' +
          '<p class="evg-join"><strong>Getting a code subscribes you to MT3UK</strong> (it&rsquo;s free) with this email, so you can like and comment on builds and interviews. You can stop emails or unsubscribe any time from your <a href="profile.html#unsubscribe">Profile</a>. You must be 18 or over; see our <a href="privacy.html">Privacy notice</a>.</p>' +
          '<form class="evg-form" novalidate>' +
            '<label for="evg-email">Email</label>' +
            '<input type="email" id="evg-email" autocomplete="email" required value="' + esc(email) + '">' +
            '<button type="submit">Send code and subscribe</button>' +
          '</form>' +
          '<p class="evg-msg" role="status">' + esc(msg || '') + '</p>' +
          '<a class="evg-back" href="index.html#events">' + BACK_ICON + ' See all events</a>' +
        '</div>';
      var form = gate.querySelector('form');
      var msgEl = gate.querySelector('.evg-msg');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var value = gate.querySelector('#evg-email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { msgEl.textContent = 'Please enter a valid email.'; return; }
        email = value;
        var btn = form.querySelector('button');
        btn.disabled = true;
        msgEl.className = 'evg-msg';
        msgEl.textContent = 'Sending\u2026';
        post('/events/pages/preview/request', { email: email, slug: slug })
          .then(function (data) {
            btn.disabled = false;
            if (!data.success) { msgEl.textContent = data.message || 'Something went wrong, please try again.'; return; }
            step2(data.message);
          })
          .catch(function () { btn.disabled = false; msgEl.textContent = 'Network error, please try again.'; });
      });
    }

    function step2(note) {
      gate.innerHTML =
        '<div class="evg-card">' +
          '<p class="evg-eyebrow">MT3UK event &middot; Preview</p>' +
          '<p class="evg-title" role="heading" aria-level="1">Enter your code</p>' +
          '<p>' + esc(note || '') + '</p>' +
          '<form class="evg-form" novalidate>' +
            '<label for="evg-code">6-digit code sent to ' + esc(email) + '</label>' +
            '<input type="text" id="evg-code" class="evg-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" required>' +
            '<button type="submit">Open event page</button>' +
          '</form>' +
          '<p class="evg-msg" role="status"></p>' +
          '<p class="evg-junk">Can\u2019t see the email? Check your <strong>Junk</strong> or <strong>Spam</strong> folder, and mark it <strong>Not junk</strong> so the next one reaches your inbox.</p>' +
          '<button type="button" class="evg-link">Use a different email or send a new code</button>' +
        '</div>';
      var form = gate.querySelector('form');
      var msgEl = gate.querySelector('.evg-msg');
      var input = gate.querySelector('#evg-code');
      try { input.focus({ preventScroll: true }); } catch (e) {}
      gate.querySelector('.evg-link').addEventListener('click', function () { step1(); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var code = input.value.replace(/\D/g, '');
        if (code.length !== 6) { msgEl.textContent = 'Enter the 6-digit code from the email.'; return; }
        var btn = form.querySelector('button');
        btn.disabled = true;
        msgEl.className = 'evg-msg';
        msgEl.textContent = 'Checking\u2026';
        post('/events/pages/preview/verify', { email: email, slug: slug, code: code })
          .then(function (data) {
            btn.disabled = false;
            if (!data.success || !data.token) { msgEl.textContent = data.message || 'That code is not right or has expired.'; return; }
            granted(data, email);
          })
          .catch(function () { btn.disabled = false; msgEl.textContent = 'Network error, please try again.'; });
      });
    }

    step1(firstMessage);
    show();
  }

  // Preview open: a small pill says it is not live, and stays until the
  // preview is ended. Someone who has just joined is welcomed once.
  function openFor(entry, isAdmin, joined) {
    open();
    whenReady(function () {
      var pill = document.createElement('div');
      pill.className = 'evg-pill';
      pill.setAttribute('role', 'status');
      var when = entry && entry.publish && !entry.draft ? 'goes live ' + esc(niceDate(entry.publish)) : 'not published yet';
      pill.innerHTML =
        '<span>' + (isAdmin ? 'Admin preview: ' + when + (entry && entry.draft ? ', only you can see this' : '') : 'Preview, ' + when + '. Please don&rsquo;t share it.') + '</span>' +
        '<button type="button" class="evg-end">End preview</button>' +
        '<button type="button" class="evg-x" aria-label="Hide this note">' + CLOSE_ICON + '</button>';
      document.body.appendChild(pill);
      pill.querySelector('.evg-x').addEventListener('click', function () { pill.parentNode.removeChild(pill); });
      pill.querySelector('.evg-end').addEventListener('click', function () { save(null); location.reload(); });
      if (joined) {
        var box = document.createElement('div');
        box.className = 'evg-notice';
        box.setAttribute('role', 'status');
        box.innerHTML = '<strong>Welcome to MT3UK</strong><p>You&rsquo;re now subscribed and signed in, so you can like and comment. Set a nickname or unsubscribe in your <a href="profile.html">Profile</a>.</p><p>Please don&rsquo;t share this event page until it is published.</p>' +
          '<button type="button" class="evg-x" aria-label="Close">' + CLOSE_ICON + '</button>';
        document.body.appendChild(box);
        box.querySelector('.evg-x').addEventListener('click', function () { box.parentNode.removeChild(box); });
        var current = saved();
        if (current) save({ token: current.token, expires: current.expires });
      }
    });
  }

  function gateFor(entry) {
    var current = saved();
    // A one-time link (the admin's Preview, or the one in the code email): swap it for access in this browser.
    if (linkToken && !(current && current.token && current.expires > Date.now())) {
      fetch(API + '/events/pages/preview/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: slug, token: linkToken }) })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data.success && data.token) { granted(data, ''); return; }
          whenReady(function () { drawGate(entry, data.message || 'That link has expired or has already been used. Enter your email for a new code.'); });
        })
        .catch(function () { whenReady(function () { drawGate(entry, 'Network error, please try again.'); }); });
      return;
    }
    if (!current || !current.token || !(current.expires > Date.now())) {
      save(null);
      whenReady(function () { drawGate(entry); });
      return;
    }
    // Check the saved access with the worker, so it ends when it should.
    fetch(API + '/events/pages/preview/check?slug=' + encodeURIComponent(slug) + '&token=' + encodeURIComponent(current.token), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.success) { openFor(entry, !!data.admin, !!current.joined); return; }
        save(null);
        whenReady(function () { drawGate(entry); });
      })
      .catch(function () { whenReady(function () { drawGate(entry); }); });
  }

  fetch('data/event-pages.json', { cache: 'no-store' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var list = (data && data.events) || [];
      var entry = null;
      list.forEach(function (ev) { if (ev.slug === slug) entry = ev; });
      // Live from the publish date. A page that isn't listed stays hidden too,
      // so a new page can't go live by accident.
      if (entry && entry.publish && !entry.draft && entry.publish <= todayUK()) { open(); return; }
      gateFor(entry);
    })
    // If the list can't be read, keep the page hidden rather than show a draft.
    .catch(function () { whenReady(function () { drawGate(null, 'Could not check this page, please try again.'); }); });
})();
