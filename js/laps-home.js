/*
  laps.html, the Laps front page: what laps.mt3uk.com/ opens the first time in a browser for anyone not signed in,
  and what Play intro on Sessions opens. The hero's buttons depend on whether the visitor is signed in,
  and the sections below it (Fastest right now among them) are drawn by js/laps-panels.js.
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

  function get(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  // The hero picture is the one set on the Track sessions sharing panel of track-admin.html (the current pick of
  // the Track sessions set, /share/track), so the admin controls it; the built-in picture is only the start.
  var shot = document.getElementById('lh-shot-img');
  if (shot) get(API + '/share/track').then(function (d) {
    var pick = d && d.success && d.pick;
    if (!pick || !pick.url) return;
    var img = new Image();
    img.onload = function () {
      // The hero's picture, and its copy under Fastest right now on a phone.
      [shot].concat([].slice.call(document.querySelectorAll('.lh-shot-copy'))).forEach(function (el) { el.src = pick.url; if (pick.caption) el.alt = pick.caption; });
    };
    img.src = pick.url;
  });

  // Fastest right now and the admin's words for each section: js/laps-panels.js.
})();
