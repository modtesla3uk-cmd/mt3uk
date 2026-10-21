/*
  Car pick: a make, then a model, then a variant, each a drop-down in A to Z order. Every variant shows its fuel type
  (Petrol, Diesel, Electric or a hybrid). The list is data/car-list/: index.json holds every make, and each make's
  models and variants are in its own file, fetched when the make is chosen. It is built from vehicle-makes-models
  (open data licence ODbL, built from autoevolution.com data) by scripts/build_car_list.py, and the line under the
  pick says so.

  MT3UKCarPick.mount(box, { pick: 'Make|Model|Variant', placeholder: false, onChange: function (choice) {} })
  choice is { make, model, variant, fuel }. pick is optional: a make name, then a model and a variant from that make.
  placeholder: true starts with 'Choose the make', then 'Choose the model' and 'Choose the variant', so nothing is chosen until the member picks it.
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
    label.className = 'field car-pick-field';
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

    var makeData = null;  // the chosen make, once its file has loaded: { name, models }
    var token = 0;        // the latest make asked for, so an older answer that arrives late is ignored

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
        return { value: String(i), text: v.name + ' (' + v.fuel + ')' };
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
    function chooseMake(slug, modelName, variantName) {
      var mine = ++token;
      makeData = null;
      if (!slug) {
        setLoading(modelF.sel, 'Choose the make first');
        setLoading(variantF.sel, 'Choose the model first');
        note.textContent = '';
        notify();
        return Promise.resolve();
      }
      setLoading(modelF.sel, 'Loading...');
      setLoading(variantF.sel, 'Loading...');
      notify();
      return loadMake(slug).then(function (data) {
        if (mine !== token) return;
        makeData = data;
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

    loadIndex().then(function (data) {
      note.textContent = '';
      var makes = data.makes.slice().sort(byName);
      var items = makes.map(function (m) { return { value: m.slug, text: m.name }; });
      if (opts.placeholder) items.unshift({ value: '', text: 'Choose the make' });
      fill(makeF.sel, items, (makes.filter(function (m) { return m.name === pick[0]; })[0] || {}).slug || '');
      return chooseMake(makeF.sel.value, pick[1], pick[2]);
    }).catch(function () {
      note.textContent = 'The car list could not be loaded. Try again in a moment.';
    });
  }

  window.MT3UKCarPick = { mount: mount };
})();
