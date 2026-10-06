/*
  track-admin.html, Vehicles panel: the vehicle makes and models Track sessions and
  Laps offer. data/vehicles.json is the starting list; changes made here are
  stored by the worker (KV vehicle-library, /vehicles/admin) on top of it.
  A make has a type, car or bike (BMW and Honda are both). Edit renames a make
  (cars that already use the old name keep it), lists its models and, for each
  model, its variants (versions, one on each line), offered in My Garage's
  Version box, with the box's rule for that model: Required (it must be picked)
  and Free text (a "Type it in" choice lets the member type any version).
  Both are off unless set (versionRules in the library).
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
  function normal(e) { return { makes: (e && e.makes) || [], drives: (e && e.drives) || {} }; }
  function typeOf(m) { return m && m.type === 'bike' ? 'bike' : 'car'; }
  function inFile(name, type) { return (base.makes || []).some(function (m) { return m.name === name && typeOf(m) === type; }); }
  function same(m, name, type) { return m.name === name && typeOf(m) === type; }

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
    merged = window.MT3UKVehicles.merge(base, extra);
    var changed = {};
    (extra.makes || []).forEach(function (m) { changed[typeOf(m) + '|' + m.name] = true; });
    var rows = [];
    ['car', 'bike'].forEach(function (t) {
      Object.keys(merged[t]).forEach(function (n) { rows.push({ name: n, type: t, models: merged[t][n] }); });
    });
    countEl.textContent = '(' + rows.length + ' makes)';
    var models = 0, unknown = 0;
    rows.forEach(function (r) { if (r.type !== 'car') return; r.models.forEach(function (m) { models++; if (!driveOf(r.name, m).drive) unknown++; }); });
    listEl.innerHTML = '<p class="iv-note vh-drive-note">' + models + ' car model' + (models === 1 ? '' : 's') + ', driven wheels ' + (unknown ? 'not known for ' + unknown : 'known for all') + '. ' +
      '<button type="button" class="tk-switch" role="switch" id="vh-unknown-only" aria-checked="' + unknownOnly + '"><span class="tk-track"></span>Only the ones not known</button></p>' +
      '<table class="iv-table tk-table vh-table' + (unknownOnly ? ' is-unknown-only' : '') + '"><thead><tr><th>Make</th><th>Type</th><th>Models and driven wheels</th><th></th></tr></thead><tbody>' + rows.map(function (r) {
      var items = r.models.map(function (m) { return modelHtml(r, m); }).join('');
      var targets = r.type === 'car' && r.models.some(function (m) { return !driveOf(r.name, m).drive; });
      return '<tr class="vh-make' + (targets ? '' : ' vh-all-known') + '"><td><b>' + esc(r.name) + '</b>' + (changed[r.type + '|' + r.name] ? ' <span class="iv-sub">(changed here)</span>' : '') + '</td><td>' + TYPE_NAME[r.type] + '</td><td>' +
        '<span class="vh-count">' + r.models.length + ' model' + (r.models.length === 1 ? '' : 's') + '</span>' + (items ? '<ul class="vh-models">' + items + '</ul>' : '') + '</td>' +
        '<td><div class="iv-actions"><button type="button" class="secondary iv-act" data-edit="' + esc(r.name) + '" data-type="' + r.type + '">Edit</button><button type="button" class="danger iv-act" data-remove="' + esc(r.name) + '" data-type="' + r.type + '">Remove</button></div></td></tr>';
    }).join('') + '</tbody></table><div class="iv-toolbar tk-top"><button type="button" class="secondary" data-new>Add a make</button></div>';
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
  function variantNote(r, model) {
    var n = variantsOf(r, model).length, rule = ruleOf(r, model);
    var words = [];
    if (n) words.push(n + ' variant' + (n === 1 ? '' : 's'));
    if (rule.required) words.push('version required');
    if (rule.free) words.push('free text');
    return words.length ? '<span class="iv-sub vh-variants">' + words.join(', ') + '</span>' : '';
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
    formEl.hidden = false;
    formEl.dataset.edit = existing ? name : '';
    formEl.dataset.type = existing ? type : '';
    formEl.innerHTML = '<h3>' + (existing ? 'Edit ' + esc(name) + ' (' + TYPE_NAME[type].toLowerCase() + ')' : 'Add a make') + '</h3>' +
      '<label>Make<input type="text" id="vh-name" maxlength="40" value="' + esc(name || '') + '"></label>' +
      (existing ? '<p class="iv-note">Renaming a make renames it on the list; cars that already use the old name keep it.</p>' : '') +
      '<label>Type<select class="field" id="vh-type"' + (existing ? ' disabled' : '') + '><option value="car"' + (type === 'car' || !existing ? ' selected' : '') + '>Car</option><option value="bike"' + (type === 'bike' ? ' selected' : '') + '>Bike</option></select></label>' +
      '<label>Models, one on each line<textarea id="vh-models" rows="8">' + esc(models.join('\n')) + '</textarea></label>' +
      '<div class="vh-variants-wrap" id="vh-variants">' + variantsHtml(models, versions, rules) + '</div>' +
      '<p class="iv-note">Variants are the Version choices My Garage offers for a model (Performance, Long Range AWD). A model added above gets a box once the make is saved. Under each box, <b>Required</b> makes the member pick a version (the box is otherwise optional) and <b>Free text</b> adds a Type it in choice so they can type any version.</p>' +
      '<div class="iv-toolbar"><button type="button" id="vh-save">Save make</button><button type="button" class="secondary" id="vh-cancel">Cancel</button>' +
      (existing && inFile(name, type) && (extra.makes || []).some(function (m) { return same(m, name, type); }) ? '<button type="button" class="secondary" id="vh-reset">Use the built-in list</button>' : '') + '</div>' +
      (existing && inFile(name, type) && (extra.makes || []).some(function (m) { return same(m, name, type); }) ? '<p class="iv-note">This make was changed here. Use the built-in list throws those changes away (models, variants and rules) and shows the list in data/vehicles.json again.</p>' : '');
    formEl.scrollIntoView({ block: 'nearest' });
  }
  function variantsHtml(models, versions, rules) {
    if (!models.length) return '';
    return '<p class="vh-variants-head">Variants, one on each line</p>' + models.map(function (m) {
      var rule = (rules || {})[m] || {};
      return '<div class="vh-variant" data-model="' + esc(m) + '"><label>' + esc(m) + '<textarea data-versions-for="' + esc(m) + '" rows="3">' + esc((versions[m] || []).join('\n')) + '</textarea></label>' +
        '<div class="vh-rules"><button type="button" class="tk-switch vh-rule" role="switch" data-rule="required" aria-checked="' + !!rule.required + '"><span class="tk-track"></span>Required</button>' +
        '<button type="button" class="tk-switch vh-rule" role="switch" data-rule="free" aria-checked="' + !!rule.free + '"><span class="tk-track"></span>Free text</button></div></div>';
    }).join('');
  }

  function put() {
    call('PUT', '/vehicles/admin', { library: extra }).then(function (d) {
      if (!d.ok) { note(d.message || 'Could not save it.', 'error'); return; }
      extra = normal(d.extra);
      formEl.hidden = true;
      refresh();
      note('Saved. Track sessions and Laps use it straight away.', 'ok');
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
    if (e.target.closest('[data-new]')) return openForm(null);
    if (ed) return openForm(ed.getAttribute('data-edit'), ed.getAttribute('data-type'));
    if (rm) {
      var name = rm.getAttribute('data-remove'), type = rm.getAttribute('data-type');
      if (!window.confirm('Take ' + name + ' (' + type + ') off the list? Cars that already use it keep it.')) return;
      extra.makes = (extra.makes || []).filter(function (m) { return !same(m, name, type); });
      if (inFile(name, type)) extra.makes.push({ name: name, type: type, removed: true });
      put();
    }
  });
  formEl.addEventListener('click', function (e) {
    var sw = e.target.closest('.vh-rule');
    if (sw) { sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); return; }
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
    var models = document.getElementById('vh-models').value.split('\n').map(function (m) { return m.trim(); }).filter(Boolean);
    // Each model's variants from its box; a model that is new to the list has none yet.
    var versions = {};
    formEl.querySelectorAll('[data-versions-for]').forEach(function (ta) {
      var list = ta.value.split('\n').map(function (v) { return v.trim(); }).filter(Boolean);
      if (list.length && models.indexOf(ta.getAttribute('data-versions-for')) !== -1) versions[ta.getAttribute('data-versions-for')] = list;
    });
    extra.makes = (extra.makes || []).filter(function (m) { return !same(m, name, type) && !(renaming && same(m, was, type)); });
    // The old name goes: taken off the file's list, or simply dropped from the changes made here.
    if (renaming && inFile(was, type)) extra.makes.push({ name: was, type: type, removed: true });
    // Each model's Version box rule from its switches; only the ones set are kept.
    var versionRules = {};
    formEl.querySelectorAll('.vh-variant[data-model]').forEach(function (box) {
      var m = box.getAttribute('data-model'), rule = {};
      if (models.indexOf(m) === -1) return;
      box.querySelectorAll('.vh-rule').forEach(function (b) { if (b.getAttribute('aria-checked') === 'true') rule[b.getAttribute('data-rule')] = true; });
      if (Object.keys(rule).length) versionRules[m] = rule;
    });
    var entry = { name: name, type: type, models: models, versions: versions };
    if (Object.keys(versionRules).length) entry.versionRules = versionRules;
    extra.makes.push(entry);
    put();
  });
})();
