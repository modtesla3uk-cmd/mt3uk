/*
  My Analysis (my-analysis.html): the signed-in member's own Track sessions, read from their session list (GET /track/sessions)
  and garage names (GET /my-builds). It replaces the Analysis panel that used to sit on My Sessions. Every figure a session's
  summary carries is used: lap times, top speed, braking g, the Track Mode figures, air temperature, conditions, tyres, pads,
  driven wheels and logger. Each dot opens its day, with that day's sessions under the graph.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var app = document.getElementById('ma-app');
  if (!app) return;
  // The desktop Track Mode badge is kept here, because the app is drawn again each time and the badge moves into it.
  var tmDesk = document.getElementById('ma-tm');
  var V = window.MT3UKTrackView || {};
  var state = { sessions: [], cars: {}, car: 'all', track: 'all', metric: 'lap', setup: 'tyres', day: null, gridGroup: 'All figures' };
  var TRACK_KEY = 'mt3ukAnalysisTrack';
  // The track picked stays picked on this device, so the page opens on it next time (a track that is no longer there falls back to all tracks).
  function rememberTrack() { try { localStorage.setItem(TRACK_KEY, state.track); } catch (e) { /* storage blocked */ } }
  var scrollAfterDraw = false;

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
  // What each figure is, and how it relates to performance, shown under the chips when the figure is picked.
  var METRIC_NOTE = {
    lap: 'Your quickest timed lap in the session. Lower is faster, and this is the figure the leaderboards rank by.',
    speed: 'The highest speed the car reached. Higher usually means more pull on the straights, but a track with short straights may never show the car’s real top speed.',
    brakeg: 'The hardest the car slowed, in g. Higher means you braked harder, which can shorten a braking zone if the tyres and brakes can cope.',
    temp: 'The air temperature when the session was driven. It is context rather than a score: cooler air is denser and can mean more grip, so compare like with like.',
    used: 'How much of the battery one session used, from start to end. Using less for the same lap means more efficient driving.',
    power: 'The most power the motor produced, in kW. More power gives more pull out of corners and onto the straights, but the car can hold power back once parts get hot.',
    regen: 'The most power the car put back into the battery while slowing, in kW. It shows how much braking energy was recovered, and it does not make the car quicker.',
    brakes: 'The hottest brakes reached, as a percentage, using the car’s own estimate. Under 70% is normal. Brakes that get too hot lose bite, so a lower figure is safer over a long session.',
    battemp: 'The hottest battery reached, as a percentage. Cooler helps the car keep its full power, and above 85% the car may hold power back.',
    inverter: 'The hottest inverter reached, as a percentage. Like the battery, a hot inverter can make the car hold back power.',
    press: 'The average tyre pressure at the start and at the end, as the car reports it. Pressure rises as the tyres warm up. Keeping it within the range the tyre maker gives helps grip, and a large rise can mean the tyres are running hot.',
    brakep: 'The highest brake pressure the car reports, in bar or psi. It shows how hard the pedal was pressed, not how hard the car slowed; Peak braking shows that.',
    throttle: 'The share of the timed laps with the throttle at 95% or more. Higher means more of the lap is spent flat out.',
    slip: 'An estimate from the car of how much the tyres spun or slid. It is context rather than a score: a higher figure can mean more power in use or a slippery surface.',
    laps: 'How many laps were in the session. It is context rather than a score: more laps is not faster, but it shows how much running the session had.'
  };
  function metricNoteHtml(m) {
    return METRIC_NOTE[m.id] ? '<p class="ma-metric-note" id="ma-metric-note"><b>' + esc(m.label) + '.</b> ' + esc(METRIC_NOTE[m.id]) + '</p>' : '';
  }
  // The setups a session can be compared by. get() gives the label, '' when not set.
  var SETUPS = [
    { id: 'tyres', label: 'Tyres', get: function (s) { return s.tyres || ''; } },
    { id: 'pads', label: 'Brake pads', get: function (s) { return s.pads || ''; } },
    { id: 'drive', label: 'Which wheels drive it?', get: function (s) { return s.drive || ''; } },
    { id: 'conditions', label: 'Conditions', get: function (s) { return s.conditions || ''; } },
    { id: 'logger', label: 'Logger', get: function (s) { return s.logger || ''; } }
  ];

  // The sessions the page is about: the car and track picked.
  // Drives are not analysed here, so they are left out of every figure, the chart and the table.
  function scoped() {
    return state.sessions.filter(function (s) {
      return s.type !== 'other' && (state.car === 'all' || s.carId === state.car) && (state.track === 'all' || trackKey(s) === state.track);
    });
  }
  function carName(id) { return state.cars[id] || 'Car'; }


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

  // The key for the graph: only the colours this figure uses (the lap, speed and braking figures are against your best,
  // the heat figures by zone, the others are context), plus the dashed best so far where it applies.
  // The key for the figure: under the graph it explains. noBest leaves out the best-so-far line (the grid's small cards have none).
  function chartKeyHtml(m, noBest) {
    var kind = figureKind(m), items;
    if (kind === 'heat') items = [[HEAT.normal, 'Heat: normal'], [HEAT.yellow, 'Heat: yellow, from 70%'], [HEAT.orange, 'Heat: orange, from 85%'], [HEAT.red, 'Heat: red, 100% and over']];
    else if (kind === 'ctx') items = [[CONTEXT, 'Context: no good or bad']];
    else items = [[FAST, 'Fast: within 1% of your best here'], [MIDDLE, 'Middle'], [SLOW, 'Slow: 3% or more off your best']];
    var best = !noBest && (kind === 'low' || kind === 'high') ? '<span><i style="background:none;height:0;border-top:2px dashed #4a5568;border-radius:0"></i>Your best so far</span>' : '';
    return '<div class="ma-day-key ma-key">' + items.map(function (k) { return '<span><i style="background:' + k[0] + '"></i>' + esc(k[1]) + '</span>'; }).join('') + best + '</div>';
  }
  // One line graph for the figure picked: each session at its date, joined in date order, with the best so far for the
  // figures where lower or higher is better. A dot opens its day.
  function chart(list) {
    var avail = METRICS.filter(function (m) { return list.some(function (s) { return m.get(s) != null; }); });
    if (!avail.length) return '<p class="tm-empty">No figures to plot yet.</p>';
    var m = avail.filter(function (x) { return x.id === state.metric; })[0] || avail[0];
    var chips = '<div class="tm-chips" role="group" aria-label="Figure to plot">' + avail.map(function (x) {
      return '<button type="button" class="chip' + (x.id === m.id ? ' is-on' : '') + '" data-metric="' + x.id + '" aria-pressed="' + (x.id === m.id) + '">' + esc(x.label) + '</button>';
    }).join('') + '</div>';
    var head = '<h2>Over time</h2><p class="tm-note">Each dot is a session, placed on its date, and the line joins them in order. The dashed line is your best so far. Press a dot to see that day’s sessions below the graph. Pick a figure to plot.</p>';
    var pts = sortByWhen(list).map(function (s) { return { s: s, v: m.get(s) }; }).filter(function (x) { return x.v != null; });
    if (pts.length < 2) return '<div class="tm-card tm-chart">' + head + chips + metricNoteHtml(m) + '<p class="tm-note">Not enough sessions with this figure yet.</p></div>';
    var W = Math.round(Math.min(900, Math.max(320, (app.clientWidth || 800) - 48))), H = 278, L = 58, R = 12, T = 30, B = 54;
    var vs = pts.map(function (x) { return x.v; }), n = pts.length;
    var y0 = Math.min.apply(null, vs), y1 = Math.max.apply(null, vs);
    if (y1 - y0 < 0.5) { y0 -= 0.5; y1 += 0.5; }
    var span = (y1 - y0) || 1;
    // Time runs to scale across the page: a long gap between two sessions is a long gap on the graph. A set with no
    // usable dates, or all on one day, is spaced evenly instead.
    var days = pts.map(function (x) { return Date.parse(x.s.date + 'T00:00:00Z'); });
    var toScale = days.every(isFinite) && days[n - 1] > days[0];
    var d0 = days[0], dspan = days[n - 1] - d0;
    function X(i) { return toScale ? L + (days[i] - d0) / dspan * (W - L - R) : L + i / (n - 1) * (W - L - R); }
    // A lap time reads fastest at the top; the other figures keep the highest value at the top.
    var fastTop = figureKind(m) === 'low';
    function Y(v) { return fastTop ? T + (v - y0) / span * (H - T - B) : T + (y1 - v) / span * (H - T - B); }
    var path = pts.map(function (x, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(x.v).toFixed(1); }).join(' ');
    var lowerBetter = figureKind(m) === 'low', bestLine = '';
    if (figureKind(m) === 'low' || figureKind(m) === 'high') {
      var run = null, bp = pts.map(function (x, i) {
        run = run === null ? x.v : lowerBetter ? Math.min(run, x.v) : Math.max(run, x.v);
        return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(run).toFixed(1);
      }).join(' ');
      bestLine = '<path d="' + bp + '" fill="none" stroke="#4a5568" stroke-width="1.5" stroke-dasharray="5 4"/>';
    }
    var dots = pts.map(function (x, i) {
      var cx = X(i).toFixed(1), cy = Y(x.v).toFixed(1), id = esc(x.s.id), on = state.picked === x.s.id;
      return '<circle class="ma-hit" data-session="' + id + '" data-day="' + esc(dayKey(x.s)) + '" cx="' + cx + '" cy="' + cy + '" r="14" fill="transparent"/>' +
        '<circle class="ma-dot' + (on ? ' is-picked' : '') + '" data-session="' + id + '" tabindex="0" role="button" cx="' + cx + '" cy="' + cy + '" r="5" stroke="#16233d" stroke-opacity=".5" stroke-width="1" fill="' + figureColour(m, x.v, vs) + '" data-day="' + esc(dayKey(x.s)) + '"><title>' +
        esc(niceDate(x.s.date) + ', ' + trackOf(x.s) + ': ' + m.fmt(x.v) + '. Press to see that day') + '</title></circle>';
    }).join('');
    var grid = '';
    [0, 0.5, 1].forEach(function (f) {
      var gy = T + f * (H - T - B);
      grid += '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '" stroke="#eef1f6"/>';
    });
    // A faint line at the start of each month, so the spacing of the sessions reads against the calendar.
    if (toScale) {
      var first = new Date(d0), last = days[n - 1];
      for (var mo = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1); mo < last; mo = Date.UTC(new Date(mo).getUTCFullYear(), new Date(mo).getUTCMonth() + 1, 1)) {
        var mx = (L + (mo - d0) / dspan * (W - L - R)).toFixed(1);
        grid += '<line x1="' + mx + '" y1="' + T + '" x2="' + mx + '" y2="' + (H - B) + '" stroke="#f3f5f9"/>';
      }
    }
    var mid = (y0 + y1) / 2;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(m.label) + ' for each session, by date">' + grid +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<text x="' + L + '" y="14" style="font-weight:600">' + esc(m.label) + '</text>' +
      '<text x="' + (L - 6) + '" y="' + (T + 10) + '" text-anchor="end">' + esc(m.fmt(fastTop ? y0 : y1)) + '</text>' +
      '<text x="' + (L - 6) + '" y="' + (Y(mid) + 4).toFixed(1) + '" text-anchor="end">' + esc(m.fmt(mid)) + '</text>' +
      '<text x="' + (L - 6) + '" y="' + (H - B) + '" text-anchor="end">' + esc(m.fmt(fastTop ? y1 : y0)) + '</text>' +
      '<path d="' + path + '" fill="none" stroke="#b9c2d0" stroke-width="1.5"/>' + bestLine +
      '<text x="' + L + '" y="' + (H - 30) + '">' + esc(niceDate(pts[0].s.date)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 30) + '" text-anchor="end">' + esc(niceDate(pts[n - 1].s.date)) + '</text>' +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle" style="font-weight:600">' + (toScale ? 'Date' : 'Session, in date order') + '</text>' +
      dots + '</svg>';
    return '<div class="tm-card tm-chart">' + head + chips + metricNoteHtml(m) + svg + chartKeyHtml(m) + '</div>';
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
    if (!s) return '<div class="tm-card ma-pick" id="ma-pick"><p class="tm-note">Press a dot on the graph to see that day, or a row in the table to see that session here.</p></div>';
    var m = mode(s), u = used(s), facts = [
      ['Date', niceDate(s.date) + (s.time ? ' at ' + esc(s.time) : '')], ['Track', esc(trackOf(s))], ['Type', esc(kindOf(s))], ['Car', esc(carName(s.carId))],
      ['Conditions', esc(s.conditions || '')], ['Air temperature', num(s.temp) != null ? Math.round(s.temp) + ' °C' : ''], ['Logger', esc(s.logger || '')],
      ['Laps', s.type === 'drag' ? (s.runs ? s.runs + ' runs' : '') : (s.laps ? String(s.laps) : '')],
      ['Best lap', timed(s) ? fmtLap(s.bestTime) : ''], ['Top speed', num(s.vmax) > 0 ? fmtSpeed(s.vmax) : ''],
      ['Peak braking', num(s.brakeG) > 0 ? s.brakeG.toFixed(2) + ' g' : ''], ['Hottest brakes', num(m.brakeTemp) != null ? pctTxt(m.brakeTemp) : ''],
      ['Charge used', u != null ? u.toFixed(1) + '%' : ''], ['Peak power', num(m.power) != null ? Math.round(m.power) + ' kW' : ''],
      ['Peak regen', num(m.regen) != null ? Math.round(m.regen) + ' kW' : ''], ['Tyres', esc(s.tyres || '')], ['Brake pads', esc(s.pads || '')], ['Which wheels drive it?', esc(s.drive || '')]
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

  // The day a dot opens: every session at its track on its date, in the order they were driven.
  function dayRows(list) {
    if (!state.day) return [];
    return sortByWhen(list.filter(function (s) { return trackKey(s) === state.day.track && s.date === state.day.date; }));
  }
  // The colours of the figures, as in the mock-up: a performance figure is fast within 1% of your best at this track and slow
  // 3% or more off it; a heat figure takes the car's heat zones; a context figure is grey. vals are the figure's values across
  // the sessions of the track, so "your best" is the best of them.
  var FAST = '#1f8a70', MIDDLE = '#16233d', SLOW = '#e8542a', CONTEXT = '#9aa3b5';
  var HEAT = { normal: '#3d6b8f', yellow: '#eab308', orange: '#c2410c', red: '#b91c1c' };
  var HIGHER_IS_BETTER = { speed: true, brakeg: true, power: true, brakep: true, throttle: true };
  var HEAT_FIGURE = { brakes: true, battemp: true, inverter: true };
  var GROUPS = ['All figures', 'Pace', 'Brakes', 'Power', 'Battery and heat', 'Driving', 'Conditions'];
  var FIGURE_GROUP = { lap: 'Pace', speed: 'Pace', brakeg: 'Brakes', brakep: 'Brakes', brakes: 'Brakes', power: 'Power', regen: 'Power', used: 'Battery and heat', battemp: 'Battery and heat', inverter: 'Battery and heat', throttle: 'Driving', slip: 'Driving', temp: 'Conditions', press: 'Conditions' };
  var GRID_ORDER = ['lap', 'speed', 'brakeg', 'brakep', 'brakes', 'power', 'regen', 'used', 'battemp', 'inverter', 'throttle', 'slip', 'temp', 'press'];
  function heatZone(p) { return p >= 100 ? 'red' : p >= 85 ? 'orange' : p >= 70 ? 'yellow' : 'normal'; }
  function figureKind(m) { return m.id === 'lap' ? 'low' : HIGHER_IS_BETTER[m.id] ? 'high' : HEAT_FIGURE[m.id] ? 'heat' : 'ctx'; }
  function figureColour(m, v, vals) {
    var kind = figureKind(m);
    if (kind === 'heat') return HEAT[heatZone(v)];
    if (kind === 'ctx') return CONTEXT;
    var best = kind === 'low' ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    var off = kind === 'low' ? (v - best) / best * 100 : (best - v) / best * 100;
    return off <= 1 ? FAST : off >= 3 ? SLOW : MIDDLE;
  }
  function valuesOf(m, list) { return list.map(function (s) { return m.get(s); }).filter(function (x) { return x != null; }); }
  function dayColour(m, v, pool) { return figureColour(m, v, valuesOf(m, pool)); }
  function dayKey(s) { return trackKey(s) + '|' + s.date; }
  // The key under the graph and the grid: the same colours and heat zones as the day panel.
  function dayPanel(list) {
    var rows = dayRows(list);
    if (!rows.length) return '';
    var first = rows[0], pool = list.filter(function (s) { return trackKey(s) === state.day.track; });
    var key = [[FAST, 'Fast: within 1% of your best here'], [MIDDLE, 'Middle'], [SLOW, 'Slow: 3% or more off your best'],
      [HEAT.normal, 'Heat: normal'], [HEAT.yellow, 'Heat: yellow, from 70%'], [HEAT.orange, 'Heat: orange, from 85%'],
      [HEAT.red, 'Heat: red, 100% and over'], [CONTEXT, 'Context: no good or bad']];
    var sessions = rows.map(function (s) {
      var figs = METRICS.filter(function (m) { return m.id !== 'laps' && m.get(s) != null; }).map(function (m) {
        var v = m.get(s);
        return '<div class="ma-fig"><i style="background:' + dayColour(m, v, pool) + '"></i><div><span>' + esc(m.label) + '</span><b>' + esc(m.fmt(v)) + '</b></div></div>';
      }).join('');
      var facts = [['Tyres', s.tyres], ['Brake pads', s.pads], ['Which wheels drive it?', s.drive], ['Conditions', s.conditions], ['Logger', s.logger]]
        .filter(function (f) { return f[1]; });
      return '<section class="ma-sess' + (s.id === state.picked ? ' is-picked' : '') + '">' +
        '<div class="ma-sess-head"><b>' + esc(s.time || '') + '</b><span>' + esc(carName(s.carId)) + '</span>' +
        '<a class="tm-pill tm-pill-accent ma-open" href="track.html?s=' + esc(s.id) + '">Open this session</a></div>' +
        (facts.length ? '<dl class="ma-facts ma-sess-facts">' + facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>' : '') +
        '<div class="ma-figs">' + figs + '</div></section>';
    }).join('');
    return '<div class="tm-card ma-day" id="ma-day"><div class="ma-day-head"><div><h2>' + esc(niceDate(first.date)) + ', ' + esc(trackOf(first)) + '</h2>' +
      '<p class="tm-note">' + rows.length + (rows.length === 1 ? ' session' : ' sessions') + ' on this day. Each figure is coloured against your best at this track.</p></div>' +
      '<button type="button" class="ma-day-close" data-close-day aria-label="Close this day"><svg class="ma-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="ma-day-key">' + key.map(function (k) { return '<span><i style="background:' + k[0] + '"></i>' + esc(k[1]) + '</span>'; }).join('') + '</div>' +
      sessions + '</div>';
  }
  // One figure's card in the grid: a dot per session, each in the three colours.
  function figureCard(m, sessions, group, trackName) {
    var rows = sessions.map(function (s) { return { s: s, v: m.get(s) }; }).filter(function (x) { return x.v != null; });
    if (!rows.length) return '';
    var kind = figureKind(m), vals = rows.map(function (x) { return x.v; });
    var pts = rows.map(function (x) { return { v: x.v, s: x.s, date: x.s.date }; });
    pts.forEach(function (p) { p.c = figureColour(m, p.v, vals); p.key = dayKey(p.s); });
    var unit = 'sessions', headline, sub, foot;
    if (kind === 'low' || kind === 'high') {
      headline = m.fmt(kind === 'low' ? Math.min.apply(null, vals) : Math.max.apply(null, vals));
      sub = 'your best at ' + trackName;
    } else if (kind === 'heat') {
      headline = m.fmt(Math.max.apply(null, vals));
      sub = 'hottest at ' + trackName;
    } else {
      headline = m.fmt(rows[rows.length - 1].v);
      sub = 'latest at ' + trackName;
    }
    if (kind === 'ctx') {
      foot = 'Context figure, grey: no good or bad';
    } else if (kind === 'heat') {
      var z = { normal: 0, yellow: 0, orange: 0, red: 0 };
      pts.forEach(function (p) { z[heatZone(p.v)] += 1; });
      foot = 'Normal ' + z.normal + ', yellow ' + z.yellow + ', orange ' + z.orange + ', red ' + z.red + ' ' + unit;
    } else {
      var n = { fast: 0, middle: 0, slow: 0 };
      pts.forEach(function (p) { if (p.c === FAST) n.fast += 1; else if (p.c === SLOW) n.slow += 1; else n.middle += 1; });
      foot = 'Fast ' + n.fast + ', middle ' + n.middle + ', slow ' + n.slow + ' ' + unit;
    }
    // Axes: the figure up the side (a faster lap at the top, and for the other figures the highest value at the top) and
    // the sessions along the bottom by date, as the Over time chart does. Gridlines at each level and each month.
    var W = 320, H = 150, L = 52, R = 12, T = 12, B = 30;
    var lo = Math.min.apply(null, pts.map(function (p) { return p.v; })), hi = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    if (hi - lo < 0.5) { lo -= 0.5; hi += 0.5; }
    var top = kind === 'low' ? lo : hi, bottom = kind === 'low' ? hi : lo;
    var days = pts.map(function (p) { return Date.parse(p.date + 'T00:00:00Z'); });
    var toScale = days.every(isFinite) && days[days.length - 1] > days[0];
    var d0 = days[0], dspan = days[days.length - 1] - d0;
    function X(i) { return toScale ? L + (days[i] - d0) / dspan * (W - L - R) : L + (pts.length > 1 ? i / (pts.length - 1) : 0.5) * (W - L - R); }
    function Y(v) { return T + (v - top) / (bottom - top) * (H - T - B); }
    var xy = pts.map(function (p, i) { return { x: X(i).toFixed(1), y: Y(p.v).toFixed(1) }; });
    var grid = '', ylab = '', xlab = '';
    [0, 0.5, 1].forEach(function (f) {
      var gy = (T + f * (H - T - B)).toFixed(1), val = top + f * (bottom - top);
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="#eef1f6"/>';
      ylab += '<text x="' + (L - 6) + '" y="' + (+gy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#4a5568">' + esc(m.fmt(val)) + '</text>';
    });
    if (toScale) {
      var first = new Date(days[0]), last = days[days.length - 1];
      for (var mo = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1); mo < last; mo = Date.UTC(new Date(mo).getUTCFullYear(), new Date(mo).getUTCMonth() + 1, 1)) {
        var mx = (L + (mo - d0) / dspan * (W - L - R)).toFixed(1);
        grid += '<line x1="' + mx + '" x2="' + mx + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#f3f5f9"/>';
        xlab += '<text x="' + mx + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="#4a5568">' + esc(new Date(mo).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })) + '</text>';
      }
    }
    var axes = '<line x1="' + L + '" x2="' + L + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>' +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="#dcdfe6"/>';
    var line = xy.length > 1 ? '<polyline points="' + xy.map(function (q) { return q.x + ',' + q.y; }).join(' ') + '" fill="none" stroke="#d3d8e2" stroke-width="1.5"/>' : '';
    var dots = pts.map(function (p, i) {
      return '<circle class="ma-gdot" cx="' + xy[i].x + '" cy="' + xy[i].y + '" r="5.5" fill="' + p.c + '" stroke="#fff" stroke-width="1.5" data-session="' + esc(p.s.id) + '" data-day="' + esc(p.key) + '" tabindex="0" role="button"><title>' + esc(niceDate(p.date) + ': ' + m.fmt(p.v) + '. Press to see that day') + '</title></circle>';
    }).join('');
    var hits = pts.map(function (p, i) {
      return '<circle class="ma-ghit" cx="' + xy[i].x + '" cy="' + xy[i].y + '" r="21" fill="transparent" data-session="' + esc(p.s.id) + '" data-day="' + esc(p.key) + '"/>';
    }).join('');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(m.label + ', ' + unit + ', by date') + '">' + grid + axes + ylab + xlab + line + hits + dots + '</svg>';
    var axis = '<div class="ma-axis"><span>' + esc(niceDate(pts[0].date)) + '</span><span>' + esc(niceDate(pts[pts.length - 1].date)) + '</span></div>';
    return '<div class="tm-card ma-fig-card" data-figure="' + m.id + '"' + (group !== 'All figures' && FIGURE_GROUP[m.id] !== group ? ' hidden' : '') + '>' +
      '<div class="ma-fig-top"><b>' + esc(m.label) + '</b><span class="ma-grp">' + esc(FIGURE_GROUP[m.id]) + '</span></div>' +
      '<div class="ma-fig-val">' + esc(headline) + '</div><div class="ma-fig-sub">' + esc(sub) + '</div>' +
      svg + axis + chartKeyHtml(m, true) + '<div class="ma-fig-foot">' + esc(foot) + '</div></div>';
  }

  // The All figures grid: one track at a time, its figures as cards, with the track and group choices above them.
  function gridSection() {
    var carList = state.sessions.filter(function (s) { return s.type !== 'other' && (state.car === 'all' || s.carId === state.car); });
    var counts = {}, names = {};
    carList.filter(function (s) { return timed(s) || s.type === 'drag'; }).forEach(function (s) {
      var k = trackKey(s);
      counts[k] = (counts[k] || 0) + 1;
      names[k] = names[k] || trackOf(s);
    });
    var keys = Object.keys(counts);
    if (!keys.length) return '';
    keys.sort(function (a, b) { return names[a] < names[b] ? -1 : 1; });
    var track = keys.indexOf(state.track) !== -1 ? state.track : keys.reduce(function (a, b) { return counts[b] > counts[a] ? b : a; });
    var sessions = sortByWhen(carList.filter(function (s) { return trackKey(s) === track; }));
    var venue = sessions[0].venue || names[track];
    var groups = GROUPS.map(function (g) {
      return '<button type="button" class="chip' + (state.gridGroup === g ? ' is-on' : '') + '" data-grid-group="' + esc(g) + '" aria-pressed="' + (state.gridGroup === g) + '">' + esc(g) + '</button>';
    }).join('');
    var cards = GRID_ORDER.map(function (id) {
      var m = METRICS.filter(function (x) { return x.id === id; })[0];
      return m ? figureCard(m, sessions, state.gridGroup, venue) : '';
    }).join('');
    return '<div class="tm-card ma-grid-head"><h2>All figures</h2>' +
      '<p class="tm-note">One track at a time, one dot per session. Each figure is coloured against your best at this track. Press a dot to see that day under the figure.</p>' +
      '<div class="tm-chips ma-grid-chips" role="group" aria-label="Figures">' + groups + '</div>' +
      '</div>' +
      '<div class="ma-grid" id="ma-grid">' + cards + '</div>';
  }

  // The day panel sits under the graph when a graph dot opened it; otherwise the picked session's card shows there.
  function beneathChart(list) {
    if (!state.day) return pickHtml(list);
    return state.day.anchor === 'chart' ? dayPanel(list) : '';
  }

  // A day opened from a figure's dot sits under that figure: after its row on a phone or tablet, at the bottom of the grid on a desktop.
  function placeGridDay(list) {
    var a = state.day && state.day.anchor;
    if (!a || a === 'chart') return;
    var grid = document.getElementById('ma-grid');
    var card = grid && grid.querySelector('.ma-fig-card[data-figure="' + a + '"]');
    if (!card || card.hidden) { clearDay(); return; }
    var box = document.createElement('div');
    box.innerHTML = dayPanel(list);
    var panel = box.firstChild;
    if (!panel) return;
    var cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    if (cols > 2) { grid.appendChild(panel); return; }
    var cards = Array.prototype.filter.call(grid.children, function (el) { return el.classList.contains('ma-fig-card') && !el.hidden; });
    var end = Math.min(cards.length - 1, Math.floor(cards.indexOf(card) / cols) * cols + cols - 1);
    grid.insertBefore(panel, cards[end].nextSibling);
  }

  // After a dot opens a day: the graph's dot brings the graph to the top of the screen; a phone's grid card brings the card,
  // with its day under it; on a desktop the day is at the bottom of the grid.
  function scrollToDay() {
    var a = state.day && state.day.anchor;
    var target = app.querySelector('.tm-chart svg') || app.querySelector('.tm-chart');
    if (a && a !== 'chart') {
      target = app.querySelector('.ma-fig-card[data-figure="' + a + '"]');
      var panel = app.querySelector('#ma-day');
      var grid = document.getElementById('ma-grid');
      if (panel && grid && panel.parentElement === grid && getComputedStyle(grid).gridTemplateColumns.split(' ').length > 2) target = panel;
    }
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // Highlights every dot of the day on show, on the graph and in each figure.
  function markDay() {
    var dots = Array.prototype.slice.call(app.querySelectorAll('.ma-dot, .ma-gdot'));
    dots.forEach(function (d) { d.classList.remove('is-open'); });
    if (!state.day) return;
    var k = state.day.track + '|' + state.day.date;
    dots.forEach(function (d) { if (d.getAttribute('data-day') === k) d.classList.add('is-open'); });
  }

  function isDot(el) { return !!el.classList && ['ma-dot', 'ma-hit', 'ma-gdot', 'ma-ghit'].some(function (c) { return el.classList.contains(c); }); }
  // The figure a dot sits in, or the graph.
  function anchorOf(el) { var card = el.closest ? el.closest('.ma-fig-card') : null; return card ? card.getAttribute('data-figure') : 'chart'; }
  function openDay(id, anchor) {
    var s = state.sessions.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    state.picked = id;
    state.day = { track: trackKey(s), date: s.date, anchor: anchor || 'chart' };
    scrollAfterDraw = true;
    draw();
  }
  function clearDay() { state.day = null; state.picked = null; }
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
    // The My Analysis icon (as in the header) beside the label, so the page is known while the choices stay in view.
    var trackPick = keys.length > 1 ? '<label class="tm-pick"><span class="ma-pick-label">Track and layout<svg class="ma-pick-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l3.5-3.5 3 3L19 8"/><path d="M15 8h4v4"/></svg></span><select id="ma-track" class="field"><option value="all"' + (state.track === 'all' ? ' selected' : '') + '>All tracks</option>' +
      keys.map(function (k) { return '<option value="' + esc(k) + '"' + (state.track === k ? ' selected' : '') + '>' + esc(byKey[k]) + '</option>'; }).join('') + '</select></label>' : '';
    var body = '';
    if (!list.length) {
      body = '<div class="tm-card"><p>No sessions here yet. Once you have saved a track session with this car, its analysis appears here.</p></div>';
    } else {
      var says = findings(list);
      body = '<div id="ma-sec-grid">' + gridSection() + '</div>' +
        '<div class="tm-card"><h2>What the figures show</h2><ul class="tm-finds">' + says.map(function (f) { return '<li>' + findIcon(f.k) + '<span>' + f.t + '</span></li>'; }).join('') + '</ul></div>' +
        '<div id="ma-sec-time">' + chart(list) + beneathChart(list) + '</div>' +
        '<div id="ma-sec-setup">' + setupBlock(list) + '</div>' +
        '<div id="ma-sec-sessions">' + detailsTable(list) + '</div>';
    }
    // The Track Mode badge beside the title shows when the sessions picked carry Track Mode figures.
    // (The title's badge on desktop and the copy under the buttons on a phone.)
    var recorded = list.filter(function (x) { return !!x.mode; }).length;
    var tmShow = recorded > 0;
    var tmBadges = [tmDesk, document.getElementById('ma-tm-phone')].filter(Boolean);
    // With no track picked the badge counts the sessions recorded with Track Mode; with a track it names the feature.
    var tmWords = state.track !== 'all' ? 'Recorded with Track Mode' : recorded + (recorded === 1 ? ' session with Track Mode' : ' sessions with Track Mode');
    tmBadges.forEach(function (b) {
      b.hidden = !tmShow;
      var text = Array.prototype.find.call(b.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
      if (text) text.nodeValue = tmWords;
    });
    // Play the red dot again each time the badge shows (page load, or a new track or car picked).
    tmBadges.forEach(function (b) {
      var tick = tmShow ? b.querySelector('.ma-rec-dot') : null;
      if (tick) { tick.style.animation = 'none'; void tick.getBoundingClientRect(); tick.style.animation = ''; }
    });
    // The badge sits beside the Track and layout drop-down on desktop (a phone shows its own copy under the buttons).
    // Quick links to each section sit in the sticky block with the choices, so they stay in reach as the page scrolls.
    var jump = list.length ? '<div class="ma-jump" role="navigation" aria-label="Sections">' +
      [['ma-sec-grid', 'All figures'], ['ma-sec-time', 'Over time'], ['ma-sec-setup', 'Setups'], ['ma-sec-sessions', 'Sessions']].map(function (x) {
        return '<a href="#' + x[0] + '">' + x[1] + '</a>';
      }).join('') + '</div>' : '';
    app.innerHTML = '<div class="tm-controls ma-controls">' + carPick + '<div class="ma-track-cell">' + trackPick + '<span class="ma-tm-slot"></span></div>' + jump + '</div>' + body;
    setControlsTop();
    var slot = app.querySelector('.ma-tm-slot');
    if (slot && tmDesk) slot.replaceWith(tmDesk);
    placeGridDay(list);
    markDay();
    if (scrollAfterDraw) { scrollAfterDraw = false; scrollToDay(); }
  }

  // A dot or a table row selects its session: the panel above the table shows it, and the page moves to the panel.
  function selectSession(el, scroll) {
    state.day = null;
    state.picked = el.getAttribute('data-session');
    draw();
    var panel = document.getElementById('ma-pick');
    if (scroll && panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-session]') : null;
    if (!el || !app.contains(el) || (e.target.closest && e.target.closest('a'))) return;
    if (isDot(el)) { openDay(el.getAttribute('data-session'), anchorOf(el)); return; }
    selectSession(el, el.tagName.toLowerCase() !== 'tr');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target && e.target.getAttribute ? e.target.getAttribute('data-session') : null;
    if (!el || !app.contains(e.target)) return;
    e.preventDefault();
    if (isDot(e.target)) { openDay(el, anchorOf(e.target)); return; }
    selectSession(e.target, true);
  });
  // The day panel's close button clears the day and the session picked with it.
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest || !app.contains(e.target) || !e.target.closest('[data-close-day]')) return;
    clearDay();
    draw();
  });
  // The figure and setup chips, and the drop-downs, redraw the page in place.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-metric],[data-setup],[data-grid-group]') : null;
    if (!b || !app.contains(b)) return;
    if (b.getAttribute('data-metric')) state.metric = b.getAttribute('data-metric');
    if (b.getAttribute('data-setup')) state.setup = b.getAttribute('data-setup');
    if (b.getAttribute('data-grid-group')) state.gridGroup = b.getAttribute('data-grid-group');
    draw();
  });
  document.addEventListener('change', function (e) {
    if (!e.target || !app.contains(e.target)) return;
    if (e.target.id === 'ma-car') { state.car = e.target.value; state.track = 'all'; rememberTrack(); clearDay(); draw(); }
    if (e.target.id === 'ma-track') { state.track = e.target.value; rememberTrack(); clearDay(); draw(); }
  });
  // The track and car choices stay in view under the page header as the page scrolls: their top sits just below the header.
  // Sections land just under the header and the sticky choices, so a link never hides its heading behind them.
  function setControlsTop() {
    var h = document.querySelector('header'), root = document.documentElement.style;
    if (h) root.setProperty('--ma-top', Math.ceil(h.getBoundingClientRect().height) + 'px');
    var c = app.querySelector('.ma-controls');
    root.setProperty('--ma-stick', (Math.ceil(h ? h.getBoundingClientRect().height : 0) + (c ? Math.ceil(c.getBoundingClientRect().height) : 0) + 12) + 'px');
  }
  setControlsTop();
  // Redraw the graph at a new width (a phone turned sideways).
  var lastW = app.clientWidth, timer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    setControlsTop();
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
  // My Analysis is a paid tool. While the switch is on for a member on the free tier (the worker says so), it shows
  // what a paid plan includes instead. Full access and the switch being off see the page as before.
  var subscribeOpen = false;
  fetch(API + '/track/tiers/access', H).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (t) {
    // The usage ring beside the title, as on the Sessions pages (js/quota-ring.js).
    if (window.MT3UKQuotaRing) window.MT3UKQuotaRing.draw(t || {});
    if (t && t.success && t.applies && !t.full && !t.proFeatures) {
      subscribeOpen = !!t.subscribe;
      // An example of a paid analysis, greyed out so it is clear it is not the member's own. Nothing of theirs is shown.
      app.innerHTML = '<div class="tm-card ma-example-note"><h2>This is an example</h2>' +
        '<p><b>Data analysis is a Laps Pro feature.</b> It turns the figures your logger or car records into lap times, corner by corner, grip and what each change did, for every session. This is an example, not your data. Unlock to see your own sessions here.</p>' +
        '<p class="tm-sub">If you add Tesla Track Mode data to a session, extra insights are available.</p>' +
        '<button type="button" class="tm-pill tm-pill-accent" data-ma-unlock>Unlock</button> <span class="tm-sub" data-ma-note hidden>Subscriptions are coming soon. Nothing is charged yet.</span></div>' +
        '<div class="ma-example" aria-label="Example, not your data"><img src="images/track-preview/analysis-example.png" alt="An example session analysis, not a member\'s own data" loading="lazy"></div>';
      app.querySelector('[data-ma-unlock]').addEventListener('click', function () {
        var n = app.querySelector('[data-ma-note]');
        if (!subscribeOpen) { if (n) n.hidden = false; return; }
        fetch(API + '/laps/pro/subscribe', { method: 'POST', headers: { 'X-Session-Token': H.headers['X-Session-Token'], 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (d) {
            if (d && d.success && d.approveUrl) { window.location.href = d.approveUrl; return; }
            if (n) { n.textContent = (d && d.message) || 'Could not start the subscription. Try again.'; n.hidden = false; }
          })
          .catch(function () { if (n) { n.textContent = 'Could not start the subscription. Try again.'; n.hidden = false; } });
      });
      return;
    }
    loadAnalysis();
  });
  function loadAnalysis() {
  Promise.all([
    fetch(API + '/track/sessions', H).then(function (r) { if (r.status === 401) throw { signIn: true }; if (r.status === 403) throw { early: true }; return r.json(); }),
    fetch(API + '/my-builds', H).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
  ]).then(function (res) {
    if (!res[0] || res[0].success === false) throw {};
    state.sessions = res[0].sessions || [];
    (res[1].cars || []).forEach(function (c) { state.cars[c.id] = c.name || 'Car'; });
    // A link from a session opens the page on that car and track (?car=, ?track=); an unknown track falls back to all tracks.
    // The track picked last time is remembered on this device; a link with ?track= still takes precedence.
    try { var kept = localStorage.getItem(TRACK_KEY); if (kept) state.track = kept; } catch (e) { /* storage blocked */ }
    var q = new URLSearchParams(location.search);
    if (q.get('car')) state.car = q.get('car');
    if (q.get('track')) state.track = q.get('track');
    draw();
  }).catch(function (err) {
    if (err && err.signIn) { app.innerHTML = '<div class="tm-card"><p>Your sign-in has ended. Sign in again to see your analysis.</p><p><a class="tm-pill tm-pill-accent" href="' + esc(signIn) + '">Sign in</a></p></div>'; return; }
    if (err && err.early) { app.innerHTML = '<div class="tm-card"><p>My Analysis is part of Sessions, which is in early preview. <a href="track.html">Ask for access on Sessions</a>.</p></div>'; return; }
    app.innerHTML = '<div class="tm-card"><p>Your sessions could not be read just now. Try again in a moment.</p></div>';
  });
  }
})();
