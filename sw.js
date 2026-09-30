const CACHE_NAME = 'mt3uk-shell-v9';
const PRECACHE_URLS = [
  '/index.html',
  '/shop.html',
  '/contact.html',
  '/track-day-prep.html',
  '/track-day-on-the-day.html',
  '/track-day-venues.html',
  '/offline.html',
  '/manifest.json',
  '/images/site/apple-touch-icon.png',
  '/images/site/icon-192.png',
  '/images/site/favicon-32.png',
  '/images/site/favicon-16.png',
  '/images/site/mt3uk-wordmark-dark.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  var pathname = new URL(request.url).pathname;
  var isDynamicManifest = pathname !== '/manifest.json' && pathname.slice(-13) === 'manifest.json';
  if (pathname.indexOf('/data/') === 0 || isDynamicManifest) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || caches.match('/offline.html');
          });
        })
    );
    return;
  }

  // Scripts, styles and data change with each site update, so they come from
  // the network first and the saved copy is only used offline. (Serving them
  // cache-first kept members on old versions of the site's scripts.)
  if (/\.(js|css|json)$/i.test(pathname)) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response.ok) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        })
        .catch(function () { return caches.match(request); })
    );
    return;
  }

  // Images and fonts rarely change: saved copy first, network if missing.
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      });
    })
  );
});

// Push notifications, turned on per device in My Garage. The worker sends
// { title, body, url }; tapping the alert opens (or focuses) that page.
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  // Open pages hear about it too, so the bell and the chat icon update
  // straight away (js/notify-bell.js, js/messenger.js).
  var tellPages = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
    windows.forEach(function (w) { w.postMessage({ type: 'mt3uk-push', url: data.url || '/' }); });
  }).catch(function () {});
  event.waitUntil(Promise.all([tellPages, self.registration.showNotification(data.title || 'MT3UK', {
    body: data.body || '',
    icon: '/images/site/icon-192.png',
    badge: '/images/site/notification-badge.png',
    data: { url: data.url || '/' }
  })]));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  // Go to the photo or comment the alert is about. If MT3UK is already open
  // (the installed app or a browser tab), bring it forward and move it
  // there, rather than opening a second window at the old page.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      var sameOrigin = windows.filter(function (w) { return w.url.indexOf(self.location.origin) === 0; });
      for (var i = 0; i < sameOrigin.length; i++) {
        if (sameOrigin[i].url === url && 'focus' in sameOrigin[i]) return sameOrigin[i].focus();
      }
      var existing = sameOrigin[0];
      if (existing && 'navigate' in existing) {
        return existing.focus()
          .then(function (w) { return (w || existing).navigate(url); })
          .catch(function () { return self.clients.openWindow(url); });
      }
      return self.clients.openWindow(url);
    })
  );
});
