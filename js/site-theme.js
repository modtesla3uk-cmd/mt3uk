/*
  The site theme for this site (mt3uk.com or laps.mt3uk.com). Runs in <head>, before the page is drawn, from the theme
  kept in this browser, so a returning visitor never sees the wrong colours. It then asks the worker (GET /site/theme) for
  both sites' themes and keeps them for next time. Set in the Site theme panel of admin.html.
*/
(function () {
  var API = window.MT3UK_THEME_API || 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var KEY = 'mt3ukTheme';
  var root = document.documentElement;
  var site = window.MT3UK_THEME_SITE || (/^(test\.)?laps\./.test(location.hostname) ? 'laps' : 'main');
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function apply(theme) {
    if (theme === 'jade') root.setAttribute('data-theme', 'jade');
    else root.removeAttribute('data-theme');
  }
  apply(read()[site]);
  if (!window.fetch) return;
  fetch(API + '/site/theme', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.success || !d.themes) return;
    try { localStorage.setItem(KEY, JSON.stringify({ main: d.themes.main, laps: d.themes.laps })); } catch (e) { /* storage blocked */ }
    apply(d.themes[site]);
  }).catch(function () { /* keep the theme already applied */ });
})();
