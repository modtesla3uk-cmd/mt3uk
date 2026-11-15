/*
  admin.html, Site theme: each site (mt3uk.com and laps.mt3uk.com) has its own colour theme. Reads and saves through the
  worker (GET and POST /site/theme/admin, admin key). A choice saves at once and shows which site changed. The same panel
  sets light or dark for the Laps pages: the default for a visitor who has not picked, and Dark for everyone.
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
      .then(function (d) { if (d && d.success) { paint(d.themes); paintMode(d.mode); } })
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
  // Laps: light or dark. The default for a visitor who has not picked (light, follow their device, dark), and Dark for
  // everyone, which opens every Laps page dark for everyone (POST /site/theme/admin with mode or darkAll).
  var modeBtns = [].slice.call(document.querySelectorAll('[data-mode-pick]'));
  var darkAll = document.getElementById('mode-dark-all');
  var modeNote = document.getElementById('mode-status');
  var MODE_WORDS = { light: 'Light', system: 'Follow their device', dark: 'Dark' };
  function noteMode(t, kind) { if (modeNote) { modeNote.textContent = t || ''; modeNote.className = 'iv-note' + (kind ? ' ' + kind : ''); } }
  function paintMode(m) {
    if (!m) return;
    modeBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-mode-pick') === m.laps ? 'true' : 'false'); });
    if (darkAll) darkAll.setAttribute('aria-checked', m.darkAll ? 'true' : 'false');
  }
  function saveMode(body, done) {
    if (!key()) { noteMode('Enter the admin key at the top of the page first.', 'error'); return; }
    noteMode('Saving...', '');
    fetch(API + '/site/theme/admin?key=' + encodeURIComponent(key()), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
      if (!d.success) { noteMode(d.message || 'Could not save. Check the admin key.', 'error'); return; }
      paintMode(d.mode);
      noteMode(done(d.mode), '');
    }).catch(function () { noteMode('Could not reach the site. Try again.', 'error'); });
  }
  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-mode-pick');
      saveMode({ mode: m }, function (mode) {
        return 'Laps now opens ' + (m === 'system' ? 'following each visitor\'s device' : 'in ' + MODE_WORDS[m].toLowerCase() + ' mode') + ' for visitors who have not picked' + (mode && mode.darkAll ? ' (Dark for everyone is on, so everyone sees dark for now).' : '.');
      });
    });
  });
  if (darkAll) darkAll.addEventListener('click', function () {
    var on = darkAll.getAttribute('aria-checked') !== 'true';
    saveMode({ darkAll: on }, function () {
      return on ? 'Dark for everyone is on: every Laps page opens dark for everyone when their next page loads.' : 'Dark for everyone is off: each visitor\'s own choice, or the default, applies again.';
    });
  });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  if (key()) load();
})();
