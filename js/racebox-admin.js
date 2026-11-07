/*
  track-admin.html, RaceBox test panel: who sees the RaceBox test in the Laps app. Like Offline mode: an approved list
  and Open to all members, kept by the worker (/laps/racebox/admin, one KV key, laps-racebox).
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('racebox-wrap');
  if (!wrap) return;
  var openBtn = document.getElementById('racebox-open');
  var allowedEl = document.getElementById('racebox-allowed');
  var noteEl = document.getElementById('racebox-note');
  var countEl = document.getElementById('racebox-count');
  var findEl = document.getElementById('racebox-find');
  var findGo = document.getElementById('racebox-find-go');
  var hostEl = document.getElementById('racebox-members-host');
  var state = { open: false, allowed: [] };

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t) { if (noteEl) noteEl.textContent = t || ''; }
  function call(method, body, extra) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/laps/racebox/admin?key=' + encodeURIComponent(key()) + (extra || ''), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function draw() {
    openBtn.setAttribute('aria-checked', state.open ? 'true' : 'false');
    if (countEl) countEl.textContent = state.open ? 'Open to all' : (state.allowed.length ? state.allowed.length + ' approved' : 'Off');
    allowedEl.innerHTML = state.allowed.length ? state.allowed.map(function (x) {
      return '<div class="iv-row"><span>' + esc(x.name || x.email) + (x.name ? ' <span class="iv-note">' + esc(x.email) + '</span>' : '') + '</span>' +
        '<button type="button" class="secondary" data-take="' + esc(x.email) + '">Take away</button></div>';
    }).join('') : '<p class="iv-note">No members approved yet.</p>';
  }
  function apply(d) {
    if (!d || !d.ok) { note(d && d.message ? d.message : 'Enter the admin key first.'); return; }
    state.open = !!d.open;
    state.allowed = d.allowed || [];
    draw();
  }
  function load() { call('GET').then(apply).catch(function () { note('Could not reach the server.'); }); }

  openBtn.addEventListener('click', function () {
    call('POST', { action: 'open', open: !state.open }).then(function (d) { apply(d); if (d && d.ok) note(state.open ? 'Open to all members.' : 'Open to all members is off.'); });
  });
  allowedEl.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-take]');
    if (!b) return;
    call('POST', { action: 'revoke', email: b.getAttribute('data-take') }).then(function (d) { apply(d); if (d && d.ok) note('Access taken away.'); });
  });
  findGo.addEventListener('click', function () {
    var q = (findEl.value || '').trim().toLowerCase();
    call('GET', undefined, '&members=1').then(function (d) {
      if (!d || !d.ok) { note(d && d.message ? d.message : 'Could not find members.'); return; }
      state.open = !!d.open; state.allowed = d.allowed || []; draw();
      var rows = (d.members || []).filter(function (m) {
        return !q || (m.email || '').indexOf(q) !== -1 || (m.name || '').toLowerCase().indexOf(q) !== -1;
      });
      hostEl.innerHTML = rows.length ? rows.map(function (m) {
        return '<div class="iv-row"><span>' + esc(m.name || m.email) + (m.name ? ' <span class="iv-note">' + esc(m.email) + '</span>' : '') + '</span>' +
          (m.access ? '<button type="button" class="secondary" data-take="' + esc(m.email) + '">Take away</button>'
                    : '<button type="button" class="secondary" data-give="' + esc(m.email) + '">Give access</button>') + '</div>';
      }).join('') : '<p class="iv-note">No Laps members match.</p>';
    }).catch(function () { note('Could not reach the server.'); });
  });
  hostEl.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('[data-give]');
    var t = e.target.closest && e.target.closest('[data-take]');
    var em = g ? g.getAttribute('data-give') : (t ? t.getAttribute('data-take') : '');
    if (!em) return;
    call('POST', { action: g ? 'add' : 'revoke', email: em }).then(function (d) { apply(d); findGo.click(); if (d && d.ok) note(g ? 'Access given.' : 'Access taken away.'); });
  });
  load();
})();
