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
  var rb = window.MT3UKRaceBox;
  var parser = rb ? rb.parser() : null;
  var readingListeners = [];
  var statusListeners = [];
  var attached = false;

  // The app's bridge can be added after a page's first script runs, so the plugin is looked up when it is needed.
  function nativeCapacitor() {
    var C = window.Capacitor;
    return C && C.isNativePlatform && C.isNativePlatform() ? C : null;
  }
  function getPlugin() {
    var C = nativeCapacitor();
    return C && C.Plugins && C.Plugins.RaceBox ? C.Plugins.RaceBox : null;
  }

  function fire(list, value) {
    list.forEach(function (fn) { try { fn(value); } catch (e) { /* one listener failing must not stop the others */ } });
  }

  function bytesFrom(base64) {
    var bin = atob(base64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Connects the plugin's events to the listeners, once.
  function attach(plugin) {
    if (attached || !plugin || !parser) return;
    attached = true;
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

  // The names of the plugins this page can see, for working out a problem on a phone.
  function pluginNames() {
    var C = nativeCapacitor();
    if (!C) return 'not running in the app';
    var names = C.Plugins ? Object.keys(C.Plugins) : [];
    return names.length ? names.join(', ') : 'none';
  }

  window.MT3UKRaceBoxApp = {
    get available() { return !!getPlugin(); },
    pluginNames: pluginNames,
    connect: function () {
      var plugin = getPlugin();
      if (!plugin) return Promise.reject(new Error('RaceBox is not available on this page. Plugins here: ' + pluginNames() + '.'));
      attach(plugin);
      return plugin.connect();
    },
    // Whether the app is connected to a RaceBox already, so a page opened again can show it: { connected, name }.
    status: function () {
      var plugin = getPlugin();
      if (!plugin) return Promise.resolve({ connected: false, name: '' });
      attach(plugin);
      return plugin.status();
    },
    disconnect: function () {
      var plugin = getPlugin();
      return plugin ? plugin.disconnect() : Promise.resolve();
    },
    onReading: function (fn) { readingListeners.push(fn); },
    onStatus: function (fn) { statusListeners.push(fn); }
  };
  attach(getPlugin());
})();
