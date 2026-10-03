/*
  Track sessions: the charts on track.html, drawn as inline SVG from a
  session made by js/track-parse.js. Lap traces are arrays of
  [distance m, time s, x m, y m, speed km/h, sideways g, lengthways g].

  MT3UKTrackView.map(svg, trace, opts)       the line coloured by speed
  MT3UKTrackView.line(svg, cfg)              speed, time gap, drag curves
  MT3UKTrackView.gg(svg, trace)              grip used
  MT3UKTrackView.timeline(svg, points, mods) best lap per session
  Each chart has a hover (or touch) tooltip. Speeds are shown in mph or
  km/h, whichever the member picked (MT3UKTrackView.units).
*/
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var C = { s1: '#2a78d6', s2: '#eb6834', ink: '#16233d', steel: '#6b7385', grid: 'rgba(22,35,61,.08)', axis: 'rgba(22,35,61,.24)', card: '#ffffff', orange: '#e8542a', orangeInk: '#b8421f', rampLo: '#5a189a', rampMid: '#d6336c', rampHi: '#c6f432', hair: 'rgba(22,35,61,.12)' };
  var units = { mph: true };
  try { units.mph = localStorage.getItem('mt3ukTrackUnits') !== 'kmh'; } catch (e) {}

  function setMph(on) { units.mph = !!on; try { localStorage.setItem('mt3ukTrackUnits', on ? 'mph' : 'kmh'); } catch (e) {} }
  function spd(k) { return units.mph ? k / 1.609344 : k; }
  function unit() { return units.mph ? 'mph' : 'km/h'; }
  function fmtV(k) { return Math.round(spd(k)) + ' ' + unit(); }
  // Distances follow the same choice: miles with mph, kilometres with km/h.
  function distK() { return units.mph ? 1609.344 : 1000; }
  function fmtD(m, dp) { return (m / distK()).toFixed(dp == null ? 1 : dp) + (units.mph ? ' mi' : ' km'); }
  function fmtLap(s) {
    if (s == null || !isFinite(s)) return '';
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, attrs) {
    var t = el('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = s;
    return t;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // One tooltip for the page.
  var tipEl = null;
  function tip(html, x, y) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'tv-tip';
      document.body.appendChild(tipEl);
    }
    tipEl.innerHTML = html;
    tipEl.style.display = 'block';
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var lx = x + 14, ly = y - h - 10;
    if (lx + w > window.innerWidth - 8) lx = x - w - 14;
    if (lx < 8) lx = 8;
    if (ly < 8) ly = y + 18;
    tipEl.style.left = lx + 'px';
    tipEl.style.top = ly + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
  // Screen position to SVG units, allowing for a zoomed or panned viewBox.
  function point(svg, evt) {
    var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    return { x: vb.x + (evt.clientX - r.left) * vb.width / r.width, y: vb.y + (evt.clientY - r.top) * vb.height / r.height };
  }
  function width(svg, fallback) {
    var par = svg.parentNode, w = 0;
    if (par) {
      var cs = window.getComputedStyle(par);
      w = par.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    }
    return Math.max(280, Math.round(w || fallback || 640));
  }

  function hex(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function ramp(t) {
    var s = [C.rampLo, C.rampMid, C.rampHi].map(hex);
    var u = Math.max(0, Math.min(1, t)) * 2, i = Math.min(1, Math.floor(u)), f = u - i;
    return 'rgb(' + s[i].map(function (v, j) { return Math.round(v + (s[i + 1][j] - v) * f); }).join(',') + ')';
  }

  function traceAt(trace, d) {
    if (window.MT3UKTrack) return window.MT3UKTrack.traceAt(trace, d);
    return trace[0];
  }

  // ---------- Track map ----------
  // opts: corners [{n, x, y, name}], startLine [[x, y], [x, y]], mono,
  // lap (number for the tooltip), outline (another trace drawn faintly).
  function map(svg, trace, opts) {
    opts = opts || {};
    svg.innerHTML = '';
    // opts.fill: { w, h } to fill a box exactly (full screen), else a 640 wide map.
    var W = opts.fill ? Math.max(200, Math.round(opts.fill.w)) : Math.min(640, width(svg, 600)), H = opts.fill ? Math.max(160, Math.round(opts.fill.h)) : Math.round(W * (opts.ratio || (opts.tall ? 0.62 : 0.7)));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.classList.add('tv-map');
    if (!trace || trace.length < 2) { zoomControls(svg, null); return null; }
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    trace.forEach(function (p) { x0 = Math.min(x0, p[2]); x1 = Math.max(x1, p[2]); y0 = Math.min(y0, p[3]); y1 = Math.max(y1, p[3]); });
    var pad = 24, s = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((y1 - y0) || 1));
    var ox = (W - s * (x1 - x0)) / 2, oy = (H - s * (y1 - y0)) / 2;
    function P(x, y) { return [ox + (x - x0) * s, H - oy - (y - y0) * s]; }
    var vmin = Infinity, vmax = -Infinity;
    trace.forEach(function (p) { vmin = Math.min(vmin, p[4]); vmax = Math.max(vmax, p[4]); });
    // Satellite imagery underneath (Esri World Imagery), when there's an
    // origin to place it by and the member hasn't switched it off.
    var satG = opts.origin ? el('g', { 'class': 'tv-sat' }, svg) : null;
    // The track: a grey band drawn from every lap of the session, so it
    // covers the road actually used. Zoomed in it grows to a real track's
    // width (about 12 m), so your line can be seen within it.
    // Every lap's band is solid inside one see-through group, so where laps
    // overlap the band doesn't get darker. Hidden over the satellite picture,
    // which shows the real track.
    var bandG = el('g', { 'class': 'tv-bands', opacity: 0.12 }, svg);
    var bands = (opts.band && opts.band.length ? opts.band : [trace]).map(function (tr) {
      return el('polyline', { 'class': 'tv-band', points: tr.map(function (p) { return P(p[2], p[3]).join(','); }).join(' '), fill: 'none', stroke: C.ink, 'stroke-width': 14, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, bandG);
    });
    function bandWidth(k) { var w = Math.max(14 / k, TRACK_WIDTH_M * s); bands.forEach(function (b) { b.setAttribute('stroke-width', w); }); }
    bandWidth(1);
    // Other days' laps, dashed, under your line.
    (opts.overlays || []).forEach(function (o) {
      el('polyline', { points: o.trace.map(function (p) { return P(p[2], p[3]).join(','); }).join(' '), fill: 'none', stroke: o.color, 'stroke-width': 2.5, 'stroke-dasharray': '6 5', 'stroke-linejoin': 'round' }, svg);
    });
    // Two laps compared: each line in its own colour (B under A), with a
    // pale edge so both show on the satellite picture.
    // The lines are thin and get thinner as the map zooms in (linePx), so the
    // real width of the track shows either side of them.
    var edgeEls = [], lineEls = [], segG = null, rampGs = [];
    function linePx(k) {
      var t = Math.min(1, Math.max(0, (k - 1) / 3));
      return { edge: 4.5 - 1.5 * t, line: 2.5 - 0.75 * t, seg: (opts.mono ? 2.5 : 3) - (opts.mono ? 0.75 : 1) * t, alpha: 0.7 - 0.2 * t };
    }
    (opts.lines || []).forEach(function (o) {
      var pts = o.trace.map(function (p) { return P(p[2], p[3]).join(','); }).join(' ');
      edgeEls.push(el('polyline', { 'class': 'tv-line-edge', points: pts, fill: 'none', stroke: 'rgba(255,255,255,.7)', 'stroke-width': 4.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg));
      // o.ramp: coloured by speed along the lap (the same colours as the key).
      if (o.ramp) {
        var rg = el('g', { 'class': 'tv-segs', 'stroke-width': linePx(1).seg }, svg);
        rampGs.push(rg);
        for (var r = 1; r < o.trace.length; r++) {
          var ra = P(o.trace[r - 1][2], o.trace[r - 1][3]), rb = P(o.trace[r][2], o.trace[r][3]);
          el('line', { 'class': 'tv-speed', x1: ra[0], y1: ra[1], x2: rb[0], y2: rb[1], stroke: ramp((o.trace[r][4] - vmin) / ((vmax - vmin) || 1)), 'stroke-linecap': 'round' }, rg);
        }
        return;
      }
      var la = { 'class': 'tv-line', points: pts, fill: 'none', stroke: o.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
      if (o.dash) la['stroke-dasharray'] = o.dash;
      lineEls.push(el('polyline', la, svg));
    });
    if (!opts.lines) segG = el('g', { 'class': 'tv-segs', 'stroke-width': linePx(1).seg }, svg);
    for (var i = 1; i < (opts.lines ? 0 : trace.length); i++) {
      var a = P(trace[i - 1][2], trace[i - 1][3]), b = P(trace[i][2], trace[i][3]);
      el('line', { 'class': opts.mono ? 'tv-mono' : 'tv-speed', x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: opts.mono ? C.steel : ramp((trace[i][4] - vmin) / ((vmax - vmin) || 1)), 'stroke-linecap': 'round' }, segG);
    }
    function lineWidth(k) {
      var w = linePx(k);
      edgeEls.forEach(function (e) { e.setAttribute('stroke-width', w.edge); e.setAttribute('stroke', 'rgba(255,255,255,' + w.alpha.toFixed(2) + ')'); });
      lineEls.forEach(function (e) { e.setAttribute('stroke-width', w.line); });
      if (segG) segG.setAttribute('stroke-width', w.seg);
      rampGs.forEach(function (g) { g.setAttribute('stroke-width', w.seg); });
    }
    // Markers (start line, corners, dots) keep their size when zoomed: each
    // is a group at its point, scaled back by the zoom.
    var fixed = [], k = 1;
    function marker(x, y) {
      var g = el('g', {}, svg);
      var m = { g: g, x: x, y: y };
      fixed.push(m);
      g.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + (1 / k) + ')');
      return m;
    }
    function moveMarker(m, x, y) { m.x = x; m.y = y; m.g.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + (1 / k) + ')'); }
    // A line across the track with a label that reads on the satellite
    // picture too (white with a dark edge). A sprint or hill climb has a
    // separate start (green) and finish (red).
    function lineMarker(line, label, colour) {
      var sa = P(line[0][0], line[0][1]), sb = P(line[1][0], line[1][1]);
      var mx = (sa[0] + sb[0]) / 2, my = (sa[1] + sb[1]) / 2, dx = sb[0] - sa[0], dy = sb[1] - sa[1], L = Math.hypot(dx, dy) || 1;
      var sm = marker(mx, my);
      el('line', { x1: -dx / L * 14, y1: -dy / L * 14, x2: dx / L * 14, y2: dy / L * 14, stroke: '#ffffff', 'stroke-width': 6, 'stroke-linecap': 'round' }, sm.g);
      el('line', { x1: -dx / L * 14, y1: -dy / L * 14, x2: dx / L * 14, y2: dy / L * 14, stroke: colour, 'stroke-width': 3.5, 'stroke-linecap': 'round' }, sm.g);
      // A style, not attributes: the page's own text rule would otherwise turn it grey.
      text(sm.g, 18, 5, label, { 'font-size': 13, 'font-weight': 700, fill: '#ffffff', stroke: '#1a1a1a', 'stroke-width': 3.5, 'paint-order': 'stroke', 'stroke-linejoin': 'round', style: 'fill:#ffffff;stroke:#1a1a1a;stroke-width:3.5px;paint-order:stroke;stroke-linejoin:round;font-weight:700;font-size:13px' });
    }
    if (opts.startLine) lineMarker(opts.startLine, opts.finishLine ? 'Start' : 'Start / finish', opts.finishLine ? '#1baf7a' : C.ink);
    if (opts.finishLine) lineMarker(opts.finishLine, 'Finish', '#d33a2c');
    (opts.corners || []).forEach(function (c) {
      var p = P(c.x, c.y), cm = marker(p[0], p[1]);
      el('circle', { cx: 0, cy: 0, r: 11, fill: C.card, stroke: C.axis }, cm.g);
      text(cm.g, 0, 4.5, String(c.n), { 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: C.ink });
    });
    function dot(color) {
      var dm = marker(0, 0);
      el('circle', { r: 7, fill: color, stroke: C.card, 'stroke-width': 2.5 }, dm.g);
      dm.g.setAttribute('visibility', 'hidden');
      return dm;
    }
    var dotB = dot(C.s2), dotA = dot(C.s1);
    function place(dm, p) {
      if (!p) { dm.g.setAttribute('visibility', 'hidden'); return; }
      var q = P(p[2], p[3]);
      moveMarker(dm, q[0], q[1]);
      dm.g.setAttribute('visibility', 'visible');
    }
    if (!opts.mono) {
      var hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }, svg);
      hit.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch' && zoom.busy()) return;
        var q = point(svg, e), bi = 0, bd = Infinity;
        trace.forEach(function (p, j) { var pp = P(p[2], p[3]), d = (pp[0] - q.x) * (pp[0] - q.x) + (pp[1] - q.y) * (pp[1] - q.y); if (d < bd) { bd = d; bi = j; } });
        if (bd > 900 / (k * k)) { place(dotA, null); hideTip(); return; }
        var p = trace[bi];
        place(dotA, p);
        tip('<b>' + (opts.lap ? 'Lap ' + opts.lap + ', ' : '') + fmtD(p[0], 2) + '</b>' + row('Speed', fmtV(p[4])) + row('Time', p[1].toFixed(1) + ' s') + row('Cornering', Math.abs(p[5]).toFixed(2) + ' g'), e.clientX, e.clientY);
      });
      hit.addEventListener('pointerleave', function () { place(dotA, null); hideTip(); });
    }
    var sat = satGround(svg, satG, opts.origin, P, s, x0, y0, H, oy, ox);
    var zoom = zoomControls(svg, { W: W, H: H, sat: sat, full: opts.full, pts: trace.map(function (p) { return P(p[2], p[3]); }), onZoom: function (kk) {
      k = kk;
      bandWidth(kk);
      lineWidth(kk);
      if (sat) sat.later();
      fixed.forEach(function (m) { moveMarker(m, m.x, m.y); });
      if (typeof edgeA !== 'undefined' && edgeA) edges();
    } });
    // When the dots are moved from outside the map (scrubbing a chart,
    // playback), a zoomed-in view follows them: centred between the two while
    // both fit on screen, else on the one in front. Hovering the map itself
    // uses place() directly, so the map doesn't slide away.
    // The change between the two is a glide, not a jump: the view follows the
    // leader exactly and the pull towards the middle of the two (blend) eases
    // in and out. It lets go of the other car when they are over 60% of the
    // screen apart and only takes both again under 45%, so a gap near the
    // limit doesn't flick back and forth.
    var posA = null, posB = null, following = true, both = true, blend = 1, lastT = 0, glideRaf = null;
    var GLIDE = 0.12; // seconds: most of the glide is done in about a third of a second
    function follow() {
      if (!following || !zoom || zoom.k() <= 1.01 || (!posA && !posB) || zoom.active()) { lastT = 0; return; }
      var qa = posA && P(posA[2], posA[3]), qb = posB && P(posB[2], posB[3]), t;
      var now = (window.performance && performance.now()) || Date.now();
      var dt = lastT ? Math.min(0.25, (now - lastT) / 1000) : 1;
      lastT = now;
      if (qa && qb) {
        var v = zoom.view();
        var apart = Math.max(Math.abs(qa[0] - qb[0]) / v.w, Math.abs(qa[1] - qb[1]) / v.h);
        if (both && apart > 0.6) both = false;
        else if (!both && apart < 0.45) both = true;
        blend += ((both ? 1 : 0) - blend) * (1 - Math.exp(-dt / GLIDE));
        if (Math.abs(blend - (both ? 1 : 0)) < 0.02) blend = both ? 1 : 0;
        var lead = posA[0] >= posB[0] ? qa : qb, mid = [(qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2];
        t = [lead[0] + (mid[0] - lead[0]) * blend, lead[1] + (mid[1] - lead[1]) * blend];
        // Paused part way through a glide: finish it.
        if (blend !== (both ? 1 : 0) && !glideRaf && window.requestAnimationFrame) glideRaf = requestAnimationFrame(function () { glideRaf = null; follow(); });
      } else t = qa || qb;
      var w = zoom.view();
      if (Math.abs(w.x + w.w / 2 - t[0]) < 0.01 && Math.abs(w.y + w.h / 2 - t[1]) < 0.01) return;
      zoom.centreOn(t[0], t[1]);
    }
    // A car off the edge of a zoomed-in map: an arrow in its colour at the
    // edge, pointing to it, with the gap.
    var gapS = null;
    function edgeArrow(color, letter) {
      var m = marker(0, 0);
      m.rot = el('g', {}, m.g);
      el('path', { d: 'M-2 -8 L12 0 L-2 8 Z', fill: color, stroke: C.card, 'stroke-width': 2, 'stroke-linejoin': 'round' }, m.rot);
      m.pill = el('rect', { rx: 10, ry: 10, height: 20, fill: color, stroke: C.card, 'stroke-width': 1.5 }, m.g);
      // style, not fill: the page's chart text colour would otherwise win.
      m.label = text(m.g, 0, 0, letter, { style: 'fill:#ffffff;font-size:13px;font-weight:700' });
      m.letter = letter;
      m.g.setAttribute('class', 'tv-edge');
      m.g.setAttribute('pointer-events', 'none');
      m.g.setAttribute('visibility', 'hidden');
      return m;
    }
    var edgeB = edgeArrow(C.s2, 'B'), edgeA = edgeArrow(C.s1, 'A');
    function edgeFor(m, pos, other) {
      if (!m) return;
      var q = pos && P(pos[2], pos[3]);
      var v = zoom && seen();
      // The same point for both (one lap only): one arrow is enough.
      var same = other && pos && other[2] === pos[2] && other[3] === pos[3] && m === edgeB;
      if (!q || !v || !zoom || zoom.k() <= 1.01 || same || (q[0] >= v.x && q[0] <= v.x + v.w && q[1] >= v.y && q[1] <= v.y + v.h)) { m.g.setAttribute('visibility', 'hidden'); return; }
      var cx = v.x + v.w / 2, cy = v.y + v.h / 2, dx = q[0] - cx, dy = q[1] - cy, pad = 18 / k;
      var sc = Math.min(dx ? (v.w / 2 - pad) / Math.abs(dx) : Infinity, dy ? (v.h / 2 - pad) / Math.abs(dy) : Infinity);
      moveMarker(m, cx + dx * sc, cy + dy * sc);
      m.rot.setAttribute('transform', 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1) + ')');
      // The label sits inside the map, away from the edge the arrow points at.
      var lbl = m.letter;
      if (gapS !== null && posA && posB) {
        var trailing = gapS >= 0 ? 'B' : 'A';
        lbl += ', ' + Math.abs(gapS).toFixed(1) + ' s ' + (m.letter === trailing ? 'behind' : 'ahead');
      }
      m.label.textContent = lbl;
      var horiz = Math.abs(dx) * v.h >= Math.abs(dy) * v.w;
      // A pill beside the arrow, on the side away from the edge.
      var tw = lbl.length * 7.2 + 16;
      var px = horiz ? (dx > 0 ? -12 - tw : 12) : -tw / 2, py = horiz ? -10 : (dy > 0 ? -36 : 16);
      m.pill.setAttribute('x', px.toFixed(1)); m.pill.setAttribute('y', py); m.pill.setAttribute('width', tw.toFixed(1));
      m.label.setAttribute('x', (px + tw / 2).toFixed(1));
      m.label.setAttribute('y', py + 14.5);
      m.label.setAttribute('text-anchor', 'middle');
      m.g.setAttribute('visibility', 'visible');
    }
    // What is actually on screen: the map can show a little more than its
    // view box when its box is a different shape (full screen on a phone).
    function seen() {
      var v = zoom.view(), r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return v;
      var sc = Math.min(r.width / v.w, r.height / v.h), w = r.width / sc, h = r.height / sc;
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w: w, h: h };
    }
    function edges() { edgeFor(edgeA, posA, posB); edgeFor(edgeB, posB, posA); }
    return { vmin: vmin, vmax: vmax, placeA: function (p) { place(dotA, p); posA = p; follow(); edges(); }, placeB: function (p) { place(dotB, p); posB = p; follow(); edges(); }, setFollow: function (on) { following = !!on; if (on) { lastT = 0; follow(); edges(); } }, setGap: function (g) { gapS = g == null || !isFinite(g) ? null : g; }, prefetchSat: function () { if (sat) sat.prefetch(trace); }, P: P, marker: marker, zoom: zoom };
  }

  // ---------- Satellite ground ----------
  // Web Mercator tiles placed on the map's flat metres: each tile's corners
  // go lat/lng -> metres around the session's origin -> the map. Over a
  // track that's accurate to well under a metre. The tile zoom follows the
  // map's zoom so the picture stays sharp; redrawn after zooming or panning.
  var SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/';
  var satOn = true;
  try { satOn = localStorage.getItem('mt3ukTrackSat') !== '0'; } catch (e) {}
  // Tiles already fetched this visit, so panning back, or playing a lap
  // again, shows them straight away (the browser also keeps them on disk).
  var tileSeen = {};
  function satGround(svg, g, origin, P, s, x0, y0, H, oy, ox) {
    if (!g || !origin || origin.length !== 2 || !window.MT3UKTrack) return null;
    var proj = window.MT3UKTrack.projector(origin[0], origin[1]);
    function toMap(lat, lng) { var xy = proj.xy(lat, lng); return P(xy[0], xy[1]); }
    function fromMap(px, py) { var x = (px - ox) / s + x0, y = (H - oy - py) / s + y0; return proj.ll(x, y); }
    function tileLng(x, z) { return x / Math.pow(2, z) * 360 - 180; }
    function tileLat(y, z) { var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(Math.sinh(n)); }
    function tileX(lng, z) { return Math.floor((lng + 180) / 360 * Math.pow(2, z)); }
    function tileY(lat, z) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
    var shown = {};      // key -> { z, node }: tiles drawn on this map
    var timer = null, last = 0;
    // The tile zoom that matches the map's current zoom.
    function zoomLevel() {
      var vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
      var mpp = (vb.width / s) / Math.max(1, r.width || vb.width);
      var z = Math.round(Math.log(156543.03 * Math.cos(origin[0] * Math.PI / 180) / Math.max(0.05, mpp)) / Math.LN2);
      return Math.max(12, Math.min(19, z));
    }
    // Loads a tile, then calls back once it can be drawn without a gap.
    function load(url, done) {
      if (tileSeen[url] === true) { done(); return; }
      var im = new Image();
      im.onload = function () { tileSeen[url] = true; done(); };
      im.onerror = function () { delete tileSeen[url]; };
      im.src = url;
    }
    // Tiles from other zoom levels stay underneath until this level's tiles
    // are all in, so the picture never goes blank while moving.
    function settle(z, wanted) {
      var ready = wanted.every(function (k) { return shown[k]; });
      if (!ready) return;
      Object.keys(shown).forEach(function (k) {
        var t = shown[k];
        if (t.z !== z) { if (t.node.parentNode) t.node.parentNode.removeChild(t.node); delete shown[k]; }
      });
    }
    function draw() {
      svg.classList.toggle('has-sat', satOn);
      if (!satOn) { g.innerHTML = ''; shown = {}; return; }
      var vb = svg.viewBox.baseVal;
      var a = fromMap(vb.x, vb.y), b = fromMap(vb.x + vb.width, vb.y + vb.height);
      var z = zoomLevel();
      var xa = tileX(Math.min(a[1], b[1]), z), xb = tileX(Math.max(a[1], b[1]), z);
      var ya = tileY(Math.max(a[0], b[0]), z), yb = tileY(Math.min(a[0], b[0]), z);
      if ((xb - xa + 1) * (yb - ya + 1) > 80) return;
      var wanted = [];
      // One tile of margin all round, so tiles are ready before the view gets there.
      for (var tx = xa - 1; tx <= xb + 1; tx++) for (var ty = ya - 1; ty <= yb + 1; ty++) {
        (function (tx, ty) {
          var key = z + '/' + ty + '/' + tx, inView = tx >= xa && tx <= xb && ty >= ya && ty <= yb;
          if (inView) wanted.push(key);
          if (shown[key]) return;
          var url = SAT_URL + key;
          load(url, function () {
            if (shown[key] || !satOn) { if (inView) settle(z, wanted); return; }
            var nw = toMap(tileLat(ty, z), tileLng(tx, z)), se = toMap(tileLat(ty + 1, z), tileLng(tx + 1, z));
            var node = el('image', { href: url, x: nw[0], y: nw[1], width: se[0] - nw[0] + 0.5, height: se[1] - nw[1] + 0.5, preserveAspectRatio: 'none' }, g);
            shown[key] = { z: z, node: node };
            settle(z, wanted);
          });
        })(tx, ty);
      }
      // Tiles well away from the view at this zoom level are dropped.
      Object.keys(shown).forEach(function (k) {
        var t = shown[k];
        if (t.z !== z) return;
        var p = k.split('/'), ky = +p[1], kx = +p[2];
        if (kx < xa - 3 || kx > xb + 3 || ky < ya - 3 || ky > yb + 3) { if (t.node.parentNode) t.node.parentNode.removeChild(t.node); delete shown[k]; }
      });
      settle(z, wanted);
    }
    draw();
    // Redraws at most every 200 ms while the view is moving, with one at the
    // end, so the picture keeps up during playback instead of waiting for it to stop.
    function later() {
      var now = Date.now();
      if (now - last >= 200) { last = now; clearTimeout(timer); timer = null; draw(); return; }
      if (!timer) timer = setTimeout(function () { timer = null; last = Date.now(); draw(); }, 200 - (now - last));
    }
    // Fetches the tiles along a trace at the current zoom, ready for playback.
    function prefetch(trace) {
      if (!satOn || !trace || !trace.length) return;
      var z = zoomLevel(), seen = {}, n = 0;
      for (var i = 0; i < trace.length && n < 400; i += 3) {
        var ll = proj.ll(trace[i][2], trace[i][3]), cx = tileX(ll[1], z), cy = tileY(ll[0], z);
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
          var key = z + '/' + (cy + dy) + '/' + (cx + dx);
          if (seen[key]) continue;
          seen[key] = 1; n++;
          load(SAT_URL + key, function () {});
        }
      }
    }
    return {
      later: later,
      prefetch: prefetch,
      toggle: function () { satOn = !satOn; try { localStorage.setItem('mt3ukTrackSat', satOn ? '1' : '0'); } catch (e) {} shown = {}; g.innerHTML = ''; draw(); return satOn; },
      on: function () { return satOn; }
    };
  }

  // Zoom and pan for a map: + / - / reset buttons, the mouse wheel, a pinch,
  // and dragging once zoomed in. It works on the SVG viewBox, so point()
  // keeps mapping taps to the right place. A drag that pans isn't a click.
  var ZOOM_MAX = 16, ZOOM_MIN = 0.4, TRACK_WIDTH_M = 12;
  function zoomControls(svg, cfg) {
    var wrap = svg.parentNode;
    if (!wrap.classList.contains('tv-zoom-wrap')) {
      var w = document.createElement('div');
      w.className = 'tv-zoom-wrap';
      wrap.insertBefore(w, svg);
      w.appendChild(svg);
      wrap = w;
    }
    var old = wrap.querySelector('.tv-zoom-btns');
    if (old) old.remove();
    if (svg._zoomOff) { svg._zoomOff(); svg._zoomOff = null; }
    if (!cfg) return null;
    var W = cfg.W, H = cfg.H, vb = { x: 0, y: 0, w: W, h: H };
    function set() {
      svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
      var kk = W / vb.w;
      svg.classList.toggle('is-zoomed', kk > 1.01);
      reset.hidden = Math.abs(kk - 1) <= 0.01;
      cfg.onZoom(kk);
    }
    function zoomAt(f, cx, cy) {
      var nw = Math.max(W / ZOOM_MAX, Math.min(W / ZOOM_MIN, vb.w / f)), nh = nw * H / W;
      if (cx == null) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; }
      vb.x = cx - (cx - vb.x) * nw / vb.w; vb.y = cy - (cy - vb.y) * nh / vb.h;
      vb.w = nw; vb.h = nh;
      clamp(); set();
    }
    function clamp() {
      // Zoomed out past the whole track, the map sits in the middle of the extra room.
      vb.x = vb.w >= W ? (W - vb.w) / 2 : Math.max(0, Math.min(W - vb.w, vb.x));
      vb.y = vb.h >= H ? (H - vb.h) / 2 : Math.max(0, Math.min(H - vb.h, vb.y));
    }
    function btn(cls, label, path) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tv-zoom-btn ' + cls; b.setAttribute('aria-label', label);
      b.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
      return b;
    }
    var box = document.createElement('div');
    box.className = 'tv-zoom-btns';
    var plus = btn('tv-zoom-in', 'Zoom in', 'M12 5v14M5 12h14');
    var minus = btn('tv-zoom-out', 'Zoom out', 'M5 12h14');
    var reset = btn('tv-zoom-reset', 'Show the whole track', 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z');
    box.appendChild(plus); box.appendChild(minus); box.appendChild(reset);
    // Full screen, when the map has it (cfg.full: { on, toggle }): the page redraws the map on the change, so the
    // button comes back showing the new state. cfg.full.state(), when given, says what the button is for just now
    // ({ on, label, path }): on a phone on its side it swaps between the map alone and the map with the charts.
    if (cfg.full) {
      var st = cfg.full.state && cfg.full.state(), isFull = st ? st.on : cfg.full.on();
      var full = btn('tv-zoom-full', st ? st.label : isFull ? 'Exit full screen' : 'Full screen map', st ? st.path : isFull ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
      full.setAttribute('aria-pressed', String(isFull));
      box.appendChild(full);
      full.addEventListener('click', function () { cfg.full.toggle(); });
    }
    wrap.appendChild(box);
    var oldCredit = wrap.querySelector('.tv-sat-credit');
    if (oldCredit) oldCredit.remove();
    if (cfg.sat) {
      var layer = btn('tv-zoom-sat', 'Satellite view', 'M12 3 2 8l10 5 10-5-10-5ZM2 13l10 5 10-5M2 17l10 5 10-5');
      layer.setAttribute('aria-pressed', String(cfg.sat.on()));
      box.appendChild(layer);
      var credit = document.createElement('div');
      credit.className = 'tv-sat-credit';
      credit.textContent = 'Imagery: Esri, Maxar, Earthstar Geographics';
      credit.hidden = !cfg.sat.on();
      wrap.appendChild(credit);
      layer.addEventListener('click', function () { var on = cfg.sat.toggle(); layer.setAttribute('aria-pressed', String(on)); credit.hidden = !on; });
    }
    // The buttons zoom towards the bit of track nearest the middle of the
    // view, so a loop's empty middle doesn't fill the screen.
    function nearCentre() {
      var cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2, best = null, bd = Infinity;
      (cfg.pts || []).forEach(function (p) { var d = (p[0] - cx) * (p[0] - cx) + (p[1] - cy) * (p[1] - cy); if (d < bd) { bd = d; best = p; } });
      return best || [cx, cy];
    }
    plus.addEventListener('click', function () {
      var c = nearCentre(), nw = Math.max(W / ZOOM_MAX, vb.w / 1.6), nh = nw * H / W;
      vb = { x: c[0] - nw / 2, y: c[1] - nh / 2, w: nw, h: nh };
      clamp(); set();
    });
    minus.addEventListener('click', function () { zoomAt(1 / 1.6); });
    reset.addEventListener('click', function () { vb = { x: 0, y: 0, w: W, h: H }; set(); });

    function onWheel(e) {
      e.preventDefault();
      var q = point(svg, e);
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, q.x, q.y);
    }
    var pts = {}, start = null, dragged = false, panCb = null, lastEv = 0;
    function count() { return Object.keys(pts).length; }
    function onDown(e) {
      lastEv = Date.now();
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      dragged = false;
      start = { vb: Object.assign({}, vb), pts: JSON.parse(JSON.stringify(pts)) };
    }
    function onMove(e) {
      if (!pts[e.pointerId] || !start) return;
      lastEv = Date.now();
      // A mouse let go off the map never said so: no button down means it is up.
      if (e.pointerType === 'mouse' && e.buttons === 0) { onUp(e); return; }
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var r = svg.getBoundingClientRect(), u = vb.w / r.width;
      var ids = Object.keys(pts);
      if (ids.length >= 2 && start.pts[ids[0]] && start.pts[ids[1]]) {
        var a0 = start.pts[ids[0]], b0 = start.pts[ids[1]], a1 = pts[ids[0]], b1 = pts[ids[1]];
        var d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1, d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1;
        var mid = { clientX: (a1.x + b1.x) / 2, clientY: (a1.y + b1.y) / 2 };
        vb = Object.assign({}, start.vb);
        var q = point(svg, mid);
        zoomAt(d1 / d0, q.x, q.y);
        dragged = true;
        e.preventDefault();
        return;
      }
      if (vb.w >= W - 0.5) return;
      var s0 = start.pts[e.pointerId];
      if (!s0) return;
      var mx = e.clientX - s0.x, my = e.clientY - s0.y;
      if (!dragged && Math.hypot(mx, my) < 6) return;
      dragged = true;
      // Keep hold of the pointer once it is a drag, so letting go anywhere
      // (even off the map) still reaches onUp.
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      if (panCb) panCb();
      vb.x = start.vb.x - mx * u; vb.y = start.vb.y - my * u;
      clamp(); set();
      e.preventDefault();
    }
    function onUp(e) {
      delete pts[e.pointerId];
      start = count() ? { vb: Object.assign({}, vb), pts: JSON.parse(JSON.stringify(pts)) } : null;
      // The click that follows a drag is swallowed; if none comes (let go off
      // the map), don't stay "dragging".
      if (dragged && !count()) setTimeout(function () { dragged = false; }, 60);
    }
    function onClick(e) { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('lostpointercapture', onUp);
    svg.addEventListener('click', onClick, true);
    // Any mouse button drags the map, so the right button's menu is kept out of the way.
    function noMenu(e) { e.preventDefault(); }
    svg.addEventListener('contextmenu', noMenu);
    // A finger lifted off the map, or taken over by the browser, is not always
    // reported to the map itself: listen on the page too so it is never left "down".
    function onAnyUp(e) { if (pts[e.pointerId]) onUp(e); }
    function onAway() { pts = {}; start = null; }
    document.addEventListener('pointerup', onAnyUp, true);
    document.addEventListener('pointercancel', onAnyUp, true);
    window.addEventListener('blur', onAway);
    document.addEventListener('visibilitychange', onAway);
    svg._zoomOff = function () {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('lostpointercapture', onUp);
      svg.removeEventListener('click', onClick, true);
      svg.removeEventListener('contextmenu', noMenu);
      document.removeEventListener('pointerup', onAnyUp, true);
      document.removeEventListener('pointercancel', onAnyUp, true);
      window.removeEventListener('blur', onAway);
      document.removeEventListener('visibilitychange', onAway);
    };
    set();
    function centreOn(x, y) {
      vb.x = x - vb.w / 2; vb.y = y - vb.h / 2;
      clamp(); set();
    }
    return {
      zoomAt: zoomAt, centreOn: centreOn, busy: function () { return count() > 1 || dragged; }, k: function () { return W / vb.w; },
      view: function () { return { x: vb.x, y: vb.y, w: vb.w, h: vb.h }; },
      // A finger or mouse button is down on the map.
      // (A touch with no news for over a second is taken to be over.)
      active: function () { return count() > 0 && Date.now() - lastEv < 1000; },
      // Called when the member drags or pinches the map by hand.
      onPan: function (cb) { panCb = cb; }
    };
  }
  function row(k, v, color) {
    return '<div class="tv-r"><span>' + (color ? '<i style="background:' + color + '"></i>' : '') + esc(k) + '</span><span>' + v + '</span></div>';
  }

  // ---------- Line chart ----------
  // cfg: x0, x1, y0, y1, xt, yt (ticks), xf, yf (labels), series [{ color,
  // pts [[x, y]], at(x), area }], tip(x, values) html, onMove(x), onLeave,
  // under(svg, X, Y), zero (a y value drawn as the axis), H.
  function line(svg, cfg) {
    svg.innerHTML = '';
    var W = cfg.W || width(svg), H = cfg.H || 240;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    // cfg.y2 { y0, y1, yt, yf }: a second scale on the right, for series with axis: 2.
    var m = { l: 46, r: cfg.y2 ? 46 : 12, t: 12, b: 28 };
    function X(v) { return m.l + (v - cfg.x0) / ((cfg.x1 - cfg.x0) || 1) * (W - m.l - m.r); }
    function Y(v) { return H - m.b - (v - cfg.y0) / ((cfg.y1 - cfg.y0) || 1) * (H - m.t - m.b); }
    function Y2(v) { return H - m.b - (v - cfg.y2.y0) / ((cfg.y2.y1 - cfg.y2.y0) || 1) * (H - m.t - m.b); }
    function Yof(sr) { return sr.axis === 2 && cfg.y2 ? Y2 : Y; }
    if (cfg.y2) cfg.y2.yt.forEach(function (v) { text(svg, W - m.r + 8, Y2(v) + 4, cfg.y2.yf ? cfg.y2.yf(v) : String(v), { 'text-anchor': 'start' }); });
    cfg.yt.forEach(function (v) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: v === cfg.zero ? C.axis : C.grid }, svg);
      text(svg, m.l - 8, Y(v) + 4, cfg.yf ? cfg.yf(v) : String(v), { 'text-anchor': 'end' });
    });
    cfg.xt.forEach(function (v) { text(svg, X(v), H - 8, cfg.xf ? cfg.xf(v) : String(v), { 'text-anchor': 'middle' }); });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: C.axis }, svg);
    if (cfg.under) cfg.under(svg, X, Y);
    cfg.series.forEach(function (sr) {
      if (!sr.pts.length) return;
      var Y = Yof(sr);
      if (sr.area) {
        var base = Y(cfg.zero || 0);
        el('path', { d: 'M' + X(sr.pts[0][0]) + ',' + base + ' ' + sr.pts.map(function (p) { return 'L' + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ') + ' L' + X(sr.pts[sr.pts.length - 1][0]) + ',' + base + 'Z', fill: sr.color, opacity: 0.12 }, svg);
      }
      el('path', { d: sr.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' '), fill: 'none', stroke: sr.color, 'stroke-width': sr.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': sr.dash || null }, svg);
    });
    var cross = el('line', { y1: m.t, y2: H - m.b, stroke: C.steel, 'stroke-width': 1, visibility: 'hidden' }, svg);
    var dots = cfg.series.map(function (sr) { return el('circle', { r: 4.5, fill: sr.color, stroke: C.card, 'stroke-width': 2, visibility: 'hidden' }, svg); });
    var hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' }, svg);
    function show(xv, e) {
      cross.setAttribute('x1', X(xv)); cross.setAttribute('x2', X(xv)); cross.setAttribute('visibility', 'visible');
      var vals = cfg.series.map(function (sr, i) {
        var v = sr.at(xv);
        if (v == null || !isFinite(v)) { dots[i].setAttribute('visibility', 'hidden'); return v; }
        dots[i].setAttribute('cx', X(xv)); dots[i].setAttribute('cy', Yof(cfg.series[i])(v)); dots[i].setAttribute('visibility', 'visible');
        return v;
      });
      if (e && cfg.tip) tip(cfg.tip(xv, vals), e.clientX, e.clientY);
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); hideTip(); }
    hit.addEventListener('pointermove', function (e) {
      var q = point(svg, e), xv = cfg.x0 + (q.x - m.l) / (W - m.l - m.r) * (cfg.x1 - cfg.x0);
      if (xv < cfg.x0 || xv > cfg.x1) return;
      show(xv, e);
      if (cfg.onMove) cfg.onMove(xv);
    });
    hit.addEventListener('pointerleave', function () { hide(); if (cfg.onLeave) cfg.onLeave(); });
    return { show: show, hide: hide, X: X, Y: Y, plot: { l: m.l, r: m.r, W: W } };
  }

  function nice(lo, hi, n) {
    if (!(hi > lo)) hi = lo + 1;
    var step = Math.pow(10, Math.floor(Math.log10((hi - lo) / n)));
    var s = [1, 2, 2.5, 5, 10].map(function (k) { return k * step; }).filter(function (k) { return (hi - lo) / k <= n; })[0] || step * 10;
    var out = [], v = Math.floor(lo / s) * s;
    for (; v < hi - 1e-9; v += s) out.push(+v.toFixed(6));
    out.push(+v.toFixed(6));
    return out;
  }

  // ---------- Grip used ----------
  function gg(svg, trace, color) {
    svg.innerHTML = '';
    svg.classList.add('tv-map');
    var W = 360, H = 360, cx = W / 2, cy = H / 2, R = 140, sc = R / 1.3;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    el('line', { x1: cx - R, x2: cx + R, y1: cy, y2: cy, stroke: C.axis }, svg);
    el('line', { x1: cx, x2: cx, y1: cy - R, y2: cy + R, stroke: C.axis }, svg);
    [0.5, 1.0].forEach(function (r) {
      el('circle', { cx: cx, cy: cy, r: r * sc, fill: 'none', stroke: C.axis, 'stroke-width': 1.5, 'stroke-dasharray': r === 1 ? '' : '4 4' }, svg);
    });
    var dots = el('g', {}, svg);
    trace.forEach(function (p) {
      var x = Math.max(-1.3, Math.min(1.3, p[5])), y = Math.max(-1.3, Math.min(1.3, p[6]));
      el('circle', { cx: cx + x * sc, cy: cy - y * sc, r: 2.2, fill: color || C.s1, 'fill-opacity': 0.45 }, dots);
    });
    // Labels on top of the dots, dark and bold, kept the same size when
    // zoomed in (each is a group scaled back by the zoom).
    var fixed = [];
    function label(x, y, s2, anchor, pill) {
      var g = el('g', {}, svg);
      fixed.push({ g: g, x: x, y: y });
      var w = s2.length * 7.2 + 12;
      var bx = anchor === 'middle' ? -w / 2 : anchor === 'end' ? -w : 0;
      el('rect', { x: bx, y: -12, width: w, height: 18, rx: 9, fill: '#ffffff', 'fill-opacity': pill ? 0.95 : 0.85, stroke: pill ? C.axis : 'none' }, g);
      text(g, bx + w / 2, 2, s2, { 'text-anchor': 'middle', 'font-size': pill ? 11 : 12.5, 'font-weight': 700, fill: pill ? C.steel : C.ink });
      g.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
    }
    label(cx + 0.5 * sc * 0.72, cy - 0.5 * sc * 0.72, '0.5 g', 'middle', true);
    label(cx + 1.0 * sc * 0.72, cy - 1.0 * sc * 0.72, '1.0 g', 'middle', true);
    label(cx, cy - R - 4, 'Accelerating', 'middle');
    label(cx, cy + R + 10, 'Braking', 'middle');
    label(cx - R + 4, cy - 14, 'Cornering', 'start');
    label(cx + R - 4, cy - 14, 'Cornering', 'end');
    zoomControls(svg, { W: W, H: H, pts: [[cx, cy]], onZoom: function (k) {
      fixed.forEach(function (f) { f.g.setAttribute('transform', 'translate(' + f.x + ' ' + f.y + ') scale(' + (1 / k) + ')'); });
      dots.querySelectorAll('circle').forEach(function (c) { c.setAttribute('r', 2.2 / Math.sqrt(k)); });
    } });
  }

  // ---------- Best lap per session ----------
  // points [{ date, time, wet, mine, label }], mods [{ date 'YYYY-MM', label }]
  function timeline(svg, points, mods) {
    svg.innerHTML = '';
    var W = width(svg, 900), H = 300;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    if (!points.length) return;
    var m = { l: 56, r: 20, t: 36, b: 30 };
    function day(s) { return Date.parse(s.length === 7 ? s + '-15' : s) / 864e5; }
    var ds = points.map(function (p) { return day(p.date); }).concat((mods || []).map(function (md) { return day(md.date); }));
    var x0 = Math.min.apply(null, ds) - 20, x1 = Math.max.apply(null, ds) + 20;
    var ts = points.map(function (p) { return p.time; });
    var tmin = Math.min.apply(null, ts), tmax = Math.max.apply(null, ts);
    var span = Math.max(2, tmax - tmin), y0 = Math.floor(tmin - span * 0.15), y1 = Math.ceil(tmax + span * 0.15);
    function X(v) { return m.l + (v - x0) / ((x1 - x0) || 1) * (W - m.l - m.r); }
    function Y(v) { return m.t + (v - y0) / ((y1 - y0) || 1) * (H - m.t - m.b); }
    nice(y0, y1, 5).forEach(function (v) {
      if (v < y0 || v > y1) return;
      el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: C.grid }, svg);
      text(svg, m.l - 8, Y(v) + 4, fmtLap(v).replace(/\.\d+$/, ''), { 'text-anchor': 'end' });
    });
    var months = Math.max(1, Math.round((x1 - x0) / 30)), every = Math.ceil(months / (W < 600 ? 3 : 6));
    var d0 = new Date(x0 * 864e5);
    for (var k = 0; k <= months + 1; k += every) {
      var dd = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k + 1, 1));
      var xv = dd.getTime() / 864e5;
      if (xv < x0 || xv > x1) continue;
      text(svg, X(xv), H - 8, dd.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }), { 'text-anchor': 'middle' });
    }
    var narrow = W < 600;
    (mods || []).forEach(function (md, i) {
      var x = X(day(md.date));
      el('line', { x1: x, x2: x, y1: m.t - 6, y2: H - m.b, stroke: C.orange, 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }, svg);
      var right = x > W * 0.6;
      text(svg, right ? x - 6 : x + 6, m.t - 14 - (i % 2) * 0, narrow ? md.label.split(':')[0] : md.label, { 'text-anchor': right ? 'end' : 'start', fill: C.orangeInk, 'font-weight': 600 });
    });
    var dry = points.filter(function (p) { return !p.wet; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (dry.length > 1) el('path', { d: dry.map(function (p, i) { return (i ? 'L' : 'M') + X(day(p.date)) + ',' + Y(p.time); }).join(' '), fill: 'none', stroke: C.s1, 'stroke-width': 2 }, svg);
    points.forEach(function (p) {
      var cx = X(day(p.date)), cy = Y(p.time);
      var c = el('circle', { cx: cx, cy: cy, r: p.mine ? 7 : 6, fill: p.wet ? C.card : C.s1, stroke: p.wet ? C.s1 : C.card, 'stroke-width': 2 }, svg);
      var hit = el('circle', { cx: cx, cy: cy, r: 18, fill: 'transparent' }, svg);
      hit.addEventListener('pointermove', function (e) {
        tip('<b>' + esc(p.label) + '</b>' + row('Best lap', fmtLap(p.time)) + row('Conditions', esc(p.conditions || 'Dry') + (p.temp != null ? ', ' + p.temp + '°C' : '')), e.clientX, e.clientY);
      });
      hit.addEventListener('pointerleave', hideTip);
      if (p.onClick) { hit.style.cursor = 'pointer'; hit.addEventListener('click', p.onClick); }
      void c;
    });
  }

  // ---------- Drag runs: speed against time ----------
  function drag(svg, runs, colors) {
    var tmax = 0, vmax = 0;
    runs.forEach(function (r) { (r.curve || []).forEach(function (p) { tmax = Math.max(tmax, p[0]); vmax = Math.max(vmax, spd(p[1])); }); });
    var yt = nice(0, vmax, 5), xt = nice(0, tmax, 6).filter(function (v) { return v <= tmax; });
    function at(r, x) { var c = r.curve || []; for (var i = 1; i < c.length; i++) if (c[i][0] >= x) { var f = (x - c[i - 1][0]) / ((c[i][0] - c[i - 1][0]) || 1); return spd(c[i - 1][1] + f * (c[i][1] - c[i - 1][1])); } return null; }
    return line(svg, {
      H: 230, x0: 0, x1: tmax || 1, y0: 0, y1: yt[yt.length - 1], xt: xt, yt: yt, xf: function (v) { return v + ' s'; },
      series: runs.map(function (r, i) { return { color: colors[i], pts: (r.curve || []).map(function (p) { return [p[0], spd(p[1])]; }), at: function (x) { return at(r, x); } }; }),
      tip: function (x, vals) { return '<b>' + x.toFixed(1) + ' s</b>' + vals.map(function (v, i) { return v == null ? '' : row('Run ' + (i + 1), Math.round(v) + ' ' + unit(), colors[i]); }).join(''); }
    });
  }

  window.MT3UKTrackView = {
    map: map, line: line, gg: gg, timeline: timeline, drag: drag, nice: nice, ramp: ramp,
    fmtLap: fmtLap, fmtV: fmtV, fmtD: fmtD, distK: distK, spd: spd, unit: unit, units: units, setMph: setMph, esc: esc, tip: tip, hideTip: hideTip, row: row, traceAt: traceAt, point: point, colors: C
  };
})();
