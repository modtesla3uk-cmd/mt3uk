/* Heading layout editor for the Laps pages, on when the address has ?layout=edit.
   Nothing here runs for a normal visit. In edit mode the heading's buttons and
   text are placed absolutely in the heading, so they can be dragged, resized and
   set to exact numbers. Positions are kept per page and per screen width (desktop
   above 900px, phone at or below it). Copy layout gives CSS lines for the page. */
(function () {
  if (!/[?&]layout=edit(&|$)/.test(location.search)) return;

  var ITEM_SEL = '.back-link, .tp-lb-pill, .tm-pill, h1, .tp-hero-actions, .tp-what, .tm-what';
  var PARA_SEL = ':scope > p';
  var hero, wrap, items = [], sel = null, snap = true, drag = null, gridPx = 8, showGrid = true, gridEl = null;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  // The four heading pages share one saved layout. An item is saved by its role (the lh-* class it carries), so the
  // same slot on each page is the same saved position.
  var ROLE_OF = { 'lh-title': 'title', 'lh-back': 'back', 'lh-s1': 's1', 'lh-s2': 's2', 'lh-s3': 's3', 'lh-intro': 'intro', 'lh-fold': 'intro' };
  var ROLES = ['title', 'back', 's1', 's2', 's3', 'intro'];
  var frameKey = location.pathname + ':' + (innerWidth > 900 ? 'desk' : 'phone');
  var STORE = 'mt3uk-layout-edit:' + frameKey;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null') || {}; } catch (e) { return {}; }
  }
  function save(data) {
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* not kept */ }
  }

  function visible(el) {
    if (el.hidden || el.closest('[hidden]')) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function roleOf(el) {
    var found = null;
    Object.keys(ROLE_OF).some(function (c) { if (el.classList.contains(c)) { found = ROLE_OF[c]; return true; } return false; });
    return found;
  }

  function nameOf(el, n) {
    var t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) t = el.tagName.toLowerCase();
    if (t.length > 28) t = t.slice(0, 28).trim();
    return n + ' ' + t;
  }

  function collect() {
    var list = Array.prototype.slice.call(hero.querySelectorAll(ITEM_SEL));
    list = list.concat(Array.prototype.slice.call(wrap.querySelectorAll(PARA_SEL)));
    list = list.filter(function (el, i, all) {
      if (!visible(el)) return false;
      // Skip anything that sits inside another item (the title's own icons and buttons).
      return !all.some(function (other) { return other !== el && other.contains(el); });
    });
    list.sort(function (a, b) {
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return list;
  }

  function start() {
    hero = document.querySelector('.page-hero');
    if (!hero) return;
    wrap = hero.querySelector('.wrap');
    document.documentElement.setAttribute('data-layout-edit', '');
    var base = wrap.getBoundingClientRect();
    var els = collect();
    var saved = load();
    var naturalH = wrap.offsetHeight;

    // Measure everything before moving anything, so the first layout is the real one.
    var measured = els.map(function (el, i) {
      var r = el.getBoundingClientRect();
      return {
        el: el,
        name: nameOf(el, i + 1),
        key: roleOf(el) || nameOf(el, i + 1),
        x: Math.round(r.left - base.left), y: Math.round(r.top - base.top),
        w: Math.round(r.width), h: Math.round(r.height),
        fs: Math.round(parseFloat(getComputedStyle(el).fontSize))
      };
    });

    wrap.style.position = 'relative';
    wrap.style.display = 'block';
    wrap.style.setProperty('height', (saved.H || naturalH) + 'px', 'important');
    wrap.style.minHeight = '0';
    gridEl = document.createElement('div');
    gridEl.className = 'layout-edit-grid';
    gridEl.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:0';
    wrap.insertBefore(gridEl, wrap.firstChild);
    drawGrid();
    // A handle along the bottom edge of the band: drag it up or down to change the band's height.
    var band = document.createElement('div');
    band.className = 'layout-edit-band';
    band.setAttribute('title', 'Drag to change the height of this band');
    band.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:12px;background:#e8542a;cursor:ns-resize;z-index:6;border-radius:6px';
    wrap.appendChild(band);
    band.addEventListener('pointerdown', function (e) {
      var start = { y: e.clientY, h: wrap.offsetHeight };
      band.setPointerCapture(e.pointerId);
      var move = function (ev) {
        wrap.style.setProperty('height', Math.max(120, snapv(start.h + (ev.clientY - start.y))) + 'px', 'important');
        fill();
      };
      var up = function () {
        band.removeEventListener('pointermove', move);
        band.removeEventListener('pointerup', up);
        band.removeEventListener('pointercancel', up);
        persist();
      };
      band.addEventListener('pointermove', move);
      band.addEventListener('pointerup', up);
      band.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    hero.style.boxSizing = 'border-box';

    measured.forEach(function (m) {
      var p = (saved.items && (saved.items[m.key] || saved.items[m.name])) || m;
      m.x = p.x; m.y = p.y; m.w = p.w; m.h = p.h; m.fs = p.fs; m.hide = !!p.hide;
      var el = m.el;
      el.dataset.layoutName = m.name;
      el.style.position = 'absolute';
      el.style.margin = '0';
      el.style.boxSizing = 'border-box';
      el.style.outline = '1px dashed rgba(232,84,42,.6)';
      el.style.cursor = 'move';
      el.style.zIndex = '5';
      el.style.overflow = 'hidden';
      var grip = document.createElement('span');
      grip.className = 'layout-edit-grip';
      grip.style.cssText = 'position:absolute;right:0;bottom:0;width:14px;height:14px;background:#e8542a;cursor:nwse-resize;border-top-left-radius:4px';
      el.appendChild(grip);
      el.addEventListener('pointerdown', down);
      items.push(m);
    });
    items.forEach(apply);
    if (!saved.H) saved.H = wrap.offsetHeight;
    wrap.style.setProperty('height', saved.H + 'px', 'important');
    panel();
    document.addEventListener('click', blockClicks, true);
    document.addEventListener('keydown', keys);
    window.addEventListener('resize', function () {
      // The frame is chosen by width. Say so rather than mixing the two.
      var bar = document.getElementById('layout-edit-bar');
      if (bar) bar.querySelector('.le-frame').textContent = frameLabel();
    });
  }

  function frameLabel() {
    return (innerWidth > 900 ? 'Desktop' : 'Phone') + ' layout, ' + innerWidth + ' px wide';
  }

  function apply(m) {
    var s = m.el.style;
    // Important, so the shared heading rules (which are !important) do not win over the saved positions.
    s.setProperty('left', m.x + 'px', 'important'); s.setProperty('top', m.y + 'px', 'important');
    s.setProperty('width', m.w + 'px', 'important'); s.setProperty('height', m.h + 'px', 'important');
    s.setProperty('font-size', m.fs + 'px', 'important');
    m.el.classList.toggle('layout-edit-sel', sel === m);
    m.el.style.opacity = m.hide ? '0.25' : '';
    if (sel === m) m.el.style.boxShadow = '0 0 0 2px #e8542a';
    else m.el.style.boxShadow = '';
  }

  function blockClicks(e) {
    if (hero && hero.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }

  function snapv(v) { return snap ? Math.round(v / gridPx) * gridPx : Math.round(v); }

  /* The grid is drawn behind the items; it follows the grid size and the show switch. */
  function drawGrid() {
    if (!gridEl) return;
    var line = 'rgba(255,255,255,.14)';
    gridEl.style.display = showGrid ? '' : 'none';
    gridEl.style.backgroundImage = 'linear-gradient(to right, ' + line + ' 1px, transparent 1px), linear-gradient(to bottom, ' + line + ' 1px, transparent 1px)';
    gridEl.style.backgroundSize = gridPx + 'px ' + gridPx + 'px';
  }

  function down(e) {
    var m = items.filter(function (x) { return x.el === this; }, this)[0];
    if (!m) return;
    select(m);
    drag = { m: m, mode: e.target.classList.contains('layout-edit-grip') ? 'resize' : 'move',
      sx: e.clientX, sy: e.clientY, x: m.x, y: m.y, w: m.w, h: m.h };
    m.el.setPointerCapture(e.pointerId);
    m.el.addEventListener('pointermove', move);
    m.el.addEventListener('pointerup', up);
    m.el.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  function move(e) {
    if (!drag) return;
    var m = drag.m, W = wrap.clientWidth, H = wrap.offsetHeight;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.mode === 'move') {
      m.x = Math.max(0, Math.min(W - m.w, snapv(drag.x + dx)));
      m.y = Math.max(0, Math.min(H - m.h, snapv(drag.y + dy)));
    } else {
      m.w = Math.max(40, Math.min(W - m.x, snapv(drag.w + dx)));
      m.h = Math.max(20, Math.min(H - m.y, snapv(drag.h + dy)));
    }
    apply(m);
    fill();
  }

  function up() {
    if (!drag) return;
    drag.m.el.removeEventListener('pointermove', move);
    drag.m.el.removeEventListener('pointerup', up);
    drag.m.el.removeEventListener('pointercancel', up);
    drag = null;
    persist();
  }

  function persist() {
    var data = { H: parseInt(wrap.style.height, 10), items: {} };
    items.forEach(function (m) {
      data.items[m.key] = { x: m.x, y: m.y, w: m.w, h: m.h, fs: m.fs, hide: !!m.hide };
    });
    save(data);
    fill();
  }

  function select(m) {
    sel = m;
    items.forEach(apply);
    fill();
  }

  /* Side panel: the selected item's numbers, the frame height, snap, copy and reset. */
  var bar, nameEl, inputs = {}, out;
  function panel() {
    bar = document.createElement('div');
    bar.id = 'layout-edit-bar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999;background:#16233d;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));box-shadow:0 -4px 16px rgba(0,0,0,.3);max-height:55vh;overflow:auto';
    bar.innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">' +
        '<strong class="le-frame">' + frameLabel() + '</strong>' +
        '<span><button type="button" data-le="panel" aria-expanded="false">Controls</button> <button type="button" data-le="grid">Grid: on</button> <select data-le="gridsize" style="font:inherit;border-radius:6px;padding:4px;background:#0f1729;color:#fff;border:1px solid #2c3856"><option value="4">4 px</option><option value="8" selected>8 px</option><option value="16">16 px</option></select> <button type="button" data-le="hide" disabled>Hide: no</button> <button type="button" data-le="snap">Snap: on</button> <button type="button" data-le="reset">Reset</button> <button type="button" data-le="copy">Copy layout</button> <button type="button" data-le="site">Save to site</button> <button type="button" data-le="site-clear">Clear site layout</button> <a href="' + location.pathname + '" style="color:#fff">Exit editing</a></span>' +
      '</div>' +
      '<div style="margin-top:8px"><strong data-le="name">Tap or drag a button</strong> <span data-le="site-msg" style="margin-left:8px;color:#f7c9b9"></span></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">' +
        ['x', 'y', 'w', 'h', 'fs'].map(function (k) {
          var lab = { x: 'X', y: 'Y', w: 'Width', h: 'Height', fs: 'Font size' }[k];
          return '<label style="display:grid;gap:2px;font-size:11px">' + lab +
            '<input type="number" data-le-in="' + k + '" style="width:84px;font:inherit;padding:4px;border-radius:6px;border:1px solid #2c3856;background:#0f1729;color:#fff"></label>';
        }).join('') +
        '<label style="display:grid;gap:2px;font-size:11px">Frame height<input type="number" data-le-in="H" style="width:96px;font:inherit;padding:4px;border-radius:6px;border:1px solid #2c3856;background:#0f1729;color:#fff"></label>' +
      '</div>' +
      '<textarea data-le="out" readonly style="width:100%;box-sizing:border-box;margin-top:8px;min-height:90px;font:12px/1.4 ui-monospace,Menlo,monospace;border-radius:6px;padding:6px;background:#0f1729;color:#e8ecf3;border:1px solid #2c3856"></textarea>';
    document.body.appendChild(bar);
    nameEl = bar.querySelector('[data-le="name"]');
    out = bar.querySelector('[data-le="out"]');
    bar.querySelectorAll('[data-le-in]').forEach(function (input) {
      inputs[input.dataset.leIn] = input;
      input.addEventListener('input', function () {
        var v = parseFloat(this.value);
        if (isNaN(v)) return;
        if (this.dataset.leIn === 'H') {
          wrap.style.setProperty('height', Math.max(40, v) + 'px', 'important');
          persist();
          return;
        }
        if (!sel) return;
        sel[this.dataset.leIn] = v;
        apply(sel);
        persist();
      });
    });
    bar.querySelector('[data-le="hide"]').addEventListener('click', function () {
      if (!sel) return;
      sel.hide = !sel.hide;
      apply(sel);
      persist();
    });
    bar.querySelector('[data-le="snap"]').addEventListener('click', function () {
      snap = !snap;
      this.textContent = 'Snap: ' + (snap ? 'on' : 'off');
    });
    // The panel starts as one slim bar, so the heading's band and its drag handle stay in view. Controls opens it.
    bar.style.maxHeight = '44px';
    bar.style.overflow = 'hidden';
    bar.querySelector('[data-le="panel"]').addEventListener('click', function () {
      var open = bar.style.maxHeight !== '44px';
      bar.style.maxHeight = open ? '44px' : '55vh';
      bar.style.overflow = open ? 'hidden' : 'auto';
      this.setAttribute('aria-expanded', String(!open));
    });
    bar.querySelector('[data-le="grid"]').addEventListener('click', function () {
      showGrid = !showGrid;
      this.textContent = 'Grid: ' + (showGrid ? 'on' : 'off');
      drawGrid();
    });
    bar.querySelector('[data-le="gridsize"]').addEventListener('change', function () {
      gridPx = parseInt(this.value, 10);
      drawGrid();
    });
    bar.querySelector('[data-le="reset"]').addEventListener('click', function () {
      try { localStorage.removeItem(STORE); } catch (e) { /* not kept */ }
      location.reload();
    });
    bar.querySelector('[data-le="site"]').addEventListener('click', function () {
      site({ frame: frame(), H: parseInt(wrap.style.height, 10), items: siteItems() }, 'Saved. Every visitor sees this ' + frame() + ' layout.');
    });
    bar.querySelector('[data-le="site-clear"]').addEventListener('click', function () {
      if (!window.confirm('Take the saved ' + frame() + ' layout off the site? Visitors go back to the built-in layout for this screen width.')) return;
      site({ frame: frame(), reset: true }, 'Cleared. The site uses the built-in ' + frame() + ' layout again.');
    });
    bar.querySelector('[data-le="copy"]').addEventListener('click', function () {
      var btn = this;
      out.select();
      try {
        navigator.clipboard.writeText(out.value).then(function () { btn.textContent = 'Copied'; },
          function () { btn.textContent = 'Select the text and copy'; });
      } catch (e) { btn.textContent = 'Select the text and copy'; }
    });
    fill();
  }

  /* Save to site: the positions for this screen width go to the worker under the admin key, and every page applies them
     at that width (js/laps-heading-layout.js). The key is kept for this tab only, the same as the admin pages. */
  function say(text) {
    var msg = bar && bar.querySelector('[data-le="site-msg"]');
    if (msg) msg.textContent = text;
  }
  function siteItems() {
    var out = {};
    items.forEach(function (m) { if (ROLES.indexOf(m.key) !== -1) out[m.key] = { x: m.x, y: m.y, w: m.w, h: m.h, fs: m.fs, hide: !!m.hide }; });
    return out;
  }
  function adminKey() {
    var k = (sessionStorage.getItem('mt3ukAdminKey') || '').trim();
    if (!k) {
      k = (window.prompt('Admin key, to save this layout for every visitor:') || '').trim();
      if (k) sessionStorage.setItem('mt3ukAdminKey', k);
    }
    return k;
  }
  // Desktop and phone each have their own saved layout. The editor saves the one for the width it is open at.
  function frame() { return innerWidth > 900 ? 'desk' : 'phone'; }
  function site(body, done) {
    var key = adminKey();
    if (!key) { say('Not saved: no admin key.'); return; }
    say('Saving...');
    fetch(API + '/laps/heading-layout/admin?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) { sessionStorage.removeItem('mt3ukAdminKey'); say('Not saved: the admin key was not accepted.'); return; }
        if (!r.ok || !d.success) { say('Not saved: ' + (d.message || 'the site did not answer.')); return; }
        say(done);
      });
    }).catch(function () { say('Not saved: no connection.'); });
  }

  function fill() {
    if (!bar) return;
    nameEl.textContent = sel ? sel.name : 'Tap or drag a button';
    ['x', 'y', 'w', 'h', 'fs'].forEach(function (k) {
      inputs[k].disabled = !sel;
      inputs[k].value = sel ? sel[k] : '';
    });
    inputs.H.value = parseInt(wrap.style.height, 10) || '';
    var hideBtn = bar.querySelector('[data-le="hide"]');
    hideBtn.disabled = !sel;
    hideBtn.textContent = 'Hide: ' + (sel && sel.hide ? 'yes' : 'no');
    var lines = ['/* ' + location.pathname + ', ' + frameLabel().toLowerCase() + '. Positions are px from the top left of the heading. */'];
    items.forEach(function (m) {
      if (m.hide) lines.push('/* ' + m.name + ' */ display: none;');
      else lines.push('/* ' + m.name + ' */ left: ' + m.x + 'px; top: ' + m.y + 'px; width: ' + m.w + 'px; height: ' + m.h + 'px; font-size: ' + m.fs + 'px;');
    });
    lines.push('/* heading height: ' + parseInt(wrap.style.height, 10) + 'px */');
    out.value = lines.join('\n');
  }

  function keys(e) {
    if (!sel || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    var step = e.shiftKey ? 10 : 1, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    sel.x = Math.max(0, sel.x + d[0] * step);
    sel.y = Math.max(0, sel.y + d[1] * step);
    apply(sel);
    persist();
  }

  ready(start);
})();
