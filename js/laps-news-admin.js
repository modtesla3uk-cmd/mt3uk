/*
  Admin: the announcement at the top of a member's Sessions (one line and an optional link), until they close it.
  Saved in the worker (KV laps-news, /laps/news/admin). Changing the words or the link makes it a new announcement,
  so members who closed the last one see it.
*/
(function () {
  var wrap = document.getElementById('news-wrap');
  if (!wrap) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var text = document.getElementById('an-text'), link = document.getElementById('an-link'), linkText = document.getElementById('an-link-text');
  var on = document.getElementById('an-on'), note = document.getElementById('an-note');
  var saveBtn = document.getElementById('an-save'), clearBtn = document.getElementById('an-clear'), loaded = false;
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function call(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path + '?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function say(t, bad) { if (note) { note.textContent = t || ''; note.classList.toggle('is-bad', !!bad); } }
  function shown() { return on.getAttribute('aria-checked') === 'true'; }
  function fill(n) {
    n = n || {};
    text.value = n.text || ''; link.value = n.link || ''; linkText.value = n.text && n.link ? (n.linkText || '') : '';
    on.setAttribute('aria-checked', String(!!n.on));
    say(n.text ? (n.on ? 'Showing to members on Sessions.' : 'Saved but switched off: members do not see it.') : 'No announcement. Write one line and switch it on.');
  }
  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    call('GET', '/laps/news/admin').then(function (d) {
      if (!d.success) { say(d.message || 'Could not load it.', true); return; }
      loaded = true; fill(d.news);
    }).catch(function () { say('Could not reach the server.', true); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open && !loaded) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap.open) load(); });
  on.addEventListener('click', function () { on.setAttribute('aria-checked', String(!shown())); });
  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    var typed = link.value.trim();
    call('POST', '/laps/news/admin', { text: text.value.trim(), link: typed, linkText: linkText.value.trim(), on: shown() }).then(function (d) {
      saveBtn.disabled = false;
      if (!d.success) { say(d.message || 'Could not save it.', true); return; }
      fill(d.news);
      if (typed && d.news && !d.news.link) say('Saved, but the link was left off: use a page such as leaderboards.html or an https:// address.', true);
      else say(d.news && d.news.on ? 'Saved. Members see it on Sessions within two minutes.' : 'Saved, switched off.');
    }).catch(function () { saveBtn.disabled = false; say('Could not reach the server.', true); });
  });
  clearBtn.addEventListener('click', function () {
    if (!window.confirm('Remove the announcement?')) return;
    call('POST', '/laps/news/admin', { clear: true }).then(function (d) {
      if (!d.success) { say(d.message || 'Could not remove it.', true); return; }
      fill({}); say('Removed.');
    }).catch(function () { say('Could not reach the server.', true); });
  });
})();
