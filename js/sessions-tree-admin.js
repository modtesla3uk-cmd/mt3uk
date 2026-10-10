/*
  track-admin.html, Sessions split by kind panel: who is invited to see the Sessions list split by kind. One KV key
  (laps-offline-access) kept by the worker (/sessions-tree/admin). Approved members, and the admin, get the header icon,
  the one-time offer, the footer link and the Profile switch; Open to all members gives them to everyone.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('tree-wrap');
  if (!wrap) return;
  var allowEl = document.getElementById('st-allowed'), noteEl = document.getElementById('st-note');
  var openBtn = document.getElementById('st-open'), countEl = document.getElementById('tree-count');
  var state = null, members = null;
  var findEl = document.getElementById('st-find'), memEl = document.getElementById('st-members'), meBtn = document.getElementById('st-me');
  var myEmail = '';
  try { myEmail = (localStorage.getItem('mt3ukMyBuildsEmail') || '').toLowerCase(); } catch (e) { /* storage blocked */ }

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, body, extra) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/sessions-tree/admin?key=' + encodeURIComponent(key()) + (extra || ''), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function draw() {
    var s = state;
    openBtn.setAttribute('aria-checked', String(!!s.open));
    countEl.textContent = s.open ? 'open to all' : s.allowed.length + ' approved';
    allowEl.innerHTML = s.allowed.length ? '<table class="iv-table"><tbody>' + s.allowed.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody has been given access yet.</p>';
    if (members) {
      members.forEach(function (m) { m.access = s.open || s.allowed.some(function (a) { return a.email === m.email; }); });
      drawMembers();
    }
    meBtn.hidden = !myEmail;
    if (myEmail) {
      var has = s.open || s.allowed.some(function (a) { return a.email === myEmail; });
      meBtn.textContent = has ? 'Take me away (' + myEmail + ')' : 'Add me (' + myEmail + ')';
      meBtn.setAttribute('data-me', has ? 'revoke' : 'add');
    }
  }
  function drawMembers() {
    var q = findEl.value.trim().toLowerCase();
    var rows = members.filter(function (m) { return !q || m.email.indexOf(q) !== -1 || (m.name || '').toLowerCase().indexOf(q) !== -1; });
    if (!rows.length) { memEl.innerHTML = '<p class="empty">No member matches.</p>'; return; }
    var shown = rows.slice(0, 50);
    memEl.innerHTML = '<table class="iv-table"><tbody>' + shown.map(function (m) {
      var you = m.email === myEmail ? ' <b>(you)</b>' : '';
      return '<tr><td>' + esc(m.name ? m.name + ' ' : '') + '<span class="iv-sub">' + esc(m.email) + you + (m.account === 'laps' ? '' : '') + '</span></td>' +
        '<td>' + (state.open ? 'Open to all' : m.access ? 'Invited' : '') + '</td>' +
        '<td>' + (m.access && !state.open ? '<button type="button" class="danger iv-act" data-revoke="' + esc(m.email) + '">Take away</button>' : !m.access ? '<button type="button" class="iv-act" data-give="' + esc(m.email) + '">Give access</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table>' + (rows.length > shown.length ? '<p class="iv-note">Showing the first ' + shown.length + ' of ' + rows.length + '. Type more to narrow it down.</p>' : '');
  }
  function loadMembers() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    memEl.innerHTML = '<p class="empty">Loading...</p>';
    call('GET', undefined, '&members=1').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the members.', 'error'); memEl.innerHTML = ''; return; }
      state = d; members = d.members || []; note(''); draw();
    }).catch(function () { note('Could not reach the server.', 'error'); memEl.innerHTML = ''; });
  }
  function load() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the list. Check the admin key.', 'error'); return; }
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
  wrap.addEventListener('click', function (e) {
    var g = e.target.closest('[data-give]'), r = e.target.closest('[data-revoke]');
    if (g) { act({ action: 'add', email: g.getAttribute('data-give') }, 'Access given. They see the Sessions split by kind the next time they open Sessions (no email sent).'); return; }
    if (r && window.confirm('Take the Sessions split by kind away from this member?')) act({ action: 'revoke', email: r.getAttribute('data-revoke') }, 'Access removed.');
  });
  document.getElementById('st-load').addEventListener('click', loadMembers);
  findEl.addEventListener('input', function () { if (members) drawMembers(); });
  meBtn.addEventListener('click', function () {
    var give = meBtn.getAttribute('data-me') !== 'revoke';
    act({ action: give ? 'add' : 'revoke', email: myEmail }, give ? 'You now have the Sessions split by kind on your own account.' : 'Taken away from your own account. Reload Sessions to see it go.');
  });
  openBtn.addEventListener('click', function () {
    var on = openBtn.getAttribute('aria-checked') !== 'true';
    if (on && !window.confirm('Show the Sessions split by kind to every member? Every signed-in member will see it the next time they open Sessions.')) return;
    act({ action: 'open', open: on }, on ? 'Open to all members.' : 'Back to invited members only.');
  });
  document.getElementById('st-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('st-add-email'), email = input.value.trim();
    if (!email) return;
    act({ action: 'add', email: email }, 'Added. They see the Sessions split by kind the next time they open Sessions (no email sent).');
    input.value = '';
  });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  if (key()) load();
})();
