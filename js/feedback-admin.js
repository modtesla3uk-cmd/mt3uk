/*
  admin.html, Reports group: Feedback from members, what members send from the menu (Give feedback) as the worker kept
  it (/feedback/admin, admin key, one KV key feedback-list, the latest 100). Each one shows the nickname, the email if
  one was given, the page it was sent from, the message and a screenshot if there was one (read through the admin
  route, never a public address). Clear takes one off the list, or all of them.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('feedback-wrap');
  if (!wrap) return;
  var listEl = document.getElementById('feedback-list'), noteEl = document.getElementById('feedback-note');
  var countEl = document.getElementById('feedback-count'), clearAllBtn = document.getElementById('feedback-clear-all');

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API + '/feedback/admin?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function nice(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function draw(list) {
    countEl.textContent = list.length ? '(' + list.length + ')' : '';
    clearAllBtn.hidden = !list.length;
    if (!list.length) { listEl.innerHTML = '<p class="empty">No feedback from members.</p>'; return; }
    listEl.innerHTML = list.map(function (f) {
      var shot = f.hasShot ? '<p><a href="' + esc(API + '/feedback/admin?shot=' + encodeURIComponent(f.id) + '&key=' + encodeURIComponent(key())) + '" target="_blank" rel="noopener">Open the screenshot</a></p>' : '';
      return '<div class="card fb-card" data-feedback="' + esc(f.id) + '">' +
        '<p><b>' + esc(f.nickname) + '</b>' + (f.email ? ' <span class="iv-sub">' + esc(f.email) + '</span>' : ' <span class="iv-sub">No email given</span>') + '</p>' +
        '<p class="card-meta">' + esc(nice(f.at)) + (f.page ? ' · ' + esc(f.page) : '') + '</p>' +
        '<p>' + esc(f.message).replace(/\n/g, '<br>') + '</p>' + shot +
        '<button type="button" class="secondary iv-act fb-clear" data-id="' + esc(f.id) + '">Clear</button></div>';
    }).join('');
  }
  function load() {
    if (!key()) return;
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the feedback.', 'is-error'); return; }
      note('');
      draw(d.feedback || []);
    }).catch(function () { note('Could not reach the server.', 'is-error'); });
  }
  function clear(id, btn) {
    if (btn) btn.disabled = true;
    call('POST', { clear: id }).then(function (d) {
      if (btn) btn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'Could not clear that.', 'is-error'); return; }
      load();
      document.dispatchEvent(new CustomEvent('mt3uk-bell-refresh'));
    }).catch(function () { if (btn) btn.disabled = false; note('Could not reach the server.', 'is-error'); });
  }
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('.fb-clear');
    if (b) clear(b.getAttribute('data-id'), b);
  });
  clearAllBtn.addEventListener('click', function () {
    if (!window.confirm('Clear all feedback from members? This takes them off the list and deletes their screenshots.')) return;
    clear('all', clearAllBtn);
  });
  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap.open) load(); });
  document.addEventListener('mt3uk-admin-changed', function () { if (wrap.open) load(); });
})();
