/*
  Light or dark. Set before the page is drawn, so a returning visitor never sees the wrong colours. Any [data-mode-toggle]
  button (the Laps footer, the intro, Profile, RaceBox and Navigate) switches it, and the choice is kept in this browser.

  RaceBox and Navigate are dark until the visitor picks light. The Laps pages (they carry data-default-mode) follow the
  admin's setting on the Site theme panel of admin.html, which js/site-theme.js fetches with the theme (GET /site/theme,
  kept in localStorage mt3ukModeSite):
  - Default for a visitor who has not picked: light, dark, or system (the visitor's own device setting).
  - Dark for everyone (darkAll): every Laps page opens dark for everyone, an earlier choice of light included. A visitor
    who picks light after it was switched on (darkAllAt) keeps light.
*/
(function () {
  var KEY = 'mt3ukColourMode', AT = 'mt3ukColourModeAt', SITE = 'mt3ukModeSite';
  var root = document.documentElement;
  var managed = root.hasAttribute('data-default-mode');
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: lasts this visit */ } }
  function own() { var v = get(KEY); return v === 'light' || v === 'dark' ? v : ''; }
  function site() { try { return JSON.parse(get(SITE) || '{}') || {}; } catch (e) { return {}; } }
  var device = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function choose() {
    var mine = own();
    if (!managed) return mine || (root.getAttribute('data-default-mode') === 'light' ? 'light' : 'dark');
    var cfg = site();
    if (cfg.darkAll && (!mine || (Number(get(AT)) || 0) < (Number(cfg.darkAllAt) || 0))) return 'dark';
    if (mine) return mine;
    if (cfg.laps === 'dark') return 'dark';
    if (cfg.laps === 'system') return device && device.matches ? 'dark' : 'light';
    return root.getAttribute('data-default-mode') === 'dark' ? 'dark' : 'light';
  }
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
  apply(choose());
  // The admin's settings arrive from js/site-theme.js after the page has started; a change is applied at once.
  window.MT3UKColourMode = {
    refresh: function (cfg) {
      if (cfg) set(SITE, JSON.stringify({ laps: cfg.laps, darkAll: !!cfg.darkAll, darkAllAt: Number(cfg.darkAllAt) || 0 }));
      apply(choose());
    }
  };
  // Following the device: a change of the device's setting while the page is open is followed too.
  if (device && device.addEventListener) device.addEventListener('change', function () { apply(choose()); });
  document.addEventListener('DOMContentLoaded', function () {
    var btns = document.querySelectorAll('[data-mode-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var next = root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
        set(KEY, next);
        set(AT, String(Date.now()));
        apply(next);
      });
    }
    apply(root.getAttribute('data-mode') || choose());
  });
})();
