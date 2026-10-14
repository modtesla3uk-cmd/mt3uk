/* Applies the saved heading layout to the four Laps heading pages (Sessions, Leaderboard, My Analysis, Favourites),
   on desktop only. The layout is the one the editor saves to the site (?layout=edit, Save to site), kept by the worker
   under one key and read with GET /laps/heading-layout. The last answer is kept in this browser so the page is placed
   at once on a return visit, and the rules are refreshed from the worker each time. Desktop and phone each have their
   own saved layout. Nothing runs in the editor, which places the items itself. With no saved layout the built-in
   positions in css/laps-heading.css stay. */
(function () {
  if (/[?&]layout=edit(&|$)/.test(location.search)) return;

  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var CACHE = 'mt3ukLapsHeadingLayout';
  // Each role names the heading elements it moves (the lh-* classes on the four pages).
  var ROLE_SEL = { title: ['.lh-title'], back: ['.lh-back'], s1: ['.lh-s1'], s2: ['.lh-s2'], s3: ['.lh-s3'], intro: ['.lh-intro', '.lh-fold'] };
  var ROLES = Object.keys(ROLE_SEL);
  var HERO = 'body:not([data-tp-view="session"]) .lh-hero ';
  var style = null;

  /* One frame's rules. Desktop places the heading items with the built-in slot classes (css/laps-heading.css). Phone
     also has to take the heading out of its own flow, so its items and the heading box are made absolute here. */
  function frameCss(f, phone) {
    var rules = [], items = (f && f.items) || {};
    ROLES.forEach(function (role) {
      var p = items[role];
      if (!p) return;
      var body = (p.hide ? 'display: none !important;' : 'position: absolute !important; margin: 0 !important; ' +
        'left: ' + p.x + 'px !important; top: ' + p.y + 'px !important; width: ' + p.w + 'px !important; height: ' + p.h + 'px !important; font-size: ' + p.fs + 'px !important;');
      ROLE_SEL[role].forEach(function (sel) { rules.push(HERO + sel + ' { ' + body + ' }'); });
    });
    if (f && f.H) {
      var wrapSel = 'body:not([data-tp-view="session"]) .lh-hero > .wrap' + (phone ? '' : ':not(:has(.lh-fold[open]))');
      rules.push(wrapSel + ' { height: ' + f.H + 'px !important;' + (phone ? ' position: relative !important; display: block !important;' : '') + ' }');
    }
    return rules.join('\n');
  }

  function css(layout) {
    var layouts = layout || {}, out = [];
    if (layouts.desk) out.push('@media (min-width: 901px) {\n' + frameCss(layouts.desk, false) + '\n}');
    if (layouts.phone) out.push('@media (max-width: 900px) {\n' + frameCss(layouts.phone, true) + '\n}');
    return out.join('\n');
  }

  function apply(layout) {
    var text = css(layout);
    if (!style) {
      style = document.createElement('style');
      style.id = 'laps-heading-layout';
      document.head.appendChild(style);
    }
    style.textContent = text;
  }

  function kept() {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { return null; }
  }
  function keep(layout) {
    try { localStorage.setItem(CACHE, JSON.stringify(layout || {})); } catch (e) { /* not kept */ }
  }

  var first = kept();
  if (first) apply(first);

  fetch(API + '/laps/heading-layout', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.success) return;
      var layout = data.layout || {};
      if (JSON.stringify(layout) === JSON.stringify(first || {})) return;
      keep(layout);
      apply(layout);
    })
    .catch(function () { /* no answer: the kept layout, or the built-in one, stays */ });
})();
