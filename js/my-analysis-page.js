/*
  My Analysis (my-analysis.html): the signed-in member's own Track sessions, read from their session list (GET /track/sessions)
  and garage names (GET /my-builds). It replaces the Analysis panel that used to sit on My Sessions. Every figure a session's
  summary carries is used: lap times, top speed, braking g, the Track Mode figures, air temperature, conditions, tyres, pads,
  driven wheels and logger. Each dot opens its session.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var app = document.getElementById('ma-app');
  if (!app) return;
  var V = window.MT3UKTrackView || {};
  var state = { sessions: [], cars: {}, car: 'all', track: 'all', metric: 'lap', setup: 'tyres' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtLap(s) { return V.fmtLap ? V.fmtLap(s) : s.toFixed(2); }
  function fmtSpeed(k) { return V.fmtV ? V.fmtV(k) : Math.round(k) + ' km/h'; }
  function niceDate(d) {
    var p = String(d || '').split('-');
    if (p.length !== 3) return d || '';
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(p[2]) + ' ' + M[Number(p[1]) - 1] + ' ' + p[0];
  }
  var psi = false;
  try { psi = localStorage.getItem('mt3ukPressure') === 'psi'; } catch (e) { psi = false; }
  function pressTxt(bar) { return psi ? Math.round(bar * 14.5038) + ' psi' : bar.toFixed(1) + ' bar'; }
  function pctTxt(v) { return v.toFixed(0) + '%'; }
  function num(v) { return v != null && isFinite(v) ? Number(v) : null; }
  function mode(s) { return s.mode || {}; }
  function timed(s) { return s.type !== 'drag' && num(s.bestTime) > 0; }
  // A session with no layout name is named for its kind, as the Sessions list names it: anything that is not a drag,
  // a sprint or a drive is a track day.
  var KIND_NAME = { track: 'Track day', sprint: 'Sprint', drag: 'Drag strip', other: 'Drives' };
  function trackOf(s) {
    var kind = s.type === 'drag' ? 'drag' : s.type === 'sprint' ? 'sprint' : s.type === 'other' ? 'other' : 'track';
    var layout = s.layout && s.layout !== s.venue ? s.layout : KIND_NAME[kind];
    return (s.venue || 'Track') + (layout ? ' · ' + layout : '');
  }
  function trackKey(s) { return (s.venue || '') + '|' + (s.layout || ''); }
  function used(s) { var m = mode(s); return m.soc ? m.soc[0] - m.soc[1] : null; }
  function avg(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), h = Math.floor(b.length / 2); return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; }
  function sortByWhen(list) { return list.slice().sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; }); }
  function kindOf(s) { return { track: 'Track day', sprint: 'Sprint', drag: 'Drag strip', other: 'Drive' }[s.type] || (s.type || ''); }

  // Every figure a session can plot. get() gives the value or null; quicker means a lower value is the darker dot.
  var METRICS = [
    { id: 'lap', label: 'Best lap', get: function (s) { return timed(s) ? s.bestTime : null; }, fmt: fmtLap, quicker: true },
    { id: 'speed', label: 'Top speed', get: function (s) { return num(s.vmax) > 0 ? s.vmax : null; }, fmt: fmtSpeed },
    { id: 'brakeg', label: 'Peak braking', get: function (s) { return num(s.brakeG); }, fmt: function (v) { return v.toFixed(2) + ' g'; } },
    { id: 'temp', label: 'Air temperature', get: function (s) { return num(s.temp); }, fmt: function (v) { return Math.round(v) + ' °C'; } },
    { id: 'used', label: 'Battery used', get: used, fmt: function (v) { return v.toFixed(1) + '%'; } },
    { id: 'power', label: 'Peak power', get: function (s) { return num(mode(s).power); }, fmt: function (v) { return Math.round(v) + ' kW'; } },
    { id: 'regen', label: 'Peak regen', get: function (s) { return num(mode(s).regen); }, fmt: function (v) { return Math.round(v) + ' kW'; } },
    { id: 'brakes', label: 'Hottest brakes', get: function (s) { return num(mode(s).brakeTemp); }, fmt: pctTxt },
    { id: 'battemp', label: 'Battery temperature', get: function (s) { return num(mode(s).batteryTemp); }, fmt: pctTxt },
    { id: 'inverter', label: 'Inverter temperature', get: function (s) { return num(mode(s).inverterTemp); }, fmt: pctTxt },
    { id: 'press', label: 'Tyre pressure', get: function (s) { return num(mode(s).tyrePressure); }, fmt: pressTxt },
    { id: 'brakep', label: 'Hardest braking pressure', get: function (s) { return num(mode(s).brakePressure); }, fmt: pressTxt },
    { id: 'throttle', label: 'Full throttle', get: function (s) { return num(mode(s).throttle); }, fmt: pctTxt },
    { id: 'slip', label: 'Slip', get: function (s) { return num(mode(s).slip); }, fmt: function (v) { return v.toFixed(1); } },
    { id: 'laps', label: 'Laps', get: function (s) { return s.type !== 'drag' && s.laps ? s.laps : null; }, fmt: function (v) { return String(v); } }
  ];
  // The setups a session can be compared by. get() gives the label, '' when not set.
  var SETUPS = [
    { id: 'tyres', label: 'Tyres', get: function (s) { return s.tyres || ''; } },
    { id: 'pads', label: 'Brake pads', get: function (s) { return s.pads || ''; } },
    { id: 'drive', label: 'Driven wheels', get: function (s) { return s.drive || ''; } },
    { id: 'conditions', label: 'Conditions', get: function (s) { return s.conditions || ''; } },
    { id: 'logger', label: 'Logger', get: function (s) { return s.logger || ''; } }
  ];

  // The orange scale of the Over time graph: faded for the lower end, strong orange for the top.
  var SHADE_LOW = [246, 196, 168], SHADE_HIGH = [232, 89, 12];
  function shadeAt(t) {
    t = Math.max(0, Math.min(1, t));
    return 'rgb(' + SHADE_LOW.map(function (v, i) { return Math.round(v + (SHADE_HIGH[i] - v) * t); }).join(',') + ')';
  }

  // The sessions the page is about: the car and track picked.
  // Drives are not analysed here, so they are left out of every figure, the chart and the table.
  function scoped() {
    return state.sessions.filter(function (s) {
      return s.type !== 'other' && (state.car === 'all' || s.carId === state.car) && (state.track === 'all' || trackKey(s) === state.track);
    });
  }
  function carName(id) { return state.cars[id] || 'Car'; }

  function tile(label, value) { return '<div class="tm-tile"><b>' + value + '</b><span>' + esc(label) + '</span></div>'; }
  function tiles(list) {
    var laps = list.filter(timed).map(function (s) { return s.bestTime; });
    var best = laps.length ? Math.min.apply(null, laps) : null;
    var speeds = list.map(function (s) { return num(s.vmax); }).filter(function (v) { return v > 0; });
    var brakes = list.map(function (s) { return num(s.brakeG); }).filter(function (v) { return v > 0; });
    var charged = list.map(used).filter(function (v) { return v != null; });
    var hot = list.map(function (s) { return num(mode(s).brakeTemp); }).filter(function (v) { return v != null; });
    return '<div class="ma-tiles">' +
      tile('Sessions', list.length) +
      tile('Best lap', best != null ? fmtLap(best) : '–') +
      tile('Average best lap', laps.length ? fmtLap(avg(laps)) : '–') +
      tile('Top speed', speeds.length ? fmtSpeed(Math.max.apply(null, speeds)) : '–') +
      tile('Peak braking', brakes.length ? Math.max.apply(null, brakes).toFixed(2) + ' g' : '–') +
      tile('Average charge used', charged.length ? pctTxt(avg(charged)) : '–') +
      tile('Hottest brakes', hot.length ? pctTxt(Math.max.apply(null, hot)) : '–') +
      '</div>';
  }

  // What the figures say, in plain words. Only what the sessions carry is mentioned.
  // The icon before each finding (the same line style as the rest of Laps).
  var FI = {
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 10v4M10 10v4"/>',
    brake: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    setup: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8"/>'
  };
  function findIcon(k) { return '<svg class="ma-fi" viewBox="0 0 24 24" aria-hidden="true">' + (FI[k] || FI.pulse) + '</svg>'; }
  function findings(list) {
    var out = [], tl = list.filter(timed);
    if (tl.length) {
      var best = tl.reduce(function (a, s) { return s.bestTime < a.bestTime ? s : a; });
      out.push({ k: 'clock', t: 'Your best lap is ' + fmtLap(best.bestTime) + ', at ' + esc(trackOf(best)) + ' on ' + niceDate(best.date) + '.' });
    }
    if (tl.length >= 2) {
      var sorted = sortByWhen(tl), first = sorted[0].bestTime, last = sorted[sorted.length - 1].bestTime, diff = last - first;
      out.push({ k: 'trend', t: Math.abs(diff) < 0.005 ? 'Your latest lap is the same as your first.' : 'Your latest lap is ' + Math.abs(diff).toFixed(2) + ' s ' + (diff < 0 ? 'quicker' : 'slower') + ' than your first.' });
    }
    function most(fn, label, fmt, k) {
      var best = null;
      list.forEach(function (s) { var v = fn(s); if (v != null && (best === null || v > fn(best))) best = s; });
      if (best) out.push({ k: k, t: 'The ' + label + ' was ' + fmt(fn(best)) + ', at ' + esc(trackOf(best)) + ' on ' + niceDate(best.date) + '.' });
    }
    most(used, 'most charge used in one session', function (v) { return v.toFixed(1) + '%'; }, 'battery');
    most(function (s) { return num(mode(s).brakeTemp); }, 'hottest brakes, by the car’s own estimate', pctTxt, 'brake');
    most(function (s) { return num(mode(s).power); }, 'highest peak power', function (v) { return Math.round(v) + ' kW'; }, 'bolt');
    most(function (s) { return num(s.brakeG); }, 'hardest braking', function (v) { return v.toFixed(2) + ' g'; }, 'pulse');
    // The tyres and pads with the quickest typical lap, where there are two or more to compare.
    [SETUPS[0], SETUPS[1]].forEach(function (d) {
      var groups = setupGroups(d, tl);
      // Sessions with nothing set are left out of the comparison: 'Not set' is not a tyre or pad.
      var named = groups.filter(function (x) { return x.label !== 'Not set'; });
      if (named.length < 2) return;
      var g = named[0];
      out.push({ k: 'setup', t: 'On ' + d.label.toLowerCase() + ', ' + esc(g.label) + ' gave the quickest best lap, ' + fmtLap(g.best) + ', over ' + g.n + ' ' + (g.n === 1 ? 'session' : 'sessions') + '.' });
    });
    return out;
  }

  // Sessions grouped by one setup, quickest best first. Sessions with no value are their own group, "Not set".
  function setupGroups(d, list) {
    var by = {};
    list.forEach(function (s) {
      var k = d.get(s) || 'Not set';
      (by[k] = by[k] || []).push(s);
    });
    return Object.keys(by).map(function (k) {
      var rows = by[k], laps = rows.map(function (s) { return s.bestTime; });
      return { label: k, n: rows.length, best: Math.min.apply(null, laps), typical: median(laps) };
    }).sort(function (a, b) { return a.best - b.best; });
  }

  // One line graph for the figure picked: each session in the order it was driven, a dot that opens it.
  function chart(list) {
    var avail = METRICS.filter(function (m) { return list.some(function (s) { return m.get(s) != null; }); });
    if (!avail.length) return '<p class="tm-empty">No figures to plot yet.</p>';
    var m = avail.filter(function (x) { return x.id === state.metric; })[0] || avail[0];
    var chips = '<div class="tm-chips" role="group" aria-label="Figure to plot">' + avail.map(function (x) {
      return '<button type="button" class="chip' + (x.id === m.id ? ' is-on' : '') + '" data-metric="' + x.id + '" aria-pressed="' + (x.id === m.id) + '">' + esc(x.label) + '</button>';
    }).join('') + '</div>';
    var head = '<h2>Over time</h2><p class="tm-note">Each dot is a session, in the order it was driven. Press a dot to open that session. Pick a figure to plot.</p>';
    var pts = sortByWhen(list).map(function (s) { return { s: s, v: m.get(s) }; }).filter(function (x) { return x.v != null; });
    if (pts.length < 2) return '<div class="tm-card tm-chart">' + head + chips + '<p class="tm-note">Not enough sessions with this figure yet.</p></div>';
    var W = Math.round(Math.min(900, Math.max(320, (app.clientWidth || 800) - 48))), H = 262, L = 58, R = 12, T = 14, B = 54;
    var vs = pts.map(function (x) { return x.v; });
    var y0 = Math.min.apply(null, vs), y1 = Math.max.apply(null, vs);
    if (y1 - y0 < 0.5) { y0 -= 0.5; y1 += 0.5; }
    var span = (y1 - y0) || 1;
    function X(i) { return L + i / (pts.length - 1) * (W - L - R); }
    function Y(v) { return T + (y1 - v) / span * (H - T - B); }
    var dots = pts.map(function (x, i) {
      var t = (x.v - y0) / span;
      var cx = X(i).toFixed(1), cy = Y(x.v).toFixed(1), id = esc(x.s.id), on = state.picked === x.s.id;
      return '<circle class="ma-hit" data-session="' + id + '" cx="' + cx + '" cy="' + cy + '" r="14" fill="transparent"/>' +
        '<circle class="ma-dot' + (on ? ' is-picked' : '') + '" data-session="' + id + '" tabindex="0" role="button" cx="' + cx + '" cy="' + cy + '" r="5" stroke="#16233d" stroke-opacity=".5" stroke-width="1" fill="' + shadeAt(m.quicker ? 1 - t : t) + '"><title>' +
        esc(niceDate(x.s.date) + ', ' + trackOf(x.s) + ': ' + m.fmt(x.v) + '. Press to see the session') + '</title></circle>';
    }).join('');
    var grid = '';
    for (var g = 0; g <= 5; g++) {
      var gy = T + g / 5 * (H - T - B), gx = L + g / 5 * (W - L - R);
      grid += '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '" stroke="#eef1f6"/>' +
        '<line x1="' + gx.toFixed(1) + '" y1="' + T + '" x2="' + gx.toFixed(1) + '" y2="' + (H - B) + '" stroke="#eef1f6"/>';
    }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(m.label) + ' for each session, in date order">' + grid +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<text x="' + (L - 6) + '" y="' + (T + 10) + '" text-anchor="end">' + esc(m.fmt(y1)) + '</text>' +
      '<text x="' + (L - 6) + '" y="' + (H - B) + '" text-anchor="end">' + esc(m.fmt(y0)) + '</text>' +
      '<text x="' + L + '" y="' + (H - 30) + '">' + esc(niceDate(pts[0].s.date)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 30) + '" text-anchor="end">' + esc(niceDate(pts[pts.length - 1].s.date)) + '</text>' +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle" style="font-weight:600">Session, in date order</text>' +
      dots + '</svg>';
    var legend = '<p class="tm-legend"><span>' + esc(m.quicker ? 'Quicker' : 'Higher') + '</span><span class="tm-grad" style="background:linear-gradient(to right,' + shadeAt(0) + ',' + shadeAt(1) + ')"></span><span>' + esc(m.quicker ? 'Slower' : 'Higher still') + '</span></p>';
    return '<div class="tm-card tm-chart">' + head + chips + svg + legend + '</div>';
  }

  function setupBlock(list) {
    var dims = SETUPS.map(function (d) { return { d: d, groups: setupGroups(d, list.filter(timed)) }; })
      .filter(function (x) { return x.groups.length >= 2; });
    if (!dims.length) return '<div class="tm-card"><h2>Setups compared</h2><p class="tm-note">Two or more tyres, pads, driven wheels, conditions or loggers with timed sessions are needed to compare them.</p></div>';
    var cur = dims.filter(function (x) { return x.d.id === state.setup; })[0] || dims[0];
    var chips = '<div class="tm-chips" role="group" aria-label="Setup to compare">' + dims.map(function (x) {
      return '<button type="button" class="chip' + (x.d.id === cur.d.id ? ' is-on' : '') + '" data-setup="' + x.d.id + '" aria-pressed="' + (x.d.id === cur.d.id) + '">' + esc(x.d.label) + '</button>';
    }).join('') + '</div>';
    var quick = cur.groups[0].best;
    var rows = cur.groups.map(function (g) {
      var gap = g.best - quick;
      return '<div class="tm-row"><div><b>' + esc(g.label) + '</b></div><div class="tm-num"><span class="tm-lab">Sessions </span>' + g.n + '</div>' +
        '<div class="tm-num"><span class="tm-lab">Best </span>' + fmtLap(g.best) + '</div><div class="tm-num"><span class="tm-lab">Typical </span>' + fmtLap(g.typical) + '</div>' +
        '<div class="tm-num"><span class="tm-lab">Gap to quickest </span>' + (gap < 0.005 ? 'Quickest' : '+' + gap.toFixed(2) + ' s') + '</div></div>';
    }).join('');
    return '<div class="tm-card"><h2>Setups compared</h2><p class="tm-note">Timed sessions grouped by ' + esc(cur.d.label.toLowerCase()) + ', quickest first. The typical lap is the middle one of the group.</p>' + chips +
      '<div class="tm-list ma-setup"><div class="tm-row tm-head"><div>' + esc(cur.d.label) + '</div><div>Sessions</div><div>Best</div><div>Typical</div><div>Gap to quickest</div></div>' + rows + '</div></div>';
  }

  // Every session, newest first, with every figure its summary carries.
  // The session picked on the graph or in the table: its figures here, and a button to open it.
  function pickHtml(list) {
    var s = list.filter(function (x) { return x.id === state.picked; })[0];
    if (!s) return '<div class="tm-card ma-pick" id="ma-pick"><p class="tm-note">Press a dot on the graph, or a row in the table, to see that session here.</p></div>';
    var m = mode(s), u = used(s), facts = [
      ['Date', niceDate(s.date) + (s.time ? ' at ' + esc(s.time) : '')], ['Track', esc(trackOf(s))], ['Type', esc(kindOf(s))], ['Car', esc(carName(s.carId))],
      ['Conditions', esc(s.conditions || '')], ['Air temperature', num(s.temp) != null ? Math.round(s.temp) + ' °C' : ''], ['Logger', esc(s.logger || '')],
      ['Laps', s.type === 'drag' ? (s.runs ? s.runs + ' runs' : '') : (s.laps ? String(s.laps) : '')],
      ['Best lap', timed(s) ? fmtLap(s.bestTime) : ''], ['Top speed', num(s.vmax) > 0 ? fmtSpeed(s.vmax) : ''],
      ['Peak braking', num(s.brakeG) > 0 ? s.brakeG.toFixed(2) + ' g' : ''], ['Hottest brakes', num(m.brakeTemp) != null ? pctTxt(m.brakeTemp) : ''],
      ['Charge used', u != null ? u.toFixed(1) + '%' : ''], ['Peak power', num(m.power) != null ? Math.round(m.power) + ' kW' : ''],
      ['Peak regen', num(m.regen) != null ? Math.round(m.regen) + ' kW' : ''], ['Tyres', esc(s.tyres || '')], ['Brake pads', esc(s.pads || '')], ['Driven wheels', esc(s.drive || '')]
    ].filter(function (f) { return f[1] !== ''; });
    return '<div class="tm-card ma-pick" id="ma-pick"><h2>' + esc(niceDate(s.date)) + ', ' + esc(trackOf(s)) + '</h2>' +
      '<dl class="ma-facts">' + facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + f[1] + '</dd></div>'; }).join('') + '</dl>' +
      '<a class="tm-pill tm-pill-accent ma-open" href="track.html?s=' + esc(s.id) + '">Open this session</a></div>';
  }
  function detailsTable(list) {
    var rows = list.slice().sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; });
    if (!rows.length) return '';
    var head = ['Date', 'Track', 'Type', 'Car', 'Conditions', 'Air temp', 'Logger', 'Laps', 'Best lap', 'Top speed', 'Peak braking', 'Hottest brakes', 'Charge used', 'Peak power', 'Tyres', 'Brake pads', 'Driven wheels', ''];
    var body = rows.map(function (s) {
      var m = mode(s), u = used(s);
      var cells = [
        niceDate(s.date), esc(trackOf(s)), esc(kindOf(s)), esc(carName(s.carId)), esc(s.conditions || ''),
        num(s.temp) != null ? Math.round(s.temp) + ' °C' : '',
        esc(s.logger || ''),
        s.type === 'drag' ? (s.runs || '') : (s.laps || ''),
        timed(s) ? fmtLap(s.bestTime) : (s.type === 'drag' && s.quarter ? s.quarter.toFixed(2) + ' s quarter mile' : ''),
        num(s.vmax) > 0 ? fmtSpeed(s.vmax) : '',
        num(s.brakeG) > 0 ? s.brakeG.toFixed(2) + ' g' : '',
        num(m.brakeTemp) != null ? pctTxt(m.brakeTemp) : '',
        u != null ? u.toFixed(1) + '%' : '',
        num(m.power) != null ? Math.round(m.power) + ' kW' : '',
        esc(s.tyres || ''), esc(s.pads || ''), esc(s.drive || '')
      ];
      return '<tr class="ma-row' + (state.picked === s.id ? ' is-picked' : '') + '" data-session="' + esc(s.id) + '" tabindex="0">' + cells.map(function (c) { return '<td>' + (c === '' ? '–' : c) + '</td>'; }).join('') +
        '<td><a href="track.html?s=' + esc(s.id) + '">Open</a></td></tr>';
    }).join('');
    return '<div class="tm-card"><h2>Every session</h2><p class="tm-note">Each session of the car and track picked, with every figure it carries. Dashes are figures that session does not have. Press a row, or a dot on the graph, to see that session above. Open goes to the session itself.</p>' +
      '<div class="ma-scroll"><table class="ma-table"><thead><tr>' + head.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function draw() {
    var list = scoped();
    var cars = state.sessions.map(function (s) { return s.carId; }).filter(function (id, i, all) { return id && all.indexOf(id) === i; });
    var carPick = cars.length > 1 ? '<label class="tm-pick"><span>Car</span><select id="ma-car" class="field"><option value="all"' + (state.car === 'all' ? ' selected' : '') + '>All cars</option>' +
      cars.map(function (id) { return '<option value="' + esc(id) + '"' + (state.car === id ? ' selected' : '') + '>' + esc(carName(id)) + '</option>'; }).join('') + '</select></label>' : '';
    var byKey = {};
    // Only timed sessions are offered (a drive has no time, so it is left out of the drop-down).
    state.sessions.filter(function (s) { return (state.car === 'all' || s.carId === state.car) && s.type !== 'other' && (timed(s) || s.type === 'drag'); }).forEach(function (s) {
      byKey[trackKey(s)] = byKey[trackKey(s)] || trackOf(s);
    });
    var keys = Object.keys(byKey).sort(function (a, b) { return byKey[a] < byKey[b] ? -1 : 1; });
    if (state.track !== 'all' && keys.indexOf(state.track) === -1) state.track = 'all';
    var trackPick = keys.length > 1 ? '<label class="tm-pick"><span>Track and layout</span><select id="ma-track" class="field"><option value="all"' + (state.track === 'all' ? ' selected' : '') + '>All tracks</option>' +
      keys.map(function (k) { return '<option value="' + esc(k) + '"' + (state.track === k ? ' selected' : '') + '>' + esc(byKey[k]) + '</option>'; }).join('') + '</select></label>' : '';
    var body = '';
    if (!list.length) {
      body = '<div class="tm-card"><p>No sessions here yet. Once you have saved a track session with this car, its analysis appears here.</p></div>';
    } else {
      var says = findings(list);
      body = '<div class="tm-card"><h2>What the figures show</h2><ul class="tm-finds">' + says.map(function (f) { return '<li>' + findIcon(f.k) + '<span>' + f.t + '</span></li>'; }).join('') + '</ul></div>' +
        tiles(list) +
        chart(list) + pickHtml(list) + setupBlock(list) + detailsTable(list);
    }
    // The Track Mode badge beside the title shows when the sessions picked carry Track Mode figures.
    var tmBadge = document.getElementById('ma-tm');
    if (tmBadge) tmBadge.hidden = !list.some(function (x) { return !!x.mode; });
    app.innerHTML = '<div class="tm-controls ma-controls">' + carPick + trackPick + '</div>' + body;
  }

  // A dot or a table row selects its session: the panel above the table shows it, and the page moves to the panel.
  function selectSession(el, scroll) {
    state.picked = el.getAttribute('data-session');
    draw();
    var panel = document.getElementById('ma-pick');
    if (scroll && panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-session]') : null;
    if (!el || !app.contains(el) || (e.target.closest && e.target.closest('a'))) return;
    selectSession(el, el.tagName.toLowerCase() !== 'tr');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target && e.target.getAttribute ? e.target.getAttribute('data-session') : null;
    if (!el || !app.contains(e.target)) return;
    e.preventDefault();
    selectSession(e.target, true);
  });
  // The figure and setup chips, and the drop-downs, redraw the page in place.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-metric],[data-setup]') : null;
    if (!b || !app.contains(b)) return;
    if (b.getAttribute('data-metric')) state.metric = b.getAttribute('data-metric');
    if (b.getAttribute('data-setup')) state.setup = b.getAttribute('data-setup');
    draw();
  });
  document.addEventListener('change', function (e) {
    if (!e.target || !app.contains(e.target)) return;
    if (e.target.id === 'ma-car') { state.car = e.target.value; state.track = 'all'; draw(); }
    if (e.target.id === 'ma-track') { state.track = e.target.value; draw(); }
  });
  // Redraw the graph at a new width (a phone turned sideways).
  var lastW = app.clientWidth, timer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { if (app.clientWidth !== lastW && state.sessions.length) { lastW = app.clientWidth; draw(); } }, 200);
  });

  var token = '';
  try { token = localStorage.getItem('mt3ukMyBuildsSession') || ''; } catch (e) { token = ''; }
  var signIn = window.mt3ukSignInUrl ? window.mt3ukSignInUrl('my-analysis.html') : 'signin.html?next=' + encodeURIComponent('my-analysis.html');
  if (!token) {
    app.innerHTML = '<div class="tm-card"><p>Sign in to see your own analysis.</p><p><a class="tm-pill tm-pill-accent" href="' + esc(signIn) + '">Sign in</a></p></div>';
    return;
  }
  var H = { headers: { 'X-Session-Token': token }, cache: 'no-store' };
  Promise.all([
    fetch(API + '/track/sessions', H).then(function (r) { if (r.status === 401) throw { signIn: true }; if (r.status === 403) throw { early: true }; return r.json(); }),
    fetch(API + '/my-builds', H).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
  ]).then(function (res) {
    if (!res[0] || res[0].success === false) throw {};
    state.sessions = res[0].sessions || [];
    (res[1].cars || []).forEach(function (c) { state.cars[c.id] = c.name || 'Car'; });
    draw();
  }).catch(function (err) {
    if (err && err.signIn) { app.innerHTML = '<div class="tm-card"><p>Your sign-in has ended. Sign in again to see your analysis.</p><p><a class="tm-pill tm-pill-accent" href="' + esc(signIn) + '">Sign in</a></p></div>'; return; }
    if (err && err.early) { app.innerHTML = '<div class="tm-card"><p>My Analysis is part of Sessions, which is in early preview. <a href="track.html">Ask for access on Sessions</a>.</p></div>'; return; }
    app.innerHTML = '<div class="tm-card"><p>Your sessions could not be read just now. Try again in a moment.</p></div>';
  });
})();
