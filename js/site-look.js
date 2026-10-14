/* The site's colours, set by the look editor (?look=edit) and kept by the worker under one key (GET /site/look).
   Every public page applies them: the values go on the root element as inline custom properties, so they beat the
   colour tokens a page sets in its own style. The last answer is kept in this browser so the colours are right at
   once on a return visit, and it is refreshed from the worker each time. With ?look=edit the page also gets the look
   editor: colour pickers, a sample of the buttons, live preview and Save to site (the admin key, kept for this tab). */
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var CACHE = 'mt3ukSiteLook';
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

  function kept() {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { return null; }
  }
  function keep(look) {
    try { localStorage.setItem(CACHE, JSON.stringify(look || {})); } catch (e) { /* not kept */ }
  }
  function apply(look) {
    var vars = (look && look.vars) || {};
    applied.forEach(function (name) { if (!vars[name]) root.style.removeProperty(name); });
    applied = Object.keys(vars);
    applied.forEach(function (name) { root.style.setProperty(name, vars[name]); });
  }

  var first = kept();
  if (first) apply(first);

  fetch(API + '/site/look', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.success) return;
      var look = data.look || {};
      if (JSON.stringify(look) === JSON.stringify(first || {})) return;
      keep(look);
      apply(look);
      if (EDIT && bar) fill(look);
    })
    .catch(function () { /* no answer: the kept colours, or the page's own, stay */ });

  /* ---- the editor ---- */
  var bar = null, pickers = {}, saved = {}, dirty = {}, msg = null;

  function current(name) {
    var c = getComputedStyle(root).getPropertyValue(name).trim();
    return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : '';
  }
  function fill(look) {
    saved = (look && look.vars) || {};
    COLOURS.forEach(function (c) {
      var input = pickers[c.name];
      input.value = saved[c.name] || current(c.name) || c.fallback;
    });
  }
  function say(text) { if (msg) msg.textContent = text; }
  function adminKey() {
    var k = (sessionStorage.getItem('mt3ukAdminKey') || '').trim();
    if (!k) {
      k = (window.prompt('Admin key, to save these colours for every visitor:') || '').trim();
      if (k) sessionStorage.setItem('mt3ukAdminKey', k);
    }
    return k;
  }
  function site(body, done) {
    var key = adminKey();
    if (!key) { say('Not saved: no admin key.'); return; }
    say('Saving...');
    fetch(API + '/site/look/admin?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) { sessionStorage.removeItem('mt3ukAdminKey'); say('Not saved: the admin key was not accepted.'); return; }
        if (!r.ok || !d.success) { say('Not saved: ' + (d.message || 'the site did not answer.')); return; }
        keep(d.look);
        saved = (d.look && d.look.vars) || {};
        dirty = {};
        say(done);
      });
    }).catch(function () { say('Not saved: no connection.'); });
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
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center" data-look-sample>' +
        '<a class="btn btn-primary" href="#" onclick="return false">Primary</a>' +
        '<a class="btn btn-accent" href="#" onclick="return false">Accent</a>' +
        '<a class="btn btn-secondary" href="#" onclick="return false">Secondary</a>' +
        '<a class="btn btn-ghost" href="#" onclick="return false">Ghost</a>' +
        '<a class="btn btn-danger" href="#" onclick="return false">Danger</a>' +
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
    bar.querySelector('[data-look-act="site"]').addEventListener('click', function () {
      var vars = {};
      Object.keys(saved).forEach(function (k) { vars[k] = saved[k]; });
      Object.keys(dirty).forEach(function (k) { vars[k] = dirty[k]; });
      site({ vars: vars }, 'Saved. Every visitor sees these colours.');
    });
    bar.querySelector('[data-look-act="local"]').addEventListener('click', function () {
      try { localStorage.removeItem(CACHE); } catch (e) { /* not kept */ }
      location.href = location.pathname;
    });
    bar.querySelector('[data-look-act="clear"]').addEventListener('click', function () {
      if (!window.confirm('Take the saved colours off the site? Every visitor goes back to the built-in colours.')) return;
      site({ reset: true }, 'Cleared. The site uses its built-in colours again.');
    });
    fill(kept() || {});
  }

  if (EDIT) {
    if (document.readyState !== 'loading') drawEditor();
    else document.addEventListener('DOMContentLoaded', drawEditor);
  }
})();
