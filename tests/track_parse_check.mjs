// Run by tests/test_track_parse.py: the track session reader (js/track-parse.js) against a
// trimmed copy of a real RaceBox file from Thruxton, the same data rewritten as CSV and GPX,
// and made-up drag runs.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const T = require(ROOT + 'js/track-parse.js');
const lib = JSON.parse(fs.readFileSync(ROOT + 'data/tracks.json', 'utf8'));
const vbo = fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// VBO
let rd = T.read(vbo, 'RaceBox_Track_Session.vbo');
ok(rd.format === 'VBO' && rd.venueName === 'Thruxton', 'VBO read with its venue');
ok(rd.startLine && near(rd.startLine[0][0], 51.2077017, 1e-6) && near(rd.startLine[0][1], -1.6088667, 1e-6), 'start line from [laptiming], longitude west is negative');
ok(rd.hz >= 12 && rd.hz <= 13 && rd.quality === 'good', 'readings a second and quality');
let s = T.analyse(rd, lib);
ok(s.type === 'track' && s.venueId === 'thruxton' && s.layoutId === 'main', 'Thruxton found from the GPS');
ok(s.date === '2026-05-28' && s.time === '14:34', 'date and start time in UK time (13:34 UTC in the file is 14:34 BST)');
ok(s.laps.length === 2 && near(s.laps[0].time, 102.392, 0.01) && near(s.laps[1].time, 99.786, 0.01), 'lap times match RaceBox: 1:42.392 and 1:39.786');
ok(s.best === 2 && near(s.bestTime, 99.786, 0.01), 'best lap');
ok(s.laps.every(l => l.sectors.length === 3 && near(l.sectors.reduce((a, b) => a + b, 0), l.time, 0.02)), 'sectors add up to the lap');
ok(s.sectorsByThirds === true, 'thirds of a lap until Thruxton has sector points');
ok(near(s.possible, s.bestSectors.reduce((a, b) => a + b, 0), 0.01) && s.possible <= s.bestTime, 'best possible lap from the best sectors');
ok(s.corners.length >= 5 && s.corners.every(c => c.lat && c.lng && c.v > 30), 'corners found with positions');
ok(near(s.vmax, 202.8, 0.5) && s.brakeMax > 0.9 && s.latMax > 0.8, 'top speed and peak g from the file');
ok(s.trace.laps[2].length > 400 && s.trace.laps[2][s.trace.laps[2].length - 1][1] === s.laps[1].time, 'trimmed trace for each lap ends at the lap time');
ok(JSON.stringify(s).length < 200000, 'session is small enough to save');
const g = T.cornerGains(s.trace.laps[2], s.trace.laps[1], s.corners);
ok(g.length === s.corners.length && g.reduce((a, c) => a + c.gain, 0) > 0.5, 'corner gains of the best lap over the other');
let notes = T.sessionNotes(s);
ok(notes.some(n => /corner 2/.test(n.text)) && notes.some(n => /Good data/.test(n.text)), 'notes name the corner that made the difference and the data quality');
ok(notes.every(n => !/\u2014/.test(n.text + n.small)), 'no em dashes in notes');

