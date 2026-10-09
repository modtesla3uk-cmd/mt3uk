const CACHE_NAME = 'mt3uk-shell-v11';
// The copy of Laps kept on a device that has switched Offline mode on (js/laps-offline.js asks for it with a
// message). Kept apart so the shell cache's clean-up never deletes it, and removed when the member switches it off.
const LAPS_CACHE = 'mt3uk-laps-offline-v1';
// The satellite map tiles seen (or fetched ahead for the member's sessions) while Offline mode is on, so a session's
// map has its picture with no signal. Tiles are fetched with CORS so they are stored at their real size.
const TILE_CACHE = 'mt3uk-laps-tiles-v1';
const TILE_HOST = 'server.arcgisonline.com';
const TILE_MAX = 2500;
// Puts a response in a cache and drops older copies of the same file under another ?v= tag, so an offline match
// (which ignores the query) can only find the newest. With `onlyIfKept` it only replaces a file already kept there.
function putFresh(cache, request, copy, onlyIfKept) {
  var path = new URL(request.url || request, self.location.origin).pathname;
  return cache.keys().then(function (ks) {
    var same = ks.filter(function (k) { return new URL(k.url).pathname === path; });
    if (onlyIfKept && !same.length) return null;
    // A page is kept under its address without the query (track.html?s=... is track.html), so a page that fetches
    // another Laps page by its plain address finds it.
    var key = /\.html$/i.test(path) ? new Request(new URL(request.url || request, self.location.origin).origin + path) : request;
    return Promise.all(same.map(function (k) { return cache.delete(k); })).then(function () { return cache.put(key, copy); });
  });
}
const LAPS_PAGES = ['/laps.html', '/track.html', '/leaderboards.html', '/laps-signin.html'];
const LAPS_FILES = [
  '/data/tracks.json', '/data/tyres.json', '/data/pads.json', '/data/vehicles.json', '/laps-manifest.json',
  '/images/laps/favicon.svg', '/images/laps/icon-192.png', '/images/laps/apple-touch-icon.png'
];
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
          keys.filter(function (key) { return key !== CACHE_NAME && key !== LAPS_CACHE && key !== TILE_CACHE; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method === 'GET' && new URL(request.url).hostname === TILE_HOST && request.url.indexOf('/tile/') !== -1) {
    event.respondWith(tileResponse(request));
    return;
  }
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  var pathname = new URL(request.url).pathname;
  var isDynamicManifest = pathname !== '/manifest.json' && pathname.slice(-13) === 'manifest.json';
  if (isDynamicManifest) {
    event.respondWith(fetch(request).catch(function () { return caches.match(request); }));
    return;
  }
  // The data files come from the network first (they change with the site). A copy is kept only for a device with
  // Offline mode on, so the track list is there with no signal.
  if (pathname.indexOf('/data/') === 0) {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response.ok) {
          var copy = response.clone();
          caches.has(LAPS_CACHE).then(function (on) { if (on) return caches.open(LAPS_CACHE).then(function (cache) { return putFresh(cache, request, copy); }); });
        }
        return response;
      }).catch(function () { return caches.match(request, { ignoreSearch: true }); })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var copy = response.clone(), copy2 = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { putFresh(cache, request, copy); });
          caches.has(LAPS_CACHE).then(function (on) { if (on) return caches.open(LAPS_CACHE).then(function (cache) { return putFresh(cache, request, copy2, true); }); });
          return response;
        })
        .catch(function () {
          // A page of Laps kept for Offline mode opens whatever its address carries after the page name
          // (track.html?s=..., ?add=1), and the front of the site stands in for a bare address.
          return caches.match(request, { ignoreSearch: true }).then(function (cached) {
            if (cached) return cached;
            if (pathname.slice(-1) === '/') return caches.match(pathname + 'index.html');
            return null;
          }).then(function (cached) {
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
            var copy = response.clone(), copy2 = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { putFresh(cache, request, copy); });
            caches.has(LAPS_CACHE).then(function (on) { if (on) return caches.open(LAPS_CACHE).then(function (cache) { return putFresh(cache, request, copy2, true); }); });
          }
          return response;
        })
        .catch(function () { return caches.match(request, { ignoreSearch: true }); })
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

