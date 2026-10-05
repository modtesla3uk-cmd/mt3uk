/*
  track-admin.html, Vehicles panel: the vehicle makes and models Track sessions and
  Laps offer. data/vehicles.json is the starting list; changes made here are
  stored by the worker (KV vehicle-library, /vehicles/admin) on top of it.
  A make has a type, car or bike (BMW and Honda are both).
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('vehicles-wrap');
  if (!wrap) return;
  var listEl = document.getElementById('vh-list'), formEl = document.getElementById('vh-form'), noteEl = document.getElementById('vh-note'), countEl = document.getElementById('vehicles-count');
  var TYPE_NAME = { car: 'Car', bike: 'Bike' };
  var base = null, extra = null, merged = null;

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
  function normal(e) { return { makes: (e && e.makes) || [] }; }
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
    listEl.innerHTML = '<table class="iv-table tk-table"><thead><tr><th>Make</th><th>Type</th><th>Models</th><th></th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr><td><b>' + esc(r.name) + '</b>' + (changed[r.type + '|' + r.name] ? ' <span class="iv-sub">(changed here)</span>' : '') + '</td><td>' + TYPE_NAME[r.type] + '</td><td>' + r.models.length +
        (r.models.length ? '<span class="iv-sub">' + esc(r.models.slice(0, 6).join(', ') + (r.models.length > 6 ? ', ...' : '')) + '</span>' : '') + '</td>' +
        '<td><div class="iv-actions"><button type="button" class="secondary iv-act" data-edit="' + esc(r.name) + '" data-type="' + r.type + '">Edit</button><button type="button" class="danger iv-act" data-remove="' + esc(r.name) + '" data-type="' + r.type + '">Remove</button></div></td></tr>';
    }).join('') + '</tbody></table><div class="iv-toolbar tk-top"><button type="button" class="secondary" data-new>Add a make</button></div>';
  }

  function openForm(name, type) {
    var existing = name != null;
    var models = existing ? merged[type][name] : [];
    formEl.hidden = false;
    formEl.dataset.edit = existing ? name : '';
    formEl.dataset.type = existing ? type : '';
    formEl.innerHTML = '<h3>' + (existing ? 'Edit ' + esc(name) + ' (' + TYPE_NAME[type].toLowerCase() + ')' : 'Add a make') + '</h3>' +
      '<label>Make<input type="text" id="vh-name" maxlength="40" value="' + esc(name || '') + '"' + (existing ? ' readonly' : '') + '></label>' +
      '<label>Type<select class="field" id="vh-type"' + (existing ? ' disabled' : '') + '><option value="car"' + (type === 'car' || !existing ? ' selected' : '') + '>Car</option><option value="bike"' + (type === 'bike' ? ' selected' : '') + '>Bike</option></select></label>' +
      '<label>Models, one on each line<textarea id="vh-models" rows="8">' + esc(models.join('\n')) + '</textarea></label>' +
      '<div class="iv-toolbar"><button type="button" id="vh-save">Save make</button><button type="button" class="secondary" id="vh-cancel">Cancel</button></div>';
    formEl.scrollIntoView({ block: 'nearest' });
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

  listEl.addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]'), rm = e.target.closest('[data-remove]');
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
    if (e.target.id === 'vh-cancel') { formEl.hidden = true; return; }
    if (e.target.id !== 'vh-save') return;
    var name = document.getElementById('vh-name').value.trim();
    var type = formEl.dataset.edit ? formEl.dataset.type : document.getElementById('vh-type').value;
    if (!name) { note('A make needs a name.', 'error'); return; }
    var adding = !formEl.dataset.edit;
    if (adding && merged[type][name]) { note(name + ' is already on the ' + type + ' list. Edit it instead.', 'error'); return; }
    var models = document.getElementById('vh-models').value.split('\n').map(function (m) { return m.trim(); }).filter(Boolean);
    extra.makes = (extra.makes || []).filter(function (m) { return !same(m, name, type); }).concat([{ name: name, type: type, models: models }]);
    put();
  });
})();
