/*
  Light or dark on the RaceBox and Navigate pages. Set before the page is drawn (dark by default on these pages), so a
  returning member never sees the wrong colours. The button (#rbt-mode-toggle or #nav-mode-toggle) switches it, and the
  choice is kept in this browser.
*/
(function () {
  var KEY = 'mt3ukColourMode';
  var root = document.documentElement;
  function read() { try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } }
  function apply(mode) {
    root.setAttribute('data-mode', mode);
    var btns = document.querySelectorAll('[data-mode-toggle]');
    for (var i = 0; i < btns.length; i++) {
      var dark = mode === 'dark';
      btns[i].setAttribute('aria-pressed', dark ? 'true' : 'false');
      btns[i].setAttribute('aria-label', dark ? 'Dark mode is on. Tap for light mode.' : 'Light mode is on. Tap for dark mode.');
      btns[i].textContent = dark ? 'Light mode' : 'Dark mode';
    }
  }
  apply(read());
  document.addEventListener('DOMContentLoaded', function () {
    var btns = document.querySelectorAll('[data-mode-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var next = root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch (e) { /* storage blocked: the choice lasts this visit */ }
        apply(next);
      });
    }
    apply(root.getAttribute('data-mode') || 'dark');
  });
})();
