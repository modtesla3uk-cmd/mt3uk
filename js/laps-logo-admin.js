/*
  Admin: the Laps logo. Four marks (js/laps-logo.js), each shown on light and dark; the chosen one is kept in the
  worker (KV laps-logo, /laps/logo/admin) and every Laps page, the favicon and the sharing card follow it.
*/
(function () {
  var wrap = document.getElementById('logo-wrap'), L = window.MT3UKLapsLogo;
  if (!wrap || !L) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var grid = document.getElementById('ll-grid'), note = document.getElementById('ll-note'), saveBtn = document.getElementById('ll-save');
  var chosen = '', saved = '', loaded = false;
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
  function lock(id, bg, fg, size) {
    return '<span class="ll-lock" style="background:' + bg + '"><svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '" style="color:' + fg + '" aria-hidden="true">' + L.inner(id, 'currentColor') + '</svg>' +
      '<span class="ll-name" style="color:' + fg + '">Laps</span></span>';
  }
  function draw() {
    grid.innerHTML = L.options.map(function (o) {
      return '<button type="button" class="ll-opt' + (o.id === chosen ? ' is-on' : '') + '" data-logo="' + o.id + '" aria-pressed="' + (o.id === chosen) + '">' +
        '<span class="ll-row">' + lock(o.id, '#f3f1ea', '#16233d', 40) + lock(o.id, '#16233d', '#ffffff', 40) +
        '<span class="ll-app" style="background:#16233d"><svg viewBox="0 0 64 64" width="38" height="38" style="color:#fff" aria-hidden="true">' + L.inner(o.id, '#ffffff') + '</svg></span></span>' +
        '<b>' + o.name + (o.id === saved ? ' <em>(in use)</em>' : '') + '</b><span class="ll-about">' + o.about + '</span></button>';
    }).join('');
    saveBtn.disabled = !chosen || chosen === saved;
  }
  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    call('GET', '/laps/logo/admin').then(function (d) {
      if (!d.success) { say(d.message || 'Could not load it.', true); return; }
      loaded = true; saved = chosen = L.known(d.logo); draw();
      say('In use: ' + L.options.filter(function (o) { return o.id === saved; })[0].name + '. Pick another to try it, then use it.');
    }).catch(function () { say('Could not reach the server.', true); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open && !loaded) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap.open) load(); });
  grid.addEventListener('click', function (e) {
    var b = e.target.closest('.ll-opt');
    if (!b) return;
    chosen = b.getAttribute('data-logo'); draw();
    say(chosen === saved ? 'This one is in use now.' : 'Not in use yet: press Use this logo to switch the whole site to it.');
  });
  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    call('POST', '/laps/logo/admin', { logo: chosen }).then(function (d) {
      if (!d.success) { saveBtn.disabled = false; say(d.message || 'Could not save it.', true); return; }
      saved = chosen = L.known(d.logo); L.remember(saved); draw();
      say('Saved. Laps pages switch within a minute, the sharing card the next time you draw one.');
    }).catch(function () { saveBtn.disabled = false; say('Could not reach the server.', true); });
  });
})();
