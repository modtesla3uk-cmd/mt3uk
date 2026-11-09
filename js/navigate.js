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

  function init() {
    var btn = $('nav-unit');
    // Navigate starts in mph. Its own saved choice (not the RaceBox page's) is kept, so changing one does not change the other.
    try { mph = localStorage.getItem('mt3ukNavigateUnit') !== 'kmh'; } catch (e) { mph = true; }
    if (btn) btn.addEventListener('click', function () {
      mph = !mph;
      try { localStorage.setItem('mt3ukNavigateUnit', mph ? 'mph' : 'kmh'); } catch (e) { /* storage blocked */ }
      showSpeed();
    });
    var handle = $('nav-route-handle');
    if (handle) handle.addEventListener('click', function () {
      var panel = $('nav-route'), wrap2 = document.querySelector('.nav-map-wrap');
      var collapsed = !panel.classList.contains('is-collapsed');
      panel.classList.toggle('is-collapsed', collapsed);
      if (wrap2) wrap2.classList.toggle('route-collapsed', collapsed);
      handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
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
  // Places are biased to the area around the phone (about 50 km, not restricted to it), and the nearest come first.
  function findPlace(q) {
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=en&q=' + encodeURIComponent(q);
    if (lastFix) {
      var la = lastFix.lat, lo = lastFix.lng, dl = 0.5, dg = 0.8;
      url += '&viewbox=' + (lo - dg) + ',' + (la + dl) + ',' + (lo + dg) + ',' + (la - dl) + '&bounded=0';
      // In the UK, only UK places are suggested: a brand name would otherwise bring up matches in other countries.
      if (la >= 49.8 && la <= 60.9 && lo >= -8.7 && lo <= 1.9) url += '&countrycodes=gb';
    }
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        var out = (list || []).map(function (p) { return { name: String(p.display_name || '').slice(0, 120), at: [+p.lat, +p.lon] }; });
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
      if (p.km !== undefined) { var s = document.createElement('small'); s.textContent = (p.km >= 10 ? Math.round(p.km) : p.km.toFixed(1)) + ' km away'; b.appendChild(s); }
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
      if (p.km !== undefined) { var s = document.createElement('small'); s.textContent = (p.km >= 10 ? Math.round(p.km) : p.km.toFixed(1)) + ' km away'; b.appendChild(s); }
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
    $('nav-route').hidden = false;
    $('nav-route').classList.remove('is-collapsed');
    var wrap = document.querySelector('.nav-map-wrap');
    if (wrap) { wrap.classList.add('has-route'); wrap.classList.remove('route-collapsed'); }
    var hd = $('nav-route-handle');
    if (hd) hd.setAttribute('aria-expanded', 'true');
    // The search gives the whole address; the card shows the first two parts (the place and its town).
    set('nav-route-to', dest.name.split(', ').slice(0, 2).join(', '));
    set('nav-route-len', (d.distanceM >= 1000 ? (d.distanceM / 1000).toFixed(1) + ' km' : d.distanceM + ' m') + ', about ' + Math.max(1, Math.round(d.durationS / 60)) + ' min');
    var ul = $('nav-steps');
    ul.textContent = '';
    (d.steps || []).slice(0, 15).forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s.text + ' (' + (s.distanceM >= 1000 ? (s.distanceM / 1000).toFixed(1) + ' km' : s.distanceM + ' m') + ')';
      ul.appendChild(li);
    });
    updateToGo();
  }
  // The straight-line distance to the destination, as the phone's position moves. Off-route rerouting is not in this version.
  function updateToGo() {
    if (!dest || !lastFix) return;
    var m = metresBetween([lastFix.lat, lastFix.lng], dest.at);
    set('nav-togo', m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m');
  }
  window.MT3UKNavigate = { map: function () { return map; }, fix: function () { return lastFix; }, trailPoints: function () { return trail ? trail.getLatLngs().length : 0; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
