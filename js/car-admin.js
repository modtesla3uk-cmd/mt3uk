/*
  track-admin.html, Members' cars panel: every car and bike in members' garages with its settings (type, make,
  model, version, year and driven wheels), from the worker's /track/admin/cars (admin key). Save on a row sends the
  changed settings; the worker writes them to the car, stamps its sessions and refreshes its leaderboard rows.
  The makes, models and variants are suggested from the vehicle library (js/vehicle-data.js); anything can be typed.
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
  function rowHtml(c) {
    var id = 'mc-' + c.carId;
    return '<tr class="mc-row' + (c.model ? '' : ' is-target') + '" data-car="' + esc(c.carId) + '">' +
      '<td data-label="Owner">' + esc(c.owner || c.email || 'Owner not known') + (c.owner && c.email ? '<span class="iv-sub">' + esc(c.email) + '</span>' : '') + '</td>' +
      '<td data-label="Car"><b>' + esc(c.car || 'A vehicle') + '</b>' + (c.garageOnly ? '<span class="mc-badge">Garage only</span>' : '') +
        '<span class="iv-sub">' + c.photos + ' photo' + (c.photos === 1 ? '' : 's') + ', ' + c.sessions + ' session' + (c.sessions === 1 ? '' : 's') + (c.model ? '' : ', no model') + '</span></td>' +
      '<td data-label="Type"><select class="mc-type" aria-label="Type"><option value="car"' + (c.vehicleType !== 'bike' ? ' selected' : '') + '>Car</option><option value="bike"' + (c.vehicleType === 'bike' ? ' selected' : '') + '>Bike</option></select></td>' +
      '<td data-label="Make"><input type="text" class="mc-make" maxlength="40" list="' + id + '-makes" value="' + esc(c.make) + '" aria-label="Make" placeholder="Tesla"><datalist id="' + id + '-makes">' + options(makesOf(c.vehicleType)) + '</datalist></td>' +
      '<td data-label="Model"><input type="text" class="mc-model" maxlength="50" list="' + id + '-models" value="' + esc(c.model) + '" aria-label="Model" placeholder="Model 3"><datalist id="' + id + '-models">' + options(modelsOf(c.vehicleType, c.make || 'Tesla')) + '</datalist></td>' +
      '<td data-label="Version"><input type="text" class="mc-version" maxlength="40" list="' + id + '-versions" value="' + esc(c.version) + '" aria-label="Version"><datalist id="' + id + '-versions">' + options(versionsOf(c)) + '</datalist></td>' +
      '<td data-label="Year"><input type="number" class="mc-year" min="1950" max="' + (new Date().getFullYear() + 1) + '" value="' + esc(c.year || '') + '" aria-label="Year"></td>' +
      '<td data-label="Driven wheels"><select class="mc-drive" aria-label="Driven wheels"><option value=""' + (c.set ? '' : ' selected') + '>' + (c.drive ? 'From the model (' + c.drive + ')' : 'Not known') + '</option>' +
        DRIVES.map(function (d) { return '<option value="' + d + '"' + (c.set && c.drive === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></td>' +
      '<td><button type="button" class="secondary iv-act mc-save">Save</button></td></tr>';
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
    // The model suggestions follow the make typed, and the versions the model.
    if (e.target.classList.contains('mc-make') || e.target.classList.contains('mc-type')) {
      var type = row.querySelector('.mc-type').value, make = row.querySelector('.mc-make').value.trim();
      row.querySelector('.mc-make + datalist').innerHTML = options(makesOf(type));
      row.querySelector('.mc-model + datalist').innerHTML = options(modelsOf(type, make || 'Tesla'));
    }
    if (e.target.classList.contains('mc-model') || e.target.classList.contains('mc-make')) {
      row.querySelector('.mc-version + datalist').innerHTML = options(versionsOf({ make: row.querySelector('.mc-make').value.trim(), model: row.querySelector('.mc-model').value.trim(), vehicleType: row.querySelector('.mc-type').value }));
    }
  });
  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.mc-save');
    if (!btn) return;
    var row = btn.closest('tr'), carId = row.getAttribute('data-car'), c = findCar(carId) || {};
    var body = { carId: carId, vehicleType: row.querySelector('.mc-type').value, make: row.querySelector('.mc-make').value.trim(), model: row.querySelector('.mc-model').value.trim(),
      version: row.querySelector('.mc-version').value.trim(), year: row.querySelector('.mc-year').value.trim(), drive: row.querySelector('.mc-drive').value };
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
