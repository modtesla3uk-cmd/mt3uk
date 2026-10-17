/* The site's look, set by the look editor (?look=edit) and kept by the worker:
   - colours for the whole site (GET /site/look): the values go on the root element as inline custom properties, so they
     beat the colour tokens a page sets in its own style;
   - the colours of single buttons (GET /site/buttons): a button carries data-btn="<name>" (the same name on every page
     for the same destination) and gets its background and text colour from its saved entry.
   The last answers are kept in this browser so the look is right at once on a return visit, and both are refreshed
   from the worker each time. With ?look=edit the page also gets the editor: colour pickers for the site, a sample of
   the buttons, a button list (click a button on the page, or pick it from the list), live preview and Save to site
   (the admin key, kept for this tab). */
(function () {
  if (!window.MT3UKWithAdminKey) document.head.appendChild(Object.assign(document.createElement('script'), { src: 'js/admin-key-ask.js' }));
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var CACHE = 'mt3ukSiteLook', BTN_CACHE = 'mt3ukSiteButtons';
  var EDIT = /[?&]look=edit(&|$)/.test(location.search);
  // The colours the editor offers, with the value a page falls back to when it sets none of its own.
  var COLOURS = [
    { name: '--ink', label: 'Ink (text, headings, navy)', fallback: '#16233d' },
    { name: '--orange', label: 'Orange (accents, Add buttons)', fallback: '#e8542a' },
    { name: '--steel', label: 'Steel (captions, quiet text)', fallback: '#7c8798' },
    { name: '--paper', label: 'Paper (page background)', fallback: '#f3f1ea' },
    { name: '--white', label: 'White (cards)', fallback: '#ffffff' },
    { name: '--charcoal', label: 'Charcoal', fallback: '#2b2b2b' },
    { name: '--hdr-bg', label: 'Header background', fallback: '#f3f1ea' },
    { name: '--btn-primary', label: 'Primary button', fallback: '#16233d' },
    { name: '--btn-primary-text', label: 'Primary button text', fallback: '#ffffff' },
    { name: '--btn-accent', label: 'Accent button', fallback: '#e8542a' },
    { name: '--btn-accent-text', label: 'Accent button text', fallback: '#ffffff' },
    { name: '--btn-secondary', label: 'Secondary button', fallback: '#ffffff' },
    { name: '--btn-secondary-text', label: 'Secondary button text', fallback: '#16233d' }
  ];
  var applied = [];
  var root = document.documentElement;

  function kept(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function keep(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value || {})); } catch (e) { /* not kept */ }
  }

  /* ---- site colours ---- */
  function apply(look) {
    var vars = (look && look.vars) || {};
    applied.forEach(function (name) { if (!vars[name]) root.style.removeProperty(name); });
    applied = Object.keys(vars);
    applied.forEach(function (name) { root.style.setProperty(name, vars[name]); });
  }

  /* ---- single buttons ---- */
  function paintButtons(map) {
    document.querySelectorAll('[data-btn]').forEach(function (el) {
      el.style.removeProperty('background');
      el.style.removeProperty('color');
      var o = (map || {})[el.getAttribute('data-btn')];
      if (!o) return;
      if (o.bg) el.style.setProperty('background', o.bg, 'important');
      if (o.text) el.style.setProperty('color', o.text, 'important');
    });
  }

  var firstLook = kept(CACHE), firstButtons = kept(BTN_CACHE);
  if (firstLook) apply(firstLook);
  function startPainting() { paintButtons(firstButtons || {}); }
  if (document.readyState !== 'loading') startPainting();
  else document.addEventListener('DOMContentLoaded', startPainting);

  fetch(API + '/site/look', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.success) return;
      var look = data.look || {};
      if (JSON.stringify(look) === JSON.stringify(firstLook || {})) return;
      keep(CACHE, look);
      apply(look);
    })
    .catch(function () { /* no answer: the kept colours, or the page's own, stay */ });

  fetch(API + '/site/buttons', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.success) return;
      var buttons = data.buttons || {};
      if (JSON.stringify(buttons) === JSON.stringify(firstButtons || {})) return;
      keep(BTN_CACHE, buttons);
      if (document.readyState !== 'loading') paintButtons(buttons);
      else document.addEventListener('DOMContentLoaded', function () { paintButtons(buttons); });
    })
    .catch(function () { /* no answer: the kept button colours, or the page's own, stay */ });

  /* ---- the editor ---- */
  var bar = null, pickers = {}, saved = {}, dirty = {}, msg = null;
  var savedButtons = {}, btnPick = null, btnBg = null, btnText = null;

  function current(name) {
    var c = getComputedStyle(root).getPropertyValue(name).trim();
    return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : '';
  }
  // A computed colour (rgb or rgba) as the six-figure hex the colour inputs take.
  function hexOf(css) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css || '');
    if (!m) return '#ffffff';
    return '#' + [m[1], m[2], m[3]].map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join('');
  }
  function fill(look) {
    saved = (look && look.vars) || {};
    COLOURS.forEach(function (c) {
      pickers[c.name].value = saved[c.name] || current(c.name) || c.fallback;
    });
  }
  function say(text) { if (msg) msg.textContent = text; }
  function post(path, body, done, onSaved) {
    window.MT3UKWithAdminKey('Admin key, to save these changes for every visitor:', function (key) {
    if (!key) { say('Not saved: no admin key.'); return; }
    say('Saving...');
    fetch(API + path + '?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) { sessionStorage.removeItem('mt3ukAdminKey'); say('Not saved: the admin key was not accepted.'); return; }
        if (!r.ok || !d.success) { say('Not saved: ' + (d.message || 'the site did not answer.')); return; }
        onSaved(d);
        say(done);
      });
    }).catch(function () { say('Not saved: no connection.'); });
    });
  }
  function site(body, done) {
    post('/site/look/admin', body, done, function (d) {
      keep(CACHE, d.look);
      saved = (d.look && d.look.vars) || {};
      dirty = {};
    });
  }
  function siteButtons(body, done) {
    post('/site/buttons/admin', body, done, function (d) {
      keep(BTN_CACHE, d.buttons);
      savedButtons = d.buttons || {};
      paintButtons(savedButtons);
    });
  }

  function buttonNames() {
    var seen = {}, out = [];
    document.querySelectorAll('[data-btn]').forEach(function (el) {
      var n = el.getAttribute('data-btn');
      if (seen[n]) return;
      seen[n] = true;
      var label = (el.getAttribute('aria-label') || el.textContent || n).replace(/\s+/g, ' ').trim();
      out.push({ name: n, label: label.length > 30 ? label.slice(0, 30).trim() : label });
    });
    return out;
  }
  function selectButton(name) {
    if (!name) return;
    btnPick.value = name;
    var els = document.querySelectorAll('[data-btn="' + name + '"]');
    if (!els.length) return;
    var cs = getComputedStyle(els[0]);
    var o = savedButtons[name] || {};
    btnBg.value = o.bg || hexOf(cs.backgroundColor);
    btnText.value = o.text || hexOf(cs.color);
    document.querySelectorAll('.site-look-picked').forEach(function (x) { x.classList.remove('site-look-picked'); });
    els.forEach(function (el) { el.classList.add('site-look-picked'); });
    els[0].scrollIntoView({ block: 'center' });
  }
  function previewButton() {
    var name = btnPick.value;
    if (!name) return;
    document.querySelectorAll('[data-btn="' + name + '"]').forEach(function (el) {
      el.style.setProperty('background', btnBg.value, 'important');
      el.style.setProperty('color', btnText.value, 'important');
    });
  }

  function drawEditor() {
    bar = document.createElement('div');
    bar.id = 'site-look-bar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:1000;background:#16233d;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));box-shadow:0 -4px 16px rgba(0,0,0,.3);max-height:60vh;overflow:auto';
    var swatches = COLOURS.map(function (c) {
      return '<label style="display:grid;gap:2px;font-size:11px">' + c.label +
        '<input type="color" data-look="' + c.name + '" style="width:84px;height:32px;padding:0;border:0;background:none"></label>';
    }).join('');
    bar.innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">' +
        '<strong>Look of the site</strong>' +
        '<span><button type="button" data-look-act="site">Save to site</button> <button type="button" data-look-act="local">Reset this browser</button> <button type="button" data-look-act="clear">Clear site look</button> <a href="' + location.pathname + '" style="color:#fff">Exit editing</a></span>' +
      '</div>' +
      '<div style="margin-top:6px"><span data-look-msg style="color:#f7c9b9"></span></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">' + swatches + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center">' +
        '<a class="btn btn-primary" href="#" onclick="return false">Primary</a>' +
        '<a class="btn btn-accent" href="#" onclick="return false">Accent</a>' +
        '<a class="btn btn-secondary" href="#" onclick="return false">Secondary</a>' +
        '<a class="btn btn-ghost" href="#" onclick="return false">Ghost</a>' +
        '<a class="btn btn-danger" href="#" onclick="return false">Danger</a>' +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:end;border-top:1px solid #2c3856;padding-top:10px">' +
        '<label style="display:grid;gap:2px;font-size:11px">Button on this page (click one, or pick it)<select data-look-btn-pick style="font:inherit;border-radius:6px;padding:4px;background:#0f1729;color:#fff;border:1px solid #2c3856;max-width:240px"></select></label>' +
        '<label style="display:grid;gap:2px;font-size:11px">Background<input type="color" data-look-btn-bg style="width:84px;height:32px;padding:0;border:0;background:none"></label>' +
        '<label style="display:grid;gap:2px;font-size:11px">Text<input type="color" data-look-btn-text style="width:84px;height:32px;padding:0;border:0;background:none"></label>' +
        '<button type="button" data-look-btn-save>Save this button</button> <button type="button" data-look-btn-off>Take this button back to the default</button>' +
      '</div>';
    document.body.appendChild(bar);
    msg = bar.querySelector('[data-look-msg]');
    COLOURS.forEach(function (c) {
      var input = bar.querySelector('[data-look="' + c.name + '"]');
      pickers[c.name] = input;
      input.addEventListener('input', function () {
        root.style.setProperty(c.name, this.value);
        dirty[c.name] = this.value;
      });
    });
    btnPick = bar.querySelector('[data-look-btn-pick]');
    btnBg = bar.querySelector('[data-look-btn-bg]');
    btnText = bar.querySelector('[data-look-btn-text]');
    btnPick.innerHTML = '<option value="">Choose a button</option>' + buttonNames().map(function (b) {
      return '<option value="' + b.name + '">' + b.label + ' (' + b.name + ')</option>';
    }).join('');
    btnPick.addEventListener('change', function () { selectButton(this.value); });
    btnBg.addEventListener('input', previewButton);
    btnText.addEventListener('input', previewButton);
    bar.querySelector('[data-look-btn-save]').addEventListener('click', function () {
      var name = btnPick.value;
      if (!name) { say('Choose a button first.'); return; }
      siteButtons({ key: name, bg: btnBg.value, text: btnText.value }, 'Saved. Every page shows this button in these colours.');
    });
    bar.querySelector('[data-look-btn-off]').addEventListener('click', function () {
      var name = btnPick.value;
      if (!name) { say('Choose a button first.'); return; }
      siteButtons({ key: name, reset: true }, 'Saved. This button is back to its default colours.');
      document.querySelectorAll('[data-btn="' + name + '"]').forEach(function (el) {
        el.style.removeProperty('background');
        el.style.removeProperty('color');
      });
    });
    // A click on a button in edit mode picks it rather than going to its link.
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-btn]');
      if (!el || bar.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      btnPick.value = el.getAttribute('data-btn');
      selectButton(btnPick.value);
    }, true);
    bar.querySelector('[data-look-act="site"]').addEventListener('click', function () {
      var vars = {};
      Object.keys(saved).forEach(function (k) { vars[k] = saved[k]; });
      Object.keys(dirty).forEach(function (k) { vars[k] = dirty[k]; });
      site({ vars: vars }, 'Saved. Every visitor sees these colours.');
    });
    bar.querySelector('[data-look-act="local"]').addEventListener('click', function () {
      try { localStorage.removeItem(CACHE); localStorage.removeItem(BTN_CACHE); } catch (e) { /* not kept */ }
      location.href = location.pathname;
    });
    bar.querySelector('[data-look-act="clear"]').addEventListener('click', function () {
      if (!window.confirm('Take the saved site colours off the site? Every visitor goes back to the built-in colours.')) return;
      site({ reset: true }, 'Cleared. The site uses its built-in colours again.');
    });
    var style = document.createElement('style');
    style.textContent = '.site-look-picked { outline: 3px solid #6ee7b7 !important; outline-offset: 3px; }';
    document.head.appendChild(style);
    savedButtons = kept(BTN_CACHE) || {};
    fill(kept(CACHE) || {});
  }

  if (EDIT) {
    var boot = function () { drawEditor(); };
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }
})();
