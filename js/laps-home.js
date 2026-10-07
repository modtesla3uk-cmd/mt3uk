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

  // The session picture: a tap opens it big over the page, the next tap (or Escape) shuts it.
  // Full screen where the browser allows it (and sideways on a phone, so the wide picture fills the screen); the
  // overlay on its own otherwise.
  function shutLight() {
    var open = document.querySelector('.lh-light');
    if (!open) return;
    open.remove();
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }
  document.addEventListener('click', function (e) {
    if (document.querySelector('.lh-light')) { shutLight(); return; }
    var img = e.target.closest && e.target.closest('.lh-shot img');
    if (!img) return;
    var box = document.createElement('div');
    box.className = 'lh-light'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'The session picture, full screen. Tap to close');
    var big = document.createElement('img'); big.src = img.src; big.alt = img.alt;
    box.appendChild(big); document.body.appendChild(box);
    var req = box.requestFullscreen || box.webkitRequestFullscreen;
    if (req) {
      var p = req.call(box);
      if (p && p.then) p.then(function () { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {} }).catch(function () {});
    }
  });
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement) { var open = document.querySelector('.lh-light'); if (open) open.remove(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shutLight(); });

  // Fastest right now and the admin's words for each section: js/laps-panels.js.
})();
