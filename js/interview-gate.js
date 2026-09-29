/* Owner Interview preview gate. Until an interview's publish date (UK time,
   from data/interviews.json), its page asks for a one-time code instead of
   showing the interview. Anyone can have a code emailed, like Sign In. A
   correct code opens the interview in this browser for 4 hours, and signs
   them in (the worker makes them an MT3UK member if they weren't already).
   A message says how long it's open for each time it opens. The admin page
   lists who has opened each interview and can revoke access.

   Loaded in each blog-<slug>.html <head> (not deferred), so the page is
   hidden before anything shows. On localhost the gate is off, so pages can
   be checked while writing them; add ?gate=on to try it locally. */
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var m = location.pathname.match(/blog-([a-z0-9-]+)\.html$/);
  if (!m) return;
  var slug = m[1];
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local && !/[?&]gate=on\b/.test(location.search)) return;

  var STORE = 'mt3ukInterviewPreview:' + slug;
  var root = document.documentElement;
  root.classList.add('iv-gate-wait');
  var style = document.createElement('style');
  style.textContent =
    'html.iv-gate-wait body{visibility:hidden}' +
    'html.iv-gated body>*:not(header):not(#iv-gate){display:none!important}' +
    '#iv-gate{min-height:calc(100svh - 70px);display:flex;align-items:center;justify-content:center;padding:48px 16px;background:#16233d;color:#fff;font-family:Inter,Arial,sans-serif}' +
    '#iv-gate .ivg-card{width:100%;max-width:440px;border:1px solid rgba(255,255,255,.2);padding:28px 24px;background:rgba(255,255,255,.04)}' +
    '#iv-gate .ivg-eyebrow{font-family:"IBM Plex Mono",monospace;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:#e8542a;margin:0 0 10px}' +
    '#iv-gate .ivg-title{font-size:1.5rem;font-weight:700;line-height:1.25;margin:0 0 12px;color:#fff}' +
    '#iv-gate p{color:rgba(255,255,255,.8);line-height:1.5;margin:0 0 16px;font-size:.98rem}' +
    '#iv-gate label{display:block;font-size:.85rem;color:rgba(255,255,255,.75);margin:0 0 6px}' +
    '#iv-gate input{width:100%;box-sizing:border-box;padding:12px 14px;font-size:16px;border:1px solid rgba(255,255,255,.35);background:#fff;color:#16233d;border-radius:0;margin:0 0 12px}' +
    '#iv-gate input.ivg-code{letter-spacing:.4em;font-family:"IBM Plex Mono",monospace;text-align:center}' +
    '#iv-gate button{width:100%;min-height:48px;border:0;background:#e8542a;color:#fff;font-family:"IBM Plex Mono",monospace;font-size:.9rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}' +
    '#iv-gate button:disabled{opacity:.6;cursor:default}' +
    '#iv-gate .ivg-link{background:none;border:0;min-height:0;width:auto;padding:0;margin-top:14px;color:rgba(255,255,255,.7);text-decoration:underline;text-transform:none;letter-spacing:0;font-family:inherit;font-size:.88rem}' +
    '#iv-gate .ivg-join{font-size:.88rem;border-left:3px solid #e8542a;padding:8px 0 8px 12px;background:rgba(232,84,42,.08)}' +
    '#iv-gate .ivg-join strong{color:#fff}' +
    '#iv-gate .ivg-join a{color:#fff}' +
    '#iv-gate .ivg-msg{min-height:1.4em;margin:12px 0 0;font-size:.9rem;color:#ffb199}' +
    '#iv-gate .ivg-msg.ok{color:#9fe0b0}' +
    '#iv-gate .ivg-back{display:inline-block;margin-top:18px;color:#fff;font-size:.9rem}' +
    '.ivg-notice{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:70;width:calc(100% - 32px);max-width:560px;box-sizing:border-box;background:#16233d;color:#fff;border:1px solid rgba(255,255,255,.25);border-left:4px solid #e8542a;padding:14px 44px 14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:Inter,Arial,sans-serif;font-size:.95rem;line-height:1.45}' +
    '.ivg-notice strong{display:block;margin-bottom:4px}' +
    '.ivg-notice p{margin:6px 0 0;color:rgba(255,255,255,.85)}' +
    '.ivg-notice-close{position:absolute;top:6px;right:6px;width:36px;height:36px;border:0;background:none;color:#fff;font-size:1.4rem;cursor:pointer}' +
    '.ivg-timer{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:60;background:#16233d;color:#fff;border:1px solid rgba(255,255,255,.25);padding:6px 12px;font-family:"IBM Plex Mono",monospace;font-size:.75rem;letter-spacing:.06em;white-space:nowrap}';
  document.head.appendChild(style);

  function show() { root.classList.remove('iv-gate-wait'); }

  function open() {
    root.classList.remove('iv-gated');
    var gate = document.getElementById('iv-gate');
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

  function clock(ms) {
    return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  }

  function timeLeft(ms) {
    var mins = Math.max(1, Math.ceil(ms / 60000));
    var h = Math.floor(mins / 60);
    return (h ? h + 'h ' : '') + (mins % 60) + 'm';
  }

  // Each time the preview opens, a message says how long it's open for.
  function notice(entry, expires, joined) {
    var box = document.createElement('div');
    box.className = 'ivg-notice';
    box.setAttribute('role', 'status');
    box.innerHTML =
      '<strong>Preview open until ' + esc(clock(expires)) + ' (' + esc(timeLeft(expires - Date.now())) + ')</strong>' +
      (joined ? '<p>Welcome to MT3UK: you&rsquo;re now subscribed and signed in, so you can like and comment. Set a nickname or unsubscribe in your <a href="profile.html" style="color:#fff">Profile</a>.</p>' : '') +
      '<p>This interview is published on ' + esc(niceDate(entry.publish)) + '. Please don&rsquo;t share it until then.</p>' +
      '<button type="button" class="ivg-notice-close" aria-label="Close">&times;</button>';
    document.body.appendChild(box);
    box.querySelector('.ivg-notice-close').addEventListener('click', function () { box.parentNode.removeChild(box); });
  }

  // While a preview is open, a small timer shows how long is left, and the
  // gate comes back when the 4 hours are up.
  function openFor(entry, expires, joined) {
    open();
    whenReady(function () {
      notice(entry, expires, joined);
      var timer = document.createElement('div');
      timer.className = 'ivg-timer';
      timer.setAttribute('role', 'status');
      document.body.appendChild(timer);
      function tick() {
        var left = expires - Date.now();
        if (left <= 0) { save(null); location.reload(); return; }
        timer.textContent = 'Preview, not yet published: ' + timeLeft(left) + ' left';
      }
      tick();
      setInterval(tick, 15000);
    });
  }

  function drawGate(entry) {
    root.classList.add('iv-gated');
    var gate = document.createElement('div');
    gate.id = 'iv-gate';
    var header = document.querySelector('body > header');
    if (header && header.nextSibling) header.parentNode.insertBefore(gate, header.nextSibling);
    else document.body.insertBefore(gate, document.body.firstChild);
    var email = '';

    function step1(msg) {
      gate.innerHTML =
        '<div class="ivg-card">' +
          '<p class="ivg-eyebrow">Owner Interview &middot; Coming ' + esc(niceDate(entry.publish)) + '</p>' +
          '<p class="ivg-title" role="heading" aria-level="1">' + esc(entry.title || 'Owner Interview') + '</p>' +
          '<p>This interview isn&rsquo;t published yet. For an early look, enter your email and we&rsquo;ll send you a one-time code. It opens the interview for 4 hours.</p>' +
          '<p class="ivg-join"><strong>Getting a code subscribes you to MT3UK</strong> (it&rsquo;s free) with this email, so you can like and comment on builds and interviews. You can stop emails or unsubscribe any time from your <a href="profile.html#unsubscribe">Profile</a>. You must be 18 or over; see our <a href="privacy.html">Privacy notice</a>.</p>' +
          '<form class="ivg-form" novalidate>' +
            '<label for="ivg-email">Email</label>' +
            '<input type="email" id="ivg-email" autocomplete="email" required value="' + esc(email) + '">' +
            '<button type="submit">Send code and subscribe</button>' +
          '</form>' +
          '<p class="ivg-msg" role="status">' + esc(msg || '') + '</p>' +
          '<a class="ivg-back" href="blog.html">&larr; See published interviews</a>' +
        '</div>';
      var form = gate.querySelector('form');
      var msgEl = gate.querySelector('.ivg-msg');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var value = gate.querySelector('#ivg-email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { msgEl.textContent = 'Please enter a valid email.'; return; }
        email = value;
        var btn = form.querySelector('button');
        btn.disabled = true;
        msgEl.className = 'ivg-msg';
        msgEl.textContent = 'Sending…';
        post('/interviews/preview/request', { email: email, slug: slug })
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
        '<div class="ivg-card">' +
          '<p class="ivg-eyebrow">Owner Interview &middot; Preview</p>' +
          '<p class="ivg-title" role="heading" aria-level="1">Enter your code</p>' +
          '<p>' + esc(note || '') + '</p>' +
          '<form class="ivg-form" novalidate>' +
            '<label for="ivg-code">6-digit code sent to ' + esc(email) + '</label>' +
            '<input type="text" id="ivg-code" class="ivg-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" required>' +
            '<button type="submit">Open interview</button>' +
          '</form>' +
          '<p class="ivg-msg" role="status"></p>' +
          '<button type="button" class="ivg-link">Use a different email or send a new code</button>' +
        '</div>';
      var form = gate.querySelector('form');
      var msgEl = gate.querySelector('.ivg-msg');
      var input = gate.querySelector('#ivg-code');
      try { input.focus({ preventScroll: true }); } catch (e) {}
      gate.querySelector('.ivg-link').addEventListener('click', function () { step1(); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var code = input.value.replace(/\D/g, '');
        if (code.length !== 6) { msgEl.textContent = 'Enter the 6-digit code from the email.'; return; }
        var btn = form.querySelector('button');
        btn.disabled = true;
        msgEl.className = 'ivg-msg';
        msgEl.textContent = 'Checking…';
        post('/interviews/preview/verify', { email: email, slug: slug, code: code })
          .then(function (data) {
            btn.disabled = false;
            if (!data.success || !data.token) { msgEl.textContent = data.message || 'That code is not right or has expired.'; return; }
            save({ token: data.token, expires: data.expires, joined: !!data.joined });
            // Signed in too, unless already signed in here. Reloading lets
            // comments and likes pick up the sign-in.
            try {
              if (data.session && !localStorage.getItem('mt3ukMyBuildsSession')) {
                localStorage.setItem('mt3ukMyBuildsSession', data.session);
                localStorage.setItem('mt3ukMyBuildsEmail', data.email || email);
              }
              // New members are asked for a nickname (js/account-bar.js).
              if (data.joined) localStorage.setItem('mt3ukAskNickname', '1');
            } catch (e) {}
            location.reload();
          })
          .catch(function () { btn.disabled = false; msgEl.textContent = 'Network error, please try again.'; });
      });
    }

    step1();
    show();
  }

  function gateFor(entry) {
    var access = saved();
    if (!access || !access.token || !(access.expires > Date.now())) {
      save(null);
      whenReady(function () { drawGate(entry); });
      return;
    }
    // Check the saved access with the worker, so it ends when it should.
    fetch(API + '/interviews/preview/check?slug=' + encodeURIComponent(slug) + '&token=' + encodeURIComponent(access.token), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.success) {
          var joined = !!access.joined;
          if (joined) save({ token: access.token, expires: access.expires });
          openFor(entry, data.expires || access.expires, joined);
          return;
        }
        save(null);
        whenReady(function () { drawGate(entry); });
      })
      .catch(function () { whenReady(function () { drawGate(entry); }); });
  }

  fetch('data/interviews.json', { cache: 'no-store' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var list = (data && data.interviews) || [];
      var entry = null;
      list.forEach(function (iv) { if (iv.url === 'blog-' + slug + '.html') entry = iv; });
      if (!entry || !entry.publish || entry.publish <= todayUK()) { open(); return; }
      gateFor(entry);
    })
    // If the schedule can't be read, show the page rather than blocking a
    // published interview.
    .catch(open);
})();
