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
  var state = { places: [] };

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
        '<button type="button" class="secondary" data-remove="' + esc(p.id) + '">Remove</button></div>';
    }).join('') : '<p class="iv-note">No addresses added yet.</p>';
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
    call('POST', { action: 'add', place: place }).then(function (d) {
      if (apply(d)) {
        note('Address added. Navigate shows it after the next search.');
        ['np-house', 'np-name', 'np-town', 'np-postcode', 'np-position'].forEach(function (id) { document.getElementById(id).value = ''; });
      }
    }).catch(function () { note('Could not reach the server.'); });
  });
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-remove]');
    if (!b) return;
    call('POST', { action: 'remove', id: b.getAttribute('data-remove') }).then(function (d) {
      if (apply(d)) note('Address removed.');
    });
  });
  load();
})();
