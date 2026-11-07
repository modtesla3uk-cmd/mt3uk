/*
 * racebox-test.html: shows live readings from a RaceBox through the Laps app's RaceBox bridge (js/racebox-app.js).
 * Outside the app the page says so and does not offer to connect.
 */
(function () {
  'use strict';
  var app = window.MT3UKRaceBoxApp;
  var rate = 0, count = 0;

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

  function show(r) {
    count++;
    set('rbt-speed', r.speedKph.toFixed(1));
    set('rbt-heading', r.heading.toFixed(1));
    set('rbt-pos', r.lat.toFixed(6) + ', ' + r.lon.toFixed(6));
    set('rbt-fix', r.fixOk ? 'Good' : (r.fixStatus === 0 ? 'No fix' : 'Poor'));
    set('rbt-sats', String(r.satellites));
    set('rbt-acc', r.horizontalAccuracy.toFixed(2));
    set('rbt-g', r.gForce.x.toFixed(2) + ' / ' + r.gForce.y.toFixed(2) + ' / ' + r.gForce.z.toFixed(2) + ' g');
    set('rbt-rot', r.rotation.x.toFixed(1) + ' / ' + r.rotation.y.toFixed(1) + ' / ' + r.rotation.z.toFixed(1));
    set('rbt-batt', r.charging ? 'Charging, ' + r.batteryPercent + '%' : r.batteryPercent + '%');
    set('rbt-time', new Date(r.utc).toISOString().replace('T', ' ').slice(0, 19));
  }

  function init() {
    if (!app || !app.available) {
      set('rbt-status', 'Open this page in the Laps app on your phone to connect to a RaceBox.');
      var b = $('rbt-connect');
      if (b) b.disabled = true;
      return;
    }
    app.onStatus(function (e) { set('rbt-status', statusText(e)); });
    app.onReading(show);
    setInterval(function () {
      rate = count;
      count = 0;
      set('rbt-rate', String(rate));
    }, 1000);
    $('rbt-connect').addEventListener('click', function () {
      set('rbt-status', 'Looking for a RaceBox…');
      app.connect().catch(function (err) { set('rbt-status', String(err && err.message ? err.message : err)); });
    });
    $('rbt-disconnect').addEventListener('click', function () {
      app.disconnect();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
