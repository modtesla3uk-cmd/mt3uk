/*
  track-admin.html, Usage panel: how Laps is being used, from the worker's /track/admin/usage (admin key), for
  deciding on a paid tier. Members with sessions, who is active and who comes back, sessions saved per week,
  shared sessions and kept readings with their storage, vehicles by make, and the access list.
*/
(function () {
  var wrap = document.getElementById('usage-wrap');
  if (!wrap) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var out = document.getElementById('us-out'), noteEl = document.getElementById('us-note'), loadBtn = document.getElementById('us-load');
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, bad) { noteEl.textContent = t || ''; noteEl.classList.toggle('is-bad', !!bad); }
  function mb(bytes) { return bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : (bytes / 1e6).toFixed(1) + ' MB'; }
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '0%'; }
  function tile(n, label, sub) { return '<div class="us-tile"><b>' + esc(n) + '</b><span>' + esc(label) + '</span>' + (sub ? '<span class="iv-sub">' + esc(sub) + '</span>' : '') + '</div>'; }
  function dayName(iso) { var d = new Date(iso + 'T00:00:00Z'); return d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; }
  function draw(d) {
    var m = d.members, s = d.sessions, a = d.access, v = d.vehicles;
    var most = Math.max.apply(null, d.weeks.map(function (w) { return w.sessions; }).concat([1]));
    var typeNames = { track: 'Track days', sprint: 'Sprints and hill climbs', drag: 'Drag runs', other: 'Drives' };
    out.innerHTML =
      '<h4 class="us-head">Members</h4><div class="us-tiles" id="us-members">' +
      tile(m.withSessions, 'with sessions') + tile(m.active30, 'active in the last 30 days', pct(m.active30, m.withSessions) + ' of them') + tile(m.active90, 'active in the last 90 days') +
      tile(m.returning, 'came back', 'sessions in two or more months') + tile(m.new30, 'new in the last 30 days') + tile(m.oneSession, 'only one session') + '</div>' +
      '<p class="iv-note">Access: ' + (a.open ? 'open to all members' : a.approved + ' approved') + ', ' + a.waiting + ' waiting. Members who had sessions before the preview count as with sessions whether or not they are on the list.</p>' +
      '<h4 class="us-head">Sessions</h4><div class="us-tiles" id="us-sessions">' +
      tile(s.total, 'saved in all' + (s.capped ? ' (first ' + s.total + ')' : '')) + tile(s.last30, 'saved in the last 30 days') + tile(s.last90, 'saved in the last 90 days') +
      tile(s.shared, 'shared', pct(s.shared, s.total) + ' on a build or a leaderboard') + tile(s.withReadings, 'keep their readings', pct(s.withReadings, s.total)) +
      tile(s.readingsSized ? mb(s.readingsBytes) : 'Not known', 'storage for readings', s.readingsSized ? 'about ' + mb(s.readingsBytes / s.readingsSized) + ' a session, from ' + s.readingsSized + ' sized' : 'sizes are kept from now on') + '</div>' +
      '<p class="iv-note">' + Object.keys(s.byType).sort().map(function (t) { return (typeNames[t] || t) + ': ' + s.byType[t]; }).join(', ') + '. ' + d.boards + ' leaderboard' + (d.boards === 1 ? '' : 's') + ' with entries.</p>' +
      '<h4 class="us-head">Sessions saved each week</h4><ol class="us-weeks" id="us-weeks">' + d.weeks.map(function (w) {
        return '<li><span class="us-week">' + esc(dayName(w.week)) + '</span><span class="us-bar"><i style="width:' + Math.round(100 * w.sessions / most) + '%"></i></span><span class="us-n">' + w.sessions + '<span class="iv-sub"> from ' + w.cars + ' vehicle' + (w.cars === 1 ? '' : 's') + '</span></span></li>';
      }).join('') + '</ol>' +
      '<h4 class="us-head">Vehicles</h4><p class="iv-note" id="us-vehicles">' + v.cars + ' with sessions' + (v.bikes ? ', ' + v.bikes + ' of them bikes' : '') + (v.byMake.length ? ': ' + v.byMake.map(function (x) { return esc(x.make) + ' ' + x.cars; }).join(', ') : '') + '.</p>' +
      '<p class="iv-sub">Counted at ' + esc(d.at.replace('T', ' ').slice(0, 16)) + ' UTC. Dates are when a session was saved, not driven.</p>';
  }
  function load() {
    if (!key()) { note('Enter the admin key at the top of the page first.'); return; }
    loadBtn.disabled = true;
    note('Counting...');
    fetch(API + '/track/admin/usage?key=' + encodeURIComponent(key()), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); })
      .then(function (d) {
        loadBtn.disabled = false;
        if (!d.ok || !d.success) { note(d.message || 'Could not count. Check the admin key.', true); return; }
        note(''); draw(d);
      }).catch(function () { loadBtn.disabled = false; note('Could not reach the server.', true); });
  }
  loadBtn.addEventListener('click', load);
  wrap.addEventListener('toggle', function () { if (wrap.open && !out.children.length) load(); });
})();
