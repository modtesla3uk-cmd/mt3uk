/*
  Favourites (favourites.html): the Track sessions a member has starred, grouped by type, on their own page. The list
  is on the worker (GET and POST /track/favourites, one list per member). A session is opened from its row; its star
  takes it off the list.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var SESSION_KEY = 'mt3ukMyBuildsSession';
  var app = document.getElementById('fav-app');
  if (!app) return;
  var GROUPS = [['track', 'Track days'], ['sprint', 'Sprints'], ['hill', 'Hill climbs'], ['drag', 'Drag strips'], ['drive', 'Drives']];
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z"/></svg>';
  var state = { list: [], filter: 'all', ranks: {} };
  var TIERS = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };
  function ordinal(n) { var t = n % 100, u = n % 10; return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'); }
  // The session's place on its leaderboard, or why it is not on one (GET /track/ranks), as on the Sessions list.
  function rankHtml(id) {
    var r = state.ranks[id];
    if (!r) return '';
    if (!r.onBoard) return '<span class="fav-rank is-off" title="' + esc(r.reason || '') + '">Not on a board</span>';
    var medal = r.place <= 3 ? '<em class="fav-medal fav-medal-' + r.place + '">' + TIERS[r.place] + '</em> ' : '';
    return '<span class="fav-rank">' + medal + ordinal(r.place) + ' of ' + r.of + ' on ' + esc(r.board) + '</span>';
  }

  function token() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (token()) opts.headers['X-Session-Token'] = token();
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; });
    });
  }
  function fmtLap(sec) {
    if (!sec) return '';
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m ? m + ':' + (s < 10 ? '0' : '') + s.toFixed(2) : s.toFixed(2) + ' s';
  }
  function groupOf(f) {
    if (f.type === 'drag') return 'drag';
    if (f.type === 'sprint') return f.hill ? 'hill' : 'sprint';
    if (f.type === 'other') return 'drive';
    return 'track';
  }
  function trackName(f) {
    var base = f.venue || (f.type === 'sprint' ? (f.hill ? 'Hill climb' : 'Sprint') : f.type === 'drag' ? 'Drag run' : 'Track session');
    if (f.layout && f.layout !== f.venue) return base + ', ' + f.layout;
    if (!f.layout && f.organizer) return base + ', ' + f.organizer;
    return base;
  }
  function result(f) {
    if (f.type === 'drag') return f.quarter ? f.quarter.toFixed(2) + ' s, 1/4 mile' : f.s60 ? f.s60.toFixed(2) + ' s, 0 to 60 mph' : (f.runs || 0) + ' runs';
    if (f.type === 'other' && !f.bestTime) return '';
    return f.bestTime ? fmtLap(f.bestTime) : (f.laps || 0) + (f.type === 'sprint' ? ' runs' : ' laps');
  }
  function rowHtml(f) {
    var meta = [f.car, f.date, f.mine ? '' : 'Shared by another member'].filter(Boolean).join(' · ');
    return '<div class="fav-row" data-fav-row>' +
      '<a class="fav-link" href="track.html?s=' + esc(f.id) + '"><b>' + esc(trackName(f)) + '</b><span>' + esc(meta) + '</span>' + rankHtml(f.id) + '</a>' +
      '<span class="fav-res">' + esc(result(f)) + '</span>' +
      '<button type="button" class="fav-star" data-fav-remove data-id="' + esc(f.id) + '" aria-pressed="true" aria-label="Remove from favourites" title="Remove from favourites">' + STAR + '</button>' +
      '</div>';
  }
  function counts() {
    var c = { all: state.list.length };
    GROUPS.forEach(function (g) { c[g[0]] = state.list.filter(function (f) { return groupOf(f) === g[0]; }).length; });
    return c;
  }
  function render() {
    if (!state.list.length) {
      app.innerHTML = '<p class="fav-empty">You have no favourites yet. Open a Track session and press Favourite, and it will be here.</p>';
      return;
    }
    var c = counts();
    var tabs = '<div class="fav-tabs" role="group" aria-label="Show">' +
      '<button type="button" class="fav-chip' + (state.filter === 'all' ? ' is-on' : '') + '" data-fav-filter="all" aria-pressed="' + (state.filter === 'all') + '">All ' + c.all + '</button>' +
      GROUPS.filter(function (g) { return c[g[0]]; }).map(function (g) {
        return '<button type="button" class="fav-chip' + (state.filter === g[0] ? ' is-on' : '') + '" data-fav-filter="' + g[0] + '" aria-pressed="' + (state.filter === g[0]) + '">' + esc(g[1]) + ' ' + c[g[0]] + '</button>';
      }).join('') + '</div>';
    var body = GROUPS.filter(function (g) { return (state.filter === 'all' || state.filter === g[0]) && c[g[0]]; }).map(function (g) {
      var rows = state.list.filter(function (f) { return groupOf(f) === g[0]; }).map(rowHtml).join('');
      return '<section class="fav-group"><h2>' + esc(g[1]) + ' <span class="fav-count">' + c[g[0]] + '</span></h2>' + rows + '</section>';
    }).join('');
    app.innerHTML = tabs + body;
  }
  function signIn(text) {
    app.innerHTML = '<p class="fav-empty">' + esc(text) + ' <a href="laps-signin.html?next=favourites.html">Sign in to Laps</a>.</p>';
  }
  // The usage ring beside the title and the tip's bulb, as on Sessions and the Leaderboard.
  function heading() {
    if (window.MT3UKLapsTip) window.MT3UKLapsTip.place();
    if (token()) api('GET', '/track/tiers/access').then(function (t) { if (window.MT3UKQuotaRing) window.MT3UKQuotaRing.draw(t || {}); });
  }
  function load() {
    heading();
    if (!token()) { signIn('Sign in to see the sessions you have starred.'); return; }
    api('GET', '/track/favourites').then(function (d) {
      if (d.status === 401) { signIn('Please sign in again.'); return; }
      if (d.status === 403) { app.innerHTML = '<p class="fav-empty">Favourites are for members with early access to Track sessions.</p>'; return; }
      if (!d.success) { app.innerHTML = '<p class="fav-empty">Your favourites could not be loaded. Try again in a moment.</p>'; return; }
      state.list = d.sessions || [];
      render();
      // Where each one stands on its leaderboard, once the list is drawn.
      if (state.list.length) api('GET', '/track/ranks?ids=' + state.list.map(function (f) { return f.id; }).join(',')).then(function (rk) {
        if (rk && rk.success) { state.ranks = rk.ranks || {}; render(); }
      }).catch(function () {});
    }).catch(function () {
      app.innerHTML = '<p class="fav-empty">Your favourites could not be loaded. Check your connection and try again.</p>';
    });
  }
  app.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-fav-filter]');
    if (chip) { state.filter = chip.getAttribute('data-fav-filter'); render(); return; }
    var star = e.target.closest('[data-fav-remove]');
    if (!star || star.disabled) return;
    var id = star.getAttribute('data-id');
    star.disabled = true;
    api('POST', '/track/favourites', { id: id, on: false }).then(function (d) {
      if (!d.success) { star.disabled = false; star.title = d.message || 'Could not save that. Try again.'; return; }
      state.list = state.list.filter(function (f) { return f.id !== id; });
      if (state.filter !== 'all' && !state.list.some(function (f) { return groupOf(f) === state.filter; })) state.filter = 'all';
      render();
    }).catch(function () { star.disabled = false; star.title = 'Could not reach Laps. Try again when you are online.'; });
  });
  load();
})();
