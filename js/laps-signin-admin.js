/*
  track-admin.html, Sign-in and sign-up panel: how signing in and joining works on laps.mt3uk.com, from the worker's
  /laps/signin/admin (admin key, one KV key laps-signin). Separate Laps sign-in (its own page and emails, the link
  coming back to laps.mt3uk.com), whether someone joining on Laps becomes an MT3UK member too, and the opening line
  of the Laps sign-in and welcome emails (blank keeps the built-in words).
*/
(function () {
  var wrap = document.getElementById('signin-wrap');
  if (!wrap) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var BUILT_IN = {
    signinIntro: 'Click the link below to sign in to Laps by MT3UK, where you can add your track sessions and see the leaderboards:',
    joinIntro: 'Thanks for joining Laps by MT3UK. Click the link below to finish joining, then add your car and your first track session:'
  };
  var sep = document.getElementById('ls-separate'), too = document.getElementById('ls-mt3uk-too');
  var signinIntro = document.getElementById('ls-signin-intro'), joinIntro = document.getElementById('ls-join-intro');
  var noteEl = document.getElementById('ls-note'), countEl = document.getElementById('ls-count'), saveBtn = document.getElementById('ls-save');
  var loaded = false;
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function note(t, bad) { noteEl.textContent = t || ''; noteEl.classList.toggle('is-bad', !!bad); }
  function on(el) { return el.getAttribute('aria-checked') === 'true'; }
  function set(el, v) { el.setAttribute('aria-checked', String(!!v)); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/laps/signin/admin?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  // The emails' fields only matter while Laps has its own sign-in.
  function sync() { wrap.querySelectorAll('[data-ls-separate-only]').forEach(function (el) { el.hidden = !on(sep); }); }
  function fill(d) {
    var c = d.settings || {};
    set(sep, c.separate !== false); set(too, c.mt3ukToo !== false);
    signinIntro.value = c.signinIntro || ''; joinIntro.value = c.joinIntro || '';
    signinIntro.placeholder = BUILT_IN.signinIntro; joinIntro.placeholder = BUILT_IN.joinIntro;
    countEl.textContent = d.lapsAccounts ? d.lapsAccounts + ' Laps-only account' + (d.lapsAccounts === 1 ? '' : 's') + ' so far.' : 'No Laps-only accounts yet.';
    sync();
  }
  function load() {
    if (!key()) { note('Enter the admin key at the top of the page first.'); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the settings. Check the admin key.', true); return; }
      loaded = true; note(''); fill(d);
    }).catch(function () { note('Could not reach the server.', true); });
  }
  [sep, too].forEach(function (el) { el.addEventListener('click', function () { set(el, !on(el)); sync(); }); });
  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    call('POST', { separate: on(sep), mt3ukToo: on(too), signinIntro: signinIntro.value.trim(), joinIntro: joinIntro.value.trim() }).then(function (d) {
      saveBtn.disabled = false;
      if (!d.ok || !d.success) { note(d.message || 'Could not save it.', true); return; }
      fill(d); note('Saved. The next sign-in or join on Laps follows it.');
    }).catch(function () { saveBtn.disabled = false; note('Could not reach the server.', true); });
  });
  wrap.addEventListener('toggle', function () { if (wrap.open && !loaded) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap.open) load(); });
})();
