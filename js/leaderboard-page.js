/*
  leaderboards.html: the public leaderboards from members' shared track
  sessions (track.html). Each car's fastest at each track layout, drag strip
  and sprint or hill climb course.

    leaderboards.html                         track days (or ?type=drag, ?type=sprint)
    leaderboards.html?board=<venue>:<layout>  one circuit layout
    leaderboards.html?drag=<venue>            one drag strip
    leaderboards.html?sprint=<venue>:<course> one sprint or hill climb course

  The boards and session counts come from the worker (/track/board,
  /drag/board, /sprint/board, /track/counts); the list of venues from
  data/tracks.json with the admin's changes (/track/tracks).
*/
(function () {
  var API = window.MT3UK_TRACK_API || 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var T = window.MT3UKTrack, V = window.MT3UKTrackView;
  var app = document.getElementById('lb-app');
  if (!app || !T || !V) return;
  var esc = V.esc;
  var MODELS = ['Model 3', 'Model Y', 'Model S', 'Model X', 'Hyundai Ioniq 5 N', 'Hyundai Ioniq 6 N', 'Porsche Taycan'];
  // Short names for the filter chips.
  var MODEL_SHORT = { 'Hyundai Ioniq 5 N': 'Ioniq 5 N', 'Hyundai Ioniq 6 N': 'Ioniq 6 N', 'Porsche Taycan': 'Taycan' };
  var TYPES = [['track', 'Track days', 'circuit'], ['drag', 'Drag', 'drag'], ['sprint', 'Sprint and hill climb', 'sprint']];
  var ICON = {
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    warn: '<path d="M12 3 2 21h20Z"/><path d="M12 10v4M12 17h.01"/>'
  };
  function icon(n) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function getJson(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }); }

  var library = null, counts = null;
  function load() {
    if (library) return Promise.resolve();
    return Promise.all([
      getJson('data/tracks.json').catch(function () { return { venues: [] }; }),
      getJson(API + '/track/tracks').catch(function () { return {}; }),
      getJson(API + '/track/counts').catch(function () { return {}; })
    ]).then(function (r) {
      library = T.mergeLibrary(r[0], r[1] && r[1].extra);
      counts = (r[2] && r[2].counts) || {};
    });
  }

  function params() { return new URL(location.href).searchParams; }
  function go(q) { history.pushState(null, '', 'leaderboards.html' + (q ? '?' + q : '')); route(); window.scrollTo(0, 0); }
  window.addEventListener('popstate', route);
  app.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-go]');
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('data-go')); }
    if (e.target.closest('[data-units]')) { V.setMph(!V.units.mph); route(); }
  });
  function unitsChip() { return '<button type="button" class="chip tp-units" data-units>' + (V.units.mph ? 'mph' : 'km/h') + '</button>'; }

  function route() {
    V.hideTip();
    var p = params();
    app.innerHTML = '<div class="tp-loading" role="status">Loading...</div>';
    load().then(function () {
      if (p.get('board')) return showBoard('track', p.get('board'));
      if (p.get('drag')) return showBoard('drag', p.get('drag'));
      if (p.get('sprint')) return showBoard('sprint', p.get('sprint'));
      showList(p.get('type') || 'track');
    }).catch(function () {
      app.innerHTML = '<div class="card tp-empty">' + icon('warn') + '<p>The leaderboards could not be loaded. Check your connection and try again.</p></div>';
    });
  }

  function boardKey(type, venueId, layoutId) {
    return type === 'drag' ? 'drag-board:' + venueId : (type === 'sprint' ? 'sprint-board:' : 'track-board:') + venueId + ':' + layoutId;
  }
  function boardQuery(type, venueId, layoutId) {
    return type === 'drag' ? 'drag=' + encodeURIComponent(venueId) : (type === 'sprint' ? 'sprint=' : 'board=') + encodeURIComponent(venueId + ':' + layoutId);
  }
  function chip(q, label, n) {
    return '<a class="chip' + (n ? ' is-busy' : '') + '" href="leaderboards.html?' + q + '" data-go="' + esc(q) + '">' + esc(label) +
      (n ? '<span class="tp-count" aria-label="' + n + ' session' + (n === 1 ? '' : 's') + '">' + n + '</span>' : '') + '</a>';
  }

  // The venues of one type, busiest first, each layout or course with its count.
  function showList(type) {
    var t = TYPES.filter(function (x) { return x[0] === type; })[0] || TYPES[0];
    var h = '<div class="tp-chips lb-types" role="tablist">' + TYPES.map(function (x) {
      return '<a class="chip' + (x[0] === t[0] ? ' is-on' : '') + '" role="tab" aria-selected="' + (x[0] === t[0]) + '" href="leaderboards.html?type=' + x[0] + '" data-go="type=' + x[0] + '">' + x[1] + '</a>';
    }).join('') + '</div>';
    var venues = library.venues.filter(function (v) { return v.type === t[2]; }).map(function (v, i) {
      var total = t[0] === 'drag' ? (counts[boardKey('drag', v.id)] || 0) : (v.layouts || []).reduce(function (n, l) { return n + (counts[boardKey(t[0], v.id, l.id)] || 0); }, 0);
      return { v: v, total: total, i: i };
    }).sort(function (a, b) { return b.total - a.total || a.i - b.i; });
    if (t[0] === 'drag') {
      h += '<div class="tp-boards">' + venues.map(function (x) {
        return '<a class="tp-board-card lb-strip' + (x.total ? ' is-busy' : '') + '" href="leaderboards.html?' + boardQuery('drag', x.v.id) + '" data-go="' + esc(boardQuery('drag', x.v.id)) + '"><div class="tp-board-name"><b>' + esc(x.v.name) + '</b>' +
          (x.total ? '<span class="tp-count">' + x.total + '</span>' : '<span class="tp-small">No runs yet</span>') + '</div><span class="tp-small">Quickest quarter mile per car</span></a>';
      }).join('') + '</div>';
    } else {
      h += '<div class="tp-boards">' + venues.map(function (x) {
        return '<div class="tp-board-card' + (x.total ? ' is-busy' : '') + '"><div class="tp-board-name"><b>' + esc(x.v.name) + '</b>' + (x.total ? '<span class="tp-small">' + x.total + ' session' + (x.total === 1 ? '' : 's') + '</span>' : '') + '</div><div class="tp-chips">' +
          (x.v.layouts || []).map(function (l) { return chip(boardQuery(t[0], x.v.id, l.id), l.name, counts[boardKey(t[0], x.v.id, l.id)] || 0); }).join('') + '</div></div>';
      }).join('') + '</div>';
    }
    h += '<p class="tp-small lb-note">The numbers are how many sessions members have shared there. Each board shows every car\'s fastest.</p>';
    h += ctaHtml();
    app.innerHTML = h;
  }

  function ctaHtml() {
    return '<div class="card lb-cta"><div><b>Get your car on the board</b><p>Upload your lap timer file in Track Sessions and share it. Your fastest goes straight on, with your car and mods.</p></div><a class="btn btn-accent" href="track.html">' + icon('upload') + 'Add a session</a></div>';
  }

  var boardModel = 'All';
  function showBoard(type, q) {
    var venueId = q.split(':')[0], layoutId = q.split(':')[1] || '';
    var v = library.venues.filter(function (x) { return x.id === venueId; })[0];
    var l = v && v.layouts ? v.layouts.filter(function (x) { return x.id === layoutId; })[0] : null;
    var title = v ? v.name + (l && l.name !== v.name ? ', ' + l.name : '') : venueId;
    var path = type === 'drag' ? '/drag/board?venue=' + encodeURIComponent(venueId) : (type === 'sprint' ? '/sprint/board?venue=' : '/track/board?venue=') + encodeURIComponent(venueId) + '&layout=' + encodeURIComponent(layoutId);
    getJson(API + path).then(function (d) {
      var entries = d.entries || [];
      function draw() {
        var shown = entries.filter(function (e) { return boardModel === 'All' || e.model === boardModel; });
        var what = type === 'drag' ? 'Each car\'s quickest quarter mile.' : type === 'sprint' ? 'Each car\'s fastest run.' : 'Each car\'s fastest lap.';
        var h = '<a class="tp-back" href="leaderboards.html?type=' + type + '" data-go="type=' + type + '">' + icon('back') + 'All ' + (type === 'drag' ? 'drag strips' : type === 'sprint' ? 'sprints and hill climbs' : 'tracks') + '</a>' +
          '<div class="tp-head"><div><h2>' + esc(title) + '</h2><p class="tp-sub">' + what + '</p></div>' + unitsChip() + '</div>' +
          '<div class="tp-chips" id="lb-models">' + ['All'].concat(MODELS).map(function (m) { return '<button type="button" class="chip' + (m === boardModel ? ' is-on' : '') + '" data-m="' + m + '">' + (MODEL_SHORT[m] || m) + '</button>'; }).join('') + '</div>';
        if (!shown.length) h += '<div class="card tp-empty">' + icon('trophy') + '<p>Nobody on this board yet' + (boardModel === 'All' ? '' : ' for the ' + esc(boardModel)) + '. Be the first.</p></div>';
        else h += '<div class="card"><div class="tp-scroll"><table class="tp-table tp-board"><thead><tr><th>#</th><th>Car</th><th>' + (type === 'drag' ? '1/4 mile' : type === 'sprint' ? 'Run' : 'Lap') + '</th><th>Date</th><th></th></tr></thead><tbody>' + shown.map(function (e, i) {
          var res = type === 'drag' ? e.quarter.toFixed(2) + ' s<small>' + V.fmtV(e.quarterSpeed) + '</small>' : V.fmtLap(e.time);
          return '<tr' + (i < 3 ? ' class="lb-top' + (i + 1) + '"' : '') + '><td><span class="lb-pos">' + (i + 1) + '</span></td><td><b>' + esc(e.car) + '</b><small>' + esc([e.owner, [e.year, e.model, e.version].filter(Boolean).join(' ')].filter(Boolean).join(' · ')) + '</small>' +
            (e.mods && e.mods.length ? '<details class="tp-mods"><summary>Mods (' + e.mods.length + ')</summary><div class="tp-chips">' + e.mods.map(function (m) { return '<span class="tp-modchip">' + esc(m) + '</span>'; }).join('') + '</div></details>' : '') + '</td>' +
            '<td class="tp-res">' + res + '</td><td>' + esc(T.niceDate(e.date)) + (e.conditions ? '<small>' + esc(e.conditions) + '</small>' : '') + '</td><td><a class="btn btn-ghost btn-sm" href="track.html?s=' + esc(e.sessionId) + '">View</a></td></tr>';
        }).join('') + '</tbody></table></div><p class="tp-small">Mods are the ones listed on the build. Weather and tyres vary between days.</p></div>';
        h += ctaHtml();
        app.innerHTML = h;
        document.getElementById('lb-models').addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-m]');
          if (b) { boardModel = b.getAttribute('data-m'); draw(); }
        });
      }
      draw();
    }).catch(function () {
      app.innerHTML = '<div class="card tp-empty">' + icon('warn') + '<p>This leaderboard could not be loaded.</p></div>';
    });
  }

  route();
})();
