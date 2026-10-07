/*
  The Laps by MT3UK logo mark, in four directions the admin can choose between on the Laps logo panel of
  track-admin.html (one KV key, laps-logo; the public GET /laps/logo says which). This one file holds every mark:
    - the inline SVG for the header and footer (.laps-logo-mark: ink parts follow the text colour, the accent is the
      brand orange),
    - the same mark on canvas, for the sharing card (js/track-share-card.js),
    - the tile (white mark on navy) used for the favicon and the home screen icon.
  On a Laps page it swaps the header and footer marks, the favicon and the touch icon to the chosen one, straight away
  from the browser's last answer (localStorage mt3ukLapsLogo) and then from the worker. The default is the lap timer,
  which is also what the page files carry, so nothing changes until a different mark is chosen.
*/
(function (root) {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev', KEY = 'mt3ukLapsLogo';
  var OR = '#e8542a', INK = '#16233d', NAVY = '#16233d';
  var OPTIONS = [
    { id: 'timer', name: 'Lap timer', about: 'A ring one lap from the line: the time, at a glance.' },
    { id: 'loop', name: 'Lap loop', about: 'A circuit with the start and finish line and the car.' },
    { id: 'ramp', name: 'Speed-ramp L', about: 'An L in the yellow to red speed colouring of the maps.' },
    { id: 'chevron', name: 'Double chevron', about: 'Two chevrons: you and the lap you are chasing.' }
  ];
  var LOOP = 'M13 41C7 30 13 15 28 13C38 12 41 23 49 23C59 23 61 37 51 45C43 51 37 44 31 48C25 52 18 52 13 41Z';
  function known(id) { return OPTIONS.some(function (o) { return o.id === id; }) ? id : 'timer'; }
  // The mark's SVG content in a 64 unit box. fg is the ink colour (currentColor in the header and footer).
  function inner(id, fg) {
    fg = fg || 'currentColor';
    switch (known(id)) {
      case 'loop':
        return '<path d="' + LOOP + '" fill="none" stroke="' + fg + '" stroke-width="5" stroke-linejoin="round"/><path d="M8 44 20 38" stroke="' + OR + '" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="23.2" r="4.2" fill="' + OR + '"/>';
      case 'ramp':
        return '<defs><linearGradient id="lapsRamp" gradientUnits="userSpaceOnUse" x1="16" y1="8" x2="56" y2="54"><stop offset="0" stop-color="#ffd83d"/><stop offset=".55" stop-color="#f58a1f"/><stop offset="1" stop-color="#d7191c"/></linearGradient></defs><path d="M17 9V42Q17 55 30 55H55" fill="none" stroke="url(#lapsRamp)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>';
      case 'chevron':
        return '<path d="M10 12 30 32 10 52" fill="none" stroke="' + OR + '" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 12 50 32 30 52" fill="none" stroke="' + fg + '" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>';
      default:
        return '<rect x="27" y="3" width="10" height="6" rx="2" fill="' + fg + '"/><circle cx="32" cy="36" r="21" fill="none" stroke="' + fg + '" stroke-opacity=".22" stroke-width="7"/><path d="M32 15A21 21 0 1 1 11 36" fill="none" stroke="' + OR + '" stroke-width="7" stroke-linecap="round"/><path d="M32 36 43 25" stroke="' + fg + '" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="36" r="3.4" fill="' + fg + '"/>';
    }
  }
  // The mark on a navy rounded square, as a standalone SVG: the favicon and the home screen icon.
  function tile(id, size, radius, scale) {
    var s = scale || 0.78, off = (64 - 64 * s) / 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + '><rect width="64" height="64" rx="' + (radius == null ? 14 : radius) + '" fill="' + NAVY + '"/><g transform="translate(' + off + ' ' + off + ') scale(' + s + ')">' + inner(id, '#ffffff') + '</g></svg>';
  }
  // The same mark on a canvas (x, y, size: its 64 unit box scaled to size), ink is the colour of its dark parts.
  function draw(c, x, y, size, id, ink) {
    ink = ink || INK;
    var k = size / 64;
    c.save(); c.translate(x, y); c.scale(k, k); c.lineCap = 'round'; c.lineJoin = 'round';
    function rr(rx, ry, w, h, r) { c.beginPath(); c.moveTo(rx + r, ry); c.arcTo(rx + w, ry, rx + w, ry + h, r); c.arcTo(rx + w, ry + h, rx, ry + h, r); c.arcTo(rx, ry + h, rx, ry, r); c.arcTo(rx, ry, rx + w, ry, r); c.closePath(); }
    switch (known(id)) {
      case 'loop':
        c.strokeStyle = ink; c.lineWidth = 5; c.stroke(new Path2D(LOOP));
        c.strokeStyle = OR; c.beginPath(); c.moveTo(8, 44); c.lineTo(20, 38); c.stroke();
        c.fillStyle = OR; c.beginPath(); c.arc(50, 23.2, 4.2, 0, Math.PI * 2); c.fill();
        break;
      case 'ramp':
        var g = c.createLinearGradient(16, 8, 56, 54); g.addColorStop(0, '#ffd83d'); g.addColorStop(0.55, '#f58a1f'); g.addColorStop(1, '#d7191c');
        c.strokeStyle = g; c.lineWidth = 10; c.beginPath(); c.moveTo(17, 9); c.lineTo(17, 42); c.quadraticCurveTo(17, 55, 30, 55); c.lineTo(55, 55); c.stroke();
        break;
      case 'chevron':
        c.lineWidth = 9;
        c.strokeStyle = OR; c.beginPath(); c.moveTo(10, 12); c.lineTo(30, 32); c.lineTo(10, 52); c.stroke();
        c.strokeStyle = ink; c.beginPath(); c.moveTo(30, 12); c.lineTo(50, 32); c.lineTo(30, 52); c.stroke();
        break;
      default:
        c.fillStyle = ink; rr(27, 3, 10, 6, 2); c.fill();
        c.lineWidth = 7; c.strokeStyle = 'rgba(22,35,61,.22)'; c.beginPath(); c.arc(32, 36, 21, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = OR; c.beginPath(); c.arc(32, 36, 21, -Math.PI / 2, Math.PI, false); c.stroke();
        c.strokeStyle = ink; c.lineWidth = 5; c.beginPath(); c.moveTo(32, 36); c.lineTo(43, 25); c.stroke();
        c.fillStyle = ink; c.beginPath(); c.arc(32, 36, 3.4, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  function current() { try { return known(localStorage.getItem(KEY)); } catch (e) { return 'timer'; } }
  function remember(id) { try { if (id === 'timer') localStorage.removeItem(KEY); else localStorage.setItem(KEY, id); } catch (e) {} }
  // Swaps the header and footer marks, the favicon and the touch icon to the chosen mark (the lap timer is what the
  // page files carry, so it is left as it is).
  function apply(id) {
    id = known(id || current());
    if (id === 'timer') return id;
    [].forEach.call(document.querySelectorAll('.laps-logo-mark'), function (svg) { svg.innerHTML = inner(id, 'currentColor'); svg.setAttribute('data-logo', id); });
    var icons = [].slice.call(document.querySelectorAll('link[rel="icon"]')), svgLink = icons.filter(function (l) { return /svg/.test(l.type || ''); })[0];
    if (!svgLink) { svgLink = document.createElement('link'); svgLink.rel = 'icon'; svgLink.type = 'image/svg+xml'; document.head.appendChild(svgLink); }
    icons.forEach(function (l) { if (l !== svgLink) l.remove(); });
    svgLink.href = 'data:image/svg+xml,' + encodeURIComponent(tile(id));
    var touch = document.querySelector('link[rel="apple-touch-icon"]');
    if (touch) touch.href = 'images/laps/' + id + '/apple-touch-icon.png';
    return id;
  }
  // What the worker says is chosen: remembered for the next load, and applied now if it changed.
  function load() {
    return fetch(API + '/laps/logo', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var id = known(d && d.success ? d.logo : current());
      if (id !== current()) { remember(id); if (id === 'timer') { location.reload(); } else apply(id); }
      return id;
    }).catch(function () { return current(); });
  }
  root.MT3UKLapsLogo = { options: OPTIONS, inner: inner, tile: tile, draw: draw, current: current, remember: remember, apply: apply, load: load, known: known };
  function boot() { if (document.querySelector('.laps-logo-mark')) { apply(current()); load(); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // A shared page swaps its Laps footer in once it has loaded: mark that one too.
  window.addEventListener('load', function () { if (document.querySelector('.laps-logo-mark')) apply(current()); });
})(window);
