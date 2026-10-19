/*
  admin.html, Site theme: each site (mt3uk.com and laps.mt3uk.com) has its own colour theme. Reads and saves through the
  worker (GET and POST /site/theme/admin, admin key). A choice saves at once and shows which site changed.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var noteEl = document.getElementById('theme-status');
  var buttons = [].slice.call(document.querySelectorAll('[data-theme-site]'));
  if (!noteEl || !buttons.length) return;

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function paint(themes) {
    buttons.forEach(function (b) {
      var on = !!themes && themes[b.getAttribute('data-theme-site')] === b.getAttribute('data-theme-pick');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function load() {
    fetch(API + '/site/theme/admin?key=' + encodeURIComponent(key()), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) { if (d && d.success) paint(d.themes); })
      .catch(function () { /* the buttons keep their last state */ });
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      var site = b.getAttribute('data-theme-site'), theme = b.getAttribute('data-theme-pick');
      if (!key()) { note('Enter the admin key at the top of the page first.', 'error'); return; }
      buttons.forEach(function (x) { x.disabled = true; });
      note('Saving...', '');
      fetch(API + '/site/theme/admin?key=' + encodeURIComponent(key()), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ site: site, theme: theme })
      }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
        if (!d.success) { note(d.message || 'Could not save the theme. Check the admin key.', 'error'); return; }
        paint(d.themes);
        note((site === 'laps' ? 'laps.mt3uk.com' : 'mt3uk.com') + ' is now ' + (theme === 'gold' ? 'Green and gold' : theme === 'jade' ? 'Jade and mist' : 'Navy and orange') + '. Visitors see it when their next page loads.', '');
      }).catch(function () { note('Could not reach the site. Try again.', 'error'); })
        .then(function () { buttons.forEach(function (x) { x.disabled = false; }); });
    });
  });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  if (key()) load();
})();