// The same readings as CSV, in mph with a few lines before the header.
const pts = rd.points;
let csv = 'Session,Thruxton test\nCar,Model 3\n\nTime (s),Latitude,Longitude,Speed (mph),Satellites\n' + pts.map(p => [p.t.toFixed(2), p.lat.toFixed(7), p.lng.toFixed(7), (p.v / 1.609344).toFixed(2), 14].join(',')).join('\n');
let rc = T.read(csv, 'export.csv');
ok(rc.format === 'CSV' && rc.speedUnit === 'mph', 'CSV with a header lower down and speed in mph');
let sc = T.analyse(rc, lib);
ok(sc.venueId === 'thruxton' && sc.layoutId === 'main' && sc.laps.length === 2 && near(sc.bestTime, 99.786, 0.05), 'CSV gives the same best lap');
ok(sc.gDerived === true && sc.latMax > 0.5, 'g worked out from GPS when the file has none');
// An outside air temperature column is read (in °F here); tyre temperatures are not.
csv = 'Time (s),Latitude,Longitude,Speed (mph),Tyre Temp FL,Air Temp (°F)\n' + pts.map(p => [p.t.toFixed(2), p.lat.toFixed(7), p.lng.toFixed(7), (p.v / 1.609344).toFixed(2), 60, 66].join(',')).join('\n');
ok(T.analyse(T.read(csv, 'temp.csv'), lib).airTemp === 19, 'air temperature from the file, °F turned into °C');
ok(T.analyse(T.read(csv.replace('Air Temp (°F)', 'Brake Temp'), 'temp.csv'), lib).airTemp === undefined, 'other temperatures are not taken as the air temperature');
// Semicolons, no unit in the header, m/s: the unit is worked out from the movement.
csv = 'time;lat;lon;speed\n' + pts.map(p => [p.t.toFixed(2), p.lat.toFixed(7), p.lng.toFixed(7), (p.v / 3.6).toFixed(3)].join(';')).join('\n');
rc = T.read(csv, 'x.csv');
ok(rc.speedUnit === 'm/s' && near(T.analyse(rc, lib).bestTime, 99.786, 0.05), 'speed unit found from the GPS when the header has none');
// Unknown column names: asks which is which, then reads it.
csv = 'a,b,c,d\n' + pts.map(p => [p.t.toFixed(2), p.lat.toFixed(7), p.lng.toFixed(7), p.v.toFixed(2)].join(',')).join('\n');
rc = T.read(csv, 'odd.csv');
ok(rc.needsMapping && rc.needsMapping.headers.join() === 'a,b,c,d' && rc.needsMapping.rows.length === 3, 'unknown columns ask for a mapping');
rc = T.read(csv, 'odd.csv', { time: 0, lat: 1, lng: 2, speed: 3, speedUnit: 'km/h' });
ok(near(T.analyse(rc, lib).bestTime, 99.786, 0.05), 'mapped columns read the laps');
// Clock times and ISO dates.
const base = Date.parse('2026-05-28T13:31:00Z');
csv = 'Date Time,Latitude,Longitude\n' + pts.map(p => [new Date(base + p.t * 1000).toISOString(), p.lat.toFixed(7), p.lng.toFixed(7)].join(',')).join('\n');
rc = T.read(csv, 'iso.csv');
let si = T.analyse(rc, lib);
ok(rc.speedDerived && si.date === '2026-05-28' && near(si.bestTime, 99.786, 0.1), 'ISO times, speed from GPS');

// GPX at 1 reading a second.
let gpx = '<?xml version="1.0"?><gpx version="1.1"><trk><name>Thruxton</name><trkseg>';
let lastT = -1;
pts.forEach(p => { if (Math.floor(p.t) > lastT) { lastT = Math.floor(p.t); gpx += '<trkpt lat="' + p.lat.toFixed(7) + '" lon="' + p.lng.toFixed(7) + '"><time>' + new Date(base + p.t * 1000).toISOString() + '</time></trkpt>'; } });
gpx += '</trkseg></trk></gpx>';
const rg = T.read(gpx, 'phone.gpx');
const sg = T.analyse(rg, lib);
ok(rg.format === 'GPX' && rg.quality === 'rough' && sg.venueId === 'thruxton', 'GPX read, marked rough at 1 a second');
ok(sg.laps.length === 2 && near(sg.bestTime, 99.786, 1.0), 'GPX lap times close');
ok(T.sessionNotes(sg).some(n => /Rough data/.test(n.text)), 'rough data note');

