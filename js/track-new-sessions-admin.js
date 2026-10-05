/*
  track-admin.html, New sessions panel: every session a member saves, as the worker noted it
  (/track/admin/new-sessions, admin key). Each is counted on the bell (js/track-admin-page.js reads the rows'
  data-session, data-title and data-sub) and was emailed to MT3UK. Clear takes a session off the list once seen;
  the New sessions switch at the top of the page (js/admin-alerts.js) turns the whole thing off.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('new-sessions-wrap');
  if (!wrap) return;
  var noteEl = document.getElementById('ns-note'), listEl = document.getElementById('ns-list');
  var countEl = document.getElementById('new-sessions-count'), clearAllBtn = document.getElementById('ns-clear-all');

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API + '/track/admin/new-sessions?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function nice(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function draw(list) {
    countEl.textContent = list.length ? '(' + list.length + ')' : '';
    clearAllBtn.hidden = !list.length;
    if (!list.length) { listEl.innerHTML = '<p class="empty">No new sessions.</p>'; return; }
    listEl.innerHTML = '<table class="iv-table ns-table"><thead><tr><th>Saved</th><th>Member</th><th>Session</th><th>Result</th><th>Sharing</th><th></th></tr></thead><tbody>' + list.map(function (s) {
      var who = s.name || s.email || 'A member';
      var what = (s.venue || 'No track named') + ', ' + (s.date || '') + (s.time ? ' at ' + s.time : '');
      return '<tr data-session="' + esc(s.id) + '" data-title="' + esc(who + ': ' + (s.venue || 'No track named')) + '" data-sub="' + esc((s.kind || 'Session') + (s.car ? ', ' + s.car : '') + ', ' + (s.date || '') + (s.result ? '. ' + s.result : '')) + '">' +
        '<td>' + esc(nice(s.at)) + '</td>' +
        '<td>' + esc(who) + (s.email && s.name ? '<span class="iv-sub">' + esc(s.email) + '</span>' : '') + '</td>' +
        '<td><a href="track.html?s=' + esc(s.id) + '" target="_blank" rel="noopener">' + esc(what) + '</a><span class="iv-sub">' + esc((s.kind || '') + (s.car ? ', ' + s.car : '') + (s.unlisted ? ', track not listed' : '')) + '</span></td>' +
        '<td>' + esc(s.result || '') + '</td>' +
        '<td>' + esc(s.privacy || '') + '</td>' +
        '<td><button type="button" class="secondary iv-act ns-clear" data-id="' + esc(s.id) + '">Clear</button></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function load() {
    if (!key()) return;
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the new sessions.', 'is-error'); return; }
      note('');
      draw(d.sessions || []);
    }).catch(function () { note('Could not reach the server.', 'is-error'); });
  }
  function clear(id, btn) {
    if (btn) btn.disabled = true;
    call('POST', { clear: id }).then(function (d) {
      if (btn) btn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'Could not clear that.', 'is-error'); return; }
      draw(d.sessions || []);
      document.dispatchEvent(new CustomEvent('mt3uk-bell-refresh'));
    }).catch(function () { if (btn) btn.disabled = false; note('Could not reach the server.', 'is-error'); });
  }
  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.ns-clear');
    if (btn) clear(btn.getAttribute('data-id'), btn);
  });
  clearAllBtn.addEventListener('click', function () {
    if (!confirm('Clear every new session from this list? The sessions themselves are not changed.')) return;
    clear('all', clearAllBtn);
  });
  document.addEventListener('mt3uk-admin-refresh', load);
  load();
})();
