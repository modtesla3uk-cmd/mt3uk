/*
  admin.html, Sharing links: the Rebuild share cards button. It asks the worker (POST /home/cards/rebuild, admin key) to
  send GitHub the card-previews event, so the homepage card pictures in share/card/ are drawn and committed now, not at the
  next morning run. The key is the one in the admin key box at the top of the page, as on the other admin panels.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var btn = document.getElementById('card-share-rebuild');
  var noteEl = document.getElementById('card-share-status');
  if (!btn || !noteEl) return;

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }

  btn.addEventListener('click', function () {
    if (!key()) { note('Enter the admin key at the top of the page first.', 'error'); return; }
    btn.disabled = true;
    note('Asking GitHub to redraw the homepage card pictures...', '');
    fetch(API + '/home/cards/rebuild?key=' + encodeURIComponent(key()), { method: 'POST', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); })
      .then(function (d) {
        if (!d.ok || !d.success) { note(d.message || 'Could not start the rebuild. Check the admin key.', 'error'); return; }
        note('Started. The pictures are drawn and committed in a few minutes. Then scrape the link again in Facebook’s Sharing Debugger.', '');
      })
      .catch(function () { note('Could not reach the site. Try again.', 'error'); })
      .then(function () { btn.disabled = false; });
  });
})();
