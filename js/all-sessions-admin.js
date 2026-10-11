/*
  track-admin.html, All sessions panel: every Track session from every member, read only
  (/track/admin/all-sessions, admin key). Filters narrow each page the worker reads; Load more reads the next page
  from where the last one stopped. Each session links to its own page, which the admin can open.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('all-sessions-wrap');
  if (!wrap) return;
  var noteEl = document.getElementById('as-note'), listEl = document.getElementById('as-list');
  var countEl = document.getElementById('all-sessions-count'), moreBtn = document.getElementById('as-more'), findBtn = document.getElementById('as-find');
  var cursor = '', rows = [], seq = 0;

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function val(id) { return (document.getElementById(id).value || '').trim(); }
  function lap(t) {
    if (t == null || !isFinite(t)) return '';
    var m = Math.floor(t / 60), s = (t - m * 60).toFixed(2);
    return m + ':' + (s.length < 5 ? '0' : '') + s;
  }
  function typeName(t) { return { track: 'Track day', sprint: 'Sprint or hill climb', drag: 'Drag strip', other: 'Drive' }[t] || (t || ''); }
  function query(c) {
    var q = 'key=' + encodeURIComponent(key());
    if (c) q += '&cursor=' + encodeURIComponent(c);
    [['member', 'as-member'], ['track', 'as-track'], ['logger', 'as-logger'], ['type', 'as-type']].forEach(function (f) {
      var v = val(f[1]); if (v) q += '&' + f[0] + '=' + encodeURIComponent(v);
    });
    return q;
  }
  function draw() {
    countEl.textContent = rows.length ? '(' + rows.length + (moreBtn.hidden ? '' : ' so far') + ')' : '';
    if (!rows.length) { listEl.innerHTML = '<p class="empty">No sessions match.</p>'; return; }
    listEl.innerHTML = '<table class="iv-table as-table"><thead><tr><th>Date</th><th>Member</th><th>Car</th><th>Session</th><th>Logger</th><th>Sharing</th><th>Best</th></tr></thead><tbody>' + rows.map(function (s) {
      var where = (s.venue || 'No track named') + (s.layout && s.layout !== s.venue ? ', ' + s.layout : '');
      return '<tr>' +
        '<td>' + esc(s.date) + (s.time ? '<span class="iv-sub">' + esc(s.time) + '</span>' : '') + '</td>' +
        '<td>' + esc(s.email || 'Unknown') + '</td>' +
        '<td>' + esc(s.car || s.carId) + '</td>' +
        '<td><a href="track.html?s=' + esc(s.id) + '" target="_blank" rel="noopener">' + esc(where) + '</a><span class="iv-sub">' + esc(typeName(s.type)) + (s.unlisted ? ', track not listed' : '') + '</span></td>' +
        '<td>' + esc(s.logger || 'Not set') + '</td>' +
        '<td>' + esc(s.privacy === 'private' ? 'Only me' : s.privacy === 'build' ? 'Shared' : s.privacy === 'board' ? 'Shared, leaderboard' : (s.privacy || '')) + '</td>' +
        '<td>' + esc(lap(s.bestTime)) + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table>';
  }
  function load(reset) {
    if (!key()) { note('Enter the admin key at the top of the page first.', 'is-error'); return; }
    var mine = ++seq;
    if (reset) { rows = []; cursor = ''; }
    findBtn.disabled = true; moreBtn.disabled = true;
    note('Reading the sessions...');
    fetch(API + '/track/admin/all-sessions?' + query(cursor), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); })
      .then(function (d) {
        if (mine !== seq) return;
        findBtn.disabled = false;
        if (!d.ok || !d.success) { note(d.message || 'Could not read the sessions.', 'is-error'); moreBtn.hidden = true; return; }
        rows = rows.concat(d.sessions || []);
        cursor = d.done ? '' : (d.cursor || '');
        moreBtn.hidden = !cursor;
        moreBtn.disabled = false;
        note(cursor ? 'Read part of the list. Press Load more for the rest.' : (rows.length ? 'All of the sessions are read.' : ''));
        draw();
      })
      .catch(function () { if (mine === seq) { findBtn.disabled = false; moreBtn.disabled = false; note('Could not reach the server.', 'is-error'); } });
  }
  findBtn.addEventListener('click', function () { load(true); });
  moreBtn.addEventListener('click', function () { load(false); });
  ['as-member', 'as-track', 'as-logger'].forEach(function (id) {
    document.getElementById(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  });
  document.getElementById('as-type').addEventListener('change', function () { load(true); });
})();
