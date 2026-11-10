/*
  track-admin.html, Navigate addresses: houses the map does not have yet, which Navigate finds alongside its own search.
  One KV key (navigate-places), kept by the worker (/navigate/places/admin, admin key).
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('nav-places-wrap');
  if (!wrap) return;
  var countEl = document.getElementById('nav-places-count');
  var noteEl = document.getElementById('nav-places-note');
  var listEl = document.getElementById('np-list');
  var addBtn = document.getElementById('np-add');
  var cancelBtn = document.getElementById('np-cancel');
  var state = { places: [], editId: null };

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t) { if (noteEl) noteEl.textContent = t || ''; }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/navigate/places/admin?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function draw() {
    if (countEl) countEl.textContent = state.places.length ? state.places.length + ' saved' : '';
    listEl.innerHTML = state.places.length ? state.places.map(function (p) {
      var label = (p.house ? p.house + ' ' : '') + p.name + (p.town ? ', ' + p.town : '') + (p.postcode ? ', ' + p.postcode : '');
      return '<div class="iv-row"><span>' + esc(label) + ' <span class="iv-note">' + esc(p.lat.toFixed(5) + ', ' + p.lng.toFixed(5)) + '</span></span>' +
        '<span><button type="button" class="secondary" data-edit="' + esc(p.id) + '">Edit</button> <button type="button" class="secondary" data-remove="' + esc(p.id) + '">Remove</button></span></div>';
    }).join('') : '<p class="iv-note">No addresses added yet.</p>';
  }
  function fill(p) {
    document.getElementById('np-house').value = p ? (p.house || '') : '';
    document.getElementById('np-name').value = p ? (p.name || '') : '';
    document.getElementById('np-town').value = p ? (p.town || '') : '';
    document.getElementById('np-postcode').value = p ? (p.postcode || '') : '';
    document.getElementById('np-position').value = p ? (p.lat + ', ' + p.lng) : '';
  }
  function editing(on) {
    addBtn.textContent = on ? 'Save changes' : 'Add address';
    cancelBtn.hidden = !on;
    if (!on) { state.editId = null; fill(null); }
  }
  function apply(d) {
    if (!d || !d.ok) { note(d && d.message ? d.message : 'Enter the admin key first.'); return false; }
    state.places = d.places || [];
    draw();
    return true;
  }
  function load() { call('GET').then(apply).catch(function () { note('Could not reach the server.'); }); }

  addBtn.addEventListener('click', function () {
    var pos = (document.getElementById('np-position').value || '').split(',').map(function (x) { return x.trim(); });
    var place = {
      house: document.getElementById('np-house').value.trim(),
      name: document.getElementById('np-name').value.trim(),
      town: document.getElementById('np-town').value.trim(),
      postcode: document.getElementById('np-postcode').value.trim(),
      lat: parseFloat(pos[0]),
      lng: parseFloat(pos[1])
    };
    if (!place.name) { note('Give the street or place name.'); return; }
    if (!isFinite(place.lat) || !isFinite(place.lng)) { note('Give the position as latitude, longitude, for example 52.0109, -0.5090.'); return; }
    var editId = state.editId;
    var body = editId ? { action: 'update', id: editId, place: place } : { action: 'add', place: place };
    call('POST', body).then(function (d) {
      if (apply(d)) {
        note(editId ? 'Address changed. Navigate uses the new details from the next search.' : 'Address added. Navigate shows it after the next search.');
        editing(false);
      }
    }).catch(function () { note('Could not reach the server.'); });
  });
  cancelBtn.addEventListener('click', function () { editing(false); note(''); });
  listEl.addEventListener('click', function (e) {
    var ed = e.target.closest && e.target.closest('[data-edit]');
    if (ed) {
      var id = ed.getAttribute('data-edit');
      var p = state.places.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      state.editId = id;
      fill(p);
      editing(true);
      note('Change the details, then tap Save changes. Cancel leaves the address as it was.');
      document.getElementById('np-name').focus();
      return;
    }
    var b = e.target.closest && e.target.closest('[data-remove]');
    if (!b) return;
    call('POST', { action: 'remove', id: b.getAttribute('data-remove') }).then(function (d) {
      if (apply(d)) note('Address removed.');
    });
  });
  load();
})();