// A track we don't know: asks for a start line, then times laps from it.
const moved = pts.map(p => [p.t.toFixed(2), (p.lat + 1.5).toFixed(7), p.lng.toFixed(7), p.v.toFixed(2)].join(',')).join('\n');
let ru = T.read('time,latitude,longitude,speed (km/h)\n' + moved, 'u.csv');
let su = T.analyse(ru, lib);
ok(su.needsStartLine && !su.venueId && su.trace.outline.length > 100 && /don't know this track/.test(su.problem), 'unknown track asks for the start line');
ru = T.read('time,latitude,longitude,speed (km/h)\n' + moved, 'u.csv');
su = T.analyse(ru, lib, { startLine: [[51.2077017 + 1.5, -1.6088667], [51.2076237 + 1.5, -1.6091363]] });
ok(su.laps.length === 2 && near(su.bestTime, 99.786, 0.05) && su.startLineFromMember, 'member start line times the laps');

// Sprint: a made-up course at Thruxton from the start line to a finish line 1.5 km round.
{
  const tr = s.trace.laps[2];
  const i = tr.findIndex(p => p[0] >= 1500);
  const p0 = tr[i - 3], p1 = tr[i + 3], c = tr[i];
  const dx = p1[2] - p0[2], dy = p1[3] - p0[3], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  const proj = T.projector(s.origin[0], s.origin[1]);
  const finish = [proj.ll(c[2] + nx * 15, c[3] + ny * 15), proj.ll(c[2] - nx * 15, c[3] - ny * 15)];
  const start = lib.venues.find(v => v.id === 'thruxton').layouts[0].startLine;
  const sprintLib = { venues: [{ id: 'test-sprint', name: 'Test Sprint', type: 'sprint', lat: 51.2085, lng: -1.6055, radius: 2500, layouts: [{ id: 'short', name: 'Short course', length: 1500, startLine: start, finishLine: finish }] }] };
  const sp = T.analyse(T.read(vbo, 'f.vbo'), sprintLib);
  ok(sp.type === 'sprint' && sp.venueId === 'test-sprint' && sp.layoutId === 'short', 'sprint venue found and the type set');
  ok(sp.laps.length === 2 && sp.laps.every(l => Math.abs(l.dist - 1500) < 40), 'two runs, start to finish');
  ok(near(sp.bestTime, c[1], 0.3) && sp.finishLine, 'run time matches the time to the finish line');
  const sq = T.analyse(T.read(vbo, 'f.vbo'), { venues: [] }, { type: 'sprint' });
  ok(sq.needsStartLine && sq.needsFinish && /Tap the start, then the finish/.test(sq.problem), 'unknown course asks for the start and finish');
  const sm = T.analyse(T.read(vbo, 'f.vbo'), { venues: [] }, { type: 'sprint', startLine: start, finishLine: finish });
  ok(sm.laps.length === 2 && sm.startLineFromMember, 'member start and finish time the runs');
  const so = T.analyse(T.read(vbo, 'f.vbo'), { venues: [] }, { type: 'other' });
  ok(so.type === 'other' && !so.needsStartLine && so.trace.outline.length > 100, 'other: mapped without needing a start line');
}

// Drag: a made-up standing start at Santa Pod, and the same on a road.
function dragCsv(lat, lng) {
  const rows = ['time,latitude,longitude,speed (mph)'];
  let x = 0;
  for (let i = 0; i <= 200; i++) {
    const t = i / 10, v = t < 2 ? 0 : 150 * (1 - Math.exp(-(t - 2) / 6.65));
    x += v * 0.44704 * 0.1;
    rows.push([t.toFixed(1), (lat + x / 110540).toFixed(7), lng.toFixed(7), v.toFixed(2)].join(','));
  }
  for (let i = 1; i <= 60; i++) rows.push([(20 + i / 10).toFixed(1), (lat + (x + i) / 110540).toFixed(7), lng.toFixed(7), Math.max(0, 140 - i * 3).toFixed(2)].join(','));
  return rows.join('\n');
}
let sd = T.analyse(T.read(dragCsv(52.2365, -0.596), 'drag.csv'), lib);
ok(sd.type === 'drag' && sd.atVenue && sd.venueId === 'santa-pod', 'drag run found at Santa Pod');
const run = sd.runs[0];
ok(sd.runs.length === 1 && near(run.s60, 3.40, 0.1) && run.ft60 > 1 && run.eighth && run.quarter > run.eighth, 'drag times: 60 ft, 0-60, 1/8 and 1/4 mile');
ok(run.quarterSpeed > 160 && run.s60to100 > 0, 'trap speed and 60-100');
let ss = T.analyse(T.read(dragCsv(51.5, -0.12), 'street.csv'), lib, { type: 'drag' });
ok(ss.type === 'drag' && ss.atVenue === false && ss.runs.length === 1, 'a run away from a venue is found but not at a venue');

// Over time, with the mods fitted between sessions.
const tn = T.trendNotes([
  { date: '2025-06-21', bestTime: 105.88, conditions: 'Dry', tyres: 'PS4S', temp: 20 },
  { date: '2025-08-30', bestTime: 112.4, conditions: 'Wet', tyres: 'PS4S', temp: 15 },
  { date: '2025-10-04', bestTime: 103.12, conditions: 'Dry', tyres: 'PS4S', temp: 16 },
  { date: '2026-05-28', bestTime: 99.786, conditions: 'Dry', tyres: 'PS4S', temp: 19 }
], [{ label: 'Coilovers: KW V3', month: 9, year: 2025 }]);
ok(/Biggest step: 3\.33 s quicker on 28 May 2026/.test(tn[0].text) || /Biggest step: 2\.76 s quicker on 4 Oct 2025 after Coilovers: KW V3 was fitted/.test(tn[0].text), 'biggest step with the mod fitted in between: ' + tn[0].text);
ok(tn.some(n => /1 wet or damp session is shown but left out/.test(n.text)), 'wet session left out of the trend');

// Library: the admin's changes on top of the file.
const merged = T.mergeLibrary(lib, { venues: [{ id: 'thruxton', removed: true }, { id: 'new-one', name: 'New', type: 'circuit', lat: 1, lng: 1, radius: 1000, layouts: [] }] });
ok(!merged.venues.some(v => v.id === 'thruxton') && merged.venues.some(v => v.id === 'new-one') && merged.venues.length === lib.venues.length, 'library merge adds, replaces and removes');
ok(T.fmtLap(99.786) === '1:39.786' && T.niceDate('2026-05-28') === '28 May 2026', 'formatting');

// Tesla Track Mode style CSV: elapsed time in milliseconds, a Lap column,
// acceleration in m/s², and a track with no start line in the list.
{
  const src = T.read(vbo, 'x.vbo');
  const timed = T.analyse(src, lib);
  const starts = timed.laps.map(l => l.start);
  const rows = ['Lap,Elapsed Time (ms),Speed (MPH),Latitude (decimal),Longitude (decimal),Lateral Acceleration (m/s^2),Longitudinal Acceleration (m/s^2)'];
  src.points.forEach(p => {
    const lap = starts.filter(t => p.t >= t).length;
    rows.push([lap, Math.round(p.t * 1000), (p.v / 1.609344).toFixed(2), p.lat.toFixed(7), p.lng.toFixed(7), '0.5', '-0.2'].join(','));
  });
  const tesla = rows.join('\n');
  const noLines = JSON.parse(JSON.stringify(lib));
  noLines.venues.forEach(v => (v.layouts || []).forEach(l => { delete l.startLine; }));
  const tr = T.read(tesla, 'telemetry-v1-2024-03-29-15_39_08.csv');
  ok(tr.hz >= 10 && tr.hz <= 14, 'Tesla milliseconds read as seconds: ' + tr.hz + ' a second');
  ok(near(tr.points[tr.points.length - 1].t, src.points[src.points.length - 1].t, 1), 'Tesla file length in seconds');
  ok(tr.startLine && tr.startLine.length === 2, 'start line taken from where the Lap column goes up');
  const ts = T.analyse(tr, noLines);
  ok(!ts.needsStartLine && ts.laps.length === timed.laps.length, 'Tesla laps found with no start line in the list: ' + ts.laps.length);
  const best = Math.min(...ts.laps.map(l => l.time));
  ok(near(best, Math.min(...timed.laps.map(l => l.time)), 0.3), 'Tesla best lap matches the VBO: ' + best);
  ok(near(Math.abs(tr.points[50].la), 0.5 / 9.81, 0.02), 'acceleration in m/s² turned into g: ' + tr.points[50].la);
  // The same file without a unit in the header is still read as milliseconds.
  const bare = tesla.replace('Elapsed Time (ms)', 'Elapsed Time');
  ok(T.read(bare, 't.csv').hz >= 10, 'milliseconds worked out from the numbers');
}

// Tesla Track Mode starts Elapsed Time again at 0 on each lap; the readings
// are written 2 or 3 times over.
{
  const src = fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-thruxton.csv', 'utf8').trim().split('\n');
  const head = src[0], rows = src.slice(1).map(l => l.split(','));
  let lapStart = 0, lap = null;
  const out = [head];
  rows.forEach(c => {
    if (c[0] !== lap) { lap = c[0]; lapStart = +c[1]; }
    const line = [c[0], +c[1] - lapStart].concat(c.slice(2)).join(',');
    out.push(line, line);
  });
  const tr = T.read(out.join('\n'), 'telemetry-v1.csv');
  const ts = T.analyse(tr, lib);
  ok(near(tr.points[tr.points.length - 1].t, +rows[rows.length - 1][1] / 1000, 1), 'per-lap elapsed time carried on across laps: ' + Math.round(tr.points[tr.points.length - 1].t) + ' s');
  ok(ts.laps.length === 2 && near(Math.min(...ts.laps.map(l => l.time)), 99.785, 0.3), 'laps from a file whose time restarts each lap: ' + ts.laps.map(l => l.time).join(', '));
}

// A date and time in the file name, for files with none inside.
{
  ok(JSON.stringify(T.dateFromName('telemetry-v1-2024-03-29-15_39_08.csv')) === '{"date":"2024-03-29","time":"15:39"}', 'Tesla file name date and time');
  ok(JSON.stringify(T.dateFromName('Session_20250621_143005.csv')) === '{"date":"2025-06-21","time":"14:30"}', 'compact file name date and time');
  ok(T.dateFromName('2026-05-28 trackday.gpx').date === '2026-05-28' && T.dateFromName('2026-05-28 trackday.gpx').time === '', 'date with no time');
  ok(T.dateFromName('my laps.csv') === null && T.dateFromName('lap-2026-13-40.csv') === null, 'no date, or not a real one');
  const tesla = fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-thruxton.csv', 'utf8');
  const s2 = T.analyse(T.read(tesla, 'telemetry-v1-2024-03-29-15_39_08.csv'), lib);
  ok(s2.date === '2024-03-29' && s2.time === '15:39' && s2.dateFrom === 'name', 'session date from the Tesla file name');
}

// Several files from one day as one session, in runs.
{
  const one = T.read(vbo, 'run1.vbo'), two = T.read(vbo, 'run2.vbo');
  two.startedAt = one.startedAt + 3600 * 1000;
  const both = T.combine([two, one]);
  ok(both.runs === 2 && both.points[0].run === 1 && both.points[both.points.length - 1].run === 2, 'files combined in time order, each point marked with its run');
  const s = T.analyse(both, lib);
  const single = T.analyse(T.read(vbo, 'x.vbo'), lib);
  ok(s.laps.length === single.laps.length * 2 && s.runs === 2, 'laps from both runs: ' + s.laps.length);
  ok(s.laps.every(l => l.time < 200), 'no lap spans the gap between files: ' + s.laps.map(l => l.time).join(', '));
  ok(s.laps.filter(l => l.run === 1).length === single.laps.length && s.laps.filter(l => l.run === 2).length === single.laps.length, 'each lap knows its run');
  ok(s.laps.map(l => l.n).join() === s.laps.map((l, i) => i + 1).join(), 'laps numbered straight through');
  ok(Math.abs(s.laps.find(l => l.n === s.best).time - 99.785) < 0.01, 'best lap of the day');
  const other = T.read(vbo, 'x.vbo'); other.startedAt = one.startedAt + 86400 * 1000 * 3;
  let err = '';
  try { T.combine([one, other]); } catch (e) { err = e.message; }
  ok(/different days/.test(err), 'files from different days are refused');
}

// A whole day of Tesla files (well over 100,000 readings) is read without
// running out of stack (no Math.max.apply over every reading).
{
  const lines = fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-thruxton.csv', 'utf8').trim().split('\n');
  const head = lines[0], rows = lines.slice(1).map(r => r.split(','));
  const end = +rows[rows.length - 1][1] + 100;
  const files = [9, 10, 11, 14, 15].map(h => {
    const out = [head];
    for (let c = 0; c < 11; c++) rows.forEach(r => { const q = r.slice(); q[0] = String(+r[0] + c * 3); q[1] = String(+r[1] + c * end); out.push(q.join(',')); });
    return T.read(out.join('\n'), 'telemetry-v1-2024-03-29-' + h + '_00_00.csv');
  });
  const day = T.combine(files);
  let s = null, err = '';
  try { s = T.analyse(day, lib); } catch (e) { err = e.message; }
  ok(day.points.length > 140000 && s && s.laps.length > 50, 'a day of ' + day.points.length + ' readings is analysed' + (err ? ': ' + err : '') + (s ? ', ' + s.laps.length + ' laps' : ''));
}
