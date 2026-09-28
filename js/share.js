// Share a gallery photo from anywhere on the site.
//
//   window.mt3ukShare({ file, caption, name, campaign }, buttonEl)
//
// Links go to the photo's share page (share/<file>.html, written by
// scripts/build_share_pages.py), which shows the photo in link previews and
// sends people on to the reel. Each link carries UTM parameters: the channel
// as utm_source and the campaign (reel_share, garage_share, cotd_share...).
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

  function link(photo, channel) {
    return SITE + '/share/' + encodeURIComponent(photo.file) + '.html' +
      '?utm_source=' + channel + '&utm_medium=share&utm_campaign=' + (photo.campaign || 'photo_share');
  }

  function text(photo) {
    var caption = titleCase(photo.caption);
    var name = titleCase(photo.name);
    var what = caption ? caption + (name ? ' by ' + name : '') : (name ? name + '’s build' : 'this build');
    return 'Check out ' + what + ' on MT3UK, the UK’s modified Tesla community';
  }

  function channelHref(channel, message, url) {
    if (channel === 'whatsapp') return 'https://wa.me/?text=' + encodeURIComponent(message + ' ' + url);
    if (channel === 'facebook') return 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url);
    if (channel === 'x') return 'https://x.com/intent/post?text=' + encodeURIComponent(message) + '&url=' + encodeURIComponent(url);
    if (channel === 'email') return 'mailto:?subject=' + encodeURIComponent('A build on MT3UK') + '&body=' + encodeURIComponent(message + '\n\n' + url);
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
      '.mt3uk-share-close{background:none;border:0;font-size:1.3rem;line-height:1;cursor:pointer;color:inherit;padding:2px 6px}' +
      '.mt3uk-share-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
      '.mt3uk-share-opt{display:block;text-align:center;padding:9px 6px;border:1px solid #16233d;border-radius:8px;background:#fff;' +
        'color:#16233d;text-decoration:none;font:600 .82rem "IBM Plex Sans",sans-serif;cursor:pointer}' +
      '.mt3uk-share-opt:hover{background:#e8542a;border-color:#e8542a;color:#fff}' +
      '.mt3uk-share-wide{grid-column:1/-1}' +
      '.mt3uk-share-opt[hidden]{display:none}' +
      '.mt3uk-share-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1300;background:#16233d;color:#fff;' +
        'padding:10px 16px;border-radius:999px;font:500 .88rem "IBM Plex Sans",sans-serif;box-shadow:0 6px 18px rgba(5,7,12,.3)}';
    var style = document.createElement('style');
    style.id = 'mt3uk-share-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function closePanel() {
    if (panel) panel.hidden = true;
    current = null;
  }

  function nativeShare(photo) {
    return navigator.share({ title: 'MT3UK', text: text(photo), url: link(photo, 'share_sheet') });
  }

  function buildPanel() {
    addStyles();
    panel = document.createElement('div');
    panel.className = 'mt3uk-share-pop';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Share this build');
    panel.hidden = true;
    panel.innerHTML =
      '<div class="mt3uk-share-head"><span>Share this build</span>' +
        '<button type="button" class="mt3uk-share-close" aria-label="Close share options">&times;</button></div>' +
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
      var photo = current;
      if (option.dataset.channel === 'copy_link') {
        copyText(link(photo, 'copy_link'))
          .then(function () { toast('Link copied'); })
          .catch(function () { toast('Could not copy the link'); });
      } else if (option.dataset.channel === 'share_sheet') {
        nativeShare(photo).catch(function () {});
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

  function openPanel(photo, anchor) {
    if (!panel) buildPanel();
    current = photo;
    var message = text(photo);
    panel.querySelectorAll('a[data-channel]').forEach(function (a) {
      a.href = channelHref(a.dataset.channel, message, link(photo, a.dataset.channel));
    });
    panel.querySelector('[data-channel="share_sheet"]').hidden = typeof navigator.share !== 'function';
    panel.hidden = false;
    place(anchor);
    var first = panel.querySelector('.mt3uk-share-opt');
    if (first) first.focus({ preventScroll: true });
  }

  window.mt3ukShare = function (photo, anchor) {
    if (!photo || !photo.file) return;
    if (panel && !panel.hidden && current && current.file === photo.file && current.anchor === anchor) { closePanel(); return; }
    photo = { file: photo.file, caption: photo.caption, name: photo.name, campaign: photo.campaign, anchor: anchor };
    var preferNative = typeof navigator.share === 'function' && window.matchMedia && window.matchMedia('(hover: none)').matches;
    if (!preferNative) { openPanel(photo, anchor); return; }
    nativeShare(photo).catch(function (err) {
      // Cancelling the share menu is not an error; anything else falls
      // back to the pop-out.
      if (!err || err.name !== 'AbortError') openPanel(photo, anchor);
    });
  };
})();
