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
  var MODELS = ['Model 3', 'Model Y', 'Model S', 'Model X'];
  var ICON = {
    upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    flag: '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>',
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
    pin: '<path d="M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/>'
  };
  function icon(n) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function token() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; } }
  function api(method, path, body) {
    var opts = { method: method, headers: {}, cache: 'no-store' };
    if (token()) opts.headers['X-Session-Token'] = token();
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (r) {
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
  function getMine() {
    if (mine) return Promise.resolve(mine);
    if (!token()) return Promise.resolve(null);
    return Promise.all([api('GET', '/my-builds'), api('GET', '/track/sessions')]).then(function (r) {
      if (r[0].status === 401) return null;
      mine = { cars: (r[0].cars || []), sessions: r[1].sessions || [] };
      return mine;
    });
  }

  // ---------- Routing ----------
  function params() { return new URL(location.href).searchParams; }
  function go(q) {
    history.pushState(null, '', 'track.html' + (q ? '?' + q : ''));
    route();
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', route);
  app.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-go]');
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('data-go')); }
  });
  function route() {
    V.hideTip();
    var p = params();
    if (p.get('s')) return showSession(p.get('s'));
    if (p.get('add')) return showAdd(p.get('car'));
    if (p.get('board')) return showBoard(p.get('board').split(':')[0], p.get('board').split(':')[1] || '', false);
    if (p.get('drag')) return showBoard(p.get('drag'), '', true);
    if (p.get('boards')) return showBoards();
    if (p.get('car')) return showCar(p.get('car'));
    return showHome();
  }
  function loading(msg) { app.innerHTML = '<div class="tp-loading" role="status">' + esc(msg || 'Loading...') + '</div>'; }
  function failed(msg) { app.innerHTML = '<div class="card tp-empty">' + icon('warn') + '<p>' + esc(msg) + '</p><a class="btn btn-secondary btn-sm" href="track.html" data-go="">Back to Track sessions</a></div>'; }
  function back(label, q) { return '<a class="tp-back" href="track.html' + (q ? '?' + q : '') + '" data-go="' + esc(q || '') + '">' + icon('back') + esc(label) + '</a>'; }
  function niceDate(d) { return T.niceDate(d); }
  function trackName(s) { return s.venue + (s.layout && s.layout !== s.venue ? ', ' + s.layout : ''); }
  function privacyPill(p, street) {
    if (street) return '<span class="tp-pill tp-pill-admin">' + icon('shield') + 'Street run, admin only</span>';
    if (p === 'board' || p === 'build') return '<span class="tp-pill">' + icon('eye') + 'Shared</span>';
    return '<span class="tp-pill">' + icon('lock') + 'Only me</span>';
  }
  function sessionResult(s) {
    if (s.type === 'drag') return s.quarter ? s.quarter.toFixed(2) + ' s, 1/4 mile' : s.s60 ? s.s60.toFixed(2) + ' s, 0 to 60 mph' : (s.runs || 0) + ' runs';
    return s.bestTime ? V.fmtLap(s.bestTime) : (s.laps || 0) + ' laps';
  }
  function notesHtml(list) {
    return list.map(function (n) {
      return '<div class="tp-note">' + icon(n.icon || 'info') + '<div><p>' + esc(n.text) + '</p>' + (n.small ? '<small>' + esc(n.small) + '</small>' : '') + '</div></div>';
    }).join('');
  }
  function unitsChip() { return '<button type="button" class="chip tp-units" data-units>' + (V.units.mph ? 'mph' : 'km/h') + '</button>'; }
  app.addEventListener('click', function (e) {
    if (e.target.closest('[data-units]')) { V.setMph(!V.units.mph); route(); }
  });

  // ---------- Home ----------
  function showHome() {
    loading();
    Promise.all([getMine(), getLibrary(), getCounts()]).then(function (r) {
      var m = r[0];
      var h = '';
      if (!m) {
        h += '<div class="card tp-intro"><h2>Your track days, mapped</h2><p>Upload the file from your lap timer (RaceBox, VBOX, Harry\'s LapTimer, TrackAddict, AiM and most phone apps) and see every lap drawn on the track, where you gained and lost time, and how your times changed as you modified the car.</p>' +
          '<ul class="tp-ticks"><li>' + icon('check') + 'Laps, sectors and corners found for you</li><li>' + icon('check') + 'Compare any two laps, corner by corner</li><li>' + icon('check') + 'See what each mod in My Garage did to your times</li><li>' + icon('check') + 'Drag runs from the strip: 60 ft, 0 to 60, quarter mile</li><li>' + icon('check') + 'Private unless you choose to share</li></ul>' +
          '<div class="tp-actions"><a class="btn btn-accent" href="signin.html?next=/track.html">Sign in to add a session</a><a class="btn btn-secondary" id="tp-boards-btn" href="track.html?boards=1" data-go="boards=1">' + icon('trophy') + 'Leaderboards</a></div></div>';
      } else if (!m.cars.length) {
        h += '<div class="card tp-intro"><h2>Add your car first</h2><p>Sessions belong to a car, so the times can be matched to its mods. Add your car with a photo in My Garage, then come back here.</p><a class="btn btn-accent" href="my-builds.html">Go to My Garage</a></div>';
      } else {
        h += myCarsHtml(m);
      }
      h += '<div class="tp-section"><div class="tp-head"><h2>Leaderboards</h2><a href="track.html?boards=1" data-go="boards=1" class="tp-link">All tracks' + icon('chev') + '</a></div>' + boardsListHtml(r[1], true, r[2]) + '</div>';
      app.innerHTML = h;
      wireCarChips(m);
    }).catch(function () { failed('Track sessions could not be loaded. Check your connection and try again.'); });
  }
  var currentCar = null;
  function myCarsHtml(m) {
    try { currentCar = currentCar || params().get('mycar') || localStorage.getItem('mt3ukTrackCar'); } catch (e) {}
    if (!m.cars.some(function (c) { return c.id === currentCar; })) currentCar = m.cars[0].id;
    var car = m.cars.filter(function (c) { return c.id === currentCar; })[0];
    var list = m.sessions.filter(function (s) { return s.carId === car.id; });
    var h = '<div class="tp-section"><div class="tp-head"><h2>Your sessions</h2>' + unitsChip() + '</div>';
    if (m.cars.length > 1) h += '<div class="tp-chips" id="tp-cars">' + m.cars.map(function (c) { return '<button type="button" class="chip' + (c.id === car.id ? ' is-on' : '') + '" data-car="' + esc(c.id) + '">' + esc(c.name) + '</button>'; }).join('') + '</div>';
    h += '<div class="tp-actions"><a class="btn btn-accent" href="track.html?add=1&car=' + encodeURIComponent(car.id) + '" data-go="add=1&car=' + esc(encodeURIComponent(car.id)) + '">' + icon('upload') + 'Add a session</a>' +
      '<a class="btn btn-secondary" id="tp-boards-btn" href="track.html?boards=1" data-go="boards=1">' + icon('trophy') + 'Leaderboards</a>' +
      (car.virtual ? '' : '<a class="btn btn-secondary" href="track.html?car=' + encodeURIComponent(car.id) + '" data-go="car=' + esc(encodeURIComponent(car.id)) + '">What others see</a>') + '</div>';
    if (!list.length) h += '<div class="card tp-empty">' + icon('flag') + '<p>No sessions for ' + esc(car.name) + ' yet. Add the file from your lap timer to get started.</p></div>';
    else h += '<div class="tp-list">' + list.map(sessionRow).join('') + '</div>';
    return h + '</div>';
  }
  function sessionRow(s) {
    return '<a class="tp-row" href="track.html?s=' + esc(s.id) + '" data-go="s=' + esc(s.id) + '"><span class="tp-row-main"><b>' + esc(trackName(s)) + '</b><span>' + esc(niceDate(s.date)) + (s.conditions ? ', ' + esc(s.conditions) : '') + (s.type === 'drag' ? ', drag' : '') + '</span></span>' +
      '<span class="tp-row-res">' + esc(sessionResult(s)) + '</span>' + (s.privacy !== undefined ? privacyPill(s.privacy, s.street) : '') + icon('chev') + '</a>';
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
  // How many shared sessions each leaderboard has (one worker call).
  var counts = null;
  function getCounts() {
    if (counts) return Promise.resolve(counts);
    return api('GET', '/track/counts').then(function (d) { counts = d.counts || {}; return counts; }).catch(function () { return {}; });
  }
  function countChip(q, label, n) {
    return '<a class="chip' + (n ? ' is-busy' : '') + '" href="track.html?' + q + '" data-go="' + esc(q) + '">' + esc(label) +
      (n ? '<span class="tp-count" aria-label="' + n + ' session' + (n === 1 ? '' : 's') + '">' + n + '</span>' : '') + '</a>';
  }
  // Tracks with sessions first, busiest first, each layout with its count.
  function boardsListHtml(lib, short, c) {
    c = c || {};
    var circuits = lib.venues.filter(function (v) { return v.type === 'circuit' && (v.layouts || []).length; }).map(function (v, i) {
      var total = v.layouts.reduce(function (t, l) { return t + (c['track-board:' + v.id + ':' + l.id] || 0); }, 0);
      return { v: v, total: total, i: i };
    }).sort(function (a, b) { return b.total - a.total || a.i - b.i; });
    var strips = lib.venues.filter(function (v) { return v.type === 'drag'; }).map(function (v, i) { return { v: v, n: c['drag-board:' + v.id] || 0, i: i }; })
      .sort(function (a, b) { return b.n - a.n || a.i - b.i; });
    if (short) circuits = circuits.slice(0, 6);
    var dragTotal = strips.reduce(function (t, x) { return t + x.n; }, 0);
    function card(name, total, chips) {
      return '<div class="tp-board-card' + (total ? ' is-busy' : '') + '"><div class="tp-board-name"><b>' + esc(name) + '</b>' + (total ? '<span class="tp-small">' + total + ' session' + (total === 1 ? '' : 's') + '</span>' : '') + '</div><div class="tp-chips">' + chips + '</div></div>';
    }
    var circuitCards = circuits.map(function (x) {
      return card(x.v.name, x.total, x.v.layouts.map(function (l) { return countChip('board=' + encodeURIComponent(x.v.id + ':' + l.id), l.name, c['track-board:' + x.v.id + ':' + l.id] || 0); }).join(''));
    });
    var dragCard = card('Drag strips', dragTotal, strips.map(function (x) { return countChip('drag=' + encodeURIComponent(x.v.id), x.v.name, x.n); }).join(''));
    // Drag strips go among the circuits by how busy they are.
    var at = circuits.filter(function (x) { return x.total >= dragTotal && dragTotal; }).length;
    if (!dragTotal) at = circuitCards.length;
    circuitCards.splice(at, 0, dragCard);
    return '<div class="tp-boards">' + circuitCards.join('') + '</div>';
  }
  function showBoards() {
    loading();
    Promise.all([getLibrary(), getCounts()]).then(function (r) {
      app.innerHTML = back('Track sessions', '') + '<div class="tp-section"><div class="tp-head"><h2>Leaderboards</h2></div><p class="tp-sub">Every session members have shared, fastest first. The number is how many sessions each track has. Tap a layout.</p>' + boardsListHtml(r[0], false, r[1]) + '</div>';
    });
  }

  // ---------- Add a session ----------
  var add = null;
  function showAdd(carId) {
    if (!token()) { location.href = 'signin.html?next=' + encodeURIComponent('/track.html?add=1'); return; }
    loading();
    Promise.all([getMine(), getLibrary(), isAdmin()]).then(function (r) {
      var m = r[0];
      if (!m) { location.href = 'signin.html?next=' + encodeURIComponent('/track.html?add=1'); return; }
      if (!m.cars.length) return showHome();
      var car = m.cars.filter(function (c) { return c.id === carId; })[0] || m.cars[0];
      add = { car: car, cars: m.cars, lib: r[1], admin: r[2], rd: null, session: null, type: null, startLine: null, conditions: 'Dry', privacy: 'private', street: false, file: null };
      drawAdd();
    }).catch(function () { failed('Could not load your cars. Check your connection and try again.'); });
  }
  function drawAdd() {
    var a = add;
    var h = back('Track sessions', '') + '<div class="tp-head"><h2>Add a session</h2>' + unitsChip() + '</div>' +
      '<div class="tp-add-grid"><div class="card">' +
      (a.cars.length > 1 ? '<div class="tp-field"><label for="tp-car">Car</label><select class="field" id="tp-car">' + a.cars.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === a.car.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></div>' : '<p class="tp-car-one">Car: <b>' + esc(a.car.name) + '</b></p>') +
      '<label class="tp-drop" id="tp-drop">' + icon('upload') + '<b>Drop your file here, or choose one</b><small>VBO, CSV or GPX. Works with RaceBox, VBOX, Harry\'s LapTimer, TrackAddict, AiM and most phone apps.</small><span class="btn btn-secondary btn-sm">Choose a file</span><input type="file" id="tp-file" accept=".vbo,.csv,.gpx,.txt,text/csv,application/gpx+xml" hidden></label>' +
      (a.file ? '<div class="tp-file">' + icon('check') + '<div><b>' + esc(a.file.name) + '</b><span>' + esc(fileMeta()) + '</span></div></div>' : '') +
      '<details class="tp-help"><summary>' + icon('info') + 'How to get the file from your lap timer</summary><ul>' +
      '<li><b>RaceBox:</b> open the session in the app, share or export it and choose VBO (CSV works too).</li>' +
      '<li><b>VBOX:</b> copy the .vbo file from the SD card.</li>' +
      '<li><b>Harry\'s LapTimer, TrackAddict:</b> export the session as CSV (or GPX) and save it to your phone.</li>' +
      '<li><b>AiM:</b> export from Race Studio as CSV with GPS latitude, longitude and speed.</li></ul></details>' +
      '<div id="tp-mapping"></div><p class="tp-status" id="tp-status" role="status"></p></div>' +
      '<div id="tp-result"></div></div>';
    app.innerHTML = h;
    var input = document.getElementById('tp-file'), drop = document.getElementById('tp-drop');
    input.addEventListener('change', function () { if (input.files[0]) readFile(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });
    var sel = document.getElementById('tp-car');
    if (sel) sel.addEventListener('change', function () { a.car = a.cars.filter(function (c) { return c.id === sel.value; })[0]; });
    if (a.session) drawResult();
  }
  function fileMeta() {
    var rd = add.rd;
    if (!rd || !rd.points) return '';
    return rd.points.length.toLocaleString('en-GB') + ' readings, ' + rd.hz + ' a second, ' + Math.max(1, Math.round(rd.points[rd.points.length - 1].t / 60)) + ' minutes' + (rd.sats ? ', ' + rd.sats + ' satellites on average' : '');
  }
  function status(msg, kind) {
    var el = document.getElementById('tp-status');
    if (el) { el.textContent = msg || ''; el.className = 'tp-status' + (kind ? ' is-' + kind : ''); }
  }
  function readFile(file) {
    if (file.size > 80 * 1024 * 1024) { status('That file is over 80 MB. Export just the one session and try again.', 'error'); return; }
    status('Reading ' + file.name + '...');
    var reader = new FileReader();
    reader.onload = function () {
      add.file = { name: file.name, text: String(reader.result || '') };
      add.session = null; add.startLine = null; add.type = null;
      parseFile();
    };
    reader.onerror = function () { status('That file could not be opened.', 'error'); };
    reader.readAsText(file);
  }
  function headerSig(h) { return h.join('|').toLowerCase().slice(0, 300); }
  function parseFile(mapping) {
    var a = add;
    try {
      if (!mapping) {
        try { var saved = JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); mapping = null; a.savedMaps = saved; } catch (e) { a.savedMaps = {}; }
      }
      var rd = T.read(a.file.text, a.file.name, mapping);
      if (rd.needsMapping) {
        var sig = headerSig(rd.needsMapping.headers);
        if (a.savedMaps && a.savedMaps[sig]) return parseFile(a.savedMaps[sig]);
        drawAdd();
        return drawMapping(rd.needsMapping);
      }
      a.rd = rd;
      analyse();
    } catch (e) {
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
  function analyse() {
    var a = add;
    var opts = {};
    if (a.type) opts.type = a.type;
    if (a.startLine) opts.startLine = a.startLine;
    a.session = T.analyse(a.rd, a.lib, opts);
    a.type = a.session.type;
    drawAdd();
    status('');
  }
  function canBoard() {
    var s = add.session;
    if (!s) return false;
    if (s.type === 'drag') return !!s.atVenue;
    return !!(s.venueId && s.layoutId && s.laps && s.laps.length && !s.needsStartLine);
  }
  function drawResult() {
    var a = add, s = a.session, box = document.getElementById('tp-result');
    var h = '<div class="card tp-fields">';
    h += '<div class="tp-field"><span class="tp-lbl">Type</span><div class="tp-chips" data-type>' + [['track', 'Track day'], ['drag', 'Drag run']].map(function (t) { return '<button type="button" class="chip' + (s.type === t[0] ? ' is-on' : '') + '" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div>';
    if (s.type === 'track') {
      if (s.needsStartLine) {
        h += '<div class="tp-notice is-warn">' + icon('pin') + '<div><b>' + esc(s.venue || 'New track') + '</b><br>' + esc(s.problem) + '</div></div>' +
          '<svg class="tv-chart tp-tap" id="tp-tap" role="img" aria-label="Your trace. Tap the start and finish line."></svg>' +
          (!s.venueId ? '<div class="tp-field"><label for="tp-venue-name">Track name</label><input class="field" id="tp-venue-name" placeholder="For example, Blyton Park" value="' + esc(a.venueName || '') + '"></div>' : '');
      } else {
        var timed = s.laps.filter(function (l) { return l.kind === 'timed'; }).length;
        h += '<div class="tp-notice is-ok">' + miniMap(s) + '<div><b>' + esc(s.venue ? trackName(s) : (a.venueName || 'Your track')) + '</b><br>' +
          (s.venueId ? 'Found from the GPS in your file. ' : 'Timed from the start line you picked. ') + timed + ' timed lap' + (timed === 1 ? '' : 's') + (s.bestTime ? ', best ' + V.fmtLap(s.bestTime) : '') + '.</div></div>';
        if (s.venueId && !s.layoutId) h += '<p class="tp-sub">We know ' + esc(s.venue) + ' but couldn\'t tell which layout this is, so it can\'t go on a leaderboard yet. We\'ve let the admin know.</p>';
        if (!s.venueId) h += '<div class="tp-field"><label for="tp-venue-name">Track name</label><input class="field" id="tp-venue-name" placeholder="For example, Blyton Park" value="' + esc(a.venueName || '') + '"></div>';
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
    var saveable = s.type === 'drag' ? (s.runs || []).length && (s.atVenue || (a.admin && a.street)) : !s.needsStartLine && s.laps && s.laps.length;
    if (saveable) {
      h += '<div class="tp-field"><span class="tp-lbl">Conditions</span><div class="tp-chips" data-cond>' + ['Dry', 'Damp', 'Wet'].map(function (c) { return '<button type="button" class="chip' + (a.conditions === c ? ' is-on' : '') + '" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div></div>' +
        '<div class="tp-f2"><div class="tp-field"><label for="tp-tyres">Tyres</label><input class="field" id="tp-tyres" placeholder="For example, Pilot Sport 4S" value="' + esc(a.tyres || '') + '"></div>' +
        '<div class="tp-field"><label for="tp-temp">Air temperature (°C)</label><input class="field" id="tp-temp" inputmode="numeric" placeholder="18" value="' + esc(a.temp == null ? '' : a.temp) + '"></div></div>' +
        '<div class="tp-field"><label for="tp-notes">Notes (only you see these)</label><input class="field" id="tp-notes" placeholder="Pressures, set-up, traffic..." value="' + esc(a.notes || '') + '"></div>' +
        '<div class="tp-field"><span class="tp-lbl">Who can see it</span><div class="tp-privacy" data-privacy>' + privacyOptions(a.privacy, a.street ? 'street' : canBoard() ? '' : 'noboard') + '</div></div>' +
        '<button type="button" class="btn btn-accent btn-block" id="tp-save">Save session</button>';
    } else if (s.type === 'drag' && (s.runs || []).length && !s.atVenue) {
      h += '<div class="tp-field"><label for="tp-req-name">Which drag strip were you at?</label><input class="field" id="tp-req-name" placeholder="Name of the venue"></div><button type="button" class="btn btn-secondary btn-block" id="tp-req">Ask for it to be added</button>';
    }
    h += '</div>';
    box.innerHTML = h;
    wireResult();
    if (s.needsStartLine) drawTap();
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
    var opts = [['private', 'Only me', 'The default. Nobody else sees it.'],
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
      ['tyres', 'temp', 'notes', 'venue-name'].forEach(function (k) {
        var el = document.getElementById('tp-' + k);
        if (!el) return;
        if (k === 'temp') a.temp = el.value.trim() === '' ? null : parseFloat(el.value);
        else if (k === 'venue-name') a.venueName = el.value.trim();
        else a[k] = el.value.trim();
      });
    }
    group('[data-type]', function (v) { keep(); if (v !== a.type) { a.type = v; analyse(); } });
    group('[data-cond]', function (v) { keep(); a.conditions = v; drawResult(); });
    group('[data-privacy]', function (v) { keep(); a.privacy = v; drawResult(); });
    var st = document.getElementById('tp-street');
    if (st) st.addEventListener('click', function () { keep(); a.street = !a.street; if (a.street) a.privacy = 'private'; drawResult(); });
    var save = document.getElementById('tp-save');
    if (save) save.addEventListener('click', function () { keep(); saveSession(save); });
    var req = document.getElementById('tp-req');
    if (req) req.addEventListener('click', function () {
      var nm = document.getElementById('tp-req-name').value.trim();
      var r0 = a.session.runs[0];
      api('POST', '/track/requests', { kind: 'drag', name: nm, lat: r0.lat, lng: r0.lng }).then(function (d) {
        status(d.success ? 'Thanks. We\'ll check it and add the strip if it is one.' : (d.message || 'Could not send that.'), d.success ? 'ok' : 'error');
      });
    });
  }
  // Unknown start line: the member taps their trace.
  function drawTap() {
    var a = add, s = a.session, svg = document.getElementById('tp-tap');
    var out = s.trace.outline;
    var proj = T.projector(out[0][0], out[0][1]);
    var d = 0, prev = null;
    var trace = out.map(function (p) { var xy = proj.xy(p[0], p[1]); if (prev) d += Math.hypot(xy[0] - prev[0], xy[1] - prev[1]); prev = xy; return [d, 0, xy[0], xy[1], p[2], 0, 0]; });
    var m = V.map(svg, trace, { mono: true });
    svg.style.cursor = 'crosshair';
    svg.addEventListener('click', function (e) {
      var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      var q = { x: (e.clientX - r.left) * vb.width / r.width, y: (e.clientY - r.top) * vb.height / r.height };
      var bi = 0, bd = Infinity;
      trace.forEach(function (p, k) { var pp = m.P(p[2], p[3]); var dd = (pp[0] - q.x) * (pp[0] - q.x) + (pp[1] - q.y) * (pp[1] - q.y); if (dd < bd) { bd = dd; bi = k; } });
      var p0 = trace[Math.max(0, bi - 3)], p1 = trace[Math.min(trace.length - 1, bi + 3)], c = trace[bi];
      var dx = p1[2] - p0[2], dy = p1[3] - p0[3], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      a.startLine = [proj.ll(c[2] + nx * 15, c[3] + ny * 15), proj.ll(c[2] - nx * 15, c[3] - ny * 15)];
      var nameEl = document.getElementById('tp-venue-name');
      a.venueName = nameEl ? nameEl.value.trim() : a.venueName;
      a.requestStart = true;
      analyse();
      if (add.session.needsStartLine) status('No laps were found from that point. Tap right on the straight where you cross the line.', 'error');
    });
  }
  function saveSession(btn) {
    var a = add, s = a.session;
    btn.disabled = true;
    status('Saving...');
    var carReady = a.car.virtual
      ? api('PUT', '/my-builds/car', { carId: a.car.id }).then(function (d) { if (!d.success) throw new Error(d.message || 'Could not set up the car'); a.car.id = d.car.id; a.car.virtual = false; mine = null; counts = null; return d.car.id; })
      : Promise.resolve(a.car.id);
    carReady.then(function (carId) {
      if (s.type === 'track' && (a.requestStart || (s.venueId && !s.layoutId))) {
        var out = [];
        var lap = s.trace.laps && s.trace.laps[s.best];
        var origin = s.origin || [0, 0], proj = T.projector(origin[0], origin[1]);
        if (lap) lap.filter(function (_, i) { return i % 4 === 0; }).forEach(function (p) { out.push(proj.ll(p[2], p[3]).map(function (v) { return Math.round(v * 1e6) / 1e6; })); });
        api('POST', '/track/requests', { kind: 'circuit', name: a.venueName || s.venue || '', venueId: s.venueId || '', startLine: s.startLine, lapLength: lap ? lap[lap.length - 1][0] : null, outline: out, note: s.venueId ? 'Layout not recognised' : 'New track' }).catch(function () {});
      }
      return api('POST', '/track/sessions', { carId: carId, session: s, conditions: a.conditions, tyres: a.tyres || '', temp: a.temp, notes: a.notes || '', privacy: a.privacy, venueName: a.venueName || '', street: a.street, adminViewer: a.street ? adminViewerToken() : '' });
    }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not save the session.');
      mine = null; counts = null;
      go('s=' + d.session.id);
    }).catch(function (e) {
      btn.disabled = false;
      status(e.message || 'Could not save the session.', 'error');
    });
  }

  // ---------- One session ----------
  var view = null;
  function showSession(id) {
    loading();
    Promise.all([api('GET', '/track/session?id=' + encodeURIComponent(id)), getMine().catch(function () { return null; })]).then(function (r) {
      var d = r[0];
      if (!d.success) return failed('This session isn\'t available. It may be private or removed.');
      view = { s: d.session, mine: r[1], a: d.session.best || 1, b: null, other: {} };
      var timed = (d.session.laps || []).filter(function (l) { return l.kind !== 'short' && l.n !== view.a; }).sort(function (x, y) { return x.time - y.time; });
      view.b = timed[0] ? String(timed[0].n) : null;
      drawSession();
    }).catch(function () { failed('This session could not be loaded. Check your connection and try again.'); });
  }
  function drawSession() {
    var s = view.s;
    var h = back(s.mine ? 'Your sessions' : 'Back', s.mine ? '' : (s.carId ? 'car=' + encodeURIComponent(s.carId) : ''));
    h += '<div class="tp-head tp-session-head"><div><h2>' + esc(trackName(s)) + '</h2><p class="tp-sub">' + esc(niceDate(s.date)) + (s.time ? ', ' + esc(s.time) : '') + (s.car ? ' &middot; ' + esc(s.car) : '') + (s.conditions ? ' &middot; ' + esc(s.conditions) : '') + (s.temp != null ? ', ' + esc(s.temp) + '°C' : '') + (s.tyres ? ' &middot; ' + esc(s.tyres) : '') + '</p></div><div class="tp-head-side">' + (s.mine ? privacyPill(s.privacy, s.street) : '') + unitsChip() + '</div></div>';
    if (s.type === 'drag') h += dragHtml(s);
    else h += trackHtml(s);
    if (s.mine) h += ownerHtml(s);
    app.innerHTML = h;
    if (s.type === 'drag') drawDragCharts(s);
    else drawTrackCharts(s);
    if (s.mine) wireOwner(s);
  }
  function tiles(list) {
    return '<div class="tp-tiles">' + list.map(function (t) { return '<div class="tp-tile' + (t[3] ? ' is-hero' : '') + '"><div class="k">' + esc(t[0]) + '</div><div class="v">' + esc(t[1]) + '</div><div class="s">' + esc(t[2] || '') + '</div></div>'; }).join('') + '</div>';
  }
  function trackHtml(s) {
    var laps = s.laps || [];
    var best = laps.filter(function (l) { return l.n === s.best; })[0];
    var h = tiles([
      ['Best lap', best ? V.fmtLap(best.time) : '-', best ? 'Lap ' + best.n + ' of ' + laps.length : '', 1],
      ['Best possible', s.possible ? V.fmtLap(s.possible) : '-', s.possible && best && best.time - s.possible < 0.05 ? 'Same as your best lap' : 'Your best sectors together'],
      ['Top speed', s.vmax ? V.fmtV(s.vmax) : '-', ''],
      ['Most grip used', s.latMax ? s.latMax.toFixed(2) + ' g' : '-', s.brakeMax ? 'Braking ' + s.brakeMax.toFixed(2) + ' g' : ''],
      ['Distance', s.distance ? V.fmtD(s.distance) : '-', s.duration ? Math.round(s.duration / 60) + ' minutes' : '']
    ]);
    h += '<div class="tp-grid tp-g-map"><div class="card"><div class="tp-chart-head"><h3>Your line, coloured by speed</h3><div class="tp-chips" id="tp-map-laps">' +
      laps.filter(function (l) { return s.trace && s.trace.laps && s.trace.laps[l.n]; }).map(function (l) { return '<button type="button" class="chip chip-sm' + (l.n === view.a ? ' is-on' : '') + '" data-lap="' + l.n + '">Lap ' + l.n + '</button>'; }).join('') + '</div></div>' +
      '<svg class="tv-chart" id="tp-map" role="img" aria-label="The lap drawn from GPS, coloured by speed"></svg>' +
      '<div class="tp-chart-foot"><span class="tp-ramp"><span id="tp-ramp-lo"></span><i></i><span id="tp-ramp-hi"></span></span><span>Drawn from the GPS in the file. Numbers are the slowest corners.</span></div></div>' +
      '<div class="card"><h3>Laps</h3><div class="tp-scroll"><table class="tp-table">' + lapTable(s) + '</table></div>' +
      (s.sectorsByThirds ? '<p class="tp-small">Sectors are thirds of the lap until this track has its own sector points.</p>' : '') + '</div></div>';
    h += '<div class="tp-section"><h3>What we spotted</h3><div class="tp-notes">' + notesHtml(T.sessionNotes(s, V.fmtV, V.fmtD)) + '</div></div>';
    if (s.trace && s.trace.laps && Object.keys(s.trace.laps).length) {
      h += '<div class="tp-section" id="compare"><div class="tp-head"><h2>Compare laps</h2></div><p class="tp-sub">Pick two laps. Move along a chart to see both at the same point on track.</p>' +
        '<div class="card tp-cmp-pick"><div class="tp-f2"><div class="tp-field"><label for="tp-cmp-a">Lap A</label><select class="field" id="tp-cmp-a">' + lapOptions(view.a) + '</select></div><div class="tp-field"><label for="tp-cmp-b">Lap B</label><select class="field" id="tp-cmp-b">' + lapOptions(view.b) + '</select></div></div></div>' +
        '<div class="tp-grid tp-g-map"><div class="card"><div class="tp-chart-head"><h3>Speed through the lap</h3><div class="tp-key" id="tp-key"></div></div><svg class="tv-chart" id="tp-speed" role="img" aria-label="Speed against distance for both laps"></svg>' +
        '<div class="tp-chart-head"><h3>Time gap</h3><span class="tp-small" id="tp-gap-cap"></span></div><svg class="tv-chart" id="tp-delta" role="img" aria-label="Running time gap between the laps"></svg></div>' +
        '<div class="tp-grid"><div class="card"><h3>Where you are</h3><svg class="tv-chart" id="tp-map2" role="img" aria-label="Track map with both laps\' positions"></svg></div>' +
        '<div class="card"><h3>Corner by corner</h3><div class="tp-scroll"><table class="tp-table" id="tp-corners"></table></div></div></div></div>' +
        '<div class="tp-grid tp-g2"><div class="card"><div class="tp-chart-head"><h3>Grip used, lap A</h3><span class="tp-small">Each dot is a moment on the lap.</span></div><svg class="tv-chart tp-gg" id="tp-gg" role="img" aria-label="Sideways against lengthways g for lap A"></svg></div><div class="tp-notes" id="tp-cmp-notes"></div></div></div>';
    }
    if (s.mine && s.venueId && s.layoutId) h += '<div class="tp-section" id="over-time"><div class="tp-head"><h2>' + esc(trackName(s)) + ' over time</h2></div><div id="tp-time"></div></div>';
    return h;
  }
  function lapKind(l, s) {
    if (l.n === s.best) return '<span class="tp-badge">Best</span>';
    var k = { 'in': 'In lap', out: 'Out lap', slow: 'Slow', short: 'Cut short' }[l.kind];
    return k ? '<span class="tp-badge is-soft">' + k + '</span>' : '';
  }
  function lapTable(s) {
    var best = (s.laps || []).filter(function (l) { return l.n === s.best; })[0];
    var bs = s.bestSectors || [];
    var n = Math.max.apply(null, [0].concat((s.laps || []).map(function (l) { return (l.sectors || []).length; })));
    var head = '<thead><tr><th>Lap</th><th>Time</th>';
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
      return '<tr class="' + (l.n === s.best ? 'is-best' : '') + '"><td>' + l.n + lapKind(l, s) + '</td><td>' + V.fmtLap(l.time) + '</td>' + cells + '<td>' + Math.round(V.spd(l.vmax || 0)) + '</td><td>' + gap + '</td></tr>';
    }).join('') + '</tbody>';
  }
  function lapOptions(sel) {
    var s = view.s;
    var h = (s.laps || []).filter(function (l) { return s.trace.laps[l.n]; }).map(function (l) {
      return '<option value="' + l.n + '"' + (String(sel) === String(l.n) ? ' selected' : '') + '>Lap ' + l.n + ', ' + V.fmtLap(l.time) + (l.n === s.best ? ' (best)' : l.kind === 'in' ? ' (in lap)' : l.kind === 'out' ? ' (out lap)' : '') + '</option>';
    }).join('');
    // Your best laps from other days at the same layout.
    if (s.mine && view.mine && s.layoutId) {
      var others = view.mine.sessions.filter(function (o) { return o.id !== s.id && o.type === 'track' && o.venueId === s.venueId && o.layoutId === s.layoutId && o.bestTime; });
      if (others.length) h += '<optgroup label="Your best on other days">' + others.map(function (o) { var v = 'x:' + o.id; return '<option value="' + v + '"' + (sel === v ? ' selected' : '') + '>' + esc(niceDate(o.date)) + ', ' + V.fmtLap(o.bestTime) + '</option>'; }).join('') + '</optgroup>';
    }
    return h;
  }
  function lapTrace(v) {
    if (String(v).indexOf('x:') === 0) {
      var id = String(v).slice(2);
      if (view.other[id]) return Promise.resolve(view.other[id]);
      return api('GET', '/track/session?id=' + encodeURIComponent(id)).then(function (d) {
        var o = d.session;
        var tr = o && o.trace && o.trace.laps && o.trace.laps[o.best];
        view.other[id] = tr ? { trace: tr, label: niceDate(o.date), time: o.bestTime } : null;
        return view.other[id];
      });
    }
    var l = (view.s.laps || []).filter(function (x) { return String(x.n) === String(v); })[0];
    return Promise.resolve(l ? { trace: view.s.trace.laps[l.n], label: 'Lap ' + l.n, time: l.time } : null);
  }
  function startLineXY(s) {
    if (!s.startLine || !s.origin || s.origin.length !== 2) return null;
    var proj = T.projector(s.origin[0], s.origin[1]);
    return s.startLine.map(function (p) { return proj.xy(p[0], p[1]); });
  }
  function drawTrackCharts(s) {
    if (!s.trace || !s.trace.laps) return;
    var mapLap = view.a, tr = s.trace.laps[mapLap];
    if (tr) {
      var mm = V.map(document.getElementById('tp-map'), tr, { corners: s.corners, startLine: startLineXY(s), lap: mapLap });
      if (mm) { document.getElementById('tp-ramp-lo').textContent = V.fmtV(mm.vmin); document.getElementById('tp-ramp-hi').textContent = V.fmtV(mm.vmax); }
    }
    var chips = document.getElementById('tp-map-laps');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lap]');
      if (!b) return;
      view.a = parseInt(b.getAttribute('data-lap'), 10);
      chips.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('is-on', c === b); });
      var m2 = V.map(document.getElementById('tp-map'), s.trace.laps[view.a], { corners: s.corners, startLine: startLineXY(s), lap: view.a });
      if (m2) { document.getElementById('tp-ramp-lo').textContent = V.fmtV(m2.vmin); document.getElementById('tp-ramp-hi').textContent = V.fmtV(m2.vmax); }
    });
    var sa = document.getElementById('tp-cmp-a'), sb = document.getElementById('tp-cmp-b');
    if (sa) {
      sa.addEventListener('change', function () { view.a = sa.value; drawCompare(s); });
      sb.addEventListener('change', function () { view.b = sb.value; drawCompare(s); });
      drawCompare(s);
    }
    if (s.mine) drawOverTime(s);
  }
  function drawCompare(s) {
    Promise.all([lapTrace(view.a), lapTrace(view.b || view.a)]).then(function (r) {
      var A = r[0], B = r[1];
      if (!A || !B) return;
      var c1 = RUN_COLORS[0], c2 = RUN_COLORS[1];
      document.getElementById('tp-key').innerHTML = '<span><i style="background:' + c1 + '"></i>' + esc(A.label) + ' (A)</span><span><i style="background:' + c2 + '"></i>' + esc(B.label) + ' (B)</span>';
      var at = V.traceAt;
      var dmax = Math.min(A.trace[A.trace.length - 1][0], B.trace[B.trace.length - 1][0]);
      var dk = V.distK(), xt = V.nice(0, dmax / dk, 6).map(function (v) { return v * dk; }).filter(function (v) { return v <= dmax; }), xf = function (v) { return V.fmtD(v); };
      var vmax = 0; A.trace.concat(B.trace).forEach(function (p) { vmax = Math.max(vmax, V.spd(p[4])); });
      var yt = V.nice(0, vmax, 6);
      var mapEl = document.getElementById('tp-map2');
      var mo = V.map(mapEl, A.trace, { mono: true, startLine: startLineXY(s), corners: s.corners });
      var other = [];
      function move(x) { if (mo) { mo.placeA(at(A.trace, x)); mo.placeB(at(B.trace, x)); } }
      function leave() { if (mo) { mo.placeA(null); mo.placeB(null); } other.forEach(function (o) { o.hide(); }); }
      function tipF(x) {
        var pa = at(A.trace, x), pb = at(B.trace, x), g = pb[1] - pa[1];
        return '<b>' + V.fmtD(x, 2) + '</b>' + V.row(A.label, V.fmtV(pa[4]), c1) + V.row(B.label, V.fmtV(pb[4]), c2) + V.row('A is', Math.abs(g).toFixed(2) + ' s ' + (g >= 0 ? 'ahead' : 'behind'));
      }
      var sp, dl;
      sp = V.line(document.getElementById('tp-speed'), {
        H: 240, x0: 0, x1: dmax, y0: 0, y1: yt[yt.length - 1], xt: xt, xf: xf, yt: yt,
        series: [{ color: c2, pts: B.trace.map(function (p) { return [p[0], V.spd(p[4])]; }), at: function (x) { return V.spd(at(B.trace, x)[4]); } }, { color: c1, pts: A.trace.map(function (p) { return [p[0], V.spd(p[4])]; }), at: function (x) { return V.spd(at(A.trace, x)[4]); } }],
        under: function (svg, X) { (s.corners || []).forEach(function (c) { var t = document.createElementNS('http://www.w3.org/2000/svg', 'text'); t.setAttribute('x', X(c.d)); t.setAttribute('y', 22); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-weight', '700'); t.textContent = c.n; svg.appendChild(t); }); },
        tip: tipF, onMove: function (x) { move(x); dl.show(x); }, onLeave: leave
      });
      var dp = [];
      for (var x = 0; x <= dmax; x += 10) dp.push([x, at(B.trace, x)[1] - at(A.trace, x)[1]]);
      var gmin = Math.min.apply(null, dp.map(function (p) { return p[1]; })), gmax = Math.max.apply(null, dp.map(function (p) { return p[1]; }));
      var gyt = V.nice(Math.min(0, gmin), Math.max(0.5, gmax), 4);
      dl = V.line(document.getElementById('tp-delta'), {
        H: 150, x0: 0, x1: dmax, y0: gyt[0], y1: gyt[gyt.length - 1], xt: xt, xf: xf, yt: gyt, zero: 0, yf: function (v) { return (v > 0 ? '+' : '') + v + ' s'; },
        series: [{ color: c1, area: true, pts: dp, at: function (x) { return at(B.trace, x)[1] - at(A.trace, x)[1]; } }], tip: tipF, onMove: function (x) { move(x); sp.show(x); }, onLeave: leave
      });
      other = [sp, dl];
      var total = B.time - A.time;
      document.getElementById('tp-gap-cap').textContent = 'Above the line, A is ahead. A finishes ' + Math.abs(total).toFixed(2) + ' s ' + (total >= 0 ? 'ahead' : 'behind') + '.';
      var gains = s.corners && s.corners.length ? T.cornerGains(A.trace, B.trace, s.corners) : [];
      document.getElementById('tp-corners').innerHTML = gains.length ? '<thead><tr><th>Corner</th><th>Slowest, A</th><th>Slowest, B</th><th>A gains</th></tr></thead><tbody>' + gains.map(function (g) { return '<tr><td>' + g.n + (g.name ? ' ' + esc(g.name) : '') + '</td><td>' + Math.round(V.spd(g.va)) + '</td><td>' + Math.round(V.spd(g.vb)) + '</td><td>' + (g.gain >= 0 ? '+' : '') + g.gain.toFixed(2) + ' s</td></tr>'; }).join('') + '</tbody>' : '<tbody><tr><td>No corners found on this lap.</td></tr></tbody>';
      V.gg(document.getElementById('tp-gg'), A.trace, c1);
      var notes = [];
      var big = gains.slice().sort(function (x, y) { return Math.abs(y.gain) - Math.abs(x.gain); })[0];
      if (big && Math.abs(total) > 0.05) notes.push({ icon: 'corner', text: 'The biggest difference was at corner ' + big.n + (big.name ? ' (' + big.name + ')' : '') + ': A ' + (big.gain >= 0 ? 'gained ' : 'lost ') + Math.abs(big.gain).toFixed(2) + ' s there, out of ' + Math.abs(total).toFixed(2) + ' s in all.', small: 'Measured from 200 m before the slowest point to 150 m after.' });
      var brake = Math.max.apply(null, A.trace.map(function (p) { return -p[6]; })), lat = Math.max.apply(null, A.trace.map(function (p) { return Math.abs(p[5]); }));
      var comb = A.trace.filter(function (p) { return Math.hypot(p[5], p[6]) > 0.6 && Math.abs(p[5]) > 0.3 && Math.abs(p[6]) > 0.3; }).length / A.trace.length;
      notes.push({ icon: 'brake', text: A.label + ' peaked at ' + brake.toFixed(2) + ' g braking and ' + lat.toFixed(2) + ' g cornering. ' + Math.round(comb * 100) + '% of the lap mixes braking or power with cornering (the dots between the axes).', small: 'Blending braking into the turn-in fills out the circle, and is often where time is found.' });
      notes.push({ icon: 'info', text: 'These are observations from the data, not coaching. Weather, tyres, traffic and flags all change lap times.' });
      document.getElementById('tp-cmp-notes').innerHTML = notesHtml(notes);
    });
  }
  // Mods with a fitted date, from the car's list in My Garage (owner only).
  function carMods(carId) {
    var car = view.mine && view.mine.cars.filter(function (c) { return c.id === carId; })[0];
    var out = [];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    ((car && car.view) || []).forEach(function (a) {
      (a.parts || []).forEach(function (p) {
        var m = String(p.meta || '').match(/Fitted (?:([A-Z][a-z]{2}) )?(\d{4})/);
        if (!m || p.empty) return;
        var month = m[1] ? MONTHS.indexOf(m[1]) + 1 : 6;
        out.push({ label: (p.kind ? p.kind + ': ' : a.label + ': ') + p.what, month: month, year: parseInt(m[2], 10), date: m[2] + '-' + (month < 10 ? '0' : '') + month });
      });
    });
    return out;
  }
  function drawOverTime(s) {
    var box = document.getElementById('tp-time');
    if (!box || !view.mine) return;
    var list = view.mine.sessions.filter(function (o) { return o.carId === s.carId && o.type === 'track' && o.venueId === s.venueId && o.layoutId === s.layoutId && o.bestTime; });
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
    V.timeline(document.getElementById('tp-timeline'), list.map(function (o) {
      return { date: o.date, time: o.bestTime, wet: (o.conditions || 'Dry') !== 'Dry', mine: o.id === s.id, label: niceDate(o.date), conditions: o.conditions, temp: o.temp, onClick: function () { go('s=' + o.id); } };
    }), mods);
  }

  function dragHtml(s) {
    var runs = s.runs || [];
    var bq = runs.filter(function (r) { return r.quarter; }).sort(function (a, b) { return a.quarter - b.quarter; })[0];
    var b60 = runs.slice().sort(function (a, b) { return a.s60 - b.s60; })[0];
    var b8 = runs.filter(function (r) { return r.eighth; }).sort(function (a, b) { return a.eighth - b.eighth; })[0];
    var bmid = runs.filter(function (r) { return r.s60to100; }).sort(function (a, b) { return a.s60to100 - b.s60to100; })[0];
    var h = '';
    if (s.street) h += '<div class="tp-notice is-admin">' + icon('shield') + '<div><b>Street run</b><br>Saved by an admin for testing. Private, never on a leaderboard.</div></div>';
    else if (s.atVenue) h += '<div class="tp-notice is-ok">' + icon('check') + '<div><b>' + esc(s.venue) + '</b><br>Runs from the strip.</div></div>';
    h += tiles([
      ['1/4 mile', bq ? bq.quarter.toFixed(2) + ' s' : '-', bq ? 'at ' + V.fmtV(bq.quarterSpeed) : 'Not reached', 1],
      ['0 to 60 mph', b60 ? b60.s60.toFixed(2) + ' s' : '-', b60 && b60.ft60 ? '60 ft in ' + b60.ft60.toFixed(2) + ' s' : ''],
      ['60 to 100 mph', bmid ? bmid.s60to100.toFixed(2) + ' s' : '-', ''],
      ['1/8 mile', b8 ? b8.eighth.toFixed(2) + ' s' : '-', b8 ? 'at ' + V.fmtV(b8.eighthSpeed) : ''],
      ['Runs', String(runs.length), '']
    ]);
    h += '<div class="tp-grid tp-g-map"><div class="card"><div class="tp-chart-head"><h3>Speed off the line</h3><div class="tp-key">' + runs.slice(0, 8).map(function (r, i) { return '<span><i style="background:' + RUN_COLORS[i] + '"></i>Run ' + (i + 1) + '</span>'; }).join('') + '</div></div><svg class="tv-chart" id="tp-drag" role="img" aria-label="Speed against time for each run"></svg></div>' +
      '<div class="card"><h3>Runs</h3><div class="tp-scroll"><table class="tp-table"><thead><tr><th>Run</th><th>60 ft</th><th>0-60</th><th>60-100</th><th>1/8</th><th>1/4</th><th>Trap</th></tr></thead><tbody>' +
      runs.map(function (r, i) { function f(v) { return v ? v.toFixed(2) : '-'; } return '<tr' + (r === bq ? ' class="is-best"' : '') + '><td>' + (i + 1) + '</td><td>' + f(r.ft60) + '</td><td>' + f(r.s60) + '</td><td>' + f(r.s60to100) + '</td><td>' + f(r.eighth) + '</td><td>' + f(r.quarter) + '</td><td>' + (r.quarterSpeed ? Math.round(V.spd(r.quarterSpeed)) : '-') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="tp-small">Times from the first movement, worked out from GPS speed. Strip timing lights use a short rollout, so their times are usually a little quicker.</p></div></div>';
    h += '<div class="tp-section"><h3>What we spotted</h3><div class="tp-notes">' + notesHtml(T.sessionNotes(s, V.fmtV, V.fmtD)) + '</div></div>';
    return h;
  }
  function drawDragCharts(s) {
    var svg = document.getElementById('tp-drag');
    if (svg && (s.runs || []).length) V.drag(svg, s.runs.slice(0, 8), RUN_COLORS);
  }

  function ownerHtml(s) {
    var limit = s.street ? 'street' : (s.type === 'drag' ? (s.atVenue ? '' : 'noboard') : (s.venueId && s.layoutId ? '' : 'noboard'));
    return '<div class="tp-section" id="settings"><div class="tp-head"><h2>Session settings</h2></div><div class="card tp-fields">' +
      '<div class="tp-field"><span class="tp-lbl">Who can see it</span><div class="tp-privacy" data-privacy>' + privacyOptions(s.privacy, limit) + '</div></div>' +
      '<div class="tp-field"><span class="tp-lbl">Conditions</span><div class="tp-chips" data-cond>' + ['Dry', 'Damp', 'Wet'].map(function (c) { return '<button type="button" class="chip' + (s.conditions === c ? ' is-on' : '') + '" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div></div>' +
      '<div class="tp-f2"><div class="tp-field"><label for="tp-e-tyres">Tyres</label><input class="field" id="tp-e-tyres" value="' + esc(s.tyres || '') + '"></div><div class="tp-field"><label for="tp-e-temp">Air temperature (°C)</label><input class="field" id="tp-e-temp" inputmode="numeric" value="' + esc(s.temp == null ? '' : s.temp) + '"></div></div>' +
      '<div class="tp-field"><label for="tp-e-notes">Notes (only you see these)</label><input class="field" id="tp-e-notes" value="' + esc(s.notes || '') + '"></div>' +
      '<div class="tp-actions"><button type="button" class="btn btn-primary" id="tp-e-save">Save changes</button><button type="button" class="btn btn-danger" id="tp-e-del">' + icon('trash') + 'Delete</button></div><p class="tp-status" id="tp-status" role="status"></p></div></div>';
  }
  function wireOwner(s) {
    var edit = { privacy: s.privacy, conditions: s.conditions };
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
    document.getElementById('tp-e-save').addEventListener('click', function () {
      var t = document.getElementById('tp-e-temp').value.trim();
      api('PUT', '/track/session', { id: s.id, privacy: edit.privacy, conditions: edit.conditions || '', tyres: document.getElementById('tp-e-tyres').value, temp: t === '' ? null : parseFloat(t), notes: document.getElementById('tp-e-notes').value }).then(function (d) {
        if (!d.success) { status(d.message || 'Could not save.', 'error'); return; }
        mine = null; counts = null;
        Object.assign(view.s, { privacy: d.session.privacy, conditions: d.session.conditions, tyres: d.session.tyres, temp: d.session.temp, notes: document.getElementById('tp-e-notes').value });
        getMine().then(function (m) { view.mine = m; drawSession(); status('Saved.', 'ok'); });
      });
    });
    document.getElementById('tp-e-del').addEventListener('click', function () {
      if (!window.confirm('Delete this session? This can\'t be undone.')) return;
      api('DELETE', '/track/session?id=' + encodeURIComponent(s.id)).then(function (d) {
        if (!d.success) { status(d.message || 'Could not delete.', 'error'); return; }
        mine = null; counts = null;
        go('');
      });
    });
  }

  // ---------- A build's shared sessions ----------
  function showCar(carId) {
    loading();
    api('GET', '/track/public?car=' + encodeURIComponent(carId)).then(function (d) {
      if (!d.success) return failed('That build could not be found.');
      var c = d.car;
      var h = back('Track sessions', '') + '<div class="tp-head"><div><h2>' + esc(c.name || 'MT3UK build') + '</h2><p class="tp-sub">' + esc([c.owner, [c.year, c.model, c.version].filter(Boolean).join(' ')].filter(Boolean).join(' · ')) + '</p></div>' + unitsChip() + '</div>';
      if (d.mine) h += '<p class="tp-sub">This is what other members see. Only sessions you share show here.</p>';
      h += d.sessions.length ? '<div class="tp-list">' + d.sessions.map(sessionRow).join('') + '</div>' : '<div class="card tp-empty">' + icon('flag') + '<p>No shared sessions yet.</p></div>';
      h += '<p class="tp-sub"><a href="gallery.html" class="tp-link">See the build in the Gallery' + icon('chev') + '</a></p>';
      app.innerHTML = h;
    }).catch(function () { failed('That build could not be loaded.'); });
  }

  // ---------- Leaderboards ----------
  var boardModel = 'All';
  function showBoard(venueId, layoutId, isDrag) {
    loading();
    Promise.all([getLibrary(), api('GET', (isDrag ? '/drag/board?venue=' : '/track/board?venue=') + encodeURIComponent(venueId) + (isDrag ? '' : '&layout=' + encodeURIComponent(layoutId)))]).then(function (r) {
      var v = r[0].venues.filter(function (x) { return x.id === venueId; })[0];
      var l = v && v.layouts ? v.layouts.filter(function (x) { return x.id === layoutId; })[0] : null;
      var title = v ? v.name + (l && l.name !== v.name ? ', ' + l.name : '') : venueId;
      var entries = r[1].entries || [];
      function draw() {
        var shown = entries.filter(function (e) { return boardModel === 'All' || e.model === boardModel; });
        var h = back('Leaderboards', 'boards=1') + '<div class="tp-head"><div><h2>' + esc(title) + '</h2><p class="tp-sub">' + (isDrag ? 'Every shared run here, quickest quarter mile first.' : 'Every shared session here, fastest lap first.') + ' Share a session to put it on.</p></div>' + unitsChip() + '</div>' +
          '<div class="tp-chips" id="tp-models">' + ['All'].concat(MODELS).map(function (m) { return '<button type="button" class="chip' + (m === boardModel ? ' is-on' : '') + '" data-m="' + m + '">' + m + '</button>'; }).join('') + '</div>';
        if (!shown.length) h += '<div class="card tp-empty">' + icon('trophy') + '<p>Nobody on this board yet' + (boardModel === 'All' ? '' : ' for the ' + esc(boardModel)) + '. Be the first.</p></div>';
        else h += '<div class="card"><div class="tp-scroll"><table class="tp-table tp-board"><thead><tr><th>#</th><th>Car</th><th>' + (isDrag ? '1/4 mile' : 'Lap') + '</th><th>Date</th><th></th></tr></thead><tbody>' + shown.map(function (e, i) {
          var res = isDrag ? e.quarter.toFixed(2) + ' s<small>' + V.fmtV(e.quarterSpeed) + '</small>' : V.fmtLap(e.time);
          return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(e.car) + '</b><small>' + esc([e.owner, [e.year, e.model, e.version].filter(Boolean).join(' ')].filter(Boolean).join(' · ')) + '</small>' +
            (e.mods && e.mods.length ? '<details class="tp-mods"><summary>Mods (' + e.mods.length + ')</summary><div class="tp-chips">' + e.mods.map(function (m) { return '<span class="tp-modchip">' + esc(m) + '</span>'; }).join('') + '</div></details>' : '') + '</td>' +
            '<td class="tp-res">' + res + '</td><td>' + esc(niceDate(e.date)) + (e.conditions ? '<small>' + esc(e.conditions) + '</small>' : '') + '</td><td><a class="btn btn-ghost btn-sm" href="track.html?s=' + esc(e.sessionId) + '" data-go="s=' + esc(e.sessionId) + '">View</a></td></tr>';
        }).join('') + '</tbody></table></div><p class="tp-small">Mods are the ones listed on the build. Weather and tyres vary between days.</p></div>';
        app.innerHTML = h;
        document.getElementById('tp-models').addEventListener('click', function (e) {
          var b = e.target.closest('[data-m]');
          if (b) { boardModel = b.getAttribute('data-m'); draw(); }
        });
      }
      draw();
    }).catch(function () { failed('The leaderboard could not be loaded.'); });
  }

  route();
})();
