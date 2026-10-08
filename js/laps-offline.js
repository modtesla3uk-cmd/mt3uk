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
  var KEEP_SESSIONS = 60, PREPARE_SESSIONS = 25;
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
    circle: '<circle cx="12" cy="12" r="10.5" fill="currentColor" stroke="none"/><g transform="translate(12 12) scale(.58) translate(-12 -12)" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M16 16h5v5"/></g>',
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
    return /^\/(my-builds|track\/sessions|track\/tracks|track\/copy|track\/access|tyres|pads|vehicles)(\?|$)/.test(path) || path.indexOf('/track/session?id=') === 0;
  }
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
      return kvAll().then(function (all) {
        var mine = all.filter(function (x) { return x.key.indexOf('get:' + (ls(EMAIL_KEY) || '') + ':/track/session?id=') === 0; }).sort(function (a, b) { return b.value.at - a.value.at; });
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
  var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
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
        'Leaderboards, sharing, sign-in and changes to saved sessions need a connection, and so do satellite pictures you have not seen before.' +
        (n ? ' <b>' + n + ' session' + (n === 1 ? ' is' : 's are') + ' waiting to be sent.</b>' : '') +
        (kept ? '' : ' <button type="button" class="lo-link" data-lo="on">Keep Laps on this device</button> for next time (needs a connection).') +
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
    var job = { kind: 'session', at: Date.now(), label: info.label || 'Session', post: info.post, source: info.source || null, carPut: info.carPut || null, stage: 'new' };
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
            '<button type="button" class="btn btn-ghost btn-sm" data-lo-remove="' + j.id + '">Remove</button></li>';
        }).join('') + '</ul>' +
        (offline ? '' : '<button type="button" class="btn btn-secondary btn-sm" data-lo-send>' + (bad ? 'Try again' : 'Send now') + '</button>');
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
          ids = d.sessions.slice().sort(function (a, b) { return String(b.date + (b.time || '')) < String(a.date + (a.time || '')) ? -1 : 1; }).slice(0, PREPARE_SESSIONS).map(function (x) { return x.id; });
        }
      }).catch(function () {});
    })).then(function () {
      out.wanted = ids.length;
      var tiles = {}, at = 0;
      function next() {
        if (at >= ids.length) return Promise.resolve();
        var id = ids[at++], path = '/track/session?id=' + encodeURIComponent(id);
        return getJson(path).then(function (d) {
          if (d && d.success && d.session) { remember(path, d); out.sessions++; tilesFor(d.session, tiles); }
          report('Keeping your sessions (' + out.sessions + ' of ' + ids.length + ')...');
        }).catch(function () {}).then(next);
      }
      return Promise.all([next(), next(), next()]).then(function () { return tiles; });
    }).then(function (tiles) {
      var urls = Object.keys(tiles);
      if (!urls.length) return out;
      report('Keeping the maps (' + urls.length + ' pictures)...');
      return ask({ type: 'laps-offline-tiles', urls: urls }).then(function (r) { out.tiles = r.kept || 0; return out; }, function () { return out; });
    });
  }
  // The copy, then what the pages need. report is shown as the progress.
  function keepCopy(report) {
    return ask({ type: 'laps-offline-on' }).then(function (r) {
      if (!r.ok) throw new Error('Laps could not be kept on this device.');
      ls(KEPT_KEY, String(r.kept)); ls('mt3ukLapsOfflineAt', String(Date.now()));
      return prepare(report);
    });
  }
  function labels() {
    drawHeaderIcon();
    var on = enabled();
    // Profile's Offline mode card is for Laps (js/laps-shared.js marks the page); on mt3uk.com it stays hidden.
    var card = document.getElementById('offline-mode');
    if (card && document.documentElement.classList.contains('laps-shared')) card.hidden = false;
    [].slice.call(document.querySelectorAll('[data-offline-toggle]')).forEach(function (el) {
      if (el.getAttribute('role') === 'switch') { el.setAttribute('aria-checked', on ? 'true' : 'false'); }
      else el.textContent = 'Offline mode: ' + (preparing ? 'getting ready...' : on ? 'on' : 'off');
      el.disabled = false;
    });
    [].slice.call(document.querySelectorAll('[data-offline-status]')).forEach(function (el) {
      var kept = ls(KEPT_KEY);
      el.textContent = progress || (on ? (kept ? 'Laps is kept on this device (' + kept + ' files). It opens with no signal.' : 'Laps is kept on this device.') : 'Off. Laps needs a connection to open.');
    });
  }
  // The question before it goes on: what is kept and what it needs. Resolves true or false.
  function confirmOn() {
    return new Promise(function (resolve) {
      var old = document.getElementById('lo-confirm');
      if (old) old.remove();
      var el = document.createElement('div');
      el.id = 'lo-confirm'; el.className = 'lo-offer lo-confirm card'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Turn on offline mode');
      el.innerHTML = '<h3>Keep Laps on this device?</h3><p>This needs a connection now, and takes a minute or so. It keeps:</p>' +
        '<ul class="lo-ticks"><li>' + icon('check') + 'the Laps pages and the track list</li><li>' + icon('check') + 'your cars and your latest ' + PREPARE_SESSIONS + ' sessions, so you can open them with no signal</li>' +
        '<li>' + icon('check') + 'the maps under those sessions (satellite pictures, a few megabytes)</li></ul>' +
        '<p class="lo-small">Sessions waiting to be sent go first. With no signal you can open these sessions and maps, and add a session from a file already on your device: it is sent when you are next online. Whether you have the file offline depends on your logger (RaceBox, for example, only lets you download it once you are online). Leaderboards, sharing and sign-in still need a connection.</p>' +
        '<div class="lo-actions"><button type="button" class="btn btn-accent btn-sm" data-lo-confirm="yes">Turn on offline mode</button><button type="button" class="btn btn-ghost btn-sm" data-lo-confirm="no">Cancel</button></div>';
      document.body.appendChild(el);
      var b = el.querySelector('[data-lo-confirm="yes"]');
      if (b) b.focus();
      el.addEventListener('click', function (e) {
        var c = e.target.closest('[data-lo-confirm]');
        if (!c) return;
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
      say('ok', '<b>Offline mode is on.</b> Laps is kept on this device' + (r && r.sessions ? ', with ' + plural(r.sessions, 'session', 'sessions') + (r.tiles ? ' and their maps' : '') : '') + '. ' + (r && r.wanted && r.sessions < r.wanted ? plural(r.wanted - r.sessions, 'session', 'sessions') + ' could not be kept; open ' + (r.wanted - r.sessions === 1 ? 'it' : 'them') + ' while online to keep ' + (r.wanted - r.sessions === 1 ? 'it' : 'them') + '. ' : '') + 'It opens with no signal.', 12000);
      document.dispatchEvent(new CustomEvent('mt3uk-offline-change'));
    }, function (e) {
      ls(ON_KEY, null); ls(KEPT_KEY, null);
      preparing = false;
      progress = e.message || 'Laps could not be kept on this device.';
      labels();
      say('warn', '<b>Offline mode did not go on.</b> ' + esc(progress) + ' Check your connection and try again.', 0);
    });
  }
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
    // Held back while Offline mode is tried out, like the offer card: only a browser with the admin viewer token has the
    // icon. Take `!adminViewer()` out of this line to show it to every member.
    if (!head || !anchor || !adminViewer()) { if (el) el.hidden = true; return; }
    var on = enabled();
    if (!el) {
      el = document.createElement('button');
      el.type = 'button'; el.id = 'nav-offline'; el.className = 'nav-chat nav-offline'; el.setAttribute('role', 'switch');
      el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.circle + '</svg><span class="nav-chat-count" id="nav-offline-count" hidden></span>';
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
  function offer() {
    // An automated browser (the site's tests) is not asked unless a test sets the delay itself: the card sits over the
    // bottom of the page and would block clicks in tests that know nothing about it.
    if (navigator.webdriver && window.MT3UK_OFFLINE_ASK_DELAY == null) return;
    // Held back while Offline mode is tried out: only a browser that has the admin viewer token (left by entering the
    // admin key on an admin page, a month at a time) is offered it. Take this line out to offer it to every member.
    if (!adminViewer()) return;
    if (!/(^|\/)(track|leaderboards|laps)\.html$/.test(location.pathname)) return;
    if (enabled() || ls(ASKED_KEY) || !token() || offline || !('serviceWorker' in navigator)) return;
    if (document.getElementById('lo-offer')) return;
    ls(ASKED_KEY, '1');
    var el = document.createElement('div');
    el.id = 'lo-offer'; el.className = 'lo-offer card'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Offline mode');
    el.innerHTML = '<h3>Use Laps without a signal?</h3><p>Offline mode keeps a copy of Laps on this device (a few megabytes). At the track with no signal you can open your past sessions and their maps. You can also add a session from a file already on your device, and it is sent when you\'re back online.</p>' +
      '<p class="lo-small">Adding a session offline depends on your logger. Some, such as RaceBox, only let you download the file once you are online.</p>' +
      '<div class="lo-actions"><button type="button" class="btn btn-accent btn-sm" data-lo-offer="on">Turn on offline mode</button><button type="button" class="btn btn-ghost btn-sm" data-lo-offer="no">Not now</button></div>' +
      '<p class="lo-small">You can change this any time at the bottom of the page, or in Profile.</p>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lo-offer]');
      if (!b) return;
      el.remove();
      if (b.getAttribute('data-lo-offer') === 'on') setEnabled(true, true);
    });
  }

  function start() {
    labels();
    // Keep the copy up to date: the pages change when the site does.
    if (enabled() && !offline && 'serviceWorker' in navigator) {
      var at = parseInt(ls('mt3ukLapsOfflineAt') || '0', 10);
      if (Date.now() - at > REFRESH_AFTER) keepCopy(function () {}).then(labels, function () {});
    }
    if (!offline) pendingCount().then(function (n) { if (n) sync(); });
    if (offline) drawBar();
    setTimeout(offer, window.MT3UK_OFFLINE_ASK_DELAY != null ? window.MT3UK_OFFLINE_ASK_DELAY : 3500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // A footer or Profile card drawn after load (shared pages swap the Laps footer in) gets its words too.
  window.addEventListener('load', function () { setTimeout(labels, 300); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !offline) sync(); });
  setInterval(function () { if (!offline && !document.hidden) pendingCount().then(function (n) { if (n) sync(); }); }, 60000);

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
    setEnabled: setEnabled,
    labels: labels
  };
})();
