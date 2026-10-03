// Sharing, for photos and for pages and sections of the site.
//
//   window.mt3ukShare({ file, caption, name, campaign }, buttonEl)
//
// Photo links go to the photo's share page (share/<file>.html, written by
// scripts/build_share_pages.py), which shows the photo in link previews and
// sends people on to the reel. Each link carries UTM parameters: the channel
// as utm_source and the campaign (reel_share, garage_share, botw_share...).
//
// Every page also gets small round share buttons: one by the page's main
// heading (campaign page_<page>) and one by each section heading, which
// links straight to that section (campaign section_<section id>). Their
// links go to share/section/<page>--<section>.html (written by
// scripts/build_section_share_pages.py), so link previews show the
// section's title, intro text and a photo, and the message includes the
// intro text too. Sections
// are <section id="..."> with an <h2>; other headings can opt in with
// data-share-anchor="<id to link to>". Add data-no-share to a heading or
// section to leave it out.
//
// Phones open their own share menu. Desktops get a small pop-out beside the
// button with WhatsApp, Facebook, X, Email and Copy link.
(function () {
  var SITE = 'https://mt3uk.com';
  var panel = null;
  var current = null;

  function titleCase(value) {
    return String(value || '').toLowerCase().replace(/(^|[\s-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  // The ISO week, stamped into every share link: chat apps keep the preview card they first made for an address,
  // so a link that changes each week picks up the week's preview picture (see the Link preview picture panel on
  // admin.html) rather than showing a stale card.
  function isoWeek() {
    var t = new Date(), d = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())), day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var wk = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
    return d.getUTCFullYear() + '-W' + (wk < 10 ? '0' : '') + wk;
  }
  function utm(channel, campaign) {
    return 'utm_source=' + channel + '&utm_medium=share&utm_campaign=' + campaign + '&w=' + isoWeek();
  }

  // What gets shared: the message, and the link for each channel.
  function photoItem(photo, anchor) {
    var caption = titleCase(photo.caption);
    // Old names are in capitals; a member's own name keeps its capitals.
    var name = /[a-z]/.test(photo.name || '') ? photo.name : titleCase(photo.name);
    var what = caption ? caption + (name ? ' by ' + name : '') : (name ? name + '’s build' : 'this build');
    return {
      key: 'photo:' + photo.file,
      anchor: anchor,
      heading: 'Share this build',
      subject: 'A build on MT3UK',
      text: 'Check out ' + what + ' on MT3UK, the UK’s modified Tesla community',
      link: function (channel) {
        return SITE + '/share/' + encodeURIComponent(photo.file) + '.html?' + utm(channel, photo.campaign || 'photo_share');
      }
    };
  }

  function pageItem(opts, anchor) {
    return {
      key: 'page:' + opts.path + '#' + (opts.hash || ''),
      anchor: anchor,
      heading: opts.heading || 'Share this page',
      subject: opts.title + ' | MT3UK',
      text: opts.text || (opts.intro
        ? opts.title + (/MT3UK/.test(opts.title) ? ': ' : ' on MT3UK: ') + opts.intro
        : opts.title + ' on MT3UK, the UK’s modified Tesla community'),
      link: function (channel) {
        return SITE + '/share/section/' + opts.stem + (opts.hash ? '--' + opts.hash : '') + '.html?' + utm(channel, opts.campaign);
      }
    };
  }

  function channelHref(channel, message, url, subject) {
    if (channel === 'whatsapp') return 'https://wa.me/?text=' + encodeURIComponent(message + ' ' + url);
    if (channel === 'facebook') return 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url);
    if (channel === 'x') return 'https://x.com/intent/post?text=' + encodeURIComponent(message) + '&url=' + encodeURIComponent(url);
    if (channel === 'email') return 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(message + '\n\n' + url);
    return url;
  }

  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      if (ok) resolve(); else reject();
    });
  }

  function toast(message) {
    var el = document.createElement('div');
    el.className = 'mt3uk-share-toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  function addStyles() {
    if (document.getElementById('mt3uk-share-styles')) return;
    var css =
      '.mt3uk-share-pop{position:fixed;z-index:1200;width:240px;background:#fff;color:#16233d;border:1px solid #16233d;' +
        'border-radius:14px;box-shadow:0 12px 32px rgba(5,7,12,.28);padding:12px;font-family:"IBM Plex Sans",sans-serif}' +
      '.mt3uk-share-pop[hidden]{display:none}' +
      '.mt3uk-share-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:600;font-size:.92rem}' +
      '.mt3uk-share-close{display:flex;align-items:center;justify-content:center;background:none;border:0;border-radius:50%;width:32px;height:32px;line-height:1;cursor:pointer;color:inherit;padding:0}' +
      '.mt3uk-share-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
      '.mt3uk-share-opt{display:block;text-align:center;padding:9px 6px;border:1px solid #16233d;border-radius:8px;background:#fff;' +
        'color:#16233d;text-decoration:none;font:600 .82rem "IBM Plex Sans",sans-serif;cursor:pointer}' +
      '.mt3uk-share-opt:hover{background:#e8542a;border-color:#e8542a;color:#fff}' +
      '.mt3uk-share-wide{grid-column:1/-1}' +
      '.mt3uk-share-opt[hidden]{display:none}' +
      '.mt3uk-share-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1300;background:#16233d;color:#fff;' +
        'padding:10px 16px;border-radius:999px;font:500 .88rem "IBM Plex Sans",sans-serif;box-shadow:0 6px 18px rgba(5,7,12,.3)}' +
      '.mt3uk-share-dot{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;margin-left:10px;' +
        'vertical-align:middle;border-radius:50%;border:1px solid currentColor;background:transparent;color:inherit;opacity:.7;cursor:pointer;' +
        'position:relative;top:-2px;flex-shrink:0}' +
      '.mt3uk-share-dot svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}' +
      '.mt3uk-share-dot:hover,.mt3uk-share-dot:focus-visible{opacity:1;background:#e8542a;border-color:#e8542a;color:#fff}' +
      '.mt3uk-share-dot::before{content:"";position:absolute;inset:-8px}' +
      // Phones: over at the far right of the heading line.
      // (float for plain headings, margin-left:auto for flex ones).
      '@media (max-width:780px){.mt3uk-share-dot{float:right;margin:0 0 0 auto;top:0;shape-outside:margin-box;shape-margin:10px}h1.mt3uk-share-heading{display:flex}' +
        '.mt3uk-share-heading,.mt3uk-share-wrap{align-self:stretch;flex:1 1 auto;max-width:none!important}}';
    var style = document.createElement('style');
    style.id = 'mt3uk-share-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function closePanel() {
    if (panel) panel.hidden = true;
    current = null;
  }

  function nativeShare(item) {
    return navigator.share({ title: 'MT3UK', text: item.text, url: item.link('share_sheet') });
  }

  function buildPanel() {
    addStyles();
    panel = document.createElement('div');
    panel.className = 'mt3uk-share-pop';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Share');
    panel.hidden = true;
    panel.innerHTML =
      '<div class="mt3uk-share-head"><span class="mt3uk-share-title">Share</span>' +
        '<button type="button" class="mt3uk-share-close" aria-label="Close share options"><svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '<div class="mt3uk-share-grid">' +
        '<a class="mt3uk-share-opt" data-channel="whatsapp" target="_blank" rel="noopener">WhatsApp</a>' +
        '<a class="mt3uk-share-opt" data-channel="facebook" target="_blank" rel="noopener">Facebook</a>' +
        '<a class="mt3uk-share-opt" data-channel="x" target="_blank" rel="noopener">X</a>' +
        '<a class="mt3uk-share-opt" data-channel="email">Email</a>' +
        '<button type="button" class="mt3uk-share-opt mt3uk-share-wide" data-channel="copy_link">Copy link</button>' +
        '<button type="button" class="mt3uk-share-opt mt3uk-share-wide" data-channel="share_sheet" hidden>More options</button>' +
      '</div>';
    document.body.appendChild(panel);

    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target.closest('.mt3uk-share-close')) { closePanel(); return; }
      var option = e.target.closest('[data-channel]');
      if (!option || !current) return;
      var item = current;
      if (option.dataset.channel === 'copy_link') {
        copyText(item.link('copy_link'))
          .then(function () { toast('Link copied'); })
          .catch(function () { toast('Could not copy the link'); });
      } else if (option.dataset.channel === 'share_sheet') {
        nativeShare(item).catch(function () {});
      }
      closePanel();
    });
    document.addEventListener('click', function (e) {
      if (!panel || panel.hidden || panel.contains(e.target)) return;
      if (current && current.anchor && current.anchor.contains(e.target)) return;
      closePanel();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel && !panel.hidden) { e.stopPropagation(); closePanel(); }
    }, true);
    // Keep the pop-out beside its button as the page or a panel scrolls.
    function follow() { if (panel && !panel.hidden && current) place(current.anchor); }
    window.addEventListener('resize', follow);
    document.addEventListener('scroll', follow, { passive: true, capture: true });
  }

  function place(anchor) {
    var r = anchor.getBoundingClientRect();
    var w = panel.offsetWidth;
    var h = panel.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function openPanel(item) {
    if (!panel) buildPanel();
    current = item;
    panel.querySelector('.mt3uk-share-title').textContent = item.heading;
    panel.setAttribute('aria-label', item.heading);
    panel.querySelectorAll('a[data-channel]').forEach(function (a) {
      a.href = channelHref(a.dataset.channel, item.text, item.link(a.dataset.channel), item.subject);
    });
    panel.querySelector('[data-channel="share_sheet"]').hidden = typeof navigator.share !== 'function';
    panel.hidden = false;
    place(item.anchor);
    var first = panel.querySelector('.mt3uk-share-opt');
    if (first) first.focus({ preventScroll: true });
  }

  function share(item) {
    // A second tap on the same button closes the pop-out.
    if (panel && !panel.hidden && current && current.key === item.key && current.anchor === item.anchor) { closePanel(); return; }
    var preferNative = typeof navigator.share === 'function' && window.matchMedia && window.matchMedia('(hover: none)').matches;
    if (!preferNative) { openPanel(item); return; }
    nativeShare(item).catch(function (err) {
      // Cancelling the share menu is not an error; anything else falls
      // back to the pop-out.
      if (!err || err.name !== 'AbortError') openPanel(item);
    });
  }

  window.mt3ukShare = function (photo, anchor) {
    if (!photo || !photo.file) return;
    share(photoItem(photo, anchor));
  };

  // A page of its own that has no section share page, such as one track
  // session: window.mt3ukSharePage({ url, text, heading, subject, campaign }, buttonEl)
  // shares that exact address (with UTM parameters).
  window.mt3ukSharePage = function (opts, anchor) {
    if (!opts || !opts.url) return;
    share({
      key: 'url:' + opts.url,
      anchor: anchor,
      heading: opts.heading || 'Share this page',
      subject: opts.subject || 'MT3UK',
      text: opts.text || 'Check this out on MT3UK, the UK’s modified Tesla community',
      link: function (channel) {
        return opts.url + (opts.url.indexOf('?') === -1 ? '?' : '&') + utm(channel, opts.campaign || 'page_share');
      }
    });
  };

  // Small round share buttons by the page heading and each section heading.
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg>';

  function headingText(el) {
    var clone = el.cloneNode(true);
    clone.querySelectorAll('.mt3uk-share-dot, button, .nav-sublink-new').forEach(function (n) { n.remove(); });
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function addDot(heading, opts) {
    if (!heading || (heading.closest('[data-no-share]') && !heading.hasAttribute('data-share-page')) || heading.querySelector('.mt3uk-share-dot')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mt3uk-share-dot';
    btn.setAttribute('aria-label', opts.heading);
    btn.innerHTML = ICON;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      share(pageItem(opts, btn));
    });
    heading.classList.add('mt3uk-share-heading');
    // On phones the button sits at the far right, so the boxes around the
    // heading, up to its section head, stretch to the full width too.
    for (var box = heading.parentElement, n = 0; box && n < 3 && !/^(SECTION|BODY|MAIN)$/.test(box.tagName) && !box.classList.contains('wrap'); box = box.parentElement, n++) {
      box.classList.add('mt3uk-share-wrap');
      if (box.classList.contains('section-head')) break;
    }
    heading.appendChild(btn);
  }

  // The first paragraph after a heading with some substance, skipping
  // countdowns. Matches scripts/build_section_share_pages.py.
  function introAfter(scope, heading) {
    var paras = (scope || document).querySelectorAll('p');
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      if (!(heading.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (p.classList.contains('hp-countdown')) continue;
      var text = p.textContent.replace(/\s+/g, ' ').trim();
      if (text.length < 30) continue;
      if (text.length > 200) text = text.slice(0, 200).replace(/\s+\S*$/, '').replace(/[,;:]$/, '') + '...';
      return text;
    }
    return '';
  }

  function addDots() {
    if (document.body.hasAttribute('data-no-share')) return;
    addStyles();
    var path = location.pathname.replace(/\/index\.html$/, '/');
    if (!/^\/[\w\-\/]*(\.html)?$/.test(path)) path = '/';
    var page = (path.replace(/^\//, '').replace(/\.html$/, '') || 'home').replace(/[^\w-]/g, '');
    var stem = page === 'home' ? 'index' : page;

    // A page whose h1 isn't about the page (the homepage hero shows the
    // latest interview) marks another element with data-share-page="<title>".
    var marked = document.querySelector('[data-share-page]');
    var main = marked || document.querySelector('h1:not(header h1)');
    if (main) {
      addDot(main, {
        path: path, stem: stem, title: (marked && marked.getAttribute('data-share-page')) || headingText(main) || 'MT3UK', intro: marked ? '' : introAfter(document, main),
        campaign: 'page_' + page, heading: 'Share this page',
        text: page === 'home' ? 'Check out MT3UK, the UK’s modified Tesla community' : null
      });
    }

    var targets = [];
    document.querySelectorAll('section[id]').forEach(function (section) {
      if (section.querySelector('h1')) return;
      var h2 = section.querySelector('h2');
      if (h2) targets.push({ heading: h2, id: section.id });
    });
    document.querySelectorAll('[data-share-anchor]').forEach(function (h) {
      targets.push({ heading: h, id: h.getAttribute('data-share-anchor') });
    });
    targets.forEach(function (t) {
      var title = headingText(t.heading);
      var scope = t.heading.closest('section') || document;
      addDot(t.heading, {
        path: path, stem: stem, hash: t.id, title: title, intro: introAfter(scope, t.heading),
        campaign: 'section_' + t.id.replace(/[^\w-]/g, ''), heading: 'Share this section'
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addDots);
  else addDots();
})();
