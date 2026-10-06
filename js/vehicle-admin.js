/*
  track-admin.html, Vehicles panel: the vehicle makes and models Track sessions and
  Laps offer. data/vehicles.json is the starting list; changes made here are
  stored by the worker (KV vehicle-library, /vehicles/admin) on top of it.
  A make has a type, car or bike (BMW and Honda are both). Edit renames a make
  (cars that already use the old name keep it), lists its models and, for each
  model, its variants (versions), offered in My Garage's Version box. Every
  model is a block with its name, a Remove button, its variants (a row each:
  name, driven wheels, Remove) and the Version box's rule for that model:
  Required (it must be picked) and Free text (a "Type it in" choice lets the
  member type any version); both are off unless set (versionRules).
  A make can also be hidden (a Shown switch on its row; hiddenMakes in the library): it stays here with its models and
  variants but members are not offered it. Remove takes a make off the list, and the Removed makes list below the table
  has Restore, which brings back the built-in entry. A variant's
  own driven wheels are kept in the library's drives (make|model|version) and
  win over what its name says; a save re-stamps the cars they reach.
  Each car model is listed with the wheels it drives (FWD, RWD or AWD) as the rule
  works out, and a Default drop-down: a default is kept in the library (drives) and
  set through /track/admin/drive, which stamps the sessions of every vehicle of that
  model not set by hand and refreshes its leaderboard rows.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('vehicles-wrap');
  if (!wrap) return;
  var listEl = document.getElementById('vh-list'), formEl = document.getElementById('vh-form'), noteEl = document.getElementById('vh-note'), countEl = document.getElementById('vehicles-count');
  var TYPE_NAME = { car: 'Car', bike: 'Bike' };
  var DRIVES = ['FWD', 'RWD', 'AWD'];
  // Models the rule can only tell from the version (or the year).
  var VARIES = { 'tesla|model 3': 1, 'tesla|model y': 1, 'tesla|model s': 1, 'polestar|2': 1, 'honda|nsx': 1 };
  var base = null, extra = null, merged = null, unknownOnly = false;

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path + (path.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function normal(e) { return { makes: (e && e.makes) || [], drives: (e && e.drives) || {}, weights: (e && e.weights) || {}, hiddenMakes: (e && e.hiddenMakes) || [] }; }
  function typeOf(m) { return m && m.type === 'bike' ? 'bike' : 'car'; }
  function inFile(name, type) { return (base.makes || []).some(function (m) { return m.name === name && typeOf(m) === type; }); }
  function same(m, name, type) { return m.name === name && typeOf(m) === type; }
  // A hidden make stays here with its models and variants but is not offered to members. Tesla is always offered
  // in My Garage (the Gallery is for Teslas), so it has no switch.
  function isHidden(name, type) { return (extra.hiddenMakes || []).some(function (h) { return same(h, name, type); }); }
  function unhide(name, type) { extra.hiddenMakes = (extra.hiddenMakes || []).filter(function (h) { return !same(h, name, type); }); }
  function fileModels(name, type) {
    var m = (base.makes || []).filter(function (x) { return same(x, name, type); })[0];
    return m ? (m.models || []).length : 0;
  }

  wrap.addEventListener('toggle', function () { if (wrap.open && !merged) load(); });

  function load() {
    if (!key()) { note('Enter the admin key at the top of the page first.', 'error'); return; }
    note('Loading vehicles...');
    Promise.all([
      fetch('data/vehicles.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { makes: [] }; }),
      call('GET', '/vehicles/admin')
    ]).then(function (r) {
      if (!r[1].ok) { note('The admin key is not right.', 'error'); return; }
      base = r[0]; extra = normal(r[1].extra);
      refresh(); note('');
    }).catch(function () { note('Could not load the vehicles.', 'error'); });
  }

  function refresh() {
    merged = window.MT3UKVehicles.merge(base, extra, { all: true });
    var changed = {};
    (extra.makes || []).forEach(function (m) { changed[typeOf(m) + '|' + m.name] = true; });
    var rows = [];
    ['car', 'bike'].forEach(function (t) {
      Object.keys(merged[t]).forEach(function (n) { rows.push({ name: n, type: t, models: merged[t][n], hidden: !!merged.hidden[t][n] }); });
    });
    var hiddenCount = rows.filter(function (r) { return r.hidden; }).length;
    countEl.textContent = '(' + rows.length + ' makes' + (hiddenCount ? ', ' + hiddenCount + ' hidden' : '') + ')';
    var models = 0, unknown = 0;
    rows.forEach(function (r) { if (r.type !== 'car') return; r.models.forEach(function (m) { models++; if (!driveOf(r.name, m).drive) unknown++; }); });
    listEl.innerHTML = '<p class="iv-note vh-drive-note">' + models + ' car model' + (models === 1 ? '' : 's') + ', driven wheels ' + (unknown ? 'not known for ' + unknown : 'known for all') + '. ' +
      '<button type="button" class="tk-switch" role="switch" id="vh-unknown-only" aria-checked="' + unknownOnly + '"><span class="tk-track"></span>Only the ones not known</button></p>' +
      '<table class="iv-table tk-table vh-table' + (unknownOnly ? ' is-unknown-only' : '') + '"><thead><tr><th>Make</th><th>Type</th><th>Models and driven wheels</th><th></th></tr></thead><tbody>' + rows.map(function (r) {
      var items = r.models.map(function (m) { return modelHtml(r, m); }).join('');
      var targets = r.type === 'car' && r.models.some(function (m) { return !driveOf(r.name, m).drive; });
      var always = r.type === 'car' && r.name === 'Tesla';
      return '<tr class="vh-make' + (targets ? '' : ' vh-all-known') + (r.hidden ? ' is-hidden' : '') + '"><td><b>' + esc(r.name) + '</b>' + (r.hidden ? ' <span class="vh-badge">Hidden from members</span>' : '') + (changed[r.type + '|' + r.name] ? ' <span class="iv-sub">(changed here)</span>' : '') + '</td><td>' + TYPE_NAME[r.type] + '</td><td>' +
        '<span class="vh-count">' + r.models.length + ' model' + (r.models.length === 1 ? '' : 's') + '</span>' + (items ? '<ul class="vh-models">' + items + '</ul>' : '') + '</td>' +
        '<td><div class="iv-actions"><button type="button" class="secondary iv-act" data-edit="' + esc(r.name) + '" data-type="' + r.type + '">Edit</button><button type="button" class="danger iv-act" data-remove="' + esc(r.name) + '" data-type="' + r.type + '">Remove</button>' +
        '<button type="button" class="tk-switch vh-show" role="switch" data-show="' + esc(r.name) + '" data-type="' + r.type + '" aria-checked="' + !r.hidden + '" aria-label="Show ' + esc(r.name) + ' to members"' +
        (always ? ' disabled title="Tesla is always offered in My Garage"' : '') + '><span class="tk-track"></span>Shown</button></div></td></tr>';
    }).join('') + '</tbody></table><div class="iv-toolbar tk-top"><button type="button" class="secondary" data-new>Add a make</button></div>' + removedHtml();
  }

  // Makes taken off the list: each can be restored, which brings back the built-in entry with its models and variants.
  function removedHtml() {
    var removed = (extra.makes || []).filter(function (m) { return m.removed; });
    return '<h3 class="sub-head">Removed makes</h3>' + (removed.length
      ? '<p class="iv-note">Makes taken off the list. Restore brings back the built-in entry with its models and variants (a make you renamed here is listed under its old name).</p>' +
        '<table class="iv-table tk-table vh-removed"><thead><tr><th>Make</th><th>Type</th><th>Built-in list</th><th></th></tr></thead><tbody>' + removed.map(function (m) {
          var n = fileModels(m.name, typeOf(m));
          return '<tr class="vh-removed-row"><td><b>' + esc(m.name) + '</b></td><td>' + TYPE_NAME[typeOf(m)] + '</td><td>' + n + ' model' + (n === 1 ? '' : 's') + '</td>' +
            '<td><button type="button" class="secondary iv-act" data-restore="' + esc(m.name) + '" data-type="' + typeOf(m) + '">Restore</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="empty">No makes have been removed.</p>');
  }

  // A car model's driven wheels: the rule's answer for the model alone, the admin's default if set, and what to say.
  function driveOf(make, model) {
    var V = window.MT3UKVehicles, v = { make: make, model: model };
    var key = V.driveKey(v), rule = V.driveRule(v), set = (extra.drives || {})[key] || '';
    var varies = !rule && VARIES[key];
    return { key: key, rule: rule, set: set, drive: set || rule || (varies ? 'version' : ''),
      how: set ? 'set here' + (rule ? ' (worked out: ' + rule + ')' : varies ? ' (else from the version)' : '') : rule ? 'worked out' : varies ? 'from the version' : 'not known' };
  }
  function variantsOf(r, model) { return ((merged.versions[r.type] || {})[r.name] || {})[model] || []; }
  function ruleOf(r, model) { return ((merged.versionRules[r.type] || {})[r.name] || {})[model] || {}; }
  // What a variant drives: its own value set here, else what the name and the model's default say.
  function variantDrive(r, model, variant) {
    var V = window.MT3UKVehicles, v = { make: r.name, model: model, version: variant };
    var key = V.driveVariantKey(v), set = (extra.drives || {})[key] || '';
    return { key: key, set: set, drive: set || V.drive(v, extra.drives) || '' };
  }
  function variantNote(r, model) {
    var rule = ruleOf(r, model), words = [];
    if (rule.required) words.push('version required');
    if (rule.free) words.push('free text');
    var vs = variantsOf(r, model), list = '';
    if (vs.length) {
      list = '<details class="vh-vlist"><summary>' + vs.length + ' variant' + (vs.length === 1 ? '' : 's') + '</summary><ul>' + vs.map(function (x) {
        var d = r.type === 'car' ? variantDrive(r, model, x) : null;
        return '<li><span class="vh-vn">' + esc(x) + '</span>' + (d ? '<span class="iv-sub vh-vd">' + (d.drive ? esc(d.drive) + (d.set ? ' (set here)' : '') : 'not known') + '</span>' : '') + '</li>';
      }).join('') + '</ul></details>';
    }
    return list + (words.length ? '<span class="iv-sub vh-variants">' + words.join(', ') + '</span>' : '');
  }
  // The Version box rule switches on a model's row (the same two as on the Edit form); a change saves at once.
  function ruleSwitches(r, model) {
    var rule = ruleOf(r, model);
    return '<span class="vh-rules">' + [['required', 'Required'], ['free', 'Free text']].map(function (x) {
      return '<button type="button" class="tk-switch vh-rule-row" role="switch" data-rule="' + x[0] + '" aria-checked="' + !!rule[x[0]] + '" aria-label="Version ' + x[1].toLowerCase() + ' for ' + esc(r.name + ' ' + model) + '"><span class="tk-track"></span>' + x[1] + '</button>';
    }).join('') + '</span>';
  }
  function modelHtml(r, model) {
    if (r.type !== 'car') return '<li class="vh-model" data-make="' + esc(r.name) + '" data-model="' + esc(model) + '"><span class="vh-model-name">' + esc(model) + '</span>' + ruleSwitches(r, model) + variantNote(r, model) + '</li>';
    var d = driveOf(r.name, model);
    return '<li class="vh-model' + (d.drive ? '' : ' is-target') + '" data-make="' + esc(r.name) + '" data-model="' + esc(model) + '"><span class="vh-model-name">' + esc(model) + '</span>' +
      '<select class="vh-drive" aria-label="Driven wheels for ' + esc(r.name + ' ' + model) + '"><option value="">' + (d.rule ? 'Worked out: ' + d.rule : d.drive === 'version' ? 'From the version' : 'Not known') + '</option>' +
      DRIVES.map(function (x) { return '<option value="' + x + '"' + (d.set === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
      '<span class="iv-sub vh-how">' + (d.set || !d.drive ? esc(d.how) : '') + '</span>' + ruleSwitches(r, model) + variantNote(r, model) + '</li>';
  }

  function openForm(name, type) {
    var existing = name != null;
    var models = existing ? merged[type][name] : [];
    var versions = existing ? (merged.versions[type] || {})[name] || {} : {};
    var rules = existing ? (merged.versionRules[type] || {})[name] || {} : {};
    var changedHere = existing && inFile(name, type) && (extra.makes || []).some(function (m) { return same(m, name, type); });
    formEl.hidden = false;
    formEl.dataset.edit = existing ? name : '';
    formEl.dataset.type = existing ? type : '';
    formEl.innerHTML = '<h3>' + (existing ? 'Edit ' + esc(name) + ' (' + TYPE_NAME[type].toLowerCase() + ')' : 'Add a make') + '</h3>' +
      '<label>Make<input type="text" id="vh-name" maxlength="40" value="' + esc(name || '') + '"></label>' +
      (existing ? '<p class="iv-note">Renaming a make renames it on the list; cars that already use the old name keep it.</p>' : '') +
      '<label>Type<select class="field" id="vh-type"' + (existing ? ' disabled' : '') + '><option value="car"' + (type === 'car' || !existing ? ' selected' : '') + '>Car</option><option value="bike"' + (type === 'bike' ? ' selected' : '') + '>Bike</option></select></label>' +
      '<p class="vh-variants-head">Models and their variants</p>' +
      '<div class="vh-mblocks" id="vh-mblocks">' + models.map(function (m) { return modelBlock(m, versions[m] || [], rules[m] || {}, existing ? type : 'car', existing ? name : ''); }).join('') + '</div>' +
      '<div class="iv-toolbar"><button type="button" class="secondary" id="vh-add-model">Add a model</button></div>' +
      '<p class="iv-note">Each model is a block: change its name, remove it, and below it change or remove each variant (the Version choices My Garage offers, such as Performance or Long Range AWD) with the wheels it drives. A variant left on Worked out takes what its name says (AWD, RWD, 4S and so on) and the model\'s default; picking FWD, RWD or AWD sets that variant. <b>Required</b> makes the member pick a version (the box is otherwise optional) and <b>Free text</b> adds a Type it in choice so they can type any version.</p>' +
      '<div class="iv-toolbar"><button type="button" id="vh-save">Save make</button><button type="button" class="secondary" id="vh-cancel">Cancel</button>' +
      (changedHere ? '<button type="button" class="secondary" id="vh-reset">Use the built-in list</button>' : '') + '</div>' +
      (changedHere ? '<p class="iv-note">This make was changed here. Use the built-in list throws those changes away (models, variants and rules) and shows the list in data/vehicles.json again.</p>' : '');
    refreshWorked();
    formEl.scrollIntoView({ block: 'nearest' });
  }
  // One model: its name, Remove, its variants (a row each) and the Version box rule.
  // A kerb weight (kg, the maker's figure) for the model, and for a variant that differs from it: Compare tyres and
  // Compare pads group cars by it. Kept in the library's weights under the same keys as the driven wheels.
  function weightOf(make, model, version) {
    var V = window.MT3UKVehicles, w = extra.weights || {};
    if (!V || !make || !model) return '';
    return (version ? w[V.driveVariantKey({ make: make, model: model, version: version })] : w[V.driveKey({ make: make, model: model })]) || '';
  }
  function modelBlock(model, variants, rule, type, make) {
    var V = window.MT3UKVehicles, drives = extra.drives || {};
    return '<div class="vh-mblock" data-model-block><div class="vh-mhead"><input type="text" class="vh-mname" maxlength="60" value="' + esc(model) + '" placeholder="Model name" aria-label="Model name">' +
      '<label class="vh-weight">Kerb weight (kg)<input type="number" class="vh-mweight" min="300" max="4000" value="' + esc(weightOf(make, model)) + '" placeholder="e.g. 1850"></label>' +
      '<button type="button" class="danger iv-act vh-mremove" aria-label="Remove the model ' + esc(model) + '">Remove model</button></div>' +
      '<div class="vh-vrows">' + variants.map(function (x) {
        var set = type === 'car' && make && V ? drives[V.driveVariantKey({ make: make, model: model, version: x })] || '' : '';
        return variantRow(x, set, type, weightOf(make, model, x));
      }).join('') + '</div>' +
      '<button type="button" class="secondary iv-act vh-vadd">Add a variant</button>' +
      '<div class="vh-rules"><button type="button" class="tk-switch vh-rule" role="switch" data-rule="required" aria-checked="' + !!rule.required + '"><span class="tk-track"></span>Required</button>' +
      '<button type="button" class="tk-switch vh-rule" role="switch" data-rule="free" aria-checked="' + !!rule.free + '"><span class="tk-track"></span>Free text</button></div></div>';
  }
  // One variant: its name, the wheels it drives (a car's only; its first choice says what it works out as) and Remove.
  function variantRow(name, set, type, weight) {
    return '<div class="vh-vrow"><input type="text" class="vh-vname" maxlength="60" value="' + esc(name) + '" placeholder="Variant name" aria-label="Variant name">' +
      '<input type="number" class="vh-vweight" min="300" max="4000" value="' + esc(weight || '') + '" placeholder="Weight (kg)" aria-label="Kerb weight for this variant, if it differs from the model\'s">' +
      (type === 'bike' ? '' : '<select class="vh-vdrive" aria-label="Driven wheels for this variant"><option value="">Worked out</option>' +
        DRIVES.map(function (x) { return '<option value="' + x + '"' + (set === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>') +
      '<button type="button" class="danger iv-act vh-vremove" aria-label="Remove the variant ' + esc(name) + '">Remove</button></div>';
  }
  // The first choice of each variant's wheels says what it works out as, for the make and model typed now.
  function refreshWorked() {
    var V = window.MT3UKVehicles, make = (document.getElementById('vh-name') || {}).value || '';
    var defaults = {};
    Object.keys(extra.drives || {}).forEach(function (k) { if (k.split('|').length === 2) defaults[k] = extra.drives[k]; });
    formEl.querySelectorAll('[data-model-block]').forEach(function (b) {
      var model = b.querySelector('.vh-mname').value.trim();
      b.querySelectorAll('.vh-vrow').forEach(function (row) {
        var sel = row.querySelector('.vh-vdrive');
        if (!sel || !V) return;
        var d = make.trim() && model ? V.drive({ make: make.trim(), model: model, version: row.querySelector('.vh-vname').value.trim() }, defaults) : '';
        sel.options[0].textContent = d ? 'Worked out: ' + d : 'Worked out: not known';
      });
    });
  }

  function put(done) {
    call('PUT', '/vehicles/admin', { library: extra }).then(function (d) {
      if (!d.ok) { note(d.message || 'Could not save it.', 'error'); return; }
      extra = normal(d.extra);
      formEl.hidden = true;
      refresh();
      var rs = d.restamped || {};
      note('Saved. ' + (done ? done + ' ' : '') + 'Track sessions and Laps use it straight away.' + (rs.vehicles ? ' Driven wheels re-stamped on ' + rs.vehicles + ' vehicle' + (rs.vehicles === 1 ? '' : 's') + ' (' + rs.stamped + ' session' + (rs.stamped === 1 ? '' : 's') + (rs.boards ? ', ' + rs.boards + ' leaderboard' + (rs.boards === 1 ? '' : 's') + ' refreshed' : '') + ').' : ''), 'ok');
      if (rs.vehicles) document.dispatchEvent(new CustomEvent('mt3uk-drive-changed'));
    }).catch(function () { note('Could not save it.', 'error'); });
  }

  listEl.addEventListener('change', function (e) {
    var sel = e.target.closest('.vh-drive');
    if (!sel) return;
    var li = sel.closest('.vh-model'), make = li.getAttribute('data-make'), model = li.getAttribute('data-model');
    sel.disabled = true;
    note('Saving...');
    call('POST', '/track/admin/drive', { make: make, model: model, drive: sel.value }).then(function (d) {
      sel.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); return; }
      extra.drives = extra.drives || {};
      if (d.drive) extra.drives[d.key] = d.drive; else delete extra.drives[d.key];
      var info = driveOf(make, model);
      li.classList.toggle('is-target', !info.drive);
      li.querySelector('.vh-how').textContent = info.set || !info.drive ? info.how : '';
      var tr = li.closest('tr');
      tr.classList.toggle('vh-all-known', !tr.querySelector('.vh-model.is-target'));
      note((d.drive ? d.drive + ' is now the default for ' + make + ' ' + model : 'Default cleared for ' + make + ' ' + model) + ': ' + d.vehicles + ' vehicle' + (d.vehicles === 1 ? '' : 's') + ' with sessions, ' +
        d.stamped + ' session' + (d.stamped === 1 ? '' : 's') + ' stamped' + (d.boards ? ' and ' + d.boards + ' leaderboard' + (d.boards === 1 ? '' : 's') + ' refreshed' : '') + '.', 'ok');
      document.dispatchEvent(new CustomEvent('mt3uk-drive-changed'));
    }).catch(function () { sel.disabled = false; note('Could not reach the server.', 'error'); });
  });
  listEl.addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]'), rm = e.target.closest('[data-remove]');
    if (e.target.closest('#vh-unknown-only')) {
      unknownOnly = !unknownOnly;
      e.target.closest('#vh-unknown-only').setAttribute('aria-checked', String(unknownOnly));
      listEl.querySelector('.vh-table').classList.toggle('is-unknown-only', unknownOnly);
      return;
    }
    var rs = e.target.closest('.vh-rule-row');
    if (rs) {
      // Save the make as it is, with this one rule switched.
      var li = rs.closest('.vh-model'), tr = li.closest('tr'), mk = li.getAttribute('data-make'), md = li.getAttribute('data-model');
      var ty = tr.querySelector('[data-edit]').getAttribute('data-type');
      var rules = {}, src = (merged.versionRules[ty] || {})[mk] || {};
      Object.keys(src).forEach(function (m) { rules[m] = { required: !!src[m].required, free: !!src[m].free }; });
      rules[md] = rules[md] || {};
      rules[md][rs.getAttribute('data-rule')] = rs.getAttribute('aria-checked') !== 'true';
      Object.keys(rules).forEach(function (m) { if (!rules[m].required) delete rules[m].required; if (!rules[m].free) delete rules[m].free; if (!Object.keys(rules[m]).length) delete rules[m]; });
      extra.makes = (extra.makes || []).filter(function (m) { return !same(m, mk, ty); });
      var entry = { name: mk, type: ty, models: merged[ty][mk].slice(), versions: (merged.versions[ty] || {})[mk] || {} };
      if (Object.keys(rules).length) entry.versionRules = rules;
      extra.makes.push(entry);
      note('Saving...');
      put();
      return;
    }
    var sh = e.target.closest('.vh-show');
    if (sh) {
      if (sh.disabled) return;
      var hn = sh.getAttribute('data-show'), ht = sh.getAttribute('data-type'), nowShown = sh.getAttribute('aria-checked') === 'true';
      unhide(hn, ht);
      if (nowShown) extra.hiddenMakes.push({ name: hn, type: ht });
      note('Saving...');
      put(nowShown ? hn + ' is hidden from members: its models and variants are kept here.' : hn + ' is shown to members again.');
      return;
    }
    var rst = e.target.closest('[data-restore]');
    if (rst) {
      var qn = rst.getAttribute('data-restore'), qt = rst.getAttribute('data-type');
      extra.makes = (extra.makes || []).filter(function (m) { return !(same(m, qn, qt) && m.removed); });
      note('Saving...');
      put(qn + ' is back, with the built-in models and variants.');
      return;
    }
    if (e.target.closest('[data-new]')) return openForm(null);
    if (ed) return openForm(ed.getAttribute('data-edit'), ed.getAttribute('data-type'));
    if (rm) {
      var name = rm.getAttribute('data-remove'), type = rm.getAttribute('data-type');
      var fromFile = inFile(name, type);
      if (!window.confirm(fromFile
        ? 'Remove ' + name + ' (' + type + ') from the list? Cars that already use it keep it, and you can bring it back from Removed makes below. To keep its models and variants and only stop members choosing it, hide it instead.'
        : 'Remove ' + name + ' (' + type + ')? It was added here, so this deletes it for good. To keep its models and variants and only stop members choosing it, hide it instead.')) return;
      extra.makes = (extra.makes || []).filter(function (m) { return !same(m, name, type); });
      unhide(name, type);
      if (fromFile) extra.makes.push({ name: name, type: type, removed: true });
      put(name + ' is removed.');
    }
  });
  formEl.addEventListener('input', function (e) {
    if (e.target.classList.contains('vh-vname') || e.target.classList.contains('vh-mname') || e.target.id === 'vh-name') refreshWorked();
  });
  formEl.addEventListener('change', function (e) {
    if (e.target.id === 'vh-type') {
      // A bike has no driven wheels: its variants lose that choice (and gain it back for a car).
      var tp = e.target.value;
      formEl.querySelectorAll('.vh-vrow').forEach(function (row) {
        var name = row.querySelector('.vh-vname').value;
        row.outerHTML = variantRow(name, '', tp, row.querySelector('.vh-vweight').value);
      });
      refreshWorked();
    }
  });
  formEl.addEventListener('click', function (e) {
    var sw = e.target.closest('.vh-rule');
    if (sw) { sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); return; }
    var bikeForm = (formEl.dataset.edit ? formEl.dataset.type : (document.getElementById('vh-type') || {}).value) === 'bike';
    if (e.target.closest('.vh-vremove')) { e.target.closest('.vh-vrow').remove(); return; }
    if (e.target.closest('.vh-mremove')) { e.target.closest('[data-model-block]').remove(); return; }
    var vadd = e.target.closest('.vh-vadd');
    if (vadd) {
      var rows = vadd.closest('[data-model-block]').querySelector('.vh-vrows');
      rows.insertAdjacentHTML('beforeend', variantRow('', '', bikeForm ? 'bike' : 'car'));
      refreshWorked();
      rows.lastElementChild.querySelector('.vh-vname').focus();
      return;
    }
    if (e.target.id === 'vh-add-model') {
      var blocks = document.getElementById('vh-mblocks');
      blocks.insertAdjacentHTML('beforeend', modelBlock('', [], {}, bikeForm ? 'bike' : 'car', ''));
      blocks.lastElementChild.querySelector('.vh-mname').focus();
      return;
    }
    if (e.target.id === 'vh-cancel') { formEl.hidden = true; return; }
    if (e.target.id === 'vh-reset') {
      var rn = formEl.dataset.edit, rt = formEl.dataset.type;
      if (!window.confirm('Go back to the built-in list for ' + rn + '? The models, variants and rules changed here are thrown away.')) return;
      extra.makes = (extra.makes || []).filter(function (m) { return !same(m, rn, rt); });
      put();
      return;
    }
    if (e.target.id !== 'vh-save') return;
    var name = document.getElementById('vh-name').value.trim();
    var type = formEl.dataset.edit ? formEl.dataset.type : document.getElementById('vh-type').value;
    if (!name) { note('A make needs a name.', 'error'); return; }
    var was = formEl.dataset.edit || '', renaming = !!was && was !== name;
    if ((!was || renaming) && merged[type][name]) { note(name + ' is already on the ' + type + ' list. Edit it instead.', 'error'); return; }
    // The models, each with its variants, rule and the wheels set on a variant, from the blocks.
    var models = [], versions = {}, versionRules = {}, variantDrives = {}, seenModel = {}, makeWeights = {};
    var V = window.MT3UKVehicles;
    formEl.querySelectorAll('[data-model-block]').forEach(function (b) {
      var m = b.querySelector('.vh-mname').value.trim();
      if (!m || seenModel[m.toLowerCase()]) return;
      seenModel[m.toLowerCase()] = true;
      models.push(m);
      var mw = parseInt(b.querySelector('.vh-mweight').value, 10);
      if (mw >= 300 && mw <= 4000) makeWeights[V.driveKey({ make: name, model: m })] = mw;
      var list = [], seenV = {};
      b.querySelectorAll('.vh-vrow').forEach(function (row) {
        var v = row.querySelector('.vh-vname').value.trim();
        if (!v || seenV[v.toLowerCase()]) return;
        seenV[v.toLowerCase()] = true;
        list.push(v);
        var sel = row.querySelector('.vh-vdrive');
        if (sel && sel.value && type === 'car') variantDrives[V.driveVariantKey({ make: name, model: m, version: v })] = sel.value;
        var vw = parseInt(row.querySelector('.vh-vweight').value, 10);
        if (vw >= 300 && vw <= 4000) makeWeights[V.driveVariantKey({ make: name, model: m, version: v })] = vw;
      });
      if (list.length) versions[m] = list;
      var rule = {};
      b.querySelectorAll('.vh-rule').forEach(function (sw) { if (sw.getAttribute('aria-checked') === 'true') rule[sw.getAttribute('data-rule')] = true; });
      if (Object.keys(rule).length) versionRules[m] = rule;
    });
    if (renaming && isHidden(was, type)) { unhide(was, type); extra.hiddenMakes.push({ name: name, type: type }); }
    extra.makes = (extra.makes || []).filter(function (m) { return !same(m, name, type) && !(renaming && same(m, was, type)); });
    // The old name goes: taken off the file's list, or simply dropped from the changes made here.
    if (renaming && inFile(was, type)) extra.makes.push({ name: was, type: type, removed: true });
    // The wheels set on this make's variants are replaced by the ones in the form; other makes' stay.
    var makePart = V.driveKey({ make: name, model: 'x' }).split('|')[0], drives = {};
    Object.keys(extra.drives || {}).forEach(function (k) {
      var parts = k.split('|');
      if (!(parts.length === 3 && parts[0] === makePart)) drives[k] = extra.drives[k];
    });
    Object.keys(variantDrives).forEach(function (k) { drives[k] = variantDrives[k]; });
    extra.drives = drives;
    // This make's weights are replaced by the ones in the form (and a renamed make's old ones dropped).
    var weights = {}, wasPart = was ? V.driveKey({ make: was, model: 'x' }).split('|')[0] : '';
    Object.keys(extra.weights || {}).forEach(function (k) { var p0 = k.split('|')[0]; if (p0 !== makePart && p0 !== wasPart) weights[k] = extra.weights[k]; });
    Object.keys(makeWeights).forEach(function (k) { weights[k] = makeWeights[k]; });
    extra.weights = weights;
    var entry = { name: name, type: type, models: models, versions: versions };
    if (Object.keys(versionRules).length) entry.versionRules = versionRules;
    extra.makes.push(entry);
    put();
  });
})();
