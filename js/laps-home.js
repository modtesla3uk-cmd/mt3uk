/*
  laps.html, the Laps front page: what laps.mt3uk.com/ opens the first time in a browser for anyone not signed in,
  and what Play intro on Sessions opens. The hero's buttons depend on whether the visitor is signed in,
  and "Fastest right now" shows the quickest shared time at the busiest boards, from /track/counts (two single KV
  keys on the worker) and the track list in data/tracks.json.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  // From mt3uk.com/laps.html the buttons go to laps.mt3uk.com.
  document.querySelectorAll('a[href^="track.html"], a[href^="leaderboards.html"], a[href^="signin.html"]').forEach(function (a) { a.setAttribute('data-laps', ''); });
  if (window.mt3ukLapsLinks) window.mt3ukLapsLinks();
  function read(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  // Seen once: laps.mt3uk.com/ now opens Sessions in this browser (index.html), where Play intro brings this back.
  try { localStorage.setItem('mt3ukLapsIntroSeen', '1'); } catch (e) {}
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Signed in: straight to adding a session, and to their own sessions.
  if (read('mt3ukMyBuildsSession')) {
    ['lh-start', 'lh-start-2'].forEach(function (id) {
      var a = document.getElementById(id);
      if (a) { a.href = 'track.html?add=1'; a.textContent = 'Add a session'; }
    });
    var actions = document.getElementById('lh-actions');
    if (actions) actions.insertAdjacentHTML('beforeend', '<a class="btn btn-secondary" href="track.html">Your sessions</a>');
    var note = document.getElementById('lh-note');
    if (note) note.textContent = 'Sessions are private until you choose to share them.';
  }

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

  function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  // The hero picture is the one set on the Track sessions sharing panel of track-admin.html (the current pick of
  // the Track sessions set, /share/track), so the admin controls it; the built-in picture is only the start.
  var shot = document.getElementById('lh-shot-img');
  if (shot) get(API + '/share/track').then(function (d) {
    var pick = d && d.success && d.pick;
    if (!pick || !pick.url) return;
    var img = new Image();
    img.onload = function () { shot.src = pick.url; if (pick.caption) shot.alt = pick.caption; };
    img.src = pick.url;
  });

  var box = document.getElementById('lh-fast');
  if (!box) return;
  Promise.all([get(API + '/track/counts'), get('data/tracks.json')]).then(function (r) {
    var counts = (r[0] && r[0].counts) || {}, leaders = (r[0] && r[0].leaders) || {};
    var venues = {};
    ((r[1] && r[1].venues) || []).forEach(function (v) { venues[v.id] = v; });
    var rows = Object.keys(leaders).filter(function (k) { return (leaders[k] || []).length; }).map(function (k) {
      var parts = k.split(':'), kind = parts[0], v = venues[parts[1]] || null, l = v && (v.layouts || []).filter(function (x) { return x.id === parts[2]; })[0];
      if (!v) return null;
      var drag = kind === 'drag-board';
      var where = v.name + (!drag && l && l.name && l.name !== v.name ? ', ' + l.name : '');
      var href = 'leaderboards.html?' + (drag ? 'drag=' + encodeURIComponent(parts[1]) : (kind === 'sprint-board' ? 'sprint=' : 'board=') + encodeURIComponent(parts[1] + ':' + parts[2]));
      var top = leaders[k][0];
      var what = drag ? 'Quarter mile' : kind === 'sprint-board' ? 'Sprint' : 'Lap';
      return { n: counts[k] || 0, where: where, href: href, who: top.owner || 'MT3UK member', car: top.car === 'MT3UK member build' && top.model ? title(top) : (top.car || title(top)),
        res: drag ? Number(top.quarter).toFixed(2) + ' s' : lapTime(top.time), what: what };
    }).filter(Boolean).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
    box.innerHTML = rows.length ? rows.map(function (x) {
      return '<a href="' + esc(x.href) + '"><span class="lh-where"><b>' + esc(x.where) + '</b><span>' + esc(x.who) + (x.car ? ', ' + esc(x.car) : '') + ' &middot; ' + esc(x.what) + '</span></span><span class="lh-time">' + esc(x.res) + '</span></a>';
    }).join('') : '<p class="lh-fast-empty">No shared times yet. Be the first on the board.</p>';
  }).catch(function () { box.innerHTML = '<p class="lh-fast-empty">The leaderboards could not be loaded just now.</p>'; });
})();
