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
  // Goes up whenever a change here moves saved times. Sessions record the one that timed them,
  // so the admin's Re-time sessions knows which are out of date (none recorded means 1).
  // 2: GPX Start waypoint, drag clock matched to RaceBox with the rollout on, out lap not numbered.
  // 3: each lap keeps the car's own figures for that lap (Track Mode files).
  // 4: the battery start and end keep two decimals, so rounding to a whole percent happens once (60.48 shows as 60, not 61).
  // 5: cornering g worked out from the GPS path has the same sign as RaceBox's and the car's own readings.
  // 6: GPS readings that slip back along the road at speed are moved onto the line between the good ones (repairGlitches).
  // 7: a fix that freezes or creeps at speed and then jumps to catch up is mended too, and a drift is mended up to
  //    where the fix catches up rather than to the first reading past it; readings are spaced by the speeds.
  var ANALYSIS_VERSION = 7;
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
          // Degrees as minutes, longitude positive to the west. Some boxes write
          // each point as latitude then longitude, others as longitude then
          // latitude: latitude is the bigger number (about 3000 minutes in
          // the UK, against under 500 for longitude).
          var v = [num(p[1]), num(p[2]), num(p[3]), num(p[4])];
          function pt(x, y) { var latFirst = Math.abs(x) >= Math.abs(y); return [(latFirst ? x : y) / 60, -(latFirst ? y : x) / 60]; }
          var a = pt(v[0], v[1]), b = pt(v[2], v[3]);
          if (isFinite(a[0]) && isFinite(a[1]) && isFinite(b[0]) && isFinite(b[1])) {
            // Some boxes (the VBOX Touch) keep the start as two points about a metre apart: the
            // car's position and heading when it was set, so they run along the road, not across
            // it. A line under 10 m is made a 30 m line across that direction, through its middle.
            var pr = projector((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), xa = pr.xy(a[0], a[1]), xb = pr.xy(b[0], b[1]);
            var len = Math.hypot(xb[0] - xa[0], xb[1] - xa[1]);
            if (len > 0.05 && len < 10) {
              var ux = (xb[0] - xa[0]) / len * 15, uy = (xb[1] - xa[1]) / len * 15, cx = (xa[0] + xb[0]) / 2, cy = (xa[1] + xb[1]) / 2;
              a = pr.ll(cx + uy, cy - ux); b = pr.ll(cx - uy, cy + ux);
            }
            startLine = [a, b];
          }
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
  // Channels some loggers write beyond position and speed (Tesla Track Mode
  // does): state of charge, power, throttle, brake pressure, battery, brake and
  // inverter temperatures, tyre pressures and slip. Found by their headers.
  var EXTRA = {
    soc: /state of charge|\bsoc\b/, pwr: /^power( level)?\b|\bpower\b.*\bkw\b/, thr: /throttle/, bpr: /brake pressure/,
    bat: /battery temp/, brk: /brake temp/, inv: /inverter temp/, tpr: /(tire|tyre) pressure/, slp: /(tire|tyre) slip/
  };
  function extraCols(headers) {
    if (!headers) return null;
    var out = {}, any = false;
    headers.forEach(function (h, i) {
      Object.keys(EXTRA).forEach(function (k) {
        if (EXTRA[k].test(h)) { (out[k] = out[k] || []).push(i); any = true; }
      });
    });
    return any ? out : null;
  }
  function chVals(f, idx) {
    var v = [];
    (idx || []).forEach(function (i) { var n = num(f[i]); if (isFinite(n)) v.push(n); });
    return v;
  }
  // One point's extra channels: only what the file has.
  function chOf(f, xc) {
    var ch = {}, v;
    if ((v = chVals(f, xc.soc)).length) ch.soc = v[0];
    if ((v = chVals(f, xc.pwr)).length) ch.pwr = v[0];
    if ((v = chVals(f, xc.thr)).length) ch.thr = v[0];
    if ((v = chVals(f, xc.bpr)).length) ch.bpr = v[0];
    if ((v = chVals(f, xc.bat)).length) ch.bat = v[0];
    if ((v = chVals(f, xc.brk)).length) ch.brk = Math.max.apply(null, v);
    if ((v = chVals(f, xc.inv)).length) ch.inv = Math.max.apply(null, v);
    // Tyre pressure reads 0 until the sensors report: a zero is no reading.
    if ((v = chVals(f, xc.tpr)).length) { var tp = v.filter(function (n) { return n > 0; }); ch.tpr = tp.length ? tp.reduce(function (a, b) { return a + b; }, 0) / tp.length : 0; }
    if ((v = chVals(f, xc.slp)).length) ch.slp = Math.max.apply(null, v.map(Math.abs));
    return ch;
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
    var xc = mapping ? null : extraCols(headers);
    var unit = mapping && mapping.speedUnit ? mapping.speedUnit : (cols.speed >= 0 ? unitFromHeader(headers[cols.speed]) : '');
    var pts = [], startedAt = null, clockDays = 0, prev = null, lapOffset = 0, lastLap = null, step = 0;
    // Every time stamp the same, in a file that counts milliseconds (Track Mode writes files like this when its timer was
    // not running). The rows are evenly spaced, but the step differs between car software versions (80 ms in some, about
    // 21 ms in others), so it is worked out from the file: the speed times the step must add up to the distance the GPS
    // path covers. With no speed to go on it falls back to 80 ms.
    var flat = false, flatN = 0;
    if (/\(ms\)|\[ms\]|\bms\b|millis|msec/.test(headers[cols.time] || '')) {
      var seen = null, same = true, count = 0;
      for (var q0 = hi + 1; q0 < lines.length && same; q0++) {
        var tv = parseTime(splitCsv(lines[q0], delim)[cols.time]);
        if (!isFinite(tv.t)) continue;
        count++;
        if (seen === null) seen = tv.t; else if (tv.t !== seen) same = false;
      }
      flat = same && count >= 10;
    }
    var flatStep = 80;
    for (var r = hi + 1; r < lines.length; r++) {
      var f = splitCsv(lines[r], delim);
      var tm = parseTime(f[cols.time]);
      if (flat && isFinite(tm.t)) tm = { t: flatN++ };
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
      var chp = xc ? chOf(f, xc) : null;
      pts.push({ ch: chp, t: t, lat: lat, lng: lng, v: cols.speed >= 0 ? num(f[cols.speed]) : NaN, la: cols.la >= 0 ? num(f[cols.la]) : NaN, lo: cols.lo >= 0 ? num(f[cols.lo]) : NaN, sats: cols.sats >= 0 ? num(f[cols.sats]) : NaN, temp: cols.temp >= 0 ? num(f[cols.temp]) : NaN, lap: cols.lap >= 0 ? num(f[cols.lap]) : NaN, abs: !!tm.abs });
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
    if (flat) {
      var toMs = unit === 'mph' ? 0.44704 : unit === 'km/h' ? 1 / 3.6 : unit === 'knots' ? 0.514444 : unit === 'm/s' ? 1 : 0;
      var path = 0, vsum = 0;
      for (var z = 1; z < pts.length; z++) {
        path += haversine(pts[z - 1], pts[z]);
        if (isFinite(pts[z].v) && isFinite(pts[z - 1].v)) vsum += (pts[z].v + pts[z - 1].v) / 2 * toMs;
      }
      // Seconds per row; kept within what a car logger does (5 to 250 ms), else 80 ms.
      var step = toMs && vsum > 0 && path > 50 ? path / vsum : 0.08;
      if (!(step >= 0.005 && step <= 0.25)) step = 0.08;
      flatStep = step * 1000;
      pts.forEach(function (p) { p.t *= flatStep; });
    }
    if (ms) pts.forEach(function (p) { p.t /= 1000; });
    // Acceleration in m/s² rather than g.
    if (cols.la >= 0 && /m\/s/.test(headers ? headers[cols.la] || '' : '')) pts.forEach(function (p) { p.la /= 9.81; });
    if (cols.lo >= 0 && /m\/s/.test(headers ? headers[cols.lo] || '' : '')) pts.forEach(function (p) { p.lo /= 9.81; });
    var t0 = pts[0].t;
    pts.forEach(function (p) { p.t -= t0; delete p.abs; });
    var fileLine = cols.lap >= 0 ? lineFromLaps(pts) : null;
    pts.forEach(function (p) { delete p.lap; if (!p.ch) delete p.ch; });
    var venue = '';
    lines.slice(0, Math.max(hi, 0)).forEach(function (l) { var m = l.match(/(?:venue|track|circuit)\s*[:,]\s*"?([^",]+)/i); if (m && !venue) venue = m[1].trim(); });
    return { format: 'CSV', points: pts, startLine: fileLine, venueName: venue, startedAt: startedAt, speedUnit: unit, timeRebuilt: flat, rebuiltStep: flat ? flatStep / 1000 : 0, columns: cols, tempF: cols.temp >= 0 && /(°|deg|\b)f\b|fahrenheit/.test(headers[cols.temp]) };
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

  // RaceBox writes its start line as a waypoint named "Start". Turned into a
  // line across the trace there, so laps are cut where RaceBox cuts them.
  function gpxStartLine(text, pts) {
    var m = /<wpt\b([^>]*)>\s*<name>\s*Start\s*<\/name>/i.exec(text);
    if (!m) return null;
    var lat = num((m[1].match(/lat="([^"]+)"/) || [])[1]), lng = num((m[1].match(/lon="([^"]+)"/) || [])[1]);
    if (!isFinite(lat) || !isFinite(lng) || pts.length < 20) return null;
    var proj = projector(lat, lng), best = -1, bd = Infinity;
    var xy = pts.map(function (p) { return proj.xy(p.lat, p.lng); });
    for (var i = 0; i < xy.length; i++) { var d = Math.hypot(xy[i][0], xy[i][1]); if (d < bd) { bd = d; best = i; } }
    // Not on the trace (a different track's file): leave it.
    if (bd > 30 || best < 0) return null;
    var a = xy[Math.max(0, best - 8)], b = xy[Math.min(xy.length - 1, best + 8)];
    var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1) return null;
    var nx = -dy / L * 15, ny = dx / L * 15;
    return [proj.ll(nx, ny), proj.ll(-nx, -ny)];
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
    return { format: 'GPX', points: pts, startLine: gpxStartLine(text, pts), venueName: name, startedAt: a0, speedUnit: 'km/h' };
  }

  // savedAt (optional): when the file was last saved on the device, from
  // the browser. Used for the date only when the file and its name have
  // none, taking the session to have ended when the file was saved.
  function read(text, fileName, mapping, savedAt) {
    text = String(text || '').replace(/^﻿/, '');
    var name = String(fileName || '').toLowerCase();
    var out;
    if (/\.vbo$/.test(name) || /^\s*(file created|\[header\])/i.test(text) && /\[data\]/i.test(text)) out = readVbo(text);
    else if (/\.gpx$/.test(name) || /<gpx[\s>]/i.test(text.slice(0, 2000))) out = readGpx(text);
    else out = readCsv(text, mapping);
    if (out.needsMapping) return out;
    finishPoints(out);
    if (!out.startedAt) {
      var fd = dateFromName(fileName);
      if (fd) { out.fileDate = fd.date; out.fileTime = fd.time; out.dateSrc = 'name'; }
      else if (savedAt > 0 && out.points.length) {
        var began = savedAt - out.points[out.points.length - 1].t * 1000;
        out.fileDate = ukDate(began); out.fileTime = ukTime(began); out.dateSrc = 'saved';
      }
    } else out.dateSrc = 'file';
    return out;
  }

  // Several files from one day (a lap timer writes one per time out) as one
  // reading: in time order, each carrying on 5 minutes after the last, with
  // every point marked with its run. Laps never span two runs. Throws when
  // the files are from different days.
  var RUN_GAP = 300;
  function combine(rds) {
    if (rds.length === 1) return rds[0];
    function dayOf(rd) { return rd.startedAt ? ukDate(rd.startedAt) : rd.fileDate || ''; }
    function when(rd, i) { return rd.startedAt || (rd.fileDate ? Date.parse(rd.fileDate + 'T' + (rd.fileTime || '00:00') + ':00Z') : 0) || i; }
    var days = rds.map(dayOf).filter(Boolean);
    if (days.some(function (d) { return d !== days[0]; })) throw new Error('These files are from different days. Add one day at a time.');
    var order = rds.map(function (rd, i) { return { rd: rd, k: when(rd, i), i: i }; }).sort(function (x, y) { return x.k - y.k || x.i - y.i; });
    var pts = [], offset = 0;
    order.forEach(function (o, n) {
      var src = o.rd.points;
      src.forEach(function (p) { var q = Object.assign({}, p); q.t = p.t + offset; q.run = n + 1; pts.push(q); });
      offset = pts[pts.length - 1].t + RUN_GAP;
    });
    var first = order[0].rd;
    var out = Object.assign({}, first, { points: pts, runs: order.length });
    out.startLine = (order.filter(function (o) { return o.rd.startLine; })[0] || {}).rd ? order.filter(function (o) { return o.rd.startLine; })[0].rd.startLine : null;
    out.venueName = (order.filter(function (o) { return o.rd.venueName; })[0] || { rd: first }).rd.venueName || '';
    out.speedDerived = order.some(function (o) { return o.rd.speedDerived; });
    out.gDerived = order.some(function (o) { return o.rd.gDerived; });
    return out;
  }


  // ---------- Two files from one session ----------
  // A lap timer (RaceBox, Racelogic) times and places the laps best; Track Mode has the car's own channels. Given both
  // readings of the same session, line them up by their speed traces and carry the car's channels onto the timed
  // readings, so the laps stay the lap timer's and each lap gets the car's figures.

  // Speed at evenly spaced times (km/h), by linear interpolation. t0 is the first time, step in seconds.
  function speedGrid(pts, step) {
    var t0 = pts[0].t, n = Math.floor((pts[pts.length - 1].t - t0) / step) + 1, out = new Array(n), j = 0;
    for (var i = 0; i < n; i++) {
      var t = t0 + i * step;
      while (j < pts.length - 2 && pts[j + 1].t < t) j++;
      var a = pts[j], b = pts[j + 1] || a, f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      f = Math.max(0, Math.min(1, f));
      out[i] = (isFinite(a.v) ? a.v : 0) + ((isFinite(b.v) ? b.v : 0) - (isFinite(a.v) ? a.v : 0)) * f;
    }
    return { t0: t0, step: step, v: out };
  }
  // Correlation of A(t) with B(t - shift) over the time both cover; null when they overlap too little or are flat.
  function corrAt(A, B, shift, minOverlap) {
    var k = Math.round(shift / A.step), i0 = Math.max(0, k), i1 = Math.min(A.v.length, k + B.v.length);
    var n = i1 - i0;
    if (n * A.step < minOverlap) return null;
    var sa = 0, sb = 0, i;
    for (i = i0; i < i1; i++) { sa += A.v[i]; sb += B.v[i - k]; }
    var ma = sa / n, mb = sb / n, saa = 0, sbb = 0, sab = 0;
    for (i = i0; i < i1; i++) { var da = A.v[i] - ma, db = B.v[i - k] - mb; saa += da * da; sbb += db * db; sab += da * db; }
    if (saa / n < 25 || sbb / n < 25) return null; // a speed spread under 5 km/h: nothing to match
    return sab / Math.sqrt(saa * sbb);
  }
  // Where the car file starts on the timed file's clock (seconds), found from the two speed traces. Returns
  // { shift, corr, second, overlap } or null. second is the best match more than 10 s away from the chosen one: a
  // match is only trusted when it clearly stands out from that.
  function alignSpeeds(timed, car) {
    if (timed.length < 20 || car.length < 20) return null;
    var A = speedGrid(timed, 1), B = speedGrid(car, 1);
    var dA = A.v.length, dB = B.v.length, minOver = Math.min(60, Math.min(dA, dB) * 0.5);
    var best = null, scores = [];
    // Two files from one session start within minutes of each other; a window of half an hour either way keeps a
    // whole day's file from taking seconds to search.
    for (var k = Math.max(-(dB - 1), -1800); k < Math.min(dA, 1800); k++) {
      var c = corrAt(A, B, k, minOver);
      if (c === null) continue;
      scores.push([k, c]);
      if (!best || c > best.c) best = { k: k, c: c };
    }
    if (!best) return null;
    var second = -1;
    scores.forEach(function (x) { if (Math.abs(x[0] - best.k) > 10 && x[1] > second) second = x[1]; });
    // Refine to a tenth of a second around the whole-second best.
    var A2 = speedGrid(timed, 0.1), B2 = speedGrid(car, 0.1), fine = { s: best.k, c: best.c };
    for (var s = best.k - 1.5; s <= best.k + 1.5; s += 0.1) {
      var c2 = corrAt(A2, B2, s, minOver);
      if (c2 !== null && c2 > fine.c - 1e-9 && c2 >= fine.c) fine = { s: s, c: c2 };
    }
    // The car's t = 0 sits at timed time timed[0].t + shift - car[0].t, on the timed clock.
    return { shift: (timed[0].t - car[0].t) + fine.s, corr: fine.c, second: second, overlap: Math.min(dA, dB) };
  }
  // The timed reading with the car's channels on it, or { reason } when the two do not line up reliably.
  function mergeSources(timed, car) {
    var carPts = car.points.filter(function (p) { return p.ch; });
    if (!carPts.length) return { reason: 'The second file has no car data.' };
    if (timed.points.some(function (p) { return p.ch; })) return { reason: 'The first file already has car data.' };
    var m = alignSpeeds(timed.points, car.points);
    if (!m) return { reason: 'There is not enough movement in both files to line them up.' };
    var margin = m.corr - Math.max(m.second, 0);
    if (m.corr < 0.9 || margin < 0.03) return { reason: 'The two files do not line up reliably (match ' + m.corr.toFixed(2) + ').', corr: m.corr };
    // The places must agree too: the car's GPS is coarser, so allow for that.
    var ds = [];
    for (var i = 0; i < timed.points.length; i += Math.max(1, Math.floor(timed.points.length / 60))) {
      var tp = timed.points[i], tc = tp.t - m.shift, lo = 0, hi = car.points.length - 1;
      if (tc < car.points[0].t || tc > car.points[hi].t) continue;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (car.points[mid].t < tc) lo = mid + 1; else hi = mid; }
      ds.push(haversine(tp, car.points[lo]));
    }
    ds.sort(function (a, b) { return a - b; });
    if (ds.length >= 5 && ds[ds.length >> 1] > 150) return { reason: 'The two files are not in the same place.', corr: m.corr };
    // Where the timed file only has speed and g-force worked out from GPS positions (a GPX has no speed of its own),
    // the car's own readings are better: its g-forces come from a sensor, not from differences of noisy positions.
    var useSpeed = !!timed.speedDerived && !car.speedDerived && car.points.some(function (p) { return isFinite(p.v); });
    var useG = !!timed.gDerived && !car.gDerived && car.points.some(function (p) { return isFinite(p.la) && isFinite(p.lo); });
    var pts = timed.points.map(function (p) {
      var tc = p.t - m.shift, q = Object.assign({}, p);
      if (tc < car.points[0].t - 0.5 || tc > car.points[car.points.length - 1].t + 0.5) return q;
      var lo = 0, hi = car.points.length - 1;
      while (lo < hi) { var mid2 = (lo + hi) >> 1; if (car.points[mid2].t < tc) lo = mid2 + 1; else hi = mid2; }
      var b = car.points[lo], a = car.points[Math.max(0, lo - 1)], f = b.t > a.t ? Math.max(0, Math.min(1, (tc - a.t) / (b.t - a.t))) : 0;
      function mix(x, y) { return isFinite(x) && isFinite(y) ? x + (y - x) * f : isFinite(y) ? y : x; }
      if (useSpeed) q.v = mix(a.v, b.v);
      if (useG) { q.la = mix(a.la, b.la); q.lo = mix(a.lo, b.lo); }
      if (!a.ch || !b.ch) { if (b.ch) q.ch = Object.assign({}, b.ch); else if (a.ch) q.ch = Object.assign({}, a.ch); return q; }
      var ch = {};
      Object.keys(b.ch).forEach(function (k) {
        var x = a.ch[k], y = b.ch[k];
        ch[k] = isFinite(x) && isFinite(y) ? x + (y - x) * f : y;
      });
      q.ch = ch;
      return q;
    });
    var out = Object.assign({}, timed, { points: pts });
    out.carSource = { shift: round(m.shift, 2), match: round(m.corr, 3) };
    if (useSpeed) { out.speedDerived = false; out.carSource.speed = true; }
    if (useG) { out.gDerived = false; out.carSource.g = true; }
    return { rd: out, shift: m.shift, corr: m.corr };
  }

  // A date (and time) in the file name, for files with none inside, such as
  // Tesla Track Mode's telemetry-v1-2024-03-29-15_39_08.csv. Taken as UK
  // local time.
  function dateFromName(name) {
    var n = String(name || '').replace(/^.*[\\/]/, '');
    // Day first, as RaceBox names its files: RaceBox_Track_Session_on_14-07-2026_10-10.vbo.
    var dm = n.match(/(?:^|[^\d])(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-(20\d\d)(?:[-_T ]+([01]\d|2[0-3])[-_:.]?([0-5]\d))?/);
    if (dm && isFinite(Date.parse(dm[3] + '-' + dm[2] + '-' + dm[1] + 'T00:00:00Z'))) return { date: dm[3] + '-' + dm[2] + '-' + dm[1], time: dm[4] ? dm[4] + ':' + dm[5] : '' };
    var m = n.match(/(20\d\d)[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[-_T ]+([01]\d|2[0-3])[-_:.]?([0-5]\d)(?:[-_:.]?([0-5]\d))?)?/);
    if (!m) return null;
    var d = m[1] + '-' + m[2] + '-' + m[3];
    if (!isFinite(Date.parse(d + 'T00:00:00Z'))) return null;
    return { date: d, time: m[4] ? m[4] + ':' + m[5] : '' };
  }

  // A GPS fix can lose its lock for a few seconds, usually in a tight corner, while the car carries on.
  // The position then drifts back along the road (a spike in the line, and distances and crossings that
  // go wrong), or freezes, or creeps at half pace, and then jumps to catch up. All are mended the same
  // way: once the fix is back where the speeds say the car is, the readings since the last good fix are
  // put onto the straight line between that fix and this one, spaced by the distance the speeds give.
  // Times and speeds are not touched. Returns how many readings were moved.
  // A drift is spotted by comparing each reading with the furthest point the car had reached along the
  // way it was going (taken over the last 6 m or more): one more than 1.5 m behind that point, within
  // 5 m of the line, with the car over 20 km/h at both, when the speeds say it has gone on at least 3 m. A freeze is
  // spotted when, over the last half second, the speeds say 6 m or more but the fix has moved under 40%
  // of that (clean driving never gives under 60%). Either ends at the first reading at least 80% as far
  // from the last good fix as the speeds say the car has gone. One that takes more than 5 s is left as
  // it is: that is a lost signal, not a blip. A real hairpin is never a drift, as its far side is a car's
  // width or more away from the line in.
  function repairGlitches(pts) {
    if (pts.length < 20) return 0;
    var lat0 = pts[0].lat, lng0 = pts[0].lng, kx = 111195 * Math.cos(lat0 * DEG), ky = 111195, fixed = 0;
    function X(p) { return (p.lng - lng0) * kx; }
    function Y(p) { return (p.lat - lat0) * ky; }
    function dist(a, b) { return Math.hypot(X(a) - X(b), Y(a) - Y(b)); }
    // How far the speeds say the car had gone by each reading.
    var S = [0];
    for (var k = 1; k < pts.length; k++) {
      var va = pts[k - 1].v, vb = pts[k].v;
      S[k] = S[k - 1] + (isFinite(va) && isFinite(vb) ? Math.max(0, (va + vb) / 2) / 3.6 * Math.max(0, pts[k].t - pts[k - 1].t) : 0);
    }
    function mend(g, i) {
      var q = pts[g], p = pts[i], byS = S[i] - S[g] > 0;
      for (var j = g + 1; j < i; j++) {
        var f = byS ? (S[j] - S[g]) / (S[i] - S[g]) : (pts[j].t - q.t) / ((p.t - q.t) || 1);
        pts[j].lat = q.lat + (p.lat - q.lat) * f;
        pts[j].lng = q.lng + (p.lng - q.lng) * f;
        fixed++;
      }
    }
    var g = 0, anchor = 0, tail = 0, mode = '';
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i], q = pts[g];
      if (p.t - q.t >= 5) { g = i; mode = ''; continue; }
      var went = S[i] - S[g];
      if (mode) {
        if (dist(p, q) >= 0.8 * went) { mend(g, i); g = i; mode = ''; }
        continue;
      }
      while (anchor < g && dist(q, pts[anchor + 1]) >= 6) anchor++;
      var dx = X(q) - X(pts[anchor]), dy = Y(q) - Y(pts[anchor]), L = Math.hypot(dx, dy), along = 1, side = 0;
      if (L >= 6) {
        var ex = X(p) - X(q), ey = Y(p) - Y(q);
        along = (ex * dx + ey * dy) / L; side = Math.abs((ex * dy - ey * dx) / L);
        // (Both at speed: a car backing up to a start line and driving off is not a drift.)
        if (along < -1.5 && side <= 5 && p.v > 20 && q.v > 20 && went > 3) { mode = 'drift'; continue; }
      }
      while (tail < i && p.t - pts[tail].t > 0.5) tail++;
      var wentHalf = S[i] - S[tail];
      // (Not from a standing start: wheels spinning at the launch would look like a frozen fix.)
      if (p.v > 20 && pts[tail].v > 20 && wentHalf >= 6 && dist(p, pts[tail]) < 0.4 * wentHalf) {
        // Back to the first reading at the spot the fix stuck on, so the whole stretch is spread out.
        g = tail;
        while (g > 0 && dist(pts[g - 1], pts[tail]) < 1 && pts[tail].t - pts[g - 1].t < 1) g--;
        anchor = Math.min(anchor, g); mode = 'freeze'; continue;
      }
      // Not past the furthest point yet, and not turning away either: the furthest point stands.
      if (L >= 6 && along <= 0 && side <= 5) continue;
      g = i;
    }
    return fixed;
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
    out.glitches = repairGlitches(pts);
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
        // Negative, so a corner one way has the same sign as RaceBox and Track Mode give it (checked against both).
        la.push(-pts[z].v / 3.6 * dh / dtt / 9.81);
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
      if (p.run !== q.run) continue;
      var d1 = o(A, B, [p.x, p.y]), d2 = o(A, B, [q.x, q.y]), d3 = o([p.x, p.y], [q.x, q.y], A), d4 = o([p.x, p.y], [q.x, q.y], B);
      // A reading exactly on the line (a straight road, positions rounded) counts as one crossing, not none.
      if ((d1 <= 0) !== (d2 <= 0) && (d3 <= 0) !== (d4 <= 0)) {
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
      // A "lap" across the gap between two files isn't one.
      if (points[s.i].run !== points[Math.max(s.i, e.i - 1)].run) continue;
      var vmax = 0, vmin = Infinity;
      for (var k = s.i; k < e.i; k++) { vmax = Math.max(vmax, points[k].v); vmin = Math.min(vmin, points[k].v); }
      var lap = { n: laps.length + 1, run: points[s.i].run || undefined, start: s.t, time: round(e.t - s.t, 3), dist: Math.round(e.d - s.d), vmax: round(vmax, 1), vmin: round(vmin, 1), i0: s.i, i1: e.i, d0: s.d };
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

  // rollout: metres the car moves before the clock starts (0.3048 for the 1 ft rollout of strip timing
  // lights and RaceBox's option); 0 times from the first movement.
  // RaceBox's 1 ft rollout, found by fitting its own times: on files with real speed readings its clock
  // starts once the car has travelled about 0.16 m from the first movement (three runs across two
  // sessions agreed to within 1 cm). Where the speed is only worked out from positions, which smooths
  // the launch, it matches a start at about 6 km/h instead.
  var ROLLOUT_METRES = 0.16;
  var ROLLOUT_START_KMH = 6;
  function dragRuns(points, rollout, speedDerived) {
    var runs = [];
    rollout = rollout > 0 ? rollout : 0;
    for (var i = 1; i < points.length; i++) {
      if (!(points[i - 1].v < 2 && points[i].v >= 2)) continue;
      // Stood still for at least half a second first.
      var still = 0;
      for (var b = i - 1; b > 0 && points[b].v < 2; b--) still = points[i - 1].t - points[b].t;
      if (still < 0.5 && i > 5) continue;
      var t0 = points[i - 1].t, j = i;
      // With the rollout on, RaceBox starts its clock a little after the first movement (see above).
      if (rollout && speedDerived) {
        while (j < points.length && points[j].v < ROLLOUT_START_KMH) j++;
        if (j >= points.length) continue;
        var pj = points[j - 1];
        t0 = pj.t + (ROLLOUT_START_KMH - pj.v) / ((points[j].v - pj.v) || 1) * (points[j].t - pj.t);
      } else if (rollout) {
        // Distance from the first reading above 2 km/h. A gap in the readings or a stop starts it again.
        var rx = 0, found = false;
        for (j = i + 1; j < points.length; j++) {
          var rp = points[j - 1], rq = points[j], rdt = rq.t - rp.t;
          if (rdt > 0.3 || rq.v < 2) { rx = 0; continue; }
          var rn = rx + (rp.v + rq.v) / 2 / 3.6 * rdt;
          if (rn >= ROLLOUT_METRES) { t0 = rp.t + (ROLLOUT_METRES - rx) / ((rn - rx) || 1) * rdt; found = true; break; }
          rx = rn;
        }
        if (!found) continue;
        // The loop below goes on from the reading after the start.
        j = Math.max(i, j);
      }
      var base = t0, rolled = true, x = 0, vmax = 0, out = { start: t0, lat: points[i].lat, lng: points[i].lng, curve: [[0, 0]] };
      var marks = { ft60: 18.288, eighth: 201.168, quarter: 402.336 }, sp = { s30: 30 * KMH_PER_MPH, s60: 60 * KMH_PER_MPH, s100: 100 * KMH_PER_MPH, k100: 100 };
      var lastCurve = 0;
      for (var k = j; k < points.length; k++) {
        var p = rollout && k === j ? { t: t0, v: points[k - 1].v + (points[k].v - points[k - 1].v) * ((t0 - points[k - 1].t) / ((points[k].t - points[k - 1].t) || 1)) } : points[k - 1], q = points[k], dt = q.t - p.t;
        var nx = x + (p.v + q.v) / 2 / 3.6 * dt;
        if (!rolled && nx >= rollout) { rolled = true; base = p.t + (rollout - x) / ((nx - x) || 1) * dt; }
        Object.keys(marks).forEach(function (m) { if (!out[m] && nx >= marks[m]) { var f = (marks[m] - x) / ((nx - x) || 1); out[m] = round(p.t + f * dt - base, 2); out[m + 'Speed'] = round(p.v + f * (q.v - p.v), 1); } });
        Object.keys(sp).forEach(function (m) { if (!out[m] && rolled && q.v >= sp[m]) { var f = (sp[m] - p.v) / ((q.v - p.v) || 1); out[m] = round(p.t + f * dt - base, 2); } });
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
      // Only a known drag strip makes it a drag run. Anywhere else a standing start is as likely a
      // sprint or a hill climb, so the member picks the type.
      else type = 'track';
    }
    var session = { analysisVersion: ANALYSIS_VERSION, type: type, format: rd.format, hz: rd.hz, sats: rd.sats, quality: rd.quality, startedAt: rd.startedAt || null, venueName: rd.venueName || '', speedDerived: !!rd.speedDerived, gDerived: !!rd.gDerived };
    if (rd.startedAt) session.date = ukDate(rd.startedAt), session.time = ukTime(rd.startedAt), session.dateFrom = 'file';
    else if (rd.fileDate) { session.date = rd.fileDate; session.time = rd.fileTime || ''; session.dateFrom = rd.dateSrc || 'name'; }
    if (rd.airTemp != null) session.airTemp = rd.airTemp;
    if (venue) { session.venueId = venue.id; session.venue = venue.name; }
    var origin = venue ? [venue.lat, venue.lng] : [pts[0].lat, pts[0].lng];
    var proj = projector(origin[0], origin[1]);
    prepare(pts, proj);
    var cdata = carData(pts);
    // A day made from several files: the same figures for each file too, so the
    // page can show one session's figures at a time.
    if (cdata && pts.length && pts[pts.length - 1].run > 1) {
      var byRun = {};
      pts.forEach(function (p) { (byRun[p.run || 1] = byRun[p.run || 1] || []).push(p); });
      cdata.runs = Object.keys(byRun).map(Number).sort(function (a, b) { return a - b; }).map(function (r) {
        var rp = byRun[r], t0 = rp[0].t;
        // Each file's own clock, so its thirds (for held-back power) are its own.
        var one = carData(rp.map(function (p) { return { t: p.t - t0, ch: p.ch }; }));
        if (!one) return null;
        delete one.found; delete one.empty;
        one.run = r;
        return one;
      }).filter(Boolean);
      if (cdata.runs.length < 2) delete cdata.runs;
    }
    if (cdata) session.carData = cdata;
    // Joined from a lap timer file and a Track Mode file: which, and how well they lined up.
    if (rd.carSource) session.carSource = rd.carSource;
    session.duration = round(pts[pts.length - 1].t, 1);
    session.distance = Math.round(pts[pts.length - 1].d);
    // A loop, not Math.max.apply: a day of files can be well over 100,000
    // readings, more arguments than a browser allows in one call.
    var vmax = -Infinity, latMax = -Infinity, loMin = Infinity, loMax = -Infinity;
    // The g figures come from the file's own readings, but one wild reading
    // (a bump, or a logger glitch when stopped) is not a car's grip: each is the
    // middle of three in a row, and cornering is only counted when moving.
    function mid3(x, y, z) { return x > y ? (y > z ? y : (x > z ? z : x)) : (x > z ? x : (y > z ? z : y)); }
    for (var pi = 0; pi < pts.length; pi++) {
      var pp = pts[pi];
      if (pp.v > vmax) vmax = pp.v;
      var pa = pts[pi > 0 ? pi - 1 : pi], pn = pts[pi < pts.length - 1 ? pi + 1 : pi];
      var laM = mid3(pa.la, pp.la, pn.la), loM = mid3(pa.lo, pp.lo, pn.lo);
      if (pp.v >= 15 && Math.abs(laM) > latMax) latMax = Math.abs(laM);
      if (loM < loMin) loMin = loM;
      if (loM > loMax) loMax = loM;
    }
    if (latMax === -Infinity) latMax = 0;
    session.vmax = round(vmax, 1);
    session.latMax = round(latMax, 2);
    session.brakeMax = round(-loMin, 2);
    session.accMax = round(loMax, 2);
    session.origin = origin;

    if (type === 'drag') {
      var dv = venue && venue.type === 'drag' ? venue : findVenue(pts, library, 'drag');
      session.atVenue = !!dv;
      if (dv) { session.venueId = dv.id; session.venue = dv.name; }
      session.runs = dragRuns(pts, !!opts.rollout, !!rd.speedDerived);
      if (opts.rollout) session.rollout = true;
      // The drive's path, for the map on a street run (the worker keeps it only for those).
      session.trace = { outline: outline(pts) };
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
    function evalLine(c) {
      var cr = crossings(pts, proj, c.line, minGap);
      if (cr.length < 2) return;
      var laps = buildLaps(pts, cr);
      var med = median(laps.map(function (l) { return l.dist; }));
      var lengthScore = c.layout && c.layout.length ? Math.abs(med - c.layout.length) / c.layout.length : 0.05;
      if (c.layout && lengthScore > 0.12) return;
      var score = laps.length - lengthScore * 10 + (c.layout ? 1 : 0);
      if (!choice || score > choice.score) choice = { c: c, cr: cr, score: score, med: med };
    }
    // A listed layout's own start line wins; the file's or the member's line is only a fallback.
    candidates.filter(function (c) { return c.layout; }).forEach(evalLine);
    if (!choice) candidates.filter(function (c) { return !c.layout; }).forEach(evalLine);
    // A track day needs no start line from the member: with none from the
    // track, the file or the member, the lap line is found from the trace (the
    // place on it that the car crosses most often, and fastest).
    if (!choice && type === 'track') {
      var auto = autoLapLine(pts, proj, minGap);
      if (auto) choice = { c: { layout: null, line: auto.line, sectors: [], auto: true }, cr: auto.cr, score: auto.cr.length, med: median(buildLaps(pts, auto.cr).map(function (l) { return l.dist; })) };
    }
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
        if (l.startLine) return best;
        var e = l.length ? Math.abs(choice.med - l.length) / l.length : 1;
        return e < 0.12 && (!best || e < best.e) ? { l: l, e: e } : best;
      }, null);
      layout = layout && layout.l;
    }
    if (layout) { session.layoutId = layout.id; session.layout = layout.name; }
    session.startLine = choice.c.line;
    if (choice.c.own) session.startLineFromMember = true; else if (choice.c.auto) session.autoLine = true; else if (choice.c.layout) session.officialLines = true;
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
    // The organiser (B19, say) says which course at the venue this was: the
    // same venue can have courses with different start and finish lines.
    var org = String(opts.organizer || '').trim().toLowerCase();
    function ofOrganiser(l) { return !org || String(l.organizer || l.name || '').trim().toLowerCase() === org; }
    ((sv && sv.layouts) || []).forEach(function (l) { if (l.startLine && l.finishLine && ofOrganiser(l)) cands.push({ layout: l, start: l.startLine, finish: l.finishLine }); });
    if (opts.startLine && opts.finishLine) cands.push({ layout: null, start: opts.startLine, finish: opts.finishLine, own: true });
    var pick = null;
    function mid(line) { var a = proj.xy(line[0][0], line[0][1]), b = proj.xy(line[1][0], line[1][1]); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    function evalCand(c) {
      var st = crossings(pts, proj, c.start, 5), fi = crossings(pts, proj, c.finish, 5);
      // Each finish ends the run that began at the last start crossing since
      // the previous finish (in the same file).
      function pairUp(fin) {
        var out = [], lastEnd = -Infinity;
        fin.forEach(function (f) {
          var a = null;
          st.forEach(function (x) { if (x.t > lastEnd && x.t + 3 < f.t && f.t - x.t < 900 && pts[x.i].run === pts[f.i].run) a = x; });
          if (a) { out.push([a, f]); lastEnd = f.t; }
        });
        return out;
      }
      // opts.finishCrossing (1 to 9): the run ends on that crossing of the
      // finish line after the start, whatever else it crosses on the way.
      function pairNth(n) {
        var out = [], lastEnd = -Infinity;
        st.forEach(function (x) {
          if (x.t <= lastEnd) return;
          var after = fi.filter(function (f) { return f.t > x.t + 3 && f.t - x.t < 900 && pts[f.i].run === pts[x.i].run; });
          if (after.length >= n) { out.push([x, after[n - 1]]); lastEnd = after[n - 1].t; }
        });
        return out;
      }
      var fc = opts.finishCrossing >= 1 ? Math.min(9, Math.round(opts.finishCrossing)) : 0;
      var pairs = fc ? pairNth(fc) : pairUp(fi), skipped = 0, climb = false;
      // A hill climb runs point to point: the finish is far from the start
      // compared with the run itself. A sprint loops back past the finish, so
      // there the first crossing can optionally be ignored (a file with just
      // one crossing keeps it).
      var ms = mid(c.start), mf = mid(c.finish), sep = Math.hypot(ms[0] - mf[0], ms[1] - mf[1]);
      var runLen = c.layout && c.layout.length ? c.layout.length : median(pairs.map(function (pr) { return pr[1].d - pr[0].d; }));
      climb = !!(pairs.length && runLen && sep > 0.6 * runLen);
      // Only a run that crosses the finish more than once has a crossing to skip, so this
      // is safe on a point-to-point course too (whatever the course looks like from its size).
      var stopsIn = fc ? [] : standstills(pts);
      if (!fc && (opts.ignoreFirstFinish || stopsIn.length)) {
        // Between stops the car is on one run. A run starts when the car crosses the start line (the
        // first crossing after the last run ended) and ends on the first finish crossing after that, or
        // the second when the first is skipped. A loop that passes the start again is still that run.
        var stopAt = stopsIn, skipPairs = [];
        if (stopAt.length) {
          // Each stretch between two stops is one possible run: it starts at the first start crossing
          // in it (the launch) and ends on the finish crossing after that.
          var edges = [[-Infinity, stopAt[0][0]]];
          for (var si = 0; si < stopAt.length; si++) edges.push([stopAt[si][1], si + 1 < stopAt.length ? stopAt[si + 1][0] : Infinity]);
          // Start line as a segment in metres, to tell whether the launch happened at it.
          var sa = proj.xy(c.start[0][0], c.start[0][1]), sb = proj.xy(c.start[1][0], c.start[1][1]);
          function startDist(p) {
            var vx = sb[0] - sa[0], vy = sb[1] - sa[1], L2 = vx * vx + vy * vy || 1;
            var u = Math.max(0, Math.min(1, ((p.x - sa[0]) * vx + (p.y - sa[1]) * vy) / L2));
            return Math.hypot(p.x - (sa[0] + u * vx), p.y - (sa[1] + u * vy));
          }
          function nearStart(p) { return startDist(p) <= 25; }
          edges.forEach(function (seg, ei) {
            // A run starts at the launch (the car moving off after a stop). The start line counts when it
            // is crossed within a few seconds of that, or when the car launched from right at it, so the
            // exact place the line was drawn does not change the result. Back-to-back runs with no stop
            // between them each count after that.
            var cursor = seg[0] - 2.5, first = true;
            for (var guard = 0; guard < 50; guard++) {
              var x = st.filter(function (cr) { return cr.t > cursor && cr.t < seg[1]; })[0];
              if (first && ei > 0) {
                var launchIdx = 0;
                while (launchIdx < pts.length - 1 && pts[launchIdx].t < seg[0]) launchIdx++;
                if (x && x.t > seg[0] + 25) x = null;
                if (!x && nearStart(pts[launchIdx])) x = { i: launchIdx, t: seg[0], d: pts[launchIdx].d };
              }
              if (x && first && ei > 0) {
                // A standing start from at or just behind the line is timed from the moment the car moves
                // off, not from the moment its front crosses a marker drawn some metres further on: where
                // the marker sits (20 m on is two seconds) then does not change the time.
                var k = 0;
                while (k < pts.length - 1 && pts[k].t < seg[0]) k++;
                while (k > 0 && pts[k - 1].v > 0.5) k--;
                if (pts[k].t < x.t && x.t - pts[k].t < 8 && startDist(pts[k]) <= 40) x = { i: k, t: pts[k].t, d: pts[k].d };
              }
              first = false;
              if (!x) break;
              var after = fi.filter(function (f) { return f.t > x.t + 3 && f.t < seg[1] && f.t - x.t < 900 && pts[f.i].run === pts[x.i].run; });
              if (!after.length) { cursor = x.t; continue; }
              var end = opts.ignoreFirstFinish && after.length >= 2 ? after[1] : after[0];
              if (opts.ignoreFirstFinish && after.length >= 2) skipped++;
              skipPairs.push([x, end]);
              cursor = end.t;
            }
          });
          pairs = skipPairs;
        } else {
          // No stops in the file: the first finish after each start, run by run.
          var by = {}, startOf = function (f) { var from = -Infinity; st.forEach(function (x) { if (x.t < f.t && x.t > from) from = x.t; }); return pts[f.i].run + ':' + from; };
          fi.forEach(function (f) { var key = startOf(f); (by[key] = by[key] || []).push(f); });
          var kept = fi.filter(function (f) { var g = by[startOf(f)]; return g.length < 2 || g[0] !== f; });
          skipped = fi.length - kept.length;
          if (skipped) pairs = pairUp(kept);
        }
      }
      if (pairs.length && (!pick || pairs.length > pick.pairs.length)) pick = { c: c, pairs: pairs, skipped: skipped, climb: climb };
    }
    // The course's own lines come first. The member's lines are only used when
    // the course's give no runs (or it has none), so nobody can time a listed
    // course on lines they moved.
    cands.filter(function (c) { return !c.own; }).forEach(evalCand);
    if (!pick) cands.filter(function (c) { return c.own; }).forEach(evalCand);
    if (!pick) {
      session.laps = [];
      session.needsStartLine = true;
      session.needsFinish = true;
      session.trace = { outline: outline(pts) };
      session.problem = sv ? 'We know ' + sv.name + ' but not ' + (org ? 'the ' + String(opts.organizer).trim() + ' course' : 'its start and finish') + ' yet. Tap the start, then the finish, on your trace.' : 'We don\'t know this course yet. Tap the start, then the finish, on your trace and we\'ll add it.';
      return session;
    }
    var layout = pick.c.layout;
    // Only one course listed and the member's own lines: it is that course
    // when their lines are where its lines are (or it has none to compare),
    // and never when they named a different organiser.
    function lineMid(l) { return [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2]; }
    function sameLine(a, b) { var x = lineMid(a), y = lineMid(b); return haversine({ lat: x[0], lng: x[1] }, { lat: y[0], lng: y[1] }) <= 25; }
    if (!layout && sv && sv.layouts && sv.layouts.length === 1 && ofOrganiser(sv.layouts[0])) {
      var only = sv.layouts[0];
      if (!only.startLine || !only.finishLine || sameLine(only.startLine, pick.c.start) && sameLine(only.finishLine, pick.c.finish)) layout = only;
      else session.courseDiffers = true;
    }
    if (layout) { session.layoutId = layout.id; session.layout = layout.name; }
    if (layout && layout.organizer) session.organizer = layout.organizer; else if (opts.organizer) session.organizer = String(opts.organizer).trim().slice(0, 40);
    session.startLine = pick.c.start;
    session.finishLine = pick.c.finish;
    if (pick.c.own) session.startLineFromMember = true; else if (pick.c.layout) session.officialLines = true;
    if (pick.skipped) session.firstFinishIgnored = pick.skipped;
    if (opts.finishCrossing >= 1) session.finishCrossing = Math.min(9, Math.round(opts.finishCrossing));
    if (pick.climb) session.pointToPoint = true;
    var laps = buildLaps(pts, null, null, pick.pairs);
    return timedTail(session, pts, laps, layout, proj, origin);
  }

  // Bests, sectors, traces and corners for laps or sprint runs.
  function timedTail(session, pts, laps, layout, proj, origin) {
    var timed = laps.filter(function (l) { return l.kind === 'timed'; });
    var best = timed.reduce(function (b, l) { return !b || l.time < b.time ? l : b; }, null);
    session.laps = laps.map(function (l) {
      var o = { n: l.n, start: round(l.start, 2), time: l.time, dist: l.dist, vmax: l.vmax, kind: l.kind, sectors: l.sectors };
      if (l.run) o.run = l.run;
      // The car's own figures for this lap alone (charge, power, brakes, temperatures, tyres), when the file has them.
      if (session.carData && l.i1 > l.i0) { var lc = carData(pts.slice(l.i0, l.i1 + 1)); if (lc) { delete lc.found; delete lc.empty; if (Object.keys(lc).length) o.carData = lc; } }
      return o;
    });
    var runs = laps.reduce(function (m, l) { return Math.max(m, l.run || 1); }, 1);
    if (runs > 1) session.runs = runs;
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

  // A line across the road at the place on the trace that is crossed most
  // times (most laps), the fastest of those: samples the trace and counts.
  function autoLapLine(pts, proj, minGap) {
    var n = pts.length, step = Math.max(4, Math.floor(n / 80)), best = null;
    for (var i = 6; i < n - 6; i += step) {
      var p0 = pts[i - 5], p1 = pts[i + 5], dx = p1.x - p0.x, dy = p1.y - p0.y, L = Math.hypot(dx, dy);
      if (L < 3 || pts[i].v < 20) continue;
      var nx = -dy / L * 15, ny = dx / L * 15;
      var line = [proj.ll(pts[i].x + nx, pts[i].y + ny), proj.ll(pts[i].x - nx, pts[i].y - ny)];
      var cr = crossings(pts, proj, line, minGap);
      if (cr.length < 2) continue;
      var score = cr.length + pts[i].v / 1000;
      if (!best || score > best.score) best = { line: line, cr: cr, score: score };
    }
    return best;
  }

  // When the car stood still (under 5 km/h for 3 s or more), as [from, to] times: the gaps between runs.
  function standstills(pts) {
    var out = [], from = -1;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].v < 5) { if (from < 0) from = i; }
      else if (from >= 0) { if (pts[i - 1].t - pts[from].t >= 3) out.push([pts[from].t, pts[i - 1].t]); from = -1; }
    }
    if (from >= 0 && pts[pts.length - 1].t - pts[from].t >= 3) out.push([pts[from].t, pts[pts.length - 1].t]);
    return out;
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
    // The out lap is not numbered, so Lap 1 is the first timed lap after it.
    function shown(l) { return l.n - laps.filter(function (x) { return x.kind === 'out' && x.n < l.n; }).length; }
    if (!best || !tr) { out.push(qualityNote(s)); return out.filter(Boolean); }
    if (s.possible && s.bestTime - s.possible >= 0.1) out.push({ icon: 'flag', text: 'Your best sectors add up to ' + fmtLap(s.possible) + ', ' + (s.bestTime - s.possible).toFixed(2) + ' s quicker than your best lap.', small: s.sectorsByThirds ? 'Sectors are thirds of the lap until this track has its own sector points.' : 'Green sector times are your best of each.' });
    // A lap that was ahead of the best for a while.
    var bt = tr[best];
    laps.forEach(function (l) {
      if (l.n === best || !tr[l.n] || l.kind === 'short') return;
      var up = 0, upAt = 0;
      tr[l.n].forEach(function (p) { var q = traceAt(bt, p[0]); var lead = q[1] - p[1]; if (lead > up) { up = lead; upAt = p[0]; } });
      if (up >= 0.4 && !out.some(function (o) { return o.lapAhead; })) out.push({ icon: 'flag', lapAhead: true, text: 'Lap ' + shown(l) + ' was ' + up.toFixed(1) + ' s up on your best lap ' + dist(upAt) + ' in' + (l.kind === 'in' ? ', before you came in to the pits.' : ', then lost it later in the lap.'), small: 'Put those parts together and there is more time in the car.' });
    });
    var others = laps.filter(function (l) { return l.kind === 'timed' && l.n !== best; }).sort(function (a, b) { return a.time - b.time; });
    if (others.length && s.corners && s.corners.length) {
      var g = cornerGains(bt, tr[others[0].n], s.corners).sort(function (a, b) { return b.gain - a.gain; })[0];
      if (g && g.gain >= 0.15) out.push({ icon: 'corner', text: 'Compared with lap ' + shown(others[0]) + ', most of your best lap\'s time came at ' + cornerName(g) + ': ' + g.gain.toFixed(2) + ' s, carrying ' + speed(Math.max(0, g.va - g.vb)) + ' more at the slowest point.', small: 'Measured from 200 m before the slowest point to 150 m after.' });
    }
    if (s.brakeMax) out.push({ icon: 'brake', text: 'Peak braking ' + s.brakeMax.toFixed(2) + ' g, peak cornering ' + s.latMax.toFixed(2) + ' g' + (s.gDerived ? ' (estimated)' : '') + ', top speed ' + speed(s.vmax) + '.', small: s.gDerived ? 'Estimated: worked out from GPS, as the file has no g readings, so treat these as a guide.' : '' });
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

  // ---------- Which parts matter on track ----------
  // Wheels, tyres, suspension, brakes and performance parts, aero from bodywork,
  // and anything whose text discloses a weight saving. Seats, trim, audio,
  // wraps and tints don't change a lap time (or can't be measured), so they
  // are left out of the track views. For a car with only a plain list of mods,
  // and for "anything else", the wording decides.
  var TRACK_AREAS = { wheels: 1, tyres: 1, suspension: 1, brakes: 1, performance: 1 };
  var TRACK_WORDS = /\b(tyres?|tires?|coilovers?|springs?|dampers?|shocks?|anti[- ]?roll|sway|brakes?|pads?|discs?|rotors?|calipers?|wheels?|rims?|spacers?|aero|wing|splitter|diffuser|canards?|lowering|geometry|alignment|camber|toe|tune|tuned|boost|cooling|cooler)\b/i;
  var WEIGHT_WORDS = /\b\d+(?:\.\d+)?\s?kg\b|weight[- ]?(?:saving|saved|reduction|loss)|lightweight|lightened/i;
  function isTrackPart(areaId, part) {
    part = part || {};
    var text = (part.kind ? part.kind + ' ' : '') + (part.what || '');
    if (WEIGHT_WORDS.test(text)) return true;
    if (TRACK_AREAS[areaId]) return true;
    if (areaId === 'bodywork') return part.kind === 'Aero';
    if (areaId === 'mods' || areaId === 'other') return TRACK_WORDS.test(text);
    return false;
  }

  // ---------- What a part did ----------
  // sessions: the car's sessions at one track layout { id, date, bestTime,
  // conditions, temp, tyres }. mods: parts with a fitted month { label, year,
  // month } (month null when only the year is known). For each part, or group
  // of parts fitted together, the best dry time before and after, using the
  // dry sessions between it and the neighbouring parts, and leaving out any
  // session in the month it was fitted (the day isn't known).
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function monthWindow(m) {
    if (m.month) { var last = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate(); return [m.year + '-' + pad2(m.month) + '-01', m.year + '-' + pad2(m.month) + '-' + pad2(last)]; }
    return [m.year + '-01-01', m.year + '-12-31'];
  }
  // The same tyres written two ways ("Pilot Sport 4S" and "Michelin Pilot Sport
  // 4S, 245/35 R19") count as the same; nothing written on one side does not.
  function sameTyres(x, y) {
    function norm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b\d{3} \d{2} (z )?r? ?\d{2}\b/, '').trim(); }
    var a = norm(x), b = norm(y);
    if (!a || !b) return !a && !b;
    return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
  }
  function modImpact(sessions, mods) {
    var dry = (sessions || []).filter(function (s) { return s.bestTime && (s.conditions || 'Dry') === 'Dry'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var wins = (mods || []).filter(function (m) { return m && m.year; }).map(function (m) { var w = monthWindow(m); return { label: m.label, start: w[0], end: w[1], year: m.year, month: m.month || null }; }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    // Parts whose fitting months overlap are one group: they can't be told apart.
    var groups = [];
    wins.forEach(function (w) {
      var g = groups[groups.length - 1];
      if (g && w.start <= g.end) { g.labels.push(w.label); if (w.end > g.end) g.end = w.end; }
      else groups.push({ labels: [w.label], start: w.start, end: w.end, year: w.year, month: w.month });
    });
    var rows = [], skipped = [];
    groups.forEach(function (g, i) {
      var prevEnd = i ? groups[i - 1].end : '0000-00-00', nextStart = i < groups.length - 1 ? groups[i + 1].start : '9999-99-99';
      var before = dry.filter(function (s) { return s.date > prevEnd && s.date < g.start; });
      var after = dry.filter(function (s) { return s.date > g.end && s.date < nextStart; });
      if (!before.length || !after.length) { skipped.push({ labels: g.labels, year: g.year, month: g.month, why: !before.length && !after.length ? 'no dry sessions either side' : !before.length ? 'no dry session before' : 'no dry session after' }); return; }
      function best(list) { return list.slice().sort(function (a, b) { return a.bestTime - b.bestTime; })[0]; }
      var b = best(before), a = best(after), flags = [];
      if (!sameTyres(b.tyres, a.tyres)) flags.push('different tyres');
      if (isFinite(b.temp) && isFinite(a.temp) && b.temp !== null && a.temp !== null && Math.abs(a.temp - b.temp) >= 8) flags.push(Math.abs(a.temp - b.temp) + '°C ' + (a.temp > b.temp ? 'warmer' : 'colder'));
      if (before.length === 1 && after.length === 1) flags.push('one session each side');
      rows.push({ labels: g.labels, year: g.year, month: g.month, before: b.bestTime, after: a.bestTime, change: round(a.bestTime - b.bestTime, 3), beforeDate: b.date, afterDate: a.date, nBefore: before.length, nAfter: after.length, flags: flags });
    });
    return { rows: rows, skipped: skipped };
  }
  function niceDate(d) {
    var m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return d || '';
    return (+m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[1];
  }

  // Merges the admin's changes (KV) over data/tracks.json, by venue id.

  // What the extra channels say over the whole file, kept small: start and end
  // charge, peak power and regeneration, peak temperatures, peak brake
  // pressure, how long the throttle was flat out, tyre pressures and slip.
  // A channel that never moves (all zeros) is listed as empty, not summarised.
  // The car's temperatures are written as a percentage, and in the files seen
  // so far as a fraction of one, so a channel that never goes above 1.5 is
  // scaled to a percentage here.
  function carData(pts) {
    var st = {}, n = 0, dt = 0, flat = 0, prevT = null;
    // Peak power in the first and last third of the file, at full throttle when
    // the file says so, to see whether the car held power back as it got hot.
    var tEnd = pts.length ? pts[pts.length - 1].t : 0, early = 0, late = 0;
    for (var i = 0; i < pts.length; i++) {
      var c = pts[i].ch;
      if (c) {
        n++;
        Object.keys(c).forEach(function (k) {
          var v = c[k];
          if (!isFinite(v)) return;
          // Tyre pressure reads 0 until the sensors report, so zeros are skipped once it does.
          if (k === 'tpr' && v === 0) { if (!st[k]) st[k] = { first: 0, last: 0, min: 0, max: 0, nz: false }; return; }
          if (k === 'tpr' && st[k] && !st[k].nz) { st[k].first = v; st[k].min = v; st[k].max = v; }
          var a = st[k] || (st[k] = { first: v, last: v, min: v, max: v, nz: false });
          a.last = v; if (v < a.min) a.min = v; if (v > a.max) a.max = v; if (v !== 0) a.nz = true;
        });
        if (isFinite(c.thr) && prevT !== null) { var step = Math.min(2, pts[i].t - prevT); if (step > 0) { dt += step; if (c.thr >= 95) flat += step; } }
        if (isFinite(c.pwr) && (!isFinite(c.thr) || c.thr >= 95)) {
          if (pts[i].t < tEnd / 3) early = Math.max(early, c.pwr);
          else if (pts[i].t > tEnd * 2 / 3) late = Math.max(late, c.pwr);
        }
      }
      prevT = pts[i].t;
    }
    if (!n) return null;
    var out = { found: [], empty: [] };
    function pct(a) { return a.max <= 1.5 ? 100 : 1; }
    function on(k, label) { if (!st[k]) return null; if (!st[k].nz && st[k].min === st[k].max) { out.empty.push(label); return null; } out.found.push(label); return st[k]; }
    var a;
    if ((a = on('soc', 'State of charge'))) out.soc = { start: round(a.first, 2), end: round(a.last, 2) };
    if ((a = on('pwr', 'Power'))) {
      out.power = { max: round(Math.max(0, a.max), 0), regen: round(Math.max(0, -a.min), 0) };
      if (early > 0 && late > 0) { out.power.early = round(early, 0); out.power.late = round(late, 0); }
    }
    if ((a = on('thr', 'Throttle')) && dt > 0) out.throttle = { full: round(flat / dt, 2) };
    if ((a = on('bpr', 'Brake pressure'))) out.brakePressure = { max: round(a.max, 1) };
    if ((a = on('bat', 'Battery temperature'))) out.batteryTemp = { start: round(a.first * pct(a), 0), max: round(a.max * pct(a), 0) };
    if ((a = on('brk', 'Brake temperature'))) out.brakeTemp = { max: round(a.max * pct(a), 0) };
    if ((a = on('inv', 'Inverter temperature'))) out.inverterTemp = { max: round(a.max * pct(a), 0) };
    if ((a = on('tpr', 'Tyre pressure'))) out.tyrePressure = { start: round(a.first, 2), end: round(a.last, 2), max: round(a.max, 2) };
    if ((a = on('slp', 'Tyre slip'))) out.slip = { max: round(a.max, 2) };
    return out.found.length || out.empty.length ? out : null;
  }

  // What a file holds, for the "what's in your file" line: position and time
  // are always there; the rest by what the readings carry.
  function fileChannels(rd) {
    var pts = rd.points || [], any = function (f) { for (var i = 0; i < pts.length; i++) if (f(pts[i])) return true; return false; };
    var cd = carData(pts) || { found: [], empty: [] };
    return {
      have: ['GPS position'].concat(
        any(function (p) { return isFinite(p.v); }) ? ['Speed'] : [],
        any(function (p) { return isFinite(p.la) || isFinite(p.lo); }) ? ['G-force'] : [],
        rd.startLine ? ['Lap numbers'] : [],
        cd.found),
      empty: cd.empty
    };
  }

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
    read: read, combine: combine, dateFromName: dateFromName, analyse: analyse, sessionNotes: sessionNotes, trendNotes: trendNotes, isTrackPart: isTrackPart, modImpact: modImpact, carData: carData, fileChannels: fileChannels, cornerGains: cornerGains,
    traceAt: traceAt, findCorners: findCorners, mergeLibrary: mergeLibrary, fmtLap: fmtLap, niceDate: niceDate, ukDate: ukDate, ukTime: ukTime,
    mergeSources: mergeSources, alignSpeeds: alignSpeeds, haversine: haversine, outline: outline, projector: projector, dragRuns: dragRuns, KMH_PER_MPH: KMH_PER_MPH, ANALYSIS_VERSION: ANALYSIS_VERSION
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MT3UKTrack = api;
})(typeof window !== 'undefined' ? window : globalThis);
