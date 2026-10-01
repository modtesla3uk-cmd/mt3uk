/*
  Tyres for Track Sessions. The makes and models come from data/tyres.json (the
  manifest) with the changes made on the Tyres panel of admin.html laid on top
  (the worker's /tyres). The Model box suggests a make's models but never
  limits what can be typed.

  MT3UKTyres.load()   -> promise; fills makes, widths, profiles and rims
  MT3UKTyres.merge(base, extra) -> { makes, widths, profiles, rims } (the admin panel uses it too)
  MT3UKTyres.compose({ make, model, w, p, d }) -> the description
  MT3UKTyres.parse(text) -> { make, model, w, p, d } from an older free-text entry
*/
(function (root) {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  // Sizes used until the manifest has loaded, or if it can't be.
  var DEFAULTS = {
    widths: [175, 185, 195, 205, 215, 225, 235, 245, 255, 265, 275, 285, 295, 305, 315, 325, 335, 345, 355],
    profiles: [25, 30, 35, 40, 45, 50, 55, 60, 65, 70],
    rims: [15, 16, 17, 18, 19, 20, 21, 22, 23]
  };

  function numbers(list, fallback) {
    var out = (Array.isArray(list) ? list : []).map(Number).filter(function (n) { return isFinite(n) && n > 0; });
    out = out.filter(function (n, i) { return out.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
    return out.length ? out : fallback;
  }

  // The manifest, then the admin's changes on top: a make is replaced by name
  // or taken off ({ name, removed: true }); a size list replaces the file's.
  function merge(base, extra) {
    base = base || {}; extra = extra || {};
    var map = {};
    (base.makes || []).forEach(function (m) { if (m && m.name) map[m.name] = (m.models || []).slice(); });
    (extra.makes || []).forEach(function (m) {
      if (!m || !m.name) return;
      if (m.removed) delete map[m.name]; else map[m.name] = (m.models || []).slice();
    });
    var makes = {};
    Object.keys(map).sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); }).forEach(function (n) { makes[n] = map[n]; });
    return {
      makes: makes,
      widths: numbers(extra.widths && extra.widths.length ? extra.widths : base.widths, DEFAULTS.widths),
      profiles: numbers(extra.profiles && extra.profiles.length ? extra.profiles : base.profiles, DEFAULTS.profiles),
      rims: numbers(extra.rims && extra.rims.length ? extra.rims : base.rims, DEFAULTS.rims)
    };
  }

  function compose(t) {
    t = t || {};
    var name = [t.make, t.model].filter(Boolean).join(' ').trim();
    var size = t.w && t.p && t.d ? t.w + '/' + t.p + ' R' + t.d : '';
    return [name, size].filter(Boolean).join(', ');
  }

  // An older free-text entry, split into the new fields as far as it can be.
  function parse(text) {
    var out = { make: '', model: '', w: '', p: '', d: '' };
    var rest = String(text || '').trim();
    if (!rest) return out;
    var m = rest.match(/(\d{3})\s*\/\s*(\d{2})\s*(?:z?r|-)?\s*(\d{2})\b/i);
    if (m) {
      out.w = parseInt(m[1], 10); out.p = parseInt(m[2], 10); out.d = parseInt(m[3], 10);
      rest = rest.replace(m[0], ' ');
    }
    rest = rest.replace(/[\s,;-]+$/, '').replace(/^[\s,;-]+/, '').replace(/\s+/g, ' ').trim();
    var low = rest.toLowerCase(), makes = Object.keys(api.makes).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < makes.length; i++) {
      var mk = makes[i].toLowerCase();
      if (low === mk || low.indexOf(mk + ' ') === 0) { out.make = makes[i]; out.model = rest.slice(mk.length).trim(); return out; }
    }
    // No make in the text: a model we know belongs to one.
    for (var j = 0; j < makes.length; j++) {
      if (api.makes[makes[j]].some(function (md) { return md.toLowerCase() === low; })) { out.make = makes[j]; out.model = rest; return out; }
    }
    out.model = rest;
    return out;
  }

  var loading = null;
  function load() {
    if (loading) return loading;
    function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    loading = Promise.all([get('data/tyres.json'), get(API + '/tyres')]).then(function (r) {
      var m = merge(r[0], r[1] && r[1].extra);
      api.makes = m.makes; api.widths = m.widths; api.profiles = m.profiles; api.rims = m.rims;
      return api;
    });
    return loading;
  }

  var api = { makes: {}, widths: DEFAULTS.widths, profiles: DEFAULTS.profiles, rims: DEFAULTS.rims, merge: merge, load: load, compose: compose, parse: parse };
  root.MT3UKTyres = api;
})(typeof window !== 'undefined' ? window : globalThis);
