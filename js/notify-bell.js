// Notification bell in the header, to the left of search. Members see a
// count of new likes and comments on their builds, and a list that opens
// from the bell (the same notifications as the bell in My Garage). Visitors
// who aren't signed in get the sign-in prompt instead (js/signin-prompt.js).
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var SESSION_KEY = 'mt3ukMyBuildsSession';
  var search = document.getElementById('nav-search');
  // Run once: the bell's own markup is now in the page, so a flag says the script has already been here.
  if (!search || window.__mt3ukBell) return;
  window.__mt3ukBell = true;

  // The icons are in the header markup (partials/header.html), so they are there from the first paint; a page without
  // them gets them added here.
  var wrap = document.getElementById('nav-bell');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'nav-bell';
    wrap.id = 'nav-bell';
    wrap.innerHTML =
      '<button type="button" class="nav-bell-btn" id="nav-bell-btn" aria-label="Notifications" aria-expanded="false" aria-controls="nav-bell-panel">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>' +
        '<span class="nav-bell-count" id="nav-bell-count" hidden></span>' +
      '</button>' +
      '<div class="nav-bell-panel" id="nav-bell-panel" role="dialog" aria-label="Notifications" hidden></div>';
    search.parentNode.insertBefore(wrap, search);
  }

  // A person icon next to the bell goes to My Profile (or Sign In first).
  var profileLink = document.getElementById('nav-profile');
  if (!profileLink) {
    profileLink = document.createElement('a');
    profileLink.className = 'nav-profile';
    profileLink.id = 'nav-profile';
    profileLink.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
    search.parentNode.insertBefore(profileLink, search);
  }
  function setProfileLink() {
    var signedIn = !!session();
    profileLink.href = signedIn ? 'profile.html' : 'signin.html?next=' + encodeURIComponent('/profile.html');
    profileLink.setAttribute('aria-label', signedIn ? 'My Profile' : 'Sign in to your profile');
    profileLink.title = signedIn ? 'My Profile' : 'Sign in';
  }

  // A garage icon after it goes to My Garage (or Sign In first). Relative, so on laps.mt3uk.com it stays there.
  var garageLink = document.getElementById('nav-garage');
  if (!garageLink) {
    garageLink = document.createElement('a');
    garageLink.className = 'nav-profile nav-garage';
    garageLink.id = 'nav-garage';
    garageLink.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-8h10v8M7 17h10"/></svg>';
    search.parentNode.insertBefore(garageLink, search);
  }
  function setGarageLink() {
    var signedIn = !!session();
    garageLink.href = signedIn ? 'my-builds.html' : 'signin.html?next=' + encodeURIComponent('/my-builds.html');
    garageLink.setAttribute('aria-label', signedIn ? 'My Garage' : 'Sign in to My Garage');
    garageLink.title = 'My Garage';
    if (/(^|\/)my-builds\.html$/i.test(location.pathname)) garageLink.setAttribute('aria-current', 'page');
  }

  var btn = wrap.querySelector('#nav-bell-btn');
  var count = wrap.querySelector('#nav-bell-count');
  var panel = wrap.querySelector('#nav-bell-panel');
  var items = null;
  var messagesUnread = 0;

  function session() {
    try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }

  setProfileLink();
  setGarageLink();

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
    if (n.link) return n.link;
    if (/^interview:/.test(n.file || '')) return 'blog-' + n.file.slice(10) + '.html#comments';
    return 'my-builds.html?file=' + encodeURIComponent(n.file || '') + (n.commentId ? '&comment=' + encodeURIComponent(n.commentId) : '');
  }

  // Unread messages have their own count on the chat icon (js/messenger.js).
  function tellMessenger() {
    try { document.dispatchEvent(new CustomEvent('mt3ukMessagesUnread', { detail: { count: messagesUnread } })); } catch (e) {}
  }

  function setCount(unread) {
    tellMessenger();
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
      '<div class="nav-bell-head"><span>Notifications</span>' +
        (items.length ? '<button type="button" class="nav-bell-clear-all">Clear all</button>' : '') + '</div>' +
      (items.length
        ? '<ul class="nav-bell-list">' + items.slice(0, 20).map(function (n) {
            return '<li class="nav-bell-row" data-id="' + esc(n.id || '') + '"><a class="nav-bell-item' + (n.read ? '' : ' is-unread') + '" href="' + esc(linkFor(n)) + '">' +
              '<span class="nav-bell-item-name">' + esc(n.fromName || '') + '</span>' +
              '<span class="nav-bell-item-text">' + esc(n.text || (n.type === 'like' ? 'liked your build' : '')) + '</span>' +
              '<span class="nav-bell-item-date">' + esc(timeAgo(n.createdAt)) + '</span>' +
            '</a><button type="button" class="nav-bell-dismiss" aria-label="Clear this notification"><svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></li>';
          }).join('') + '</ul>'
        : '<p class="nav-bell-empty">No notifications yet. You&rsquo;ll see likes and comments on your builds here.</p>') +
      '<a class="nav-bell-all" href="profile.html">My Profile &rarr;</a>';
  }

  function load() {
    var token = session();
    if (!token) { messagesUnread = 0; setCount(0); items = null; return Promise.resolve(false); }
    return fetch(API + '/my-builds/notifications', { headers: { 'X-Session-Token': token }, cache: 'no-store' })
      .then(function (res) {
        if (res.status === 401) return { expired: true };
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && data.expired) { items = null; messagesUnread = 0; setCount(0); return 'expired'; }
        if (!data || !data.success) return false;
        items = data.notifications || [];
        messagesUnread = data.messagesUnread || 0;
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

  // Clears one notification (id) or all of them, here and on the server.
  function clear(id) {
    var token = session();
    items = id ? (items || []).filter(function (n) { return n.id !== id; }) : [];
    setCount((items || []).filter(function (n) { return !n.read; }).length);
    if (!token) return;
    try {
      fetch(API + '/my-builds/notifications/clear', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
        body: JSON.stringify(id ? { id: id } : { all: true })
      }).catch(function () {});
    } catch (e) {}
  }

  panel.addEventListener('click', function (e) {
    if (e.target.closest('.nav-bell-clear-all')) {
      e.preventDefault();
      e.stopPropagation();
      clear(null);
      drawList();
      return;
    }
    var row = e.target.closest('.nav-bell-row');
    if (!row) return;
    var id = row.getAttribute('data-id');
    if (e.target.closest('.nav-bell-dismiss')) {
      // The x clears it without opening it.
      e.preventDefault();
      e.stopPropagation();
      clear(id);
      drawList();
      return;
    }
    // Opening a notification clears it too, then follows the link.
    if (id && e.target.closest('.nav-bell-item')) clear(id);
  });

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
  // Check again every few minutes while the page is open, on coming back to
  // the page, and straight away when a phone notification arrives (sw.js).
  // The unread message count goes to the chat icon (js/messenger.js).
  setInterval(function () { if (!document.hidden && panel.hidden) load(); }, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && panel.hidden) load(); });
  if (navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === 'function') {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'mt3uk-push' && panel.hidden) load();
    });
  }
})();
