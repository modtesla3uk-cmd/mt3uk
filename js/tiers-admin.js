/*
  track-admin.html, Full access and free limit panel: the number of Track sessions a free member may upload in total,
  and the members with Full access (not held to that limit; for testing, no payments yet). One KV key (track-tiers)
  kept by the worker (/track/tiers/admin). Changes take effect the next time a member uploads.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('tiers-wrap');
  if (!wrap) return;
  var noteEl = document.getElementById('tiers-note'), countEl = document.getElementById('tiers-count');
  var limitEl = document.getElementById('tiers-limit'), fullEl = document.getElementById('tiers-full');
  var state = null;

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/track/tiers/admin?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function draw() {
    countEl.textContent = state.full.length ? state.full.length + ' with Full access' : '';
    if (document.activeElement !== limitEl) limitEl.value = state.limit;
    fullEl.innerHTML = state.full.length ? '<table class="iv-table"><tbody>' + state.full.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody has Full access yet.</p>';
  }
  function load() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the limit. Check the admin key.', 'error'); return; }
      state = d; note(''); draw();
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  function act(body, done) {
    call('POST', body).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); return; }
      state = d; draw(); note(done || '');
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  fullEl.addEventListener('click', function (e) {
    var r = e.target.closest('[data-revoke]');
    if (r && window.confirm('Take Full access away from this member? They go back to the free limit.')) act({ action: 'revoke', email: r.getAttribute('data-revoke') }, 'Full access taken away.');
  });
  document.getElementById('tiers-limit-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = parseInt(limitEl.value, 10);
    if (!(n >= 0 && n <= 10000)) { note('The limit must be a whole number from 0 to 10,000.', 'error'); return; }
    act({ action: 'limit', limit: n }, 'Free limit saved as ' + n + ' sessions.');
  });
  document.getElementById('tiers-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('tiers-add-email'), email = input.value.trim();
    if (!email) return;
    act({ action: 'add', email: email }, 'Full access given. No email is sent.');
    input.value = '';
  });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  if (key()) load();
})();
