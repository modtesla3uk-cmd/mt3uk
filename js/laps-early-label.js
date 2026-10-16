// The early preview labels (the "Early preview" under the Laps logo and in its aria label, the badge on the Sessions
// card of the homepage, and the Laps front page note) come off once Laps is open to all members. /laps/signin says
// whether it is still a preview (preview: false once it is open). The answer is kept for the browser session, under
// the same key as js/laps-strip.js. The labels stay until the answer says Laps is open, so nothing changes for a preview.
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var KEY = 'mt3ukLapsPreview';
  var PREVIEW = /early preview/i;

  function keep(v) { try { sessionStorage.setItem(KEY, v); } catch (e) { /* storage blocked */ } }

  // Takes the labels off a node and everything under it.
  function clean(node) {
    if (!node || node.nodeType !== 1) return;
    var all = node.querySelectorAll ? node.querySelectorAll('.laps-logo-early, .early-badge, .laps-logo, #lh-note') : [];
    var list = [].slice.call(all);
    if (node.matches && node.matches('.laps-logo-early, .early-badge, .laps-logo, #lh-note')) list.unshift(node);
    list.forEach(function (el) {
      if (el.classList.contains('laps-logo')) {
        if (PREVIEW.test(el.getAttribute('aria-label') || '')) el.setAttribute('aria-label', 'Laps by MT3UK');
      } else if (el.classList.contains('laps-logo-early') || el.classList.contains('early-badge') || el.id === 'lh-note') {
        if (PREVIEW.test(el.textContent || '')) el.parentNode && el.parentNode.removeChild(el);
      }
    });
  }

  function open() {
    clean(document.documentElement);
    // Headers can be swapped in after the page loads (js/laps-shared.js), so keep taking the labels off as they arrive.
    if (window.MutationObserver) {
      new MutationObserver(function (records) {
        records.forEach(function (rec) { [].forEach.call(rec.addedNodes, clean); });
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Asked on every page load. A stored 'yes' is not trusted (a tab that saw the preview before Laps opened to all would
  // keep the labels), so the answer is only read back to be written again.
  fetch(API + '/laps/signin', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || typeof d.preview !== 'boolean') return;
      keep(d.preview ? 'yes' : 'no');
      // Remembered for the next page load, so the labels are hidden before the page paints (the snippet in each page's head).
      try { if (d.preview) localStorage.removeItem('mt3ukLapsOpen'); else localStorage.setItem('mt3ukLapsOpen', '1'); } catch (e) { /* storage blocked */ }
      if (!d.preview) open();
    })
    .catch(function () { /* no answer: the labels stay */ });
})();
