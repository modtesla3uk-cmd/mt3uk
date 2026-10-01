/*
  Track sessions: reads a logger file in the browser and works out the laps,
  sectors, corners, drag runs and the notes shown on track.html. Nothing here
  touches the page, so tests/track_parse_check.mjs runs it in node.

  MT3UKTrack.read(text, fileName, mapping)
    VBO (RaceBox, VBOX), CSV (RaceBox, Harry's LapTimer, TrackAddict, AiM,
    VBOX and most others) or GPX. Returns { format, points, startLine,
    venueName, startedAt } or { needsMapping: { headers, rows } } when a CSV's
    columns aren't recognised (pass mapping = { time, lat, lng, speed,
    speedUnit } as column numbers to read it).
  MT3UKTrack.analyse(read, library, opts)
    Finds the venue and layout in library (data/tracks.json merged with the
    admin's changes) and returns the session to save: summary, laps,
    corners, drag runs and a trimmed trace. opts.startLine ([[lat, lng],
    [lat, lng]]) times laps where the library has no start line yet.
  Points are { t (seconds from the start), lat, lng, v (km/h), la, lo
  (sideways and lengthways g), sats }.
*/
(function (root) {
  var KMH_PER_MPH = 1.609344;
  var DEG = Math.PI / 180;

  function num(s) {
    if (s == null) return NaN;
    var n = parseFloat(String(s).trim().replace(/^\+/, ''));
    return isFinite(n) ? n : NaN;
  }
  function median(a) {
    if (!a.length) return NaN;
    var b = a.slice().sort(function (x, y) { return x - y; });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function round(v, d) { var k = Math.pow(10, d || 0); return Math.round(v * k) / k; }
  function haversine(a, b) {
    var dLat = (b.lat - a.lat) * DEG, dLng = (b.lng - a.lng) * DEG;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  // Flat metres around an origin; plenty for a circuit.
  function projector(lat0, lng0) {
    var kx = Math.cos(lat0 * DEG) * 111320, ky = 110540;
    return {
      xy: function (lat, lng) { return [(lng - lng0) * kx, (lat - lat0) * ky]; },
      ll: function (x, y) { return [lat0 + y / ky, lng0 + x / kx]; }
    };
  }

  // ---------- Reading files ----------

  function readVbo(text) {
    var lines = text.split(/\r?\n/);
    var sec = '', cols = null, rows = [], startLine = null, venue = '', dateStr = '';
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (!s) continue;
      if (/^\[.*\]$/.test(s)) { sec = s.toLowerCase(); continue; }
      if (sec === '[comments]') {
        var mv = s.match(/^venue\s*:\s*(.+)$/i); if (mv) venue = mv[1].trim();
        var md = s.match(/utc date started\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i); if (md) dateStr = md[3] + '-' + pad(md[2]) + '-' + pad(md[1]);
      } else if (sec === '[laptiming]') {
        var p = s.split(/\s+/);
        if (/^start/i.test(p[0]) && p.length >= 5) {
          var a = [num(p[1]) / 60, -num(p[2]) / 60], b = [num(p[3]) / 60, -num(p[4]) / 60];
          if (isFinite(a[0]) && isFinite(b[0])) startLine = [a, b];
        }
      } else if (sec === '[column names]') {
        cols = s.split(/\s+/).map(function (c) { return c.toLowerCase(); });
      } else if (sec === '[data]' && cols) {
        rows.push(s.split(/\s+/));
      }
    }
    if (!dateStr) { var mf = text.match(/created on (\d{1,2})\/(\d{1,2})\/(\d{4})/i); if (mf) dateStr = mf[3] + '-' + pad(mf[2]) + '-' + pad(mf[1]); }
    if (!cols) throw new Error('This VBO file has no column names.');
    function col() { for (var k = 0; k < arguments.length; k++) { var j = cols.indexOf(arguments[k]); if (j !== -1) return j; } return -1; }
    var cT = col('time'), cLat = col('lat', 'latitude'), cLng = col('lng', 'long', 'longitude'), cV = col('velocity', 'velocity kmh', 'speed'),
      cLo = col('longacc', 'long_acc', 'longaccel'), cLa = col('latacc', 'lat_acc', 'lataccel'), cS = col('sats', 'satellites');
    if (cT < 0 || cLat < 0 || cLng < 0) throw new Error('This VBO file has no time or position columns.');
    var pts = [], dayOffset = 0, prevSec = -1;
    rows.forEach(function (r) {
      var ts = String(r[cT]);
      var sec = parseInt(ts.slice(0, 2), 10) * 3600 + parseInt(ts.slice(2, 4), 10) * 60 + parseFloat(ts.slice(4));
      if (!isFinite(sec)) return;
      if (prevSec >= 0 && sec + 43200 < prevSec) dayOffset += 86400;
      prevSec = sec;
      var lat = num(r[cLat]) / 60, lng = -num(r[cLng]) / 60;
      if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;
      var sats = cS >= 0 ? (parseInt(r[cS], 10) & 63) : NaN;
      pts.push({ utc: sec + dayOffset, lat: lat, lng: lng, v: cV >= 0 ? num(r[cV]) : NaN, lo: cLo >= 0 ? num(r[cLo]) : NaN, la: cLa >= 0 ? num(r[cLa]) : NaN, sats: sats });
    });
    var startedAt = null;
    if (dateStr && pts.length) startedAt = Date.parse(dateStr + 'T00:00:00Z') + pts[0].utc * 1000;
    // Keep only fixes with satellites when the logger reports them.
    if (pts.some(function (p) { return p.sats > 3; })) pts = pts.filter(function (p) { return !(p.sats >= 0) || p.sats > 3; });
    var t0 = pts.length ? pts[0].utc : 0;
    pts.forEach(function (p) { p.t = p.utc - t0; delete p.utc; });
    return { format: 'VBO', points: pts, startLine: startLine, venueName: venue, startedAt: startedAt, speedUnit: 'km/h' };
  }
  function pad(s) { s = String(s); return s.length < 2 ? '0' + s : s; }

  var ALIASES = {
    time: ['time', 'utc time', 'utc', 'timestamp', 'time (s)', 'time(s)', 'elapsed time', 'elapsed', 'gps time', 'session time', 'time_s', 'seconds', 'datetime', 'date time', 'record time'],
    lat: ['latitude', 'lat', 'gps latitude', 'gps_latitude', 'latitude (deg)', 'lat (deg)', 'position latitude'],
    lng: ['longitude', 'lon', 'lng', 'long', 'gps longitude', 'gps_longitude', 'longitude (deg)', 'lon (deg)', 'position longitude'],
    speed: ['speed', 'velocity', 'gps speed', 'gps_speed', 'speed (km/h)', 'speed (kph)', 'speed (mph)', 'speed (m/s)', 'speed_kmh', 'speed_mph', 'speed kmh', 'speed mph', 'gps speed (km/h)', 'gps speed (mph)', 'speed[km/h]', 'speed[mph]', 'velocity kmh'],
    la: ['latacc', 'lat acc', 'lateral acc', 'lateral acceleration', 'lat g', 'lateral g', 'gforce lat', 'g lat', 'gps latacc', 'lateral', 'accel lateral', 'acc lateral', 'lat accel', 'g-force lateral', 'lateral (g)'],
    lo: ['longacc', 'long acc', 'longitudinal acc', 'longitudinal acceleration', 'long g', 'longitudinal g', 'gforce long', 'g long', 'gps lonacc', 'inline', 'accel longitudinal', 'acc longitudinal', 'long accel', 'g-force longitudinal', 'longitudinal (g)', 'inline g'],
    sats: ['sats', 'satellites', 'gps sats', 'satellite count', 'num sats', 'gps satellites'],
    // The lap number some loggers write (Tesla Track Mode does).
    lap: ['lap', 'lap number', 'lap #', 'lap no', 'lap_number', 'lapnumber', 'lap count'],
    // Outside air only: tyre, battery and motor temperatures are left alone.
    temp: ['air temp', 'air temperature', 'ambient temp', 'ambient temperature', 'ambient', 'outside temp', 'outside temperature', 'oat', 'ambient air temp', 'air temp c', 'ambient temp c']
  };
  function normHeader(h) { return String(h).trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, ' '); }
  function stripUnit(h) { return h.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/, '').trim(); }
  function findCol(headers, key) {
    var list = ALIASES[key];
    for (var i = 0; i < headers.length; i++) if (list.indexOf(headers[i]) !== -1) return i;
    for (var j = 0; j < headers.length; j++) if (list.indexOf(stripUnit(headers[j])) !== -1) return j;
    return -1;
  }
  function splitCsv(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === delim && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  function unitFromHeader(h) {
    if (/mph/.test(h)) return 'mph';
    if (/m\/s|mps|ms-1/.test(h)) return 'm/s';
    if (/km\/?h|kph|kmh/.test(h)) return 'km/h';
    if (/knot|kts|kn\b/.test(h)) return 'knots';
    return '';
  }
  function parseTime(s) {
    s = String(s).trim().replace(/^"|"$/g, '');
    if (!s) return { t: NaN };
    if (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(s)) { var d = Date.parse(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')); return { t: d / 1000, abs: d }; }
    var m = s.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:[.,]\d+)?)$/);
    if (m) return { t: (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3].replace(',', '.')), clock: true };
    var m2 = s.match(/^(\d{1,3}):(\d{2}(?:[.,]\d+)?)$/);
    if (m2) return { t: (+m2[1]) * 60 + parseFloat(m2[2].replace(',', '.')) };
    var n = parseFloat(s.replace(',', '.'));
    if (!isFinite(n)) return { t: NaN };
    if (n > 1e12) return { t: n / 1000, abs: n };
    if (n > 1e9) return { t: n, abs: n * 1000 };
    return { t: n };
  }

  function readCsv(text, mapping) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    var delim = ',';
    var sample = lines.slice(0, 60).join('\n');
    var counts = { ',': (sample.match(/,/g) || []).length, ';': (sample.match(/;/g) || []).length, '\t': (sample.match(/\t/g) || []).length };
    if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) delim = ';';
    else if (counts['\t'] > counts[',']) delim = '\t';
    // The header is the first line naming a latitude and longitude; some apps
    // put a few lines of session details first.
    var hi = -1, headers = null;
    for (var i = 0; i < Math.min(lines.length, 80); i++) {
      var h = splitCsv(lines[i], delim).map(normHeader);
      if (findCol(h, 'lat') !== -1 && findCol(h, 'lng') !== -1) { hi = i; headers = h; break; }
    }
    var cols;
    if (mapping) {
      if (hi === -1) { hi = 0; headers = splitCsv(lines[0], delim).map(normHeader); }
      cols = { time: mapping.time, lat: mapping.lat, lng: mapping.lng, speed: mapping.speed == null ? -1 : mapping.speed, la: -1, lo: -1, sats: -1 };
    } else if (hi !== -1) {
      cols = { time: findCol(headers, 'time'), lat: findCol(headers, 'lat'), lng: findCol(headers, 'lng'), speed: findCol(headers, 'speed'), la: findCol(headers, 'la'), lo: findCol(headers, 'lo'), sats: findCol(headers, 'sats'), temp: findCol(headers, 'temp'), lap: findCol(headers, 'lap') };
      if (cols.time === -1) {
        // Some apps split date and clock time; any column with "time" in it.
        for (var k = 0; k < headers.length; k++) if (/time/.test(headers[k]) && k !== cols.lat && k !== cols.lng) { cols.time = k; break; }
      }
    }
    if (!cols || cols.time === -1 || cols.lat === -1 || cols.lng === -1) {
      var hh = splitCsv(lines[hi === -1 ? 0 : hi], delim).map(function (x) { return x.trim().replace(/^"|"$/g, ''); });
      return { needsMapping: { headers: hh, rows: lines.slice((hi === -1 ? 0 : hi) + 1, (hi === -1 ? 0 : hi) + 4).map(function (l) { return splitCsv(l, delim); }) } };
    }
    var unit = mapping && mapping.speedUnit ? mapping.speedUnit : (cols.speed >= 0 ? unitFromHeader(headers[cols.speed]) : '');
    var pts = [], startedAt = null, clockDays = 0, prev = null, lapOffset = 0, lastLap = null, step = 0;
    for (var r = hi + 1; r < lines.length; r++) {
      var f = splitCsv(lines[r], delim);
      var tm = parseTime(f[cols.time]);
      var lat = num(f[cols.lat]), lng = num(f[cols.lng]);
      if (!isFinite(tm.t) || !isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { lat /= 60; lng /= 60; }
      var t = tm.t;
      if (tm.clock && prev !== null && t + clockDays + 43200 < prev) clockDays += 86400;
      t += tm.clock ? clockDays : 0;
      // Some loggers (Tesla Track Mode) start the elapsed time again at 0 on
      // each new lap: carry it on from the end of the lap before.
      var lapNo = cols.lap >= 0 ? num(f[cols.lap]) : NaN;
      if (isFinite(lapNo) && lastLap !== null && lapNo > lastLap && prev !== null && t + lapOffset < prev) lapOffset = prev - t + step;
      if (isFinite(lapNo)) lastLap = lapNo;
      t += lapOffset;
      if (prev !== null && t <= prev) continue;
      if (prev !== null) step = t - prev;
      prev = t;
      if (startedAt === null && tm.abs) startedAt = tm.abs;
      pts.push({ t: t, lat: lat, lng: lng, v: cols.speed >= 0 ? num(f[cols.speed]) : NaN, la: cols.la >= 0 ? num(f[cols.la]) : NaN, lo: cols.lo >= 0 ? num(f[cols.lo]) : NaN, sats: cols.sats >= 0 ? num(f[cols.sats]) : NaN, temp: cols.temp >= 0 ? num(f[cols.temp]) : NaN, lap: cols.lap >= 0 ? num(f[cols.lap]) : NaN, abs: !!tm.abs });
    }
    if (!pts.length) throw new Error('No readings with a position were found in this file.');
    // Elapsed time in milliseconds (Tesla Track Mode writes "Elapsed Time
    // (ms)"): said in the header, or plain from the numbers, whole steps of
    // 10 to 1000 that would make the file over 6 hours long as seconds.
    var th = headers ? headers[cols.time] || '' : '';
    var ms = /\(ms\)|\[ms\]|\bms\b|millis|msec/.test(th);
    if (!ms && !pts[0].abs && pts.length > 20) {
      var steps = [];
      for (var q = 1; q < Math.min(pts.length, 400); q++) steps.push(pts[q].t - pts[q - 1].t);
      steps.sort(function (x, y) { return x - y; });
      var step = steps[Math.floor(steps.length / 2)];
      var whole = pts.slice(0, 200).every(function (p) { return p.t === Math.round(p.t); });
      ms = whole && step >= 10 && step <= 1000 && pts[pts.length - 1].t - pts[0].t > 6 * 3600;
    }
    if (ms) pts.forEach(function (p) { p.t /= 1000; });
    // Acceleration in m/s² rather than g.
    if (cols.la >= 0 && /m\/s/.test(headers ? headers[cols.la] || '' : '')) pts.forEach(function (p) { p.la /= 9.81; });
    if (cols.lo >= 0 && /m\/s/.test(headers ? headers[cols.lo] || '' : '')) pts.forEach(function (p) { p.lo /= 9.81; });
    var t0 = pts[0].t;
    pts.forEach(function (p) { p.t -= t0; delete p.abs; });
    var fileLine = cols.lap >= 0 ? lineFromLaps(pts) : null;
    pts.forEach(function (p) { delete p.lap; });
    var venue = '';
    lines.slice(0, Math.max(hi, 0)).forEach(function (l) { var m = l.match(/(?:venue|track|circuit)\s*[:,]\s*"?([^",]+)/i); if (m && !venue) venue = m[1].trim(); });
    return { format: 'CSV', points: pts, startLine: fileLine, venueName: venue, startedAt: startedAt, speedUnit: unit, columns: cols, tempF: cols.temp >= 0 && /(°|deg|\b)f\b|fahrenheit/.test(headers[cols.temp]) };
  }

  // Where the file's lap number goes up is the start/finish line: a short
  // line across the direction of travel there, like a member's tap.
  function lineFromLaps(pts) {
    for (var i = 4; i < pts.length - 4; i++) {
      var a = pts[i - 1].lap, b = pts[i].lap;
      if (!isFinite(a) || !isFinite(b) || b <= a || a < 0) continue;
      // Halfway between the readings either side, so it isn't on a reading.
      var proj = projector((pts[i - 1].lat + pts[i].lat) / 2, (pts[i - 1].lng + pts[i].lng) / 2);
      var p0 = proj.xy(pts[i - 4].lat, pts[i - 4].lng), p1 = proj.xy(pts[i + 4].lat, pts[i + 4].lng);
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
      if (L < 1) continue;
      var nx = -dy / L, ny = dx / L;
      return [proj.ll(nx * 15, ny * 15), proj.ll(-nx * 15, -ny * 15)];
    }
    return null;
  }

  function readGpx(text) {
    var pts = [], re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g, m;
    while ((m = re.exec(text))) {
      var lat = num((m[1].match(/lat="([^"]+)"/) || [])[1]), lng = num((m[1].match(/lon="([^"]+)"/) || [])[1]);
      var tm = (m[2].match(/<time>([^<]+)<\/time>/) || [])[1];
      var sp = (m[2].match(/<(?:\w+:)?speed>([^<]+)<\/(?:\w+:)?speed>/) || [])[1];
      if (!isFinite(lat) || !isFinite(lng) || !tm) continue;
      var abs = Date.parse(tm);
      if (!isFinite(abs)) continue;
      pts.push({ abs: abs, lat: lat, lng: lng, v: sp != null ? num(sp) * 3.6 : NaN, la: NaN, lo: NaN, sats: NaN });
    }
    if (!pts.length) throw new Error('No track points were found in this GPX file.');
    var a0 = pts[0].abs;
    pts.forEach(function (p) { p.t = (p.abs - a0) / 1000; delete p.abs; });
    var name = (text.match(/<name>([^<]+)<\/name>/) || [])[1] || '';
    return { format: 'GPX', points: pts, startLine: null, venueName: name, startedAt: a0, speedUnit: 'km/h' };
  }

  function read(text, fileName, mapping) {
    text = String(text || '').replace(/^﻿/, '');
    var name = String(fileName || '').toLowerCase();
    var out;
    if (/\.vbo$/.test(name) || /^\s*(file created|\[header\])/i.test(text) && /\[data\]/i.test(text)) out = readVbo(text);
    else if (/\.gpx$/.test(name) || /<gpx[\s>]/i.test(text.slice(0, 2000))) out = readGpx(text);
    else out = readCsv(text, mapping);
    if (out.needsMapping) return out;
    finishPoints(out);
    return out;
  }

  // Speeds in km/h and g worked out where the file has none, then smoothed.
  function finishPoints(out) {
    var pts = out.points;
    if (pts.length < 10) throw new Error('This file is too short to use.');
    var derived = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dt = b.t - a.t;
      derived.push(dt > 0 ? haversine(a, b) / dt * 3.6 : 0);
    }
    var hasSpeed = pts.filter(function (p) { return isFinite(p.v); }).length > pts.length * 0.8;
    if (hasSpeed) {
      var unit = out.speedUnit;
      if (!unit) {
        // No unit in the file: pick the one that matches the GPS movement.
        var ratios = [];
        pts.forEach(function (p, k) { if (derived[k] > 20 && p.v > 0) ratios.push(p.v / derived[k]); });
        var r = median(ratios);
        var opts = [['km/h', 1], ['mph', 1 / KMH_PER_MPH], ['m/s', 1 / 3.6], ['knots', 1 / 1.852]];
        unit = opts.reduce(function (best, o) { return Math.abs(Math.log(r / o[1])) < Math.abs(Math.log(r / best[1])) ? o : best; }, opts[0])[0];
      }
      var k = unit === 'mph' ? KMH_PER_MPH : unit === 'm/s' ? 3.6 : unit === 'knots' ? 1.852 : 1;
      pts.forEach(function (p, j) { p.v = isFinite(p.v) ? p.v * k : derived[j]; });
      out.speedUnit = unit || 'km/h';
    } else {
      var sm = smooth(derived, 2);
      pts.forEach(function (p, j) { p.v = sm[j]; });
      out.speedDerived = true;
    }
    var hasG = pts.filter(function (p) { return isFinite(p.la) && isFinite(p.lo); }).length > pts.length * 0.8;
    if (!hasG) {
      var head = [];
      for (var q = 0; q < pts.length; q++) {
        var p0 = pts[Math.max(0, q - 1)], p1 = pts[Math.min(pts.length - 1, q + 1)];
        head.push(Math.atan2((p1.lng - p0.lng) * Math.cos(p0.lat * DEG), p1.lat - p0.lat));
      }
      var lo = [], la = [];
      for (var z = 0; z < pts.length; z++) {
        var u = Math.max(0, z - 1), w = Math.min(pts.length - 1, z + 1), dtt = pts[w].t - pts[u].t || 1;
        lo.push((pts[w].v - pts[u].v) / 3.6 / dtt / 9.81);
        var dh = head[w] - head[u];
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        la.push(pts[z].v / 3.6 * dh / dtt / 9.81);
      }
      lo = smooth(lo, 2); la = smooth(la, 2);
      pts.forEach(function (p, j) { p.lo = lo[j]; p.la = la[j]; });
      out.gDerived = true;
    }
    var dts = [];
    for (var y = 1; y < Math.min(pts.length, 2000); y++) dts.push(pts[y].t - pts[y - 1].t);
    out.hz = round(1 / (median(dts) || 1), 0);
    var sats = pts.filter(function (p) { return isFinite(p.sats); }).map(function (p) { return p.sats; });
    out.sats = sats.length ? round(sats.reduce(function (a, b) { return a + b; }, 0) / sats.length, 1) : null;
    out.quality = out.hz >= 10 ? 'good' : out.hz >= 5 ? 'fair' : 'rough';
    // Outside air temperature, when the logger records it (average, in °C).
    var temps = pts.map(function (p) { return out.tempF ? (p.temp - 32) * 5 / 9 : p.temp; }).filter(function (v) { return isFinite(v) && v > -30 && v < 50; });
    if (temps.length > pts.length * 0.5) out.airTemp = Math.round(median(temps));
  }
  function smooth(a, n) {
    return a.map(function (_, i) {
      var s = 0, c = 0;
      for (var k = Math.max(0, i - n); k <= Math.min(a.length - 1, i + n); k++) { if (isFinite(a[k])) { s += a[k]; c++; } }
      return c ? s / c : 0;
    });
  }

  // ---------- Venues ----------

  function venues(library) { return (library && library.venues) || []; }

  function findVenue(points, library, type) {
    var mid = points[Math.floor(points.length / 2)];
    var best = null, bestD = Infinity;
    venues(library).forEach(function (v) {
      if (type && v.type !== type) return;
      var inside = 0, step = Math.max(1, Math.floor(points.length / 200));
      for (var i = 0; i < points.length; i += step) if (haversine(points[i], v) <= v.radius) inside++;
      var share = inside / Math.ceil(points.length / step);
      var d = haversine(mid, v);
      if (share >= 0.5 && d < bestD) { best = v; bestD = d; }
    });
    return best;
  }

  // ---------- Laps ----------

  function crossings(points, proj, line, minGap) {
    var a = proj.xy(line[0][0], line[0][1]), b = proj.xy(line[1][0], line[1][1]);
    var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    // Widened a little so a line drawn just short of the track edge still counts.
    var A = [a[0] - ux * 15, a[1] - uy * 15], B = [b[0] + ux * 15, b[1] + uy * 15];
    function o(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    var out = [];
    for (var i = 1; i < points.length; i++) {
      var p = points[i - 1], q = points[i];
      var d1 = o(A, B, [p.x, p.y]), d2 = o(A, B, [q.x, q.y]), d3 = o([p.x, p.y], [q.x, q.y], A), d4 = o([p.x, p.y], [q.x, q.y], B);
      if (d1 * d2 < 0 && d3 * d4 < 0) {
        var f = d1 / (d1 - d2);
        var t = p.t + f * (q.t - p.t), d = p.d + f * (q.d - p.d);
        if (!out.length || t - out[out.length - 1].t > minGap) out.push({ i: i, t: t, d: d });
      }
    }
    return out;
  }

  function at(points, key, value, from) {
    // First point where points[k][key] passes value, interpolated (key rises).
    for (var k = Math.max(1, from || 1); k < points.length; k++) {
      if (points[k][key] >= value) {
        var p = points[k - 1], q = points[k], f = (value - p[key]) / ((q[key] - p[key]) || 1);
        return { t: p.t + f * (q.t - p.t), d: p.d + f * (q.d - p.d), v: p.v + f * (q.v - p.v), k: k };
      }
    }
    return null;
  }

  // Laps between one start-line crossing and the next or, for a sprint,
  // runs from the start line to the finish line (pairs).
  function buildLaps(points, cr, sectorCr, pairs) {
    var laps = [];
    var segs = pairs || cr.slice(0, -1).map(function (c, j) { return [c, cr[j + 1]]; });
    for (var j = 0; j < segs.length; j++) {
      var s = segs[j][0], e = segs[j][1];
      var vmax = 0, vmin = Infinity;
      for (var k = s.i; k < e.i; k++) { vmax = Math.max(vmax, points[k].v); vmin = Math.min(vmin, points[k].v); }
      var lap = { n: j + 1, start: s.t, time: round(e.t - s.t, 3), dist: Math.round(e.d - s.d), vmax: round(vmax, 1), vmin: round(vmin, 1), i0: s.i, i1: e.i, d0: s.d };
      if (sectorCr && sectorCr.length) {
        var marks = [s.t];
        sectorCr.forEach(function (sc) { var c = sc.filter(function (x) { return x.t > s.t && x.t < e.t; })[0]; marks.push(c ? c.t : NaN); });
        marks.push(e.t);
        lap.sectors = [];
        for (var m = 1; m < marks.length; m++) lap.sectors.push(round(marks[m] - marks[m - 1], 2));
        if (lap.sectors.some(function (x) { return !isFinite(x); })) lap.sectors = null;
      }
      if (!lap.sectors) {
        lap.sectors = [];
        var prev = s.t;
        [1 / 3, 2 / 3].forEach(function (fr) {
          var c = at(points, 'd', s.d + fr * (e.d - s.d), s.i);
          lap.sectors.push(round(c.t - prev, 2)); prev = c.t;
        });
        lap.sectors.push(round(e.t - prev, 2));
        lap.sectorsByThirds = true;
      }
      laps.push(lap);
    }
    // Laps much slower or shorter than the rest are left out of bests.
    var med = median(laps.map(function (l) { return l.time; })), medD = median(laps.map(function (l) { return l.dist; }));
    laps.forEach(function (l, idx) {
      if (l.dist < medD * 0.8) l.kind = 'short';
      else if (l.time > med * 1.12) l.kind = pairs ? 'slow' : idx === laps.length - 1 && l.vmin < 45 ? 'in' : idx === 0 && l.vmin < 45 ? 'out' : 'slow';
      else l.kind = 'timed';
    });
    return laps;
  }

  function lapTrace(points, lap, hz) {
    var out = [], step = 1 / (hz || 5), next = lap.start;
    for (var k = lap.i0; k <= lap.i1 && k < points.length; k++) {
      var p = points[k];
      if (p.t + 1e-9 < next && k !== lap.i1) continue;
      next = p.t + step;
      out.push([round(p.d - lap.d0, 1), round(Math.max(0, p.t - lap.start), 2), round(p.x, 1), round(p.y, 1), round(p.v, 1), round(p.la, 2), round(p.lo, 2)]);
    }
    var last = out[out.length - 1];
    if (last) { last[0] = lap.dist; last[1] = lap.time; }
    return out;
  }

  // Slowest points of a lap trace: [d, t, x, y, v, la, lo].
  function findCorners(trace) {
    var mins = [];
    for (var i = 0; i < trace.length; i++) {
      var d = trace[i][0], v = trace[i][4], isMin = true, peak = 0;
      for (var k = i - 1; k >= 0 && trace[k][0] > d - 150; k--) if (trace[k][4] < v) { isMin = false; break; }
      if (!isMin) continue;
      for (var k2 = i + 1; k2 < trace.length && trace[k2][0] < d + 150; k2++) if (trace[k2][4] < v) { isMin = false; break; }
      if (!isMin) continue;
      for (var k3 = i - 1; k3 >= 0 && trace[k3][0] > d - 600; k3--) peak = Math.max(peak, trace[k3][4]);
      if (peak - v < 15) continue;
      if (mins.length && d - mins[mins.length - 1][0] < 200) continue;
      mins.push(trace[i]);
    }
    return mins.map(function (p, n) { return { n: n + 1, d: Math.round(p[0]), x: p[2], y: p[3], v: p[4] }; });
  }

  function traceAt(trace, d) {
    var lo = 0, hi = trace.length - 1;
    if (d <= trace[0][0]) return trace[0];
    if (d >= trace[hi][0]) return trace[hi];
    while (lo < hi) { var m = (lo + hi) >> 1; if (trace[m][0] < d) lo = m + 1; else hi = m; }
    var p = trace[lo - 1], q = trace[lo], f = (d - p[0]) / ((q[0] - p[0]) || 1);
    return p.map(function (v, i) { return v + (q[i] - v) * f; });
  }

  // Time lap A gains on lap B around each corner (200 m before to 150 m after
  // its slowest point) and each lap's slowest speed there.
  function cornerGains(a, b, corners) {
    return corners.map(function (c) {
      function span(tr) { return traceAt(tr, c.d + 150)[1] - traceAt(tr, c.d - 200)[1]; }
      function vmin(tr) { var m = Infinity; tr.forEach(function (p) { if (Math.abs(p[0] - c.d) < 80) m = Math.min(m, p[4]); }); return m === Infinity ? traceAt(tr, c.d)[4] : m; }
      return { n: c.n, name: c.name || '', d: c.d, gain: round(span(b) - span(a), 2), va: round(vmin(a), 1), vb: round(vmin(b), 1) };
    });
  }

  // ---------- Drag runs ----------

  function dragRuns(points) {
    var runs = [];
    for (var i = 1; i < points.length; i++) {
      if (!(points[i - 1].v < 2 && points[i].v >= 2)) continue;
      // Stood still for at least half a second first.
      var still = 0;
      for (var b = i - 1; b > 0 && points[b].v < 2; b--) still = points[i - 1].t - points[b].t;
      if (still < 0.5 && i > 5) continue;
      var t0 = points[i - 1].t, x = 0, vmax = 0, out = { start: t0, lat: points[i].lat, lng: points[i].lng, curve: [[0, 0]] };
      var marks = { ft60: 18.288, eighth: 201.168, quarter: 402.336 }, sp = { s60: 60 * KMH_PER_MPH, s100: 100 * KMH_PER_MPH, k100: 100 };
      var lastCurve = 0;
      for (var k = i; k < points.length; k++) {
        var p = points[k - 1], q = points[k], dt = q.t - p.t;
        var nx = x + (p.v + q.v) / 2 / 3.6 * dt;
        Object.keys(marks).forEach(function (m) { if (!out[m] && nx >= marks[m]) { var f = (marks[m] - x) / ((nx - x) || 1); out[m] = round(p.t + f * dt - t0, 2); out[m + 'Speed'] = round(p.v + f * (q.v - p.v), 1); } });
        Object.keys(sp).forEach(function (m) { if (!out[m] && q.v >= sp[m]) { var f = (sp[m] - p.v) / ((q.v - p.v) || 1); out[m] = round(p.t + f * dt - t0, 2); } });
        x = nx; vmax = Math.max(vmax, q.v);
        if (q.t - t0 - lastCurve >= 0.1) { out.curve.push([round(q.t - t0, 2), round(q.v, 1)]); lastCurve = q.t - t0; }
        if (q.v < vmax - 15 || out.quarter) { i = k; break; }
        if (k === points.length - 1) i = k;
      }
      if (!out.s60) continue;
      out.vmax = round(vmax, 1);
      if (out.s100 && out.s60) out.s60to100 = round(out.s100 - out.s60, 2);
      runs.push(out);
    }
    return runs;
  }

  // ---------- Putting it together ----------

  function analyse(rd, library, opts) {
    opts = opts || {};
    var pts = rd.points;
    var type = opts.type || null;
    var venue = findVenue(pts, library, type === 'drag' ? 'drag' : type === 'track' ? 'circuit' : type === 'sprint' ? 'sprint' : null);
    if (!type) {
      if (venue && venue.type === 'drag') type = 'drag';
      else if (venue && venue.type === 'sprint') type = 'sprint';
      else if (venue) type = 'track';
      else type = dragRuns(prepare(pts)).length && !rd.startLine ? 'drag' : 'track';
    }
    var session = { type: type, format: rd.format, hz: rd.hz, sats: rd.sats, quality: rd.quality, startedAt: rd.startedAt || null, venueName: rd.venueName || '', speedDerived: !!rd.speedDerived, gDerived: !!rd.gDerived };
    if (rd.startedAt) session.date = ukDate(rd.startedAt), session.time = ukTime(rd.startedAt);
    if (rd.airTemp != null) session.airTemp = rd.airTemp;
    if (venue) { session.venueId = venue.id; session.venue = venue.name; }
    var origin = venue ? [venue.lat, venue.lng] : [pts[0].lat, pts[0].lng];
    var proj = projector(origin[0], origin[1]);
    prepare(pts, proj);
    session.duration = round(pts[pts.length - 1].t, 1);
    session.distance = Math.round(pts[pts.length - 1].d);
    session.vmax = round(Math.max.apply(null, pts.map(function (p) { return p.v; })), 1);
    session.latMax = round(Math.max.apply(null, pts.map(function (p) { return Math.abs(p.la); })), 2);
    session.brakeMax = round(-Math.min.apply(null, pts.map(function (p) { return p.lo; })), 2);
    session.accMax = round(Math.max.apply(null, pts.map(function (p) { return p.lo; })), 2);
    session.origin = origin;

    if (type === 'drag') {
      var dv = venue && venue.type === 'drag' ? venue : findVenue(pts, library, 'drag');
      session.atVenue = !!dv;
      if (dv) { session.venueId = dv.id; session.venue = dv.name; }
      session.runs = dragRuns(pts);
      if (!session.runs.length) session.problem = 'No drag run found. A run needs a standing start and to reach 60 mph.';
      return session;
    }

    if (type === 'sprint') return sprintSession(session, rd, pts, library, venue, proj, origin, opts);

    // Which start line: the layout's, else the one in the file, else the member's.
    var layouts = venue && venue.layouts && venue.type === 'circuit' ? venue.layouts : [];
    var choice = null, minGap = 20;
    var candidates = [];
    layouts.forEach(function (l) { if (l.startLine && l.startLine.length === 2) candidates.push({ layout: l, line: l.startLine, sectors: l.sectors || [] }); });
    if (opts.startLine) candidates.push({ layout: null, line: opts.startLine, sectors: [], own: true });
    if (rd.startLine) candidates.push({ layout: null, line: rd.startLine, sectors: [], fromFile: true });
    candidates.forEach(function (c) {
      var cr = crossings(pts, proj, c.line, minGap);
      if (cr.length < 2) return;
      var laps = buildLaps(pts, cr);
      var med = median(laps.map(function (l) { return l.dist; }));
      var lengthScore = c.layout && c.layout.length ? Math.abs(med - c.layout.length) / c.layout.length : 0.05;
      if (c.layout && lengthScore > 0.12) return;
      var score = laps.length - lengthScore * 10 + (c.layout ? 1 : 0);
      if (!choice || score > choice.score) choice = { c: c, cr: cr, score: score, med: med };
    });
    if (type === 'other') session.trace = { outline: outline(pts) };
    if (!choice && type === 'other') { session.laps = []; return session; }
    if (!choice) {
      session.laps = [];
      session.needsStartLine = true;
      session.trace = { outline: outline(pts) };
      session.problem = venue ? 'We know ' + venue.name + ' but not its start line yet. Tap where the start and finish line is on your trace.' : 'We don\'t know this track yet. Tap where the start and finish line is on your trace and we\'ll add the track.';
      return session;
    }
    var layout = choice.c.layout;
    if (!layout && layouts.length) {
      // A start line from the file or the member: match the layout by lap length.
      layout = layouts.reduce(function (best, l) {
        var e = l.length ? Math.abs(choice.med - l.length) / l.length : 1;
        return e < 0.12 && (!best || e < best.e) ? { l: l, e: e } : best;
      }, null);
      layout = layout && layout.l;
    }
    if (layout) { session.layoutId = layout.id; session.layout = layout.name; }
    session.startLine = choice.c.line;
    if (choice.c.own) session.startLineFromMember = true;
    var sectorCr = layout && layout.sectors && layout.sectors.length ? layout.sectors.map(function (s) { return crossings(pts, proj, s, minGap); }) : null;
    var laps = buildLaps(pts, choice.cr, sectorCr);
    return timedTail(session, pts, laps, layout, proj, origin);
  }

  // Sprints and hill climbs: timed from the start line to the finish line.
  function sprintSession(session, rd, pts, library, venue, proj, origin, opts) {
    var sv = venue && venue.type === 'sprint' ? venue : findVenue(pts, library, 'sprint');
    delete session.venueId; delete session.venue;
    if (sv) { session.venueId = sv.id; session.venue = sv.name; }
    var cands = [];
    ((sv && sv.layouts) || []).forEach(function (l) { if (l.startLine && l.finishLine) cands.push({ layout: l, start: l.startLine, finish: l.finishLine }); });
    if (opts.startLine && opts.finishLine) cands.push({ layout: null, start: opts.startLine, finish: opts.finishLine, own: true });
    var pick = null;
    cands.forEach(function (c) {
      var st = crossings(pts, proj, c.start, 5), fi = crossings(pts, proj, c.finish, 5), pairs = [];
      st.forEach(function (a) {
        var e = fi.filter(function (f) { return f.t > a.t + 3 && f.t - a.t < 900; })[0];
        if (e && (!pairs.length || a.t > pairs[pairs.length - 1][1].t)) pairs.push([a, e]);
      });
      if (pairs.length && (!pick || pairs.length > pick.pairs.length)) pick = { c: c, pairs: pairs };
    });
    if (!pick) {
      session.laps = [];
      session.needsStartLine = true;
      session.needsFinish = true;
      session.trace = { outline: outline(pts) };
      session.problem = sv ? 'We know ' + sv.name + ' but not its start and finish yet. Tap the start, then the finish, on your trace.' : 'We don\'t know this course yet. Tap the start, then the finish, on your trace and we\'ll add it.';
      return session;
    }
    var layout = pick.c.layout;
    if (!layout && sv && sv.layouts && sv.layouts.length === 1) layout = sv.layouts[0];
    if (layout) { session.layoutId = layout.id; session.layout = layout.name; }
    session.startLine = pick.c.start;
    session.finishLine = pick.c.finish;
    if (pick.c.own) session.startLineFromMember = true;
    var laps = buildLaps(pts, null, null, pick.pairs);
    return timedTail(session, pts, laps, layout, proj, origin);
  }

  // Bests, sectors, traces and corners for laps or sprint runs.
  function timedTail(session, pts, laps, layout, proj, origin) {
    var timed = laps.filter(function (l) { return l.kind === 'timed'; });
    var best = timed.reduce(function (b, l) { return !b || l.time < b.time ? l : b; }, null);
    session.laps = laps.map(function (l) { return { n: l.n, start: round(l.start, 2), time: l.time, dist: l.dist, vmax: l.vmax, kind: l.kind, sectors: l.sectors }; });
    session.sectorsByThirds = laps.some(function (l) { return l.sectorsByThirds; });
    if (best) {
      session.best = best.n;
      session.bestTime = best.time;
      var bestSec = best.sectors.map(function (_, i) { return Math.min.apply(null, laps.filter(function (l) { return l.kind !== 'short'; }).filter(function (l) { return l.sectors && l.sectors.length === best.sectors.length; }).map(function (l) { return l.sectors[i]; })); });
      session.bestSectors = bestSec;
      session.possible = round(bestSec.reduce(function (a, b) { return a + b; }, 0), 3);
    }
    // Traces: 5 a second, fewer if the session is very long.
    var hz = laps.length > 25 ? 2.5 : 5;
    var traces = {};
    laps.forEach(function (l) { traces[l.n] = lapTrace(pts, l, hz); });
    session.trace = { hz: hz, laps: traces, origin: origin };
    if (session.type === 'other') session.trace.outline = outline(pts);
    if (best) {
      var corners = findCorners(traces[best.n]);
      var named = (layout && layout.corners) || [];
      corners.forEach(function (c) {
        var ll = proj.ll(c.x, c.y), near = null, nd = 80;
        named.forEach(function (nc) { var dd = haversine({ lat: ll[0], lng: ll[1] }, { lat: nc.lat, lng: nc.lng }); if (dd < nd) { nd = dd; near = nc; } });
        if (near) c.name = near.name;
        c.lat = round(ll[0], 6); c.lng = round(ll[1], 6);
      });
      session.corners = corners;
    }
    return session;
  }

  function prepare(pts, proj) {
    var d = 0;
    proj = proj || projector(pts[0].lat, pts[0].lng);
    for (var i = 0; i < pts.length; i++) {
      var xy = proj.xy(pts[i].lat, pts[i].lng);
      pts[i].x = xy[0]; pts[i].y = xy[1];
      if (i) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      pts[i].d = d;
    }
    return pts;
  }
  function outline(pts) {
    var out = [], step = Math.max(1, Math.floor(pts.length / 1500));
    for (var i = 0; i < pts.length; i += step) out.push([round(pts[i].lat, 6), round(pts[i].lng, 6), round(pts[i].v, 0)]);
    return out;
  }

  function ukDate(ms) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
    catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function ukTime(ms) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)); }
    catch (e) { return new Date(ms).toISOString().slice(11, 16); }
  }

  // ---------- Notes ----------

  function fmtLap(s) {
    if (!isFinite(s)) return '';
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
  }

  // What we spotted in one session. speed(kmh) formats a speed in the
  // member's units.
  function sessionNotes(s, speed, dist) {
    speed = speed || function (k) { return Math.round(k / KMH_PER_MPH) + ' mph'; };
    dist = dist || function (m) { return (m / 1609.344).toFixed(1) + ' mi'; };
    var out = [];
    if (s.type === 'drag') {
      var runs = s.runs || [];
      if (runs.length > 1) {
        var bq = runs.filter(function (r) { return r.quarter; }).sort(function (a, b) { return a.quarter - b.quarter; });
        var b60 = runs.slice().sort(function (a, b) { return a.s60 - b.s60; });
        if (b60.length > 1 && b60[b60.length - 1].s60 - b60[0].s60 > 0.15) out.push({ icon: 'up', text: 'Your best launch was ' + (b60[b60.length - 1].s60 - b60[0].s60).toFixed(2) + ' s quicker to 60 mph than your slowest. 60 ft times: ' + runs.map(function (r) { return r.ft60 ? r.ft60.toFixed(2) : '-'; }).join(', ') + ' s.', small: 'Most of a quarter mile is won in the first 60 feet.' });
        if (bq.length) out.push({ icon: 'flag', text: 'Best quarter mile ' + bq[0].quarter.toFixed(2) + ' s at ' + speed(bq[0].quarterSpeed) + '.', small: '' });
      }
      out.push(qualityNote(s));
      return out.filter(Boolean);
    }
    var laps = s.laps || [], tr = s.trace && s.trace.laps, best = s.best;
    if (!best || !tr) { out.push(qualityNote(s)); return out.filter(Boolean); }
    if (s.possible && s.bestTime - s.possible >= 0.1) out.push({ icon: 'flag', text: 'Your best sectors add up to ' + fmtLap(s.possible) + ', ' + (s.bestTime - s.possible).toFixed(2) + ' s quicker than your best lap.', small: s.sectorsByThirds ? 'Sectors are thirds of the lap until this track has its own sector points.' : 'Green sector times are your best of each.' });
    // A lap that was ahead of the best for a while.
    var bt = tr[best];
    laps.forEach(function (l) {
      if (l.n === best || !tr[l.n] || l.kind === 'short') return;
      var up = 0, upAt = 0;
      tr[l.n].forEach(function (p) { var q = traceAt(bt, p[0]); var lead = q[1] - p[1]; if (lead > up) { up = lead; upAt = p[0]; } });
      if (up >= 0.4 && !out.some(function (o) { return o.lapAhead; })) out.push({ icon: 'flag', lapAhead: true, text: 'Lap ' + l.n + ' was ' + up.toFixed(1) + ' s up on your best lap ' + dist(upAt) + ' in' + (l.kind === 'in' ? ', before you came in to the pits.' : ', then lost it later in the lap.'), small: 'Put those parts together and there is more time in the car.' });
    });
    var others = laps.filter(function (l) { return l.kind === 'timed' && l.n !== best; }).sort(function (a, b) { return a.time - b.time; });
    if (others.length && s.corners && s.corners.length) {
      var g = cornerGains(bt, tr[others[0].n], s.corners).sort(function (a, b) { return b.gain - a.gain; })[0];
      if (g && g.gain >= 0.15) out.push({ icon: 'corner', text: 'Compared with lap ' + others[0].n + ', most of your best lap\'s time came at ' + cornerName(g) + ': ' + g.gain.toFixed(2) + ' s, carrying ' + speed(Math.max(0, g.va - g.vb)) + ' more at the slowest point.', small: 'Measured from 200 m before the slowest point to 150 m after.' });
    }
    if (s.brakeMax) out.push({ icon: 'brake', text: 'Peak braking ' + s.brakeMax.toFixed(2) + ' g, peak cornering ' + s.latMax.toFixed(2) + ' g, top speed ' + speed(s.vmax) + '.', small: s.gDerived ? 'Worked out from GPS, as the file has no g readings, so treat these as a guide.' : '' });
    out.push(qualityNote(s));
    return out.filter(Boolean);
  }
  function cornerName(c) { return c.name ? c.name : 'corner ' + c.n; }
  function qualityNote(s) {
    var txt = s.hz + ' readings a second' + (s.sats ? ' from ' + s.sats + ' satellites on average' : '');
    if (s.quality === 'good') return { icon: 'sig', text: 'Good data: ' + txt + ', so the times and lines are reliable.', small: '' };
    if (s.quality === 'fair') return { icon: 'sig', text: 'Fair data: ' + txt + '. Lap times are fine; corner details are approximate.', small: '' };
    return { icon: 'sig', text: 'Rough data: ' + txt + '. Lap times are approximate and corner comparisons are left out.', small: 'A dedicated logger such as a RaceBox records 10 to 25 times a second.' };
  }

  // Sessions at one layout over time, with the mods fitted between them.
  // sessions: [{ id, date, bestTime, conditions, tyres, temp }]; mods:
  // [{ label, month, year }].
  function trendNotes(sessions, mods) {
    var dry = sessions.filter(function (s) { return s.bestTime && (s.conditions || 'Dry') === 'Dry'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var out = [];
    var wetCount = sessions.length - dry.length;
    if (dry.length < 2) {
      out.push({ icon: 'info', text: 'Trends use dry sessions only, so wet and damp days don\'t hide what changed. ' + (wetCount ? wetCount + ' of these ' + sessions.length + ' sessions ' + (wetCount > 1 ? 'were' : 'was') + ' wet or damp. ' : '') + 'Add another dry session here to see the difference.', small: '' });
      return out;
    }
    var steps = [];
    for (var i = 1; i < dry.length; i++) {
      var a = dry[i - 1], b = dry[i];
      var between = (mods || []).filter(function (m) { var md = m.year + '-' + pad(m.month || 1); return md >= a.date.slice(0, 7) && md <= b.date.slice(0, 7); });
      steps.push({ a: a, b: b, gain: round(a.bestTime - b.bestTime, 2), mods: between });
    }
    var big = steps.slice().sort(function (x, y) { return y.gain - x.gain; })[0];
    if (big && big.gain > 0.3) {
      var why = big.mods.length ? ' after ' + big.mods.map(function (m) { return m.label; }).join(' and ') + (big.mods.length > 1 ? ' were' : ' was') + ' fitted' : '';
      var caveat = [];
      if ((big.a.tyres || '') !== (big.b.tyres || '')) caveat.push('the tyres changed too');
      if (isFinite(big.a.temp) && isFinite(big.b.temp) && Math.abs(big.a.temp - big.b.temp) >= 8) caveat.push('it was ' + Math.abs(big.a.temp - big.b.temp) + '°C ' + (big.b.temp > big.a.temp ? 'warmer' : 'colder'));
      out.push({
        icon: 'up',
        text: 'Biggest step: ' + big.gain.toFixed(2) + ' s quicker on ' + niceDate(big.b.date) + why + '.',
        small: caveat.length ? 'Bear in mind ' + caveat.join(' and ') + '.' : big.mods.length ? 'Both sessions were dry, so the change is the most likely reason.' : 'No mods were fitted in between, so this is driving and conditions.'
      });
    }
    var first = dry[0], last = dry[dry.length - 1];
    if (last.bestTime < first.bestTime) out.push({ icon: 'flag', text: 'Since ' + niceDate(first.date) + ' you are ' + (first.bestTime - last.bestTime).toFixed(2) + ' s a lap quicker over ' + dry.length + ' dry sessions.', small: '' });
    var wet = sessions.length - dry.length;
    out.push({ icon: 'info', text: (wet ? wet + ' wet or damp session' + (wet > 1 ? 's are' : ' is') + ' shown but left out of the trend. ' : '') + 'These are observations from your data, not coaching. Weather, tyres, traffic and flags all change lap times.', small: '' });
    return out;
  }
  function niceDate(d) {
    var m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return d || '';
    return (+m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[1];
  }

  // Merges the admin's changes (KV) over data/tracks.json, by venue id.
  function mergeLibrary(base, extra) {
    var list = venues(base).map(function (v) { return v; });
    venues(extra).forEach(function (v) {
      var i = -1;
      list.forEach(function (x, k) { if (x.id === v.id) i = k; });
      if (v.removed) { if (i !== -1) list.splice(i, 1); return; }
      if (i === -1) list.push(v); else list[i] = v;
    });
    return { venues: list };
  }

  var api = {
    read: read, analyse: analyse, sessionNotes: sessionNotes, trendNotes: trendNotes, cornerGains: cornerGains,
    traceAt: traceAt, findCorners: findCorners, mergeLibrary: mergeLibrary, fmtLap: fmtLap, niceDate: niceDate,
    haversine: haversine, projector: projector, dragRuns: dragRuns, KMH_PER_MPH: KMH_PER_MPH
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MT3UKTrack = api;
})(typeof window !== 'undefined' ? window : globalThis);
