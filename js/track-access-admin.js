/*
  admin.html, Early access panel: who can use Track Sessions while it is an
  early preview. Members ask on track.html; the requests wait here to be
  approved or declined. The list is one KV key (track-access) kept by the
  worker (/track/access/admin). "Open to all members" lets everyone in.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('access-wrap');
  if (!wrap) return;
  var pendEl = document.getElementById('ac-pending'), allowEl = document.getElementById('ac-allowed'), noteEl = document.getElementById('ac-note');
  var openBtn = document.getElementById('ac-open'), countEl = document.getElementById('access-count');
  var importBtn = document.getElementById('ac-import'), importNote = document.getElementById('ac-import-note');
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
    return fetch(API + '/track/access/admin?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function draw() {
    var s = state;
    openBtn.setAttribute('aria-checked', String(!!s.open));
    // Until the current testers are on the list, anyone who already has sessions keeps access on their own.
    importBtn.disabled = !!s.imported;
    importNote.textContent = s.imported ? 'Done on ' + when(s.imported) + '. Access now follows this list, so Revoke works for everyone.' : 'Until you do this, anyone who already has sessions keeps access automatically and cannot be revoked.';
    countEl.textContent = s.pending.length ? s.pending.length + ' waiting' : (s.open ? 'open to all' : s.allowed.length + ' approved');
    pendEl.innerHTML = s.pending.length ? '<table class="iv-table"><thead><tr><th>Member</th><th>Using</th><th>Note</th><th>Asked</th><th></th></tr></thead><tbody>' + s.pending.map(function (p) {
      return '<tr><td>' + esc(p.name ? p.name + ' ' : '') + '<span class="iv-sub">' + esc(p.email) + '</span></td><td>' + esc(p.use || '') + '</td><td>' + esc(p.note || '') + '</td><td>' + esc(when(p.at)) + '</td>' +
        '<td><div class="iv-actions"><button type="button" class="iv-act" data-approve="' + esc(p.email) + '">Approve</button><button type="button" class="secondary iv-act" data-deny="' + esc(p.email) + '">Decline</button></div></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody is waiting.</p>';
    allowEl.innerHTML = s.allowed.length ? '<table class="iv-table"><tbody>' + s.allowed.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + (a.existing ? ', current tester' : '') + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="' + esc(a.email) + '">Revoke</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody has been approved yet. Members who already had sessions keep using it.</p>';
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
    var a = e.target.closest('[data-approve]'), d = e.target.closest('[data-deny]'), r = e.target.closest('[data-revoke]');
    if (a) act({ action: 'approve', email: a.getAttribute('data-approve') }, 'Approved. They have been emailed.');
    else if (d) act({ action: 'deny', email: d.getAttribute('data-deny') }, 'Declined.');
    else if (r && window.confirm('Take away this member\'s access? Their sessions stay saved.')) act({ action: 'revoke', email: r.getAttribute('data-revoke') }, 'Access removed.');
  });
  importBtn.addEventListener('click', function () {
    if (!window.confirm('Put everyone who already has track sessions on the approved list? After this, access follows the list and you can revoke any of them.')) return;
    call('POST', { action: 'import' }).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); return; }
      state = d; draw();
      note(d.added.length ? 'Added ' + d.added.length + ': ' + d.added.map(function (x) { return x.name || x.email; }).join(', ') + '.' : 'Everyone with sessions was already on the list.');
    }).catch(function () { note('Could not reach the server.', 'error'); });
  });
  openBtn.addEventListener('click', function () {
    var on = openBtn.getAttribute('aria-checked') !== 'true';
    if (on && !window.confirm('Open Track Sessions to every member? Anyone signed in will be able to use it.')) return;
    act({ action: 'open', open: on }, on ? 'Open to all members.' : 'Back to approved members only.');
  });
  document.getElementById('ac-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('ac-add-email'), email = input.value.trim();
    if (!email) return;
    act({ action: 'add', email: email }, 'Added. They can use it now (no email sent).');
    input.value = '';
  });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  // The count shows without opening the panel, once the key is known.
  if (key()) load();
})();
