/*
  Homepage: the Offers card and the Shop card in the hero's cards block (#hp-shop-cards). Both are set in admin.html's Shop
  panel and read from the worker (GET /shop/home, public). The offer shows only while it is live (the worker checks its
  dates); otherwise the placeholder text shows, or the Offers card is left out when there is none. Text is written with
  textContent, so nothing the admin types is read as markup.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var box = document.getElementById('hp-shop-cards');
  if (!box) return;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // Where each Shop product sits on shop.html, for an item with no link of its own (so the card goes to the item, not the top).
  var SHOP_ANCHORS = { 'master-cylinder-brace': 'brace', 'evoffer-sport-seats': 'evoffer', 'merch': 'merch' };
  function shopLink(url, id) {
    var u = String(url || '');
    if (/^https:\/\//.test(u)) {
      var sep = u.indexOf('?') === -1 ? '?' : '&';
      return u + sep + 'utm_source=mt3uk_shop&utm_medium=internal&utm_campaign=' + encodeURIComponent(id || 'offer') + '_order';
    }
    if (u) return u;
    return 'shop.html#' + (SHOP_ANCHORS[id] || id || 'offers');
  }
  function dateText(iso) {
    var d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Today's date on the viewer's own clock, as YYYY-MM-DD.
  function localToday() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function liveOffer(offer) {
    // The worker sends the offer only while it is switched on; its dates are checked here.
    if (!offer) return null;
    var today = localToday();
    if (offer.start && today < offer.start) return null;
    if (offer.end && today > offer.end) return null;
    return offer;
  }

  function offerCard(data) {
    var offer = liveOffer(data.offer);
    if (!offer && !data.placeholder) return null;
    var card = el('article', 'hp-card hp-offer-card');
    if (!offer) {
      card.appendChild(el('span', 'hp-card-tag', 'Offers'));
      card.appendChild(el('p', 'hp-card-text', data.placeholder));
      return card;
    }
    card.appendChild(el('span', 'hp-card-tag', offer.percent ? offer.percent + '% off' : 'Offer'));
    card.appendChild(el('h3', 'hp-card-title', offer.heading));
    if (offer.text) card.appendChild(el('p', 'hp-card-text', offer.text));
    if (offer.code) card.appendChild(el('p', 'hp-card-text', 'Use code ' + offer.code + ' at checkout.'));
    if (offer.items && offer.items.length) {
      var list = el('ul', 'hp-card-list');
      offer.items.forEach(function (it) {
        var li = el('li');
        var a = el('a', '', it.name + (it.price ? ' (' + it.price + ')' : ''));
        a.href = shopLink(it.url, it.id);
        li.appendChild(a);
        list.appendChild(li);
      });
      card.appendChild(list);
    }
    if (offer.end) card.appendChild(el('p', 'hp-card-note', 'Until ' + dateText(offer.end)));
    return card;
  }

  function shopCard(data) {
    var card = el('article', 'hp-card hp-shop-card');
    card.appendChild(el('span', 'hp-card-tag', 'Shop'));
    card.appendChild(el('h3', 'hp-card-title', 'In the MT3UK Shop'));
    var hl = data.highlights || [];
    if (hl.length) {
      var list = el('ul', 'hp-card-list');
      hl.forEach(function (h) { list.appendChild(el('li', '', h)); });
      card.appendChild(list);
    }
    var a = el('a', 'hp-card-link', 'Visit the Shop');
    a.href = 'shop.html';
    card.appendChild(a);
    return card;
  }

  function draw(data) {
    box.textContent = '';
    var offers = offerCard(data);
    if (offers) box.appendChild(offers);
    box.appendChild(shopCard(data));
    box.hidden = false;
  }

  fetch(API + '/shop/home', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.success) draw(d); else draw({ highlights: [], placeholder: '', offer: null }); })
    .catch(function () { draw({ highlights: [], placeholder: '', offer: null }); });
})();
