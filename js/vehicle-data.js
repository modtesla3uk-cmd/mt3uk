/*
  Vehicle makes and models for Track sessions and Laps. They come from
  data/vehicles.json (the manifest) with the changes made on the Vehicles panel
  of track-admin.html laid on top (the worker's /vehicles). A make has a type, car or
  bike, and a list of models. The Model box suggests a make's models but never
  limits what can be typed.

  MT3UKVehicles.load()    -> promise; fills car and bike ({ make: [models] })
  MT3UKVehicles.merge(base, extra, { all }) -> { car, bike, versions, versionRules, hidden } (the admin panel uses it too;
    hidden makes are left out unless all is true)
  MT3UKVehicles.versionsFor({ make, model }) -> the model's variants for the Version box (edited on the same panel)
  MT3UKVehicles.versionRule({ make, model }) -> { required, free }: whether the Version box must be filled in and
    whether anything can be typed in it (set per model on the same panel; both off unless set)
  MT3UKVehicles.title({ make, model }) -> the name to show, "Kia EV6 GT"
  MT3UKVehicles.modelKey({ make, model }) -> what a leaderboard's model filter matches ("Model 3", "Kia EV6 GT")
  MT3UKVehicles.drive({ make, model, version, year }) -> 'FWD', 'RWD', 'AWD' or '', with the admin's defaults by
    model (loaded with the library) laid on, and a variant's own wheels (set in a make's Edit form, key make|model|version)
    ahead of both; driveRule(v) is the rule alone, driveKey(v) a model's key in the defaults, driveVariantKey(v) a variant's
*/
(function (root) {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var TYPES = ['car', 'bike'];

  function typeOf(m) { return TYPES.indexOf(m && m.type) !== -1 ? m.type : 'car'; }

  // The manifest, then the admin's changes on top: a make is replaced by name
  // and type, or taken off ({ name, type, removed: true }).
  // Each make can also list its models' variants (versions): { car: { Tesla: { 'Model 3': [...] } } } in
  // out.versions. An admin entry without a versions list keeps the file's.
  // Each make can also carry a rule for its models' Version box ({ 'Model 3': { required: true, free: true } }) in
  // out.versionRules, kept like the variants.
  // The admin can also hide a make ({ hiddenMakes: [{ name, type }] }): it stays on the Vehicles panel with its
  // models and variants but is left out of the lists members pick from. merge(base, extra, { all: true }) keeps
  // hidden makes in (the panel uses it); out.hidden says which they are.
  function merge(base, extra, opts) {
    base = base || {}; extra = extra || {};
    var maps = { car: {}, bike: {} }, vers = { car: {}, bike: {} }, rules = { car: {}, bike: {} };
    function copyVersions(v) { var o = {}; Object.keys(v || {}).forEach(function (k) { o[k] = (v[k] || []).slice(); }); return o; }
    function copyRules(r) { var o = {}; Object.keys(r || {}).forEach(function (k) { if (r[k] && (r[k].required || r[k].free)) o[k] = { required: !!r[k].required, free: !!r[k].free }; }); return o; }
    (base.makes || []).forEach(function (m) { if (m && m.name) { maps[typeOf(m)][m.name] = (m.models || []).slice(); vers[typeOf(m)][m.name] = copyVersions(m.versions); rules[typeOf(m)][m.name] = copyRules(m.versionRules); } });
    (extra.makes || []).forEach(function (m) {
      if (!m || !m.name) return;
      if (m.removed) { delete maps[typeOf(m)][m.name]; delete vers[typeOf(m)][m.name]; delete rules[typeOf(m)][m.name]; return; }
      maps[typeOf(m)][m.name] = (m.models || []).slice();
      if (m.versions) vers[typeOf(m)][m.name] = copyVersions(m.versions);
      if (m.versionRules) rules[typeOf(m)][m.name] = copyRules(m.versionRules);
    });
    var hid = {};
    (extra.hiddenMakes || []).forEach(function (h) { if (h && h.name) hid[typeOf(h) + '|' + String(h.name).toLowerCase()] = true; });
    var out = { versions: { car: {}, bike: {} }, versionRules: { car: {}, bike: {} }, hidden: { car: {}, bike: {} } };
    TYPES.forEach(function (t) {
      out[t] = {};
      Object.keys(maps[t]).sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); }).forEach(function (n) {
        var isHidden = !!hid[t + '|' + n.toLowerCase()];
        if (isHidden) out.hidden[t][n] = true;
        if (isHidden && !(opts && opts.all)) return;
        out[t][n] = maps[t][n]; out.versions[t][n] = vers[t][n] || {}; out.versionRules[t][n] = rules[t][n] || {};
      });
    });
    return out;
  }

  // What a model has in a per-make, per-model table (the variants, or the Version rules): by make and model, or
  // by a model that carries its make ("Hyundai Ioniq 5 N", or a Tesla model with no make), from whichever list has it.
  function lookUp(table, v) {
    v = v || {};
    var make = String(v.make || '').trim(), model = String(v.model || '').trim();
    if (make && model.toLowerCase().indexOf(make.toLowerCase() + ' ') === 0) model = model.slice(make.length + 1);
    var types = v.vehicleType === 'bike' ? ['bike'] : ['car', 'bike'];
    for (var i = 0; i < types.length; i++) {
      var vt = table[types[i]] || {};
      if (make && vt[make] && vt[make][model]) return vt[make][model];
      if (!make) {
        var names = Object.keys(vt);
        for (var j = 0; j < names.length; j++) {
          var rest = model.toLowerCase().indexOf(names[j].toLowerCase() + ' ') === 0 ? model.slice(names[j].length + 1) : model;
          if (vt[names[j]][rest]) return vt[names[j]][rest];
        }
      }
    }
    return null;
  }
  // A model's variants, for the Version drop-down.
  function versionsFor(v) { return (lookUp(api.versions, v) || []).slice(); }
  // A model's Version box rule: both off unless the admin set them.
  function versionRule(v) {
    var r = lookUp(api.versionRules, v) || {};
    return { required: !!r.required, free: !!r.free };
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
    if (!String(v.make || '').trim() && !String(v.model || '').trim()) return modelInName(v.car || v.name);
    return String(v.make || '').trim() === 'Tesla' ? String(v.model || '').trim() : title(v);
  }

  // The Tesla model a car's name gives away ("DEVIANT MODEL S" is a Model S), for a car whose record
  // has no make or model set. Kept the same as modelInName in the worker.
  function modelInName(name) {
    var m = /\bmodel\s*([3sxy])\b/i.exec(String(name || ''));
    return m ? 'Model ' + m[1].toUpperCase() : '';
  }


  // Which wheels are driven: 'FWD', 'RWD' or 'AWD', from the make, model and version, or '' when it cannot be told
  // (and for bikes). The version settles it where it says (Long Range AWD, Rear-Wheel Drive, 4S, xDrive, Dual Motor);
  // a model built one way only is known from its name. Kept the same in js/vehicle-data.js and the worker (a test
  // checks they agree).
  var DRIVES = ['FWD', 'RWD', 'AWD'];
  var FIXED_DRIVE = {
    'tesla|model x': 'AWD', 'tesla|cybertruck': 'AWD', 'tesla|roadster': 'RWD',
    'hyundai|ioniq 5 n': 'AWD', 'hyundai|ioniq 6 n': 'AWD', 'hyundai|ioniq 5': 'RWD', 'hyundai|ioniq 6': 'RWD', 'hyundai|ioniq 9': 'RWD', 'hyundai|kona n': 'FWD',
    'hyundai|kona electric': 'FWD', 'hyundai|i20 n': 'FWD', 'hyundai|i30 n': 'FWD', 'hyundai|i30 fastback n': 'FWD', 'hyundai|inster': 'FWD',
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
  // The make, model and version a vehicle's wheels are judged by, lowercased: older cars carry the make inside the
  // model (Hyundai Ioniq 5 N) or have none (a Tesla), and a model typed with its trim (911 GT3, Taycan 4S, Model 3
  // Performance) is a model and a version.
  function driveParts(v) {
    v = v || {};
    var make = String(v.make || '').trim().toLowerCase(), model = String(v.model || '').trim().toLowerCase(), ver = String(v.version || '').trim().toLowerCase();
    if (make && model.indexOf(make + ' ') === 0) model = model.slice(make.length + 1);
    if (!make) {
      var m = /^(hyundai|porsche|kia)\s+/.exec(model);
      if (m) { make = m[1]; model = model.slice(m[0].length); } else if (/^(model [3sxy]|cybertruck|roadster)\b/.test(model)) make = 'tesla';
    }
    var m2 = /^(model [3sxy]|taycan|911|macan electric|cybertruck|ev6|ioniq [56])\s+(.+)$/.exec(model);
    if (m2 && !/^(gt|n)$/.test(m2[2])) { model = m2[1]; ver = (m2[2] + ' ' + ver).trim(); }
    return { make: make, model: model, ver: ver, year: Number(v.year) || 0, bike: v.vehicleType === 'bike' };
  }
  // A model's key in the admin's defaults by model ('tesla|model 3'), and a variant's own ('tesla|model 3|performance').
  function driveModelKey(v) { var p = driveParts(v); return p.make + '|' + p.model; }
  function driveVariantKey(v) { var p = driveParts(v); return p.make + '|' + p.model + '|' + p.ver; }
  // What the version (or the year) says about the wheels, or '' when it says nothing: the words in it (Long Range
  // AWD, Rear-Wheel Drive, xDrive, Dual Motor), a Tesla's or a Taycan's trim, a Polestar 2's or an NSX's year.
  function driveSaid(p) {
    var make = p.make, model = p.model, ver = p.ver, text = model + ' ' + ver;
    if (/\b(awd|4wd|xdrive|4matic|4motion|quattro|dual[ -]motor|all-wheel|e-4orce|4drive|all4|4x4)\b/.test(text)) return 'AWD';
    if (/\b(rwd|rear[ -]wheel)\b/.test(text)) return 'RWD';
    if (/\b(fwd|front[ -]wheel)\b/.test(text)) return 'FWD';
    if (make === 'tesla') {
      if (model === 'model 3' || model === 'model y') return /performance|long range/.test(ver) ? 'AWD' : /standard|mid range/.test(ver) ? 'RWD' : '';
      if (model === 'model s') return /^p?\d+d$|plaid|long range|performance|raven/.test(ver) ? 'AWD' : /^p?\d+\+?$/.test(ver) ? 'RWD' : '';
    }
    if (make === 'porsche') {
      if (model === 'taycan') return /^(4|4s|gts|turbo)\b|cross turismo|sport turismo/.test(ver) ? 'AWD' : '';
      if (model === 'macan electric') return /^(4|turbo)\b/.test(ver) ? 'AWD' : '';
      if (model === '911') return /carrera 4|targa 4|turbo|dakar/.test(ver) ? 'AWD' : '';
    }
    if (make === 'polestar') {
      if (/single|standard range/.test(ver)) return model === '2' && p.year && p.year < 2024 ? 'FWD' : 'RWD';
      if (model === '2') return /dual|performance/.test(ver) ? 'AWD' : '';
    }
    if (make === 'lucid' && /pure/.test(ver)) return 'RWD';
    if (make === 'mg' && model === 'cyberster' && /\bgt\b/.test(ver)) return 'AWD';
    if (make === 'mercedes-benz' && model === 'amg gt' && /4[ -]door/.test(ver)) return 'AWD';
    if (make === 'volkswagen' && model === 'id. buzz' && /gtx/.test(ver)) return 'AWD';
    if (make === 'honda' && model === 'nsx') return p.year ? (p.year >= 2016 ? 'AWD' : 'RWD') : '';
    return '';
  }
  // What the model alone says: one built one way, or the usual one (a Taycan, Macan or 911 is RWD unless its trim says).
  function driveModel(p) {
    if (p.make === 'porsche' && (p.model === 'taycan' || p.model === 'macan electric' || p.model === '911')) return 'RWD';
    return FIXED_DRIVE[p.make + '|' + p.model] || '';
  }
  function driveFor(v) {
    var p = driveParts(v);
    if (p.bike) return '';
    return driveSaid(p) || driveModel(p);
  }
  // The rule with the admin's defaults by model (set on the Vehicles panel, kept in the vehicle library as
  // { 'kia|ev6': 'RWD' }) laid on: what the version says still wins, else the model's default, else the model alone.
  function driveWith(v, defaults) {
    var p = driveParts(v);
    if (p.bike) return '';
    // A variant of its own (make|model|version) comes first, then what the version says, then the model's default,
    // then the model alone.
    var dv = defaults && p.ver ? defaults[p.make + '|' + p.model + '|' + p.ver] : '';
    if (dv && DRIVES.indexOf(dv) !== -1) return dv;
    var d = defaults ? defaults[p.make + '|' + p.model] : '';
    return driveSaid(p) || (d && DRIVES.indexOf(d) !== -1 ? d : '') || driveModel(p);
  }

  var loading = null;
  function load() {
    if (loading) return loading;
    function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    loading = Promise.all([get('data/vehicles.json'), get(API + '/vehicles')]).then(function (r) {
      var m = merge(r[0], r[1] && r[1].extra);
      api.car = m.car; api.bike = m.bike; api.versions = m.versions; api.versionRules = m.versionRules; api.loaded = true;
      api.drives = (r[1] && r[1].extra && r[1].extra.drives) || {};
      return api;
    });
    return loading;
  }

  var api = { car: {}, bike: {}, versions: { car: {}, bike: {} }, versionRules: { car: {}, bike: {} }, drives: {}, loaded: false, merge: merge, load: load, title: title, modelKey: modelKey, modelInName: modelInName, versionsFor: versionsFor, versionRule: versionRule, DRIVES: DRIVES,
    drive: function (v, defaults) { return driveWith(v, defaults === undefined ? api.drives : defaults); }, driveRule: driveFor, driveKey: driveModelKey, driveVariantKey: driveVariantKey };
  root.MT3UKVehicles = api;
})(typeof window !== 'undefined' ? window : globalThis);
