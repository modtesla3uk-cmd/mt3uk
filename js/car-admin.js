/*
  track-admin.html, Members' cars panel: every car and bike in members' garages with its settings (type, make,
  model, version, year and driven wheels), from the worker's /track/admin/cars (admin key). Save on a row sends the
  changed settings; the worker writes them to the car, stamps its sessions and refreshes its leaderboard rows.
  The Make, Model and Version drop-downs offer the vehicle library's choices (js/vehicle-data.js) and Type it in,
  which opens a text box for anything else.
*/
(function () {
  var wrap = document.getElementById('cars-wrap');
  if (!wrap) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var listEl = document.getElementById('mc-list'), noteEl = document.getElementById('mc-note'), loadBtn = document.getElementById('mc-load');
  var filterEl = document.getElementById('mc-filter'), countEl = document.getElementById('cars-count');
  var DRIVES = ['FWD', 'RWD', 'AWD'];
  var cars = [];
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, bad) { noteEl.textContent = t || ''; noteEl.classList.toggle('is-bad', !!bad); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/track/admin/cars?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  var V = window.MT3UKVehicles;
  function makesOf(type) { return V && V.loaded ? Object.keys(V[type === 'bike' ? 'bike' : 'car'] || {}) : []; }
  function modelsOf(type, make) { return V && V.loaded ? ((V[type === 'bike' ? 'bike' : 'car'] || {})[make] || []) : []; }
  function versionsOf(c) { return V && V.loaded ? V.versionsFor({ make: c.make, model: c.model, vehicleType: c.vehicleType }) : []; }
  function options(list) { return list.map(function (x) { return '<option value="' + esc(x) + '"></option>'; }).join(''); }
  function matches(c, q) {
    if (!q) return true;
    return [c.owner, c.email, c.car, c.make, c.model, c.version, c.year].join(' ').toLowerCase().indexOf(q) !== -1;
  }
  var OTHER = '__other__';
  // The models offered when a car has no make: the garage's listed ones (Teslas, and the older names that carry
  // their make).
  var LISTED = ['Model 3', 'Model Y', 'Model S', 'Model X', 'Hyundai Ioniq 5 N', 'Hyundai Ioniq 6 N', 'Porsche Taycan'];
  function modelChoices(type, make) { return make ? modelsOf(type, make) : LISTED.concat(modelsOf(type, 'Tesla').filter(function (m) { return LISTED.indexOf(m) === -1; })); }
  // A drop-down of the library's choices, the car's own value if it is not listed, and Type it in, which opens a
  // text box after it; the typed words are what the row sends.
  function selectHtml(cls, label, list, value, empty) {
    var seen = {}, opts = list.slice();
    if (value && opts.indexOf(value) === -1) opts.push(value);
    return '<select class="' + cls + '" aria-label="' + label + '"><option value="">' + empty + '</option>' + opts.map(function (x) {
      if (seen[x]) return ''; seen[x] = true;
      return '<option value="' + esc(x) + '"' + (x === value ? ' selected' : '') + '>' + esc(x) + '</option>';
    }).join('') + '<option value="' + OTHER + '">Type it in</option></select>';
  }
  function rowHtml(c) {
    return '<tr class="mc-row' + (c.model ? '' : ' is-target') + '" data-car="' + esc(c.carId) + '">' +
      '<td data-label="Owner">' + esc(c.owner || c.email || 'Owner not known') + (c.owner && c.email ? '<span class="iv-sub">' + esc(c.email) + '</span>' : '') + '</td>' +
      '<td data-label="Car"><b>' + esc(c.car || 'A vehicle') + '</b>' + (c.garageOnly ? '<span class="mc-badge">Garage only</span>' : '') +
        '<span class="iv-sub">' + c.photos + ' photo' + (c.photos === 1 ? '' : 's') + ', ' + c.sessions + ' session' + (c.sessions === 1 ? '' : 's') + (c.model ? '' : ', no model') + '</span></td>' +
      '<td data-label="Type"><select class="mc-type" aria-label="Type"><option value="car"' + (c.vehicleType !== 'bike' ? ' selected' : '') + '>Car</option><option value="bike"' + (c.vehicleType === 'bike' ? ' selected' : '') + '>Bike</option></select></td>' +
      '<td data-label="Make">' + selectHtml('mc-make', 'Make', makesOf(c.vehicleType), c.make, 'Not set (Tesla)') + '</td>' +
      '<td data-label="Model">' + selectHtml('mc-model', 'Model', modelChoices(c.vehicleType, c.make), c.model, 'Not set') + '</td>' +
      '<td data-label="Version">' + selectHtml('mc-version', 'Version', versionsOf(c), c.version, 'Not set') + '</td>' +
      '<td data-label="Year"><input type="number" class="mc-year" min="1950" max="' + (new Date().getFullYear() + 1) + '" value="' + esc(c.year || '') + '" aria-label="Year"></td>' +
      '<td data-label="Driven wheels"><select class="mc-drive" aria-label="Driven wheels"><option value=""' + (c.set ? '' : ' selected') + '>' + (c.drive ? 'From the model (' + c.drive + ')' : 'Not known') + '</option>' +
        DRIVES.map(function (d) { return '<option value="' + d + '"' + (c.set && c.drive === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></td>' +
      '<td><button type="button" class="secondary iv-act mc-save">Save</button></td></tr>';
  }
  // What a Make, Model or Version drop-down holds: the typed words when Type it in is chosen.
  function picked(row, cls) {
    var sel = row.querySelector('.' + cls);
    if (sel.value !== OTHER) return sel.value;
    var box = row.querySelector('.' + cls + '-typed');
    return box ? box.value.trim() : '';
  }
  // Type it in opens a text box after the drop-down (and closes it when something else is picked).
  function showTyped(sel, cls) {
    var box = sel.parentNode.querySelector('.' + cls + '-typed');
    if (sel.value !== OTHER) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('input');
      box.type = 'text'; box.className = cls + '-typed'; box.maxLength = 50; box.placeholder = 'Type it';
      box.setAttribute('aria-label', sel.getAttribute('aria-label') + ', typed in');
      sel.insertAdjacentElement('afterend', box);
    }
    box.focus();
  }
  function refill(row, cls, label, list, value, empty) {
    var sel = row.querySelector('.' + cls), box = row.querySelector('.' + cls + '-typed');
    if (box) box.remove();
    sel.outerHTML = selectHtml(cls, label, list, value, empty);
  }
  function draw() {
    var q = filterEl.value.trim().toLowerCase(), shown = cars.filter(function (c) { return matches(c, q); });
    countEl.textContent = cars.length ? '(' + cars.length + ')' : '';
    listEl.innerHTML = cars.length ? '<p class="iv-note">' + cars.length + ' vehicle' + (cars.length === 1 ? '' : 's') + (q ? ', ' + shown.length + ' shown' : '') + ', ' + cars.filter(function (c) { return !c.model; }).length + ' with no model.</p>' +
      '<table class="iv-table tk-table mc-table"><thead><tr><th>Owner</th><th>Car</th><th>Type</th><th>Make</th><th>Model</th><th>Version</th><th>Year</th><th>Driven wheels</th><th></th></tr></thead><tbody>' +
      shown.map(rowHtml).join('') + '</tbody></table>' : '<p class="empty">No cars yet.</p>';
  }
  function load() {
    if (!key()) { note('Enter the admin key at the top of the page first.'); return; }
    loadBtn.disabled = true;
    note('Looking through the garages...');
    var lib = V && !V.loaded ? V.load().catch(function () {}) : Promise.resolve();
    Promise.all([call('GET'), lib]).then(function (r) {
      var d = r[0];
      loadBtn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'Could not load the cars. Check the admin key.', true); return; }
      cars = d.cars || [];
      note(''); draw();
    }).catch(function () { loadBtn.disabled = false; note('Could not reach the server.', true); });
  }
  function findCar(id) { for (var i = 0; i < cars.length; i++) if (cars[i].carId === id) return cars[i]; return null; }
  loadBtn.addEventListener('click', load);
  filterEl.addEventListener('input', function () { if (cars.length) draw(); });
  listEl.addEventListener('input', function (e) {
    var row = e.target.closest('tr.mc-row');
    if (row) row.classList.add('is-changed');
  });
  listEl.addEventListener('change', function (e) {
    var row = e.target.closest('tr.mc-row');
    if (!row) return;
    row.classList.add('is-changed');
    var t = e.target;
    ['mc-make', 'mc-model', 'mc-version'].forEach(function (cls) { if (t.classList.contains(cls)) showTyped(t, cls); });
    // The models follow the make picked, and the versions the model.
    if (t.classList.contains('mc-type') || t.classList.contains('mc-make')) {
      var type = row.querySelector('.mc-type').value, make = picked(row, 'mc-make');
      if (t.classList.contains('mc-type')) refill(row, 'mc-make', 'Make', makesOf(type), make, 'Not set (Tesla)');
      refill(row, 'mc-model', 'Model', modelChoices(type, make), '', 'Not set');
      refill(row, 'mc-version', 'Version', [], '', 'Not set');
    }
    if (t.classList.contains('mc-model')) {
      refill(row, 'mc-version', 'Version', versionsOf({ make: picked(row, 'mc-make'), model: picked(row, 'mc-model'), vehicleType: row.querySelector('.mc-type').value }), '', 'Not set');
    }
  });
  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.mc-save');
    if (!btn) return;
    var row = btn.closest('tr'), carId = row.getAttribute('data-car'), c = findCar(carId) || {};
    var body = { carId: carId, vehicleType: row.querySelector('.mc-type').value, make: picked(row, 'mc-make'), model: picked(row, 'mc-model'),
      version: picked(row, 'mc-version'), year: row.querySelector('.mc-year').value.trim(), drive: row.querySelector('.mc-drive').value };
    btn.disabled = true;
    note('Saving ' + (c.car || 'the car') + '...');
    call('POST', body).then(function (d) {
      btn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', true); return; }
      var sessions = c.sessions || 0;
      Object.assign(c, d.car || {}, { sessions: sessions });
      row.outerHTML = rowHtml(c);
      note('Saved ' + (c.car || 'the car') + ': ' + d.stamped + ' session' + (d.stamped === 1 ? '' : 's') + ' stamped' + (d.boards ? ' and ' + d.boards + ' leaderboard' + (d.boards === 1 ? '' : 's') + ' refreshed' : '') + '.');
      document.dispatchEvent(new CustomEvent('mt3uk-drive-changed'));
    }).catch(function () { btn.disabled = false; note('Could not reach the server.', true); });
  });
  wrap.addEventListener('toggle', function () { if (wrap.open && !cars.length) load(); });
})();
