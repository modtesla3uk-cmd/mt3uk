/* The ? button by the title of the four Laps heading pages (Sessions, Leaderboard, My Analysis, Favourites) opens the
   "What is ...?" text of that page as a panel. One handler for every page, so the buttons carry no script of their own.
   On desktop the heading keeps its height while the panel is open, so the page under it does not move; the height is
   fixed from the closed heading just before the panel opens and released when it shuts. Phone keeps each page's own
   behaviour (css/laps-heading.css, and each page's phone rules). */
(function () {
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.tp-what-q');
    if (!btn) return;
    var hero = btn.closest('.page-hero');
    var fold = hero && hero.querySelector('.lh-fold');
    var wrap = hero && hero.querySelector('.wrap');
    if (!fold) return;
    var height = wrap ? wrap.offsetHeight : 0;
    fold.open = !fold.open;
    btn.setAttribute('aria-expanded', String(fold.open));
    if (!wrap || !(innerWidth > 900)) return;
    if (fold.open) {
      wrap.style.setProperty('height', height + 'px', 'important');
      wrap.style.setProperty('padding-top', '0', 'important');
    } else {
      wrap.style.removeProperty('height');
      wrap.style.removeProperty('padding-top');
    }
  });
})();
