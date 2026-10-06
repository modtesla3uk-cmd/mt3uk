/*
  Brake pads for Track sessions. The makes and their compounds come from data/pads.json with the changes made on the
  Brake pads panel of track-admin.html laid on top (the worker's /pads, KV pad-library), as for tyres. Each compound
  can carry what its maker publishes: use, mu (friction), tempMin and tempMax (degrees C) and notes.

  MT3UKPads.load()                    -> promise; fills makes ({ make: [compound, ...] }) and uses
  MT3UKPads.merge(base, extra)        -> { makes, uses } (the admin panel uses it too)
  MT3UKPads.compounds(make)           -> the compound names of a make
  MT3UKPads.info(make, compound)      -> the compound's maker data, or null
  MT3UKPads.compose({ make, compound }) -> "Pagid RSL29"
  MT3UKPads.parse(text)               -> { make, compound } from text such as a My Garage brakes field
  MT3UKPads.makerLine(info)           -> "Track day, mu 0.50, 100 to 650 C" (only what is known)
*/
(function (root) {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var USES = ['Road', 'Fast road', 'Track day', 'Endurance', 'Race'];

  function copyCompound(c) {
    if (!c || !c.name) return null;
    var o = { name: String(c.name) };
    ['use', 'mu', 'tempMin', 'tempMax', 'notes'].forEach(function (k) { if (c[k] !== undefined && c[k] !== null && c[k] !== '') o[k] = c[k]; });
    return o;
  }
  // The file, then the admin's changes on top: a make is replaced by name, with its compounds, or taken off
  // ({ name, removed: true }).
  function merge(base, extra) {
    base = base || {}; extra = extra || {};
    var map = {};
    function add(m) { map[m.name] = (m.compounds || []).map(copyCompound).filter(Boolean); }
    (base.makes || []).forEach(function (m) { if (m && m.name) add(m); });
    (extra.makes || []).forEach(function (m) {
      if (!m || !m.name) return;
      if (m.removed) delete map[m.name]; else add(m);
    });
    var makes = {};
    Object.keys(map).sort(function (a, b) {
      // The car's own pads first, then A to Z.
      if (a === 'Original equipment') return -1;
      if (b === 'Original equipment') return 1;
      return a.toLowerCase().localeCompare(b.toLowerCase());
    }).forEach(function (n) { makes[n] = map[n]; });
    return { makes: makes, uses: (base.uses && base.uses.length ? base.uses : USES).slice() };
  }

  function compounds(make) { return ((api.makes[make]) || []).map(function (c) { return c.name; }); }
  function info(make, compound) {
    var list = api.makes[make] || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === compound) return list[i];
    return null;
  }
  function compose(p) {
    p = p || {};
    if (!p.make && !p.compound) return '';
    if (p.make === 'Original equipment') return 'Original equipment pads';
    return [p.make, p.compound].filter(Boolean).join(' ').trim();
  }
  // "Pagid RSL29", "pagid rsl 29", "RSL29": the make and compound we know, as far as the text says.
  function squash(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9+.]/g, ''); }
  function parse(text) {
    var out = { make: '', compound: '' };
    var t = squash(text);
    if (!t) return out;
    if (/^(stock|standard|original|oem|factory)/.test(t)) return { make: 'Original equipment', compound: 'Standard pads' };
    var makes = Object.keys(api.makes).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < makes.length; i++) {
      var mk = squash(makes[i]);
      if (t.indexOf(mk) === 0) {
        out.make = makes[i];
        var rest = t.slice(mk.length);
        api.makes[makes[i]].forEach(function (c) { if (!out.compound && rest && rest.indexOf(squash(c.name)) === 0) out.compound = c.name; });
        return out;
      }
    }
    // No make in the text: a compound only one make has.
    var hits = [];
    makes.forEach(function (m) { api.makes[m].forEach(function (c) { if (squash(c.name) && t.indexOf(squash(c.name)) === 0) hits.push([m, c.name]); }); });
    if (hits.length === 1) { out.make = hits[0][0]; out.compound = hits[0][1]; }
    return out;
  }
  function makerLine(c) {
    if (!c) return '';
    var parts = [];
    if (c.use) parts.push(c.use);
    if (c.mu) parts.push('\u03bc ' + c.mu);
    if (c.tempMin != null && c.tempMax != null) parts.push(c.tempMin + ' to ' + c.tempMax + '°C');
    else if (c.tempMax != null) parts.push('up to ' + c.tempMax + '°C');
    return parts.join(', ');
  }

  var loading = null;
  function load() {
    if (loading) return loading;
    function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    loading = Promise.all([get('data/pads.json'), get(API + '/pads')]).then(function (r) {
      var m = merge(r[0], r[1] && r[1].extra);
      api.makes = m.makes; api.uses = m.uses; api.loaded = true;
      return api;
    });
    return loading;
  }

  var api = { makes: {}, uses: USES.slice(), loaded: false, merge: merge, load: load, compounds: compounds, info: info, compose: compose, parse: parse, makerLine: makerLine };
  root.MT3UKPads = api;
})(typeof window !== 'undefined' ? window : globalThis);
