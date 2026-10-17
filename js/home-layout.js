/*
  Homepage hero layout, desktop only (901px wide and up, the page's breakpoint). The saved layout (GET /home/layout) places
  each card by its left, top and width, and sets its text and button size (zoom). With ?layout=edit the cards can be
  dragged, resized from their bottom-right corner, and scaled with A+ and A-; Save writes the layout to the worker (admin
  key, the same as the other admin pages). Saved layouts go live as soon as they are saved; Reset clears them. Phone keeps
  the swipe layout in css/index.html and is not touched.
*/
(function () {
  if (!window.MT3UKWithAdminKey) document.head.appendChild(Object.assign(document.createElement('script'), { src: 'js/admin-key-ask.js' }));
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var ITEMS = {
    latest: '#hp-hero .hp-hero-card',
    laps: '#hp-hero .hp-laps-promo',
    next: '#hp-hero-next',
    join: '#hp-join',
    offer: '#hp-shop-cards .hp-offer-card',
    shop: '#hp-shop-cards .hp-shop-card',
    note: '.hp-cols > .hp-site-note',
    stats: '.hp-cols > .hp-stats'
  };
  var NAMES = { latest: 'Latest interview', laps: 'Laps', next: 'Next interview', join: 'Add a photo', offer: 'Offers card', shop: 'Shop card', note: 'Site note', stats: 'Member numbers' };
  var gridPx = 8, snapOn = true, showGrid = true, phoneOn = true;
  // The order the cards come in on a phone. Without a saved layout it is the default desktop order; with one, the order the
  // cards sit in on desktop (top to bottom, then left to right). It sets --phone-order on each card (index.html) and the
  // numbers in the editor.
  // Where the cards sit with no saved layout (measured on desktop, in the frame's pixels), for the phone order.
  var DEFAULT_COORDS = {
    latest: { x: 0, y: 0, w: 484 }, next: { x: 484, y: 0, w: 484 }, join: { x: 484, y: 131, w: 484 },
    offer: { x: 484, y: 267, w: 484 }, laps: { x: 0, y: 300, w: 484 }, shop: { x: 484, y: 417, w: 484 },
    note: { x: 0, y: 608, w: 1000 }, stats: { x: 0, y: 663, w: 560 }
  };
  var FOOTER = ['note', 'stats'];
  var FRAME_MIDDLE = 500;
  var phoneRank = {}, lastCoords = null;
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
      '#hl-bar .hl-msg { flex-basis: 100%; color: #f7c9b9; min-height: 1.4em; }' +
      '.hp-cols .hl-phone-no { position: absolute; z-index: 0; pointer-events: none; padding: 2px 7px; border-radius: 999px; background: #16233d; color: #ffffff; font: 700 11px/1.2 system-ui, sans-serif; white-space: nowrap; }' +
      '.hp-cols.hl-no-phone .hl-phone-no { display: none; }' +
      '.hp-cols.hl-edit [data-hl] { z-index: 1; }' +
      '.hp-cols.hl-edit .hp-laps-promo { overflow: visible; }';
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

  // A card may rise at most this far above the frame: higher, it goes under the sticky header where no scroll reaches it.
  var TOP_MIN = -60;

  // Where each card is now, from the frame: its saved place, or where it sits when it has none yet (a card drawn later).
  function coordsNow() {
    var base = cols.getBoundingClientRect(), out = {};
    present().forEach(function (it) {
      var r = it.el.getBoundingClientRect();
      if (it.el.style.left && it.el.style.top) {
        out[it.id] = { x: parseFloat(it.el.style.left), y: parseFloat(it.el.style.top), w: parseFloat(it.el.style.width) || Math.round(r.width) };
      } else {
        out[it.id] = { x: Math.round(r.left - base.left), y: Math.round(r.top - base.top), w: Math.round(r.width) };
      }
    });
    return out;
  }

  // The phone order: the left column top to bottom, then the right column top to bottom, then the note and the member
  // numbers. A card is in the left column when its middle is left of the middle of the frame.
  function phoneOrder(coords) {
    var ids = present().map(function (it) { return it.id; }), pos = {};
    ids.forEach(function (id) { pos[id] = (coords && coords[id]) || DEFAULT_COORDS[id] || { x: 0, y: 100000, w: 0 }; });
    var byPlace = function (a, b) { return (pos[a].y - pos[b].y) || (pos[a].x - pos[b].x); };
    var left = [], right = [], footer = [];
    ids.forEach(function (id) {
      if (FOOTER.indexOf(id) !== -1) footer.push(id);
      else if (pos[id].x + (pos[id].w || 0) / 2 <= FRAME_MIDDLE) left.push(id);
      else right.push(id);
    });
    return left.sort(byPlace).concat(right.sort(byPlace), footer.sort(byPlace));
  }

  // The phone number of each card sits in the frame behind it, at its top left corner, so it shows where the card is in the
  // order and moves with the card. Only the editor has them.
  function refreshBadges(coords) {
    if (!cols.classList.contains('hl-edit')) return;
    var c = coords || coordsNow();
    present().forEach(function (it) {
      var no = cols.querySelector('.hl-phone-no[data-for="' + it.id + '"]');
      if (!no) {
        no = document.createElement('span');
        no.className = 'hl-phone-no';
        no.setAttribute('data-for', it.id);
        cols.appendChild(no);
      }
      var text = 'Phone ' + phoneRank[it.id];
      if (no.textContent !== text) no.textContent = text;
      if (c[it.id]) { no.style.left = (c[it.id].x + 10) + 'px'; no.style.top = (c[it.id].y - 18) + 'px'; }
    });
  }

  function applyPhoneOrder(coords) {
    lastCoords = coords;
    phoneRank = {};
    phoneOrder(coords).forEach(function (id, i) { phoneRank[id] = i + 1; });
    present().forEach(function (it) { it.el.style.setProperty('--phone-order', phoneRank[it.id]); });
    refreshBadges(coords);
  }

  // On the frame (a saved layout or the editor) the order follows where the cards are; on a phone it follows the saved
  // layout, or the default order when there is none.
  function refreshPhoneOrder() {
    var live = cols.classList.contains('hl-on') || cols.classList.contains('hl-edit');
    applyPhoneOrder(live ? coordsNow() : lastCoords);
  }

  function applyLayout(l) {
    applyPhoneOrder(l && l.desk ? l.desk.items : null);
    if (!desk.matches || !l || !l.desk) { clearLayout(); return; }
    ensureCss();
    cols.classList.add('hl-on');
    cols.style.height = l.desk.H + 'px';
    present().forEach(function (it) {
      var p = l.desk.items[it.id];
      it.el.setAttribute('data-hl', it.id);
      if (!p) return;
      it.el.style.left = p.x + 'px';
      it.el.style.top = Math.max(TOP_MIN, p.y) + 'px';
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

  function snap(v) { return snapOn ? Math.round(v / gridPx) * gridPx : Math.round(v); }

  // The grid is drawn on the frame behind the cards, only while editing; it follows the grid size and the show switch.
  function drawGrid() {
    var on = cols.classList.contains('hl-edit') && showGrid;
    cols.style.backgroundImage = on ? 'linear-gradient(to right, rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.16) 1px, transparent 1px)' : '';
    cols.style.backgroundSize = on ? gridPx + 'px ' + gridPx + 'px' : '';
  }

  // Keyboard: with a card selected, the arrow keys move it 1px (Shift: 10px). Tab goes from card to card.
  function keys(e) {
    if (!selected || !cols.classList.contains('hl-edit') || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
    var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    var step = e.shiftKey ? 10 : 1;
    var x = Math.max(0, Math.round(parseFloat(selected.style.left) || 0) + d[0] * step);
    var y = Math.max(TOP_MIN, Math.round(parseFloat(selected.style.top) || 0) + d[1] * step);
    selected.style.left = x + 'px';
    selected.style.top = y + 'px';
    refreshPhoneOrder();
    select(selected);
    say('Moved to ' + x + ', ' + y + ' px from the frame\'s top left.');
  }

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
        drag.el.style.top = Math.max(TOP_MIN, snap(drag.oy + dy)) + 'px';
      }
    });
    cols.addEventListener('pointerup', function () { if (drag) { refreshPhoneOrder(); select(drag.el); } drag = null; });
    cols.addEventListener('pointercancel', function () { drag = null; });
    // A card dragged is not followed by its link.
    cols.addEventListener('click', function (e) { if (cols.classList.contains('hl-edit') && e.target.closest('[data-hl]')) e.preventDefault(); }, true);
  }

  // How far a card can grow, in frame pixels, before it meets another card or the edge of the frame. Its height is the room
  // below it; its width, the room to its right. A card that already overlaps another has no room to grow that way.
  function roomFor(el) {
    var base = cols.getBoundingClientRect(), r = el.getBoundingClientRect();
    var x = r.left - base.left, y = r.top - base.top, w = r.width, h = r.height;
    var maxW = base.width - x, maxH = base.height - y;
    present().forEach(function (it) {
      if (it.el === el) return;
      var o = it.el.getBoundingClientRect();
      var ox = o.left - base.left, oy = o.top - base.top;
      var across = oy < y + h && oy + o.height > y, along = ox < x + w && ox + o.width > x;
      if (across && ox >= x + w - 1) maxW = Math.min(maxW, ox - x);
      if (along && oy >= y + h - 1) maxH = Math.min(maxH, oy - y);
    });
    return { w: Math.max(0, Math.floor(maxW)), h: Math.max(0, Math.floor(maxH)) };
  }

  function select(el) {
    if (selected) selected.classList.remove('is-sel');
    selected = el;
    el.classList.add('is-sel');
    var id = el.getAttribute('data-hl'), phone = phoneRank[id], room = roomFor(el);
    if (bar) bar.querySelector('[data-hl-name]').textContent = (NAMES[id] || 'Card') + (phone ? ' (phone ' + phone + ')' : '') + ' selected: text and buttons at ' + Math.round(parseFloat(el.style.zoom || 1) * 100) + '%. Room to grow: ' + room.w + ' px wide, ' + room.h + ' px tall before it meets another card or the frame edge.';
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
      '<label class="hl-figure">Members figure <input type="text" maxlength="20" data-hl-members aria-label="Members figure" style="width:84px;font:inherit;padding:5px;border-radius:6px;border:1px solid #2c3856;background:#0f1729;color:#fff"></label>' +
      '<button type="button" data-a="members">Set members figure</button>' +
      '<button type="button" data-a="phone">Phone order: on</button>' +
      '<button type="button" data-a="grid">Grid: on</button>' +
      '<select data-a="gridsize" aria-label="Grid size"><option value="4">4 px</option><option value="8" selected>8 px</option><option value="16">16 px</option></select>' +
      '<button type="button" data-a="snap">Snap: on</button>' +
      '<button type="button" data-a="taller">Frame taller</button>' +
      '<button type="button" data-a="shorter">Frame shorter</button>' +
      '<button type="button" class="primary" data-a="save">Save layout</button>' +
      '<button type="button" data-a="reset">Reset to the default</button>' +
      '<a href="' + location.pathname + '">Exit editing</a>' +
      '<span class="hl-msg"></span>';
    document.body.appendChild(bar);
    bar.querySelector('[data-a="gridsize"]').addEventListener('change', function () { gridPx = parseInt(this.value, 10); drawGrid(); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'members') saveMembers();
      if (a === 'phone') { phoneOn = !phoneOn; b.textContent = 'Phone order: ' + (phoneOn ? 'on' : 'off'); cols.classList.toggle('hl-no-phone', !phoneOn); }
      if (a === 'grid') { showGrid = !showGrid; b.textContent = 'Grid: ' + (showGrid ? 'on' : 'off'); drawGrid(); }
      if (a === 'snap') { snapOn = !snapOn; b.textContent = 'Snap: ' + (snapOn ? 'on' : 'off'); }
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

  // The Members figure is typed in (data/community.json, read by the other pages too). Build shows the figure in use.
  function fillMembers() {
    fetch('data/community.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var input = bar && bar.querySelector('[data-hl-members]');
      if (input && d && d.members && !input.value) input.value = d.members;
    }).catch(function () {});
  }

  function saveMembers() {
    var input = bar.querySelector('[data-hl-members]');
    window.MT3UKWithAdminKey('Admin key, to save the members figure:', function (key) {
    if (!key) { say('Not saved: no admin key.'); return; }
    say('Saving the members figure...');
    fetch(API + '/home/members/admin?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ members: input.value.trim() })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (x.ok && x.d.success) {
          document.querySelectorAll('.member-count').forEach(function (el) { el.textContent = x.d.members; });
          input.value = x.d.members;
          say('Saved. The members figure is ' + x.d.members + ' here now; the other pages show it once the site has updated (about a minute).');
        } else say('Not saved: ' + (x.d.message || 'check the admin key.'));
      })
      .catch(function () { say('Not saved: could not reach the server.'); });
    });
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
    window.MT3UKWithAdminKey('Admin key, to save the layout:', function (key) {
    if (!key) { say('Not saved: no admin key.'); return; }
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
    });
  }

  function reset() {
    if (!window.confirm('Reset the homepage to the default layout? Visitors will see the default from now on.')) return;
    var key = sessionStorage.getItem('mt3ukAdminKey') || '';
    fetch(API + '/home/layout/admin?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ layout: { desk: null } })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.success) { layout = { desk: null }; clearLayout(); cols.classList.add('hl-edit'); applyLayout({ desk: startFromPage() }); drawGrid(); say('Reset. The default layout shows to visitors.'); }
      else say('Not reset: ' + (d.message || 'check the admin key.'));
    }).catch(function () { say('Not reset: could not reach the server.'); });
  }

  function enterEditor() {
    buildBar();
    fillMembers();
    var start = layout.desk ? { H: layout.desk.H, items: {} } : startFromPage();
    if (layout.desk) present().forEach(function (it) { var p = layout.desk.items[it.id]; if (p) start.items[it.id] = p; });
    frameH = start.H;
    cols.classList.add('hl-edit');
    applyLayout({ desk: start });
    editorDrag();
    // Each card can take the keyboard: Tab to it, then the arrow keys move it. Each shows its place on a phone.
    present().forEach(function (it) { it.el.setAttribute('tabindex', '0'); });
    refreshBadges();
    cols.addEventListener('focusin', function (e) {
      var el = e.target.closest && e.target.closest('[data-hl]');
      if (el && cols.classList.contains('hl-edit')) select(el);
    });
    document.addEventListener('keydown', keys);
    drawGrid();
    // The fonts can change the size of the cards after they were measured, so the order is worked out again once they are in.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshPhoneOrder);
    say('Drag a card to move it, or Tab to it and use the arrow keys (Shift for 10 px). Drag its corner to change its width.');
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
      if (window.mt3ukHomeFirst) window.mt3ukHomeFirst.save('layout', layout.desk || null);
      if (editing && desk.matches) whenCardsReady(enterEditor);
      else whenCardsReady(function () { applyLayout(layout); });
    })
    .catch(function () { if (editing) whenCardsReady(enterEditor); });

  desk.addEventListener('change', function () { if (!editing) applyLayout(layout); });

  // A card that appears later (the Next interview, the offer, sign-in's photo card) takes its place in the phone order too.
  var heroBox = document.getElementById('hp-hero');
  if (heroBox && 'MutationObserver' in window) {
    new MutationObserver(function () { refreshPhoneOrder(); })
      .observe(heroBox, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
})();
