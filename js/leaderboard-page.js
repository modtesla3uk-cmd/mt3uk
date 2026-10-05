/*
  leaderboards.html: the public leaderboards from members' shared track
  sessions (track.html). Each car's fastest at each track layout, drag strip
  and sprint or hill climb course.

    leaderboards.html                         track days (or ?type=drag, ?type=sprint, ?type=hill)
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
  var TYPES = [['track', 'Track days', 'circuit'], ['drag', 'Drag', 'drag'], ['sprint', 'Sprint', 'sprint'], ['hill', 'Hill climb', 'sprint']];
  // What each kind of board is called in "All ..." links and buttons.
  var KIND_NAME = { track: 'tracks', drag: 'drag strips', sprint: 'sprints', hill: 'hill climbs' };
  var ICON = {
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    warn: '<path d="M12 3 2 21h20Z"/><path d="M12 10v4M12 17h.01"/>'
  };
  function icon(n) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function getJson(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }); }

  var library = null, counts = null, leaders = null;
  function load() {
    if (library) return Promise.resolve();
    return Promise.all([
      getJson('data/tracks.json').catch(function () { return { venues: [] }; }),
      getJson(API + '/track/tracks').catch(function () { return {}; }),
      getJson(API + '/track/counts').catch(function () { return {}; }),
      window.MT3UKTyres ? window.MT3UKTyres.load().catch(function () {}) : null
    ]).then(function (r) {
      library = T.mergeLibrary(r[0], r[1] && r[1].extra);
      counts = (r[2] && r[2].counts) || {};
      leaders = (r[2] && r[2].leaders) || {};
    });
  }

  function params() { return new URL(location.href).searchParams; }
  // As on track.html: each move pushes a history entry carrying its depth, so a board's Back steps back to the list it
  // was opened from, and goes to the list (its parent) only when there is nothing to step back to (a shared link).
  function backDepth() { var st = history.state; return st && typeof st.lbDepth === 'number' ? st.lbDepth : 0; }
  function go(q) { history.pushState({ lbDepth: backDepth() + 1 }, '', 'leaderboards.html' + (q ? '?' + q : '')); route(); window.scrollTo(0, 0); }
  window.addEventListener('popstate', route);
  app.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-go]');
    if (a && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (a.hasAttribute('data-back') && backDepth() > 0) history.back();
      else go(a.getAttribute('data-go'));
    }
    if (e.target.closest('[data-units]')) { V.setMph(!V.units.mph); route(); }
  });
  function unitsChip() { return '<button type="button" class="chip tp-units" data-units>' + (V.units.mph ? 'mph' : 'km/h') + '</button>'; }

  // The page's own Back is only on the list; inside a board its own Back (to the list) is the one.
  function syncPageBack() { var b = document.getElementById('lb-page-back'); if (b) b.hidden = !!document.querySelector('#' + app.id + ' .tp-back'); }
  function route() {
    V.hideTip();
    var p = params();
    app.innerHTML = '<div class="tp-loading" id="lb-loading" role="status"><span class="tp-spinner" aria-hidden="true"></span><p>Loading the leaderboards...</p></div>';
    setTimeout(function () {
      var el = document.getElementById('lb-loading');
      if (el) el.insertAdjacentHTML('beforeend', '<p class="tp-loading-slow">This is taking a little longer than usual.</p>');
    }, window.MT3UK_SLOW_MS || 8000);
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
  var showAll = false;
  // How the track list is ordered: busiest first (the default), A to Z, or by when the newest top-three time was set.
  var sortMode = 'busy';
  var SORTS = [['busy', 'Most sessions'], ['az', 'A to Z'], ['newest', 'Newest'], ['oldest', 'Oldest']];
  function latestOn(keys) {
    var d = '';
    keys.forEach(function (k) { (leaders[k] || []).forEach(function (l) { if (l.date && l.date > d) d = l.date; }); });
    return d;
  }

  // The top three at one board, shown on the track list so nobody has to open
  // each track to see who is quickest.
  function podium(key, drag) {
    var top = leaders[key] || [];
    if (!top.length) return '';
    return '<ol class="lb-podium">' + top.map(function (l, i) {
      var res = drag ? Number(l.quarter).toFixed(2) + ' s' : V.fmtLap(l.time);
      return '<li class="lb-top' + (i + 1) + '"><span class="lb-pos">' + (i + 1) + '</span><span class="lb-who"><b>' + esc(l.owner || 'MT3UK member') + '</b><small>' + esc(l.car === 'MT3UK member build' && l.model ? l.model : l.car) + '</small>' + (l.date ? '<small class="lb-date">' + esc(T.niceDate(l.date)) + '</small>' : '') + '</span><span class="lb-res">' + res + '</span></li>';
    }).join('') + '</ol>';
  }

  // A layout or course: its name and number of sessions, its top three, and a
  // link to the whole board.
  function layoutBlock(type, v, l) {
    var key = boardKey(type, v.id, l.id), n = counts[key] || 0, q = boardQuery(type, v.id, l.id);
    return '<a class="lb-layout' + (n ? ' is-busy' : '') + '" href="leaderboards.html?' + q + '" data-go="' + esc(q) + '"><span class="lb-layout-head"><b>' + esc(l.name) + '</b>' +
      (n ? '<span class="tp-small">' + n + ' session' + (n === 1 ? '' : 's') + '</span>' : '<span class="tp-small">No sessions yet</span>') + icon('chev') + '</span>' + podium(key, false) + '</a>';
  }

  // The venues of one type, busiest first, each with the top three per layout.
  function showList(type) {
    var t = TYPES.filter(function (x) { return x[0] === type; })[0] || TYPES[0];
    var h = '<div class="tp-chips lb-types" role="tablist">' + TYPES.map(function (x) {
      return '<a class="chip' + (x[0] === t[0] ? ' is-on' : '') + '" role="tab" aria-selected="' + (x[0] === t[0]) + '" href="leaderboards.html?type=' + x[0] + '" data-go="type=' + x[0] + '">' + x[1] + '</a>';
    }).join('') + '</div>';
    h = '<div class="lb-bar">' + h + '<label class="lb-sort"><span>Sort by</span><select class="field" id="lb-sort">' + SORTS.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === sortMode ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select></label></div>';
    // Sprints and hill climbs share one kind of board; the venue's hill flag tells them apart.
    var bt = t[0] === 'hill' ? 'sprint' : t[0];
    var venues = library.venues.filter(function (v) { return v.type === t[2] && (t[0] === 'hill' ? T.isHill(v) : t[0] === 'sprint' ? !T.isHill(v) : true); }).map(function (v, i) {
      var total = t[0] === 'drag' ? (counts[boardKey('drag', v.id)] || 0) : (v.layouts || []).reduce(function (n, l) { return n + (counts[boardKey(bt, v.id, l.id)] || 0); }, 0);
      var when = latestOn(t[0] === 'drag' ? [boardKey('drag', v.id)] : (v.layouts || []).map(function (l) { return boardKey(bt, v.id, l.id); }));
      return { v: v, total: total, i: i, when: when };
    }).sort(function (a, b) {
      if (sortMode === 'az') return a.v.name.localeCompare(b.v.name);
      if (sortMode === 'newest' || sortMode === 'oldest') {
        // Tracks with no times yet go last either way.
        if (!a.when !== !b.when) return a.when ? -1 : 1;
        if (a.when !== b.when) return (a.when < b.when) === (sortMode === 'oldest') ? -1 : 1;
      }
      return b.total - a.total || a.i - b.i;
    });
    var busy = venues.filter(function (x) { return x.total; }), quiet = venues.length - busy.length;
    var shown = showAll || !busy.length ? venues : busy;
    h += '<div class="tp-boards lb-venues">' + shown.map(function (x) {
      var v = x.v;
      if (t[0] === 'drag') {
        var q = boardQuery('drag', v.id), key = boardKey('drag', v.id);
        return '<a class="tp-board-card lb-venue' + (x.total ? ' is-busy' : '') + '" href="leaderboards.html?' + q + '" data-go="' + esc(q) + '"><div class="tp-board-name"><b>' + esc(v.name) + '</b>' +
          (x.total ? '<span class="tp-small">' + x.total + ' run' + (x.total === 1 ? '' : 's') + '</span>' : '<span class="tp-small">No runs yet</span>') + '</div>' +
          (x.total ? podium(key, true) : '') + '<span class="tp-small lb-what">Quickest quarter mile per car</span></a>';
      }
      var layouts = v.layouts || [], active = layouts.filter(function (l) { return counts[boardKey(bt, v.id, l.id)]; }), idle = layouts.filter(function (l) { return !counts[boardKey(bt, v.id, l.id)]; });
      return '<div class="tp-board-card lb-venue' + (x.total ? ' is-busy' : '') + '"><div class="tp-board-name"><b>' + esc(v.name) + '</b>' +
        (x.total ? '<span class="tp-small">' + x.total + ' session' + (x.total === 1 ? '' : 's') + '</span>' : '') + '</div>' +
        active.map(function (l) { return layoutBlock(bt, v, l); }).join('') +
        (idle.length ? (active.length ? '<p class="tp-small lb-idle">No sessions yet: ' + idle.map(function (l) { return esc(l.name); }).join(', ') + '</p>' : idle.map(function (l) { return layoutBlock(bt, v, l); }).join('')) : '') + '</div>';
    }).join('') + '</div>';
    if (busy.length && quiet) h += '<p class="lb-more"><button type="button" class="btn btn-secondary btn-sm" data-showall>' + (showAll ? 'Only show ' + KIND_NAME[t[0]] + ' with sessions' : 'Show all ' + venues.length + ' (' + quiet + ' with no sessions yet)') + '</button></p>';
    h += '<p class="tp-small lb-note">Times are each car\'s fastest. Open a layout for the whole board and filters.</p>';
    h += ctaHtml();
    app.innerHTML = h;
    syncPageBack();
    var sortSel = document.getElementById('lb-sort');
    if (sortSel) sortSel.addEventListener('change', function () { sortMode = sortSel.value; showList(type); });
    var btn = app.querySelector('[data-showall]');
    if (btn) btn.addEventListener('click', function () { showAll = !showAll; showList(type); });
  }

  function ctaHtml() {
    return '<div class="card lb-cta"><div><b>Get your car on the board</b><p>Upload your lap timer file in Track Sessions and share it. Your fastest goes straight on, with your car and mods.</p></div><a class="btn btn-accent" href="track.html">' + icon('upload') + 'Add a session</a></div>';
  }

  // ---- One board -------------------------------------------------------
  var boardModel = 'All', fCond = 'All', fMake = 'All', fTyre = 'All';
  // A car's make and model as the filter and the board line see them (js/vehicle-data.js); cars saved before makes existed have only a model.
  function modelKey(e) { return window.MT3UKVehicles ? window.MT3UKVehicles.modelKey(e) : (e.model || ''); }
  function titleOf(e) { return window.MT3UKVehicles ? window.MT3UKVehicles.title(e) : (e.model || ''); }
  // The listed models, then any others the board's cars have, so a car of another make still has its chip.
  function modelChips(entries) {
    var extra = [];
    entries.forEach(function (e) { var k = modelKey(e); if (k && MODELS.indexOf(k) === -1 && extra.indexOf(k) === -1) extra.push(k); });
    return MODELS.concat(extra.sort());
  }

  function tyreParts(b) {
    if (b.tyreMake || b.tyreModel) return { make: b.tyreMake || '', model: b.tyreModel || '' };
    var t = window.MT3UKTyres && b.tyres ? window.MT3UKTyres.parse(b.tyres) : null;
    return { make: t ? t.make : '', model: t ? t.model : '' };
  }
  // Each car's results to choose from: its best for every mix of conditions
  // and tyres, or just its fastest for boards made before those were kept.
  function resultsOf(e, type) {
    if (e.bests && e.bests.length) return e.bests;
    var b = { sessionId: e.sessionId, date: e.date, conditions: e.conditions, tyres: e.tyres, tyreMake: e.tyreMake, tyreModel: e.tyreModel };
    if (type === 'drag') { b.quarter = e.quarter; b.quarterSpeed = e.quarterSpeed; } else b.time = e.time;
    return [b];
  }
  function scoreOf(b, type) { return type === 'drag' ? b.quarter : b.time; }
  function condOf(b) { return b.conditions || 'Dry'; }

  // The cars that match the filters, each with its best matching result, quickest first.
  function rank(entries, type) {
    var out = [];
    entries.forEach(function (e) {
      if (boardModel !== 'All' && modelKey(e) !== boardModel) return;
      var best = null;
      resultsOf(e, type).forEach(function (b) {
        if (fCond !== 'All' && condOf(b) !== fCond) return;
        var tp = tyreParts(b);
        if (fMake !== 'All' && tp.make !== fMake) return;
        if (fTyre !== 'All' && tp.model !== fTyre) return;
        if (!best || scoreOf(b, type) < scoreOf(best, type)) best = b;
      });
      if (best) out.push({ e: e, b: best, s: scoreOf(best, type) });
    });
    return out.sort(function (a, b) { return a.s - b.s; });
  }

  function options(list, current, all) {
    return '<option value="All">' + all + '</option>' + list.map(function (x) { return '<option' + (x === current ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
  }

  function rowHtml(r, i, lead, type) {
    var e = r.e, b = r.b, drag = type === 'drag';
    var res = drag ? r.s.toFixed(2) + ' s' : V.fmtLap(r.s);
    var gap = i ? '+' + (r.s - lead).toFixed(2) + ' s' : 'Fastest';
    var tyres = b.tyres || e.tyres;
    var who = [e.owner ? e.car : '', [e.year, titleOf(e), e.version].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    var drive = b.drive || e.drive;
    var info = '<span class="lb-tyre' + (tyres ? '' : ' is-none') + '">' + (drive ? '<b class="lb-drive">' + esc(drive) + '</b> &middot; ' : '') + (tyres ? esc(tyres) : 'Tyres not given') + '</span><span class="lb-date">' + esc(T.niceDate(b.date)) +
      (b.conditions ? ' · ' + esc(b.conditions) : '') + (drag && b.quarterSpeed ? ' · ' + V.fmtV(b.quarterSpeed) : '') + (e.sessions > 1 ? ' · ' + e.sessions + ' sessions' : '') + '</span>';
    return '<li class="lb-row' + (i < 3 ? ' lb-top' + (i + 1) : '') + '"><span class="lb-pos">' + (i + 1) + '</span>' +
      '<div class="lb-car"><a class="lb-name" href="track.html?s=' + esc(b.sessionId) + '">' + esc(e.owner || e.car) + '</a><small>' + esc(who) + '</small></div>' +
      '<div class="lb-time"><b>' + res + '</b><small>' + gap + '</small></div>' +
      '<div class="lb-info">' + info + '</div>' +
      // The car's mods are kept on the entry (and shown on its session page), but a board row lists only the tyres for now.
      icon('chev') + '</li>';
  }

  function showBoard(type, q) {
    var venueId = q.split(':')[0], layoutId = q.split(':')[1] || '';
    var v = library.venues.filter(function (x) { return x.id === venueId; })[0];
    var l = v && v.layouts ? v.layouts.filter(function (x) { return x.id === layoutId; })[0] : null;
    var title = v ? v.name + (l && l.name !== v.name ? ', ' + l.name : '') : venueId;
    var path = type === 'drag' ? '/drag/board?venue=' + encodeURIComponent(venueId) : (type === 'sprint' ? '/sprint/board?venue=' : '/track/board?venue=') + encodeURIComponent(venueId) + '&layout=' + encodeURIComponent(layoutId);
    fCond = 'All'; fMake = 'All'; fTyre = 'All';
    getJson(API + path).then(function (d) {
      var entries = d.entries || [];
      // What is there to filter by, from every car's results.
      var conds = [], makes = [], tyresOf = {};
      entries.forEach(function (e) {
        resultsOf(e, type).forEach(function (b) {
          var c = condOf(b), tp = tyreParts(b);
          if (conds.indexOf(c) === -1) conds.push(c);
          if (tp.make) {
            if (makes.indexOf(tp.make) === -1) makes.push(tp.make);
            tyresOf[tp.make] = tyresOf[tp.make] || [];
            if (tp.model && tyresOf[tp.make].indexOf(tp.model) === -1) tyresOf[tp.make].push(tp.model);
          }
        });
      });
      conds.sort(function (a, b) { var o = ['Dry', 'Damp', 'Wet'], x = o.indexOf(a), y = o.indexOf(b); return (x < 0 ? 9 : x) - (y < 0 ? 9 : y); });
      makes.sort();
      function draw(focus) {
        var shown = rank(entries, type);
        var what = type === 'drag' ? 'Each car\'s quickest quarter mile.' : type === 'sprint' ? 'Each car\'s fastest run.' : 'Each car\'s fastest lap.';
        var filtered = fCond !== 'All' || fMake !== 'All';
        var listType = type === 'sprint' && T.isHill(v) ? 'hill' : type;
        var h = '<a class="tp-back back-link" href="leaderboards.html?type=' + listType + '" data-go="type=' + listType + '" data-back aria-label="Back to all ' + KIND_NAME[listType] + '">' + icon('back') + 'Back' + '</a>' +
          '<div class="tp-head"><div><h2>' + esc(title) + '</h2><p class="tp-sub">' + what + '</p></div></div>' +
          '<div class="lb-filters"><div class="lb-filter-top"><div class="tp-chips lb-models" id="lb-models">' + ['All'].concat(modelChips(entries)).map(function (m) { return '<button type="button" class="chip' + (m === boardModel ? ' is-on' : '') + (m !== 'All' && !entries.some(function (e) { return modelKey(e) === m; }) ? ' is-empty' : '') + '" data-m="' + m + '">' + (MODEL_SHORT[m] || m) + '</button>'; }).join('') + '</div>' + unitsChip() + '</div>' +
          (conds.length > 1 || makes.length ? '<div class="lb-selects">' +
            (conds.length > 1 ? '<label class="lb-sel"><span>Conditions</span><select class="field" id="lb-cond">' + options(conds, fCond, 'Any conditions') + '</select></label>' : '') +
            (makes.length ? '<label class="lb-sel"><span>Tyre make</span><select class="field" id="lb-make">' + options(makes, fMake, 'Any tyres') + '</select></label>' : '') +
            (fMake !== 'All' && (tyresOf[fMake] || []).length ? '<label class="lb-sel"><span>Tyre model</span><select class="field" id="lb-tyre">' + options(tyresOf[fMake].slice().sort(), fTyre, 'Any ' + esc(fMake)) + '</select></label>' : '') +
            (filtered ? '<button type="button" class="btn btn-ghost btn-sm" id="lb-clear">Clear filters</button>' : '') + '</div>' : '') + '</div>';
        if (!shown.length) h += '<div class="card tp-empty">' + icon('trophy') + '<p>' + (filtered ? 'Nobody matches these filters.' : 'Nobody on this board yet' + (boardModel === 'All' ? '' : ' for the ' + esc(boardModel)) + '. Be the first.') + '</p></div>';
        else {
          h += '<p class="tp-small lb-count" role="status">' + shown.length + ' car' + (shown.length === 1 ? '' : 's') + (filtered ? ', each with its best that matches' : '') + '</p>' +
            '<div class="card lb-card"><ol class="lb-list">' + shown.map(function (r, i) { return rowHtml(r, i, shown[0].s, type); }).join('') + '</ol></div>' +
            '<p class="tp-small lb-note">Each row shows the tyres the time was set on. Open a car to see its mods. Weather and tyres vary between days, so use the filters to compare like with like.</p>';
        }
        h += ctaHtml();
        app.innerHTML = h;
        syncPageBack();
        document.getElementById('lb-models').addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-m]');
          if (b) { boardModel = b.getAttribute('data-m'); draw(); }
        });
        function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('change', function () { fn(el.value); draw(id); }); }
        on('lb-cond', function (x) { fCond = x; });
        on('lb-make', function (x) { fMake = x; fTyre = 'All'; });
        on('lb-tyre', function (x) { fTyre = x; });
        var clear = document.getElementById('lb-clear');
        if (clear) clear.addEventListener('click', function () { fCond = 'All'; fMake = 'All'; fTyre = 'All'; draw(); });
        if (focus) { var f = document.getElementById(focus); if (f) f.focus(); }
      }
      draw();
    }).catch(function () {
      app.innerHTML = '<div class="card tp-empty">' + icon('warn') + '<p>This leaderboard could not be loaded.</p></div>';
    });
  }

  route();
})();
