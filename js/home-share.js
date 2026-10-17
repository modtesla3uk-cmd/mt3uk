/*
  Homepage: a Share button at the top right of each card. It makes a picture of the card as it is seen (its text, its
  pictures and its colours, with the page's fonts copied in) and offers the picture to the phone or browser share sheet.
  Where there is no share sheet the picture is saved as a PNG. The buttons are hidden in the layout editor
  (js/home-layout.js) so the cards can still be moved.
*/
(function () {
  var CARDS = [
    { sel: '#hp-hero .hp-hero-card', name: 'Latest interview', dark: false },
    { sel: '#hp-hero .hp-laps-promo', name: 'Laps', dark: false },
    { sel: '#hp-hero-next', name: 'Next interview', dark: true, pad: true },
    { sel: '#hp-join', name: 'Add a photo', dark: true, pad: true },
    { sel: '#hp-shop-cards .hp-offer-card', name: 'Offers', dark: false, pad: true },
    { sel: '#hp-shop-cards .hp-shop-card', name: 'Shop', dark: true, pad: true }
  ];
  var FONTS = 'https://fonts.googleapis.com/css2?family=Archivo+Expanded:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
  var HOME = 'https://mt3uk.com/';
  var ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>';
  // Layout properties the picture takes from the page's own place for the card, not from its copied styles.
  var PLACE = ['position', 'left', 'top', 'right', 'bottom', 'inset', 'margin', 'transform', 'zoom', 'transition', 'animation'];

  var st = document.createElement('style');
  st.textContent =
    '.hp-has-share { position: relative; }' +
    '.hp-card-pad { padding-right: 56px !important; }' +
    '.hp-card-share { position: absolute; top: 8px; right: 8px; z-index: 4; width: 40px; height: 40px; padding: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: 1px solid rgba(22, 35, 61, 0.2); background: rgba(255, 255, 255, 0.92); color: #16233d; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18); text-decoration: none; }' +
    '.hp-card-share.is-dark { border-color: rgba(255, 255, 255, 0.35); background: rgba(14, 22, 40, 0.8); color: #ffffff; }' +
    '.hp-card-share:focus-visible { outline: 3px solid #e8542a; outline-offset: 2px; }' +
    '.hp-card-share .icon { width: 18px; height: 18px; }' +
    '.hp-cols.hl-edit .hp-card-share { display: none; }';
  document.head.appendChild(st);

  // The page's fonts, as data the picture can carry (a picture cannot load them from the page). Fetched once; without them
  // the picture uses the system fonts.
  var fontCss = null;
  function dataUrl(url) {
    return fetch(url, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('fetch failed');
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    });
  }
  // Gives up after a few seconds, so a slow font server cannot hold up the picture.
  function getFontCss() {
    if (!fontCss) {
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(''); }, 4000); });
      fontCss = Promise.race([timeout, fetch(FONTS).then(function (r) { return r.ok ? r.text() : ''; }).then(function (css) {
        var found = (css.match(/url\(https:\/\/fonts\.gstatic\.com[^)]+\)/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; });
        return Promise.all(found.map(function (u) { return dataUrl(u.slice(4, -1)); })).then(function (datas) {
          found.forEach(function (u, i) { css = css.split(u).join('url(' + datas[i] + ')'); });
          return css;
        });
      }).catch(function () { return ''; })]);
    }
    return fontCss;
  }

  // Copies the computed style of every element onto its copy, so the copy looks the same with no page stylesheet.
  function copyStyles(src, dst) {
    var from = [src].concat(Array.prototype.slice.call(src.querySelectorAll('*')));
    var to = [dst].concat(Array.prototype.slice.call(dst.querySelectorAll('*')));
    from.forEach(function (el, i) {
      var cs = getComputedStyle(el), out = to[i];
      for (var k = 0; k < cs.length; k++) {
        var p = cs[k];
        if (i === 0 && PLACE.indexOf(p) !== -1) continue;
        if (i > 0 && (p === 'zoom' || p === 'transition' || p === 'animation')) continue;
        out.style.setProperty(p, cs.getPropertyValue(p), cs.getPropertyPriority(p));
      }
    });
  }
  function inlineImages(root) {
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    return Promise.all(imgs.map(function (img) {
      var src = img.currentSrc || img.src;
      img.removeAttribute('srcset');
      if (!src || src.indexOf('data:') === 0) return null;
      return dataUrl(src).then(function (d) { img.setAttribute('src', d); }).catch(function () {});
    }));
  }

  // The card as a PNG, at twice its size on the page so it stays sharp.
  function picture(card) {
    var rect = card.getBoundingClientRect();
    var w = Math.ceil(rect.width), h = Math.ceil(rect.height);
    var clone = card.cloneNode(true);
    copyStyles(card, clone);
    Array.prototype.forEach.call(clone.querySelectorAll('.hp-card-share'), function (n) { n.remove(); });
    clone.style.position = 'relative';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.margin = '0';
    return Promise.all([getFontCss(), inlineImages(clone)]).then(function (res) {
      var fonts = document.createElement('style');
      fonts.textContent = res[0];
      clone.insertBefore(fonts, clone.firstChild);
      var box = '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + w + 'px;height:' + h + 'px;overflow:hidden">' +
        new XMLSerializer().serializeToString(clone) + '</div>';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' + box + '</foreignObject></svg>';
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement('canvas');
          canvas.width = w * 2;
          canvas.height = h * 2;
          var ctx = canvas.getContext('2d');
          ctx.scale(2, 2);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('no picture')); }, 'image/png');
        };
        img.onerror = function () { reject(new Error('picture did not draw')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    });
  }

  function flash(btn, text) {
    var label = btn.getAttribute('data-label') || btn.getAttribute('aria-label');
    btn.setAttribute('data-label', label);
    btn.setAttribute('aria-label', text);
    btn.title = text;
    setTimeout(function () { btn.setAttribute('aria-label', label); btn.title = label; }, 2500);
  }

  function save(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function share(c, card, btn) {
    var name = 'mt3uk-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
    btn.disabled = true;
    picture(card).then(function (blob) {
      var file = new File([blob], name, { type: 'image/png' });
      var data = { title: 'MT3UK', text: c.name + ' on MT3UK', url: HOME };
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share(Object.assign({ files: [file] }, data)).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          throw err;
        });
      }
      save(blob, name);
      flash(btn, 'Picture saved');
    }).catch(function () {
      flash(btn, 'Could not make the picture');
    }).then(function () { btn.disabled = false; });
  }

  function addButtons() {
    CARDS.forEach(function (c) {
      var card = document.querySelector(c.sel);
      if (!card || card.querySelector(':scope > .hp-card-share')) return;
      var link = card.tagName === 'A';
      var btn = document.createElement(link ? 'span' : 'button');
      btn.className = 'hp-card-share' + (c.dark ? ' is-dark' : '');
      if (link) { btn.setAttribute('role', 'button'); btn.tabIndex = 0; } else { btn.type = 'button'; }
      btn.setAttribute('aria-label', 'Share the ' + c.name + ' card as a picture');
      btn.title = 'Share this card as a picture';
      btn.innerHTML = ICON;
      btn.addEventListener('click', function (e) {
        // A card that is a link keeps its link for the card itself, not for the button.
        e.preventDefault();
        e.stopPropagation();
        if (!btn.disabled) share(c, card, btn);
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
  }

  addButtons();
  // Cards are drawn after the page loads (offers, sign-in, the next interview), so add their buttons as they appear.
  var hero = document.getElementById('hp-hero');
  if (hero && 'MutationObserver' in window) new MutationObserver(addButtons).observe(hero, { childList: true, subtree: true });
})();
