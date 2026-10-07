/*
  Laps strips for MT3UK pages: live Laps data dropped into any page.
  - <div data-laps-venue="thruxton"></div>: the track's boards on Laps (each layout's fastest time, who and in what,
    and how many cars), with See the leaderboard and Add your session. With nothing shared there yet, an invitation
    to be the first.
  - <div data-laps-more></div>: the other tracks, strips and hill climbs with times on Laps (busiest first, at most
    12), leaving out the ones the page already shows with data-laps-venue, each linking to its board.
  From /track/counts (two single KV keys on the worker) and data/tracks.json. The links carry data-laps, so on
  mt3uk.com js/account-bar.js sends them to laps.mt3uk.com, signed in. If the data cannot be read, nothing shows.
  Styles: css/laps-strip.css.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var spots = document.querySelectorAll('[data-laps-venue], [data-laps-more]');
  if (!spots.length) return;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  var ICON = {
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
    chev: '<path d="m9 6 6 6-6 6"/>'
  };
  function icon(n) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function lapTime(s) {
    s = Number(s);
    if (!(s > 0)) return '';
    var m = Math.floor(s / 60), r = s - m * 60;
    return m ? m + ':' + (r < 10 ? '0' : '') + r.toFixed(2) : r.toFixed(2) + ' s';
  }
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
      var add = '<a class="btn btn-accent btn-sm" href="track.html?add=1" data-laps>' + icon('upload') + 'Add your session</a>';
      var html = '<div class="ls-head">' + icon('trophy') + '<b>' + esc(v.name) + ' on Laps</b></div>';
      if (here.length) {
        html += '<ul class="ls-rows">' + here.map(function (b) {
          var name = b.kind === 'drag-board' ? 'Quarter mile' : (b.layout && b.layout.name && b.layout.name !== v.name ? b.layout.name : 'Fastest ' + what(b));
          return '<li><a href="' + esc(boardHref(b.kind, id, b.layoutId)) + '" data-laps><span class="ls-where"><b>' + esc(name) + '</b><span>' + esc(b.top.owner || 'MT3UK member') +
            (carOf(b.top) ? ', ' + esc(carOf(b.top)) : '') + ' &middot; ' + b.n + ' car' + (b.n === 1 ? '' : 's') + '</span></span><span class="ls-time">' + esc(result(b)) + '</span>' + icon('chev') + '</a></li>';
        }).join('') + '</ul>';
        html += '<div class="ls-actions"><a class="btn btn-secondary btn-sm" href="' + esc(boardHref(here[0].kind, id, here[0].layoutId)) + '" data-laps>See the leaderboard</a>' + add + '</div>';
      } else {
        html += '<p class="ls-empty">No shared times here yet. Upload your lap timer file and be the first on the board.</p><div class="ls-actions">' + add + '</div>';
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
    if (window.mt3ukLapsLinks) window.mt3ukLapsLinks();
  });
})();
