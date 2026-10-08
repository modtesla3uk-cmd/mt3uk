/*
  track.html: members' track days and drag runs.

    track.html                    your sessions (signed in), leaderboards
    track.html?add=1&car=<id>     add a session from a logger file
    track.html?s=<id>             one session (yours, or one shared with you)
    track.html?car=<id>           a build's shared sessions
    track.html?board=<venue>:<layout>, ?drag=<venue>   leaderboards
    track.html?boards=1           every leaderboard

  Files are read in the browser by js/track-parse.js; only the laps, notes
  and a trimmed trace go to the worker (/track/... in workers/vote-worker.js).
  Charts come from js/track-view.js.
*/
(function () {
  var API = window.MT3UK_TRACK_API || 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var SESSION_KEY = 'mt3ukMyBuildsSession';
  var MAP_KEY = 'mt3ukTrackColumns';
  var T = window.MT3UKTrack, V = window.MT3UKTrackView;
  var app = document.getElementById('tp-app');
  if (!app || !T || !V) return;
  var esc = V.esc;
  var RUN_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948', '#2b9fb5', '#8a6d3b', '#9b59b6', '#5b6475'];
  var TYPE_WORD = { drag: 'drag', sprint: 'sprint', other: 'other' };
  var TYPES = [['track', 'Track day'], ['drag', 'Drag run'], ['sprint', 'Sprint'], ['hill', 'Hill climb'], ['other', 'Other']];
  // Sprint and Hill climb are one type underneath (timed from a start line to a finish line); `hill` on the session says which.
  // A place the track list marks as a hill climb makes it one whatever was picked.
  function isHillSession(s, venues) {
    if (!s || s.type !== 'sprint') return false;
    if (s.hill) return true;
    var v = s.venueId && venues && (venues.venues || venues).filter(function (x) { return x.id === s.venueId; })[0];
    return !!v && T.isHill(v);
  }
  function typeChips(s, hill) {
    return TYPES.map(function (t) {
      var on = t[0] === 'hill' ? s.type === 'sprint' && hill : t[0] === 'sprint' ? s.type === 'sprint' && !hill : s.type === t[0];
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-v="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
  }
  var ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 5v3.5h3.5"/><path d="M4 13a8 8 0 0 0 14.9 3M20 19v-3.5h-3.5"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    flag: '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    rotate: '<rect x="8" y="3" width="8" height="18" rx="1.5"/><path d="M3 9a9 9 0 0 1 2.5-4.5M3 9l2.5-.5M3 9l-.5-2.5M21 15a9 9 0 0 1-2.5 4.5M21 15l-2.5.5M21 15l.5 2.5"/>',
    start: '<path fill="currentColor" stroke="none" d="M5 4h2v16H5zM20 4.5v15a1 1 0 0 1-1.5.86L8 12.86a1 1 0 0 1 0-1.72l10.5-7.5A1 1 0 0 1 20 4.5Z"/>',
    play: '<path fill="currentColor" stroke="none" d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/>',
    pause: '<path fill="currentColor" stroke="none" d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
    rewind: '<path fill="currentColor" stroke="none" transform="translate(24 0) scale(-1 1)" d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    corner: '<path d="M4 20c0-9 7-16 16-16"/><path d="M15 4h5v5"/>',
    sig: '<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/>',
    up: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    brake: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    warn: '<path d="M12 3 2 21h20Z"/><path d="M12 10v4M12 17h.01"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    sessions: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    pin: '<path d="M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/>'
  };
  function icon(n) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function token() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; } }
  // gzip: send the body compressed (a saved session is about 60% smaller).
  // The worker spots gzip from its first bytes. Browsers without
  // CompressionStream send it as it is.
  function api(method, path, body, gzip) {
    var opts = { method: method, headers: {}, cache: 'no-store' };
    if (token()) opts.headers['X-Session-Token'] = token();
    // The admin view of a private session (GET) and the admin-only routes carry the admin viewer token.
    if ((method === 'GET' || path.indexOf('/track/admin/') === 0) && adminViewerToken()) opts.headers['X-Admin-Viewer'] = adminViewerToken();
    var ready = Promise.resolve();
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
      if (gzip && typeof CompressionStream === 'function') {
        ready = new Response(new Blob([opts.body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
          .then(function (gz) { opts.body = gz; }, function () {});
      }
    }
    var off = window.MT3UKOffline;
    // A weak signal: a read that has not answered in `readTimeout` while this device holds a copy of its answer is
    // given up on and the copy is used (and the page says it is offline). With no copy it waits as long as it ever
    // did, and a write is never cut short, so a slow save is not lost.
    var timedOut = false, timer = null;
    if (off && method === 'GET' && window.AbortController && cacheableRead(path)) {
      var ctl = new AbortController();
      opts.signal = ctl.signal;
      timer = setTimeout(function () {
        off.recall(path).then(function (c) { if (c) { timedOut = true; ctl.abort(); } });
      }, off.readTimeout());
    }
    return ready.then(function () { return fetch(API + path, opts); }).then(function (r) {
      clearTimeout(timer);
      return r.json().catch(function () { return {}; }).then(function (d) {
        d.status = r.status;
        // What the worker says about the member's cars and sessions is kept on the device, to show with no signal.
        if (off && method === 'GET') off.remember(path, d);
        return d;
      });
    }, function (err) {
      clearTimeout(timer);
      if (timedOut) { err = new TypeError('The signal is too weak: no answer in time'); err.offline = true; }
      if (!off || !off.isNetworkError(err)) throw err;
      off.noteNetworkError();
      if (method === 'GET') return off.recall(path).then(function (c) { if (c) return c; throw err; });
      var e = new Error('You are offline, and this needs a connection.');
      e.offline = true;
      throw e;
    });
  }
  // The reads the device keeps an answer for (js/laps-offline.js, cacheable): the only ones a weak signal gives up on.
  function cacheableRead(path) {
    return /^\/(my-builds|track\/sessions|track\/tracks|track\/copy|track\/access|tyres|pads|vehicles)(\?|$)/.test(path) || path.indexOf('/track/session?id=') === 0;
  }
  function adminViewerToken() {
    try {
      var v = JSON.parse(localStorage.getItem('mt3ukAdminViewer') || 'null');
      return v && v.token && v.expires > Date.now() ? v.token : '';
    } catch (e) { return ''; }
  }
  var adminCheck = null;
  function isAdmin() {
    if (adminCheck) return adminCheck;
    var t = adminViewerToken();
    adminCheck = !t ? Promise.resolve(false) : fetch(API + '/admin/viewer-check?token=' + encodeURIComponent(t), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { return !!(d && d.success); }).catch(function () { return false; });
    return adminCheck;
  }

  // ---------- Weather at the track (Open-Meteo, free, no key) ----------
  // Air temperature for the session's hour at the track, and rain in the
  // three hours before, to suggest Dry, Damp or Wet. Only the track's
  // position and the date go to Open-Meteo. Their licence asks for credit,
  // so wherever it's used the page says "Open-Meteo".
  var METEO_CREDIT = '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>';
  function ukToday() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function lookupWeather(origin, date, time) {
    if (!origin || origin.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return Promise.resolve(null);
    var daysAgo = Math.round((Date.parse(ukToday()) - Date.parse(date)) / 864e5);
    if (daysAgo < 0) return Promise.resolve(null);
    var q = 'latitude=' + Number(origin[0]).toFixed(3) + '&longitude=' + Number(origin[1]).toFixed(3) + '&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=Europe%2FLondon';
    // Recent days come from the forecast service, older ones from the archive.
    var url = daysAgo <= 60 ? 'https://api.open-meteo.com/v1/forecast?' + q + '&past_days=' + (daysAgo + 1) + '&forecast_days=1'
      : 'https://archive-api.open-meteo.com/v1/archive?' + q + '&start_date=' + date + '&end_date=' + date;
    var hour = /^\d{2}:/.test(time || '') ? time.slice(0, 2) : '12';
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var h = d && d.hourly;
      if (!h || !h.time) return null;
      var i = h.time.indexOf(date + 'T' + hour + ':00');
      if (i === -1 || h.temperature_2m[i] == null) return null;
      var rain = 0;
      for (var k = Math.max(0, i - 3); k <= i; k++) rain += h.precipitation[k] || 0;
      return { temp: Math.round(h.temperature_2m[i]), rain: Math.round(rain * 10) / 10, wind: h.wind_speed_10m ? Math.round(h.wind_speed_10m[i]) : null, hour: hour + ':00' };
    }).catch(function () { return null; });
  }
  function weatherConditions(w) { return w.rain >= 1 ? 'Wet' : w.rain >= 0.2 ? 'Damp' : 'Dry'; }
  function weatherNote(w, place) {
    return 'From ' + METEO_CREDIT + ' weather for ' + esc(place || 'the track') + ' at ' + esc(w.hour) + ': ' + w.temp + '°C, ' +
      (w.rain ? w.rain + ' mm of rain in the 3 hours before' : 'no rain in the 3 hours before') + (w.wind != null ? ', wind ' + V.fmtV(w.wind) : '') + '.';
  }

  var library = null;
  function getLibrary() {
    if (library) return Promise.resolve(library);
    return Promise.all([
      fetch('data/tracks.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { venues: [] }; }),
      api('GET', '/track/tracks').catch(function () { return {}; })
    ]).then(function (res) {
      library = T.mergeLibrary(res[0], res[1] && res[1].extra);
      return library;
    });
  }
  var mine = null;
  // Offline mode: shown above anything drawn from what this device kept the last time it was online.
  function oldNote(at) {
    var when = new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return '<div class="tp-notice is-warn" id="tp-old-note" role="status">' + icon('info') + '<div>You are offline, so this is what was on this device on ' + esc(when) + '. Anything new appears when you are online again.</div></div>';
  }
  function isOffline() { return !!(window.MT3UKOffline && window.MT3UKOffline.isOffline()); }
  // 'car' or 'bike': the vehicle of the session or Add page on show, for the words on it.
  var VW = 'car';
  function vwOf(c) { return c && c.vehicleType === 'bike' ? 'bike' : 'car'; }
  // The welcome card's text, as set on the admin page; nothing set means the built-in words.
  var copy = null;
  // Sign in: the Laps one on laps.mt3uk.com (js/account-bar.js), the MT3UK one elsewhere.
  function signInUrl(next) { return window.mt3ukSignInUrl ? window.mt3ukSignInUrl(next) : 'signin.html?next=' + encodeURIComponent(next); }
  function getCopy() {
    if (copy) return Promise.resolve(copy);
    return api('GET', '/track/copy').then(function (d) { copy = (d && d.copy) || {}; return copy; }).catch(function () { return {}; });
  }
  function getMine() {
    if (mine) return Promise.resolve(mine);
    if (!token()) return Promise.resolve(null);
    return Promise.all([api('GET', '/my-builds'), api('GET', '/track/sessions')]).then(function (r) {
      if (r[0].status === 401) return null;
      // Early preview: not on the approved list yet. Not kept, so approval shows on the next visit.
      if (r[1].status === 403 && r[1].needsAccess) return { gate: true, cars: r[0].cars || [], sessions: [] };
      var got = { cars: (r[0].cars || []), sessions: r[1].sessions || [] };
      // The answer kept on this device from the last time there was a connection: shown, but not remembered, so the
      // real list is fetched as soon as the page is online again.
      if (r[0].cachedAt || r[1].cachedAt) { got.cachedAt = Math.min(r[0].cachedAt || Infinity, r[1].cachedAt || Infinity); return got; }
      mine = got;
      return mine;
    });
  }

  // ---------- Early preview gate ----------
  var PREVIEW_USES = ['Tesla Track Mode', 'RaceBox', 'Another lap timer app', 'Just having a look'];
  var PREVIEW_SHOTS = [
    ['images/track-preview/session-overview.jpg', 'A whole session zoomed out: the best lap tiles, the Tesla Track Mode figures, two laps compared with speed and time gap charts, a map and a corner by corner table, then the grip circle and what we spotted.', 760, 2310, 'A whole session, zoomed out']
  ];

  // The preview pictures, one at a time: Previous and Next (or the arrow keys),
  // full screen, and Close (or Escape).
  function openShot(index, opener) {
    var old = document.getElementById('tp-lb');
    if (old) old.remove();
    var n = PREVIEW_SHOTS.length, at = index;
    var box = document.createElement('div');
    box.className = 'tp-lb' + (n === 1 ? ' tp-lb-one' : ''); box.id = 'tp-lb'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Preview pictures');
    box.innerHTML = '<div class="tp-lb-bar"><span class="tp-lb-count" id="tp-lb-count"></span><span class="tp-lb-tools"><button type="button" class="tp-lb-btn" data-lb="full" aria-label="Full screen">' + icon('expand') + '</button><button type="button" class="tp-lb-btn" data-lb="close" aria-label="Close">' + icon('x') + '</button></span></div>' +
      '<div class="tp-lb-stage"><button type="button" class="tp-lb-btn tp-lb-prev" data-lb="prev" aria-label="Previous picture">' + icon('prev') + '</button><figure class="tp-lb-fig"><img id="tp-lb-img" alt=""><figcaption id="tp-lb-cap"></figcaption></figure><button type="button" class="tp-lb-btn tp-lb-next" data-lb="next" aria-label="Next picture">' + icon('next') + '</button></div>';
    document.body.appendChild(box);
    document.body.classList.add('tp-noscroll');
    function show(k) {
      at = (k + n) % n;
      var x = PREVIEW_SHOTS[at];
      var img = document.getElementById('tp-lb-img');
      img.src = x[0]; img.alt = x[1];
      document.getElementById('tp-lb-cap').textContent = x[4] + '. ' + x[1];
      document.getElementById('tp-lb-count').textContent = n > 1 ? (at + 1) + ' of ' + n : '';
    }
    function close() {
      if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* already out */ } }
      box.remove(); document.body.classList.remove('tp-noscroll'); document.removeEventListener('keydown', onKey);
      if (opener && document.body.contains(opener)) opener.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(at - 1);
      else if (e.key === 'ArrowRight') show(at + 1);
    }
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lb]');
      if (!b) { if (e.target === box || e.target.classList.contains('tp-lb-stage')) close(); return; }
      var what = b.getAttribute('data-lb');
      if (what === 'close') close();
      else if (what === 'prev') show(at - 1);
      else if (what === 'next') show(at + 1);
      else if (what === 'full') {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (box.requestFullscreen) box.requestFullscreen().catch(function () { /* not allowed here */ });
      }
    });
    // Swiping on a phone.
    var sx = null;
    box.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1)); }, { passive: true });
    show(index);
    box.querySelector('[data-lb="close"]').focus();
  }
  function showGate() {
    loading();
    api('GET', '/track/access').then(function (d) {
      var status = d.success && d.access ? d.access : 'none';
      var pending = status === 'pending';
      var h = '<div class="card tp-gate"><span class="early-badge early-badge-lg">Early preview</span><h2>Track Sessions is being tested</h2><div class="tp-gate-top"><div class="tp-gate-intro">' +
        '<p>Upload the file from your lap timer or Tesla Track Mode and see every lap mapped, where you gained and lost time, and what your mods did to your times. We are letting a small group try it first so we can fix things before it opens to everyone.</p>' +
        '<ul class="tp-ticks"><li>' + icon('check') + 'Laps, sectors and corners found for you</li><li>' + icon('check') + 'Compare any two laps, corner by corner, with playback</li><li>' + icon('check') + 'Tesla Track Mode figures: charge, power, braking and temperatures</li><li>' + icon('check') + 'Sessions are private until you choose to share them</li></ul></div><div class="tp-gate-ask">';
      if (pending) {
        h += '<div class="tp-notice is-ok" id="tp-gate-done">' + icon('check') + '<div><b>Request received</b><br>We will email you when you are in. Thank you for waiting.</div></div>';
      } else {
        h += '<form id="tp-gate-form" class="tp-gate-form"><h3>Ask for early access</h3>' +
          '<div class="tp-field"><label for="tp-gate-use">What will you use it with?</label><select class="field" id="tp-gate-use">' + PREVIEW_USES.map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</select></div>' +
          '<div class="tp-field"><label for="tp-gate-note">Anything we should know? (optional)</label><textarea class="field" id="tp-gate-note" rows="3" maxlength="300" placeholder="For example, the tracks you go to"></textarea></div>' +
          '<button type="submit" class="btn btn-accent" id="tp-gate-send">Request access</button><p class="tp-status" id="tp-gate-status" role="status"></p></form>';
      }
      h += '</div></div>' +
        '<h3 class="tp-gate-see">See what it does</h3><p class="tp-small">Tap the picture to see it bigger. It uses example data.</p>' +
        '<div class="tp-gate-thumbs">' + PREVIEW_SHOTS.map(function (x, k) { return '<button type="button" class="tp-thumb" data-shot="' + k + '" aria-label="Open: ' + esc(x[4]) + '"><span class="tp-thumb-img"><img src="' + x[0] + '" alt="" width="' + x[2] + '" height="' + x[3] + '" loading="lazy"></span><span class="tp-thumb-cap">' + esc(x[4]) + '</span></button>'; }).join('') + '</div>' +
        '<p class="tp-small">The <a href="leaderboards.html">Leaderboard</a> page is open to everyone to look at.</p></div>';
      app.innerHTML = h;
      app.querySelectorAll('[data-shot]').forEach(function (b) { b.addEventListener('click', function () { openShot(parseInt(b.getAttribute('data-shot'), 10), b); }); });
      var f = document.getElementById('tp-gate-form');
      if (f) f.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = document.getElementById('tp-gate-send'), st = document.getElementById('tp-gate-status');
        btn.disabled = true; st.textContent = 'Sending...';
        api('POST', '/track/access/request', { use: document.getElementById('tp-gate-use').value, note: document.getElementById('tp-gate-note').value }).then(function (r) {
          if (r.success && r.access === 'approved') { mine = null; return showHome(); }
          if (r.success) { showGate(); return; }
          btn.disabled = false; st.textContent = r.message || 'Could not send that. Try again.';
        }).catch(function () { btn.disabled = false; st.textContent = 'Could not send that. Check your connection and try again.'; });
      });
    }).catch(function () { failed('Could not load this page. Check your connection and try again.'); });
  }

  // ---------- Routing ----------
  function params() { return new URL(location.href).searchParams; }
  // Back steps back through the views this visit has moved through, so it returns to where the member came from (a
  // leaderboard, a track's list of sessions, another session). Each go() pushes a history entry carrying its depth, and
  // the page itself counts as one step when it was opened from another page of the site. With nothing to step back to
  // (a shared link, a bookmark, a new tab) Back goes to the view's parent, the link it carries, instead.
  function siteHost(h) {
    var sites = window.MT3UK_SITES || { main: ['mt3uk.com', 'www.mt3uk.com'], laps: ['laps.mt3uk.com'] };
    return h === location.hostname || (sites.main || []).indexOf(h) >= 0 || (sites.laps || []).indexOf(h) >= 0;
  }
  function fromSite() {
    try {
      if (!document.referrer || window.history.length < 2) return false;
      var r = new URL(document.referrer);
      return siteHost(r.hostname) && (r.pathname !== location.pathname || r.search !== location.search);
    } catch (e) { return false; }
  }
  function backDepth() { var st = history.state; return st && typeof st.tpDepth === 'number' ? st.tpDepth : (fromSite() ? 1 : 0); }
  // replace: the new view takes the place of the current one in the history, so Back (and the browser's back button)
  // skip it: the Add page once its session is saved, a session once it is deleted.
  function go(q, keepScroll, replace) {
    var y = window.scrollY || 0;
    rememberCards();
    history[replace ? 'replaceState' : 'pushState']({ tpDepth: backDepth() + (replace ? 0 : 1) }, '', 'track.html' + (q ? '?' + q : ''));
    route();
    window.scrollTo(0, keepScroll ? y : 0);
  }
  // Back to the view before, or to q when there is none to go back to.
  function goBack(q) { if (backDepth() > 0) history.back(); else go(q); }
  window.addEventListener('popstate', route);
  // Offline mode: back online, or the sessions kept on the device have been sent: the list is fetched afresh.
  function listAgain() { mine = null; counts = null; if (!location.search) showHome(); }
  document.addEventListener('mt3uk-offline-end', function () { library = null; listAgain(); });
  document.addEventListener('mt3uk-offline-synced', listAgain);
  app.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-go]');
    if (a && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (a.getAttribute('data-back') === 'replace') go(a.getAttribute('data-go'), false, true);
      else if (a.hasAttribute('data-back')) goBack(a.getAttribute('data-go'));
      else go(a.getAttribute('data-go'));
    }
  });
  // The page's own Back (to the page before) is only on the list of sessions; a session or the Add page has its own Back.
  // A view's own Back (to the list it came from) takes the place of the page's Back in the heading, so Back is always
  // the same button in the same place (round on a phone). Moved whenever the view is drawn.
  var heroTop = document.querySelector('.page-hero .tp-hero-top');
  var pageBack = heroTop && heroTop.querySelector('.back-link:not(.tp-back)');
  // Each new view starts with the page's Back (hidden off the list of sessions, as before); a view that draws its own
  // Back has it moved into the heading in its place.
  function syncPageBack() {
    if (!heroTop || !pageBack) return;
    [].slice.call(heroTop.querySelectorAll('.tp-back, .tp-home')).forEach(function (x) { x.remove(); });
    pageBack.hidden = !!location.search.replace(/^\?/, '');
  }
  // A view's own Back goes to the list it came from, which on a session can be two or three steps from My Sessions,
  // so a My Sessions button (#tp-home) sits beside it on every view but the list.
  function moveViewBack() {
    var inner = app.querySelector('.tp-back');
    if (!inner || !heroTop || !pageBack) return;
    [].slice.call(heroTop.querySelectorAll('.tp-back, .tp-home')).forEach(function (x) { x.remove(); });
    inner.classList.add('back-link');
    heroTop.insertBefore(inner, pageBack);
    // On every view but the list itself, whatever Back does (it steps back one view at a time).
    inner.insertAdjacentHTML('afterend', '<a class="back-link tp-home" id="tp-home" href="track.html" data-go="" aria-label="My Sessions" title="My Sessions">' + icon('sessions') + 'My Sessions</a>');
    pageBack.hidden = true;
  }
  if (heroTop) {
    heroTop.addEventListener('click', function (e) {
      var a = e.target.closest('a.tp-back[data-go], a.tp-home');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      if (a.classList.contains('tp-home')) go('');
      else if (a.getAttribute('data-back') === 'replace') go(a.getAttribute('data-go'), false, true);
      else goBack(a.getAttribute('data-go'));
    });
    if (window.MutationObserver) new MutationObserver(moveViewBack).observe(app, { childList: true, subtree: true });
  }
  // Add a session in the page heading (track.html), under Leaderboards: shown on the member's list of sessions only,
  // for the vehicle picked there.
  var heroAddCar = null;
  function heroAdd() {
    var box = document.getElementById('tp-hero-actions'), a = document.getElementById('tp-hero-add');
    if (!box || !a) return;
    // While the list is still loading (track.html shows the box as a placeholder, .is-waiting), it stays.
    box.hidden = !heroAddCar && !box.classList.contains('is-waiting');
    if (!heroAddCar) return;
    box.classList.remove('is-waiting');
    a.classList.remove('is-wait');
    var q = 'add=1&car=' + encodeURIComponent(heroAddCar);
    a.href = 'track.html?' + q;
    a.setAttribute('data-go', q);
  }
  (function () {
    var a = document.getElementById('tp-hero-add');
    if (a) a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || !a.getAttribute('data-go')) return;
      e.preventDefault();
      go(a.getAttribute('data-go'));
    });
  })();
  // Each route gets a number: a view still loading when the member moves on (Back pressed before a session has
  // loaded, say) must not draw over the view that replaced it.
  var routeSeq = 0;
  function stale(my) { return my !== routeSeq; }
  // The heading's Add a session is a placeholder until the first view has drawn (heroAdd), then the real button or gone.
  function heroSettle() {
    var box = document.getElementById('tp-hero-actions'), a = document.getElementById('tp-hero-add');
    if (box) box.classList.remove('is-waiting');
    if (a) a.classList.remove('is-wait');
    heroAdd();
  }
  function route() {
    var done = routeView();
    Promise.resolve(done).then(heroSettle, heroSettle);
  }
  function routeView() {
    routeSeq++;
    stopPlay();
    syncPageBack();
    heroAddCar = null;
    heroAdd();
    if (window.MT3UKLapsPanels) window.MT3UKLapsPanels.show(false);
    if (cmpFull) { cmpFull = false; unlockOrientation(); document.body.classList.remove('tp-noscroll'); }
    V.hideTip();
    var p = params();
    // Sessions and builds have their own share button, so the page one steps aside.
    document.body.setAttribute('data-tp-view', p.get('s') ? 'session' : p.get('car') && !p.get('add') ? 'car' : '');
    if (p.get('s')) return showSession(p.get('s'));
    if (p.get('add')) return showAdd(p.get('car'));
    if (p.get('at')) return showTrackSessions(p.get('mycar'), p.get('at'), p.get('lay') || '');
    // The leaderboards have their own page now; old links still work.
    if (p.get('board')) { location.replace('leaderboards.html?board=' + encodeURIComponent(p.get('board'))); return; }
    if (p.get('drag')) { location.replace('leaderboards.html?drag=' + encodeURIComponent(p.get('drag'))); return; }
    if (p.get('boards')) { location.replace('leaderboards.html'); return; }
    if (p.get('car')) return showCar(p.get('car'));
    return showHome();
  }
  // Loading: a spinner and a line, then a note when it is slow (the garage lists every photo, which can take a
  // while on a slow connection) and a Refresh button when it is very slow. Tests shorten the waits (MT3UK_SLOW_MS).
  var SLOW_MS = (window.MT3UK_SLOW_MS || 8000);
  var loadingSeq = 0;
  function loading(msg) {
    var seq = ++loadingSeq;
    app.innerHTML = '<div class="tp-loading" id="tp-loading" role="status"><span class="tp-spinner" aria-hidden="true"></span><p>' + esc(msg || 'Loading...') + '</p></div>';
    setTimeout(function () {
      var el = document.getElementById('tp-loading');
      if (!el || seq !== loadingSeq) return;
      el.insertAdjacentHTML('beforeend', '<p class="tp-loading-slow" id="tp-loading-slow">This is taking a little longer than usual. Your garage and sessions are being gathered.</p>');
    }, SLOW_MS);
    setTimeout(function () {
      var el = document.getElementById('tp-loading');
      if (!el || seq !== loadingSeq) return;
      el.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-secondary btn-sm" data-refresh>' + icon('refresh') + '<span>Refresh</span></button>');
    }, SLOW_MS * 3);
  }
  function failed(msg) { app.innerHTML = '<div class="card tp-empty">' + icon('warn') + '<p>' + esc(msg) + '</p><a class="btn btn-secondary btn-sm" href="track.html" data-go="" data-back aria-label="Back to Track sessions">Back</a></div>'; }
  // Every Back is a button that just says Back; where it goes is in its name for a screen reader. It steps back to the
  // view before (goBack); the link it carries is the view's parent, for when there is no view before. A screen drawn in
  // place of a session (Change the type, Edit the map) has no history entry of its own, so its Back redraws the session
  // in the same entry (replace) instead of stepping back past it.
  function back(label, q, replace) {
    // The name says where it goes: the parent view, or just Back when it steps back to the view before.
    var name = !replace && backDepth() > 0 ? 'Back' : /^back\b/i.test(label) ? label : 'Back to ' + label.charAt(0).toLowerCase() + label.slice(1);
    return '<a class="tp-back" href="track.html' + (q ? '?' + q : '') + '" data-go="' + esc(q || '') + '" data-back' + (replace ? '="replace"' : '') + ' aria-label="' + esc(name) + '">' + icon('back') + 'Back</a>';
  }
  function niceDate(d) { return T.niceDate(d); }
  // "28 May", with the year only when it isn't this year.
  function shortDate(d) {
    var n = niceDate(d || '');
    return String(d || '').slice(0, 4) === String(new Date().getFullYear()) ? n.replace(/ \d{4}$/, '') : n;
  }
  // Short forms for the A and B labels, so they fit a phone: 28/05 (the year only when it is not this one), a member as
  // first initial and last name, and "L5" for Lap 5, "R2 L3" for run 2, lap 3.
  function dmy(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    if (!m) return d || '';
    return m[3] + '/' + m[2] + (m[1] === String(new Date().getFullYear()) ? '' : '/' + m[1].slice(2));
  }
  // The same with the year always shown, for the date beside each car in the full screen controls.
  function dmyYear(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1].slice(2) : d || '';
  }
  // A member as the first initial and last name ("A. Smith") when their public name is a first and last name; a nickname
  // (one word) is shown as it is. Only the name the member chose to show is ever used.
  function initials(name) {
    name = String(name || '').trim();
    if (!name || name === 'You') return name;
    var words = name.split(/\s+/).filter(Boolean);
    if (words.length < 2) return name.length > 14 ? name.slice(0, 13) + '\u2026' : name;
    return words[0].charAt(0).toUpperCase() + '. ' + words[words.length - 1];
  }
  // The public note under the session heading: a second note the owner writes for everyone who opens the session.
  var PUBLIC_NOTE_MAX = 140;
  function publicNoteHtml(note) { return note ? '<p class="tp-public-note" id="tp-public-note-line">' + icon('info') + '<span>' + esc(note) + '</span></p>' : ''; }
  function trackName(s) { return (s.venue || (s.type === 'sprint' ? (s.hill ? 'Hill climb' : 'Sprint') : s.type === 'drag' ? 'Drag run' : 'Track session')) + (s.layout && s.layout !== s.venue ? ', ' + s.layout : !s.layout && s.organizer ? ', ' + s.organizer : ''); }
  function privacyPill(p, street) {
    if (street) return '<span class="tp-pill tp-pill-admin">' + icon('shield') + 'Street run, admin only</span>';
    if (p === 'board' || p === 'build') return '<span class="tp-pill">' + icon('eye') + 'Shared</span>';
    return '<span class="tp-pill">' + icon('lock') + 'Only me</span>';
  }
  function sessionResult(s) {
    if (s.type === 'drag') return s.quarter ? s.quarter.toFixed(2) + ' s, 1/4 mile' : s.s60 ? s.s60.toFixed(2) + ' s, 0 to 60 mph' : (s.runs || 0) + ' runs';
    if (s.type === 'other' && !s.bestTime) return s.vmax ? 'Top ' + V.fmtV(s.vmax) : '';
    return s.bestTime ? V.fmtLap(s.bestTime) : (s.laps || 0) + (s.type === 'sprint' ? ' runs' : ' laps');
  }
  function notesHtml(list) {
    return list.map(function (n) {
      return '<div class="tp-note">' + icon(n.icon || 'info') + '<div><p>' + esc(n.text) + '</p>' + (n.small ? '<small>' + esc(n.small) + '</small>' : '') + '</div></div>';
    }).join('');
  }
  // The round share button, top right of a public session or build page.
  var SITE_URL = 'https://laps.mt3uk.com/';
  // A car's make and model together (js/vehicle-data.js); cars saved before makes existed have only a model.
  function titleOf(c) { return window.MT3UKVehicles ? window.MT3UKVehicles.title(c) : (c.model || ''); }
  function shareDot(label) {
    return '<button type="button" class="mt3uk-share-dot tp-share-dot" data-tp-share aria-label="' + esc(label) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg></button>';
  }
  function wireShare(opts) {
    var btn = document.querySelector('[data-tp-share]');
    if (btn) btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.mt3ukSharePage) window.mt3ukSharePage(opts, btn);
    });
  }
  // Tyres: make and model from the known list (the model box suggests, never
  // limits), and the size as separate width, profile and diameter drop-downs.
  var TY = window.MT3UKTyres;
  // The makes, models and sizes come from data/tyres.json and the admin's changes.
  function loadTyres() { return TY ? TY.load().catch(function () {}) : Promise.resolve(); }
  function tyreInit(s) {
    if (!TY) return {};
    if (s.tyreMake !== undefined || s.tyreModel !== undefined || s.tyreWidth) return { make: s.tyreMake || '', model: s.tyreModel || '', w: s.tyreWidth || '', p: s.tyreProfile || '', d: s.tyreRim || '' };
    return TY.parse(s.tyres || '');
  }
  // The tyres from the car's most recent session, to start the next one with.
  function lastTyre(m, carId) {
    if (!TY || !m) return null;
    var list = (m.sessions || []).filter(function (x) { return x.carId === carId && x.tyres; })
      .sort(function (x, y) { return (y.date + (y.time || '')) < (x.date + (x.time || '')) ? -1 : 1; });
    if (!list.length) return null;
    var t = TY.parse(list[0].tyres);
    return t.make || t.model || t.w ? t : null;
  }
  function tyreOpts(list, sel, label, unit) {
    return '<option value="">' + label + '</option>' + list.map(function (v) { return '<option value="' + v + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + v + (unit || '') + '</option>'; }).join('');
  }
  function tyreModelList(make) { return (TY && Object.prototype.hasOwnProperty.call(TY.makes, make) && TY.makes[make]) || []; }
  // The Model drop-down for a make from the tyre list: Choose the model, each model, then Other model (type it in), which
  // opens the text box (an unlisted tyre can still be typed). Without a listed make the text box is all there is.
  function tyreModelPick(make, model) {
    var list = tyreModelList(make);
    if (!list.length) return '';
    return '<option value="">Choose the model</option>' + list.map(function (m) { return '<option value="' + esc(m) + '"' + (m === model ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') +
      '<option value="__other"' + (model && list.indexOf(model) === -1 ? ' selected' : '') + '>Other model, type it in</option>';
  }
  function tyreFields(pre, t) {
    if (!TY) return '';
    t = t || {};
    var known = !!(t.make && Object.prototype.hasOwnProperty.call(TY.makes, t.make)), other = !!(t.make && !known);
    return '<div class="tp-tyres"><span class="tp-lbl">Tyres</span>' +
      '<div class="tp-f2"><div class="tp-field"><label for="' + pre + '-make">Make</label><select class="field" id="' + pre + '-make"><option value="">Not set</option>' +
        Object.keys(TY.makes).map(function (m) { return '<option value="' + esc(m) + '"' + (known && t.make === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') +
        '<option value="__other"' + (other ? ' selected' : '') + '>Other make</option></select></div>' +
      '<div class="tp-field"><label for="' + pre + '-model-pick">Model</label>' +
        '<select class="field" id="' + pre + '-model-pick"' + (known && tyreModelList(t.make).length ? '' : ' hidden') + '>' + tyreModelPick(known ? t.make : '', t.model || '') + '</select>' +
        '<input class="field" id="' + pre + '-model" autocomplete="off" aria-label="Tyre model" placeholder="Type the model, for example Pilot Sport 4S" value="' + esc(t.model || '') + '"' +
          (known && tyreModelList(t.make).length && (!t.model || tyreModelList(t.make).indexOf(t.model) !== -1) ? ' hidden' : '') + '></div></div>' +
      '<div class="tp-field" id="' + pre + '-other-wrap"' + (other ? '' : ' hidden') + '><label for="' + pre + '-make-other">Make</label><input class="field" id="' + pre + '-make-other" value="' + esc(other ? t.make : '') + '"></div>' +
      '<div class="tp-f3"><div class="tp-field"><label for="' + pre + '-w">Width (mm)</label><select class="field" id="' + pre + '-w">' + tyreOpts(TY.widths, t.w, 'Width') + '</select></div>' +
      '<div class="tp-field"><label for="' + pre + '-p">Profile (%)</label><select class="field" id="' + pre + '-p">' + tyreOpts(TY.profiles, t.p, 'Profile') + '</select></div>' +
      '<div class="tp-field"><label for="' + pre + '-d">Diameter (in)</label><select class="field" id="' + pre + '-d">' + tyreOpts(TY.rims, t.d, 'Diameter') + '</select></div></div>' +
      '<p class="tp-src tp-tyre-preview" id="' + pre + '-preview"></p></div>';
  }
  // Driven wheels on the Add page: starts as the car's (set in My Garage, or from its make, model and version);
  // a change here is saved with the session and back to the car.
  function driveFields(a) {
    var DR = (window.MT3UKVehicles && window.MT3UKVehicles.DRIVES) || ['FWD', 'RWD', 'AWD'];
    return '<div class="tp-field"><span class="tp-lbl">Driven wheels</span><div class="tp-chips" data-drive>' + DR.map(function (d) {
      return '<button type="button" class="chip' + (a.drive === d ? ' is-on' : '') + '" data-v="' + d + '" aria-pressed="' + (a.drive === d) + '">' + d + '</button>';
    }).join('') + '</div>' + (a.drive ? '' : '<p class="tp-small">Pick which wheels drive the ' + VW + '. It is shown with the tyres on the leaderboard.</p>') + '</div>';
  }
  function readTyre(pre) {
    var mk = document.getElementById(pre + '-make');
    if (!mk || !TY) return null;
    function v(id) { var el = document.getElementById(pre + '-' + id); return el ? el.value.trim() : ''; }
    var make = mk.value === '__other' ? v('make-other') : mk.value;
    return { make: make, model: v('model'), w: v('w') ? parseInt(v('w'), 10) : '', p: v('p') ? parseInt(v('p'), 10) : '', d: v('d') ? parseInt(v('d'), 10) : '' };
  }
  // What goes to the worker: the description and its parts.
  function tyrePayload(t) {
    t = t || {};
    return { tyres: TY ? TY.compose(t) : '', tyreMake: t.make || '', tyreModel: t.model || '', tyreWidth: t.w || null, tyreProfile: t.p || null, tyreRim: t.d || null };
  }
  function wireTyres(pre) {
    var mk = document.getElementById(pre + '-make');
    if (!mk || !TY) return;
    function preview() {
      var el = document.getElementById(pre + '-preview'), t = readTyre(pre), txt = TY.compose(t);
      if (el) el.textContent = txt ? 'Saved as: ' + txt : '';
      var half = t && ((t.w || t.p || t.d) && !(t.w && t.p && t.d));
      if (el && half) el.textContent += (txt ? '. ' : '') + 'Pick the width, profile and diameter to save the size.';
    }
    mk.addEventListener('change', function () {
      var wrap = document.getElementById(pre + '-other-wrap');
      if (wrap) wrap.hidden = mk.value !== '__other';
      // A different make has different models, so the old one goes and the drop-down is filled for the new make.
      var md = document.getElementById(pre + '-model'), pick = document.getElementById(pre + '-model-pick');
      if (md) md.value = '';
      var opts = tyreModelPick(mk.value, '');
      if (pick) { pick.innerHTML = opts; pick.hidden = !opts; }
      if (md) md.hidden = !!opts;
      preview();
    });
    // Choosing a listed model fills the text box behind it; Other model opens the box to type one.
    var mdl = document.getElementById(pre + '-model'), mpick = document.getElementById(pre + '-model-pick');
    if (mpick && mdl) mpick.addEventListener('change', function () {
      if (mpick.value === '__other') { mdl.value = ''; mdl.hidden = false; mdl.focus(); }
      else { mdl.value = mpick.value; mdl.hidden = true; }
      preview();
    });
    ['model', 'make-other', 'w', 'p', 'd'].forEach(function (k) {
      var el = document.getElementById(pre + '-' + k);
      if (el) { el.addEventListener('input', preview); el.addEventListener('change', preview); }
    });
    preview();
  }
  // Brake pads: front and rear, each a make and a compound from the pad list (data/pads.json and the admin's changes,
  // js/pad-data.js), with Same pads on the rear (on unless the two differ). The Add page fills them in from the car's
  // brakes in My Garage; what is picked is saved with the session only, never back to the garage.
  var PD = window.MT3UKPads;
  function loadPads() { return PD ? PD.load().catch(function () {}) : Promise.resolve(); }
  function padInit(s) {
    s = s || {};
    var p = { fm: s.padFrontMake || '', fc: s.padFrontCompound || '', rm: s.padRearMake || '', rc: s.padRearCompound || '' };
    p.same = !(p.rm || p.rc) || (p.rm === p.fm && p.rc === p.fc);
    return p;
  }
  // The car's pads from its My Garage brakes ("Pagid RSL29" in Front pads), as far as the pad list knows them.
  function carPads(car) {
    var f = car && car.specs && car.specs.brakes && car.specs.brakes.fields;
    if (!PD || !f) return null;
    var fr = PD.parse(f.frontPads || f.pads || ''), rr = PD.parse(f.rearPads || f.frontPads || f.pads || '');
    if (!fr.make && !rr.make) return null;
    var p = { fm: fr.make, fc: fr.compound, rm: rr.make, rc: rr.compound };
    p.same = p.rm === p.fm && p.rc === p.fc;
    return p;
  }
  function padSelects(pre, side, make, compound, off) {
    var known = !!(make && PD.makes[make]);
    var makeOpts = '<option value="">Not set</option>' + Object.keys(PD.makes).map(function (m) { return '<option value="' + esc(m) + '"' + (m === make ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') +
      (make && !known ? '<option value="' + esc(make) + '" selected>' + esc(make) + '</option>' : '');
    var comps = known ? PD.compounds(make) : (compound ? [compound] : []);
    if (compound && comps.indexOf(compound) === -1) comps = comps.concat([compound]);
    var compOpts = '<option value="">' + (make ? 'Choose the compound' : 'Choose the make first') + '</option>' + comps.map(function (c) { return '<option value="' + esc(c) + '"' + (c === compound ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var label = side === 'front' ? 'Front pads' : 'Rear pads';
    return '<div class="tp-f2 tp-pad-row" data-pad-side="' + side + '"' + (off ? ' hidden' : '') + '>' +
      '<div class="tp-field"><label for="' + pre + '-' + side + '-make">' + label + ', make</label><select class="field" id="' + pre + '-' + side + '-make">' + makeOpts + '</select></div>' +
      '<div class="tp-field"><label for="' + pre + '-' + side + '-comp">' + label + ', compound</label><select class="field" id="' + pre + '-' + side + '-comp"' + (make ? '' : ' disabled') + '>' + compOpts + '</select></div>' +
      '<p class="tp-small tp-pad-maker" id="' + pre + '-' + side + '-maker"></p></div>';
  }
  function padFields(pre, p, note) {
    if (!PD) return '';
    p = p || { same: true };
    return '<div class="tp-pads"><span class="tp-lbl">Brake pads</span>' + (note ? '<p class="tp-src">' + icon('info') + '<span>' + note + '</span></p>' : '') +
      padSelects(pre, 'front', p.fm, p.fc, false) +
      '<button type="button" class="tp-switch tp-pad-same" role="switch" id="' + pre + '-same" aria-checked="' + (p.same !== false) + '"><span>Same pads on the rear</span><span class="tp-track"></span></button>' +
      padSelects(pre, 'rear', p.same !== false ? p.fm : p.rm, p.same !== false ? p.fc : p.rc, p.same !== false) +
      '<p class="tp-small">Not on the list? <a href="contact.html">Tell us</a> and we&rsquo;ll add it.</p></div>';
  }
  function readPads(pre) {
    var fm = document.getElementById(pre + '-front-make');
    if (!fm || !PD) return null;
    function v(id) { var el = document.getElementById(pre + '-' + id); return el ? el.value : ''; }
    var same = document.getElementById(pre + '-same').getAttribute('aria-checked') === 'true';
    var p = { fm: v('front-make'), fc: v('front-comp') };
    p.rm = same ? p.fm : v('rear-make'); p.rc = same ? p.fc : v('rear-comp'); p.same = same;
    return p;
  }
  function padPayload(p) {
    p = p || {};
    return { padFrontMake: p.fm || '', padFrontCompound: p.fc || '', padRearMake: p.rm || '', padRearCompound: p.rc || '' };
  }
  function wirePads(pre) {
    if (!PD || !document.getElementById(pre + '-front-make')) return;
    function maker(side) {
      var m = document.getElementById(pre + '-' + side + '-make').value, c = document.getElementById(pre + '-' + side + '-comp').value;
      var line = PD.makerLine(PD.info(m, c)), el = document.getElementById(pre + '-' + side + '-maker');
      if (el) el.textContent = line ? "Maker's figures: " + line : '';
    }
    ['front', 'rear'].forEach(function (side) {
      var mk = document.getElementById(pre + '-' + side + '-make'), cp = document.getElementById(pre + '-' + side + '-comp');
      mk.addEventListener('change', function () {
        var list = PD.compounds(mk.value);
        cp.innerHTML = '<option value="">' + (mk.value ? 'Choose the compound' : 'Choose the make first') + '</option>' + list.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
        // A make with one compound (the car's original pads) is picked for them.
        if (list.length === 1) cp.value = list[0];
        cp.disabled = !mk.value;
        maker(side);
      });
      cp.addEventListener('change', function () { maker(side); });
      maker(side);
    });
    var same = document.getElementById(pre + '-same');
    same.addEventListener('click', function () {
      var on = same.getAttribute('aria-checked') !== 'true';
      same.setAttribute('aria-checked', String(on));
      var rear = document.querySelector('[data-pad-side="rear"]');
      if (rear) rear.hidden = on;
    });
  }
  // Force refresh: for a page that looks out of date. Fetches the page's own scripts, styles and the track list afresh
  // (past the browser's and the network's copies), clears the stored copies of the site's service worker (never the
  // worker itself, which also carries push notifications), then loads the page again, so what the member sees is what
  // is live now.
  function refreshChip() { return '<button type="button" class="chip tp-refresh" data-refresh aria-label="Refresh this page from the latest version" title="Refresh">' + icon('refresh') + '</button>'; }
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-refresh]');
    if (!b || b.disabled) return;
    b.disabled = true;
    var label = b.querySelector('span');
    if (label) label.textContent = 'Refreshing...';
    var urls = [].slice.call(document.querySelectorAll('script[src], link[rel="stylesheet"]')).map(function (el) { return el.src || el.href; })
      .filter(function (u) { return u && u.indexOf(location.origin) === 0; });
    urls.push(new URL('data/tracks.json', location.href).href);
    var jobs = urls.map(function (u) { return fetch(u, { cache: 'reload' }).catch(function () {}); });
    try { if (window.caches && caches.keys) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }).catch(function () {})); } catch (err) {}
    try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.update(); })); }).catch(function () {})); } catch (err) {}
    Promise.all(jobs).then(function () { mine = null; library = null; copy = null; location.reload(); });
  });
  function unitsChip() { return '<button type="button" class="chip tp-units" data-units>' + (V.units.mph ? 'mph' : 'km/h') + '</button>'; }
  app.addEventListener('click', function (e) {
    if (!e.target.closest('[data-units]')) return;
    V.setMph(!V.units.mph);
    // Adding a session: redraw it in the new unit, keeping the file and
    // everything chosen or typed so far.
    if (params().get('add') && add && add.session && document.getElementById('tp-result')) {
      var ty = readTyre('tp-tyre'); if (ty) { var nt = TY.compose(ty); if (add.tyrePre && nt !== add.tyres) add.tyrePre = false; add.tyre = ty; add.tyres = nt; }
      var pd0 = readPads('tp-pad'); if (pd0) add.pads = pd0;
      var ne = document.getElementById('tp-notes'); if (ne) add.notes = ne.value.trim();
      var pe = document.getElementById('tp-public-note'); if (pe) add.publicNote = pe.value.trim();
      var te = document.getElementById('tp-temp');
      if (te) { var tv = te.value.trim() === '' ? null : parseFloat(te.value); if (tv !== add.temp) { add.temp = tv; add.tempSource = tv == null ? '' : 'member'; add.weather = null; } }
      drawAdd();
      return;
    }
    route();
  });

  // ---------- Home ----------
  function showHome() {
    loading();
    var my = routeSeq;
    return Promise.all([getMine(), getLibrary(), getCopy()]).then(function (r) {
      if (stale(my)) return;
      var m = r[0], c = r[2] || {};
      if (m && m.gate) return showGate();
      var h = '';
      if (!m) {
        var bullets = c.bullets && c.bullets.length ? c.bullets : ['Laps, sectors and corners found for you', 'Compare any two laps, corner by corner', 'See what each mod in My Garage did to your times', 'Drag runs from the strip: 60 ft, 0 to 60, quarter mile', 'Private unless you choose to share'];
        h += '<div class="card tp-intro"><h2>' + esc(c.heading || 'Your track days, mapped') + '</h2><p>' + esc(c.intro || 'Upload the file from your lap timer (RaceBox, VBOX, Harry\'s LapTimer, TrackAddict, AiM and most phone apps) and see every lap drawn on the track, where you gained and lost time, and how your times changed as you modified the car.') + '</p>' +
          '<ul class="tp-ticks">' + bullets.map(function (b) { return '<li>' + icon('check') + esc(b) + '</li>'; }).join('') + '</ul>' +
          '<div class="tp-actions"><a class="btn btn-accent" href="signin.html?next=/track.html">Sign in to add a session</a><a class="btn btn-secondary" id="tp-boards-btn" href="leaderboards.html">' + icon('trophy') + 'Leaderboards</a></div></div>';
      } else if (!m.cars.length) {
        h += addCarHtml(true);
      } else {
        // Leaderboards first, above the cars. Faded until the member has a
        // session of their own to put on a board.
        h += myCarsHtml(m);
      }
      // Sessions just saved from a batch: say so at the top.
      if (justSaved && (justSaved.batch || justSaved.text || justSaved.queued)) { h = savedHtml(justSaved) + h; justSaved = null; }
      app.innerHTML = h;
      heroAdd();
      // Offline mode: an old list is marked, and sessions saved on the device and waiting to be sent are listed.
      if (m && m.cachedAt) app.insertAdjacentHTML('afterbegin', oldNote(m.cachedAt));
      if (window.MT3UKOffline && m) window.MT3UKOffline.drawPending(app);
      // A member with no sessions yet sees What are Sessions? open, so they see what Laps does.
      var what = document.querySelector('.page-hero .tp-what');
      if (what && m && !(m.sessions || []).length) what.open = true;
      if (m && m.cars && m.cars.length) { drawNews(); drawSince(m); }
      // The front page panels the admin chose for Sessions, under the list (js/laps-panels.js).
      if (window.MT3UKLapsPanels && m) window.MT3UKLapsPanels.show(true);
      if (window.MT3UKLapsTip) window.MT3UKLapsTip.place();
      wireAddCar();
      wireCarChips(m);
      if (m && m.cars && m.cars.length) wireSessionList(m);
    }).catch(function () { failed('Track sessions could not be loaded. Check your connection and try again.'); });
  }
  var currentCar = null, vehiclesOpen = false;
  function carSessionCount(m, c) { return m.sessions.filter(function (x) { return x.carId === c.id; }).length; }
  // The heading row has the vehicle picked beside it (Change opens the list under the row, a row for each vehicle and then
  // Add a vehicle). With one vehicle the picked one is just shown, with an Add a vehicle button under it.
  function vehiclesHtml(m, car) {
    var n = carSessionCount(m, car);
    var cur = '<span class="tp-vtext"><b>' + esc(car.name) + '</b><span>' + n + ' session' + (n === 1 ? '' : 's') + '</span></span>';
    var head = '<div class="tp-vhead"><h2>Your vehicles</h2><button type="button" class="tp-car tp-vcurrent is-on" id="tp-vtoggle" aria-expanded="' + vehiclesOpen + '">' + cur + '<span class="tp-vchange">' + icon('chev') + '</span></button></div>';
    if (!vehiclesOpen) return head;
    return head + '<div class="card tp-vlist" role="radiogroup" aria-label="Your vehicles">' + m.cars.map(function (c) {
      var on = c.id === car.id, k = carSessionCount(m, c);
      return '<button type="button" class="tp-car tp-vrow' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-car="' + esc(c.id) + '"><span class="tp-vdot"></span><span class="tp-vtext"><b>' + esc(c.name) + '</b><span>' + esc([titleOf(c), c.version].filter(Boolean).join(' ') || 'Car') + '</span></span><span class="tp-vn">' + k + ' session' + (k === 1 ? '' : 's') + '</span></button>';
    }).join('') + '<button type="button" class="tp-vrow tp-vadd" id="tp-car-add-open">' + icon('plus') + 'Add a vehicle</button></div>';
  }
  // ---------- The announcement ----------
  // One line the admin writes on the Announcement panel of track-admin.html (/laps/news), at the top of the member's
  // list of sessions until they close it or follow its link; a new announcement (a new id) shows again.
  var NEWS_SEEN = 'mt3ukLapsNewsSeen';
  function drawNews() {
    api('GET', '/laps/news').then(function (d) {
      var n = d && d.news, box = document.getElementById('tp-news');
      if (!n || !n.text || !box) return;
      var seen = '';
      try { seen = localStorage.getItem(NEWS_SEEN) || ''; } catch (e) {}
      if (seen === n.id) return;
      function done() { try { localStorage.setItem(NEWS_SEEN, n.id); } catch (e) {} }
      box.innerHTML = '<p>' + icon('flag') + '<span>' + esc(n.text) + (n.link ? ' <a href="' + esc(n.link) + '"' + (/^https:/.test(n.link) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(n.linkText || 'Find out more') + '</a>' : '') + '</span></p>' +
        '<button type="button" class="tp-since-close" data-news-close aria-label="Close this announcement">' + icon('x') + '</button>';
      box.hidden = false;
      box.addEventListener('click', function (e) {
        if (e.target.closest('[data-news-close]')) { done(); box.hidden = true; }
        else if (e.target.closest('a')) done();
      });
    }).catch(function () {});
  }

  // ---------- Since you were last here ----------
  // At the top of the member's list of sessions: what has changed on the boards their cars are on since they last
  // looked (a car moved up or down, new cars on the board). Each visit reads those boards (the public /track/board,
  // /sprint/board and /drag/board, at most 12) and compares them with the last look, kept in this browser per member
  // (localStorage mt3ukLapsSince). The first visit only takes the look; the line shows when something has changed,
  // and the look is moved on when the member closes it or opens one of its boards.
  var SINCE_KEY = 'mt3ukLapsSince';
  function sinceStore() { try { return JSON.parse(localStorage.getItem(SINCE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function sinceWho() { try { return (localStorage.getItem('mt3ukMyBuildsEmail') || 'me').toLowerCase(); } catch (e) { return 'me'; } }
  function sinceSave(snap) { var all = sinceStore(); all[sinceWho()] = snap; try { localStorage.setItem(SINCE_KEY, JSON.stringify(all)); } catch (e) {} }
  function ordinal(n) { var t = n % 100, u = n % 10; return n + (t > 10 && t < 14 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'); }
  function sinceBoards(m) {
    var out = {};
    (m.sessions || []).forEach(function (x) {
      if ((x.privacy !== 'board' && x.privacy !== 'build') || !x.venueId) return;
      var type = x.type === 'drag' ? 'drag' : x.type === 'sprint' ? 'sprint' : x.type === 'track' || !x.type ? 'track' : '';
      if (!type || (type !== 'drag' && !x.layoutId)) return;
      var key = type === 'drag' ? 'drag-board:' + x.venueId : (type === 'sprint' ? 'sprint-board:' : 'track-board:') + x.venueId + ':' + x.layoutId;
      var b = out[key] || (out[key] = { key: key, type: type, venueId: x.venueId, layoutId: x.layoutId || '', cars: {}, last: '' });
      b.cars[x.carId || 'car'] = true;
      if ((x.date || '') > b.last) b.last = x.date || '';
    });
    return Object.keys(out).map(function (k) { return out[k]; }).sort(function (a, b) { return a.last < b.last ? 1 : -1; }).slice(0, 12);
  }
  function sinceLook(boards) {
    return Promise.all(boards.map(function (b) {
      var path = b.type === 'drag' ? '/drag/board?venue=' + encodeURIComponent(b.venueId) : (b.type === 'sprint' ? '/sprint/board?venue=' : '/track/board?venue=') + encodeURIComponent(b.venueId) + '&layout=' + encodeURIComponent(b.layoutId);
      return api('GET', path).then(function (d) {
        var entries = ((d && d.entries) || []).filter(function (e) { return Number(b.type === 'drag' ? e.quarter : e.time) > 0; })
          .sort(function (x, y) { return Number(b.type === 'drag' ? x.quarter : x.time) - Number(b.type === 'drag' ? y.quarter : y.time); });
        var pos = {};
        entries.forEach(function (e, i) { if (b.cars[e.carId]) pos[e.carId] = i + 1; });
        return { key: b.key, n: entries.length, pos: pos };
      }).catch(function () { return null; });
    })).then(function (rows) {
      var snap = {};
      rows.forEach(function (r) { if (r) snap[r.key] = { n: r.n, pos: r.pos }; });
      return snap;
    });
  }
  function sinceWhere(b) {
    var v = library && (library.venues || []).filter(function (x) { return x.id === b.venueId; })[0];
    var l = v && (v.layouts || []).filter(function (x) { return x.id === b.layoutId; })[0];
    return v ? v.name + (b.type !== 'drag' && l && l.name && l.name !== v.name ? ', ' + l.name : '') : b.venueId;
  }
  function sinceChanges(m, boards, was, now) {
    var out = [];
    boards.forEach(function (b) {
      var a = was[b.key], z = now[b.key];
      if (!a || !z) return;
      var href = 'leaderboards.html?' + (b.type === 'drag' ? 'drag=' + encodeURIComponent(b.venueId) : (b.type === 'sprint' ? 'sprint=' : 'board=') + encodeURIComponent(b.venueId + ':' + b.layoutId));
      var where = sinceWhere(b), said = false;
      Object.keys(z.pos).forEach(function (carId) {
        var from = (a.pos || {})[carId], to = z.pos[carId];
        if (!from || from === to) return;
        var car = (m.cars.filter(function (c) { return c.id === carId; })[0] || {}).name || 'Your car';
        out.push({ down: to > from, href: href, text: car + (to > from ? ' dropped to ' : ' moved up to ') + ordinal(to) + ' at ' + where });
        said = true;
      });
      var more = z.n - (a.n || 0);
      if (more > 0 && !said) out.push({ href: href, text: more + ' new car' + (more === 1 ? '' : 's') + ' on the board at ' + where });
    });
    // Drops first: they are the ones a member wants to know about.
    return out.sort(function (x, y) { return (y.down ? 1 : 0) - (x.down ? 1 : 0); });
  }
  function drawSince(m) {
    var box = document.getElementById('tp-since');
    var boards = sinceBoards(m);
    if (!box || !boards.length) return;
    var was = sinceStore()[sinceWho()];
    Promise.all([sinceLook(boards), getLibrary().catch(function () { return null; })]).then(function (r) {
      var now = r[0];
      if (!Object.keys(now).length) return;
      if (!was) { sinceSave(now); return; }
      var list = sinceChanges(m, boards, was, now);
      if (!list.length) { sinceSave(now); return; }
      box = document.getElementById('tp-since');
      if (!box) return;
      var shown = list.slice(0, 4);
      box.innerHTML = '<div class="tp-since-head"><b>' + icon('flag') + 'Since you were last here</b><button type="button" class="tp-since-close" data-since-close aria-label="Close, I have seen these">' + icon('x') + '</button></div>' +
        '<ul>' + shown.map(function (x) { return '<li class="' + (x.down ? 'is-down' : 'is-up') + '"><a href="' + esc(x.href) + '" data-laps>' + esc(x.text) + '</a></li>'; }).join('') + '</ul>' +
        (list.length > shown.length ? '<p class="tp-small">And ' + (list.length - shown.length) + ' more on the Leaderboard.</p>' : '');
      box.hidden = false;
      if (window.mt3ukLapsLinks) window.mt3ukLapsLinks();
      box.addEventListener('click', function (e) {
        if (e.target.closest('[data-since-close]')) { sinceSave(now); box.hidden = true; }
        else if (e.target.closest('a')) sinceSave(now);
      });
    });
  }
  // After saving several files the list opens to them under the Saved message: their car is the one picked, and their
  // track, layout and day are dropped down, so the sessions added are in view rather than a closed tree.
  // After the list redraws (a bulk edit), the day that was changed is scrolled to the middle of the screen and flashed.
  var pendingDay = null, pendingTimer = null;
  function focusDay(key) {
    pendingDay = key; clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { pendingDay = null; }, 15000);
  }
  // Leaving a session (Exit session, Back) lands on the list at the row it came from, not at the top: the last session shown is
  // looked for once the list is drawn.
  var lastSession = null;
  function showLastSession() {
    if (!lastSession || document.getElementById('tp-session-bar')) return;
    var row = [].filter.call(app.querySelectorAll('.tp-row[data-sid]'), function (x) { return x.getAttribute('data-sid') === lastSession && x.offsetParent !== null; })[0];
    if (!row) return;
    lastSession = null;
    row.scrollIntoView({ block: 'center' });
    row.classList.add('is-flash');
    setTimeout(function () { row.classList.remove('is-flash'); }, 1600);
  }
  function showPendingDay() {
    showLastSession();
    if (!pendingDay) return;
    var el = [].filter.call(app.querySelectorAll('.tp-daygroup[data-day]'), function (x) { return x.getAttribute('data-day') === pendingDay; })[0];
    if (!el) return;
    pendingDay = null; clearTimeout(pendingTimer);
    el.scrollIntoView({ block: 'center' });
    el.classList.add('is-flash');
    setTimeout(function () { el.classList.remove('is-flash'); }, 2200);
  }
  if (window.MutationObserver) new MutationObserver(showPendingDay).observe(app, { childList: true, subtree: true });
  function openToSaved(m) {
    var ids = justSaved && justSaved.ids;
    if (!ids || !ids.length) return;
    var saved = m.sessions.filter(function (x) { return ids.indexOf(x.id) !== -1; });
    saved.forEach(function (x) {
      if (x.carId) currentCar = x.carId;
      var tk = trackKeyOf(x);
      openTracks[tk] = true;
      openLayouts[tk + '|' + layoutKeyOf(x)] = true;
      if (dayKey(x)) { openDays[dayKey(x)] = true; }
    });
    if (saved.length) storeListOpen();
  }
  function myCarsHtml(m) {
    openToSaved(m);
    try { currentCar = currentCar || params().get('mycar') || localStorage.getItem('mt3ukTrackCar'); } catch (e) {}
    if (!m.cars.some(function (c) { return c.id === currentCar; })) currentCar = m.cars[0].id;
    var car = m.cars.filter(function (c) { return c.id === currentCar; })[0];
    var list = m.sessions.filter(function (s) { return s.carId === car.id; });
    // Your vehicles: a list that folds away to the one picked. Its sessions are listed below.
    var h = '<div class="card tp-news" id="tp-news" role="status" hidden></div><div class="card tp-since" id="tp-since" role="status" hidden></div>' + '<div class="tp-section tp-vehicles"><div class="tp-vbox" id="tp-cars">' + vehiclesHtml(m, car) + '</div>' +
      '<div id="tp-car-add-wrap" hidden>' + addCarHtml(false) + '</div></div>';
    // One tight row: the title and the car at the left, search, refresh, units and What others see (an eye) at the right.
    var othersChip = car.virtual ? '' : '<a class="chip tp-others" href="track.html?car=' + encodeURIComponent(car.id) + '" data-go="car=' + esc(encodeURIComponent(car.id)) + '" aria-label="What others see" title="What others see">' + icon('eye') + '</a>';
    h += '<div class="tp-section"><div class="tp-head tp-list-head"><div class="tp-head-title"><h2>Sessions</h2></div><div class="tp-head-side">' + findToggleHtml(m) + refreshChip() + unitsChip() + othersChip + '</div></div>';
    // Add a session is in the page heading, under Leaderboards (heroAdd).
    heroAddCar = car.id;
    h += findPanelHtml(m);
    h += '<div id="tp-tracks">';
    if (!list.length) h += '<div class="card tp-empty">' + icon('flag') + '<p>No sessions for ' + esc(car.name) + ' yet. Add the file from your lap timer to get started.</p></div>';
    else h += trackToolsHtml(list) + '<div class="tp-list tp-tracklist" id="tp-sess-list">' + trackListHtml(list, car.id) + '</div>';
    h += '</div><div id="tp-find-results"></div>';
    return h + '</div>';
  }
  // The main screen is one line for each track, newest driven first (or A to Z, or most sessions). A line opens its own page
  // with every session there (showTrackSessions), so a track is quick to find and the list stays short.
  var sortMode = 'newest';
  var SORTS = [['newest', 'Recently driven'], ['az', 'A to Z'], ['most', 'Most sessions']];
  function whenOf(s) { return (s.date || '') + (s.time || ''); }
  function trackTitleOf(s) { return s.venue || (s.type === 'sprint' ? (s.hill ? 'Hill climb' : 'Sprint') : s.type === 'drag' ? 'Drag run' : 'Track session'); }
  function trackKeyOf(s) { return s.venueId ? 'v:' + s.venueId : 'n:' + trackTitleOf(s).toLowerCase(); }
  function trackEntries(list) {
    var by = {}, out = [];
    list.forEach(function (x) {
      var k = trackKeyOf(x);
      if (!by[k]) { by[k] = { key: k, name: trackTitleOf(x), n: 0, last: '' }; out.push(by[k]); }
      by[k].n++;
      if (whenOf(x) > by[k].last) by[k].last = whenOf(x);
    });
    return out.sort(function (a, b) {
      if (sortMode === 'az') return a.name.localeCompare(b.name);
      if (sortMode === 'most' && a.n !== b.n) return b.n - a.n;
      return a.last === b.last ? a.name.localeCompare(b.name) : a.last < b.last ? 1 : -1;
    });
  }
  // Find: words match the track, layout, date (typed any way: 21 Jul, 21/07/2026, July 2026, 2026-07-21), conditions, tyres
  // and kind of session, and two dates give a range. With either, the list shows the matching sessions themselves.
  var findText = '', findFrom = '', findTo = '', findDates = false, findOpen = false, carNames = {};
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function findActive() { return !!(findText.trim() || findFrom || findTo); }
  function sessionHaystack(x) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x.date || ''), d = [];
    if (m) {
      var day = +m[3], mon = +m[2], mname = MONTHS[mon - 1] || '';
      d = [x.date, niceDate(x.date), day + ' ' + mname + ' ' + m[1], mname, mname.slice(0, 3), m[1], m[3] + '/' + m[2] + '/' + m[1], day + '/' + mon + '/' + m[1], m[3] + '/' + m[2], day + '/' + mon];
    }
    return [trackName(x), x.venue, x.layout, x.conditions, x.tyres, x.time, carNames[x.carId] || '', x.type === 'sprint' ? (x.hill ? 'hill climb hillclimb' : 'sprint') : x.type === 'drag' ? 'drag' : x.type === 'other' ? 'drive' : 'track day'].concat(d).join(' | ').toLowerCase();
  }
  function matchesFind(x) {
    var from = findFrom, to = findTo;
    if (from && to && from > to) { var t = from; from = to; to = t; }
    if (from && (x.date || '') < from) return false;
    if (to && (x.date || '') > to) return false;
    var words = findText.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (!words.length) return true;
    var hay = sessionHaystack(x);
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }
  var FIND_MAX = 60;
  function findResultsHtml(list, manyCars) {
    var rows = list.filter(matchesFind).sort(function (a, b) { return whenOf(a) < whenOf(b) ? 1 : whenOf(a) > whenOf(b) ? -1 : 0; });
    if (!rows.length) return '<div class="card tp-empty">' + icon('flag') + '<p>No sessions match. Try fewer words, or a wider range of dates.</p></div>';
    return '<p class="tp-small tp-find-count" role="status">' + rows.length + ' session' + (rows.length === 1 ? '' : 's') + ' found' + (rows.length > FIND_MAX ? ', showing the newest ' + FIND_MAX + '. Narrow the search to see the rest' : '') + '</p>' +
      '<div class="tp-list">' + rows.slice(0, FIND_MAX).map(function (x) { return sessionRow(x, manyCars ? carNames[x.carId] : ''); }).join('') + '</div>';
  }
  // A magnifier in the Sessions row opens the search. It looks through every vehicle at once, and while it is used its
  // results take the place of the track lines only: the vehicles and the Sessions buttons stay where they are.
  function findToggleHtml(m) {
    if (!m || !m.cars || !m.cars.length || m.sessions.length < 2) return '';
    return '<button type="button" class="chip tp-find-toggle' + (findOpen || findActive() ? ' is-on' : '') + '" id="tp-find-toggle" aria-label="Search your sessions" aria-expanded="' + !!(findOpen || findActive()) + '">' + icon('search') + '</button>';
  }
  function findPanelHtml(m) {
    if (!m || !m.cars || !m.cars.length || m.sessions.length < 2) return '';
    var open = findOpen || findActive(), on = !!(findDates || findFrom || findTo);
    return '<div class="tp-findpanel" id="tp-find-panel"' + (open ? '' : ' hidden') + '><div class="tp-find"><div class="tp-field tp-find-text"><input class="field" id="tp-find" type="search" autocomplete="off" aria-label="Find a track, session or date" placeholder="Search all vehicles: track, date, wet..." value="' + esc(findText) + '"></div>' +
      '<button type="button" class="chip tp-find-cal' + (on ? ' is-on' : '') + '" id="tp-find-dates" aria-label="Between dates" aria-expanded="' + on + '">' + icon('calendar') + '</button></div>' +
      '<div class="tp-find-range" id="tp-find-range"' + (on ? '' : ' hidden') + '><div class="tp-field"><label for="tp-find-from">From</label><input class="field" type="date" id="tp-find-from" value="' + esc(findFrom) + '"></div>' +
      '<div class="tp-field"><label for="tp-find-to">To</label><input class="field" type="date" id="tp-find-to" value="' + esc(findTo) + '"></div></div>' +
      '<div class="tp-find-bar"><span class="tp-small tp-find-hint">Searches all your vehicles</span><button type="button" class="btn btn-ghost btn-sm" id="tp-find-clear"' + (findActive() ? '' : ' hidden') + '>Clear</button></div></div>';
  }
  // The sort for the track lines of the vehicle picked.
  // Filters by logger, tyres and pads (listFilters), kept while the page lives. A filter's drop-down lists every value
  // the member's sessions carry, with how many; while any filter is on the tracks and layouts are drawn open (filterOpenAll) down to the days
  // so the matching sessions are in view, with a line saying how many of the sessions match and a Clear chip.
  var FILTERS = [['logger', 'Logger', 'All loggers'], ['tyres', 'Tyres', 'All tyres'], ['pads', 'Pads', 'All pads']];
  var listFilters = { logger: '', tyres: '', pads: '' }, filterOpenAll = false;
  function filtersOn() { return FILTERS.some(function (f) { return !!listFilters[f[0]]; }); }
  var NOT_SET = '__none';
  function filteredList(list) {
    return list.filter(function (x) { return FILTERS.every(function (f) { var want = listFilters[f[0]], v = x[f[0]] || ''; return !want || (want === NOT_SET ? !v : v === want); }); });
  }
  function filterSelectHtml(f, list) {
    var counts = {}, none = 0;
    list.forEach(function (x) { var v = x[f[0]] || ''; if (v) counts[v] = (counts[v] || 0) + 1; else none++; });
    var vals = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); });
    if (listFilters[f[0]] && listFilters[f[0]] !== NOT_SET && vals.indexOf(listFilters[f[0]]) === -1) vals.push(listFilters[f[0]]);
    // Always shown, so a logger, tyre or pad is never hard to find: sessions without one are a choice of their own.
    return '<div class="tp-field tp-filter"><label for="tp-filter-' + f[0] + '">' + f[1] + '</label><select class="field" id="tp-filter-' + f[0] + '" data-filter="' + f[0] + '"><option value="">' + f[2] + '</option>' +
      vals.map(function (v) { return '<option value="' + esc(v) + '"' + (v === listFilters[f[0]] ? ' selected' : '') + '>' + esc(v) + (counts[v] ? ' (' + counts[v] + ')' : '') + '</option>'; }).join('') +
      (none ? '<option value="' + NOT_SET + '"' + (listFilters[f[0]] === NOT_SET ? ' selected' : '') + '>Not set (' + none + ')</option>' : '') + '</select></div>';
  }
  function filterNoteHtml(list) {
    if (!filtersOn()) return '';
    var n = filteredList(list).length;
    return '<p class="tp-small tp-filter-note" id="tp-filter-note">' + (n ? 'Showing ' + n + ' of ' + list.length + ' sessions' : 'No sessions match') + ' <button type="button" class="chip" id="tp-filter-clear">Clear</button></p>';
  }
  function trackToolsHtml(list) {
    var filters = list.length ? FILTERS.map(function (f) { return filterSelectHtml(f, list); }).join('') : '';
    if (trackEntries(list).length < 2 && !filters) return '';
    return '<div class="tp-tools">' + (trackEntries(list).length > 1 ? '<div class="tp-field tp-sort"><label for="tp-sort">Sort by</label><select class="field" id="tp-sort">' +
      SORTS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sortMode ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' : '') +
      (filters ? '<div class="tp-filters">' + filters + '</div>' : '') + '</div>' + filterNoteHtml(list);
  }
  // The layouts and events at one track: each layout (or a sprint's organiser, or the kind of session when there is
  // neither) once, with its count and last day. The track line's chevron drops them down (openTracks keeps them open
  // through a redraw), and a layout line opens the track's page showing only the sessions on that layout.
  var KIND_WORD = { drag: 'Drag runs', sprint: 'Sprint', other: 'Drives', track: 'Track days' };
  function layoutTitleOf(s) {
    if (s.layout && s.layout !== s.venue) return s.layout;
    if (s.organizer) return s.organizer;
    return s.type === 'sprint' && s.hill ? 'Hill climb' : KIND_WORD[s.type] || KIND_WORD.track;
  }
  function layoutKeyOf(s) { return s.layoutId ? 'l:' + s.layoutId : 'n:' + layoutTitleOf(s).toLowerCase(); }
  function layoutEntries(list) {
    var by = {}, out = [];
    list.forEach(function (x) {
      var k = layoutKeyOf(x);
      if (!by[k]) { by[k] = { key: k, name: layoutTitleOf(x), n: 0, last: '' }; out.push(by[k]); }
      by[k].n++;
      if (whenOf(x) > by[k].last) by[k].last = whenOf(x);
    });
    return out.sort(function (a, b) { return a.last === b.last ? a.name.localeCompare(b.name) : a.last < b.last ? 1 : -1; });
  }
  // The list is a tree: a track's chevron drops down its layouts, and a layout's row drops down its sessions (the same
  // day groups as the track's page), so every session is reached without leaving the list. What is open is kept for
  // the browser session (sessionStorage mt3ukLapsListOpen), so coming back from a session finds the list as it was.
  // What is open is kept in memory while the page lives, so Back from a session (by any route) finds the list as it
  // was left; a full refresh of the page starts it folded. The sessions just saved are opened (openToSaved).
  var openTracks = {}, openLayouts = {};
  function storeListOpen() {}
  // publicView: the read-only list others see (no Shared switches, nothing to edit).
  function trackListHtml(list, carId, publicView) {
    filterOpenAll = filtersOn();
    list = filteredList(list);
    if (!list.length) return '<div class="card tp-empty">' + icon('flag') + '<p>No sessions match those filters.</p></div>';
    return trackEntries(list).map(function (t) {
            var lastDay = niceDate(t.last.slice(0, 10)), open = filterOpenAll || !!openTracks[t.key];
      var here = list.filter(function (x) { return trackKeyOf(x) === t.key; }), lays = layoutEntries(here);
      return '<div class="tp-trackwrap" data-track="' + esc(t.key) + '"><button type="button" class="tp-row tp-trackrow" data-track-toggle="' + esc(t.key) + '" aria-expanded="' + open + '" aria-label="' + (open ? 'Hide' : 'Show') + ' the layouts at ' + esc(t.name) + '"><span class="tp-row-main"><b>' + esc(t.name) + '</b><span>' + t.n + ' session' + (t.n === 1 ? '' : 's') + ', last ' + esc(lastDay) + '</span></span>' + icon('chev') + '</button>' +
        '<div class="tp-layouts"' + (open ? '' : ' hidden') + '>' + lays.map(function (l) {
          var lk = t.key + '|' + l.key, lopen = filterOpenAll || !!openLayouts[lk];
          var rows = here.filter(function (x) { return layoutKeyOf(x) === l.key; }).sort(function (x, y) { return whenOf(x) < whenOf(y) ? 1 : whenOf(x) > whenOf(y) ? -1 : 0; });
          return '<div class="tp-layoutwrap"><button type="button" class="tp-row tp-layoutrow" data-layout-toggle="' + esc(lk) + '" aria-expanded="' + lopen + '"><span class="tp-row-main"><b>' + esc(l.name) + '</b><span>' + l.n + ' session' + (l.n === 1 ? '' : 's') + ', last ' + esc(niceDate(l.last.slice(0, 10))) + '</span></span>' + icon('chev') + '</button>' +
            '<div class="tp-layout-sessions"' + (lopen ? '' : ' hidden') + '>' + sessionListHtml(rows, !publicView, list, true) + '</div></div>';
        }).join('') + '</div></div>';
    }).join('');
  }
  function wireTrackToggles() {
    var box = document.getElementById('tp-sess-list');
    if (!box || box.getAttribute('data-toggles')) return;
    box.setAttribute('data-toggles', '1');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-track-toggle]'), lb = e.target.closest('[data-layout-toggle]');
      if (b) {
        var k = b.getAttribute('data-track-toggle'), wrap = b.closest('.tp-trackwrap'), lays = wrap && wrap.querySelector('.tp-layouts');
        openTracks[k] = !openTracks[k];
        b.setAttribute('aria-expanded', openTracks[k] ? 'true' : 'false');
        b.setAttribute('aria-label', b.getAttribute('aria-label').replace(openTracks[k] ? 'Show' : 'Hide', openTracks[k] ? 'Hide' : 'Show'));
        if (lays) lays.hidden = !openTracks[k];
      } else if (lb) {
        var lk = lb.getAttribute('data-layout-toggle'), lw = lb.closest('.tp-layoutwrap'), sess = lw && lw.querySelector('.tp-layout-sessions');
        openLayouts[lk] = !openLayouts[lk];
        lb.setAttribute('aria-expanded', openLayouts[lk] ? 'true' : 'false');
        if (sess) sess.hidden = !openLayouts[lk];
      } else return;
      storeListOpen();
    });
  }
  // Where the car sits on the leaderboard: a trophy on the session that holds
  // its place. 1st is Platinum, 2nd Gold, 3rd Silver, then 4th, 5th and so on.
  var TIERS = { 1: 'Platinum', 2: 'Gold', 3: 'Silver' };
  function ordinal(n) {
    var t = n % 100, u = n % 10;
    return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
  }
  function rankBadge(r, name) {
    return '<em class="tp-rank tp-rank-' + (r.rank <= 3 ? r.rank : 'n') + '" title="' + esc(ordinal(r.rank) + ' of ' + r.of + ' on the ' + name + ' leaderboard') + '">' + icon('trophy') + (TIERS[r.rank] ? TIERS[r.rank] + ' ' : '') + ordinal(r.rank) + '</em>';
  }
  function boardPathOf(s) {
    if (s.street || s.privacy === 'private' || !s.venueId) return '';
    if (s.type === 'drag') return s.atVenue ? '/drag/board?venue=' + encodeURIComponent(s.venueId) : '';
    if (s.type === 'other' || !s.layoutId) return '';
    return (s.type === 'sprint' ? '/sprint/board?venue=' : '/track/board?venue=') + encodeURIComponent(s.venueId) + '&layout=' + encodeURIComponent(s.layoutId);
  }
  // { sessionId: { rank, of } } for the sessions that hold the car's place.
  function loadRanks(carId, list) {
    var paths = {};
    list.forEach(function (x) { var pth = boardPathOf(x); if (pth) paths[pth] = 1; });
    var out = {};
    return Promise.all(Object.keys(paths).map(function (pth) {
      return api('GET', pth).then(function (d) {
        var e = (d && d.entries) || [], i = -1;
        e.forEach(function (x, k) { if (i < 0 && x.carId === carId) i = k; });
        if (i >= 0) out[e[i].sessionId] = { rank: i + 1, of: e.length };
      }).catch(function () {});
    })).then(function () { return out; });
  }
  var ranks = {}, ranksFor = '';
  function applyRanks(list) {
    var rows = document.querySelectorAll('#tp-sess-list .tp-row[data-sid]');
    Array.prototype.forEach.call(rows, function (row) {
      var r = ranks[row.getAttribute('data-sid')];
      if (!r || row.querySelector('.tp-rank')) return;
      var sess = list.filter(function (x) { return x.id === row.getAttribute('data-sid'); })[0];
      row.querySelector('.tp-row-main').insertAdjacentHTML('beforeend', rankBadge(r, sess ? trackName(sess) : 'track'));
    });
  }
  function wireSessionList(m) {
    var car = m.cars.filter(function (c) { return c.id === currentCar; })[0];
    if (!car) return;
    var list = m.sessions.filter(function (x) { return x.carId === car.id; });
    carNames = {};
    m.cars.forEach(function (c) { carNames[c.id] = c.name; });
    function redrawList() {
      var tracks = document.getElementById('tp-tracks');
      if (tracks) tracks.innerHTML = trackToolsHtml(list) + '<div class="tp-list tp-tracklist" id="tp-sess-list">' + trackListHtml(list, car.id) + '</div>';
      applyRanks(list);
      wireTrackToggles();
      wireTools();
    }
    function wireTools() {
      var sortSel = document.getElementById('tp-sort');
      if (sortSel) sortSel.addEventListener('change', function () { sortMode = sortSel.value; redrawList(); });
      [].forEach.call(document.querySelectorAll('#tp-tracks [data-filter]'), function (sel) {
        sel.addEventListener('change', function () { listFilters[sel.getAttribute('data-filter')] = sel.value; redrawList(); });
      });
      var clear = document.getElementById('tp-filter-clear');
      if (clear) clear.addEventListener('click', function () { FILTERS.forEach(function (f) { listFilters[f[0]] = ''; }); redrawList(); });
    }
    wireTools();
    wireTrackToggles();
    // The trophies on the sessions listed under the layouts, as on a track's page.
    if (ranksFor !== car.id) { ranks = {}; ranksFor = car.id; }
    applyRanks(list);
    loadRanks(car.id, list).then(function (rk) { if (ranksFor !== car.id || currentCar !== car.id) return; ranks = rk; applyRanks(list); });
    // Find: the magnifier opens the search; while it is used the results sit in place of the track lines.
    var box = document.getElementById('tp-find'), from = document.getElementById('tp-find-from'), to = document.getElementById('tp-find-to'), range = document.getElementById('tp-find-range'), datesBtn = document.getElementById('tp-find-dates');
    var toggle = document.getElementById('tp-find-toggle'), panel = document.getElementById('tp-find-panel');
    function redraw() {
      var res = document.getElementById('tp-find-results'), tracks = document.getElementById('tp-tracks'), clear = document.getElementById('tp-find-clear');
      if (res) res.innerHTML = findActive() ? findResultsHtml(m.sessions, m.cars.length > 1) : '';
      if (tracks) tracks.hidden = findActive();
      if (clear) clear.hidden = !findActive();
      if (toggle) toggle.classList.toggle('is-on', findOpen || findActive());
    }
    if (toggle) toggle.addEventListener('click', function () {
      findOpen = panel.hidden;
      panel.hidden = !findOpen;
      toggle.setAttribute('aria-expanded', findOpen ? 'true' : 'false');
      if (!findOpen && !findActive()) { /* closed with nothing in it */ }
      if (findOpen && box) box.focus();
      redraw();
    });
    if (box) box.addEventListener('input', function () { findText = box.value; redraw(); });
    if (from) from.addEventListener('change', function () { findFrom = from.value; redraw(); });
    if (to) to.addEventListener('change', function () { findTo = to.value; redraw(); });
    if (datesBtn) datesBtn.addEventListener('click', function () {
      var open = range.hidden;
      range.hidden = !open; findDates = open;
      datesBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      datesBtn.classList.toggle('is-on', open || !!(findFrom || findTo));
      if (open && from) from.focus();
    });
    var clearBtn = document.getElementById('tp-find-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      findText = findFrom = findTo = ''; findDates = false;
      if (box) box.value = ''; if (from) from.value = ''; if (to) to.value = '';
      if (range) range.hidden = true;
      if (datesBtn) { datesBtn.classList.remove('is-on'); datesBtn.setAttribute('aria-expanded', 'false'); }
      redraw();
      if (box) box.focus();
    });
    if (findActive()) redraw();
  }
  // One track's page: every session there for the car, a day at a time, newest first. The trophies show here.
  function showTrackSessions(carId, key, lay) {
    loading();
    var my = routeSeq;
    Promise.all([getMine(), getLibrary()]).then(function (r) {
      if (stale(my)) return;
      var m = r[0];
      if (!m) { location.href = signInUrl('/track.html'); return; }
      if (m.gate) return showGate();
      var car = m.cars.filter(function (c) { return c.id === carId; })[0];
      if (!car) return showHome();
      currentCar = car.id;
      var all = m.sessions.filter(function (x) { return x.carId === car.id; });
      var rows = all.filter(function (x) { return trackKeyOf(x) === key && (!lay || layoutKeyOf(x) === lay); }).sort(function (x, y) { return whenOf(x) < whenOf(y) ? 1 : whenOf(x) > whenOf(y) ? -1 : 0; });
      if (!rows.length) return showHome();
      var saved = justSaved && (justSaved.batch || justSaved.text) ? savedHtml(justSaved) : '';
      justSaved = null;
      // One layout picked from the track's drop-down: the heading names it, and the page shows only those sessions.
      var title = trackTitleOf(rows[0]) + (lay ? ', ' + layoutTitleOf(rows[0]) : '');
      app.innerHTML = saved + back('Track sessions', 'mycar=' + encodeURIComponent(car.id)) + '<div class="tp-head"><div><h2>' + esc(title) + '</h2><p class="tp-sub tp-for">' + esc(car.name) + ', ' + rows.length + ' session' + (rows.length === 1 ? '' : 's') + '</p></div>' + unitsChip() + '</div>' +
        '<div class="tp-list" id="tp-sess-list">' + sessionListHtml(rows, true, all) + '</div>';
      if (ranksFor !== car.id) { ranks = {}; ranksFor = car.id; }
      applyRanks(rows);
      loadRanks(car.id, rows).then(function (rk) {
        if (ranksFor !== car.id || currentCar !== car.id) return;
        ranks = rk;
        applyRanks(rows);
      });
    }).catch(function () { failed('Your sessions could not be loaded. Check your connection and try again.'); });
  }
  function sessionRow(s, carName) {
    return '<a class="tp-row" title="Open to view" href="track.html?s=' + esc(s.id) + '" data-sid="' + esc(s.id) + '" data-go="s=' + esc(s.id) + '"><span class="tp-row-main"><b>' + esc(trackName(s)) + '</b><span>' + esc(niceDate(s.date)) + (s.conditions ? ', ' + esc(s.conditions) : '') + (TYPE_WORD[s.type] ? ', ' + TYPE_WORD[s.type] : '') + (s.tyres ? ', ' + esc(s.tyres) : '') + (s.pads ? ', ' + esc(s.pads) : '') + '</span>' + (carName ? '<span class="tp-row-car">' + esc(carName) + '</span>' : '') + '</span>' +
      '<span class="tp-row-res">' + esc(sessionResult(s)) + '</span>' + (s.privacy !== undefined ? privacyPill(s.privacy, s.street) : '') + icon('chev') + '</a>';
  }
  // Sessions at the same track on the same day are grouped, in time of day order, and numbered by it:
  // #1 is the earliest. Street runs and drives that are not timed on a track stay on their own.
  function dayKey(s) {
    if (s.type === 'other' || s.street || !s.date) return '';
    return [s.type === 'sprint' ? 'sprint' : s.type === 'drag' ? 'drag' : 'circuit', s.venueId || s.venue || '', s.layoutId || '', s.organizer || '', s.date].join('|');
  }
  function byTime(a, b) { return (a.time || '').localeCompare(b.time || '') || (a.id < b.id ? -1 : 1); }
  // Where a session falls in its day at its track, from the sessions we know of: { n: 2, of: 5 }, or null on its own.
  function dayPlace(s, all) {
    var k = dayKey(s);
    if (!k) return null;
    var day = (all || []).filter(function (x) { return x.id === s.id || dayKey(x) === k; }).sort(byTime);
    if (day.length < 2 || day.every(function (x) { return x.id !== s.id; })) return null;
    return { n: day.map(function (x) { return x.id; }).indexOf(s.id) + 1, of: day.length };
  }
  // A session's row in its day: the time, what it was, the result and whether it is shared, on one line. The fastest
  // row of a closed day (expand) is a link plus a chevron button that opens the whole day.
  function dayRow(s, n, fastest, expand, tile) {
    var inner = '<span class="tp-daygroup-no">#' + n + '</span><span class="tp-row-main"><b>' + (s.time ? esc(s.time) : 'Time not known') + '</b><span>' +
      esc([s.type === 'drag' ? (s.runs || 0) + ' run' + (s.runs === 1 ? '' : 's') : (s.laps || 0) + (s.type === 'sprint' ? ' run' : ' lap') + (s.laps === 1 ? '' : 's'), s.conditions, s.tyres, s.pads].filter(Boolean).join(', ')) + (fastest ? ' <b class="tp-fastest">Fastest</b>' : '') + '</span></span>' +
      '<span class="tp-row-res">' + esc(sessionResult(s)) + '</span>' + (s.privacy !== undefined ? privacyPill(s.privacy, s.street) : '');
    if (expand) return '<div class="tp-row tp-dayfast" data-sid="' + esc(s.id) + '"><a class="tp-row-link" title="Open to view" href="track.html?s=' + esc(s.id) + '" data-go="s=' + esc(s.id) + '">' + inner + '</a>' +
      '<button type="button" class="tp-day-expand" data-day-toggle aria-expanded="false" aria-label="Show all ' + expand + ' sessions of this day">' + icon('chev') + '</button></div>';
    return '<a class="tp-row tp-pickable' + (pickedIds[s.id] ? ' is-picked' : '') + '" draggable="false" title="Open to view" href="track.html?s=' + esc(s.id) + '" data-sid="' + esc(s.id) + '" data-go="s=' + esc(s.id) + '">' + inner + icon('chev') + '</a>';
  }
  // Sessions picked by holding on them (or Ctrl/Cmd/Shift-click): the day's bulk edit then changes only those.
  var pickedIds = {};
  // The list as rows, with a day at one track in a card of its own when it has two or more sessions.
  var openDays = {};
  // The battery used in one session, in points of charge (Track Mode files carry it).
  function chargeUsed(x) { return x.soc && x.soc.length === 2 ? Math.max(0, x.soc[0] - x.soc[1]) : null; }
  // A day's charge: on track, and on drives that day between the runs, from the sessions that have it.
  // The same file saved twice counts once (same day, time and battery start and end).
  function dayCharge(g, drives) {
    function once(a) {
      var seen = {};
      return a.filter(function (x) { var k = [x.date, x.time, x.soc && x.soc.join('-')].join('|'); if (seen[k]) return false; seen[k] = 1; return true; });
    }
    var on = once(g.filter(function (x) { return chargeUsed(x) !== null; })), between = once((drives || []).filter(function (x) { return chargeUsed(x) !== null; }));
    if (!on.length) return '';
    function sum(a) { return Math.round(a.reduce(function (t, x) { return t + chargeUsed(x); }, 0)); }
    var txt = 'Charge used ' + sum(on) + '% on track' + (between.length ? ', ' + sum(between) + '% between runs' : '');
    return txt + (on.length < g.length ? ' (from ' + on.length + ' of ' + g.length + ' sessions)' : '');
  }
  // The heading and the count of a group. With more than one session they open and close it; a group of one is just shown.
  function groupTitleHtml(text, label, open, many, sub) {
    // In the Sessions tree a closed day is one compact row: the date, how many sessions and the fastest, and a chevron to step down.
    return many ? '<button type="button" class="tp-daygroup-title" data-day-toggle aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="' + esc(label) + '"><span class="tp-day-titles"><h3>' + esc(text) + '</h3>' + (sub ? '<span class="tp-day-sub">' + esc(sub) + '</span>' : '') + '</span>'+ '</button>'
      : '<div class="tp-daygroup-title"><h3>' + esc(text) + '</h3></div>';
  }
  function groupCountHtml(count, n, open, many) {
    return many ? '' : '<span class="tp-daygroup-count"><span class="tp-small">' + count + '</span></span>';
  }
  // Whether a day is shared, as a small eye or lock on its collapsed tile: all shared, none, or a mix.
  function dayPrivacyHtml(g) {
    var n = g.filter(function (x) { return x.privacy && x.privacy !== 'private'; }).length;
    var word = n === g.length ? 'Shared' : n ? 'Some sessions shared' : 'Only me';
    // A mix says how many are on each side, so a session left private is easy to spot.
    var mixed = n && n < g.length, counts = mixed ? 'Shared (' + n + '), Private (' + (g.length - n) + ')' : '';
    return '<span class="tp-day-priv' + (mixed ? ' is-mixed' : '') + '" role="img" title="' + (counts || word) + '" aria-label="' + (counts || word) + '">' + icon(n ? 'eye' : 'lock') + (mixed ? '<span class="tp-day-priv-n">Shared (' + n + ') Private (' + (g.length - n) + ')</span>' : '') + '</span>';
  }
  // tile: the Sessions tree, where every date is one compact tile (the date, how many sessions and the fastest, an arrow) until its arrow is pressed.
  function sessionListHtml(list, owner, all, tile) {
    var groups = {}, order = [];
    list.forEach(function (s) {
      var k = dayKey(s) || 'one:' + s.id;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(s);
    });
    // A drive between runs belongs to the first day group on its date: it is counted in that group's charge and
    // kept inside it, not listed on its own.
    var driveOwner = {};
    order.forEach(function (k) { var g0 = groups[k]; if (g0.length > 1 && !driveOwner[g0[0].date]) driveOwner[g0[0].date] = k; });
    return order.map(function (k) {
      var g = groups[k];
      // A drive or street run (no track to group by) stays a plain row; a timed session on its own gets the same card as a day.
      if (g.length < 2 && !dayKey(g[0])) return g[0].type === 'other' && driveOwner[g[0].date] ? '' : sessionRow(g[0]);
      g = g.slice().sort(byTime);
      var drives = driveOwner[g[0].date] === k ? (all || list).filter(function (x) { return x.type === 'other' && x.date === g[0].date; }).sort(byTime) : [];
      // The fastest of the day: the best lap or run, or for drag runs the quickest quarter mile (else 0 to 60).
      function score(x) { return x.type === 'drag' ? (x.quarter || (x.s60 ? 1000 + x.s60 : 0)) : x.bestTime || 0; }
      var fast = g.filter(function (x) { return score(x) > 0; }).sort(function (a, b) { return score(a) - score(b); })[0];
      var key = k, many = g.length > 1, open = tile ? !!openDays[key] : (openDays[key] || !fast || g.length === 1), count = g.length + ' session' + (many ? 's' : '');
      var best = fast && fast.type !== 'drag' ? V.fmtLap(fast.bestTime) : '';
      return '<div class="card tp-daygroup' + (tile ? ' tp-day-tile' : '') + '"' + ' data-open="' + (open ? 'true' : 'false') + '" data-many="' + (many ? 'true' : 'false') + '" data-day="' + esc(key) + '">' +
        '<div class="tp-daygroup-head">' + groupTitleHtml(niceDate(g[0].date) + ' on ' + trackName(g[0]), niceDate(g[0].date) + ' on ' + trackName(g[0]) + ', ' + count, open, many || tile, count + (best ? (many ? ', fastest ' : ', ') + best : '')) +
        (owner ? '<button type="button" class="tp-daygroup-share" role="switch" data-day-share data-ids="' + esc(g.map(function (x) { return x.id; }).join(',')) + '" data-what="' + esc(niceDate(g[0].date) + ' at ' + trackName(g[0])) + '" aria-checked="' + (g.every(function (x) { return x.privacy && x.privacy !== 'private'; }) ? 'true' : 'false') + '" aria-label="' + (many ? 'Share all ' + g.length + ' sessions' : 'Share this session') + '"><span>Shared</span><span class="tp-track"></span></button>' : '') +
        groupCountHtml(count, g.length, open, many) +
        (tile && owner ? dayPrivacyHtml(g) : '') +
        (tile ? '<button type="button" class="tp-day-arrow" data-day-toggle aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="' + (open ? 'Hide' : 'Show') + ' the ' + count + ' on ' + esc(niceDate(g[0].date)) + '">' + icon('chev') + '</button>' : '') + '</div>' +
        (dayCharge(g, drives) ? '<p class="tp-small tp-daygroup-charge">' + esc(dayCharge(g, drives)) + '</p>' : '') +
        (fast && many && !tile ? '<div class="tp-daygroup-best"><span class="tp-small tp-daygroup-label">Fastest session of the day, <span class="tp-daygroup-count"><span class="tp-small">' + count + '</span></span></span>' + dayRow(fast, g.indexOf(fast) + 1, false, g.length) + '</div>' : '') +
        '<div class="tp-list tp-daygroup-all">' + g.map(function (x, i) { return dayRow(x, i + 1, many && x === fast); }).join('') +
        (fast && many && !tile ? '<button type="button" class="tp-daygroup-less" data-day-toggle aria-expanded="true">Show only the fastest of the ' + count + icon('chev') + '</button>' : '') +
        (drives.length ? '<span class="tp-small tp-daygroup-label tp-drives-label">Drives between runs (' + drives.length + ')</span>' + drives.map(sessionRow).join('') : '') +
        (owner ? addToDayButton(g[0], many) : '') +
        (owner ? '<button type="button" class="btn btn-danger btn-sm tp-daygroup-delete" data-day-delete data-ids="' + esc(g.concat(drives).map(function (x) { return x.id; }).join(',')) + '" data-label="' + esc(trackName(g[0])) + '" data-date="' + esc(niceDate(g[0].date)) + '">' + icon('trash') + (many ? 'Delete this day' : 'Delete this session') + '</button>' : '') + '</div>' + (owner ? dayEditButton(g) : '') + '</div>';
    }).join('');
  }
  // The Add a session page for another session on the same day (and the same layout): the day and the layout are only a
  // starting point, the files still keep their own date when they have one.
  function addToDayQuery(s) {
    var q = 'add=1&car=' + encodeURIComponent(s.carId || '') + '&day=' + encodeURIComponent(s.date || '');
    if (s.type === 'track' && s.layoutId) q += '&layout=' + encodeURIComponent(s.layoutId);
    return q;
  }
  function addToDayButton(s, many) {
    if (!s || !s.date || !s.carId) return '';
    return '<a class="btn btn-secondary btn-sm tp-daygroup-add" href="track.html?' + esc(addToDayQuery(s)) + '" data-go="' + esc(addToDayQuery(s)) + '" data-day-add>' + icon('upload') + (many ? 'Add a session to this day' : 'Add another session from this day') + '</a>';
  }
  // Edit all the sessions of a day at once (the owner): conditions, air temperature, tyres, brake pads and the logger,
  // for when they were left off or set wrong on every file of the day. Anything left blank stays as it is on each session.
  function dayEditButton(g) {
    var many = g.length > 1, picked = many ? g.filter(function (x) { return pickedIds[x.id]; }) : [], use = picked.length ? picked : g;
    return '<p class="tp-small tp-pick-hint" data-pick-hint>' + icon('info') + '<span>' + editHint(many, picked.length, g.length) + '</span></p>' +
      (many ? '<div class="tp-pickbar" data-pickbar' + (picked.length ? '' : ' hidden') + '><span data-pick-count>' + picked.length + ' selected</span><button type="button" class="btn btn-ghost btn-sm" data-pick-clear>Clear selection</button></div>' : '') +
      '<button type="button" class="btn btn-secondary btn-sm tp-daygroup-edit" data-day-edit title="' + esc(editHint(many, picked.length, g.length)) + '" data-all-ids="' + esc(g.map(function (x) { return x.id; }).join(',')) + '" data-ids="' + esc(use.map(function (x) { return x.id; }).join(',')) + '"' + (picked.length ? ' data-picked' : '') + ' data-what="' + esc(niceDate(g[0].date) + ' at ' + trackName(g[0])) + '">' + icon('sliders') + editLabel(many, picked.length, g.length) + '</button>';
  }
  function editLabel(many, picked) {
    return picked ? 'Quick edit ' + picked + ' selected' : 'Quick edit';
  }
  // What the Quick edit button does, shown beside it and as its tooltip.
  function editHint(many, picked, total) {
    return !many ? 'Quick edit changes this session\'s conditions, air temperature, tyres, brake pads or logger without opening it.'
      : picked ? 'Quick edit will change only the ' + (picked === 1 ? '1 selected session' : picked + ' selected sessions') + '. Tap a session to add or remove it.'
      : 'Quick edit changes the conditions, air temperature, tyres, brake pads or logger on all ' + total + ' sessions at once. Hold a session to pick just some of them.';
  }
  // The tyres and brake pads from the car's last session before the earliest of these sessions, if it had any.
  function previousKit(m, ids) {
    var all = (m && m.sessions) || [], day = all.filter(function (x) { return ids.indexOf(x.id) !== -1; }).sort(byTime);
    if (!day.length) return {};
    var first = day[0], cutoff = first.date + (first.time || '');
    var before = all.filter(function (x) { return x.carId === first.carId && ids.indexOf(x.id) === -1 && (x.date + (x.time || '')) < cutoff; })
      .sort(function (x, y) { return (y.date + (y.time || '')) < (x.date + (x.time || '')) ? -1 : 1; });
    var tyreSess = before.filter(function (x) { return x.tyres; })[0], padSess = before.filter(function (x) { return x.pads || x.padFrontMake; })[0], out = {};
    if (tyreSess && TY) { var t = TY.parse(tyreSess.tyres); if (t.make || t.model || t.w) out.tyre = t; }
    if (padSess && PD) out.pads = { fields: padInit(padSess), text: padSess.pads || '' };
    return out;
  }
  function dayEditHtml(n, what, picked) {
    var sel = picked ? (n === 1 ? 'the selected session' : 'the ' + n + ' selected sessions') : n > 1 ? 'all ' + n + ' sessions' : 'the session';
    return '<div class="card tp-fields tp-dayedit" id="tp-dayedit"><h3>Edit ' + sel + ' on ' + esc(what) + '</h3>' +
      '<p class="tp-small">Only what you set here changes; anything left blank stays as it is on each session.</p>' +
      '<div class="tp-de-grid">' +
      '<div class="tp-field"><span class="tp-lbl">Conditions</span><div class="tp-chips" data-cond>' + ['Dry', 'Damp', 'Wet'].map(function (c) { return '<button type="button" class="chip" data-v="' + c + '" aria-pressed="false">' + c + '</button>'; }).join('') + '</div></div>' +
      '<div class="tp-field"><span class="tp-lbl">Sharing</span><div class="tp-chips" data-share>' + [['board', 'Shared'], ['private', 'Only me']].map(function (c) { return '<button type="button" class="chip" data-v="' + c[0] + '" aria-pressed="false">' + c[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="tp-field"><label for="tp-de-temp">Air temperature (°C)</label><input class="field" id="tp-de-temp" inputmode="numeric" placeholder="Leave as it is"></div>' +
      '<div class="tp-weather-row"><button type="button" class="btn btn-secondary btn-sm" id="tp-de-weather">Fill in from weather</button><p class="tp-src" id="tp-de-src"></p></div>' +
      '<div class="tp-de-kit"><button type="button" class="tp-switch" role="switch" id="tp-de-tyres-on" aria-checked="false"><span>Change the tyres</span><span class="tp-track"></span></button>' +
      '<div id="tp-de-tyres" hidden>' + tyreFields('tp-de-tyre', {}) + '</div></div>' +
      '<div class="tp-de-kit"><button type="button" class="tp-switch" role="switch" id="tp-de-pads-on" aria-checked="false"><span>Change the brake pads</span><span class="tp-track"></span></button>' +
      '<div id="tp-de-pads" hidden>' + padFields('tp-de-pad', { same: true }) + '</div></div>' +
      loggerFields('tp-de-logger', '', false).replace('Choose the logger', 'Leave as it is') +
      '</div>' +
      '<div class="tp-actions"><button type="button" class="btn btn-primary" data-day-edit-apply>' + icon('check') + 'Apply to ' + sel + '</button><button type="button" class="btn btn-ghost" data-day-edit-cancel>Cancel</button></div><p class="tp-status" id="tp-de-status" role="status"></p></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-day-edit]');
    if (!b) return;
    var box = b.closest('.tp-daygroup'), ids = b.getAttribute('data-ids').split(','), what = b.getAttribute('data-what');
    var old = document.getElementById('tp-dayedit');
    if (old) old.remove();
    // The tyre and pad lists are loaded on demand (the list page does not need them until now).
    Promise.all([loadTyres(), loadPads(), getMine()]).catch(function () {}).then(function (res) {
    if (!document.body.contains(b)) return;
    var picked = b.hasAttribute('data-picked');
    b.insertAdjacentHTML('afterend', dayEditHtml(ids.length, what, picked));
    var form = document.getElementById('tp-dayedit');
    form.setAttribute('data-ids', ids.join(',')); form.setAttribute('data-what', what);
    wireTyres('tp-de-tyre'); wirePads('tp-de-pad'); wireLogger('tp-de-logger');
    // Same tyres or pads as the car's last session before this day: one tap fills them in and switches the change on.
    var prev = previousKit(res && res[2], ids);
    [['tyres', prev.tyre, function (t) { return TY ? TY.compose(t) : ''; }, function (t) { return tyreFields('tp-de-tyre', t); }, function () { wireTyres('tp-de-tyre'); }],
     ['pads', prev.pads, function (p) { return p.text; }, function (p) { return padFields('tp-de-pad', p.fields); }, function () { wirePads('tp-de-pad'); }]].forEach(function (k) {
      if (!k[1]) return;
      var sw = document.getElementById('tp-de-' + k[0] + '-on'), fields = document.getElementById('tp-de-' + k[0]);
      sw.insertAdjacentHTML('afterend', '<p class="tp-small tp-tyre-note" id="tp-de-prev-' + k[0] + '">Same ' + (k[0] === 'tyres' ? 'tyres' : 'brake pads') + ' as last time (' + esc(k[2](k[1])) + ')? <button type="button" class="btn btn-secondary btn-sm" id="tp-de-use-' + k[0] + '">Use previous ' + (k[0] === 'tyres' ? 'tyres' : 'brake pads') + '</button></p>');
      document.getElementById('tp-de-use-' + k[0]).addEventListener('click', function () {
        fields.innerHTML = k[3](k[1]); k[4]();
        sw.setAttribute('aria-checked', 'true'); fields.hidden = false;
      });
    });
    ['data-cond', 'data-share'].forEach(function (attr) {
      form.querySelector('[' + attr + ']').addEventListener('click', function (ev) {
        var c = ev.target.closest('button[data-v]');
        if (!c) return;
        var on = c.getAttribute('aria-pressed') !== 'true';
        form.querySelectorAll('[' + attr + '] button').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
        if (on) { c.classList.add('is-on'); c.setAttribute('aria-pressed', 'true'); }
      });
    });
    ['tyres', 'pads'].forEach(function (k) {
      var sw = document.getElementById('tp-de-' + k + '-on'), fields = document.getElementById('tp-de-' + k);
      sw.addEventListener('click', function () { var on = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', on ? 'true' : 'false'); fields.hidden = !on; });
    });
    form.querySelector('[data-day-edit-cancel]').addEventListener('click', function () { form.remove(); });
    // The weather at the track that day (Open-Meteo, the earliest session's time): fills the temperature and the conditions.
    var dayWeather = null, tempEl = document.getElementById('tp-de-temp');
    tempEl.addEventListener('input', function () { dayWeather = null; document.getElementById('tp-de-src').innerHTML = ''; });
    document.getElementById('tp-de-weather').addEventListener('click', function () {
      var src = document.getElementById('tp-de-src');
      src.textContent = 'Looking up the weather...';
      getMine().then(function (m) {
        var day = ((m && m.sessions) || []).filter(function (x) { return ids.indexOf(x.id) !== -1 && x.origin; }).sort(byTime)[0];
        if (!day) return null;
        return lookupWeather(day.origin, day.date, day.time).then(function (w) { return w && { w: w, s: day }; });
      }).then(function (r) {
        if (!r) { src.textContent = 'No weather found for that day and place.'; return; }
        dayWeather = r.w;
        tempEl.value = r.w.temp;
        var c = weatherConditions(r.w);
        form.querySelectorAll('[data-cond] button').forEach(function (x) { var on = x.getAttribute('data-v') === c; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        src.innerHTML = icon('info') + '<span>' + weatherNote(r.w, r.s.venue) + ' Conditions set to match. Apply to keep it.</span>';
      });
    });
    form.querySelector('[data-day-edit-apply]').addEventListener('click', function () {
      var body = {}, cond = form.querySelector('[data-cond] button.is-on'), t = document.getElementById('tp-de-temp').value.trim(), lg = loggerValue('tp-de-logger');
      if (cond) body.conditions = cond.getAttribute('data-v');
      var shareChip = form.querySelector('[data-share] button.is-on');
      if (shareChip) body.privacy = shareChip.getAttribute('data-v');
      if (t !== '' && isFinite(parseFloat(t))) { body.temp = parseFloat(t); body.tempSource = dayWeather && parseFloat(t) === dayWeather.temp ? 'weather' : 'member'; if (body.tempSource === 'weather') body.weather = dayWeather; }
      if (document.getElementById('tp-de-tyres-on').getAttribute('aria-checked') === 'true') Object.assign(body, tyrePayload(readTyre('tp-de-tyre')));
      if (document.getElementById('tp-de-pads-on').getAttribute('aria-checked') === 'true') Object.assign(body, padPayload(readPads('tp-de-pad')));
      if (lg) body.logger = lg;
      var st = document.getElementById('tp-de-status');
      if (!Object.keys(body).length) { st.textContent = 'Set at least one thing to change first.'; st.className = 'tp-status is-error'; return; }
      if (body.privacy === 'board' && !window.confirm((ids.length === 1 ? 'Share this session' : 'Share these ' + ids.length + ' sessions') + ' at ' + what + '? Members will see ' + (ids.length === 1 ? 'it' : 'them') + ' on your car\'s page, and on the track\'s leaderboard where it has one.')) return;
      var btn = form.querySelector('[data-day-edit-apply]');
      btn.disabled = true; st.textContent = 'Saving...'; st.className = 'tp-status';
      var chain = Promise.resolve(), failed = 0;
      ids.forEach(function (id) {
        chain = chain.then(function () { return api('PUT', '/track/session', Object.assign({ id: id }, body)).then(function (d) { if (!d.success) failed++; }).catch(function () { failed++; }); });
      });
      chain.then(function () {
        mine = null; counts = null;
        justSaved = { text: failed ? failed + ' of the ' + ids.length + ' sessions at ' + what + ' could not be changed. Try again.' : (ids.length === 1 ? 'The session at ' + what + ' is updated.' : (picked ? 'The ' : 'All ') + ids.length + (picked ? ' selected sessions at ' : ' sessions at ') + what + ' are updated.') };
        ids.forEach(function (id) { delete pickedIds[id]; });
        // The list redraws; stay on the day that was changed, open, rather than going back to the top.
        var dkey = box && box.getAttribute('data-day');
        if (dkey) { openDays[dkey] = true; storeListOpen(); focusDay(dkey); }
        route();
      });
    });
    form.scrollIntoView({ block: 'nearest' });
    });
  });
  // Picking sessions of a day: hold on a session (about half a second), or Ctrl/Cmd/Shift-click, to pick it. While any are picked in a
  // day a plain tap picks or unpicks too (so it does not open the session), and the day's Edit button changes only the picked ones.
  function pickableRow(t) {
    var row = t && t.closest && t.closest('a.tp-pickable');
    var box = row && row.closest('.tp-daygroup[data-many="true"]');
    return row && box && box.querySelector('[data-day-edit]') ? { row: row, box: box } : null;
  }
  function refreshPick(box) {
    var rows = box.querySelectorAll('a.tp-pickable'), picked = [];
    Array.prototype.forEach.call(rows, function (r) { if (r.classList.contains('is-picked')) picked.push(r.getAttribute('data-sid')); });
    var btn = box.querySelector('[data-day-edit]'), bar = box.querySelector('[data-pickbar]');
    btn.setAttribute('data-ids', (picked.length ? picked : btn.getAttribute('data-all-ids').split(',')).join(','));
    if (picked.length) btn.setAttribute('data-picked', ''); else btn.removeAttribute('data-picked');
    btn.innerHTML = icon('sliders') + editLabel(true, picked.length);
    var hint = editHint(true, picked.length, rows.length);
    btn.setAttribute('title', hint);
    var hs = box.querySelector('[data-pick-hint] span');
    if (hs) hs.textContent = hint;
    if (bar) { bar.hidden = !picked.length; bar.querySelector('[data-pick-count]').textContent = picked.length + ' selected'; }
    var form = document.getElementById('tp-dayedit');
    if (form && box.contains(form)) form.remove();
  }
  function togglePick(hit) {
    var on = !hit.row.classList.contains('is-picked');
    hit.row.classList.toggle('is-picked', on);
    var id = hit.row.getAttribute('data-sid');
    if (on) pickedIds[id] = true; else delete pickedIds[id];
    refreshPick(hit.box);
  }
  (function () {
    var timer = null, sx = 0, sy = 0, justHeld = false;
    function stop() { if (timer) { clearTimeout(timer); timer = null; } }
    document.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      var hit = pickableRow(e.target);
      stop(); justHeld = false;
      if (!hit) return;
      sx = e.clientX; sy = e.clientY;
      timer = setTimeout(function () { timer = null; justHeld = true; togglePick(hit); }, 450);
    });
    document.addEventListener('pointermove', function (e) { if (timer && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) stop(); });
    ['pointerup', 'pointerleave', 'scroll'].forEach(function (n) { document.addEventListener(n, stop, true); });
    // A long press on a phone also asks for the link's menu (and may cancel the pointer): never show it, and pick the row if the timer had not yet.
    document.addEventListener('contextmenu', function (e) {
      var hit = pickableRow(e.target);
      if (!hit) return;
      e.preventDefault();
      if (timer) { stop(); justHeld = true; togglePick(hit); }
    });
    document.addEventListener('click', function (e) {
      var hit = pickableRow(e.target);
      if (!hit) return;
      if (justHeld) { justHeld = false; e.preventDefault(); e.stopPropagation(); return; }
      if (e.ctrlKey || e.metaKey || e.shiftKey || hit.box.querySelector('a.tp-pickable.is-picked')) { e.preventDefault(); e.stopPropagation(); togglePick(hit); }
    }, true);
    document.addEventListener('click', function (e) {
      var c = e.target.closest && e.target.closest('[data-pick-clear]');
      if (!c) return;
      var box = c.closest('.tp-daygroup');
      Array.prototype.forEach.call(box.querySelectorAll('a.tp-pickable.is-picked'), function (r) { r.classList.remove('is-picked'); delete pickedIds[r.getAttribute('data-sid')]; });
      refreshPick(box);
    });
  })();
  // ---------- Add a car (no photo needed) ----------
  // Sessions belong to a car. A car can be added here with just its make and model (POST /my-builds/car/new);
  // photos can be added later in My Garage. A car of another make is kept in the garage, out of the Gallery.
  function addCarHtml(first) {
    return '<form class="card tp-intro tp-addcar" id="tp-addcar" novalidate>' +
      '<h2>' + (first ? 'Add your car' : 'Add a car') + '</h2>' +
      '<p>' + (first ? 'Sessions belong to a car, so your times can be matched to its mods. ' : '') + 'No photo needed: you can add photos later in My Garage.</p>' +
      // Car or bike: hidden while Laps is for cars only (October 2026); drop hidden to offer bikes again.
      '<div class="tp-types" role="group" aria-label="Car or bike" hidden>' +
        '<button type="button" class="chip is-on" data-addcar-type="car" aria-pressed="true">Car</button>' +
        '<button type="button" class="chip" data-addcar-type="bike" aria-pressed="false">Bike</button></div>' +
      '<div class="tp-addcar-grid">' +
        '<div class="tp-field"><label for="tp-addcar-make">Make</label><select class="field" id="tp-addcar-make"><option value="">Loading the makes</option></select></div>' +
        '<div class="tp-field"><label for="tp-addcar-model">Model</label><select class="field" id="tp-addcar-model" disabled><option value="">Choose the make first</option></select></div>' +
        '<div class="tp-field"><label for="tp-addcar-year">Year (optional)</label><input class="field" id="tp-addcar-year" type="number" inputmode="numeric" min="1950" max="' + (new Date().getFullYear() + 1) + '" placeholder="e.g. 2022"></div>' +
        '<div class="tp-field"><label for="tp-addcar-name">Name it (optional)</label><input class="field" id="tp-addcar-name" maxlength="150" placeholder="e.g. Track car"></div>' +
      '</div>' +
      '<p class="tp-small tp-addcar-missing">Make or model not on the list? <a href="contact.html">Tell us</a> and we\u2019ll add it.</p>' +
      '<p class="tp-addcar-msg" id="tp-addcar-msg" role="status"></p>' +
      '<div class="tp-actions"><button type="submit" class="btn btn-accent" id="tp-addcar-save">Add car</button>' +
        (first ? '' : '<button type="button" class="btn btn-secondary" id="tp-addcar-cancel">Cancel</button>') + '</div></form>';
  }
  function wireAddCar() {
    var form = document.getElementById('tp-addcar');
    if (!form) return;
    var type = 'car';
    var make = document.getElementById('tp-addcar-make'), model = document.getElementById('tp-addcar-model');
    var msg = document.getElementById('tp-addcar-msg');
    var wrap = document.getElementById('tp-car-add-wrap');
    var cancel = document.getElementById('tp-addcar-cancel');
    if (cancel) cancel.addEventListener('click', function () { wrap.hidden = true; var open = document.getElementById('tp-car-add-open'); if (open) open.hidden = false; });
    // Make and model are picked from the vehicle list (the Vehicles panel of track-admin.html), never typed, so
    // every vehicle is named the same way on the boards. Each drop-down keeps its choice while it is filled again.
    function opts(list, first, keep) {
      return '<option value="">' + esc(first) + '</option>' + list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === keep ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    }
    function models() {
      var byMake = (window.MT3UKVehicles && window.MT3UKVehicles[type]) || {}, list = make.value ? byMake[make.value] || [] : [];
      model.innerHTML = opts(list, make.value ? 'Choose the model' : 'Choose the make first', model.value);
      model.disabled = !make.value;
    }
    function lists() {
      var V2 = window.MT3UKVehicles, byMake = (V2 && V2[type]) || {};
      make.innerHTML = opts(Object.keys(byMake).sort(function (a, b) { return a.localeCompare(b); }), V2 && V2.loaded === false ? 'Loading the makes' : 'Choose the make', make.value);
      models();
    }
    if (window.MT3UKVehicles) window.MT3UKVehicles.load().then(lists, lists);
    make.addEventListener('change', models);
    form.addEventListener('click', function (e) {
      var b = e.target.closest('[data-addcar-type]');
      if (!b) return;
      type = b.getAttribute('data-addcar-type');
      form.querySelectorAll('[data-addcar-type]').forEach(function (c) { var on = c === b; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', String(on)); });
      // The words follow Car or bike.
      var bike = type === 'bike';
      document.getElementById('tp-addcar-save').textContent = bike ? 'Add bike' : 'Add car';
      document.getElementById('tp-addcar-name').placeholder = bike ? 'e.g. Track bike' : 'e.g. Track car';
      lists();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!make.value) { msg.textContent = 'Choose the make.'; make.focus(); return; }
      if (!model.value) { msg.textContent = 'Choose the model.'; model.focus(); return; }
      var btn = document.getElementById('tp-addcar-save');
      btn.disabled = true;
      msg.textContent = '';
      api('POST', '/my-builds/car/new', { make: make.value.trim(), model: model.value.trim(), year: document.getElementById('tp-addcar-year').value, vehicleType: type, name: document.getElementById('tp-addcar-name').value.trim() }).then(function (d) {
        btn.disabled = false;
        if (!d.success) { msg.textContent = d.message || 'Could not add the car. Please try again.'; return; }
        mine = null;
        currentCar = d.car.id;
        try { localStorage.setItem('mt3ukTrackCar', currentCar); } catch (er) {}
        showHome();
      }).catch(function () { btn.disabled = false; msg.textContent = 'Could not reach the server. Please try again.'; });
    });
  }
  function wireCarChips(m) {
    var box = document.getElementById('tp-cars');
    if (!box) return;
    function draw() {
      var car = m.cars.filter(function (c) { return c.id === currentCar; })[0] || m.cars[0];
      box.innerHTML = vehiclesHtml(m, car);
    }
    box.addEventListener('click', function (e) {
      if (e.target.closest('#tp-vtoggle')) { vehiclesOpen = !vehiclesOpen; draw(); return; }
      var add = e.target.closest('#tp-car-add-open'), wrap = document.getElementById('tp-car-add-wrap');
      if (add && wrap) { wrap.hidden = false; vehiclesOpen = false; draw(); var mk = document.getElementById('tp-addcar-make'); if (mk) mk.focus(); return; }
      var b = e.target.closest('[data-car]');
      if (!b) return;
      var picked = b.getAttribute('data-car');
      vehiclesOpen = false;
      if (picked === currentCar) { draw(); return; }
      currentCar = picked;
      try { localStorage.setItem('mt3ukTrackCar', currentCar); } catch (er) {}
      showHome();
    });
  }
  var counts = null;
  // Delete every session of a day at one track (and the drives between its runs), after asking.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-day-delete]');
    if (!b || b.disabled) return;
    var ids = b.getAttribute('data-ids').split(','), what = b.getAttribute('data-label') + ' - ' + b.getAttribute('data-date');
    if (!window.confirm('Confirm delete?\n\n' + (ids.length === 1 ? 'This will delete this session (' + what + ').' : 'This will delete all ' + ids.length + ' sessions for this day (' + what + ').') + ' This can\'t be undone.')) return;
    b.disabled = true;
    var chain = Promise.resolve(), failed = 0;
    ids.forEach(function (id) {
      chain = chain.then(function () { return api('DELETE', '/track/session?id=' + encodeURIComponent(id)).then(function (d) { if (!d.success) failed++; }).catch(function () { failed++; }); });
    });
    chain.then(function () {
      mine = null; counts = null;
      justSaved = { text: failed ? failed + ' of the ' + ids.length + ' sessions for ' + what + ' could not be deleted. Try again.' : (ids.length === 1 ? 'Deleted the session (' + what + ').' : 'Deleted all ' + ids.length + ' sessions for this day (' + what + ').') };
      route();
    });
  });
  // The switch on a day's group: share every session that day at that track, or make them all Only me.
  document.addEventListener('click', function (e) {
    var sw = e.target.closest && e.target.closest('[data-day-share]');
    if (!sw || sw.disabled) return;
    var ids = sw.getAttribute('data-ids').split(','), what = sw.getAttribute('data-what');
    var share = sw.getAttribute('aria-checked') !== 'true', value = share ? 'board' : 'private';
    if (share && !window.confirm(ids.length === 1 ? 'Share this session at ' + what + '? Members will see it on your car\'s page, and on the track\'s leaderboard where it has one.' : 'Share all ' + ids.length + ' sessions at ' + what + '? Members will see them on your car\'s page, and on the track\'s leaderboard where it has one.')) return;
    sw.disabled = true;
    sw.setAttribute('aria-checked', share ? 'true' : 'false');
    var chain = Promise.resolve(), failed = 0;
    ids.forEach(function (id) {
      chain = chain.then(function () { return api('PUT', '/track/session', { id: id, privacy: value }).then(function (d) { if (!d.success) failed++; }).catch(function () { failed++; }); });
    });
    chain.then(function () {
      mine = null; counts = null;
      justSaved = { text: failed ? failed + ' of the ' + ids.length + ' sessions at ' + what + ' could not be changed. Try again.' : (ids.length === 1 ? 'The session at ' + what + ' is now ' : 'All ' + ids.length + ' sessions at ' + what + ' are now ') + (share ? 'Shared' : 'Only me') + '.' };
      route();
    });
  });
  // Two files from one session (a lap timer's and the car's): join them, or save them separately.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#tp-merge-toggle');
    if (!b || !add || !add.files) return;
    add.mergeOff = !add.mergeOff;
    parseFile();
  });
  // Choosing a lap changes the figures: the tiles and the Track Mode card follow it.
  document.addEventListener('change', function (e) {
    var sel = e.target.closest && e.target.closest('#tp-lap-pick');
    if (!sel || !view || !view.s) return;
    // Another session that day: open it.
    if (sel.value.slice(0, 2) === 'x:') { go('s=' + sel.value.slice(2), true); return; }
    lapSel = sel.value ? parseInt(sel.value, 10) : null;
    lapSelFor = view.s.id;
    var box = document.getElementById('tp-headline');
    if (box) box.innerHTML = headlineHtml(view.s);
  });
  // The Saved message after an upload goes away when dismissed.
  document.addEventListener('click', function (e) {
    var x = e.target.closest && e.target.closest('#tp-saved-x');
    if (x && x.closest('#tp-saved')) x.closest('#tp-saved').remove();
  });
  // A day's group opens and closes from its heading, and stays as chosen when the list is drawn again.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-day-toggle]');
    if (!b) return;
    var box = b.closest('.tp-daygroup');
    var open = box.getAttribute('data-open') !== 'true';
    box.setAttribute('data-open', open ? 'true' : 'false');
    Array.prototype.forEach.call(box.querySelectorAll('[data-day-toggle]'), function (x) { x.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    openDays[box.getAttribute('data-day')] = open;
  });

  // ---------- Add a session ----------
  var add = null;
  // Where a file comes from, for the Add a session screen.
  var FILE_SOURCES = [
    ['Tesla Track Mode', 'Save the session\'s telemetry to a USB drive from Track Mode. The file is named like telemetry-v1-2025-04-25-11_35_49.csv. Copy it to your phone or computer and add it here. Besides laps, speed and G-force it holds the car\'s own data: charge, power, throttle, brake pressure, temperatures, tyre pressures and slip.'],
    ['RaceBox', 'Open the session in the app, share or export it and choose VBO (CSV works too).'],
    ['VBOX', 'Copy the .vbo file from the SD card.'],
    ['Harry\'s LapTimer or TrackAddict', 'Export the session as CSV (or GPX) and save it to your phone.'],
    ['AiM', 'Export from Race Studio as CSV with GPS latitude, longitude and speed.'],
    ['Something else', 'Any CSV or GPX with a time, latitude, longitude and ideally speed. If the columns are not recognised you can pick them yourself.']
  ];
  function showAdd(carId) {
    if (!token()) { location.href = signInUrl('/track.html?add=1'); return; }
    loading();
    Promise.all([getMine(), getLibrary(), isAdmin(), loadTyres(), loadPads()]).then(function (r) {
      var m = r[0];
      if (!m) { location.href = signInUrl('/track.html?add=1'); return; }
      if (m.gate) return showGate();
      if (!m.cars.length) return showHome();
      var car = m.cars.filter(function (c) { return c.id === carId; })[0] || m.cars[0];
      VW = vwOf(car);
      add = { car: car, drive: (car && car.drive) || '', cars: m.cars, lib: r[1], admin: r[2], rd: null, session: null, type: null, startLine: null, conditions: 'Dry', privacy: 'private', street: false, file: null };
      // Opened from a day (Add a session to this day): that day, and the layout of the sessions on it, to start from.
      var hp = params(), hd = hp.get('day') || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(hd) && hd <= ukToday()) { add.dayHint = hd; add.layoutHint = String(hp.get('layout') || '').slice(0, 60); add.layoutPick = add.layoutHint; }
      var lt = lastTyre(m, car.id);
      // The tyres start empty; the car's last ones are offered with a button.
      add.lastTyre = lt || null;
      add.lastLogger = lastLogger(m);
      // The pads start as the car's brakes in My Garage.
      var cp = carPads(car);
      add.pads = cp || { same: true }; add.padsFromCar = !!cp;
      drawAdd();
    }).catch(function () { failed('Could not load your cars. Check your connection and try again.'); });
  }
  function drawAdd() {
    var a = add;
    var h;
    if (a.replaceId) {
      // Changing a saved session's type: its saved readings are read again.
      h = back('Back to the session', 's=' + a.replaceId, true) + '<div class="tp-head"><h2>' + (a.lineEdit ? 'Edit the map' : a.relayout ? 'Change the layout' : 'Change the type') + '</h2>' + unitsChip() + '</div>' +
        '<div class="tp-add-grid"><div class="card"><p class="tp-car-one">Car: <b>' + esc(a.car.name) + '</b></p>' +
        (a.lineEdit ? '<p class="tp-sub">Drag the start and finish markers to where they should be, press Done, and check the time. Then send the change. Your session stays as it is until MT3UK has approved it.</p>'
          : '<p class="tp-sub">Using the readings saved with this session. Pick the type below, check the result, then save.</p>') +
        '<p class="tp-status" id="tp-status" role="status"></p></div><div id="tp-result"></div></div>';
      app.innerHTML = h;
      if (a.session) drawResult();
      return;
    }
    h = back('Track sessions', '') + '<div class="tp-head"><h2>Add a session</h2>' + unitsChip() + '</div>' +
      '<div class="tp-add-grid"><div class="card">' +
      (a.dayHint ? '<p class="tp-sub" id="tp-day-intro">Adding another session to ' + esc(niceDate(a.dayHint)) + '. Pick its files below.</p>' : '') +
      (a.cars.length > 1 ? '<div class="tp-field"><label for="tp-car">Car</label><select class="field" id="tp-car">' + a.cars.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === a.car.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></div>' : '<p class="tp-car-one">Car: <b>' + esc(a.car.name) + '</b></p>') +
      '<label class="tp-drop" id="tp-drop">' + icon('upload') + '<b>Drop your files here, or choose them</b><small>One file, or all of a day\'s files together (they make one session). VBO, CSV or GPX. Works with RaceBox, VBOX, Harry\'s LapTimer, TrackAddict, AiM and most phone apps.</small><span class="btn btn-secondary btn-sm">Choose files</span><input type="file" id="tp-file" multiple accept=".vbo,.csv,.gpx,.txt,text/csv,application/gpx+xml" hidden></label>' +
      (a.files && a.files.length ? fileBox() : '') +
      '<details class="tp-help"' + (a.files && a.files.length ? '' : ' open') + '><summary>' + icon('info') + 'Where do I get my file?</summary>' +
      '<div class="tp-chips tp-src-chips" id="tp-src-chips" role="group" aria-label="Where your data comes from">' + FILE_SOURCES.map(function (f, i) { return '<button type="button" class="chip chip-sm' + (i === 0 ? ' is-on' : '') + '" data-src="' + i + '">' + esc(f[0]) + '</button>'; }).join('') + '</div>' +
      '<p class="tp-small tp-src-steps" id="tp-src-steps">' + esc(FILE_SOURCES[0][1]) + '</p></details>' +
      '<div id="tp-mapping"></div><p class="tp-status" id="tp-status" role="status"></p></div>' +
      '<div id="tp-result"></div></div>';
    app.innerHTML = h;
    var input = document.getElementById('tp-file'), drop = document.getElementById('tp-drop');
    input.addEventListener('change', function () { if (input.files.length) readFiles(input.files); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
    drop.addEventListener('drop', function (e) { var fl = e.dataTransfer && e.dataTransfer.files; if (fl && fl.length) readFiles(fl); });
    var chips = document.getElementById('tp-src-chips');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-src]');
      if (!b) return;
      [].forEach.call(chips.querySelectorAll('[data-src]'), function (x) { x.classList.toggle('is-on', x === b); });
      document.getElementById('tp-src-steps').textContent = FILE_SOURCES[+b.getAttribute('data-src')][1];
    });
    var sel = document.getElementById('tp-car');
    if (sel) sel.addEventListener('change', function () {
      a.car = a.cars.filter(function (c) { return c.id === sel.value; })[0];
      VW = vwOf(a.car);
      a.drive = (a.car && a.car.drive) || '';
      // Tyres follow the car chosen, until they have been changed by hand.
      a.lastTyre = lastTyre(mine, a.car.id) || null;
      if (a.tyrePre) { a.tyre = undefined; a.tyres = ''; a.tyrePre = false; }
    });
    if (a.session) drawResult();
  }
  // What each file in the box is called when a day's files are combined:
  // "session" for a track day, "run" for sprints, hill climbs and drag.
  function partWord(type, many) {
    var w = type === 'sprint' || type === 'drag' ? 'run' : 'session';
    return many ? w + 's' : w;
  }
  function fileMeta() {
    var rd = add.rd;
    if (!rd || !rd.points) return '';
    // Minutes on track, leaving out the gaps between files.
    var mins = rd.runs ? rd.points.reduce(function (acc, p, i, arr) { return i && p.run === arr[i - 1].run ? acc + p.t - arr[i - 1].t : acc; }, 0) / 60 : rd.points[rd.points.length - 1].t / 60;
    return (rd.runs ? rd.runs + ' ' + partWord(add.type, true) + ', ' : '') + rd.points.length.toLocaleString('en-GB') + ' readings, ' + rd.hz + ' a second, ' + Math.max(1, Math.round(mins)) + ' minutes' + (rd.sats ? ', ' + rd.sats + ' satellites on average' : '');
  }
  // The chosen files, in time order. A file that couldn't be used says so
  // and gets a warning mark instead of a tick; the tick only shows when at
  // least one file worked.
  function fileBox() {
    var a = add, list = a.list || a.files.map(function (f) { return { f: f }; });
    var used = list.filter(function (x) { return x.rd && !x.mergedInto; }).length, skipped = list.filter(function (x) { return x.reason; }).length;
    var head = list.length > 1 ? '<b>' + list.length + ' files' + (skipped && a.list ? ' (' + skipped + ' skipped)' : '') + '</b>' : '';
    var items = list.map(function (x) {
      var w = x.rd ? fileWhen(x.rd) : '';
      return '<li' + (x.reason ? ' class="is-skipped"' : '') + '><b>' + esc(x.f.name) + '</b>' + (w ? '<span class="tp-file-when">' + esc(w) + '</span>' : '') + (x.rebuilt ? '<span class="tp-file-when">No time stamps in this file (the car\'s timer was not running): its times are worked out from the speed and the GPS path.</span>' : '') + (x.mergedInto ? '<span class="tp-file-when">Car data added to the session from ' + esc(x.mergedInto) + '.</span>' : '') + (x.merged ? '<span class="tp-file-when">With the car data from ' + esc(x.merged.name) + ' (lined up, match ' + x.merged.match.toFixed(2) + ').</span>' : '') + (x.noMerge && x.rd ? '<span class="tp-file-when">Saved on its own: ' + esc(x.noMerge) + '</span>' : '') + (x.reason ? '<span class="tp-file-skip">Skipped: ' + esc(x.reason) + '</span>' : '') + '</li>';
    }).join('');
    var meta = a.rd ? fileMeta() : '';
    // Several files are saved as one session each, not merged.
    if (used > 1 && !a.replaceId) meta = used + ' files: each is saved as its own session, grouped by day.' + (meta ? ' ' + meta : '');
    var joinBtn = a.canMerge ? '<button type="button" class="btn btn-secondary btn-sm" id="tp-merge-toggle">' + (a.mergeOff ? 'Join the lap timer and car files' : 'Save the files separately instead') + '</button>' : '';
    var mark = a.rd ? 'check' : a.pending ? 'info' : 'warn';
    return '<div class="tp-file' + (a.rd ? '' : a.pending ? '' : ' is-bad') + '">' + icon(mark) + '<div>' + head + '<ul class="tp-file-list">' + items + '</ul>' + (meta ? '<span>' + esc(meta) + '</span>' : '') + joinBtn + '</div></div>';
  }
  // Each file's date and start time, and where they came from.
  var WHEN_FROM = { file: 'recorded in the file', name: 'from the file name', saved: 'from when the file was saved' };
  function fileWhen(rd) {
    var d = rd.startedAt ? T.ukDate(rd.startedAt) : rd.fileDate, t = rd.startedAt ? T.ukTime(rd.startedAt) : rd.fileTime;
    if (!d) return 'No date found';
    return niceDate(d) + (t ? ', ' + t : '') + ' (' + WHEN_FROM[rd.dateSrc || 'name'] + ')';
  }
  function status(msg, kind) {
    var el = document.getElementById('tp-status');
    if (el) { el.textContent = msg || ''; el.className = 'tp-status' + (kind ? ' is-' + kind : ''); }
  }
  // One file, or all of a day's files: read them all, then they're
  // combined into one session (track-parse.js combine).
  function readFiles(list) {
    var files = Array.prototype.slice.call(list, 0, 12);
    var big = files.filter(function (f) { return f.size > 80 * 1024 * 1024; })[0];
    if (big) { status(big.name + ' is over 80 MB. Export just the one session and try again.', 'error'); return; }
    status('Reading ' + (files.length > 1 ? files.length + ' files' : files[0].name) + '...');
    Promise.all(files.map(function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve({ name: file.name, text: String(reader.result || ''), modified: file.lastModified || 0 }); };
        reader.onerror = function () { reject(new Error(file.name + ' could not be opened.')); };
        reader.readAsText(file);
      });
    })).then(function (read) {
      add.files = read; add.list = null; add.rd = null; add.mergeOff = false;
      // The logger: guessed from the file names, else the member's last one, else the member picks.
      if (!add.loggerTouched) add.logger = loggerGuess(read) || add.lastLogger || '';
      add.nameLooked = false;
      if (add.venueNameLooked) { add.venueName = ''; add.venueNameLooked = false; }
      add.session = null; add.startLine = null; add.finishLine = null; add.editLines = false; add.tapFull = false; add.tapAuto = false; add.tapOutline = null; add.finishCross = 0; add.organizer = ''; add.orgNew = false; add.orgFrom = null; add.rollout = false; add.tapMap = null; add.confirmLines = false; add.type = null; add.date = null; add.time = null;
      // Nothing about adding a layout carries over from the last file: the pick, its name and the add switch.
      add.layoutPick = add.layoutHint || ''; add.layoutName = ''; add.addNow = false; add.addedLayout = false;
      add.weatherKey = null; if (add.tempSource !== 'member') { add.temp = null; add.tempSource = ''; add.weather = null; }
      parseFile();
    }).catch(function (e) { status(e.message || 'That file could not be opened.', 'error'); });
  }
  function headerSig(h) { return h.join('|').toLowerCase().slice(0, 300); }
  // Why a file couldn't be used, in a few words for under its name.
  function skipReason(e) {
    var m = (e && e.message) || '';
    if (/too short/i.test(m)) return 'too short to use';
    if (/No readings with a position|No track points/i.test(m)) return 'no positions in it';
    return m ? m.replace(/\.$/, '').replace(/^./, function (c) { return c.toLowerCase(); }) : 'could not be read';
  }
  // When a file was recorded, to put a day's files in order.
  function fileKey(rd, i) {
    return rd.startedAt || (rd.fileDate ? Date.parse(rd.fileDate + 'T' + (rd.fileTime || '00:00') + ':00Z') : 0) || i;
  }
  // A lap timer's file and a Track Mode file from the same session: line them up by their speed and keep one
  // session, timed by the lap timer and with the car's figures. A car file that will not line up reliably is
  // saved on its own, and says why. Used by adding a file and by adding the readings again.
  function joinCarFiles(good, mergeOff) {
    var carFiles = good.filter(function (x) { return x.rd.format === 'CSV' && x.rd.points.some(function (p) { return p.ch; }); });
    var timerFiles = good.filter(function (x) { return carFiles.indexOf(x) === -1; });
    var joined = [];
    if (carFiles.length && timerFiles.length) {
      carFiles.forEach(function (c) {
        var bestM = null, why = '';
        timerFiles.forEach(function (t) {
          if (t.merged) return;
          var r = T.mergeSources(t.rd, c.rd);
          if (r.rd && (!bestM || r.corr > bestM.r.corr)) bestM = { t: t, r: r };
          else if (!r.rd && !why) why = r.reason;
        });
        c.noMerge = '';
        if (bestM && !mergeOff) {
          bestM.t.rd = Object.assign({}, bestM.r.rd, { carSource: Object.assign({}, bestM.r.rd.carSource, { name: c.f.name }) });
          bestM.t.merged = { name: c.f.name, shift: bestM.r.shift, match: bestM.r.corr };
          c.mergedInto = bestM.t.f.name;
          joined.push(c);
        } else if (bestM) c.noMerge = 'Joining is switched off.';
        else c.noMerge = why || 'It did not line up with the other file.';
      });
      good = good.filter(function (x) { return joined.indexOf(x) === -1; });
    }
    return { good: good, joined: joined, canMerge: carFiles.length > 0 && timerFiles.length > 0 };
  }
  function parseFile(mapping) {
    var a = add;
    a.pending = false;
    try {
      if (!mapping) {
        try { var saved = JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); mapping = null; a.savedMaps = saved; } catch (e) { a.savedMaps = {}; }
      }
      // Each file read on its own; a column choice (from the member, or
      // remembered) is used for files the reader didn't recognise. A file
      // that can't be used is skipped and the rest carry on.
      var good = [], bad = [], lastErr = null;
      for (var fi = 0; fi < a.files.length; fi++) {
        var f = a.files[fi];
        try {
          var one = T.read(f.text, f.name, null, f.modified);
          if (one.needsMapping) {
            var sig = headerSig(one.needsMapping.headers);
            var mp = mapping || (a.savedMaps && a.savedMaps[sig]);
            if (!mp) { a.pending = true; drawAdd(); return drawMapping(one.needsMapping); }
            one = T.read(f.text, f.name, mp, f.modified);
          }
          good.push({ f: f, rd: one, k: fileKey(one, fi), rebuilt: !!one.timeRebuilt });
        } catch (e) {
          lastErr = e;
          bad.push({ f: f, reason: skipReason(e) });
        }
      }
      if (!good.length) {
        a.list = null; a.rd = null; a.session = null;
        drawAdd();
        status(a.files.length > 1 ? 'None of those files could be used. ' + (lastErr && lastErr.message || '') : (lastErr && lastErr.message) || 'That file could not be read.', 'error');
        return;
      }
      good.forEach(function (x, i) { x.i = i; });
      good.sort(function (x, y) { return x.k - y.k || x.i - y.i; });
      var jr = joinCarFiles(good, a.mergeOff), joined = jr.joined;
      good = jr.good;
      a.canMerge = jr.canMerge;
      var rds = good.map(function (x) { return x.rd; });
      a.rd = T.combine(rds);
      a.list = good.concat(joined, bad);
      analyse();
    } catch (e) {
      a.list = null; a.rd = null; a.session = null;
      drawAdd();
      status((e && e.message) || 'That file could not be read.', 'error');
    }
  }
  function drawMapping(nm) {
    var opts = function (sel) { return '<option value="">Not in this file</option>' + nm.headers.map(function (h, i) { return '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(h || 'Column ' + (i + 1)) + '</option>'; }).join(''); };
    var box = document.getElementById('tp-mapping');
    box.innerHTML = '<div class="tp-mapping"><b>Which column is which?</b><p>We didn\'t recognise this file\'s columns. Pick them once and we\'ll remember for files like it.</p>' +
      '<div class="tp-sample"><table class="tp-table"><thead><tr>' + nm.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + nm.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="tp-f2">' + [['time', 'Time'], ['lat', 'Latitude'], ['lng', 'Longitude'], ['speed', 'Speed']].map(function (f) { return '<div class="tp-field"><label for="tp-map-' + f[0] + '">' + f[1] + '</label><select class="field" id="tp-map-' + f[0] + '">' + opts(-1) + '</select></div>'; }).join('') +
      '<div class="tp-field"><label for="tp-map-unit">Speed is in</label><select class="field" id="tp-map-unit"><option value="">Work it out</option><option>km/h</option><option>mph</option><option>m/s</option></select></div></div>' +
      '<button type="button" class="btn btn-primary" id="tp-map-go">Read the file</button></div>';
    document.getElementById('tp-map-go').addEventListener('click', function () {
      function v(k) { var x = document.getElementById('tp-map-' + k).value; return x === '' ? null : parseInt(x, 10); }
      var mp = { time: v('time'), lat: v('lat'), lng: v('lng'), speed: v('speed'), speedUnit: document.getElementById('tp-map-unit').value };
      if (mp.time === null || mp.lat === null || mp.lng === null) { status('Time, latitude and longitude are needed.', 'error'); return; }
      try { var all = JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); all[headerSig(nm.headers)] = mp; localStorage.setItem(MAP_KEY, JSON.stringify(all)); } catch (e) {}
      parseFile(mp);
    });
  }
  // What the member chose, as the options for the timing code.
  function analysisOpts(a) {
    var opts = {};
    if (a.type) opts.type = a.type;
    if (a.startLine) opts.startLine = a.startLine;
    if (a.finishLine) opts.finishLine = a.finishLine;
    // Sprints and hill climbs: ignore the first time a file crosses the finish line (on by default).
    if (a.ignoreFinish !== false) opts.ignoreFirstFinish = true;
    if (a.finishCross) opts.finishCrossing = a.finishCross;
    if (a.organizer) opts.organizer = a.organizer;
    if (a.rollout) opts.rollout = true;
    // Which layout of a listed circuit it was: one of its own, or one we do not list yet.
    if (a.layoutPick === '__new') opts.newLayout = true; else if (a.layoutPick) opts.layoutId = a.layoutPick;
    // Editing a saved session's map: the lines on the map, not the course's own.
    if (a.lineEdit) opts.ownLines = true;
    return opts;
  }
  function analyse() {
    var a = add;
    var opts = analysisOpts(a);
    a.session = T.analyse(a.rd, a.lib, opts);
    // A layout that came from the day this session is being added to, but is not a layout of the track the file is at, is dropped.
    if (a.layoutPick && a.layoutPick === a.layoutHint && !(a.session.venueId && venueLayouts(a, a.session).some(function (l) { return l.id === a.layoutPick; }))) {
      a.layoutPick = '';
      a.session = T.analyse(a.rd, a.lib, analysisOpts(a));
    }
    // A sprint or hill climb venue with several courses: never assume one. The member picks the organiser (or adds a new
    // one) before anything is timed or saved.
    a.session.needsLayoutPick = false;
    if (mustPickLayout(a, a.session)) {
      var ps = a.session;
      ps.needsLayoutPick = true;
      ps.laps = []; ps.bestTime = null; ps.best = null;
      delete ps.layoutId; delete ps.layout; delete ps.layoutPicked; delete ps.officialLines; delete ps.lapsFromTrace; delete ps.layoutLineGap;
      delete ps.startLine; delete ps.finishLine; delete ps.organizer;
      ps.problem = 'Pick which organiser ran ' + (ps.venue || 'this event') + '.';
    }
    // A hill climb, as picked or as the track list has it.
    if (a.session.type === 'sprint' && (a.hill || isHillSession(a.session, a.lib))) a.session.hill = true; else a.hill = false;
    // Kept so Re-time sessions can time it the same way later (on is the default).
    if (a.session.type === 'sprint' && a.ignoreFinish === false) a.session.ignoreFinish = false;
    // A date or start time the member typed wins over the file's.
    if (a.date) { a.session.date = a.date; a.session.dateFrom = 'member'; }
    // Adding to a day: a file with no date of its own (or only the day it was saved on the device) goes on that day.
    else if (a.dayHint && (!a.session.date || a.session.dateFrom === 'saved')) { a.session.date = a.dayHint; a.session.dateFrom = 'member'; }
    if (a.time) a.session.time = a.time;
    a.type = a.session.type;
    drawAdd();
    status('');
    fillTemp();
    lookupName();
  }
  // A track we don't know: look up its name from where it is (OpenStreetMap, via
  // the Overpass service), so the member only has to check it. Only the
  // position of the track, rounded to about 100 m, is sent.
  var nameCache = {};
  function lookupPoint(s) {
    var o = s.trace && s.trace.outline;
    if (o && o.length) { var m = o[Math.floor(o.length / 2)]; return [m[0], m[1]]; }
    return s.origin && s.origin.length === 2 ? s.origin : null;
  }
  function trackNameFromMap(lat, lng) {
    lat = Math.round(lat * 1000) / 1000; lng = Math.round(lng * 1000) / 1000;
    var key = lat + ',' + lng;
    if (nameCache[key] !== undefined) return Promise.resolve(nameCache[key]);
    var around = 'around:900,' + lat + ',' + lng;
    var q = '[out:json][timeout:8];(nwr(' + around + ')["highway"="raceway"]["name"];nwr(' + around + ')["leisure"="track"]["name"];nwr(' + around + ')["sport"~"^(motor|karting|motor_racing)$"]["name"];);out tags center 20;';
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 9000);
    return fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        clearTimeout(timer);
        var best = null, bd = Infinity;
        ((d && d.elements) || []).forEach(function (el) {
          var name = el.tags && String(el.tags.name || '').trim(), c = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null);
          if (!name || !c) return;
          // The nearest named track; a kart track is the last choice.
          var dist = T.haversine({ lat: lat, lng: lng }, { lat: c.lat, lng: c.lon }) + (/kart/i.test(name) || /kart/i.test(el.tags.sport || '') ? 500 : 0);
          if (dist < bd) { bd = dist; best = name; }
        });
        nameCache[key] = best ? best.slice(0, 60) : null;
        return nameCache[key];
      })
      .catch(function () { clearTimeout(timer); return null; });
  }
  function lookupName() {
    var a = add, s = a && a.session;
    if (!s || a.replaceId || s.venueId || (s.type !== 'track' && s.type !== 'sprint') || a.venueName || a.nameLooked) return;
    var pt = lookupPoint(s);
    if (!pt) return;
    a.nameLooked = true;
    trackNameFromMap(pt[0], pt[1]).then(function (name) {
      if (!name || add !== a || a.venueName) return;
      var el = document.getElementById('tp-venue-name');
      if (el && el.value.trim()) return;
      a.venueName = name; a.lookedName = name; a.venueNameLooked = true;
      if (el) {
        el.value = name;
        if (!document.getElementById('tp-name-src')) el.parentNode.insertAdjacentHTML('afterend', nameNote());
      }
      refreshAddNow(a);
    });
  }
  function nameNote() {
    return '<p class="tp-src" id="tp-name-src">' + icon('info') + '<span>Name found from the map (OpenStreetMap). Change it if it isn\'t right.</span></p>';
  }
  // A track day, sprint or drag run at a track, course or strip we do not list needs its name from the member: it is
  // what their list, the request to add it and the admin's view call it. Saving stops on an empty box and points at
  // it. A mapped drive (Other) can be saved without a place.
  var REQ = ' <span class="tp-req">(required)</span>';
  // ---------- The logger used ----------
  // Every session says which logger or app recorded it (required on the Add page, shown to everyone on the session).
  // The popular ones are listed; Other takes a typed name. The pick is guessed from the file, else it is the member's
  // last one.
  var LOGGERS = ['RaceBox', 'VBOX (Racelogic)', 'Tesla Track Mode', "Harry's LapTimer", 'TrackAddict', 'RaceChrono', 'AiM Solo', 'Garmin Catalyst', 'Dragy'];
  var LOGGER_MAX = 40;
  function loggerGuess(files) {
    var names = (files || []).map(function (f) { return String((f.f || f).name || ''); }).join(' ').toLowerCase();
    if (/racebox/.test(names)) return 'RaceBox';
    if (/telemetry-v1-|track.?mode/.test(names)) return 'Tesla Track Mode';
    if (/harry|\bhlt\b/.test(names)) return "Harry's LapTimer";
    if (/trackaddict/.test(names)) return 'TrackAddict';
    if (/racechrono/.test(names)) return 'RaceChrono';
    if (/\baim\b|solo/.test(names)) return 'AiM Solo';
    if (/garmin|catalyst/.test(names)) return 'Garmin Catalyst';
    if (/dragy/.test(names)) return 'Dragy';
    if (/\.vbo$|\.vbo\b/.test(names)) return 'VBOX (Racelogic)';
    return '';
  }
  // The member's most recent session that names its logger.
  function lastLogger(m) {
    var list = ((m && m.sessions) || []).filter(function (x) { return x.logger; })
      .sort(function (x, y) { return (y.date + (y.time || '')) < (x.date + (x.time || '')) ? -1 : 1; });
    return list.length ? list[0].logger : '';
  }
  // The select and the Other box, for the Add page (id tp-logger) and Session settings (tp-e-logger).
  function loggerFields(id, value, required) {
    var other = !!value && LOGGERS.indexOf(value) === -1;
    return '<div class="tp-field"><label for="' + id + '">Logger or app used' + (required ? REQ : '') + '</label><select class="field" id="' + id + '" data-logger' + (required ? ' required aria-required="true"' : '') + '>' +
      '<option value="">Choose the logger</option>' + LOGGERS.map(function (l) { return '<option value="' + esc(l) + '"' + (l === value ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') +
      '<option value="__other"' + (other ? ' selected' : '') + '>Other (type it in)</option></select>' +
      '<input class="field tp-logger-other" id="' + id + '-other" maxlength="' + LOGGER_MAX + '" placeholder="Name of the logger or app" aria-label="Name of the logger or app" value="' + esc(other ? value : '') + '"' + (other ? '' : ' hidden') + '></div>';
  }
  function loggerValue(id) {
    var sel = document.getElementById(id), oth = document.getElementById(id + '-other');
    if (!sel) return '';
    return sel.value === '__other' ? String((oth && oth.value) || '').trim().slice(0, LOGGER_MAX) : sel.value;
  }
  // The Other box shows when Other is picked; wired once per form.
  function wireLogger(id) {
    var sel = document.getElementById(id), oth = document.getElementById(id + '-other');
    if (!sel || !oth) return;
    sel.addEventListener('change', function () { oth.hidden = sel.value !== '__other'; if (!oth.hidden) oth.focus(); });
  }
  function loggerError(id) {
    var sel = document.getElementById(id), oth = document.getElementById(id + '-other'), el = sel && sel.value === '__other' ? oth : sel;
    if (!el) return;
    el.setAttribute('aria-invalid', 'true');
    status('Say which logger or app recorded this session first.', 'error');
    el.scrollIntoView({ block: 'center' }); el.focus();
  }
  function missingName() {
    var el = document.querySelector('#tp-result input[data-name-req]');
    return el && !el.value.trim() ? el : null;
  }
  function nameError(el) {
    el.setAttribute('aria-invalid', 'true');
    if (!document.getElementById('tp-name-err')) el.insertAdjacentHTML('afterend', '<p class="tp-err" id="tp-name-err" role="alert">Enter the name of the track to save this session.</p>');
    status('Enter the track name first.', 'error');
    el.scrollIntoView({ block: 'center' });
    el.focus();
  }
  function wireNameField() {
    var el = document.querySelector('#tp-result input[data-name-req]');
    if (el) el.addEventListener('input', function () {
      if (el.id === 'tp-venue-name') { add.venueName = el.value.trim(); refreshAddNow(add); }
      if (!el.value.trim()) return;
      el.removeAttribute('aria-invalid');
      var err = document.getElementById('tp-name-err');
      if (err) err.remove();
    });
  }
  // Air temperature: from the file when the logger records it, otherwise
  // looked up from Open-Meteo. Anything the member types wins.
  function fillTemp() {
    var a = add, s = a.session;
    if (!s || a.replaceId || (a.tempSource === 'member' && a.temp != null)) return;
    if (s.airTemp != null) {
      a.temp = s.airTemp; a.tempSource = 'file'; a.weather = null;
      if (document.getElementById('tp-result')) drawResult();
      return;
    }
    var key = (s.origin || []).join(',') + s.date + s.time;
    if (a.weatherKey === key) return;
    a.weatherKey = key;
    lookupWeather(s.origin, s.date, s.time).then(function (w) {
      if (!w || add !== a || a.weatherKey !== key || a.tempSource === 'member') return;
      a.temp = w.temp; a.tempSource = 'weather'; a.weather = w;
      if (!a.condTouched) a.conditions = weatherConditions(w);
      if (document.getElementById('tp-result')) drawResult();
    });
  }
  function canBoard() {
    var s = add.session;
    if (!s) return false;
    if (s.type === 'drag') return !!s.atVenue;
    if (s.type === 'other') return false;
    return !!(s.venueId && s.layoutId && s.laps && s.laps.length && !s.needsStartLine);
  }
  // What the file holds, so a member can see their data was picked up.
  function channelsHtml(a) {
    if (!a.rd || !T.fileChannels) return '';
    var c = T.fileChannels(a.rd);
    return '<p class="tp-small tp-chans" id="tp-chans"><b>In your file:</b> ' + esc(c.have.join(', ')) + '.' + (c.empty.length ? ' In the file but empty: ' + esc(c.empty.join(', ').toLowerCase()) + '.' : '') + '</p>';
  }
  // The sprint's ignore switch and "Run ends on" choice: shown while the lines are
  // being checked too, so the member can see the time change as they set them.
  function sprintControlsHtml(a, s, isSprint) {
    var out = '';
    if (isSprint) out += '<button type="button" class="tp-switch" role="switch" aria-checked="' + (a.ignoreFinish !== false) + '" id="tp-ignore-finish"><span><b>Ignore the first time each run crosses the finish line</b><br><small>' + (s.firstFinishIgnored ? 'Skipped the first crossing on ' + s.firstFinishIgnored + ' run' + (s.firstFinishIgnored === 1 ? '' : 's') + ' in this file. Turn it off if a run is missing or ends too late.' : 'Only a run that crosses the finish line more than once has a crossing to skip. Turn this off if a run is missing.') + '</small></span><span class="tp-track"></span></button>';
    if (isSprint) out += '<div class="tp-field"><label for="tp-finish-cross">Run ends on</label><select class="field" id="tp-finish-cross"><option value="">Automatic (see the switch above)</option>' + [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (a.finishCross === n ? ' selected' : '') + '>Crossing ' + n + ' of the finish line</option>'; }).join('') + '</select><p class="tp-small">If the ' + VW + ' passes the finish line before the run really ends, choose which crossing finishes the timing. It counts from the start line.</p></div>';
    return out;
  }
  // For the admin: which sprint courses the page knows near this file, and why none matched.
  function courseDebugHtml(a, s) {
    var o = s.origin;
    if (!o || o.length !== 2 || !a.lib) return '';
    var near = (a.lib.venues || []).filter(function (v) { return v.type === (s.type === 'sprint' ? 'sprint' : 'circuit'); }).map(function (v) { return { v: v, d: Math.round(T.haversine({ lat: o[0], lng: o[1] }, v)) }; }).sort(function (x, y) { return x.d - y.d; }).slice(0, 2);
    return '<p class="tp-small tp-debug">Admin: ' + (a.lib.venues || []).length + ' tracks are loaded. ' + (near.length ? 'Nearest ' + (s.type === 'sprint' ? 'sprint' : 'circuit') + ' venues: ' + near.map(function (n) { var withLines = (n.v.layouts || []).filter(function (l) { return l.startLine && (s.type !== 'sprint' || l.finishLine); }).length; return esc(n.v.name) + ' (' + n.d + ' m away, radius ' + (n.v.radius || '?') + ' m, ' + withLines + ' of ' + (n.v.layouts || []).length + ' courses with lines)'; }).join('; ') + '.' : 'No venue of this type is listed.') + '</p>';
  }
  function drawResult() {
    var a = add, s = a.session, box = document.getElementById('tp-result');
    if (!(s.needsStartLine || a.editLines) && a.tapFull) { a.tapFull = false; document.body.classList.remove('tp-noscroll'); }
    var h = '<div class="card tp-fields">';
    if (!a.lineEdit) h += '<div class="tp-field"><span class="tp-lbl">Type</span><div class="tp-chips" data-type>' + typeChips(s, isHillSession(s, a.lib) || !!a.hill) + '</div></div>';
    // The track name and the date come first: they are the first things to check.
    var topDate = '';
    if (!a.replaceId) {
      // The date and start time: from the file, its name, or the member. The
      // weather lookup needs them, and the session is saved on that date.
      topDate = '<div class="tp-f2"><div class="tp-field"><label for="tp-date">Date</label><input class="field" type="date" id="tp-date" max="' + esc(ukToday()) + '" value="' + esc(s.date || '') + '"></div>' +
        '<div class="tp-field"><label for="tp-time">Start time</label><input class="field" type="time" id="tp-time" value="' + esc(s.time || '') + '"></div></div>' +
        (s.dateFrom === 'name' ? '<p class="tp-src" id="tp-date-src">' + icon('info') + '<span>Date and time from the file name. Change them if they\'re not right.</span></p>'
          : s.dateFrom === 'saved' ? '<p class="tp-src" id="tp-date-src">' + icon('info') + '<span>Your file has no date in it, so these are from when it was saved on your device. Change them if they\'re not right.</span></p>'
          : s.dateFrom === 'file' ? '<p class="tp-src" id="tp-date-src">' + icon('info') + '<span>Date and time recorded in your file.</span></p>'
          : !s.date ? '<p class="tp-src" id="tp-date-src">' + icon('info') + '<span>Your file has no date in it. Add the date and start time to look up the weather.</span></p>' : '');
    }
    if (!s.venueId && (s.type === 'track' || s.type === 'sprint')) h += '<div class="tp-field"><label for="tp-venue-name">Track name' + REQ + '</label><input class="field" id="tp-venue-name" data-name-req placeholder="For example, Blyton Park" value="' + esc(a.venueName || '') + '" required aria-required="true"></div>' + (a.venueNameLooked ? nameNote() : '');
    h += topDate;
    if (a.dayHint && !a.replaceId) h += s.date === a.dayHint
      ? '<p class="tp-src" id="tp-day-hint">' + icon('info') + '<span>Adding a session to ' + niceDate(a.dayHint) + '.' + (s.dateFrom === 'member' && !a.date ? ' Your file has no date of its own, so it is saved on that day.' : '') + '</span></p>'
      : '<div class="tp-notice is-warn" id="tp-day-hint">' + icon('warn') + '<div>This file is from ' + niceDate(s.date) + ', not ' + niceDate(a.dayHint) + '. It is saved on its own day. Change the date above if that is not right.</div></div>';
    h += layoutFieldHtml(a, s);
    h += channelsHtml(a);
    var isSprint = s.type === 'sprint', word = isSprint ? 'run' : 'lap';
    if (isSprint) {
      // Who ran the event: courses at one venue can have different start and finish lines. At a listed venue the
      // organisers it already has are a drop-down (typing a new name used to send the member straight to the map);
      // Add a new organiser opens a name box and, when the venue has courses with lines, a choice of which course's
      // start and finish to use, so a new organiser on a known course is timed at once.
      var orgs = [], courses = [];
      ((a.lib && a.lib.venues) || []).forEach(function (vv) {
        if (vv.type !== 'sprint' || (s.venueId ? vv.id !== s.venueId : true)) return;
        (vv.layouts || []).forEach(function (l) {
          var o = String(l.organizer || '').trim();
          if (o && orgs.indexOf(o) === -1) orgs.push(o);
          if (l.startLine && l.finishLine) courses.push({ id: l.id, name: o || l.name || 'the listed course', start: l.startLine, finish: l.finishLine });
        });
      });
      var cur = a.organizer || s.organizer || '', help = '<p class="tp-small">Who ran the sprint. Courses at one venue can have different start and finish lines, so this keeps results comparable.</p>';
      if (s.venueId && (orgs.length || courses.length)) {
        var isNew = !!a.orgNew || (cur && orgs.indexOf(cur) === -1);
        h += '<div class="tp-field"><label for="tp-organiser">Organiser</label><select class="field" id="tp-organiser"><option value=""' + (!isNew && !cur ? ' selected' : '') + '>Choose an organiser</option>' +
          orgs.map(function (o) { return '<option value="' + esc(o) + '"' + (!isNew && o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
          '<option value="__new"' + (isNew ? ' selected' : '') + '>Add a new organiser</option></select>' + help + '</div>';
        if (isNew) {
          h += '<div class="tp-field"><label for="tp-organiser-new">New organiser</label><input class="field" id="tp-organiser-new" autocomplete="off" maxlength="40" placeholder="For example, B19" value="' + esc(cur) + '"></div>';
          if (courses.length) {
            var from = a.orgFrom === undefined || a.orgFrom === null ? courses[0].id : a.orgFrom;
            h += '<div class="tp-field"><label for="tp-org-lines">Start and finish lines</label><select class="field" id="tp-org-lines">' +
              courses.map(function (c) { return '<option value="' + esc(c.id) + '"' + (from === c.id ? ' selected' : '') + '>Same as ' + esc(c.name) + '</option>'; }).join('') +
              '<option value=""' + (from === '' ? ' selected' : '') + '>Set them on the map</option></select><p class="tp-small">A new organiser usually runs the same course: use its lines and MT3UK will add the course. Pick Set them on the map if theirs differ.</p></div>';
          }
        }
      } else {
        h += '<div class="tp-field"><label for="tp-organiser">Organiser</label><input class="field" id="tp-organiser" list="tp-organisers" autocomplete="off" placeholder="For example, B19" value="' + esc(cur) + '"><datalist id="tp-organisers">' + orgs.map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist>' + help + '</div>';
      }
    }
    if (s.type === 'other') {
      h += '<div class="tp-notice is-ok">' + icon('check') + '<div><b>' + esc(s.venue || 'Your drive') + '</b><br>Mapped with your top speed and grip. Other sessions aren\'t timed for a leaderboard.' + (s.laps && s.laps.length ? ' ' + s.laps.length + ' laps found too.' : '') + '</div></div>' +
        (!s.venueId ? '<div class="tp-field"><label for="tp-venue-name">Where was it?</label><input class="field" id="tp-venue-name" placeholder="For example, Autotest at Curborough" value="' + esc(a.venueName || '') + '"></div>' : '');
    } else if (s.type === 'track' || isSprint) {
      if (s.needsStartLine || a.editLines) {
        var tapText = tapHint(a, isSprint), hasMarks = !!(a.startLine || a.finishLine);
        var timedNow = s.needsStartLine ? 0 : (s.laps || []).filter(function (l) { return l.kind === 'timed'; }).length;
        h += (s.needsStartLine ? '<div class="tp-notice is-warn">' + icon('pin') + '<div><b>' + esc(s.venue || (isSprint ? 'New course' : 'New track')) + '</b><br>' + esc(s.problem) + (a.admin ? courseDebugHtml(a, s) : '') + '</div></div>'
          : '<div class="tp-notice is-ok">' + icon('check') + '<div>' + timedNow + ' timed ' + word + (timedNow === 1 ? '' : 's') + (s.bestTime ? ', best ' + V.fmtLap(s.bestTime) : '') + '. ' + (a.confirmLines ? (isSprint ? '<b>Confirm correct Start and Finish lines.</b> Check they are where the run really started and finished. Drag a marker if one is out, then tick the button.' : '<b>Confirm the Start and Finish line is correct.</b> Drag the marker if it is out, then tick the button.') : 'Drag a marker to move it, then press Done.') + '</div></div>') +
          (!s.needsStartLine ? sprintControlsHtml(a, s, isSprint) : '') +
          '<p class="tp-small">Zoom in with the + button, the mouse wheel or a pinch. Drag the map with any mouse button to move it. A quick click or tap places a marker, and a marker can be dragged along the track.</p>' +
          '<div class="tp-tapbox' + (a.tapFull ? ' is-full' : '') + '" id="tp-tapbox"><p class="tp-sub tp-tap-step" id="tp-tap-step">' + tapText + '</p><div class="tp-tapmap" id="tp-tapmap"><svg class="tv-chart tp-tap" id="tp-tap" role="img" aria-label="Your trace. ' + tapText + '"></svg></div>' +
          '<div class="tp-tap-tools"><button type="button" class="btn btn-secondary btn-sm" data-tap="undo"' + (hasMarks ? '' : ' disabled') + '>' + icon('rewind') + 'Undo last marker</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-tap="clear"' + (hasMarks ? '' : ' disabled') + '>' + icon('x') + 'Clear markers</button>' +
          (!isSprint && s.needsStartLine ? '<button type="button" class="btn btn-secondary btn-sm" data-tap="sprint">' + icon('pin') + 'Separate start and finish</button>' : '') +
          '<button type="button" class="btn btn-secondary btn-sm" data-tap="full">' + icon(a.tapFull ? 'x' : 'expand') + (a.tapFull ? 'Exit full screen' : 'Full screen') + '</button>' +
          (a.editLines && !s.needsStartLine ? (a.confirmLines ? '<button type="button" class="btn btn-secondary tp-confirm" data-tap="done" role="switch" aria-checked="false">' + icon('check') + 'Correct lines?</button>' : '<button type="button" class="btn btn-primary btn-sm" data-tap="done">' + icon('check') + 'Done</button>') : '') + '</div></div>';
      } else if (s.needsLayoutPick) {
        h += '<div class="tp-notice is-warn" id="tp-pick-layout">' + icon('warn') + '<div><b>Which organiser was it?</b><br>' + esc(s.venue || 'This track') + ' has more than one course, so choose the organiser above before your runs are timed. If the organiser is not listed, choose Add a new organiser.</div></div>';
      } else {
        var timed = s.laps.filter(function (l) { return l.kind === 'timed'; }).length;
        h += '<div class="tp-notice is-ok">' + miniMap(s) + '<div><b>' + esc(s.venue ? trackName(s) : (a.venueName || 'Your track')) + '</b><br>' +
          (s.autoLine ? 'No start line is set for this track, so your laps were found from your own trace. ' : s.officialLines ? 'Timed with this course\'s official ' + (isSprint ? 'start and finish lines' : 'start line') + ', which only MT3UK sets so results stay comparable. ' : s.venueId ? 'Found from the GPS in your file. ' : isSprint ? 'Timed between the start and finish you picked. ' : 'Timed from the start line you picked. ') + timed + ' timed ' + word + (timed === 1 ? '' : 's') + (s.bestTime ? ', best ' + V.fmtLap(s.bestTime) : '') + '.</div></div>';
        // A pass with a long stop in the middle is not a lap: this is probably a sprint or hill climb file.
        var lapTimes = (s.laps || []).filter(function (l) { return l.kind === 'timed'; }).map(function (l) { return l.time; });
        var gapLap = !isSprint && s.type === 'track' && (s.laps || []).some(function (l) { return l.kind === 'slow' && lapTimes.length && l.time > 3 * Math.min.apply(null, lapTimes); });
        if (isSprint) h += reverseHtml(s);
        // A day of laps with the logger running between sessions (a VBOX does) is not a sprint file: the gaps are just left out.
        if (gapLap && lapTimes.length >= 6) h += '<div class="tp-notice">' + icon('info') + '<div><b>The ' + VW + ' was parked between sessions.</b><br>The logger kept recording while it was stopped. Those gaps are not laps, so they are left out. Your ' + lapTimes.length + ' timed laps are not affected.</div></div>';
        else if (gapLap) h += '<div class="tp-notice is-warn">' + icon('warn') + '<div><b>The ' + VW + ' stopped for a long time between passes.</b><br>That is not a lap, so it is left out. If these were sprint or hill climb runs, switch the type to time each run from the start to the finish. <button type="button" class="btn btn-secondary btn-sm" data-tap="sprint">Switch to Sprint</button> <button type="button" class="btn btn-secondary btn-sm" data-tap="hill">Switch to Hill climb</button></div></div>';
        if ((a.startLine || a.finishLine || s.startLine) && !s.officialLines && !s.autoLine && !s.lapsFromTrace) h += '<button type="button" class="btn btn-secondary btn-sm tp-move-lines" data-tap="edit">' + icon('pin') + 'Move ' + (isSprint ? 'start and finish' : 'the start line') + '</button>';
        h += sprintControlsHtml(a, s, isSprint);
        h += addNowHtml(a, s, isSprint);
        h += layoutGapHtml(a, s);
        h += lapsFromTraceHtml(a, s);
        h += linePreviewHtml(a, s);
        // The admin can make the lines just set the official ones, so the course is remembered for everyone.
        // Not at a listed circuit with no layout picked: that would add a layout named after the circuit. There, Add this layout now asks for a name.
        if (a.admin && s.startLineFromMember && s.startLine && (isSprint ? s.finishLine : !s.venueId || s.layoutId)) h += '<div class="tp-notice is-admin" id="tp-official-box">' + icon('shield') + '<div>Admin: make these the official ' + (isSprint ? 'start and finish lines' : 'start line') + ' for this course, so every file uploaded there uses them. <button type="button" class="btn btn-secondary btn-sm" id="tp-make-official">Make official</button></div></div>';
        if (s.venueId && !s.layoutId && !a.addNow) h += '<p class="tp-sub">We know ' + esc(s.venue) + ' but couldn\'t tell which layout this is, so it can\'t go on a leaderboard yet. We\'ve let the admin know.</p>';
      }
    } else {
      var runs = s.runs || [];
      if (!runs.length) h += '<div class="tp-notice is-warn">' + icon('warn') + '<div><b>No drag run found</b><br>' + esc(s.problem || '') + '</div></div>';
      else if (s.atVenue) h += '<div class="tp-notice is-ok">' + icon('check') + '<div><b>' + esc(s.venue) + '</b><br>' + runs.length + ' run' + (runs.length === 1 ? '' : 's') + ' from the strip. ' + bestRunLine(runs) + '</div></div>';
      else {
        h += '<div class="tp-notice is-warn">' + icon('warn') + '<div><b>We couldn\'t find a drag strip here</b><br>Drag runs can only be saved from a venue. If you were at one we don\'t list, tell us below and we\'ll add it.</div></div>';
        if (a.admin) h += '<div class="tp-notice is-admin">' + icon('shield') + '<div>Admin only option.</div></div><button type="button" class="tp-switch" role="switch" aria-checked="' + a.street + '" id="tp-street"><span><b>Include as a street run</b><br><small>Kept private, never on a leaderboard or build page.</small></span><span class="tp-track"></span></button>';
      }
    }
    if (s.type === 'drag' && (s.runs || []).length) {
        h += '<button type="button" class="tp-switch" role="switch" aria-checked="' + !!a.rollout + '" id="tp-rollout"><span><b>1 ft rollout</b><br><small>Start the clock just after the ' + VW + ' starts to move, where RaceBox\'s option puts it. Off times from the first movement.</small></span><span class="tp-track"></span></button>';
    }
    h += lineFiguresHtml(a, s);
    var saveable = s.type === 'drag' ? (s.runs || []).length : s.type === 'other' ? true : !s.needsStartLine && s.laps && s.laps.length;
    if (saveable && a.lineEdit) {
      var oL = a.oldLines || {}, moved = llText(a.startLine || s.startLine) !== llText(oL.startLine) || (s.type === 'sprint' && llText(a.finishLine || s.finishLine) !== llText(oL.finishLine));
      if (a.sent) {
        h += '<div id="tp-sent"><div class="tp-notice is-ok" role="status">' + icon('check') + '<div><b>Sent for approval</b><br>MT3UK has been told and will email you. Your session stays as it is until MT3UK has approved the change.</div></div>' +
          '<button type="button" class="btn btn-primary btn-block" id="tp-sent-close">' + icon('check') + 'Close</button></div>';
      } else {
        h += '<button type="button" class="btn btn-secondary btn-block" id="tp-undo-lines"' + (moved ? '' : ' disabled') + '>' + icon('rewind') + 'Undo changes</button>';
        h += '<button type="button" class="btn btn-accent btn-block" id="tp-save">Send for approval</button><p class="tp-small">MT3UK checks the change before the map is updated. You will be emailed.</p>';
      }
    } else if (saveable && a.replaceId) {
      h += '<button type="button" class="btn btn-accent btn-block" id="tp-save">Save changes</button>';
    } else if (saveable) {
      h += loggerFields('tp-logger', a.logger || '', true) +
        '<div class="tp-field"><span class="tp-lbl">Conditions</span><div class="tp-chips" data-cond>' + ['Dry', 'Damp', 'Wet'].map(function (c) { return '<button type="button" class="chip' + (a.conditions === c ? ' is-on' : '') + '" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div></div>' +
        tyreFields('tp-tyre', a.tyre) + (a.tyrePre && a.tyre ? '<p class="tp-small tp-tyre-note">Filled in from your last session with this ' + VW + '. Change it if it is different.</p>' : (a.lastTyre && !(a.tyre && (a.tyre.make || a.tyre.model || a.tyre.w)) ? '<p class="tp-small tp-tyre-note" id="tp-tyre-offer">Same tyres as last time (' + esc(TY.compose(a.lastTyre)) + ')? <button type="button" class="btn btn-secondary btn-sm" id="tp-use-last-tyres">Use previous tyres</button></p>' : '')) +
        padFields('tp-pad', a.pads, a.padsFromCar ? 'Filled in from ' + esc(a.car ? a.car.name : 'your car') + ' in My Garage. Change them if you ran something different on this day; your garage is not changed.' : '') +
        driveFields(a) + '<div class="tp-field"><label for="tp-temp">Air temperature (°C)</label><input class="field" id="tp-temp" inputmode="numeric" placeholder="18" value="' + esc(a.temp == null ? '' : a.temp) + '"></div>' +
        (a.tempSource === 'weather' && a.weather ? '<p class="tp-src" id="tp-temp-src">' + icon('info') + '<span>' + weatherNote(a.weather, s.venue) + (a.condTouched ? '' : ' Conditions set to match. Change them if the track was different.') + '</span></p>'
          : a.tempSource === 'file' ? '<p class="tp-src" id="tp-temp-src">' + icon('info') + '<span>From the air temperature recorded in your file.</span></p>' : '') +
        '<div class="tp-field"><label for="tp-notes">Private notes (only you see these)</label><input class="field" id="tp-notes" placeholder="Pressures, set-up, traffic..." value="' + esc(a.notes || '') + '"></div>' +
        '<div class="tp-field"><label for="tp-public-note">Public note (one sentence, shown at the top of the session to everyone who opens it)</label><input class="field" id="tp-public-note" maxlength="' + PUBLIC_NOTE_MAX + '" placeholder="Red flag mid-session, new tyres, first time here..." value="' + esc(a.publicNote || '') + '"></div>' +
        '<div class="tp-field"><span class="tp-lbl">Who can see it</span><div class="tp-privacy" data-privacy>' + privacyOptions(a.privacy, a.street || (s.type === 'drag' && !s.atVenue) ? 'street' : canBoard() ? '' : 'noboard') + '</div></div>' +
        (s.type === 'drag' && !s.atVenue && !a.street ? '<div class="tp-field"><label for="tp-req-name">Which drag strip were you at?' + REQ + '</label><input class="field" id="tp-req-name" data-name-req placeholder="Name of the venue" value="' + esc(a.venueName || '') + '" required aria-required="true"><p class="tp-small">You can save it now. It stays private and off every leaderboard until the strip is added, and MT3UK is told about it.</p></div>' : '') +
        '<button type="button" class="btn btn-accent btn-block" id="tp-save">Save session</button>';
    } else if ((s.type === 'track' || s.type === 'sprint') && s.needsStartLine) {
      h += '<div class="tp-notice"><div><b>Cannot time it yet?</b><br>Save it without times. It stays private, and MT3UK is told about the course so it can be added. Once it is, open the session, go to Session settings and change the type to ' + (s.type === 'sprint' ? 'Sprint or hill climb' : 'Track day') + ' to time it.</div></div><button type="button" class="btn btn-secondary btn-block" id="tp-save-untimed">Save without times, tell MT3UK</button>';
    } else if (s.type === 'drag' && (s.runs || []).length && !s.atVenue) {
      h += '<div class="tp-field"><label for="tp-req-name">Which drag strip were you at?</label><input class="field" id="tp-req-name" placeholder="Name of the venue"></div><button type="button" class="btn btn-secondary btn-block" id="tp-req">Ask for it to be added</button>';
    }
    h += '</div>';
    box.innerHTML = h;
    wireResult();
    if (s.needsStartLine || a.editLines) drawTap(); else drawLinePreview();
    var mv = box.querySelector('[data-tap="edit"]');
    if (mv) mv.addEventListener('click', function () {
      // Lines that came from the file or a known course become markers to move.
      var cur = add.session || {};
      if (!add.startLine && !add.finishLine && cur.startLine) { add.startLine = cur.startLine; add.finishLine = cur.type === 'sprint' ? cur.finishLine || null : null; }
      add.editLines = true; add.confirmLines = false; drawResult(); var tb = document.getElementById('tp-tapbox'); if (tb) tb.scrollIntoView({ block: 'nearest' }); });
  }
  function bestRunLine(runs) {
    var q = runs.filter(function (r) { return r.quarter; }).sort(function (x, y) { return x.quarter - y.quarter; })[0];
    var b = runs.filter(function (r) { return r.s60; }).sort(function (x, y) { return x.s60 - y.s60; })[0];
    return q ? 'Best quarter mile ' + q.quarter.toFixed(2) + ' s at ' + V.fmtV(q.quarterSpeed) + '.' : b ? 'Best 0 to 60 mph ' + b.s60.toFixed(2) + ' s.' : runs.length + ' runs, none reached 60 mph.';
  }
  // Only me, or Shared (on the car's page and the track's leaderboard).
  // Older sessions saved as "build" count as Shared.
  function privacyOptions(on, limit) {
    if (on === 'build') on = 'board';
    var opts = [['private', 'Only me', 'The default. Only you, and MT3UK\'s admin if you ask for help.'],
      ['board', 'Shared', limit === 'noboard' ? 'Members see it on your ' + VW + '\'s page. This track has no leaderboard yet.' : 'Members see it on your ' + VW + '\'s page and on this track\'s leaderboard, with your ' + VW + ' and mods.']];
    if (limit === 'street') opts = opts.slice(0, 1);
    return opts.map(function (o) {
      return '<button type="button" class="tp-opt' + (on === o[0] ? ' is-on' : '') + '" data-v="' + o[0] + '"><span class="tp-dot"></span><span><b>' + o[1] + '</b><span>' + o[2] + '</span></span></button>';
    }).join('');
  }
  function miniMap(s) {
    var tr = s.trace && s.trace.laps && s.trace.laps[s.best || (s.laps[0] && s.laps[0].n)];
    if (!tr) return icon('check');
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    tr.forEach(function (p) { x0 = Math.min(x0, p[2]); x1 = Math.max(x1, p[2]); y0 = Math.min(y0, p[3]); y1 = Math.max(y1, p[3]); });
    var sc = Math.min(56 / ((x1 - x0) || 1), 40 / ((y1 - y0) || 1));
    var pts = tr.filter(function (_, i) { return i % 3 === 0; }).map(function (p) { return (4 + (p[2] - x0) * sc).toFixed(1) + ',' + (44 - (p[3] - y0) * sc).toFixed(1); }).join(' ');
    return '<svg class="tp-mini" viewBox="0 0 64 48" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  }
  function wireResult() {
    var a = add;
    function group(sel, fn) {
      var g = document.querySelector(sel);
      if (g) g.addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (b && !b.disabled) fn(b.getAttribute('data-v')); });
    }
    function keep() {
      var pd = readPads('tp-pad'); if (pd) { a.pads = pd; }
      if (document.getElementById('tp-logger')) { var lgv = loggerValue('tp-logger'); if (lgv !== (a.logger || '')) a.loggerTouched = true; a.logger = lgv; }
      var ty = readTyre('tp-tyre');
      if (ty) { var nt2 = TY.compose(ty); if (a.tyrePre && nt2 !== a.tyres) a.tyrePre = false; a.tyre = ty; a.tyres = nt2; }
      ['temp', 'notes', 'public-note', 'venue-name', 'layout-name'].forEach(function (k) {
        var el = document.getElementById('tp-' + k);
        if (!el) return;
        if (k === 'temp') {
          var tv = el.value.trim() === '' ? null : parseFloat(el.value);
          if (tv !== a.temp) { a.tempSource = tv == null ? '' : 'member'; a.weather = null; }
          a.temp = tv;
        }
        else if (k === 'layout-name') a.layoutName = el.value.trim().slice(0, 40);
        else if (k === 'public-note') a.publicNote = el.value.trim().slice(0, PUBLIC_NOTE_MAX);
        else if (k === 'venue-name') { a.venueName = el.value.trim(); if (a.venueNameLooked && a.venueName !== a.lookedName) a.venueNameLooked = false; }
        else a[k] = el.value.trim();
      });
    }
    group('[data-type]', function (v) { keep(); var hillPick = v === 'hill'; if (hillPick) v = 'sprint'; var hillChanged = v === 'sprint' && !!a.hill !== hillPick; a.hill = hillPick; if (hillChanged && v === a.type) { if (a.session) { if (hillPick) a.session.hill = true; else delete a.session.hill; } drawAdd(); return; } if (v !== a.type) { a.type = v; a.startLine = null; a.finishLine = null; a.editLines = false; a.confirmLines = false; a.tapFull = false; a.tapAuto = false; analyse(); } });
    ['tp-date', 'tp-time'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        keep();
        var v = el.value;
        if (id === 'tp-date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return; a.date = v; a.session.date = v; a.session.dateFrom = 'member'; }
        else { a.time = v; a.session.time = v; }
        // Look the weather up again for the new date or hour.
        a.weatherKey = null;
        if (a.tempSource !== 'member') { a.temp = null; a.tempSource = ''; a.weather = null; }
        drawResult();
        fillTemp();
      });
    });
    group('[data-cond]', function (v) { keep(); a.conditions = v; a.condTouched = true; drawResult(); });
    wireLogger('tp-logger');
    group('[data-drive]', function (v) { a.drive = a.drive === v ? '' : v; document.querySelectorAll('[data-drive] button[data-v]').forEach(function (x) { var on = x.getAttribute('data-v') === a.drive; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); }); });
    group('[data-privacy]', function (v) { keep(); a.privacy = v; drawResult(); });
    group('[data-layout]', function (v) {
      keep();
      a.layoutPick = v; a.layoutName = v === '__new' ? a.layoutName : ''; a.addNow = false; a.editLines = false; a.confirmLines = false; a.tapFull = false;
      // Never start from the lines of a listed layout: a new layout takes the file's own line or the one the member marks.
      a.startLine = null; a.finishLine = null;
      analyse();
      // No line in the file: offer the one found from the trace (the main straight, usually) to confirm or move.
      if (v === '__new' && a.session && a.session.needsStartLine && a.session.suggestedLine) { a.startLine = a.session.suggestedLine; linesChanged(); }
    });
    var orgIn = document.getElementById('tp-organiser'), orgNew = document.getElementById('tp-organiser-new'), orgLines = document.getElementById('tp-org-lines');
    // A new organiser on a known course: start from that course's lines (copied, so the parser times the run on the
    // member's own lines and the course is requested with them); Set them on the map clears them for the map picker.
    function orgLinesFrom() {
      var id = a.orgFrom, c = null;
      if (id) ((a.lib && a.lib.venues) || []).forEach(function (vv) { if (vv.id === (a.session && a.session.venueId)) (vv.layouts || []).forEach(function (l) { if (l.id === id && l.startLine && l.finishLine) c = l; }); });
      a.startLine = c ? JSON.parse(JSON.stringify(c.startLine)) : null;
      a.finishLine = c ? JSON.parse(JSON.stringify(c.finishLine)) : null;
      a.confirmLines = false; a.editLines = false;
    }
    if (orgIn && orgIn.tagName === 'SELECT') orgIn.addEventListener('change', function () {
      keep();
      if (orgIn.value === '__new') { a.orgNew = true; a.organizer = ''; if (a.orgFrom === undefined || a.orgFrom === null) a.orgFrom = null; a.startLine = null; a.finishLine = null; drawAdd(); var nn = document.getElementById('tp-organiser-new'); if (nn) nn.focus(); return; }
      a.orgNew = false; a.orgFrom = null; a.organizer = orgIn.value.trim().slice(0, 40); a.startLine = null; a.finishLine = null; analyse();
    });
    else if (orgIn) orgIn.addEventListener('change', function () { keep(); a.organizer = orgIn.value.trim().slice(0, 40); analyse(); });
    if (orgNew) orgNew.addEventListener('change', function () {
      keep(); a.organizer = orgNew.value.trim().slice(0, 40);
      if (orgLines && (a.orgFrom === undefined || a.orgFrom === null)) a.orgFrom = orgLines.value;
      orgLinesFrom(); analyse();
    });
    if (orgLines) orgLines.addEventListener('change', function () { keep(); a.orgFrom = orgLines.value; orgLinesFrom(); analyse(); });
    var sentClose = document.getElementById('tp-sent-close');
    if (sentClose) sentClose.addEventListener('click', function () { go('s=' + a.replaceId, false, true); });
    var undoLines = document.getElementById('tp-undo-lines');
    if (undoLines) undoLines.addEventListener('click', function () {
      var o = a.oldLines || {};
      a.startLine = o.startLine || null; a.finishLine = o.finishLine || null;
      status('Back to the old lines.', '');
      linesChanged();
    });
    document.querySelectorAll('[data-copy-line]').forEach(function (b) { b.addEventListener('click', function () { copyText(b.getAttribute('data-copy-line'), b); }); });
    var rollSw = document.getElementById('tp-rollout');
    if (rollSw) rollSw.addEventListener('click', function () { keep(); a.rollout = !a.rollout; analyse(); });
    var untimedBtn = document.getElementById('tp-save-untimed');
    if (untimedBtn) untimedBtn.addEventListener('click', function () {
      keep();
      var miss0 = missingName();
      if (miss0) { nameError(miss0); return; }
      if (document.getElementById('tp-logger') && !loggerValue('tp-logger')) { loggerError('tp-logger'); return; }
      var s0 = a.session, nameEl = document.getElementById('tp-venue-name'), name = (nameEl && nameEl.value.trim()) || a.venueName || s0.venue || '';
      var o0 = s0.origin || [], ol = ((s0.trace && s0.trace.outline) || []).filter(function (_, i) { return i % 4 === 0; }).map(function (q) { return [q[0], q[1]]; });
      untimedBtn.disabled = true;
      api('POST', '/track/requests', { kind: s0.type === 'sprint' ? 'sprint' : 'circuit', hill: s0.type === 'sprint' && isHillSession(s0, a.lib), name: name, venueId: s0.venueId || '', organizer: s0.type === 'sprint' ? (a.organizer || '') : '', startLine: a.startLine || null, finishLine: a.finishLine || null, lat: o0[0], lng: o0[1], outline: ol, note: 'Saved without times: the course or its lines are not set up' }).catch(function () {});
      // Saved as a mapped drive. Changing its type to Sprint or Track day later times it.
      a.pendingCourse = name || 'this course'; a.venueName = name; a.type = 'other';
      analyse();
      saveSession(untimedBtn);
    });
    var offBtn = document.getElementById('tp-make-official');
    if (offBtn) offBtn.addEventListener('click', function () {
      keep();
      var s2 = a.session, nameEl = document.getElementById('tp-venue-name'), laps = (s2.laps || []).filter(function (l) { return l.n === s2.best; })[0];
      offBtn.disabled = true;
      api('POST', '/track/admin/course', { kind: s2.type === 'sprint' ? 'sprint' : 'circuit', hill: s2.type === 'sprint' && isHillSession(s2, a.lib), name: (nameEl && nameEl.value.trim()) || a.venueName || s2.venue || '', organizer: a.organizer || s2.organizer || '', venueId: s2.venueId || '', layoutId: s2.type === 'sprint' ? '' : s2.layoutId || '', startLine: s2.startLine, finishLine: s2.finishLine || null, lapLength: laps && laps.dist ? laps.dist : 0, lat: s2.origin && s2.origin[0], lng: s2.origin && s2.origin[1] }).then(function (d) {
        if (!d.success) { offBtn.disabled = false; status(d.message || 'Could not make that official.', 'error'); return; }
        // The course now exists: this file (and every other) is timed on its lines.
        a.lib = d.library; a.startLine = null; a.finishLine = null; a.editLines = false; a.confirmLines = false;
        analyse();
        status('Official lines saved. ' + d.relinked + ' of your saved sessions were linked to them.', 'ok');
      }).catch(function () { offBtn.disabled = false; status('Could not reach the server.', 'error'); });
    });
    [].slice.call(document.querySelectorAll('#tp-result .tp-notice [data-tap="sprint"], #tp-result .tp-notice [data-tap="hill"]')).forEach(function (hintBtn) {
    hintBtn.addEventListener('click', function () { keep(); a.hill = hintBtn.getAttribute('data-tap') === 'hill'; a.type = 'sprint'; a.startLine = null; a.finishLine = null; a.editLines = false; a.confirmLines = false; a.tapFull = false; a.tapAuto = false; analyse(); });
    });
    var useLast = document.getElementById('tp-use-last-tyres');
    if (useLast) useLast.addEventListener('click', function () { keep(); a.tyre = a.lastTyre; a.tyres = TY.compose(a.lastTyre); a.tyrePre = true; drawResult(); });
    var fcSel = document.getElementById('tp-finish-cross');
    if (fcSel) fcSel.addEventListener('change', function () { keep(); a.finishCross = fcSel.value ? parseInt(fcSel.value, 10) : 0; analyse(); });
    var ig = document.getElementById('tp-ignore-finish');
    if (ig) ig.addEventListener('click', function () { keep(); a.ignoreFinish = a.ignoreFinish === false; analyse(); });
    var rb = document.getElementById('tp-result');
    if (rb) rb._keep = keep;
    if (rb && !rb._addNowWired) {
      rb._addNowWired = true;
      rb.addEventListener('click', function (e) { if (e.target.closest('#tp-addnow') && add) { rb._keep(); add.addNow = !add.addNow; drawResult(); } });
    }
    var st = document.getElementById('tp-street');
    if (st) st.addEventListener('click', function () { keep(); a.street = !a.street; if (a.street) a.privacy = 'private'; drawResult(); });
    wireTyres('tp-tyre');
    wirePads('tp-pad');
    var save = document.getElementById('tp-save');
    if (save) save.addEventListener('click', function () {
      keep();
      if (a.lineEdit) { sendLineChange(save); return; }
      var miss = missingName(); if (miss) { nameError(miss); return; }
      if (document.getElementById('tp-logger') && !loggerValue('tp-logger')) { loggerError('tp-logger'); return; }
      // Adding a new layout to a listed circuit needs its name.
      var ln = document.getElementById('tp-layout-name');
      var taken = a.addNow && ln && a.layoutName && venueLayouts(a, a.session).filter(function (l) { return l.startLine && String(l.name || '').trim().toLowerCase() === a.layoutName.toLowerCase(); })[0];
      if (taken) { ln.setAttribute('aria-invalid', 'true'); status('A layout called ' + taken.name + ' is already listed. Pick it in the Layout row, or give this one a different name.', 'error'); ln.scrollIntoView({ block: 'center' }); ln.focus(); return; }
      if (a.addNow && ln && !a.layoutName) { ln.setAttribute('aria-invalid', 'true'); status('Enter the name of the layout first.', 'error'); ln.scrollIntoView({ block: 'center' }); ln.focus(); return; }
      saveSession(save);
    });
    wireNameField();
    var req = document.getElementById('tp-req');
    if (req) req.addEventListener('click', function () {
      var nm = document.getElementById('tp-req-name').value.trim();
      var r0 = a.session.runs[0];
      api('POST', '/track/requests', { kind: 'drag', name: nm, lat: r0.lat, lng: r0.lng }).then(function (d) {
        status(d.success ? 'Thanks. We\'ll check it and add the strip if it is one.' : (d.message || 'Could not send that.'), d.success ? 'ok' : 'error');
      });
    });
  }
  // What to do next on the tap map.
  function tapHint(a, sprint) {
    if (sprint) return !a.startLine ? 'Tap the start line, then the finish line.' : !a.finishLine ? 'Start set. Now tap the finish line.' : 'Start and finish set. Drag either marker to move it.';
    return a.startLine ? 'Start and finish line set. Drag the marker to move it.' : 'Tap where the start and finish line is.';
  }
  // Unknown start line: the member taps their trace. Markers can be undone,
  // cleared or dragged along the track; a click only counts as a tap when the
  // map wasn't being dragged.
  // The start and finish lines as the full latitude and longitude figures (both ends of each line, to 7 decimal places,
  // about a centimetre), so they can be checked against another source before saving or sending for approval. When a
  // saved session's map is being edited the old lines are shown beside the new ones.
  function llText(l) { return l && l.length === 2 ? [l[0][0], l[0][1], l[1][0], l[1][1]].map(function (v) { return Number(v).toFixed(7); }).join(', ') : ''; }
  function lineFiguresHtml(a, s) {
    // What the member has set (or, with nothing set, the lines the course or file gave).
    var st = a.startLine || s.startLine, fi = a.finishLine || s.finishLine;
    if (!s || (s.type !== 'sprint' && s.type !== 'track') || !st) return '';
    var sprint = s.type === 'sprint', o = a.lineEdit ? a.oldLines || {} : null;
    var rows = [[sprint ? 'Start line' : 'Start and finish line', o ? o.startLine : null, st]];
    if (sprint) rows.push(['Finish line', o ? o.finishLine : null, fi]);
    function cell(label, l) {
      var t = llText(l);
      var ends = t ? t.split(', ') : [];
      return '<div class="tp-fig"><span class="tp-lbl">' + label + '</span>' + (t ? '<span class="tp-fignum"><span>' + esc(ends[0] + ', ' + ends[1]) + '</span><span>' + esc(ends[2] + ', ' + ends[3]) + '</span></span> <button type="button" class="btn btn-ghost btn-sm" data-copy-line="' + esc(t) + '" aria-label="Copy the ' + esc(label.toLowerCase()) + '">' + icon('copy') + '<span>Copy</span></button>' : '<span class="tp-fignum">not set</span>') + '</div>';
    }
    return '<div class="tp-section tp-figs" id="tp-figs"><div class="tp-head"><h3>Line figures</h3></div><div class="card tp-fields">' +
      '<p class="tp-small">Latitude and longitude of each end of the line, to 7 decimal places.</p>' +
      rows.map(function (r) {
        return '<div class="tp-figrow"><b>' + r[0] + '</b>' + (o ? cell('Before', r[1]) + cell('After', r[2]) : cell('Figures', r[2])) + '</div>';
      }).join('') + '</div></div>';
  }
  function drawTap() {
    var a = add, s = a.session, svg = document.getElementById('tp-tap'), wrap = document.getElementById('tp-tapmap');
    // A timed session keeps its laps, not the whole trace: read the trace again
    // (with no lines) to have the whole drive to place markers on.
    var out = s.trace && s.trace.outline;
    if (!out) { if (!a.tapOutline) a.tapOutline = T.outline(a.rd.points); out = a.tapOutline; }
    if (!out || !out.length) return;
    var sprint = s.type === 'sprint';
    var proj = T.projector(out[0][0], out[0][1]);
    var d = 0, prev = null;
    var trace = out.map(function (p) { var xy = proj.xy(p[0], p[1]); if (prev) d += Math.hypot(xy[0] - prev[0], xy[1] - prev[1]); prev = xy; return [d, 0, xy[0], xy[1], p[2], 0, 0]; });
    document.body.classList.toggle('tp-noscroll', !!a.tapFull);
    var fill = a.tapFull && wrap ? { w: wrap.clientWidth, h: wrap.clientHeight } : null;
    // Placing or moving a marker redraws the page; the map carries on from the zoom and centre it had, so the member can
    // see exactly where the line sits instead of being sent back to the whole map.
    var kept = a.tapMap && a.tapMap.zoom && a.tapMap.zoom.frac ? a.tapMap.zoom.frac() : null;
    // A session of many laps would be a tangle of lines, and a marker could only land on the nearest waypoint of any of
    // them. With laps, only the fastest lap is drawn and placed on: one clean line, filled in to about a metre apart so a
    // marker can sit anywhere along it, not just on a reading.
    var bestRows = s.trace && s.trace.laps && s.best && s.trace.laps[s.best], best = null, gap = 0;
    if (bestRows && bestRows.length > 10 && s.origin && s.origin.length === 2 && s.laps && s.laps.length > 1) {
      var bp = T.projector(s.origin[0], s.origin[1]), raw = bestRows.map(function (r) { var ll = bp.ll(r[2], r[3]); return proj.xy(ll[0], ll[1]).concat(r[4]); }), len = 0;
      for (var ri = 1; ri < raw.length; ri++) len += Math.hypot(raw[ri][0] - raw[ri - 1][0], raw[ri][1] - raw[ri - 1][1]);
      gap = Math.max(1, len / 6000);
      best = []; d = 0;
      raw.forEach(function (q, ri) {
        if (ri) {
          var q0 = raw[ri - 1], seg = Math.hypot(q[0] - q0[0], q[1] - q0[1]), n = Math.max(1, Math.ceil(seg / gap));
          for (var k = 1; k <= n; k++) best.push([d + seg * k / n, 0, q0[0] + (q[0] - q0[0]) * k / n, q0[1] + (q[1] - q0[1]) * k / n, q0[2] + (q[2] - q0[2]) * k / n, 0, 0]);
          d += seg;
        } else best.push([0, 0, q[0], q[1], q[2], 0, 0]);
      });
      trace = best;
    }
    var m = V.map(svg, trace, { mono: true, ratio: 0.85, fill: fill, origin: [out[0][0], out[0][1]], highlight: best });
    a.tapMap = m;
    if (kept && kept.k > 1.01 && m && m.zoom && m.zoom.restore) m.zoom.restore(kept);
    svg.style.cursor = 'crosshair';
    function nearest(px, py) {
      var bi = 0, bd = Infinity;
      trace.forEach(function (p, k) { var pp = m.P(p[2], p[3]); var dd = (pp[0] - px) * (pp[0] - px) + (pp[1] - py) * (pp[1] - py); if (dd < bd) { bd = dd; bi = k; } });
      return bi;
    }
    // A line across the track at a point of the trace, and back again.
    function lineAt(bi) {
      var K = gap ? Math.round(15 / gap) : 3, p0 = trace[Math.max(0, bi - K)], p1 = trace[Math.min(trace.length - 1, bi + K)], c = trace[bi];
      var dx = p1[2] - p0[2], dy = p1[3] - p0[3], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      return [proj.ll(c[2] + nx * 15, c[3] + ny * 15), proj.ll(c[2] - nx * 15, c[3] - ny * 15)];
    }
    function indexOf(line) {
      var mid = proj.xy((line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2), bi = 0, bd = Infinity;
      trace.forEach(function (p, k) { var dd = (p[2] - mid[0]) * (p[2] - mid[0]) + (p[3] - mid[1]) * (p[3] - mid[1]); if (dd < bd) { bd = dd; bi = k; } });
      return bi;
    }
    // Start (green, S) and finish (red, F); a circuit has one start/finish (S/F).
    function mark(kind, bi) {
      var c = trace[bi], pp = m.P(c[2], c[3]), mk = m.marker(pp[0], pp[1]);
      var ns = 'http://www.w3.org/2000/svg', circle = document.createElementNS(ns, 'circle'), label = document.createElementNS(ns, 'text');
      circle.setAttribute('r', 11); circle.setAttribute('fill', kind === 'finish' ? '#d33a2c' : '#1baf7a'); circle.setAttribute('stroke', '#ffffff'); circle.setAttribute('stroke-width', 2.5);
      label.setAttribute('text-anchor', 'middle'); label.setAttribute('y', 4); label.setAttribute('style', 'fill:#ffffff;font-size:' + (sprint ? 11 : 9) + 'px;font-weight:700');
      label.textContent = kind === 'finish' ? 'F' : sprint ? 'S' : 'S/F';
      mk.g.appendChild(circle); mk.g.appendChild(label);
      mk.g.setAttribute('class', 'tp-tapmark');
      mk.g.setAttribute('data-mark', kind);
      mk.g.style.cursor = 'grab';
      // Dragging a marker moves it along the track; the map doesn't pan.
      mk.g.addEventListener('pointerdown', function (e) {
        e.stopPropagation(); e.preventDefault();
        try { mk.g.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        var at = bi;
        function mv(ev) { var q = V.point(svg, ev); at = nearest(q.x, q.y); var np = m.P(trace[at][2], trace[at][3]); mk.x = np[0]; mk.y = np[1]; mk.g.setAttribute('transform', mk.g.getAttribute('transform').replace(/translate\([^)]*\)/, 'translate(' + np[0] + ' ' + np[1] + ')')); }
        function up() {
          mk.g.removeEventListener('pointermove', mv); mk.g.removeEventListener('pointerup', up); mk.g.removeEventListener('pointercancel', up);
          if (at === bi) return;
          if (kind === 'finish') a.finishLine = lineAt(at); else a.startLine = lineAt(at);
          linesChanged();
        }
        mk.g.addEventListener('pointermove', mv); mk.g.addEventListener('pointerup', up); mk.g.addEventListener('pointercancel', up);
      });
      return mk;
    }
    if (a.startLine) mark('start', indexOf(a.startLine));
    if (a.finishLine) mark('finish', indexOf(a.finishLine));
    // Only a quick, still, left-button click places a marker.
    var down = null;
    svg.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, t: Date.now(), b: e.button }; });
    svg.addEventListener('click', function (e) {
      if (!down || down.b !== 0 || Date.now() - down.t > 600 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      if (e.target.closest && e.target.closest('.tp-tapmark')) return;
      var full = sprint ? a.startLine && a.finishLine : a.startLine;
      if (full) { status(sprint ? 'Both markers are placed. Drag one to move it, or undo or clear them.' : 'The marker is placed. Drag it to move it, or clear it.', ''); return; }
      var q = V.point(svg, e), line = lineAt(nearest(q.x, q.y));
      var nameEl = document.getElementById('tp-venue-name');
      a.venueName = nameEl ? nameEl.value.trim() : a.venueName;
      a.requestStart = true;
      if (sprint && !a.startLine) a.startLine = line; else if (sprint) a.finishLine = line; else a.startLine = line;
      linesChanged();
    });
    var tools = document.getElementById('tp-tapbox');
    if (tools) tools.querySelectorAll('[data-tap]').forEach(function (b) {
      b.addEventListener('click', function () {
        var what = b.getAttribute('data-tap');
        if (what === 'undo') { if (sprint && a.finishLine) a.finishLine = null; else a.startLine = null; linesChanged(); }
        else if (what === 'clear') { a.startLine = null; a.finishLine = null; a.confirmLines = false; linesChanged(); }
        else if (what === 'sprint') { a.type = 'sprint'; a.startLine = null; a.finishLine = null; a.editLines = false; a.confirmLines = false; a.tapAuto = false; analyse(); }
        else if (what === 'full') { a.tapFull = !a.tapFull; drawResult(); }
        else if (what === 'done') {
          var finish = function () {
            var wasConfirm = a.confirmLines;
            a.editLines = false; a.confirmLines = false; a.tapFull = false; document.body.classList.remove('tp-noscroll'); drawResult();
            // Confirmed: back to the top of the result (the time, the switches), where the member carries on.
            if (wasConfirm) { var top = document.querySelector('#tp-result .tp-notice'); if (top && top.scrollIntoView) top.scrollIntoView({ block: 'start' }); }
          };
          if (a.confirmLines) {
            // Ticked: the button goes orange for a moment, then the lines are taken.
            if (b.getAttribute('aria-checked') === 'true') return;
            b.setAttribute('aria-checked', 'true'); b.classList.add('is-on');
            setTimeout(finish, 450);
          } else finish();
        }
      });
    });
  }
  // The markers changed: time the laps again once the lines are complete,
  // otherwise just show the markers placed so far.
  function linesChanged() {
    var a = add, sprint = a.session && a.session.type === 'sprint';
    var complete = sprint ? a.startLine && a.finishLine : a.startLine;
    if (!complete) {
      // Back to "needs a line" with the markers placed so far kept.
      var s0 = a.startLine, f0 = a.finishLine;
      a.startLine = null; a.finishLine = null;
      analyse();
      a.startLine = s0; a.finishLine = f0;
      if (!a.session.needsStartLine) a.editLines = true;
      drawResult();
      return;
    }
    analyse();
    var bad = !sprint && implausibleLaps(add.session);
    if (bad) {
      // A line in the wrong place can still give "laps": one long one from
      // the paddock, say. Don't take those.
      a.startLine = null;
      analyse();
      status('That line gives a ' + V.fmtLap(bad) + ' lap, which can\'t be right. Zoom in and tap the straight you cross on every lap.', 'error');
    } else if (!add.session.needsStartLine) {
      // Both lines are down: stay on the map and ask the member to check them.
      a.editLines = true; a.confirmLines = true;
      drawResult();
    } else if (add.session.needsStartLine) {
      // Keep the markers so they can be moved rather than placed again.
      a.editLines = true;
      drawResult();
      status(sprint ? 'No runs were found between those points. Drag the markers right onto the road where you started and finished.' : 'No laps were found from that point. Drag the marker right onto the straight you cross on every lap.', 'error');
    }
  }
  // Laps from a tapped line that can't be real: the best over 15 minutes,
  // or most laps far longer than the trace's own loop. Returns the best
  // lap's time when they're implausible.
  function implausibleLaps(s) {
    var laps = (s && s.laps) || [];
    if (!laps.length) return 0;
    var best = Math.min.apply(null, laps.map(function (l) { return l.time; }));
    if (best > 900) return best;
    var dists = laps.map(function (l) { return l.dist; }).sort(function (x, y) { return x - y; });
    var v = ((add.lib && add.lib.venues) || []).filter(function (x) { return x.id === s.venueId; })[0];
    var ly = v && (v.layouts || []).filter(function (x) { return x.id === s.layoutId; })[0];
    if (ly && ly.length && dists[Math.floor(dists.length / 2)] > ly.length * 3) return best;
    return 0;
  }
  // What the worker is sent to save one session, with the settings chosen for the upload.
  function postBody(a, carId, sess) {
    return Object.assign(padPayload(a.pads), { carId: carId, session: sess, drive: a.drive || '', conditions: a.conditions, tyres: a.tyres || '', tyreMake: (a.tyre && a.tyre.make) || '', tyreModel: (a.tyre && a.tyre.model) || '', tyreWidth: (a.tyre && a.tyre.w) || null, tyreProfile: (a.tyre && a.tyre.p) || null, tyreRim: (a.tyre && a.tyre.d) || null, temp: a.temp, tempSource: a.temp == null ? '' : (a.tempSource || 'member'), weather: a.tempSource === 'weather' ? a.weather : null, notes: a.notes || '', publicNote: a.publicNote || '', logger: a.logger || '', privacy: a.privacy, venueName: a.venueName || '', street: a.street, adminViewer: a.street ? adminViewerToken() : '' });
  }
  // The layouts of the circuit this session is at, to pick from. The one found from the GPS is picked already; a
  // member whose layout was not found (or wrongly found) picks it, or says it is a different one, which is then added
  // from their own start line.
  function venueLayouts(a, s) {
    var v = s.venueId && ((a.lib && a.lib.venues) || []).filter(function (x) { return x.id === s.venueId; })[0];
    return v && v.type === 'circuit' ? (v.layouts || []) : [];
  }
  // Adding a sprint or hill climb at a venue with more than one course, and no organiser picked yet: the member must choose.
  // Track days are not held to this: their layout is found from the GPS.
  function mustPickLayout(a, s) {
    if (a.lineEdit || (a.replaceId && !a.relayout) || !s.venueId) return false;
    if (s.type === 'sprint') {
      // Sprints and hill climbs: the organiser says which course. Their own lines, or a new organiser, are a choice too.
      if (a.organizer || a.orgNew || (a.startLine && a.finishLine)) return false;
      var v = ((a.lib && a.lib.venues) || []).filter(function (x) { return x.id === s.venueId; })[0];
      return !!v && v.type === 'sprint' && (v.layouts || []).filter(function (l) { return l.startLine && l.finishLine; }).length > 1;
    }
    return false;
  }
  function layoutFieldHtml(a, s) {
    if (a.lineEdit || (a.replaceId && !a.relayout) || s.type !== 'track' || !s.venueId) return '';
    var ls = venueLayouts(a, s);
    if (!ls.length) return '';
    var cur = a.layoutPick === '__new' ? '__new' : (a.layoutPick || s.layoutId || '');
    var note = cur === '__new' ? (s.needsStartLine ? 'Tap where this layout starts and finishes on the map below. Then you can add it to the track list.' : a.confirmLines ? 'We found the line from your laps. Drag it to where this layout starts and finishes, then tick Correct lines.' : 'Check the start line on the map below. Use Move the start line if it is not where this layout starts and finishes, then add it to the track list.')
      : !cur ? 'We could not tell which layout this was from your file. Pick it here, or choose A different layout if it is not listed.'
      : 'Found from your file. If it is not right, pick another.';
    return '<div class="tp-field" id="tp-layout-field"><span class="tp-lbl">Layout at ' + esc(s.venue || 'this track') + '</span><div class="tp-chips" data-layout>' +
      ls.map(function (l) { return '<button type="button" class="chip' + (cur === l.id ? ' is-on' : '') + '" data-v="' + esc(l.id) + '" aria-pressed="' + (cur === l.id) + '">' + esc(l.name || l.id) + '</button>'; }).join('') +
      (a.replaceId ? '' : '<button type="button" class="chip' + (cur === '__new' ? ' is-on' : '') + '" data-v="__new" aria-pressed="' + (cur === '__new') + '">A different layout</button>') + '</div><p class="tp-small">' + note + '</p></div>';
  }
  // The start and finish line this session was timed on, on the map, so the member can see where it is before saving.
  function linePreviewHtml(a, s) {
    if (a.lineEdit || !s.startLine || !(s.laps && s.laps.length) || !(s.trace && s.trace.laps && s.trace.laps[s.best || s.laps[0].n])) return '';
    var sprint = s.type === 'sprint', what = sprint ? 'start and finish lines' : 'start and finish line';
    var how = s.lapsFromTrace ? 'This is the start/finish line of this ' + (sprint ? 'course' : 'layout') + '. Your laps were timed from a point on your trace, because the file has no lap from this line back to itself.' : s.officialLines ? 'These are the lines MT3UK uses for this ' + (sprint ? 'course' : 'layout') + ', so times can be compared. If they look wrong, save the session, then use Request Edit Map on it and MT3UK will look.'
      : s.autoLine ? 'No line is set for this track yet, so this one was found from your trace. Use Move the start line if it is not where you start and finish.'
      : 'Your own ' + what + '. Use Move if they are not right.';
    return '<div class="tp-field" id="tp-line-preview"><span class="tp-lbl">Your ' + what + '</span><div class="tp-tapmap"><svg class="tv-chart tp-tap" id="tp-line-map" role="img" aria-label="Your best ' + (sprint ? 'run' : 'lap') + ' with the ' + what + ' marked"></svg></div><p class="tp-small">' + how + '</p></div>';
  }
  // A layout picked whose saved start line the file does not cross: why it is not timed on that line.
  function layoutGapHtml(a, s) {
    if (a.lineEdit || s.layoutLineGap == null) return '';
    return '<div class="tp-notice is-warn" id="tp-layout-gap">' + icon('warn') + '<div><b>This file does not cross the start line saved for ' + esc(s.layout || 'that layout') + '.</b><br>The closest your ' + VW + ' came to it was about ' + s.layoutLineGap + ' m. Either this was another layout, or the saved line is in the wrong place. ' +
      (s.layoutLineGap > 25 ? 'A session more than 25 m from a layout\'s saved line cannot go on its leaderboard, so MT3UK needs to check that line. ' : '') + 'Pick another layout above, or tell MT3UK.</div></div>';
  }
  // On the layout by its path: the file has no lap from the start/finish line back to itself.
  function lapsFromTraceHtml(a, s) {
    if (a.lineEdit || !s.lapsFromTrace) return '';
    return '<div class="tp-notice" id="tp-laps-from-trace">' + icon('info') + '<div><b>Your file has no lap from the start/finish line back to itself.</b><br>It starts or stops part way round, so your laps were timed from a point on your trace. They are still full laps of ' + esc(s.layout || 'this layout') + '.</div></div>';
  }
  function drawLinePreview() {
    var a = add, s = a && a.session, svg = document.getElementById('tp-line-map');
    if (!svg || !s) return;
    var tr = s.trace && s.trace.laps && s.trace.laps[s.best || (s.laps[0] && s.laps[0].n)];
    if (!tr || !tr.length) return;
    V.map(svg, tr, { mono: true, ratio: 0.7, origin: s.origin, lines: [{ trace: tr, color: '#2a78d6' }], startLine: startLineXY(s), finishLine: s.type === 'sprint' ? startLineXY(s, s.finishLine) : null });
  }
  // A track, course or layout we do not list, with lines to time it by: the member can add it to the track list
  // themselves rather than wait for the admin. Their lines become its official ones, the session is timed on them
  // and goes on the new leaderboard at once, and the track is flagged for the admin's review (the Admin bell keeps
  // the request, marked as added). Off by default.
  function canAddNow(a, s) {
    return (s.type === 'track' || s.type === 'sprint') && !s.layoutId && !s.needsStartLine && !!s.startLine && (s.type !== 'sprint' || !!s.finishLine) && !!(a.venueName || s.venue);
  }
  function addNowHtml(a, s, isSprint) {
    if ((s.type !== 'track' && s.type !== 'sprint') || s.layoutId || s.needsStartLine || !s.startLine || (isSprint && !s.finishLine)) return '';
    var what = isSprint ? 'course' : s.venueId ? 'layout' : 'track', name = a.venueName || s.venue || ('this ' + what);
    var lines = isSprint ? 'start and finish lines' : 'start line';
    var layoutBox = !isSprint && s.venueId && a.addNow ? '<div class="tp-field"><label for="tp-layout-name">Layout name' + REQ + '</label><input class="field" id="tp-layout-name" data-layout-req maxlength="40" placeholder="For example, Short Circuit" value="' + esc(a.layoutName || '') + '" required aria-required="true"></div>' : '';
    return layoutBox + '<div class="tp-notice is-warn" id="tp-addnow-box">' + icon('pin') + '<div><b>' + (s.venueId ? 'This layout at ' + esc(s.venue) + ' is not in the MT3UK track list yet.' : (a.venueName || s.venue ? esc(name) : 'This ' + what) + ' is not in the MT3UK track list yet.') + '</b><br>' +
      'Normally MT3UK checks the ' + lines + ' and adds the ' + what + ', and your session joins its leaderboard then. You can add it now instead.</div></div>' +
      '<button type="button" class="tp-switch" role="switch" aria-checked="' + (a.addNow ? 'true' : 'false') + '" id="tp-addnow"><span><b>Add this ' + what + ' now</b><br><small>' +
      (a.addNow ? 'Saving adds ' + esc(name) + ' to the list with your ' + lines + ' as its official ' + (isSprint ? 'lines' : 'line') + ', times this session on ' + (isSprint ? 'them' : 'it') + ' and puts it on the leaderboard straight away. MT3UK will still review the ' + what + ' and may adjust the ' + lines + '.'
        : 'Your ' + lines + ' become' + (isSprint ? '' : 's') + ' the official ' + (isSprint ? 'ones' : 'one') + ' and this session goes on the leaderboard straight away. MT3UK reviews the ' + what + ' afterwards.') + '</small></span><span class="tp-track"></span></button>';
  }
  // The notice names the track once the member types a name or the map lookup finds one.
  function refreshAddNow(a) {
    var box = document.getElementById('tp-addnow-box'), sw = document.getElementById('tp-addnow');
    if (!box || !sw || !a.session) return;
    sw.remove();
    box.insertAdjacentHTML('afterend', addNowHtml(a, a.session, a.session.type === 'sprint'));
    box.remove();
  }
  // The outline of the best lap (or the whole drive) as positions, thinned, for a request or a new course.
  function traceOutline(s) {
    var out = [];
    var lap = s.trace && s.trace.laps && s.trace.laps[s.best];
    var origin = s.origin || [0, 0], proj = T.projector(origin[0], origin[1]);
    if (lap) lap.filter(function (_, i) { return i % 4 === 0; }).forEach(function (p) { out.push(proj.ll(p[2], p[3]).map(function (v) { return Math.round(v * 1e6) / 1e6; })); });
    else if (s.trace && s.trace.outline) s.trace.outline.filter(function (_, i) { return i % 4 === 0; }).forEach(function (p) { out.push([p[0], p[1]]); });
    return { out: out, lap: lap };
  }
  function addCourseNow(a) {
    var s = a.session, tr = traceOutline(s), o = s.origin || [0, 0], name = a.venueName || s.venue || '';
    status('Adding ' + name + ' to the track list...');
    return api('POST', '/track/courses', { kind: s.type === 'sprint' ? 'sprint' : 'circuit', hill: s.type === 'sprint' && isHillSession(s, a.lib), name: name, venueId: s.venueId || '', organizer: s.type === 'sprint' ? (a.organizer || s.organizer || '') : '', layoutName: s.type === 'sprint' ? '' : (a.layoutName || ''), startLine: s.startLine, finishLine: s.finishLine || null, lapLength: tr.lap ? tr.lap[tr.lap.length - 1][0] : null, lat: o[0], lng: o[1], outline: tr.out }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not add the track.');
      if (d.library) a.lib = d.library;
      // Timed again against the new course: its official lines are the ones just sent, so the laps are the same.
      // The layout now exists: from here every file is timed on it (not as a different layout again), and the admin is not
      // sent a second request for it.
      if (d.layoutId) { a.layoutPick = d.layoutId; a.addNow = false; a.addedLayout = true; }
      var again = analysisOpts(a);
      var next = T.analyse(a.rd, a.lib, again);
      if (a.date) { next.date = a.date; next.dateFrom = 'member'; }
      if (a.time) next.time = a.time;
      if (!next.layoutId && d.venueId && d.layoutId) {
        var nv = (a.lib.venues || []).filter(function (v) { return v.id === d.venueId; })[0], nl = nv && (nv.layouts || []).filter(function (l) { return l.id === d.layoutId; })[0];
        next.venueId = d.venueId; next.layoutId = d.layoutId; next.venue = nv ? nv.name : name; next.layout = nl ? nl.name : '';
      }
      next.fileName = s.fileName;
      next.addedCourse = true;
      a.session = next;
      return true;
    });
  }
  // Tell MT3UK about a course it cannot place on a leaderboard: a venue we do not list, a listed venue whose layout
  // was not recognised, or a layout with no official start line yet (the member's line is offered for it). Track days
  // find their own lap line, so this cannot wait for the member to tap one.
  // A request to MT3UK for a track: best effort, and kept on the device to send later when there is no connection.
  function sendRequest(body) {
    var off = window.MT3UKOffline;
    var keep = function () { if (off) off.queueCall('POST', '/track/requests', body, 'Track request: ' + (body.name || 'new track')); };
    if (off && off.isOffline()) { keep(); return Promise.resolve(); }
    return api('POST', '/track/requests', body).catch(function (e) { if (off && off.isNetworkError(e)) keep(); });
  }
  // With no connection (or a request that never reaches the worker) a session and its readings are kept on this
  // device and sent later (js/laps-offline.js). carPut: the car with no photo yet, made when it is sent.
  function queuedLabel(a, sess) { return (sess.venue || a.venueName || 'Session') + (sess.date ? ', ' + sess.date : '') + (a.car && a.car.name ? ' (' + a.car.name + ')' : ''); }
  function savePost(a, body, rd, sess, carPut) {
    var off = window.MT3UKOffline;
    var keep = function () { return off.queueSession({ label: queuedLabel(a, sess), post: body, source: sourceOf(rd), carPut: carPut || null }).then(function () { return { success: true, queued: true }; }); };
    if (off && (off.isOffline() || carPut)) return keep();
    return api('POST', '/track/sessions', body, true).catch(function (e) {
      if (off && off.isNetworkError(e)) return keep();
      throw e;
    });
  }
  function requestCourse(a, s) {
    if (s.type !== 'track' && s.type !== 'sprint') return;
    if (a.addedLayout) return;
    var ownLine = s.layoutId && !s.officialLines && s.startLine && ((a.lib.venues || []).filter(function (vv) { return vv.id === s.venueId; })[0] || { layouts: [] }).layouts.filter(function (l) { return l.id === s.layoutId && !l.startLine; }).length;
    if (!(a.requestStart || ownLine || !s.layoutId)) return;
    var tr = traceOutline(s), out = tr.out, lap = tr.lap;
    return sendRequest({ kind: s.type === 'sprint' ? 'sprint' : 'circuit', hill: s.type === 'sprint' && isHillSession(s, a.lib), name: a.venueName || s.venue || '', venueId: s.venueId || '', layoutId: ownLine ? s.layoutId : '', organizer: s.type === 'sprint' ? (a.organizer || s.organizer || '') : '', startLine: s.startLine, finishLine: s.finishLine || null, lapLength: lap ? lap[lap.length - 1][0] : null, outline: out, note: s.type === 'sprint' ? (s.venueId ? 'Course not recognised' : 'New sprint or hill climb') : s.venueId ? 'Layout not recognised' : 'New track' });
  }
  // Several files: each is timed on its own and saved as its own session, with the settings chosen
  // above. A file that gives no laps or runs is left out and listed.
  function saveBatch(a, carId, carPut) {
    var items = (a.list || []).filter(function (x) { return x.rd && !x.mergedInto; }), opts = analysisOpts(a), made = [], skipped = [], siblingLine = null, noReadings = [], queued = 0;
    // Files with real time stamps first: a file the car wrote with no time stamps may have no start line of its own,
    // so it borrows the one found on the files from the same upload.
    var ordered = items.filter(function (x) { return !x.rd.timeRebuilt; }).concat(items.filter(function (x) { return x.rd.timeRebuilt; }));
    function hasLaps(s1) { return s1.type === 'drag' ? !!(s1.runs && s1.runs.length) : s1.type === 'other' ? s1.distance > 0 : !!(s1.laps && s1.laps.length); }
    var chain = Promise.resolve();
    ordered.forEach(function (x) {
      chain = chain.then(function () {
        var s1 = T.analyse(x.rd, a.lib, opts), drive = false;
        if (x.rd.timeRebuilt && (!hasLaps(s1) || s1.needsStartLine) && siblingLine) s1 = T.analyse(x.rd, a.lib, Object.assign({}, opts, { startLine: siblingLine }));
        if (x.rd.timeRebuilt && (!hasLaps(s1) || s1.needsStartLine)) {
          // Nothing to time: keep it as a drive with its map and car figures, private and off every leaderboard.
          s1 = T.analyse(x.rd, a.lib, Object.assign({}, opts, { type: 'other' }));
          drive = true;
        }
        if (drive ? !(s1.distance > 0) : (!hasLaps(s1) || s1.needsStartLine)) { skipped.push({ name: x.f.name, reason: s1.problem || (s1.type === 'drag' ? 'No drag run found.' : 'No laps were found.') }); return; }
        if (!x.rd.timeRebuilt && !siblingLine && s1.startLine) siblingLine = s1.startLine;
        s1.fileName = String(x.f.name + (x.merged ? ', ' + x.merged.name : '')).slice(0, 200);
        if (!drive && !s1.venueId && a.venueName) s1.venueName = a.venueName;
        if (!drive && !(a.session && a.session.addedCourse && s1.layoutId)) requestCourse(a, s1);
        var body = postBody(a, carId, s1);
        if (drive) { body.privacy = 'private'; body.venueName = ''; }
        return savePost(a, body, x.rd, s1, carPut).then(function (d) {
          if (!d.success) { skipped.push({ name: x.f.name, reason: d.message || 'Could not save it.' }); return; }
          if (d.queued) { queued++; return; }
          made.push(d.session.id);
          return keepReadings(d.session.id, x.rd).then(function (r) { if (r && r.kept === false) noReadings.push(x.f.name); });
        });
      });
    });
    return chain.then(function () {
      if (!made.length && !queued) throw new Error('None of those files could be saved. ' + (skipped[0] ? skipped[0].name + ': ' + skipped[0].reason : ''));
      return { success: true, batch: made.length + queued, queued: queued, ids: made, skipped: skipped, noReadings: noReadings };
    });
  }
  function saveSession(btn) {
    var a = add, s = a.session;
    // The file's name, kept with the session so the member can tell which file it was.
    if (!s.venueId && a.venueName) s.venueName = a.venueName;
    if (a.pendingCourse) s.pendingCourse = a.pendingCourse;
    // A drag run at a strip we do not list: save it, and tell MT3UK about the strip.
    if (s.type === 'drag' && !s.atVenue && !a.street && s.runs && s.runs[0]) {
      var stripEl = document.getElementById('tp-req-name');
      sendRequest({ kind: 'drag', name: (stripEl && stripEl.value.trim()) || a.venueName || '', lat: s.runs[0].lat, lng: s.runs[0].lng, note: 'Drag run saved at a strip we do not list' });
    }
    s.fileName = (a.files || []).map(function (f) { return f.name; }).join(', ').slice(0, 200);
    // No connection: the session is kept on this device (js/laps-offline.js). Changing a saved session and adding a new
    // track to the list need the worker, so they wait.
    if (isOffline() && a.replaceId) { status('Adding the file to a saved session needs a connection. Try again when you are online.', 'error'); return; }
    if (isOffline() && a.addNow && canAddNow(a, s)) { status('Adding a new track to the list needs a connection. Switch off "Add this track now" and the session is kept on this device, and MT3UK is told about the track when it is sent.', 'error'); return; }
    btn.disabled = true;
    status('Saving...');
    var carPut = null, offNow = isOffline();
    var carReady = a.car.virtual && !a.replaceId
      ? (offNow ? Promise.resolve(null) : api('PUT', '/my-builds/car', { carId: a.car.id }).catch(function (e) { if (window.MT3UKOffline && window.MT3UKOffline.isNetworkError(e)) return null; throw e; }))
        .then(function (d) {
          // Offline: the car is made when the session is sent.
          if (!d) { carPut = a.drive && a.drive !== a.car.drive ? { carId: a.car.id, drive: a.drive } : { carId: a.car.id }; return a.car.id; }
          if (!d.success) throw new Error(d.message || 'Could not set up the car'); a.car.id = d.car.id; a.car.virtual = false; mine = null; counts = null; return d.car.id;
        })
      : Promise.resolve(a.car.id);
    carReady.then(function (carId) {
      // A choice of driven wheels that differs from the car's is kept on the car for next time.
      if (a.drive && a.car && a.drive !== a.car.drive && !carPut) {
        a.car.drive = a.drive; mine = null;
        var driveBody = { carId: carId, drive: a.drive };
        if (offNow) { if (window.MT3UKOffline) window.MT3UKOffline.queueCall('PUT', '/my-builds/car', driveBody, 'Driven wheels for your car'); }
        else api('PUT', '/my-builds/car', driveBody).catch(function (e) { if (window.MT3UKOffline && window.MT3UKOffline.isNetworkError(e)) window.MT3UKOffline.queueCall('PUT', '/my-builds/car', driveBody, 'Driven wheels for your car'); });
      }
      return (a.addNow && !a.replaceId && canAddNow(a, s) ? addCourseNow(a) : Promise.resolve(false)).then(function (added) {
        if (added) { s = a.session; status('Saving...'); } else requestCourse(a, s);
        if (a.replaceId) return api('PUT', '/track/session', { id: a.replaceId, session: s, venueName: a.venueName || '' }, true);
        if ((a.list || []).filter(function (x) { return x.rd && !x.mergedInto; }).length > 1) return saveBatch(a, carId, carPut);
        return savePost(a, postBody(a, carId, s), a.rd, s, carPut);
      });
    }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not save the session.');
      mine = null; counts = null;
      // Kept on this device: the list says so, and shows what is waiting.
      if (d.queued) { justSaved = { batch: d.batch || 1, queued: d.queued === true ? 1 : d.queued, ids: d.ids || [], skipped: d.skipped || [] }; go('', false, true); return; }
      if (d.batch) { justSaved = { batch: d.batch, ids: d.ids || [], skipped: d.skipped || [], noReadings: d.noReadings || [], joined: (a.list || []).filter(function (x) { return x.merged; }).length }; go('', false, true); return; }
      justSaved = { files: (a.files || []).length || 1 };
      // A changed session was edited in place of its own page, so that page is redrawn in the same history entry.
      if (a.replaceId) { go('s=' + d.session.id, false, true); return; }
      // Keep the readings with the session, so its type can be changed later.
      // Best effort: a session without them still works.
      status('Keeping your readings...');
      return keepReadings(d.session.id, a.rd).then(function (r) {
        if (r && r.kept === false) justSaved.readings = r.message;
        if (r && r.kept === null) justSaved.sending = true;
        go('s=' + d.session.id, false, true);
      });
    }).catch(function (e) {
      btn.disabled = false;
      status(e.message || 'Could not save the session.', 'error');
    });
  }

  // The readings as compact rows, for the worker to keep (gzipped) with the
  // session. Rounded to about a centimetre and a millisecond.
  function sourceOf(rd) {
    var meta = {};
    Object.keys(rd).forEach(function (k) { if (k !== 'points') meta[k] = rd[k]; });
    function r(v, n) { return v == null || !isFinite(v) ? null : Math.round(v * n) / n; }
    // A reading with nothing in its last columns (no satellites, temperature or run) is sent without them: restoreSource reads a missing one as empty.
    return { v: 1, rd: meta, p: rd.points.map(function (q) {
      var row = [r(q.t, 1000), r(q.lat, 1e7), r(q.lng, 1e7), r(q.v, 100), r(q.la, 1000), r(q.lo, 1000), r(q.sats, 1), r(q.temp, 10), q.run || 0];
      while (row.length > 4 && (row[row.length - 1] === null || row[row.length - 1] === 0)) row.pop();
      return row;
    }) };
  }
  function restoreSource(src) {
    var rd = Object.assign({}, src.rd);
    function n(v) { return v == null ? NaN : v; }
    rd.points = src.p.map(function (a) {
      var q = { t: a[0], lat: a[1], lng: a[2], v: n(a[3]), la: n(a[4]), lo: n(a[5]), sats: n(a[6]), temp: n(a[7]) };
      if (a[8]) q.run = a[8];
      return q;
    });
    return rd;
  }
  // Resolves { kept: true }, { kept: false, message } (the worker refused them, or they could not be sent) or
  // { kept: null } (still sending after 20 s: the page moves on, and brings the session up to date if they arrive).
  // Ids whose readings are still being sent. Leaving the page (a refresh) stops the upload, so the page says to wait.
  var readingsSending = {};
  function keepReadings(id, rd) {
    readingsSending[id] = true;
    var send = api('POST', '/track/session/source?id=' + encodeURIComponent(id), sourceOf(rd), true).then(function (d) {
      delete readingsSending[id];
      var out = d && d.success ? { kept: true } : { kept: false, message: (d && d.message) || 'They could not be sent.' };
      if (view && view.s && view.s.id === id && !view.s.hasSource) {
        if (out.kept) showSession(id); else { view.s.readingsMessage = out.message; drawSession(); }
      }
      return out;
    }).catch(function () { delete readingsSending[id]; return { kept: false, message: 'They could not be sent.' }; });
    var wait = new Promise(function (resolve) { setTimeout(function () { resolve({ kept: null }); }, 20000); });
    return Promise.race([send, wait]);
  }
  // A saved session's readings. They come back gzipped: the browser usually unzips them on the way in, but not
  // always (a large file can arrive still zipped), and api() would then find no readings. So the bytes are
  // read here and unzipped when they still start with the gzip marker, as the admin's Re-time does.
  function fetchSource(id) {
    var headers = {};
    if (token()) headers['X-Session-Token'] = token();
    return fetch(API + '/track/session/source?id=' + encodeURIComponent(id), { headers: headers, cache: 'no-store' }).then(function (r) {
      return r.arrayBuffer().then(function (buf) {
        var b = new Uint8Array(buf);
        if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
          if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unzip your readings. Try another browser.');
          return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
        }
        var d;
        try { d = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { d = {}; }
        d.status = r.status;
        return d;
      });
    });
  }
  function sourceError(src) {
    return (src && src.message) || 'Could not load your readings' + (src && src.status && src.status !== 200 ? ' (the server said ' + src.status + ')' : '') + '. Try again, or ask MT3UK.';
  }
  // Change a saved session's type: its readings come back from the worker and
  // go through the same screen as adding one (tap the line if the course is
  // new, then check the result and save).
  function startRetype(s, type, hill, layoutId) {
    status('Loading your readings...');
    Promise.all([fetchSource(s.id), getMine(), getLibrary(), isAdmin()]).then(function (r) {
      var src = r[0], m = r[1];
      if (!src.p || !m) throw new Error(sourceError(src));
      var car = m.cars.filter(function (c) { return c.id === s.carId; })[0] || m.cars[0];
      VW = vwOf(car);
      add = { car: car, drive: (car && car.drive) || '', cars: m.cars, lib: r[2], admin: r[3], rd: restoreSource(src), session: null, type: type, hill: !!hill, startLine: null, conditions: s.conditions || 'Dry', condTouched: true, privacy: s.privacy, street: false, tyres: s.tyres || '', tyre: tyreInit(s), pads: padInit(s), temp: s.temp, tempSource: s.tempSource || '', weather: s.weather || null, notes: s.notes || '', publicNote: s.publicNote || '', logger: s.logger || '', loggerTouched: !!s.logger, date: s.date, time: s.time, venueName: s.venueId ? '' : s.venue, replaceId: s.id, files: null, list: null };
      add.layoutPick = layoutId || ''; add.relayout = !!layoutId;
      analyse();
      window.scrollTo(0, 0);
    }).catch(function (e) { status((e && e.message) || 'Could not load your readings.', 'error'); });
  }

  // ---------- Add the readings again ----------
  // A session saved without its readings (an upload that failed, or a session from before we kept them) can be given
  // them again from the same file, with no duplicate session: the file is read as when adding one, checked to be the
  // same drive (the same place, length and distance), and sent to be kept with the session. After that its type can
  // be changed and its map edited.
  function readingsAgainHtml() {
    return '<div class="tp-readings-again"><button type="button" class="btn btn-secondary btn-sm" data-readings-again>' + icon('upload') + 'Add the readings again</button>' +
      '<input type="file" multiple accept=".vbo,.csv,.gpx,.txt,text/csv,application/gpx+xml" hidden data-readings-file>' +
      '<p class="tp-small">Pick the same file this session was saved from (all of its files, if it was several).</p>' +
      '<p class="tp-small tp-err" data-readings-note role="status"></p></div>';
  }
  function readTextFiles(list) {
    var files = Array.prototype.slice.call(list, 0, 12), big = files.filter(function (f) { return f.size > 80 * 1024 * 1024; })[0];
    if (big) return Promise.reject(new Error(big.name + ' is over 80 MB.'));
    return Promise.all(files.map(function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve({ name: file.name, text: String(reader.result || ''), modified: file.lastModified || 0 }); };
        reader.onerror = function () { reject(new Error(file.name + ' could not be opened.')); };
        reader.readAsText(file);
      });
    }));
  }
  // The files as one set of readings, read and joined as when adding a session.
  function readingsFromFiles(read) {
    var saved = {}, good = [];
    try { saved = JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); } catch (e) { saved = {}; }
    read.forEach(function (f, i) {
      try {
        var one = T.read(f.text, f.name, null, f.modified);
        if (one.needsMapping) {
          var mp = saved[headerSig(one.needsMapping.headers)];
          if (!mp) throw new Error(f.name + ': we do not recognise its columns. Add it once as a new session to teach us, then try again.');
          one = T.read(f.text, f.name, mp, f.modified);
        }
        good.push({ f: f, rd: one, k: fileKey(one, i), i: i });
      } catch (e) { if (/recognise its columns/.test(e.message)) throw e; /* a file that cannot be read is left out */ }
    });
    if (!good.length) throw new Error('None of those files could be read.');
    good.sort(function (x, y) { return x.k - y.k || x.i - y.i; });
    return T.combine(joinCarFiles(good, false).good.map(function (x) { return x.rd; }));
  }
  // Why a file is not the drive the session was saved from, or '' when it is.
  function readingsMismatch(s, a) {
    var off = [];
    if (s.duration && a.duration && Math.abs(a.duration - s.duration) > 1.5) off.push('its length');
    if (s.distance && a.distance && Math.abs(a.distance - s.distance) > Math.max(30, 0.03 * s.distance)) off.push('its distance');
    if (s.origin && a.origin && s.origin.length === 2 && a.origin.length === 2 && T.haversine({ lat: s.origin[0], lng: s.origin[1] }, { lat: a.origin[0], lng: a.origin[1] }) > 3000) off.push('where it was');
    return off.length ? 'That does not look like the file this session was saved from (' + off.join(' and ') + ' is different). Pick the same file again.' : '';
  }
  function addReadingsAgain(s, files, note) {
    note('Reading ' + (files.length > 1 ? files.length + ' files' : files[0].name) + '...');
    return Promise.all([readTextFiles(files), getLibrary()]).then(function (r) {
      var rd = readingsFromFiles(r[0]), why = readingsMismatch(s, T.analyse(rd, r[1], { type: 'other' }));
      if (why) throw new Error(why);
      note('Sending your readings...');
      return api('POST', '/track/session/source?id=' + encodeURIComponent(s.id), sourceOf(rd), true);
    }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'The readings could not be kept.');
      showSession(s.id);
    }).catch(function (e) { note((e && e.message) || 'That did not work.'); throw e; });
  }
  // Refresh a saved session's Track Mode figures from the car file, with no new session: the same drive's files are
  // picked again and read as when adding one, and only the summary of the car's figures is sent to replace the old.
  function carAgainHtml() {
    return '<div class="tp-car-again"><button type="button" class="btn btn-secondary btn-sm" data-car-again>' + icon('upload') + 'Refresh these figures from the file</button>' +
      '<input type="file" multiple accept=".vbo,.csv,.gpx,.txt,text/csv,application/gpx+xml" hidden data-car-file>' +
      '<p class="tp-small">Saved before we kept every peak? Pick the same files again (the car\'s file and the lap timer\'s, if you used both) to work out these figures again. Nothing else on the session changes and no new session is made.</p>' +
      '<p class="tp-small tp-err" data-car-note role="status"></p></div>';
  }
  function refreshCarData(s, files, note) {
    note('Reading ' + (files.length > 1 ? files.length + ' files' : files[0].name) + '...');
    return Promise.all([readTextFiles(files), getLibrary()]).then(function (r) {
      var rd = readingsFromFiles(r[0]), a = T.analyse(rd, r[1], { type: 'other' }), why = readingsMismatch(s, a);
      if (why) throw new Error(why);
      if (!a.carData) throw new Error('There are no Track Mode figures in those files. Pick the car\'s own file (telemetry-v1-....csv) as well.');
      // Each lap's own figures, from the same timing the session has (its type, organiser and lines).
      var laps = [];
      try {
        var o = { type: s.type, ignoreFirstFinish: s.ignoreFinish !== false };
        if (s.rollout) o.rollout = true;
        if (s.organizer) o.organizer = s.organizer;
        if (s.finishCrossing) o.finishCrossing = s.finishCrossing;
        if (s.startLineFromMember && s.startLine) { o.startLine = s.startLine; if (s.finishLine) o.finishLine = s.finishLine; }
        if (s.linesAccepted && s.startLine) o.ownLines = true;
        (T.analyse(rd, r[1], o).laps || []).forEach(function (l) { if (l.carData) laps.push({ n: l.n, run: l.run, carData: l.carData }); });
      } catch (e) { laps = []; }
      note('Saving the new figures...');
      return api('POST', '/track/session/car?id=' + encodeURIComponent(s.id), { carData: a.carData, carSource: a.carSource || null, laps: laps });
    }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'The figures could not be saved.');
      showSession(s.id);
    }).catch(function (e) { note((e && e.message) || 'That did not work.'); throw e; });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-car-again]');
    if (btn) { var inp = btn.parentNode.querySelector('[data-car-file]'); if (inp) inp.click(); }
  });
  document.addEventListener('change', function (e) {
    var input = e.target && e.target.matches && e.target.matches('[data-car-file]') ? e.target : null;
    if (!input || !input.files.length || !view || !view.s) return;
    var box = input.parentNode, btn = box.querySelector('[data-car-again]'), noteEl = box.querySelector('[data-car-note]');
    btn.disabled = true;
    refreshCarData(view.s, input.files, function (t) { noteEl.textContent = t; }).catch(function () { btn.disabled = false; input.value = ''; });
  });
  function wireReadingsAgain() {
    [].slice.call(document.querySelectorAll('.tp-readings-again')).forEach(function (box) {
      var btn = box.querySelector('[data-readings-again]'), input = box.querySelector('[data-readings-file]'), noteEl = box.querySelector('[data-readings-note]');
      btn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        if (!input.files.length || !view) return;
        btn.disabled = true;
        addReadingsAgain(view.s, input.files, function (t) { noteEl.textContent = t; }).catch(function () { btn.disabled = false; input.value = ''; });
      });
    });
  }

  // ---------- Editing a saved session's map ----------
  // Once saved, a session's start and finish lines are fixed so every time stays comparable. A member who finds
  // one in the wrong place presses Request Edit Map; MT3UK allows it for that one session; the member moves the
  // lines on the map and sends the change; and the session only changes once MT3UK has accepted it.
  function lineEditHtml(s) {
    if (!s.mine || s.street || (s.type !== 'sprint' && s.type !== 'track')) return '';
    // No readings kept (a session saved before we kept them, or a file too long to keep): say why there is no button.
    if (!s.hasSource) {
      var why = readingsSending[s.id] ? 'Your readings are still being sent. Keep this page open: the options for the lines appear when they have arrived.'
        : 'This session\'s readings were not kept (' + (s.readingsMessage ? esc(String(s.readingsMessage).replace(/\.$/, '')) : 'a session saved before we kept them, or a file too long to keep') + '), so its lines cannot be edited. Add the readings again below, or add the file again as a new session.';
      return '<div class="tp-section" id="lineedit" data-tile="lineedit"><div class="tp-head">' + '<h2>Start and finish lines</h2></div><div class="card tp-fields"><p class="tp-src">' + icon('info') + '<span>' + why + '</span></p>' + (readingsSending[s.id] ? '' : readingsAgainHtml()) + '</div></div>';
    }
    return '<div class="tp-section" id="lineedit" data-tile="lineedit"><div class="tp-head">' + '<h2>Start and finish lines</h2></div><div class="card tp-fields" id="tp-lineedit"><p class="tp-sub">Checking...</p></div></div>';
  }
  // The track name on a session at a track we do not list: the member suggests a new name and sends it for approval (no
  // permission step); the admin accepts or denies it and the member is emailed either way.
  // At a track we do list, what can be wrong is the name of its layout ("Brands Hatch, New Layout"), which every session on
  // that layout shares: a rename is asked for here and, once MT3UK approves it, changes for everyone.
  function layoutRename(s) { return !!(s.venueId && s.layoutId && s.layout && s.type !== 'drag' && s.type !== 'other'); }
  function renameHtml(s) {
    if (!s.mine || s.street) return '';
    if (s.venueId ? !layoutRename(s) : !s.venue) return '';
    return '<div class="tp-section" id="rename" data-tile="rename"><div class="tp-head">' + '<h2>' + (layoutRename(s) ? 'Layout name' : 'Track name') + '</h2></div><div class="card tp-fields" id="tp-rename"><p class="tp-sub">Checking...</p></div></div>';
  }
  function drawRename(s, st) {
    var box = document.getElementById('tp-rename');
    if (!box) return;
    var h = '', p = st && st.proposal, lay = layoutRename(s), cur = lay ? s.layout : s.venue;
    if (p) {
      h = '<p class="tp-src">' + icon('info') + '<span>Your suggested name has gone to MT3UK. We will email you when it has been approved or turned down. ' + (lay ? 'The layout keeps its name until then.' : 'This session keeps its name until then.') + '</span></p><p class="tp-small">From <b>' + esc(p.from || cur) + '</b> to <b>' + esc(p.to) + '</b>.</p>' +
        '<button type="button" class="btn btn-secondary" id="tp-rename-edit">' + icon('pin') + 'Suggest a different name</button>';
    } else {
      h = (lay ? '<p class="tp-sub">This session is on the layout <b>' + esc(s.layout) + '</b> at ' + esc(s.venue) + '. Every session on that layout shares its name, so if it is wrong, suggest a new one. MT3UK checks it before it changes for everyone with a session on this layout.</p>'
        : '<p class="tp-sub">This track is not in the MT3UK track list, so it has the name you typed: <b>' + esc(s.venue) + '</b>. If it is wrong, suggest a new name. MT3UK checks it before it changes.</p>') +
        '<div class="tp-field"><label for="tp-rename-name">' + (lay ? 'Layout name' : 'Track name') + '</label><input class="field" id="tp-rename-name" maxlength="60" value="' + esc(cur) + '"></div>' +
        '<button type="button" class="btn btn-primary" id="tp-rename-send">' + icon('pin') + 'Send for approval</button>';
    }
    h += '<p class="tp-small tp-err" id="tp-rename-note" role="status"></p>';
    box.innerHTML = h;
    var note = document.getElementById('tp-rename-note'), send = document.getElementById('tp-rename-send'), again = document.getElementById('tp-rename-edit');
    if (again) again.addEventListener('click', function () { drawRename(s, { state: 'granted', proposal: null }); });
    if (send) send.addEventListener('click', function () {
      var name = document.getElementById('tp-rename-name').value.trim();
      if (!name) { note.textContent = lay ? 'Enter the layout name.' : 'Enter the track name.'; return; }
      send.disabled = true;
      api('POST', '/track/rename/propose', { id: s.id, name: name }).then(function (d) {
        if (!d.success) { send.disabled = false; note.textContent = d.message || 'Could not send that.'; return; }
        drawRename(s, { state: 'granted', proposal: d.proposal });
      }).catch(function () { send.disabled = false; note.textContent = 'Could not reach the server.'; });
    });
  }
  function wireRename(s) {
    if (!document.getElementById('tp-rename')) return;
    api('GET', '/track/rename/status?id=' + encodeURIComponent(s.id)).then(function (d) {
      if (view && view.s === s) drawRename(s, d.success ? d : { state: 'none', proposal: null });
    }).catch(function () { drawRename(s, { state: 'none', proposal: null }); });
  }
  function drawLineEdit(s, st) {
    var box = document.getElementById('tp-lineedit');
    if (!box) return;
    var sprint = s.type === 'sprint', h = '', p = st && st.proposal;
    if (!st || st.state === 'none') {
      h = '<p class="tp-sub">The lines are fixed once a session is saved, so every ' + (sprint ? 'run' : 'lap') + ' stays comparable. If ' + (sprint ? 'the start or the finish is' : 'the start line is') + ' in the wrong place, ask MT3UK to let you edit this map.</p>' +
        '<div class="tp-field"><label for="tp-line-why">What is wrong with the line' + (sprint ? 's' : '') + '? (optional)</label><input class="field" id="tp-line-why" maxlength="300" placeholder="For example, the finish is too early"></div>' +
        '<button type="button" class="btn btn-secondary" id="tp-line-request">' + icon('pin') + 'Request Edit Map</button>';
    } else if (st.state === 'pending') {
      h = '<p class="tp-src">' + icon('info') + '<span>Requested. MT3UK has been told and will email you when you can edit this map.</span></p>';
    } else if (p) {
      h = '<p class="tp-src">' + icon('info') + '<span>Your change is waiting for MT3UK to approve it. The map and the time on this session stay as they are until then.</span></p>' +
        '<p class="tp-small">Time from ' + esc(p.from.time ? V.fmtLap(p.from.time) : 'none') + ' to ' + esc(p.to.time ? V.fmtLap(p.to.time) : 'none') + ' on the new lines.</p>' +
        '<button type="button" class="btn btn-secondary" id="tp-line-edit">' + icon('pin') + 'Change it again</button>';
    } else {
      h = '<p class="tp-sub">MT3UK has said you can edit this map. Move the ' + (sprint ? 'start and finish lines' : 'start line') + ', check the time and send the change. Nothing on this session changes until MT3UK approves it. If it does, the new lines can apply to every session at this track.</p>' +
        '<button type="button" class="btn btn-primary" id="tp-line-edit">' + icon('pin') + 'Edit the map</button>';
    }
    h += '<p class="tp-small tp-err" id="tp-line-note" role="status"></p>';
    box.innerHTML = h;
    var note = document.getElementById('tp-line-note');
    var req = document.getElementById('tp-line-request'), ed = document.getElementById('tp-line-edit');
    if (req) req.addEventListener('click', function () {
      req.disabled = true;
      var why = document.getElementById('tp-line-why');
      api('POST', '/track/lines/request', { id: s.id, note: why ? why.value.trim() : '' }).then(function (d) {
        if (!d.success) { req.disabled = false; note.textContent = d.message || 'Could not send that.'; return; }
        drawLineEdit(s, { state: d.state || 'pending', proposal: null });
      }).catch(function () { req.disabled = false; note.textContent = 'Could not reach the server.'; });
    });
    if (ed) ed.addEventListener('click', function () { ed.disabled = true; startLineEdit(s, note); });
  }
  function wireLineEdit(s) {
    if (!document.getElementById('tp-lineedit') || !s.hasSource) return;
    api('GET', '/track/lines/status?id=' + encodeURIComponent(s.id)).then(function (d) {
      if (view && view.s === s) drawLineEdit(s, d.success ? d : { state: 'none', proposal: null });
    }).catch(function () { drawLineEdit(s, { state: 'none', proposal: null }); });
  }
  // The saved readings come back and go through the same screen as adding a file, on the lines as they are now.
  function startLineEdit(s, note) {
    if (note) note.textContent = 'Loading your readings...';
    Promise.all([fetchSource(s.id), getMine(), getLibrary()]).then(function (r) {
      var src = r[0], m = r[1];
      if (!src.p || !m) throw new Error(sourceError(src));
      var car = m.cars.filter(function (c) { return c.id === s.carId; })[0] || m.cars[0];
      VW = vwOf(car);
      add = { car: car, drive: (car && car.drive) || '', cars: m.cars, lib: r[2], admin: false, rd: restoreSource(src), session: null, type: s.type, startLine: s.startLine || null, finishLine: s.type === 'sprint' ? (s.finishLine || null) : null,
        editLines: true, confirmLines: false, lineEdit: true, organizer: s.organizer || '', ignoreFinish: s.ignoreFinish !== false, finishCross: s.finishCrossing || 0, rollout: !!s.rollout,
        conditions: s.conditions || 'Dry', condTouched: true, privacy: s.privacy, street: false, tyres: s.tyres || '', tyre: tyreInit(s), pads: padInit(s), temp: s.temp, tempSource: s.tempSource || '', weather: s.weather || null,
        notes: s.notes || '', publicNote: s.publicNote || '', logger: s.logger || '', loggerTouched: !!s.logger, date: s.date, time: s.time, venueName: s.venueId ? '' : s.venue, replaceId: s.id, files: null, list: null,
        oldLines: { startLine: s.startLine || null, finishLine: s.type === 'sprint' ? (s.finishLine || null) : null, time: s.bestTime || null } };
      analyse();
      window.scrollTo(0, 0);
    }).catch(function (e) { if (note) note.textContent = (e && e.message) || 'Could not load your readings.'; var b = document.getElementById('tp-line-edit'); if (b) b.disabled = false; });
  }
  // The pictures for MT3UK's email: the old lines and the new ones on the same view. Best effort: a change is sent
  // without them if they cannot be drawn or sent.
  function linePictures(a, s) {
    var LI = window.MT3UKLineImage, sprint = s.type === 'sprint', o = a.oldLines || {};
    if (!LI) return Promise.resolve([null, null]);
    var set = function (st, fi) { return [st ? { line: st, kind: 'start', label: sprint ? 'Start' : 'Start / finish' } : null, sprint && fi ? { line: fi, kind: 'finish', label: 'Finish' } : null].filter(Boolean); };
    if (!a.tapOutline) a.tapOutline = T.outline(a.rd.points);
    // As on the map the member moved the lines on: a session of many laps shows only its fastest lap, not every lap
    // joined into one tangle.
    var bestRows = s.trace && s.trace.laps && s.best && s.trace.laps[s.best], outline;
    if (bestRows && bestRows.length > 10 && s.origin && s.origin.length === 2 && s.laps && s.laps.length > 1) {
      var bp = T.projector(s.origin[0], s.origin[1]);
      outline = bestRows.map(function (r) { return bp.ll(r[2], r[3]); });
    } else outline = a.tapOutline.map(function (p) { return [p[0], p[1]]; });
    var base = { frame: [].concat(o.startLine || [], o.finishLine || [], s.startLine || [], sprint ? s.finishLine || [] : []), outline: outline };
    var make = function (title, time, lines) { return LI.make(Object.assign({ title: title, subtitle: time ? 'Time ' + V.fmtLap(time) : '', lines: lines }, base)).catch(function () { return null; }); };
    return Promise.all([make('Old lines', o.time, set(o.startLine, o.finishLine)), make('New lines', s.bestTime, set(s.startLine, s.finishLine))]);
  }
  function sendPicture(id, which, blob) {
    var headers = { 'Content-Type': 'application/octet-stream' };
    if (token()) headers['X-Session-Token'] = token();
    return fetch(API + '/track/lines/image?id=' + encodeURIComponent(id) + '&which=' + which, { method: 'POST', headers: headers, body: blob }).catch(function () {});
  }
  // Send the moved lines to MT3UK. Nothing on the session changes yet.
  function sendLineChange(btn) {
    var a = add, s = a.session;
    if (!s || s.needsStartLine || !s.startLine || (s.type === 'sprint' && !s.finishLine)) { status('Set both lines first.', 'error'); return; }
    btn.disabled = true;
    status('Making the pictures of the old and new lines...');
    linePictures(a, s).then(function (pics) {
      status('Sending...');
      return Promise.all([pics[0] ? sendPicture(a.replaceId, 'before', pics[0]) : null, pics[1] ? sendPicture(a.replaceId, 'after', pics[1]) : null]);
    }).catch(function () {}).then(function () {
      return api('POST', '/track/lines/propose', { id: a.replaceId, startLine: s.startLine, finishLine: s.type === 'sprint' ? s.finishLine : null, time: s.bestTime || null });
    }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not send that.');
      // Recorded: the screen says so, with a Close button that goes back to the session, rather than leaving at once.
      // It is kept as state so a later redraw (the weather arriving, say) keeps showing it.
      a.sent = true;
      drawResult();
      var sentBox = document.getElementById('tp-sent');
      if (sentBox && sentBox.scrollIntoView) sentBox.scrollIntoView({ block: 'center' });
    }).catch(function (e) { btn.disabled = false; status((e && e.message) || 'Could not send that.', 'error'); });
  }

  // ---------- One session ----------
  var view = null;
  function showSession(id) {
    loading();
    var my = routeSeq;
    Promise.all([api('GET', '/track/session?id=' + encodeURIComponent(id)), getMine().catch(function () { return null; }), loadTyres(), getLibrary().catch(function () { return null; }), loadPads()]).then(function (r) {
      if (stale(my)) return;
      var d = r[0];
      if (!d.success) return failed('This session isn\'t available. It may be private or removed.');
      if (!d.session.hasSource && d.session.readingsRefused && !d.session.readingsMessage) d.session.readingsMessage = d.session.readingsRefused.message;
      VW = d.session.vehicleType === 'bike' ? 'bike' : 'car';
      view = { s: d.session, mine: r[1], a: d.session.best || 1, b: null, other: {}, members: [], memberById: {} };
      var timed = (d.session.laps || []).filter(function (l) { return l.kind !== 'short' && l.n !== view.a; }).sort(function (x, y) { return x.time - y.time; });
      view.b = timed[0] ? String(timed[0].n) : null;
      // Other members' best laps at this track, from its leaderboard.
      var bp = d.session.venueId && d.session.layoutId && (d.session.type === 'track' || d.session.type === 'sprint')
        ? (d.session.type === 'sprint' ? '/sprint/board?venue=' : '/track/board?venue=') + encodeURIComponent(d.session.venueId) + '&layout=' + encodeURIComponent(d.session.layoutId) : '';
      var board = bp ? api('GET', bp).catch(function () { return null; }) : Promise.resolve(null);
      return board.then(function (b) {
        if (stale(my)) return;
        var mineIds = {};
        ((view.mine && view.mine.sessions) || []).forEach(function (x) { mineIds[x.id] = 1; });
        view.members = ((b && b.entries) || []).filter(function (e) { return e.sessionId && e.sessionId !== d.session.id && e.carId !== d.session.carId && !mineIds[e.sessionId] && e.time; }).slice(0, 50);
        view.members.forEach(function (e) { view.memberById[e.sessionId] = e; });
        drawSession();
        if (d.cachedAt) app.insertAdjacentHTML('afterbegin', oldNote(d.cachedAt));
      });
    }).catch(function (err) {
      if (window.console) console.error(err);
      failed(isOffline() ? 'This session is not on this device. Open it once while you are online and it will be here next time you are offline.' : 'This session could not be loaded. Check your connection and try again.');
    });
  }
  // Skip to section: lists the sections this session page has and scrolls to the one chosen.
  var SKIP_TO = [['#tp-headline', 'Best lap and headline times'], ['#compare', 'Compare laps'], ['#tp-mapcard', 'Map'], ['#tp-gbox', 'G-force and speed'], ['[data-tile="corners"]', 'Corner by corner'],
    ['[data-tile="grip"]', 'How much grip you used'], ['[data-tile="cmpnotes"]', 'What the laps say'], ['#tp-laps', 'Laps'], ['[data-tile="spotted"]', 'What we spotted'], ['#over-time', 'Over time'],
    ['#tp-impact', 'What each mod did'], ['#lineedit', 'Start and finish lines'], ['#settings', 'Session settings']];
  function wireSkip(s) {
    var sel = document.getElementById('tp-skip');
    if (!sel) return;
    SKIP_TO.forEach(function (x) {
      if (!document.querySelector(x[0])) return;
      var o = document.createElement('option'); o.value = x[0]; o.textContent = x[1]; sel.appendChild(o);
    });
    // Sprints, drag runs and drives have a few sections of their own: any section heading on the page is offered as well.
    if (sel.options.length < 3) [].forEach.call(document.querySelectorAll('#app .tp-section[id], #app details[id]'), function (el) {
      var h = el.querySelector('h2, h3, summary h3'); if (!h || sel.querySelector('option[value="#' + el.id + '"]')) return;
      var o = document.createElement('option'); o.value = '#' + el.id; o.textContent = h.textContent.trim(); sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      var el = sel.value && document.querySelector(sel.value);
      sel.value = '';
      if (!el) return;
      if (el.tagName === 'DETAILS') el.open = true;
      var inner = el.closest && el.closest('details'); if (inner) inner.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  function drawSession() {
    var s = view.s;
    lastSession = s.id;
    // Add a session stays in the page heading on the owner's own session, for the same car.
    heroAddCar = s.mine && s.carId ? s.carId : null;
    heroAdd();
    // Where it falls among your sessions at this track that day, by time of day.
    var place = s.mine && view.mine ? dayPlace(s, view.mine.sessions) : null;
    var h = (justSaved && s.mine ? savedHtml(justSaved) : '') + back(s.mine ? 'Your sessions' : 'Back', s.mine ? '' : (s.carId ? 'car=' + encodeURIComponent(s.carId) : ''));
    if (s.adminView) h += '<p class="tp-admin-banner" id="tp-admin-banner">' + icon('lock') + 'Admin view, read only. This is a private session and this view is logged. Notes are not shown.</p>';
    // Skip to a section (filled in once the page is drawn, from the sections it has) and Exit session, at the top.
    h += '<div class="tp-session-bar" id="tp-session-bar"><label class="tp-skip"><select class="field" id="tp-skip" aria-label="Skip to section"><option value="">Skip to section</option></select></label>' +
      '<a class="btn btn-secondary btn-sm tp-exit" id="tp-exit" href="track.html' + (!s.mine && s.carId ? '?car=' + encodeURIComponent(s.carId) : '') + '" data-go="' + (!s.mine && s.carId ? 'car=' + esc(encodeURIComponent(s.carId)) : '') + '">' + icon('x') + 'Exit session</a></div>';
    h += '<div class="tp-head tp-session-head"><div><h2>' + esc(trackName(s)) + '</h2>' + (s.ownerName ? '<p class="tp-by" id="tp-by">' + icon('user') + '<span>Session by <b>' + esc(s.ownerName) + '</b>' + (s.mine ? ' (you)' : '') + '</span></p>' : '') + '<p class="tp-sub">' + (s.type === 'sprint' ? '<b id="tp-kind">' + (isHillSession(s, library) ? 'Hill climb' : 'Sprint') + '</b> &middot; ' : '') + esc(niceDate(s.date)) + (s.time ? ', ' + esc(s.time) : '') + (place ? ' &middot; <b id="tp-day-place">Session ' + place.n + ' of ' + place.of + ' that day</b>' : '') + (s.car ? ' &middot; ' + esc(s.car) : '') + (s.conditions ? ' &middot; ' + esc(s.conditions) : '') + (s.temp != null ? ', ' + esc(s.temp) + '°C' + (s.tempSource === 'weather' ? ' (Open-Meteo)' : s.tempSource === 'file' ? ' (from file)' : '') : '') + (s.drive ? ' &middot; ' + esc(s.drive) : '') + (s.tyres ? ' &middot; ' + esc(s.tyres) : '') + (s.pads ? ' &middot; <span id="tp-pads-line">Pads: ' + esc(s.pads) + '</span>' : '') + (s.logger ? ' &middot; <span id="tp-logger-line">Logger: ' + esc(s.logger) + '</span>' : '') + '</p>' + publicNoteHtml(s.publicNote) + launchLine(s) + (s.fileName && (s.mine || s.adminView) ? '<p class="tp-small tp-filename" id="tp-filename">' + icon('file') + 'File: ' + esc(s.fileName) + '</p>' : '') + (s.mine || s.adminView ? '<p class="tp-small tp-sid" id="tp-sid">Session ID: <code id="tp-sid-text">' + esc(s.id) + '</code> <button type="button" class="btn btn-ghost btn-sm" id="tp-sid-copy" aria-label="Copy the session ID">' + icon('copy') + '<span>Copy</span></button></p>' : '') + '</div><div class="tp-head-side">' + (s.mine ? privacyPill(s.privacy, s.street) + '<span id="tp-rank-slot"></span>' : '') + refreshChip() + unitsChip() + (s.street || s.privacy === 'private' ? '' : shareDot('Share this session')) + '</div></div>';
    LW = s.type === 'sprint' ? 'Run' : 'Lap';
    // Timed with older code and no readings kept to work it out again: only uploading the file again updates it.
    if (s.mine && !s.hasSource && s.type !== 'other' && (s.analysisVersion || 1) < T.ANALYSIS_VERSION) h += '<p class="tp-notice" id="tp-old-version">' + icon('info') + '<span>Timed with an older version. Upload the file again to update the times.</span></p>';
    var untimed = s.type === 'other' && !(s.laps && s.laps.length);
    if (s.type === 'drag') h += dragHtml(s);
    else if (untimed) h += otherHtml(s);
    else if (s.mine && s.reverseRun) h += reverseHtml(s) + trackHtml(s);
    else h += trackHtml(s);
    if (s.mine) h += lineEditHtml(s) + renameHtml(s) + ownerHtml(s);
    else if (s.adminView) h += adminLayoutHtml(s);
    // The board of movable panels, opened in trackHtml after the Compare laps pickers, takes everything to here.
    if (boardOpen) { h += '</div>'; boardOpen = false; }
    justSaved = null;
    app.innerHTML = h;
    wireSkip(s);
    if (s.type === 'drag') drawDragCharts(s);
    else if (untimed) drawOtherCharts(s);
    else drawTrackCharts(s);
    // Sprints and hill climbs have runs, not laps.
    if (s.type === 'sprint') runWords(app);
    if (s.mine) wireOwner(s);
    else if (s.adminView) wireAdminLayout(s);
    var sidBtn = document.getElementById('tp-sid-copy');
    if (sidBtn) sidBtn.addEventListener('click', function () { copyText(s.id, sidBtn); });
    if (s.mine) wireLineEdit(s);
    if (s.mine) wireRename(s);
    if (s.mine && !s.hasSource) wireReadingsAgain();
    if (!s.street && s.privacy !== 'private') {
      var what = s.type === 'drag' ? 'Drag run' : s.type === 'sprint' ? (isHillSession(s, library) ? 'Hill climb run' : 'Sprint run') : 'Track session', res = sessionResult(s);
      wireShare({ url: SITE_URL + 'track.html?s=' + encodeURIComponent(s.id), heading: 'Share this session', subject: trackName(s) + ' | Laps by MT3UK', campaign: 'track_session',
        text: what + ' at ' + trackName(s) + (res ? ', ' + res + ',' : '') + ' on Laps by MT3UK' });
    }
    if (s.mine && boardPathOf(s)) loadRanks(s.carId, [s]).then(function (r) {
      var slot = document.getElementById('tp-rank-slot');
      if (slot && view && view.s === s && r[s.id]) slot.innerHTML = rankBadge(r[s.id], trackName(s));
    });
  }
  var LW = 'Lap';
  // Set when a session has just been saved, so the page it opens on says so once.
  var justSaved = null;
  function savedHtml(j) {
    if (j.queued) {
      return '<div class="tp-notice is-ok tp-saved" id="tp-saved" role="status">' + icon('check') + '<div><b>Saved on this device</b><br>' + (j.queued === 1 ? 'Your session is' : j.queued + ' sessions are') +
        ' kept here because there is no connection. ' + (j.queued === 1 ? 'It is' : 'They are') + ' sent when you are next online with Laps open, and your changes are synced then.' +
        (j.batch > j.queued ? '<br><span class="tp-small">' + (j.batch - j.queued) + ' more saved now.</span>' : '') +
        (j.skipped && j.skipped.length ? '<br><span class="tp-small">' + j.skipped.length + ' file' + (j.skipped.length === 1 ? ' was' : 's were') + ' not saved: ' + esc(j.skipped.map(function (x) { return x.name + ' (' + x.reason + ')'; }).join('; ')) + '</span>' : '') +
        '</div><button type="button" class="tp-saved-x" id="tp-saved-x" aria-label="Dismiss">' + icon('x') + '</button></div>';
    }
    if (j.text) return '<div class="tp-notice is-ok tp-saved" id="tp-saved" role="status">' + icon('check') + '<div><b>Done</b><br>' + esc(j.text) + '</div><button type="button" class="tp-saved-x" id="tp-saved-x" aria-label="Dismiss">' + icon('x') + '</button></div>';
    if (j.batch) {
      return '<div class="tp-notice is-ok tp-saved" id="tp-saved" role="status">' + icon('check') + '<div><b>Saved</b><br>' + (j.split ? 'Split into ' : '') + j.batch + ' session' + (j.batch === 1 ? '' : 's') + (j.split ? '.' : (j.joined ? ' saved. ' + j.joined + (j.joined === 1 ? ' has' : ' have') + ' the car\'s Track Mode data joined on.' : ' saved, one for each file.')) + ' They are grouped by day below.' +
        (j.noReadings && j.noReadings.length ? '<br><span class="tp-small">The readings were not kept for ' + esc(j.noReadings.join(', ')) + ' (a long file can be too big), so their type and map lines cannot be changed later.</span>' : '') +
        (j.skipped && j.skipped.length ? '<br><span class="tp-small">' + j.skipped.length + ' file' + (j.skipped.length === 1 ? ' was' : 's were') + ' not saved: ' + esc(j.skipped.map(function (x) { return x.name + ' (' + x.reason + ')'; }).join('; ')) + '</span>' : '') + '</div>' +
        '<button type="button" class="tp-saved-x" id="tp-saved-x" aria-label="Dismiss">' + icon('x') + '</button></div>';
    }
    var many = j.files > 1;
    return '<div class="tp-notice is-ok tp-saved" id="tp-saved" role="status">' + icon('check') + '<div><b>Saved</b><br>' +
      (many ? 'Your ' + j.files + ' files were combined into one session. ' : 'Your session is saved. ') +
      (j.sending ? '<br><span class="tp-small">Your readings are still being sent. Keep this page open until they have arrived: the options to change the type and the map lines appear then.</span><br>' : '') +
      (j.readings ? '<br><span class="tp-small">Your readings were not kept (' + esc(String(j.readings).replace(/\.$/, '')) + '), so this session\'s type and map lines cannot be changed later. Add the file again if you need that.</span><br>' : '') +
      '<a class="tp-link" href="track.html" data-go="">Go back to Track sessions</a></div>' +
      '<button type="button" class="tp-saved-x" id="tp-saved-x" aria-label="Dismiss">' + icon('x') + '</button></div>';
  }
  // Swaps lap words for run words in the page's text (not in attributes).
  function runWords(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), node, list = [];
    while ((node = walker.nextNode())) list.push(node);
    list.forEach(function (n) {
      n.nodeValue = n.nodeValue.replace(/\bLaps\b/g, 'Runs').replace(/\blaps\b/g, 'runs').replace(/\bLap\b/g, 'Run').replace(/\blap\b/g, 'run');
    });
  }
  // The lines may be the wrong way round: a faster pass in the file crosses them finish first (the climb, when the
  // drive back down is what got timed).
  function reverseHtml(s) {
    var r = s.reverseRun;
    if (!r || s.type !== 'sprint') return '';
    return '<div class="tp-notice is-warn" id="tp-reverse">' + icon('warn') + '<div><b>The start and finish may be the wrong way round.</b><br>This is timed at up to ' + esc(V.fmtV(r.fwdPeak)) + ', but a faster pass (up to ' + esc(V.fmtV(r.peak)) + ', ' + esc(V.fmtLap(r.time)) + ') crosses the two lines the other way. If that is the ' + (isHillSession(s, library) ? 'climb' : 'run') + ', ' + (s.officialLines ? 'the lines MT3UK has set for this course may be the wrong way round: please tell MT3UK.' : 'the start line should be where you set off and the finish at the end of the ' + (isHillSession(s, library) ? 'hill' : 'run') + '.') + '</div></div>';
  }
  // Other sessions without laps: the drive mapped, with its numbers.
  function otherHtml(s) {
    var h = (s.pendingCourse ? '<div class="tp-notice is-warn" id="tp-pending-course">' + icon('pin') + '<div><b>Saved without times</b><br>' + esc(s.pendingCourse) + ' is not set up yet, and MT3UK has been told. Once it is, change this session\'s type to Sprint or hill climb (or Track day) in Session settings below to time it.</div></div>' : '') + tiles([
      ['Top speed', s.vmax ? V.fmtV(s.vmax) : '-', '', 1],
      ['Most grip used' + (s.gDerived ? ' (estimated)' : ''), s.latMax ? s.latMax.toFixed(2) + ' g' : '-', s.brakeMax ? 'Braking ' + s.brakeMax.toFixed(2) + ' g' : ''],
      ['Distance', s.distance ? V.fmtD(s.distance) : '-', s.duration ? Math.round(s.duration / 60) + ' minutes' : '']
    ]);
    h += carDataHtml(s);
    h += '<div class="card"><div class="tp-chart-head"><h3>Your drive, coloured by speed</h3></div><svg class="tv-chart" id="tp-map" role="img" aria-label="The drive drawn from GPS, coloured by speed"></svg>' +
      '<div class="tp-chart-foot"><span class="tp-ramp"><span id="tp-ramp-lo"></span><i></i><span id="tp-ramp-hi"></span></span><span>Other sessions are mapped but not timed for a leaderboard.</span></div></div>';
    return h;
  }
  function drawOtherCharts(s) {
    var out = s.outline || (s.trace && s.trace.outline) || [];
    if (out.length < 2) return;
    var proj = T.projector(out[0][0], out[0][1]), d = 0, prev = null;
    var trace = out.map(function (p) { var xy = proj.xy(p[0], p[1]); if (prev) d += Math.hypot(xy[0] - prev[0], xy[1] - prev[1]); prev = xy; return [d, 0, xy[0], xy[1], p[2] || 0, 0, 0]; });
    var mm = V.map(document.getElementById('tp-map'), trace, { origin: [out[0][0], out[0][1]] });
    if (mm) { document.getElementById('tp-ramp-lo').textContent = V.fmtV(mm.vmin); document.getElementById('tp-ramp-hi').textContent = V.fmtV(mm.vmax); }
  }
  // Pressures in bar or psi (remembered in this browser).
  var PSI_PER_BAR = 14.5038;
  var pressUnit = 'bar';
  try { if (localStorage.getItem('mt3ukPressure') === 'psi') pressUnit = 'psi'; } catch (e) { /* storage blocked */ }
  function press(bar, dp) { return pressUnit === 'psi' ? Math.round(bar * PSI_PER_BAR) + '' : bar.toFixed(dp); }
  // Which of a day's sessions the tiles show ('all' for the whole day).
  // The Track Mode and Laps cards stay open or closed as last left, from one session to the next and between
  // visits, so flicking through a day's sessions does not mean opening them each time.
  var carRun = 'all', carRunFor = null, carOpen = false, lapsOpen = false;
  try { carOpen = localStorage.getItem('mt3ukCarOpen') === '1'; lapsOpen = localStorage.getItem('mt3ukLapsOpen') === '1'; } catch (e) { /* storage blocked */ }
  function rememberCard(id, key) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { localStorage.setItem(key, el.open ? '1' : '0'); } catch (err) { /* storage blocked */ }
    return el.open;
  }
  // The toggle event comes a moment after the click, so a redraw straight after one reads the cards as they are.
  function rememberCards() {
    var c = rememberCard('car-data', 'mt3ukCarOpen'), l = rememberCard('tp-laps', 'mt3ukLapsOpen');
    if (c !== null) carOpen = c;
    if (l !== null) lapsOpen = l;
  }
  document.addEventListener('toggle', function (e) {
    if (e.target && (e.target.id === 'car-data' || e.target.id === 'tp-laps')) rememberCards();
  }, true);
  document.addEventListener('click', function (e) {
    var rb = e.target.closest && e.target.closest('#car-data [data-car-run]');
    if (rb && view && view.s) {
      carRun = rb.getAttribute('data-car-run');
      var cb = document.getElementById('car-data');
      if (cb) cb.outerHTML = carDataHtml(view.s, chosenLap(view.s));
      var nr = document.querySelector('#car-data [data-car-run="' + carRun + '"]');
      if (nr) nr.focus();
      return;
    }
    var b = e.target.closest && e.target.closest('#car-data [data-press]');
    if (!b || !view || !view.s) return;
    pressUnit = b.getAttribute('data-press');
    try { localStorage.setItem('mt3ukPressure', pressUnit); } catch (err) { /* storage blocked */ }
    var box = document.getElementById('car-data');
    if (box) box.outerHTML = carDataHtml(view.s, chosenLap(view.s));
    var nb = document.querySelector('#car-data [data-press="' + pressUnit + '"]');
    if (nb) nb.focus();
  });
  // Track Mode's temperature zones, as owners describe the colours on the car's
  // screen: under 70% normal, then yellow, orange (the car starts holding back)
  // and red at 100%. Shown as colour and a short meaning, never as degrees.
  function heatZone(p) {
    if (p >= 100) return { cls: 'is-red', text: 'Red: at the limit, the car cuts power' };
    if (p >= 85) return { cls: 'is-orange', text: 'Orange: near the limit, the car may hold back power' };
    if (p >= 70) return { cls: 'is-yellow', text: 'Yellow: warm, close to peak performance' };
    return { cls: 'is-ok', text: 'Normal operating range' };
  }
  // Peak power late in the session well under what it was early on, when the
  // throttle was flat out both times: the car probably held power back.
  function powerHeldBack(p) {
    return p && p.early >= 50 && p.late > 0 && p.late < p.early * 0.9 ? p : null;
  }
  // The car's own channels, when the file had them (Tesla Track Mode does).
  // lap (optional): the lap chosen above the figures. Its own figures show when the file had them and they were kept.
  function carDataHtml(s, lap) {
    var all = s.carData;
    if (!all) return '';
    if (carRunFor !== s.id) { carRun = 'all'; carRunFor = s.id; }
    var lapCar = lap && lap.carData ? lap.carData : null;
    var runs = !lap && all.runs && all.runs.length > 1 ? all.runs : null, word = partWord(s.type);
    var picked = runs && carRun !== 'all' ? runs.filter(function (r) { return String(r.run) === carRun; })[0] : null;
    if (!picked) carRun = 'all';
    var c = lapCar ? Object.assign({ found: all.found, empty: all.empty }, lapCar) : picked ? Object.assign({ found: all.found, empty: all.empty }, picked) : all;
    // Which session the figures come from.
    var from = lapCar ? lapName(lap, s) + ', ' + niceDate(s.date) + (s.time ? ' at ' + s.time : '')
      : lap ? 'The whole session: this lap\'s own figures were not kept for this session. Adding the file again, or the admin\'s Re-time sessions, brings them.'
      : picked ? cap(word) + ' ' + picked.run + ' of ' + runs.length + ', ' + niceDate(s.date)
      : runs ? 'The whole day, all ' + runs.length + ' ' + word + 's, ' + niceDate(s.date)
      : 'This ' + word + ', ' + niceDate(s.date) + (s.time ? ' at ' + s.time : '');
    if (s.carSource && s.carSource.name) from += '. The car\'s figures come from ' + s.carSource.name + ', lined up with the lap timer file' + (s.carSource.match ? ' (match ' + Number(s.carSource.match).toFixed(2) + ')' : '') + (s.carSource.g ? '. Speed and g-forces are the car\'s own, not worked out from GPS' : '') + '.';
    var t = [], pct = function (n) { return Math.round(n) + '%'; };
    // Small figures (one lap uses 1 to 2%) keep a decimal, so 1.3% is not shown as 1%; bigger ones are whole numbers.
    if (c.soc) {
      var used = c.soc.start - c.soc.end, fine = Math.abs(used) < 10;
      var pc = function (v) { return (fine ? Math.round(v * 10) / 10 : Math.round(v)) + '%'; };
      t.push(['Charge used', pc(used), 'Of the battery, ' + pc(c.soc.start) + ' to ' + pc(c.soc.end)]);
    }
    if (c.power) t.push(['Peak power', Math.round(c.power.max) + ' kW', c.power.regen ? 'Regeneration up to ' + Math.round(c.power.regen) + ' kW' : '']);
    if (c.brakePressure) t.push(['Hardest braking', press(c.brakePressure.max, 1) + ' ' + pressUnit, 'Peak master cylinder pressure, as the car reports it, not pedal force']);
    if (c.throttle) t.push(['Flat out', Math.round(c.throttle.full * 100) + '%', 'Of the time, throttle at 95% or more']);
    var z;
    if (c.batteryTemp) { z = heatZone(c.batteryTemp.max); t.push(['Battery temperature', 'Up to ' + pct(c.batteryTemp.max), 'Started at ' + pct(c.batteryTemp.start) + '. ' + z.text, 0, 'tp-heat ' + z.cls]); }
    if (c.brakeTemp) { z = heatZone(c.brakeTemp.max); t.push(['Hottest brakes (estimated)', pct(c.brakeTemp.max), 'The car\'s own estimate, not a reading. ' + z.text, 0, 'tp-heat ' + z.cls]); }
    if (c.inverterTemp) { z = heatZone(c.inverterTemp.max); t.push(['Hottest inverter', pct(c.inverterTemp.max), z.text, 0, 'tp-heat ' + z.cls]); }
    if (c.tyrePressure) t.push(['Tyre pressure', press(c.tyrePressure.start, 2) + ' to ' + press(c.tyrePressure.end, 2) + ' ' + pressUnit, 'Start to end, average of the four']);
    if (c.slip) t.push(['Most tyre slip', c.slip.max.toFixed(2), 'Estimated by the car']);
    if (!t.length && !(c.empty || []).length) return '';
    var hasPress = c.brakePressure || c.tyrePressure, held = powerHeldBack(c.power);
    // Folded away until opened, with the headline figures in the summary.
    var gist = t.slice(0, 3).map(function (x) { return x[0] + ' ' + x[1]; }).join(', ');
    return '<details class="card tp-cardata" id="car-data"' + (carOpen ? ' open' : '') + '><summary><h2>Track Mode</h2><span class="tp-small">' + esc(gist || 'The car\'s own data') + '</span><span class="tp-open">' + icon('chev') + '</span></summary><div class="tp-head">' +
      (hasPress ? '<div class="tp-chips" role="group" aria-label="Pressure in">' + ['bar', 'psi'].map(function (u) { return '<button type="button" class="chip chip-sm' + (u === pressUnit ? ' is-on' : '') + '" data-press="' + u + '" aria-pressed="' + (u === pressUnit) + '">' + u + '</button>'; }).join('') + '</div>' : '') +
      '</div>' +
      (runs ? '<div class="tp-chips tp-car-runs" role="group" aria-label="Show the figures for">' + [['all', 'Whole day']].concat(runs.map(function (r) { return [String(r.run), cap(word) + ' ' + r.run]; })).map(function (o) { return '<button type="button" class="chip chip-sm' + (o[0] === carRun ? ' is-on' : '') + '" data-car-run="' + o[0] + '" aria-pressed="' + (o[0] === carRun) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>' : '') +
      '<p class="tp-sub tp-car-from" id="tp-car-from">' + icon('info') + esc(from) + '</p>' +
      (t.length ? tiles(t) : '') +
      (held ? '<div class="tp-note tp-held" id="tp-held">' + icon('warn') + '<p>Power held back? Flat out, your peak power fell from ' + held.early + ' kW early in the session to ' + held.late + ' kW late on.<small>The car limits power as parts get hot. Compare with the temperatures above.</small></p></div>' : '') +
      '<p class="tp-small">Read from the file your car wrote. Temperatures are shown as a percentage, as the car reports them, not in degrees. Their colours follow the Track Mode zones as owners describe them (yellow from 70%, orange from 85%, red at 100%).' +
      ((c.empty || []).length ? ' In the file but empty: ' + esc((c.empty || []).join(', ').toLowerCase()) + '.' : '') + '</p>' +
      (s.mine ? carAgainHtml() : '') + '</details>';
  }
  function tiles(list) {
    return '<div class="tp-tiles">' + list.map(function (t) { return '<div class="tp-tile' + (t[3] ? ' is-hero' : '') + (t[4] ? ' ' + t[4] : '') + '"><div class="k">' + esc(t[0]) + '</div><div class="v">' + esc(t[1]) + '</div><div class="s">' + esc(t[2] || '') + '</div></div>'; }).join('') + '</div>';
  }
  // The lap chosen above the headline figures (none: the whole session).
  var lapSel = null, lapSelFor = null;
  function chosenLap(s) { return lapSel ? (s.laps || []).filter(function (l) { return l.n === lapSel; })[0] || null : null; }
  // Most cornering and braking g in one lap, from its trace (sideways and lengthways g are columns 5 and 6).
  function lapG(s, l) {
    var rows = (s.trace && s.trace.laps && s.trace.laps[l.n]) || [], lat = 0, brake = 0;
    rows.forEach(function (p) { lat = Math.max(lat, Math.abs(p[5] || 0)); brake = Math.max(brake, -(p[6] || 0)); });
    return { lat: lat, brake: brake };
  }
  // The headline tiles and the Track Mode figures, for the whole session or for the lap chosen.
  function headlineHtml(s) {
    var laps = s.laps || [], sprint = s.type === 'sprint', LWd = sprint ? 'Run' : 'Lap';
    var best = laps.filter(function (l) { return l.n === s.best; })[0], sel = chosenLap(s);
    var h;
    if (sel) {
      var g = lapG(s, sel);
      var vs = best && sel.n !== best.n ? '+' + (sel.time - best.time).toFixed(2) + ' s on your best ' + LWd.toLowerCase() : sel.n === s.best ? 'Your best ' + LWd.toLowerCase() : '';
      h = tiles(sprint ? [
        [LWd + ' time', V.fmtLap(sel.time), lapName(sel, s) + (vs ? ', ' + vs : ''), 1],
        ['Top speed', sel.vmax ? V.fmtV(sel.vmax) : '-', ''],
        ['Most grip used' + (s.gDerived ? ' (estimated)' : ''), g.lat ? g.lat.toFixed(2) + ' g' : '-', g.brake ? 'Braking ' + g.brake.toFixed(2) + ' g' : ''],
        ['Run distance', sel.dist ? V.fmtD(sel.dist) : '-', '']
      ] : [
        [LWd + ' time', V.fmtLap(sel.time), lapName(sel, s) + (vs ? ', ' + vs : ''), 1],
        ['Best possible', s.possible ? V.fmtLap(s.possible) : '-', 'Your best sectors together, whole session'],
        ['Top speed', sel.vmax ? V.fmtV(sel.vmax) : '-', 'This ' + LWd.toLowerCase()],
        ['Most grip used' + (s.gDerived ? ' (estimated)' : ''), g.lat ? g.lat.toFixed(2) + ' g' : '-', g.brake ? 'Braking ' + g.brake.toFixed(2) + ' g' : ''],
        ['Distance', sel.dist ? V.fmtD(sel.dist) : '-', V.fmtLap(sel.time) + ' ' + LWd.toLowerCase()]
      ]);
    } else {
      h = tiles(sprint ? [
        // A sprint is one timed run: no best possible lap, and the distance is the run's.
        ['Best run', best ? V.fmtLap(best.time) : '-', best ? 'Run ' + best.n : '', 1],
        ['Top speed', s.vmax ? V.fmtV(s.vmax) : '-', ''],
        ['Most grip used' + (s.gDerived ? ' (estimated)' : ''), s.latMax ? s.latMax.toFixed(2) + ' g' : '-', s.brakeMax ? 'Braking ' + s.brakeMax.toFixed(2) + ' g' : ''],
        ['Run distance', best && best.dist ? V.fmtD(best.dist) : '-', laps.length > 1 ? laps.length + ' runs in this file' : '']
      ] : [
        ['Best lap', best ? V.fmtLap(best.time) : '-', best ? lapName(best, s) : '', 1],
        ['Best possible', s.possible ? V.fmtLap(s.possible) : '-', s.possible && best && best.time - s.possible < 0.05 ? 'Same as your best lap' : 'Your best sectors together'],
        ['Top speed', s.vmax ? V.fmtV(s.vmax) : '-', ''],
        ['Most grip used' + (s.gDerived ? ' (estimated)' : ''), s.latMax ? s.latMax.toFixed(2) + ' g' : '-', s.brakeMax ? 'Braking ' + s.brakeMax.toFixed(2) + ' g' : ''],
        ['Distance', s.distance ? V.fmtD(s.distance) : '-', s.duration ? Math.round(s.duration / 60) + ' minutes' : '']
      ]);
    }
    // Track Mode figures straight after the headline tiles (nothing when the file had none).
    return h + carDataHtml(s, sel);
  }
  // Choose a lap, or the whole session, for the figures below.
  function lapPickHtml(s) {
    var laps = (s.laps || []).filter(function (l) { return l.kind !== 'short' || l.n === lapSel; });
    // One lap is still a choice: its figures against the whole session's, out and in laps included.
    if (!laps.length) return '';
    var LWd = s.type === 'sprint' ? 'Run' : 'Lap';
    return '<div class="tp-field tp-lap-pick"><label for="tp-lap-pick">Figures for</label><select class="field" id="tp-lap-pick"><option value="">Whole session</option>' + laps.map(function (l) {
      return '<option value="' + l.n + '"' + (lapSel === l.n ? ' selected' : '') + '>' + esc(lapName(l, s) + ', ' + V.fmtLap(l.time) + (l.n === s.best ? ' (best)' : l.kind === 'in' ? ' (in ' + LWd.toLowerCase() + ')' : '')) + '</option>';
    }).join('') + dayOptions(s) + '</select></div>';
  }
  // Your other sessions at this track that day, numbered by time of day as the list is, so the day can be
  // flicked through from here. Choosing one opens it.
  function dayOptions(s) {
    if (!s.mine || !view || !view.mine) return '';
    var k = dayKey(s);
    if (!k) return '';
    var day = view.mine.sessions.filter(function (x) { return x.id === s.id || dayKey(x) === k; }).sort(byTime);
    if (day.length < 2) return '';
    return '<optgroup label="Your other sessions that day">' + day.map(function (o, i) {
      if (o.id === s.id) return '';
      return '<option value="x:' + esc(o.id) + '">' + esc('Session ' + (i + 1) + (o.time ? ', ' + o.time : '') + (o.bestTime ? ', ' + V.fmtLap(o.bestTime) : '')) + '</option>';
    }).join('') + '</optgroup>';
  }
  function trackHtml(s) {
    var laps = s.laps || [];
    var best = laps.filter(function (l) { return l.n === s.best; })[0];
    if (lapSelFor !== s.id) { lapSel = null; lapSelFor = s.id; }
    gReset(s.id);
    var h = lapPickHtml(s) + '<div id="tp-headline">' + headlineHtml(s) + '</div>';
    // The lap times, folded away until opened (shown after Compare laps).
    var lapsHtml = '<details class="card tp-laps" id="tp-laps" data-tile="laps"' + (lapsOpen ? ' open' : '') + '><summary>' + '<h3>Laps</h3><span class="tp-small">' + laps.length + ' ' + (laps.length === 1 ? 'lap' : 'laps') + (best ? ', best ' + V.fmtLap(best.time) : '') + '</span>' + icon('chev') + '</summary><div class="tp-scroll"><table class="tp-table">' + lapTable(s) + '</table></div>' +
      (s.sectorsByThirds ? '<p class="tp-small">Sectors are thirds of the lap until this track has its own sector points.</p>' : '') + '</details>';
    var spottedHtml = '<div class="tp-section" data-tile="spotted"><div class="tp-chart-head">' + '<h3>What we spotted</h3></div><div class="tp-notes">' + notesHtml(T.sessionNotes(s, V.fmtV, V.fmtD)) + '</div></div>';
    // One map: Compare laps' Map, straight after the tiles.
    if (s.trace && s.trace.laps && Object.keys(s.trace.laps).length) {
      h += '<div class="tp-section" id="compare"><div class="tp-head"><h2>Compare laps</h2></div><p class="tp-sub">Pick two laps. Press Play, or move along a chart, to see where both are at the same moment. The slower lap trails by the time gap.</p>' +
        '<div class="card tp-cmp-pick"><div class="tp-f2"><div class="tp-field"><label for="tp-cmp-a">Lap A</label><select class="field" id="tp-cmp-a">' + lapOptions(view.a) + '</select></div><div class="tp-field"><label for="tp-cmp-b">Lap B</label><select class="field" id="tp-cmp-b">' + lapOptions(view.b) + '</select></div></div></div>' +
        '</div><div class="tp-board" id="tp-board"><div class="card tp-o-speed" data-tile="speed"><div class="tp-chart-head">' + '<h3>Speed through the lap</h3><div class="tp-key" id="tp-key"></div></div><svg class="tv-chart" id="tp-speed" role="img" aria-label="Speed against distance for both laps"></svg>' +
        '<div class="tp-chart-head"><h3>Time gap</h3><span class="tp-small" id="tp-gap-cap"></span></div><svg class="tv-chart" id="tp-delta" role="img" aria-label="Running time gap between the laps"></svg>' + '</div>' +
        '<div class="card tp-mapcard" id="tp-mapcard" data-tile="map"><div class="tp-chart-head tp-map-head">' + '<h3>Map</h3><button type="button" class="tp-switch tp-gswitch tp-speedsw" role="switch" id="tp-speedcol" aria-checked="' + cmpSpeed + '"><span>Colour by speed</span><span class="tp-track"></span></button><button type="button" class="tp-rotate-hint" id="tp-rotate-hint" aria-label="Turn the screen sideways for a bigger map" title="Turn the screen sideways for a bigger map">' + icon('rotate') + '</button><button type="button" class="btn btn-secondary btn-sm" id="tp-full" aria-label="Full screen map"></button></div>' +
        '<p class="tp-small tp-sync-note">Both laps at the same moment: the slower one trails by the time gap.</p>' +
        '<div class="tp-play" id="tp-play"><div class="tp-pn-grip" id="tp-pn-grip" role="separator" aria-label="Drag to move the controls" title="Drag to move the controls"><i></i><i></i><i></i></div><div class="tp-play-row"><div class="tp-play-btns"><button type="button" class="btn btn-secondary" id="tp-play-start" data-play="start" aria-label="Go back to the start"></button><button type="button" class="btn btn-secondary" id="tp-play-back" data-play="back"></button><button type="button" class="btn btn-primary" id="tp-play-toggle" data-play="toggle"></button></div><div class="tp-when" id="tp-when" aria-live="off"></div>' +
        '<div class="tp-chips" id="tp-speeds" role="group" aria-label="Playback speed">' + [['0.25', 'x0.25'], ['0.5', 'x0.5'], ['1', 'x1'], ['2', 'x2'], ['5', 'x5']].map(function (v) { return '<button type="button" class="chip" data-speed="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>' +
        '<button type="button" class="chip is-on" id="tp-follow" aria-pressed="true" title="When the map is zoomed in, keep the ' + VW + 's in view">Follow ' + VW + 's</button></div>' +
        '<div class="tp-pn-size" id="tp-pn-size" role="separator" aria-label="Drag to resize the controls" title="Drag to resize the controls"></div>' +
        '</div>' +
        '<div class="tp-mapwrap" id="tp-mapwrap"><svg class="tv-chart" id="tp-map2" role="img" aria-label="Track map with both laps\' lines and positions"></svg>' +
        '<div class="tp-chart-foot tp-speedkey" id="tp-speedkey"' + (cmpSpeed ? '' : ' hidden') + '><span class="tp-ramp"><span id="tp-ramp-lo"></span><i></i><span id="tp-ramp-hi"></span></span><span>Lap A coloured by speed, lap B dashed. Numbers are the slowest corners.</span></div></div>' +
        '<div class="tp-mopts" id="tp-mopts"><button type="button" class="tp-mopts-btn" id="tp-mopts-btn" aria-expanded="false" aria-controls="tp-mopts-card" aria-label="Map options">' + icon('sliders') + '</button>' +
        '<div class="tp-mopts-card" id="tp-mopts-card" hidden><div class="tp-mopts-head"><span>Map options</span><button type="button" class="tp-mopts-x" id="tp-mopts-x" aria-label="Close map options">' + icon('x') + '</button></div>' +
        '<div class="tp-mopts-body" id="tp-mopts-body"><button type="button" class="tp-switch tp-gswitch" role="switch" id="tp-carspeed" aria-checked="' + carSpeed + '"><span>Speed on cars</span><span class="tp-track"></span></button><button type="button" class="btn btn-secondary btn-sm" id="tp-pn-reset">Reset the controls</button></div></div></div>' +
        '<div class="tp-fs-laps" id="tp-fs-laps"></div>' +
        '<div class="tp-split" id="tp-split" role="separator" aria-orientation="vertical" aria-label="Drag to make the map bigger or smaller" title="Drag to make the map bigger or smaller"></div>' +
        '<div class="tp-metrics" id="tp-metrics" aria-live="off"></div>' +
        '<div class="tp-gbox" id="tp-gbox"><div class="tp-chart-head"><h3>G-force' + (s.gDerived ? ' (estimated)' : '') + ' and speed</h3><button type="button" class="tp-switch tp-gswitch" role="switch" id="tp-gshow" aria-checked="' + !gHidden + '"><span>Show G-Forces</span><span class="tp-track"></span></button><div class="tp-chips" id="tp-gtoggles" role="group" aria-label="G-force lines to show">' + G_DEFS.map(function (d) { return '<button type="button" class="chip chip-sm' + (gShow[d[0]] ? ' is-on' : '') + '" data-g="' + d[0] + '" aria-pressed="' + !!gShow[d[0]] + '">' + d[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="tp-gcharts" id="tp-gforce"></div>' +
        // The slider sits under the chart, lined up with its time axis.
        '<div class="tp-scrub-row"><div class="tp-scrub-track" id="tp-scrub-track"><div class="tp-ruler" id="tp-ruler" aria-hidden="true"></div><input type="range" id="tp-scrub" min="0" max="100" step="0.01" value="0" aria-label="Position in the lap"></div><span class="tp-clock" id="tp-clock">0:00.0</span></div>' +
        '<div class="tp-small tp-gpeaks" id="tp-gpeaks"></div><p class="tp-small" id="tp-gnote"></p></div></div>' +
        '<div class="card tp-o-corner" data-tile="corners"><div class="tp-chart-head">' + '<h3>Corner by corner</h3></div><div class="tp-scroll"><table class="tp-table" id="tp-corners"></table></div></div>' +
        '<div class="card" data-tile="grip"><div class="tp-chart-head">' + '<h3>How much grip you used, lap A' + (s.gDerived ? ' (estimated)' : '') + '</h3><span class="tp-small">Each dot is a moment on the lap. The further from the middle, the harder the ' + VW + ' was working the tyres.</span></div><svg class="tv-chart tp-gg" id="tp-gg" role="img" aria-label="Sideways against lengthways g for lap A"></svg></div>' +
        '<div class="card" data-tile="cmpnotes"><div class="tp-chart-head">' + '<h3>What the laps say</h3></div><div class="tp-notes" id="tp-cmp-notes"></div></div>';
      boardOpen = true;
    }
    h += lapsHtml + spottedHtml;
    if (s.mine && s.venueId && s.layoutId) h += '<div class="tp-section" id="over-time" data-tile="overtime"><div class="tp-head">' + '<h2>' + esc(trackName(s)) + ' over time</h2></div><div id="tp-time"></div></div>';
    return h;
  }
  // "Lap 5", or "Session 2, lap 5" on a day made from several files
  // ("Run 2" for sprints and hill climbs).
  // The out lap is not a numbered lap: Lap 1 is the first timed one after it.
  function lapNo(l, s) { return l.n - (s.laps || []).filter(function (x) { return x.kind === 'out' && x.n < l.n; }).length; }
  function lapName(l, s) { return l.kind === 'out' ? 'Out lap' : s.runs > 1 ? cap(partWord(s.type)) + ' ' + (l.run || 1) + ', lap ' + lapNo(l, s) : 'Lap ' + lapNo(l, s); }
  // Clock time of day: "14:34" to seconds, and seconds back to "14:36:12" (past midnight wraps round).
  function clockSecs(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 : null; }
  function fmtClock(sec) { sec = Math.floor(((sec % 86400) + 86400) % 86400); return ('0' + Math.floor(sec / 3600)).slice(-2) + ':' + ('0' + Math.floor(sec % 3600 / 60)).slice(-2) + ':' + ('0' + sec % 60).slice(-2); }
  function lapShort(l, s) { return l.kind === 'out' ? 'Out' : s.runs > 1 ? partWord(s.type).charAt(0).toUpperCase() + (l.run || 1) + ' L' + lapNo(l, s) : 'L' + lapNo(l, s); }
  function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }
  function lapKind(l, s) {
    if (l.n === s.best) return '<span class="tp-badge">Best</span>';
    var k = { 'in': 'In lap', out: 'Out lap', slow: 'Slow', short: 'Cut short' }[l.kind];
    return k ? '<span class="tp-badge is-soft">' + k + '</span>' : '';
  }
  function lapTable(s) {
    var best = (s.laps || []).filter(function (l) { return l.n === s.best; })[0];
    var bs = s.bestSectors || [];
    var n = Math.max.apply(null, [0].concat((s.laps || []).map(function (l) { return (l.sectors || []).length; })));
    var head = '<thead><tr>' + (s.runs > 1 ? '<th>' + cap(partWord(s.type)) + '</th>' : '') + '<th>Lap</th><th>Time</th>';
    for (var i = 0; i < n; i++) head += '<th>S' + (i + 1) + '</th>';
    head += '<th>Top ' + V.unit() + '</th><th>Gap</th></tr></thead>';
    return head + '<tbody>' + (s.laps || []).map(function (l) {
      var cells = '';
      for (var i = 0; i < n; i++) {
        var v = l.sectors && l.sectors[i];
        var isBest = v != null && bs[i] != null && Math.abs(v - bs[i]) < 0.005;
        cells += '<td class="' + (isBest ? 'is-fast' : '') + '">' + (v == null ? '' : v.toFixed(2)) + (isBest ? '<span class="tp-sr"> (best sector)</span>' : '') + '</td>';
      }
      var gap = best && l.n !== best.n && l.kind !== 'short' ? '+' + (l.time - best.time).toFixed(2) : '';
      return '<tr class="' + (l.n === s.best ? 'is-best' : '') + '">' + (s.runs > 1 ? '<td>' + (l.run || 1) + '</td>' : '') + '<td>' + (l.kind === 'out' ? '' : lapNo(l, s)) + lapKind(l, s) + '</td><td>' + V.fmtLap(l.time) + '</td>' + cells + '<td>' + Math.round(V.spd(l.vmax || 0)) + '</td><td>' + gap + '</td></tr>';
    }).join('') + '</tbody>';
  }
  // The same track: the same course where it is a listed one; otherwise by where it was (within 2 km), or by name.
  function sameTrack(o, s) {
    if (o.type !== s.type) return false;
    if (s.layoutId && o.layoutId) return o.venueId === s.venueId && o.layoutId === s.layoutId;
    if (o.origin && s.origin && o.origin.length === 2 && s.origin.length === 2) return T.haversine({ lat: o.origin[0], lng: o.origin[1] }, { lat: s.origin[0], lng: s.origin[1] }) < 2000;
    return !!o.venue && String(o.venue).toLowerCase() === String(s.venue || '').toLowerCase();
  }
  function lapOptions(sel) {
    var s = view.s;
    var h = (s.laps || []).filter(function (l) { return s.trace.laps[l.n] && (l.kind === 'timed' || l.kind === 'in' || l.kind === 'out' || String(l.n) === String(sel)); }).map(function (l) {
      return '<option value="' + l.n + '"' + (String(sel) === String(l.n) ? ' selected' : '') + '>' + lapName(l, s) + ', ' + V.fmtLap(l.time) + (l.n === s.best ? ' (best)' : l.kind === 'in' ? ' (in lap)' : '') + '</option>';
    }).join('');
    // Your best laps from your other sessions at the same track, on any day, so the sessions of one track day
    // can be compared with each other too.
    if (s.mine && view.mine) {
      var others = view.mine.sessions.filter(function (o) { return o.id !== s.id && o.bestTime && sameTrack(o, s); }).sort(function (a, b) { return (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')); });
      if (others.length) h += '<optgroup label="Your other sessions at this track">' + others.map(function (o) {
        var v = 'x:' + o.id;
        return '<option value="' + v + '"' + (sel === v ? ' selected' : '') + '>' + esc(shortDate(o.date) + (o.time ? ', ' + o.time : '')) + ', ' + V.fmtLap(o.bestTime) + '</option>';
      }).join('') + '</optgroup>';
    }
    h += memberOptions(sel);
    return h;
  }
  function memberName(e) { return (e.owner || 'A member') + (e.car ? ', ' + e.car : ''); }
  // Other members' best laps here, from the leaderboard (shared sessions only).
  function memberOptions(sel) {
    var list = (view && view.members) || [];
    if (!list.length) return '';
    return '<optgroup label="Other members\' best laps">' + list.map(function (e) {
      var v = 'x:' + e.sessionId;
      return '<option value="' + esc(v) + '"' + (sel === v ? ' selected' : '') + '>' + esc(memberName(e)) + ', ' + V.fmtLap(e.time) + '</option>';
    }).join('') + '</optgroup>';
  }
  function lapTrace(v) {
    if (String(v).indexOf('x:') === 0) {
      var id = String(v).slice(2);
      if (view.other[id]) return Promise.resolve(view.other[id]);
      return api('GET', '/track/session?id=' + encodeURIComponent(id)).then(function (d) {
        var o = d.session;
        var tr = o && o.trace && o.trace.laps && o.trace.laps[o.best];
        var mem = view.memberById && view.memberById[id];
        // Which lap this is, so A and B say where they came from.
        var lbl = (mem ? initials(mem.owner || 'A member') : o.mine ? 'You' : o.ownerName ? initials(o.ownerName) : 'Best') + ', best, ' + dmy(o.date);
        var bl = (o.laps || []).filter(function (x) { return x.n === o.best; })[0];
        view.other[id] = tr ? { trace: tr, label: lbl, time: o.bestTime, origin: o.origin, startLine: o.startLine, when: { date: o.date, base: clockSecs(o.time), start: (bl && bl.start) || 0 } } : null;
        return view.other[id];
      });
    }
    var l = (view.s.laps || []).filter(function (x) { return String(x.n) === String(v); })[0];
    // Whose lap it is, so A and B can't be mixed up: "You" for your own, otherwise the member's name.
    var who = view.s.mine ? 'You' : (view.s.ownerName || '');
    return Promise.resolve(l ? { trace: view.s.trace.laps[l.n], label: (who ? initials(who) + ', ' : '') + lapShort(l, view.s) + ', ' + dmy(view.s.date), time: l.time, when: { date: view.s.date, base: clockSecs(view.s.time), start: l.start || 0 } } : null);
  }
  function startLineXY(s, line) {
    line = line || s.startLine;
    if (!line || !s.origin || s.origin.length !== 2) return null;
    var proj = T.projector(s.origin[0], s.origin[1]);
    return line.map(function (p) { return proj.xy(p[0], p[1]); });
  }
  // Another session's lap in this session's map coordinates (each session's
  // trace is in metres around its own origin).
  function intoThis(s, o) {
    if (!o.origin || o.origin.length !== 2 || !s.origin || s.origin.length !== 2) return o.trace;
    if (o.origin[0] === s.origin[0] && o.origin[1] === s.origin[1]) return o.trace;
    var from = T.projector(o.origin[0], o.origin[1]), to = T.projector(s.origin[0], s.origin[1]);
    return o.trace.map(function (p) { var ll = from.ll(p[2], p[3]), xy = to.xy(ll[0], ll[1]); var q = p.slice(); q[2] = xy[0]; q[3] = xy[1]; return q; });
  }
  // A lap from a session timed on a different start line (two sessions at a track with no official line each find
  // their own) starts somewhere else round the circuit. A lap is a loop, so it is turned to start where this
  // session's line is, with distance and time counted from there, and the two laps then line up.
  function ontoLine(s, o) {
    var line = startLineXY(s), tr = o.trace;
    // Only laps are loops. A sprint or hill climb run goes from its start to its finish, so turning it round a
    // point would draw a stray line back across the map and shift its times.
    if (s.type === 'sprint' || s.pointToPoint || o.pointToPoint) return o;
    if (!line || !o.startLine || !tr || tr.length < 3) return o;
    var mine = s.startLine && s.startLine.length === 2 && T.haversine({ lat: o.startLine[0][0], lng: o.startLine[0][1] }, { lat: s.startLine[0][0], lng: s.startLine[0][1] }) < 15;
    if (mine) return o;
    var mx = (line[0][0] + line[1][0]) / 2, my = (line[0][1] + line[1][1]) / 2, k = 0, kd = Infinity;
    tr.forEach(function (p, i) { var d = Math.hypot(p[2] - mx, p[3] - my); if (d < kd) { kd = d; k = i; } });
    if (k === 0 || k === tr.length - 1 || kd > 60) return o;
    var D = tr[tr.length - 1][0], T0 = isFinite(o.time) ? o.time : tr[tr.length - 1][1], dk = tr[k][0], tk = tr[k][1];
    function shift(p, dd, dt) { var q = p.slice(); q[0] = Math.round((p[0] + dd) * 10) / 10; q[1] = Math.round((p[1] + dt) * 100) / 100; return q; }
    // From the line to the end of the lap, then the start of the lap up to the line (its first and last points are
    // the same place, so one is dropped), closed by the line point again at the full distance and time.
    var out = tr.slice(k).map(function (p) { return shift(p, -dk, -tk); }).concat(tr.slice(1, k).map(function (p) { return shift(p, D - dk, T0 - tk); }));
    var end = tr[k].slice(); end[0] = D; end[1] = T0; out.push(end);
    return Object.assign({}, o, { trace: out });
  }
  function drawTrackCharts(s) {
    if (!s.trace || !s.trace.laps) return;
    pb.render = null;
    var sa = document.getElementById('tp-cmp-a'), sb = document.getElementById('tp-cmp-b');
    wirePlay();
    applyLayout();
    if (sa) {
      sa.addEventListener('change', function () { view.a = sa.value; drawCompare(s); });
      sb.addEventListener('change', function () { view.b = sb.value; drawCompare(s); });
      drawCompare(s);
    }
    if (s.mine) drawOverTime(s);
  }
  // How the two laps are lined up on the Map.
  // What the G-force charts show (key, label). Each measure switched on gets a chart of its own, stacked, with lap A
  // in its blue and lap B in its orange, as on the map, so colour always means the car. Each session opens showing
  // one, cornering; more can be switched on with the chips.
  var G_DEFS = [['acc', 'Acceleration G'], ['brk', 'Braking G'], ['cor', 'Cornering G']];
  var gShow = { acc: false, brk: false, cor: true }, gShowFor = null;
  function gReset(id) { if (gShowFor !== id) { gShow = { acc: false, brk: false, cor: true }; gShowFor = id; } }

  // The whole G-force and speed chart can be hidden (remembered in this browser).
  var gHidden = false;
  try { gHidden = localStorage.getItem('mt3ukTrackChart') === 'off'; } catch (e) { /* storage blocked */ }
  // ---------- The board ----------
  // Everything from Compare laps down is a tile ([data-tile]) in one 12-column board (#tp-board, .tp-board), each as
  // wide as its --span (DEFAULT_SPAN; full width on a phone). Nothing is moved or resized by the member.
  var boardOpen = false;
  var DEFAULT_SPAN = { speed: 6, map: 6, corners: 6, grip: 6, cmpnotes: 12, laps: 12, spotted: 12, overtime: 12, 'overtime-notes': 6, 'overtime-table': 6, 'overtime-mods': 12, lineedit: 6, rename: 6, settings: 12, adminlayout: 12 };
  var MAP_BASE = 380;
  // Packing: the grid's rows are 1px tall and each tile spans as many as its own height (plus the gap), measured
  // (ResizeObserver, redraws, a window resize), so the next tile starts straight under the one above it instead of
  // under the tallest tile of the row, and the board has no empty blocks.
  var BOARD_GAP = 14, packTick = null, packWatch = null;
  function packBoard() {
    var b = board();
    if (!b) return;
    [].forEach.call(b.querySelectorAll(':scope > [data-tile]'), function (t) {
      var h = t.getBoundingClientRect().height;
      t.style.setProperty('--rows', Math.max(1, Math.ceil(h) + BOARD_GAP));
    });
  }
  function packSoon() { if (packTick) return; packTick = requestAnimationFrame(function () { packTick = null; packBoard(); }); }
  window.addEventListener('resize', packSoon);
  function board() { return document.getElementById('tp-board'); }
  function tilesOf(b) { return b ? [].slice.call(b.querySelectorAll(':scope > [data-tile]')) : []; }
  function keyOf(t) { return t.getAttribute('data-tile'); }
  // Gives each tile its width and watches it for packing, after every draw that adds tiles.
  function applyLayout() {
    var b = board();
    if (!b) return;
    tilesOf(b).forEach(function (t) {
      t.style.setProperty('--span', DEFAULT_SPAN[keyOf(t)] || 12);
      if (window.ResizeObserver) { if (!packWatch) packWatch = new ResizeObserver(packSoon); if (!t.getAttribute('data-packed')) { t.setAttribute('data-packed', '1'); packWatch.observe(t); } }
    });
    packBoard();
  }
  function setCharts(on) {
    gHidden = !on;
    var gs = document.getElementById('tp-gshow'), gbox = document.getElementById('tp-gbox'), mcard = document.getElementById('tp-mapcard');
    if (gs) gs.setAttribute('aria-checked', String(on));
    if (gbox) gbox.classList.toggle('is-off', gHidden);
    // On a phone on its side in full screen, the charts have a panel beside the map; without them the map has it all.
    if (mcard) mcard.classList.toggle('has-charts', on);
    try { localStorage.setItem('mt3ukTrackChart', gHidden ? 'off' : 'on'); } catch (e) { /* storage blocked */ }
    placeHead();
    // Full screen: the map takes the room, so draw it to its new size.
    if (cmpFull && view && view.s) drawCompare(view.s, true);
    else if (cmpAlign) cmpAlign();
  }
  // A phone on its side in full screen: the map and the charts share the screen, split where the member drags the
  // divider (remembered in this browser), the map having at least a third and at most most of it.
  function landFull() { return cmpFull && window.innerWidth > window.innerHeight && window.innerHeight <= 560; }
  var mapSplit = 60;
  try { var ms = parseFloat(localStorage.getItem('mt3ukTrackSplit')); if (ms >= 30 && ms <= 85) mapSplit = ms; } catch (e) { /* storage blocked */ }
  function applySplit() { var card = document.getElementById('tp-mapcard'); if (card) card.style.setProperty('--tp-map', mapSplit + '%'); }
  // With the charts beside the map, the colour switch and Exit join the panel's top row, so they wrap with the chips
  // however narrow the panel is dragged; otherwise the heading is back at the top of the card.
  function placeHead() {
    var card = document.getElementById('tp-mapcard'), head = card && card.querySelector('.tp-map-head'), row = document.querySelector('#tp-gbox .tp-chart-head');
    if (!card || !head) return;
    if (landFull() && !gHidden && row) { if (head.parentNode !== row) row.appendChild(head); }
    else if (head.parentNode !== card || card.firstChild !== head) card.insertBefore(head, card.firstChild);
    // The speed and G figures sit at the top of the charts panel too, not over the map where they hid the cars.
    // The car rows and the G-force pills go with the playback controls on the left (as in portrait), leaving the
    // panel on the right to the charts.
    var mbox = document.getElementById('tp-metrics'), gbox = document.getElementById('tp-gbox'), play = document.getElementById('tp-play'), gt = document.getElementById('tp-gtoggles');
    // The figures float over the map, with no box round them, so the controls stay small.
    if (mbox && gbox && mbox.parentNode !== card) card.insertBefore(mbox, gbox);
    // On a phone on its side the colour switch sits in the Map options card on the left of the map; otherwise it is in
    // the map's heading.
    var sw = document.getElementById('tp-speedcol'), obody = document.getElementById('tp-mopts-body');
    if (sw && obody) {
      if (landFull()) { if (sw.parentNode !== obody) obody.insertBefore(sw, obody.firstChild); }
      else if (sw.parentNode !== head) head.insertBefore(sw, head.querySelector('.tp-rotate-hint'));
    }
    panelClamp();
    // The Lap A and Lap B pickers come along into full screen: first in the Map options card on a phone on its side, in a
    // row under the map when upright, and back in their own card on the page otherwise.
    var la = document.getElementById('tp-cmp-a'), lb = document.getElementById('tp-cmp-b');
    if (la && lb) {
      var fa = la.parentNode, fb = lb.parentNode, home = document.querySelector('.tp-cmp-pick .tp-f2'), fsl = document.getElementById('tp-fs-laps');
      if (landFull() && obody) { if (fa.parentNode !== obody || fb.parentNode !== obody) { obody.insertBefore(fb, obody.firstChild); obody.insertBefore(fa, obody.firstChild); } }
      else if (cmpFull && fsl) { if (fa.parentNode !== fsl || fb.parentNode !== fsl) { fsl.appendChild(fa); fsl.appendChild(fb); } }
      else if (home && (fa.parentNode !== home || fb.parentNode !== home)) { home.appendChild(fa); home.appendChild(fb); }
    }
    // The G-force pills stay in the charts panel's top row.
    if (gt && row && gt.parentNode !== row) row.appendChild(gt);
  }
  document.addEventListener('pointerdown', function (e) {
    var h = e.target.closest && e.target.closest('#tp-split');
    if (!h || !landFull()) return;
    e.preventDefault();
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    h.classList.add('is-dragging');
    function mv(ev) { mapSplit = Math.max(30, Math.min(85, Math.round(ev.clientX / window.innerWidth * 1000) / 10)); applySplit(); }
    function up() {
      h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      h.classList.remove('is-dragging');
      try { localStorage.setItem('mt3ukTrackSplit', String(mapSplit)); } catch (err) { /* storage blocked */ }
      if (view && view.s) drawCompare(view.s, true);
    }
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
  var cmpFull = false, cmpDrawG = null, cmpAlign = null;
  // The map's lap A in speed colours (remembered in this browser).
  var cmpSpeed = true;
  try { cmpSpeed = localStorage.getItem('mt3ukTrackSpeedLine') !== 'off'; } catch (e) { /* storage blocked */ }
  // The speed beside each car's dot (a phone on its side in full screen), on or off (remembered in this browser).
  var carSpeed = true;
  try { carSpeed = localStorage.getItem('mt3ukTrackCarSpeed') !== 'off'; } catch (e) { /* storage blocked */ }
  // The playback controls in landscape full screen float: moved by their top grip, resized by their corner, and the
  // place and width are remembered in this browser ({ x, y, w } in pixels from the top left of the screen).
  var panel = null;
  try { var pj = JSON.parse(localStorage.getItem('mt3ukTrackPanel') || 'null'); if (pj && isFinite(pj.x) && isFinite(pj.y) && isFinite(pj.w)) panel = pj; } catch (e) { /* storage blocked */ }
  function panelApply() {
    var mc = document.getElementById('tp-mapcard');
    if (!mc) return;
    if (!panel) { mc.removeAttribute('data-pn'); mc.style.removeProperty('--pn-x'); mc.style.removeProperty('--pn-y'); mc.style.removeProperty('--pn-w'); return; }
    mc.setAttribute('data-pn', 'on');
    mc.style.setProperty('--pn-x', panel.x + 'px'); mc.style.setProperty('--pn-y', panel.y + 'px'); mc.style.setProperty('--pn-w', panel.w + 'px');
  }
  // Keeps the panel on the screen: its width fits, and a corner of it can always be reached.
  function panelClamp() {
    var mc = document.getElementById('tp-mapcard'), pn = document.getElementById('tp-play');
    if (!panel || !mc || !pn || !landFull()) return;
    var cw = mc.clientWidth, ch = mc.clientHeight;
    panel.w = Math.max(260, Math.min(panel.w, cw - 8));
    panel.x = Math.max(0, Math.min(panel.x, cw - panel.w));
    panel.y = Math.max(0, Math.min(panel.y, ch - Math.min(pn.offsetHeight || 60, ch)));
    panelApply();
  }
  function panelSave() { try { if (panel) localStorage.setItem('mt3ukTrackPanel', JSON.stringify(panel)); else localStorage.removeItem('mt3ukTrackPanel'); } catch (e) { /* storage blocked */ } }
  function panelStart(e, mode) {
    var mc = document.getElementById('tp-mapcard'), pn = document.getElementById('tp-play');
    if (!mc || !pn || !landFull()) return;
    e.preventDefault();
    var cr = mc.getBoundingClientRect(), pr = pn.getBoundingClientRect(), h = e.currentTarget;
    // The first drag takes the panel from its resting place to where it is now.
    var from = panel || { x: pr.left - cr.left, y: pr.top - cr.top, w: pr.width };
    var sx = e.clientX, sy = e.clientY;
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    function mv(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      panel = mode === 'move' ? { x: from.x + dx, y: from.y + dy, w: from.w } : { x: from.x, y: from.y, w: from.w + dx };
      panelClamp(); panelApply();
    }
    function up() {
      h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      panelSave();
    }
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }
  // The distance a lap had reached after t seconds.
  function distAtTime(trace, t) {
    var lo = 0, hi = trace.length - 1;
    if (t <= trace[0][1]) return trace[0][0];
    if (t >= trace[hi][1]) return trace[hi][0];
    while (lo < hi) { var m = (lo + hi) >> 1; if (trace[m][1] < t) lo = m + 1; else hi = m; }
    var p = trace[lo - 1], q = trace[lo], f = (t - p[1]) / ((q[1] - p[1]) || 1);
    return p[0] + (q[0] - p[0]) * f;
  }
  // Play the two laps along the track in real time (x1), forwards or back.
  var cmpFollow = true;
  var pb = { raf: 0, playing: false, dir: 1, speed: 1, t: 0, last: 0, active: false, render: null, tEnd: 0 };
  function clock(t) { var m = Math.floor(t / 60), sec = t - m * 60; return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(1); }
  // The time ruler above the slider: minutes and seconds, as many labels as fit.
  function drawRuler(tEnd) {
    var r = document.getElementById('tp-ruler');
    if (!r || !(tEnd > 0)) return;
    var wpx = r.clientWidth || 300, fit = Math.max(2, Math.floor(wpx / 46));
    var step = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600].filter(function (st) { return tEnd / st <= fit; })[0] || 600;
    var minor = step / (step === 15 ? 3 : step === 5 ? 5 : 2);
    var h = '';
    for (var t = 0; t <= tEnd + 1e-6; t += minor) {
      var pct = t / tEnd * 100, major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      h += '<i class="' + (major ? 'is-major' : '') + '" style="left:' + pct.toFixed(2) + '%"></i>';
      if (major && pct <= 92) h += '<span class="' + (t === 0 ? 'is-first' : '') + '" style="left:' + pct.toFixed(2) + '%">' + Math.floor(t / 60) + ':' + ('0' + Math.round(t % 60)).slice(-2) + '</span>';
    }
    r.innerHTML = h;
  }
  // The slider's orange fill, up to where the lap is.
  function scrubFill(sc) { if (sc && +sc.max > 0) sc.style.setProperty('--p', (Math.min(1, +sc.value / +sc.max) * 100).toFixed(2) + '%'); }
  function playUi() {
    var tog = document.getElementById('tp-play-toggle'), back = document.getElementById('tp-play-back'), st = document.getElementById('tp-play-start');
    if (!tog || !back) return;
    // On a phone Start and Rewind show just their icons (CSS), so each says what it is.
    if (st && !st.firstChild) st.innerHTML = icon('start') + '<span class="tp-bl">Start</span>';
    var fw = pb.playing && pb.dir > 0, bw = pb.playing && pb.dir < 0;
    tog.innerHTML = icon(fw ? 'pause' : 'play') + '<span class="tp-bl">' + (fw ? 'Pause' : 'Play') + '</span>';
    tog.setAttribute('aria-label', fw ? 'Pause' : 'Play');
    back.innerHTML = icon(bw ? 'pause' : 'rewind') + '<span class="tp-bl">' + (bw ? 'Pause' : 'Rewind') + '</span>';
    back.setAttribute('aria-label', bw ? 'Pause rewinding' : 'Rewind');
    document.querySelectorAll('#tp-speeds [data-speed]').forEach(function (b) {
      var on = parseFloat(b.getAttribute('data-speed')) === pb.speed;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function stopPlay() {
    if (pb.raf) cancelAnimationFrame(pb.raf);
    pb.raf = 0; pb.playing = false;
    playUi();
  }
  // Back to the start of the lap: stops playback and puts both cars on the line.
  function toStart() {
    if (!pb.render) return;
    stopPlay();
    pb.active = true;
    pb.t = 0;
    pb.render(0);
  }
  function startPlay(dir) {
    if (!pb.render) return;
    if (pb.playing && pb.dir === dir) { stopPlay(); return; }
    if (dir > 0 && pb.t >= pb.tEnd) pb.t = 0;
    if (dir < 0 && pb.t <= 0) pb.t = pb.tEnd;
    pb.dir = dir; pb.playing = true; pb.active = true; pb.last = 0;
    // Starting playback always puts the cars back in view when zoomed in.
    setFollow(true);
    if (cmpMap && cmpMap.prefetchSat) cmpMap.prefetchSat();
    playUi();
    if (!pb.raf) pb.raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    pb.raf = 0;
    if (!pb.playing) return;
    // A long gap (the tab was hidden) isn't played through.
    var dt = pb.last ? Math.min(0.1, (now - pb.last) / 1000) : 0;
    pb.last = now;
    pb.t += pb.dir * pb.speed * dt;
    if ((pb.dir > 0 && pb.t >= pb.tEnd) || (pb.dir < 0 && pb.t <= 0)) {
      pb.t = pb.dir > 0 ? pb.tEnd : 0;
      pb.render(pb.t);
      stopPlay();
      return;
    }
    pb.render(pb.t);
    pb.raf = requestAnimationFrame(tick);
  }
  function gUi() {
    document.querySelectorAll('#tp-gtoggles [data-g]').forEach(function (b) {
      var on = !!gShow[b.getAttribute('data-g')];
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  // Full screen: the map fills the screen with the controls, numbers and
  // G-force lines along the bottom. Redrawn to the new size, keeping the lap's place.
  function fullUi() {
    var b = document.getElementById('tp-full'), card = document.getElementById('tp-mapcard');
    if (card) card.classList.toggle('is-full', cmpFull);
    document.body.classList.toggle('tp-noscroll', cmpFull);
    if (b) {
      b.innerHTML = icon(cmpFull ? 'x' : 'expand') + (cmpFull ? 'Exit full screen' : 'Full screen');
      b.setAttribute('aria-label', cmpFull ? 'Exit full screen' : 'Full screen map');
    }
  }
  // The rotate button in portrait full screen turns the screen sideways: the browser only allows that in its own full
  // screen, so it asks for that first. Where the phone or browser will not (an iPhone), it says to turn the phone.
  function rotateToast(text) {
    var old = document.getElementById('tp-rotate-toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.id = 'tp-rotate-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1300;max-width:86%;padding:10px 16px;border-radius:10px;background:#16233d;color:#fff;font:600 0.9rem/1.3 "IBM Plex Sans",sans-serif;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.4)';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 3500);
  }
  function lockLandscape() {
    var so = window.screen && window.screen.orientation, el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    function fail() {
      rotateToast('Turn your phone sideways to use the bigger map.');
      try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) { /* nothing to leave */ }
    }
    if (!so || !so.lock) { fail(); return; }
    var p = null;
    try { p = req ? req.call(el) : null; } catch (e) { p = null; }
    Promise.resolve(p).then(function () { return so.lock('landscape'); }).catch(fail);
  }
  function unlockOrientation() {
    try { if (window.screen && screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* not locked */ }
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) { /* not in full screen */ }
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#tp-rotate-hint')) lockLandscape(); });
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement) { try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* not locked */ } } });
  function setFull(on) {
    cmpFull = !!on;
    if (!cmpFull) unlockOrientation();
    fullUi();
    placeHead();
    if (view && view.s && document.getElementById('tp-map2')) drawCompare(view.s, true);
    if (cmpFull) { var b = document.getElementById('tp-full'); if (b) b.focus({ preventScroll: true }); }
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cmpFull) setFull(false); });
  // Turning the phone while full screen: draw the map to the new size.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!cmpFull) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { panelClamp(); placeHead(); if (cmpFull && view && view.s && document.getElementById('tp-map2')) drawCompare(view.s, true); }, 200);
  });
  // Whether a zoomed-in map keeps the cars in view. Dragging the map turns it off.
  var cmpMap = null;
  function setFollow(on) {
    cmpFollow = on;
    var fol = document.getElementById('tp-follow');
    if (fol) { fol.classList.toggle('is-on', on); fol.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (cmpMap && cmpMap.setFollow) cmpMap.setFollow(on);
  }
  function wirePlay() {
    var box = document.getElementById('tp-play');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-play]'), sp = e.target.closest('[data-speed]');
      if (b && b.getAttribute('data-play') === 'start') toStart();
      else if (b) startPlay(b.getAttribute('data-play') === 'back' ? -1 : 1);
      else if (sp) { pb.speed = parseFloat(sp.getAttribute('data-speed')); playUi(); }
    });
    var fol = document.getElementById('tp-follow');
    if (fol) fol.addEventListener('click', function () { setFollow(!cmpFollow); });
    var fb = document.getElementById('tp-full');
    if (fb) fb.addEventListener('click', function () { setFull(!cmpFull); });
    var sc = document.getElementById('tp-speedcol');
    if (sc) sc.addEventListener('click', function () {
      cmpSpeed = !cmpSpeed;
      sc.setAttribute('aria-checked', String(cmpSpeed));
      var key = document.getElementById('tp-speedkey');
      if (key) key.hidden = !cmpSpeed;
      try { localStorage.setItem('mt3ukTrackSpeedLine', cmpSpeed ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
      if (view && view.s) drawCompare(view.s, true);
    });
    // Map options: a small button on the left of the map opens a card with the two map switches (it starts closed).
    var ob = document.getElementById('tp-mopts-btn'), oc = document.getElementById('tp-mopts-card'), ox = document.getElementById('tp-mopts-x'), cs = document.getElementById('tp-carspeed');
    function openOpts(on) { if (oc) oc.hidden = !on; if (ob) { ob.hidden = on; ob.setAttribute('aria-expanded', String(on)); } }
    if (ob) ob.addEventListener('click', function () { openOpts(true); });
    if (ox) ox.addEventListener('click', function () { openOpts(false); if (ob) ob.focus(); });
    var gr = document.getElementById('tp-pn-grip'), sz = document.getElementById('tp-pn-size'), rs = document.getElementById('tp-pn-reset');
    if (gr) gr.addEventListener('pointerdown', function (e) { panelStart(e, 'move'); });
    // Hold anywhere on the panel that is not a button to move it, not only the grip.
    var pnEl = document.getElementById('tp-play');
    if (pnEl) pnEl.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button, a, input, select, #tp-pn-size, #tp-pn-grip')) return;
      panelStart(e, 'move');
    });
    if (sz) sz.addEventListener('pointerdown', function (e) { panelStart(e, 'size'); });
    if (rs) rs.addEventListener('click', function () { panel = null; panelSave(); panelApply(); });
    panelApply();
    function showCarSpeed() { var mc = document.getElementById('tp-mapcard'); if (mc) mc.setAttribute('data-carspeed', carSpeed ? 'on' : 'off'); if (cs) cs.setAttribute('aria-checked', String(carSpeed)); }
    showCarSpeed();
    if (cs) cs.addEventListener('click', function () {
      carSpeed = !carSpeed;
      showCarSpeed();
      try { localStorage.setItem('mt3ukTrackCarSpeed', carSpeed ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
    });
    var gs = document.getElementById('tp-gshow'), gbox = document.getElementById('tp-gbox'), mcard = document.getElementById('tp-mapcard');
    if (gbox) gbox.classList.toggle('is-off', gHidden);
    if (mcard) mcard.classList.toggle('has-charts', !gHidden);
    applySplit();
    if (gs) gs.addEventListener('click', function () { setCharts(gHidden); });
    var gt = document.getElementById('tp-gtoggles');
    if (gt) gt.addEventListener('click', function (e) {
      var b = e.target.closest('[data-g]');
      if (!b) return;
      var k = b.getAttribute('data-g');
      gShow[k] = !gShow[k];
      gUi();
      if (cmpDrawG) cmpDrawG();
    });
    gUi();
    fullUi();
    document.getElementById('tp-scrub').addEventListener('input', function (e) {
      if (!pb.render) return;
      stopPlay();
      pb.active = true;
      pb.t = parseFloat(e.target.value) || 0;
      scrubFill(e.target);
      pb.render(pb.t);
    });
    playUi();
  }
  function drawCompare(s, keep) {
    // Redrawing for full screen carries on from the same place in the lap.
    var resume = keep ? { t: pb.t, active: pb.active, playing: pb.playing, dir: pb.dir } : null;
    // ...and from the same zoom and place on the map.
    var zoomed = keep && cmpMap && cmpMap.zoom && cmpMap.zoom.frac ? cmpMap.zoom.frac() : null;
    Promise.all([lapTrace(view.a), lapTrace(view.b || view.a)]).then(function (r) {
      var A = r[0], B = r[1];
      if (!A || !B) return;
      // Another day's lap, moved onto this session's map.
      if (A.origin) A = ontoLine(s, Object.assign({}, A, { trace: intoThis(s, A) }));
      if (B.origin) B = view.b ? ontoLine(s, Object.assign({}, B, { trace: intoThis(s, B) })) : A;
      var c1 = RUN_COLORS[0], c2 = RUN_COLORS[1];
      document.getElementById('tp-key').innerHTML = '<span><i style="background:' + c1 + '"></i>' + esc(A.label) + ' (A)</span><span><i style="background:' + c2 + '"></i>' + esc(B.label) + ' (B)</span>';
      var at = V.traceAt;
      var dmax = Math.min(A.trace[A.trace.length - 1][0], B.trace[B.trace.length - 1][0]);
      var dk = V.distK(), xt = V.nice(0, dmax / dk, 6).map(function (v) { return v * dk; }).filter(function (v) { return v <= dmax; }), xf = function (v) { return V.fmtD(v); };
      var vmax = 0; A.trace.concat(B.trace).forEach(function (p) { vmax = Math.max(vmax, V.spd(p[4])); });
      var yt = V.nice(0, vmax, 6);
      var mapEl = document.getElementById('tp-map2');
      var mapBox = document.getElementById('tp-mapwrap');
      var fill = cmpFull && mapBox ? { w: mapBox.clientWidth, h: mapBox.clientHeight } : null;
      var lines = cmpSpeed ? (A === B ? [{ trace: A.trace, ramp: true }] : [{ trace: B.trace, color: c2, dash: '6 5' }, { trace: A.trace, ramp: true }])
        : (A === B ? [{ trace: A.trace, color: c1 }] : [{ trace: B.trace, color: c2 }, { trace: A.trace, color: c1 }]);
      // The whole session's laps underneath as the track's width.
      var band = Object.keys(s.trace.laps).map(function (k) { return s.trace.laps[k]; });
      var mo = V.map(mapEl, A.trace, { fill: fill, ratio: fill ? undefined : MAP_BASE / Math.max(200, mapBox ? mapBox.clientWidth : 600), mono: true, lines: lines, band: band, full: { on: function () { return cmpFull; }, toggle: function () { setFull(!cmpFull); }, state: function () { return null; } }, startLine: startLineXY(s), finishLine: s.type === 'sprint' ? startLineXY(s, s.finishLine) : null, corners: s.corners, origin: s.origin });
      var lo = document.getElementById('tp-ramp-lo'), hi = document.getElementById('tp-ramp-hi');
      if (mo && lo && hi) { lo.textContent = V.fmtV(mo.vmin); hi.textContent = V.fmtV(mo.vmax); }
      cmpMap = mo;
      if (zoomed && mo && mo.zoom && mo.zoom.restore && zoomed.k > 1.01) mo.zoom.restore(zoomed);
      if (mo && mo.setFollow) mo.setFollow(cmpFollow);
      if (mo && mo.zoom && mo.zoom.onPan) mo.zoom.onPan(function () { if (cmpFollow) setFollow(false); });
      // G-force rows [distance, acceleration, cornering] for each lap, as recorded (not averaged), so the line
      // reaches the same peaks as the headline figures and the Max labels. Cornering keeps its sign, one way
      // positive and the other negative, as RaceBox draws it.
      function smoothG(trace) {
        return trace.map(function (p) { return [p[0], p[6], p[5]]; });
      }
      var ga = smoothG(A.trace), gb = A === B ? ga : smoothG(B.trace);
      // Holding or hovering on a G chart reads the recorded row nearest the finger, not a blend of two rows: a blend
      // can never reach a peak that sits on one row, so the reading would stop short of the Max label.
      function nearRow(rows, x) {
        var lo = 0, hi = rows.length - 1;
        while (lo < hi) { var m = (lo + hi) >> 1; if (rows[m][0] < x) lo = m + 1; else hi = m; }
        var p0 = rows[Math.max(0, lo - 1)], q0 = rows[lo];
        return Math.abs(q0[0] - x) < Math.abs(p0[0] - x) ? q0 : p0;
      }
      var fmtAcc = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + ' g'; }, fmtCor = fmtAcc, fmtBrk = function (v) { return Math.max(0, -v).toFixed(2) + ' g'; };
      // The numbers under the map: each lap's speed and G-force where its dot is.
      var mbox = document.getElementById('tp-metrics');
      function mrow(id, colour, label) {
        return '<div class="tp-mrow"><span class="tp-mkey" style="background:' + colour + '"></span><b>' + esc(label) + '</b>' +
          '<span class="tp-mv"><small>Speed</small><i data-m="' + id + '-v">-</i></span><span class="tp-mv"><small>Accel</small><i data-m="' + id + '-acc">-</i></span><span class="tp-mv"><small>Corner</small><i data-m="' + id + '-cor">-</i></span></div>';
      }
      if (mbox) mbox.innerHTML = '<div class="tp-mhead" aria-hidden="true"><span></span><span></span><span>Speed</span><span>Acl G</span><span>Cor G</span></div>' + mrow('a', c1, A.label + ' (A)') + (A === B ? '' : mrow('b', c2, B.label + ' (B)')) + '<div class="tp-mgap" data-m="gap"></div>';
      // Landscape full screen: who is who, with the date and the time of day at the playhead, at the foot of the controls.
      var wbox = document.getElementById('tp-when');
      function wrow(id, colour, a) { return '<div class="tp-wrow"><span class="tp-mkey" style="background:' + colour + '"></span><b>' + esc(a.label.replace(/, \d\d\/\d\d(\/\d\d)?$/, '')) + '</b><span data-w="' + id + '"></span></div>'; }
      if (wbox) wbox.innerHTML = wrow('a', c1, A) + (A === B ? '' : wrow('b', c2, B));
      function setW(id, car, p) {
        var el = wbox && wbox.querySelector('[data-w="' + id + '"]'), w = car.when;
        if (!el || !w) return;
        el.textContent = dmyYear(w.date) + (w.base == null ? '' : ' ' + fmtClock(w.base + w.start + p[1]));
      }
      function setM(id, v) { var el = mbox && mbox.querySelector('[data-m="' + id + '"]'); if (el) el.textContent = v; }
      function showMetrics(pa, pb, g) {
        var ra = nearRow(ga, pa[0]), rb = nearRow(gb, pb[0]);
        setM('a-v', V.fmtV(pa[4])); setM('a-acc', fmtAcc(ra[1])); setM('a-cor', fmtCor(ra[2]));
        setW('a', A, pa); if (A !== B) setW('b', B, pb);
        // The speed beside each car's dot (a phone on its side in full screen shows these instead of the figures).
        if (mo && mo.setLabel) { mo.setLabel('a', V.fmtV(pa[4])); mo.setLabel('b', V.fmtV(pb[4])); }
        if (A !== B) { setM('b-v', V.fmtV(pb[4])); setM('b-acc', fmtAcc(rb[1])); setM('b-cor', fmtCor(rb[2])); setM('gap', 'A is ' + Math.abs(g).toFixed(2) + ' s ' + (g >= 0 ? 'ahead' : 'behind')); }
      }
      // Until a lap is played or scrubbed, the figures show where both laps start, not dashes.
      try { var s0a = at(A.trace, 0), s0b = at(B.trace, 0); showMetrics(s0a, s0b, 0); setM('gap', ''); } catch (e) { /* the dashes stay */ }
      function charts() { return [sp, dl].concat(gls).filter(Boolean); }
      // The quicker lap is at x and the other is wherever it was at that
      // elapsed time, so it trails by the time gap.
      function move(x) {
        if (!mo) return 0;
        var pa = at(A.trace, x), pb = at(B.trace, x), gap = pb[1] - pa[1], when = A !== B ? Math.min(pa[1], pb[1]) : pa[1];
        if (A !== B) {
          var t = Math.min(pa[1], pb[1]);
          if (pa[1] > t) pa = at(A.trace, distAtTime(A.trace, t));
          else if (pb[1] > t) pb = at(B.trace, distAtTime(B.trace, t));
        }
        if (mo.setGap) mo.setGap(A !== B ? gap : null);
        mo.placeA(pa); mo.placeB(pb);
        showMetrics(pa, pb, gap);
        return when;
      }
      // Back to where playback or the slider left it, else hidden.
      function leave() {
        if (pb.active && pb.render) { pb.render(pb.t); return; }
        if (mo) { mo.placeA(null); mo.placeB(null); }
        charts().forEach(function (o) { o.hide(); });
      }
      // Played or scrubbed to t seconds into the lap: the leader's place sets
      // the chart cursors, and each lap's dot goes where it was at that time.
      function renderAt(t) {
        var x = Math.min(dmax, Math.max(distAtTime(A.trace, t), distAtTime(B.trace, t)));
        move(x);
        [sp, dl].forEach(function (o) { if (o) o.show(x); });
        gls.forEach(function (g) { g.show(Math.min(t, tEndG)); });
        var sc = document.getElementById('tp-scrub'), ck = document.getElementById('tp-clock');
        if (sc) { sc.value = t; scrubFill(sc); }
        if (ck) ck.textContent = clock(t) + ' / ' + clock(pb.tEnd);
      }
      function tipF(x) {
        var pa = at(A.trace, x), pb = at(B.trace, x), g = pb[1] - pa[1];
        return '<b>' + V.fmtD(x, 2) + '</b>' + V.row(A.label, V.fmtV(pa[4]), c1) + V.row(B.label, V.fmtV(pb[4]), c2) + V.row('A is', Math.abs(g).toFixed(2) + ' s ' + (g >= 0 ? 'ahead' : 'behind'));
      }
      function tipG(x) {
        var ra = nearRow(gaT, x), rb = nearRow(gbT, x), h = '<b>' + clock(x) + '</b>';
        if (gShow.acc) h += V.row('Accel, A', fmtAcc(ra[1]), c1) + (A === B ? '' : V.row('Accel, B', fmtAcc(rb[1]), c2));
        if (gShow.brk) h += V.row('Braking, A', fmtBrk(ra[1]), c1) + (A === B ? '' : V.row('Braking, B', fmtBrk(rb[1]), c2));
        if (gShow.cor) h += V.row('Corner, A', fmtCor(ra[2]), c1) + (A === B ? '' : V.row('Corner, B', fmtCor(rb[2]), c2));
        return h;
      }
      // The charts: one for each measure switched on, stacked on a shared time axis, lap A in blue and lap B in
      // orange. Moving over any of them moves the cursor on all, and playback with it.
      // The G-force and speed chart runs on time, like playback and the map: at
      // any point it shows both laps at the same moment, and its time axis is
      // the ruler for the slider underneath.
      function onTime(trace, rows) { return trace.map(function (p, i) { return [p[1], rows[i][1], rows[i][2]]; }); }
      var gaT = onTime(A.trace, ga), gbT = A === B ? gaT : onTime(B.trace, gb);
      var spA = A.trace.map(function (p) { return [p[1], p[4]]; }), spB = A === B ? spA : B.trace.map(function (p) { return [p[1], p[4]]; });  // km/h: V.fmtV does the unit
      var tEndG = Math.max(A.trace[A.trace.length - 1][1], B.trace[B.trace.length - 1][1]);
      function timeTicks(fitPx) {
        var fit = Math.max(2, Math.floor(fitPx / 46));
        var step = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600].filter(function (st) { return tEndG / st <= fit; })[0] || 600;
        var out = [];
        for (var v = 0; v <= tEndG + 1e-6; v += step) out.push(v);
        return out;
      }
      function mss(v) { return Math.floor(v / 60) + ':' + ('0' + Math.round(v % 60)).slice(-2); }
      var gls = [];
      // The speed of each lap, written above the cursor on the top chart (blue for lap A, orange for lap B), in the
      // chart's top margin so it never covers a line. It shows and hides with the cursor.
      function speedAtCursor(svg, gl, topM) {
        var ns = 'http://www.w3.org/2000/svg', tx = document.createElementNS(ns, 'text'), show = gl.show, hide = gl.hide;
        tx.setAttribute('class', 'tp-gspeed'); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('visibility', 'hidden'); tx.setAttribute('pointer-events', 'none');
        tx.setAttribute('style', 'font-size:11px;font-weight:600;paint-order:stroke;stroke:#ffffff;stroke-width:3px;stroke-linejoin:round');
        tx.setAttribute('y', topM - 6);
        svg.appendChild(tx);
        gl.show = function (x, e) {
          show(x, e);
          var a = V.fmtV(at(spA, x)[1]), b = A === B ? '' : V.fmtV(at(spB, x)[1]);
          tx.innerHTML = '<tspan fill="' + c1 + '">' + esc(a) + '</tspan>' + (b ? '<tspan fill="#3d4658">  </tspan><tspan fill="' + c2 + '">' + esc(b) + '</tspan>' : '');
          var half = (a.length + (b ? b.length + 2 : 0)) * 3.4;
          tx.setAttribute('x', Math.max(gl.plot.l + half, Math.min(gl.plot.W - gl.plot.r - half, gl.X(x))));
          tx.setAttribute('visibility', 'visible');
        };
        gl.hide = function () { hide(); tx.setAttribute('visibility', 'hidden'); };
      }
      function drawG() {
        var box = document.getElementById('tp-gforce'), note = document.getElementById('tp-gnote');
        if (!box) return;
        var defs = G_DEFS.filter(function (d) { return gShow[d[0]]; });
        if (note) note.textContent = !defs.length ? 'Turn a line on to see it.' : A === B ? A.label : 'Blue: ' + A.label + ' (A). Orange: ' + B.label + ' (B).';
        box.innerHTML = '';
        gls = [];
        var peakLines = [], pkEl = document.getElementById('tp-gpeaks');
        if (pkEl) pkEl.innerHTML = '';
        if (!defs.length) { alignScrub(); return; }
        // One chart has the full height (in full screen a share of a tall screen); stacked ones are shorter each. In
        // full screen the stack as a whole is held to a quarter more than one chart, so the map keeps its room.
        var base = cmpFull ? Math.max(110, Math.min(200, Math.round(window.innerHeight * 0.22))) : 150;
        var H = defs.length === 1 ? base : cmpFull ? Math.max(70, Math.round(base * 1.25 / defs.length)) : Math.max(96, Math.round(base * 0.7));
        // A phone on its side in full screen: the charts share a panel beside the map, the height of the screen less
        // the switch, the chips and the slider.
        if (cmpFull && window.innerWidth > window.innerHeight && window.innerHeight <= 560) {
          // The room left in the panel once the chips, switches, figures, slider and clock have theirs (they wrap on a
          // narrow screen, so they are measured rather than guessed).
          var pbox = document.getElementById('tp-gbox'), used = 0;
          if (pbox) [].forEach.call(pbox.children, function (c) { if (c.id !== 'tp-gforce' && c.offsetHeight) used += c.offsetHeight + 4; });
          var pcs = pbox ? window.getComputedStyle(pbox) : null, pad = pcs ? (parseFloat(pcs.paddingTop) || 0) + (parseFloat(pcs.paddingBottom) || 0) : 0;
          var room = pbox ? pbox.clientHeight - pad - used - 10 : window.innerHeight - 150;
          H = Math.max(48, Math.floor((room - (defs.length - 1) * 2) / defs.length));
        }
        var xt = timeTicks(box.clientWidth || 600);
        // Only the last chart has the time labels under it, so it has 20 more than the others and they plot as tall as it.
        var Hn = Math.floor((H * defs.length - 20 - 14) / defs.length);
        defs.forEach(function (d, di) {
          var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'tv-chart tp-gchart');
          svg.setAttribute('data-g', d[0]);
          svg.setAttribute('role', 'img');
          svg.setAttribute('aria-label', d[1] + ' over the lap for both laps');
          box.appendChild(svg);
          var series = [], gy, tip, underG, topG, gX, gY;
          {
            // Braking G is the lengthways g below zero drawn upwards, from 0 to the hardest stop.
            var brk = d[0] === 'brk', col = d[0] === 'cor' ? 2 : 1, lo = 0, hi = 0.5, fmt = brk ? fmtBrk : col === 1 ? fmtAcc : fmtCor, word = brk ? 'Braking' : col === 1 ? 'Accel' : 'Corner';
            var val = function (r) { return brk ? Math.max(0, -r[1]) : r[col]; };
            [gaT, gbT].forEach(function (lp, li) {
              if (li && A === B) return;
              lp.forEach(function (r) { lo = Math.min(lo, val(r)); hi = Math.max(hi, val(r)); });
              series.push({ color: li ? c2 : c1, width: 1.5, pts: lp.map(function (r) { return [r[0], val(r)]; }), at: function (x) { return val(nearRow(lp, x)); } });
            });
            // The biggest figure of each lap, from its own readings (the same figure as the note below and the headline
            // tiles): a dashed line across the chart and a dot where it happened.
            var peaks = [];
            [[A, c1, 'A'], [B, c2, 'B']].forEach(function (lp, li) {
              if (li && A === B) return;
              // Each side on its own: acceleration and braking, or cornering one way and the other.
              var up = 0, down = 0, tUp = 0, tDown = 0;
              lp[0].trace.forEach(function (r) {
                var v = (col === 1 ? r[6] : r[5]) || 0;
                if (v > up) { up = v; tUp = r[1]; }
                if (-v > down) { down = -v; tDown = r[1]; }
              });
              if (brk) {
                if (down > 0) peaks.push([down, lp[1], lp[2], 'Max braking', tDown]);
              } else if (col === 1) {
                if (up > 0) peaks.push([up, lp[1], lp[2], 'Max acceleration', tUp]);
                if (down > 0) peaks.push([-down, lp[1], lp[2], 'Max braking', tDown]);
              } else {
                // Cornering has one maximum, whichever way it was: the same figure as the note and the headline tiles.
                if (up >= down) { if (up) peaks.push([up, lp[1], lp[2], 'Max', tUp]); } else peaks.push([-down, lp[1], lp[2], 'Max', tDown]);
              }
            });
            peaks.forEach(function (pk) { lo = Math.min(lo, pk[0]); hi = Math.max(hi, pk[0]); });
            // The words for each side of the chart, giving the figure for each lap (lap A and lap B when two are shown).
            var sides = {};
            peaks.forEach(function (pk) {
              var k = pk[0] < 0 ? 'lo' : 'hi', sd = sides[k] = sides[k] || { word: pk[3], parts: [], at: pk };
              sd.parts.push((A === B ? '' : pk[2] + ' ') + Math.abs(pk[0]).toFixed(2) + ' g');
            });
            underG = function (sv, X, Y) {
              gX = X; gY = Y;
              var ns = 'http://www.w3.org/2000/svg';
              peaks.forEach(function (pk) {
                var ln = document.createElementNS(ns, 'line');
                ln.setAttribute('class', 'tp-gmaxline'); ln.setAttribute('x1', X(0)); ln.setAttribute('x2', X(tEndG)); ln.setAttribute('y1', Y(pk[0])); ln.setAttribute('y2', Y(pk[0]));
                ln.setAttribute('stroke', pk[1]); ln.setAttribute('stroke-width', 1); ln.setAttribute('stroke-dasharray', '4 4'); ln.setAttribute('opacity', '0.55'); ln.setAttribute('pointer-events', 'none');
                sv.appendChild(ln);
              });
            };
            // Drawn after the chart, so the dots sit over the lines. The figures are not drawn on the chart, where they
            // landed on the traces: they are listed under the charts (#tp-gpeaks), in the same words.
            topG = function (sv) {
              var ns = 'http://www.w3.org/2000/svg';
              peaks.forEach(function (pk) {
                var dot = document.createElementNS(ns, 'circle');
                dot.setAttribute('class', 'tp-gpeak'); dot.setAttribute('cx', gX(pk[4])); dot.setAttribute('cy', gY(pk[0])); dot.setAttribute('r', 3.5);
                dot.setAttribute('fill', pk[1]); dot.setAttribute('stroke', '#ffffff'); dot.setAttribute('stroke-width', 1.5); dot.setAttribute('pointer-events', 'none');
                sv.appendChild(dot);
              });
            };
            peakLines.push({ title: d[1], items: Object.keys(sides).sort().map(function (k) { return sides[k].word + ' ' + sides[k].parts.join(', '); }) });
            // The g scale is even about zero (Braking G runs from zero up), so a corner one way is drawn as big as the same corner the other way.
            var gm = Math.ceil(Math.max(-lo, hi) * 2) / 2;
            gy = brk ? V.nice(0, Math.max(0.5, Math.ceil(hi * 4) / 4), defs.length === 1 ? 4 : 2) : V.nice(-gm, gm, defs.length === 1 ? 4 : 2);
            tip = function (x) { return '<b>' + clock(x) + '</b>' + V.row(word + ', A', fmt(nearRow(gaT, x)[col]), c1) + (A === B ? '' : V.row(word + ', B', fmt(nearRow(gbT, x)[col]), c2)); };
          }
          // The speed is not a chart: it is written above the cursor on the top chart (below), so the charts have the room.
          var first = di === 0, topM = first ? (defs.length > 1 ? 32 : 24) : defs.length > 1 ? 18 : undefined;
          var gl = V.line(svg, {
            // The time labels sit under the last chart only; the ones above share its axis.
            H: defs.length > 1 ? Hn + (first ? 14 : 0) + (di === defs.length - 1 ? 20 : 0) : H, top: topM, bottom: di === defs.length - 1 ? undefined : 8, x0: 0, x1: tEndG, y0: gy[0], y1: gy[gy.length - 1], xt: di === defs.length - 1 ? xt : [], xf: mss, yt: gy, zero: 0, yf: function (v) { return v + ' g'; },
            // Moving over a chart moves playback to that moment, slider, cursors and all.
            series: series, under: underG, tip: tip, onMove: function (t) { stopPlay(); pb.active = true; pb.t = t; renderAt(t); }, onLeave: leave
          });
          gls.push(gl);
          if (first) speedAtCursor(svg, gl, topM);
          if (topG) topG(svg);
          // With more than one chart showing, each is named in its top left corner, so it is clear which is which.
          if (defs.length > 1) {
            var ttl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            ttl.setAttribute('class', 'tp-gtitle'); ttl.setAttribute('x', 48); ttl.setAttribute('y', 13);
            ttl.textContent = d[1];
            svg.appendChild(ttl);
          }
        });
        // The biggest figures, one line for each chart that has them.
        if (pkEl) pkEl.innerHTML = peakLines.map(function (l) { return '<div><b>' + esc(l.title) + ':</b> ' + l.items.map(function (t) { return '<span class="tp-gmax">' + esc(t) + '</span>'; }).join('. ') + '.</div>'; }).join('');
        alignScrub();
        if (pb.active && pb.render) pb.render(pb.t);
      }
      cmpDrawG = drawG;
      cmpAlign = function () { alignScrub(); };
      // The slider's ends line up with the chart's time axis, so the chart is its ruler.
      function alignScrub() {
        var tr = document.getElementById('tp-scrub-track'), gs = document.getElementById('tp-gforce'), box = document.getElementById('tp-gbox'), gl = gls[0];
        if (!tr) return;
        var on = gl && gl.plot && gs && box && !box.classList.contains('is-off') && gs.clientWidth;
        var k = on ? gs.clientWidth / gl.plot.W : 1;
        tr.style.marginLeft = on ? (gl.plot.l * k).toFixed(1) + 'px' : '';
        tr.style.marginRight = on ? (gl.plot.r * k).toFixed(1) + 'px' : '';
        if (box) box.classList.toggle('has-axis', !!on);
        drawRuler(pb.tEnd || tEndG);
      }
      var sp, dl;
      sp = V.line(document.getElementById('tp-speed'), {
        H: 240, x0: 0, x1: dmax, y0: 0, y1: yt[yt.length - 1], xt: xt, xf: xf, yt: yt,
        series: [{ color: c2, pts: B.trace.map(function (p) { return [p[0], V.spd(p[4])]; }), at: function (x) { return V.spd(at(B.trace, x)[4]); } }, { color: c1, pts: A.trace.map(function (p) { return [p[0], V.spd(p[4])]; }), at: function (x) { return V.spd(at(A.trace, x)[4]); } }],
        under: function (svg, X) { (s.corners || []).forEach(function (c) { var t = document.createElementNS('http://www.w3.org/2000/svg', 'text'); t.setAttribute('x', X(c.d)); t.setAttribute('y', 22); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-weight', '700'); t.textContent = c.n; svg.appendChild(t); }); },
        tip: tipF, onMove: function (x) { userHover(); var w = move(x); dl.show(x); if (gl) gl.show(w); }, onLeave: leave
      });
      var dp = [];
      for (var x = 0; x <= dmax; x += 10) dp.push([x, at(B.trace, x)[1] - at(A.trace, x)[1]]);
      var gmin = Math.min.apply(null, dp.map(function (p) { return p[1]; })), gmax = Math.max.apply(null, dp.map(function (p) { return p[1]; }));
      var gyt = V.nice(Math.min(0, gmin), Math.max(0.5, gmax), 4);
      dl = V.line(document.getElementById('tp-delta'), {
        H: 150, x0: 0, x1: dmax, y0: gyt[0], y1: gyt[gyt.length - 1], xt: xt, xf: xf, yt: gyt, zero: 0, yf: function (v) { return (v > 0 ? '+' : '') + v + ' s'; },
        series: [{ color: c1, area: true, pts: dp, at: function (x) { return at(B.trace, x)[1] - at(A.trace, x)[1]; } }], tip: tipF, onMove: function (x) { userHover(); var w = move(x); sp.show(x); if (gl) gl.show(w); }, onLeave: leave
      });
      // Hovering a chart takes over from playback.
      function userHover() { stopPlay(); pb.active = false; }
      stopPlay();
      pb.active = false; pb.t = 0;
      pb.tEnd = Math.max(A.trace[A.trace.length - 1][1], B.trace[B.trace.length - 1][1]);
      pb.render = renderAt;
      drawG();
      var scrub = document.getElementById('tp-scrub'), clk = document.getElementById('tp-clock');
      if (scrub) { scrub.max = pb.tEnd; scrub.value = 0; scrubFill(scrub); }
      drawRuler(pb.tEnd);
      if (clk) clk.textContent = clock(0) + ' / ' + clock(pb.tEnd);
      if (resume) {
        pb.t = Math.min(resume.t, pb.tEnd); pb.active = resume.active;
        if (resume.active) renderAt(pb.t);
        if (resume.playing) startPlay(resume.dir);
      }
      var total = B.time - A.time;
      document.getElementById('tp-gap-cap').textContent = 'Above the line, A is ahead. A finishes ' + Math.abs(total).toFixed(2) + ' s ' + (total >= 0 ? 'ahead' : 'behind') + '.';
      var gains = s.corners && s.corners.length ? T.cornerGains(A.trace, B.trace, s.corners) : [];
      document.getElementById('tp-corners').innerHTML = gains.length ? '<thead><tr><th>Corner</th><th>Slowest, A</th><th>Slowest, B</th><th>A gains</th></tr></thead><tbody>' + gains.map(function (g) { return '<tr><td>' + g.n + (g.name ? ' ' + esc(g.name) : '') + '</td><td>' + Math.round(V.spd(g.va)) + '</td><td>' + Math.round(V.spd(g.vb)) + '</td><td>' + (g.gain >= 0 ? '+' : '') + g.gain.toFixed(2) + ' s</td></tr>'; }).join('') + '</tbody>' : '<tbody><tr><td>No corners found on this lap.</td></tr></tbody>';
      V.gg(document.getElementById('tp-gg'), A.trace, c1);
      var notes = [];
      var big = gains.slice().sort(function (x, y) { return Math.abs(y.gain) - Math.abs(x.gain); })[0];
      if (big && Math.abs(total) > 0.05) notes.push({ icon: 'corner', text: 'The biggest difference was at corner ' + big.n + (big.name ? ' (' + big.name + ')' : '') + ': A ' + (big.gain >= 0 ? 'gained ' : 'lost ') + Math.abs(big.gain).toFixed(2) + ' s there, out of ' + Math.abs(total).toFixed(2) + ' s in all.', small: 'Measured from 200 m before the slowest point to 150 m after.' });
      var brake = A.trace.reduce(function (m, p) { return Math.max(m, -p[6]); }, -Infinity), lat = A.trace.reduce(function (m, p) { return Math.max(m, Math.abs(p[5])); }, -Infinity);
      var comb = A.trace.filter(function (p) { return Math.hypot(p[5], p[6]) > 0.6 && Math.abs(p[5]) > 0.3 && Math.abs(p[6]) > 0.3; }).length / A.trace.length;
      notes.push({ icon: 'brake', text: A.label + ' peaked at ' + brake.toFixed(2) + ' g braking and ' + lat.toFixed(2) + ' g cornering. ' + Math.round(comb * 100) + '% of the lap mixes braking or power with cornering (the dots between the axes).', small: 'Blending braking into the turn-in fills out the circle, and is often where time is found.' });
      notes.push({ icon: 'info', text: 'These are observations from the data, not coaching. Weather, tyres, traffic and flags all change lap times.' });
      document.getElementById('tp-cmp-notes').innerHTML = notesHtml(notes);
      if (view.s.type === 'sprint') { runWords(document.getElementById('compare')); }
    });
  }
  // Mods with a fitted date, from the car's list in My Garage (owner only).
  function carMods(carId) {
    var car = view.mine && view.mine.cars.filter(function (c) { return c.id === carId; })[0];
    var out = [];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    ((car && car.view) || []).forEach(function (a) {
      (a.parts || []).forEach(function (p) {
        if (!T.isTrackPart(a.id, p)) return;
        var m = String(p.meta || '').match(/Fitted (?:([A-Z][a-z]{2}) )?(\d{4})/);
        if (!m || p.empty) return;
        var month = m[1] ? MONTHS.indexOf(m[1]) + 1 : 6;
        out.push({ label: (p.kind ? p.kind + ': ' : a.label + ': ') + p.what, month: month, monthKnown: !!m[1], year: parseInt(m[2], 10), date: m[2] + '-' + (month < 10 ? '0' : '') + month });
      });
    });
    return out;
  }
  // What each track part did: the best dry time here before and after it was
  // fitted, from the member's own sessions. Other things change between days,
  // so the card says what it could not account for.
  function impactHtml(list, s) {
    var mods = carMods(s.carId).map(function (m) { return { label: m.label, year: m.year, month: m.monthKnown ? m.month : null }; });
    var head = '<div class="card tp-impact" id="tp-impact" data-tile="overtime-mods"><div class="tp-chart-head">' + '<h3>What each mod did</h3></div>';
    if (!mods.length) return head + '<p class="tp-small">Add when you fitted your wheels, tyres, suspension, brakes, aero and performance parts on your build (the Fitted date) and this compares your best dry time here before and after each one.</p></div>';
    var r = T.modImpact(list.map(function (o) { return { id: o.id, date: o.date, bestTime: o.bestTime, conditions: o.conditions, temp: o.temp, tyres: o.tyres }; }), mods);
    var h = head;
    if (!r.rows.length) h += '<p class="tp-small">Not enough yet. A part needs a dry session here before it was fitted and another after.</p>';
    else h += '<div class="tp-scroll"><table class="tp-table tp-impact-table"><thead><tr><th>Part</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>' + r.rows.map(function (x) {
      var better = x.change < 0, same = Math.abs(x.change) < 0.005;
      return '<tr><td>' + x.labels.map(esc).join('<br>') + (x.labels.length > 1 ? '<small>Fitted together, so the change is for all of them</small>' : '') + (x.flags.length ? '<small>' + x.flags.map(esc).join(', ') + '</small>' : '') + '</td>' +
        '<td>' + V.fmtLap(x.before) + '<small>' + esc(niceDate(x.beforeDate)) + '</small></td><td>' + V.fmtLap(x.after) + '<small>' + esc(niceDate(x.afterDate)) + '</small></td>' +
        '<td class="' + (same ? '' : better ? 'is-fast' : 'is-slow') + '">' + (same ? 'No change' : (better ? '' : '+') + x.change.toFixed(2) + ' s') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    if (r.skipped.length) h += '<p class="tp-small">Not compared (' + r.skipped.map(function (x) { return esc(x.labels.join(', ') + ': ' + x.why); }).join('; ') + ').</p>';
    return h + '<p class="tp-small">Your best dry time before and after each part, at this track. Weather, tyres and driving change between days, so treat it as a guide.</p></div>';
  }
  // The Sessions list under the best lap chart shows only the latest few until opened, so it is no taller than What the trend says.
  var timeAll = false, SHORT_ROWS = 4;
  function drawOverTime(s) {
    var box = document.getElementById('tp-time'), tile = box && box.closest('[data-tile]'), b = board();
    if (!box || !view.mine) return;
    // Tiles drawn last time (the page redraws on a change of settings).
    if (b) tilesOf(b).forEach(function (t) { if (/^overtime-/.test(keyOf(t))) t.remove(); });
    var list = view.mine.sessions.filter(function (o) { return o.carId === s.carId && o.type === s.type && o.venueId === s.venueId && o.layoutId === s.layoutId && o.bestTime; });
    if (list.length < 2) { box.innerHTML = '<div class="card tp-empty">' + icon('up') + '<p>Add another session here to see your times over time, with the mods you fitted in between marked from My Garage.</p></div>'; return; }
    var dates = list.map(function (o) { return o.date.slice(0, 7); }).sort();
    var mods = carMods(s.carId).filter(function (m) { return m.date >= dates[0].slice(0, 7) && m.date <= dates[dates.length - 1]; });
    box.innerHTML = '<div class="card"><div class="tp-chart-head"><h3>Best lap per session</h3><div class="tp-key"><span><i style="background:' + RUN_COLORS[0] + '"></i>Dry</span><span><i class="is-ring"></i>Wet or damp (left out of the trend)</span><span class="is-mod"><i class="is-dash"></i>Mod fitted</span></div></div><svg class="tv-chart" id="tp-timeline" role="img" aria-label="Best lap at this track for each session, faster is higher"></svg>' + '<p class="tp-small">Higher up is faster. Tap a point to open that session.</p></div>';
    var after = '<div class="card" data-tile="overtime-notes"><div class="tp-chart-head">' + '<h3>What the trend says</h3></div><div class="tp-notes">' + notesHtml(T.trendNotes(list.map(function (o) { return { date: o.date, bestTime: o.bestTime, conditions: o.conditions || 'Dry', tyres: o.tyres, temp: o.temp }; }), mods)) + '</div></div>' +
      '<div class="card' + (timeAll ? '' : ' is-short') + '" data-tile="overtime-table" id="tp-sessions-tile"><div class="tp-chart-head">' + '<h3>Sessions</h3></div><div class="tp-scroll"><table class="tp-table"><thead><tr><th>Date</th><th>Best</th><th>Change</th><th>Conditions</th></tr></thead><tbody>' +
      list.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (o, i, arr) {
        var prev = arr.slice(0, i).filter(function (p) { return (p.conditions || 'Dry') === 'Dry'; }).pop();
        var ch = (o.conditions || 'Dry') === 'Dry' && prev ? o.bestTime - prev.bestTime : null;
        return '<tr' + (o.id === s.id ? ' class="is-best"' : '') + '><td><a href="track.html?s=' + esc(o.id) + '" data-go="s=' + esc(o.id) + '">' + esc(niceDate(o.date)) + '</a></td><td>' + V.fmtLap(o.bestTime) + '</td><td>' + (ch === null ? '' : (ch > 0 ? '+' : '') + ch.toFixed(2)) + '</td><td>' + esc(o.conditions || '') + (o.temp != null ? ', ' + o.temp + '°C' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (list.length > SHORT_ROWS ? '<button type="button" class="btn btn-secondary btn-sm tp-sess-more" id="tp-sess-more" aria-expanded="' + timeAll + '">' + (timeAll ? 'Show fewer sessions' : 'Show all ' + list.length + ' sessions') + '</button>' : '') + '</div>' + impactHtml(list, s);
    // The extra tiles go on the board after the chart's tile (or into the section when there is no board).
    if (tile && b) tile.insertAdjacentHTML('afterend', after); else box.insertAdjacentHTML('beforeend', after);
    timelineData = { list: list, mods: mods, s: s };
    drawTimeline();
    var more = document.getElementById('tp-sess-more');
    if (more) more.addEventListener('click', function () { timeAll = !timeAll; drawOverTime(s); });
    applyLayout();
  }
  // The best lap chart, drawn again at its chosen height (the grip bar under it).
  var timelineData = null;
  function drawTimeline() {
    var svg = document.getElementById('tp-timeline'), d = timelineData;
    if (!svg || !d) return;
    V.timeline(svg, d.list.map(function (o) {
      return { date: o.date, time: o.bestTime, wet: (o.conditions || 'Dry') !== 'Dry', mine: o.id === d.s.id, label: niceDate(o.date), conditions: o.conditions, temp: o.temp, onClick: function () { go('s=' + o.id); } };
    }), d.mods, { H: 300 });
  }

  function dragHtml(s) {
    var runs = s.runs || [];
    var bq = runs.filter(function (r) { return r.quarter; }).sort(function (a, b) { return a.quarter - b.quarter; })[0];
    var b60 = runs.filter(function (r) { return r.s60; }).sort(function (a, b) { return a.s60 - b.s60; })[0];
    var b30 = runs.filter(function (r) { return r.s30; }).sort(function (a, b) { return a.s30 - b.s30; })[0];
    var b8 = runs.filter(function (r) { return r.eighth; }).sort(function (a, b) { return a.eighth - b.eighth; })[0];
    var bmid = runs.filter(function (r) { return r.s60to100; }).sort(function (a, b) { return a.s60to100 - b.s60to100; })[0];
    var h = '';
    if (s.street) h += '<div class="tp-notice is-admin">' + icon('shield') + '<div><b>Street run</b><br>Saved by an admin for testing. Private, never on a leaderboard.</div></div>';
    else if (s.atVenue) h += '<div class="tp-notice is-ok">' + icon('check') + '<div><b>' + esc(s.venue) + '</b><br>Runs from the strip.</div></div>';
    h += tiles([
      ['1/4 mile', bq ? bq.quarter.toFixed(2) + ' s' : '-', bq ? 'at ' + V.fmtV(bq.quarterSpeed) : 'Not reached', 1],
      ['0 to 30 mph', b30 ? b30.s30.toFixed(2) + ' s' : '-', s.rollout ? '1 ft rollout' : 'From first movement'],
      ['0 to 60 mph', b60 ? b60.s60.toFixed(2) + ' s' : '-', b60 && b60.ft60 ? '60 ft in ' + b60.ft60.toFixed(2) + ' s' : ''],
      ['60 to 100 mph', bmid ? bmid.s60to100.toFixed(2) + ' s' : '-', ''],
      ['1/8 mile', b8 ? b8.eighth.toFixed(2) + ' s' : '-', b8 ? 'at ' + V.fmtV(b8.eighthSpeed) : ''],
      ['Runs', String(runs.length), '']
    ]);
    h += carDataHtml(s);
    // Street runs (admin testing) also show where the drive went.
    if (s.street && (s.outline || (s.trace && s.trace.outline) || []).length > 1) h += '<div class="card"><div class="tp-chart-head"><h3>Your drive, coloured by speed</h3></div><svg class="tv-chart" id="tp-map" role="img" aria-label="The drive drawn from GPS, coloured by speed"></svg><div class="tp-chart-foot"><span class="tp-ramp"><span id="tp-ramp-lo"></span><i></i><span id="tp-ramp-hi"></span></span><span>Street runs are private and never on a leaderboard.</span></div></div>';
    h += '<div class="tp-grid tp-g-map"><div class="card"><div class="tp-chart-head"><h3>Speed off the line</h3><div class="tp-key">' + runs.slice(0, 12).map(function (r, i) { return '<span><i style="background:' + RUN_COLORS[i] + '"></i>Run ' + (i + 1) + '</span>'; }).join('') + '</div></div><svg class="tv-chart" id="tp-drag" role="img" aria-label="Speed against time for each run"></svg></div>' +
      '<div class="card"><h3>Runs</h3><div class="tp-scroll"><table class="tp-table"><thead><tr><th>Run</th><th>60 ft</th><th>0-30</th><th>0-60</th><th>60-100</th><th>1/8</th><th>1/4</th><th>Trap</th></tr></thead><tbody>' +
      runs.map(function (r, i) { function f(v) { return v ? v.toFixed(2) : '-'; } return '<tr' + (r === bq ? ' class="is-best"' : '') + '><td>' + (i + 1) + '</td><td>' + f(r.ft60) + '</td><td>' + f(r.s30) + '</td><td>' + f(r.s60) + '</td><td>' + f(r.s60to100) + '</td><td>' + f(r.eighth) + '</td><td>' + f(r.quarter) + '</td><td>' + (r.quarterSpeed ? Math.round(V.spd(r.quarterSpeed)) : '-') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="tp-small">' + (s.rollout ? 'Timed with a 1 ft rollout: the clock starts just after the ' + VW + ' begins to move, as RaceBox\'s rollout option does. Worked out from GPS speed.' : 'Times from the first movement, worked out from GPS speed. Strip timing lights and RaceBox\'s rollout option start the clock after about a foot of movement, so their times are usually a little quicker.') + '</p></div></div>';
    h += '<div class="tp-section"><h3>What we spotted</h3><div class="tp-notes">' + notesHtml(T.sessionNotes(s, V.fmtV, V.fmtD)) + '</div></div>';
    return h;
  }
  function drawDragCharts(s) {
    var svg = document.getElementById('tp-drag');
    if (svg && (s.runs || []).length) V.drag(svg, s.runs.slice(0, 12), RUN_COLORS);
    if (s.street && (s.outline || (s.trace && s.trace.outline) || []).length > 1 && document.getElementById('tp-map')) drawOtherCharts(s);
  }

  // A standing start: which signal started the clock on the best run (the accelerometer, or the speed).
  function launchLine(s) {
    var l = s.launch;
    if (s.type !== 'sprint' || !l || !l.from) return '';
    return '<p class="tp-small tp-launch" id="tp-launch">' + icon('info') + (l.from === 'g' ? 'Clock started from the accelerometer, ' + Number(l.lead).toFixed(2) + ' s before the speed rose.' : 'Clock started from the speed (the accelerometer did not move first).') + '</p>';
  }
  function ownerHtml(s) {
    var limit = s.street ? 'street' : (s.type === 'drag' ? (s.atVenue ? '' : 'noboard') : (s.venueId && s.layoutId ? '' : 'noboard'));
    var typeBox = s.street ? '' : s.hasSource
      ? '<div class="tp-field"><span class="tp-lbl">Type</span><div class="tp-chips" data-retype>' + typeChips(s, isHillSession(s, library)) + '</div><p class="tp-small">Picked the wrong one? Choose another and we\'ll read your saved readings again as that type.</p></div>'
      : '<p class="tp-src">' + icon('info') + '<span>This session was saved before we kept the readings (or they could not be kept), so its type can\'t be changed.' + (s.readingsMessage ? ' Reason: ' + esc(String(s.readingsMessage)) : '') + ' Add the readings again, or add the file again as a new session.</span></p>' + (readingsSending[s.id] ? '' : readingsAgainHtml());
    // A track day at a listed circuit: the layout can be changed, timing the saved readings on the layout picked.
    var relayoutBox = '';
    if (s.hasSource && !s.street && s.type === 'track' && s.venueId) {
      var rv = ((library && library.venues) || []).filter(function (x) { return x.id === s.venueId && x.type === 'circuit'; })[0], rls = (rv && rv.layouts) || [];
      if (rls.length > 1 || (rls.length && !s.layoutId)) relayoutBox = '<div class="tp-field" id="tp-relayout"><span class="tp-lbl">Layout at ' + esc(s.venue || 'this track') + '</span><div class="tp-chips" data-relayout>' +
        rls.map(function (l) { return '<button type="button" class="chip' + (s.layoutId === l.id ? ' is-on' : '') + '" data-v="' + esc(l.id) + '" aria-pressed="' + (s.layoutId === l.id) + '">' + esc(l.name || l.id) + '</button>'; }).join('') +
        '</div><p class="tp-small">' + (s.layoutId ? 'Picked the wrong layout? Choose another and we\'ll time your saved readings on it.' : 'We could not tell which layout this was. Pick it and we\'ll time your saved readings on it.') + layoutByAdminNote(s) + '</p></div>';
    }
    // Saved as several files merged into one: offer one session per file.
    var splitBox = s.hasSource && !s.street && (s.type === 'track' || s.type === 'sprint') && typeof s.runs === 'number' && s.runs > 1
      ? '<div class="tp-field"><span class="tp-lbl">Several files</span><p class="tp-src">' + icon('info') + '<span>This is ' + s.runs + ' files merged into one session. Split it to get one session for each file, grouped by day.</span></p><button type="button" class="btn btn-secondary btn-sm" id="tp-e-split">Split into ' + s.runs + ' sessions</button></div>' : '';
    var addDayBox = !s.street && s.date && s.carId ? '<div class="tp-field">' + addToDayButton(s, false) + '</div>' : '';
    return '<div class="tp-section" id="settings" data-tile="settings"><div class="tp-head">' + '<h2>Session settings</h2></div><div class="card tp-fields">' + addDayBox + typeBox + relayoutBox + splitBox +
      '<div class="tp-field"><span class="tp-lbl">Who can see it</span><div class="tp-privacy" data-privacy>' + privacyOptions(s.privacy, limit) + '</div></div>' +
      '<div class="tp-field"><span class="tp-lbl">Conditions</span><div class="tp-chips" data-cond>' + ['Dry', 'Damp', 'Wet'].map(function (c) { return '<button type="button" class="chip' + (s.conditions === c ? ' is-on' : '') + '" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div></div>' +
      tyreFields('tp-e-tyre', tyreInit(s)) + padFields('tp-e-pad', padInit(s), '') + loggerFields('tp-e-logger', s.logger || '', false) +
      '<div class="tp-field"><label for="tp-e-temp">Air temperature (°C)</label><input class="field" id="tp-e-temp" inputmode="numeric" value="' + esc(s.temp == null ? '' : s.temp) + '"></div>' +
      '<div class="tp-weather-row"><button type="button" class="btn btn-secondary btn-sm" id="tp-e-weather">Fill in from weather</button><p class="tp-src" id="tp-e-src">' + (s.tempSource === 'weather' && s.weather ? icon('info') + '<span>' + weatherNote(s.weather, s.venue) + '</span>' : s.tempSource === 'file' ? icon('info') + '<span>From the air temperature recorded in your file.</span>' : '') + '</p></div>' +
      '<div class="tp-field"><label for="tp-e-notes">Private notes (only you see these)</label><input class="field" id="tp-e-notes" value="' + esc(s.notes || '') + '"></div>' +
      '<div class="tp-field"><label for="tp-e-public-note">Public note (one sentence, shown at the top of the session to everyone who opens it)</label><input class="field" id="tp-e-public-note" maxlength="' + PUBLIC_NOTE_MAX + '" placeholder="Red flag mid-session, new tyres, first time here..." value="' + esc(s.publicNote || '') + '"></div>' +
      '<div class="tp-actions"><button type="button" class="btn btn-primary" id="tp-e-save">Save changes</button><button type="button" class="btn btn-secondary" id="tp-e-close">Close</button><button type="button" class="btn btn-ghost" id="tp-e-discard">Discard</button><button type="button" class="btn btn-danger" id="tp-e-del">' + icon('trash') + 'Delete</button></div><p class="tp-status" id="tp-status" role="status"></p></div></div>';
  }
  // Copy a piece of text, with the button saying so for a moment. Falls back to a hidden box on older browsers.
  function copyText(text, btn) {
    var label = btn.querySelector('span'), old = label ? label.textContent : '';
    function done(ok) {
      if (label) label.textContent = ok ? 'Copied' : 'Press and hold to copy';
      setTimeout(function () { if (label) label.textContent = old; }, 1800);
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }
  // "MT3UK moved it at your request": shown to the owner and the admin once the admin has changed a session's layout.
  function layoutByAdminNote(s) {
    var b = s.layoutByAdmin;
    if (!b || !b.at) return '';
    return ' <span class="tp-layout-byadmin">MT3UK set the layout to ' + esc(s.layout || '') + ' on ' + esc(niceDate(String(b.at).slice(0, 10))) + (b.from ? ' (it was ' + esc(b.from) + ')' : '') + ', as asked' + (b.note ? ': ' + esc(b.note) : '') + '.</span>';
  }
  // Admin view of a member's track day: the layout can be changed for them, only when they have asked. The admin
  // says who asked and how, the saved readings are timed on the layout picked, the result is shown before anything
  // is saved, and the member is emailed. The session is then marked as the member's own pick, so no re-time moves it.
  function adminLayoutHtml(s) {
    if (s.type !== 'track' || !s.venueId || !s.hasSource || s.street) return '';
    var rv = ((library && library.venues) || []).filter(function (x) { return x.id === s.venueId && x.type === 'circuit'; })[0], rls = (rv && rv.layouts) || [];
    if (rls.length < 2) return '';
    return '<div class="tp-section" id="tp-admin-layout" data-tile="adminlayout"><div class="tp-head">' + '<h2>Layout (admin)</h2></div><div class="card tp-fields">' +
      '<p class="tp-small">' + icon('lock') + ' Only change this when the member has asked. It is their session: the chips below time their saved readings on the layout picked, show the result, and email them.' + layoutByAdminNote(s) + (s.layoutPicked && !(s.layoutByAdmin && s.layoutByAdmin.at) ? ' <b>The member picked the current layout themselves.</b>' : '') + '</p>' +
      '<div class="tp-field"><span class="tp-lbl">Layout at ' + esc(s.venue || 'this track') + '</span><div class="tp-chips" data-admin-relayout>' +
      rls.map(function (l) { return '<button type="button" class="chip' + (s.layoutId === l.id ? ' is-on' : '') + '" data-v="' + esc(l.id) + '" aria-pressed="' + (s.layoutId === l.id) + '">' + esc(l.name || l.id) + '</button>'; }).join('') + '</div></div>' +
      '<label class="tp-field"><span class="tp-lbl">Who asked, and where (required)</span><input class="field" id="tp-admin-layout-note" maxlength="200" placeholder="John Chambers, by email on 7 Oct: both sessions were on Old Hairpin"></label>' +
      '<div class="tp-actions"><button type="button" class="btn btn-primary" id="tp-admin-layout-go" disabled>Change the layout, as the member asked</button></div>' +
      '<p class="tp-small tp-err" id="tp-admin-layout-note-out" role="status"></p></div></div>';
  }
  function fetchAdminSource(id) {
    var headers = {};
    if (adminViewerToken()) headers['X-Admin-Viewer'] = adminViewerToken();
    return fetch(API + '/track/admin/retime/source?id=' + encodeURIComponent(id), { headers: headers, cache: 'no-store' }).then(function (r) {
      if (r.status === 404) throw new Error('No readings were kept for this session, so its layout cannot be changed here.');
      if (!r.ok) throw new Error('The readings could not be read (' + r.status + ').');
      return r.arrayBuffer();
    }).then(function (buf) {
      var b = new Uint8Array(buf);
      if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
        if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unzip the readings.');
        return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
      }
      return JSON.parse(new TextDecoder().decode(buf));
    });
  }
  function wireAdminLayout(s) {
    var box = document.getElementById('tp-admin-layout');
    if (!box) return;
    var chips = box.querySelector('[data-admin-relayout]'), note = document.getElementById('tp-admin-layout-note'), goBtn = document.getElementById('tp-admin-layout-go'), out = document.getElementById('tp-admin-layout-note-out');
    var pick = s.layoutId || '';
    function sync() { goBtn.disabled = !(pick && pick !== (s.layoutId || '') && note.value.trim().length >= 3); }
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      pick = b.getAttribute('data-v');
      chips.querySelectorAll('.chip').forEach(function (c) { var on = c === b; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on); });
      sync();
    });
    note.addEventListener('input', sync);
    goBtn.addEventListener('click', function () {
      var rv = library.venues.filter(function (x) { return x.id === s.venueId; })[0], target = ((rv && rv.layouts) || []).filter(function (l) { return l.id === pick; })[0];
      if (!target) return;
      out.textContent = 'Reading the saved readings...';
      goBtn.disabled = true;
      fetchAdminSource(s.id).then(function (src) {
        if (!src.p || !src.rd) throw new Error('No readings were kept for this session.');
        var opts = { type: 'track', layoutId: pick, ignoreFirstFinish: s.ignoreFinish !== false };
        if (s.organizer) opts.organizer = s.organizer;
        if (s.startLineFromMember && s.startLine) opts.startLine = s.startLine;
        var next = T.analyse(restoreSource(src), library, opts);
        if (!(next.laps && next.laps.length) || next.layoutId !== pick) throw new Error('The readings give no laps on ' + (target.name || pick) + (next.problem ? ': ' + next.problem : '.'));
        var words = 'Change this session to ' + (target.name || pick) + ' for ' + (s.ownerName || 'the member') + '?\n\nBest lap: ' + (s.bestTime ? V.fmtLap(s.bestTime) : '-') + ' now, ' + (next.bestTime ? V.fmtLap(next.bestTime) : '-') + ' after.\nLaps: ' + ((s.laps || []).length) + ' now, ' + next.laps.length + ' after.\n\nThey will be emailed, and the layout then counts as their own pick, so no re-time moves it.';
        if (!window.confirm(words)) { out.textContent = 'Nothing changed.'; sync(); return; }
        next.date = s.date; next.time = s.time || next.time; next.fileName = s.fileName;
        if (s.ignoreFinish === false) next.ignoreFinish = false;
        next.layoutPicked = true;
        return api('POST', '/track/admin/retime', { id: s.id, session: next, memberAsked: note.value.trim() }, true).then(function (d) {
          if (!d.success) throw new Error(d.message || 'Could not save it.');
          status('Layout changed to ' + (target.name || pick) + '. The member has been emailed.', 'ok');
          go('s=' + s.id, false, true);
        });
      }).catch(function (e) { out.textContent = (e && e.message) || 'Could not change it.'; sync(); });
    });
  }
  function wireOwner(s) {
    var edit = { privacy: s.privacy, conditions: s.conditions, tempSource: s.tempSource || '', weather: s.weather || null, temp: s.temp };
    wireTyres('tp-e-tyre');
    wirePads('tp-e-pad');
    var tempEl = document.getElementById('tp-e-temp');
    tempEl.addEventListener('input', function () { edit.tempSource = tempEl.value.trim() === '' ? '' : 'member'; edit.weather = null; document.getElementById('tp-e-src').innerHTML = ''; });
    document.getElementById('tp-e-weather').addEventListener('click', function () {
      var src = document.getElementById('tp-e-src');
      src.textContent = 'Looking up the weather...';
      lookupWeather(s.origin, s.date, s.time).then(function (w) {
        if (!w) { src.textContent = 'No weather found for that day and place.'; return; }
        tempEl.value = w.temp;
        edit.tempSource = 'weather'; edit.weather = w;
        edit.conditions = weatherConditions(w);
        document.querySelectorAll('#settings [data-cond] button[data-v]').forEach(function (x) { x.classList.toggle('is-on', x.getAttribute('data-v') === edit.conditions); });
        src.innerHTML = icon('info') + '<span>' + weatherNote(w, s.venue) + ' Conditions set to match. Save changes to keep it.</span>';
      });
    });
    function group(sel, key) {
      var g = document.querySelector('#settings ' + sel);
      g.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-v]');
        if (!b || b.disabled) return;
        edit[key] = b.getAttribute('data-v');
        g.querySelectorAll('button[data-v]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      });
    }
    group('[data-privacy]', 'privacy');
    group('[data-cond]', 'conditions');
    wireLogger('tp-e-logger');
    var rt = document.querySelector('#settings [data-retype]');
    if (rt) rt.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]'), v = b && b.getAttribute('data-v');
      if (!b) return;
      // Sprint and Hill climb are the same type: only the label changes, so there is nothing to read again.
      if ((v === 'sprint' || v === 'hill') && s.type === 'sprint') {
        var wantHill = v === 'hill';
        if (wantHill === isHillSession(s, library)) return;
        api('PUT', '/track/session', { id: s.id, hill: wantHill }).then(function (d) {
          if (!d.success) { status(d.message || 'Could not change it.', 'error'); return; }
          if (wantHill) s.hill = true; else delete s.hill;
          mine = null; counts = null;
          drawSession(); status('Saved.', 'ok');
        });
        return;
      }
      if (v !== s.type) startRetype(s, v === 'hill' ? 'sprint' : v, v === 'hill');
    });
    var rl = document.querySelector('#settings [data-relayout]');
    if (rl) rl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (b && b.getAttribute('data-v') !== s.layoutId) startRetype(s, 'track', false, b.getAttribute('data-v'));
    });
    // Any change to the settings below marks them unsaved, so Discard can ask before throwing them away.
    var dirty = false;
    var box = document.getElementById('settings');
    ['input', 'change', 'click'].forEach(function (ev) {
      box.addEventListener(ev, function (e) {
        if (e.target.closest('#tp-e-save, #tp-e-close, #tp-e-discard, #tp-e-del')) return;
        if (ev === 'click' && !e.target.closest('button[data-v], #tp-e-weather')) return;
        dirty = true;
      });
    });
    // Back to the view before (Your sessions when there is none), as the Back link does.
    function closeSession() { goBack(''); }
    function saveSettings() {
      var t = document.getElementById('tp-e-temp').value.trim();
      var ty = tyrePayload(readTyre('tp-e-tyre')), pd = padPayload(readPads('tp-e-pad'));
      api('PUT', '/track/session', Object.assign({ id: s.id, privacy: edit.privacy, conditions: edit.conditions || '' }, ty, pd, { temp: t === '' ? null : parseFloat(t), tempSource: t === '' ? '' : (edit.tempSource || 'member'), weather: edit.tempSource === 'weather' ? edit.weather : null, notes: document.getElementById('tp-e-notes').value, publicNote: document.getElementById('tp-e-public-note').value.trim(), logger: loggerValue('tp-e-logger') })).then(function (d) {
        if (!d.success) { status(d.message || 'Could not save.', 'error'); return; }
        mine = null; counts = null;
        // The worker's summary has the tyre make and model but not the size, so the size is what was just sent: without it the
        // width, profile and diameter drop-downs came back empty after Save and looked unsaved.
        Object.assign(view.s, { privacy: d.session.privacy, conditions: d.session.conditions, tyres: d.session.tyres, tyreMake: d.session.tyreMake, tyreModel: d.session.tyreModel, tyreWidth: ty.tyreWidth, tyreProfile: ty.tyreProfile, tyreRim: ty.tyreRim, pads: d.session.pads || '', padFrontMake: pd.padFrontMake, padFrontCompound: pd.padFrontCompound, padRearMake: pd.padRearMake, padRearCompound: pd.padRearCompound, temp: d.session.temp, tempSource: d.session.tempSource, weather: d.session.weather, notes: document.getElementById('tp-e-notes').value, publicNote: document.getElementById('tp-e-public-note').value.trim(), logger: loggerValue('tp-e-logger') });
        var ll = document.getElementById('tp-logger-line'), sub = document.querySelector('.tp-session-head .tp-sub');
        if (ll) ll.previousSibling && ll.previousSibling.nodeType === 3 && ll.previousSibling.remove(), ll.remove();
        if (view.s.logger && sub) sub.insertAdjacentHTML('beforeend', ' &middot; <span id="tp-logger-line">Logger: ' + esc(view.s.logger) + '</span>');
        var pl = document.getElementById('tp-public-note-line');
        if (pl) pl.remove();
        document.querySelector('.tp-session-head .tp-sub').insertAdjacentHTML('afterend', publicNoteHtml(view.s.publicNote));
        dirty = false;
        getMine().then(function (m) { view.mine = m; drawSession(); status('Saved.', 'ok'); });
      });
    }
    document.getElementById('tp-e-save').addEventListener('click', saveSettings);
    // Close leaves without saving; it only checks first when something was changed.
    document.getElementById('tp-e-close').addEventListener('click', function () {
      if (dirty && !window.confirm('Close without saving your changes?')) return;
      closeSession();
    });
    // Discard puts the settings back as they were last saved, and stays on the page.
    document.getElementById('tp-e-discard').addEventListener('click', function () {
      var had = dirty;
      drawSession();
      if (had) status('Changes discarded.', 'ok');
    });
    var splitBtn = document.getElementById('tp-e-split');
    if (splitBtn) splitBtn.addEventListener('click', function () { splitSession(s, splitBtn); });
    document.getElementById('tp-e-del').addEventListener('click', function () {
      if (!window.confirm('Delete this session? This can\'t be undone.')) return;
      api('DELETE', '/track/session?id=' + encodeURIComponent(s.id)).then(function (d) {
        if (!d.success) { status(d.message || 'Could not delete.', 'error'); return; }
        mine = null; counts = null;
        go('', false, true);
      });
    });
  }

  // A session saved as several files merged into one, made into one session per file from the readings kept
  // with it. Each file's own day and time come from its name where the names allow, else it keeps the
  // session's. The member's settings carry over to every new session, then the merged one is removed.
  function splitSession(s, btn) {
    if (!window.confirm('Split this into ' + s.runs + ' separate sessions? The merged session is replaced and your settings carry over.')) return;
    btn.disabled = true;
    status('Loading your readings...');
    Promise.all([fetchSource(s.id), getLibrary()]).then(function (r) {
      var src = r[0], lib = r[1];
      if (!src.p) throw new Error(sourceError(src));
      var rd = restoreSource(src), groups = {}, order = [];
      rd.points.forEach(function (q) { var k = q.run || 1; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(q); });
      if (order.length < 2) throw new Error('This session is not several files.');
      // The files' names in time order, when each has a date in it.
      var names = String(s.fileName || '').split(', '), when = names.map(function (n) { var d = T.dateFromName(n); return d ? { name: n, date: d.date, time: d.time || '' } : null; });
      var named = names.length === order.length && when.every(Boolean) ? when.slice().sort(function (x, y) { return (x.date + x.time).localeCompare(y.date + y.time); }) : null;
      var opts = { type: s.type, ignoreFirstFinish: s.ignoreFinish !== false };
      if (s.organizer) opts.organizer = s.organizer;
      if (s.finishCrossing) opts.finishCrossing = s.finishCrossing;
      if (s.startLineFromMember && s.startLine) { opts.startLine = s.startLine; if (s.finishLine) opts.finishLine = s.finishLine; }
      var settings = { conditions: s.conditions || '', tyres: s.tyres || '', tyre: tyreInit(s), pads: padInit(s), temp: s.temp, tempSource: s.tempSource || '', weather: s.weather || null, notes: s.notes || '', publicNote: s.publicNote || '', logger: s.logger || '', privacy: s.privacy, venueName: s.venueId ? '' : s.venue, street: false };
      var made = [], skipped = [], chain = Promise.resolve();
      order.forEach(function (k, i) {
        chain = chain.then(function () {
          var pts = groups[k], t0 = pts[0].t;
          var one = Object.assign({}, rd, { points: pts.map(function (q) { var c = Object.assign({}, q); c.t = q.t - t0; delete c.run; return c; }) });
          delete one.runs;
          if (named) { one.fileDate = named[i].date; one.fileTime = named[i].time; delete one.startedAt; }
          else if (i) { one.fileDate = s.date; one.fileTime = s.time || ''; delete one.startedAt; }
          var s1 = T.analyse(one, lib, opts);
          var none = !(s1.laps && s1.laps.length);
          if (none || s1.needsStartLine) { skipped.push({ name: named ? named[i].name : 'File ' + (i + 1), reason: s1.problem || 'No laps were found.' }); return; }
          s1.fileName = named ? named[i].name : '';
          if (!s1.venueId && settings.venueName) s1.venueName = settings.venueName;
          return api('POST', '/track/sessions', postBody(settings, s.carId, s1), true).then(function (d) {
            if (!d.success) { skipped.push({ name: s1.fileName || 'File ' + (i + 1), reason: d.message || 'Could not save it.' }); return; }
            made.push(d.session.id);
            return keepReadings(d.session.id, one);
          });
        });
      });
      return chain.then(function () {
        if (!made.length) throw new Error('None of the files could be made into a session.');
        // Anything that could not be made means keeping the merged session, so nothing is lost.
        if (skipped.length) {
          return Promise.all(made.map(function (id) { return api('DELETE', '/track/session?id=' + encodeURIComponent(id)); })).then(function () {
            throw new Error(skipped.length + ' of the files could not be made into a session (' + skipped[0].name + ': ' + skipped[0].reason + '). Nothing was changed.');
          });
        }
        return api('DELETE', '/track/session?id=' + encodeURIComponent(s.id)).then(function () { return made; });
      });
    }).then(function (ids) {
      mine = null; counts = null;
      justSaved = { batch: ids.length, ids: ids, split: true, skipped: [] };
      go('', false, true);
    }).catch(function (e) {
      btn.disabled = false;
      status((e && e.message) || 'Could not split the session.', 'error');
    });
  }

  // ---------- A build's shared sessions ----------
  // Kerb weight (the owner's figure, else the vehicle list's for the model and version) and the pads fitted, from
  // the car's mods in My Garage.
  function carKitHtml(c) {
    var V = window.MT3UKVehicles, lib = V && V.weight ? V.weight(c) : null;
    var parts = [];
    if (c.weight) parts.push('Kerb weight ' + Number(c.weight).toLocaleString('en-GB') + ' kg (owner\'s figure)');
    else if (lib) parts.push('Kerb weight ' + Number(lib).toLocaleString('en-GB') + ' kg (maker\'s figure)');
    if (c.pads) parts.push('Pads: ' + c.pads);
    return parts.length ? '<p class="tp-sub" id="tp-car-kit">' + esc(parts.join(' · ')) + '</p>' : '';
  }
  function showCar(carId) {
    loading();
    var V = window.MT3UKVehicles, my = routeSeq;
    Promise.all([api('GET', '/track/public?car=' + encodeURIComponent(carId)), V && V.load ? V.load().catch(function () {}) : null]).then(function (r) {
      if (stale(my)) return;
      var d = r[0];
      if (!d.success) return failed('That build could not be found.');
      var c = d.car;
      var h = back('Track sessions', '') + '<div class="tp-head"><div><h2>' + esc(c.name || 'MT3UK build') + '</h2><p class="tp-sub">' + esc([c.owner, [c.year, titleOf(c), c.version].filter(Boolean).join(' '), c.drive].filter(Boolean).join(' · ')) + '</p>' + carKitHtml(c) + '</div>' + '<div class="tp-head-side">' + refreshChip() + unitsChip() + (d.mine ? '<a class="chip tp-others" href="track.html" data-go="" aria-label="What I see" title="What I see: back to my sessions">' + icon('eye') + '</a>' : shareDot('Share this build')) + '</div></div>';
      if (d.mine) { currentCar = carId; h += '<div class="tp-publicbar" role="note">' + icon('eye') + '<span><b>Public view.</b> This is what other members see. Only the sessions you share are listed, and nothing here can be edited.</span></div>'; }
      h += d.sessions.length ? '<div class="tp-list tp-tracklist" id="tp-sess-list">' + trackListHtml(d.sessions, carId, true) + '</div>' : '<div class="card tp-empty">' + icon('flag') + '<p>No shared sessions yet.</p></div>';
      h += '<p class="tp-sub"><a href="gallery.html" class="tp-link">See the build in the Gallery' + icon('chev') + '</a></p>';
      app.innerHTML = h;
      wireTrackToggles();
      wireShare({ url: SITE_URL + 'track.html?car=' + encodeURIComponent(carId), heading: 'Share this build', subject: (c.name || 'Laps build') + ' | Laps by MT3UK', campaign: 'track_build',
        text: (c.name || 'This build') + '’s track sessions on Laps by MT3UK' });
    }).catch(function () { failed('That build could not be loaded.'); });
  }

  route();
})();
