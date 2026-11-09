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
    L.tileLayer(MAP_BASE, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    el.classList.add('rbt-mono');
    trail = L.polyline([], { color: '#e4b64f', weight: 4 }).addTo(map);
    marker = L.circleMarker([lat, lng], { radius: 8, color: '#16233d', fillColor: '#1c8a4b', fillOpacity: 1 }).addTo(map);
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
    lastFix = { lat: c.latitude, lng: c.longitude, t: p.timestamp };
    updateToGo();
    status('Your phone has a fix.');
    // Anything under 1 km/h (about 0.6 mph) shows as stopped, so walking pace shows. Parked GPS speed can still wander above this.
    if (c.speed != null && !isNaN(c.speed)) { lastKph = c.speed * 3.6 < 1 ? 0 : c.speed * 3.6; showSpeed(); }
    else { set('nav-speed', '–'); }
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
      map.panTo(here, { animate: false });
    });
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
    // summary does the same: a swipe up (40 px or more) opens it, a swipe down folds it.
    var swipeFrom = null, swipedAt = 0;
    function toggleRoute() {
      var panel = $('nav-route');
      setRouteFolded(!panel.classList.contains('is-collapsed'));
    }
    function setRouteFolded(folded) {
      var panel = $('nav-route'), wrap2 = document.querySelector('.nav-map-wrap');
      panel.classList.toggle('is-collapsed', folded);
      if (wrap2) wrap2.classList.toggle('route-collapsed', folded);
      if (handle) handle.setAttribute('aria-expanded', folded ? 'false' : 'true');
    }
    function swipeStart(e) {
      if (e.button) return;
      swipeFrom = { y: e.clientY, id: e.pointerId };
      if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    }
    function swipeEnd(e) {
      if (!swipeFrom || e.pointerId !== swipeFrom.id) return;
      var dy = e.clientY - swipeFrom.y;
      swipeFrom = null;
      if (dy <= -40) { setRouteFolded(false); swipedAt = Date.now(); }
      else if (dy >= 40) { setRouteFolded(true); swipedAt = Date.now(); }
    }
    if (handle) {
      handle.addEventListener('click', function () {
        // A swipe also ends in a click on some browsers; the swipe has already done the work.
        if (Date.now() - swipedAt < 400) return;
        toggleRoute();
      });
      [handle, document.querySelector('#nav-route .nav-route-head'), document.querySelector('#nav-route .nav-route-summary')].forEach(function (el) {
        if (!el) return;
        el.addEventListener('pointerdown', swipeStart);
        el.addEventListener('pointerup', swipeEnd);
        el.addEventListener('pointercancel', function () { swipeFrom = null; });
      });
    }
    var rc = $('nav-recentre');
    if (rc) rc.addEventListener('click', function () { if (map && lastFix) map.setView([lastFix.lat, lastFix.lng], map.getZoom(), { animate: true }); });
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
  function routeTo() {
    if (!dest) return;
    if (!lastFix) return setRouteMsg('Waiting for your phone\u2019s position before a route can start.', true);
    setRouteMsg('Working out the route...');
    fetch(WORKER + '/navigate/route', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': session() }, body: JSON.stringify({ from: [lastFix.lat, lastFix.lng], to: dest.at }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && !!d.success, d: d }; }); })
      .then(function (res) { if (!res.ok) return setRouteMsg(res.d.message || 'The route could not be worked out.', true); drawRoute(res.d); })
      .catch(function () { setRouteMsg('The route could not be worked out. Check the connection and try again.', true); });
  }
  function drawRoute(d) {
    setRouteMsg('');
    loadLeaflet(function () {
      if (!map || !window.L) return;
      if (routeLayer) map.removeLayer(routeLayer);
      if (destMarker) map.removeLayer(destMarker);
      routeLayer = L.polyline(d.line, { color: '#1c6fd6', weight: 6, opacity: 0.85 }).addTo(map);
      destMarker = L.circleMarker(d.line[d.line.length - 1], { radius: 8, color: '#16233d', fillColor: '#e8542a', fillOpacity: 1 }).bindTooltip(dest.name).addTo(map);
      map.fitBounds(routeLayer.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [30, 260], maxZoom: 17 });
    });
    // A new route opens folded: the handle and Drive heading show, and the member taps the handle for the directions.
    $('nav-route').hidden = false;
    $('nav-route').classList.add('is-collapsed');
    var wrap = document.querySelector('.nav-map-wrap');
    if (wrap) { wrap.classList.add('has-route'); wrap.classList.add('route-collapsed'); }
    var hd = $('nav-route-handle');
    if (hd) hd.setAttribute('aria-expanded', 'false');
    // The search gives the whole address; the card shows the first two parts (the place and its town).
    set('nav-route-to', dest.name.split(', ').slice(0, 2).join(', '));
    routeD = d;
    renderRouteText();
    updateToGo();
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
  // The distance still to drive along the route line: from the point on it nearest the phone to its end. Returns null
  // when there is no route line yet.
  function leftOnRoute() {
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
    var left = metresBetween(best.q, line[best.i + 1]);
    for (var j = best.i + 1; j < line.length - 1; j++) left += metresBetween(line[j], line[j + 1]);
    return left;
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
