/*
  Homepage hero layout, desktop only (901px wide and up, the page's breakpoint). The saved layout (GET /home/layout) places
  each card by its left, top and width, and sets its text and button size (zoom). With ?layout=edit the cards can be
  dragged, resized from their bottom-right corner, and scaled with A+ and A-; Save writes the layout to the worker (admin
  key, the same as the other admin pages). Saved layouts go live as soon as they are saved; Reset clears them. Phone keeps
  the swipe layout in css/index.html and is not touched.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var ITEMS = {
    latest: '#hp-hero .hp-hero-card',
    laps: '#hp-hero .hp-laps-promo',
    next: '#hp-hero-next',
    join: '#hp-join',
    offer: '#hp-shop-cards .hp-offer-card',
    shop: '#hp-shop-cards .hp-shop-card'
  };
  var NAMES = { latest: 'Latest interview', laps: 'Laps', next: 'Next interview', join: 'Add a photo', offer: 'Offers card', shop: 'Shop card' };
  var GRID = 8;
  var cols = document.querySelector('.hp-cols');
  if (!cols) return;
  var desk = window.matchMedia('(min-width: 901px)');
  var editing = /[?&]layout=edit(&|$)/.test(location.search);
  var layout = { desk: null };
  var selected = null, bar = null, frameH = 0;

  function ensureCss() {
    if (document.getElementById('home-layout-css')) return;
    var st = document.createElement('style');
    st.id = 'home-layout-css';
    st.textContent =
      '.hp-cols.hl-on { position: relative !important; display: block !important; }' +
      '.hp-cols.hl-on .hp-col-right { display: contents !important; }' +
      '.hp-cols.hl-on .hp-shop-cards { display: block !important; margin: 0 !important; }' +
      '.hp-cols.hl-on [data-hl] { position: absolute !important; margin: 0 !important; max-width: none !important; box-sizing: border-box; }' +
      '.hp-cols.hl-on .hp-shop-cards > [data-hl] { display: flex; }' +
      '.hp-cols.hl-edit [data-hl] { outline: 1px dashed rgba(232,84,42,.7); outline-offset: 2px; cursor: move; touch-action: none; }' +
      '.hp-cols.hl-edit [data-hl].is-sel { outline: 2px solid #e8542a; }' +
      '.hp-cols.hl-edit [data-hl]::after { content: ""; position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px; border-right: 3px solid #e8542a; border-bottom: 3px solid #e8542a; pointer-events: none; }' +
      '#hl-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647; background: #16233d; color: #fff; font: 13px/1.4 system-ui, sans-serif; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; box-shadow: 0 -4px 16px rgba(0,0,0,.3); }' +
      '#hl-bar button, #hl-bar a { font: inherit; border-radius: 6px; padding: 6px 12px; border: 1px solid #2c3856; background: #22324f; color: #fff; text-decoration: none; cursor: pointer; }' +
      '#hl-bar button.primary { background: #e8542a; border-color: #e8542a; font-weight: 700; }' +
      '#hl-bar .hl-msg { flex-basis: 100%; color: #f7c9b9; min-height: 1.4em; }';
    document.head.appendChild(st);
  }

  function present() {
    return Object.keys(ITEMS).map(function (id) {
      var el = document.querySelector(ITEMS[id]);
      if (!el || el.hidden || (el.closest && el.closest('[hidden]') && el.closest('[hidden]') !== el)) return null;
      return { id: id, el: el };
    }).filter(Boolean);
  }

  function clearLayout() {
    cols.classList.remove('hl-on', 'hl-edit');
    cols.style.height = '';
    Object.keys(ITEMS).forEach(function (id) {
      var el = document.querySelector(ITEMS[id]);
      if (!el) return;
      el.removeAttribute('data-hl');
      ['position', 'left', 'top', 'width', 'zoom', 'margin', 'maxWidth'].forEach(function (k) { el.style[k] = ''; });
      el.classList.remove('is-sel');
    });
  }

  function applyLayout(l) {
    if (!desk.matches || !l || !l.desk) { clearLayout(); return; }
    ensureCss();
    cols.classList.add('hl-on');
    cols.style.height = l.desk.H + 'px';
    present().forEach(function (it) {
      var p = l.desk.items[it.id];
      it.el.setAttribute('data-hl', it.id);
      if (!p) return;
      it.el.style.left = p.x + 'px';
      it.el.style.top = p.y + 'px';
      it.el.style.width = p.w + 'px';
      it.el.style.zoom = p.z;
    });
  }

  // Editor: reads where each card is now, so the first drag starts from the page as it looks.
  function startFromPage() {
    var base = cols.getBoundingClientRect();
    var out = { H: Math.round(cols.offsetHeight || base.height), items: {} };
    present().forEach(function (it) {
      var r = it.el.getBoundingClientRect();
      out.items[it.id] = { x: Math.round(r.left - base.left), y: Math.round(r.top - base.top), w: Math.round(r.width), z: 1 };
    });
    return out;
  }

  function snap(v) { return Math.round(v / GRID) * GRID; }

  function editorDrag() {
    var drag = null;
    cols.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('[data-hl]');
      if (!el || !cols.classList.contains('hl-edit')) return;
      e.preventDefault();
      select(el);
      var r = el.getBoundingClientRect();
      var corner = e.clientX > r.right - 22 && e.clientY > r.bottom - 22;
      drag = { el: el, corner: corner, sx: e.clientX, sy: e.clientY, ox: parseFloat(el.style.left) || 0, oy: parseFloat(el.style.top) || 0, ow: parseFloat(el.style.width) || r.width };
      el.setPointerCapture(e.pointerId);
    });
    cols.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (drag.corner) {
        drag.el.style.width = Math.max(120, snap(drag.ow + dx)) + 'px';
      } else {
        drag.el.style.left = Math.max(0, snap(drag.ox + dx)) + 'px';
        drag.el.style.top = Math.max(0, snap(drag.oy + dy)) + 'px';
      }
    });
    cols.addEventListener('pointerup', function () { drag = null; });
    cols.addEventListener('pointercancel', function () { drag = null; });
    // A card dragged is not followed by its link.
    cols.addEventListener('click', function (e) { if (cols.classList.contains('hl-edit') && e.target.closest('[data-hl]')) e.preventDefault(); }, true);
  }

  function select(el) {
    if (selected) selected.classList.remove('is-sel');
    selected = el;
    el.classList.add('is-sel');
    if (bar) bar.querySelector('[data-hl-name]').textContent = (NAMES[el.getAttribute('data-hl')] || 'Card') + ' selected: text and buttons at ' + Math.round(parseFloat(el.style.zoom || 1) * 100) + '%';
  }

  function say(t) { var m = bar && bar.querySelector('.hl-msg'); if (m) m.textContent = t || ''; }

  function buildBar() {
    ensureCss();
    bar = document.createElement('div');
    bar.id = 'hl-bar';
    bar.innerHTML =
      '<strong>Homepage layout</strong>' +
      '<span data-hl-name>Tap a card to select it</span>' +
      '<button type="button" data-a="plus">A+ text and buttons</button>' +
      '<button type="button" data-a="minus">A− text and buttons</button>' +
      '<button type="button" data-a="taller">Frame taller</button>' +
      '<button type="button" data-a="shorter">Frame shorter</button>' +
      '<button type="button" class="primary" data-a="save">Save layout</button>' +
      '<button type="button" data-a="reset">Reset to the default</button>' +
      '<a href="' + location.pathname + '">Exit editing</a>' +
      '<span class="hl-msg"></span>';
    document.body.appendChild(bar);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'taller') { frameH += 40; cols.style.height = frameH + 'px'; }
      if (a === 'shorter') { frameH = Math.max(200, frameH - 40); cols.style.height = frameH + 'px'; }
      if (a === 'plus' || a === 'minus') {
        if (!selected) { say('Tap a card first.'); return; }
        var z = parseFloat(selected.style.zoom || 1) + (a === 'plus' ? 0.1 : -0.1);
        selected.style.zoom = Math.max(0.5, Math.min(2, Math.round(z * 10) / 10));
        select(selected);
      }
      if (a === 'save') save();
      if (a === 'reset') reset();
    });
    cols.addEventListener('pointerdown', function (e) { if (!e.target.closest('[data-hl]')) { if (selected) selected.classList.remove('is-sel'); selected = null; } }, true);
  }

  function current() {
    var out = { H: frameH, items: {} };
    present().forEach(function (it) {
      var el = it.el;
      out.items[it.id] = { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, w: parseFloat(el.style.width) || el.offsetWidth, z: parseFloat(el.style.zoom) || 1 };
    });
    return out;
  }

  function save() {
    var key = sessionStorage.getItem('mt3ukAdminKey') || window.prompt('Admin key, to save the layout:') || '';
    if (!key) { say('Not saved: no admin key.'); return; }
    sessionStorage.setItem('mt3ukAdminKey', key);
    say('Saving...');
    fetch(API + '/home/layout/admin?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ layout: { desk: current() } })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (x.ok && x.d.success) { layout = x.d.layout; say('Saved. Visitors see this layout from now on (on desktop).'); }
        else if (x.d && x.d.message) { say('Not saved: ' + x.d.message); }
        else { say('Not saved.'); }
      })
      .catch(function () { say('Not saved: could not reach the server.'); });
  }

  function reset() {
    if (!window.confirm('Reset the homepage to the default layout? Visitors will see the default from now on.')) return;
    var key = sessionStorage.getItem('mt3ukAdminKey') || '';
    fetch(API + '/home/layout/admin?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ layout: { desk: null } })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.success) { layout = { desk: null }; clearLayout(); cols.classList.add('hl-edit'); applyLayout({ desk: startFromPage() }); say('Reset. The default layout shows to visitors.'); }
      else say('Not reset: ' + (d.message || 'check the admin key.'));
    }).catch(function () { say('Not reset: could not reach the server.'); });
  }

  function enterEditor() {
    buildBar();
    var start = layout.desk ? { H: layout.desk.H, items: {} } : startFromPage();
    if (layout.desk) present().forEach(function (it) { var p = layout.desk.items[it.id]; if (p) start.items[it.id] = p; });
    frameH = start.H;
    cols.classList.add('hl-edit');
    applyLayout({ desk: start });
    editorDrag();
    say('Drag a card to move it. Drag its corner to change its width.');
  }

  // Wait until the shop cards have been drawn, so the editor sees every card.
  function whenCardsReady(cb, tries) {
    var box = document.getElementById('hp-shop-cards');
    if ((box && !box.hidden && box.children.length) || tries > 40) { cb(); return; }
    setTimeout(function () { whenCardsReady(cb, (tries || 0) + 1); }, 150);
  }

  fetch(API + '/home/layout', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      layout = d && d.success && d.layout ? d.layout : { desk: null };
      if (editing && desk.matches) whenCardsReady(enterEditor);
      else whenCardsReady(function () { applyLayout(layout); });
    })
    .catch(function () { if (editing) whenCardsReady(enterEditor); });

  desk.addEventListener('change', function () { if (!editing) applyLayout(layout); });
})();
