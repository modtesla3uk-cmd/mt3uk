/*
  admin.html, Subscribers panel: Give nicknames to members without one. A one-off for members from before nicknames
  were automatic: the worker (POST /profile/admin/nicknames, admin key) gives each member with a first and last name
  but no nickname the automatic one (first initial and last name), and says how many it gave.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var btn = document.getElementById('nick-fill-btn'), note = document.getElementById('nick-fill-status');
  if (!btn || !note) return;
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  btn.addEventListener('click', function () {
    if (!key()) { note.textContent = 'Enter the admin key at the top of the page first.'; return; }
    if (!window.confirm('Give every member who has a name but no nickname the automatic one (first initial and last name)?')) return;
    btn.disabled = true;
    note.textContent = 'Working through the members...';
    fetch(API + '/profile/admin/nicknames?key=' + encodeURIComponent(key()), { method: 'POST', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); })
      .then(function (d) {
        btn.disabled = false;
        if (!d.ok || !d.success) { note.textContent = d.message || 'That did not work.'; return; }
        note.textContent = 'Done: ' + d.given + ' member' + (d.given === 1 ? '' : 's') + ' given a nickname' + (d.examples && d.examples.length ? ' (' + d.examples.join(', ') + (d.given > d.examples.length ? ', ...' : '') + ')' : '') +
          ', ' + d.had + ' already had one, ' + d.noName + ' with no name to make one from, ' + d.cleared + ' cleared theirs, ' + d.total + ' in all.';
      })
      .catch(function () { btn.disabled = false; note.textContent = 'Could not reach the server.'; });
  });
})();
