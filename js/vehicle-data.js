/*
  Vehicle makes and models for Track sessions and Laps. They come from
  data/vehicles.json (the manifest) with the changes made on the Vehicles panel
  of track-admin.html laid on top (the worker's /vehicles). A make has a type, car or
  bike, and a list of models. The Model box suggests a make's models but never
  limits what can be typed.

  MT3UKVehicles.load()    -> promise; fills car and bike ({ make: [models] })
  MT3UKVehicles.merge(base, extra) -> { car, bike } (the admin panel uses it too)
  MT3UKVehicles.title({ make, model }) -> the name to show, "Kia EV6 GT"
  MT3UKVehicles.modelKey({ make, model }) -> what a leaderboard's model filter matches ("Model 3", "Kia EV6 GT")
*/
(function (root) {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var TYPES = ['car', 'bike'];

  function typeOf(m) { return TYPES.indexOf(m && m.type) !== -1 ? m.type : 'car'; }

  // The manifest, then the admin's changes on top: a make is replaced by name
  // and type, or taken off ({ name, type, removed: true }).
  function merge(base, extra) {
    base = base || {}; extra = extra || {};
    var maps = { car: {}, bike: {} };
    (base.makes || []).forEach(function (m) { if (m && m.name) maps[typeOf(m)][m.name] = (m.models || []).slice(); });
    (extra.makes || []).forEach(function (m) {
      if (!m || !m.name) return;
      if (m.removed) delete maps[typeOf(m)][m.name]; else maps[typeOf(m)][m.name] = (m.models || []).slice();
    });
    var out = {};
    TYPES.forEach(function (t) {
      out[t] = {};
      Object.keys(maps[t]).sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); }).forEach(function (n) { out[t][n] = maps[t][n]; });
    });
    return out;
  }

  // The name to show for a vehicle. Cars saved before makes existed keep the make inside the model
  // ("Hyundai Ioniq 5 N") or have none ("Model 3"), so a make is only put in front when the model
  // does not already start with it.
  function title(v) {
    v = v || {};
    var make = String(v.make || '').trim(), model = String(v.model || '').trim();
    if (make && model && model.toLowerCase().indexOf(make.toLowerCase()) !== 0) return make + ' ' + model;
    return model || make;
  }

  // The key a leaderboard filters a vehicle by. Tesla models are known by the model alone (Model 3), as before
  // there were makes; every other make shows in front (Kia EV6 GT, Porsche Taycan).
  function modelKey(v) {
    v = v || {};
    return String(v.make || '').trim() === 'Tesla' ? String(v.model || '').trim() : title(v);
  }

  var loading = null;
  function load() {
    if (loading) return loading;
    function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    loading = Promise.all([get('data/vehicles.json'), get(API + '/vehicles')]).then(function (r) {
      var m = merge(r[0], r[1] && r[1].extra);
      api.car = m.car; api.bike = m.bike;
      return api;
    });
    return loading;
  }

  var api = { car: {}, bike: {}, merge: merge, load: load, title: title, modelKey: modelKey };
  root.MT3UKVehicles = api;
})(typeof window !== 'undefined' ? window : globalThis);
