/*
  Laps strips for MT3UK pages: live Laps data dropped into any page.
  - <div data-laps-venue="thruxton"></div>: the track's boards on Laps (each layout's fastest time, who and in what,
    and how many cars), with See the leaderboard and Add your session. With nothing shared there yet, an invitation
    to be the first.
  - <div data-laps-more></div>: the other tracks, strips and hill climbs with times on Laps (busiest first, at most
    12), leaving out the ones the page already shows with data-laps-venue, each linking to its board.
  - [data-laps-fast-line] (the homepage Sessions tile's grey line): "Fastest at Thruxton: 1:21.42, Rich", the leader
    of the busiest board, in place of its own words (kept when there are no times).
  - <div data-laps-car="<carId>" data-laps-name="<car>"></div>: that car on Laps (My Garage's open car; also
    MT3UKLapsStrip.car(el) to draw or redraw one). With data-laps-mine, the owner's own list (/track/sessions, every
    session, the private ones marked "Only me") is used; otherwise, or if that cannot be read, the car's shared
    sessions (/track/public). The best per track, linking to the session, then All sessions and Add your session.
  - [data-laps-preview]: a short note on what the early preview is, for anyone without early access (hidden
    otherwise). Strips carry one, and their heading gets an "Early preview" tag while Laps is a preview.
  - [data-laps-add] (any Add a session link; a page that draws one later, such as the Gallery's car sheet, calls
    window.MT3UKLapsStrip.gateAdds(itsBox)): while Laps is an early preview, a visitor who is signed out or has not
    been given early access (GET /track/access) sees Join the early preview (or You're on the list) in its place.
  From /track/counts (two single KV keys on the worker) and data/tracks.json. The links carry data-laps, so on
  mt3uk.com js/account-bar.js sends them to laps.mt3uk.com, signed in. If the data cannot be read, nothing shows.
  Styles: css/laps-strip.css.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var spots = document.querySelectorAll('[data-laps-venue], [data-laps-more], [data-laps-fast-line]');
  // Where the viewer stands with the early preview: 'open' (Laps is open to all, nothing to say), 'approved',
  // 'pending', 'none' (signed in, not asked) or 'out' (signed out). /laps/signin says whether it is still a preview
  // (public); /track/access where a signed-in member stands. Both kept for the browser session.
  var stateP = null;
  function kept(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function keep(k, v) { try { if (v) sessionStorage.setItem(k, v); } catch (e) {} }
  function previewOn() {
    var k = kept('mt3ukLapsPreview');
    if (k) return Promise.resolve(k === 'yes');
    return fetch(API + '/laps/signin', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var on = !(d && d.preview === false);
      keep('mt3ukLapsPreview', on ? 'yes' : 'no');
      return on;
    }).catch(function () { return true; });
  }
  function access() {
    var tok = '';
    try { tok = localStorage.getItem('mt3ukMyBuildsSession') || ''; } catch (e) {}
    if (!tok) return Promise.resolve('out');
    var k = kept('mt3ukLapsAccess');
    if (k) return Promise.resolve(k);
    return fetch(API + '/track/access', { headers: { 'X-Session-Token': tok }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        var a = (d && d.access) || 'none';
        keep('mt3ukLapsAccess', a);
        return a;
      }).catch(function () { return 'none'; });
  }
  function previewState() {
    if (stateP) return stateP;
    stateP = Promise.all([previewOn(), access()]).then(function (r) { return r[1] === 'approved' ? 'approved' : r[0] ? r[1] : 'open'; });
    return stateP;
  }
  // The admin's own words for the note (the Welcome text panel of track-admin.html, /track/copy: previewOut,
  // previewNone, previewPending), over the built-in ones.
  var copyP = null;
  function noteWords(st) {
    if (!copyP) copyP = fetch(API + '/track/copy', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { return (d && d.copy) || {}; }).catch(function () { return {}; });
    return copyP.then(function (c) {
      var own = c['preview' + st.charAt(0).toUpperCase() + st.slice(1)];
      var lead = st === 'pending' ? 'You\u2019re on the early preview list.' : 'Early preview.';
      return '<b>' + esc(lead) + '</b> ' + (own ? esc(own) : NOTES[st] || NOTES.none);
    });
  }
  var SPARK = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></svg>';
  var NOTES = {
    out: 'Anyone can browse the leaderboards. Adding your own laps is open to early testers while we finish Laps.',
    none: 'Anyone can browse the leaderboards. Adding your own laps is open to early testers while we finish Laps. Ask for a place and we\u2019ll let you know.',
    pending: 'We\u2019ll email you as soon as your place is ready. Until then, have a look round the leaderboards.'
  };
  // Add a session links ([data-laps-add]) and the early preview notes ([data-laps-preview]). A member with early
  // access (or everyone, once Laps is open) gets Add a session and no note. Anyone else gets Join the early preview
  // (signed out: the Laps sign-up, which puts them on the list; signed in: Sessions, with its request form), or,
  // already waiting, You're on the list, and a short note saying what the preview is.
  function gateAdds(root) {
    root = root || document;
    var links = root.querySelectorAll('[data-laps-add]'), notes = root.querySelectorAll('[data-laps-preview]');
    if (!links.length && !notes.length) return;
    previewState().then(function (st) {
      var shut = st !== 'open' && st !== 'approved';
      notes.forEach(function (n) { n.hidden = !shut; });
      if (!shut) return;
      if (notes.length) noteWords(st).then(function (html) { notes.forEach(function (n) { n.innerHTML = html; }); });
      links.forEach(function (a) {
        a.href = st === 'out' ? 'laps-signin.html' : 'track.html';
        a.innerHTML = SPARK + (st === 'pending' ? 'You\u2019re on the list' : 'Join the early preview');
        a.classList.add('is-preview');
        if (st === 'pending' && a.classList.contains('btn-accent')) { a.classList.remove('btn-accent'); a.classList.add('btn-secondary'); }
        a.removeAttribute('data-laps-add');
      });
      if (window.mt3ukLapsLinks) window.mt3ukLapsLinks();
    });
  }
  // The "Early preview" tag after a strip's heading, while Laps is a preview.
  function tagHeads(root) {
    previewOn().then(function (on) {
      if (!on) return;
      (root || document).querySelectorAll('.ls-head b').forEach(function (b) {
        if (!b.parentNode.querySelector('.early-badge')) b.insertAdjacentHTML('afterend', '<span class="early-badge">Early preview</span>');
      });
    });
  }
  // ---- A car on Laps ----
  function lapTime(s) {
    s = Number(s);
    if (!(s > 0)) return '';
    var m = Math.floor(s / 60), r = s - m * 60;
    return m ? m + ':' + (r < 10 ? '0' : '') + r.toFixed(2) : r.toFixed(2) + ' s';
  }
  function get(url, headers) { return fetch(url, { cache: 'no-store', headers: headers || {} }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  var ICON = {
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
    chev: '<path d="m9 6 6 6-6 6"/>'
  };
  function icon(n) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function carSessions(carId, mine) {
    var tok = '';
    try { tok = localStorage.getItem('mt3ukMyBuildsSession') || ''; } catch (e) {}
    var own = mine && tok ? get(API + '/track/sessions', { 'X-Session-Token': tok }).then(function (d) {
      return d && d.success && Array.isArray(d.sessions) ? d.sessions.filter(function (s) { return s.carId === carId; }) : null;
    }) : Promise.resolve(null);
    return own.then(function (list) {
      if (list) return list;
      return get(API + '/track/public?car=' + encodeURIComponent(carId)).then(function (d) { return d && d.success ? (d.sessions || []) : null; });
    });
  }
  function drawCar(el) {
    var carId = el.getAttribute('data-laps-car'), name = el.getAttribute('data-laps-name') || 'This car', mine = el.hasAttribute('data-laps-mine');
    if (!carId) { el.hidden = true; return Promise.resolve(); }
    var stamp = String(Date.now());
    el.setAttribute('data-laps-stamp', stamp);
    return carSessions(carId, mine).then(function (list) {
      if (el.getAttribute('data-laps-stamp') !== stamp) return;
      if (!list) { el.hidden = true; return; }
      var best = {};
      list.forEach(function (s) {
        if (s.street || (s.type !== 'drag' && s.type !== 'track' && s.type !== 'sprint')) return;
        var score = s.type === 'drag' ? s.quarter : s.bestTime;
        if (!(score > 0)) return;
        var k = s.type === 'drag' ? 'drag:' + (s.venueId || s.venue) : s.type + ':' + (s.venueId || s.venue) + ':' + (s.layoutId || '');
        if (!best[k] || score < (best[k].type === 'drag' ? best[k].quarter : best[k].bestTime)) best[k] = s;
      });
      var rows = Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
      var add = '<a class="btn btn-accent btn-sm" href="track.html?add=1&car=' + encodeURIComponent(carId) + '" data-laps data-laps-add>' + icon('upload') + 'Add your session</a>';
      var all = '<a class="btn btn-secondary btn-sm" href="track.html?' + (mine ? 'mycar=' : 'car=') + encodeURIComponent(carId) + '" data-laps>' + (mine ? 'All sessions' : 'All shared sessions') + '</a>';
      var html = '<div class="ls-head">' + icon('trophy') + '<b>' + esc(name) + ' on Laps</b></div>';
      if (rows.length) {
        html += '<ul class="ls-rows">' + rows.map(function (t) {
          var res = t.type === 'drag' ? Number(t.quarter).toFixed(2) + ' s' : lapTime(t.bestTime);
          var what = t.type === 'drag' ? 'Quarter mile' : t.type === 'sprint' ? 'Best run' : 'Best lap';
          var when = '';
          if (t.date) { var d = new Date(t.date + 'T12:00:00'); if (!isNaN(d)) when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
          var sub = what + (when ? ' \u00b7 ' + when : '') + (mine && t.privacy === 'private' ? ' \u00b7 Only me' : '');
          return '<li><a href="track.html?s=' + encodeURIComponent(t.id) + '" data-laps><span class="ls-where"><b>' + esc(t.venue + (t.layout && t.layout !== t.venue ? ', ' + t.layout : '')) + '</b><span>' + esc(sub) + '</span></span><span class="ls-time">' + esc(res) + '</span>' + icon('chev') + '</a></li>';
        }).join('') + '</ul>' + (mine ? '<p class="laps-preview-note" data-laps-preview hidden></p>' : '') + '<div class="ls-actions">' + all + (mine ? add : '<a class="btn btn-ghost btn-sm" href="laps.html" data-laps>What is Laps?</a>') + '</div>';
      } else if (mine) {
        html += '<p class="ls-empty">No sessions for this ' + (el.getAttribute('data-laps-word') || 'car') + ' yet. Upload your lap timer file from a track day, sprint or drag strip and it shows here, with your best at each track.</p><p class="laps-preview-note" data-laps-preview hidden></p><div class="ls-actions">' + add + '</div>';
      } else { el.hidden = true; el.innerHTML = ''; return; }
      el.classList.add('laps-strip');
      el.innerHTML = html;
      el.hidden = false;
      gateAdds(el);
      tagHeads(el);
      if (window.mt3ukLapsLinks) window.mt3ukLapsLinks();
    });
  }
  window.MT3UKLapsStrip = { gateAdds: gateAdds, tagHeads: tagHeads, state: previewState, car: drawCar };
  gateAdds(document);
  document.querySelectorAll('[data-laps-car]').forEach(drawCar);
  if (!spots.length) return;
  function carOf(c) {
    var make = c.make || '', model = c.model || '';
    var t = make && model && model.toLowerCase().indexOf(make.toLowerCase()) !== 0 ? make + ' ' + model : (model || make);
    return c.car === 'MT3UK member build' && t ? t : (c.car || t);
  }
  function boardHref(kind, venueId, layoutId) {
    return 'leaderboards.html?' + (kind === 'drag-board' ? 'drag=' + encodeURIComponent(venueId) : (kind === 'sprint-board' ? 'sprint=' : 'board=') + encodeURIComponent(venueId + ':' + layoutId));
  }

  Promise.all([get(API + '/track/counts'), get('data/tracks.json')]).then(function (r) {
    if (!r[0]) return;
    var counts = r[0].counts || {}, leaders = r[0].leaders || {}, venues = {};
    ((r[1] && r[1].venues) || []).forEach(function (v) { venues[v.id] = v; });
    // Every board with a time, as { kind, venue, layout, n, top }.
    var boards = Object.keys(leaders).filter(function (k) { return (leaders[k] || []).length; }).map(function (k) {
      var p = k.split(':'), v = venues[p[1]];
      if (!v) return null;
      var l = (v.layouts || []).filter(function (x) { return x.id === p[2]; })[0] || null;
      return { kind: p[0], venue: v, layoutId: p[2] || '', layout: l, n: counts[k] || 0, top: leaders[k][0] };
    }).filter(Boolean);
    function result(b) { return b.kind === 'drag-board' ? Number(b.top.quarter).toFixed(2) + ' s' : lapTime(b.top.time); }
    function what(b) { return b.kind === 'drag-board' ? 'quarter mile' : b.kind === 'sprint-board' ? (b.venue.hill ? 'hill climb' : 'sprint') : 'lap'; }

    var shown = {};
    document.querySelectorAll('[data-laps-venue]').forEach(function (el) {
      var id = el.getAttribute('data-laps-venue'), v = venues[id];
      shown[id] = true;
      if (!v) return;
      var here = boards.filter(function (b) { return b.venue.id === id; }).sort(function (a, b) { return b.n - a.n; });
      var add = '<a class="btn btn-accent btn-sm" href="track.html?add=1" data-laps data-laps-add>' + icon('upload') + 'Add your session</a>';
      var html = '<div class="ls-head">' + icon('trophy') + '<b>' + esc(v.name) + ' on Laps</b></div>';
      if (here.length) {
        html += '<ul class="ls-rows">' + here.map(function (b) {
          var name = b.kind === 'drag-board' ? 'Quarter mile' : (b.layout && b.layout.name && b.layout.name !== v.name ? b.layout.name : 'Fastest ' + what(b));
          return '<li><a href="' + esc(boardHref(b.kind, id, b.layoutId)) + '" data-laps><span class="ls-where"><b>' + esc(name) + '</b><span>' + esc(b.top.owner || 'MT3UK member') +
            (carOf(b.top) ? ', ' + esc(carOf(b.top)) : '') + ' &middot; ' + b.n + ' car' + (b.n === 1 ? '' : 's') + '</span></span><span class="ls-time">' + esc(result(b)) + '</span>' + icon('chev') + '</a></li>';
        }).join('') + '</ul>';
        html += '<p class="laps-preview-note" data-laps-preview hidden></p><div class="ls-actions"><a class="btn btn-secondary btn-sm" href="' + esc(boardHref(here[0].kind, id, here[0].layoutId)) + '" data-laps>See the leaderboard</a>' + add + '</div>';
      } else {
        html += '<p class="ls-empty">No shared times here yet. Upload your lap timer file and be the first on the board.</p><p class="laps-preview-note" data-laps-preview hidden></p><div class="ls-actions">' + add + '</div>';
      }
      el.classList.add('laps-strip');
      el.innerHTML = html;
    });

    document.querySelectorAll('[data-laps-more]').forEach(function (el) {
      var rest = boards.filter(function (b) { return !shown[b.venue.id]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
      if (!rest.length) { el.hidden = true; return; }
      el.classList.add('laps-more');
      el.innerHTML = '<ul class="ls-rows">' + rest.map(function (b) {
        var where = b.venue.name + (b.kind !== 'drag-board' && b.layout && b.layout.name && b.layout.name !== b.venue.name ? ', ' + b.layout.name : '');
        return '<li><a href="' + esc(boardHref(b.kind, b.venue.id, b.layoutId)) + '" data-laps><span class="ls-where"><b>' + esc(where) + '</b><span>' + esc(b.top.owner || 'MT3UK member') +
          (carOf(b.top) ? ', ' + esc(carOf(b.top)) : '') + ' &middot; fastest ' + esc(what(b)) + '</span></span><span class="ls-time">' + esc(result(b)) + '</span>' + icon('chev') + '</a></li>';
      }).join('') + '</ul><p class="ls-actions"><a class="btn btn-secondary btn-sm" href="leaderboards.html" data-laps>All leaderboards</a></p>';
    });
    document.querySelectorAll('[data-laps-fast-line]').forEach(function (el) {
      var top = boards.slice().sort(function (a, b) { return b.n - a.n; })[0];
      if (!top) return;
      el.textContent = 'Fastest at ' + top.venue.name + ': ' + result(top) + ', ' + (top.top.owner || 'MT3UK member');
    });
    gateAdds(document);
    tagHeads(document);
    if (window.mt3ukLapsLinks) window.mt3ukLapsLinks();
  });
})();
