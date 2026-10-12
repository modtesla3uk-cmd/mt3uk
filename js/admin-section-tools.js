/*
  A refresh button against every section of the admin pages (admin.html and track-admin.html): one at the end of each
  panel's title bar, beside its "?", and one at the right of each category's heading. Pressing it loads the panels
  again from the server (the same as the Refresh at the top of the page, through "mt3uk-admin-refresh") and keeps the
  section where it is on the screen while the lists redraw, so there is no scrolling up and down to refresh and then
  find the place again. If you scroll or press a key while it settles, it lets go at once.
*/
(function () {
  var ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
  var HOLD_MS = 4000;     // how long the section is held in place while the lists redraw

  function make(label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sec-refresh';
    b.setAttribute('aria-label', label);
    b.setAttribute('title', label);
    b.innerHTML = ICON;
    // Enter and Space on the button must not open or close the panel it sits in.
    b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
    return b;
  }

  function add() {
    [].slice.call(document.querySelectorAll('details.collapsible > summary')).forEach(function (sum) {
      if (sum.querySelector('.sec-refresh') || !sum.querySelector('.panel-title')) return;
      sum.classList.add('has-tools');
      sum.appendChild(make('Refresh this section'));
    });
    [].slice.call(document.querySelectorAll('.admin-group > .group-head')).forEach(function (head) {
      if (head.querySelector('.sec-refresh')) return;
      head.classList.add('has-tools');
      head.appendChild(make('Refresh this category'));
    });
  }

  // Keeps the section's heading at the same place on the screen until the lists have settled or the reader moves.
  function hold(anchor, done) {
    var top = anchor.getBoundingClientRect().top, until = Date.now() + HOLD_MS, stopped = false;
    var stops = ['wheel', 'touchstart', 'keydown'];
    function stop() { stopped = true; }
    stops.forEach(function (n) { window.addEventListener(n, stop, { once: true, passive: true }); });
    (function frame() {
      if (stopped || Date.now() > until) {
        stops.forEach(function (n) { window.removeEventListener(n, stop); });
        done();
        return;
      }
      var d = anchor.getBoundingClientRect().top - top;
      if (Math.abs(d) > 1) window.scrollBy({ top: d, left: 0, behavior: 'instant' });
      requestAnimationFrame(frame);
    })();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.sec-refresh');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.classList.contains('is-busy')) return;
    var box = b.closest('details.collapsible') || b.closest('.admin-group');
    if (!box) return;
    if (box.tagName === 'DETAILS') box.open = true;
    var anchor = box.tagName === 'DETAILS' ? box.querySelector('summary') : (box.querySelector('.group-head') || box);
    b.classList.add('is-busy');
    b.setAttribute('aria-busy', 'true');
    document.dispatchEvent(new CustomEvent('mt3uk-admin-refresh'));
    hold(anchor, function () { b.classList.remove('is-busy'); b.removeAttribute('aria-busy'); });
  }, true);

  add();
  // Panels the pages draw later get theirs too.
  var timer = null;
  if (window.MutationObserver) {
    new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(add, 150); }).observe(document.body, { childList: true, subtree: true });
  }
})();
