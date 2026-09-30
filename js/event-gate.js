/* Event page gate. An event page (event-<slug>.html) is listed in
   data/event-pages.json as a draft or with a publish date (UK time). Until
   it is published, the page shows a "Coming soon" card instead of the event.
   Only the admin can open it early: the Event pages section of
   events-admin.html has a Preview button that makes a one-time link (?preview=<token>),
   which opens the page in that browser for 4 hours. There is no public code
   or sign-up for events.

   Loaded in each event page's <head> (not deferred), so the page is hidden
   before anything shows. On localhost the gate is off, so pages can be
   checked while writing them; add ?gate=on to try it locally. */
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var m = location.pathname.match(/event-([a-z0-9-]+)\.html$/);
  if (!m) return;
  var slug = m[1];
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
    '#ev-gate .evg-eyebrow{font-family:"IBM Plex Mono",monospace;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:#e8542a;margin:0 0 10px}' +
    '#ev-gate .evg-title{font-family:"Archivo Expanded",Arial,sans-serif;font-size:1.5rem;font-weight:800;line-height:1.25;margin:0 0 12px;color:#fff}' +
    '#ev-gate p{color:rgba(255,255,255,.8);line-height:1.5;margin:0 0 16px;font-size:.98rem}' +
    '#ev-gate .evg-msg{min-height:1.4em;margin:12px 0 0;font-size:.9rem;color:#ffb199}' +
    '#ev-gate .evg-back{display:inline-block;margin-top:6px;color:#fff;font-size:.9rem}' +
    '.evg-notice{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:70;width:calc(100% - 32px);max-width:560px;box-sizing:border-box;background:#16233d;color:#fff;border:1px solid rgba(255,255,255,.25);border-left:4px solid #e8542a;padding:14px 44px 14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:"IBM Plex Sans",Arial,sans-serif;font-size:.95rem;line-height:1.45}' +
    '.evg-notice strong{display:block;margin-bottom:4px}' +
    '.evg-notice p{margin:6px 0 0;color:rgba(255,255,255,.85)}' +
    '.evg-notice-close{position:absolute;top:6px;right:6px;width:36px;height:36px;border:0;background:none;color:#fff;font-size:1.4rem;cursor:pointer}' +
    '.evg-timer{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:60;background:#16233d;color:#fff;border:1px solid rgba(255,255,255,.25);padding:6px 12px;font-family:"IBM Plex Mono",monospace;font-size:.75rem;letter-spacing:.06em;white-space:nowrap}' +
    '@media (max-width:780px){.evg-timer{bottom:78px}}';
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

  function clock(ms) {
    return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  }

  function timeLeft(ms) {
    var mins = Math.max(1, Math.ceil(ms / 60000));
    var h = Math.floor(mins / 60);
    return (h ? h + 'h ' : '') + (mins % 60) + 'm';
  }

  function drawGate(entry, message) {
    root.classList.add('ev-gated');
    var gate = document.createElement('div');
    gate.id = 'ev-gate';
    var header = document.querySelector('body > header');
    if (header && header.nextSibling) header.parentNode.insertBefore(gate, header.nextSibling);
    else document.body.insertBefore(gate, document.body.firstChild);
    gate.innerHTML =
      '<div class="evg-card">' +
        '<p class="evg-eyebrow">MT3UK Event &middot; ' + (entry && entry.publish && !entry.draft ? 'Coming ' + esc(niceDate(entry.publish)) : 'Coming soon') + '</p>' +
        '<p class="evg-title" role="heading" aria-level="1">' + esc((entry && entry.title) || 'Event details coming soon') + '</p>' +
        '<p>This event page isn&rsquo;t live yet. Details and tickets will be posted here, and in the Facebook group, as soon as it is.</p>' +
        '<a class="evg-back" href="index.html#events">&larr; See all events</a>' +
        '<p class="evg-msg" role="status">' + esc(message || '') + '</p>' +
      '</div>';
    show();
  }

  // Preview open: a notice says how long for, and a small timer counts down.
  function openFor(entry, expires) {
    open();
    whenReady(function () {
      var box = document.createElement('div');
      box.className = 'evg-notice';
      box.setAttribute('role', 'status');
      box.innerHTML =
        '<strong>Admin preview open until ' + esc(clock(expires)) + ' (' + esc(timeLeft(expires - Date.now())) + ')</strong>' +
        '<p>' + (entry && entry.publish && !entry.draft
          ? 'This event page goes live on ' + esc(niceDate(entry.publish)) + '.'
          : 'This event page is a draft, so only you can see it.') + '</p>' +
        '<button type="button" class="evg-notice-close" aria-label="Close">&times;</button>';
      document.body.appendChild(box);
      box.querySelector('.evg-notice-close').addEventListener('click', function () { box.parentNode.removeChild(box); });
      var timer = document.createElement('div');
      timer.className = 'evg-timer';
      timer.setAttribute('role', 'status');
      document.body.appendChild(timer);
      function tick() {
        var left = expires - Date.now();
        if (left <= 0) { save(null); location.reload(); return; }
        timer.textContent = 'Admin preview, not live: ' + timeLeft(left) + ' left';
      }
      tick();
      setInterval(tick, 15000);
    });
  }

  function gateFor(entry) {
    var current = saved();
    // The admin's one-time link: swap it for 4 hours of access in this browser.
    if (linkToken && !(current && current.token && current.expires > Date.now())) {
      fetch(API + '/events/pages/preview/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: slug, token: linkToken }) })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data.success && data.token) { save({ token: data.token, expires: data.expires }); location.reload(); return; }
          whenReady(function () { drawGate(entry, 'That preview link has expired or has already been used. Press Preview on the admin page for a new one.'); });
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
        if (data && data.success) { openFor(entry, data.expires || current.expires); return; }
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
      list.forEach(function (ev) { if (ev.url === 'event-' + slug + '.html') entry = ev; });
      // Live from the publish date. A page that isn't listed stays hidden too,
      // so a new page can't go live by accident.
      if (entry && entry.publish && !entry.draft && entry.publish <= todayUK()) { open(); return; }
      gateFor(entry);
    })
    // If the list can't be read, keep the page hidden rather than show a draft.
    .catch(function () { whenReady(function () { drawGate(null, 'Could not check this page, please try again.'); }); });
})();
