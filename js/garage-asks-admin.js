/*
  admin.html, Other makes panel: cars of another make are kept in their owner's
  garage (not in the Gallery, the Reel or Build of the Week). When a member asks
  for one to be shown, the request waits here (one KV key, garage-gallery-requests,
  through the worker's /my-builds/admin/garage-gallery). Approve shows the car's
  photos in the Gallery and the Reel; Decline keeps it in the garage. Either way
  the member is emailed.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var R2 = window.MT3UK_R2_BASE || 'https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev';
  var wrap = document.getElementById('garage-asks-wrap');
  if (!wrap) return;
  var listEl = document.getElementById('ga-list'), noteEl = document.getElementById('ga-note'), countEl = document.getElementById('garage-asks-count');

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/my-builds/admin/garage-gallery?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function draw(pending) {
    countEl.textContent = pending.length ? '(' + pending.length + ' waiting)' : '';
    listEl.innerHTML = pending.length ? pending.map(function (p) {
      var photos = (p.photos || []).map(function (f) {
        return '<img class="ga-photo" src="' + R2 + '/gallery/' + encodeURIComponent(f) + '" alt="" loading="lazy" onerror="this.remove()">';
      }).join('');
      return '<div class="ga-row" data-car="' + esc(p.carId) + '"><div class="ga-photos">' + photos + '</div><div class="ga-text">' +
        '<b>' + esc(p.car || 'A car') + '</b>' + (p.title ? ' <span class="iv-sub">' + esc(p.title) + (p.type === 'bike' ? ', a bike' : '') + '</span>' : '') +
        '<span class="iv-sub">' + esc(p.name ? p.name + ', ' : '') + esc(p.email) + ', asked ' + esc(when(p.at)) + '</span>' +
        (p.note ? '<span class="iv-sub">Note: ' + esc(p.note) + '</span>' : '') +
        '<div class="iv-actions"><button type="button" class="iv-act" data-approve="' + esc(p.carId) + '">Make public</button>' +
        '<button type="button" class="secondary iv-act" data-decline="' + esc(p.carId) + '">Keep private</button></div></div></div>';
    }).join('') : '<p class="empty">Nobody is waiting.</p>';
  }
  function load() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the requests. Check the admin key.', 'error'); return; }
      note(''); draw(d.pending || []);
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  listEl.addEventListener('click', function (e) {
    var ok = e.target.closest('[data-approve]'), no = e.target.closest('[data-decline]');
    if (!ok && !no) return;
    var carId = (ok || no).getAttribute(ok ? 'data-approve' : 'data-decline');
    if (ok && !window.confirm('Make this car public? Its photos go in the Gallery and the Reel for everyone to see, and the owner is emailed.')) return;
    if (no && !window.confirm('Keep this car private? It stays in the owner\'s garage only, and the owner is emailed.')) return;
    (ok || no).disabled = true;
    call('POST', { carId: carId, action: ok ? 'approve' : 'decline' }).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); (ok || no).disabled = false; return; }
      draw(d.pending || []);
      note(ok ? 'Made public: it is in the Gallery and the Reel. The owner has been emailed.' : 'Kept private in the owner\'s garage. The owner has been emailed.', 'ok');
    }).catch(function () { note('Could not reach the server.', 'error'); (ok || no).disabled = false; });
  });
  // Cars of another make still in the Gallery (from before only Teslas went in): found on request, because
  // the worker looks through every car to find them.
  var oldEl = document.getElementById('ga-old'), findBtn = document.getElementById('ga-find'), emailSw = document.getElementById('ga-email');
  // Email the owner: on unless switched off, for each car kept in the garage from here.
  function emailOn() { return !emailSw || emailSw.getAttribute('aria-checked') === 'true'; }
  if (emailSw) emailSw.addEventListener('click', function () { emailSw.setAttribute('aria-checked', String(!emailOn())); });
  function callOld(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/my-builds/admin/other-makes?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function drawOld(cars) {
    oldEl.innerHTML = cars.length ? cars.map(function (c) {
      var photos = (c.photos || []).map(function (f) {
        return '<img class="ga-photo" src="' + R2 + '/gallery/' + encodeURIComponent(f) + '" alt="" loading="lazy" onerror="this.remove()">';
      }).join('');
      return '<div class="ga-row" data-car="' + esc(c.carId) + '"><div class="ga-photos">' + photos + '</div><div class="ga-text">' +
        '<b>' + esc(c.car || 'A car') + '</b> <span class="iv-sub">' + esc(c.title) + ', on public view in the Gallery and the Reel' +
          (c.approvedAt ? ' (made public on ' + esc(when(c.approvedAt)) + ')' : '') + '</span>' +
        '<span class="iv-sub">' + esc(c.owner ? c.owner + ', ' : '') + esc(c.email || 'owner not known') + '</span>' +
        '<div class="iv-actions"><button type="button" class="secondary iv-act" data-garage="' + esc(c.carId) + '">Remove from public view</button></div></div></div>';
    }).join('') : '<p class="empty">No cars of another make are on public view.</p>';
  }
  if (findBtn) findBtn.addEventListener('click', function () {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    findBtn.disabled = true;
    note('Looking through the cars...');
    callOld('GET').then(function (d) {
      findBtn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'Could not look. Check the admin key.', 'error'); return; }
      note(''); drawOld(d.cars || []);
    }).catch(function () { findBtn.disabled = false; note('Could not reach the server.', 'error'); });
  });
  if (oldEl) oldEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-garage]');
    if (!btn) return;
    var tell = emailOn();
    if (!window.confirm('Remove this car from public view?\n\nIts photos leave the Gallery, the Reel and this week\'s vote, and its votes this week are cleared. Nothing is deleted: it stays in the owner\'s garage with its photos, mods list and Track sessions.\n\n' + (tell ? 'The owner is emailed to say why.' : 'The owner is not emailed.'))) return;
    btn.disabled = true;
    callOld('POST', { carId: btn.getAttribute('data-garage'), action: 'garage', email: tell }).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); btn.disabled = false; return; }
      var row = btn.closest('.ga-row');
      if (row) row.remove();
      if (!oldEl.querySelector('.ga-row')) drawOld([]);
      note(tell ? 'Removed from public view. It stays in the owner\'s garage, and the owner has been emailed.' : 'Removed from public view. It stays in the owner\'s garage, and the owner was not emailed.', 'ok');
    }).catch(function () { note('Could not reach the server.', 'error'); btn.disabled = false; });
  });

  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
})();
