/*
  Account links shared by every public page.

  - The orange "Sign Up / Sign In" menu button is for visitors only, so it's
    hidden for signed-in members (My Garage is already in the menu).
  - Signed-in members get a slim "Signed in as <first name> · ri•••@example.com"
    bar under the header, with My Garage and Sign out. The homepage shows this
    in its hero box instead, and My Garage and Sign Up / Sign In have their
    own, so none of them get the bar.
  - window.mt3ukSignOut() signs out on this device and reloads the page.

  Uses only what's saved on the device (no worker call): the session, the
  email, and the first name My Garage and the homepage remember after loading
  the member's builds.
*/
(function () {
  var SESSION_KEY = 'mt3ukMyBuildsSession';
  var EMAIL_KEY = 'mt3ukMyBuildsEmail';
  var FIRST_NAME_KEY = 'mt3ukMyBuildsFirstName';

  function read(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function maskEmail(email) {
    var at = email.indexOf('@');
    if (at < 1) return '';
    return email.slice(0, Math.min(2, at)) + '•••' + email.slice(at);
  }

  window.mt3ukMaskEmail = maskEmail;

  window.mt3ukSignOut = function () {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(FIRST_NAME_KEY);
    } catch (e) {}
    window.location.reload();
  };

  var signedIn = !!read(SESSION_KEY);
  var ASK_NICKNAME_KEY = 'mt3ukAskNickname';
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';

  // Checks a nickname box as the member types and says under it whether the
  // nickname is free. Saving still checks on the server.
  window.mt3ukWatchNickname = function (input, msg) {
    var timer = null, seq = 0;
    function show(text, ok) {
      msg.textContent = text;
      msg.style.color = ok === true ? '#1c8a4b' : ok === false ? '#c0392b' : '';
      msg.setAttribute('data-available', ok === true ? 'yes' : ok === false ? 'no' : '');
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var nick = input.value.trim();
      var mine = ++seq;
      if (!nick) { show('', null); return; }
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/.test(nick)) {
        show('3 to 20 letters or numbers (you can use _ . -), starting with a letter or number.', false);
        return;
      }
      timer = setTimeout(function () {
        fetch(API + '/profile/nickname?nick=' + encodeURIComponent(nick), { headers: { 'X-Session-Token': read(SESSION_KEY) }, cache: 'no-store' })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (mine !== seq || !data || !data.success) return;
            show(data.message || '', !!data.available);
          })
          .catch(function () {});
      }, 400);
    });
  };

  // New members (set by Sign Up and the interview preview gate) are asked
  // once to choose a nickname. "Later" leaves it for their Profile.
  function askNickname() {
    var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (!read(SESSION_KEY) || read(ASK_NICKNAME_KEY) !== '1' || page === 'profile.html' || document.getElementById('mt3uk-nick-prompt')) return;
    function done() {
      try { localStorage.removeItem(ASK_NICKNAME_KEY); } catch (e) {}
      box.remove();
    }
    var style = document.createElement('style');
    style.textContent =
      '#mt3uk-nick-prompt{position:fixed;inset:0;z-index:400;background:rgba(14,22,40,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"IBM Plex Sans",sans-serif}' +
      '#mt3uk-nick-prompt form{background:#f3f1ea;color:#1c1c1c;border-top:4px solid #e8542a;max-width:420px;width:100%;padding:24px 22px;box-shadow:0 20px 50px rgba(0,0,0,.35)}' +
      '#mt3uk-nick-prompt h2{font-family:"Archivo Expanded",sans-serif;font-size:1.15rem;color:#16233d;margin:0 0 8px}' +
      '#mt3uk-nick-prompt p{margin:0 0 14px;color:#4a5568;font-size:.92rem;line-height:1.45}' +
      '#mt3uk-nick-prompt label{display:block;font-family:"IBM Plex Sans",sans-serif;font-size:.86rem;font-weight:600;color:#16233d;margin-bottom:6px}' +
      '#mt3uk-nick-prompt input{width:100%;box-sizing:border-box;border:1px solid #16233d;background:#fff;padding:11px 12px;font:inherit;font-size:16px;margin-bottom:12px}' +
      '#mt3uk-nick-prompt .mt3uk-nick-row{display:flex;gap:10px;flex-wrap:wrap}' +
      '#mt3uk-nick-prompt button{min-height:44px;padding:10px 16px;border:1px solid #16233d;background:transparent;color:#16233d;font:inherit;font-weight:600;cursor:pointer;border-radius:4px}' +
      '#mt3uk-nick-prompt button[type=submit]{background:#e8542a;border-color:#e8542a;color:#fff;flex:1}' +
      '#mt3uk-nick-prompt .mt3uk-nick-msg{min-height:1.2em;margin:10px 0 0;color:#e8542a;font-weight:600;font-size:.88rem}';
    document.head.appendChild(style);
    var box = document.createElement('div');
    box.id = 'mt3uk-nick-prompt';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'mt3uk-nick-title');
    box.innerHTML =
      '<form novalidate>' +
        '<h2 id="mt3uk-nick-title">Welcome! Pick a nickname</h2>' +
        '<p>Your nickname shows on your builds, comments and likes instead of your full name, and friends find you by it. You can change it any time in your Profile.</p>' +
        '<label for="mt3uk-nick-input">Nickname</label>' +
        '<input type="text" id="mt3uk-nick-input" name="mt3uk-handle" maxlength="20" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="e.g. GreenKnight">' +
        '<div class="mt3uk-nick-row"><button type="submit">Save nickname</button><button type="button" class="mt3uk-nick-later">Later</button></div>' +
        '<p class="mt3uk-nick-msg" role="status"></p>' +
      '</form>';
    document.body.appendChild(box);
    var form = box.querySelector('form');
    var input = box.querySelector('input');
    var msg = box.querySelector('.mt3uk-nick-msg');
    window.mt3ukWatchNickname(input, msg);
    try { input.focus({ preventScroll: true }); } catch (e) {}
    box.querySelector('.mt3uk-nick-later').addEventListener('click', done);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.style.color = '';
      var nick = input.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/.test(nick)) {
        msg.textContent = '3 to 20 letters or numbers (you can use _ . -), starting with a letter or number.';
        return;
      }
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      msg.textContent = '';
      fetch(API + '/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': read(SESSION_KEY) },
        body: JSON.stringify({ nickname: nick })
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (r) {
          btn.disabled = false;
          if (r.status === 401) { done(); return; }
          if (!r.data.success) { msg.textContent = r.data.message || 'Could not save, please try again.'; return; }
          done();
        })
        .catch(function () { btn.disabled = false; msg.textContent = 'Network error, please try again.'; });
    });
  }

  // Sign Up calls this once a new member is signed in on the same page.
  window.mt3ukAskNickname = askNickname;

  // In the installed app, ask about notifications when it's opened, signed
  // in or not, like a normal app; they switch on once signed in
  // (js/push-toggle.js). Waits for the homepage intro and the nickname
  // prompt. Profile has its own on/off control, so not there.
  function autoPush() {
    var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var app = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (!app || page === 'profile.html' || !('PushManager' in window)) return;
    if (document.getElementById('mt3uk-intro') || document.getElementById('mt3uk-nick-prompt')) { setTimeout(autoPush, 1000); return; }
    var go = function () { window.mt3ukPushAuto({ api: API, session: function () { return read(SESSION_KEY); } }); };
    if (window.mt3ukPushAuto) { go(); return; }
    var s = document.createElement('script');
    s.src = '/js/push-toggle.js';
    s.onload = go;
    document.head.appendChild(s);
  }

  // The installed app tells the worker (once a day) that this member has it
  // on this kind of device, so the website in Safari or Chrome stops
  // offering to install it (Safari can't see apps on the phone, or when
  // one is deleted, so it only counts the app if it's been used lately).
  function reportApp() {
    var app = (window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches) || navigator.standalone === true;
    var today = new Date().toISOString().slice(0, 10);
    if (!app || !read(SESSION_KEY) || read('mt3ukAppReported') === today) return;
    var ua = navigator.userAgent;
    var platform = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : /Android/i.test(ua) ? 'android' : 'desktop';
    fetch(API + '/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': read(SESSION_KEY) },
      body: JSON.stringify({ appInstalled: platform })
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (data && data.success) { try { localStorage.setItem('mt3ukAppReported', today); } catch (e) {} }
    }).catch(function () {});
  }
  window.mt3ukAppPlatform = function () {
    var ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : /Android/i.test(ua) ? 'android' : 'desktop';
  };

  // Sign-in pages call this straight after signing in, so the app asks
  // about notifications then rather than on the next page.
  window.mt3ukAutoPush = function () { setTimeout(autoPush, 800); };

  // Sign-ins last 30 days from last use: once a day, swap this one for a
  // renewed one. If it has run out, or "Sign out of all devices" was used,
  // forget it here too.
  function refreshSession() {
    var today = new Date().toISOString().slice(0, 10);
    if (!read(SESSION_KEY) || read('mt3ukSessionChecked') === today) return;
    fetch(API + '/session/refresh', { headers: { 'X-Session-Token': read(SESSION_KEY) }, cache: 'no-store' })
      .then(function (res) {
        if (res.status === 401) {
          try { [SESSION_KEY, EMAIL_KEY, FIRST_NAME_KEY].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.success) return;
        try {
          localStorage.setItem('mt3ukSessionChecked', today);
          if (data.session) localStorage.setItem(SESSION_KEY, data.session);
        } catch (e) {}
      })
      .catch(function () {});
  }

  // ---------- Sign-in handover between mt3uk.com and laps.mt3uk.com ----------
  // A sign-in is kept per address, so following a link from one to the other would land signed out. When a signed-in
  // member follows such a link, the worker gives a one-time code (2 minutes, works once), which goes in the link's #
  // as #mt3uk-handover=<code>, then :<the link's own #> if it had one. The page there swaps it for its own sign-in.
  // On laps.mt3uk.com only the Laps pages (and Sign in) stay there: a link to any other page of the site (Profile,
  // My Garage, the Gallery) goes to mt3uk.com, signed in. Tests set window.MT3UK_SITES to two local addresses.
  var SITES = window.MT3UK_SITES || { main: ['mt3uk.com', 'www.mt3uk.com'], mainOrigin: 'https://mt3uk.com', laps: ['laps.mt3uk.com'] };
  var LAPS_PAGES = ['/', '/laps.html', '/track.html', '/leaderboards.html', '/signin.html', '/laps-signin.html'];
  function siteOf(host) { return SITES.main.indexOf(host) !== -1 ? 'main' : SITES.laps.indexOf(host) !== -1 ? 'laps' : ''; }
  var hereSite = siteOf(location.hostname);

  // Sign in on laps.mt3uk.com is the Laps one (laps-signin.html): its emailed link comes back here, signed in on this
  // address, with Laps words. Every Sign in link on a page here (the menu, the bell, the prompts, the Laps pages'
  // buttons) is sent there when it is followed; window.mt3ukSignInUrl(next) gives the address for a script. With the
  // admin's separate Laps sign-in switched off, laps-signin.html passes visitors on to signin.html.
  window.mt3ukSignInUrl = function (next) {
    return (hereSite === 'laps' ? 'laps-signin.html' : 'signin.html') + (next ? '?next=' + encodeURIComponent(next) : '');
  };
  document.addEventListener('click', function (e) {
    if (hereSite !== 'laps') return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (u.origin === location.origin && u.pathname === '/signin.html') a.setAttribute('href', '/laps-signin.html' + u.search + u.hash);
  }, true);

  // Links to the Laps pages from mt3uk.com (the menu's Track Sessions and Leaderboards, My Garage's buttons and
  // links, the homepage tile, site search) carry data-laps, and go to laps.mt3uk.com on the live site. On
  // localhost and on laps.mt3uk.com itself they are left as they are. Old bookmarks of mt3uk.com/track.html keep
  // working: there is no redirect. window.mt3ukLapsUrl does the same for an address built in a script.
  window.mt3ukLapsUrl = function (href) {
    if (hereSite !== 'main') return href;
    try { var u = new URL(href, location.href); return u.origin === location.origin ? 'https://' + SITES.laps[0] + u.pathname + u.search + u.hash : href; } catch (e) { return href; }
  };
  function lapsLinks(root) {
    if (hereSite !== 'main') return;
    (root || document).querySelectorAll('a[data-laps]').forEach(function (a) { a.href = window.mt3ukLapsUrl(a.getAttribute('href')); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { lapsLinks(); }); else lapsLinks();
  window.mt3ukLapsLinks = lapsLinks;

  // Where a link really goes: on Laps, a page that is not a Laps page is on mt3uk.com.
  function handoverTarget(href) {
    var u;
    try { u = new URL(href, location.href); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol) || !hereSite) return null;
    if (hereSite === 'laps' && u.origin === location.origin && LAPS_PAGES.indexOf(u.pathname) === -1) {
      var to = new URL(u.pathname + u.search + u.hash, SITES.mainOrigin);
      return to;
    }
    var there = siteOf(u.hostname);
    return there && there !== hereSite ? u : null;
  }

  function withCode(u, code) {
    var own = u.hash ? u.hash.slice(1) : '';
    u.hash = 'mt3uk-handover=' + code + (own ? ':' + own : '');
    return u.href;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== '_self') return;
    var to = handoverTarget(a.getAttribute('href'));
    if (!to) return;
    e.preventDefault();
    var token = read(SESSION_KEY);
    if (!token) { location.href = to.href; return; }
    var gone = false;
    function go(url) { if (gone) return; gone = true; location.href = url; }
    // Never hold the member up: without an answer in 3 seconds the link opens as it is (signed out there).
    var timer = setTimeout(function () { go(to.href); }, 3000);
    fetch(API + '/session/handover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
      body: JSON.stringify({ firstName: read(FIRST_NAME_KEY) })
    }).then(function (res) { return res.json(); }).then(function (d) {
      clearTimeout(timer);
      go(d && d.success && d.code ? withCode(to, d.code) : to.href);
    }).catch(function () { clearTimeout(timer); go(to.href); });
  });

  // Arriving with a code: take it out of the address at once, then swap it for a sign-in here. Reloads when that
  // signs the member in (or as someone else), so every part of the page sees it.
  (function redeemHandover() {
    var m = /^#mt3uk-handover=([a-f0-9]{64})(?::(.*))?$/.exec(location.hash);
    if (!m) return;
    var own = m[2] || '';
    try { history.replaceState(history.state, '', location.pathname + location.search + (own ? '#' + own : '')); } catch (e) {}
    var tries = 0;
    function attempt() {
      tries++;
      fetch(API + '/session/handover/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: m[1] }) })
        .then(function (res) { return res.json().then(function (d) { return { status: res.status, d: d }; }); })
        .then(function (r) {
          // A code made a moment ago can take a second to reach every Cloudflare server: try twice more.
          if (r.status === 404 && tries < 3) { setTimeout(attempt, 800); return; }
          if (!r.d || !r.d.success || !r.d.session) return;
          var before = read(SESSION_KEY), beforeEmail = read(EMAIL_KEY);
          try {
            localStorage.setItem(SESSION_KEY, r.d.session);
            localStorage.setItem(EMAIL_KEY, r.d.email || '');
            if (r.d.firstName) localStorage.setItem(FIRST_NAME_KEY, r.d.firstName);
            else if (beforeEmail !== r.d.email) localStorage.removeItem(FIRST_NAME_KEY);
          } catch (e) { return; }
          if (!before || beforeEmail !== r.d.email) {
            // After a reload the browser gives this page as its own referrer, so Back remembers the real one.
            try { sessionStorage.setItem('mt3ukBackFrom', JSON.stringify({ page: location.pathname, from: document.referrer })); } catch (e) {}
            location.reload();
          }
        })
        .catch(function () {});
    }
    attempt();
  })();

  // Back is one button on every page: it goes back to the page you came from when that was another page of this site
  // (on either address: mt3uk.com or laps.mt3uk.com, which only send their origin as the referrer across the two), and
  // to the page it links to (its parent) when you came from a shared link, a bookmark or the sign-in page. It runs in
  // the capture phase so it is first: on laps.mt3uk.com the parent link (the MT3UK homepage, My Garage) is on the other
  // address, and the handover handler above would otherwise take the click and go there every time.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.back-link:not([data-go])');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var ref = document.referrer, from = null;
    try {
      var kept = JSON.parse(sessionStorage.getItem('mt3ukBackFrom') || 'null');
      if (kept && kept.page === location.pathname && ref && new URL(ref).href === location.href) ref = kept.from;
    } catch (err) { /* nothing kept */ }
    try { from = ref ? new URL(ref) : null; } catch (err) { /* no usable referrer */ }
    if (!from || window.history.length < 2) return;
    var ours = from.origin === location.origin || (!!hereSite && !!siteOf(from.hostname));
    var samePage = from.origin === location.origin && from.pathname === location.pathname;
    if (ours && !samePage && from.pathname !== '/signin.html' && from.pathname !== '/laps-signin.html') {
      e.preventDefault();
      window.history.back();
    }
  }, true);

  function run() {
    refreshSession();
    askNickname();
    reportApp();
    setTimeout(autoPush, 1500);
    if (signedIn) {
      // The button's own CSS uses !important, so it's removed rather than hidden.
      document.querySelectorAll('.nav-link-mobile').forEach(function (link) { link.remove(); });
    }

    var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (!signedIn || page === '' || page === 'index.html' || page === 'signin.html' || page === 'laps-signin.html') return;
    var header = document.querySelector('header');
    if (!header || document.getElementById('mt3uk-account-bar')) return;

    var style = document.createElement('style');
    style.textContent =
      '.mt3uk-account-bar{background:#16233d;color:#d3d8e2;font-family:"IBM Plex Sans",sans-serif;font-size:.84rem;line-height:1.4}' +
      '.mt3uk-account-bar-inner{max-width:var(--content-max,1000px);margin:0 auto;padding:7px 16px;display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap}' +
      '.mt3uk-account-bar p{margin:0;flex:1;min-width:0}' +
      '.mt3uk-account-bar strong{color:#fff;font-weight:600}' +
      '.mt3uk-account-bar .mt3uk-account-email{color:#b9c0cf;white-space:nowrap}' +
      '.mt3uk-account-bar a,.mt3uk-account-bar button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 16px;box-sizing:border-box;color:#fff;background:transparent;border:1px solid rgba(255,255,255,.45);border-radius:var(--radius,10px);font:inherit;font-weight:600;line-height:1.2;cursor:pointer;text-decoration:none;transition:background-color .15s ease,border-color .15s ease}' +
      '.mt3uk-account-bar a:hover,.mt3uk-account-bar button:hover{background:rgba(255,255,255,.12);border-color:#fff}' +
      '.mt3uk-account-bar a[aria-current="page"]{background:rgba(255,255,255,.18);border-color:#fff}' +
      '.mt3uk-account-bar .mt3uk-account-actions{display:flex;gap:10px;flex-wrap:wrap}' +
      '@media(max-width:560px){.mt3uk-account-bar p{flex:1 0 100%}.mt3uk-account-bar .mt3uk-account-actions{flex:1 0 100%;gap:8px}.mt3uk-account-bar .mt3uk-account-actions>*{flex:1 1 0;padding-left:8px;padding-right:8px}}';
    document.head.appendChild(style);

    var first = read(FIRST_NAME_KEY);
    var masked = maskEmail(read(EMAIL_KEY));
    var bar = document.createElement('div');
    bar.className = 'mt3uk-account-bar';
    bar.id = 'mt3uk-account-bar';
    bar.innerHTML =
      '<div class="mt3uk-account-bar-inner">' +
        '<p>Signed in as ' + (first
          ? '<strong>' + esc(first) + '</strong>' + (masked ? ' <span class="mt3uk-account-email">&middot; ' + esc(masked) + '</span>' : '')
          : '<strong>' + esc(masked || 'a member') + '</strong>') + '</p>' +
        '<span class="mt3uk-account-actions"><a href="profile.html"' + (page === 'profile.html' ? ' aria-current="page"' : '') + '>Profile</a><a href="my-builds.html"' + (page === 'my-builds.html' ? ' aria-current="page"' : '') + '>My Garage</a>' +
        '<button type="button" class="mt3uk-account-signout">Sign out</button></span>' +
      '</div>';
    bar.querySelector('.mt3uk-account-signout').addEventListener('click', window.mt3ukSignOut);
    header.parentNode.insertBefore(bar, header.nextSibling);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
