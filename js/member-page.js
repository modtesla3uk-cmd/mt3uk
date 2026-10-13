/*
  Member (member.html?car=<carId>): a member's public profile, found from one of their cars. It shows the name other
  members see, the cars they have shared Track sessions on, and those sessions. The worker sends only what is shared
  (GET /profile/public); nothing here needs a sign-in.
*/
(function () {
  var API = window.MT3UK_TRACK_API || 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var app = document.getElementById('mp-app');
  var heading = document.getElementById('mp-name');
  if (!app) return;
  var TYPE = { track: 'Track day', sprint: 'Sprint', drag: 'Drag strip', other: 'Drive' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtLap(sec) {
    if (!sec) return '';
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m ? m + ':' + (s < 10 ? '0' : '') + s.toFixed(2) : s.toFixed(2) + ' s';
  }
  function result(s) {
    if (s.type === 'drag') return s.quarter ? s.quarter.toFixed(2) + ' s, 1/4 mile' : s.s60 ? s.s60.toFixed(2) + ' s, 0 to 60 mph' : (s.runs || 0) + ' runs';
    return s.bestTime ? fmtLap(s.bestTime) : (s.laps || 0) + (s.type === 'sprint' ? ' runs' : ' laps');
  }
  function trackName(s) {
    var base = s.venue || (TYPE[s.type] || 'Track session');
    if (s.layout && s.layout !== s.venue) return base + ', ' + s.layout;
    return base;
  }
  function niceDate(d) {
    if (!d) return '';
    var t = new Date(d + 'T12:00:00');
    return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function carLine(c) { return [c.year, c.make, c.model].filter(Boolean).join(' '); }
  function say(text) { app.innerHTML = '<p class="mp-empty">' + esc(text) + '</p>'; }

  function render(d) {
    if (heading) heading.textContent = d.member.name;
    document.title = d.member.name + ' - Laps by MT3UK';
    var carName = {};
    var cars = d.cars.map(function (c) {
      carName[c.id] = c.name || carLine(c) || 'Car';
      return '<a class="mp-car" href="track.html?car=' + esc(c.id) + '"><b>' + esc(c.name || carLine(c) || 'Car') + '</b>' +
        (carLine(c) && c.name ? '<span>' + esc(carLine(c)) + '</span>' : '') + '</a>';
    }).join('');
    var rows = d.sessions.map(function (s) {
      var meta = [niceDate(s.date), s.time, carName[s.carId], s.conditions].filter(Boolean).join(' · ');
      return '<a class="mp-row" href="track.html?s=' + esc(s.id) + '"><span class="mp-row-main"><b>' + esc(trackName(s)) + '</b><span>' + esc(meta) + '</span></span>' +
        '<span class="mp-res">' + esc(result(s)) + '</span></a>';
    }).join('');
    app.innerHTML =
      (cars ? '<h2 class="mp-h">Cars</h2><div class="mp-cars">' + cars + '</div>' : '') +
      '<h2 class="mp-h">Shared sessions</h2>' +
      (rows ? rows + '<p class="mp-note">' + d.sessions.length + ' shared session' + (d.sessions.length === 1 ? '' : 's') + ', newest first.</p>'
        : '<p class="mp-empty">No shared sessions yet.</p>');
  }

  var car = new URLSearchParams(location.search).get('car') || '';
  if (!car) { say('This member\'s page needs a car to open it. Press a name on a leaderboard.'); return; }
  fetch(API + '/profile/public?car=' + encodeURIComponent(car), { cache: 'no-store' })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); })
    .then(function (d) {
      if (d.status === 404) { say('That member\'s page could not be found.'); return; }
      if (!d.success) { say('This page could not be loaded. Check your connection and try again.'); return; }
      render(d);
    })
    .catch(function () { say('This page could not be loaded. Check your connection and try again.'); });
})();
