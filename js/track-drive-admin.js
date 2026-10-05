/*
  track-admin.html, Driven wheels panel: every vehicle with sessions and the wheels it drives (FWD, RWD or AWD),
  from the worker's /track/admin/drive. Choosing one saves it to the vehicle, stamps its sessions and refreshes its
  leaderboard rows. Vehicles the rule cannot tell come first.
*/
(function () {
  var wrap = document.getElementById('drive-wrap');
  if (!wrap) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var listEl = document.getElementById('dw-list'), noteEl = document.getElementById('dw-note'), loadBtn = document.getElementById('dw-load');
  var DRIVES = ['FWD', 'RWD', 'AWD'];
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, bad) { noteEl.textContent = t || ''; noteEl.classList.toggle('is-bad', !!bad); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/track/admin/drive?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function title(v) {
    var make = v.make || '', model = v.model || '';
    var name = make && model && model.toLowerCase().indexOf(make.toLowerCase()) !== 0 ? make + ' ' + model : (model || make);
    return [v.year, name, v.version].filter(Boolean).join(' ') || 'No model saved';
  }
  function draw(rows) {
    var unknown = rows.filter(function (r) { return !r.drive; }).length;
    listEl.innerHTML = rows.length ? '<p class="iv-note">' + rows.length + ' vehicle' + (rows.length === 1 ? '' : 's') + ' with sessions' + (unknown ? ', ' + unknown + ' not known' : ', all known') + '.</p>' +
      '<table class="tk-table"><thead><tr><th>Owner</th><th>Vehicle</th><th>Sessions</th><th>Driven wheels</th></tr></thead><tbody>' + rows.map(function (r) {
        return '<tr class="dw-row' + (r.drive ? '' : ' is-target') + '" data-car="' + esc(r.carId) + '"><td>' + esc(r.owner || r.email || 'Owner not known') + (r.owner && r.email ? '<span class="iv-sub">' + esc(r.email) + '</span>' : '') + '</td>' +
          '<td><b>' + esc(r.car || 'A vehicle') + '</b><span class="iv-sub">' + esc(title(r)) + (r.vehicleType === 'bike' ? ', a bike' : '') + '</span></td><td>' + r.sessions + '<span class="dw-sess"> session' + (r.sessions === 1 ? '' : 's') + '</span></td>' +
          '<td><select class="dw-pick" aria-label="Driven wheels"><option value=""' + (r.drive ? '' : ' selected') + '>Not known</option>' + DRIVES.map(function (d) { return '<option value="' + d + '"' + (r.drive === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select>' +
          '<span class="iv-sub dw-how">' + (r.set ? 'Set by hand' : r.drive ? 'From the model' : 'Pick one') + '</span></td></tr>';
      }).join('') + '</tbody></table>' : '<p class="empty">No vehicles have sessions yet.</p>';
  }
  function load() {
    if (!key()) { note('Enter the admin key at the top of the page first.'); return; }
    loadBtn.disabled = true;
    note('Looking through the sessions...');
    call('GET').then(function (d) {
      loadBtn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'Could not load the vehicles. Check the admin key.', true); return; }
      note(''); draw(d.vehicles || []);
    }).catch(function () { loadBtn.disabled = false; note('Could not reach the server.', true); });
  }
  loadBtn.addEventListener('click', load);
  listEl.addEventListener('change', function (e) {
    var sel = e.target.closest('.dw-pick');
    if (!sel) return;
    var row = sel.closest('tr'), carId = row.getAttribute('data-car');
    sel.disabled = true;
    call('POST', { carId: carId, drive: sel.value }).then(function (d) {
      sel.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', true); return; }
      row.classList.toggle('is-target', !d.drive);
      row.querySelector('.dw-how').textContent = d.set ? 'Set by hand' : d.drive ? 'From the model' : 'Pick one';
      note((d.drive ? d.drive + ' saved' : 'Cleared, back to what the model says') + ': ' + d.stamped + ' session' + (d.stamped === 1 ? '' : 's') + ' stamped' + (d.boards ? ' and ' + d.boards + ' leaderboard' + (d.boards === 1 ? '' : 's') + ' refreshed' : '') + '.');
    }).catch(function () { sel.disabled = false; note('Could not reach the server.', true); });
  });
  wrap.addEventListener('toggle', function () { if (wrap.open && !listEl.children.length) load(); });
})();
