/*
  admin.html and track-admin.html: the Notifications switches at the top of the page. Bell shows or hides the
  notification bell; Email turns the emails to MT3UK about admin actions on or off (the worker checks it before
  sending each one). It also keeps the bell up to date within seconds (see load()). Both are kept in one KV key through the worker's /admin/alerts route, so they are the same on
  every device, and both start on.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var row = document.getElementById('admin-alerts');
  if (!row) return;
  var bellSw = document.getElementById('alerts-bell'), emailSw = document.getElementById('alerts-email'), noteEl = document.getElementById('alerts-note');
  var LOCAL = 'mt3ukAdminAlerts';

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function show(a) {
    bellSw.setAttribute('aria-checked', String(a.bell !== false));
    emailSw.setAttribute('aria-checked', String(a.email !== false));
    document.documentElement.classList.toggle('bell-off', a.bell === false);
    try { localStorage.setItem(LOCAL, JSON.stringify(a)); } catch (e) {}
  }
  function note(t) { noteEl.textContent = t || ''; }
  // What this browser saw last, so a hidden bell does not flash up before the worker answers.
  try { var last = JSON.parse(localStorage.getItem(LOCAL) || 'null'); if (last) show(last); } catch (e) {}

  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API + '/admin/alerts?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  // The worker's stamp changes whenever something new waits for the admin (a request, a report, a claim). It is
  // checked every 15 seconds while the page is in view, and at once when the page comes back into view; a change
  // tells the page to reload what the bell counts ('mt3uk-admin-changed').
  var stamp = null;
  function load() {
    if (!key()) return;
    call('GET').then(function (d) {
      if (!(d.ok && d.success && d.alerts)) return;
      show(d.alerts);
      if (stamp !== null && d.stamp !== stamp) document.dispatchEvent(new CustomEvent('mt3uk-admin-changed'));
      stamp = d.stamp || '';
    }).catch(function () {});
  }
  setInterval(function () { if (!document.hidden) load(); }, 15 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  function flip(sw, field) {
    sw.addEventListener('click', function () {
      if (!key()) { note('Enter the admin key first.'); return; }
      var on = sw.getAttribute('aria-checked') !== 'true', body = {};
      body[field] = on;
      sw.disabled = true;
      call('POST', body).then(function (d) {
        sw.disabled = false;
        if (!d.ok || !d.success) { note(d.message || 'Could not save that. Check the admin key.'); return; }
        show(d.alerts || {});
        note(field === 'bell' ? (on ? 'Bell on.' : 'Bell hidden.') : (on ? 'Emails on.' : 'Emails off: nothing is emailed to MT3UK about admin actions until you switch them back on.'));
      }).catch(function () { sw.disabled = false; note('Could not reach the server.'); });
    });
  }
  flip(bellSw, 'bell');
  flip(emailSw, 'email');
  // Entering the key (Load) reads the switches straight away.
  document.addEventListener('mt3uk-admin-refresh', load);
  load();
})();
