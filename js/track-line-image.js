/*
  Pictures of a course's start and finish lines, for the emails about a map edit: the satellite view with the
  start line (green) and the finish line (red) on it, drawn on a canvas in the browser and kept as a JPEG. The
  old lines and the new ones are drawn with the same framing so they can be compared side by side.

  MT3UKLineImage.make({ title, subtitle, lines: [{ line: [[lat, lng], [lat, lng]], kind: 'start' | 'finish', label }],
    frame: [[lat, lng], ...] (the points the view must fit), outline: [[lat, lng], ...] (the drive, drawn faintly) })
    -> Promise of a JPEG Blob.

  The imagery is Esri World Imagery, the same as the maps on the site. If it cannot be drawn onto a canvas (a
  tile server that will not share its pictures with a page, or no connection), the picture is the drive's trace
  on a plain background instead, so a change never waits on it.
*/
(function (root) {
  var SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/';
  var W = 1000, H = 600, MAX_ZOOM = 18, GREEN = '#1baf7a', RED = '#d33a2c';

  // Web Mercator: a position as pixels on the whole world at a zoom.
  function world(lat, lng, z) {
    var n = 256 * Math.pow(2, z), r = lat * Math.PI / 180;
    return [(lng + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
  }
  function load(url) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = url;
    });
  }
  // The closest zoom that still leaves the framed points inside the middle of the picture.
  function pickZoom(pts) {
    for (var z = MAX_ZOOM; z >= 12; z--) {
      var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach(function (p) { var w = world(p[0], p[1], z); x0 = Math.min(x0, w[0]); x1 = Math.max(x1, w[0]); y0 = Math.min(y0, w[1]); y1 = Math.max(y1, w[1]); });
      if (x1 - x0 <= W * 0.5 && y1 - y0 <= H * 0.5) return z;
    }
    return 12;
  }
  function draw(opts, withImagery) {
    var frame = (opts.frame && opts.frame.length ? opts.frame : []).slice();
    (opts.lines || []).forEach(function (l) { if (l.line) frame = frame.concat(l.line); });
    if (!frame.length) return Promise.reject(new Error('Nothing to draw'));
    var z = pickZoom(frame), lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    frame.forEach(function (p) { var w = world(p[0], p[1], z); lo = [Math.min(lo[0], w[0]), Math.min(lo[1], w[1])]; hi = [Math.max(hi[0], w[0]), Math.max(hi[1], w[1])]; });
    var cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, ox = cx - W / 2, oy = cy - H / 2;
    function P(p) { var w = world(p[0], p[1], z); return [w[0] - ox, w[1] - oy]; }
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var c = canvas.getContext('2d');
    c.fillStyle = '#26301f'; c.fillRect(0, 0, W, H);
    var tiles = [];
    if (withImagery) {
      var tx0 = Math.floor(ox / 256), tx1 = Math.floor((ox + W) / 256), ty0 = Math.floor(oy / 256), ty1 = Math.floor((oy + H) / 256);
      for (var tx = tx0; tx <= tx1; tx++) for (var ty = ty0; ty <= ty1; ty++) tiles.push([tx, ty]);
    }
    return Promise.all(tiles.map(function (t) { return load(SAT + z + '/' + t[1] + '/' + t[0]).then(function (im) { return { t: t, im: im }; }); })).then(function (got) {
      var drawn = 0;
      got.forEach(function (g) { if (g.im) { c.drawImage(g.im, g.t[0] * 256 - ox, g.t[1] * 256 - oy, 256, 256); drawn++; } });
      // The drive, faint, so the lines can be seen against where the car went (and a picture with no imagery still says something).
      if (opts.outline && opts.outline.length > 1) {
        c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath();
        opts.outline.forEach(function (p, i) { var q = P(p); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
        c.stroke();
      }
      c.font = '700 15px Arial, sans-serif'; c.textAlign = 'center';
      (opts.lines || []).forEach(function (l) {
        if (!l.line) return;
        var a = P(l.line[0]), b = P(l.line[1]), colour = l.kind === 'finish' ? RED : GREEN;
        c.lineCap = 'round';
        c.strokeStyle = '#ffffff'; c.lineWidth = 9; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
        c.strokeStyle = colour; c.lineWidth = 5; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
        var mx = (a[0] + b[0]) / 2, my = Math.min(a[1], b[1]) - 14, label = l.label || (l.kind === 'finish' ? 'Finish' : 'Start');
        c.lineWidth = 4; c.strokeStyle = '#1a1a1a'; c.strokeText(label, mx, my); c.fillStyle = '#ffffff'; c.fillText(label, mx, my);
      });
      // What this picture is.
      c.textAlign = 'left';
      var title = opts.title || '', sub = opts.subtitle || '';
      c.font = '700 22px Arial, sans-serif';
      var bw = Math.max(c.measureText(title).width, sub ? (c.font = '400 16px Arial, sans-serif', c.measureText(sub).width) : 0) + 28;
      c.fillStyle = 'rgba(22,35,61,.88)'; c.fillRect(16, 16, bw, sub ? 62 : 40);
      c.fillStyle = '#ffffff'; c.font = '700 22px Arial, sans-serif'; c.fillText(title, 30, 44);
      if (sub) { c.font = '400 16px Arial, sans-serif'; c.fillText(sub, 30, 68); }
      c.textAlign = 'right'; c.font = '400 11px Arial, sans-serif'; c.fillStyle = 'rgba(255,255,255,.85)';
      c.fillText(drawn ? 'Imagery: Esri, Maxar, Earthstar Geographics' : 'No satellite imagery: the line is the drive', W - 10, H - 10);
      return canvas;
    });
  }
  function toBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try { canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('No picture')); }, 'image/jpeg', 0.85); } catch (e) { reject(e); }
    });
  }
  function make(opts) {
    // With imagery first; a canvas the browser will not export (tiles that were not shared) is drawn again without it.
    return draw(opts, true).then(toBlob).catch(function () { return draw(opts, false).then(toBlob); });
  }

  root.MT3UKLineImage = { make: make };
})(typeof window !== 'undefined' ? window : this);
