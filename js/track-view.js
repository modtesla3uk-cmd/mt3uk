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
  var C = { s1: '#2a78d6', s2: '#eb6834', ink: '#16233d', steel: '#6b7385', grid: 'rgba(22,35,61,.08)', axis: 'rgba(22,35,61,.24)', card: '#ffffff', orange: '#e8542a', orangeInk: '#b8421f', rampLo: '#b7d3f6', rampMid: '#3987e5', rampHi: '#0d366b', hair: 'rgba(22,35,61,.12)' };
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
    for (var k in attrs) e.setAttribute(k, attrs[k]);
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
    var W = Math.min(640, width(svg, 600)), H = Math.round(W * (opts.tall ? 0.62 : 0.7));
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
    el('polyline', { points: trace.map(function (p) { return P(p[2], p[3]).join(','); }).join(' '), fill: 'none', stroke: C.hair, 'stroke-width': 14, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    for (var i = 1; i < trace.length; i++) {
      var a = P(trace[i - 1][2], trace[i - 1][3]), b = P(trace[i][2], trace[i][3]);
      el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: opts.mono ? C.steel : ramp((trace[i][4] - vmin) / ((vmax - vmin) || 1)), 'stroke-width': opts.mono ? 3 : 5, 'stroke-linecap': 'round' }, svg);
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
    if (opts.startLine) {
      var sa = P(opts.startLine[0][0], opts.startLine[0][1]), sb = P(opts.startLine[1][0], opts.startLine[1][1]);
      var mx = (sa[0] + sb[0]) / 2, my = (sa[1] + sb[1]) / 2, dx = sb[0] - sa[0], dy = sb[1] - sa[1], L = Math.hypot(dx, dy) || 1;
      var sm = marker(mx, my);
      el('line', { x1: -dx / L * 14, y1: -dy / L * 14, x2: dx / L * 14, y2: dy / L * 14, stroke: C.ink, 'stroke-width': 3 }, sm.g);
      text(sm.g, 18, 5, 'Start / finish', { 'font-size': 13, fill: C.ink });
    }
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
    var zoom = zoomControls(svg, { W: W, H: H, pts: trace.map(function (p) { return P(p[2], p[3]); }), onZoom: function (kk) {
      k = kk;
      fixed.forEach(function (m) { moveMarker(m, m.x, m.y); });
    } });
    return { vmin: vmin, vmax: vmax, placeA: function (p) { place(dotA, p); }, placeB: function (p) { place(dotB, p); }, P: P, marker: marker, zoom: zoom };
  }

  // Zoom and pan for a map: + / - / reset buttons, the mouse wheel, a pinch,
  // and dragging once zoomed in. It works on the SVG viewBox, so point()
  // keeps mapping taps to the right place. A drag that pans isn't a click.
  var ZOOM_MAX = 8;
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
      reset.hidden = kk <= 1.01;
      cfg.onZoom(kk);
    }
    function zoomAt(f, cx, cy) {
      var nw = Math.max(W / ZOOM_MAX, Math.min(W, vb.w / f)), nh = nw * H / W;
      if (cx == null) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; }
      vb.x = cx - (cx - vb.x) * nw / vb.w; vb.y = cy - (cy - vb.y) * nh / vb.h;
      vb.w = nw; vb.h = nh;
      clamp(); set();
    }
    function clamp() {
      vb.x = Math.max(0, Math.min(W - vb.w, vb.x));
      vb.y = Math.max(0, Math.min(H - vb.h, vb.y));
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
    var reset = btn('tv-zoom-reset', 'Show the whole track', 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
    box.appendChild(plus); box.appendChild(minus); box.appendChild(reset);
    wrap.appendChild(box);
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
    var pts = {}, start = null, dragged = false;
    function count() { return Object.keys(pts).length; }
    function onDown(e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      dragged = false;
      start = { vb: Object.assign({}, vb), pts: JSON.parse(JSON.stringify(pts)) };
    }
    function onMove(e) {
      if (!pts[e.pointerId] || !start) return;
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
      vb.x = start.vb.x - mx * u; vb.y = start.vb.y - my * u;
      clamp(); set();
      e.preventDefault();
    }
    function onUp(e) {
      delete pts[e.pointerId];
      start = count() ? { vb: Object.assign({}, vb), pts: JSON.parse(JSON.stringify(pts)) } : null;
    }
    function onClick(e) { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('click', onClick, true);
    svg._zoomOff = function () {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('click', onClick, true);
    };
    set();
    return { zoomAt: zoomAt, busy: function () { return count() > 1 || dragged; }, k: function () { return W / vb.w; } };
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
    var m = { l: 46, r: 12, t: 12, b: 28 };
    function X(v) { return m.l + (v - cfg.x0) / ((cfg.x1 - cfg.x0) || 1) * (W - m.l - m.r); }
    function Y(v) { return H - m.b - (v - cfg.y0) / ((cfg.y1 - cfg.y0) || 1) * (H - m.t - m.b); }
    cfg.yt.forEach(function (v) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: v === cfg.zero ? C.axis : C.grid }, svg);
      text(svg, m.l - 8, Y(v) + 4, cfg.yf ? cfg.yf(v) : String(v), { 'text-anchor': 'end' });
    });
    cfg.xt.forEach(function (v) { text(svg, X(v), H - 8, cfg.xf ? cfg.xf(v) : String(v), { 'text-anchor': 'middle' }); });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: C.axis }, svg);
    if (cfg.under) cfg.under(svg, X, Y);
    cfg.series.forEach(function (sr) {
      if (!sr.pts.length) return;
      if (sr.area) {
        var base = Y(cfg.zero || 0);
        el('path', { d: 'M' + X(sr.pts[0][0]) + ',' + base + ' ' + sr.pts.map(function (p) { return 'L' + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ') + ' L' + X(sr.pts[sr.pts.length - 1][0]) + ',' + base + 'Z', fill: sr.color, opacity: 0.12 }, svg);
      }
      el('path', { d: sr.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' '), fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    });
    var cross = el('line', { y1: m.t, y2: H - m.b, stroke: C.steel, 'stroke-width': 1, visibility: 'hidden' }, svg);
    var dots = cfg.series.map(function (sr) { return el('circle', { r: 4.5, fill: sr.color, stroke: C.card, 'stroke-width': 2, visibility: 'hidden' }, svg); });
    var hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' }, svg);
    function show(xv, e) {
      cross.setAttribute('x1', X(xv)); cross.setAttribute('x2', X(xv)); cross.setAttribute('visibility', 'visible');
      var vals = cfg.series.map(function (sr, i) {
        var v = sr.at(xv);
        if (v == null || !isFinite(v)) { dots[i].setAttribute('visibility', 'hidden'); return v; }
        dots[i].setAttribute('cx', X(xv)); dots[i].setAttribute('cy', Y(v)); dots[i].setAttribute('visibility', 'visible');
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
    return { show: show, hide: hide, X: X, Y: Y };
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
    var W = 360, H = 360, cx = W / 2, cy = H / 2, R = 140, sc = R / 1.3;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    [0.5, 1.0].forEach(function (r) {
      el('circle', { cx: cx, cy: cy, r: r * sc, fill: 'none', stroke: C.grid, 'stroke-width': 1.5, 'stroke-dasharray': r === 1 ? '' : '3 4' }, svg);
      text(svg, cx + 4, cy - r * sc - 4, r.toFixed(1) + ' g');
    });
    el('line', { x1: cx - R, x2: cx + R, y1: cy, y2: cy, stroke: C.grid }, svg);
    el('line', { x1: cx, x2: cx, y1: cy - R, y2: cy + R, stroke: C.grid }, svg);
    text(svg, cx, cy - R - 6, 'Accelerate', { 'text-anchor': 'middle', fill: C.steel });
    text(svg, cx, cy + R + 18, 'Brake', { 'text-anchor': 'middle', fill: C.steel });
    text(svg, cx - R + 2, cy - 6, 'Cornering', { fill: C.steel });
    text(svg, cx + R - 2, cy - 6, 'Cornering', { 'text-anchor': 'end', fill: C.steel });
    trace.forEach(function (p) {
      var x = Math.max(-1.3, Math.min(1.3, p[5])), y = Math.max(-1.3, Math.min(1.3, p[6]));
      el('circle', { cx: cx + x * sc, cy: cy - y * sc, r: 2.2, fill: color || C.s1, 'fill-opacity': 0.4 }, svg);
    });
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
