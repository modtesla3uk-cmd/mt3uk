/*
  Shared pages (Profile and My Garage) on laps.mt3uk.com.

  Both addresses serve the same files, so these MT3UK pages carry the Laps header and footer in two <template>s
  (scripts/build_layout.py, SHARED_PAGES). This script sits straight after the header and, on laps.mt3uk.com only,
  swaps the Laps header in before the page is drawn (the footer once the page has loaded), and uses the Laps app
  name and title. On mt3uk.com it does nothing. Tests set window.MT3UK_SITES to two local addresses.
*/
(function () {
  var SITES = window.MT3UK_SITES || { laps: ['laps.mt3uk.com'] };
  if (SITES.laps.indexOf(location.hostname) === -1) return;
  function swap(id, tag) {
    var tpl = document.getElementById(id), el = document.querySelector(tag);
    if (tpl && el) el.parentNode.replaceChild(tpl.content.cloneNode(true), el);
  }
  swap('laps-header-tpl', 'header');
  document.documentElement.classList.add('laps-shared');
  var manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.setAttribute('href', 'laps-manifest.json');
  var appName = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appName) appName.setAttribute('content', 'Laps');
  document.title = document.title.replace(/\s*[-—|]\s*MT3UK\s*$/, '') + ' - Laps by MT3UK';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { swap('laps-footer-tpl', 'footer'); });
  else swap('laps-footer-tpl', 'footer');
})();
