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
    status('Your phone has a fix.');
    // GPS speed wanders by about 1 mph when the car is still, so anything under 2 km/h shows as stopped (as the RaceBox test does).
    if (c.speed != null && !isNaN(c.speed)) { lastKph = c.speed * 3.6 < 2 ? 0 : c.speed * 3.6; showSpeed(); }
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
      var here = [c.latitude, c.longitude];
      // A parked phone's fix wanders by several metres. While stopped the dot only moves for a clear 15 m; moving, it moves
      // when a fix is more than its own accuracy (and at least 6 m) from the last one shown.
      var stopped = lastKph === 0;
      var need = stopped ? 15 : Math.max(6, c.accuracy || 0);
      if (shown && metresBetween(shown, here) <= need) return;
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
    try { mph = localStorage.getItem('mt3ukRaceBoxUnit') === 'mph'; } catch (e) { mph = false; }
    if (btn) btn.addEventListener('click', function () {
      mph = !mph;
      try { localStorage.setItem('mt3ukRaceBoxUnit', mph ? 'mph' : 'kmh'); } catch (e) { /* storage blocked */ }
      showSpeed();
    });
    approved().then(function (ok) {
      if (!ok) return;
      $('nav-gate').hidden = true;
      $('nav-body').hidden = false;
      start();
    });
  }

  window.MT3UKNavigate = { fix: function () { return lastFix; }, trailPoints: function () { return trail ? trail.getLatLngs().length : 0; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
