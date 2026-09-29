// Notification bell in the header, to the left of search. Members see a
// count of new likes and comments on their builds, and a list that opens
// from the bell (the same notifications as the bell in My Garage). Visitors
// who aren't signed in get the sign-in prompt instead (js/signin-prompt.js).
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var SESSION_KEY = 'mt3ukMyBuildsSession';
  var search = document.getElementById('nav-search');
  if (!search || document.getElementById('nav-bell')) return;

  var wrap = document.createElement('div');
  wrap.className = 'nav-bell';
  wrap.id = 'nav-bell';
  wrap.innerHTML =
    '<button type="button" class="nav-bell-btn" id="nav-bell-btn" aria-label="Notifications" aria-expanded="false" aria-controls="nav-bell-panel">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>' +
      '<span class="nav-bell-count" id="nav-bell-count" hidden></span>' +
    '</button>' +
    '<div class="nav-bell-panel" id="nav-bell-panel" role="dialog" aria-label="Notifications" hidden></div>';
  search.parentNode.insertBefore(wrap, search);

  var btn = wrap.querySelector('#nav-bell-btn');
  var count = wrap.querySelector('#nav-bell-count');
  var panel = wrap.querySelector('#nav-bell-panel');
  var items = null;

  function session() {
    try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function timeAgo(iso) {
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (!(mins >= 0)) return '';
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  function linkFor(n) {
    if (/^interview:/.test(n.file || '')) return 'blog-' + n.file.slice(10) + '.html#comments';
    return 'my-builds.html?file=' + encodeURIComponent(n.file || '') + (n.commentId ? '&comment=' + encodeURIComponent(n.commentId) : '');
  }

  function setCount(unread) {
    count.hidden = !unread;
    count.textContent = unread > 99 ? '99+' : String(unread);
    btn.setAttribute('aria-label', unread ? 'Notifications, ' + unread + ' new' : 'Notifications');
  }

  function drawSignedOut(expired) {
    panel.innerHTML =
      '<div class="nav-bell-signin">' +
        '<p class="nav-bell-title">' + (expired ? 'Please sign in again' : 'Sign in for notifications') + '</p>' +
        '<p>See when members like or comment on your builds.</p>' +
        '<a class="nav-bell-cta" href="signin.html?next=' + encodeURIComponent(location.pathname + location.search) + '">Sign Up / Sign In</a>' +
      '</div>';
  }

  function drawList() {
    if (!items) {
      panel.innerHTML = '<p class="nav-bell-empty">Loading&hellip;</p>';
      return;
    }
    panel.innerHTML =
      '<p class="nav-bell-head">Notifications</p>' +
      (items.length
        ? '<ul class="nav-bell-list">' + items.slice(0, 20).map(function (n) {
            return '<li><a class="nav-bell-item' + (n.read ? '' : ' is-unread') + '" href="' + esc(linkFor(n)) + '">' +
              '<span class="nav-bell-item-name">' + esc(n.fromName || '') + '</span>' +
              '<span class="nav-bell-item-text">' + esc(n.text || (n.type === 'like' ? 'liked your build' : '')) + '</span>' +
              '<span class="nav-bell-item-date">' + esc(timeAgo(n.createdAt)) + '</span>' +
            '</a></li>';
          }).join('') + '</ul>'
        : '<p class="nav-bell-empty">No notifications yet. You&rsquo;ll see likes and comments on your builds here.</p>') +
      '<a class="nav-bell-all" href="my-builds.html">Open My Garage &rarr;</a>';
  }

  function load() {
    var token = session();
    if (!token) { setCount(0); items = null; return Promise.resolve(false); }
    return fetch(API + '/my-builds/notifications', { headers: { 'X-Session-Token': token }, cache: 'no-store' })
      .then(function (res) {
        if (res.status === 401) return { expired: true };
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && data.expired) { items = null; setCount(0); return 'expired'; }
        if (!data || !data.success) return false;
        items = data.notifications || [];
        setCount(data.unread || 0);
        if (!panel.hidden) drawList();
        return true;
      })
      .catch(function () { return false; });
  }

  function markRead() {
    var token = session();
    if (!token || count.hidden) return;
    fetch(API + '/my-builds/notifications/read', { method: 'POST', headers: { 'X-Session-Token': token } })
      .then(function () {
        setCount(0);
        (items || []).forEach(function (n) { n.read = true; });
      })
      .catch(function () {});
  }

  function close() {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (!session()) {
      drawSignedOut(false);
      return;
    }
    drawList();
    load().then(function (result) {
      if (panel.hidden) return;
      if (result === 'expired') { drawSignedOut(true); return; }
      drawList();
      markRead();
    });
  });

  document.addEventListener('click', function (e) {
    if (!panel.hidden && !wrap.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) { close(); btn.focus(); }
  });

  load();
  // Check again every few minutes while the page is open.
  setInterval(function () { if (!document.hidden && panel.hidden) load(); }, 3 * 60 * 1000);
})();
