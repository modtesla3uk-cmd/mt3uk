/*
  admin.html, Facebook posts panel (Sharing links group): ready-to-paste posts for the MT3UK Facebook group, written
  from the site's own public data, so there is no worker route: Build of the Week (data/featured.json and the gallery
  manifest), upcoming events (data/event-pages.json), the latest owner interviews (data/interviews.json) and the
  fastest lap on Laps (/track/counts with data/tracks.json). Each card holds the post in a box the admin can edit and a
  Copy post button. Every link is tagged utm_source=facebook so visitors from Facebook show in the analytics and see
  the welcome strip on the homepage (index.html). Facebook does not let a site post into a group, so this is a copy.
*/
(function () {
  var wrap = document.getElementById('fbposts-wrap');
  var listEl = document.getElementById('fbp-list');
  if (!wrap || !listEl) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var SITE = 'https://mt3uk.com';
  var LAPS = 'https://laps.mt3uk.com';
  var noteEl = document.getElementById('fbp-note');
  var loaded = false;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function tag(url, campaign) { return url + (url.indexOf('?') === -1 ? '?' : '&') + 'utm_source=facebook&utm_medium=group&utm_campaign=' + campaign; }
  // Today's date in the UK, as YYYY-MM-DD, to compare with publish and event dates.
  function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); }
  function nice(date) {
    var d = new Date(date + 'T12:00:00');
    return isNaN(d) ? date : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function lapTime(s) {
    s = Number(s);
    if (!(s > 0)) return '';
    var m = Math.floor(s / 60), r = s - m * 60;
    return m ? m + ':' + (r < 10 ? '0' : '') + r.toFixed(2) : r.toFixed(2) + ' s';
  }

  function buildOfTheWeek(photos, featured) {
    if (!featured || !featured.file) return [];
    var p = (photos || []).filter(function (x) { return x.file === featured.file; })[0];
    var who = p && p.name ? ' by ' + p.name : '';
    var what = p && p.caption ? p.caption : 'this week’s winner';
    var link = tag(SITE + '/share/' + encodeURIComponent(featured.file) + '.html', 'build_of_the_week');
    return [{ kind: 'Build of the Week', title: what + who,
      text: 'Build of the Week: ' + what + who + '.\n\nVote for next week’s winner, and add your own build to the gallery (it only takes a minute, and you don’t need Facebook):\n' + link }];
  }

  function events(list) {
    var now = today();
    return (list || []).filter(function (e) {
      return !e.draft && e.publish && e.publish <= now && (e.endDate || e.startDate) >= now;
    }).sort(function (a, b) { return String(a.startDate).localeCompare(String(b.startDate)); }).map(function (e) {
      var when = e.startDate ? nice(e.startDate) + (e.startTime ? ', ' + e.startTime + (e.endTime ? ' to ' + e.endTime : '') : '') : '';
      var where = [e.venue, e.town].filter(Boolean).join(', ');
      var link = tag(SITE + '/share/event/' + encodeURIComponent(e.slug) + '.html', 'event_' + e.slug);
      return { kind: 'Event', title: e.name || e.title,
        text: (e.name || e.title) + (e.tagline ? '\n' + e.tagline : '') + '\n\n' + (when ? when + '\n' : '') + (where ? where + '\n' : '') + (e.entry ? 'Entry: ' + e.entry + (e.entryNote ? ' ' + e.entryNote : '') + '\n' : '') + '\nDetails: ' + link };
    });
  }

  function interviews(list) {
    var now = today();
    return (list || []).filter(function (i) { return i.publish && i.publish <= now && i.url; })
      .sort(function (a, b) { return String(b.publish).localeCompare(String(a.publish)); }).slice(0, 3).map(function (i) {
        var link = tag(SITE + '/' + i.url, 'interview_' + i.url.replace(/^blog-|\.html$/g, ''));
        var car = [i.car, i.year].filter(Boolean).join(', ');
        return { kind: 'Owner interview', title: i.title,
          text: 'Owner interview: ' + i.title + '\n' + (i.name ? i.name : '') + (car ? ' (' + car + ')' : '') + '\n\n' + (i.excerpt || '') + '\n\nRead it: ' + link };
      });
  }

  function lapsFastest(counts, tracks) {
    if (!counts) return [];
    var cs = counts.counts || {}, leaders = counts.leaders || {}, venues = {};
    ((tracks && tracks.venues) || []).forEach(function (v) { venues[v.id] = v; });
    var boards = Object.keys(leaders).filter(function (k) { return (leaders[k] || []).length; }).map(function (k) {
      var p = k.split(':'), v = venues[p[1]];
      return v ? { kind: p[0], key: k, venue: v, layoutId: p[2] || '', n: cs[k] || 0, top: leaders[k][0] } : null;
    }).filter(Boolean).sort(function (a, b) { return b.n - a.n; });
    var b = boards[0];
    if (!b) return [];
    var drag = b.kind === 'drag-board';
    var res = drag ? Number(b.top.quarter).toFixed(2) + ' s' : lapTime(b.top.time);
    if (!res) return [];
    var what = drag ? 'quarter mile' : b.kind === 'sprint-board' ? (b.venue.hill ? 'hill climb' : 'sprint') : 'lap';
    var q = drag ? 'drag=' + encodeURIComponent(b.venue.id) : (b.kind === 'sprint-board' ? 'sprint=' : 'board=') + encodeURIComponent(b.venue.id + ':' + b.layoutId);
    var link = tag(LAPS + '/leaderboards.html?' + q, 'laps_fastest');
    var who = b.top.owner || 'an MT3UK member';
    return [{ kind: 'Fastest on Laps', title: 'Fastest ' + what + ' at ' + b.venue.name,
      text: 'Fastest ' + what + ' at ' + b.venue.name + ' on Laps by MT3UK: ' + res + ', ' + who + '.\n\nHow quick are you? Upload your lap timer file and see where you rank (' + b.n + ' car' + (b.n === 1 ? '' : 's') + ' on this board so far):\n' + link }];
  }

  function copy(text, done) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }

  function draw(cards) {
    if (!cards.length) { listEl.innerHTML = '<p class="empty">Nothing to post about yet.</p>'; return; }
    listEl.innerHTML = cards.map(function (c, i) {
      return '<div class="fbp-card" data-i="' + i + '"><div class="fbp-head"><span class="iv-sub">' + esc(c.kind) + '</span><b>' + esc(c.title) + '</b></div>' +
        '<textarea class="fbp-text" rows="7" aria-label="Post for ' + esc(c.title) + '">' + esc(c.text) + '</textarea>' +
        '<div class="iv-toolbar"><button type="button" class="secondary fbp-copy">Copy post</button><span class="iv-note fbp-done" role="status"></span></div></div>';
    }).join('');
  }

  function load() {
    noteEl.textContent = 'Loading…';
    Promise.all([
      get('images/gallery/manifest.json'), get('data/featured.json'), get('data/event-pages.json'),
      get('data/interviews.json'), get(API + '/track/counts'), get('data/tracks.json')
    ]).then(function (r) {
      loaded = true;
      var cards = [].concat(buildOfTheWeek(r[0], r[1]), events(r[2] && r[2].events), interviews(r[3] && r[3].interviews), lapsFastest(r[4], r[5]));
      noteEl.textContent = '';
      draw(cards);
    });
  }

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.fbp-copy');
    if (!btn) return;
    var card = btn.closest('.fbp-card');
    var done = card.querySelector('.fbp-done');
    copy(card.querySelector('.fbp-text').value, function (ok) { done.textContent = ok ? 'Copied. Paste it into the group.' : 'Could not copy. Select the text and copy it by hand.'; });
  });
  document.getElementById('fbp-refresh').addEventListener('click', load);
  wrap.addEventListener('toggle', function () { if (wrap.open && !loaded) load(); });
})();
