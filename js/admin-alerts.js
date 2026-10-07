/*
  admin.html and track-admin.html: the Notifications switches at the top of the page. Bell shows or hides the
  notification bell; Email turns the emails to MT3UK about admin actions on or off (the worker checks it before
  sending each one); New sessions (track-admin.html only) turns the note about each session a member saves on or
  off (the list, the bell item and the email). It also keeps the bell up to date within seconds (see load()). Both are kept in one KV key through the worker's /admin/alerts route, so they are the same on
  every device, and both start on.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var row = document.getElementById('admin-alerts');
  if (!row) return;
  var bellSw = document.getElementById('alerts-bell'), emailSw = document.getElementById('alerts-email'), noteEl = document.getElementById('alerts-note');
  // track-admin.html only: whether a member's newly saved session is listed, counted on the bell and emailed.
  var sessionsSw = document.getElementById('alerts-sessions');
  var LOCAL = 'mt3ukAdminAlerts';

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function show(a) {
    bellSw.setAttribute('aria-checked', String(a.bell !== false));
    emailSw.setAttribute('aria-checked', String(a.email !== false));
    if (sessionsSw) sessionsSw.setAttribute('aria-checked', String(a.sessions !== false));
    document.documentElement.classList.toggle('bell-off', a.bell === false);
    try { localStorage.setItem(LOCAL, JSON.stringify(a)); } catch (e) {}
  }
  function note(t) { noteEl.textContent = t || ''; }
  // What this browser saw last, so a hidden bell does not flash up before the worker answers.
  try { var last = JSON.parse(localStorage.getItem(LOCAL) || 'null'); if (last) show(last); } catch (e) {}

  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API + '/admin/alerts?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  // The worker's stamp changes whenever something new waits for the admin (a request, a report, a claim). It is
  // checked every 15 seconds while the page is in view, and at once when the page comes back into view; a change
  // tells the page to reload what the bell counts ('mt3uk-admin-changed').
  var stamp = null;
  function load() {
    if (!key()) return;
    call('GET').then(function (d) {
      if (!(d.ok && d.success && d.alerts)) return;
      show(d.alerts);
      pushDevices = d.pushDevices || [];
      showPush();
      if (stamp !== null && d.stamp !== stamp) document.dispatchEvent(new CustomEvent('mt3uk-admin-changed'));
      stamp = d.stamp || '';
    }).catch(function () {});
  }
  setInterval(function () { if (!document.hidden) load(); }, 15 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  function flip(sw, field) {
    sw.addEventListener('click', function () {
      if (!key()) { note('Enter the admin key first.'); return; }
      var on = sw.getAttribute('aria-checked') !== 'true', body = {};
      body[field] = on;
      sw.disabled = true;
      call('POST', body).then(function (d) {
        sw.disabled = false;
        if (!d.ok || !d.success) { note(d.message || 'Could not save that. Check the admin key.'); return; }
        show(d.alerts || {});
        note(field === 'bell' ? (on ? 'Bell on.' : 'Bell hidden.')
          : field === 'sessions' ? (on ? 'New sessions on: each session a member saves is listed on the New sessions panel, counted on the bell and emailed.' : 'New sessions off: nothing is listed, counted or emailed about new sessions until you switch it back on.')
          : (on ? 'Emails on.' : 'Emails off: nothing is emailed to MT3UK about admin actions until you switch them back on.'));
      }).catch(function () { sw.disabled = false; note('Could not reach the server.'); });
    });
  }
  // ---------- Push on this device ----------
  // The members' service worker (/sw.js) shows the notification; this device's push subscription is added to or
  // taken off the admin's list on the worker. The browser's subscription itself is kept, because the same one
  // carries this browser's member notifications. On an iPhone push only works in the installed app.
  var pushSw = document.getElementById('alerts-push');
  var canPush = !!(pushSw && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  var swReady = canPush ? navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).catch(function () { return null; }) : Promise.resolve(null);
  var pushDevices = null;
  function showPush() {
    if (!canPush) return;
    swReady.then(function (reg) {
      if (!reg) return;
      pushSw.hidden = false;
      return reg.pushManager.getSubscription().then(function (sub) {
        pushSw.setAttribute('aria-checked', String(!!(sub && pushDevices && pushDevices.indexOf(sub.endpoint) !== -1)));
      });
    }).catch(function () {});
  }
  function keyBytes(b64) {
    var s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  if (pushSw) pushSw.addEventListener('click', function () {
    if (!key()) { note('Enter the admin key first.'); return; }
    var on = pushSw.getAttribute('aria-checked') !== 'true';
    pushSw.disabled = true;
    var done = function (msg) { pushSw.disabled = false; if (msg) note(msg); };
    swReady.then(function (reg) {
      if (!reg) throw new Error('Push notifications are not available in this browser.');
      if (!on) {
        return reg.pushManager.getSubscription().then(function (sub) {
          return call('POST', { unsubscribe: sub ? sub.endpoint : '' });
        }).then(function (d) {
          if (!d.ok || !d.success) throw new Error(d.message || 'Could not save that.');
          pushDevices = d.pushDevices || [];
          pushSw.setAttribute('aria-checked', 'false');
          done('Push is off on this device.');
        });
      }
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser or phone settings, then try again.');
        return reg.pushManager.getSubscription();
      }).then(function (sub) {
        if (sub) return sub;
        return fetch(API + '/push/key', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (k) {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.publicKey) });
        });
      }).then(function (sub) {
        return call('POST', { subscribe: sub.toJSON(), test: true });
      }).then(function (d) {
        if (!d.ok || !d.success) throw new Error(d.message || 'Could not save that.');
        pushDevices = d.pushDevices || [];
        pushSw.setAttribute('aria-checked', 'true');
        done('Push is on for this device. A test notification is on its way.');
      });
    }).catch(function (err) { done(err.message || 'Could not switch push on.'); });
  });
  // A push arriving while the page is open brings the bell up to date at once.
  if (canPush) navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'mt3uk-push') load();
  });

  // ---------- Remember the key on this device ----------
  // Kept in this device's storage (js/admin-key-keep.js puts it back each time the page opens), so the installed
  // app does not ask for it every time. Off unless switched on; switching it off forgets it.
  var KEEP = 'mt3ukAdminKeyKept';
  var keepSw = document.getElementById('alerts-keep');
  function kept() { try { return localStorage.getItem(KEEP) || ''; } catch (e) { return ''; } }
  if (keepSw) {
    keepSw.setAttribute('aria-checked', String(!!kept()));
    keepSw.addEventListener('click', function () {
      var on = keepSw.getAttribute('aria-checked') !== 'true';
      if (on && !key()) { note('Enter the admin key first.'); return; }
      try { if (on) localStorage.setItem(KEEP, key()); else localStorage.removeItem(KEEP); } catch (e) { note('This browser will not keep it.'); return; }
      keepSw.setAttribute('aria-checked', String(on));
      note(on ? 'The key is remembered on this device. Anyone using it unlocked can open the admin pages.' : 'The key is no longer remembered here.');
    });
    // A new key entered later replaces the remembered one.
    document.addEventListener('mt3uk-admin-refresh', function () { if (kept() && key() && key() !== kept()) { try { localStorage.setItem(KEEP, key()); } catch (e) {} } });
  }

  // ---------- The admin pages' own address: admin.mt3uk.com ----------
  // On Android an installed MT3UK app claims every mt3uk.com page, so Chrome will not install the admin pages from
  // there. They are installed from admin.mt3uk.com (the same files, on its own address), and there a link to any
  // other page of the site goes back to mt3uk.com, except that a link to a Laps page (a member's session, the
  // Leaderboard) goes to laps.mt3uk.com, from the admin pages on mt3uk.com too, so the pages after it are Laps pages.
  // Tests set window.MT3UK_ADMIN_SITE to local addresses.
  var ADMIN = window.MT3UK_ADMIN_SITE || { origin: 'https://admin.mt3uk.com', main: ['mt3uk.com', 'www.mt3uk.com'], mainOrigin: 'https://mt3uk.com' };
  var LAPS_ORIGIN = ADMIN.laps || 'https://laps.mt3uk.com';
  var onAdminSite = location.origin === ADMIN.origin;
  var onMainSite = ADMIN.main.indexOf(location.hostname) !== -1;
  var APP_PAGES = ['/admin.html', '/track-admin.html'];
  var LAPS_PAGES = ['/track.html', '/leaderboards.html', '/laps.html', '/laps-signin.html'];
  // A link that leaves this address carries the admin viewer token (and the member's sign-in, if any) as a one-time
  // code in its # (the worker's /session/handover, as js/account-bar.js does for a sign-in), so a private session
  // opens there without entering the key again. Without an answer in 3 seconds the link opens as it is.
  var SESSION_KEY = 'mt3ukMyBuildsSession', ADMIN_VIEWER_KEY = 'mt3ukAdminViewer';
  function stored(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function adminViewer() {
    try { var v = JSON.parse(stored(ADMIN_VIEWER_KEY) || 'null'); return v && v.token && v.expires > Date.now() ? v : null; } catch (e) { return null; }
  }
  function withHandover(to, cb) {
    var token = stored(SESSION_KEY), av = adminViewer();
    if (!token && !av) return cb(to);
    var gone = false;
    function go(url) { if (gone) return; gone = true; cb(url); }
    var timer = setTimeout(function () { go(to); }, 3000);
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Session-Token'] = token;
    if (av) headers['X-Admin-Viewer'] = av.token;
    fetch(API + '/session/handover', { method: 'POST', headers: headers, body: JSON.stringify({ firstName: stored('mt3ukMyBuildsFirstName') }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        clearTimeout(timer);
        if (!d || !d.success || !d.code) return go(to);
        var u = new URL(to), own = u.hash ? u.hash.slice(1) : '';
        u.hash = 'mt3uk-handover=' + d.code + (own ? ':' + own : '');
        go(u.href);
      })
      .catch(function () { clearTimeout(timer); go(to); });
  }
  if (onAdminSite || onMainSite) document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (u.origin !== location.origin || APP_PAGES.indexOf(u.pathname) !== -1) return;
    var laps = LAPS_PAGES.indexOf(u.pathname) !== -1;
    if (!laps && !onAdminSite) return;
    e.preventDefault();
    var to = (laps ? LAPS_ORIGIN : ADMIN.mainOrigin) + u.pathname + u.search + u.hash;
    if (a.target === '_blank') {
      // The new tab is opened on the click itself, so the browser does not block it as a pop-up, and sent on once the code is here.
      var w = window.open('about:blank', '_blank');
      if (w) { try { w.opener = null; } catch (err) {} }
      withHandover(to, function (url) { if (w) w.location.href = url; else location.href = url; });
    } else withHandover(to, function (url) { location.href = url; });
  });
  // Arriving with a code (js/admin-key-keep.js took it out of the address at load): swap it for the sign-in and the
  // admin viewer token here. The admin pages work from the key, so nothing reloads.
  (function redeem() {
    var code = window.MT3UK_HANDOVER_CODE;
    if (!code) return;
    window.MT3UK_HANDOVER_CODE = '';
    var tries = 0;
    function attempt() {
      tries++;
      fetch(API + '/session/handover/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) })
        .then(function (res) { return res.json().then(function (d) { return { status: res.status, d: d }; }); })
        .then(function (r) {
          if (r.status === 404 && tries < 3) { setTimeout(attempt, 800); return; }
          if (!r.d || !r.d.success) return;
          try {
            if (r.d.session) { localStorage.setItem(SESSION_KEY, r.d.session); localStorage.setItem('mt3ukMyBuildsEmail', r.d.email || ''); if (r.d.firstName) localStorage.setItem('mt3ukMyBuildsFirstName', r.d.firstName); }
            if (r.d.adminViewer && r.d.adminViewer.token) localStorage.setItem(ADMIN_VIEWER_KEY, JSON.stringify(r.d.adminViewer));
          } catch (e) {}
        })
        .catch(function () {});
    }
    attempt();
  })();

  // ---------- Install this page as an app ----------
  // From admin.mt3uk.com Chrome and Edge install straight away; Safari and Firefox are told how. From mt3uk.com the
  // button goes to the same page on admin.mt3uk.com to install it there. Hidden inside the installed app.
  var installBtn = document.getElementById('alerts-install');
  var installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var installPrompt = null;
  var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (installBtn && !installed) {
    installBtn.hidden = false;
    if (onAdminSite && location.hash === '#install') note('Press ' + installBtn.textContent + ' to add it to your home screen.');
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; });
    window.addEventListener('appinstalled', function () { installBtn.hidden = true; note('Installed. Open it from your home screen or apps.'); });
    installBtn.addEventListener('click', function () {
      if (onMainSite) {
        note('Opening admin.mt3uk.com, where it installs as its own app...');
        // Only go if that address answers: until it is set up in Cloudflare it would be a dead page.
        fetch(ADMIN.origin + '/admin-manifest.json', { mode: 'no-cors', cache: 'no-store' }).then(function () {
          location.href = ADMIN.origin + location.pathname + '#install';
        }).catch(function () { note('admin.mt3uk.com is not set up yet: add it as a custom domain on the mt3uk Worker in Cloudflare.'); });
        return;
      }
      if (installPrompt) {
        installPrompt.prompt();
        installPrompt.userChoice.then(function () { installPrompt = null; }).catch(function () {});
        return;
      }
      note(isIos
        ? 'In Safari, tap the Share button, then Add to Home Screen. Push notifications on an iPhone work from the installed app: open it, then switch on Push on this device.'
        : 'Use your browser\'s menu: Install page as app, Add to Home screen or Add to Dock.');
    });
  }

  flip(bellSw, 'bell');
  flip(emailSw, 'email');
  if (sessionsSw) flip(sessionsSw, 'sessions');
  // Entering the key (Load) reads the switches straight away.
  document.addEventListener('mt3uk-admin-refresh', load);
  load();
})();
