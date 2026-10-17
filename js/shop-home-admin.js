/*
  admin.html, Shop panel: the Shop list (every product an offer can pick), the Offers card (heading, percent, items, text,
  start and end dates, placeholder shown when there is no live offer) and the Shop card's highlights. Kept by the worker
  (GET and POST /shop/home/admin, admin key). The list starts from data/shop-products.json until the admin first saves it.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('shop-cards-wrap');
  if (!wrap) return;
  var noteEl = document.getElementById('shop-note'), countEl = document.getElementById('shop-cards-count');
  var listEl = document.getElementById('shop-products'), itemsEl = document.getElementById('shop-o-items');
  var onBtn = document.getElementById('shop-offer-on');
  var state = null, products = [];
  // Today's date on the admin's own clock, as YYYY-MM-DD.
  function localToday() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/shop/home/admin?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }

  function productsOrSeed() {
    // Until the admin saves the list, the starting list in data/shop-products.json.
    if (state && state.products) return Promise.resolve(state.products);
    return fetch('data/shop-products.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return []; });
  }

  function drawList() {
    listEl.innerHTML = products.length ? '<table class="iv-table"><tbody>' + products.map(function (p) {
      return '<tr><td>' + esc(p.name) +
        (p.line ? '<br><span class="iv-sub">' + esc(p.line) + '</span>' : '') + '</td>' +
        '<td><button type="button" class="danger iv-act" data-remove="' + esc(p.id) + '">Remove</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">No products yet.</p>';
  }

  function drawOffer(home) {
    var offer = (home && home.offer) || {};
    onBtn.setAttribute('aria-checked', String(!!offer.on));
    onBtn.classList.toggle('is-on', !!offer.on);
    document.getElementById('shop-o-heading').value = offer.heading || '';
    document.getElementById('shop-o-percent').value = offer.percent || '';
    document.getElementById('shop-o-start').value = offer.start || '';
    document.getElementById('shop-o-end').value = offer.end || '';
    document.getElementById('shop-o-text').value = offer.text || '';
    document.getElementById('shop-placeholder').value = (home && home.placeholder) || '';
    document.getElementById('shop-highlights').value = ((home && home.highlights) || []).join('\n');
    var picked = (offer.items || []).map(function (i) { return i.id; });
    itemsEl.innerHTML = products.length ? products.map(function (p) {
      return '<label class="iv-note" style="display:block"><input type="checkbox" class="shop-pick" value="' + esc(p.id) + '"' + (picked.indexOf(p.id) !== -1 ? ' checked' : '') + '> ' + esc(p.name) + '</label>';
    }).join('') : '<p class="empty">Add a product to the Shop list first.</p>';
    var today = localToday();
    var live = !!offer.on && (!offer.start || today >= offer.start) && (!offer.end || today <= offer.end);
    countEl.textContent = live ? 'offer showing' : (offer.on ? 'offer not in its dates' : 'no offer');
  }

  function draw() {
    drawList();
    drawOffer(state && state.home);
  }

  function load() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the Shop. Check the admin key.', 'error'); return; }
      state = d;
      return productsOrSeed().then(function (list) {
        products = list;
        note('');
        draw();
      });
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }

  function save(body, done) {
    return call('POST', body).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not save.', 'error'); return; }
      state = Object.assign({}, state, d);
      if (d.products) products = d.products;
      draw();
      note(done || 'Saved.');
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }

  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key() && wrap.open) load(); });

  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-remove]');
    if (!b) return;
    var id = b.getAttribute('data-remove');
    var next = products.filter(function (p) { return p.id !== id; });
    if (!window.confirm('Take this product off the Shop list? An offer that already lists it keeps its copy.')) return;
    save({ products: next }, 'Product removed.');
  });

  document.getElementById('shop-product-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('shop-p-name').value.trim();
    if (!name) { note('Give the product a name.', 'error'); return; }
    var id = slug(name), n = 2, base = id;
    while (products.some(function (p) { return p.id === id; })) { id = base + '-' + n++; }
    var item = {
      id: id, name: name,
      url: document.getElementById('shop-p-url').value.trim(),
      line: document.getElementById('shop-p-line').value.trim()
    };
    save({ products: products.concat([item]) }, 'Added to the Shop list.').then(function () {
      ['shop-p-name', 'shop-p-url', 'shop-p-line'].forEach(function (k) { document.getElementById(k).value = ''; });
    });
  });

  onBtn.addEventListener('click', function () {
    var on = onBtn.getAttribute('aria-checked') !== 'true';
    onBtn.setAttribute('aria-checked', String(on));
    onBtn.classList.toggle('is-on', on);
  });

  document.getElementById('shop-save').addEventListener('click', function () {
    var picked = Array.prototype.map.call(itemsEl.querySelectorAll('.shop-pick:checked'), function (c) { return c.value; });
    var items = products.filter(function (p) { return picked.indexOf(p.id) !== -1; }).map(function (p) { return { id: p.id, name: p.name, url: p.url }; });
    var offer = {
      on: onBtn.getAttribute('aria-checked') === 'true',
      heading: document.getElementById('shop-o-heading').value.trim(),
      percent: parseInt(document.getElementById('shop-o-percent').value, 10) || 0,
      start: document.getElementById('shop-o-start').value,
      end: document.getElementById('shop-o-end').value,
      text: document.getElementById('shop-o-text').value.trim(),
      items: items
    };
    if (offer.on && (!offer.heading || !offer.items.length)) { note('An offer needs a heading and at least one item.', 'error'); return; }
    if (offer.start && offer.end && offer.end < offer.start) { note('The end date is before the start date.', 'error'); return; }
    var highlights = document.getElementById('shop-highlights').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    save({ home: { offer: offer, placeholder: document.getElementById('shop-placeholder').value.trim(), highlights: highlights } }, 'Saved. The homepage cards update within a few minutes.');
  });
})();
