/*
  track-admin.html, Sprints and hill climbs panel: the gate that hides sprints and hill climbs (saving, viewing and
  seeing them) from everyone except testers, or opens them to everyone. One KV key (track-kinds) kept by the worker
  (/track/kinds/admin). Nothing shows to members while the switch is Off.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('kinds-wrap');
  if (!wrap) return;
  var noteEl = document.getElementById('kinds-note'), countEl = document.getElementById('kinds-count');
  var testersEl = document.getElementById('kinds-testers');
  var state = null;
  var MODE_WORDS = { off: 'Off', testers: 'Testers only', all: 'Everyone' };

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, body, extra) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/track/kinds/admin?key=' + encodeURIComponent(key()) + (extra || ''), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function has(list, email) { return list.some(function (x) { return x.email === email; }); }
  function draw() {
    countEl.textContent = MODE_WORDS[state.mode] || '';
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-kmode]'), function (b) {
      var on = b.getAttribute('data-kmode') === state.mode;
      b.setAttribute('aria-pressed', String(on));
      b.className = on ? 'iv-act' : 'secondary';
    });
    testersEl.innerHTML = state.testers.length ? '<table class="iv-table"><tbody>' + state.testers.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">No testers yet.</p>';
  }
  function load() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the panel. Check the admin key.', 'error'); return; }
      state = d; note(''); draw();
    }).catch(function () { note('Could not reach the server.', 'error'); });
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
    window.MT3UKMemberFinder.mount(document.getElementById('kinds-members-host'), {
      load: loadMembers,
      action: { label: 'Add as tester', run: function (m) { return act({ action: 'add', email: m.email }, 'Added as a tester.'); } },
      note: function (m) { return state && has(state.testers, m.email) ? '(already a tester)' : ''; }
    });
  }
  function act(body, done) {
    return call('POST', body).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); return; }
      state = Object.assign({}, state, d); draw(); note(done || '');
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  wrap.addEventListener('click', function (e) {
    var m = e.target.closest('[data-kmode]');
    if (m) {
      var mode = m.getAttribute('data-kmode');
      if (mode === state.mode) return;
      if (mode === 'all' && !window.confirm('Open sprints and hill climbs to everyone? Every signed-in member will see them, including existing ones.')) return;
      act({ action: 'mode', mode: mode }, 'Switch set to ' + MODE_WORDS[mode] + '.');
      return;
    }
    var g = e.target.closest('[data-give]');
    if (g) { act({ action: 'add', email: g.getAttribute('data-give') }, 'Added as a tester.'); return; }
    var r = e.target.closest('[data-revoke]');
    if (r && window.confirm('Take this member off the testers list?')) act({ action: 'revoke', email: r.getAttribute('data-revoke') }, 'Removed.');
  });
  mountFinder();
  // Read when the panel is opened (or refreshed while it is open), not on every page load.
  document.addEventListener('mt3uk-admin-refresh', function () { if (key() && wrap.open) load(); });
})();
