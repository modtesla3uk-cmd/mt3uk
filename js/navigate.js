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
    map = L.map(el).setView([lat, lng], 17);
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
    if (!driving || browsing) { el.style.transform = ''; return; }
    var turn = heading !== null ? -heading : 0;
    el.style.transform = 'perspective(2600px) rotateX(' + DRIVE_TILT + 'deg) rotate(' + turn + 'deg)';
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
  var DRIVE_ZOOM = 18;
  function userMoved() {
    if (!driving || programmatic || browsing) return;
    browsing = true;
    var wrap = drivingWrap();
    if (wrap) wrap.classList.add('is-browsing');
    applyRotation();
  }
  // Recentre: back on the phone, turned and tilted again.
  function recentreDrive() {
    browsing = false;
    var wrap = drivingWrap();
    if (wrap) wrap.classList.remove('is-browsing');
    followPhone(map ? map.getZoom() : DRIVE_ZOOM);
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
  function voiceAvailable() {
    return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';
  }
  function say(text, cancelFirst) {
    if (!voiceOn || !voiceAvailable() || !text) return;
    try {
      if (cancelFirst) window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      u.rate = 1;
      u.volume = 1;
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
  function startDrive() {
    if (!routeD || !map) return;
    driving = true;
    $('nav-route').classList.remove('is-dragging');
    var wrap = document.querySelector('.nav-map-wrap');
    if (wrap) wrap.classList.add('is-driving');
    setRouteFolded(true); // the directions start folded, and the directions button opens them
    browsing = false;
    if (wrap) wrap.classList.remove('is-browsing', 'dirs-open');
    map.invalidateSize();
    followPhone(DRIVE_ZOOM);
    applyRotation();
    spoken = {};
    if (routeD.steps && routeD.steps[0]) say(routeD.steps[0].text, true);
    updateDrive();
  }
  function stopDrive() {
    driving = false;
    browsing = false;
    var w0 = drivingWrap();
    if (w0) w0.classList.remove('is-browsing', 'dirs-open');
    if (voiceAvailable()) window.speechSynthesis.cancel();
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
  function setVoiceButton() {
    var b = $('nav-voice');
    if (!b) return;
    b.innerHTML = voiceOn ? VOICE_ON : VOICE_OFF;
    b.setAttribute('aria-pressed', voiceOn ? 'true' : 'false');
    b.setAttribute('aria-label', voiceOn ? 'Turn voice directions off' : 'Turn voice directions on');
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
      if (lastKph === 0 && shown) return;
      if (shown && metresBetween(shown, here) <= Math.max(6, c.accuracy || 0)) return;
      shown = here;
      marker.setLatLng(here);
      trail.addLatLng(here);
      if (!(driving && browsing)) quietly(function () { map.panTo(here, { animate: false }); });
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
  var driving = false, heading = null, DRIVE_TILT = 65;
  // Browsing: while driving, a press-and-drag or a pinch takes the map off the phone and flat, until Recentre.
  var browsing = false, programmatic = false;
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
    var vb = $('nav-voice');
    if (vb) {
      if (!voiceAvailable()) vb.hidden = true;
      setVoiceButton();
      vb.addEventListener('click', function () {
        voiceOn = !voiceOn;
        try { localStorage.setItem('mt3ukNavigateVoice', voiceOn ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
        if (!voiceOn && voiceAvailable()) window.speechSynthesis.cancel();
        setVoiceButton();
      });
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
    var go = $('nav-go'), q = $('nav-to-q');
    if (go) go.addEventListener('click', askRoute);
    if (q) q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearSuggestions(); askRoute(); } });
    if (q) q.addEventListener('input', suggestWhileTyping);
    approved().then(function (ok) {
      if (!ok) return;
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
          [p.name, p.street, p.district || p.locality, p.city, p.county, p.country].forEach(function (x) {
            if (x && !seen[x]) { seen[x] = true; names.push(String(x)); }
          });
          return { name: names.join(', ').slice(0, 120), at: [+c[1], +c[0]] };
        }).filter(Boolean);
      });
  }
  // A query of several words is also sent with its last word on its own, because the other words (Tesla, say) can
  // crowd out the place the member means: "Tesla Leic" then still brings up Leicester.
  function findPlace(q) {
    var words = q.split(/\s+/), last = words[words.length - 1];
    var asks = [photonPlaces(q)];
    if (words.length > 1 && last.length >= 3) asks.push(photonPlaces(last));
    return Promise.all(asks).then(function (lists) {
      var seen = {}, out = [];
      lists.forEach(function (list) {
        list.forEach(function (p) {
          var k = p.name.toLowerCase();
          if (!seen[k]) { seen[k] = true; out.push(p); }
        });
      });
      if (lastFix) out.forEach(function (p) { p.km = metresBetween([lastFix.lat, lastFix.lng], p.at) / 1000; });
      if (lastFix) out.sort(function (a, b) { return a.km - b.km; });
      return out.slice(0, 5);
    });
  }
  // Suggestions while typing, in light grey under the box. They wait for three letters and a short pause, so the place
  // service is not asked on every key press, and an answer that comes late is dropped.
  var suggestTimer = null, suggestSeq = 0;
  function showSuggestions(list) {
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
      b.addEventListener('click', function () { choose(p); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  function clearSuggestions() {
    var ul = $('nav-results');
    if (ul) { ul.textContent = ''; ul.classList.remove('is-suggest'); }
  }
  function suggestWhileTyping() {
    clearTimeout(suggestTimer);
    var q = ($('nav-to-q').value || '').trim();
    if (q.length < 3 || parseCoords(q)) { suggestSeq++; clearSuggestions(); return; }
    suggestTimer = setTimeout(function () {
      var my = ++suggestSeq;
      findPlace(q).then(function (list) {
        if (my !== suggestSeq) return;
        if (list.length) showSuggestions(list); else clearSuggestions();
      }).catch(function () { if (my === suggestSeq) clearSuggestions(); });
    }, 450);
  }
  function choose(p) {
    dest = p;
    clearSuggestions();
    $('nav-to-q').value = p.name;
    routeTo();
  }
  function showResults(list) {
    var ul = $('nav-results');
    ul.textContent = '';
    list.forEach(function (p) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.name;
      var s = distanceSmall(p);
      if (s) b.appendChild(s);
      b.addEventListener('click', function () { choose(p); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  function askRoute() {
    var q = ($('nav-to-q').value || '').trim();
    if (!q) return setRouteMsg('Type a place, or a position as lat, lng.', true);
    var at = parseCoords(q);
    if (at) { dest = { name: at[0].toFixed(5) + ', ' + at[1].toFixed(5), at: at }; return routeTo(); }
    setRouteMsg('Looking for that place...');
    findPlace(q).then(function (list) {
      if (!list.length) return setRouteMsg('No place found for that. Try a postcode, or lat, lng.', true);
      if (list.length === 1) return choose(list[0]);
      setRouteMsg('Pick the right place:');
      showResults(list);
    }).catch(function () { setRouteMsg('The place search did not answer. Try again.', true); });
  }
  function requestRoute() {
    return fetch(WORKER + '/navigate/route', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': session() }, body: JSON.stringify({ from: [lastFix.lat, lastFix.lng], to: dest.at }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && !!d.success, d: d }; }); });
  }
  function routeTo() {
    if (!dest) return;
    if (!lastFix) return setRouteMsg('Waiting for your phone\u2019s position before a route can start.', true);
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
      if (!silent) map.fitBounds(routeLayer.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [30, 260], maxZoom: 17 });
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
  function nearestOnRoute() {
    var line = routeD && routeD.line;
    if (!line || line.length < 2 || !lastFix) return null;
    var k = Math.cos(lastFix.lat * Math.PI / 180), best = null;
    for (var i = 0; i < line.length - 1; i++) {
      var a = line[i], b = line[i + 1];
      // Flat picture over one short piece of road, with longitude scaled by the latitude.
      var ax = a[1] * k, ay = a[0], dx = b[1] * k - ax, dy = b[0] - ay;
      var len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, ((lastFix.lng * k - ax) * dx + (lastFix.lat - ay) * dy) / len2)) : 0;
      var q = [ay + t * dy, (ax + t * dx) / k];
      var d = metresBetween([lastFix.lat, lastFix.lng], q);
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
