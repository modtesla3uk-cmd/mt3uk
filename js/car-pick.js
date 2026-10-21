/*
  Car pick: a make, then a model, then a variant, each a drop-down in A to Z order. Every variant shows its fuel type
  (Petrol, Diesel, Electric or a hybrid). The list is data/car-list/: index.json holds every make, and each make's
  models and variants are in its own file, fetched when the make is chosen. It is built from vehicle-makes-models
  (open data licence ODbL, built from autoevolution.com data) by scripts/build_car_list.py, and the line under the
  pick says so.

  MT3UKCarPick.mount(box, {
    pick: 'Make|Model|Variant',      optional: a make name, then a model and a variant from that make
    placeholder: true,               starts with 'Choose the make', 'Choose the model' and 'Choose the variant'
    onChange: function (choice) {},  choice is { make, model, variant, fuel }
    offered: function (make) {},     optional: false leaves a make out (My Garage's hidden makes)
    library: {                       optional: the admin's additions on the Vehicles panel (My Garage)
      makes: function () {},         -> [make names]
      models: function (make) {},    -> [model names]
      versions: function (make, model) {}  -> [variant names, with no fuel]
    }
  })
*/
(function () {
  var BASE = '/data/car-list/';
  var SOURCE_URL = 'https://github.com/gor3a/vehicle-makes-models';
  var indexLoading = null;
  var makeLoading = {};

  var cmp = function (a, b) { return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }); };
  var byName = function (a, b) { return cmp(a.name, b.name); };

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // The list of makes, loaded once. A failed load is tried again next time.
  function loadIndex() {
    if (!indexLoading) {
      indexLoading = getJSON(BASE + 'index.json');
      indexLoading.catch(function () { indexLoading = null; });
    }
    return indexLoading;
  }

  // One make's models and variants, loaded once when it is chosen. A failed load is tried again next time.
  function loadMake(slug) {
    if (!makeLoading[slug]) {
      makeLoading[slug] = getJSON(BASE + slug + '.json');
      makeLoading[slug].catch(function () { delete makeLoading[slug]; });
    }
    return makeLoading[slug];
  }

  function field(text) {
    var label = document.createElement('label');
    label.className = 'car-pick-field';
    var name = document.createElement('span');
    name.className = 'k';
    name.textContent = text;
    var sel = document.createElement('select');
    sel.className = 'car-pick-sel';
    sel.setAttribute('aria-label', text);
    label.appendChild(name);
    label.appendChild(sel);
    return { label: label, sel: sel };
  }

  // items are { value, text }. The option whose value is pickValue is chosen, else the first.
  function fill(sel, items, pickValue) {
    sel.innerHTML = '';
    if (!items.length) {
      var none = document.createElement('option');
      none.textContent = 'None listed';
      sel.appendChild(none);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    items.forEach(function (item) {
      var o = document.createElement('option');
      o.value = item.value;
      o.textContent = item.text;
      if (item.value === pickValue) o.selected = true;
      sel.appendChild(o);
    });
  }

  function setLoading(sel, text) {
    sel.innerHTML = '';
    var o = document.createElement('option');
    o.textContent = text;
    sel.appendChild(o);
    sel.disabled = true;
  }

  function mount(box, opts) {
    opts = opts || {};
    var pick = (opts.pick || '').split('|');
    var lib = opts.library || null;
    var offered = opts.offered || function () { return true; };
    box.innerHTML = '';
    box.classList.add('car-pick');
    var makeF = field('Make');
    var modelF = field('Model');
    var variantF = field('Variant');
    var note = document.createElement('p');
    note.className = 'car-pick-note';
    note.setAttribute('role', 'status');
    var credit = document.createElement('p');
    credit.className = 'car-pick-credit';
    credit.innerHTML = 'Vehicle makes, models and engines: <a href="' + SOURCE_URL + '" rel="noopener">vehicle-makes-models</a> '
      + '(open data licence ODbL), built from autoevolution.com data.';
    [makeF.label, modelF.label, variantF.label, note, credit].forEach(function (el) { box.appendChild(el); });
    note.textContent = 'Loading the car list...';

    var makeData = null;  // the chosen make, once its list is ready: { name, models: [{ name, variants: [{ name, fuel }] }] }
    var token = 0;        // the latest make asked for, so an older answer that arrives late is ignored

    // The car list's make, with the admin's additions from the vehicle library laid on it.
    function withLibrary(name, data) {
      var models = data ? data.models.map(function (m) { return { name: m.name, variants: m.variants.slice() }; }) : [];
      if (lib && lib.models) {
        (lib.models(name) || []).forEach(function (mn) {
          var m = models.filter(function (x) { return x.name === mn; })[0];
          if (!m) { m = { name: mn, variants: [] }; models.push(m); }
          ((lib.versions && lib.versions(name, mn)) || []).forEach(function (vn) {
            if (!m.variants.some(function (v) { return v.name === vn; })) m.variants.push({ name: vn, fuel: '' });
          });
        });
      }
      return { name: name, models: models };
    }

    function modelsOf() { return makeData ? makeData.models.slice().sort(byName) : []; }
    function modelNamed(name) {
      return modelsOf().filter(function (m) { return m.name === name; })[0];
    }
    function variantsOf(model) { return model ? model.variants.slice().sort(byName) : []; }
    function current() {
      var model = makeData && modelNamed(modelF.sel.value);
      var variant = model && variantF.sel.value !== '' && variantsOf(model)[Number(variantF.sel.value)];
      return {
        make: makeData ? makeData.name : '',
        model: model ? model.name : '',
        variant: variant ? variant.name : '',
        fuel: variant ? variant.fuel : ''
      };
    }
    function notify() { if (opts.onChange) opts.onChange(current()); }

    function showVariants(variantName) {
      if (modelF.sel.value === '') {
        setLoading(variantF.sel, 'Choose the model first');
        notify();
        return;
      }
      var list = variantsOf(modelNamed(modelF.sel.value));
      var chosen = '';
      list.forEach(function (v, i) { if (v.name === variantName && chosen === '') chosen = String(i); });
      var items = list.map(function (v, i) {
        return { value: String(i), text: v.fuel ? v.name + ' (' + v.fuel + ')' : v.name };
      });
      if (opts.placeholder) items.unshift({ value: '', text: 'Choose the variant' });
      fill(variantF.sel, items, chosen);
      notify();
    }
    function showModels(modelName, variantName) {
      var items = modelsOf().map(function (m) { return { value: m.name, text: m.name }; });
      if (opts.placeholder) items.unshift({ value: '', text: 'Choose the model' });
      fill(modelF.sel, items, modelName || '');
      showVariants(variantName);
    }
    function chooseMake(name, modelName, variantName) {
      var mine = ++token;
      makeData = null;
      if (!name) {
        setLoading(modelF.sel, 'Choose the make first');
        setLoading(variantF.sel, 'Choose the model first');
        note.textContent = '';
        notify();
        return Promise.resolve();
      }
      setLoading(modelF.sel, 'Loading...');
      setLoading(variantF.sel, 'Loading...');
      notify();
      return makeFile(name).then(function (data) {
        if (mine !== token) return;
        makeData = withLibrary(name, data);
        note.textContent = '';
        showModels(modelName, variantName);
      }).catch(function () {
        if (mine !== token) return;
        fill(modelF.sel, [], '');
        fill(variantF.sel, [], '');
        note.textContent = 'The car list could not be loaded. Try again in a moment.';
      });
    }

    makeF.sel.addEventListener('change', function () { chooseMake(makeF.sel.value); });
    modelF.sel.addEventListener('change', function () { showVariants(); });
    variantF.sel.addEventListener('change', notify);

    // Every make on the car list, with the library's makes, A to Z, leaving out any the picker is not offered.
    function makeList(index) {
      var names = index ? index.makes.map(function (m) { return m.name; }) : [];
      ((lib && lib.makes) ? lib.makes() : []).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
      return names.filter(function (n) { return offered(n) || n === pick[0]; })
        .sort(function (a, b) { return cmp(a, b); });
    }

    loadIndex().catch(function () { return null; }).then(function (index) {
      note.textContent = '';
      var names = makeList(index);
      var items = names.map(function (n) { return { value: n, text: n }; });
      if (opts.placeholder) items.unshift({ value: '', text: 'Choose the make' });
      fill(makeF.sel, items, pick[0] || '');
      return chooseMake(makeF.sel.value, pick[1], pick[2]);
    }).catch(function () {
      note.textContent = 'The car list could not be loaded. Try again in a moment.';
    });
  }

  // For other pickers: every make, a make's models, and a model's variants, all from the same list.
  function slugOf(name) {
    return loadIndex().then(function (d) {
      var m = d.makes.filter(function (x) { return x.name === name; })[0];
      return m ? m.slug : null;
    });
  }
  function makeFile(name) {
    return slugOf(name).then(function (slug) {
      return slug ? loadMake(slug) : { name: name, models: [] };
    });
  }
  function makes() {
    return loadIndex().then(function (d) { return d.makes.slice().sort(byName); });
  }
  function models(name) {
    return makeFile(name).then(function (m) {
      return m ? m.models.map(function (x) { return x.name; }).sort(cmp) : [];
    });
  }
  function variants(name, model) {
    return makeFile(name).then(function (m) {
      var found = m && m.models.filter(function (x) { return x.name === model; })[0];
      return found ? found.variants.slice().sort(byName) : [];
    });
  }

  window.MT3UKCarPick = { mount: mount, makes: makes, models: models, variants: variants };
})();
