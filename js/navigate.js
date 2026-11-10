/*
 * Navigate (navigate.html): shows the phone's own location on a map, with speed, heading and accuracy. It uses only the
 * phone's GPS (navigator.geolocation, which the Laps app allows on every Android version), so the RaceBox is not needed.
 */
(function () {
  'use strict';
  var LEAFLET = { css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' };
  var MAP_BASE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  var map = null, marker = null, trail = null, leafletRequested = false, pts = [], lastKph = null, mph = false, lastFix = null, watch = null, shown = null;
  // While driving, the dot, the map and the turn glide towards each new fix over a few frames, so the picture moves smoothly.
  var shownPos = null, targetPos = null, drawHeading = null, frame = null;
  // The last fix while driving, and how fast the phone was going: between fixes the dot is carried on from it.
  var fixPos = null, fixAt = 0, velMs = 0;

  function metresBetween(a, b) {
    var R = 6371000, dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function $(id) { return document.getElementById(id); }
  function set(id, t) { var el = $(id); if (el) el.textContent = t; }
  function status(text, bad) {
    var el = $('nav-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-bad', !!bad);
  }
  function compass(deg) { return POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]; }

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

  function ensureMap(lat, lng) {
    if (map || !window.L) return;
    var el = $('nav-map');
    if (!el) return;
    el.hidden = false;
    // Lines drawn on a canvas, not as SVG: the map is tilted and turned while driving, and SVG lines flicker in that.
    map = L.map(el, { preferCanvas: true }).setView([lat, lng], 17);
    map.on('dragstart', userMoved);
    map.on('zoomstart', userMoved);
    L.tileLayer(MAP_BASE, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    el.classList.add('rbt-mono');
    trail = L.polyline([], { color: '#e4b64f', weight: 4 }).addTo(map);
    marker = L.circleMarker([lat, lng], { radius: 8, color: '#16233d', fillColor: '#1c8a4b', fillOpacity: 1 }).addTo(map);
  }

  // While driving the map turns so the direction of travel points up, and leans back like a sat-nav's 3D view.
  function applyRotation() {
    var el = $('nav-map');
    if (!el) return;
    if (!driving) { el.style.transform = ''; return; }
    // 3D only while following the phone. Once the member pans, turns or zooms, the map is flat (2D) until Recentre.
    var tilt = browsing ? 0 : DRIVE_TILT;
    var h = drawHeading !== null ? drawHeading : heading;
    var turn = browsing ? viewTurn : (h !== null ? -h : 0);
    // The car sits lower on the screen in 3D, as in Google's view, so more of the road ahead shows.
    var lift = Math.round(window.innerHeight * 0.2 * (tilt / DRIVE_TILT));
    el.style.transform = 'translateY(' + lift + 'px) perspective(2600px) rotateX(' + tilt + 'deg) rotate(' + turn + 'deg)';
  }
  // Arrows for the turn card: straight on unless the step says left or right.
  var ARROWS = {
    straight: 'M12 19V5M5 12l7-7 7 7',
    left: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v5',
    right: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0-6 6v5'
  };
  function turnArrow(text) {
    var t = String(text || '').toLowerCase(), key = /\bleft\b/.test(t) ? 'left' : /\bright\b/.test(t) ? 'right' : 'straight';
    var el = $('nav-turn-arrow');
    if (el) el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ARROWS[key] + '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  // Driving zoom: closer than the map's usual view, so the next turns are easy to read.
  var DRIVE_ZOOM = 19;
  // Browsing: the map stays tilted, and the member turns and moves it. It starts from the turn it has now.
  function enterBrowse() {
    if (!driving || browsing) return;
    browsing = true;
    viewTurn = heading !== null ? -heading : 0;
    var wrap = drivingWrap();
    if (wrap) wrap.classList.add('is-browsing');
  }
  function userMoved() {
    if (!driving || programmatic) return;
    enterBrowse();
    applyRotation();
  }
  // Recentre: back on the phone, turned and tilted again.
  function recentreDrive() {
    browsing = false;
    viewTurn = heading !== null ? -heading : 0;
    var wrap = drivingWrap();
    if (wrap) wrap.classList.remove('is-browsing');
    followPhone(DRIVE_ZOOM);
    applyRotation();
  }
  function followPhone(zoom) {
    if (map && lastFix) quietly(function () { map.setView([lastFix.lat, lastFix.lng], zoom || map.getZoom(), { animate: false }); });
  }
  // The turn card and the bottom bar: the step we are on and the distance to its end, the time and distance left.
  // Voice: the next turn is spoken as the phone nears it, with the phone's own speech. Speech needs a tap first, so
  // Start route (a tap) also says the first step. The speaker button mutes it, and the choice is kept on this device.
  var voiceOn = true, spoken = {};
  try { voiceOn = localStorage.getItem('mt3ukNavigateVoice') !== 'off'; } catch (e) { voiceOn = true; }
  // In the Laps app the phone's own speech comes through the app's TextToSpeech plugin, because the app's web view
  // has no speech of its own. Anywhere else the browser's speech is used.
  function nativeSpeech() {
    var C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform() || !C.Plugins || !C.Plugins.TextToSpeech) return null;
    return C.Plugins.TextToSpeech;
  }
  function voiceAvailable() {
    return !!nativeSpeech() || ('speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined');
  }
  // The app's voice (its index in the plugin's list): a British one, the network voice when the phone has it, which
  // sounds more natural than the default. Looked up once.
  var nativeVoice = null, voicePicked = false;
  function pickNativeVoice() {
    if (voicePicked) return;
    var n = nativeSpeech();
    if (!n || !n.getSupportedVoices) return;
    voicePicked = true;
    Promise.resolve(n.getSupportedVoices()).then(function (r) {
      var list = (r && r.voices) || [], best = -1, bestScore = -1;
      list.forEach(function (v, i) {
        if (!/^en[-_]gb/i.test(String(v.lang || ''))) return;
        var score = /network/i.test(String(v.name || '')) ? 2 : 1;
        if (score > bestScore) { best = i; bestScore = score; }
      });
      nativeVoice = best >= 0 ? best : null;
    }).catch(function () { nativeVoice = null; });
  }
  // The browser's British voice, the better (online or Google) one when there is one.
  var browserVoiceCache;
  function browserVoice() {
    if (browserVoiceCache !== undefined) return browserVoiceCache;
    try {
      var list = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
      if (!list.length) return null; // not loaded yet: try again next time
      var uk = list.filter(function (v) { return /^en[-_]gb/i.test(v.lang || ''); });
      browserVoiceCache = uk.filter(function (v) { return /google|online|natural/i.test(v.name); })[0] || uk[0] || null;
    } catch (e) { browserVoiceCache = null; }
    return browserVoiceCache;
  }
  function stopSpeech() {
    try {
      var n = nativeSpeech();
      if (n) { n.stop(); return; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch (e) { /* speech blocked on this device */ }
  }
  function say(text, cancelFirst) {
    if (!voiceOn || !voiceAvailable() || !text) return;
    try {
      var n = nativeSpeech();
      if (n) {
        // Flush starts the new turn at once; Add waits for the one being said.
        var opts = { text: text, lang: 'en-GB', rate: 0.95, pitch: 1, volume: 1, queueStrategy: cancelFirst ? 0 : 1 };
        if (nativeVoice !== null) opts.voice = nativeVoice;
        n.speak(opts).catch(function () { /* the app could not speak */ });
        return;
      }
      if (cancelFirst) window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      u.rate = 0.95;
      u.volume = 1;
      var bv = browserVoice();
      if (bv) u.voice = bv;
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech blocked on this device */ }
  }
  // Distances as they are said: yards or miles with mph, metres or kilometres with km/h, rounded to what a driver hears.
  function spokenDistance(m) {
    if (mph) {
      var yd = m * 1.09361;
      if (yd < 880) return (Math.max(50, Math.round(yd / 50) * 50)) + ' yards';
      return (m / 1609.344).toFixed(1) + ' miles';
    }
    if (m < 1000) return (Math.max(50, Math.round(m / 50) * 50)) + ' metres';
    return (m / 1000).toFixed(1) + ' kilometres';
  }
  function lowerFirst(t) { return String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1); }
  function announce(cur, upcoming, toTurn, left) {
    var steps = routeD.steps || [], key = cur + ':';
    if (toTurn <= 400 && !spoken[key + 'far']) { spoken[key + 'far'] = true; say('In ' + spokenDistance(toTurn) + ', ' + lowerFirst(upcoming)); }
    if (toTurn <= 60 && !spoken[key + 'near']) { spoken[key + 'near'] = true; say('Now, ' + lowerFirst(upcoming), true); }
    if (left < 25 && !spoken.arrive) { spoken.arrive = true; say('You have arrived.'); }
  }

  // The turn card and the voice follow the next instruction: the one at the end of the step we are on, with the
  // distance to it.
  function updateDrive() {
    if (!driving || !routeD || !lastFix) return;
    var left = leftOnRoute();
    if (left === null) return;
    var steps = routeD.steps || [], total = 0;
    steps.forEach(function (st) { total += st.distanceM || 0; });
    var done = 0, cur = steps.length - 1;
    for (var k = 0; k < steps.length; k++) {
      done += steps[k].distanceM || 0;
      if (left > total - done) { cur = k; break; }
    }
    var toTurn = Math.max(0, left - (total - done));
    var next = steps[cur + 1], upcoming = next ? next.text : 'You will arrive at your destination';
    if (left < 25) { set('nav-turn-text', 'You have arrived'); set('nav-turn-dist', ''); turnArrow('straight'); }
    else { set('nav-turn-text', upcoming); set('nav-turn-dist', 'in ' + distText(toTurn)); turnArrow(upcoming); announce(cur, upcoming, toTurn, left); }
    var secs = routeD.distanceM ? routeD.durationS * left / routeD.distanceM : 0;
    var arrive = new Date(Date.now() + secs * 1000);
    set('nav-eta', Math.max(1, Math.round(secs / 60)) + ' min');
    set('nav-left', distText(left) + ' \u00b7 ' + arrive.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    set('nav-drive-speed', ($('nav-speed') || {}).textContent || '\u2013');
    set('nav-drive-unit', mph ? 'mph' : 'km/h');
  }
  // A new fix while driving: the dot is carried on from it at the phone's speed, along the way the phone is heading.
  function setFix(here, c) {
    var now = performance.now();
    fixPos = here.slice();
    fixAt = now;
    velMs = c.speed != null && !isNaN(c.speed) ? c.speed : 0;
    if (heading === null) velMs = 0;
  }
  // Where the phone is now, carried on from the last fix (at most two seconds on).
  function predictedPos(now) {
    var t = Math.min(2, Math.max(0, (now - fixAt) / 1000));
    var d = velMs * t, h = heading * Math.PI / 180;
    return [fixPos[0] + d * Math.cos(h) / 111320, fixPos[1] + d * Math.sin(h) / (111320 * Math.cos(fixPos[0] * Math.PI / 180))];
  }
  // The dot sits on the road it is driving on when the phone is within 25 m of the route. Further off, it is where the phone says.
  function stepFrame() {
    frame = null;
    if (!driving || !map || !fixPos) return;
    var aim = predictedPos(performance.now());
    var near = routeNear(aim);
    targetPos = near && near.d <= 25 ? near.q : aim;
    if (!shownPos) shownPos = targetPos.slice();
    var gap = metresBetween(shownPos, targetPos);
    // A long jump (after a gap in the signal) is taken at once; short moves glide.
    var k = gap > 60 ? 1 : 0.3;
    shownPos = [shownPos[0] + (targetPos[0] - shownPos[0]) * k, shownPos[1] + (targetPos[1] - shownPos[1]) * k];
    if (heading !== null) {
      if (drawHeading === null) drawHeading = heading;
      drawHeading += (((heading - drawHeading + 540) % 360) - 180) * 0.2;
    }
    marker.setLatLng(shownPos);
    if (!browsing) quietly(function () { map.setView(shownPos, map.getZoom(), { animate: false }); });
    applyRotation();
    // Every frame while driving, so the dot keeps moving between the fixes.
    frame = requestAnimationFrame(stepFrame);
  }
  function startFrames() { if (!frame && driving) frame = requestAnimationFrame(stepFrame); }

  function startDrive() {
    if (!routeD || !map) return;
    driving = true;
    // The speaker always shows while driving. On a phone with no voice it is greyed out and says so when tapped.
    var vbtn = $('nav-voice');
    if (vbtn) vbtn.style.display = 'flex';
    pickNativeVoice();
    shownPos = null; targetPos = null; drawHeading = heading; fixPos = null; velMs = 0;
    $('nav-route').classList.remove('is-dragging');
    var wrap = document.querySelector('.nav-map-wrap');
    if (wrap) wrap.classList.add('is-driving');
    setRouteFolded(true); // the directions start folded, and the directions button opens them
    browsing = false;
    if (wrap) wrap.classList.remove('is-browsing', 'dirs-open');
    map.dragging.disable();
    map.touchZoom.disable();
    map.invalidateSize();
    followPhone(DRIVE_ZOOM);
    applyRotation();
    spoken = {};
    if (routeD.steps && routeD.steps[0]) say(routeD.steps[0].text, true);
    updateDrive();
  }
  function stopDrive() {
    driving = false;
    if (frame) cancelAnimationFrame(frame);
    frame = null; shownPos = null; targetPos = null; drawHeading = null; fixPos = null; velMs = 0;
    browsing = false;
    var vbtn = $('nav-voice');
    if (vbtn) vbtn.style.display = 'none';
    var vnote = $('nav-voice-note');
    if (vnote) vnote.style.display = 'none';
    if (map) { map.dragging.enable(); map.touchZoom.enable(); }
    var w0 = drivingWrap();
    if (w0) w0.classList.remove('is-browsing', 'dirs-open');
    if (voiceAvailable()) stopSpeech();
    var wrap = document.querySelector('.nav-map-wrap');
    if (wrap) wrap.classList.remove('is-driving');
    applyRotation();
    if (map) {
      map.invalidateSize();
      if (routeLayer) map.fitBounds(routeLayer.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [30, 260], maxZoom: 17 });
    }
  }

  var VOICE_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z" fill="currentColor"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var VOICE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // The speaker floats over the map while driving, under Recentre. It is made here, with its style inline, so it shows
  // whatever copy of the page the phone has.
  function makeVoiceButton() {
    var old = $('nav-voice');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var oldNote = $('nav-voice-note');
    if (oldNote && oldNote.parentNode) oldNote.parentNode.removeChild(oldNote);
    var wrap = document.querySelector('.nav-map-wrap');
    if (!wrap) return null;
    var note = document.createElement('div');
    note.id = 'nav-voice-note';
    note.setAttribute('role', 'status');
    note.textContent = 'Voice directions are not available on this phone';
    note.style.cssText = 'position:absolute;right:64px;bottom:240px;z-index:1006;display:none;max-width:210px;background:#16233d;color:#fff;font:600 13px/1.3 system-ui,sans-serif;padding:8px 10px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.25);';
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'nav-voice';
    b.style.cssText = 'position:absolute;right:12px;top:auto;bottom:228px;z-index:1006;width:44px;height:44px;border-radius:50%;border:1px solid #d8dbe2;background:#fff;color:#16233d;display:none;align-items:center;justify-content:center;padding:0;cursor:pointer;';
    b.addEventListener('click', function () {
      if (!voiceAvailable()) {
        // No speech on this phone (the Laps app's web view has none): say so for a moment instead of doing nothing.
        note.style.display = 'block';
        clearTimeout(voiceNoteTimer);
        voiceNoteTimer = setTimeout(function () { note.style.display = 'none'; }, 3000);
        return;
      }
      voiceOn = !voiceOn;
      try { localStorage.setItem('mt3ukNavigateVoice', voiceOn ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
      if (!voiceOn && voiceAvailable()) stopSpeech();
      setVoiceButton();
    });
    wrap.appendChild(note);
    wrap.appendChild(b);
    return b;
  }
  var voiceNoteTimer = null;
  function setVoiceButton() {
    var b = $('nav-voice');
    if (!b) return;
    var can = voiceAvailable();
    var on = can && voiceOn;
    b.innerHTML = on ? VOICE_ON : VOICE_OFF;
    b.style.color = on ? '#16233d' : '#8a94a6';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', !can ? 'Voice directions are not available on this phone' : voiceOn ? 'Turn voice directions off' : 'Turn voice directions on');
  }

  // While driving, the map is moved by hand. One finger pans, and two fingers turn and zoom it. The screen movement is
  // taken back onto the map's own plane first (undoing the tilt, then the turn), so the map follows the finger.
  function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function angle2(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
  function turnedDelta(dx, dy) {
    var dyP = dy / Math.cos(DRIVE_TILT * Math.PI / 180);
    var t = -viewTurn * Math.PI / 180;
    return [dx * Math.cos(t) - dyP * Math.sin(t), dx * Math.sin(t) + dyP * Math.cos(t)];
  }
  function gestureDown(e) {
    if (!driving || !map) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer cannot be captured */ }
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    enterBrowse();
    applyRotation();
    var ids = Object.keys(touches);
    if (ids.length === 1) gesture = { mode: 'pan', last: { x: e.clientX, y: e.clientY } };
    else if (ids.length === 2) {
      var pts = ids.map(function (id) { return touches[id]; });
      gesture = { mode: 'pinch', d0: dist2(pts[0], pts[1]), a0: angle2(pts[0], pts[1]), z0: map.getZoom(), t0: viewTurn };
    }
  }
  function gestureMove(e) {
    if (!driving || !map || !touches[e.pointerId] || !gesture) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (gesture.mode === 'pan' && Object.keys(touches).length === 1) {
      var dx = e.clientX - gesture.last.x, dy = e.clientY - gesture.last.y;
      gesture.last = { x: e.clientX, y: e.clientY };
      var d = turnedDelta(dx, dy);
      quietly(function () { map.panBy([-d[0], -d[1]], { animate: false }); });
    } else if (gesture.mode === 'pinch') {
      var pts = Object.keys(touches).map(function (id) { return touches[id]; });
      if (pts.length < 2) return;
      quietly(function () { map.setZoom(gesture.z0 + Math.log(dist2(pts[0], pts[1]) / gesture.d0) / Math.LN2, { animate: false }); });
      viewTurn = gesture.t0 + (angle2(pts[0], pts[1]) - gesture.a0);
      applyRotation();
    }
  }
  function gestureUp(e) {
    delete touches[e.pointerId];
    if (Object.keys(touches).length === 0) gesture = null;
  }
  function showSpeed() {
    if (lastKph === null) return;
    set('nav-speed', String(Math.round(mph ? lastKph * 0.621371 : lastKph)));
    set('nav-speed-unit', mph ? 'mph' : 'km/h');
    var b = $('nav-unit');
    if (b) { b.textContent = mph ? 'Show in km/h' : 'Show in mph'; b.setAttribute('aria-pressed', mph ? 'true' : 'false'); }
  }

  function onPosition(p) {
    var c = p.coords;
    lastFix = { lat: c.latitude, lng: c.longitude, t: p.timestamp, acc: c.accuracy };
    updateToGo();
    checkOffRoute();
    status('Your phone has a fix.');
    // Anything under 1 km/h (about 0.6 mph) shows as stopped, so walking pace shows. Parked GPS speed can still wander above this.
    if (c.speed != null && !isNaN(c.speed)) { lastKph = c.speed * 3.6 < 1 ? 0 : c.speed * 3.6; showSpeed(); }
    else { set('nav-speed', '–'); }
    // The direction of travel is only trusted while moving (above about 2 km/h).
    if (c.heading != null && !isNaN(c.heading) && lastKph > 2) heading = c.heading;
    if (c.heading != null && !isNaN(c.heading)) {
      set('nav-card', compass(c.heading));
      set('nav-deg', Math.round(c.heading) + '°');
    }
    set('nav-pos', c.latitude.toFixed(6) + ', ' + c.longitude.toFixed(6));
    set('nav-acc', 'within ' + Math.round(c.accuracy) + ' m');
    var when = new Date(p.timestamp || Date.now());
    set('nav-time', isNaN(when.getTime()) ? '\u2013' : when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    loadLeaflet(function () {
      ensureMap(c.latitude, c.longitude);
      if (!map) return;
      var rcb = $('nav-recentre');
      if (rcb) rcb.hidden = false;
      var here = [c.latitude, c.longitude];
      // The phone's own speed says when it is still. A still phone's fixes wander by 10 to 30 m, more than the reported
      // accuracy, so while stopped the dot and trail stay where they are. Moving, a fix moves them when it is more than its
      // accuracy (and at least 6 m) from the last one shown.
      if (lastKph === 0 && shown) {
        // Standing still: the trail is only the path since the phone last moved, so the wander left from before is cleared.
        if (trail.getLatLngs().length > 1) trail.setLatLngs([shown]);
        return;
      }
      if (!driving && shown && metresBetween(shown, here) <= Math.max(6, c.accuracy || 0)) return;
      shown = here;
      trail.addLatLng(here);
      if (driving) {
        setFix(here, c);
        startFrames();
      } else {
        marker.setLatLng(here);
        quietly(function () { map.panTo(here, { animate: false }); });
      }
    });
    if (driving) { applyRotation(); updateDrive(); }
  }

  function onError(err) {
    if (err.code === 1) status('Location is not allowed for Laps. Allow it for the app in the phone’s settings, then open this page again.', true);
    else if (err.code === 2) status('Your phone could not get a position yet. Go outside, or wait a moment.', true);
    else status('Your phone took too long to give a position. Trying again.', true);
  }

  function start() {
    if (!navigator.geolocation) { status('This phone gives no location to the page.', true); return; }
    watch = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }

  function approved() {
    // The same approval list as the RaceBox test, for now.
    var s = null;
    try { s = localStorage.getItem('mt3ukMyBuildsSession'); } catch (e) { s = null; }
    if (!s) return Promise.resolve(false);
    return fetch('https://late-darkness-ebc8.modtesla3uk.workers.dev/laps/racebox/access', { cache: 'no-store', headers: { 'X-Session-Token': s } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return !!(d && d.access); })
      .catch(function () { return false; });
  }

  // Distances follow the speed unit: miles (yards under a tenth of a mile) with mph, metres and km with km/h.
  var routeD = null;
  var driving = false, heading = null, DRIVE_TILT = 60;
  // Browsing: while driving, a press-and-drag or a pinch takes the map off the phone and flat, until Recentre.
  var browsing = false, programmatic = false, viewTurn = 0, touches = {}, gesture = null;
  function quietly(fn) { programmatic = true; try { fn(); } finally { programmatic = false; } }
  function drivingWrap() { return document.querySelector('.nav-map-wrap'); }
  function distText(m) {
    if (mph) {
      var mi = m / 1609.344;
      return mi >= 0.1 ? mi.toFixed(1) + ' mi' : Math.round(m * 1.09361) + ' yd';
    }
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
  }
  // The distance small print on a place in the results, in the unit now shown.
  function distanceSmall(p) {
    if (p.km === undefined) return null;
    var s = document.createElement('small');
    s.dataset.m = String(Math.round(p.km * 1000));
    s.textContent = distText(p.km * 1000) + ' away';
    return s;
  }
  // Redraws every distance on screen after the unit is switched.
  function showDistances() {
    document.querySelectorAll('#nav-results small[data-m]').forEach(function (s) {
      s.textContent = distText(+s.dataset.m) + ' away';
    });
    renderRouteText();
    updateToGo();
  }

  // The route panel is a card at the bottom of the screen. It is folded (only its handle and Drive heading show) or open.
  // --nav-y is how far the panel is pushed down, so a drag moves it with the finger and it snaps to a state on release.
  function shownHeight() {
    var panel = $('nav-route'), hd = $('nav-route-handle'), head = panel && panel.querySelector('.nav-route-head');
    if (!panel || !hd || !head) return 0;
    var was = head.style.display;
    head.style.display = 'flex';
    var h = hd.offsetHeight + head.offsetHeight;
    head.style.display = was;
    return h;
  }
  function foldOffset() {
    var panel = $('nav-route');
    return panel ? Math.max(0, panel.offsetHeight - shownHeight()) : 0;
  }
  function setPanelY(px) {
    var panel = $('nav-route');
    if (panel) panel.style.setProperty('--nav-y', Math.round(px) + 'px');
  }
  function setRouteFolded(folded) {
    var panel = $('nav-route'), wrap = document.querySelector('.nav-map-wrap'), hd = $('nav-route-handle');
    if (!panel) return;
    panel.classList.toggle('is-collapsed', folded);
    setPanelY(folded ? foldOffset() : 0);
    if (wrap) wrap.classList.toggle('route-collapsed', folded);
    if (wrap && driving) wrap.classList.toggle('dirs-open', !folded);
    if (hd) hd.setAttribute('aria-expanded', folded ? 'false' : 'true');
  }

  function init() {
    var btn = $('nav-unit');
    // Navigate starts in mph. Its own saved choice (not the RaceBox page's) is kept, so changing one does not change the other.
    try { mph = localStorage.getItem('mt3ukNavigateUnit') !== 'kmh'; } catch (e) { mph = true; }
    if (btn) btn.addEventListener('click', function () {
      mph = !mph;
      try { localStorage.setItem('mt3ukNavigateUnit', mph ? 'mph' : 'kmh'); } catch (e) { /* storage blocked */ }
      showSpeed();
      showDistances();
    });
    var handle = $('nav-route-handle');
    // Tapping the handle folds or opens the route panel. Pressing and dragging on the handle, the Drive heading or the
    // summary moves the panel with the finger. On release a swipe of 40 px or more opens or folds it, and a shorter
    // drag settles to the nearer state.
    var swipe = null, swipedAt = 0;
    function toggleRoute() {
      var panel = $('nav-route');
      if (panel) setRouteFolded(!panel.classList.contains('is-collapsed'));
    }
    function dragStart(e) {
      if (e.button) return;
      // A button inside the summary (Start route) is left to its own click, which the pointer capture below would take.
      var btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (btn && btn !== e.currentTarget) return;
      var panel = $('nav-route');
      if (!panel) return;
      var folded = panel.classList.contains('is-collapsed');
      swipe = { y: e.clientY, id: e.pointerId, base: folded ? foldOffset() : 0, fold: foldOffset(), moved: false };
      panel.classList.add('is-dragging');
      if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    }
    function dragMove(e) {
      if (!swipe || e.pointerId !== swipe.id) return;
      var dy = e.clientY - swipe.y;
      if (Math.abs(dy) > 4) swipe.moved = true;
      setPanelY(Math.min(swipe.fold, Math.max(0, swipe.base + dy)));
    }
    function dragEnd(e) {
      if (!swipe || e.pointerId !== swipe.id) return;
      var s = swipe;
      swipe = null;
      var dy = e.clientY - s.y;
      var y = Math.min(s.fold, Math.max(0, s.base + dy));
      $('nav-route').classList.remove('is-dragging');
      var folded;
      if (dy <= -40) folded = false;
      else if (dy >= 40) folded = true;
      else folded = y > s.fold / 2;
      setRouteFolded(folded);
      if (s.moved) swipedAt = Date.now();
    }
    function dragCancel() {
      if (!swipe) return;
      swipe = null;
      var panel = $('nav-route');
      if (panel) { panel.classList.remove('is-dragging'); setRouteFolded(panel.classList.contains('is-collapsed')); }
    }
    if (handle) {
      handle.addEventListener('click', function () {
        // A swipe also ends in a click on some browsers; the swipe has already done the work.
        if (Date.now() - swipedAt < 400) return;
        toggleRoute();
      });
      [handle, document.querySelector('#nav-route .nav-route-head'), document.querySelector('#nav-route .nav-route-summary')].forEach(function (el) {
        if (!el) return;
        el.addEventListener('pointerdown', dragStart);
        el.addEventListener('pointermove', dragMove);
        el.addEventListener('pointerup', dragEnd);
        el.addEventListener('pointercancel', dragCancel);
      });
    }
    var vb = makeVoiceButton();
    if (vb) setVoiceButton();
    var mapEl = $('nav-map');
    if (mapEl) {
      mapEl.addEventListener('pointerdown', gestureDown);
      mapEl.addEventListener('pointermove', gestureMove);
      mapEl.addEventListener('pointerup', gestureUp);
      mapEl.addEventListener('pointercancel', gestureUp);
    }
    var st = $('nav-start'), ex = $('nav-exit');
    if (st) st.addEventListener('click', startDrive);
    if (ex) ex.addEventListener('click', stopDrive);
    var rc = $('nav-recentre');
    if (rc) rc.addEventListener('click', function () {
      if (driving) return recentreDrive();
      if (map && lastFix) map.setView([lastFix.lat, lastFix.lng], map.getZoom(), { animate: true });
    });
    var dirs = $('nav-dirs');
    if (dirs) dirs.addEventListener('click', function () {
      // The directions fly up from the bottom; the bottom bar gives way to them until they are folded again.
      var panel = $('nav-route');
      if (panel) setRouteFolded(!panel.classList.contains('is-collapsed'));
    });
    var go = $('nav-go'), add = $('nav-add-stop');
    if (go) go.addEventListener('click', askRoute);
    if (add) add.addEventListener('click', addStop);
    var pinBtn = $('nav-pin'), pinUse = $('nav-pin-use'), pinCancel = $('nav-pin-cancel'), stopsEl = $('nav-stops');
    if (pinBtn) pinBtn.addEventListener('click', startPin);
    if (pinUse) pinUse.addEventListener('click', usePin);
    if (pinCancel) pinCancel.addEventListener('click', endPin);
    if (stopsEl) stopsEl.addEventListener('focusin', function (e) {
      if (!e.target.dataset || e.target.dataset.i === undefined) return;
      activeStop = Number(e.target.dataset.i);
      if (!e.target.value.trim()) showRecent();
    });
    renderStops();
    approved().then(function (ok) {
      if (!ok) return;
      loadLocalPlaces(); // the addresses are loaded before the first search
      $('nav-gate').hidden = true;
      $('nav-body').hidden = false;
      start();
    });
  }

  // Destination and route. A place name is looked up on OpenStreetMap (one search per press, not per letter); a position typed
  // as lat, lng is used as it is. The route itself comes from the worker, which keeps the OpenRouteService key.
  var WORKER = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var dest = null, routeLayer = null, destMarker = null;
  function session() { try { return localStorage.getItem('mt3ukMyBuildsSession') || ''; } catch (e) { return ''; } }
  function parseCoords(q) {
    var m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    var a = +m[1], b = +m[2];
    return (Math.abs(a) <= 90 && Math.abs(b) <= 180) ? [a, b] : null;
  }
  function setRouteMsg(t, bad) {
    var el = $('nav-route-msg');
    if (!el) return;
    el.textContent = t;
    el.hidden = !t;
    el.classList.toggle('is-bad', !!bad);
  }
  // Places come from Photon (komoot.io), which matches a part-typed last word, so "Leic" finds Leicester. Biased to the
  // area around the phone (not restricted to it); in the UK only UK places are suggested; the nearest come first.
  function photonPlaces(q) {
    var url = 'https://photon.komoot.io/api/?lang=en&limit=8&q=' + encodeURIComponent(q);
    if (lastFix) {
      var la = lastFix.lat, lo = lastFix.lng;
      url += '&lat=' + la + '&lon=' + lo + '&location_bias_scale=0.5';
      if (la >= 49.8 && la <= 60.9 && lo >= -8.7 && lo <= 1.9) url += '&countrycode=gb';
    }
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : { features: [] }; })
      .then(function (d) {
        return ((d && d.features) || []).map(function (f) {
          var p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
          if (!c) return null;
          var seen = {}, names = [];
          var street = p.street ? (p.housenumber ? p.housenumber + ' ' + p.street : p.street) : '';
          [p.name, street, p.district || p.locality, p.city, p.county, p.country].forEach(function (x) {
            if (x && !seen[x]) { seen[x] = true; names.push(String(x)); }
          });
          var hay = [p.name, p.street, p.district, p.locality, p.city, p.county, p.postcode].filter(Boolean).join(' ').toLowerCase();
          return { name: names.join(', ').slice(0, 120), at: [+c[1], +c[0]], hay: hay, house: p.housenumber ? String(p.housenumber) : '' };
        }).filter(Boolean);
      });
  }
  // A query of several words is also sent with its last word on its own, because the other words (Tesla, say) can
  // crowd out the place the member means: "Tesla Leic" then still brings up Leicester.
  // How well a place matches what was typed: each word of the search that it contains (a street, a town), and a house
  // number that is the same as the one typed. Places that match more come first; the nearest breaks a tie.
  function matchScore(p, q) {
    var words = String(q).toLowerCase().split(/[\s,]+/).filter(function (w) { return w.length > 1 && !/^\d+$/.test(w); });
    var nums = String(q).match(/\d+/g) || [];
    var n = words.filter(function (w) { return p.hay && p.hay.indexOf(w) >= 0; }).length;
    // A house number is a small help only: a street and a town typed together come before a house number alone.
    if (p.house && nums.indexOf(p.house) >= 0) n += 0.5;
    return n;
  }
  // Addresses the admin keeps for houses the map does not have (see track-admin.html, Navigate addresses). Loaded once
  // per page, for approved members; a failed load is tried again on the next search.
  var localPlaces = null;
  function loadLocalPlaces() {
    if (localPlaces !== null) return;
    localPlaces = [];
    fetch(WORKER + '/navigate/places', { headers: { 'X-Session-Token': session() } })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) { localPlaces = d && d.success && Array.isArray(d.places) ? d.places : []; })
      .catch(function () { localPlaces = null; });
  }
  function localMatches() {
    return (localPlaces || []).map(function (pl) {
      var label = (pl.house ? pl.house + ' ' : '') + (pl.name || '');
      var parts = [label, pl.town, pl.postcode].filter(Boolean);
      return {
        name: parts.join(', ').slice(0, 120),
        at: [+pl.lat, +pl.lng],
        hay: parts.join(' ').toLowerCase(),
        house: pl.house ? String(pl.house) : '',
        local: true
      };
    });
  }
  // Geoapify's address search (through the worker). Empty when it is not set up or does not answer, so Photon still works.
  function geoPlaces(q) {
    var url = WORKER + '/navigate/search?q=' + encodeURIComponent(q);
    if (lastFix) url += '&lat=' + lastFix.lat + '&lng=' + lastFix.lng;
    return fetch(url, { headers: { 'X-Session-Token': session() } })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (!d || !d.success || !Array.isArray(d.places)) return [];
        return d.places.map(function (p) {
          return { name: p.name, at: p.at, hay: [p.name, p.street, p.town, p.postcode].filter(Boolean).join(' ').toLowerCase(), house: p.house || '' };
        });
      })
      .catch(function () { return []; });
  }
  function findPlace(q) {
    loadLocalPlaces();
    var words = q.split(/\s+/), last = words[words.length - 1];
    var asks = [geoPlaces(q), photonPlaces(q)];
    if (words.length > 1 && last.length >= 3) asks.push(photonPlaces(last));
    return Promise.all(asks).then(function (lists) {
      lists.push(localMatches());
      var seen = {}, out = [];
      lists.forEach(function (list) {
        list.forEach(function (p) {
          var k = p.name.toLowerCase();
          if (!seen[k]) { seen[k] = true; out.push(p); }
        });
      });
      if (lastFix) out.forEach(function (p) { p.km = metresBetween([lastFix.lat, lastFix.lng], p.at) / 1000; });
      out.forEach(function (p) { p.score = matchScore(p, q); });
      // An address from the list is only offered when what was typed matches it.
      out = out.filter(function (p) { return !p.local || p.score > 0; });
      out.sort(function (a, b) { return (b.score - a.score) || (lastFix ? a.km - b.km : 0); });
      return out.slice(0, 5);
    });
  }
  // The route's stops, in order: the last one is the destination. Each has its own search line, with suggestions in
  // light grey while typing (after three letters and a short pause, so the place service is not asked on every key).
  var stops = [{ text: '', place: null }], wantRoute = false, activeStop = null, pinIndex = 0;
  var suggestTimer = null, suggestSeq = 0;
  var GRIP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.7" fill="currentColor"/><circle cx="15" cy="6" r="1.7" fill="currentColor"/><circle cx="9" cy="12" r="1.7" fill="currentColor"/><circle cx="15" cy="12" r="1.7" fill="currentColor"/><circle cx="9" cy="18" r="1.7" fill="currentColor"/><circle cx="15" cy="18" r="1.7" fill="currentColor"/></svg>';
  var X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function stopLabel(i) { return i === stops.length - 1 ? 'destination' : 'stop ' + (i + 1); }
  function renderStops() {
    var ul = $('nav-stops');
    if (!ul) return;
    ul.textContent = '';
    stops.forEach(function (st, i) {
      var last = i === stops.length - 1;
      var li = document.createElement('li');
      li.className = 'nav-stop';
      var grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'nav-grip';
      grip.innerHTML = GRIP_SVG;
      grip.setAttribute('aria-label', 'Move the ' + stopLabel(i));
      var input = document.createElement('input');
      input.type = 'search';
      input.className = 'field nav-stop-input';
      input.autocomplete = 'off';
      input.dataset.i = String(i);
      input.value = st.text;
      input.placeholder = last ? 'Where to? A place, a postcode, or lat, lng' : 'Add a stop: a place or postcode';
      input.setAttribute('aria-label', last ? 'Destination' : 'Stop ' + (i + 1));
      if (last) input.id = 'nav-to-q';
      input.addEventListener('input', onStopInput);
      input.addEventListener('keydown', onStopKey);
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'nav-stop-remove';
      rm.innerHTML = X_SVG;
      rm.setAttribute('aria-label', 'Remove the ' + stopLabel(i));
      rm.hidden = stops.length < 2;
      rm.addEventListener('click', function () { removeStop(i); });
      grip.addEventListener('pointerdown', function (e) { startMove(e, li, i); });
      li.appendChild(grip);
      li.appendChild(input);
      li.appendChild(rm);
      ul.appendChild(li);
    });
  }
  function onStopInput(e) {
    var i = Number(e.target.dataset.i), v = e.target.value;
    // Only text that really changed gives up the place chosen for the stop. Some keyboards send an input event with the
    // same text after a suggestion is picked, and that must not send the place back to a search.
    if (v !== stops[i].text) stops[i].place = null;
    stops[i].text = v;
    if (v.trim()) stops[i].typed = v;
    suggestWhileTyping(v, i);
  }
  function onStopKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearSuggestions();
    askRoute();
  }
  // Moving a stop: its grip is dragged up or down, and the stop lands where the finger lets go.
  function startMove(e, li, from) {
    if (e.button) return;
    var grip = e.currentTarget, ul = $('nav-stops'), startY = e.clientY, target = from, active = true;
    grip.setPointerCapture(e.pointerId);
    li.classList.add('is-moving');
    function move(ev) {
      if (!active) return;
      li.style.transform = 'translateY(' + (ev.clientY - startY) + 'px)';
      // The new place is the number of other stops whose middle is above the finger.
      var n = 0;
      [].slice.call(ul.children).forEach(function (r, j) {
        if (j === from) return;
        var b = r.getBoundingClientRect();
        if (b.top + b.height / 2 < ev.clientY) n++;
      });
      target = n;
    }
    function end() {
      if (!active) return;
      active = false;
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      li.classList.remove('is-moving');
      li.style.transform = '';
      if (target !== from) moveStop(from, target);
    }
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }
  // Pin on map: the map shows a pin in its middle; the member pans the map until the pin is on the place and taps Use
  // this point. The point becomes the stop last typed in (or the destination), with its position as the place.
  function startPin() {
    if (!map) return setRouteMsg('Wait for your phone to find its position, then pin the place on the map.', true);
    pinIndex = activeStop !== null && activeStop < stops.length ? activeStop : stops.length - 1;
    clearSuggestions();
    var wrap = document.querySelector('.nav-map-wrap'), pin = $('nav-pin-mode');
    if (wrap) wrap.classList.add('is-pinning');
    if (pin) pin.hidden = false;
    setRouteMsg('Move the map so the pin is on the place, then tap Use this point.');
    map.invalidateSize();
    if (wrap) wrap.scrollIntoView({ block: 'center' });
  }
  function endPin() {
    var wrap = document.querySelector('.nav-map-wrap'), pin = $('nav-pin-mode');
    if (wrap) wrap.classList.remove('is-pinning');
    if (pin) pin.hidden = true;
    setRouteMsg('');
  }
  function usePin() {
    if (!map) return endPin();
    var c = map.getCenter(), i = pinIndex;
    var place = { name: 'Pinned point, ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5), at: [c.lat, c.lng] };
    endPin();
    choose(place, i);
  }
  function addStop() {
    stops.splice(stops.length - 1, 0, { text: '', place: null });
    renderStops();
    var inputs = document.querySelectorAll('#nav-stops .nav-stop-input');
    if (inputs.length > 1) inputs[inputs.length - 2].focus();
  }
  function removeStop(i) {
    if (stops.length < 2) return;
    stops.splice(i, 1);
    renderStops();
    if (wantRoute) routeNow(); else clearSuggestions();
  }
  function moveStop(from, to) {
    var st = stops.splice(from, 1)[0];
    stops.splice(to, 0, st);
    renderStops();
    if (wantRoute) routeNow();
  }
  function showSuggestions(list, i) {
    var ul = $('nav-results');
    ul.textContent = '';
    ul.classList.add('is-suggest');
    list.forEach(function (p) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.name;
      var s = distanceSmall(p);
      if (s) b.appendChild(s);
      b.addEventListener('click', function () { choose(p, i); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  function clearSuggestions() {
    var ul = $('nav-results');
    if (ul) { ul.textContent = ''; ul.classList.remove('is-suggest', 'is-recent'); }
  }
  // Recent searches: the words and numbers typed for a destination or stop, kept on this device (up to five).
  var RECENT_KEY = 'mt3ukNavigateRecent', RECENT_MAX = 5;
  function recentSearches() {
    try {
      var a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x; }) : [];
    } catch (e) { return []; }
  }
  function saveRecent(text) {
    var t = String(text || '').trim().slice(0, 120);
    if (t.length < 2) return;
    var list = recentSearches().filter(function (x) { return x.toLowerCase() !== t.toLowerCase(); });
    list.unshift(t);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch (e) { /* storage blocked */ }
  }
  function showRecent() {
    var list = recentSearches(), ul = $('nav-results');
    if (!ul || !list.length) return;
    ul.textContent = '';
    ul.classList.add('is-recent');
    list.forEach(function (t) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.addEventListener('click', function () { useRecent(t); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    var li2 = document.createElement('li'), clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'nav-recent-clear';
    clr.textContent = 'Clear recent searches';
    clr.addEventListener('click', function () {
      try { localStorage.removeItem(RECENT_KEY); } catch (e) { /* storage blocked */ }
      clearSuggestions();
    });
    li2.appendChild(clr);
    ul.appendChild(li2);
  }
  // A recent search put back in the stop it was typed into, with its suggestions.
  function useRecent(t) {
    var i = activeStop !== null && activeStop < stops.length ? activeStop : stops.length - 1;
    stops[i].text = t;
    stops[i].place = null;
    stops[i].typed = t;
    renderStops();
    var input = document.querySelector('#nav-stops .nav-stop-input[data-i="' + i + '"]');
    if (input) { input.focus(); input.setSelectionRange(t.length, t.length); }
    suggestWhileTyping(t, i);
  }
  function suggestWhileTyping(text, i) {
    clearTimeout(suggestTimer);
    var q = String(text || '').trim();
    // Four letters and a longer pause before the place services are asked, so each search costs fewer of the daily credits.
    if (q.length < 4 || parseCoords(q)) { suggestSeq++; clearSuggestions(); return; }
    suggestTimer = setTimeout(function () {
      var my = ++suggestSeq;
      findPlace(q).then(function (list) {
        if (my !== suggestSeq) return;
        if (list.length) showSuggestions(list, i); else clearSuggestions();
      }).catch(function () { if (my === suggestSeq) clearSuggestions(); });
    }, 800);
  }
  // A suggestion chosen for a stop. Once a route has been asked for, it is worked out again with the new stop.
  function choose(p, i) {
    saveRecent(stops[i].typed || stops[i].text);
    stops[i].place = p;
    stops[i].text = p.name;
    if (i === stops.length - 1) wantRoute = true;
    clearSuggestions();
    renderStops();
    if (wantRoute) routeNow();
  }
  function showResults(list, i) {
    var ul = $('nav-results');
    ul.textContent = '';
    list.forEach(function (p) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.name;
      var s = distanceSmall(p);
      if (s) b.appendChild(s);
      b.addEventListener('click', function () { choose(p, i); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  function askRoute() {
    wantRoute = true;
    stops.forEach(function (st) { saveRecent(st.typed); });
    clearTimeout(suggestTimer);
    suggestSeq++; // a suggestion still on its way must not appear after the route is asked for
    clearSuggestions();
    routeNow();
  }
  // Works out where a stop is: a place already chosen, a position typed as lat, lng, or the first match for the text
  // (or the member picks one when there are several).
  function resolveStop(i) {
    var st = stops[i], q = String(st.text || '').trim();
    if (st.place) return Promise.resolve(st.place);
    if (!q) return Promise.reject(new Error('Add a place for the ' + stopLabel(i) + ', or remove it.'));
    var at = parseCoords(q);
    if (at) { st.place = { name: at[0].toFixed(5) + ', ' + at[1].toFixed(5), at: at }; return Promise.resolve(st.place); }
    setRouteMsg('Looking for ' + (i === stops.length - 1 ? 'that place' : 'stop ' + (i + 1)) + '...');
    return findPlace(q).then(function (list) {
      if (!list.length) throw new Error('No place found for the ' + stopLabel(i) + '. Try a postcode, or lat, lng.');
      if (list.length === 1) { st.place = list[0]; st.text = list[0].name; return st.place; }
      setRouteMsg('Pick the right place for the ' + stopLabel(i) + ':');
      showResults(list, i);
      var pick = new Error('pick');
      pick.pick = true;
      throw pick;
    });
  }
  // Every stop in order, then the route through them.
  function routeNow() {
    wantRoute = true;
    var chain = Promise.resolve();
    stops.forEach(function (_, i) { chain = chain.then(function () { return resolveStop(i); }); });
    chain.then(function () {
      dest = stops[stops.length - 1].place;
      renderStops();
      routeTo();
    }).catch(function (e) { if (!e.pick) setRouteMsg(e.message, true); });
  }
  // The stops still ahead: the ones the phone is not already at.
  function stopsAhead() {
    return stops.slice(0, -1).map(function (st) { return st.place && st.place.at; }).filter(function (at) {
      return at && (!lastFix || metresBetween([lastFix.lat, lastFix.lng], at) > 60);
    });
  }
  function requestRoute() {
    return fetch(WORKER + '/navigate/route', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': session() }, body: JSON.stringify({ from: [lastFix.lat, lastFix.lng], to: dest.at, via: stopsAhead() }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && !!d.success, d: d }; }); });
  }
  function routeTo() {
    if (!dest) return;
    if (!lastFix) return setRouteMsg('Waiting for your phone’s position before a route can start.', true);
    reroutes = 0; // a new trip
    setRouteMsg('Working out the route...');
    requestRoute()
      .then(function (res) { if (!res.ok) return setRouteMsg(res.d.message || 'The route could not be worked out.', true); drawRoute(res.d); })
      .catch(function () { setRouteMsg('The route could not be worked out. Check the connection and try again.', true); });
  }
  function drawRoute(d, silent) {
    setRouteMsg('');
    loadLeaflet(function () {
      if (!map || !window.L) return;
      if (routeLayer) map.removeLayer(routeLayer);
      if (destMarker) map.removeLayer(destMarker);
      routeLayer = L.polyline(d.line, { color: '#1c6fd6', weight: 6, opacity: 0.85 }).addTo(map);
      destMarker = L.circleMarker(d.line[d.line.length - 1], { radius: 8, color: '#16233d', fillColor: '#e8542a', fillOpacity: 1 }).bindTooltip(dest.name).addTo(map);
      if (!silent && !driving) map.fitBounds(routeLayer.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [30, 260], maxZoom: 17 });
    });
    // A new route opens folded: the handle and Drive heading show, and the member taps the handle for the directions.
    $('nav-route').hidden = false;
    var wrap = document.querySelector('.nav-map-wrap');
    if (wrap) wrap.classList.add('has-route');
    // The search gives the whole address; the card shows the first two parts (the place and its town).
    set('nav-route-to', dest.name.split(', ').slice(0, 2).join(', '));
    routeD = d;
    spoken = {};
    renderRouteText();
    updateToGo();
    // Folded once the directions are in, so the folded height is measured with the full panel. A new route on the way
    // keeps the fold the member has chosen.
    if (!silent) setRouteFolded(true);
  }
  // The route's length and turns, in the unit now shown.
  function renderRouteText() {
    if (!routeD) return;
    var len = distText(routeD.distanceM) + ', about ' + Math.max(1, Math.round(routeD.durationS / 60)) + ' min';
    set('nav-route-len', len);
    set('nav-route-short', len);
    var ul = $('nav-steps');
    ul.textContent = '';
    (routeD.steps || []).slice(0, 15).forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s.text + ' (' + distText(s.distanceM) + ')';
      ul.appendChild(li);
    });
  }
  // The point on the route line nearest the phone: how far off the line it is, and where on the line that point is.
  // Null when there is no route line yet.
  function nearestOnRoute() { return lastFix ? routeNear([lastFix.lat, lastFix.lng]) : null; }
  // The nearest point of the route line to a point [lat, lng]: { d, q, i }, or null without a route.
  function routeNear(p) {
    var line = routeD && routeD.line;
    if (!line || line.length < 2) return null;
    var k = Math.cos(p[0] * Math.PI / 180), best = null;
    for (var i = 0; i < line.length - 1; i++) {
      var a = line[i], b = line[i + 1];
      // Flat picture over one short piece of road, with longitude scaled by the latitude.
      var ax = a[1] * k, ay = a[0], dx = b[1] * k - ax, dy = b[0] - ay;
      var len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, ((p[1] * k - ax) * dx + (p[0] - ay) * dy) / len2)) : 0;
      var q = [ay + t * dy, (ax + t * dx) / k];
      var d = metresBetween(p, q);
      if (!best || d < best.d) best = { d: d, q: q, i: i };
    }
    return best;
  }
  // The distance still to drive along the route line: from that nearest point to the end.
  function leftOnRoute() {
    var near = nearestOnRoute();
    if (!near) return null;
    var line = routeD.line;
    var left = metresBetween(near.q, line[near.i + 1]);
    for (var j = near.i + 1; j < line.length - 1; j++) left += metresBetween(line[j], line[j + 1]);
    return left;
  }

  // Rerouting: when the phone has been well off the line for a while, a new route is worked out from where it is now to
  // the same place. Each one costs a routing request, so there is a gap between them and a limit per trip. A new route
  // keeps the panel's fold and does not move the map.
  var REROUTE_OFF_M = 60, REROUTE_AFTER_MS = window.MT3UK_REROUTE_AFTER_MS || 10000;
  var REROUTE_GAP_MS = window.MT3UK_REROUTE_GAP_MS || 30000, REROUTE_MAX = 8;
  var offSince = 0, lastReroute = 0, reroutes = 0, rerouting = false;
  function checkOffRoute() {
    if (!routeD || !dest || !lastFix || rerouting) return;
    var near = nearestOnRoute();
    if (!near) return;
    if (near.d <= Math.max(REROUTE_OFF_M, lastFix.acc || 0)) { offSince = 0; return; }
    var now = Date.now();
    if (!offSince) offSince = now;
    if (now - offSince < REROUTE_AFTER_MS || now - lastReroute < REROUTE_GAP_MS || reroutes >= REROUTE_MAX) return;
    rerouteNow();
  }
  function rerouteNow() {
    rerouting = true;
    lastReroute = Date.now();
    offSince = 0;
    reroutes++;
    setRouteMsg('Off the route. Working out a new one...');
    requestRoute().then(function (res) {
      rerouting = false;
      if (!res.ok) return setRouteMsg('Could not work out a new route. Carry on, or try again.', true);
      drawRoute(res.d, true);
    }).catch(function () {
      rerouting = false;
      setRouteMsg('Could not work out a new route. Check the connection.', true);
    });
  }
  // The distance to go as the phone's position moves: along the route when there is one, else straight-line.
  // Off-route rerouting is not in this version.
  function updateToGo() {
    if (!dest || !lastFix) return;
    var left = leftOnRoute();
    var m = left !== null ? left : metresBetween([lastFix.lat, lastFix.lng], dest.at);
    set('nav-togo', distText(m));
  }
  window.MT3UKNavigate = { map: function () { return map; }, fix: function () { return lastFix; }, trailPoints: function () { return trail ? trail.getLatLngs().length : 0; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
