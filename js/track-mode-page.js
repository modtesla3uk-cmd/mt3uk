/*
  Tesla Track Mode, analysed (track-mode.html): the shared Track sessions that carry the car's own Track Mode figures, read from one
  public list on the worker (GET /track/mode-runs). It shows what the cars did across those sessions: charge used, peak power,
  regen, the hottest brakes (the car's own estimate, as a percentage) and battery temperature, with a few plain findings and a
  Owners' private sessions are not in the list.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var app = document.getElementById('tm-app');
  if (!app) return;
  var state = { runs: [], track: 'all', sort: 'newest', metric: 'used' };
  var SORTS = [['newest', 'Newest first'], ['best', 'Quickest lap first'], ['charge', 'Most charge used'], ['power', 'Highest peak power'], ['brakes', 'Hottest brakes']];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lapTime(s) {
    if (!isFinite(s)) return '';
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
  }
  function niceDate(d) {
    var p = String(d || '').split('-');
    if (p.length !== 3) return d || '';
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(p[2]) + ' ' + M[Number(p[1]) - 1] + ' ' + p[0];
  }
  // Charge used, as a percentage of the battery (start less end). Negative when the car charged during the session.
  function used(r) { var s = r.mode && r.mode.soc; return s ? s[0] - s[1] : null; }
  function trackOf(r) { return (r.venue || 'Track') + (r.layout ? ' · ' + r.layout : ''); }
  function trackKey(r) { return (r.venue || '') + '|' + (r.layout || ''); }
  function pct(v, dp) { return v == null || !isFinite(v) ? '' : v.toFixed(dp || 0) + '%'; }
  function kW(v) { return v == null || !isFinite(v) ? '' : Math.round(v) + ' kW'; }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function mx(list, fn) { var best = null; list.forEach(function (r) { var v = fn(r); if (v != null && isFinite(v) && (best === null || v > fn(best))) best = r; }); return best; }

  function visible() {
    var list = state.track === 'all' ? state.runs.slice() : state.runs.filter(function (r) { return trackKey(r) === state.track; });
    var key = {
      best: function (r) { return r.bestTime == null ? Infinity : r.bestTime; },
      charge: function (r) { var u = used(r); return u == null ? -Infinity : -u; },
      power: function (r) { return r.mode && r.mode.power != null ? -r.mode.power : Infinity; },
      brakes: function (r) { return r.mode && r.mode.brakeTemp != null ? -r.mode.brakeTemp : Infinity; }
    }[state.sort];
    if (key) list.sort(function (a, b) { var x = key(a), y = key(b); return x === y ? 0 : x < y ? -1 : 1; });
    return list;
  }

  // Plain findings from the runs on the page (the whole list, not the filtered one, so they describe the lot).
  function findings(runs) {
    var out = [];
    var charged = runs.filter(function (r) { return used(r) != null; });
    var c = mx(charged, used);
    if (c) out.push('The most charge used in one session was ' + used(c).toFixed(1) + '%, at ' + esc(trackOf(c)) + ' on ' + niceDate(c.date) + '.');
    var b = mx(runs.filter(function (r) { return r.mode && r.mode.brakeTemp != null; }), function (r) { return r.mode.brakeTemp; });
    if (b) out.push('The hottest brakes, by the car’s own estimate, were ' + pct(b.mode.brakeTemp) + ', at ' + esc(trackOf(b)) + ' on ' + niceDate(b.date) + '.');
    var p = mx(runs.filter(function (r) { return r.mode && r.mode.power != null; }), function (r) { return r.mode.power; });
    if (p) out.push('The highest peak power was ' + kW(p.mode.power) + ', at ' + esc(trackOf(p)) + ' on ' + niceDate(p.date) + '.');
    // Quicker half against slower half, by the charge each used: only where there are enough runs to say anything.
    var timed = charged.filter(function (r) { return r.bestTime != null; }).sort(function (a, b) { return a.bestTime - b.bestTime; });
    if (timed.length >= 4) {
      var half = Math.floor(timed.length / 2);
      var fast = avg(timed.slice(0, half).map(used)), slow = avg(timed.slice(timed.length - half).map(used));
      out.push('The quicker half of the ' + timed.length + ' runs with a lap time used ' + fast.toFixed(1) + '% of the battery on average, the slower half ' + slow.toFixed(1) + '.');
    }
    return out;
  }

  // One line graph for the figure picked (chips, as the G-force chart on a session): the runs in the order they were driven,
  // a dot for each, lap time in its tooltip. A run without the figure leaves a gap in the line.
  var METRICS = [
    ['used', 'Battery used', used, '%', 1],
    ['brakes', 'Hottest brakes', function (r) { return r.mode && r.mode.brakeTemp; }, '%', 0],
    ['power', 'Peak power', function (r) { return r.mode && r.mode.power; }, ' kW', 0],
    ['pressure', 'Tyre pressure', function (r) { return r.mode && r.mode.tyrePressure; }, ' bar', 1]
  ];
  function lineChart(runs) {
    var m = METRICS.filter(function (x) { return x[0] === state.metric; })[0] || METRICS[0];
    var chips = '<div class="tm-chips" role="group" aria-label="Figure to plot">' + METRICS.map(function (x) {
      return '<button type="button" class="chip' + (x[0] === m[0] ? ' is-on' : '') + '" data-metric="' + x[0] + '" aria-pressed="' + (x[0] === m[0]) + '">' + x[1] + '</button>';
    }).join('') + '</div>';
    var head = '<h2>Over time</h2><p class="tm-note">Each dot is a run, in the order it was driven. Pick a figure to plot.</p>';
    var pts = runs.map(function (r) { return { r: r, v: m[2](r) }; }).filter(function (x) { return x.v != null && isFinite(x.v); })
      .sort(function (a, b) { return (a.r.date + a.r.time) < (b.r.date + b.r.time) ? -1 : 1; });
    if (pts.length < 2) return '<div class="tm-card tm-chart">' + head + chips + '<p class="tm-note">Not enough runs with this figure yet.</p></div>';
    var W = 340, H = 240, L = 58, R = 12, T = 14, B = 36;
    var vs = pts.map(function (x) { return x.v; });
    var y0 = Math.min.apply(null, vs), y1 = Math.max.apply(null, vs);
    if (y1 - y0 < 0.5) { y0 -= 0.5; y1 += 0.5; }
    function X(i) { return L + i / (pts.length - 1) * (W - L - R); }
    function Y(v) { return T + (y1 - v) / (y1 - y0) * (H - T - B); }
    var line = pts.map(function (x, i) { return X(i).toFixed(1) + ',' + Y(x.v).toFixed(1); }).join(' ');
    var dots = pts.map(function (x, i) {
      return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(x.v).toFixed(1) + '" r="5" fill="#e8590c"><title>' + esc(trackOf(x.r) + ', ' + niceDate(x.r.date) + ': ' + lapTime(x.r.bestTime) + ', ' + m[1].toLowerCase() + ' ' + x.v.toFixed(m[4]) + m[3]) + '</title></circle>';
    }).join('');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(m[1]) + ' for each run, in the order they were driven">' +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<polyline points="' + line + '" fill="none" stroke="#e8590c" stroke-width="2" stroke-linejoin="round"/>' +
      '<text x="' + (L - 6) + '" y="' + (T + 10) + '" text-anchor="end">' + y1.toFixed(m[4]) + m[3] + '</text>' +
      '<text x="' + (L - 6) + '" y="' + (H - B) + '" text-anchor="end">' + y0.toFixed(m[4]) + m[3] + '</text>' +
      '<text x="' + L + '" y="' + (H - 10) + '">' + niceDate(pts[0].r.date) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 10) + '" text-anchor="end">' + niceDate(pts[pts.length - 1].r.date) + '</text>' +
      dots + '</svg>';
    return '<div class="tm-card tm-chart">' + head + chips + svg + '</div>';
  }

  function rowHtml(r) {
    var m = r.mode || {};
    var u = used(r);
    var cell = function (label, value) { return '<span class="tm-num"><span class="tm-lab tm-sub">' + label + '</span> ' + (value === '' ? '<span class="tm-sub">Not recorded</span>' : '<b>' + value + '</b>') + '</span>'; };
    return '<div class="tm-row">' +
      '<div><a class="tm-open" href="track.html?s=' + encodeURIComponent(r.id) + '">' + esc(niceDate(r.date)) + ' · ' + esc(trackOf(r)) + '</a><div class="tm-sub">' + esc(r.conditions || '') + (r.logger ? ' · ' + esc(r.logger) : '') + '</div></div>' +
      '<div>' + esc(r.car || 'MT3UK member build') + '<div class="tm-sub">' + esc(r.owner || 'MT3UK member') + '</div></div>' +
      cell('Best lap', r.bestTime == null ? '' : lapTime(r.bestTime)) +
      cell('Charge used', u == null ? '' : u.toFixed(1) + '%') +
      cell('Peak power', m.power == null ? '' : kW(m.power)) +
      cell('Regen', m.regen == null ? '' : kW(m.regen)) +
      cell('Hottest brakes', m.brakeTemp == null ? '' : pct(m.brakeTemp)) +
      cell('Battery max', m.batteryTemp == null ? '' : pct(m.batteryTemp)) +
      '</div>';
  }

  function draw() {
    var runs = state.runs;
    if (!runs.length) {
      app.innerHTML = '<div class="tm-card"><h2>No Track Mode sessions yet</h2><p>When a member shares a track session that has its Track Mode figures, it appears here with its analysis. A session kept only for the owner is not shown.</p></div>';
      return;
    }
    var cars = {};
    runs.forEach(function (r) { cars[r.carId] = true; });
    var charges = runs.map(used).filter(function (v) { return v != null; });
    var powers = runs.map(function (r) { return r.mode && r.mode.power; }).filter(function (v) { return v != null; });
    var brakes = runs.map(function (r) { return r.mode && r.mode.brakeTemp; }).filter(function (v) { return v != null; });
    var tracks = {};
    runs.forEach(function (r) { tracks[trackKey(r)] = trackOf(r); });
    var trackKeys = Object.keys(tracks).sort(function (a, b) { return tracks[a] < tracks[b] ? -1 : 1; });
    var list = visible();
    var tiles = '<div class="tm-tiles">' +
      '<div class="tm-tile"><b>' + runs.length + '</b><span>Shared sessions</span></div>' +
      '<div class="tm-tile"><b>' + Object.keys(cars).length + '</b><span>Cars</span></div>' +
      '<div class="tm-tile"><b>' + (charges.length ? avg(charges).toFixed(1) + '%' : '') + '</b><span>Average charge used</span></div>' +
      '<div class="tm-tile"><b>' + (powers.length ? kW(Math.max.apply(null, powers)) : '') + '</b><span>Highest peak power</span></div>' +
      '<div class="tm-tile"><b>' + (brakes.length ? pct(Math.max.apply(null, brakes)) : '') + '</b><span>Hottest brakes (car’s estimate)</span></div>' +
      '</div>';
    var fx = findings(runs);
    var analysis = '<div class="tm-card"><h2>What the runs show</h2>' + (fx.length ? '<ul>' + fx.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' : '<p>Not enough runs yet to compare.</p>') + '</div>';
    var controls = '<div class="tm-controls">' +
      '<label>Track<select id="tm-track"><option value="all">All tracks</option>' + trackKeys.map(function (k) { return '<option value="' + esc(k) + '"' + (state.track === k ? ' selected' : '') + '>' + esc(tracks[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Sort by<select id="tm-sort">' + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (state.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label>' +
      '</div>';
    var head = '<div class="tm-row tm-head"><div>Session</div><div>Car</div><div class="tm-num">Best lap</div><div class="tm-num">Charge used</div><div class="tm-num">Peak power</div><div class="tm-num">Regen</div><div class="tm-num">Hottest brakes</div><div class="tm-num">Battery max</div></div>';
    var rows = list.length ? list.map(rowHtml).join('') : '<div class="tm-empty">No runs on this track yet.</div>';
    app.innerHTML = tiles + analysis + lineChart(runs) + controls + '<div class="tm-list">' + head + rows + '</div>' +
      '<p class="tm-note">Charge used is the battery at the start less the end, as a percentage of the battery. Brake temperature is the car’s own estimate, not a reading. Battery is the highest battery temperature the car reported.</p>';
    Array.prototype.forEach.call(app.querySelectorAll('[data-metric]'), function (b) { b.addEventListener('click', function () { state.metric = b.getAttribute('data-metric'); draw(); }); });
    var tSel = document.getElementById('tm-track'), sSel = document.getElementById('tm-sort');
    if (tSel) tSel.addEventListener('change', function () { state.track = tSel.value; draw(); });
    if (sSel) sSel.addEventListener('change', function () { state.sort = sSel.value; draw(); });
  }

  app.innerHTML = '<p class="tm-empty">Loading the Track Mode sessions…</p>';
  fetch(API + '/track/mode-runs').then(function (r) { return r.json(); }).then(function (j) {
    state.runs = (j && j.runs) || [];
    draw();
  }).catch(function () {
    app.innerHTML = '<div class="tm-card"><h2>Could not load the sessions</h2><p>Try again in a moment.</p></div>';
  });
})();
