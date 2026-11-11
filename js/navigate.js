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

  // The car: a red arrow, wider than the route line, turned to the way the phone is heading.
  function carIcon() {
    return L.divIcon({ className: 'nav-car-wrap', iconSize: [48, 48], iconAnchor: [24, 24],
      html: '<div class="nav-car"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 L41 43 L24 34 L7 43 Z" fill="#e0301e" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round"/></svg></div>' });
  }
  // The arrow sits in the map, so it turns with the map: it is turned to the heading itself.
  function orientCar() {
    var el = marker && marker.getElement ? marker.getElement() : null;
    var car = el && el.querySelector('.nav-car');
    if (car) car.style.transform = 'rotate(' + (drawHeading !== null && driving ? drawHeading : (heading || 0)) + 'deg)';
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
    marker = L.marker([lat, lng], { icon: carIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
    // The map fills its box however the box was shown or sized when the map was made (the RaceBox can give the first fix
    // before the page has laid out), so the map is told whenever its box changes size.
    if (window.ResizeObserver) new ResizeObserver(function () { if (map) map.invalidateSize(); }).observe(el);
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
        var opts = { text: text, lang: 'en-GB', rate: 0.9, pitch: 1, volume: 1, queueStrategy: cancelFirst ? 0 : 1 };
        if (nativeVoice !== null) opts.voice = nativeVoice;
        n.speak(opts).catch(function () { /* the app could not speak */ });
        return;
      }
      if (cancelFirst) window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      u.rate = 0.9;
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
  // The turn itself, short enough to hear: "turn left", "turn right", "take the roundabout", or the instruction as it is.
  function turnWord(t) {
    var s = String(t || '');
    if (/roundabout/i.test(s)) return 'take the roundabout';
    if (/\bleft\b/i.test(s)) return 'turn left';
    if (/\bright\b/i.test(s)) return 'turn right';
    return lowerFirst(s);
  }
  function announce(cur, upcoming, toTurn, left) {
    var steps = routeD.steps || [], key = cur + ':';
    // Earlier than before, and the direction comes first, so there is time to hear it: half a mile or so out, then 200
    // yards, then "now". Commas give the voice a pause after each part.
    if (toTurn <= 800 && toTurn > 200 && !spoken[key + 'far']) { spoken[key + 'far'] = true; say('In ' + spokenDistance(toTurn) + ', ' + lowerFirst(upcoming) + '.'); }
    if (toTurn <= 200 && toTurn > 40 && !spoken[key + 'mid']) { spoken[key + 'mid'] = true; say('In ' + spokenDistance(toTurn) + ', ' + turnWord(upcoming) + '.'); }
    if (toTurn <= 40 && !spoken[key + 'near']) { spoken[key + 'near'] = true; say('Now, ' + turnWord(upcoming) + '.', true); }

  }

  // At the destination, once: "You have arrived at 12 Maple Close, Towcester." (the place's name as it was chosen).
  function arrived() {
    if (spoken.arrive) return;
    spoken.arrive = true;
    var where = dest && dest.name ? String(dest.name).replace(/\s+/g, ' ').trim() : '';
    // A place given only as coordinates is not worth saying aloud.
    if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(where)) where = '';
    say(where ? 'You have arrived at ' + where + '.' : 'You have arrived.');
  }
  // The turn card and the voice follow the next instruction: the one at the end of the step we are on, with the
  // distance to it.
  function updateDrive() {
    if (!driving || !routeD || !lastFix) return;
    var wrapEl = document.querySelector('.nav-map-wrap'), barEl = $('nav-drive-bar');
    if (wrapEl && barEl) wrapEl.style.setProperty('--bar', barEl.offsetHeight + 'px');
    // The turn card can take several lines, so what sits under it (the stepper, the toast) starts below its real bottom.
    var turnEl = $('nav-turn');
    if (wrapEl && turnEl) wrapEl.style.setProperty('--turn', (turnEl.offsetTop + turnEl.offsetHeight) + 'px');
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
    if (left < 25) { set('nav-turn-text', 'You have arrived'); set('nav-turn-dist', ''); turnArrow('straight'); arrived(); }
    else { set('nav-turn-text', upcoming); set('nav-turn-dist', 'in ' + distText(toTurn)); turnArrow(upcoming); announce(cur, upcoming, toTurn, left); }
    var secs = routeD.distanceM ? routeD.durationS * left / routeD.distanceM : 0;
    var arrive = new Date(Date.now() + secs * 1000);
    set('nav-eta', Math.max(1, Math.round(secs / 60)) + ' min');
    set('nav-left', distText(left) + ' \u00b7 ' + arrive.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    set('nav-speed-big', ($('nav-speed') || {}).textContent || '\u2013');
    set('nav-speed-big-unit', mph ? 'mph' : 'km/h');
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
    orientCar();
    // Every frame while driving, so the dot keeps moving between the fixes.
    frame = requestAnimationFrame(stepFrame);
  }
  function startFrames() { if (!frame && driving) frame = requestAnimationFrame(stepFrame); }

  // A short message over the map, for example while rerouting.
  var toastTimer = null;
  function showToast(text) {
    var t = $('nav-toast');
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3000);
  }
  function startDrive() {
    if (!routeD || !map) return;
    driving = true;
    // The speaker always shows while driving. On a phone with no voice it is greyed out and says so when tapped.
    var vbtn = $('nav-voice');
    if (vbtn) vbtn.style.display = 'flex';
    pickNativeVoice();
    if (trail) trail.setStyle({ opacity: 0 });
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
    if (trail) trail.setStyle({ opacity: 1 });
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
  // Pointer moves are collected and applied once per animation frame, so the map redraws at the screen's rate rather than
  // at the touch rate, which is much faster on newer phones and made the pan and zoom jerky.
  var gestureFrame = null, gesturePan = [0, 0];
  function gestureMove(e) {
    if (!driving || !map || !touches[e.pointerId] || !gesture) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (gesture.mode === 'pan' && Object.keys(touches).length === 1) {
      var dx = e.clientX - gesture.last.x, dy = e.clientY - gesture.last.y;
      gesture.last = { x: e.clientX, y: e.clientY };
      gesturePan = [gesturePan[0] + dx, gesturePan[1] + dy];
    }
    if (!gestureFrame) gestureFrame = requestAnimationFrame(applyGesture);
  }
  function applyGesture() {
    gestureFrame = null;
    if (!driving || !map || !gesture) { gesturePan = [0, 0]; return; }
    if (gesture.mode === 'pan' && Object.keys(touches).length === 1) {
      var d = turnedDelta(gesturePan[0], gesturePan[1]);
      gesturePan = [0, 0];
      if (d[0] || d[1]) quietly(function () { map.panBy([-d[0], -d[1]], { animate: false }); });
    } else if (gesture.mode === 'pinch') {
      var pts = Object.keys(touches).map(function (id) { return touches[id]; });
      if (pts.length < 2) return;
      quietly(function () { map.setZoom(gesture.z0 + Math.log(dist2(pts[0], pts[1]) / gesture.d0) / Math.LN2, { animate: false }); });
      viewTurn = gesture.t0 + (angle2(pts[0], pts[1]) - gesture.a0);
      applyRotation();
    }
  }
  function gestureUp(e) {
    // Any move not yet applied is applied before the finger lifts, so the last movement is not lost.
    if (gestureFrame) { cancelAnimationFrame(gestureFrame); applyGesture(); }
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
    // The phone's GPS is used only while the RaceBox is not giving readings.
    if (raceboxOn && Date.now() - rbLastAt < 3000) return;
    applyFix(p.coords, p.timestamp);
  }
  // One position, from the phone or the RaceBox: the speed, the map, the turns and the route all follow it.
  function applyFix(c, ts) {
    lastFix = { lat: c.latitude, lng: c.longitude, t: ts, acc: c.accuracy };
    if (pendingTo && !driving) {
      var go = pendingTo;
      pendingTo = null;
      stops = [{ text: go.name, typed: go.name, place: { name: go.name, at: go.at } }];
      wantRoute = true;
      renderStops();
      routeNow();
    }
    updateToGo();
    checkOffRoute();
    if (!raceboxOn) status('Your phone has a fix.');
    // Anything under 1 km/h (about 0.6 mph) shows as stopped, so walking pace shows. Parked GPS speed can still wander above this.
    if (c.speed != null && !isNaN(c.speed)) { lastKph = c.speed * 3.6 < 1 ? 0 : c.speed * 3.6; showSpeed(); }
    else { set('nav-speed', '–'); }
    // The direction of travel is only trusted while moving (above about 2 km/h).
    if (c.heading != null && !isNaN(c.heading) && lastKph > 2) heading = c.heading;
    orientCar();
    if (c.heading != null && !isNaN(c.heading)) {
      set('nav-card', compass(c.heading));
      set('nav-deg', Math.round(c.heading) + '°');
    }
    set('nav-pos', c.latitude.toFixed(6) + ', ' + c.longitude.toFixed(6));
    set('nav-acc', 'within ' + Math.round(c.accuracy) + ' m');
    var when = new Date(ts || Date.now());
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
    // Folded, the handle, the heading and the trip with Start route are shown; the directions are not.
    var summary = panel.querySelector('.nav-route-summary');
    var h = hd.offsetHeight + head.offsetHeight + (summary ? summary.offsetHeight : 0);
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
    showStepper();
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
    // The handle on the bottom bar while driving: a tap, or a swipe up, brings the directions up over the map.
    var dh = $('nav-drive-handle');
    if (dh) {
      var dStart = null, dSwiped = false;
      dh.addEventListener('pointerdown', function (e) { dStart = e.clientY; dSwiped = false; });
      dh.addEventListener('pointermove', function (e) {
        if (dStart !== null && dStart - e.clientY > 30) { dSwiped = true; dStart = null; setRouteFolded(false); }
      });
      dh.addEventListener('pointerup', function () { dStart = null; });
      dh.addEventListener('pointercancel', function () { dStart = null; });
      dh.addEventListener('click', function () {
        if (dSwiped) { dSwiped = false; return; }
        setRouteFolded(false);
      });
    }
    var lb = $('nav-launch');
    if (lb) lb.addEventListener('click', launchTap);
    if ($('nav-clear')) $('nav-clear').addEventListener('click', clearEverything);
    if ($('nav-step-prev')) $('nav-step-prev').addEventListener('click', function () { moveStep(-1); });
    if ($('nav-step-next')) $('nav-step-next').addEventListener('click', function () { moveStep(1); });
    if ($('nav-step-close')) $('nav-step-close').addEventListener('click', closeStep);
    startRaceBox();
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
    var go = $('nav-go');
    if (go) go.addEventListener('click', askRoute);
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
  // In the Laps app a connected RaceBox gives the position and speed, about 25 times a second, instead of the phone's GPS.
  var raceboxOn = false, rbLastAt = 0;
  function startRaceBox() {
    if (!window.MT3UKRaceBoxApp || !window.MT3UKRaceBoxApp.available) return;
    window.MT3UKRaceBoxApp.onReading(function (r) {
      if (!r || !r.fixOk || !r.coordinatesValid) return;
      rbLastAt = Date.now();
      if (!raceboxOn) { raceboxOn = true; status('Using the RaceBox for position and speed.'); var lb = $('nav-launch'); if (lb) lb.hidden = false; }
      var c = { latitude: r.lat, longitude: r.lon, speed: r.speedMs, heading: r.heading, accuracy: r.horizontalAccuracy };
      applyFix(c, r.utc);
      launchStep(c.speed, r.utc);
    });
  }
  // The 0 to 60 mph timer, on the RaceBox's speed. Armed, it starts when the car first moves above 1 mph, and stops at 60.
  var launch = { state: 'idle', t0: 0, best: null, last: null };
  function setLaunchText(t) { var b = $('nav-launch'); if (b) b.textContent = t; }
  function launchStep(speedMs, ts) {
    var mph = speedMs * 2.23694;
    if (launch.state === 'armed' && mph > 1) { launch.state = 'running'; launch.t0 = ts; }
    if (launch.state === 'running') {
      if (mph >= 60) {
        var t = (ts - launch.t0) / 1000;
        launch.state = 'done';
        launch.last = t;
        launch.best = launch.best === null || t < launch.best ? t : launch.best;
        setLaunchText('0\u201360: ' + t.toFixed(2) + ' s \u00b7 best ' + launch.best.toFixed(2));
      } else {
        setLaunchText(((ts - launch.t0) / 1000).toFixed(2) + ' s');
      }
    }
  }
  function launchTap() {
    if (launch.state === 'armed') { launch.state = 'idle'; setLaunchText('0\u201360 mph'); return; }
    launch.state = 'armed';
    setLaunchText('Ready \u2013 go when you move');
  }
  // A destination given in the address, from a Laps track: navigate.html?to=51.2085,-1.6055&name=Thruxton. It is routed
  // once the phone has a position.
  var pendingTo = (function () {
    try {
      var q = new URLSearchParams(location.search), m = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(q.get('to') || '');
      if (!m) return null;
      var at = [Number(m[1]), Number(m[2])];
      if (Math.abs(at[0]) > 90 || Math.abs(at[1]) > 180) return null;
      var name = String(q.get('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80) || at[0].toFixed(5) + ', ' + at[1].toFixed(5);
      return { name: name, at: at };
    } catch (e) { return null; }
  })();
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
      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'nav-add-stop';
      plus.innerHTML = PLUS_SVG;
      plus.setAttribute('aria-label', 'Add a stop before the ' + stopLabel(i));
      plus.addEventListener('click', function () { addStopAt(i); });
      var mic = document.createElement('button');
      mic.type = 'button';
      mic.className = 'nav-mic';
      mic.innerHTML = MIC_SVG;
      mic.setAttribute('aria-label', 'Say the ' + stopLabel(i));
      mic.setAttribute('aria-pressed', 'false');
      mic.hidden = !voiceInputAvailable();
      mic.addEventListener('click', function () { dictate(i, mic); });
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
      li.appendChild(plus);
      li.appendChild(mic);
      li.appendChild(rm);
      ul.appendChild(li);
    });
  }
  // Voice input for a place: the phone's speech turns what is said into the box, and the place is then looked up as typed.
  // The button only shows where the phone or browser can do it.
  var MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var listening = null;
  // In the Laps app the web view can show the microphone, but it cannot listen until the app has the speech plugin and
  // the microphone permission, so the microphone is left out there.
  function inLapsApp() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  // In the Laps app the speech plugin listens; the plugin asks for the microphone the first time.
  function nativeMic() {
    if (!inLapsApp() || !window.Capacitor.Plugins) return null;
    return window.Capacitor.Plugins.SpeechRecognition || null;
  }
  function voiceInputAvailable() { return !!nativeMic() || (!!Rec && !inLapsApp()); }
  var nativeListening = false;
  function dictateNative(i, btn) {
    var sr = nativeMic();
    if (nativeListening) { sr.stop(); return; }
    var input = document.querySelector('#nav-stops .nav-stop-input[data-i="' + i + '"]');
    nativeListening = true;
    btn.classList.add('is-listening');
    btn.setAttribute('aria-pressed', 'true');
    setRouteMsg('Listening. Say the place.');
    Promise.resolve(sr.requestPermissions()).then(function (p) {
      if (!p || (p.speechRecognition !== 'granted' && p.speechRecognition !== undefined)) throw new Error('denied');
      return sr.start({ language: 'en-GB', maxResults: 1, partialResults: false, popup: false });
    }).then(function (r) {
      var text = r && r.matches && r.matches[0] ? String(r.matches[0]).trim() : '';
      if (input && text) { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); setRouteMsg(''); }
      else setRouteMsg("Didn't catch that. Try again, or type the place.", true);
    }).catch(function () {
      setRouteMsg('Allow the microphone for Laps in the phone settings, then try again. Or type the place.', true);
    }).then(function () {
      nativeListening = false;
      btn.classList.remove('is-listening');
      btn.setAttribute('aria-pressed', 'false');
    });
  }
  function dictate(i, btn) {
    if (nativeMic()) return dictateNative(i, btn);
    if (listening) { listening.stop(); return; }
    if (!Rec) return;
    var input = document.querySelector('#nav-stops .nav-stop-input[data-i="' + i + '"]');
    var rec = new Rec();
    rec.lang = 'en-GB';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    listening = rec;
    btn.classList.add('is-listening');
    btn.setAttribute('aria-pressed', 'true');
    setRouteMsg('Listening. Say the place.');
    rec.onresult = function (e) {
      var text = '';
      for (var k = 0; k < e.results.length; k++) text += e.results[k][0].transcript;
      if (!input) return;
      input.value = text.trim();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rec.onerror = function (e) {
      var denied = e && (e.error === 'not-allowed' || e.error === 'service-not-allowed');
      setRouteMsg(denied ? 'Allow the microphone for this site, then try again. Or type the place.' : "Didn't catch that. Try again, or type the place.", true);
    };
    rec.onend = function () {
      listening = null;
      btn.classList.remove('is-listening');
      btn.setAttribute('aria-pressed', 'false');
      if (input && input.value.trim()) setRouteMsg('');
    };
    try { rec.start(); } catch (err) { listening = null; btn.classList.remove('is-listening'); setRouteMsg('Voice input could not start. Type the place instead.', true); }
  }
  function onStopInput(e) {
    var i = Number(e.target.dataset.i), v = e.target.value;
    // Only text that really changed gives up the place chosen for the stop. Some keyboards send an input event with the
    // same text after a suggestion is picked, and that must not send the place back to a search.
    if (v !== stops[i].text) {
      stops[i].place = null;
      if (routeD) clearRoute();
    }
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
  // The + beside a field adds a stop just before that field: the one beside the destination adds a stop on the way.
  var PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  function addStopAt(i) {
    if (stops.length >= 6) return setRouteMsg('There can be up to five stops on the way.', true);
    stops.splice(i, 0, { text: '', place: null });
    renderStops();
    var input = document.querySelector('#nav-stops .nav-stop-input[data-i="' + i + '"]');
    if (input) input.focus();
  }
  function removeStop(i) {
    if (stops.length < 2) return;
    stops.splice(i, 1);
    renderStops();
    if (routeD) clearRoute();
    clearSuggestions();
  }
  function moveStop(from, to) {
    var st = stops.splice(from, 1)[0];
    stops.splice(to, 0, st);
    renderStops();
    if (routeD) clearRoute();
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
    clearSuggestions();
    renderStops();
    // The route on the map no longer matches the stop, so it is taken away until Route is pressed again.
    if (routeD) clearRoute();
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
  // The names of the stops still ahead, in the order they are visited, for the directions to show.
  function stopNamesAhead() {
    return stops.slice(0, -1).filter(function (st) {
      return st.place && st.place.at && (!lastFix || metresBetween([lastFix.lat, lastFix.lng], st.place.at) > 60);
    }).map(function (st) { return st.place.name || ''; });
  }
  function requestRoute() {
    var names = stopNamesAhead();
    return fetch(WORKER + '/navigate/route', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': session() }, body: JSON.stringify({ from: [lastFix.lat, lastFix.lng], to: dest.at, via: stopsAhead() }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (d && d.success) d.viaNames = names; return { ok: r.ok && !!d.success, d: d }; }); });
  }
  // Takes the route away: the line, the destination mark, the turn selection and the Drive panel. Nothing is asked of the
  // server, and a new route needs Route to be pressed.
  function clearRoute() {
    routeD = null;
    dest = null;
    wantRoute = false;
    if (routeLayer && map) { map.removeLayer(routeLayer); routeLayer = null; }
    if (destMarker && map) { map.removeLayer(destMarker); destMarker = null; }
    closeStep();
    var panel = $('nav-route');
    if (panel) panel.hidden = true;
    setRouteMsg('');
    updateClearButton();
  }
  function updateClearButton() { var b = $('nav-clear'); if (b) b.hidden = !routeD; }
  function clearEverything() {
    clearRoute();
    stops = [{ text: '', place: null }];
    renderStops();
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
      routeLayer = L.featureGroup([
        L.polyline(d.line, { color: '#ffffff', weight: 17, opacity: 1, lineCap: 'round', lineJoin: 'round' }),
        L.polyline(d.line, { color: '#1c6fd6', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round' })
      ]).addTo(map);
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
  // Where a step starts on the route line: walk along the line by the distance the steps before it cover.
  function stepStartPoint(i) {
    var line = routeD && routeD.line, steps = (routeD && routeD.steps) || [];
    if (!line || line.length < 2 || i < 0 || i >= steps.length) return null;
    var want = 0;
    for (var k = 0; k < i; k++) want += steps[k].distanceM || 0;
    var acc = 0;
    for (var j = 0; j < line.length - 1; j++) {
      var seg = metresBetween(line[j], line[j + 1]);
      if (acc + seg >= want) {
        var t = seg ? (want - acc) / seg : 0;
        return [line[j][0] + (line[j + 1][0] - line[j][0]) * t, line[j][1] + (line[j + 1][1] - line[j][1]) * t];
      }
      acc += seg;
    }
    return line[line.length - 1];
  }
  // Tapping a step shows where it is: the map moves to it, a mark sits on it, and the directions step aside.
  var stepMark = null, stepIndex = null;
  function stepCount() { return routeD && routeD.steps ? routeD.steps.length : 0; }
  function showStep(i, li) {
    var p = stepStartPoint(i);
    if (!p || !map) return;
    stepIndex = i;
    var all = document.querySelectorAll('#nav-steps .nav-step');
    all.forEach(function (el, k) { el.classList.toggle('is-active', k === i); });
    if (!li && all[i]) li = all[i];
    if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    enterBrowse();
    setRouteFolded(true);
    if (!stepMark) stepMark = L.circleMarker(p, { radius: 9, color: '#ffffff', weight: 3, fillColor: '#e8542a', fillOpacity: 1 }).addTo(map);
    else stepMark.setLatLng(p);
    map.setView(p, Math.max(map.getZoom(), 17), { animate: true });
    showStepper();
  }
  // The stepper: back and forward through the turns from the one shown, and its number out of all of them.
  function showStepper() {
    var box = $('nav-stepper');
    if (!box) return;
    var n = stepCount();
    // Over the open directions list it would cover the list, so it shows once the list is folded.
    var pn = $('nav-route'), listOpen = !!(pn && !pn.hidden && !pn.classList.contains('is-collapsed'));
    box.hidden = stepIndex === null || n === 0 || listOpen;
    var st = stepIndex !== null && routeD && routeD.steps ? routeD.steps[stepIndex] : null;
    set('nav-step-text', st ? st.text : '');
    var ico = $('nav-step-icon');
    if (ico) ico.innerHTML = st ? stepIconSvg(st.text) : '';
    set('nav-step-label', 'Turn ' + (stepIndex + 1) + ' of ' + n);
    var prev = $('nav-step-prev'), next = $('nav-step-next');
    if (prev) prev.disabled = stepIndex === null || stepIndex <= 0;
    if (next) next.disabled = stepIndex === null || stepIndex >= n - 1;
  }
  function closeStep() {
    stepIndex = null;
    document.querySelectorAll('#nav-steps .nav-step').forEach(function (el) { el.classList.remove('is-active'); });
    if (stepMark && map) { map.removeLayer(stepMark); stepMark = null; }
    showStepper();
  }
  function moveStep(d) {
    if (stepIndex === null) return;
    var i = stepIndex + d;
    if (i >= 0 && i < stepCount()) showStep(i);
  }
  // The icon for a step: a turn left or right, straight on, a roundabout or the destination.
  function stepIconSvg(text) {
    var t = String(text || '');
    var key = /roundabout/i.test(t) ? 'roundabout' : /arriv|destination/i.test(t) ? 'arrive' : /\bleft\b/i.test(t) ? 'left' : /\bright\b/i.test(t) ? 'right' : 'straight';
    var inner = key === 'roundabout' ? '<circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'
      : key === 'arrive' ? '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>'
      : '<path d="' + ARROWS[key] + '"/>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  function renderRouteText() {
    updateClearButton();
    if (!routeD) return;
    closeStep(); // a new route starts with no turn selected
    var len = distText(routeD.distanceM) + ', about ' + Math.max(1, Math.round(routeD.durationS / 60)) + ' min';
    set('nav-route-len', len);
    set('nav-route-short', len);
    var ul = $('nav-steps');
    ul.textContent = '';
    // Each step: its icon, its instruction, and the distance on to the next one, as Google Maps lists them.
    var stopAfter = routeD.stopAfter || [], viaNames = routeD.viaNames || [];
    function stopRow(k) {
      // A stop on the way: its name, and a tap shows where it is, as for a turn.
      var row = document.createElement('li');
      row.className = 'nav-stop-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.innerHTML = '<span class="nav-step-icon">' + stepIconSvg('Arrive at stop') + '</span>';
      var label = document.createElement('span');
      label.textContent = 'Stop ' + (k + 1) + ': ' + (viaNames[k] || 'stop ' + (k + 1));
      row.appendChild(label);
      var at = stopAfter[k];
      row.addEventListener('click', function () { showStep(at); });
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showStep(at); } });
      return row;
    }
    (routeD.steps || []).slice(0, 15).forEach(function (st, index) {
      stopAfter.forEach(function (after, k) { if (after === index) ul.appendChild(stopRow(k)); });
      var li = document.createElement('li');
      li.className = 'nav-step';
      var icon = document.createElement('span');
      icon.className = 'nav-step-icon';
      icon.innerHTML = stepIconSvg(st.text);
      var main = document.createElement('span');
      main.className = 'nav-step-main';
      var text = document.createElement('span');
      text.className = 'nav-step-text';
      text.textContent = st.text;
      var dist = document.createElement('span');
      dist.className = 'nav-step-dist';
      dist.textContent = distText(st.distanceM);
      main.appendChild(text);
      main.appendChild(dist);
      li.appendChild(icon);
      li.appendChild(main);
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', st.text + '. Show it on the map.');
      li.addEventListener('click', function () { showStep(index, li); });
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showStep(index, li); } });
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
  var REROUTE_OFF_M = 45, REROUTE_AFTER_MS = window.MT3UK_REROUTE_AFTER_MS || 4000;
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
    showToast('Rerouting...');
    requestRoute().then(function (res) {
      rerouting = false;
      if (!res.ok) return setRouteMsg('Could not work out a new route. Carry on, or try again.', true);
      drawRoute(res.d, true);
      showToast('New route. Follow the blue line.');
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
  window.MT3UKNavigate = { map: function () { return map; }, fix: function () { return lastFix; }, trailPoints: function () { return trail ? trail.getLatLngs().length : 0; }, stepPoint: function (i) { return stepStartPoint(i); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
