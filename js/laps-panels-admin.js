/*
  Admin: the Laps front page sections as panels (laps.html: Fastest right now, What Laps does, Every kind of day,
  Works with your lap timer, EVs any make). For each one: its heading, intro line, cards or chips, and where it
  shows: the front page, and for signed-in members Sessions and the Leaderboard. laps.html holds the built-in words,
  read here for the placeholders; the changes go to the worker (KV laps-panels) and js/laps-panels.js applies them.
*/
(function () {
  var wrap = document.getElementById('panels-wrap');
  if (!wrap) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var list = document.getElementById('lpn-list'), note = document.getElementById('lpn-note');
  var saveBtn = document.getElementById('lpn-save'), resetBtn = document.getElementById('lpn-reset');
  var PLACES = [['front', 'Front page', true], ['sessions', 'Sessions', false], ['leaderboard', 'Leaderboard', false]];
  var defs = null, loaded = false;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function call(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path + '?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function say(t, bad) { if (note) { note.textContent = t || ''; note.classList.toggle('is-bad', !!bad); } }
  function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

  // The built-in words, from laps.html itself.
  function readDefaults() {
    return fetch('laps.html', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      return [].slice.call(doc.querySelectorAll('main [data-panel]')).map(function (sec) {
        return {
          id: sec.getAttribute('data-panel'),
          heading: text(sec.querySelector('h2')),
          lead: text(sec.querySelector('.lh-lead') || sec.querySelector('.wrap > p:not(.lh-more)')),
          cards: [].slice.call(sec.querySelectorAll('.lh-card')).map(function (c) { return { title: text(c.querySelector('h3')), text: text(c.querySelector('p')) }; }),
          items: [].slice.call(sec.querySelectorAll('.lh-timers span')).map(text)
        };
      });
    });
  }
  function draw(ps) {
    ps = ps || {};
    list.innerHTML = defs.map(function (d) {
      var p = ps[d.id] || {}, show = p.show || {};
      return '<fieldset class="lpn-panel" data-id="' + esc(d.id) + '"><legend>' + esc(d.heading) + '</legend>' +
        '<div class="iv-toolbar lpn-places">' + PLACES.map(function (pl) {
          var on = typeof show[pl[0]] === 'boolean' ? show[pl[0]] : pl[2];
          return '<button type="button" class="tk-switch" role="switch" data-place="' + pl[0] + '" aria-checked="' + on + '"><span class="tk-track"></span>' + pl[1] + '</button>';
        }).join('') + '</div>' +
        '<label>Heading<input type="text" data-f="heading" maxlength="80" value="' + esc(p.heading || '') + '" placeholder="' + esc(d.heading) + '"></label>' +
        (d.lead ? '<label>Intro line<textarea data-f="lead" rows="2" maxlength="400" placeholder="' + esc(d.lead) + '">' + esc(p.lead || '') + '</textarea></label>' : '') +
        d.cards.map(function (c, i) {
          var o = (p.cards || [])[i] || {};
          return '<div class="lpn-card"><label>Card ' + (i + 1) + ' title<input type="text" data-card="' + i + '" data-cf="title" maxlength="60" value="' + esc(o.title || '') + '" placeholder="' + esc(c.title) + '"></label>' +
            '<label>Card ' + (i + 1) + ' text<textarea data-card="' + i + '" data-cf="text" rows="2" maxlength="300" placeholder="' + esc(c.text) + '">' + esc(o.text || '') + '</textarea></label></div>';
        }).join('') +
        (d.items.length ? '<label>Chips, one a line (up to 12)<textarea data-f="items" rows="4" placeholder="' + esc(d.items.join('\n')) + '">' + esc((p.items || []).join('\n')) + '</textarea></label>' : '') +
        '</fieldset>';
    }).join('');
  }
  function collect() {
    var out = {};
    list.querySelectorAll('.lpn-panel').forEach(function (fs) {
      var p = { show: {} };
      fs.querySelectorAll('[data-place]').forEach(function (b) { p.show[b.getAttribute('data-place')] = b.getAttribute('aria-checked') === 'true'; });
      fs.querySelectorAll('[data-f]').forEach(function (el) {
        var v = el.value.trim();
        if (el.getAttribute('data-f') === 'items') p.items = v.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
        else p[el.getAttribute('data-f')] = v;
      });
      var cards = [];
      fs.querySelectorAll('[data-card]').forEach(function (el) {
        var i = +el.getAttribute('data-card');
        cards[i] = cards[i] || { title: '', text: '' };
        cards[i][el.getAttribute('data-cf')] = el.value.trim();
      });
      if (cards.length) p.cards = cards;
      out[fs.getAttribute('data-id')] = p;
    });
    return out;
  }
  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    say('Loading...');
    Promise.all([defs ? Promise.resolve(defs) : readDefaults(), call('GET', '/laps/panels/admin')]).then(function (r) {
      defs = r[0];
      if (!r[1].success) { say(r[1].message || 'Could not load the panels.', true); return; }
      loaded = true;
      draw(r[1].panels);
      say(Object.keys(r[1].panels || {}).length ? 'Your changes are showing.' : 'The front page\'s own words are showing. Type to replace them; anything left blank keeps them.');
    }).catch(function () { say('Could not reach the server.', true); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open && !loaded) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap.open) load(); });
  list.addEventListener('click', function (e) {
    var b = e.target.closest('.tk-switch');
    if (b) b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
  });
  if (saveBtn) saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    call('POST', '/laps/panels/admin', { panels: collect() }).then(function (d) {
      saveBtn.disabled = false;
      if (!d.success) { say(d.message || 'Could not save them.', true); return; }
      draw(d.panels); say('Saved. The pages show it on their next load (within two minutes).');
    }).catch(function () { saveBtn.disabled = false; say('Could not reach the server.', true); });
  });
  if (resetBtn) resetBtn.addEventListener('click', function () {
    if (!window.confirm('Go back to the front page\'s own words, with every panel on the front page only?')) return;
    call('POST', '/laps/panels/admin', { reset: true }).then(function (d) {
      if (!d.success) { say(d.message || 'Could not reset them.', true); return; }
      draw({}); say('Back to the front page\'s own words.');
    }).catch(function () { say('Could not reach the server.', true); });
  });
})();
