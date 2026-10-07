/*
  The Laps front page sections (laps.html: Fastest right now, What Laps does, Every kind of day, Works with your lap
  timer, EVs any make) as panels. laps.html holds the built-in words; the admin's changes come from /laps/panels
  (the Laps panels panel of track-admin.html, KV laps-panels): each section's heading, intro line, cards (title and
  text) or chips, and where it shows. On the front page a section can be taken off; on Sessions and the Leaderboard
  a section chosen for that page is drawn under the page for signed-in members, in <div data-laps-panels="sessions">
  (or "leaderboard"), which the page shows or hides with MT3UKLapsPanels.show(true/false) as its views change.

  Fastest right now (the leader at the six busiest boards, from /track/counts and data/tracks.json) is drawn into
  any [data-lh-fast]. MT3UKLapsPanels.fastest() gives its rows, and fastBulb(btn, pop) puts them at the top of the
  light bulb's box on Sessions and lights the bulb when a leader has changed since the member last opened it
  (localStorage mt3ukLapsFastSeen).
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var SEEN = 'mt3ukLapsFastSeen';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function signedIn() { try { return !!localStorage.getItem('mt3ukMyBuildsSession'); } catch (e) { return false; } }
  var PLACES = { front: true, sessions: false, leaderboard: false };
  function shownOn(p, place, sec) { return p && p.show && typeof p.show[place] === 'boolean' ? p.show[place] : (place === 'front' && sec && sec.hasAttribute('data-front-off') ? false : PLACES[place]); }

  var panelsP = null;
  function panels() { if (!panelsP) panelsP = get(API + '/laps/panels').then(function (d) { return (d && d.panels) || {}; }); return panelsP; }

  // The admin's words over a section's own.
  function apply(sec, p) {
    if (!p) return;
    var h = sec.querySelector('h2');
    if (p.heading && h) h.textContent = p.heading;
    var lead = sec.querySelector('.lh-lead') || sec.querySelector('.wrap > p:not(.lh-more)');
    if (p.lead && lead) lead.textContent = p.lead;
    if (p.cards) sec.querySelectorAll('.lh-card').forEach(function (card, i) {
      var c = p.cards[i];
      if (!c) return;
      var t = card.querySelector('h3'), x = card.querySelector('p');
      if (c.title && t) t.textContent = c.title;
      if (c.text && x) x.textContent = c.text;
    });
    var chips = sec.querySelector('.lh-timers');
    if (p.items && chips) chips.innerHTML = p.items.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('');
  }
  // A signed-in member's buttons: straight to adding a session.
  function memberButtons(root) {
    if (!signedIn()) return;
    root.querySelectorAll('a[href^="signin.html"]').forEach(function (a) { a.href = 'track.html?add=1'; a.textContent = 'Add a session'; });
  }

  // ---- Fastest right now ----
  function lapTime(s) {
    s = Number(s);
    if (!(s > 0)) return '';
    var m = Math.floor(s / 60), r = s - m * 60;
    return m ? m + ':' + (r < 10 ? '0' : '') + r.toFixed(2) : r.toFixed(2) + ' s';
  }
  function title(c) {
    var make = c.make || '', model = c.model || '';
    return make && model && model.toLowerCase().indexOf(make.toLowerCase()) !== 0 ? make + ' ' + model : (model || make);
  }
  var fastP = null;
  function fastest() {
    if (fastP) return fastP;
    fastP = Promise.all([get(API + '/track/counts'), get('data/tracks.json')]).then(function (r) {
      if (!r[0]) return null;
      var counts = r[0].counts || {}, leaders = r[0].leaders || {}, venues = {};
      ((r[1] && r[1].venues) || []).forEach(function (v) { venues[v.id] = v; });
      return Object.keys(leaders).filter(function (k) { return (leaders[k] || []).length; }).map(function (k) {
        var parts = k.split(':'), kind = parts[0], v = venues[parts[1]] || null, l = v && (v.layouts || []).filter(function (x) { return x.id === parts[2]; })[0];
        if (!v) return null;
        var drag = kind === 'drag-board';
        var where = v.name + (!drag && l && l.name && l.name !== v.name ? ', ' + l.name : '');
        var href = 'leaderboards.html?' + (drag ? 'drag=' + encodeURIComponent(parts[1]) : (kind === 'sprint-board' ? 'sprint=' : 'board=') + encodeURIComponent(parts[1] + ':' + parts[2]));
        var top = leaders[k][0];
        var res = drag ? Number(top.quarter).toFixed(2) + ' s' : lapTime(top.time);
        // The board and its leading time only: a leader's nickname or car name can change without the lead changing.
        return { key: k + '|' + res, n: counts[k] || 0, where: where, href: href, who: top.owner || 'MT3UK member',
          car: top.car === 'MT3UK member build' && top.model ? title(top) : (top.car || title(top)), res: res,
          what: drag ? 'Quarter mile' : kind === 'sprint-board' ? 'Sprint' : 'Lap' };
      }).filter(Boolean).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
    });
    return fastP;
  }
  // The list from the last look. Keys saved before October 2026 carried the leader's name as a third part: it is
  // dropped, so the change of format does not mark every board New once.
  function seen() {
    try {
      var list = JSON.parse(localStorage.getItem(SEEN) || 'null');
      return Array.isArray(list) ? list.map(function (k) { return String(k).split('|').slice(0, 2).join('|'); }) : null;
    } catch (e) { return null; }
  }
  function rowHtml(x, isNew) {
    return '<a href="' + esc(x.href) + '"><span class="lh-where"><b>' + esc(x.where) + (isNew ? ' <span class="lh-new">New</span>' : '') + '</b><span>' + esc(x.who) + (x.car ? ', ' + esc(x.car) : '') + ' &middot; ' + esc(x.what) + '</span></span><span class="lh-time">' + esc(x.res) + '</span></a>';
  }
  function drawFastest(box) {
    fastest().then(function (rows) {
      if (!rows) { box.innerHTML = '<p class="lh-fast-empty">The leaderboards could not be loaded just now.</p>'; return; }
      box.innerHTML = rows.length ? rows.map(function (x) { return rowHtml(x, false); }).join('') : '<p class="lh-fast-empty">No shared times yet. Be the first on the board.</p>';
    });
  }
  // The light bulb on Sessions: Fastest right now at the top of its box, each leader that is new since the member
  // last opened it marked New, and the bulb lit until it is opened.
  function fastBulb(btn, pop) {
    if (!btn || !pop || pop.querySelector('.lh-fast-pop')) return;
    fastest().then(function (rows) {
      if (!rows || !rows.length || pop.querySelector('.lh-fast-pop')) return;
      var was = seen(), fresh = rows.filter(function (x) { return !was || was.indexOf(x.key) < 0; });
      pop.insertAdjacentHTML('afterbegin', '<div class="lh-fast-pop"><b>Fastest right now</b><div class="lh-fast">' +
        rows.map(function (x) { return rowHtml(x, fresh.indexOf(x) >= 0 && !!was); }).join('') + '</div><a class="lh-fast-all" href="leaderboards.html">All leaderboards</a></div>');
      if (window.mt3ukLapsLinks) window.mt3ukLapsLinks();
      if (fresh.length) {
        btn.classList.add('is-lit');
        btn.setAttribute('aria-label', 'Fastest right now has changed. ' + (btn.getAttribute('aria-label') || ''));
      }
      // Runs before js/laps-tip.js opens the box (its listener is on the document), so a click while shut opens it.
      btn.addEventListener('click', function () {
        if (btn.getAttribute('aria-expanded') === 'true') return;
        try { localStorage.setItem(SEEN, JSON.stringify(rows.map(function (x) { return x.key; }))); } catch (e) {}
        btn.classList.remove('is-lit');
      });
    });
  }

  // ---- The front page ----
  function front() {
    var secs = document.querySelectorAll('main [data-panel]');
    if (!secs.length) return;
    document.querySelectorAll('[data-lh-fast]').forEach(drawFastest);
    panels().then(function (ps) {
      secs.forEach(function (sec) {
        var p = ps[sec.getAttribute('data-panel')];
        apply(sec, p);
        if (!shownOn(p, 'front', sec)) sec.hidden = true;
      });
    });
  }

  // ---- Sessions and the Leaderboard ----
  var slot = document.querySelector('[data-laps-panels]'), filled = null, wanted = false;
  function fill() {
    if (filled) return filled;
    var place = slot.getAttribute('data-laps-panels');
    filled = Promise.all([panels(), fetch('laps.html', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; })]).then(function (r) {
      var ps = r[0], doc = new DOMParser().parseFromString(r[1] || '', 'text/html');
      var html = '';
      [].slice.call(doc.querySelectorAll('main [data-panel]')).forEach(function (sec) {
        var p = ps[sec.getAttribute('data-panel')];
        if (!shownOn(p, place)) return;
        sec.removeAttribute('id');
        apply(sec, p);
        html += sec.outerHTML;
      });
      slot.innerHTML = html;
      slot.querySelectorAll('[data-lh-fast]').forEach(function (b) { b.removeAttribute('id'); drawFastest(b); });
      memberButtons(slot);
      if (window.mt3ukLapsLinks) window.mt3ukLapsLinks();
    });
    return filled;
  }
  // The page says when its view is one the panels belong under (the list of sessions, the list of tracks).
  function show(on) {
    wanted = !!on;
    if (!slot) return;
    if (!wanted || !signedIn()) { slot.hidden = true; return; }
    fill().then(function () { slot.hidden = !wanted || !slot.innerHTML; });
  }

  window.MT3UKLapsPanels = { fastest: fastest, fastBulb: fastBulb, show: show, panels: panels };
  front();
})();
