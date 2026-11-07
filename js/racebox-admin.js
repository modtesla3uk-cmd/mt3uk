/*
  track-admin.html, RaceBox test panel: one switch that shows the RaceBox test panel in the Laps app. One KV key
  (laps-racebox) kept by the worker (/laps/racebox/admin). Off hides the panel from everyone.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var sw = document.getElementById('racebox-on');
  if (!sw) return;
  var noteEl = document.getElementById('racebox-note');
  var countEl = document.getElementById('racebox-count');

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function show(on) {
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    if (countEl) countEl.textContent = on ? 'On' : 'Off';
    if (noteEl) noteEl.textContent = on ? 'On: the RaceBox test shows in the Laps app.' : 'Off: the RaceBox test is hidden.';
  }
  function fail(msg) { if (noteEl) noteEl.textContent = msg || 'Could not change it.'; }
  function load() {
    fetch(API + '/laps/racebox/admin?key=' + encodeURIComponent(key()), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) { if (d && d.success) show(d.on); else fail(d && d.message ? d.message : 'Enter the admin key first.'); })
      .catch(function () { fail('Could not reach the server.'); });
  }
  sw.addEventListener('click', function () {
    var on = sw.getAttribute('aria-checked') !== 'true';
    fetch(API + '/laps/racebox/admin?key=' + encodeURIComponent(key()), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ on: on })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) { if (d && d.success) show(d.on); else fail(d && d.message); })
      .catch(function () { fail('Could not reach the server.'); });
  });
  load();
})();
