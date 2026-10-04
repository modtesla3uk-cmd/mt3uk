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
  var RUN_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
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
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
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
    chev: '<path d="m9 6 6 6-6 6"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
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
    return ready.then(function () { return fetch(API + path, opts); }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; });
    });
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
  // The welcome card's text, as set on the admin page; nothing set means the built-in words.
  var copy = null;
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
      mine = { cars: (r[0].cars || []), sessions: r[1].sessions || [] };
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
    app.innerHTML = '<div class="tp-loading" role="status">Loading...</div>';
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
  function go(q, keepScroll) {
    var y = window.scrollY || 0;
    rememberCards();
    history.pushState(null, '', 'track.html' + (q ? '?' + q : ''));
    route();
    window.scrollTo(0, keepScroll ? y : 0);
  }
  window.addEventListener('popstate', route);
  app.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-go]');
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('data-go')); }
  });
  // The page's own Back (to the page before) is only on the list of sessions; a session or the Add page has its own Back.
  function syncPageBack() { var b = document.querySelector('.page-hero .back-link'); if (b) b.hidden = !!location.search.replace(/^\?/, ''); }
  function route() {
    stopPlay();
    syncPageBack();
    if (cmpFull) { cmpFull = false; unlockOrientation(); document.body.classList.remove('tp-noscroll'); }
    V.hideTip();
    var p = params();
    // Sessions and builds have their own share button, so the page one steps aside.
    document.body.setAttribute('data-tp-view', p.get('s') ? 'session' : p.get('car') && !p.get('add') ? 'car' : '');
    if (p.get('s')) return showSession(p.get('s'));
    if (p.get('add')) return showAdd(p.get('car'));
    // The leaderboards have their own page now; old links still work.
    if (p.get('board')) { location.replace('leaderboards.html?board=' + encodeURIComponent(p.get('board'))); return; }
    if (p.get('drag')) { location.replace('leaderboards.html?drag=' + encodeURIComponent(p.get('drag'))); return; }
    if (p.get('boards')) { location.replace('leaderboards.html'); return; }
    if (p.get('car')) return showCar(p.get('car'));
    return showHome();
  }
  function loading(msg) { app.innerHTML = '<div class="tp-loading" role="status">' + esc(msg || 'Loading...') + '</div>'; }
  function failed(msg) { app.innerHTML = '<div class="card tp-empty">' + icon('warn') + '<p>' + esc(msg) + '</p><a class="btn btn-secondary btn-sm" href="track.html" data-go="" aria-label="Back to Track sessions">Back</a></div>'; }
  // Every Back is a button that just says Back; where it goes is in its name for a screen reader.
  function back(label, q) { return '<a class="tp-back" href="track.html' + (q ? '?' + q : '') + '" data-go="' + esc(q || '') + '" aria-label="' + esc(/^back\b/i.test(label) ? label : 'Back to ' + label.charAt(0).toLowerCase() + label.slice(1)) + '">' + icon('back') + 'Back</a>'; }
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
  var SITE_URL = 'https://mt3uk.com/';
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
  function tyreModels(make) { return ((TY && TY.makes[make]) || []).map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join(''); }
  function tyreFields(pre, t) {
    if (!TY) return '';
    t = t || {};
    var known = !!(t.make && Object.prototype.hasOwnProperty.call(TY.makes, t.make)), other = !!(t.make && !known);
    return '<div class="tp-tyres"><span class="tp-lbl">Tyres</span>' +
      '<div class="tp-f2"><div class="tp-field"><label for="' + pre + '-make">Make</label><select class="field" id="' + pre + '-make"><option value="">Not set</option>' +
        Object.keys(TY.makes).map(function (m) { return '<option value="' + esc(m) + '"' + (known && t.make === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') +
        '<option value="__other"' + (other ? ' selected' : '') + '>Other make</option></select></div>' +
      '<div class="tp-field"><label for="' + pre + '-model">Model</label><input class="field" id="' + pre + '-model" list="' + pre + '-models" autocomplete="off" placeholder="For example, Pilot Sport 4S" value="' + esc(t.model || '') + '"><datalist id="' + pre + '-models">' + tyreModels(known ? t.make : '') + '</datalist></div></div>' +
      '<div class="tp-field" id="' + pre + '-other-wrap"' + (other ? '' : ' hidden') + '><label for="' + pre + '-make-other">Make</label><input class="field" id="' + pre + '-make-other" value="' + esc(other ? t.make : '') + '"></div>' +
      '<div class="tp-f3"><div class="tp-field"><label for="' + pre + '-w">Width (mm)</label><select class="field" id="' + pre + '-w">' + tyreOpts(TY.widths, t.w, 'Width') + '</select></div>' +
      '<div class="tp-field"><label for="' + pre + '-p">Profile (%)</label><select class="field" id="' + pre + '-p">' + tyreOpts(TY.profiles, t.p, 'Profile') + '</select></div>' +
      '<div class="tp-field"><label for="' + pre + '-d">Diameter (in)</label><select class="field" id="' + pre + '-d">' + tyreOpts(TY.rims, t.d, 'Diameter') + '</select></div></div>' +
      '<p class="tp-src tp-tyre-preview" id="' + pre + '-preview"></p></div>';
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
      var dl = document.getElementById(pre + '-models');
      if (dl) dl.innerHTML = tyreModels(mk.value);
      // A different make has different models, so the old one goes.
      var md = document.getElementById(pre + '-model');
      if (md) md.value = '';
      preview();
    });
    // The list of models drops down as soon as the empty box is tapped.
    var mdl = document.getElementById(pre + '-model');
    if (mdl) mdl.addEventListener('focus', function () { if (!mdl.value && typeof mdl.showPicker === 'function') { try { mdl.showPicker(); } catch (e) { /* not allowed here */ } } });
    ['model', 'make-other', 'w', 'p', 'd'].forEach(function (k) {
      var el = document.getElementById(pre + '-' + k);
      if (el) { el.addEventListener('input', preview); el.addEventListener('change', preview); }
    });
    preview();
  }
  function unitsChip() { return '<button type="button" class="chip tp-units" data-units>' + (V.units.mph ? 'mph' : 'km/h') + '</button>'; }
  app.addEventListener('click', function (e) {
    if (!e.target.closest('[data-units]')) return;
    V.setMph(!V.units.mph);
    // Adding a session: redraw it in the new unit, keeping the file and
    // everything chosen or typed so far.
    if (params().get('add') && add && add.session && document.getElementById('tp-result')) {
      var ty = readTyre('tp-tyre'); if (ty) { var nt = TY.compose(ty); if (add.tyrePre && nt !== add.tyres) add.tyrePre = false; add.tyre = ty; add.tyres = nt; }
      var ne = document.getElementById('tp-notes'); if (ne) add.notes = ne.value.trim();
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
    Promise.all([getMine(), getLibrary(), getCopy()]).then(function (r) {
      var m = r[0], c = r[2] || {};
      if (m && m.gate) return showGate();
      var h = '';
      if (!m) {
        var bullets = c.bullets && c.bullets.length ? c.bullets : ['Laps, sectors and corners found for you', 'Compare any two laps, corner by corner', 'See what each mod in My Garage did to your times', 'Drag runs from the strip: 60 ft, 0 to 60, quarter mile', 'Private unless you choose to share'];
        h += '<div class="card tp-intro"><h2>' + esc(c.heading || 'Your track days, mapped') + '</h2><p>' + esc(c.intro || 'Upload the file from your lap timer (RaceBox, VBOX, Harry\'s LapTimer, TrackAddict, AiM and most phone apps) and see every lap drawn on the track, where you gained and lost time, and how your times changed as you modified the car.') + '</p>' +
          '<ul class="tp-ticks">' + bullets.map(function (b) { return '<li>' + icon('check') + esc(b) + '</li>'; }).join('') + '</ul>' +
          '<div class="tp-actions"><a class="btn btn-accent" href="signin.html?next=/track.html">Sign in to add a session</a><a class="btn btn-secondary" id="tp-boards-btn" href="leaderboards.html">' + icon('trophy') + 'Leaderboards</a></div></div>';
      } else if (!m.cars.length) {
        h += '<div class="card tp-intro"><h2>Add your car first</h2><p>Sessions belong to a car, so the times can be matched to its mods. Add your car with a photo in My Garage, then come back here.</p><a class="btn btn-accent" href="my-builds.html">Go to My Garage</a></div>';
      } else {
        // Leaderboards first, above the cars. Faded until the member has a
        // session of their own to put on a board.
        h += boardsLink(!m.sessions.length) + myCarsHtml(m);
      }
      if (!m || !m.cars.length) h += boardsLink(false);
      // Sessions just saved from a batch: say so at the top.
      if (justSaved && (justSaved.batch || justSaved.text)) { h = savedHtml(justSaved) + h; justSaved = null; }
      app.innerHTML = h;
      wireCarChips(m);
      if (m && m.cars && m.cars.length) wireSessionList(m);
    }).catch(function () { failed('Track sessions could not be loaded. Check your connection and try again.'); });
  }
  function boardsLink(quiet) {
    return '<a class="tp-boards-link' + (quiet ? ' is-quiet' : '') + '" href="leaderboards.html">' + icon('trophy') + '<span><b>Leaderboards</b><span>' +
      (quiet ? 'Add a session to get your car on the board' : 'Rankings at each track, drag strip, sprint and hill climb') + '</span></span>' + icon('chev') + '</a>';
  }
  var currentCar = null;
  function myCarsHtml(m) {
    try { currentCar = currentCar || params().get('mycar') || localStorage.getItem('mt3ukTrackCar'); } catch (e) {}
    if (!m.cars.some(function (c) { return c.id === currentCar; })) currentCar = m.cars[0].id;
    var car = m.cars.filter(function (c) { return c.id === currentCar; })[0];
    var list = m.sessions.filter(function (s) { return s.carId === car.id; });
    // Your cars: pick one; its sessions are listed below.
    var h = '<div class="tp-section"><div class="tp-head"><h2>Your cars</h2></div><div class="tp-cars" id="tp-cars">' + m.cars.map(function (c) {
      var n = m.sessions.filter(function (x) { return x.carId === c.id; }).length;
      return '<button type="button" class="tp-car' + (c.id === car.id ? ' is-on' : '') + '" data-car="' + esc(c.id) + '" aria-pressed="' + (c.id === car.id) + '"><b>' + esc(c.name) + '</b><span>' +
        esc([c.model, c.version].filter(Boolean).join(' ') || 'Car') + ' &middot; ' + n + ' session' + (n === 1 ? '' : 's') + '</span></button>';
    }).join('') + '</div></div>';
    h += '<div class="tp-section"><div class="tp-head"><div><h2>Sessions</h2><p class="tp-sub tp-for">' + esc(car.name) + '</p></div>' + unitsChip() + '</div>';
    h += '<div class="tp-actions"><a class="btn btn-accent" href="track.html?add=1&car=' + encodeURIComponent(car.id) + '" data-go="add=1&car=' + esc(encodeURIComponent(car.id)) + '">' + icon('upload') + 'Add a session</a>' +
      (car.virtual ? '' : '<a class="btn btn-secondary" href="track.html?car=' + encodeURIComponent(car.id) + '" data-go="car=' + esc(encodeURIComponent(car.id)) + '">What others see</a>') + '</div>';
    if (!list.length) h += '<div class="card tp-empty">' + icon('flag') + '<p>No sessions for ' + esc(car.name) + ' yet. Add the file from your lap timer to get started.</p></div>';
    else h += listToolsHtml(list) + trackFilterHtml(list) + '<div class="tp-list" id="tp-sess-list">' + shownListHtml(list) + '</div>';
    return h + '</div>';
  }
  // Filter the list by track name (only when there's more than one track).
  var trackFilter = '';
  function inTrackFilter(s) { return !trackFilter || trackName(s) === trackFilter; }
  // Filter by kind of session (Track day, Drag, Sprint) and sort by newest, oldest or A to Z.
  var typeFilter = '', sortMode = 'newest';
  var TYPE_CHIPS = [['', 'All'], ['track', 'Track'], ['drag', 'Drag'], ['sprint', 'Sprint']];
  var SORTS = [['newest', 'Newest'], ['oldest', 'Oldest'], ['az', 'A to Z']];
  function inTypeFilter(s) { return !typeFilter || s.type === typeFilter; }
  function whenOf(s) { return (s.date || '') + (s.time || ''); }
  function sortedSessions(l) {
    return l.slice().sort(function (x, y) {
      if (sortMode === 'az') { var c = trackName(x).localeCompare(trackName(y)); if (c) return c; }
      var a = whenOf(x), b = whenOf(y);
      return a === b ? 0 : (a < b) === (sortMode === 'oldest') ? -1 : 1;
    });
  }
  function shownListHtml(list) {
    var rows = sortedSessions(list.filter(inTrackFilter).filter(inTypeFilter));
    return rows.length ? sessionListHtml(rows, true, list) : '<div class="card tp-empty">' + icon('flag') + '<p>No sessions match this filter.</p></div>';
  }
  function listToolsHtml(list) {
    if (list.length < 2) return '';
    return '<div class="tp-tools"><div class="tp-types" id="tp-type-filter" role="group" aria-label="Show">' + TYPE_CHIPS.map(function (t) {
      var n = t[0] ? list.filter(function (x) { return x.type === t[0]; }).length : list.length;
      return '<button type="button" class="chip' + (t[0] === typeFilter ? ' is-on' : '') + '" data-type="' + t[0] + '" aria-pressed="' + (t[0] === typeFilter) + '">' + t[1] + ' (' + n + ')</button>';
    }).join('') + '</div><div class="tp-field tp-sort"><label for="tp-sort">Sort by</label><select class="field" id="tp-sort">' +
      SORTS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sortMode ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>';
  }
  function trackFilterHtml(list) {
    var names = {};
    list.forEach(function (x) { var n = trackName(x); names[n] = (names[n] || 0) + 1; });
    var keys = Object.keys(names).sort(function (x, y) { return x.localeCompare(y); });
    if (!names[trackFilter]) trackFilter = '';
    if (keys.length < 2) return '';
    return '<div class="tp-field tp-filter"><label for="tp-track-filter">Track</label><select class="field" id="tp-track-filter"><option value="">All tracks (' + list.length + ')</option>' +
      keys.map(function (k) { return '<option value="' + esc(k) + '"' + (k === trackFilter ? ' selected' : '') + '>' + esc(k) + ' (' + names[k] + ')</option>'; }).join('') + '</select></div>';
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
    var sel = document.getElementById('tp-track-filter');
    function redraw() {
      document.getElementById('tp-sess-list').innerHTML = shownListHtml(list);
      applyRanks(list);
    }
    if (sel) sel.addEventListener('change', function () { trackFilter = sel.value; redraw(); });
    var types = document.getElementById('tp-type-filter'), sortSel = document.getElementById('tp-sort');
    if (types) types.addEventListener('click', function (e) {
      var b = e.target.closest('[data-type]');
      if (!b) return;
      typeFilter = b.getAttribute('data-type');
      Array.prototype.forEach.call(types.querySelectorAll('[data-type]'), function (x) {
        var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      redraw();
    });
    if (sortSel) sortSel.addEventListener('change', function () { sortMode = sortSel.value; redraw(); });
    if (ranksFor !== car.id) { ranks = {}; ranksFor = car.id; }
    applyRanks(list);
    loadRanks(car.id, list).then(function (r) {
      if (ranksFor !== car.id || currentCar !== car.id) return;
      ranks = r;
      applyRanks(list);
    });
  }
  function sessionRow(s) {
    return '<a class="tp-row" href="track.html?s=' + esc(s.id) + '" data-sid="' + esc(s.id) + '" data-go="s=' + esc(s.id) + '"><span class="tp-row-main"><b>' + esc(trackName(s)) + '</b><span>' + esc(niceDate(s.date)) + (s.conditions ? ', ' + esc(s.conditions) : '') + (TYPE_WORD[s.type] ? ', ' + TYPE_WORD[s.type] : '') + '</span></span>' +
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
  function dayRow(s, n, fastest) {
    return '<a class="tp-row" href="track.html?s=' + esc(s.id) + '" data-sid="' + esc(s.id) + '" data-go="s=' + esc(s.id) + '"><span class="tp-daygroup-no">#' + n + '</span><span class="tp-row-main"><b>' + (s.time ? esc(s.time) : 'Time not known') + '</b><span>' +
      esc([s.type === 'drag' ? (s.runs || 0) + ' run' + (s.runs === 1 ? '' : 's') : (s.laps || 0) + (s.type === 'sprint' ? ' run' : ' lap') + (s.laps === 1 ? '' : 's'), s.conditions].filter(Boolean).join(', ')) + (fastest ? ' <b class="tp-fastest">Fastest</b>' : '') + '</span></span>' +
      '<span class="tp-row-res">' + esc(sessionResult(s)) + '</span>' + (s.privacy !== undefined ? privacyPill(s.privacy, s.street) : '') + icon('chev') + '</a>';
  }
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
  function sessionListHtml(list, owner, all) {
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
      if (g.length < 2) return g[0].type === 'other' && driveOwner[g[0].date] ? '' : sessionRow(g[0]);
      g = g.slice().sort(byTime);
      var drives = driveOwner[g[0].date] === k ? (all || list).filter(function (x) { return x.type === 'other' && x.date === g[0].date; }).sort(byTime) : [];
      // The fastest of the day: the best lap or run, or for drag runs the quickest quarter mile (else 0 to 60).
      function score(x) { return x.type === 'drag' ? (x.quarter || (x.s60 ? 1000 + x.s60 : 0)) : x.bestTime || 0; }
      var fast = g.filter(function (x) { return score(x) > 0; }).sort(function (a, b) { return score(a) - score(b); })[0];
      var key = k, open = openDays[key] || !fast;
      var best = fast && fast.type !== 'drag' ? V.fmtLap(fast.bestTime) : '';
      return '<div class="card tp-daygroup" data-open="' + (open ? 'true' : 'false') + '" data-day="' + esc(key) + '">' +
        '<div class="tp-daygroup-head"><button type="button" class="tp-daygroup-title" data-day-toggle aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="' + esc(niceDate(g[0].date) + ' on ' + trackName(g[0]) + ', ' + g.length + ' sessions') + '"><h3>' + esc(niceDate(g[0].date)) + ' on ' + esc(trackName(g[0])) + '</h3></button>' +
        (owner ? '<button type="button" class="tp-daygroup-share" role="switch" data-day-share data-ids="' + esc(g.map(function (x) { return x.id; }).join(',')) + '" data-what="' + esc(niceDate(g[0].date) + ' at ' + trackName(g[0])) + '" aria-checked="' + (g.every(function (x) { return x.privacy && x.privacy !== 'private'; }) ? 'true' : 'false') + '" aria-label="Share all ' + g.length + ' sessions"><span>Shared</span><span class="tp-track"></span></button>' : '') +
        '<button type="button" class="tp-daygroup-count" data-day-toggle aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="Show or hide the ' + g.length + ' sessions"><span class="tp-small">' + g.length + ' sessions</span>' + icon('chev') + '</button></div>' +
        (dayCharge(g, drives) ? '<p class="tp-small tp-daygroup-charge">' + esc(dayCharge(g, drives)) + '</p>' : '') +
        (fast ? '<div class="tp-daygroup-best"><span class="tp-small tp-daygroup-label">Fastest session of the day</span>' + dayRow(fast, g.indexOf(fast) + 1, false) + '</div>' : '') +
        '<div class="tp-list tp-daygroup-all">' + g.map(function (x, i) { return dayRow(x, i + 1, x === fast); }).join('') +
        (drives.length ? '<span class="tp-small tp-daygroup-label tp-drives-label">Drives between runs (' + drives.length + ')</span>' + drives.map(sessionRow).join('') : '') +
        (owner ? '<button type="button" class="btn btn-danger btn-sm tp-daygroup-delete" data-day-delete data-ids="' + esc(g.concat(drives).map(function (x) { return x.id; }).join(',')) + '" data-label="' + esc(trackName(g[0])) + '" data-date="' + esc(niceDate(g[0].date)) + '">' + icon('trash') + 'Delete this day</button>' : '') + '</div></div>';
    }).join('');
  }
  function wireCarChips(m) {
    var chips = document.getElementById('tp-cars');
    if (!chips) return;
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-car]');
      if (!b) return;
      currentCar = b.getAttribute('data-car');
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
    if (!window.confirm('Confirm delete?\n\nThis will delete all ' + ids.length + ' sessions for this day (' + what + '). This can\'t be undone.')) return;
    b.disabled = true;
    var chain = Promise.resolve(), failed = 0;
    ids.forEach(function (id) {
      chain = chain.then(function () { return api('DELETE', '/track/session?id=' + encodeURIComponent(id)).then(function (d) { if (!d.success) failed++; }).catch(function () { failed++; }); });
    });
    chain.then(function () {
      mine = null; counts = null;
      justSaved = { text: failed ? failed + ' of the ' + ids.length + ' sessions for ' + what + ' could not be deleted. Try again.' : 'Deleted all ' + ids.length + ' sessions for this day (' + what + ').' };
      showHome();
    });
  });
  // The switch on a day's group: share every session that day at that track, or make them all Only me.
  document.addEventListener('click', function (e) {
    var sw = e.target.closest && e.target.closest('[data-day-share]');
    if (!sw || sw.disabled) return;
    var ids = sw.getAttribute('data-ids').split(','), what = sw.getAttribute('data-what');
    var share = sw.getAttribute('aria-checked') !== 'true', value = share ? 'board' : 'private';
    if (share && !window.confirm('Share all ' + ids.length + ' sessions at ' + what + '? Members will see them on your car\'s page, and on the track\'s leaderboard where it has one.')) return;
    sw.disabled = true;
    sw.setAttribute('aria-checked', share ? 'true' : 'false');
    var chain = Promise.resolve(), failed = 0;
    ids.forEach(function (id) {
      chain = chain.then(function () { return api('PUT', '/track/session', { id: id, privacy: value }).then(function (d) { if (!d.success) failed++; }).catch(function () { failed++; }); });
    });
    chain.then(function () {
      mine = null; counts = null;
      justSaved = { text: failed ? failed + ' of the ' + ids.length + ' sessions at ' + what + ' could not be changed. Try again.' : 'All ' + ids.length + ' sessions at ' + what + ' are now ' + (share ? 'Shared' : 'Only me') + '.' };
      showHome();
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
    if (!token()) { location.href = 'signin.html?next=' + encodeURIComponent('/track.html?add=1'); return; }
    loading();
    Promise.all([getMine(), getLibrary(), isAdmin(), loadTyres()]).then(function (r) {
      var m = r[0];
      if (!m) { location.href = 'signin.html?next=' + encodeURIComponent('/track.html?add=1'); return; }
      if (m.gate) return showGate();
      if (!m.cars.length) return showHome();
      var car = m.cars.filter(function (c) { return c.id === carId; })[0] || m.cars[0];
      add = { car: car, cars: m.cars, lib: r[1], admin: r[2], rd: null, session: null, type: null, startLine: null, conditions: 'Dry', privacy: 'private', street: false, file: null };
      var lt = lastTyre(m, car.id);
      // The tyres start empty; the car's last ones are offered with a button.
      add.lastTyre = lt || null;
      drawAdd();
    }).catch(function () { failed('Could not load your cars. Check your connection and try again.'); });
  }
  function drawAdd() {
    var a = add;
    var h;
    if (a.replaceId) {
      // Changing a saved session's type: its saved readings are read again.
      h = back('Back to the session', 's=' + a.replaceId) + '<div class="tp-head"><h2>' + (a.lineEdit ? 'Edit the map' : 'Change the type') + '</h2>' + unitsChip() + '</div>' +
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
      add.nameLooked = false;
      if (add.venueNameLooked) { add.venueName = ''; add.venueNameLooked = false; }
      add.session = null; add.startLine = null; add.finishLine = null; add.editLines = false; add.tapFull = false; add.tapAuto = false; add.tapOutline = null; add.finishCross = 0; add.organizer = ''; add.rollout = false; add.confirmLines = false; add.type = null; add.date = null; add.time = null;
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
    // Editing a saved session's map: the lines on the map, not the course's own.
    if (a.lineEdit) opts.ownLines = true;
    return opts;
  }
  function analyse() {
    var a = add;
    var opts = analysisOpts(a);
    a.session = T.analyse(a.rd, a.lib, opts);
    // A hill climb, as picked or as the track list has it.
    if (a.session.type === 'sprint' && (a.hill || isHillSession(a.session, a.lib))) a.session.hill = true; else a.hill = false;
    // Kept so Re-time sessions can time it the same way later (on is the default).
    if (a.session.type === 'sprint' && a.ignoreFinish === false) a.session.ignoreFinish = false;
    // A date or start time the member typed wins over the file's.
    if (a.date) { a.session.date = a.date; a.session.dateFrom = 'member'; }
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
    if (isSprint) out += '<div class="tp-field"><label for="tp-finish-cross">Run ends on</label><select class="field" id="tp-finish-cross"><option value="">Automatic (see the switch above)</option>' + [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (a.finishCross === n ? ' selected' : '') + '>Crossing ' + n + ' of the finish line</option>'; }).join('') + '</select><p class="tp-small">If the car passes the finish line before the run really ends, choose which crossing finishes the timing. It counts from the start line.</p></div>';
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
    h += channelsHtml(a);
    var isSprint = s.type === 'sprint', word = isSprint ? 'run' : 'lap';
    if (isSprint) {
      // Who ran the event: courses at one venue can have different start and finish lines.
      var orgs = {};
      ((a.lib && a.lib.venues) || []).forEach(function (vv) { if (vv.type === 'sprint' && (!s.venueId || vv.id === s.venueId)) (vv.layouts || []).forEach(function (l) { var o = l.organizer || ''; if (o) orgs[o] = 1; }); });
      h += '<div class="tp-field"><label for="tp-organiser">Organiser</label><input class="field" id="tp-organiser" list="tp-organisers" autocomplete="off" placeholder="For example, B19" value="' + esc(a.organizer || s.organizer || '') + '"><datalist id="tp-organisers">' + Object.keys(orgs).map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist><p class="tp-small">Who ran the sprint. Courses at one venue can have different start and finish lines, so this keeps results comparable.</p></div>';
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
      } else {
        var timed = s.laps.filter(function (l) { return l.kind === 'timed'; }).length;
        h += '<div class="tp-notice is-ok">' + miniMap(s) + '<div><b>' + esc(s.venue ? trackName(s) : (a.venueName || 'Your track')) + '</b><br>' +
          (s.autoLine ? 'No start line is set for this track, so your laps were found from your own trace. ' : s.officialLines ? 'Timed with this course\'s official ' + (isSprint ? 'start and finish lines' : 'start line') + ', which only MT3UK sets so results stay comparable. ' : s.venueId ? 'Found from the GPS in your file. ' : isSprint ? 'Timed between the start and finish you picked. ' : 'Timed from the start line you picked. ') + timed + ' timed ' + word + (timed === 1 ? '' : 's') + (s.bestTime ? ', best ' + V.fmtLap(s.bestTime) : '') + '.</div></div>';
        // A pass with a long stop in the middle is not a lap: this is probably a sprint or hill climb file.
        var lapTimes = (s.laps || []).filter(function (l) { return l.kind === 'timed'; }).map(function (l) { return l.time; });
        var gapLap = !isSprint && s.type === 'track' && (s.laps || []).some(function (l) { return l.kind === 'slow' && lapTimes.length && l.time > 3 * Math.min.apply(null, lapTimes); });
        if (isSprint) h += reverseHtml(s);
        if (gapLap) h += '<div class="tp-notice is-warn">' + icon('warn') + '<div><b>The car stopped for a long time between passes.</b><br>That is not a lap, so it is left out. If these were sprint or hill climb runs, switch the type to time each run from the start to the finish. <button type="button" class="btn btn-secondary btn-sm" data-tap="sprint">Switch to Sprint</button> <button type="button" class="btn btn-secondary btn-sm" data-tap="hill">Switch to Hill climb</button></div></div>';
        if ((a.startLine || a.finishLine || s.startLine) && !s.officialLines && !s.autoLine) h += '<button type="button" class="btn btn-secondary btn-sm tp-move-lines" data-tap="edit">' + icon('pin') + 'Move ' + (isSprint ? 'start and finish' : 'the start line') + '</button>';
        h += sprintControlsHtml(a, s, isSprint);
        h += addNowHtml(a, s, isSprint);
        // The admin can make the lines just set the official ones, so the course is remembered for everyone.
        if (a.admin && s.startLineFromMember && s.startLine && (isSprint ? s.finishLine : true)) h += '<div class="tp-notice is-admin" id="tp-official-box">' + icon('shield') + '<div>Admin: make these the official ' + (isSprint ? 'start and finish lines' : 'start line') + ' for this course, so every file uploaded there uses them. <button type="button" class="btn btn-secondary btn-sm" id="tp-make-official">Make official</button></div></div>';
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
        h += '<button type="button" class="tp-switch" role="switch" aria-checked="' + !!a.rollout + '" id="tp-rollout"><span><b>1 ft rollout</b><br><small>Start the clock just after the car starts to move, where RaceBox\'s option puts it. Off times from the first movement.</small></span><span class="tp-track"></span></button>';
    }
    var saveable = s.type === 'drag' ? (s.runs || []).length : s.type === 'other' ? true : !s.needsStartLine && s.laps && s.laps.length;
    if (saveable && a.lineEdit) {
      h += '<button type="button" class="btn btn-accent btn-block" id="tp-save">Send for approval</button><p class="tp-small">MT3UK checks the change before the map is updated. You will be emailed.</p>';
    } else if (saveable && a.replaceId) {
      h += '<button type="button" class="btn btn-accent btn-block" id="tp-save">Save changes</button>';
    } else if (saveable) {
      h += '<div class="tp-field"><span class="tp-lbl">Conditions</span><div class="tp-chips" data-cond>' + ['Dry', 'Damp', 'Wet'].map(function (c) { return '<button type="button" class="chip' + (a.conditions === c ? ' is-on' : '') + '" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div></div>' +
        tyreFields('tp-tyre', a.tyre) + (a.tyrePre && a.tyre ? '<p class="tp-small tp-tyre-note">Filled in from your last session with this car. Change it if it is different.</p>' : (a.lastTyre && !(a.tyre && (a.tyre.make || a.tyre.model || a.tyre.w)) ? '<p class="tp-small tp-tyre-note" id="tp-tyre-offer">Same tyres as last time (' + esc(TY.compose(a.lastTyre)) + ')? <button type="button" class="btn btn-secondary btn-sm" id="tp-use-last-tyres">Use previous tyres</button></p>' : '')) +
        '<div class="tp-field"><label for="tp-temp">Air temperature (°C)</label><input class="field" id="tp-temp" inputmode="numeric" placeholder="18" value="' + esc(a.temp == null ? '' : a.temp) + '"></div>' +
        (a.tempSource === 'weather' && a.weather ? '<p class="tp-src" id="tp-temp-src">' + icon('info') + '<span>' + weatherNote(a.weather, s.venue) + (a.condTouched ? '' : ' Conditions set to match. Change them if the track was different.') + '</span></p>'
          : a.tempSource === 'file' ? '<p class="tp-src" id="tp-temp-src">' + icon('info') + '<span>From the air temperature recorded in your file.</span></p>' : '') +
        '<div class="tp-field"><label for="tp-notes">Notes (only you see these)</label><input class="field" id="tp-notes" placeholder="Pressures, set-up, traffic..." value="' + esc(a.notes || '') + '"></div>' +
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
    if (s.needsStartLine || a.editLines) drawTap();
    var mv = box.querySelector('[data-tap="edit"]');
    if (mv) mv.addEventListener('click', function () {
      // Lines that came from the file or a known course become markers to move.
      var cur = add.session || {};
      if (!add.startLine && !add.finishLine && cur.startLine) { add.startLine = cur.startLine; add.finishLine = cur.type === 'sprint' ? cur.finishLine || null : null; }
      add.editLines = true; add.confirmLines = false; drawResult(); var tb = document.getElementById('tp-tapbox'); if (tb) tb.scrollIntoView({ block: 'nearest' }); });
  }
  function bestRunLine(runs) {
    var q = runs.filter(function (r) { return r.quarter; }).sort(function (x, y) { return x.quarter - y.quarter; })[0];
    var b = runs.slice().sort(function (x, y) { return x.s60 - y.s60; })[0];
    return q ? 'Best quarter mile ' + q.quarter.toFixed(2) + ' s at ' + V.fmtV(q.quarterSpeed) + '.' : 'Best 0 to 60 mph ' + b.s60.toFixed(2) + ' s.';
  }
  // Only me, or Shared (on the car's page and the track's leaderboard).
  // Older sessions saved as "build" count as Shared.
  function privacyOptions(on, limit) {
    if (on === 'build') on = 'board';
    var opts = [['private', 'Only me', 'The default. Only you, and MT3UK\'s admin if you ask for help.'],
      ['board', 'Shared', limit === 'noboard' ? 'Members see it on your car\'s page. This track has no leaderboard yet.' : 'Members see it on your car\'s page and on this track\'s leaderboard, with your car and mods.']];
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
      var ty = readTyre('tp-tyre');
      if (ty) { var nt2 = TY.compose(ty); if (a.tyrePre && nt2 !== a.tyres) a.tyrePre = false; a.tyre = ty; a.tyres = nt2; }
      ['temp', 'notes', 'venue-name'].forEach(function (k) {
        var el = document.getElementById('tp-' + k);
        if (!el) return;
        if (k === 'temp') {
          var tv = el.value.trim() === '' ? null : parseFloat(el.value);
          if (tv !== a.temp) { a.tempSource = tv == null ? '' : 'member'; a.weather = null; }
          a.temp = tv;
        }
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
    group('[data-privacy]', function (v) { keep(); a.privacy = v; drawResult(); });
    var orgIn = document.getElementById('tp-organiser');
    if (orgIn) orgIn.addEventListener('change', function () { keep(); a.organizer = orgIn.value.trim().slice(0, 40); analyse(); });
    var rollSw = document.getElementById('tp-rollout');
    if (rollSw) rollSw.addEventListener('click', function () { keep(); a.rollout = !a.rollout; analyse(); });
    var untimedBtn = document.getElementById('tp-save-untimed');
    if (untimedBtn) untimedBtn.addEventListener('click', function () {
      keep();
      var miss0 = missingName();
      if (miss0) { nameError(miss0); return; }
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
      api('POST', '/track/admin/course', { kind: s2.type === 'sprint' ? 'sprint' : 'circuit', hill: s2.type === 'sprint' && isHillSession(s2, a.lib), name: (nameEl && nameEl.value.trim()) || a.venueName || s2.venue || '', organizer: a.organizer || s2.organizer || '', venueId: s2.venueId || '', startLine: s2.startLine, finishLine: s2.finishLine || null, lapLength: laps && laps.dist ? laps.dist : 0, lat: s2.origin && s2.origin[0], lng: s2.origin && s2.origin[1] }).then(function (d) {
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
    var save = document.getElementById('tp-save');
    if (save) save.addEventListener('click', function () { keep(); if (a.lineEdit) { sendLineChange(save); return; } var miss = missingName(); if (miss) { nameError(miss); return; } saveSession(save); });
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
    var m = V.map(svg, trace, { mono: true, ratio: 0.85, fill: fill, origin: [out[0][0], out[0][1]] });
    svg.style.cursor = 'crosshair';
    function nearest(px, py) {
      var bi = 0, bd = Infinity;
      trace.forEach(function (p, k) { var pp = m.P(p[2], p[3]); var dd = (pp[0] - px) * (pp[0] - px) + (pp[1] - py) * (pp[1] - py); if (dd < bd) { bd = dd; bi = k; } });
      return bi;
    }
    // A line across the track at a point of the trace, and back again.
    function lineAt(bi) {
      var p0 = trace[Math.max(0, bi - 3)], p1 = trace[Math.min(trace.length - 1, bi + 3)], c = trace[bi];
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
    return { carId: carId, session: sess, conditions: a.conditions, tyres: a.tyres || '', tyreMake: (a.tyre && a.tyre.make) || '', tyreModel: (a.tyre && a.tyre.model) || '', tyreWidth: (a.tyre && a.tyre.w) || null, tyreProfile: (a.tyre && a.tyre.p) || null, tyreRim: (a.tyre && a.tyre.d) || null, temp: a.temp, tempSource: a.temp == null ? '' : (a.tempSource || 'member'), weather: a.tempSource === 'weather' ? a.weather : null, notes: a.notes || '', privacy: a.privacy, venueName: a.venueName || '', street: a.street, adminViewer: a.street ? adminViewerToken() : '' };
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
    return '<div class="tp-notice is-warn" id="tp-addnow-box">' + icon('pin') + '<div><b>' + (s.venueId ? 'This layout at ' + esc(s.venue) + ' is not in the MT3UK track list yet.' : (a.venueName || s.venue ? esc(name) : 'This ' + what) + ' is not in the MT3UK track list yet.') + '</b><br>' +
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
    return api('POST', '/track/courses', { kind: s.type === 'sprint' ? 'sprint' : 'circuit', hill: s.type === 'sprint' && isHillSession(s, a.lib), name: name, venueId: s.venueId || '', organizer: s.type === 'sprint' ? (a.organizer || s.organizer || '') : '', startLine: s.startLine, finishLine: s.finishLine || null, lapLength: tr.lap ? tr.lap[tr.lap.length - 1][0] : null, lat: o[0], lng: o[1], outline: tr.out }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not add the track.');
      if (d.library) a.lib = d.library;
      // Timed again against the new course: its official lines are the ones just sent, so the laps are the same.
      var next = T.analyse(a.rd, a.lib, analysisOpts(a));
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
  function requestCourse(a, s) {
    if (s.type !== 'track' && s.type !== 'sprint') return;
    var ownLine = s.layoutId && !s.officialLines && s.startLine && ((a.lib.venues || []).filter(function (vv) { return vv.id === s.venueId; })[0] || { layouts: [] }).layouts.filter(function (l) { return l.id === s.layoutId && !l.startLine; }).length;
    if (!(a.requestStart || ownLine || !s.layoutId)) return;
    var tr = traceOutline(s), out = tr.out, lap = tr.lap;
    return api('POST', '/track/requests', { kind: s.type === 'sprint' ? 'sprint' : 'circuit', hill: s.type === 'sprint' && isHillSession(s, a.lib), name: a.venueName || s.venue || '', venueId: s.venueId || '', layoutId: ownLine ? s.layoutId : '', organizer: s.type === 'sprint' ? (a.organizer || s.organizer || '') : '', startLine: s.startLine, finishLine: s.finishLine || null, lapLength: lap ? lap[lap.length - 1][0] : null, outline: out, note: s.type === 'sprint' ? (s.venueId ? 'Course not recognised' : 'New sprint or hill climb') : s.venueId ? 'Layout not recognised' : 'New track' }).catch(function () {});
  }
  // Several files: each is timed on its own and saved as its own session, with the settings chosen
  // above. A file that gives no laps or runs is left out and listed.
  function saveBatch(a, carId) {
    var items = (a.list || []).filter(function (x) { return x.rd && !x.mergedInto; }), opts = analysisOpts(a), made = [], skipped = [], siblingLine = null, noReadings = [];
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
        return api('POST', '/track/sessions', body, true).then(function (d) {
          if (!d.success) { skipped.push({ name: x.f.name, reason: d.message || 'Could not save it.' }); return; }
          made.push(d.session.id);
          return keepReadings(d.session.id, x.rd).then(function (r) { if (r && r.kept === false) noReadings.push(x.f.name); });
        });
      });
    });
    return chain.then(function () {
      if (!made.length) throw new Error('None of those files could be saved. ' + (skipped[0] ? skipped[0].name + ': ' + skipped[0].reason : ''));
      return { success: true, batch: made.length, ids: made, skipped: skipped, noReadings: noReadings };
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
      api('POST', '/track/requests', { kind: 'drag', name: (stripEl && stripEl.value.trim()) || a.venueName || '', lat: s.runs[0].lat, lng: s.runs[0].lng, note: 'Drag run saved at a strip we do not list' }).catch(function () {});
    }
    s.fileName = (a.files || []).map(function (f) { return f.name; }).join(', ').slice(0, 200);
    btn.disabled = true;
    status('Saving...');
    var carReady = a.car.virtual && !a.replaceId
      ? api('PUT', '/my-builds/car', { carId: a.car.id }).then(function (d) { if (!d.success) throw new Error(d.message || 'Could not set up the car'); a.car.id = d.car.id; a.car.virtual = false; mine = null; counts = null; return d.car.id; })
      : Promise.resolve(a.car.id);
    carReady.then(function (carId) {
      return (a.addNow && !a.replaceId && canAddNow(a, s) ? addCourseNow(a) : Promise.resolve(false)).then(function (added) {
        if (added) { s = a.session; status('Saving...'); } else requestCourse(a, s);
        if (a.replaceId) return api('PUT', '/track/session', { id: a.replaceId, session: s, venueName: a.venueName || '' }, true);
        if ((a.list || []).filter(function (x) { return x.rd && !x.mergedInto; }).length > 1) return saveBatch(a, carId);
        return api('POST', '/track/sessions', postBody(a, carId, s), true);
      });
    }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not save the session.');
      mine = null; counts = null;
      if (d.batch) { justSaved = { batch: d.batch, skipped: d.skipped || [], noReadings: d.noReadings || [], joined: (a.list || []).filter(function (x) { return x.merged; }).length }; go(''); return; }
      justSaved = { files: (a.files || []).length || 1 };
      if (a.replaceId) { go('s=' + d.session.id); return; }
      // Keep the readings with the session, so its type can be changed later.
      // Best effort: a session without them still works.
      status('Keeping your readings...');
      return keepReadings(d.session.id, a.rd).then(function (r) {
        if (r && r.kept === false) justSaved.readings = r.message;
        if (r && r.kept === null) justSaved.sending = true;
        go('s=' + d.session.id);
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
  function startRetype(s, type, hill) {
    status('Loading your readings...');
    Promise.all([fetchSource(s.id), getMine(), getLibrary(), isAdmin()]).then(function (r) {
      var src = r[0], m = r[1];
      if (!src.p || !m) throw new Error(sourceError(src));
      var car = m.cars.filter(function (c) { return c.id === s.carId; })[0] || m.cars[0];
      add = { car: car, cars: m.cars, lib: r[2], admin: r[3], rd: restoreSource(src), session: null, type: type, hill: !!hill, startLine: null, conditions: s.conditions || 'Dry', condTouched: true, privacy: s.privacy, street: false, tyres: s.tyres || '', tyre: tyreInit(s), temp: s.temp, tempSource: s.tempSource || '', weather: s.weather || null, notes: s.notes || '', date: s.date, time: s.time, venueName: s.venueId ? '' : s.venue, replaceId: s.id, files: null, list: null };
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
      return '<div class="tp-section" id="lineedit"><div class="tp-head"><h2>Start and finish lines</h2></div><div class="card tp-fields"><p class="tp-src">' + icon('info') + '<span>' + why + '</span></p>' + (readingsSending[s.id] ? '' : readingsAgainHtml()) + '</div></div>';
    }
    return '<div class="tp-section" id="lineedit"><div class="tp-head"><h2>Start and finish lines</h2></div><div class="card tp-fields" id="tp-lineedit"><p class="tp-sub">Checking...</p></div></div>';
  }
  // The track name on a session at a track we do not list: the same steps as the map (ask, allowed, send, approved).
  function renameHtml(s) {
    if (!s.mine || s.street || s.venueId || !s.venue) return '';
    return '<div class="tp-section" id="rename"><div class="tp-head"><h2>Track name</h2></div><div class="card tp-fields" id="tp-rename"><p class="tp-sub">Checking...</p></div></div>';
  }
  function drawRename(s, st) {
    var box = document.getElementById('tp-rename');
    if (!box) return;
    var h = '', p = st && st.proposal;
    if (!st || st.state === 'none') {
      h = '<p class="tp-sub">This track is not in the MT3UK track list, so it has the name you typed: <b>' + esc(s.venue) + '</b>. If it is wrong, ask MT3UK to let you rename it.</p>' +
        '<div class="tp-field"><label for="tp-rename-why">What should it be called? (optional)</label><input class="field" id="tp-rename-why" maxlength="300" placeholder="For example, it is spelt Abingdon"></div>' +
        '<button type="button" class="btn btn-secondary" id="tp-rename-request">' + icon('pin') + 'Request rename</button>';
    } else if (st.state === 'pending') {
      h = '<p class="tp-src">' + icon('info') + '<span>Requested. MT3UK has been told and will email you when you can rename this track.</span></p>';
    } else if (p) {
      h = '<p class="tp-src">' + icon('info') + '<span>Your new name is waiting for MT3UK to approve it. This session keeps its name until then.</span></p><p class="tp-small">From <b>' + esc(p.from || s.venue) + '</b> to <b>' + esc(p.to) + '</b>.</p>' +
        '<button type="button" class="btn btn-secondary" id="tp-rename-edit">' + icon('pin') + 'Change it again</button>';
    } else {
      h = '<p class="tp-sub">MT3UK has said you can rename this track. Enter the name and send it. The name only changes once MT3UK has approved it.</p>' +
        '<div class="tp-field"><label for="tp-rename-name">Track name</label><input class="field" id="tp-rename-name" maxlength="60" value="' + esc(s.venue) + '"></div>' +
        '<button type="button" class="btn btn-primary" id="tp-rename-send">' + icon('pin') + 'Send for approval</button>';
    }
    h += '<p class="tp-small tp-err" id="tp-rename-note" role="status"></p>';
    box.innerHTML = h;
    var note = document.getElementById('tp-rename-note'), req = document.getElementById('tp-rename-request'), send = document.getElementById('tp-rename-send'), again = document.getElementById('tp-rename-edit');
    if (req) req.addEventListener('click', function () {
      req.disabled = true;
      var why = document.getElementById('tp-rename-why');
      api('POST', '/track/rename/request', { id: s.id, note: why ? why.value.trim() : '' }).then(function (d) {
        if (!d.success) { req.disabled = false; note.textContent = d.message || 'Could not send that.'; return; }
        drawRename(s, { state: d.state || 'pending', proposal: null });
      }).catch(function () { req.disabled = false; note.textContent = 'Could not reach the server.'; });
    });
    if (again) again.addEventListener('click', function () { drawRename(s, { state: 'granted', proposal: null }); });
    if (send) send.addEventListener('click', function () {
      var name = document.getElementById('tp-rename-name').value.trim();
      if (!name) { note.textContent = 'Enter the track name.'; return; }
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
      add = { car: car, cars: m.cars, lib: r[2], admin: false, rd: restoreSource(src), session: null, type: s.type, startLine: s.startLine || null, finishLine: s.type === 'sprint' ? (s.finishLine || null) : null,
        editLines: true, confirmLines: false, lineEdit: true, organizer: s.organizer || '', ignoreFinish: s.ignoreFinish !== false, finishCross: s.finishCrossing || 0, rollout: !!s.rollout,
        conditions: s.conditions || 'Dry', condTouched: true, privacy: s.privacy, street: false, tyres: s.tyres || '', tyre: tyreInit(s), temp: s.temp, tempSource: s.tempSource || '', weather: s.weather || null,
        notes: s.notes || '', date: s.date, time: s.time, venueName: s.venueId ? '' : s.venue, replaceId: s.id, files: null, list: null,
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
    var base = { frame: [].concat(o.startLine || [], o.finishLine || [], s.startLine || [], sprint ? s.finishLine || [] : []), outline: a.tapOutline.map(function (p) { return [p[0], p[1]]; }) };
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
      go('s=' + a.replaceId);
    }).catch(function (e) { btn.disabled = false; status((e && e.message) || 'Could not send that.', 'error'); });
  }

  // ---------- One session ----------
  var view = null;
  function showSession(id) {
    loading();
    Promise.all([api('GET', '/track/session?id=' + encodeURIComponent(id)), getMine().catch(function () { return null; }), loadTyres(), getLibrary().catch(function () { return null; })]).then(function (r) {
      var d = r[0];
      if (!d.success) return failed('This session isn\'t available. It may be private or removed.');
      if (!d.session.hasSource && d.session.readingsRefused && !d.session.readingsMessage) d.session.readingsMessage = d.session.readingsRefused.message;
      view = { s: d.session, mine: r[1], a: d.session.best || 1, b: null, other: {}, members: [], memberById: {} };
      var timed = (d.session.laps || []).filter(function (l) { return l.kind !== 'short' && l.n !== view.a; }).sort(function (x, y) { return x.time - y.time; });
      view.b = timed[0] ? String(timed[0].n) : null;
      // Other members' best laps at this track, from its leaderboard.
      var bp = d.session.venueId && d.session.layoutId && (d.session.type === 'track' || d.session.type === 'sprint')
        ? (d.session.type === 'sprint' ? '/sprint/board?venue=' : '/track/board?venue=') + encodeURIComponent(d.session.venueId) + '&layout=' + encodeURIComponent(d.session.layoutId) : '';
      var board = bp ? api('GET', bp).catch(function () { return null; }) : Promise.resolve(null);
      return board.then(function (b) {
        var mineIds = {};
        ((view.mine && view.mine.sessions) || []).forEach(function (x) { mineIds[x.id] = 1; });
        view.members = ((b && b.entries) || []).filter(function (e) { return e.sessionId && e.sessionId !== d.session.id && e.carId !== d.session.carId && !mineIds[e.sessionId] && e.time; }).slice(0, 50);
        view.members.forEach(function (e) { view.memberById[e.sessionId] = e; });
        drawSession();
      });
    }).catch(function () { failed('This session could not be loaded. Check your connection and try again.'); });
  }
  function drawSession() {
    var s = view.s;
    // Where it falls among your sessions at this track that day, by time of day.
    var place = s.mine && view.mine ? dayPlace(s, view.mine.sessions) : null;
    var h = (justSaved && s.mine ? savedHtml(justSaved) : '') + back(s.mine ? 'Your sessions' : 'Back', s.mine ? '' : (s.carId ? 'car=' + encodeURIComponent(s.carId) : ''));
    if (s.adminView) h += '<p class="tp-admin-banner" id="tp-admin-banner">' + icon('lock') + 'Admin view, read only. This is a private session and this view is logged. Notes are not shown.</p>';
    h += '<div class="tp-head tp-session-head"><div><h2>' + esc(trackName(s)) + '</h2>' + (s.ownerName ? '<p class="tp-by" id="tp-by">' + icon('user') + '<span>Session by <b>' + esc(s.ownerName) + '</b>' + (s.mine ? ' (you)' : '') + '</span></p>' : '') + '<p class="tp-sub">' + (s.type === 'sprint' ? '<b id="tp-kind">' + (isHillSession(s, library) ? 'Hill climb' : 'Sprint') + '</b> &middot; ' : '') + esc(niceDate(s.date)) + (s.time ? ', ' + esc(s.time) : '') + (place ? ' &middot; <b id="tp-day-place">Session ' + place.n + ' of ' + place.of + ' that day</b>' : '') + (s.car ? ' &middot; ' + esc(s.car) : '') + (s.conditions ? ' &middot; ' + esc(s.conditions) : '') + (s.temp != null ? ', ' + esc(s.temp) + '°C' + (s.tempSource === 'weather' ? ' (Open-Meteo)' : s.tempSource === 'file' ? ' (from file)' : '') : '') + (s.tyres ? ' &middot; ' + esc(s.tyres) : '') + '</p>' + (s.fileName && (s.mine || s.adminView) ? '<p class="tp-small tp-filename" id="tp-filename">' + icon('file') + 'File: ' + esc(s.fileName) + '</p>' : '') + (s.mine || s.adminView ? '<p class="tp-small tp-sid" id="tp-sid">Session ID: <code id="tp-sid-text">' + esc(s.id) + '</code> <button type="button" class="btn btn-ghost btn-sm" id="tp-sid-copy" aria-label="Copy the session ID">' + icon('copy') + '<span>Copy</span></button></p>' : '') + '</div><div class="tp-head-side">' + (s.mine ? privacyPill(s.privacy, s.street) + '<span id="tp-rank-slot"></span>' : '') + unitsChip() + (s.street || s.privacy === 'private' ? '' : shareDot('Share this session')) + '</div></div>';
    LW = s.type === 'sprint' ? 'Run' : 'Lap';
    // Timed with older code and no readings kept to work it out again: only uploading the file again updates it.
    if (s.mine && !s.hasSource && s.type !== 'other' && (s.analysisVersion || 1) < T.ANALYSIS_VERSION) h += '<p class="tp-notice" id="tp-old-version">' + icon('info') + '<span>Timed with an older version. Upload the file again to update the times.</span></p>';
    var untimed = s.type === 'other' && !(s.laps && s.laps.length);
    if (s.type === 'drag') h += dragHtml(s);
    else if (untimed) h += otherHtml(s);
    else if (s.mine && s.reverseRun) h += reverseHtml(s) + trackHtml(s);
    else h += trackHtml(s);
    if (s.mine) h += lineEditHtml(s) + renameHtml(s) + ownerHtml(s);
    justSaved = null;
    app.innerHTML = h;
    if (s.type === 'drag') drawDragCharts(s);
    else if (untimed) drawOtherCharts(s);
    else drawTrackCharts(s);
    // Sprints and hill climbs have runs, not laps.
    if (s.type === 'sprint') runWords(app);
    if (s.mine) wireOwner(s);
    var sidBtn = document.getElementById('tp-sid-copy');
    if (sidBtn) sidBtn.addEventListener('click', function () { copyText(s.id, sidBtn); });
    if (s.mine) wireLineEdit(s);
    if (s.mine) wireRename(s);
    if (s.mine && !s.hasSource) wireReadingsAgain();
    if (!s.street && s.privacy !== 'private') {
      var what = s.type === 'drag' ? 'Drag run' : s.type === 'sprint' ? (isHillSession(s, library) ? 'Hill climb run' : 'Sprint run') : 'Track session', res = sessionResult(s);
      wireShare({ url: SITE_URL + 'track.html?s=' + encodeURIComponent(s.id), heading: 'Share this session', subject: trackName(s) + ' | MT3UK', campaign: 'track_session',
        text: what + ' at ' + trackName(s) + (res ? ', ' + res + ',' : '') + ' on MT3UK' });
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
    return '<div class="tp-notice is-warn" id="tp-reverse">' + icon('warn') + '<div><b>The start and finish may be the wrong way round.</b><br>This is timed at up to ' + esc(V.fmtV(r.fwdPeak)) + ', but a faster pass (up to ' + esc(V.fmtV(r.peak)) + ', ' + esc(V.fmtLap(r.time)) + ') crosses the two lines the other way. If that is the ' + (isHillSession(s, library) ? 'climb' : 'run') + ', the start line should be where you set off and the finish where you stopped.</div></div>';
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
      ((c.empty || []).length ? ' In the file but empty: ' + esc((c.empty || []).join(', ').toLowerCase()) + '.' : '') + '</p></details>';
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
      var vs = best && sel.n !== best.n ? '+' + (sel.time - best.time).toFixed(3) + ' s on your best ' + LWd.toLowerCase() : sel.n === s.best ? 'Your best ' + LWd.toLowerCase() : '';
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
    var lapsHtml = '<details class="card tp-laps" id="tp-laps"' + (lapsOpen ? ' open' : '') + '><summary><h3>Laps</h3><span class="tp-small">' + laps.length + ' ' + (laps.length === 1 ? 'lap' : 'laps') + (best ? ', best ' + V.fmtLap(best.time) : '') + '</span>' + icon('chev') + '</summary><div class="tp-scroll"><table class="tp-table">' + lapTable(s) + '</table></div>' +
      (s.sectorsByThirds ? '<p class="tp-small">Sectors are thirds of the lap until this track has its own sector points.</p>' : '') + '</details>';
    var spottedHtml = '<div class="tp-section"><h3>What we spotted</h3><div class="tp-notes">' + notesHtml(T.sessionNotes(s, V.fmtV, V.fmtD)) + '</div></div>';
    // One map: Compare laps' "Where you are", straight after the tiles.
    if (s.trace && s.trace.laps && Object.keys(s.trace.laps).length) {
      h += '<div class="tp-section" id="compare"><div class="tp-head"><h2>Compare laps</h2></div><p class="tp-sub">Pick two laps. Press Play, or move along a chart, to see where both are at the same moment. The slower lap trails by the time gap.</p>' +
        '<div class="card tp-cmp-pick"><div class="tp-f2"><div class="tp-field"><label for="tp-cmp-a">Lap A</label><select class="field" id="tp-cmp-a">' + lapOptions(view.a) + '</select></div><div class="tp-field"><label for="tp-cmp-b">Lap B</label><select class="field" id="tp-cmp-b">' + lapOptions(view.b) + '</select></div></div></div>' +
        '<div class="tp-grid tp-g-map"><div class="tp-grid"><div class="card tp-o-speed"><div class="tp-chart-head"><h3>Speed through the lap</h3><div class="tp-key" id="tp-key"></div></div><svg class="tv-chart" id="tp-speed" role="img" aria-label="Speed against distance for both laps"></svg>' +
        '<div class="tp-chart-head"><h3>Time gap</h3><span class="tp-small" id="tp-gap-cap"></span></div><svg class="tv-chart" id="tp-delta" role="img" aria-label="Running time gap between the laps"></svg></div>' +
        '<div class="card tp-o-corner"><h3>Corner by corner</h3><div class="tp-scroll"><table class="tp-table" id="tp-corners"></table></div></div></div>' +
        '<div class="tp-grid"><div class="card tp-mapcard" id="tp-mapcard"><div class="tp-chart-head tp-map-head"><h3>Where you are</h3><button type="button" class="tp-switch tp-gswitch tp-speedsw" role="switch" id="tp-speedcol" aria-checked="' + cmpSpeed + '"><span>Colour by speed</span><span class="tp-track"></span></button><button type="button" class="tp-rotate-hint" id="tp-rotate-hint" aria-label="Turn the screen sideways for a bigger map" title="Turn the screen sideways for a bigger map">' + icon('rotate') + '</button><button type="button" class="btn btn-secondary btn-sm" id="tp-full" aria-label="Full screen map"></button></div>' +
        '<p class="tp-small tp-sync-note">Both laps at the same moment: the slower one trails by the time gap.</p>' +
        '<div class="tp-play" id="tp-play"><div class="tp-pn-grip" id="tp-pn-grip" role="separator" aria-label="Drag to move the controls" title="Drag to move the controls"><i></i><i></i><i></i></div><div class="tp-play-row"><div class="tp-play-btns"><button type="button" class="btn btn-secondary" id="tp-play-start" data-play="start" aria-label="Go back to the start"></button><button type="button" class="btn btn-secondary" id="tp-play-back" data-play="back"></button><button type="button" class="btn btn-primary" id="tp-play-toggle" data-play="toggle"></button></div><div class="tp-when" id="tp-when" aria-live="off"></div>' +
        '<div class="tp-chips" id="tp-speeds" role="group" aria-label="Playback speed">' + [['0.25', 'x0.25'], ['0.5', 'x0.5'], ['1', 'x1'], ['2', 'x2'], ['5', 'x5']].map(function (v) { return '<button type="button" class="chip" data-speed="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>' +
        '<button type="button" class="chip is-on" id="tp-follow" aria-pressed="true" title="When the map is zoomed in, keep the cars in view">Follow cars</button></div>' +
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
        '<p class="tp-small" id="tp-gnote"></p></div></div>' +
        '</div></div>' +
        '<div class="tp-grid tp-g2"><div class="card"><div class="tp-chart-head"><h3>How much grip you used, lap A' + (s.gDerived ? ' (estimated)' : '') + '</h3><span class="tp-small">Each dot is a moment on the lap. The further from the middle, the harder the car was working the tyres.</span></div><svg class="tv-chart tp-gg" id="tp-gg" role="img" aria-label="Sideways against lengthways g for lap A"></svg></div><div class="tp-notes" id="tp-cmp-notes"></div></div></div>';
    }
    h += lapsHtml + spottedHtml;
    if (s.mine && s.venueId && s.layoutId) h += '<div class="tp-section" id="over-time"><div class="tp-head"><h2>' + esc(trackName(s)) + ' over time</h2></div><div id="tp-time"></div></div>';
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
      var gap = best && l.n !== best.n && l.kind !== 'short' ? '+' + (l.time - best.time).toFixed(3) : '';
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
    if (sa) {
      sa.addEventListener('change', function () { view.a = sa.value; drawCompare(s); });
      sb.addEventListener('change', function () { view.b = sb.value; drawCompare(s); });
      drawCompare(s);
    }
    if (s.mine) drawOverTime(s);
  }
  // How the two laps are lined up on the "Where you are" map.
  // What the G-force charts show (key, label). Each measure switched on gets a chart of its own, stacked, with lap A
  // in its blue and lap B in its orange, as on the map, so colour always means the car. Each session opens showing
  // one, cornering; more can be switched on with the chips.
  var G_DEFS = [['acc', 'Acceleration G'], ['cor', 'Cornering G'], ['spd', 'Speed']];
  var gShow = { acc: false, cor: true, spd: false }, gShowFor = null;
  function gReset(id) { if (gShowFor !== id) { gShow = { acc: false, cor: true, spd: false }; gShowFor = id; } }

  // The whole G-force and speed chart can be hidden (remembered in this browser).
  var gHidden = false;
  try { gHidden = localStorage.getItem('mt3ukTrackChart') === 'off'; } catch (e) { /* storage blocked */ }
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
      var mo = V.map(mapEl, A.trace, { fill: fill, mono: true, lines: lines, band: band, full: { on: function () { return cmpFull; }, toggle: function () { setFull(!cmpFull); }, state: function () { return null; } }, startLine: startLineXY(s), finishLine: s.type === 'sprint' ? startLineXY(s, s.finishLine) : null, corners: s.corners, origin: s.origin });
      var lo = document.getElementById('tp-ramp-lo'), hi = document.getElementById('tp-ramp-hi');
      if (mo && lo && hi) { lo.textContent = V.fmtV(mo.vmin); hi.textContent = V.fmtV(mo.vmax); }
      cmpMap = mo;
      if (zoomed && mo && mo.zoom && mo.zoom.restore && zoomed.k > 1.01) mo.zoom.restore(zoomed);
      if (mo && mo.setFollow) mo.setFollow(cmpFollow);
      if (mo && mo.zoom && mo.zoom.onPan) mo.zoom.onPan(function () { if (cmpFollow) setFollow(false); });
      // Smoothed G-force rows [distance, acceleration, cornering] for each lap.
      function smoothG(trace) {
        return trace.map(function (p, i) {
          var n = 0, ac = 0, co = 0;
          // Cornering keeps its sign, one way positive and the other negative, as RaceBox draws it.
          for (var k = Math.max(0, i - 2); k <= Math.min(trace.length - 1, i + 2); k++) { ac += trace[k][6]; co += trace[k][5]; n++; }
          return [p[0], ac / n, co / n];
        });
      }
      var ga = smoothG(A.trace), gb = A === B ? ga : smoothG(B.trace);
      var fmtAcc = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + ' g'; }, fmtCor = fmtAcc;
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
        var ra = at(ga, pa[0]), rb = at(gb, pb[0]);
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
        var ra = at(gaT, x), rb = at(gbT, x), h = '<b>' + clock(x) + '</b>';
        if (gShow.acc) h += V.row('Accel, A', fmtAcc(ra[1]), c1) + (A === B ? '' : V.row('Accel, B', fmtAcc(rb[1]), c2));
        if (gShow.cor) h += V.row('Corner, A', fmtCor(ra[2]), c1) + (A === B ? '' : V.row('Corner, B', fmtCor(rb[2]), c2));
        if (gShow.spd) h += V.row('Speed, A', V.fmtV(at(spA, x)[1]), c1) + (A === B ? '' : V.row('Speed, B', V.fmtV(at(spB, x)[1]), c2));
        return h;
      }
      // The charts: one for each measure switched on, stacked on a shared time axis, lap A in blue and lap B in
      // orange. Moving over any of them moves the cursor on all, and playback with it.
      // The G-force and speed chart runs on time, like playback and the map: at
      // any point it shows both laps at the same moment, and its time axis is
      // the ruler for the slider underneath.
      function onTime(trace, rows) { return trace.map(function (p, i) { return [p[1], rows[i][1], rows[i][2]]; }); }
      var gaT = onTime(A.trace, ga), gbT = A === B ? gaT : onTime(B.trace, gb);
      var spA = A.trace.map(function (p) { return [p[1], V.spd(p[4])]; }), spB = A === B ? spA : B.trace.map(function (p) { return [p[1], V.spd(p[4])]; });
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
      function drawG() {
        var box = document.getElementById('tp-gforce'), note = document.getElementById('tp-gnote');
        if (!box) return;
        var defs = G_DEFS.filter(function (d) { return gShow[d[0]]; });
        if (note) note.textContent = !defs.length ? 'Turn a line on to see it.' : A === B ? A.label : 'Blue: ' + A.label + ' (A). Orange: ' + B.label + ' (B).';
        box.innerHTML = '';
        gls = [];
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
        var Hn = Math.floor((H * defs.length - 20) / defs.length);
        defs.forEach(function (d, di) {
          var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'tv-chart tp-gchart');
          svg.setAttribute('data-g', d[0]);
          svg.setAttribute('role', 'img');
          svg.setAttribute('aria-label', d[1] + ' over the lap for both laps');
          box.appendChild(svg);
          var series = [], gy, tip;
          if (d[0] === 'spd') {
            gy = V.nice(0, vmax, 4);
            [spA, spB].forEach(function (lp, li) {
              if (li && A === B) return;
              series.push({ color: li ? c2 : c1, width: 1.5, pts: lp, at: function (x) { return at(lp, x)[1]; } });
            });
            tip = function (x) { return '<b>' + clock(x) + '</b>' + V.row('Speed, A', V.fmtV(at(spA, x)[1]), c1) + (A === B ? '' : V.row('Speed, B', V.fmtV(at(spB, x)[1]), c2)); };
          } else {
            var col = d[0] === 'acc' ? 1 : 2, lo = 0, hi = 0.5, fmt = col === 1 ? fmtAcc : fmtCor, word = col === 1 ? 'Accel' : 'Corner';
            [gaT, gbT].forEach(function (lp, li) {
              if (li && A === B) return;
              lp.forEach(function (r) { lo = Math.min(lo, r[col]); hi = Math.max(hi, r[col]); });
              series.push({ color: li ? c2 : c1, width: 1.5, pts: lp.map(function (r) { return [r[0], r[col]]; }), at: function (x) { return at(lp, x)[col]; } });
            });
            // The g scale is even about zero, so a corner one way is drawn as big as the same corner the other way.
            var gm = Math.ceil(Math.max(-lo, hi) * 2) / 2;
            gy = V.nice(-gm, gm, defs.length === 1 ? 4 : 2);
            tip = function (x) { return '<b>' + clock(x) + '</b>' + V.row(word + ', A', fmt(at(gaT, x)[col]), c1) + (A === B ? '' : V.row(word + ', B', fmt(at(gbT, x)[col]), c2)); };
          }
          var spd = d[0] === 'spd';
          gls.push(V.line(svg, {
            // The time labels sit under the last chart only; the ones above share its axis.
            H: defs.length > 1 ? (di === defs.length - 1 ? Hn + 20 : Hn) : H, top: defs.length > 1 ? 18 : undefined, bottom: di === defs.length - 1 ? undefined : 8, x0: 0, x1: tEndG, y0: gy[0], y1: gy[gy.length - 1], xt: di === defs.length - 1 ? xt : [], xf: mss, yt: gy, zero: spd ? null : 0, yf: function (v) { return spd ? String(v) : v + ' g'; },
            // Moving over a chart moves playback to that moment, slider, cursors and all.
            series: series, tip: tip, onMove: function (t) { stopPlay(); pb.active = true; pb.t = t; renderAt(t); }, onLeave: leave
          }));
          // With more than one chart showing, each is named in its top left corner, so it is clear which is which.
          if (defs.length > 1) {
            var ttl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            ttl.setAttribute('class', 'tp-gtitle'); ttl.setAttribute('x', 48); ttl.setAttribute('y', 13);
            ttl.textContent = d[1];
            svg.appendChild(ttl);
          }
        });
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
    var head = '<div class="card tp-impact" id="tp-impact"><div class="tp-chart-head"><h3>What each mod did</h3></div>';
    if (!mods.length) return head + '<p class="tp-small">Add when you fitted your wheels, tyres, suspension, brakes, aero and performance parts on your build (the Fitted date) and this compares your best dry time here before and after each one.</p></div>';
    var r = T.modImpact(list.map(function (o) { return { id: o.id, date: o.date, bestTime: o.bestTime, conditions: o.conditions, temp: o.temp, tyres: o.tyres }; }), mods);
    var h = head;
    if (!r.rows.length) h += '<p class="tp-small">Not enough yet. A part needs a dry session here before it was fitted and another after.</p>';
    else h += '<div class="tp-scroll"><table class="tp-table tp-impact-table"><thead><tr><th>Part</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>' + r.rows.map(function (x) {
      var better = x.change < 0, same = Math.abs(x.change) < 0.005;
      return '<tr><td>' + x.labels.map(esc).join('<br>') + (x.labels.length > 1 ? '<small>Fitted together, so the change is for all of them</small>' : '') + (x.flags.length ? '<small>' + x.flags.map(esc).join(', ') + '</small>' : '') + '</td>' +
        '<td>' + V.fmtLap(x.before) + '<small>' + esc(niceDate(x.beforeDate)) + '</small></td><td>' + V.fmtLap(x.after) + '<small>' + esc(niceDate(x.afterDate)) + '</small></td>' +
        '<td class="' + (same ? '' : better ? 'is-fast' : 'is-slow') + '">' + (same ? 'No change' : (better ? '' : '+') + x.change.toFixed(3) + ' s') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    if (r.skipped.length) h += '<p class="tp-small">Not compared (' + r.skipped.map(function (x) { return esc(x.labels.join(', ') + ': ' + x.why); }).join('; ') + ').</p>';
    return h + '<p class="tp-small">Your best dry time before and after each part, at this track. Weather, tyres and driving change between days, so treat it as a guide.</p></div>';
  }
  function drawOverTime(s) {
    var box = document.getElementById('tp-time');
    if (!box || !view.mine) return;
    var list = view.mine.sessions.filter(function (o) { return o.carId === s.carId && o.type === s.type && o.venueId === s.venueId && o.layoutId === s.layoutId && o.bestTime; });
    if (list.length < 2) { box.innerHTML = '<div class="card tp-empty">' + icon('up') + '<p>Add another session here to see your times over time, with the mods you fitted in between marked from My Garage.</p></div>'; return; }
    var dates = list.map(function (o) { return o.date.slice(0, 7); }).sort();
    var mods = carMods(s.carId).filter(function (m) { return m.date >= dates[0].slice(0, 7) && m.date <= dates[dates.length - 1]; });
    box.innerHTML = '<div class="card"><div class="tp-chart-head"><h3>Best lap per session</h3><div class="tp-key"><span><i style="background:' + RUN_COLORS[0] + '"></i>Dry</span><span><i class="is-ring"></i>Wet or damp (left out of the trend)</span><span class="is-mod"><i class="is-dash"></i>Mod fitted</span></div></div><svg class="tv-chart" id="tp-timeline" role="img" aria-label="Best lap at this track for each session, faster is higher"></svg><p class="tp-small">Higher up is faster. Tap a point to open that session.</p></div>' +
      '<div class="tp-grid tp-g2"><div class="tp-notes">' + notesHtml(T.trendNotes(list.map(function (o) { return { date: o.date, bestTime: o.bestTime, conditions: o.conditions || 'Dry', tyres: o.tyres, temp: o.temp }; }), mods)) + '</div>' +
      '<div class="card"><h3>Sessions</h3><div class="tp-scroll"><table class="tp-table"><thead><tr><th>Date</th><th>Best</th><th>Change</th><th>Conditions</th></tr></thead><tbody>' +
      list.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (o, i, arr) {
        var prev = arr.slice(0, i).filter(function (p) { return (p.conditions || 'Dry') === 'Dry'; }).pop();
        var ch = (o.conditions || 'Dry') === 'Dry' && prev ? o.bestTime - prev.bestTime : null;
        return '<tr' + (o.id === s.id ? ' class="is-best"' : '') + '><td><a href="track.html?s=' + esc(o.id) + '" data-go="s=' + esc(o.id) + '">' + esc(niceDate(o.date)) + '</a></td><td>' + V.fmtLap(o.bestTime) + '</td><td>' + (ch === null ? '' : (ch > 0 ? '+' : '') + ch.toFixed(2)) + '</td><td>' + esc(o.conditions || '') + (o.temp != null ? ', ' + o.temp + '°C' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>';
    box.insertAdjacentHTML('beforeend', impactHtml(list, s));
    V.timeline(document.getElementById('tp-timeline'), list.map(function (o) {
      return { date: o.date, time: o.bestTime, wet: (o.conditions || 'Dry') !== 'Dry', mine: o.id === s.id, label: niceDate(o.date), conditions: o.conditions, temp: o.temp, onClick: function () { go('s=' + o.id); } };
    }), mods);
  }

  function dragHtml(s) {
    var runs = s.runs || [];
    var bq = runs.filter(function (r) { return r.quarter; }).sort(function (a, b) { return a.quarter - b.quarter; })[0];
    var b60 = runs.slice().sort(function (a, b) { return a.s60 - b.s60; })[0];
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
    h += '<div class="tp-grid tp-g-map"><div class="card"><div class="tp-chart-head"><h3>Speed off the line</h3><div class="tp-key">' + runs.slice(0, 8).map(function (r, i) { return '<span><i style="background:' + RUN_COLORS[i] + '"></i>Run ' + (i + 1) + '</span>'; }).join('') + '</div></div><svg class="tv-chart" id="tp-drag" role="img" aria-label="Speed against time for each run"></svg></div>' +
      '<div class="card"><h3>Runs</h3><div class="tp-scroll"><table class="tp-table"><thead><tr><th>Run</th><th>60 ft</th><th>0-30</th><th>0-60</th><th>60-100</th><th>1/8</th><th>1/4</th><th>Trap</th></tr></thead><tbody>' +
      runs.map(function (r, i) { function f(v) { return v ? v.toFixed(2) : '-'; } return '<tr' + (r === bq ? ' class="is-best"' : '') + '><td>' + (i + 1) + '</td><td>' + f(r.ft60) + '</td><td>' + f(r.s30) + '</td><td>' + f(r.s60) + '</td><td>' + f(r.s60to100) + '</td><td>' + f(r.eighth) + '</td><td>' + f(r.quarter) + '</td><td>' + (r.quarterSpeed ? Math.round(V.spd(r.quarterSpeed)) : '-') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="tp-small">' + (s.rollout ? 'Timed with a 1 ft rollout: the clock starts just after the car begins to move, as RaceBox\'s rollout option does. Worked out from GPS speed.' : 'Times from the first movement, worked out from GPS speed. Strip timing lights and RaceBox\'s rollout option start the clock after about a foot of movement, so their times are usually a little quicker.') + '</p></div></div>';
    h += '<div class="tp-section"><h3>What we spotted</h3><div class="tp-notes">' + notesHtml(T.sessionNotes(s, V.fmtV, V.fmtD)) + '</div></div>';
    return h;
  }
  function drawDragCharts(s) {
    var svg = document.getElementById('tp-drag');
    if (svg && (s.runs || []).length) V.drag(svg, s.runs.slice(0, 8), RUN_COLORS);
    if (s.street && (s.outline || (s.trace && s.trace.outline) || []).length > 1 && document.getElementById('tp-map')) drawOtherCharts(s);
  }

  function ownerHtml(s) {
    var limit = s.street ? 'street' : (s.type === 'drag' ? (s.atVenue ? '' : 'noboard') : (s.venueId && s.layoutId ? '' : 'noboard'));
    var typeBox = s.street ? '' : s.hasSource
      ? '<div class="tp-field"><span class="tp-lbl">Type</span><div class="tp-chips" data-retype>' + typeChips(s, isHillSession(s, library)) + '</div><p class="tp-small">Picked the wrong one? Choose another and we\'ll read your saved readings again as that type.</p></div>'
      : '<p class="tp-src">' + icon('info') + '<span>This session was saved before we kept the readings (or they could not be kept), so its type can\'t be changed.' + (s.readingsMessage ? ' Reason: ' + esc(String(s.readingsMessage)) : '') + ' Add the readings again, or add the file again as a new session.</span></p>' + (readingsSending[s.id] ? '' : readingsAgainHtml());
    // Saved as several files merged into one: offer one session per file.
    var splitBox = s.hasSource && !s.street && (s.type === 'track' || s.type === 'sprint') && typeof s.runs === 'number' && s.runs > 1
      ? '<div class="tp-field"><span class="tp-lbl">Several files</span><p class="tp-src">' + icon('info') + '<span>This is ' + s.runs + ' files merged into one session. Split it to get one session for each file, grouped by day.</span></p><button type="button" class="btn btn-secondary btn-sm" id="tp-e-split">Split into ' + s.runs + ' sessions</button></div>' : '';
    return '<div class="tp-section" id="settings"><div class="tp-head"><h2>Session settings</h2></div><div class="card tp-fields">' + typeBox + splitBox +
      '<div class="tp-field"><span class="tp-lbl">Who can see it</span><div class="tp-privacy" data-privacy>' + privacyOptions(s.privacy, limit) + '</div></div>' +
      '<div class="tp-field"><span class="tp-lbl">Conditions</span><div class="tp-chips" data-cond>' + ['Dry', 'Damp', 'Wet'].map(function (c) { return '<button type="button" class="chip' + (s.conditions === c ? ' is-on' : '') + '" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div></div>' +
      tyreFields('tp-e-tyre', tyreInit(s)) +
      '<div class="tp-field"><label for="tp-e-temp">Air temperature (°C)</label><input class="field" id="tp-e-temp" inputmode="numeric" value="' + esc(s.temp == null ? '' : s.temp) + '"></div>' +
      '<div class="tp-weather-row"><button type="button" class="btn btn-secondary btn-sm" id="tp-e-weather">Fill in from weather</button><p class="tp-src" id="tp-e-src">' + (s.tempSource === 'weather' && s.weather ? icon('info') + '<span>' + weatherNote(s.weather, s.venue) + '</span>' : s.tempSource === 'file' ? icon('info') + '<span>From the air temperature recorded in your file.</span>' : '') + '</p></div>' +
      '<div class="tp-field"><label for="tp-e-notes">Notes (only you see these)</label><input class="field" id="tp-e-notes" value="' + esc(s.notes || '') + '"></div>' +
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
  function wireOwner(s) {
    var edit = { privacy: s.privacy, conditions: s.conditions, tempSource: s.tempSource || '', weather: s.weather || null, temp: s.temp };
    wireTyres('tp-e-tyre');
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
    // Back to Your sessions, as the Back link does.
    function closeSession() { go(''); }
    function saveSettings() {
      var t = document.getElementById('tp-e-temp').value.trim();
      var ty = tyrePayload(readTyre('tp-e-tyre'));
      api('PUT', '/track/session', Object.assign({ id: s.id, privacy: edit.privacy, conditions: edit.conditions || '' }, ty, { temp: t === '' ? null : parseFloat(t), tempSource: t === '' ? '' : (edit.tempSource || 'member'), weather: edit.tempSource === 'weather' ? edit.weather : null, notes: document.getElementById('tp-e-notes').value })).then(function (d) {
        if (!d.success) { status(d.message || 'Could not save.', 'error'); return; }
        mine = null; counts = null;
        Object.assign(view.s, { privacy: d.session.privacy, conditions: d.session.conditions, tyres: d.session.tyres, tyreMake: d.session.tyreMake, tyreModel: d.session.tyreModel, tyreWidth: d.session.tyreWidth, tyreProfile: d.session.tyreProfile, tyreRim: d.session.tyreRim, temp: d.session.temp, tempSource: d.session.tempSource, weather: d.session.weather, notes: document.getElementById('tp-e-notes').value });
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
        go('');
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
      var settings = { conditions: s.conditions || '', tyres: s.tyres || '', tyre: tyreInit(s), temp: s.temp, tempSource: s.tempSource || '', weather: s.weather || null, notes: s.notes || '', privacy: s.privacy, venueName: s.venueId ? '' : s.venue, street: false };
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
        return api('DELETE', '/track/session?id=' + encodeURIComponent(s.id)).then(function () { return made.length; });
      });
    }).then(function (n) {
      mine = null; counts = null;
      justSaved = { batch: n, split: true, skipped: [] };
      go('');
    }).catch(function (e) {
      btn.disabled = false;
      status((e && e.message) || 'Could not split the session.', 'error');
    });
  }

  // ---------- A build's shared sessions ----------
  function showCar(carId) {
    loading();
    api('GET', '/track/public?car=' + encodeURIComponent(carId)).then(function (d) {
      if (!d.success) return failed('That build could not be found.');
      var c = d.car;
      var h = back('Track sessions', '') + '<div class="tp-head"><div><h2>' + esc(c.name || 'MT3UK build') + '</h2><p class="tp-sub">' + esc([c.owner, [c.year, c.model, c.version].filter(Boolean).join(' ')].filter(Boolean).join(' · ')) + '</p></div>' + '<div class="tp-head-side">' + unitsChip() + shareDot('Share this build') + '</div></div>';
      if (d.mine) h += '<p class="tp-sub">This is what other members see. Only sessions you share show here.</p>';
      h += d.sessions.length ? '<div class="tp-list">' + sessionListHtml(d.sessions) + '</div>' : '<div class="card tp-empty">' + icon('flag') + '<p>No shared sessions yet.</p></div>';
      h += '<p class="tp-sub"><a href="gallery.html" class="tp-link">See the build in the Gallery' + icon('chev') + '</a></p>';
      app.innerHTML = h;
      wireShare({ url: SITE_URL + 'track.html?car=' + encodeURIComponent(carId), heading: 'Share this build', subject: (c.name || 'MT3UK build') + ' | MT3UK', campaign: 'track_build',
        text: (c.name || 'This MT3UK build') + '’s track sessions on MT3UK' });
    }).catch(function () { failed('That build could not be loaded.'); });
  }

  route();
})();
