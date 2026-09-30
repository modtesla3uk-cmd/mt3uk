/* Event page gate. Every event is an entry in data/event-pages.json, shown at
   event.html?e=<slug>. An entry is a draft or has a publish date (UK time).
   Until it is published, the page shows a "Coming soon" card instead of the
   event. Only the admin can open it early: Preview on events-admin.html makes
   a one-time link (?preview=<token>), and this browser then keeps the preview
   open (about a month, or until you press End preview). There is no public
   code or sign-up for events, and no countdown.

   Loaded in the <head> of event.html (not deferred), so the page is hidden
   before anything shows. On localhost the gate is off, so pages can be
   checked while writing them; add ?gate=on to try it locally. */
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
    '@media (max-width:780px){.evg-pill{bottom:78px}}';
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

  function drawGate(entry, message) {
    root.classList.add('ev-gated');
    var gate = document.createElement('div');
    gate.id = 'ev-gate';
    var header = document.querySelector('body > header');
    if (header && header.nextSibling) header.parentNode.insertBefore(gate, header.nextSibling);
    else document.body.insertBefore(gate, document.body.firstChild);
    gate.innerHTML =
      '<div class="evg-card">' +
        '<p class="evg-eyebrow">MT3UK event &middot; ' + (entry && entry.publish && !entry.draft ? 'Coming ' + esc(niceDate(entry.publish)) : 'Coming soon') + '</p>' +
        '<p class="evg-title" role="heading" aria-level="1">' + esc((entry && entry.title) || 'Event details coming soon') + '</p>' +
        '<p>This event page isn&rsquo;t live yet. Details and tickets will be posted here, and in the Facebook group, as soon as it is.</p>' +
        '<a class="evg-back" href="index.html#events"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg> See all events</a>' +
        '<p class="evg-msg" role="status">' + esc(message || '') + '</p>' +
      '</div>';
    show();
  }

  // Preview open: a small pill says it is not live. It stays until the admin
  // ends the preview; there is no countdown.
  function openFor(entry) {
    open();
    whenReady(function () {
      var pill = document.createElement('div');
      pill.className = 'evg-pill';
      pill.setAttribute('role', 'status');
      pill.innerHTML =
        '<span>Admin preview: ' + (entry && entry.publish && !entry.draft ? 'goes live ' + esc(niceDate(entry.publish)) : 'draft, only you can see this') + '</span>' +
        '<button type="button" class="evg-end">End preview</button>' +
        '<button type="button" class="evg-x" aria-label="Hide this note"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
      document.body.appendChild(pill);
      pill.querySelector('.evg-x').addEventListener('click', function () { pill.parentNode.removeChild(pill); });
      pill.querySelector('.evg-end').addEventListener('click', function () { save(null); location.reload(); });
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
          whenReady(function () { drawGate(entry, 'That preview link has expired or has already been used. Press Preview on the Events admin page for a new one.'); });
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
        if (data && data.success) { openFor(entry); return; }
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
