/*
  The picture a shared Track Sessions link previews with, drawn on a canvas (1200 x 630, the size link previews
  use): a session's map coloured by speed with its corners and start line, beside the wordmark, the best lap, top
  speed and grip, and a chart of two laps' cornering g. Used by the admin page, which saves the result to the
  bucket. A photo can be fitted to the same size instead.
*/
(function (root) {
  var W = 1200, H = 630, MAPW = 700;
  var RAMP = ['#ffd83d', '#f58a1f', '#d7191c'];
  var INK = '#16233d', STEEL = '#6b7385', PAPER = '#f6f3ee', HAIR = 'rgba(22,35,61,.14)', GRID = 'rgba(22,35,61,.08)', MAPBG = '#ffffff';
  var BLUE = '#2a78d6', ORANGE = '#eb6834';
  var HEAD = '"Archivo Expanded", "Arial Black", Arial, sans-serif', BODY = '"IBM Plex Sans", Arial, sans-serif';
  function hex(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function ramp(t) {
    var s = RAMP.map(hex), u = Math.max(0, Math.min(1, t)) * 2, i = Math.min(1, Math.floor(u)), f = u - i;
    return 'rgb(' + s[i].map(function (v, j) { return Math.round(v + (s[i + 1][j] - v) * f); }).join(',') + ')';
  }
  function fmtLap(t) { var cs = Math.round(t * 100 + 1e-7), m = Math.floor(cs / 6000), s = (cs - m * 6000) / 100; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); }
  function niceDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    if (!m) return d || '';
    return parseInt(m[3], 10) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m[2], 10) - 1] + ' ' + m[1];
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function ellipsize(c, text, max) {
    if (c.measureText(text).width <= max) return text;
    while (text.length > 1 && c.measureText(text + '...').width > max) text = text.slice(0, -1);
    return text.replace(/[ ,]+$/, '') + '...';
  }
  function tile(c, x, y, w, h, k, v, s) {
    c.fillStyle = '#ffffff'; roundRect(c, x, y, w, h, 10); c.fill(); c.strokeStyle = HAIR; c.lineWidth = 1; c.stroke();
    c.fillStyle = STEEL; c.font = '600 13px ' + BODY; c.fillText(k, x + 14, y + 24);
    c.fillStyle = INK; c.font = '800 23px ' + HEAD; c.fillText(ellipsize(c, v, w - 26), x + 14, y + 54);
    c.fillStyle = STEEL; c.font = '400 12px ' + BODY; c.fillText(ellipsize(c, s, w - 26), x + 14, y + 74);
  }
  // mph unless opts.unit is 'kmh'. opts.wordmark is a loaded Image. Throws when the session has no lap trace.
  function draw(canvas, s, opts) {
    opts = opts || {};
    var mph = opts.unit !== 'kmh', T = root.MT3UKTrack;
    var tr = s && s.trace && s.trace.laps && s.trace.laps[s.best];
    if (!tr || tr.length < 2) throw new Error('This session has no lap trace to draw.');
    canvas.width = W; canvas.height = H;
    var c = canvas.getContext('2d');
    c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
    // The map: every lap faintly, the best lap coloured by speed.
    c.fillStyle = MAPBG; c.fillRect(0, 0, MAPW, H);
    var all = Object.keys(s.trace.laps).map(function (k) { return s.trace.laps[k]; });
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    tr.forEach(function (p) { x0 = Math.min(x0, p[2]); x1 = Math.max(x1, p[2]); y0 = Math.min(y0, p[3]); y1 = Math.max(y1, p[3]); });
    var pad = 48, k = Math.min((MAPW - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((y1 - y0) || 1));
    var ox = (MAPW - k * (x1 - x0)) / 2, oy = (H - k * (y1 - y0)) / 2;
    function P(x, y) { return [ox + (x - x0) * k, H - oy - (y - y0) * k]; }
    c.lineCap = 'round'; c.lineJoin = 'round';
    all.forEach(function (lap) {
      if (lap === tr) return;
      c.strokeStyle = 'rgba(22,35,61,.13)'; c.lineWidth = 9; c.beginPath();
      lap.forEach(function (p, i) { var q = P(p[2], p[3]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.stroke();
    });
    var vs = tr.map(function (p) { return p[4]; }), vlo = Math.min.apply(null, vs), vhi = Math.max.apply(null, vs);
    c.strokeStyle = 'rgba(22,35,61,.9)'; c.lineWidth = 10; c.beginPath();
    tr.forEach(function (p, i) { var q = P(p[2], p[3]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.stroke();
    c.lineWidth = 5.5;
    for (var i = 1; i < tr.length; i++) {
      var a = P(tr[i - 1][2], tr[i - 1][3]), b = P(tr[i][2], tr[i][3]);
      c.strokeStyle = ramp((tr[i][4] - vlo) / ((vhi - vlo) || 1)); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    }
    // Start line, when the session has one, across the track at its place.
    if (s.startLine && s.startLine.length === 2 && s.origin && T && T.projector) {
      var proj = T.projector(s.origin[0], s.origin[1]), la = proj.xy(s.startLine[0][0], s.startLine[0][1]), lb = proj.xy(s.startLine[1][0], s.startLine[1][1]);
      var pa = P(la[0], la[1]), pb = P(lb[0], lb[1]), mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2, dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy) || 1;
      dx = dx / len * 16; dy = dy / len * 16;
      c.strokeStyle = '#ffffff'; c.lineWidth = 9; c.beginPath(); c.moveTo(mx - dx, my - dy); c.lineTo(mx + dx, my + dy); c.stroke();
      c.strokeStyle = INK; c.lineWidth = 4; c.beginPath(); c.moveTo(mx - dx, my - dy); c.lineTo(mx + dx, my + dy); c.stroke();
      c.fillStyle = INK; c.font = '700 15px ' + BODY; c.fillText('Start / finish', mx + 22, my + 5);
    }
    (s.corners || []).forEach(function (cn) {
      var q = P(cn.x, cn.y);
      c.fillStyle = '#ffffff'; c.strokeStyle = INK; c.lineWidth = 2;
      c.beginPath(); c.arc(q[0], q[1], 13, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = INK; c.font = '700 13px ' + BODY; c.textAlign = 'center'; c.fillText(String(cn.n), q[0], q[1] + 4.5); c.textAlign = 'left';
    });
    // Speed key, top left of the map.
    function spd(v) { return Math.round(mph ? v / 1.609344 : v) + (mph ? ' mph' : ' km/h'); }
    c.font = '500 15px ' + BODY;
    var lo = spd(vlo), hi = spd(vhi), kw = c.measureText(lo).width + c.measureText(hi).width + 110 + 44;
    c.fillStyle = '#ffffff'; roundRect(c, 20, 20, kw, 34, 17); c.fill(); c.strokeStyle = HAIR; c.lineWidth = 1; c.stroke();
    c.fillStyle = STEEL; c.fillText(lo, 34, 42);
    var g = c.createLinearGradient(44 + c.measureText(lo).width, 0, 44 + c.measureText(lo).width + 110, 0);
    RAMP.forEach(function (col, i) { g.addColorStop(i / 2, col); });
    c.fillStyle = g; roundRect(c, 44 + c.measureText(lo).width, 33, 110, 8, 4); c.fill();
    c.fillStyle = STEEL; c.fillText(hi, 44 + c.measureText(lo).width + 122, 42);
    c.fillStyle = HAIR; c.fillRect(MAPW - 1, 0, 1, H);
    // The panel.
    var px = MAPW + 36, pw = W - MAPW - 72;
    if (opts.wordmark && opts.wordmark.naturalWidth) { var wh = 34, ww = wh * opts.wordmark.naturalWidth / opts.wordmark.naturalHeight; c.drawImage(opts.wordmark, px, 34, ww, wh); }
    c.fillStyle = STEEL; c.font = '600 14px ' + BODY; c.textAlign = 'right'; c.fillText('Track sessions', W - 36, 56); c.textAlign = 'left';
    var title = (s.venue || 'Track session') + (s.layout && s.layout !== s.venue ? ', ' + s.layout : '');
    c.fillStyle = INK; c.font = '800 32px ' + HEAD;
    var words = title.split(' '), lines = [''], li = 0;
    words.forEach(function (w) { var t = (lines[li] ? lines[li] + ' ' : '') + w; if (c.measureText(t).width > pw && lines[li]) { lines.push(w); li++; } else lines[li] = t; });
    lines = lines.slice(0, 2);
    lines.forEach(function (l, i) { c.fillText(ellipsize(c, l, pw), px, 116 + i * 38); });
    var ty = 116 + lines.length * 38;
    var timed = (s.laps || []).filter(function (l) { return l.kind === 'timed'; }).length, best = (s.laps || []).filter(function (l) { return l.n === s.best; })[0];
    c.fillStyle = STEEL; c.font = '400 16px ' + BODY;
    c.fillText(ellipsize(c, niceDate(s.date) + (s.time ? ', ' + s.time : '') + '. ' + (s.laps || []).length + ' laps, ' + timed + ' timed. Every lap mapped, timed and compared.', pw), px, ty + 2);
    // Tiles.
    var tw = (pw - 20) / 3, tyy = ty + 26;
    tile(c, px, tyy, tw, 88, 'Best lap', best ? fmtLap(best.time) : '-', best ? 'Lap ' + s.best + ' of ' + (s.laps || []).length : '');
    tile(c, px + tw + 10, tyy, tw, 88, 'Top speed', s.vmax ? spd(s.vmax) : '-', 'This session');
    tile(c, px + 2 * (tw + 10), tyy, tw, 88, 'Most grip', s.latMax ? s.latMax.toFixed(2) + ' g' : '-', s.brakeMax ? 'Braking ' + s.brakeMax.toFixed(2) + ' g' : '');
    // Chart: cornering g of the best lap and the next best, in the cars' blue and orange.
    var cy = tyy + 100, ch = H - cy - 30;
    c.fillStyle = '#ffffff'; roundRect(c, px, cy, pw, ch, 10); c.fill(); c.strokeStyle = HAIR; c.lineWidth = 1; c.stroke();
    var other = (s.laps || []).filter(function (l) { return l.kind === 'timed' && l.n !== s.best; }).sort(function (a, b) { return a.time - b.time; })[0];
    var trB = other && s.trace.laps[other.n];
    c.fillStyle = INK; c.font = '600 13px ' + BODY; c.fillText('Cornering g, lap against lap', px + 14, cy + 24);
    var lx = px + pw - 14;
    function keyItem(label, col) { c.font = '500 12px ' + BODY; var wd = c.measureText(label).width; lx -= wd; c.fillStyle = STEEL; c.fillText(label, lx, cy + 24); lx -= 24; c.fillStyle = col; c.fillRect(lx, cy + 19, 18, 3); lx -= 14; }
    if (trB) keyItem('Lap ' + other.n, ORANGE);
    keyItem('Lap ' + s.best + (trB ? ' (best)' : ''), BLUE);
    var gx = px + 46, gw = pw - 60, gy0 = cy + 40, gh = ch - 72, tEnd = Math.max(tr[tr.length - 1][1], trB ? trB[trB.length - 1][1] : 0) || 1;
    function sm(t) { return t.map(function (p, i) { var n = 0, v = 0; for (var j = Math.max(0, i - 2); j <= Math.min(t.length - 1, i + 2); j++) { v += t[j][5]; n++; } return [p[1], v / n]; }); }
    var ga = sm(tr), gb = trB ? sm(trB) : null, gm = 0.5;
    [ga, gb].forEach(function (a) { if (a) a.forEach(function (p) { gm = Math.max(gm, Math.abs(p[1])); }); });
    gm = Math.ceil(gm * 2) / 2;
    function X(t) { return gx + t / tEnd * gw; }
    function Y(v) { return gy0 + gh / 2 - v / gm * gh / 2; }
    c.font = '400 11px ' + BODY; c.textAlign = 'right';
    [-gm, -gm / 2, 0, gm / 2, gm].forEach(function (v) { c.strokeStyle = v === 0 ? 'rgba(22,35,61,.3)' : GRID; c.lineWidth = 1; c.beginPath(); c.moveTo(gx, Y(v)); c.lineTo(gx + gw, Y(v)); c.stroke(); c.fillStyle = STEEL; c.fillText(v + ' g', gx - 6, Y(v) + 4); });
    c.textAlign = 'center';
    for (var t = 0; t <= tEnd; t += tEnd > 150 ? 30 : 15) { var mm = Math.floor(t / 60), ss = Math.round(t - mm * 60); c.fillText(mm + ':' + (ss < 10 ? '0' : '') + ss, X(t), gy0 + gh + 18); }
    c.textAlign = 'left';
    [[gb, ORANGE], [ga, BLUE]].forEach(function (pair) {
      if (!pair[0]) return;
      c.strokeStyle = pair[1]; c.lineWidth = 1.8; c.beginPath();
      pair[0].forEach(function (p, i) { if (i) c.lineTo(X(p[0]), Y(p[1])); else c.moveTo(X(p[0]), Y(p[1])); }); c.stroke();
    });
    return canvas;
  }
  // A photo fitted to the size, cropped to fill.
  function photo(canvas, img) {
    canvas.width = W; canvas.height = H;
    var c = canvas.getContext('2d'), k = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
    c.fillStyle = MAPBG; c.fillRect(0, 0, W, H);
    c.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return canvas;
  }
  // A JPEG no bigger than maxBytes (chat apps drop previews much over 300 KB), as a Blob.
  function toJpeg(canvas, maxBytes) {
    maxBytes = maxBytes || 290000;
    return new Promise(function (resolve, reject) {
      var q = 0.88;
      (function attempt() {
        canvas.toBlob(function (b) {
          if (!b) { reject(new Error('Could not make the picture.')); return; }
          if (b.size <= maxBytes || q <= 0.5) resolve(b); else { q -= 0.08; attempt(); }
        }, 'image/jpeg', q);
      })();
    });
  }
  root.MT3UKTrackShareCard = { draw: draw, photo: photo, toJpeg: toJpeg, W: W, H: H };
})(window);