// Offline mode (js/laps-offline.js): keep the Laps pages, their scripts and styles and the data files in LAPS_CACHE,
// or remove them. The scripts and styles are found from the pages' own tags, so a new script is kept without a
// change here. A file that cannot be fetched is left out; the reply says how many were kept.
function lapsKeep(cache, url, found) {
  return fetch(url, { cache: 'reload' }).then(function (response) {
    if (!response.ok) return null;
    var path = new URL(url, self.location.origin).pathname;
    var copy = response.clone();
    return putFresh(cache, new Request(url), copy).then(function () {
      if (/\.html$/i.test(path)) {
        return response.text().then(function (html) {
          var re = /(?:src|href)="([^"#]+\.(?:js|css)[^"]*)"/g, m;
          while ((m = re.exec(html))) {
            var u = new URL(m[1], self.location.origin + path);
            if (u.origin === self.location.origin) found[u.pathname + u.search] = 1;
          }
        });
      }
    }).then(function () { return true; });
  }).catch(function () { return null; });
}
function lapsPrecache() {
  return caches.open(LAPS_CACHE).then(function (cache) {
    var found = {}, kept = 0, total = 0;
    return Promise.all(LAPS_PAGES.map(function (u) { total++; return lapsKeep(cache, u, found).then(function (ok) { if (ok) kept++; }); })).then(function () {
      var rest = LAPS_FILES.concat(Object.keys(found));
      total += rest.length;
      return Promise.all(rest.map(function (u) { return lapsKeep(cache, u, {}).then(function (ok) { if (ok) kept++; }); }));
    }).then(function () { return { kept: kept, total: total }; });
  });
}
// A map tile: from the kept copy when there is one; otherwise from the network, and kept when Offline mode is on.
// With Offline mode off the tile is fetched exactly as the page asked, so nothing changes for anyone else.
function tileTrim(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= TILE_MAX) return;
    return Promise.all(keys.slice(0, keys.length - TILE_MAX + 200).map(function (k) { return cache.delete(k); }));
  });
}
function tileResponse(request) {
  return caches.has(LAPS_CACHE).then(function (on) {
    if (!on) return fetch(request);
    return caches.open(TILE_CACHE).then(function (cache) {
      return cache.match(request.url).then(function (hit) {
        if (hit) return hit;
        return fetch(request.url, { mode: 'cors' }).then(function (response) {
          if (response.ok) cache.put(request.url, response.clone()).then(function () { return tileTrim(cache); });
          return response;
        }).catch(function () { return fetch(request); });
      });
    });
  });
}
function tilesKeep(urls) {
  return caches.open(TILE_CACHE).then(function (cache) {
    var kept = 0, at = 0;
    function worker() {
      if (at >= urls.length) return Promise.resolve();
      var u = urls[at++];
      return cache.match(u).then(function (hit) {
        if (hit) { kept++; return null; }
        return fetch(u, { mode: 'cors' }).then(function (r) { if (r.ok) { kept++; return cache.put(u, r); } }).catch(function () {});
      }).then(worker);
    }
    return Promise.all([worker(), worker()]).then(function () { return tileTrim(cache); }).then(function () { return { kept: kept, total: urls.length }; });
  });
}
self.addEventListener('message', function (event) {
  var data = event.data || {}, port = event.ports && event.ports[0];
  if (data.type === 'laps-offline-on') {
    event.waitUntil(lapsPrecache().then(function (r) { if (port) port.postMessage({ ok: r.kept > 0, kept: r.kept, total: r.total }); }, function () { if (port) port.postMessage({ ok: false }); }));
  } else if (data.type === 'laps-offline-tiles') {
    var urls = (data.urls || []).filter(function (u) { return typeof u === 'string' && u.indexOf('https://' + TILE_HOST + '/') === 0; }).slice(0, 200);
    event.waitUntil(tilesKeep(urls).then(function (r) { if (port) port.postMessage({ ok: true, kept: r.kept, total: r.total }); }, function () { if (port) port.postMessage({ ok: false }); }));
  } else if (data.type === 'laps-offline-off') {
    event.waitUntil(Promise.all([caches.delete(LAPS_CACHE), caches.delete(TILE_CACHE)]).then(function () { if (port) port.postMessage({ ok: true }); }));
  }
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
