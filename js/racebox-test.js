/*
 * racebox-test.html: shows live readings from a RaceBox through the Laps app's RaceBox bridge (js/racebox-app.js).
 * Outside the app the page says so and does not offer to connect.
 */
(function () {
  'use strict';
  var app = window.MT3UKRaceBoxApp;
  var rate = 0, count = 0;
  var lastKph = null;
  // The speed can be shown in km/h or mph. The choice is kept on the phone.
  var unit = 'kmh';
  try { if (localStorage.getItem('mt3ukRaceBoxUnit') === 'mph') unit = 'mph'; } catch (e) { /* storage blocked: km/h */ }

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }

  function statusText(e) {
    var s = e && e.state;
    var d = e && e.detail;
    if (s === 'scanning') return 'Looking for a RaceBox' + (d ? ' (round ' + d + ' of 3)' : '') + '…';
    if (s === 'connecting') return 'Connecting to ' + (d || 'the RaceBox') + '…';
    if (s === 'discovering') return 'Setting up the connection…';
    if (s === 'connected') return 'Connected to ' + (d || 'the RaceBox') + '. Live readings below.';
    if (s === 'retrying') return 'The connection did not work. Trying again (' + d + ' of 3)…';
    if (s === 'disconnected') return 'Disconnected.';
    if (s === 'notfound') return 'No RaceBox found. Switch it on, keep it close, and try again.';
    if (s === 'failed') return 'The RaceBox could not be used' + (d ? ' (' + d + ')' : '') + '. Try again.';
    return 'Status: ' + (s || 'unknown');
  }

  function renderSpeed() {
    if (lastKph === null) return;
    var mph = unit === 'mph';
    // Whole numbers only: 0 to 1 km/h shows as 0, 42.3 km/h as 42.
    var shown = String(Math.round(mph ? lastKph * 0.621371 : lastKph));
    set('rbt-speed', shown);
    set('rbt-speed-unit', mph ? 'mph' : 'km/h');
    // The large speed on the map in full screen.
    set('rbt-speed-big', shown);
    set('rbt-speed-big-unit', mph ? 'mph' : 'km/h');
    var b = $('rbt-unit');
    if (b) b.setAttribute('aria-checked', mph ? 'true' : 'false');
  }

  function toggleUnit() {
    unit = unit === 'mph' ? 'kmh' : 'mph';
    try { localStorage.setItem('mt3ukRaceBoxUnit', unit); } catch (e) { /* storage blocked: the choice lasts this visit */ }
    renderSpeed();
  }

  // The map: the car's position and the trail of good fixes. Leaflet and OpenStreetMap load only once there is a good fix.
  var LEAFLET = { css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' };
  var map = null, trail = null, marker = null, leafletRequested = false;
  var pts = [];
  window.MT3UKRaceBoxTrail = pts;
  window.MT3UKRaceBoxDrive = { analyse: analyseDrive, placeName: placeName };

  function metres(a, b) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function loadLeaflet(done) {
    if (window.L) return done();
    if (leafletRequested) return setTimeout(function () { loadLeaflet(done); }, 300);
    leafletRequested = true;
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET.css;
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = LEAFLET.js;
    js.onload = done;
    js.onerror = function () { leafletRequested = false; };
    document.head.appendChild(js);
  }

  // The dot is green with a good GPS fix and red without one, and the prompt on the map says what to do.
  function setDot(good) {
    if (marker) marker.setStyle({ fillColor: good ? '#1c8a4b' : '#c0392b' });
  }

  function setPrompt(text) {
    var p = $('rbt-prompt');
    if (!p) return;
    p.textContent = text || '';
    p.hidden = !text;
  }

  // Recording: while Record a drive is on, readings are saved on the phone (IndexedDB) in batches of a second, so closing
  // the app loses at most about a second. Saved drives are listed under the readings and can be deleted.
  var DB_NAME = 'mt3uk-racebox', DB_VERSION = 1;
  var dbPromise = null;
  var rec = { id: null, started: 0, seq: 0, buf: [], count: 0 };
  function openDb() {
    if (!dbPromise) dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('readings')) db.createObjectStore('readings', { keyPath: ['rec', 'seq'] });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }
  function dbRun(store, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode);
        var req = fn(tx.objectStore(store));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function saveBatch(id, seq, rows, count, ended, started) {
    var work = Promise.resolve();
    if (rows.length) work = dbRun('readings', 'readwrite', function (st) { return st.put({ rec: id, seq: seq, rows: rows }); });
    return work.then(function () {
      return dbRun('recordings', 'readwrite', function (st) { return st.put({ id: id, started: started, ended: ended, count: count }); });
    });
  }
  // Writes the readings waiting in the buffer. When ending, the recording is closed as well.
  function flushRecording(ending) {
    if (!rec.id) return Promise.resolve();
    var rows = rec.buf, id = rec.id, seq = rec.seq, count = rec.count, started = rec.started;
    if (!rows.length && !ending) return Promise.resolve();
    rec.buf = [];
    rec.seq++;
    if (ending) rec.id = null;
    // Saves run one after another, so a later save (such as the one that closes the drive) is never overwritten by an earlier one.
    saveQueue = saveQueue.then(function () {
      return saveBatch(id, seq, rows, count, ending ? Date.now() : 0, started);
    }).then(function () {
      if (ending) drawRecordings();
    });
    return saveQueue;
  }
  var saveQueue = Promise.resolve();
  // Recording needs a GPS fix: the switch stays off until the RaceBox has one. Once recording, it stays on so it can be
  // stopped, and a drive that loses its fix keeps recording.
  var lastFixOk = false;
  function setRecordAvailable(ok) {
    var b = $('rbt-record'), note = $('rbt-rec-note');
    if (rec.id) return;
    if (b) b.disabled = !ok;
    if (note) note.hidden = !!ok;
    syncRecFloat();
  }
  // The large Record button on the full-screen map: Record, or a red Stop while recording. It follows the switch.
  function syncRecFloat() {
    var f = $('rbt-rec-float'), b = $('rbt-record');
    if (!f) return;
    var on = !!rec.id;
    f.textContent = on ? 'Stop' : 'Record';
    f.classList.toggle('is-recording', on);
    f.setAttribute('aria-pressed', on ? 'true' : 'false');
    f.disabled = b ? b.disabled : true;
  }
  function setRecordSwitch(on) {
    var b = $('rbt-record');
    if (b) b.setAttribute('aria-checked', on ? 'true' : 'false');
    var line = $('rbt-rec-line');
    if (line) { line.hidden = !on; }
  }
  function startRecording() {
    if (rec.id) return;
    rec = { id: 'd' + Date.now(), started: Date.now(), seq: 0, buf: [], count: 0 };
    setRecordSwitch(true);
    syncRecFloat();
    saveQueue = saveQueue.then(function () { return saveBatch(rec.id, 0, [], 0, 0, rec.started); }).then(drawRecordings);
    updateRecLine();
  }
  function stopRecording() {
    setRecordSwitch(false);
    flushRecording(true);
    setRecordAvailable(lastFixOk);
    syncRecFloat();
  }
  function updateRecLine() {
    var line = $('rbt-rec-line');
    if (line && rec.id) line.textContent = 'Recording: ' + rec.count + ' readings';
  }
  function recordReading(r) {
    if (!rec.id) return;
    rec.buf.push([r.utc, r.lat, r.lon, r.speedKph, r.heading, r.gForce.x, r.gForce.y, r.gForce.z, r.rotation.x, r.rotation.y, r.rotation.z, r.fixOk ? 1 : 0, r.satellites, r.horizontalAccuracy]);
    rec.count++;
    if (rec.buf.length >= 25) flushRecording(false);
    updateRecLine();
  }
  function drawRecordings() {
    return dbRun('recordings', 'readonly', function (st) { return st.getAll(); }).then(function (list) {
      var ul = $('rbt-drives-list'), empty = $('rbt-drives-empty');
      if (!ul) return;
      list.sort(function (a, b) { return b.started - a.started; });
      ul.textContent = '';
      if (empty) empty.hidden = list.length > 0;
      list.forEach(function (d) {
        var li = document.createElement('li');
        var info = document.createElement('div');
        var when = document.createElement('span');
        when.className = 'rbt-drive-when';
        when.textContent = new Date(d.started).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        var how = document.createElement('span');
        how.className = 'rbt-drive-info';
        var secs = d.ended ? Math.round((d.ended - d.started) / 1000) : 0;
        var now = rec.id === d.id;
        how.textContent = d.count + ' readings' + (secs ? ', ' + Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s' : '') +
          (now ? ', recording now' : (!d.ended ? ', unfinished (the app closed while recording)' : ''));
        info.appendChild(when);
        info.appendChild(how);
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-danger btn-sm rbt-del';
        del.textContent = 'Delete';
        var view = document.createElement('button');
        view.type = 'button';
        view.className = 'btn btn-secondary btn-sm rbt-view-open';
        view.textContent = 'View';
        view.addEventListener('click', function () { openDrive(d.id, d.started); });
        del.disabled = now;
        del.addEventListener('click', function () { deleteRecording(d.id); });
        li.appendChild(info);
        li.appendChild(view);
        li.appendChild(del);
        ul.appendChild(li);
      });
    }).catch(function () {});
  }
  // Viewing a saved drive: its route on a map, the figures and the stops (under 2 km/h for 10 seconds or more).
  var driveMap = null;
  function useMph() { return unit === 'mph'; }
  function readDrive(id) {
    return dbRun('readings', 'readonly', function (st) { return st.getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])); })
      .then(function (batches) {
        var rows = [];
        (batches || []).forEach(function (b) { rows = rows.concat(b.rows); });
        return rows;
      });
  }
  function analyseDrive(rows) {
    var out = { distanceM: 0, durationS: 0, movingS: 0, topKph: 0, stops: [], route: [] };
    if (!rows.length) return out;
    out.durationS = (rows[rows.length - 1][0] - rows[0][0]) / 1000;
    var stop = null;
    function closeStop(s) {
      var secs = (s.t1 - s.t0) / 1000;
      if (secs >= 10) out.stops.push({ at: s.t0, secs: secs, lat: s.lat / s.n, lon: s.lon / s.n });
    }
    rows.forEach(function (r, i) {
      var dt = i ? Math.min(1, Math.max(0, (r[0] - rows[i - 1][0]) / 1000)) : 0;
      var kph = r[3];
      out.topKph = Math.max(out.topKph, kph);
      out.distanceM += kph / 3.6 * dt;
      if (kph >= 2) out.movingS += dt;
      if (r[11]) out.route.push([r[1], r[2]]);
      if (kph < 2) {
        if (!stop) stop = { t0: r[0], t1: r[0], lat: 0, lon: 0, n: 0 };
        stop.t1 = r[0]; stop.lat += r[1]; stop.lon += r[2]; stop.n++;
      } else if (stop) { closeStop(stop); stop = null; }
    });
    if (stop) closeStop(stop);
    return out;
  }
  // The street name and number near a point, from OpenStreetMap (Nominatim). One request a second at most, and each
  // point is kept on the phone's page once looked up. Returns '' when there is no name.
  var placeCache = {}, placeQueue = Promise.resolve();
  function placeName(lat, lon) {
    var key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (placeCache[key] !== undefined) return Promise.resolve(placeCache[key]);
    var job = placeQueue.then(function () {
      return new Promise(function (done) { setTimeout(done, 1100); });
    }).then(function () {
      return fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=' + lat + '&lon=' + lon)
        .then(function (res) { return res.ok ? res.json() : null; });
    }).then(function (data) {
      var a = (data && data.address) || {};
      var road = a.road || a.pedestrian || a.footway || a.path || '';
      var street = a.house_number && road ? a.house_number + ' ' + road : road;
      var name = [street, a.town || a.village || a.city || a.suburb || ''].filter(Boolean).join(', ');
      placeCache[key] = name;
      return name;
    }).catch(function () { return ''; });
    placeQueue = job;
    return job;
  }
  function fmtTime(ms) { return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function fmtLength(s) {
    s = Math.round(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + ' h ' + m + ' min' : (m ? m + ' min ' + x + ' s' : x + ' s');
  }
  function fmtSpeed(kph) { return useMph() ? Math.round(kph * 0.621371) + ' mph' : Math.round(kph) + ' km/h'; }
  function fmtDist(m) { return useMph() ? (m / 1609.344).toFixed(2) + ' mi' : (m / 1000).toFixed(2) + ' km'; }
  function closeDrive() {
    var view = $('rbt-view');
    if (view) { view.hidden = true; view.removeAttribute('data-drive'); }
    if (driveMap) { driveMap.remove(); driveMap = null; }
  }
  function openDrive(id, started) {
    readDrive(id).then(function (rows) {
      var a = analyseDrive(rows);
      var view = $('rbt-view');
      if (!view) return;
      view.hidden = false;
      view.setAttribute('data-drive', id);
      set('rbt-view-title', 'Drive from ' + fmtTime(started));
      var stats = $('rbt-view-stats');
      stats.textContent = '';
      [['Distance', fmtDist(a.distanceM)], ['Driving time', fmtLength(a.movingS)], ['Length of drive', fmtLength(a.durationS)],
        ['Top speed', fmtSpeed(a.topKph)], ['Average while moving', a.movingS ? fmtSpeed(a.distanceM / a.movingS * 3.6) : '–'],
        ['Stops', String(a.stops.length)]].forEach(function (pair) {
        var div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = pair[0];
        dd.textContent = pair[1];
        div.appendChild(dt);
        div.appendChild(dd);
        stats.appendChild(div);
      });
      var list = $('rbt-view-stops');
      list.textContent = '';
      if (!a.stops.length) {
        var none = document.createElement('li');
        none.textContent = 'No stops of 10 seconds or more.';
        list.appendChild(none);
      }
      a.stops.forEach(function (s, i) {
        var li = document.createElement('li');
        var when = 'Stop ' + (i + 1) + ' at ' + new Date(s.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ', for ' + fmtLength(s.secs);
        var where = ' (' + s.lat.toFixed(5) + ', ' + s.lon.toFixed(5) + ')';
        li.textContent = when + where;
        list.appendChild(li);
        // The street name and number replace the coordinates once they are looked up.
        placeName(s.lat, s.lon).then(function (name) {
          if (name) li.textContent = when + ', ' + name;
        });
      });
      loadLeaflet(function () {
        if (!window.L || !$('rbt-view-map') || view.hidden) return;
        if (driveMap) { driveMap.remove(); driveMap = null; }
        driveMap = L.map($('rbt-view-map'));
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(driveMap);
        if (a.route.length) {
          var line = L.polyline(a.route, { color: '#e4b64f', weight: 4 }).addTo(driveMap);
          L.circleMarker(a.route[0], { radius: 7, color: '#16233d', fillColor: '#1c8a4b', fillOpacity: 1 }).bindTooltip('Start').addTo(driveMap);
          L.circleMarker(a.route[a.route.length - 1], { radius: 7, color: '#16233d', fillColor: '#c0392b', fillOpacity: 1 }).bindTooltip('End').addTo(driveMap);
          driveMap.fitBounds(line.getBounds(), { padding: [20, 20] });
        } else {
          driveMap.setView([51.5, -0.1], 5);
        }
        a.stops.forEach(function (s, i) {
          L.circleMarker([s.lat, s.lon], { radius: 6, color: '#16233d', fillColor: '#e67e22', fillOpacity: 1 }).bindTooltip('Stop ' + (i + 1)).addTo(driveMap);
        });
        setTimeout(function () { if (driveMap) driveMap.invalidateSize(); }, 60);
      });
      view.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }).catch(function () {});
  }

  function deleteRecording(id) {
    if (!window.confirm('Delete this drive from the phone? It cannot be undone.')) return;
    if ($('rbt-view') && $('rbt-view').getAttribute('data-drive') === id) closeDrive();
    dbRun('readings', 'readwrite', function (st) { return st.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])); })
      .then(function () { return dbRun('recordings', 'readwrite', function (st) { return st.delete(id); }); })
      .then(drawRecordings);
  }

  // G meter: across (x) left to right, along (y) up for forward; 1 g is 40 units from the centre, clamped at the rim.
  // Zero takes the reading at the moment it is pressed (parked) as the middle, so a mounting tilt does not push the dot off centre.
  var lastG = { x: 0, y: 0 }, gZero = { x: 0, y: 0 };
  try { var savedZero = JSON.parse(localStorage.getItem('mt3ukRaceBoxGZero') || 'null'); if (savedZero) gZero = savedZero; } catch (e) {}
  function drawMeter() {
    var ax = lastG.x - gZero.x, ay = lastG.y - gZero.y;
    var mx = Math.max(-1.1, Math.min(1.1, ax)), my = Math.max(-1.1, Math.min(1.1, ay));
    var dot = $('rbt-meter-dot');
    if (dot) { dot.setAttribute('cx', (50 + mx * 40).toFixed(1)); dot.setAttribute('cy', (50 - my * 40).toFixed(1)); }
    set('rbt-meter-x', ax.toFixed(2));
    set('rbt-meter-y', ay.toFixed(2));
  }
  function zeroG() {
    gZero = { x: lastG.x, y: lastG.y };
    try { localStorage.setItem('mt3ukRaceBoxGZero', JSON.stringify(gZero)); } catch (e) {}
    drawMeter();
  }
  // Auto-zero: after each connection, the first second of readings taken while the car is still (under 2 km/h)
  // becomes the middle. Moving restarts the count, so a car that is rolling when it connects waits for a stop.
  var autoZero = { on: true, n: 0, sx: 0, sy: 0 };
  function startAutoZero() { autoZero = { on: true, n: 0, sx: 0, sy: 0 }; }
  function feedAutoZero(r) {
    if (!autoZero.on) return;
    if (r.speedKph >= 2) { autoZero.n = 0; autoZero.sx = 0; autoZero.sy = 0; return; }
    autoZero.n++;
    autoZero.sx += r.gForce.x;
    autoZero.sy += r.gForce.y;
    if (autoZero.n >= 25) {
      gZero = { x: autoZero.sx / autoZero.n, y: autoZero.sy / autoZero.n };
      try { localStorage.setItem('mt3ukRaceBoxGZero', JSON.stringify(gZero)); } catch (e) {}
      autoZero.on = false;
      drawMeter();
    }
  }

  // The street name comes from OpenStreetMap's reverse lookup (Nominatim). It is asked for at most every 10 seconds,
  // and only after the car has moved 40 m, so the free service is not overloaded. Shown under the position when there is one.
  var street = { at: null, busy: false, asked: 0 };
  function showStreet(name) {
    var el = $('rbt-street');
    if (!el) return;
    el.textContent = name || '';
    el.hidden = !name;
  }
  function lookStreet(here) {
    if (street.busy) return;
    if (street.at && metres(street.at, here) < 40) return;
    if (Date.now() - street.asked < 10000) return;
    street.busy = true;
    street.asked = Date.now();
    var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&accept-language=en&lat=' + here[0] + '&lon=' + here[1];
    fetch(url).then(function (res) { return res.ok ? res.json() : null; }).then(function (data) {
      street.busy = false;
      street.at = here;
      var a = (data && data.address) || {};
      showStreet(a.road || a.pedestrian || a.footway || a.path || '');
    }).catch(function () { street.busy = false; });
  }

  function drawFix(r) {
    if (!r.fixOk) {
      setDot(false);
      setPrompt('No GPS fix yet. Keep the RaceBox with a clear view of the sky.');
      return;
    }
    setPrompt('');
    lookStreet([r.lat, r.lon]);
    var here = [r.lat, r.lon];
    // Skip tiny moves: a parked car's GPS wanders by a few metres, which would scribble on the trail.
    if (pts.length && metres(pts[pts.length - 1], here) < 3) {
      if (marker) { marker.setLatLng(here); setDot(true); }
      return;
    }
    pts.push(here);
    // The map area and its buttons appear with the first good fix, so they keep their place while the map library loads.
    var fsBtn = $('rbt-full');
    var mapEl = $('rbt-map');
    if (mapEl) mapEl.hidden = false;
    if (fsBtn) fsBtn.hidden = false;
    $('rbt-clear').hidden = false;
    loadLeaflet(function () {
      var el = $('rbt-map');
      if (!el || !window.L) return;
      if (!map) {
        map = L.map(el).setView(here, 17);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
        trail = L.polyline(pts, { color: '#e4b64f', weight: 4 }).addTo(map);
        marker = L.circleMarker(here, { radius: 7, color: '#16233d', fillColor: '#1c8a4b', fillOpacity: 1 }).addTo(map);
        setDot(true);
      } else {
        trail.setLatLngs(pts);
        marker.setLatLng(here);
        setDot(true);
        map.panTo(here);
      }
    });
  }

  // The map buttons sit just above the readings band, whatever height the band is with its text.
  function fitBand() {
    var band = document.querySelector('.rbt-band');
    if (band) document.documentElement.style.setProperty('--band-h', band.offsetHeight + 'px');
  }
  // Full screen: the map fills the screen and the readings sit over it. The map is resized to match.
  // The heading tile moves onto the map in full screen, and back into the readings when full screen ends.
  var headingHome = null;
  function moveHeading(toMap) {
    var tile = document.querySelector('.rbt-heading-tile'), map = document.querySelector('.rbt-map-wrap');
    if (!tile || !map) return;
    if (toMap) {
      if (!headingHome) { headingHome = document.createComment('heading'); tile.parentNode.insertBefore(headingHome, tile); }
      map.appendChild(tile);
    } else if (headingHome && headingHome.parentNode) {
      headingHome.parentNode.insertBefore(tile, headingHome);
    }
  }
  function setFull(on) {
    document.documentElement.classList.toggle('rbt-full-on', on);
    moveHeading(on);
    var b = $('rbt-full');
    if (b) { b.textContent = on ? 'Exit full screen' : 'Go full screen'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    setMenu(false);
    // The phone's browser settles its height a moment after the switch, and Leaflet only loads tiles for the new size
    // when the map is moved, so refresh it a few times (setView at the same centre and zoom does that).
    function refreshMap() { if (map) { map.invalidateSize(); map.setView(map.getCenter(), map.getZoom(), { animate: false }); } }
    if (map) [60, 300, 800].forEach(function (ms) { setTimeout(refreshMap, ms); });
  }

  // Full screen: the status and the two switches sit in a fly-out opened by the Controls button.
  function setMenu(open) {
    var f = $('rbt-flyout'), b = $('rbt-menu');
    if (f) f.classList.toggle('is-open', open);
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function clearTrail() {
    pts.length = 0;
    if (trail) trail.setLatLngs([]);
  }

  // 16-point compass name for a heading in degrees (0 is north).
  var POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compassPoint(deg) {
    return POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  function show(r) {
    count++;
    drawFix(r);
    lastKph = r.speedKph;
    feedAutoZero(r);
    recordReading(r);
    lastFixOk = !!r.fixOk;
    setRecordAvailable(lastFixOk);
    renderSpeed();
    set('rbt-heading', r.heading.toFixed(1));
    var arrow = $('rbt-arrow');
    if (arrow) arrow.style.transform = 'rotate(' + r.heading + 'deg)';
    // The GPS heading means little at a standstill, so the direction name shows only above walking pace.
    set('rbt-card', r.speedKph >= 2 ? compassPoint(r.heading) : '');
    set('rbt-pos', r.lat.toFixed(6) + ', ' + r.lon.toFixed(6));
    set('rbt-fix', r.fixOk ? 'Good' : (r.fixStatus === 0 ? 'No fix' : 'Poor'));
    // Green for a good GPS fix, red for no fix or a poor one.
    var fixCard = $('rbt-fix') && $('rbt-fix').parentNode && $('rbt-fix').parentNode.parentNode;
    if (fixCard) {
      fixCard.classList.toggle('rbt-fix-good', !!r.fixOk);
      fixCard.classList.toggle('rbt-fix-bad', !r.fixOk);
    }
    set('rbt-sats', String(r.satellites));
    set('rbt-acc', r.horizontalAccuracy.toFixed(2));
    set('rbt-g', r.gForce.x.toFixed(2) + ' / ' + r.gForce.y.toFixed(2) + ' / ' + r.gForce.z.toFixed(2) + ' g');
    lastG = { x: r.gForce.x, y: r.gForce.y };
    drawMeter();
    set('rbt-rot', r.rotation.x.toFixed(1) + ' / ' + r.rotation.y.toFixed(1) + ' / ' + r.rotation.z.toFixed(1));
    set('rbt-batt', r.charging ? 'Charging, ' + r.batteryPercent + '%' : r.batteryPercent + '%');
    set('rbt-time', new Date(r.utc).toISOString().replace('T', ' ').slice(0, 19));
  }

  // The Connect button shows where the connection is: Connecting while it is set up, Connected while it is live,
  // and back to Connect once it is off, as the RaceBox app does.
  function setConnectButton(state) {
    var b = $('rbt-connect');
    if (!b) return;
    var busy = state === 'scanning' || state === 'connecting' || state === 'discovering' || state === 'retrying';
    var on = state === 'connected';
    var label = $('rbt-connect-label');
    if (label) label.textContent = on ? 'Connected' : (busy ? 'Connecting…' : 'Connect to RaceBox');
    // The switch is on while connected: turning it off disconnects. It is off, and busy while connecting.
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.disabled = busy;
  }

  function ready() {
    set('rbt-status', 'Not connected. Switch the RaceBox on, then tap Connect to RaceBox.');
    // The app can still be connected from before this page was opened, so show that rather than Not connected.
    Promise.resolve().then(function () { return app.status(); }).then(function (r) {
      if (r && r.connected) {
        set('rbt-status', statusText({ state: 'connected', detail: r.name || '' }));
        setConnectButton('connected');
      }
    }).catch(function () { /* the app did not answer: stay on Not connected */ });
    app.onStatus(function (e) {
      set('rbt-status', statusText(e));
      setConnectButton(e && e.state);
      if (e && (e.state === 'disconnected' || e.state === 'notfound' || e.state === 'failed')) {
        setDot(false);
        setPrompt('Not connected. Tap Connect to RaceBox to start.');
        lastFixOk = false;
        setRecordAvailable(false);
      } else if (e && e.state === 'connected') {
        startAutoZero();
        setPrompt('Connected. Waiting for a GPS fix.');
      }
    });
    app.onReading(show);
    setInterval(function () {
      rate = count;
      count = 0;
      set('rbt-rate', String(rate));
    }, 1000);
    $('rbt-connect').addEventListener('click', function () {
      if ($('rbt-connect').getAttribute('aria-checked') === 'true') { app.disconnect(); return; }
      set('rbt-status', 'Looking for a RaceBox…');
      app.connect().catch(function (err) { set('rbt-status', String(err && err.message ? err.message : err)); setConnectButton('failed'); });
    });
    $('rbt-unit').addEventListener('click', toggleUnit);
    $('rbt-clear').addEventListener('click', clearTrail);
    $('rbt-full').addEventListener('click', function () { setFull(!document.documentElement.classList.contains('rbt-full-on')); });
    $('rbt-menu').addEventListener('click', function () { var f = $('rbt-flyout'); setMenu(!(f && f.classList.contains('is-open'))); });
    $('rbt-zero').addEventListener('click', zeroG);
    $('rbt-view-close').addEventListener('click', closeDrive);
    fitBand();
    if (window.ResizeObserver && document.querySelector('.rbt-band')) new ResizeObserver(fitBand).observe(document.querySelector('.rbt-band'));
    window.addEventListener('resize', fitBand);
    $('rbt-rec-float').addEventListener('click', function () { $('rbt-record').click(); });
    $('rbt-record').addEventListener('click', function () {
      if ($('rbt-record').getAttribute('aria-checked') === 'true') stopRecording(); else startRecording();
    });
    drawRecordings();
    renderSpeed();
  }

  function notReady() {
    var b = $('rbt-connect');
    if (b) b.disabled = true;
    if (!app.pluginNames || app.pluginNames() === 'not running in the app') {
      set('rbt-status', 'Open this page in the Laps app on your phone to connect to a RaceBox.');
    } else {
      set('rbt-status', 'RaceBox is not available on this page. Plugins here: ' + app.pluginNames() + '. Open the RaceBox test from the Laps front page.');
    }
  }

  function init() {
    if (!app) return notReady();
    // The app's bridge can arrive a moment after the page's scripts run, so check for a few seconds before giving up.
    var tries = 0;
    (function check() {
      if (app.available) return ready();
      tries++;
      if (tries < 10) return setTimeout(check, 500);
      notReady();
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
