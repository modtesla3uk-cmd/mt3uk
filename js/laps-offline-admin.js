/*
  track-admin.html, Offline mode panel: who is offered Laps offline mode while it is tried out. One KV key
  (laps-offline-access) kept by the worker (/laps/offline/admin). Approved members, and the admin, get the header icon,
  the one-time offer, the footer link and the Profile switch; Open to all members gives them to everyone.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('offline-wrap');
  if (!wrap) return;
  var allowEl = document.getElementById('of-allowed'), noteEl = document.getElementById('of-note');
  var openBtn = document.getElementById('of-open'), countEl = document.getElementById('offline-count');
  var state = null;
  var meBtn = document.getElementById('of-me');
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
    return fetch(API + '/laps/offline/admin?key=' + encodeURIComponent(key()) + (extra || ''), opts)
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
    meBtn.hidden = !myEmail;
    if (myEmail) {
      var has = s.open || s.allowed.some(function (a) { return a.email === myEmail; });
      meBtn.textContent = has ? 'Take me away (' + myEmail + ')' : 'Add me (' + myEmail + ')';
      meBtn.setAttribute('data-me', has ? 'revoke' : 'add');
    }
  }
  // The member list is the shared finder (js/member-finder.js): by nickname, name or email, with Show members and Close list.
  function loadMembers() {
    return call('GET', undefined, '&members=1').then(function (d) {
      if (!d.ok || !d.success) throw new Error(d.message || 'Could not load the members.');
      return d.members || [];
    });
  }
  function mountFinder() {
    if (!window.MT3UKMemberFinder) return;
    window.MT3UKMemberFinder.mount(document.getElementById('of-members-host'), {
      load: loadMembers,
      placeholder: 'Find a Laps member by nickname, name or email',
      action: { label: 'Give access', run: function (m) { return act({ action: 'add', email: m.email }, 'Access given. They see Offline mode the next time they open Laps (no email sent).'); } },
      note: function (m) { return state ? (state.open ? '(open to all)' : m.email === myEmail ? '(you)' : has(m.email) ? '(has access)' : '') : ''; }
    });
  }
  function has(email) { return state.allowed.some(function (a) { return a.email === email; }); }
  function load() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the list. Check the admin key.', 'error'); return; }
      state = d; note(''); draw();
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  function act(body, done) {
    return call('POST', body).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); return; }
      state = d; draw(); note(done || '');
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  wrap.addEventListener('click', function (e) {
    var g = e.target.closest('[data-give]'), r = e.target.closest('[data-revoke]');
    if (g) { act({ action: 'add', email: g.getAttribute('data-give') }, 'Access given. They see Offline mode the next time they open Laps (no email sent).'); return; }
    if (r && window.confirm('Take Offline mode away from this member? If they already switched it on it stays on for them.')) act({ action: 'revoke', email: r.getAttribute('data-revoke') }, 'Access removed.');
  });
  mountFinder();
  meBtn.addEventListener('click', function () {
    var give = meBtn.getAttribute('data-me') !== 'revoke';
    act({ action: give ? 'add' : 'revoke', email: myEmail }, give ? 'You now have Offline mode on your own account.' : 'Taken away from your own account. Reload Laps to see it go.');
  });
  openBtn.addEventListener('click', function () {
    var on = openBtn.getAttribute('aria-checked') !== 'true';
    if (on && !window.confirm('Offer Offline mode to every member? Every signed-in member on Laps will see its icon, the offer and the footer link.')) return;
    act({ action: 'open', open: on }, on ? 'Open to all members.' : 'Back to approved members only.');
  });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  if (key()) load();
})();
