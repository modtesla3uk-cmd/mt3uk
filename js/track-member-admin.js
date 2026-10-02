/*
  admin.html, Member sessions panel: find a member's Track sessions by email
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
      listEl.innerHTML = list.length ? '<table class="iv-table"><thead><tr><th>Session</th><th>Date</th><th>Privacy</th></tr></thead><tbody>' + list.map(function (s) {
        return '<tr><td><a href="track.html?s=' + esc(s.id) + '" target="_blank" rel="noopener">' + esc((s.venue || 'Session') + (s.layout ? ' ' + s.layout : '')) + '</a></td><td>' + esc(s.date || '') + '</td><td>' + esc(s.privacy || '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
      loadViews();
    });
  }
  findBtn.addEventListener('click', find);
  emailEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  wrap.addEventListener('toggle', function () { if (wrap.open) loadViews(); });
})();
