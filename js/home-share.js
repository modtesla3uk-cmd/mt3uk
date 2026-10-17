/*
  Homepage: each card has its own address (index.html#card-<id>) and a Share button at its top right. The button shares
  the card's share page, share/card/<id>.html, which has the card as its link preview (scripts/build_card_shares.py).
  Where there is no share sheet the link is copied. Opening a card's address brings the visitor to that card. The
  buttons are hidden in the layout editor (js/home-layout.js) so the cards can still be moved.
*/
(function () {
  var CARDS = [
    { id: 'latest', sel: '#hp-hero .hp-hero-card', name: 'Latest interview', dark: false },
    { id: 'laps', sel: '#hp-hero .hp-laps-promo', name: 'Laps', dark: false },
    { id: 'next', sel: '#hp-hero-next', name: 'Next interview', dark: true, pad: true },
    { id: 'join', sel: '#hp-join', name: 'Add a photo', dark: true, pad: true },
    { id: 'offers', sel: '#hp-shop-cards .hp-offer-card', name: 'Offers', dark: false, pad: true },
    { id: 'shop', sel: '#hp-shop-cards .hp-shop-card', name: 'Shop', dark: true, pad: true }
  ];
  var SHARE = 'https://mt3uk.com/share/card/';
  var ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>';

  var st = document.createElement('style');
  st.textContent =
    '.hp-has-share { position: relative; }' +
    '.hp-card-pad { padding-right: 56px !important; }' +
    '.hp-card-share { position: absolute; top: 8px; right: 8px; z-index: 4; width: 40px; height: 40px; padding: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: 1px solid rgba(22, 35, 61, 0.2); background: rgba(255, 255, 255, 0.92); color: #16233d; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18); text-decoration: none; }' +
    '.hp-card-share.is-dark { border-color: rgba(255, 255, 255, 0.35); background: rgba(14, 22, 40, 0.8); color: #ffffff; }' +
    '.hp-card-share:focus-visible { outline: 3px solid #e8542a; outline-offset: 2px; }' +
    '.hp-card-share .icon { width: 18px; height: 18px; }' +
    '.hp-card-landed { outline: 3px solid #e8542a; outline-offset: 6px; transition: outline-color 0.6s ease; }' +
    '.hp-cols.hl-edit .hp-card-share { display: none; }';
  document.head.appendChild(st);

  function flash(btn, text) {
    var label = btn.getAttribute('data-label') || btn.getAttribute('aria-label');
    btn.setAttribute('data-label', label);
    btn.setAttribute('aria-label', text);
    btn.title = text;
    setTimeout(function () { btn.setAttribute('aria-label', label); btn.title = label; }, 2500);
  }

  function copyLink(url, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { flash(btn, 'Link copied'); }, function () { flash(btn, 'Could not copy the link'); });
    } else {
      flash(btn, 'Could not copy the link');
    }
  }

  function share(c, btn) {
    var url = SHARE + c.id + '.html';
    if (typeof navigator.share === 'function') {
      navigator.share({ title: 'MT3UK', text: c.name + ' on MT3UK', url: url }).catch(function (err) {
        if (!err || err.name !== 'AbortError') copyLink(url, btn);
      });
    } else {
      copyLink(url, btn);
    }
  }

  function addButtons() {
    CARDS.forEach(function (c) {
      var card = document.querySelector(c.sel);
      if (!card) return;
      if (!card.id) card.id = 'card-' + c.id;
      if (card.querySelector(':scope > .hp-card-share')) return;
      var link = card.tagName === 'A';
      var btn = document.createElement(link ? 'span' : 'button');
      btn.className = 'hp-card-share' + (c.dark ? ' is-dark' : '');
      if (link) { btn.setAttribute('role', 'button'); btn.tabIndex = 0; } else { btn.type = 'button'; }
      btn.setAttribute('aria-label', 'Share the ' + c.name + ' card');
      btn.title = 'Share this card';
      btn.innerHTML = ICON;
      btn.addEventListener('click', function (e) {
        // On a card that is a link, the button shares the card and does not follow the link.
        e.preventDefault();
        e.stopPropagation();
        share(c, btn);
      });
      if (link) {
        btn.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
        });
      }
      card.appendChild(btn);
      card.classList.add('hp-has-share');
      // The text of these cards runs across the top, so it keeps clear of the button. The cards in the swipe row do not need it.
      if (c.pad) card.classList.add('hp-card-pad');
    });
    landOnCard();
  }

  // A card's own address (index.html#card-<id>) brings the visitor to that card once it has been drawn.
  var landed = false;
  function landOnCard() {
    var m = location.hash.match(/^#card-([a-z]+)$/);
    if (landed || !m) return;
    var card = document.getElementById('card-' + m[1]);
    if (!card) return;
    landed = true;
    card.scrollIntoView({ block: 'center' });
    card.classList.add('hp-card-landed');
    setTimeout(function () { card.classList.remove('hp-card-landed'); }, 2500);
  }

  addButtons();
  // Cards are drawn after the page loads (offers, sign-in, the next interview), so add their buttons as they appear.
  var hero = document.getElementById('hp-hero');
  if (hero && 'MutationObserver' in window) new MutationObserver(addButtons).observe(hero, { childList: true, subtree: true });
})();
