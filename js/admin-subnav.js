/*
  Second menu row for admin.html and track-admin.html: the sections inside the category being read.
  It is built from the page, so a new panel appears here without any change.
  Choosing one opens the panel and scrolls to it. The menu above it stays as
  the list of categories, and the current one is marked.
*/
(function () {
  var nav = document.querySelector('.admin-nav');
  var sub = document.getElementById('admin-subnav');
  if (!nav || !sub) return;
  // The page this menu is on (admin.html or track-admin.html), read from its own category links.
  var firstLink = nav.querySelector('a[href*="#grp-"]');
  var PAGE = firstLink ? firstLink.getAttribute('href').split('#')[0] : 'admin.html';
  var groups = [].slice.call(document.querySelectorAll('.admin-group'));
  var current = null;

  function titleOf(d) {
    var h = d.querySelector('summary .panel-title');
    if (!h) return '';
    var c = h.cloneNode(true);
    [].slice.call(c.querySelectorAll('.summary-count')).forEach(function (n) { n.parentNode.removeChild(n); });
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  function setHeights() {
    var h = nav.offsetHeight;
    document.documentElement.style.setProperty('--nav-h', h + 'px');
    sub.style.top = h + 'px';
  }

  function build(group) {
    sub.innerHTML = '';
    var panels = [].slice.call(group.querySelectorAll('details.collapsible')).filter(function (d) { return !d.hidden && d.id && titleOf(d); });
    sub.hidden = panels.length < 2;
    panels.forEach(function (d) {
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = PAGE + '#' + d.id;
      a.textContent = titleOf(d);
      a.setAttribute('data-panel', d.id);
      li.appendChild(a);
      sub.appendChild(li);
    });
    setHeights();
  }

  function mark(group) {
    [].slice.call(nav.querySelectorAll('a[href^="' + PAGE + '#grp-"]')).forEach(function (a) {
      if (a.getAttribute('href') === PAGE + '#' + group.id) a.setAttribute('data-here', 'true'); else a.removeAttribute('data-here');
    });
  }

  function update() {
    var line = nav.offsetHeight + sub.offsetHeight + 40, pick = groups[0];
    groups.forEach(function (g) { if (g.getBoundingClientRect().top <= line) pick = g; });
    // At the foot of the page the last group can't scroll up to the line.
    if (window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 4) pick = groups[groups.length - 1];
    if (pick && pick !== current) { current = pick; build(pick); mark(pick); }
  }

  nav.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="' + PAGE + '#grp-"]');
    var g = a && document.getElementById(a.getAttribute('href').split('#')[1]);
    if (g) { current = g; build(g); mark(g); }
  });

  sub.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-panel]');
    if (!a) return;
    e.preventDefault();
    var d = document.getElementById(a.getAttribute('data-panel'));
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (history.replaceState) history.replaceState(null, '', PAGE + '#' + d.id);
  });

  var queued = false;
  function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; update(); }); }
  window.addEventListener('scroll', soon, { passive: true });
  window.addEventListener('resize', function () { setHeights(); soon(); });
  // Panels fill in and show or hide as the lists load.
  if (window.MutationObserver) {
    var mo = new MutationObserver(function () { if (current) build(current); });
    groups.forEach(function (g) { mo.observe(g, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); });
  }
  setHeights();
  update();
})();
