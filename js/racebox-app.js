/*
 * Laps app: connects to a RaceBox Mini, Mini S or Micro through the app's RaceBox plugin (RaceBoxPlugin.java) and
 * gives each live reading to the page. Needs js/racebox-parse.js loaded first. Outside the app it does nothing.
 *
 * window.MT3UKRaceBoxApp:
 *   available           true inside the Laps app
 *   connect()           -> Promise. Asks for Bluetooth permission if needed, then looks for a RaceBox nearby.
 *   disconnect()        -> Promise.
 *   onReading(fn)       fn(reading) for every live reading (see decodeLive in racebox-parse.js), about 25 a second.
 *   onStatus(fn)        fn({ state, detail }): scanning, connecting, discovering, connected, disconnected, notfound, failed.
 */
(function () {
  'use strict';
  var C = window.Capacitor;
  var native = !!(C && C.isNativePlatform && C.isNativePlatform());
  var plugin = native && C.Plugins ? C.Plugins.RaceBox : null;
  var rb = window.MT3UKRaceBox;
  var parser = rb ? rb.parser() : null;
  var readingListeners = [];
  var statusListeners = [];

  function fire(list, value) {
    list.forEach(function (fn) { try { fn(value); } catch (e) { /* one listener failing must not stop the others */ } });
  }

  function bytesFrom(base64) {
    var bin = atob(base64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  if (plugin && parser) {
    plugin.addListener('data', function (ev) {
      if (!ev || !ev.base64) return;
      parser.push(bytesFrom(ev.base64)).forEach(function (msg) {
        if (msg.cls === rb.CLASS_RACEBOX && msg.id === rb.ID_DATA) {
          var reading = rb.decodeLive(msg.payload);
          if (reading) fire(readingListeners, reading);
        }
      });
    });
    plugin.addListener('status', function (ev) { fire(statusListeners, ev); });
  }

  window.MT3UKRaceBoxApp = {
    available: !!plugin,
    connect: function () {
      if (!plugin) return Promise.reject(new Error('Open this in the Laps app to use a RaceBox.'));
      return plugin.connect();
    },
    disconnect: function () {
      return plugin ? plugin.disconnect() : Promise.resolve();
    },
    onReading: function (fn) { readingListeners.push(fn); },
    onStatus: function (fn) { statusListeners.push(fn); }
  };
})();
