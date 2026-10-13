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
  var state = { runs: [], track: 'all', member: 'all', sort: 'newest', metric: 'used', lapMetric: 'charge', picked: '', scrollTo: '' };
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

  // The runs of the member picked (all members when none is), before the track filter.
  function memberRuns() {
    return state.member === 'all' ? state.runs.slice() : state.runs.filter(function (r) { return (r.owner || 'MT3UK member') === state.member; });
  }
  // The runs the page is about: the member and the track picked. The tiles, findings, graph and list all follow them.
  function scopeRuns() {
    return state.track === 'all' ? memberRuns() : memberRuns().filter(function (r) { return trackKey(r) === state.track; });
  }
  function visible() {
    var list = scopeRuns();
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
    // The drawing is as wide as the card, so the dots keep their size from a phone to a desktop.
    var W = Math.round(Math.min(900, Math.max(340, app.clientWidth - 48))), H = 240, L = 58, R = 12, T = 14, B = 36;
    var vs = pts.map(function (x) { return x.v; });
    var y0 = Math.min.apply(null, vs), y1 = Math.max.apply(null, vs);
    if (y1 - y0 < 0.5) { y0 -= 0.5; y1 += 0.5; }
    function X(i) { return L + i / (pts.length - 1) * (W - L - R); }
    function Y(v) { return T + (y1 - v) / (y1 - y0) * (H - T - B); }
    var dots = pts.map(function (x, i) {
      return '<circle class="tm-dot' + (state.picked === x.r.id ? ' is-picked' : '') + '" data-run="' + esc(x.r.id) + '" tabindex="0" role="button" cx="' + X(i).toFixed(1) + '" cy="' + Y(x.v).toFixed(1) + '" r="5" fill="#e8590c"><title>' + esc(trackOf(x.r) + ', ' + niceDate(x.r.date) + ': ' + lapTime(x.r.bestTime) + ', ' + m[1].toLowerCase() + ' ' + x.v.toFixed(m[4]) + m[3] + '. Press to see the session below.') + '</title></circle>';
    }).join('');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(m[1]) + ' for each run, in the order they were driven">' +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<text x="' + (L - 6) + '" y="' + (T + 10) + '" text-anchor="end">' + y1.toFixed(m[4]) + m[3] + '</text>' +
      '<text x="' + (L - 6) + '" y="' + (H - B) + '" text-anchor="end">' + y0.toFixed(m[4]) + m[3] + '</text>' +
      '<text x="' + L + '" y="' + (H - 10) + '">' + niceDate(pts[0].r.date) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 10) + '" text-anchor="end">' + niceDate(pts[pts.length - 1].r.date) + '</text>' +
      dots + '</svg>';
    return '<div class="tm-card tm-chart">' + head + chips + svg + '</div>';
  }

  function median(a) {
    var v = a.slice().sort(function (x, y) { return x - y; });
    if (!v.length) return null;
    var h = Math.floor(v.length / 2);
    return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  }
  // Each lap of each run that has the figure, with the run's place in the lot.
  function allLaps(runs) {
    var out = [];
    runs.forEach(function (r) { (r.mode && r.mode.laps || []).forEach(function (l) { out.push(l); }); });
    return out;
  }
  // The Lap analysis: one graph with a chip for each measure, a dot a lap (or a run for tyre warm-up) against its lap time,
  // and the sentence for that measure under it. Brakes against pads stay a table.
  var LAP_METRICS = [
    ['charge', 'Charge per lap', '%', 1, 'Battery used per lap (%)'],
    ['battery', 'Battery temperature', '%', 0, 'Highest battery temperature in the lap (%)'],
    ['throttle', 'Full throttle', '%', 0, 'Share of the lap at full throttle (%)'],
    ['tyres', 'Tyre warm-up', ' bar', 2, 'Tyre pressure rise, start to end (bar)']
  ];
  function lapPoints(runs, k) {
    var laps = allLaps(runs), pts = [];
    if (k === 'tyres') {
      runs.forEach(function (r) {
        if (r.mode && r.mode.tyreStart != null && r.mode.tyreEnd != null && r.bestTime != null) pts.push({ x: r.mode.tyreEnd - r.mode.tyreStart, y: r.bestTime, r: r, lap: null });
      });
      return pts;
    }
    runs.forEach(function (run) {
      (run.mode && run.mode.laps || []).forEach(function (l) {
        var x = k === 'charge' ? l.used : k === 'battery' ? l.bt : (l.th != null ? l.th * 100 : null);
        if (x != null && isFinite(x) && l.t != null) pts.push({ x: x, y: l.t, r: run });
      });
    });
    // Each session's fastest lap is marked, so it stands out from the other laps.
    var fastest = {};
    pts.forEach(function (p) { if (fastest[p.r.id] === undefined || p.y < fastest[p.r.id]) fastest[p.r.id] = p.y; });
    pts.forEach(function (p) { p.best = p.y === fastest[p.r.id]; });
    return pts;
  }
  function lapCaption(runs, k) {
    var laps = allLaps(runs);
    if (k === 'charge') {
      var used = laps.filter(function (l) { return l.used != null; });
      if (!used.length) return 'No charge per lap recorded yet.';
      var a = avg(used.map(function (l) { return l.used; }));
      return a > 0 ? 'About ' + a.toFixed(1) + '% of the battery per lap on average, so about ' + Math.floor(80 / a) + ' laps use 80% of it.' : 'On average the battery did not go down over ' + used.length + ' laps.';
    }
    if (k === 'battery') {
      var tb = laps.filter(function (l) { return l.bt != null && l.t != null; });
      if (tb.length < 4) return 'Not enough laps with a battery temperature yet.';
      var mBt = median(tb.map(function (l) { return l.bt; }));
      var hot = tb.filter(function (l) { return l.bt > mBt; }), cool = tb.filter(function (l) { return l.bt <= mBt; });
      if (!hot.length || !cool.length) return 'The battery stayed at about the same temperature.';
      var d = avg(hot.map(function (l) { return l.t; })) - avg(cool.map(function (l) { return l.t; }));
      return 'Laps with the hotter battery (above ' + mBt.toFixed(0) + '%) were ' + (d >= 0 ? d.toFixed(2) + ' s slower' : (-d).toFixed(2) + ' s quicker') + ' on average than the cooler laps.';
    }
    if (k === 'throttle') {
      var th = laps.filter(function (l) { return l.th != null && l.t != null; });
      if (th.length < 4) return 'Not enough laps with throttle figures yet.';
      var byT = th.slice().sort(function (x, y) { return x.t - y.t; }), h2 = Math.floor(byT.length / 2);
      return 'The quicker half of the laps spent ' + (avg(byT.slice(0, h2).map(function (l) { return l.th; })) * 100).toFixed(0) + '% of the lap at full throttle, the slower half ' + (avg(byT.slice(byT.length - h2).map(function (l) { return l.th; })) * 100).toFixed(0) + '%.';
    }
    var warm = runs.filter(function (r) { return r.mode && r.mode.tyreStart != null && r.mode.tyreEnd != null && r.bestTime != null; });
    if (warm.length < 4) return 'Not enough runs with tyre pressures yet.';
    var byBest = warm.slice().sort(function (x, y) { return x.bestTime - y.bestTime; }), h3 = Math.floor(byBest.length / 2);
    var rise = function (r) { return r.mode.tyreEnd - r.mode.tyreStart; };
    return 'The quicker half of the runs gained ' + avg(byBest.slice(0, h3).map(rise)).toFixed(2) + ' bar of tyre pressure from start to end, the slower half ' + avg(byBest.slice(byBest.length - h3).map(rise)).toFixed(2) + ' bar.';
  }
  // Dots against the lap time: the quicker laps sit higher.
  function dotGraph(pts, unit, dp, xTitle) {
    var W = Math.round(Math.min(900, Math.max(340, app.clientWidth - 48))), H = 262, L = 58, R = 12, T = 14, B = 54;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x1 - x0 < 0.5) { x0 -= 0.5; x1 += 0.5; }
    if (y1 - y0 < 0.5) { y0 -= 0.5; y1 += 0.5; }
    function X(v) { return L + (v - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (v - y0) / (y1 - y0) * (H - T - B); }
    var dots = pts.map(function (p) {
      return '<circle class="tm-dot' + (state.picked === p.r.id ? ' is-picked' : '') + '" data-run="' + esc(p.r.id) + '" tabindex="0" role="button" cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (p.best ? 6 : 4.5) + '" fill="' + (p.best ? '#2f9e44' : '#e8590c') + '" stroke="#16233d" stroke-width="0.8"><title>' + esc(trackOf(p.r) + ', ' + niceDate(p.r.date) + ': ' + lapTime(p.y) + ', ' + p.x.toFixed(dp) + unit + '. Press to see the session below.') + '</title></circle>';
    }).join('');
    // Faint grid lines at six even steps on each axis, so a dot can be read against them.
    var grid = '';
    for (var g = 0; g <= 5; g++) {
      var gy = T + g / 5 * (H - T - B), gx = L + g / 5 * (W - L - R);
      grid += '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '" stroke="#eef1f6"/>' +
        '<line x1="' + gx.toFixed(1) + '" y1="' + T + '" x2="' + gx.toFixed(1) + '" y2="' + (H - B) + '" stroke="#eef1f6"/>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Lap time against the figure, one dot for each">' + grid +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<text x="' + (L - 6) + '" y="' + (T + 10) + '" text-anchor="end">' + lapTime(y0) + '</text>' +
      '<text x="' + (L - 6) + '" y="' + (H - B) + '" text-anchor="end">' + lapTime(y1) + '</text>' +
      '<text x="' + L + '" y="' + (H - 30) + '">' + x0.toFixed(dp) + unit + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 30) + '" text-anchor="end">' + x1.toFixed(dp) + unit + '</text>' +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle" style="font-weight:600">' + esc(xTitle) + '</text>' +
      dots + '</svg>';
  }
  function lapAnalysis(runs) {
    var pads = {};
    var chips = '<div class="tm-chips" role="group" aria-label="Lap measure to plot">' + LAP_METRICS.map(function (m) {
      return '<button type="button" class="chip' + (state.lapMetric === m[0] ? ' is-on' : '') + '" data-lapmetric="' + m[0] + '" aria-pressed="' + (state.lapMetric === m[0]) + '">' + m[1] + '</button>';
    }).join('') + '</div>';
    var m = LAP_METRICS.filter(function (x) { return x[0] === state.lapMetric; })[0] || LAP_METRICS[0];
    var pts = lapPoints(runs, m[0]);
    var graph = pts.length >= 2 ? dotGraph(pts, m[2], m[3], m[4]) : '<p class="tm-note">Not enough laps or runs with this figure yet.</p>';
    runs.forEach(function (r) {
      if (!r.pads || !r.mode) return;
      var k = r.pads;
      pads[k] = pads[k] || { n: 0, br: [], bp: [], best: null };
      pads[k].n++;
      if (r.mode.brakeTemp != null) pads[k].br.push(r.mode.brakeTemp);
      if (r.mode.brakePressure != null) pads[k].bp.push(r.mode.brakePressure);
      if (r.bestTime != null && (pads[k].best === null || r.bestTime < pads[k].best)) pads[k].best = r.bestTime;
    });
    var padKeys = Object.keys(pads);
    var padHtml = padKeys.length ? '<h3 class="tm-sub-h">Brakes against pads</h3><div class="tm-list tm-pads">' + padKeys.map(function (k) {
      var p = pads[k];
      return '<div class="tm-row"><div><b>' + esc(k) + '</b><div class="tm-sub">' + p.n + ' run' + (p.n === 1 ? '' : 's') + '</div></div>' +
        '<div class="tm-num"><span class="tm-lab tm-sub">Hottest brakes</span> ' + (p.br.length ? '<b>' + avg(p.br).toFixed(0) + '%</b>' : '<span class="tm-sub">Not recorded</span>') + '</div>' +
        '<div class="tm-num"><span class="tm-lab tm-sub">Brake pressure</span> ' + (p.bp.length ? '<b>' + avg(p.bp).toFixed(1) + '</b>' : '<span class="tm-sub">Not recorded</span>') + '</div>' +
        '<div class="tm-num"><span class="tm-lab tm-sub">Best lap</span> <b>' + lapTime(p.best) + '</b></div></div>';
    }).join('') + '</div>' : '';
    var legend = m[0] === 'tyres' ? '' : '<p class="tm-legend"><span class="tm-leg"><span class="tm-key tm-key-best" aria-hidden="true"></span><b>Green</b> = each session\u2019s fastest lap</span> <span class="tm-leg"><span class="tm-key tm-key-lap" aria-hidden="true"></span><b>Orange</b> = its other laps</span></p>';
    return '<div class="tm-card tm-lapgraph"><h2>Lap analysis</h2><p class="tm-note">Each dot is a lap, or a run for tyre warm-up, against its lap time. Quicker laps sit higher. Pick a measure.</p>' + chips + graph + legend +
      '<p class="tm-note">' + esc(lapCaption(runs, m[0])) + '</p>' + padHtml + '</div>';
  }

  function rowHtml(r) {
    var m = r.mode || {};
    var picked = state.picked === r.id;
    var u = used(r);
    var cell = function (label, value) { return '<span class="tm-num"><span class="tm-lab tm-sub">' + label + '</span> ' + (value === '' ? '<span class="tm-sub">Not recorded</span>' : '<b>' + value + '</b>') + '</span>'; };
    return '<div class="tm-row' + (picked ? ' is-picked' : '') + '" id="tm-row-' + esc(r.id) + '" data-run="' + esc(r.id) + '">' +
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
    drawnWidth = app.clientWidth;
    var runs = scopeRuns();
    if (!runs.length) {
      app.innerHTML = '<div class="tm-card"><h2>No Track Mode sessions yet</h2><p>When a member shares a track session that has its Track Mode figures, it appears here with its analysis. A session kept only for the owner is not shown.</p></div>';
      return;
    }
    var cars = {};
    runs.forEach(function (r) { cars[r.carId] = true; });
    var charges = runs.map(used).filter(function (v) { return v != null; });
    var powers = runs.map(function (r) { return r.mode && r.mode.power; }).filter(function (v) { return v != null; });
    var brakes = runs.map(function (r) { return r.mode && r.mode.brakeTemp; }).filter(function (v) { return v != null; });
    var memberSet = {};
    state.runs.forEach(function (r) { memberSet[r.owner || 'MT3UK member'] = true; });
    var members = Object.keys(memberSet).sort();
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
      '<label>Member<select id="tm-member"><option value="all">All members</option>' + members.map(function (m) { return '<option value="' + esc(m) + '"' + (state.member === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></label>' +
      '<label>Track<select id="tm-track"><option value="all">All tracks</option>' + trackKeys.map(function (k) { return '<option value="' + esc(k) + '"' + (state.track === k ? ' selected' : '') + '>' + esc(tracks[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Sort by<select id="tm-sort">' + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (state.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label>' +
      '</div>';
    var head = '<div class="tm-row tm-head"><div>Session</div><div>Car</div><div class="tm-num">Best lap</div><div class="tm-num">Charge used</div><div class="tm-num">Peak power</div><div class="tm-num">Regen</div><div class="tm-num">Hottest brakes</div><div class="tm-num">Battery max</div></div>';
    var rows = list.length ? list.map(rowHtml).join('') : '<div class="tm-empty">No runs on this track yet.</div>';
    app.innerHTML = controls + tiles + analysis + lineChart(runs) + lapAnalysis(runs) + '<div class="tm-list">' + head + rows + '</div>' +
      '<p class="tm-note">Charge used is the battery at the start less the end, as a percentage of the battery. Brake temperature is the car’s own estimate, not a reading. Battery is the highest battery temperature the car reported.</p>';
    Array.prototype.forEach.call(app.querySelectorAll('[data-metric]'), function (b) { b.addEventListener('click', function () { state.metric = b.getAttribute('data-metric'); draw(); }); });
    Array.prototype.forEach.call(app.querySelectorAll('[data-lapmetric]'), function (b) { b.addEventListener('click', function () { state.lapMetric = b.getAttribute('data-lapmetric'); draw(); }); });
    // A dot on the graph picks its session: the list shows it (all tracks, if a track filter hides it) and it is highlighted.
    function pick(id) {
      state.picked = id;
      state.scrollTo = id;
      if (!visible().some(function (r) { return r.id === id; })) { state.track = 'all'; state.member = 'all'; }
      draw();
    }
    Array.prototype.forEach.call(app.querySelectorAll('circle[data-run]'), function (c) {
      c.addEventListener('click', function () { pick(c.getAttribute('data-run')); });
      c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(c.getAttribute('data-run')); } });
    });
    if (state.scrollTo) {
      var row = document.getElementById('tm-row-' + state.scrollTo);
      state.scrollTo = '';
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    var mSel = document.getElementById('tm-member'), tSel = document.getElementById('tm-track'), sSel = document.getElementById('tm-sort');
    if (mSel) mSel.addEventListener('change', function () { state.member = mSel.value; state.track = 'all'; draw(); });
    if (tSel) tSel.addEventListener('change', function () { state.track = tSel.value; draw(); });
    if (sSel) sSel.addEventListener('change', function () { state.sort = sSel.value; draw(); });
  }

  // The page opens on the signed-in member's own sessions when they have any here, and on all members otherwise (a visitor,
  // or a member with no Track Mode sessions). Their cars are read from their garage with their sign-in.
  // The graphs are drawn as wide as the screen, so they are drawn again when the width changes (a rotation, or a window resized).
  var drawnWidth = 0, resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (Math.abs(app.clientWidth - drawnWidth) > 40 && state.runs.length) draw();
    }, 200);
  });
  app.innerHTML = '<p class="tm-empty">Loading the Track Mode sessions…</p>';
  var token = '';
  try { token = localStorage.getItem('mt3ukMyBuildsSession') || ''; } catch (e) { token = ''; }
  var runsReq = fetch(API + '/track/mode-runs').then(function (r) { return r.json(); });
  var carsReq = token ? fetch(API + '/my-builds', { headers: { 'X-Session-Token': token }, cache: 'no-store' })
    .then(function (r) { return r.json(); }).catch(function () { return null; }) : Promise.resolve(null);
  Promise.all([runsReq, carsReq]).then(function (res) {
    state.runs = (res[0] && res[0].runs) || [];
    var mine = res[1] && res[1].success && Array.isArray(res[1].cars) ? res[1].cars.map(function (c) { return c.id; }) : [];
    var own = state.runs.filter(function (r) { return mine.indexOf(r.carId) !== -1; })[0];
    if (own) state.member = own.owner || 'MT3UK member';
    draw();
  }).catch(function () {
    app.innerHTML = '<div class="tm-card"><h2>Could not load the sessions</h2><p>Try again in a moment.</p></div>';
  });
})();
