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


  // Which wheels are driven: 'FWD', 'RWD' or 'AWD', from the make, model and version, or '' when it cannot be told
  // (and for bikes). The version settles it where it says (Long Range AWD, Rear-Wheel Drive, 4S, xDrive, Dual Motor);
  // a model built one way only is known from its name. Kept the same in js/vehicle-data.js and the worker (a test
  // checks they agree).
  var DRIVES = ['FWD', 'RWD', 'AWD'];
  var FIXED_DRIVE = {
    'tesla|model x': 'AWD', 'tesla|cybertruck': 'AWD', 'tesla|roadster': 'RWD',
    'hyundai|ioniq 5 n': 'AWD', 'hyundai|ioniq 6 n': 'AWD', 'hyundai|ioniq 5': 'RWD', 'hyundai|ioniq 6': 'RWD', 'hyundai|kona n': 'FWD',
    'kia|ev6 gt': 'AWD', 'kia|ev6': 'RWD', 'kia|ev9': 'RWD',
    'porsche|718 cayman': 'RWD', 'porsche|718 boxster': 'RWD',
    'polestar|3': 'AWD', 'polestar|4': 'AWD',
    'bmw|i4 m50': 'AWD', 'bmw|ix m60': 'AWD', 'bmw|i5 m60': 'AWD', 'bmw|m2': 'RWD', 'bmw|m3': 'RWD', 'bmw|m4': 'RWD',
    'audi|rs e-tron gt': 'AWD', 'audi|e-tron gt': 'AWD', 'audi|rs3': 'AWD', 'audi|rs6': 'AWD',
    'mercedes-benz|eqe amg': 'AWD', 'mercedes-benz|eqs amg': 'AWD', 'mercedes-benz|amg gt': 'RWD',
    'lotus|eletre': 'AWD', 'lotus|emeya': 'AWD', 'lotus|emira': 'RWD', 'lotus|elise': 'RWD', 'lotus|exige': 'RWD', 'lotus|evora': 'RWD',
    'lucid|air': 'AWD', 'rimac|nevera': 'AWD', 'mg|cyberster': 'RWD', 'mg|mg4 xpower': 'AWD',
    'ford|mustang mach-e': 'RWD', 'ford|mustang mach-e gt': 'AWD', 'ford|focus st': 'FWD', 'ford|fiesta st': 'FWD',
    'volkswagen|id.3': 'RWD', 'volkswagen|id.4 gtx': 'AWD', 'volkswagen|id. buzz': 'RWD', 'volkswagen|golf r': 'AWD', 'volkswagen|golf gti': 'FWD',
    'cupra|born': 'RWD', 'cupra|leon': 'FWD', 'mini|cooper se': 'FWD', 'mini|john cooper works': 'FWD',
    'renault|megane e-tech': 'FWD', 'renault|clio': 'FWD', 'alpine|a110': 'RWD',
    'nissan|ariya': 'FWD', 'nissan|leaf': 'FWD', 'nissan|gt-r': 'AWD',
    'honda|civic type r': 'FWD', 'honda|s2000': 'RWD', 'toyota|gr86': 'RWD', 'toyota|gr yaris': 'AWD', 'toyota|supra': 'RWD',
    'subaru|brz': 'RWD', 'subaru|wrx sti': 'AWD', 'mazda|mx-5': 'RWD'
  };
  function driveFor(v) {
    v = v || {};
    if (v.vehicleType === 'bike') return '';
    var make = String(v.make || '').trim().toLowerCase(), model = String(v.model || '').trim().toLowerCase(), ver = String(v.version || '').trim().toLowerCase();
    // Older cars carry the make inside the model (Hyundai Ioniq 5 N), and a Tesla had no make at all.
    if (!make) {
      var m = /^(hyundai|porsche|kia)\s+/.exec(model);
      if (m) { make = m[1]; model = model.slice(m[0].length); } else if (/^(model [3sxy]|cybertruck|roadster)\b/.test(model)) make = 'tesla';
    }
    // A model typed with its trim (911 GT3, Taycan 4S, Model 3 Performance) is a model and a version.
    var m2 = /^(model [3sxy]|taycan|911|macan electric|cybertruck|ev6|ioniq [56])\s+(.+)$/.exec(model);
    if (m2 && !/^(gt|n)$/.test(m2[2])) { model = m2[1]; ver = (m2[2] + ' ' + ver).trim(); }
    var text = model + ' ' + ver;
    if (/\b(awd|4wd|xdrive|4matic|4motion|quattro|dual[ -]motor|all-wheel|e-4orce|4drive|all4|4x4)\b/.test(text)) return 'AWD';
    if (/\b(rwd|rear[ -]wheel)\b/.test(text)) return 'RWD';
    if (/\b(fwd|front[ -]wheel)\b/.test(text)) return 'FWD';
    if (make === 'tesla') {
      if (model === 'model 3' || model === 'model y') return /performance|long range/.test(ver) ? 'AWD' : /standard|mid range/.test(ver) ? 'RWD' : '';
      if (model === 'model s') return /^p?\d+d$|plaid|long range|performance|raven/.test(ver) ? 'AWD' : /^p?\d+\+?$/.test(ver) ? 'RWD' : '';
    }
    if (make === 'porsche') {
      if (model === 'taycan') return !ver || ver === 'taycan' ? 'RWD' : /^(4|4s|gts|turbo)\b|cross turismo|sport turismo/.test(ver) ? 'AWD' : '';
      if (model === 'macan electric') return /^(4|turbo)\b/.test(ver) ? 'AWD' : 'RWD';
      if (model === '911') return /carrera 4|targa 4|turbo|dakar/.test(ver) ? 'AWD' : 'RWD';
    }
    if (make === 'polestar') {
      if (/single|standard range/.test(ver)) return model === '2' && v.year && Number(v.year) < 2024 ? 'FWD' : 'RWD';
      if (model === '2') return /dual|performance/.test(ver) ? 'AWD' : '';
    }
    if (make === 'lucid' && /pure/.test(ver)) return 'RWD';
    if (make === 'mg' && model === 'cyberster' && /\bgt\b/.test(ver)) return 'AWD';
    if (make === 'mercedes-benz' && model === 'amg gt' && /4[ -]door/.test(ver)) return 'AWD';
    if (make === 'volkswagen' && model === 'id. buzz' && /gtx/.test(ver)) return 'AWD';
    if (make === 'honda' && model === 'nsx') return v.year ? (Number(v.year) >= 2016 ? 'AWD' : 'RWD') : '';
    return FIXED_DRIVE[make + '|' + model] || '';
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

  var api = { car: {}, bike: {}, merge: merge, load: load, title: title, modelKey: modelKey, drive: driveFor, DRIVES: DRIVES };
  root.MT3UKVehicles = api;
})(typeof window !== 'undefined' ? window : globalThis);
