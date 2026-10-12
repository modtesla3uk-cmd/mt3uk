/*
  track-admin.html, Sign-in and sign-up panel: the Laps members list, the Laps-only accounts (joined on Laps while
  MT3UK membership was switched off) from the worker's /laps/members/admin (admin key; it lists laps-account: keys with
  list(), fine for an admin route). Remove signs the person out everywhere, deletes what Laps held about them, takes
  them off the early access and New Laps sign-ups lists and, with the Email them switch on, emails them that they are
  unsubscribed with a link to subscribe again. Full MT3UK members are removed on the Subscribers panel of admin.html.
*/
(function () {
  var wrap = document.getElementById('signin-wrap');
  var listEl = document.getElementById('lm-list');
  if (!wrap || !listEl) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var noteEl = document.getElementById('lm-note'), emailSw = document.getElementById('lm-email');
  var loaded = false;
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, bad) { noteEl.textContent = t || ''; noteEl.classList.toggle('is-bad', !!bad); }
  function emailOn() { return emailSw.getAttribute('aria-checked') === 'true'; }
  function nice(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/laps/members/admin?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function draw(members) {
    if (!members.length) { listEl.innerHTML = '<p class="empty">No Laps-only accounts.</p>'; return; }
    listEl.innerHTML = '<table class="iv-table lm-table"><thead><tr><th>Member</th><th>Joined</th><th></th></tr></thead><tbody>' + members.map(function (m) {
      return '<tr data-member="' + esc(m.email) + '"><td>' + esc(m.name || m.email) + (m.name ? '<span class="iv-sub">' + esc(m.email) + '</span>' : '') + '</td>' +
        '<td>' + esc(nice(m.since)) + '</td>' +
        '<td><button type="button" class="secondary iv-act lm-remove" data-email="' + esc(m.email) + '">Remove</button></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function load() {
    if (!key()) return;
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the Laps members.', true); return; }
      loaded = true; note(''); draw(d.members || []);
    }).catch(function () { note('Could not reach the server.', true); });
  }
  emailSw.addEventListener('click', function () { emailSw.setAttribute('aria-checked', String(!emailOn())); });
  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.lm-remove');
    if (!btn) return;
    var email = btn.getAttribute('data-email');
    var tell = emailOn();
    if (!confirm('Remove the Laps account for ' + email + '? Their cars, sessions and settings will be deleted and they will be signed out, ' + (tell ? 'and emailed to say they are unsubscribed, with a link to subscribe again.' : 'without an email.'))) return;
    btn.disabled = true;
    call('POST', { remove: email, notify: tell }).then(function (d) {
      if (!d.ok || !d.success) { btn.disabled = false; note(d.message || 'Could not remove that account.', true); return; }
      draw(d.members || []);
      note('Removed ' + email + (d.emailed ? ' and emailed them.' : (tell ? '. They were not emailed (emails off, or they had no account).' : ', without an email.')));
      document.dispatchEvent(new CustomEvent('mt3uk-admin-refresh'));
      document.dispatchEvent(new CustomEvent('mt3uk-bell-refresh'));
    }).catch(function () { btn.disabled = false; note('Could not reach the server.', true); });
  });
  wrap.addEventListener('toggle', function () { if (wrap.open && !loaded) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap.open && loaded) load(); });
})();
