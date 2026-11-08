/*
 * Staging a recorded RaceBox drive for Laps: the drive is written as a RaceBox-format VBO file and kept on the phone
 * until the member decides to upload it from Add a session. The same IndexedDB as the RaceBox test page (mt3uk-racebox),
 * so the Laps pages on laps.mt3uk.com read what the RaceBox page saved.
 *
 * window.MT3UKStage:
 *   openDb()              -> Promise of the database (creates every store)
 *   stage(recId, started, name) -> Promise: writes the drive as a VBO file into the staged list
 *   list()                -> Promise of [{ id, name, started, count }], newest first (no file text, so it is quick)
 *   get(id)               -> Promise of the VBO text of a staged drive, or null (the file name is in list())
 *   remove(id)            -> Promise: takes a staged drive off the list (after it is uploaded, or the member removes it)
 *   toVbo(rows, started, name) -> the VBO text for the rows the RaceBox test page saves
 *
 * A saved row is [utc ms, lat, lon, km/h, heading, g across, g along, g up, rot x, rot y, rot z, fix ok, satellites, accuracy,
 *   altitude m, fix status (0 none, 2 2D, 3 3D), PDOP, battery %, speed accuracy m/s, heading accuracy deg].
 * Drives recorded before the last four were added have only the first 14; the rest are written as 0.
 */
(function (root) {
  'use strict';
  var DB_NAME = 'mt3uk-racebox', DB_VERSION = 2;
  var dbPromise = null;

  function openDb() {
    if (!dbPromise) dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('readings')) db.createObjectStore('readings', { keyPath: ['rec', 'seq'] });
        if (!db.objectStoreNames.contains('staged')) db.createObjectStore('staged', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('stagedText')) db.createObjectStore('stagedText', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  // Runs one request in one transaction and resolves with its result.
  function run(store, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode);
        var req = fn(tx.objectStore(store));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }

  // RaceBox's clock: hhmmss.cc in UTC, which the VBO reader turns back into seconds.
  function clock(utc) {
    var d = new Date(utc);
    return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + '.' + pad(Math.floor(d.getUTCMilliseconds() / 10));
  }

  // The VBO file: positions in decimal minutes with longitude positive to the west, as the reader expects.
  // g is written the way other loggers have it: across = -x, along = -y (the same signs as the CSV and dashcam readers).
  function toVbo(rows, started, name, mode, venue) {
    var d = new Date(started);
    var date = pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
    var time = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    var out = [
      'File created on ' + date + ' at ' + time + ' by Laps (' + (name || 'drive') + ')',
      '',
      '[header]',
      'satellites',
      '',
      '[comments]',
      'UTC date started : ' + date
    ];
    // Drag mode, so Laps times the drive as a drag run with the 1 ft rollout.
    if (mode === 'drag') out.push('Mode : Drag');
    else if (mode === 'track') out.push('Mode : Track');
    // The track chosen on the recorder, so Laps knows which circuit or strip it was.
    if (venue) out.push('Venue : ' + venue);
    out.push('', '[column names]',
      // The columns RaceBox records: position, speed, heading, height, the three g and three rotation figures, and the accuracy figures.
      'time sats fix lat long velocity heading height latacc longacc vertacc gyrox gyroy gyroz hacc sacc hdgacc pdop batt',
      '',
      '[data]');
    rows.forEach(function (r) {
      var lat = r[1], lon = r[2];
      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return;
      var v = function (i, d) { return (isFinite(r[i]) ? r[i] : 0).toFixed(d); };
      out.push([
        clock(r[0]),
        String(Math.max(0, Math.min(63, Math.round(r[12] || 0)))),
        String(r[15] || 0),
        (lat * 60).toFixed(6),
        (-lon * 60).toFixed(6),
        v(3, 3),
        v(4, 2),
        v(14, 2),
        (-(isFinite(r[5]) ? r[5] : 0)).toFixed(4),
        (-(isFinite(r[6]) ? r[6] : 0)).toFixed(4),
        v(7, 4),
        v(8, 2),
        v(9, 2),
        v(10, 2),
        v(13, 3),
        v(18, 3),
        v(19, 2),
        v(16, 2),
        String(r[17] || 0)
      ].join(' '));
    });
    return out.join('\r\n') + '\r\n';
  }

  // Every saved row of one drive, in order.
  function rowsOf(recId) {
    return run('readings', 'readonly', function (st) {
      return st.getAll(IDBKeyRange.bound([recId, 0], [recId, Number.MAX_SAFE_INTEGER]));
    }).then(function (batches) {
      var rows = [];
      (batches || []).forEach(function (b) { rows = rows.concat(b.rows); });
      return rows;
    });
  }

  function stage(recId, started, name) {
    return run('recordings', 'readonly', function (st) { return st.get(recId); }).then(function (meta) {
      return rowsOf(recId).then(function (rows) { return { rows: rows, mode: meta && meta.mode, venue: meta && meta.venue }; });
    }).then(function (got) {
      var rows = got.rows, mode = got.mode, venue = got.venue;
      var usable = rows.filter(function (r) { return r[1] || r[2]; });
      if (!usable.length) throw new Error('There are no readings to send for this drive.');
      var text = toVbo(usable, started, name, mode, venue);
      // Named as RaceBox names its own files, so Laps guesses the logger as RaceBox.
      var fileName = 'RaceBox_' + name.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') + '.vbo';
      var id = 's' + recId;
      return run('stagedText', 'readwrite', function (st) { return st.put({ id: id, text: text }); })
        .then(function () {
          return run('staged', 'readwrite', function (st) {
            return st.put({ id: id, name: name, fileName: fileName, started: started, count: usable.length });
          });
        })
        .then(function () { return { id: id, fileName: fileName, count: usable.length }; });
    });
  }

  function list() {
    return run('staged', 'readonly', function (st) { return st.getAll(); }).then(function (items) {
      return (items || []).sort(function (a, b) { return b.started - a.started; });
    });
  }

  function get(id) {
    return run('stagedText', 'readonly', function (st) { return st.get(id); }).then(function (row) { return row ? row.text : null; });
  }

  function remove(id) {
    return run('staged', 'readwrite', function (st) { return st.delete(id); })
      .then(function () { return run('stagedText', 'readwrite', function (st) { return st.delete(id); }); });
  }

  root.MT3UKStage = { openDb: openDb, stage: stage, list: list, get: get, remove: remove, toVbo: toVbo };
})(typeof window !== 'undefined' ? window : this);
