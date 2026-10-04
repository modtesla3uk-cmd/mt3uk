/*
  track-admin.html, Member sessions panel: find a member's Track sessions by email
  and open any of them, private ones included. The worker gives the admin a
  read-only view without notes and logs each view (/track/admin/sessions).
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('member-sessions-wrap');
  if (!wrap) return;
  var noteEl = document.getElementById('ms-note'), listEl = document.getElementById('ms-list'), viewsEl = document.getElementById('ms-views');
  var emailEl = document.getElementById('ms-email'), findBtn = document.getElementById('ms-find');

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(email) {
    return fetch(API + '/track/admin/sessions?key=' + encodeURIComponent(key()) + (email ? '&email=' + encodeURIComponent(email) : ''), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function rename(id, venue) {
    return fetch(API + '/track/admin/session?key=' + encodeURIComponent(key()), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, venue: venue }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function nice(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function drawViews(views) {
    viewsEl.innerHTML = views.length ? '<table class="iv-table"><thead><tr><th>When</th><th>Session</th><th>Privacy</th></tr></thead><tbody>' + views.map(function (v) {
      return '<tr><td>' + esc(nice(v.at)) + '</td><td><a href="track.html?s=' + esc(v.id) + '">' + esc((v.venue || 'Session') + (v.date ? ', ' + v.date : '') + (v.car ? ', ' + v.car : '')) + '</a></td><td>' + esc(v.privacy || '') + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">No private sessions opened yet.</p>';
  }
  function loadViews() {
    if (!key()) return;
    call('').then(function (d) { if (d.ok && d.views) drawViews(d.views); });
  }
  function find() {
    var email = emailEl.value.trim();
    if (!key()) { note('Enter the admin key above first.', ''); return; }
    if (!email) { note('Type the member\'s email.', ''); return; }
    note('Looking...', '');
    call(email).then(function (d) {
      if (!d.ok) { note(d.message || 'Could not look that up.', 'error'); return; }
      var list = d.sessions || [];
      note(list.length ? list.length + ' session' + (list.length === 1 ? '' : 's') + '.' : 'No sessions for that email.', '');
      listEl.innerHTML = list.length ? '<table class="iv-table ms-table"><thead><tr><th>Session</th><th>Track name</th><th>Date</th><th>Privacy</th></tr></thead><tbody>' + list.map(function (s) {
        // A session at a track we do not list is named by the member, so the admin can put it right here. One at a
        // listed track takes its name from the track list.
        var nameCell = s.venueId
          ? esc(s.venue || '') + '<span class="iv-sub">Listed track</span>'
          : '<div class="ms-rename"><input type="text" class="ms-name" data-id="' + esc(s.id) + '" value="' + esc(s.venue || '') + '" maxlength="60" aria-label="Track name"><button type="button" class="iv-act ms-save" data-id="' + esc(s.id) + '">Save</button></div>';
        return '<tr data-id="' + esc(s.id) + '"><td><a href="track.html?s=' + esc(s.id) + '" target="_blank" rel="noopener">' + esc((s.venue || 'Session') + (s.layout ? ' ' + s.layout : '')) + '</a></td><td>' + nameCell + '</td><td>' + esc(s.date || '') + '</td><td>' + esc(s.privacy || '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
      loadViews();
    });
  }
  function saveName(btn) {
    var id = btn.getAttribute('data-id'), row = btn.closest('tr'), input = row.querySelector('.ms-name'), venue = input.value.trim();
    if (!venue) { note('Enter the track name.', 'error'); input.focus(); return; }
    btn.disabled = true;
    note('Saving...', '');
    rename(id, venue).then(function (d) {
      btn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'Could not rename that session.', 'error'); return; }
      var saved = (d.session && d.session.venue) || venue;
      input.value = saved;
      row.querySelector('a').textContent = saved + ((d.session && d.session.layout) ? ' ' + d.session.layout : '');
      note('Renamed to ' + saved + '. The member sees the new name in their list.', 'ok');
    });
  }
  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.ms-save');
    if (btn) saveName(btn);
  });
  listEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.classList.contains('ms-name')) return;
    e.preventDefault();
    var btn = e.target.closest('tr').querySelector('.ms-save');
    if (btn) saveName(btn);
  });
  findBtn.addEventListener('click', find);
  emailEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); find(); } });

  // Why a session is or is not on a leaderboard (/track/admin/boardcheck).
  var idEl = document.getElementById('ms-id'), checkBtn = document.getElementById('ms-check'), outEl = document.getElementById('ms-check-out');
  function check() {
    var v = idEl.value.trim();
    if (!v) { outEl.innerHTML = '<p class="iv-note is-error">Paste a session link or id first.</p>'; return; }
    checkBtn.disabled = true; outEl.innerHTML = '<p class="iv-note">Checking...</p>';
    fetch(API + '/track/admin/boardcheck?key=' + encodeURIComponent(key()) + '&id=' + encodeURIComponent(v), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); })
      .then(function (d) {
        checkBtn.disabled = false;
        if (!d.ok || !d.success) { outEl.innerHTML = '<p class="iv-note is-error">' + esc(d.message || 'Could not check it.') + '</p>'; return; }
        var s = d.session;
        var h = '<p class="iv-note"><b>' + esc((s.venue || 'No track') + (s.layout && s.layout !== s.venue ? ', ' + s.layout : '')) + '</b> (' + esc(s.type === 'sprint' && d.tab === 'Hill climb' ? 'hill climb' : s.type) + ', ' + esc(s.date) + (s.bestTime ? ', best ' + esc(s.bestTime) : '') + ', sharing: ' + esc(s.privacy || 'none') + ')</p>';
        h += d.onBoard ? '<p class="iv-note is-ok">On the ' + esc(d.tab) + ' leaderboard (' + d.entries + ' car' + (d.entries === 1 ? '' : 's') + ' on that board).</p>'
          : '<p class="iv-note is-error">Not shown as a row on the ' + esc(d.tab) + ' leaderboard' + (d.board ? '' : ' (it has no board to be on)') + '.</p>';
        if (d.reasons && d.reasons.length) h += '<ul class="iv-note" style="padding-left:18px">' + d.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
        if (d.repairable) h += '<div class="iv-toolbar"><button type="button" class="secondary iv-act" data-repair-session="' + esc(s.id) + '">Repair</button></div>';
        outEl.innerHTML = h;
      }).catch(function () { checkBtn.disabled = false; outEl.innerHTML = '<p class="iv-note is-error">Could not reach the server.</p>'; });
  }
  // Every problem at once (/track/admin/boardproblems), with a button to bring a board up to date (/track/admin/boardrepair).
  var probBtn = document.getElementById('ms-problems'), probOut = document.getElementById('ms-prob-out');
  function getJson(path) {
    return fetch(API + path + (path.indexOf('?') < 0 ? '?' : '&') + 'key=' + encodeURIComponent(key()), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function repair(board, carId, btn, sessionId, done) {
    btn.disabled = true; btn.textContent = 'Working...';
    return fetch(API + '/track/admin/boardrepair?key=' + encodeURIComponent(key()), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: board || undefined, carId: carId || undefined, sessionId: sessionId || undefined }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) { if (d.success) (done || problems)(); else { btn.disabled = false; btn.textContent = d.message ? 'Failed: ' + d.message : 'Try again'; } })
      .catch(function () { btn.disabled = false; btn.textContent = 'Try again'; });
  }
  function problems() {
    probBtn.disabled = true; probOut.innerHTML = '<p class="iv-note">Looking through every member\'s sessions...</p>';
    getJson('/track/admin/boardproblems').then(function (d) {
      probBtn.disabled = false;
      if (!d.ok || !d.success) { probOut.innerHTML = '<p class="iv-note is-error">' + esc(d.message || 'Could not check.') + '</p>'; return; }
      var h = '<p class="iv-note">' + d.sessions + ' sessions from ' + d.members + ' members' + (d.more ? ' (the first 700 members)' : '') + ': ' + d.onBoard + ' on a board, ' + d.privateOrStreet + ' private, ' + d.other + ' of type Other, <b>' + d.problems.length + ' with a problem</b>' + (d.hiddenBoards.length ? ', <b>' + d.hiddenBoards.length + ' hidden board' + (d.hiddenBoards.length === 1 ? '' : 's') + '</b>' : '') + '.</p>';
      if (d.hiddenBoards.length) h += '<table class="iv-table"><thead><tr><th>Board the track list is not counting</th><th></th></tr></thead><tbody>' + d.hiddenBoards.map(function (b) { return '<tr><td>' + esc(b) + '</td><td><button type="button" class="secondary iv-act" data-repair="' + esc(b) + '">Repair</button></td></tr>'; }).join('') + '</tbody></table>';
      if (d.problems.length) h += '<table class="iv-table ms-table"><thead><tr><th>Session</th><th>Car</th><th>Why</th><th></th></tr></thead><tbody>' + d.problems.map(function (p) {
        var fix = /no entry for this car yet|shared list|Repair links/.test(p.reasons.join(' ')) && p.board;
        return '<tr><td><a href="track.html?s=' + esc(p.id) + '" target="_blank" rel="noopener">' + esc((p.venue || 'No track') + (p.layout && p.layout !== p.venue ? ', ' + p.layout : '')) + '</a><br><span class="iv-sub">' + esc(p.type + ', ' + p.date + (p.bestTime ? ', ' + p.bestTime : '')) + '</span></td><td>' + esc(p.car) + '</td><td>' + p.reasons.map(function (t) { return esc(t); }).join('<br>') + '</td><td>' + (fix ? '<button type="button" class="secondary iv-act" data-repair="' + esc(p.board) + '" data-car="' + esc(p.carId) + '" data-session="' + esc(p.id) + '">Repair</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
      else if (!d.hiddenBoards.length) h += '<p class="iv-note is-ok">No problems found.</p>';
      probOut.innerHTML = h;
    }).catch(function () { probBtn.disabled = false; probOut.innerHTML = '<p class="iv-note is-error">Could not reach the server.</p>'; });
  }
  probBtn.addEventListener('click', problems);
  probOut.addEventListener('click', function (e) {
    var b = e.target.closest('[data-repair]');
    if (b) repair(b.getAttribute('data-repair'), b.getAttribute('data-car') || '', b, b.getAttribute('data-session') || '');
  });
  checkBtn.addEventListener('click', check);
  outEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-repair-session]');
    if (b) repair('', '', b, b.getAttribute('data-repair-session'), check);
  });
  idEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); check(); } });
  wrap.addEventListener('toggle', function () { if (wrap.open) loadViews(); });
})();
