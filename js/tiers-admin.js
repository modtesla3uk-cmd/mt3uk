/*
  track-admin.html, Free tier and Full access panel. The switch (off, testers only, everyone), the allowance (start,
  monthly top-up, cap), the testers and the members with Full access. One KV key (track-tiers) kept by the worker
  (/track/tiers/admin). Nothing shows to members while the switch is off.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('tiers-wrap');
  if (!wrap) return;
  var noteEl = document.getElementById('tiers-note'), countEl = document.getElementById('tiers-count');
  var testersEl = document.getElementById('tiers-testers'), fullEl = document.getElementById('tiers-full');
  var membersEl = document.getElementById('tiers-members'), findEl = document.getElementById('tiers-find');
  var reqEl = document.getElementById('tiers-requests'), paidEl = document.getElementById('tiers-paid');
  var state = null, members = null;
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
    return fetch(API + '/track/tiers/admin?key=' + encodeURIComponent(key()) + (extra || ''), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function has(list, email) { return list.some(function (x) { return x.email === email; }); }
  function draw() {
    countEl.textContent = MODE_WORDS[state.mode] || '';
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-mode]'), function (b) {
      var on = b.getAttribute('data-mode') === state.mode;
      b.setAttribute('aria-pressed', String(on));
      b.className = on ? 'iv-act' : 'secondary';
    });
    ['start', 'monthly', 'cap'].forEach(function (k) {
      var el = document.getElementById('tiers-' + k);
      if (document.activeElement !== el) el.value = state.allowance[k];
    });
    testersEl.innerHTML = state.testers.length ? '<table class="iv-table"><tbody>' + state.testers.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="testers" data-email="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">No testers yet.</p>';
    fullEl.innerHTML = state.full.length ? '<table class="iv-table"><tbody>' + state.full.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="full" data-email="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody has Full access yet.</p>';
    paidEl.innerHTML = (state.paid || []).length ? '<table class="iv-table"><tbody>' + state.paid.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="paid" data-email="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody is on the paid plan yet.</p>';
    var asks = state.requests || [];
    reqEl.innerHTML = asks.length ? '<table class="iv-table"><tbody>' + asks.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="iv-act" data-topup="' + esc(a.email) + '" data-req="' + esc(a.id) + '">Add 1 day</button> <button type="button" class="secondary iv-act" data-done="' + esc(a.id) + '">Done</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">No requests waiting.</p>';
    if (members) drawMembers();
  }
  function drawMembers() {
    var q = findEl.value.trim().toLowerCase();
    var rows = members.filter(function (m) { return !q || m.email.indexOf(q) !== -1 || (m.name || '').toLowerCase().indexOf(q) !== -1; });
    if (!rows.length) { membersEl.innerHTML = '<p class="empty">No member matches.</p>'; return; }
    var shown = rows.slice(0, 50);
    membersEl.innerHTML = '<table class="iv-table"><tbody>' + shown.map(function (m) {
      var tester = has(state.testers, m.email);
      return '<tr><td>' + esc(m.name ? m.name + ' ' : '') + '<span class="iv-sub">' + esc(m.email) + '</span></td><td>' + (tester ? 'Tester' : '') + '</td>' +
        '<td>' + (tester ? '<button type="button" class="danger iv-act" data-revoke="testers" data-email="' + esc(m.email) + '">Take away</button>' : '<button type="button" class="iv-act" data-give="testers" data-email="' + esc(m.email) + '">Add as tester</button>') + '</td></tr>';
    }).join('') + '</tbody></table>' + (rows.length > shown.length ? '<p class="iv-note">Showing the first ' + shown.length + ' of ' + rows.length + '. Type more to narrow it down.</p>' : '');
  }
  function load() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the panel. Check the admin key.', 'error'); return; }
      state = d; note(''); draw();
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  function loadMembers() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    membersEl.innerHTML = '<p class="empty">Loading...</p>';
    call('GET', undefined, '&members=1').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the members.', 'error'); membersEl.innerHTML = ''; return; }
      state = d; members = d.members || []; note(''); draw();
    }).catch(function () { note('Could not reach the server.', 'error'); membersEl.innerHTML = ''; });
  }
  function act(body, done) {
    call('POST', body).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); return; }
      state = Object.assign({}, state, d); draw(); note(done || '');
      if (body.action === 'topup' || body.action === 'requestdone') {
        // The reply does not list the requests, so the list is read again (the note stays).
        call('GET').then(function (g) { if (g.ok && g.success) { state.requests = g.requests || []; draw(); } });
      }
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  wrap.addEventListener('click', function (e) {
    var m = e.target.closest('[data-mode]');
    if (m) {
      var mode = m.getAttribute('data-mode');
      if (mode === state.mode) return;
      if (mode === 'all' && !window.confirm('Turn the free tier on for everyone? Every signed-in member will be held to the allowance.')) return;
      act({ action: 'mode', mode: mode }, 'Switch set to ' + MODE_WORDS[mode] + '.');
      return;
    }
    var tu = e.target.closest('[data-topup]');
    if (tu) { act({ action: 'topup', email: tu.getAttribute('data-topup'), days: 1 }, 'Added 1 day. The request is marked done.'); return; }
    var dn = e.target.closest('[data-done]');
    if (dn) { act({ action: 'requestdone', id: dn.getAttribute('data-done') }, 'Marked done.'); return; }
    var g = e.target.closest('[data-give]');
    if (g) { act({ action: 'add', list: g.getAttribute('data-give'), email: g.getAttribute('data-email') }, 'Added as a tester.'); return; }
    var r = e.target.closest('[data-revoke]');
    if (r && window.confirm('Take this member off the ' + (r.getAttribute('data-revoke') === 'full' ? 'Full access' : 'testers') + ' list?')) {
      act({ action: 'revoke', list: r.getAttribute('data-revoke'), email: r.getAttribute('data-email') }, 'Removed.');
    }
  });
  document.getElementById('tiers-load').addEventListener('click', loadMembers);
  findEl.addEventListener('input', function () { if (members) drawMembers(); });
  document.getElementById('tiers-allowance-form').addEventListener('submit', function (e) {
    e.preventDefault();
    act({ action: 'allowance', start: parseInt(document.getElementById('tiers-start').value, 10), monthly: parseInt(document.getElementById('tiers-monthly').value, 10), cap: parseInt(document.getElementById('tiers-cap').value, 10) }, 'Allowance saved.');
  });
  document.getElementById('tiers-tester-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('tiers-tester-email'), email = input.value.trim();
    if (!email) return;
    act({ action: 'add', list: 'testers', email: email }, 'Added as a tester.');
    input.value = '';
  });
  document.getElementById('tiers-paid-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('tiers-paid-email'), email = input.value.trim();
    if (!email) return;
    act({ action: 'add', list: 'paid', email: email }, 'Added to the paid plan.');
    input.value = '';
  });
  document.getElementById('tiers-full-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('tiers-full-email'), email = input.value.trim();
    if (!email) return;
    act({ action: 'add', list: 'full', email: email }, 'Full access given. No email is sent.');
    input.value = '';
  });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  if (key()) load();
})();
