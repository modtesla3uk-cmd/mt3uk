/*
  track-admin.html, Brake pads panel: the pad makes and compounds Track sessions offers, and for each compound what
  its maker publishes (use, mu, working temperature range, notes), shown beside it in Compare pads and on the Add
  page. data/pads.json is the starting list; changes made here are stored by the worker (KV pad-library,
  /pads/admin) on top of it and used straight away.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('pads-wrap');
  if (!wrap) return;
  var listEl = document.getElementById('pd-list'), formEl = document.getElementById('pd-form'), noteEl = document.getElementById('pd-note'), countEl = document.getElementById('pads-count');
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
    return fetch(API + path + '?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function inFile(name) { return (base.makes || []).some(function (m) { return m.name === name; }); }

  wrap.addEventListener('toggle', function () { if (wrap.open && !merged) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap.open) load(); });

  function load() {
    if (!key()) { note('Enter the admin key at the top of the page first.', 'error'); return; }
    note('Loading brake pads...');
    Promise.all([
      fetch('data/pads.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { makes: [] }; }),
      call('GET', '/pads/admin')
    ]).then(function (r) {
      if (!r[1].ok) { note('The admin key is not right.', 'error'); return; }
      base = r[0]; extra = { makes: (r[1].extra && r[1].extra.makes) || [] };
      refresh(); note('');
    }).catch(function () { note('Could not load the brake pads.', 'error'); });
  }

  function refresh() {
    merged = window.MT3UKPads.merge(base, extra);
    var names = Object.keys(merged.makes);
    countEl.textContent = '(' + names.length + ' makes)';
    var changed = {};
    extra.makes.forEach(function (m) { changed[m.name] = true; });
    listEl.innerHTML = '<table class="iv-table tk-table pd-table"><thead><tr><th>Make</th><th>Compounds and maker data</th><th></th></tr></thead><tbody>' + names.map(function (n) {
      var list = merged.makes[n];
      return '<tr><td><b>' + esc(n) + '</b>' + (changed[n] ? '<span class="iv-sub">Changed here</span>' : '') + '</td><td>' + (list.length ? list.map(function (c) {
        var line = window.MT3UKPads.makerLine(c);
        return '<span class="pd-comp"><b>' + esc(c.name) + '</b>' + (line ? ' <span class="iv-sub pd-line">' + esc(line) + '</span>' : ' <span class="iv-sub pd-line pd-none">No maker data yet</span>') + '</span>';
      }).join('') : '<span class="iv-sub">No compounds</span>') + '</td>' +
        '<td><div class="iv-actions"><button type="button" class="secondary iv-act" data-edit="' + esc(n) + '">Edit</button><button type="button" class="danger iv-act" data-remove="' + esc(n) + '">Remove</button></div></td></tr>';
    }).join('') + '</tbody></table><div class="iv-toolbar tk-top"><button type="button" class="secondary" data-new>Add a make</button></div>';
  }

  function useOptions(v) {
    return '<option value="">Not set</option>' + merged.uses.map(function (u) { return '<option' + (u === v ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join('');
  }
  function compoundRow(c) {
    c = c || {};
    return '<div class="pd-row" data-row>' +
      '<label>Compound<input type="text" data-f="name" maxlength="40" value="' + esc(c.name || '') + '" placeholder="e.g. RSL29"></label>' +
      '<label>Use<select data-f="use">' + useOptions(c.use) + '</select></label>' +
      '<label>Friction (μ)<input type="text" data-f="mu" maxlength="20" value="' + esc(c.mu || '') + '" placeholder="e.g. 0.50"></label>' +
      '<label>From (°C)<input type="number" data-f="tempMin" min="0" max="1500" value="' + esc(c.tempMin != null ? c.tempMin : '') + '"></label>' +
      '<label>To (°C)<input type="number" data-f="tempMax" min="0" max="1500" value="' + esc(c.tempMax != null ? c.tempMax : '') + '"></label>' +
      '<label class="pd-notes">Notes<input type="text" data-f="notes" maxlength="200" value="' + esc(c.notes || '') + '" placeholder="e.g. Good initial bite, low disc wear"></label>' +
      '<button type="button" class="danger iv-act" data-drop>Remove</button></div>';
  }
  function openForm(name) {
    var existing = name != null;
    var list = existing ? merged.makes[name] : [];
    formEl.hidden = false;
    formEl.dataset.edit = existing ? name : '';
    formEl.innerHTML = '<h3>' + (existing ? 'Edit ' + esc(name) : 'Add a make') + '</h3>' +
      '<label>Make<input type="text" id="pd-name" maxlength="40" value="' + esc(name || '') + '"' + (existing ? ' readonly' : '') + '></label>' +
      '<p class="iv-note">Each compound with what its maker publishes. Leave a figure blank rather than guess it: members see "Maker\'s figures" beside what Laps has measured.</p>' +
      '<div id="pd-rows">' + (list.length ? list : [{}]).map(compoundRow).join('') + '</div>' +
      '<div class="iv-toolbar"><button type="button" class="secondary" id="pd-add-row">Add a compound</button></div>' +
      '<div class="iv-toolbar"><button type="button" id="pd-save">Save make</button><button type="button" class="secondary" id="pd-cancel">Cancel</button>' +
      (existing && inFile(name) && extra.makes.some(function (m) { return m.name === name; }) ? '<button type="button" class="secondary" id="pd-reset">Use the built-in list</button>' : '') + '</div>';
    formEl.scrollIntoView({ block: 'nearest' });
  }
  function readRows() {
    return Array.prototype.map.call(formEl.querySelectorAll('[data-row]'), function (row) {
      var o = {};
      row.querySelectorAll('[data-f]').forEach(function (el) {
        var v = el.value.trim();
        if (v === '') return;
        o[el.getAttribute('data-f')] = el.type === 'number' ? Number(v) : v;
      });
      return o;
    }).filter(function (o) { return o.name; });
  }

  function put() {
    call('PUT', '/pads/admin', { library: extra }).then(function (d) {
      if (!d.ok) { note(d.message || 'Could not save it.', 'error'); return; }
      extra = { makes: (d.extra && d.extra.makes) || [] };
      formEl.hidden = true;
      refresh();
      note('Saved. Track sessions use it straight away.', 'ok');
    }).catch(function () { note('Could not save it.', 'error'); });
  }

  listEl.addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]'), rm = e.target.closest('[data-remove]');
    if (e.target.closest('[data-new]')) return openForm(null);
    if (ed) return openForm(ed.getAttribute('data-edit'));
    if (rm) {
      var name = rm.getAttribute('data-remove');
      if (!window.confirm('Take ' + name + ' off the list? Sessions that already use it keep it.')) return;
      extra.makes = extra.makes.filter(function (m) { return m.name !== name; });
      if (inFile(name)) extra.makes.push({ name: name, removed: true });
      put();
    }
  });
  formEl.addEventListener('click', function (e) {
    if (e.target.id === 'pd-cancel') { formEl.hidden = true; return; }
    if (e.target.id === 'pd-add-row') { document.getElementById('pd-rows').insertAdjacentHTML('beforeend', compoundRow({})); return; }
    if (e.target.closest('[data-drop]')) { e.target.closest('[data-row]').remove(); return; }
    if (e.target.id === 'pd-reset') {
      var n = formEl.dataset.edit;
      extra.makes = extra.makes.filter(function (m) { return m.name !== n; });
      put();
      return;
    }
    if (e.target.id !== 'pd-save') return;
    var name = document.getElementById('pd-name').value.trim();
    if (!name) { note('A make needs a name.', 'error'); return; }
    if (!formEl.dataset.edit && merged.makes[name]) { note(name + ' is already on the list. Edit it instead.', 'error'); return; }
    extra.makes = extra.makes.filter(function (m) { return m.name !== name; }).concat([{ name: name, compounds: readRows() }]);
    put();
  });
})();
