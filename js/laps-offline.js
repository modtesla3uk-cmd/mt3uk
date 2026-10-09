/*
  Offline mode for Laps (js/laps-offline.js, css/laps-offline.css, sw.js).

  - The switch (Laps footer, Profile, and a one-time offer) keeps a copy of the Laps pages, scripts and track data
    on the device (sw.js, LAPS_CACHE), so Laps opens with no signal.
  - The page notices when the connection goes (the browser's online and offline events, and any request that fails
    to reach the worker) and says so: "You're in offline mode", with what still works.
  - Reads: the worker's answers for the member's cars, session list, a session opened before and the track list are
    kept in IndexedDB as they come in (cacheable), and are used, marked as old, when there is no connection.
  - Adding a session with no connection: the file is read and timed in the browser as usual; Save puts the session
    and its readings in a queue on the device (queueSession). When the connection is back (or the page is next
    opened with one) the queue is sent, in order, and a message says how many went (sync).
  - Everything else that needs the worker (leaderboards, sharing, sign-in, editing a saved session) says it needs a
    connection.

  window.MT3UKOffline is used by js/track-page.js.
*/
(function () {
  var API = window.MT3UK_TRACK_API || 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var SESSION_KEY = 'mt3ukMyBuildsSession', EMAIL_KEY = 'mt3ukMyBuildsEmail';
  var ON_KEY = 'mt3ukLapsOffline', ASKED_KEY = 'mt3ukLapsOfflineAsked', KEPT_KEY = 'mt3ukLapsOfflineKept';
  // Sessions kept for offline viewing: the latest few are fetched when Offline mode goes on, and any opened later are kept
  // too, up to KEEP_SESSIONS (the oldest go first).
  var KEEP_SESSIONS = 60, PREPARE_SESSIONS = 5;
  // A car's browser (the Tesla screen) has little memory and closed while Offline mode fetched the latest 25 sessions
  // and their maps, so Offline mode is now about the circuits picked (see Circuits kept on the device): the latest
  // sessions are a small fallback on every device, and a car browser keeps fewer per circuit and fewer map pictures.
  function carBrowser() {
    if (window.MT3UK_CAR_BROWSER != null) return !!window.MT3UK_CAR_BROWSER;
    return /Tesla|QtCarBrowser/i.test(navigator.userAgent || '') || !!(navigator.deviceMemory && navigator.deviceMemory <= 2);
  }
  function prepareSessions() { return PREPARE_SESSIONS; }
  // The Tesla screen refuses every page load while the car has no connection (a fresh open, a browser refresh, a move
  // to another page), before the saved copy gets a look in, so on a car browser Laps says to keep the tab open, and
  // moves between its pages are made inside the open tab (softNav below).
  var CAR_NOTE = 'On this car\'s screen, keep this tab open and do not refresh: the car cannot load pages with no signal. Moving between Sessions, the Leaderboard and a session still works from this tab.';
  function carNoteHtml(cls) { return carBrowser() ? '<p class="' + (cls || 'lo-small') + ' lo-car-note"><b>Car screen:</b> ' + esc(CAR_NOTE) + '</p>' : ''; }
  var SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/';
  var REFRESH_AFTER = 20 * 3600 * 1000;

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked */ }
    return null;
  }
  function token() { return ls(SESSION_KEY) || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ICON = {
    off: '<path d="M2 8.8a15 15 0 0 1 4-2.4M22 8.8a15 15 0 0 0-9-3.7M5 12.9a10 10 0 0 1 3.2-2M19 12.9a10 10 0 0 0-3.4-2.2M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
    cloud: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20.5A5.5 5.5 0 0 1 7.4 9.6 8 8 0 0 1 22.6 8.5 6 6 0 0 1 21.5 20.5Z"/><circle cx="14.6" cy="14" r="4.6" stroke-width="1.7"/><path stroke-width="1.7" d="M10 14h9.2M14.6 9.4c1.5 1.3 2.3 2.9 2.3 4.6s-.8 3.3-2.3 4.6c-1.5-1.3-2.3-2.9-2.3-4.6s.8-3.3 2.3-4.6z"/></g>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12A9 9 0 0 1 18.5 5.8L21 8M21 3v5h-5M3 21v-5h5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>'
  };
  function icon(n) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }

  // ---------- Storage: IndexedDB, or memory when the browser will not give it ----------
  var mem = { kv: {}, queue: [], seq: 0 };
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('mt3uk-laps-offline', 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          d.createObjectStore('kv');
          d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      if (!d) return undefined;
      return new Promise(function (resolve) {
        var out;
        try {
          var t = d.transaction(store, mode), s = t.objectStore(store);
          out = fn(s);
          t.oncomplete = function () { resolve(out && 'result' in out ? out.result : undefined); };
          t.onerror = t.onabort = function () { resolve(undefined); };
        } catch (e) { resolve(undefined); }
      });
    });
  }
  function kvGet(k) { return db().then(function (d) { return d ? tx('kv', 'readonly', function (s) { return s.get(k); }) : mem.kv[k]; }); }
  function kvSet(k, v) { return db().then(function (d) { if (!d) { mem.kv[k] = v; return; } return tx('kv', 'readwrite', function (s) { return s.put(v, k); }); }); }
  function kvAll() {
    return db().then(function (d) {
      if (!d) return Object.keys(mem.kv).map(function (k) { return { key: k, value: mem.kv[k] }; });
      return new Promise(function (resolve) {
        var out = [];
        try {
          var req = d.transaction('kv', 'readonly').objectStore('kv').openCursor();
          req.onsuccess = function () { var c = req.result; if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else resolve(out); };
          req.onerror = function () { resolve(out); };
        } catch (e) { resolve(out); }
      });
    });
  }
  function kvDel(k) { return db().then(function (d) { if (!d) { delete mem.kv[k]; return; } return tx('kv', 'readwrite', function (s) { return s.delete(k); }); }); }
  function qAll() {
    return db().then(function (d) {
      if (!d) return mem.queue.slice();
      return tx('queue', 'readonly', function (s) { return s.getAll(); }).then(function (l) { return (l || []).sort(function (a, b) { return a.id - b.id; }); });
    });
  }
  function qPut(job) {
    return db().then(function (d) {
      if (!d) {
        if (!job.id) job.id = ++mem.seq;
        mem.queue = mem.queue.filter(function (x) { return x.id !== job.id; }).concat([job]);
        return job;
      }
      return new Promise(function (resolve, reject) {
        try {
          var t = d.transaction('queue', 'readwrite'), req = t.objectStore('queue').put(job);
          req.onsuccess = function () { job.id = req.result; };
          t.oncomplete = function () { resolve(job); };
          t.onerror = t.onabort = function () { reject(t.error || new Error('Could not keep it on this device.')); };
        } catch (e) { reject(e); }
      });
    });
  }
  function qDel(id) {
    return db().then(function (d) {
      if (!d) { mem.queue = mem.queue.filter(function (x) { return x.id !== id; }); return; }
      return tx('queue', 'readwrite', function (s) { return s.delete(id); });
    });
  }

  // ---------- Reads kept for the offline pages ----------
  // Which worker answers are worth keeping: the member's cars and sessions, one session (the latest few), the
  // track list, the copy and access answers the Add page asks for.
  function cacheable(path) {
    return /^\/(my-builds|track\/sessions|track\/tracks|track\/copy|track\/access|track\/counts|tyres|pads|vehicles)(\?|$)/.test(path) || path.indexOf('/track/session?id=') === 0 || boardPath(path);
  }
  // The leaderboards: a board for a circuit, a sprint or a drag strip.
  function boardPath(path) { return /^\/(track|sprint|drag)\/board\?/.test(path); }
  function venueOf(path) { var m = /[?&]venue=([^&]*)/.exec(path); return m ? decodeURIComponent(m[1]) : ''; }
  function cacheKey(path) { return 'get:' + (ls(EMAIL_KEY) || '') + ':' + path; }
  function remember(path, d) {
    if (!cacheable(path) || !d || d.success === false || (d.status && d.status >= 400)) return;
    var copy;
    try { copy = JSON.parse(JSON.stringify(d)); } catch (e) { return; }
    delete copy.status;
    var k = cacheKey(path);
    kvSet(k, { at: Date.now(), value: copy }).then(function () {
      if (path.indexOf('/track/session?id=') !== 0) return;
      // Keep only the latest few sessions: each one carries its lap traces.
      // Sessions of a kept circuit (pinSessions) are never trimmed: they are why the circuit was kept.
      return Promise.all([kvAll(), pinnedIds()]).then(function (r) {
        var prefix = 'get:' + (ls(EMAIL_KEY) || '') + ':/track/session?id=', pins = r[1];
        var mine = r[0].filter(function (x) { return x.key.indexOf(prefix) === 0 && !pins[decodeURIComponent(x.key.slice(prefix.length))]; }).sort(function (a, b) { return b.value.at - a.value.at; });
        return Promise.all(mine.slice(KEEP_SESSIONS).map(function (x) { return kvDel(x.key); }));
      });
    });
  }
  // What the worker last said to this GET, marked old, or null.
  function recall(path) {
    if (!cacheable(path)) return Promise.resolve(null);
    return kvGet(cacheKey(path)).then(function (r) {
      if (!r || !r.value) return null;
      var d = r.value;
      d.status = 200; d.cachedAt = r.at;
      return d;
    });
  }

  // ---------- Are we offline? ----------
  var offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || window.MT3UK_OFFLINE_HINT === true;
  try { delete window.MT3UK_OFFLINE_HINT; } catch (e) { window.MT3UK_OFFLINE_HINT = undefined; }
  var closed = false, pollTimer = null, syncing = false, lastSync = null;
  function isNetworkError(e) {
    return !!e && (e.offline === true || e instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network/i.test(String(e.message || '')));
  }
  function set(next) {
    if (next === offline) return;
    offline = next;
    closed = false;
    if (offline) startPoll(); else { stopPoll(); setTimeout(sync, 800); }
    drawBar();
    drawHeaderIcon();
    document.dispatchEvent(new CustomEvent(offline ? 'mt3uk-offline-start' : 'mt3uk-offline-end'));
  }
  // A request that never reached the worker. The browser can say it is online with no signal, so this counts.
  function noteNetworkError() { set(true); }
  // Does the worker answer, and quickly? A weak signal can leave a request hanging for a minute or more, which is as
  // good as no signal here, so an answer slower than the limit counts as none.
  function ping() {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, window.MT3UK_OFFLINE_PING_MS || 8000) : null;
    return fetch(API + '/track/copy', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { clearTimeout(timer); return !!r; }, function () { clearTimeout(timer); return false; });
  }
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (navigator.onLine === false) return;
      ping().then(function (ok) { if (ok) set(false); });
    }, window.MT3UK_OFFLINE_POLL_MS || 12000);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  window.addEventListener('offline', function () { set(true); });
  window.addEventListener('online', function () {
    // The browser says it is back: check the worker answers before saying so.
    ping().then(function (ok) { set(!ok); });
  });
  if (offline) startPoll();

  // ---------- The bar ----------
  var barMsg = null, barTimer = null;
  function pendingCount() { return qAll().then(function (l) { return l.length; }); }
  function bar() {
    var el = document.getElementById('lo-bar');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lo-bar'; el.className = 'lo-bar'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lo]');
      if (!b) return;
      if (b.getAttribute('data-lo') === 'close') { closed = true; barMsg = null; drawBar(); }
      else if (b.getAttribute('data-lo') === 'on') setEnabled(true);

    });
    return el;
  }
  function drawBar() {
    if (!document.body) return;
    drawBarNow();
    // Room under the page for the bar, so it never covers the last lines.
    var el = document.getElementById('lo-bar');
    var pad = function () { document.body.style.paddingBottom = el && !el.hidden ? (el.offsetHeight + 24) + 'px' : ''; };
    setTimeout(pad, 60); setTimeout(pad, 400);
  }
  function drawBarNow() {
    var el = bar();
    if (barMsg) {
      el.hidden = false; el.className = 'lo-bar is-' + barMsg.kind;
      el.innerHTML = '<span class="lo-ico">' + icon(barMsg.kind === 'ok' || barMsg.kind === 'info' ? 'check' : 'sync') + '</span><div class="lo-text">' + barMsg.html + '</div><button type="button" class="lo-x" data-lo="close" aria-label="Close">' + icon('x') + '</button>';
      return;
    }
    if (!offline || closed) { el.hidden = true; return; }
    pendingCount().then(function (n) {
      if (barMsg || !offline || closed) return;
      var kept = enabled();
      el.hidden = false; el.className = 'lo-bar is-offline';
      el.innerHTML = '<span class="lo-ico">' + icon('off') + '</span><div class="lo-text"><b>You\'re in offline mode.</b> ' +
        'You can open sessions you have looked at before, with their maps, and add a session from a file already on your device (it is sent when you\'re next online). ' +
        'Sessions saved on this device open here too, with their map and playback. ' +
        'Leaderboards, sharing, sign-in and changes to saved sessions need a connection, and so do satellite pictures you have not seen before.' +
        (circuits().length ? ' The leaderboards and your sessions for ' + esc(circuitNames()) + ' still open.' : '') +
        (n ? ' <b>' + n + ' session' + (n === 1 ? ' is' : 's are') + ' waiting to be sent.</b>' : '') +
        (kept ? '' : ' <button type="button" class="lo-link" data-lo="on">Keep Laps on this device</button> for next time (needs a connection).') +
        (carBrowser() ? ' <b>Car screen:</b> ' + esc(CAR_NOTE) : '') +
        '</div><button type="button" class="lo-x" data-lo="close" aria-label="Close">' + icon('x') + '</button>';
    });
  }
  function say(kind, html, ms) {
    barMsg = { kind: kind, html: html };
    drawBar();
    clearTimeout(barTimer);
    if (ms) barTimer = setTimeout(function () { barMsg = null; drawBar(); }, ms);
  }

  // ---------- The queue ----------
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  // A session saved with no connection: the body of POST /track/sessions, the readings for POST
  // /track/session/source, and the PUT /my-builds/car that makes a car with no photo yet (carPut).
  function queueSession(info) {
    var job = { kind: 'session', at: Date.now(), label: info.label || 'Session', carName: info.carName || '', post: info.post, source: info.source || null, carPut: info.carPut || null, stage: 'new' };
    return qPut(job).then(function (j) { renderPending(); drawBar(); return j; });
  }
  // A call that has no answer the page needs (a request to MT3UK for a track): sent later as it is.
  function queueCall(method, path, body, label) {
    return qPut({ kind: 'call', at: Date.now(), method: method, path: path, body: body, label: label || 'Request to MT3UK', stage: 'new' }).then(function (j) { renderPending(); return j; });
  }
  function post(method, path, body, gzip) {
    var opts = { method: method, headers: {}, cache: 'no-store' };
    if (token()) opts.headers['X-Session-Token'] = token();
    var ready = Promise.resolve();
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
      if (gzip && typeof CompressionStream === 'function') {
        ready = new Response(new Blob([opts.body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer().then(function (gz) { opts.body = gz; }, function () {});
      }
    }
    return ready.then(function () { return fetch(API + path, opts); }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; });
    });
  }
  // Send what is waiting, oldest first. A job the worker refuses (a file already saved, no early access) keeps its
  // reason on the card and is skipped until the member removes it or presses Try again.
  function sync(force) {
    // One tab at a time, so two open pages never send the same session twice.
    if (!navigator.locks) return doSync(force);
    return navigator.locks.request('mt3uk-laps-sync', { ifAvailable: true }, function (lock) { return lock ? doSync(force) : null; });
  }
  function doSync(force) {
    if (syncing || offline || !token()) return Promise.resolve(null);
    syncing = true;
    var done = 0, refused = 0, noReadings = 0, signedOut = false, stopped = false;
    return qAll().then(function (jobs) {
      var todo = jobs.filter(function (j) { return force || !j.error; });
      if (!todo.length) return null;
      say('sync', 'Back online. Sending ' + plural(todo.length, 'saved item', 'saved items') + '...');
      var chain = Promise.resolve();
      todo.forEach(function (job) {
        chain = chain.then(function () {
          if (stopped) return;
          return run(job).then(function (r) {
            if (r === 'done') { done++; return qDel(job.id); }
            if (r === 'noreadings') { done++; noReadings++; return qDel(job.id); }
            if (r === 'signin') { signedOut = true; stopped = true; return; }
            if (r === 'refused') { refused++; return qPut(job); }
          }, function (e) {
            // No connection part way: leave the rest for next time.
            stopped = true;
            if (isNetworkError(e)) set(true);
            return qPut(job);
          });
        });
      });
      return chain;
    }).then(function () {
      syncing = false;
      renderPending();
      if (signedOut) say('warn', '<b>Sign in to send your saved sessions.</b> They are kept on this device until you do.', 0);
      else if (done || refused) {
        var m = done ? '<b>' + plural(done, 'session', 'sessions') + ' sent.</b> ' + (done === 1 ? 'It is' : 'They are') + ' in your list now.' : '';
        if (noReadings) m += ' ' + plural(noReadings, 'session', 'sessions') + ' saved without readings, so some charts need the file added again.';
        if (refused) m += (m ? ' ' : '') + '<b>' + plural(refused, 'item', 'items') + ' could not be sent.</b> See the list under Sessions.';
        say(refused ? 'warn' : 'ok', m, refused ? 0 : 8000);
      } else { barMsg = null; drawBar(); }
      if (done) document.dispatchEvent(new CustomEvent('mt3uk-offline-synced', { detail: { count: done, refused: refused } }));
      lastSync = { done: done, refused: refused };
      return lastSync;
    }, function (e) { syncing = false; barMsg = null; drawBar(); throw e; });
  }
  function refuse(job, d) {
    if (d.status === 401) return 'signin';
    job.error = d.message || (d.status === 403 && d.needsAccess ? 'Laps early access is needed to save sessions.' : 'The server would not take it (' + (d.status || 'error') + ').');
    return 'refused';
  }
  function run(job) {
    job.error = null;
    if (job.kind === 'call') {
      return post(job.method, job.path, job.body, false).then(function (d) { return d.status === 401 ? 'signin' : 'done'; });
    }
    var step = Promise.resolve();
    if (job.stage === 'new') {
      if (job.carPut && !job.carId) {
        step = post('PUT', '/my-builds/car', job.carPut).then(function (d) {
          if (!d.success) return refuse(job, d);
          job.carId = d.car.id; job.post.carId = d.car.id;
          return qPut(job).then(function () { return null; });
        });
      }
      step = step.then(function (bad) {
        if (bad) return bad;
        return post('POST', '/track/sessions', job.post, true).then(function (d) {
          if (!d.success) return refuse(job, d);
          job.sessionId = d.session.id; job.stage = 'saved';
          return qPut(job).then(function () { return null; });
        });
      });
    }
    return step.then(function (bad) {
      if (bad) return bad;
      if (!job.source) return 'done';
      return post('POST', '/track/session/source?id=' + encodeURIComponent(job.sessionId), job.source, true).then(function (d) {
        if (d.status === 401) return 'signin';
        return d.success ? 'done' : 'noreadings';
      });
    });
  }
  // The card at the top of the member's list: what is waiting, with a way to send it and to remove it.
  function renderPending() {
    drawHeaderIcon();
    var box = document.getElementById('lo-pending');
    if (!box) return Promise.resolve();
    return qAll().then(function (jobs) {
      jobs = jobs.filter(function (j) { return j.kind === 'session'; });
      if (!jobs.length) { box.hidden = true; box.innerHTML = ''; return; }
      var bad = jobs.filter(function (j) { return j.error; }).length;
      box.hidden = false;
      box.innerHTML = '<h3>' + plural(jobs.length, 'session', 'sessions') + ' waiting to be sent</h3>' +
        '<p class="lo-small">' + (offline ? 'Kept on this device. They are sent when you are next online with Laps open.' : 'Kept on this device until they are sent.') + '</p>' +
        '<ul class="lo-list">' + jobs.map(function (j) {
          var when = new Date(j.at);
          return '<li' + (j.error ? ' class="is-bad"' : '') + '><div><b>' + esc(j.label) + '</b><span class="lo-when">Saved ' + esc(when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' at ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) + '</span>' +
            (j.error ? '<span class="lo-err">' + esc(j.error) + '</span>' : '') + '</div>' +
            '<div class="lo-row-actions"><a class="btn btn-secondary btn-sm" href="track.html?s=' + (j.sessionId ? esc(j.sessionId) : 'local-' + j.id) + '" data-go="s=' + (j.sessionId ? esc(j.sessionId) : 'local-' + j.id) + '">Open</a><button type="button" class="btn btn-ghost btn-sm" data-lo-remove="' + j.id + '">Remove</button></div></li>';
        }).join('') + '</ul>' +
        (offline ? '' : '<button type="button" class="btn btn-secondary btn-sm" data-lo-send>' + (bad ? 'Try again' : 'Send now') + '</button>');
    });
  }
  // A session saved on this device and not sent yet, as the session page draws it (js/track-page.js, track.html?s=local-<id>):
  // the analysed session the Add page made, with the choices made there. It is the member's own, read only: nothing that
  // needs the worker (rank, sharing, settings) is on it. Resolves null when it has been sent or removed.
  var SKIP_FIELDS = { session: 1, carId: 1, street: 1, adminViewer: 1, venueName: 1 };
  function localSession(id) {
    var n = parseInt(String(id).replace(/^local-/, ''), 10);
    return qAll().then(function (jobs) {
      var job = jobs.filter(function (j) { return j.kind === 'session' && j.id === n && j.post && j.post.session && j.stage === 'new'; })[0];
      if (!job) return null;
      var b = job.post, rec = JSON.parse(JSON.stringify(b.session));
      Object.keys(b).forEach(function (k) { if (!SKIP_FIELDS[k] && b[k] !== '' && b[k] != null && typeof b[k] !== 'object') rec[k] = b[k]; });
      rec.id = 'local-' + job.id; rec.carId = String(b.carId || ''); rec.car = job.carName || '';
      rec.local = true; rec.savedAt = job.at; rec.mine = false; rec.privacy = 'private'; rec.ownerName = '';
      delete rec.notes;
      return rec;
    });
  }
  function drawPending(container) {
    if (!container) return Promise.resolve();
    var box = document.getElementById('lo-pending');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lo-pending'; box.className = 'card lo-pending'; box.hidden = true;
      container.insertBefore(box, container.firstChild);
    } else if (box.parentNode !== container) container.insertBefore(box, container.firstChild);
    return renderPending();
  }
  document.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-lo-remove]');
    if (rm) {
      if (!window.confirm('Remove this session from the queue? It has not been sent, so it will be lost.')) return;
      qDel(parseInt(rm.getAttribute('data-lo-remove'), 10)).then(function () { renderPending(); drawBar(); });
      return;
    }
    if (e.target.closest('[data-lo-send]')) sync(true);
  });

  // ---------- The switch ----------
  function enabled() { return ls(ON_KEY) === '1'; }
  var progress = '', preparing = false;
  function swReady() {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('This browser cannot keep Laps for offline use.'));
    return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; });
  }
  function ask(msg) {
    return swReady().then(function (reg) {
      var worker = reg.active || navigator.serviceWorker.controller;
      return new Promise(function (resolve, reject) {
        if (!worker) { reject(new Error('Laps could not start offline mode. Reload the page and try again.')); return; }
        var ch = new MessageChannel();
        var t = setTimeout(function () { reject(new Error('That took too long. Check your connection and try again.')); }, 60000);
        ch.port1.onmessage = function (ev) { clearTimeout(t); resolve(ev.data || {}); };
        worker.postMessage(msg, [ch.port2]);
      });
    });
  }
  // ---------- Getting ready: what is kept for use with no signal ----------
  function getJson(path) {
    var headers = {};
    if (token()) headers['X-Session-Token'] = token();
    return fetch(API + path, { headers: headers, cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; });
    });
  }
  // The satellite tiles under a session's map: its route's box (and a tile around it) at two zooms, the ones the map
  // opens at, so the map has its picture offline. Other zooms are kept as they are looked at, while Offline mode is on.
  function tilesFor(session, into) {
    var tr = session.trace || {}, o = session.origin || tr.origin, pts = [], i;
    if (!o || o.length !== 2 || !isFinite(o[0]) || !isFinite(o[1])) return;
    var lapKey = tr.laps ? (session.best && tr.laps[session.best] ? session.best : Object.keys(tr.laps)[0]) : null;
    var kx = Math.cos(o[0] * Math.PI / 180) * 111320, ky = 110540;
    if (lapKey != null && tr.laps[lapKey]) for (i = 0; i < tr.laps[lapKey].length; i++) { var r = tr.laps[lapKey][i]; pts.push([o[0] + r[3] / ky, o[1] + r[2] / kx]); }
    else if (tr.outline) for (i = 0; i < tr.outline.length; i++) pts.push([tr.outline[i][0], tr.outline[i][1]]);
    if (!pts.length) pts.push([o[0], o[1]]);
    var la0 = Infinity, la1 = -Infinity, ln0 = Infinity, ln1 = -Infinity;
    pts.forEach(function (p) { la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); ln0 = Math.min(ln0, p[1]); ln1 = Math.max(ln1, p[1]); });
    [16, 17].forEach(function (z) {
      var n = Math.pow(2, z);
      function tx(lng) { return Math.floor((lng + 180) / 360 * n); }
      function ty(lat) { var rad = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n); }
      var xa = tx(ln0) - 1, xb = tx(ln1) + 1, ya = ty(la1) - 1, yb = ty(la0) + 1;
      if ((xb - xa + 1) * (yb - ya + 1) > 150) return;
      for (var x = xa; x <= xb; x++) for (var y = ya; y <= yb; y++) into[SAT_URL + z + '/' + y + '/' + x] = 1;
    });
  }
  // ---------- Circuits kept on the device ----------
  // A member keeps up to MAX_CIRCUITS circuits (a track, a sprint or hill climb, a drag strip). For each, Offline mode keeps
  // every leaderboard (all its layouts, or the strip's board) and the member's own sessions there (up to
  // CIRCUIT_SESSIONS, with their maps), beside the track list and the counts. A board not kept is not on the device.
  // A circuit is added on the confirm card, in Profile, by holding its card on the Leaderboard and letting go (or its cloud
  // button), or by holding its row on Sessions.
  var CIRCUITS_KEY = 'mt3ukLapsOfflineCircuits', MAX_CIRCUITS = 3, CIRCUIT_SESSIONS = 40, BOARD_TOP = 10, BOARD_SESSIONS = 30, CAR_CIRCUIT_SESSIONS = 8, CAR_BOARD_SESSIONS = 10;
  function circuits() {
    var a = null;
    try { a = JSON.parse(ls(CIRCUITS_KEY) || 'null'); } catch (e) { a = null; }
    if (!Array.isArray(a)) {
      // The single circuit an earlier version kept.
      var old = ls('mt3ukLapsOfflineCircuit');
      a = old ? [{ id: old, name: ls('mt3ukLapsOfflineCircuitName') || '' }] : [];
    }
    return a.filter(function (c) { return c && typeof c.id === 'string' && c.id; }).slice(0, MAX_CIRCUITS);
  }
  function saveCircuits(a) {
    ls(CIRCUITS_KEY, a.length ? JSON.stringify(a) : null);
    ls('mt3ukLapsOfflineCircuit', null); ls('mt3ukLapsOfflineCircuitName', null);
  }
  function circuit() { var c = circuits()[0]; return c ? c.id : ''; }
  function isKept(id) { return circuits().some(function (c) { return c.id === id; }); }
  function circuitNames() { return circuits().map(function (c) { return c.name || c.id; }).join(', '); }
  function enc(x) { return encodeURIComponent(x); }
  // A read with the kept copy as the fallback (js/leaderboard-page.js): the answer is kept while Offline mode is on
  // (counts and track list always, boards only for the kept circuits), and with no signal, or when the worker has not
  // answered in time, the kept copy is returned instead (cachedAt says when it was kept). Rejects when there is none.
  function read(path) {
    function fresh() {
      return getJson(path).then(function (d) {
        var keep = enabled() && (!boardPath(path) || isKept(venueOf(path)));
        if (keep) remember(path, d);
        return d;
      });
    }
    if (!cacheable(path)) return fresh();
    return recall(path).then(function (copy) {
      var p = fresh();
      if (copy && !offline) p = Promise.race([p, new Promise(function (resolve, reject) { setTimeout(function () { reject(new Error('slow')); }, window.MT3UK_READ_TIMEOUT_MS || 15000); })]);
      if (copy && offline) return copy;
      return p.then(null, function (err) {
        if (isNetworkError(err) || (err && err.message === 'slow')) noteNetworkError(err);
        if (copy) return copy;
        throw err;
      });
    });
  }
  // Every circuit, sprint and drag strip Laps lists (the track list file with the worker's additions), for the choice.
  function venueList() {
    return Promise.all([
      fetch('data/tracks.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { venues: [] }; }),
      read('/track/tracks').catch(function () { return {}; })
    ]).then(function (r) {
      var by = {}, out = [];
      var extra = r[1] && r[1].extra;
      (((r[0] && r[0].venues) || []).concat(Array.isArray(extra) ? extra : (extra && extra.venues) || [])).forEach(function (v) {
        if (!v || !v.id) return;
        var ex = by[v.id];
        if (!ex) { ex = by[v.id] = { id: v.id, name: v.name || v.id, type: v.type, layouts: [] }; out.push(ex); }
        (v.layouts || []).forEach(function (l) { if (l && l.id && !ex.layouts.some(function (x) { return x.id === l.id; })) ex.layouts.push({ id: l.id, name: l.name || l.id }); });
      });
      out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      return out;
    });
  }
  function boardPaths(v) {
    if (v.type === 'drag') return ['/drag/board?venue=' + enc(v.id)];
    return (v.layouts || []).slice(0, 40).map(function (l) { return (v.type === 'sprint' ? '/sprint/board?venue=' : '/track/board?venue=') + enc(v.id) + '&layout=' + enc(l.id); });
  }
  // Fetches and keeps one circuit's boards and the counts. Never throws; resolves { n, ids }: how many boards were kept and
  // the sessions their top BOARD_TOP rows open (the best session of each car), up to BOARD_SESSIONS in all, so a row opened
  // offline has its session on the device too.
  function keepBoards(id) {
    var none = { n: 0, ids: [] };
    if (!id || offline) return Promise.resolve(none);
    return venueList().then(function (list) {
      var v = list.filter(function (x) { return x.id === id; })[0];
      if (!v) return none;
      var paths = boardPaths(v), at = 0, n = 0, ids = [];
      function next() {
        if (at >= paths.length) return Promise.resolve();
        var p = paths[at++];
        return getJson(p).then(function (d) {
          if (!d || d.success === false || d.status >= 400) return;
          remember(p, d); n++;
          var drag = /^\/drag\//.test(p);
          (d.entries || []).filter(function (e) { return e && e.sessionId; })
            .sort(function (a, b) { return drag ? (a.quarter || 1e9) - (b.quarter || 1e9) : (a.time || 1e9) - (b.time || 1e9); })
            .slice(0, BOARD_TOP).forEach(function (e) { if (ids.indexOf(e.sessionId) === -1) ids.push(e.sessionId); });
        }).catch(function () {}).then(next);
      }
      var counts = getJson('/track/counts').then(function (d) { remember('/track/counts', d); }).catch(function () {});
      return Promise.all([next(), next(), next(), counts]).then(function () { return { n: n, ids: ids.slice(0, carBrowser() ? CAR_BOARD_SESSIONS : BOARD_SESSIONS) }; });
    }, function () { return none; });
  }
  // The member's own sessions at a circuit (their newest CIRCUIT_SESSIONS). Resolves their ids.
  function ownSessionIds(id) {
    if (!id || offline || !token()) return Promise.resolve([]);
    return getJson('/track/sessions').then(function (d) {
      if (!d || !d.sessions) return [];
      remember('/track/sessions', d);
      return d.sessions.filter(function (x) { return x.venueId === id; })
        .sort(function (a, b) { return String(b.date + (b.time || '')) < String(a.date + (a.time || '')) ? -1 : 1; })
        .slice(0, carBrowser() ? CAR_CIRCUIT_SESSIONS : CIRCUIT_SESSIONS).map(function (x) { return x.id; });
    }).catch(function () { return []; });
  }
  // The sessions kept for each circuit are pinned: one KV key per circuit, so trimming (remember) leaves them alone and
  // taking the circuit off lets them go back to the ordinary pool.
  function pinKey(id) { return 'pins:' + (ls(EMAIL_KEY) || '') + ':' + id; }
  function pinSessions(id, ids) { return kvSet(pinKey(id), { at: Date.now(), ids: ids }); }
  function unpinSessions(id) { return kvDel(pinKey(id)); }
  function pinnedIds() {
    var prefix = 'pins:' + (ls(EMAIL_KEY) || '') + ':';
    return kvAll().then(function (all) {
      var out = {};
      all.forEach(function (x) { if (String(x.key).indexOf(prefix) === 0 && x.value && x.value.ids) x.value.ids.forEach(function (i) { out[i] = 1; }); });
      return out;
    });
  }
  // One circuit: its boards, then the sessions behind them and your own there, with their maps.
  function keepCircuit(id, report) {
    return Promise.all([keepBoards(id), ownSessionIds(id)]).then(function (r) {
      var boards = r[0], ids = r[1].slice();
      boards.ids.forEach(function (i) { if (ids.indexOf(i) === -1) ids.push(i); });
      var out = { sessions: 0, tiles: 0, boards: boards.n };
      return keepSessionIds(ids, out, report || function () {}).then(function () { return pinSessions(id, ids); }).then(function () { return out; });
    });
  }
  // Every kept circuit, one after another. Resolves with the totals.
  function keepAllCircuits(report) {
    var total = { boards: 0, sessions: 0 }, list = circuits(), chain = Promise.resolve();
    list.forEach(function (c) {
      chain = chain.then(function () {
        report('Keeping ' + (c.name || c.id) + '...');
        return keepCircuit(c.id, report).then(function (o) { total.boards += o.boards || 0; total.sessions += o.sessions || 0; });
      });
    });
    return chain.then(function () { return total; });
  }
  // Takes the boards of a circuit off the device (its sessions stay with the others, oldest out as usual).
  function dropBoards(venue) {
    if (!venue) return Promise.resolve();
    return kvAll().then(function (all) {
      return Promise.all(all.filter(function (x) {
        var path = String(x.key).replace(/^get:[^:]*:/, '');
        return boardPath(path) && venueOf(path) === venue;
      }).map(function (x) { return kvDel(x.key); }));
    });
  }
  // Adds a circuit. Resolves { ok, full, already }. Keeps it at once when Offline mode is on and there is a signal; otherwise
  // it is kept when Offline mode goes on, is refreshed, or the device is next online.
  function addCircuit(id, name) {
    var list = circuits();
    if (!id) return Promise.resolve({ ok: false });
    if (list.some(function (c) { return c.id === id; })) return Promise.resolve({ ok: true, already: true });
    if (list.length >= MAX_CIRCUITS) return Promise.resolve({ ok: false, full: true });
    list.push({ id: id, name: name || '' });
    saveCircuits(list);
    labels();
    if (!enabled() || offline) return Promise.resolve({ ok: true, kept: false });
    return keepCircuit(id).then(function (o) { labels(); return { ok: true, kept: true, boards: o.boards, sessions: o.sessions }; });
  }
  function removeCircuit(id) {
    saveCircuits(circuits().filter(function (c) { return c.id !== id; }));
    labels();
    return Promise.all([dropBoards(id), unpinSessions(id)]).then(function () { labels(); return { ok: true }; });
  }
  // Fills a "add a circuit" drop-down (the confirm card's and Profile's).
  function fillCircuitSelect(sel, placeholder) {
    if (!sel || sel.getAttribute('data-filled')) return;
    sel.setAttribute('data-filled', '1');
    venueList().then(function (list) {
      var groups = [['circuit', 'Circuits'], ['sprint', 'Sprints and hill climbs'], ['drag', 'Drag strips']];
      sel.innerHTML = '<option value="">' + esc(placeholder || 'None') + '</option>' + groups.map(function (g) {
        var vs = list.filter(function (v) { return v.type === g[0]; });
        return vs.length ? '<optgroup label="' + g[1] + '">' + vs.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>'; }).join('') + '</optgroup>' : '';
      }).join('');
    });
  }
  // The kept circuits as a list with Remove, wherever a [data-offline-circuits] list is.
  function drawCircuitList() {
    var list = circuits();
    [].slice.call(document.querySelectorAll('[data-offline-circuit]')).forEach(function (sel) { sel.disabled = list.length >= MAX_CIRCUITS; });
    [].slice.call(document.querySelectorAll('[data-offline-circuit-count]')).forEach(function (el) { el.textContent = list.length + ' of ' + MAX_CIRCUITS + ' kept'; });
    [].slice.call(document.querySelectorAll('[data-circuit-refresh]')).forEach(function (b) { b.hidden = !list.length; });
    var uls = [].slice.call(document.querySelectorAll('[data-offline-circuits]'));
    if (!uls.length) return Promise.resolve();
    // How many sessions each circuit holds on this device is the pinned list for it.
    return kvAll().then(function (all) {
      var prefix = 'pins:' + (ls(EMAIL_KEY) || '') + ':', counts = {};
      all.forEach(function (x) { if (String(x.key).indexOf(prefix) === 0 && x.value && x.value.ids) counts[String(x.key).slice(prefix.length)] = x.value.ids.length; });
      return counts;
    }, function () { return {}; }).then(function (counts) {
      uls.forEach(function (ul) {
        ul.innerHTML = list.map(function (c) {
          var n = counts[c.id];
          var kept = typeof n === 'number' ? ' <small class="lo-kept-count">' + n + (n === 1 ? ' session' : ' sessions') + ' kept</small>' : '';
          return '<li><span>' + esc(c.name || c.id) + kept + '</span><button type="button" class="btn btn-ghost btn-sm" data-circuit-remove="' + esc(c.id) + '" aria-label="Take ' + esc(c.name || c.id) + ' off this device">Remove</button></li>';
        }).join('');
        ul.hidden = !list.length;
      });
    });
  }
  // Profile's Refresh kept circuits: keep every kept circuit's boards and sessions again, so new top times come in.
  function refreshCircuits() {
    var out = document.querySelector('[data-offline-status]');
    function note(t) { if (out) out.textContent = t; }
    if (!enabled()) { note('Turn Offline mode on first.'); return Promise.resolve(false); }
    if (offline) { note('You need a signal to refresh your kept circuits.'); return Promise.resolve(false); }
    note('Refreshing your kept circuits...');
    return keepAllCircuits(function (t) { note(t); }).then(function (t) {
      note('Refreshed: ' + t.boards + (t.boards === 1 ? ' board' : ' boards') + ' and ' + t.sessions + (t.sessions === 1 ? ' session' : ' sessions') + ' kept.');
      return drawCircuitList().then(function () { return true; });
    }, function () { note('Your kept circuits could not be refreshed. Try again with a better signal.'); return false; });
  }

  // ---------- Holding a circuit to keep it ----------
  // A circuit's card (Leaderboard) or row (Sessions) carries data-keep-venue and data-keep-name. On the Leaderboard the
  // card's own hold-then-drag moves it (js/leaderboard-page.js), and letting go without moving calls holdKeep; a cloud
  // button (data-keep-toggle) does the same by tap. On Sessions a row with data-keep-hold is kept by holding it here.
  var HOLD_KEEP_MS = 550, keepHold = null, keepSuppress = false;
  function holdKeep(id, name) {
    if (!id || !allowed()) return Promise.resolve();
    name = name || id;
    if (isKept(id)) {
      if (!window.confirm('Take ' + name + ' off this device? Its leaderboards and your sessions there will not open with no signal.')) return Promise.resolve();
      return removeCircuit(id).then(function () { say('info', '<b>' + esc(name) + '</b> is no longer kept offline.', 5000); markKept(); });
    }
    if (circuits().length >= MAX_CIRCUITS) {
      say('warn', '<b>' + MAX_CIRCUITS + ' circuits are already kept</b> (' + esc(circuitNames()) + '). Take one off first: hold it again, or use Profile.', 8000);
      return Promise.resolve();
    }
    if (!enabled()) {
      // Offline mode is off: keep the choice, then ask to turn it on (the confirm card lists what is kept).
      return addCircuit(id, name).then(function () { markKept(); return setEnabled(true); });
    }
    if (offline) { return addCircuit(id, name).then(function () { markKept(); say('info', '<b>' + esc(name) + ' will be kept</b> when you are next online.', 6000); }); }
    say('sync', '<b>Keeping ' + esc(name) + ' for offline use...</b>');
    return addCircuit(id, name).then(function (r) {
      markKept();
      say('ok', '<b>' + esc(name) + ' is kept on this device.</b> ' + (r.boards ? plural(r.boards, 'leaderboard', 'leaderboards') : 'Its leaderboards') + (r.sessions ? ' and ' + plural(r.sessions, 'of your sessions', 'of your sessions') : '') + ' open with no signal.', 8000);
    });
  }
  // Shows which circuits are kept on every card, row and button that names one, and the hint where there is one.
  function markKept() {
    var ok = allowed();
    [].slice.call(document.querySelectorAll('[data-keep-venue]')).forEach(function (el) {
      var kept = ok && isKept(el.getAttribute('data-keep-venue'));
      if (el.classList.contains('is-kept') !== kept) el.classList.toggle('is-kept', kept);
      var btn = el.querySelector('[data-keep-toggle]');
      if (btn) {
        if (btn.hidden === ok) btn.hidden = !ok;
        var pressed = kept ? 'true' : 'false';
        if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
        var lbl = (kept ? 'Take ' : 'Keep ') + (el.getAttribute('data-keep-name') || 'this circuit') + (kept ? ' off this device' : ' for offline use');
        if (btn.getAttribute('aria-label') !== lbl) { btn.setAttribute('aria-label', lbl); btn.title = lbl; }
      }
    });
    [].slice.call(document.querySelectorAll('[data-keep-hint]')).forEach(function (el) { if (el.hidden === ok) el.hidden = !ok; });
  }
  function cancelKeepHold() {
    if (!keepHold) return;
    clearTimeout(keepHold.timer);
    keepHold.el.classList.remove('is-keeping');
    keepHold = null;
  }
  document.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    var el = e.target.closest && e.target.closest('[data-keep-hold]');
    if (!el || !allowed()) return;
    cancelKeepHold();
    el.classList.add('is-keeping');
    keepHold = {
      el: el, x: e.clientX, y: e.clientY,
      timer: setTimeout(function () {
        var held = keepHold && keepHold.el;
        cancelKeepHold();
        if (!held) return;
        // The tap that ends this hold must not open the row.
        keepSuppress = true; setTimeout(function () { keepSuppress = false; }, 700);
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (er) { /* no vibration */ } }
        holdKeep(held.getAttribute('data-keep-venue'), held.getAttribute('data-keep-name'));
      }, HOLD_KEEP_MS)
    };
  });
  document.addEventListener('pointermove', function (e) { if (keepHold && (Math.abs(e.clientX - keepHold.x) > 10 || Math.abs(e.clientY - keepHold.y) > 10)) cancelKeepHold(); });
  ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, cancelKeepHold); });
  document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('[data-keep-hold]') && allowed()) e.preventDefault(); });
  document.addEventListener('click', function (e) {
    if (keepSuppress && e.target.closest && e.target.closest('[data-keep-hold]')) { keepSuppress = false; e.preventDefault(); e.stopPropagation(); return; }
    var b = e.target.closest && e.target.closest('[data-keep-toggle]');
    if (b) {
      e.preventDefault(); e.stopPropagation();
      var host = b.closest('[data-keep-venue]');
      if (host) holdKeep(host.getAttribute('data-keep-venue'), host.getAttribute('data-keep-name'));
    }
  }, true);
  var markTimer = null, markObserver = null;
  function markSoon() { clearTimeout(markTimer); markTimer = setTimeout(markKept, 80); }
  function watchMarks() {
    if (!window.MutationObserver || !document.body) return;
    markObserver = new MutationObserver(markSoon);
    markObserver.observe(document.body, { childList: true, subtree: true });
    markKept();
  }

  // Fetches and keeps what the pages need offline: the member's cars, session list and settings, their latest
  // sessions (with the map pictures under them). report(text) says how far it is. Never throws: what could not be
  // kept is counted.
  function prepare(report) {
    var out = { sessions: 0, wanted: 0, tiles: 0 };
    var reads = ['/my-builds', '/track/sessions', '/track/tracks', '/track/copy', '/track/access'];
    var ids = [];
    report('Keeping your cars and sessions...');
    return Promise.all(reads.map(function (path) {
      return getJson(path).then(function (d) {
        remember(path, d);
        if (path === '/track/sessions' && d.sessions) {
          ids = d.sessions.slice().sort(function (a, b) { return String(b.date + (b.time || '')) < String(a.date + (a.time || '')) ? -1 : 1; }).slice(0, prepareSessions()).map(function (x) { return x.id; });
        }
      }).catch(function () {});
    })).then(function () {
      out.wanted = ids.length;
      return keepSessionIds(ids, out, report);
    });
  }
  // Fetches and keeps these sessions (three at a time) and the satellite tiles under their routes. out.sessions and out.tiles
  // are counted; never throws.
  var TILE_CHUNK = 60;
  // How many map pictures one run may keep: a car's browser (Tesla) or a low-memory device keeps fewer.
  function tileBudget() {
    if (window.MT3UK_TILE_BUDGET != null) return window.MT3UK_TILE_BUDGET;
    return carBrowser() ? 120 : 400;
  }
  function keepSessionIds(ids, out, report) {
    var tiles = {}, at = 0;
    function next() {
      if (at >= ids.length) return Promise.resolve();
      var id = ids[at++], path = '/track/session?id=' + encodeURIComponent(id);
      return getJson(path).then(function (d) {
        if (d && d.success && d.session) { remember(path, d); out.sessions = (out.sessions || 0) + 1; tilesFor(d.session, tiles); }
        report('Keeping your sessions (' + (out.sessions || 0) + ' of ' + ids.length + ')...');
      }).catch(function () {}).then(next);
    }
    return Promise.all([next(), next(), next()]).then(function () { return keepTiles(Object.keys(tiles), out, report); });
  }
  // The pictures are the heaviest step: a car's browser (Tesla) has little memory and closed on 1,500 at once. So the
  // closer zoom first, a budget per run (smaller on a car screen or a low-memory device), and a few dozen at a time.
  function keepTiles(all, out, report) {
    var urls = all.filter(function (u) { return /\/tile\/16\//.test(u); }).concat(all.filter(function (u) { return !/\/tile\/16\//.test(u); })).slice(0, tileBudget());
    if (!urls.length) return Promise.resolve(out);
    var chunks = [], i;
    for (i = 0; i < urls.length; i += TILE_CHUNK) chunks.push(urls.slice(i, i + TILE_CHUNK));
    var started = Date.now(), limit = window.MT3UK_TILE_WAIT_MS || 60000, stop = false, ci = 0;
    function nextChunk() {
      if (stop || ci >= chunks.length) return Promise.resolve(out);
      var chunk = chunks[ci++];
      report('Keeping the maps (' + Math.min(urls.length, (ci - 1) * TILE_CHUNK + chunk.length) + ' of ' + urls.length + ' pictures)...');
      // The maps are a bonus: never wait on them for ever, and stop asking for more once time is up.
      var left = Math.max(1000, limit - (Date.now() - started));
      var wait = new Promise(function (resolve) { setTimeout(function () { stop = true; resolve({}); }, left); });
      return Promise.race([ask({ type: 'laps-offline-tiles', urls: chunk }), wait]).then(function (r) { out.tiles = (out.tiles || 0) + (r.kept || 0); }, function () { stop = true; }).then(nextChunk);
    }
    return nextChunk();
  }
  // The copy, then what the pages need. report is shown as the progress.
  function keepCopy(report) {
    return ask({ type: 'laps-offline-on' }).then(function (r) {
      if (!r.ok) throw new Error('Laps could not be kept on this device.');
      ls(KEPT_KEY, String(r.kept)); ls('mt3ukLapsOfflineAt', String(Date.now()));
      return prepare(report).then(function (out) {
        if (!circuits().length) return out;
        return keepAllCircuits(report).then(function (t) { out.boards = t.boards; out.circuitSessions = t.sessions; return out; });
      });
    });
  }
  // Refresh with a signal and Offline mode on: send what is waiting, then keep the pages, cars and latest sessions again.
  // Never throws; resolves true when the copy was refreshed.
  function refreshCopy() {
    if (!enabled() || offline) return Promise.resolve(false);
    return Promise.resolve(token() ? sync() : null).catch(function () {}).then(function () {
      return keepCopy(function () {});
    }).then(function () { labels(); return true; }, function () { return false; });
  }
  function labels() {
    drawHeaderIcon();
    var on = enabled();
    // Profile's Offline mode card is for Laps (js/laps-shared.js marks the page); on mt3uk.com it stays hidden.
    var card = document.getElementById('offline-mode');
    if (card) card.hidden = !(allowed() && document.documentElement.classList.contains('laps-shared'));
    [].slice.call(document.querySelectorAll('[data-offline-car]')).forEach(function (el) { el.hidden = !carBrowser(); if (carBrowser() && !el.textContent) el.textContent = 'Car screen: ' + CAR_NOTE; });
    [].slice.call(document.querySelectorAll('[data-offline-toggle]')).forEach(function (el) {
      el.hidden = !allowed();
      if (el.getAttribute('role') === 'switch') { el.setAttribute('aria-checked', on ? 'true' : 'false'); }
      else el.textContent = 'Offline mode: ' + (preparing ? 'getting ready...' : on ? 'on' : 'off');
      el.disabled = false;
    });
    drawCircuitList();
    [].slice.call(document.querySelectorAll('[data-offline-circuit]')).forEach(function (sel) {
      fillCircuitSelect(sel, 'Add a circuit...');
    });
    [].slice.call(document.querySelectorAll('[data-offline-status]')).forEach(function (el) {
      var kept = ls(KEPT_KEY);
      el.textContent = progress || (on ? (kept ? 'Laps is kept on this device (' + kept + ' files). It opens with no signal.' : 'Laps is kept on this device.') + (circuits().length ? ' Kept circuits: ' + circuitNames() + '.' : '') : 'Off. Laps needs a connection to open.');
    });
  }
  // The question before it goes on: what is kept and what it needs. Resolves true or false.
  function confirmOn() {
    return new Promise(function (resolve) {
      var old = document.getElementById('lo-confirm');
      if (old) old.remove();
      var el = document.createElement('div');
      el.id = 'lo-confirm'; el.className = 'lo-offer lo-confirm card'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Turn on offline mode');
      el.innerHTML = '<h3>Keep Laps on this device?</h3><p>Pick the track you are going to. Every leaderboard for it is kept on this device, with your own sessions there and the top sessions on its boards, and their maps, so you can look at them with no signal.</p>' +
        '<label class="lo-field"><span>Track to keep for offline use</span><select class="field" id="lo-circuit"><option value="">None yet</option></select></label>' +
        '<p class="lo-small">You can keep up to ' + MAX_CIRCUITS + ' circuits. Hold a circuit on the Leaderboard or Sessions pages, or use Profile, to change them any time, and press Refresh kept circuits in Profile before a trip.</p>' +
        '<p>This needs a connection now, and takes a minute or so. It also keeps:</p>' +
        '<ul class="lo-ticks"><li>' + icon('check') + 'the Laps pages and the track list</li><li>' + icon('check') + 'your cars and your latest ' + prepareSessions() + ' sessions</li>' +
        '<li>' + icon('check') + 'any session you open while you have a signal, with its map' + (carBrowser() ? ' (a car screen has little memory, so fewer pictures are fetched ahead)' : '') + '</li></ul>' +
        carNoteHtml() +
        '<p class="lo-small">Sessions waiting to be sent go first. With no signal you can open these sessions and maps, and add a session from a file already on your device: it is sent when you are next online. Whether you have the file offline depends on your logger (RaceBox, for example, only lets you download it once you are online). Other leaderboards, sharing and sign-in still need a connection.</p>' +
        '<div class="lo-actions"><button type="button" class="btn btn-accent btn-sm" data-lo-confirm="yes">Turn on offline mode</button><button type="button" class="btn btn-ghost btn-sm" data-lo-confirm="no">Cancel</button></div>';
      document.body.appendChild(el);
      var b = el.querySelector('[data-lo-confirm="yes"]');
      if (b) b.focus();
      var pick = el.querySelector('#lo-circuit');
      fillCircuitSelect(pick, 'None yet');
      el.addEventListener('click', function (e) {
        var c = e.target.closest('[data-lo-confirm]');
        if (!c) return;
        if (c.getAttribute('data-lo-confirm') === 'yes' && pick && pick.value) {
          var opt = pick.options[pick.selectedIndex];
          // Only the choice is stored here: Offline mode goes on next and keeps everything, circuits included.
          var cur = circuits();
          if (!cur.some(function (x) { return x.id === pick.value; }) && cur.length < MAX_CIRCUITS) { cur.push({ id: pick.value, name: opt.text }); saveCircuits(cur); }
        }
        el.remove();
        resolve(c.getAttribute('data-lo-confirm') === 'yes');
      });
    });
  }
  // on: true asks first (unless confirmed is true: the one-time offer is already the question).
  function setEnabled(on, confirmed) {
    if (!on) {
      // With no signal the copy cannot be fetched again, so Laps could not open next time: ask first.
      if (offline && !window.confirm('You have no signal. If you turn Offline mode off now, Laps cannot open again until you are back online. Turn it off?')) return Promise.resolve();
      ls(ON_KEY, null); ls(KEPT_KEY, null); ls('mt3ukLapsOfflineAt', null);
      progress = ''; preparing = false;
      labels(); drawBar();
      return ask({ type: 'laps-offline-off' }).catch(function () {}).then(function () { document.dispatchEvent(new CustomEvent('mt3uk-offline-change')); });
    }
    if (offline) { progress = 'You need a connection to switch it on, so Laps can download its pages.'; labels(); say('warn', '<b>You need a connection to turn offline mode on,</b> so Laps can download what it needs. Try again when you are online.', 8000); return Promise.resolve(); }
    if (!confirmed) return confirmOn().then(function (yes) { if (yes) return setEnabled(true, true); labels(); });
    preparing = true; progress = 'Getting ready...';
    ls(ON_KEY, '1');
    labels();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* not offered */ }
    function report(text) { progress = text; labels(); say('sync', '<b>Getting Laps ready for offline use.</b> ' + esc(text)); }
    report('Sending anything waiting...');
    // What is waiting goes first, so the list kept afterwards includes it.
    return Promise.resolve(token() ? sync() : null).catch(function () {}).then(function () {
      report('Keeping a copy of Laps on this device...');
      return keepCopy(report);
    }).then(function (r) {
      preparing = false; progress = '';
      labels();
      say('ok', '<b>Offline mode is on.</b> Laps is kept on this device' + (r && r.sessions ? ', with ' + plural(r.sessions, 'session', 'sessions') + (r.tiles ? ' and their maps' : '') : '') + '. ' + (r && r.boards ? ' ' + esc(circuitNames()) + ' is kept too, with its leaderboards' + (r.circuitSessions ? ' and ' + plural(r.circuitSessions, 'of your sessions', 'of your sessions') : '') + '.' : '') + (r && r.wanted && r.sessions < r.wanted ? plural(r.wanted - r.sessions, 'session', 'sessions') + ' could not be kept; open ' + (r.wanted - r.sessions === 1 ? 'it' : 'them') + ' while online to keep ' + (r.wanted - r.sessions === 1 ? 'it' : 'them') + '. ' : '') + 'It opens with no signal.', 12000);
      document.dispatchEvent(new CustomEvent('mt3uk-offline-change'));
    }, function (e) {
      ls(ON_KEY, null); ls(KEPT_KEY, null);
      preparing = false;
      progress = e.message || 'Laps could not be kept on this device.';
      labels();
      say('warn', '<b>Offline mode did not go on.</b> ' + esc(progress) + ' Check your connection and try again.', 0);
    });
  }
  // Profile: add a circuit from the drop-down, take one off with Remove.
  document.addEventListener('change', function (e) {
    var sel = e.target.closest && e.target.closest('[data-offline-circuit]');
    if (!sel || !sel.value) return;
    var val = sel.value, name = sel.options[sel.selectedIndex].text;
    sel.value = '';
    holdKeep(val, name).then(function () { labels(); });
  });
  document.addEventListener('click', function (e) {
    var rf = e.target.closest && e.target.closest('[data-circuit-refresh]');
    if (!rf) return;
    rf.disabled = true;
    refreshCircuits().then(function () { rf.disabled = false; });
  });
  document.addEventListener('click', function (e) {
    var rm = e.target.closest && e.target.closest('[data-circuit-remove]');
    if (!rm) return;
    var id = rm.getAttribute('data-circuit-remove'), c = circuits().filter(function (x) { return x.id === id; })[0];
    removeCircuit(id).then(function () { say('info', '<b>' + esc((c && c.name) || id) + '</b> is no longer kept offline.', 5000); markKept(); });
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-offline-toggle]');
    if (!t) return;
    e.preventDefault();
    t.disabled = true;
    setEnabled(!enabled());
  });

  // ---------- The icon in the header ----------
  // A button beside the bell on the Laps header (for the admin only for now) that turns Offline mode on and off. Muted while it is off, green while
  // it is on, orange while the device actually has no signal (with a green dot if it is on); a small number says how
  // many sessions wait to be sent. With a signal a press switches it (on asks first, off is at once); with no signal it
  // cannot be switched on, and switching it off would lose the copy, so a press shows what works instead.
  var iconCount = 0;
  function drawHeaderIcon() {
    var head = document.querySelector('header .laps-logo');
    var anchor = document.getElementById('nav-bell');
    var el = document.getElementById('nav-offline');
    // Held back while Offline mode is tried out, like the offer card (see allowed()).
    if (!head || !anchor || !allowed()) { if (el) el.hidden = true; return; }
    var on = enabled();
    if (!el) {
      el = document.createElement('button');
      el.type = 'button'; el.id = 'nav-offline'; el.className = 'nav-chat nav-offline'; el.setAttribute('role', 'switch');
      el.innerHTML = '<svg viewBox="0.5 1 28 22.5" aria-hidden="true">' + ICON.cloud + '</svg><span class="nav-chat-count" id="nav-offline-count" hidden></span>';
      el.addEventListener('click', pressIcon);
      anchor.parentNode.insertBefore(el, anchor);
    }
    el.hidden = false;
    el.classList.toggle('is-on', on);
    el.classList.toggle('is-offline', offline);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
    el.disabled = preparing;
    var label = 'Offline mode: ' + (preparing ? 'getting ready' : on ? 'on' : 'off') + (offline ? '. You have no signal' : '');
    el.setAttribute('aria-label', label);
    el.title = label + (offline ? '. Tap for details' : on ? '. Tap to turn off' : '. Tap to turn on');
    qAll().then(function (jobs) {
      iconCount = jobs.length;
      var c = document.getElementById('nav-offline-count');
      if (c) { c.hidden = !iconCount; c.textContent = iconCount > 9 ? '9+' : String(iconCount); }
    });
  }
  function pressIcon() {
    if (offline) { barMsg = null; closed = false; drawBar(); return; }
    if (enabled()) {
      setEnabled(false);
      say('info', '<b>Offline mode is off.</b> The copy of Laps kept on this device has been removed.', 6000);
    } else setEnabled(true);
  }

  // ---------- The offer, once ----------
  function adminViewer() {
    try {
      var v = JSON.parse(localStorage.getItem('mt3ukAdminViewer') || 'null');
      return !!(v && v.token && v.expires > Date.now());
    } catch (e) { return false; }
  }
  // Who is offered Offline mode while it is tried out: the admin's browser, a member the admin approved (or everyone once
  // Open to all members is on, Access group of track-admin.html), and anyone who already switched it on. The worker's
  // answer is kept for the member, so it still holds with no signal.
  var ACCESS_KEY = 'mt3ukLapsOfflineAccess';
  function allowed() {
    // Signed in, the list decides, the admin's own account included, so adding and taking away can be tested on it.
    // Until the page has an answer for this member, a device that already has Offline mode on keeps it (it may be
    // opening with no signal). The admin viewer token only counts when nobody is signed in on this browser.
    if (token()) {
      var seen = ls(ACCESS_KEY), mine = (ls(EMAIL_KEY) || '').toLowerCase();
      if (!seen || seen.slice(0, seen.lastIndexOf('|')) !== mine) return enabled();
      return seen === mine + '|1';
    }
    if (enabled()) return true;
    return adminViewer();
  }
  // Access taken away: Offline mode goes off, the kept copy, circuits and maps are removed. Anything waiting to be
  // sent stays in the queue, so no session is lost.
  function revokeAccess() {
    ls(ON_KEY, null); ls(KEPT_KEY, null); ls('mt3ukLapsOfflineAt', null);
    ls(CIRCUITS_KEY, null); ls('mt3ukLapsOfflineCircuit', null); ls('mt3ukLapsOfflineCircuitName', null);
    progress = ''; preparing = false;
    labels(); drawBar();
    return Promise.all([ask({ type: 'laps-offline-off' }).catch(function () {}), kvAll().then(function (all) {
      var who = ':' + (ls(EMAIL_KEY) || '') + ':';
      return Promise.all(all.filter(function (x) { var k = String(x.key); return (k.indexOf('get' + who) === 0 || k.indexOf('pins' + who) === 0); }).map(function (x) { return kvDel(x.key); }));
    }).catch(function () {})]).then(function () {
      labels(); drawBar(); markKept();
      document.dispatchEvent(new CustomEvent('mt3uk-offline-change'));
    });
  }
  function checkAccess() {
    if (!token() || offline) return Promise.resolve();
    return getJson('/laps/offline/access').then(function (d) {
      if (d.status === 401) ls(ACCESS_KEY, null);
      else if (d.success) {
        ls(ACCESS_KEY, (ls(EMAIL_KEY) || '').toLowerCase() + '|' + (d.access ? '1' : '0'));
        if (!d.access && enabled()) return revokeAccess();
      }
      labels();
    }, function () { /* keep the last answer */ });
  }
  function offer() {
    // An automated browser (the site's tests) is not asked unless a test sets the delay itself: the card sits over the
    // bottom of the page and would block clicks in tests that know nothing about it.
    if (navigator.webdriver && window.MT3UK_OFFLINE_ASK_DELAY == null) return;
    // Held back while Offline mode is tried out: only the admin's browser and members the admin approved are offered it.
    if (!allowed()) return;
    if (!/(^|\/)(track|leaderboards|laps)\.html$/.test(location.pathname)) return;
    if (enabled() || ls(ASKED_KEY) || !token() || offline || !('serviceWorker' in navigator)) return;
    if (document.getElementById('lo-offer')) return;
    ls(ASKED_KEY, '1');
    var el = document.createElement('div');
    el.id = 'lo-offer'; el.className = 'lo-offer card'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Offline mode');
    el.innerHTML = '<h3>Use Laps without a signal?</h3><p>Pick the track you are going to and Offline mode keeps its leaderboards, your sessions there and their maps on this device (a few megabytes), so you can look at them at the track with no signal. You can also add a session from a file already on your device, and it is sent when you\'re back online.</p>' +
      '<label class="lo-field"><span>Track to keep for offline use</span><select class="field" id="lo-offer-circuit"><option value="">None yet</option></select></label>' +
      '<p class="lo-small">Adding a session offline depends on your logger. Some, such as RaceBox, only let you download the file once you are online.</p>' +
      carNoteHtml() +
      '<div class="lo-actions"><button type="button" class="btn btn-accent btn-sm" data-lo-offer="on">Turn on offline mode</button><button type="button" class="btn btn-ghost btn-sm" data-lo-offer="no">Not now</button></div>' +
      '<p class="lo-small">You can change this any time at the bottom of the page, or in Profile.</p>';
    document.body.appendChild(el);
    var offerPick = el.querySelector('#lo-offer-circuit');
    fillCircuitSelect(offerPick, 'None yet');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lo-offer]');
      if (!b) return;
      var turnOn = b.getAttribute('data-lo-offer') === 'on';
      if (turnOn && offerPick && offerPick.value) {
        // Only the choice is stored here: Offline mode goes on next and keeps everything, the circuit included.
        var cur = circuits();
        if (!cur.some(function (x) { return x.id === offerPick.value; }) && cur.length < MAX_CIRCUITS) { cur.push({ id: offerPick.value, name: offerPick.options[offerPick.selectedIndex].text }); saveCircuits(cur); }
      }
      el.remove();
      if (turnOn) setEnabled(true, true);
    });
  }

  function start() {
    labels();
    watchMarks();
    // Keep the copy up to date: the pages change when the site does.
    if (enabled() && !offline && 'serviceWorker' in navigator) {
      var at = parseInt(ls('mt3ukLapsOfflineAt') || '0', 10);
      if (Date.now() - at > REFRESH_AFTER) keepCopy(function () {}).then(labels, function () {});
    }
    if (!offline) pendingCount().then(function (n) { if (n) sync(); });
    if (offline) drawBar();
    var known = checkAccess();
    setTimeout(function () { known.then(offer); }, window.MT3UK_OFFLINE_ASK_DELAY != null ? window.MT3UK_OFFLINE_ASK_DELAY : 3500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // A footer or Profile card drawn after load (shared pages swap the Laps footer in) gets its words too.
  window.addEventListener('load', function () { setTimeout(labels, 300); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !offline) sync(); });
  var syncTimer = setInterval(function () { if (!offline && !document.hidden) pendingCount().then(function (n) { if (n) sync(); }); }, 60000);

  // ---------- Moving between the Laps pages inside the open tab (car browsers) ----------
  // The Tesla screen blocks every page load with no connection, so with Laps offline on a car browser a link to another
  // Laps page fetches that page from the saved copy (the service worker answers from it) and writes it over this one,
  // with the address moved on, so the car has no page load to block. The browser's Back works the same way (popstate).
  var LAPS_FILES_RE = /\/(laps|track|leaderboards|profile)\.html$/;
  var pageFile = (location.pathname.split('/').pop() || 'index.html');
  function teardown() {
    stopPoll();
    clearInterval(syncTimer);
    clearTimeout(markTimer); clearTimeout(barTimer);
    if (markObserver) { markObserver.disconnect(); markObserver = null; }
  }
  function softNav(href, push) {
    var url;
    try { url = new URL(href, location.href); } catch (e) { return Promise.resolve(false); }
    return fetch(url.pathname, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('not kept');
      return r.text();
    }).then(function (html) {
      if (push) history.pushState(null, '', url.href);
      window.MT3UK_OFFLINE_HINT = offline;
      teardown();
      document.open();
      document.write(html);
      document.close();
      window.scrollTo(0, 0);
      return true;
    }, function () {
      // With a signal the car can load it the usual way; without one it cannot be opened at all.
      if (!offline) { location.assign(url.href); return false; }
      say('warn', '<b>That page is not kept on this device.</b> It opens again once you have a signal.', 8000);
      return false;
    });
  }
  function softNavWanted(url) {
    // Whenever Offline mode is on, not only once offline is noticed: the car's own online state cannot be trusted, and
    // a move made in the open tab works the same with or without a signal.
    return carBrowser() && (offline || enabled()) && url.origin === location.origin && LAPS_FILES_RE.test(url.pathname);
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-go')) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (!softNavWanted(url)) return;
    // A link to a section of this page stays a hash change.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    e.preventDefault(); e.stopPropagation();
    softNav(url.href, true);
  }, true);
  window.addEventListener('popstate', function (e) {
    var file = location.pathname.split('/').pop() || 'index.html';
    if (file === pageFile) return;
    var url = new URL(location.href);
    if (!softNavWanted(url)) return;
    e.stopImmediatePropagation();
    softNav(url.href, false);
  });

  window.MT3UKOffline = {
    isOffline: function () { return offline; },
    isNetworkError: isNetworkError,
    // How long a read may take before a copy kept on the device is used instead (a weak signal).
    readTimeout: function () { return window.MT3UK_READ_TIMEOUT_MS || 15000; },
    noteNetworkError: noteNetworkError,
    remember: remember,
    recall: recall,
    queueSession: queueSession,
    queueCall: queueCall,
    drawPending: drawPending,
    pending: qAll,
    sync: sync,
    enabled: enabled,
    say: say,
    read: read,
    circuit: circuit,
    circuits: circuits,
    addCircuit: addCircuit,
    removeCircuit: removeCircuit,
    holdKeep: holdKeep,
    markKept: markKept,
    refreshCopy: refreshCopy,
    keepTiles: keepTiles,
    carBrowser: carBrowser,
    softNav: softNav,
    prepareSessions: prepareSessions,
    refreshCircuits: refreshCircuits,
    localSession: localSession,
    setEnabled: setEnabled,
    labels: labels
  };
})();
