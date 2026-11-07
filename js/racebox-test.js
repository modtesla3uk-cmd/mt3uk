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
    set('rbt-speed', String(Math.round(mph ? lastKph * 0.621371 : lastKph)));
    set('rbt-speed-unit', mph ? 'mph' : 'km/h');
    var b = $('rbt-unit');
    if (b) { b.textContent = mph ? 'Show in km/h' : 'Show in mph'; b.setAttribute('aria-pressed', mph ? 'true' : 'false'); }
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

  function drawFix(r) {
    if (!r.fixOk) return;
    var here = [r.lat, r.lon];
    // Skip tiny moves: a parked car's GPS wanders by a few metres, which would scribble on the trail.
    if (pts.length && metres(pts[pts.length - 1], here) < 3) {
      if (marker) marker.setLatLng(here);
      return;
    }
    pts.push(here);
    var fsBtn = $('rbt-full');
    if (fsBtn) fsBtn.hidden = false;
    loadLeaflet(function () {
      var el = $('rbt-map');
      if (!el || !window.L) return;
      el.hidden = false;
      $('rbt-clear').hidden = false;
      if (!map) {
        map = L.map(el).setView(here, 17);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
        trail = L.polyline(pts, { color: '#e4b64f', weight: 4 }).addTo(map);
        marker = L.circleMarker(here, { radius: 7, color: '#16233d', fillColor: '#1c8a4b', fillOpacity: 1 }).addTo(map);
      } else {
        trail.setLatLngs(pts);
        marker.setLatLng(here);
        map.panTo(here);
      }
    });
  }

  // Full screen: the map fills the screen and the readings sit over it. The map is resized to match.
  function setFull(on) {
    document.documentElement.classList.toggle('rbt-full-on', on);
    var b = $('rbt-full');
    if (b) { b.textContent = on ? 'Exit full screen' : 'Go full screen'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (map) setTimeout(function () { map.invalidateSize(); }, 60);
  }

  function clearTrail() {
    pts.length = 0;
    if (trail) trail.setLatLngs([]);
  }

  function show(r) {
    count++;
    drawFix(r);
    lastKph = r.speedKph;
    renderSpeed();
    set('rbt-heading', r.heading.toFixed(1));
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
    b.textContent = on ? 'Connected' : (busy ? 'Connecting\u2026' : 'Connect to RaceBox');
    b.disabled = on || busy;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    // The full-screen button shows as soon as the RaceBox is connected, even before the GPS has a fix.
    var fs = $('rbt-full');
    if (fs && on) fs.hidden = false;
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
    app.onStatus(function (e) { set('rbt-status', statusText(e)); setConnectButton(e && e.state); });
    app.onReading(show);
    setInterval(function () {
      rate = count;
      count = 0;
      set('rbt-rate', String(rate));
    }, 1000);
    $('rbt-connect').addEventListener('click', function () {
      set('rbt-status', 'Looking for a RaceBox…');
      app.connect().catch(function (err) { set('rbt-status', String(err && err.message ? err.message : err)); setConnectButton('failed'); });
    });
    $('rbt-unit').addEventListener('click', toggleUnit);
    $('rbt-clear').addEventListener('click', clearTrail);
    $('rbt-full').addEventListener('click', function () { setFull(!document.documentElement.classList.contains('rbt-full-on')); });
    renderSpeed();
    $('rbt-disconnect').addEventListener('click', function () {
      app.disconnect();
    });
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
