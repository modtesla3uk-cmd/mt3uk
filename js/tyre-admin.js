/*
  track-admin.html, Tyres panel: the tyre makes and models Track sessions offers.
  data/tyres.json is the starting list; changes made here are stored by the
  worker (KV tyre-library, /tyres/admin) on top of it. Also the sizes for the
  Width, Profile and Diameter drop-downs.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('tyres-wrap');
  if (!wrap) return;
  var listEl = document.getElementById('ty-list'), formEl = document.getElementById('ty-form'), sizesEl = document.getElementById('ty-sizes'), noteEl = document.getElementById('ty-note'), countEl = document.getElementById('tyres-count');
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
  function normal(e) { e = e || {}; return { makes: e.makes || [], info: e.info || {}, widths: e.widths, profiles: e.profiles, rims: e.rims }; }
  function inFile(name) { return (base.makes || []).some(function (m) { return m.name === name; }); }

  wrap.addEventListener('toggle', function () { if (wrap.open && !merged) load(); });

  function load() {
    if (!key()) { note('Enter the admin key at the top of the page first.', 'error'); return; }
    note('Loading tyres...');
    Promise.all([
      fetch('data/tyres.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { makes: [] }; }),
      call('GET', '/tyres/admin')
    ]).then(function (r) {
      if (!r[1].ok) { note('The admin key is not right.', 'error'); return; }
      base = r[0]; extra = normal(r[1].extra);
      refresh(); note('');
    }).catch(function () { note('Could not load the tyres.', 'error'); });
  }

  function refresh() {
    merged = window.MT3UKTyres.merge(base, extra);
    var names = Object.keys(merged.makes);
    countEl.textContent = '(' + names.length + ' makes)';
    var changed = {};
    (extra.makes || []).forEach(function (m) { changed[m.name] = true; });
    listEl.innerHTML = '<table class="iv-table tk-table"><thead><tr><th>Make</th><th>Models</th><th></th></tr></thead><tbody>' + names.map(function (n) {
      var models = merged.makes[n];
      var withData = models.filter(function (md) { return merged.info[n + '|' + md]; }).length;
      return '<tr><td><b>' + esc(n) + '</b>' + (changed[n] ? ' <span class="iv-sub">(changed here)</span>' : '') + '</td><td>' + models.length + (models.length ? '<span class="iv-sub">' + esc(models.slice(0, 4).join(', ')) + (models.length > 4 ? ', ...' : '') + '</span>' : '') + (models.length ? '<span class="iv-sub">Maker data for ' + withData + ' of ' + models.length + '</span>' : '') + '</td>' +
        '<td><div class="iv-actions"><button type="button" class="secondary iv-act" data-edit="' + esc(n) + '">Edit</button>' + (models.length ? '<button type="button" class="secondary iv-act" data-info="' + esc(n) + '">Maker data</button>' : '') + '<button type="button" class="danger iv-act" data-remove="' + esc(n) + '">Remove</button></div></td></tr>';
    }).join('') + '</tbody></table><div class="iv-toolbar tk-top"><button type="button" class="secondary" data-new>Add a make</button></div>';
    sizesEl.innerHTML = '<div class="tk-form"><p class="iv-note">The drop-down choices, separated by commas. Widths are in millimetres, profiles in per cent and diameters in inches.</p>' +
      [['widths', 'Widths (mm)'], ['profiles', 'Profiles (%)'], ['rims', 'Diameters (in)']].map(function (f) {
        return '<label>' + f[1] + '<input type="text" id="ty-' + f[0] + '" value="' + esc(merged[f[0]].join(', ')) + '"></label>';
      }).join('') +
      '<div class="iv-toolbar"><button type="button" id="ty-save-sizes">Save sizes</button><button type="button" class="secondary" id="ty-reset-sizes">Use the file\'s sizes</button></div></div>';
  }

  function openForm(name) {
    var existing = name != null;
    var models = existing ? merged.makes[name] : [];
    formEl.hidden = false;
    formEl.dataset.edit = existing ? name : '';
    formEl.innerHTML = '<h3>' + (existing ? 'Edit ' + esc(name) : 'Add a make') + '</h3>' +
      '<label>Make<input type="text" id="ty-name" maxlength="40" value="' + esc(name || '') + '"' + (existing ? ' readonly' : '') + '></label>' +
      '<label>Models, one on each line<textarea id="ty-models" rows="8">' + esc(models.join('\n')) + '</textarea></label>' +
      '<div class="iv-toolbar"><button type="button" id="ty-save">Save make</button><button type="button" class="secondary" id="ty-cancel">Cancel</button></div>';
    formEl.scrollIntoView({ block: 'nearest' });
  }

  // What each model's maker publishes: its category, the UK/EU tyre label's wet grip and rolling resistance (A to E)
  // and noise (dB), whether it is EV rated, and notes. Shown as the maker's figures in Compare tyres.
  function sel(f, v, opts, blank) {
    return '<select data-f="' + f + '"><option value="">' + (blank || 'Not set') + '</option>' + opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
  }
  function openInfo(make) {
    var cats = window.MT3UKTyres.CATEGORIES, grades = ['A', 'B', 'C', 'D', 'E'];
    formEl.hidden = false;
    formEl.dataset.infoMake = make; formEl.dataset.edit = '';
    formEl.innerHTML = '<h3>Maker data: ' + esc(make) + '</h3>' +
      '<p class="iv-note">For each model, what its maker publishes and the UK/EU tyre label shows. Leave anything you are not sure of as Not set: members see these marked as the maker\'s figures, beside what Laps has measured.</p>' +
      merged.makes[make].map(function (md) {
        var i = merged.info[make + '|' + md] || {};
        return '<div class="ty-info-row" data-model="' + esc(md) + '"><b class="ty-info-name">' + esc(md) + '</b>' +
          '<label>Category' + sel('category', i.category, cats) + '</label>' +
          '<label>Wet grip' + sel('wetGrip', i.wetGrip, grades) + '</label>' +
          '<label>Rolling resistance' + sel('rolling', i.rolling, grades) + '</label>' +
          '<label>Noise (dB)<input type="number" data-f="noise" min="50" max="90" value="' + esc(i.noise || '') + '"></label>' +
          '<label>EV rated' + sel('ev', i.ev ? 'Yes' : '', ['Yes']) + '</label>' +
          '<label class="ty-info-notes">Notes<input type="text" data-f="notes" maxlength="200" value="' + esc(i.notes || '') + '"></label></div>';
      }).join('') +
      '<div class="iv-toolbar"><button type="button" id="ty-save-info">Save maker data</button><button type="button" class="secondary" id="ty-cancel">Cancel</button></div>';
    formEl.scrollIntoView({ block: 'nearest' });
  }
  function saveInfo() {
    var make = formEl.dataset.infoMake;
    var info = Object.assign({}, extra.info || {});
    formEl.querySelectorAll('.ty-info-row').forEach(function (row) {
      var k = make + '|' + row.getAttribute('data-model'), o = {};
      row.querySelectorAll('[data-f]').forEach(function (el) {
        var f = el.getAttribute('data-f'), v = el.value.trim();
        if (!v) return;
        if (f === 'ev') o.ev = v === 'Yes';
        else if (f === 'noise') o.noise = Number(v);
        else o[f] = v;
      });
      if (Object.keys(o).length) info[k] = o; else delete info[k];
    });
    extra.info = info;
    put();
  }

  function put(done) {
    call('PUT', '/tyres/admin', { library: extra }).then(function (d) {
      if (!d.ok) { note(d.message || 'Could not save it.', 'error'); return; }
      extra = normal(d.extra);
      formEl.hidden = true;
      refresh();
      note('Saved. Track sessions use it straight away.', 'ok');
      if (done) done();
    }).catch(function () { note('Could not save it.', 'error'); });
  }
  function numbers(id) {
    return document.getElementById(id).value.split(/[\s,]+/).map(Number).filter(function (n) { return isFinite(n) && n > 0; });
  }

  listEl.addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]'), rm = e.target.closest('[data-remove]');
    if (e.target.closest('[data-new]')) return openForm(null);
    if (ed) return openForm(ed.getAttribute('data-edit'));
    var inf = e.target.closest('[data-info]');
    if (inf) return openInfo(inf.getAttribute('data-info'));
    if (rm) {
      var name = rm.getAttribute('data-remove');
      if (!window.confirm('Take ' + name + ' off the list? Sessions that already use it keep it.')) return;
      extra.makes = (extra.makes || []).filter(function (m) { return m.name !== name; });
      if (inFile(name)) extra.makes.push({ name: name, removed: true });
      put();
    }
  });
  formEl.addEventListener('click', function (e) {
    if (e.target.id === 'ty-cancel') { formEl.hidden = true; return; }
    if (e.target.id === 'ty-save-info') return saveInfo();
    if (e.target.id !== 'ty-save') return;
    var name = document.getElementById('ty-name').value.trim();
    if (!name) { note('A make needs a name.', 'error'); return; }
    var adding = !formEl.dataset.edit;
    if (adding && merged.makes[name]) { note(name + ' is already on the list. Edit it instead.', 'error'); return; }
    var models = document.getElementById('ty-models').value.split('\n').map(function (m) { return m.trim(); }).filter(Boolean);
    extra.makes = (extra.makes || []).filter(function (m) { return m.name !== name; }).concat([{ name: name, models: models }]);
    put();
  });
  sizesEl.addEventListener('click', function (e) {
    if (e.target.id === 'ty-save-sizes') {
      // Only a list that differs from the file's is kept as a change.
      ['widths', 'profiles', 'rims'].forEach(function (k) {
        var n = numbers('ty-' + k).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (x, y) { return x - y; });
        var file = window.MT3UKTyres.merge(base, {})[k];
        if (n.length && JSON.stringify(n) !== JSON.stringify(file)) extra[k] = n; else delete extra[k];
      });
      put();
    } else if (e.target.id === 'ty-reset-sizes') {
      delete extra.widths; delete extra.profiles; delete extra.rims;
      put();
    }
  });
})();
