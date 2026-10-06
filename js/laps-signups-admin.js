/*
  track-admin.html, Sign-in and sign-up panel: the New Laps sign-ups list, everyone who joined on laps.mt3uk.com, as
  the worker noted it (/laps/signups/admin, admin key, one KV key laps-signups). A sign-up not waiting for early access
  (Early access open to all) is counted on the bell (js/track-admin-page.js reads the rows' data-signup, data-waiting,
  data-title and data-sub); one waiting is counted as an early access request instead. Clear takes one off the list.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var listEl = document.getElementById('lsu-list');
  if (!listEl) return;
  var noteEl = document.getElementById('lsu-note'), countEl = document.getElementById('signups-count'), clearAllBtn = document.getElementById('lsu-clear-all');

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API + '/laps/signups/admin?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function nice(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function accountText(x) { return x.account === 'laps' ? 'Laps only' : 'MT3UK member too'; }
  function draw(list) {
    countEl.textContent = list.length ? '(' + list.length + ' new)' : '';
    clearAllBtn.hidden = !list.length;
    if (!list.length) { listEl.innerHTML = '<p class="empty">No new Laps sign-ups.</p>'; return; }
    listEl.innerHTML = '<table class="iv-table lsu-table"><thead><tr><th>Joined</th><th>Member</th><th>Account</th><th>Early access</th><th></th></tr></thead><tbody>' + list.map(function (x) {
      return '<tr data-signup="' + esc(x.email) + '" data-waiting="' + (x.waiting ? 'true' : 'false') + '" data-title="' + esc(x.name || x.email) + '" data-sub="' + esc('Joined on Laps, ' + accountText(x)) + '">' +
        '<td>' + esc(nice(x.at)) + '</td>' +
        '<td>' + esc(x.name || x.email) + (x.name ? '<span class="iv-sub">' + esc(x.email) + '</span>' : '') + '</td>' +
        '<td>' + esc(accountText(x)) + '</td>' +
        '<td>' + (x.waiting ? 'Put on the early access list' : 'Already in') + '</td>' +
        '<td><button type="button" class="secondary iv-act lsu-clear" data-email="' + esc(x.email) + '">Clear</button></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function load() {
    if (!key()) return;
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the new sign-ups.', 'is-error'); return; }
      note('');
      draw(d.signups || []);
    }).catch(function () { note('Could not reach the server.', 'is-error'); });
  }
  function clear(email, btn) {
    if (btn) btn.disabled = true;
    call('POST', { clear: email }).then(function (d) {
      if (btn) btn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'Could not clear that.', 'is-error'); return; }
      draw(d.signups || []);
      document.dispatchEvent(new CustomEvent('mt3uk-bell-refresh'));
    }).catch(function () { if (btn) btn.disabled = false; note('Could not reach the server.', 'is-error'); });
  }
  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.lsu-clear');
    if (btn) clear(btn.getAttribute('data-email'), btn);
  });
  clearAllBtn.addEventListener('click', function () {
    if (!confirm('Clear every new sign-up from this list? Their accounts are not changed.')) return;
    clear('all', clearAllBtn);
  });
  document.addEventListener('mt3uk-admin-refresh', load);
  load();
})();
