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
ok(Object.values(s.trace.laps).every(t => t[0][0] === 0 && t[0][1] === 0 && t[1][1] > 0 && t[1][1] <= 0.5), 'each lap trace starts on the line, at time 0, before its first reading');
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
ok(!su.needsStartLine && !su.venueId && su.autoLine === true && su.laps.length >= 2, 'an unknown track finds its own lap line, so a track day needs no start line from the member (' + su.laps.length + ' laps)');
{
  // One lap only: nothing repeats, so there is no line to find and the member is asked.
  const once = pts.filter(p => p.t < 70).map(p => [p.t.toFixed(2), (p.lat + 1.5).toFixed(7), p.lng.toFixed(7), p.v.toFixed(2)].join(',')).join('\n');
  const one = T.analyse(T.read('time,latitude,longitude,speed (km/h)\n' + once, 'u.csv'), lib);
  ok(one.needsStartLine && /don't know this track/.test(one.problem), 'with a single pass over the ground the start line is still asked for');
}
ru = T.read('time,latitude,longitude,speed (km/h)\n' + moved, 'u.csv');
su = T.analyse(ru, lib, { startLine: [[51.2077017 + 1.5, -1.6088667], [51.2076237 + 1.5, -1.6091363]] });
ok(su.laps.length === 2 && near(su.bestTime, 99.786, 0.05) && su.startLineFromMember, 'member start line times the laps');

// A line drawn exactly through a reading (a straight road, positions rounded) still counts as crossed.
{
  const lat0 = 51.7, lng0 = -1.3, rows = [];
  let tt = 0;
  for (let i = 0; i < 60; i++) rows.push({ lat: lat0, lng: lng0, v: 0, t: (tt += 0.1), sats: 9 });
  for (let i = 1; i <= 100; i++) rows.push({ lat: lat0 + i * 10 / 110540, lng: lng0, v: 72, t: (tt += 0.5), sats: 9 });
  const line = i => [[lat0 + i * 10 / 110540, lng0 - 0.0003], [lat0 + i * 10 / 110540, lng0 + 0.0003]];
  const rdl = Object.assign({}, T.read(vbo, 'f.vbo'), { points: rows, startLine: null, hz: 2 });
  let found = 0;
  for (const [a, b] of [[2, 20], [5, 40], [8, 60], [3, 30], [10, 50]]) {
    const r = T.analyse(Object.assign({}, rdl, { points: rows.map(q => Object.assign({}, q)) }), { venues: [] }, { type: 'sprint', startLine: line(a), finishLine: line(b), ignoreFirstFinish: true });
    if (r.laps && r.laps.length === 1) found++;
  }
  ok(found === 5, 'lines drawn exactly through a reading are still crossed (' + found + ' of 5 placements found the run)');
}

// A standing start is timed from the launch: where the start marker sits (within 40 m ahead) does not change the time.
{
  const lat0 = 51.7, lng0 = -1.3, rows = [];
  let tt = 0;
  for (let i = 0; i < 80; i++) rows.push({ lat: lat0, lng: lng0, v: 0, t: (tt += 0.05), sats: 9 });
  const t0 = tt;
  for (let i = 1; i <= 360; i++) { const u = i * 0.05, d = 0.5 * 4 * u * u, v = Math.min(4 * u, 60) * 3.6; rows.push({ lat: lat0 + d / 110540, lng: lng0, v: v, t: (tt += 0.05), sats: 9 }); }
  for (let i = 0; i < 80; i++) rows.push({ lat: rows[rows.length - 1].lat, lng: lng0, v: 0, t: (tt += 0.05), sats: 9 });
  const line = m => [[lat0 + m / 110540, lng0 - 0.0003], [lat0 + m / 110540, lng0 + 0.0003]];
  const times = [];
  for (const startAt of [0.5, 5, 12, 20, 30]) {
    const r = T.analyse(Object.assign({}, T.read(vbo, 'f.vbo'), { points: rows.map(q => Object.assign({}, q)), startLine: null, hz: 20 }), { venues: [] }, { type: 'sprint', startLine: line(startAt), finishLine: line(250), ignoreFirstFinish: true });
    times.push(r.laps && r.laps.length ? r.laps[0].time : -1);
  }
  ok(times.every(x => x > 0 && Math.abs(x - times[0]) < 0.1), 'the run time does not depend on where the start marker is within 40 m of the launch (' + times.map(x => x.toFixed(2)).join(', ') + ' s)');
}

// Drag runs: 0 to 30 mph, and the 1 ft rollout (the clock starts a little after the first movement).
{
  const lat0 = 51.7, lng0 = -1.3, rows = [];
  let tt = 0;
  for (let i = 0; i < 40; i++) rows.push({ lat: lat0, lng: lng0, v: 0, t: (tt += 0.02), sats: 9 });
  for (let i = 1; i <= 500; i++) { const u = i * 0.02, d = 0.5 * 5 * u * u, v = Math.min(5 * u, 50) * 3.6; rows.push({ lat: lat0 + d / 110540, lng: lng0, v: v, t: (tt += 0.02), sats: 9 }); }
  const base = T.read(vbo, 'f.vbo');
  const mk = o => T.analyse(Object.assign({}, base, { points: rows.map(q => Object.assign({}, q)), startLine: null, hz: 50 }), { venues: [] }, Object.assign({ type: 'drag' }, o));
  const plain = mk({}), rolled = mk({ rollout: true });
  const r0 = plain.runs && plain.runs[0], r1 = rolled.runs && rolled.runs[0];
  ok(r0 && r0.s30 > 2 && r0.s30 < 4, 'a 0 to 30 mph time is worked out (' + (r0 && r0.s30) + ' s)');
  // 1 ft at 5 m/s/s takes 0.35 s from the launch, and the plain clock already starts about 0.1 s in (at 2 km/h).
  ok(r1 && rolled.rollout === true && near(r0.s60 - r1.s60, 0.18, 0.06) && near(r0.s30 - r1.s30, 0.18, 0.06), 'a 1 ft rollout takes about 0.2 of a second off each time here (' + (r0.s60 - r1.s60).toFixed(2) + ', ' + (r0.s30 - r1.s30).toFixed(2) + ')');
}

// A standing start away from any known drag strip is not assumed to be a drag run (it may be a sprint).
{
  const rows = ['time,latitude,longitude,speed (mph)'];
  let x = 0;
  for (let i = 0; i <= 200; i++) { const tt = i / 10, v = tt < 2 ? 0 : 150 * (1 - Math.exp(-(tt - 2) / 6.65)); x += v * 0.44704 * 0.1; rows.push(tt.toFixed(1) + ',' + (53.5 + x / 110540).toFixed(7) + ',-1.5000000,' + v.toFixed(2)); }
  const unknown = T.analyse(T.read(rows.join('\n'), 'run.csv'), { venues: [] });
  ok(unknown.type === 'track', 'a standing start at an unknown place defaults to a track day, not a drag run (' + unknown.type + ')');
}

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
  // Ignoring the first time the file crosses the finish line (off unless asked for).
  // A point-to-point course (a hill climb: the finish is far from the start) never skips it.
  const hc = T.analyse(T.read(vbo, 'f.vbo'), sprintLib, { ignoreFirstFinish: true });
  ok(hc.laps.length === 2 && hc.pointToPoint === true && hc.firstFinishIgnored === undefined, 'a hill climb keeps both runs even when asked to ignore the first finish');
  ok(sp.laps.length === 2 && sp.firstFinishIgnored === undefined, 'and nothing is ignored unless asked');
  // A sprint that loops back past the finish: the finish near the start of the lap.
  const loopAt = tr.findIndex(p => p[0] >= 3000), q0 = tr[loopAt - 3], q1 = tr[loopAt + 3], qc = tr[loopAt];
  const qx = q1[2] - q0[2], qy = q1[3] - q0[3], qL = Math.hypot(qx, qy), qnx = -qy / qL, qny = qx / qL;
  const loopFinish = [proj.ll(qc[2] + qnx * 15, qc[3] + qny * 15), proj.ll(qc[2] - qnx * 15, qc[3] - qny * 15)];
  const loopLib = { venues: [{ id: 'loop-sprint', name: 'Loop Sprint', type: 'sprint', lat: 51.2085, lng: -1.6055, radius: 2500, layouts: [{ id: 'loop', name: 'Loop course', length: 3000, startLine: start, finishLine: loopFinish }] }] };
  const lp = T.analyse(T.read(vbo, 'f.vbo'), loopLib), lk = T.analyse(T.read(vbo, 'f.vbo'), loopLib, { ignoreFirstFinish: true });
  ok(lp.laps.length === 2 && !lp.pointToPoint, 'a loop sprint times both runs by default');
  ok(lk.laps.length === 2 && lk.firstFinishIgnored === undefined, 'a run that crosses the finish line once keeps it, even when asked to ignore the first crossing');
  // A sprint on a loop: the start line is on the lap, so the car crosses it again part way through a run.
  // A run starts at the launch and ends on the second finish crossing, however the line was placed.
  {
    const R = 200, lat0 = 51.5, lng0 = -1.0, kLng = 111320 * Math.cos(lat0 * Math.PI / 180);
    const at = th => ({ lat: lat0 + R * Math.sin(th) / 110540, lng: lng0 + R * Math.cos(th) / kLng });
    const lineAt = th => { const p = at(th), n = 12; return [[p.lat + n * Math.sin(th) / 110540, p.lng + n * Math.cos(th) / kLng], [p.lat - n * Math.sin(th) / 110540, p.lng - n * Math.cos(th) / kLng]]; };
    let t = 0;
    const rows = [], still = (th, secs) => { for (let i = 0; i < secs * 10; i++) rows.push(Object.assign({ v: 0, t: (t += 0.1), sats: 9 }, at(th))); };
    const drive = laps => { const n = Math.round(laps * 1257 / 30 * 10); for (let i = 1; i <= n; i++) rows.push(Object.assign({ v: 108, t: (t += 0.1), sats: 9 }, at(i / n * laps * 2 * Math.PI))); };
    still(0, 5); drive(2); still(0, 8); drive(2); still(0, 5);
    const rdx = Object.assign({}, T.read(vbo, 'f.vbo'), { points: rows, startLine: null, hz: 10 });
    const S = lineAt(0.02), F = lineAt(Math.PI / 2 + 0.02);
    const on = T.analyse(rdx, { venues: [] }, { type: 'sprint', startLine: S, finishLine: F, ignoreFirstFinish: true });
    ok(on.laps.length === 2 && near(on.laps[0].time, 52.4, 1.5) && near(on.laps[1].time, 52.4, 1.5), 'a loop sprint: two runs, each from the launch to the second finish crossing (' + on.laps.map(l => l.time).join(', ') + ')');
    ok(on.firstFinishIgnored === 2, 'the first finish crossing is skipped on each run');
    const off = T.analyse(rdx, { venues: [] }, { type: 'sprint', startLine: S, finishLine: F });
    ok(off.laps.length === 4, 'with no skipping each lap is a run (' + off.laps.length + ')');
    // Drawn a little either side of where the car launches, the result is the same.
    for (const th of [-0.03, 0.03, 0.06]) {
      const moved = T.analyse(rdx, { venues: [] }, { type: 'sprint', startLine: lineAt(th), finishLine: F, ignoreFirstFinish: true });
      ok(moved.laps.length === 2 && moved.laps[0].time > 45, 'start line moved a little (' + th + ' rad) still gives two runs: ' + moved.laps.map(l => l.time).join(', '));
    }
  }
  // The member can choose which crossing of the finish line ends a run.
  const f1 = T.analyse(T.read(vbo, 'f.vbo'), loopLib, { finishCrossing: 1 }), f9 = T.analyse(T.read(vbo, 'f.vbo'), loopLib, { finishCrossing: 9 });
  ok(f1.laps.length === 2 && f1.finishCrossing === 1 && near(f1.bestTime, lp.bestTime, 0.01), 'crossing 1 ends each run on the first finish crossing');
  ok(f9.needsStartLine && f9.laps.length === 0, 'a crossing the car never reaches gives no runs, so the lines are asked for again');
  const f2 = T.analyse(T.read(vbo, 'f.vbo'), loopLib, { finishCrossing: 2, ignoreFirstFinish: true });
  ok(f2.finishCrossing === 2 && f2.firstFinishIgnored === undefined, 'a chosen crossing replaces the ignore switch');
  // One wild reading (a glitch) is not a car's grip.
  {
    const base0 = T.analyse(T.read(vbo, 'f.vbo'), lib), spiky = T.read(vbo, 'f.vbo');
    const k = Math.floor(spiky.points.length / 2);
    spiky.points[k].la = 2.9; spiky.points[k].lo = -3.1;
    const sp2 = T.analyse(spiky, lib);
    ok(near(sp2.latMax, base0.latMax, 0.01) && near(sp2.brakeMax, base0.brakeMax, 0.01), 'a single wild g reading does not set the peak (' + base0.latMax + ' g, braking ' + base0.brakeMax + ' g)');
    const still = T.read(vbo, 'f.vbo');
    for (let j = 0; j < 4; j++) { still.points[j].v = 1; still.points[j].la = 2.5; }
    ok(near(T.analyse(still, lib).latMax, base0.latMax, 0.2), 'cornering g is not counted when almost stopped');
  }
  // The course's official lines win: a member's own lines are not used when they exist.
  {
    const official = lib.venues.find(v => v.id === 'thruxton').layouts[0];
    const moved = T.analyse(T.read(vbo, 'f.vbo'), lib, { startLine: loopFinish });
    ok(moved.officialLines === true && !moved.startLineFromMember && JSON.stringify(moved.startLine) === JSON.stringify(official.startLine) && moved.layoutId === official.id, 'a circuit with an official start line ignores the member\'s line');
    const movedSprint = T.analyse(T.read(vbo, 'f.vbo'), sprintLib, { type: 'sprint', startLine: loopFinish, finishLine: start });
    ok(movedSprint.officialLines === true && !movedSprint.startLineFromMember && movedSprint.layoutId === 'short', 'a sprint course with official lines ignores the member\'s lines');
    const noLine = JSON.parse(JSON.stringify(lib)); delete noLine.venues.find(v => v.id === 'thruxton').layouts[0].startLine;
    const own = T.analyse(T.read(vbo, 'f.vbo'), noLine, { startLine: official.startLine });
    ok(own.startLineFromMember === true && !own.officialLines, 'with no official line the member\'s line is still used');
  }
  // Organisers: the same venue can have courses with different lines.
  const orgLib = JSON.parse(JSON.stringify(sprintLib)); orgLib.venues[0].layouts[0].organizer = 'B19';
  const o1 = T.analyse(T.read(vbo, 'f.vbo'), orgLib, { organizer: ' b19 ' });
  ok(o1.layoutId === 'short' && o1.organizer === 'B19' && o1.laps.length === 2, 'a known organiser finds its course and keeps the organiser');
  const o2 = T.analyse(T.read(vbo, 'f.vbo'), orgLib, { organizer: 'CSCC' });
  ok(o2.needsStartLine && /CSCC course/.test(o2.problem) && !o2.layoutId, 'a different organiser at a known venue asks for its start and finish');
  const o3 = T.analyse(T.read(vbo, 'f.vbo'), orgLib, { organizer: 'CSCC', startLine: start, finishLine: finish });
  ok(o3.laps.length === 2 && !o3.layoutId && o3.organizer === 'CSCC' && o3.startLineFromMember, 'the member\'s own lines time it, but it is not B19\'s course');
  const farLib = JSON.parse(JSON.stringify(sprintLib)); farLib.venues[0].layouts[0].startLine = start.map(p => [p[0] + 0.01, p[1]]); farLib.venues[0].layouts[0].finishLine = finish.map(p => [p[0] + 0.01, p[1]]);
  const o4 = T.analyse(T.read(vbo, 'f.vbo'), farLib, { type: 'sprint', startLine: start, finishLine: finish });
  ok(o4.laps.length === 2 && !o4.layoutId && o4.courseDiffers === true, 'lines well away from the only listed course are not that course');
  const o5 = T.analyse(T.read(vbo, 'f.vbo'), orgLib, { type: 'sprint', startLine: start, finishLine: finish });
  ok(o5.layoutId === 'short' && !o5.courseDiffers, 'the same lines are the listed course');
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
ok(T.fmtLap(99.786) === '1:39.79' && T.niceDate('2026-05-28') === '28 May 2026', 'formatting');

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



// A VBOX Touch writes its start line as longitude then latitude, in minutes with
// longitude positive to the west, and only about a metre long.
{
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push('009 ' + (142043 + Math.floor(i / 10)) + '.' + (i % 10) + '0 +' + (3070.6 + i * 0.001).toFixed(6) + ' -00071.9000 ' + (40 + i).toFixed(3) + ' 100.0 +0111.2 +0000.00 +00.00 -00.00 00002');
  const vbo = ['File created on 20/05/2023 @ 15:20:41', '', '[header]', 'satellites', 'time', 'latitude', 'longitude', 'velocity kmh', 'heading', 'height', 'vertical velocity m/s', 'Long accel g', 'Lat accel g', 'solution type', '',
    '[channel units]', '', '[laptiming]', 'Start        -71.89949 +3070.63870 -71.90033 +3070.63841', '', '[column names]', 'sats time lat long velocity heading height vert-vel longacc latacc solution_type', '', '[data]'].concat(rows).join('\n');
  const rd = T.read(vbo, 'VBOX0016.vbo');
  const [a, b] = rd.startLine;
  ok(near(a[0], 51.1773, 0.001) && near(a[1], 1.1983, 0.001) && near(b[0], 51.1773, 0.001) && near(b[1], 1.1983, 0.001), 'a longitude-then-latitude start line is read as UK coordinates: ' + JSON.stringify(rd.startLine));
  const pr = T.projector(a[0], a[1]), xa = pr.xy(a[0], a[1]), xb = pr.xy(b[0], b[1]);
  ok(near(Math.hypot(xa[0] - xb[0], xa[1] - xb[1]), 30, 1), 'a one metre line is stretched to 30 m so a car can cross it');
  // Those two points are the car's position and heading, so they run along the road: the line made from them goes across it.
  const o1 = pr.xy(-(-71.89949) / 60 * 0 + 3070.63870 / 60, 71.89949 / 60), o2 = pr.xy(3070.63841 / 60, 71.90033 / 60);
  const dot = ((o2[0] - o1[0]) * (xb[0] - xa[0]) + (o2[1] - o1[1]) * (xb[1] - xa[1])) / (Math.hypot(o2[0] - o1[0], o2[1] - o1[1]) * Math.hypot(xb[0] - xa[0], xb[1] - xa[1]));
  ok(Math.abs(dot) < 0.05, 'the stretched line is across the direction of the two points, not along it (cos ' + dot.toFixed(3) + ')');
  // The older order (latitude then longitude, as in the Thruxton file) still reads as before.
  const old = T.read(vbo.replace('Start        -71.89949 +3070.63870 -71.90033 +3070.63841', 'Start        +03072.46210 +000096.53200 +03072.45742 +000096.54818'), 'x.vbo').startLine;
  ok(near(old[0][0], 51.2077, 0.001) && near(old[0][1], -1.6089, 0.001), 'latitude then longitude is still read the old way: ' + JSON.stringify(old[0]));
}

// Tyres written two ways are the same tyres; nothing on one side is not.
{
  const mk = (id, date, t, tyres) => ({ id, date, bestTime: t, conditions: 'Dry', temp: 15, tyres });
  const one = (before, after) => T.modImpact([mk('a', '2026-03-01', 100, before), mk('b', '2026-06-01', 99, after)], [{ label: 'Wheels: forged', year: 2026, month: 4 }]).rows[0].flags;
  ok(one('Pilot Sport 4S', 'Michelin Pilot Sport 4S, 245/35 R19').indexOf('different tyres') === -1, 'the same tyres written two ways are not flagged');
  ok(one('Michelin Pilot Sport 4S, 245/35 R19', 'Michelin Pilot Sport 4S, 255/35 R19').indexOf('different tyres') === -1, 'a different size alone is not a different tyre');
  ok(one('Pilot Sport 4S', 'Kumho Ecsta PS71').indexOf('different tyres') !== -1, 'different tyres are flagged');
  ok(one('', 'Kumho Ecsta PS71').indexOf('different tyres') !== -1 && one('', '').indexOf('different tyres') === -1, 'tyres given on only one side are flagged, none on either are not');
}

// A full Tesla Track Mode export (29 columns): the channels beyond position,
// speed and G-force are summarised, and a channel that never moves is empty.
{
  const src = T.read(vbo, 'x.vbo');
  const timed = T.analyse(src, lib);
  const starts = timed.laps.map(l => l.start);
  const head = 'Lap,Elapsed Time (ms),Speed (MPH),Latitude (decimal),Longitude (decimal),Lateral Acceleration (m/s^2),Longitudinal Acceleration (m/s^2),Throttle Position (%),Brake Pressure (bar),Steering Angle (deg),Steering Angle Rate (deg/s),Yaw Rate (rad/s),Power Level (KW),State of Charge (%),Tire Pressure Front Left (bar),Tire Pressure Front Right (bar),Tire Pressure Rear Left (bar),Tire Pressure Rear Right (bar),Brake Temperature Front Left (% est.),Brake Temperature Front Right (% est.),Brake Temperature Rear Left (% est.),Brake Temperature Rear Right (% est.),Front Inverter Temp (%),Rear Inverter Temp (%),Battery Temp (%),Tire Slip Front Left (% est.),Tire Slip Front Right (% est.),Tire Slip Rear Left (% est.),Tire Slip Rear Right (% est.)';
  const n = src.points.length;
  const rows = [head];
  src.points.forEach((p, i) => {
    const lap = starts.filter(t => p.t >= t).length, f = i / n;
    const accel = i % 40 < 20;
    rows.push([lap, Math.round(p.t * 1000), (p.v / 1.609344).toFixed(2), p.lat.toFixed(7), p.lng.toFixed(7), '0.5', '-0.2',
      accel ? 100 : 0, accel ? 0 : 35.5, 10, 0, 0, accel ? 250 : -120, (80 - 5 * f).toFixed(2), 0, 0, 0, 0,
      (0.02 + 0.3 * f).toFixed(3), (0.02 + 0.2 * f).toFixed(3), 0.02, 0.02, 0.6, (0.7 + 0.1 * f).toFixed(3), (0.5 + 0.12 * f).toFixed(3), -0.11, -0.11, -0.11, 0.35].join(','));
  });
  const rd = T.read(rows.join('\n'), 'telemetry-v1-2025-04-25-11_35_49.csv');
  const ts = T.analyse(rd, lib);
  const cd = ts.carData;
  ok(cd && cd.soc && near(cd.soc.start, 80, 0.1) && cd.soc.end < cd.soc.start && cd.soc.end > 74, 'charge at the start and end: ' + JSON.stringify(cd && cd.soc));
  ok(cd.power.max === 250 && cd.power.regen === 120, 'peak power and regeneration (negative power): ' + JSON.stringify(cd.power));
  ok(cd.power.early === 250 && cd.power.late === 250, 'flat-out peak power early and late in the session: ' + JSON.stringify(cd.power));
  // Power that drops late on (the car holding back when hot) is seen.
  const fade = rows.map((r, i) => { if (!i) return r; const c = r.split(','); if (i > rows.length * 0.6 && +c[12] > 0) c[12] = 190; return c.join(','); });
  const fcd = T.analyse(T.read(fade.join('\n'), 't.csv'), lib).carData;
  ok(fcd.power.early === 250 && fcd.power.late === 190, 'late peak power lower than early: ' + JSON.stringify(fcd.power));
  ok(cd.brakePressure.max === 35.5, 'peak brake pressure');
  ok(cd.throttle.full > 0.4 && cd.throttle.full < 0.6, 'time with the throttle flat out: ' + cd.throttle.full);
  ok(near(cd.batteryTemp.start, 50, 1) && near(cd.batteryTemp.max, 62, 1), 'battery temperature written as a fraction is shown as a percentage: ' + JSON.stringify(cd.batteryTemp));
  ok(near(cd.brakeTemp.max, 32, 1) && near(cd.inverterTemp.max, 80, 1), 'hottest brake and inverter');
  ok(cd.slip.max === 0.35, 'tyre slip');
  ok(cd.empty.indexOf('Tyre pressure') !== -1 && !cd.tyrePressure, 'tyre pressures that never move are listed as empty, not summarised');
  ok(ts.laps.length === timed.laps.length, 'laps still found with the extra columns');
  const fc = T.fileChannels(rd);
  ok(fc.have.indexOf('Speed') !== -1 && fc.have.indexOf('G-force') !== -1 && fc.have.indexOf('Lap numbers') !== -1 && fc.have.indexOf('Battery temperature') !== -1 && fc.empty.indexOf('Tyre pressure') !== -1, 'what is in the file: ' + fc.have.join(', '));
  // Tyre pressures that start at 0 until the sensors report: zeros are skipped.
  const tp = rows.map((r, i) => { if (!i) return r; const c = r.split(','); const v = i < 20 ? 0 : 2.4 + i / 5000; c[14] = c[15] = c[16] = c[17] = v; return c.join(','); });
  const tcd = T.analyse(T.read(tp.join('\n'), 't.csv'), lib).carData;
  ok(tcd.tyrePressure && near(tcd.tyrePressure.start, 2.4, 0.05) && tcd.tyrePressure.end > tcd.tyrePressure.start && tcd.empty.indexOf('Tyre pressure') === -1, 'tyre pressure from the first real reading: ' + JSON.stringify(tcd.tyrePressure));
  // A day made from two files: figures for the whole day and for each file.
  {
    const half = Math.floor(rows.length / 2);
    const f1 = rows.slice(0, half).join('\n'), f2 = [rows[0]].concat(rows.slice(half)).join('\n');
    const day = T.combine([T.read(f1, 'telemetry-v1-2025-04-25-10_00_00.csv'), T.read(f2, 'telemetry-v1-2025-04-25-11_00_00.csv')]);
    const dcd = T.analyse(day, lib).carData;
    ok(dcd.runs && dcd.runs.length === 2 && dcd.runs[0].run === 1 && dcd.runs[1].run === 2, 'one set of figures per file: ' + JSON.stringify((dcd.runs || []).map(r => r.run)));
    ok(near(dcd.soc.start, 80, 0.1) && near(dcd.runs[0].soc.start, 80, 0.1) && near(dcd.runs[1].soc.end, dcd.soc.end, 0.01) && dcd.runs[1].soc.start < dcd.runs[0].soc.start, 'each file has its own start and end charge');
    ok(!dcd.runs[0].found && dcd.found.length, 'the list of channels is kept once, for the day');
    ok(!T.analyse(T.read(f1, 'one.csv'), lib).carData.runs, 'a single file has no per-file figures');
  }
  // A file with only the basic columns has no car data.
  ok(!T.analyse(T.read(vbo, 'x.vbo'), lib).carData, 'no car data from a file without those channels');
  // A file that is a parked capture (the extra channels barely move) is still read as an error, not a crash.
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

// Track-relevant parts, and what each part did.
{
  ok(T.isTrackPart('tyres', { what: 'Michelin Pilot Sport 4S' }) && T.isTrackPart('wheels', { what: 'Forged 19s' }) && T.isTrackPart('suspension', { what: 'KW V3' }) && T.isTrackPart('brakes', { what: 'Pads' }) && T.isTrackPart('performance', { what: 'Acceleration Boost' }), 'wheels, tyres, suspension, brakes and performance count on track');
  ok(!T.isTrackPart('audio', { what: 'Subwoofer' }) && !T.isTrackPart('bodywork', { kind: 'Wrap', what: 'Matte' }) && !T.isTrackPart('bodywork', { kind: 'Tint', what: 'Rear' }) && !T.isTrackPart('interior', { what: 'Seats: Recaro' }) && !T.isTrackPart('interior', { what: 'Carbon trim' }), 'audio, wraps, tints, seats and trim do not');
  ok(T.isTrackPart('bodywork', { kind: 'Aero', what: 'Splitter' }), 'aero counts');
  ok(T.isTrackPart('interior', { what: 'Seats: Recaro, 12 kg lighter' }) && T.isTrackPart('other', { what: 'Lightweight carbon boot' }), 'a disclosed weight saving counts, wherever it is listed');
  ok(T.isTrackPart('mods', { what: 'KW V3 coilovers' }) && !T.isTrackPart('mods', { what: 'Window tint' }), 'a plain list is judged by its wording');
  const S = [
    { id: 'a', date: '2026-01-10', bestTime: 102, conditions: 'Dry', temp: 10, tyres: 'PS4S' },
    { id: 'b', date: '2026-03-15', bestTime: 100.5, conditions: 'Dry', temp: 12, tyres: 'PS4S' },
    { id: 'c', date: '2026-05-02', bestTime: 99, conditions: 'Dry', temp: 24, tyres: 'Cup 2' },
    { id: 'w', date: '2026-05-20', bestTime: 105, conditions: 'Wet' },
    { id: 'd', date: '2026-07-01', bestTime: 98.7, conditions: 'Dry', temp: 22, tyres: 'Cup 2' }
  ];
  const r = T.modImpact(S, [{ label: 'KW V3 coilovers', year: 2026, month: 2 }, { label: 'Cup 2', year: 2026, month: 4 }, { label: 'Pads', year: 2026, month: 4 }, { label: 'Wing', year: 2027, month: null }]);
  ok(r.rows.length === 2 && r.rows[0].labels[0] === 'KW V3 coilovers' && r.rows[0].before === 102 && r.rows[0].after === 100.5 && r.rows[0].change === -1.5, 'a part: best dry time before and after');
  ok(r.rows[0].flags.join() === 'one session each side', 'and says when there is one session each side');
  ok(r.rows[1].labels.join() === 'Cup 2,Pads' && r.rows[1].change === -1.8 && r.rows[1].flags.includes('different tyres') && r.rows[1].flags.includes('10°C warmer'), 'parts fitted in the same month are one group, with the tyre and temperature caveats');
  ok(r.skipped.length === 1 && r.skipped[0].labels[0] === 'Wing', 'a part with no dry session after is skipped');
  const m = T.modImpact([{ id: 'x', date: '2026-04-10', bestTime: 100, conditions: 'Dry' }, { id: 'y', date: '2026-04-20', bestTime: 99, conditions: 'Dry' }], [{ label: 'Pads', year: 2026, month: 4 }]);
  ok(m.rows.length === 0 && m.skipped.length === 1, 'sessions in the month a part was fitted are left out (the day is unknown)');
  const wet = T.modImpact([{ id: 'x', date: '2026-01-10', bestTime: 100, conditions: 'Wet' }, { id: 'y', date: '2026-06-20', bestTime: 99, conditions: 'Dry' }], [{ label: 'Pads', year: 2026, month: 3 }]);
  ok(wet.rows.length === 0, 'wet sessions are not compared');
}

// RaceBox GPX: its "Start" waypoint is the lap line, so laps are cut where RaceBox cuts them
{
  const gx = T.read(fs.readFileSync(ROOT + 'tests/fixtures/racebox-castle-combe-gpx.gpx', 'utf8'), 'racebox.gpx');
  const sx = T.analyse(gx, lib, { type: 'track' });
  ok(gx.startLine && !sx.autoLine && sx.venueId === 'castle-combe', 'GPX Start waypoint is used as the lap line, not a guessed one');
  ok(sx.laps.length === 5 && near(sx.bestTime, 77.686, 0.1), 'Castle Combe best lap matches RaceBox (1:17.68)');
}

// RaceBox names its files day first; the day and time come out the right way round
{
  const d = T.dateFromName('RaceBox_Track_Session_on_14-07-2026_10-10_2.gpx');
  ok(d && d.date === '2026-07-14' && d.time === '10:10', 'a RaceBox file name gives its day and time (14-07-2026 10-10)');
  const t = T.dateFromName('telemetry-v1-2025-04-25-11_35_49.csv');
  ok(t && t.date === '2025-04-25' && t.time === '11:35', 'a year-first name still works');
}

// A Track Mode file with every time stamp at 0 (its timer was not running) is read, with the time worked out from the file
{
  const txt = fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-no-timestamps.csv', 'utf8');
  let rd = null, err = '';
  try { rd = T.read(txt, 'telemetry-v1-2024-02-23-15_10_30.csv'); } catch (e) { err = e.message; }
  ok(rd && !err, 'a file with every time stamp at 0 is read (' + err + ')');
  ok(rd && rd.timeRebuilt === true && rd.points.length === 300 && rd.rebuiltStep >= 0.005 && rd.rebuiltStep <= 0.25 && near(rd.points[299].t, 299 * rd.rebuiltStep, 0.001), 'its time is rebuilt from the rows, with the step worked out from the file');
  const drive = T.analyse(rd, { venues: [] }, { type: 'other' });
  ok(drive.type === 'other' && drive.carData && drive.carData.found.length > 5 && drive.distance > 30 && drive.date === '2024-02-23' && drive.time === '15:10', 'as a drive it has its day, distance and car figures');
  // The step comes from the speed and the GPS path: the speed times the rebuilt time adds up to the distance driven.
  const P = rd.points; let gps = 0, spd = 0;
  for (let i = 1; i < P.length; i++) { gps += T.haversine(P[i - 1], P[i]); spd += (P[i - 1].v + P[i].v) / 2 / 3.6 * (P[i].t - P[i - 1].t); }
  ok(Math.abs(spd / gps - 1) < 0.05, 'speed times the rebuilt time matches the GPS distance (' + (spd / gps).toFixed(3) + ')');
  const lap = T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-no-timestamps-lap.csv', 'utf8'), 'telemetry-v1-2024-02-23-15_10_30.csv');
  const ls = T.analyse(lap, { venues: [] }, {});
  ok(ls.laps && ls.laps.length === 1 && ls.laps[0].kind === 'timed' && near(ls.laps[0].time, 106.4, 1.5) && near(ls.laps[0].dist, 2416, 40), 'a whole lap in such a file is timed (' + (ls.laps && ls.laps[0] && ls.laps[0].time) + ' s)');
  const normal = T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-thruxton.csv', 'utf8'), 'telemetry-v1-2025-04-25-11_35_49.csv');
  ok(!normal.timeRebuilt, 'a file with real time stamps is not rebuilt');
}

// Each lap keeps the car's own figures for that lap
{
  const rd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-no-timestamps-lap.csv', 'utf8'), 'telemetry-v1-2024-02-23-15_10_30.csv');
  const ss = T.analyse(rd, { venues: [] }, {});
  const lc = ss.laps && ss.laps[0] && ss.laps[0].carData;
  ok(lc && lc.soc && lc.power && lc.batteryTemp && !('found' in lc) && !('empty' in lc), 'a lap carries its own Track Mode figures (charge, power, temperatures)');
  ok(lc && lc.soc.start >= lc.soc.end && ss.carData.soc.start >= lc.soc.start - 0.5, 'its battery figures sit inside the whole session\'s');
}

// The battery keeps two decimals, so rounding to a whole percent happens once: 60.48 is 60, not 61
{
  const rd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-short-drive-end.csv', 'utf8'), 'telemetry-v1-2026-10-02-23_01_21.csv');
  const d = T.analyse(rd, { venues: [] }, { type: 'other' });
  ok(d.carData && d.carData.soc && d.carData.soc.end === 60.48 && Math.round(d.carData.soc.end) === 60, 'the battery at the end is kept as 60.48, which is 60%, not 61% (' + (d.carData && d.carData.soc && d.carData.soc.end) + ')');
}

// Two files from one session: a lap timer's and the car's are lined up by their speed and joined
{
  const car = T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-no-timestamps-lap.csv', 'utf8'), 'telemetry-v1-2024-02-23-15_10_30.csv');
  // The same drive as a lap timer logs it: 10 a second, its clock starting 37.5 s before the car file, a little noise, and
  // speed and g-force only worked out from the positions (as a GPX has).
  const OFFSET = 37.5, pts = []; let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let t = 0; t < OFFSET; t += 0.1) pts.push({ t, lat: car.points[0].lat, lng: car.points[0].lng, v: 0, la: 1.5, lo: 1.5, sats: NaN });
  const last = car.points[car.points.length - 1].t; let j = 0;
  for (let tc = 0; tc <= last; tc += 0.1) {
    while (j < car.points.length - 2 && car.points[j + 1].t < tc) j++;
    const a = car.points[j], b = car.points[j + 1], f = (tc - a.t) / ((b.t - a.t) || 1);
    pts.push({ t: OFFSET + tc, lat: a.lat + (b.lat - a.lat) * f + rnd() * 2e-6, lng: a.lng + (b.lng - a.lng) * f + rnd() * 2e-6, v: a.v + (b.v - a.v) * f + rnd() * 0.6, la: 1.5, lo: -1.5, sats: NaN });
  }
  const timed = Object.assign({}, car, { points: pts, format: 'VBO', timeRebuilt: false, speedDerived: true, gDerived: true });
  const r = T.mergeSources(timed, car);
  ok(r.rd && Math.abs(r.shift - OFFSET) < 0.15 && r.corr > 0.99, 'the car file is lined up with the timed file by its speed (offset ' + (r.shift && r.shift.toFixed(2)) + ' s, match ' + (r.corr && r.corr.toFixed(3)) + ')');
  const ms = T.analyse(r.rd, { venues: [] }, {});
  ok(ms.laps && ms.laps.length === 1 && ms.laps[0].carData && ms.laps[0].carData.soc && ms.carSource && ms.carSource.match > 0.99, 'the joined session is timed by the lap timer and each lap has the car\'s figures');
  const carOnly = T.analyse(car, { venues: [] }, {});
  ok(ms.gDerived === false && Math.abs(ms.latMax - carOnly.latMax) < 0.05 && ms.latMax < 1.2, 'the car\'s own g-forces replace the ones worked out from GPS (' + ms.latMax + ' g, the car says ' + carOnly.latMax + ', not 1.5)');
  const other = T.read(fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1'), 'f.vbo');
  const bad = T.mergeSources(other, car);
  ok(!bad.rd && /line up|enough movement|same place/.test(bad.reason), 'files from different drives are not joined (' + bad.reason + ')');
  const noCar = T.mergeSources(other, other);
  ok(!noCar.rd && /no car data/.test(noCar.reason), 'a second file without car data is not joined');
  // The real pair: a RaceBox GPX and the Track Mode file of the same drive
  const rb = T.read(fs.readFileSync(ROOT + 'tests/fixtures/racebox-drive-2026-10-02.gpx', 'utf8'), 'RaceBox_Drag_Session_on_02-10-2026_23-03.gpx');
  const tm = T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-drive-2026-10-02.csv', 'utf8'), 'telemetry-v1-2026-10-02-23_01_21.csv');
  const real = T.mergeSources(rb, tm);
  ok(real.rd && real.corr > 0.99 && Math.abs(real.shift) < 0.5, 'a real RaceBox and Track Mode pair line up (offset ' + (real.shift && real.shift.toFixed(2)) + ' s, match ' + (real.corr && real.corr.toFixed(4)) + ')');
  // The g worked out from the GPX path turns the same way as the car's own readings, so a corner one way has one sign
  // on both kinds of file (and on RaceBox's own charts).
  {
    const corrOf = (a, b) => { let n = 0, sa = 0, sb = 0; a.forEach((x, i) => { if (isFinite(x) && isFinite(b[i])) { sa += x; sb += b[i]; n++; } }); const ma = sa / n, mb = sb / n; let aa = 0, bb = 0, ab = 0; a.forEach((x, i) => { if (isFinite(x) && isFinite(b[i])) { aa += (x - ma) ** 2; bb += (b[i] - mb) ** 2; ab += (x - ma) * (b[i] - mb); } }); return ab / Math.sqrt(aa * bb); };
    const latC = corrOf(rb.points.map(p => p.la), real.rd.points.map(p => p.la)), lonC = corrOf(rb.points.map(p => p.lo), real.rd.points.map(p => p.lo));
    ok(latC > 0.9 && lonC > 0.85, 'g from the GPS path has the sign and shape of the car\'s own (cornering match ' + latC.toFixed(2) + ', braking ' + lonC.toFixed(2) + ')');
  }
  // The car file has far more readings than the lap timer's, so a short peak between two of its points must still count:
  // the figures from the joined pair are the car file's own peaks (brake pressure 32.1 bar, power 243.6 kW, regen 79 kW).
  {
    const own = T.analyse(tm, { venues: [] }, { type: 'other' }).carData, joined = T.analyse(real.rd, { venues: [] }, { type: 'other' }).carData;
    ok(joined.brakePressure.max === own.brakePressure.max && joined.power.max === own.power.max && joined.power.regen === own.power.regen && joined.slip.max === own.slip.max,
      'a joined session keeps the car file\'s own peaks (' + joined.brakePressure.max + ' bar, ' + joined.power.max + ' kW, regen ' + joined.power.regen + ', slip ' + joined.slip.max + '; the car file says ' + own.brakePressure.max + ', ' + own.power.max + ', ' + own.power.regen + ', ' + own.slip.max + ')');
  }
  // Hardest braking only counts while moving, and one wild reading is not braking.
  {
    const mk = (spec) => spec.map((x, i) => ({ t: i * 0.1, v: x[0], ch: { bpr: x[1], soc: 50 } }));
    const still = T.carData(mk([[0, 32], [0, 32], [0, 5], [50, 6], [50, 7], [50, 8]]));
    ok(still.brakePressure.max === 8, 'a high brake pressure at a standstill is not the hardest braking (' + still.brakePressure.max + ')');
    const blip = T.carData(mk([[50, 6], [50, 7], [50, 40], [50, 7], [50, 8], [50, 9], [50, 9]]));
    ok(blip.brakePressure.max === 9, 'one wild reading is dropped (' + blip.brakePressure.max + ')');
    const none = T.carData(mk([[0, 30], [0, 31], [0, 32], [0, 33]]));
    ok(!none.brakePressure, 'no braking while moving gives no figure');
  }
  const rs = T.analyse(real.rd, { venues: [] }, { type: 'other' });
  ok(rs.gDerived === false && rs.latMax > 0.3 && rs.latMax < 0.7 && rs.carData && rs.carData.soc && rs.carData.soc.end < rs.carData.soc.start + 0.01, 'the real pair gives the car\'s own g-forces (' + rs.latMax + ' g) and its battery figures');
}

// GPS glitches. tests/fixtures/abingdon-glitches.csv is five columns of a real Track Mode sprint file, cut to
// its three bad patches with the clean driving either side: the fix drifting 8 m back up the road in a tight
// corner (and 33 rows the member picked out), creeping at half pace for 4 s and then jumping, and freezing
// for a second at 80 mph. After reading, each is spread out along the road: no reading sits behind the last
// 6 m of travel, and over any 0.8 s the fix has moved about as far as the speeds say. A real hairpin, a car
// standing still and a clean straight are left alone.
{
  const gl = T.read(fs.readFileSync(ROOT + 'tests/fixtures/abingdon-glitches.csv', 'utf8'), 'abingdon-glitches.csv');
  const P = gl.points, proj = T.projector(P[0].lat, P[0].lng), xy = P.map(p => proj.xy(p.lat, p.lng));
  let back = 0, off = 0, windows = 0, anchor = 0;
  for (let i = 1; i < P.length; i++) {
    if (P[i].t - P[i - 1].t > 2) { anchor = i; continue; } // the gap between two patches
    while (anchor < i - 1 && Math.hypot(xy[i - 1][0] - xy[anchor + 1][0], xy[i - 1][1] - xy[anchor + 1][1]) >= 6) anchor++;
    const dx = xy[i - 1][0] - xy[anchor][0], dy = xy[i - 1][1] - xy[anchor][1], L = Math.hypot(dx, dy);
    if (L >= 6 && P[i].v > 20 && ((xy[i][0] - xy[i - 1][0]) * dx + (xy[i][1] - xy[i - 1][1]) * dy) / L < -1.5) back++;
  }
  for (let k = 45; k < P.length; k += 45) {
    if (P[k].t - P[k - 45].t > 2) continue;
    let bySpeed = 0; for (let j = k - 44; j <= k; j++) bySpeed += (P[j].v + P[j - 1].v) / 2 / 3.6 * (P[j].t - P[j - 1].t);
    const byFix = Math.hypot(xy[k][0] - xy[k - 45][0], xy[k][1] - xy[k - 45][1]);
    windows++; if (Math.abs(bySpeed - byFix) > Math.max(8, 0.35 * bySpeed)) off++;
  }
  ok(gl.glitches >= 150 && gl.glitches <= 400, 'the three real glitches are mended (' + gl.glitches + ' readings moved)');
  ok(back === 0 && off === 0, 'after mending no reading goes back up the road and the fix keeps pace with the speeds (' + back + ' back, ' + off + ' of ' + windows + ' windows off)');
  // A fix that freezes on one spot for a second at 70 mph and then jumps to where the car really is.
  const lat0 = 51.69, kx = 111195 * Math.cos(lat0 * Math.PI / 180), v = 70 / 2.23694, rows = [];
  for (let i = 0; i < 200; i++) { const t = i / 40, y = -(i < 80 ? t * v : i < 120 ? 2 * v : t * v); rows.push([t.toFixed(3), (lat0 + y / 111195).toFixed(7), (-1.3).toFixed(7), 70].join(',')); }
  const fz = T.read('Time (s),Latitude,Longitude,Speed (mph)\n' + rows.join('\n'), 'freeze.csv');
  const ys = fz.points.map(p => (p.lat - lat0) * 111195), gaps = ys.slice(1).map((y, i) => ys[i] - y);
  ok(fz.glitches >= 35 && Math.max(...gaps) < 1.2 && Math.min(...gaps) > 0.6, 'a fix frozen for a second at speed is spread evenly to where it jumped to (' + fz.glitches + ' moved, steps ' + Math.min(...gaps).toFixed(2) + ' to ' + Math.max(...gaps).toFixed(2) + ' m)');
  const straight = rows.map((r, i) => { const t = i / 40; return [t.toFixed(3), (lat0 - t * v / 111195).toFixed(7), (-1.3).toFixed(7), 70].join(','); });
  ok(T.read('Time (s),Latitude,Longitude,Speed (mph)\n' + straight.join('\n'), 'clean.csv').glitches === 0, 'a clean straight has nothing moved');
  const step = 0.3, path = [];
  for (let i = 0; i < 90; i++) path.push([0, -i * step]);
  const y0 = -89 * step, Rd = 6;
  for (let a = 0; a <= Math.PI; a += step / Rd) path.push([Rd - Rd * Math.cos(a), y0 - Rd * Math.sin(a)]);
  const yEnd = path[path.length - 1][1]; for (let i = 1; i < 90; i++) path.push([2 * Rd, yEnd + i * step]);
  const hp = T.read('Time (s),Latitude,Longitude,Speed (mph)\n' + path.map((p, i) => [(i / 30).toFixed(3), (lat0 + p[1] / 111195).toFixed(7), (-1.3 + p[0] / kx).toFixed(7), 20].join(',')).join('\n'), 'hairpin.csv');
  ok(hp.glitches === 0, 'a real hairpin is not changed');
  const still = []; for (let i = 0; i < 300; i++) still.push([(i / 30).toFixed(3), (lat0 + (Math.sin(i) * 1.5) / 111195).toFixed(7), (-1.3 + (Math.cos(i * 0.7) * 1.5) / kx).toFixed(7), i < 60 || i > 240 ? 15 : 0].join(','));
  ok(T.read('Time (s),Latitude,Longitude,Speed (mph)\n' + still.join('\n'), 'still.csv').glitches === 0, 'a car standing still with the fix wandering is not changed');
  // Backing up 3.5 m to a start line, then a 1 g launch past the spot the car had reached: not a drift.
  const rev = []; let x = 0, vv = 0;
  for (let i = 0; i < 400; i++) {
    const t = i / 50;
    if (t < 2) { vv = 5.5; x += vv / 50; } else if (t < 2.5) { vv = 0; } else if (t < 3.5) { vv = -3.3; x += vv / 50; } else if (t < 4) { vv = 0; } else { vv = Math.min(30, 9.81 * (t - 4)); x += vv / 50; }
    rev.push([t.toFixed(3), (lat0 + x / 111195).toFixed(7), (-1.3).toFixed(7), (Math.abs(vv) * 2.23694).toFixed(1)].join(','));
  }
  ok(T.read('Time (s),Latitude,Longitude,Speed (mph)\n' + rev.join('\n'), 'reverse.csv').glitches === 0, 'backing up to a start line and launching is not changed');
}

// ownLines (the admin moving or keeping a session's own lines): the lines given are used, not the course's.
{
  const rdT = T.read(vbo, 'RaceBox_Track_Session.vbo');
  const course = T.analyse(rdT, lib);
  const line = course.startLine.map(p => [p[0] + 0.00002, p[1]]);
  const withCourse = T.analyse(rdT, lib, { type: 'track', startLine: line });
  const own = T.analyse(rdT, lib, { type: 'track', startLine: line, ownLines: true });
  ok(!withCourse.startLineFromMember && JSON.stringify(withCourse.startLine) === JSON.stringify(course.startLine), "the course's own line wins over a member's line");
  ok(own.startLineFromMember === true && JSON.stringify(own.startLine) === JSON.stringify(line) && own.laps.length >= 1, 'with ownLines the line given is used instead (' + own.laps.length + ' laps)');
}

// A hill climb whose start and finish are the wrong way round: the drive back down the same road is timed instead of the
// climb, and the file says so (reverseRun). Trimmed from a real VBOX Sport file from Shelsley Walsh.
{
  const hrd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/shelsley-climb-and-descent.vbo', 'latin1'), 'Shelsley_HillClimb.VBO');
  const P = hrd.points;
  const near2 = t => P.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
  const across = (p, q, w = 0.00012) => { const dx = q.lng - p.lng, dy = q.lat - p.lat, n = Math.hypot(dx, dy); const px = -dy / n, py = dx / n; return [[p.lat + py * w, p.lng + px * w], [p.lat - py * w, p.lng - px * w]]; };
  // The climb: the car moves off at the bottom and stops at the top. Find those times from the speeds.
  const fast = P.filter(p => p.v > 100), climbStart = fast[0].t - 4, climbEnd = fast[fast.length - 1].t + 20;
  const right = T.analyse(hrd, { venues: [] }, { type: 'sprint', ownLines: true, startLine: across(near2(climbStart), near2(climbStart + 1)), finishLine: across(near2(climbEnd), near2(climbEnd - 1)) });
  ok(right.bestTime && right.bestTime < 70 && !right.reverseRun, 'a climb timed the right way round is about a minute and is not flagged: ' + right.bestTime);
  const wrong = T.analyse(hrd, { venues: [] }, { type: 'sprint', ownLines: true, startLine: across(near2(climbEnd), near2(climbEnd - 1)), finishLine: across(near2(climbStart), near2(climbStart + 1)) });
  ok(wrong.bestTime && wrong.bestTime > 80, 'with the lines the wrong way round the drive back down is timed: ' + wrong.bestTime);
  ok(wrong.reverseRun && wrong.reverseRun.peak > 140 && wrong.reverseRun.fwdPeak < 70 && wrong.reverseRun.time > 40 && wrong.reverseRun.time < 80, 'and the faster pass the other way is reported: ' + JSON.stringify(wrong.reverseRun));
  ok(T.ANALYSIS_VERSION >= 9, 'the analysis version moved on');
}

// A standing start is timed from the first reading above 0.5 km/h (the moment the car moves off), whatever the start
// line is: only the finish line decides where the clock stops. The Shelsley file with the finish line from the VBOX time
// of 33.05 s, and start lines at the launch, 3 m on and 60 m on.
{
  const hrd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/shelsley-climb-and-descent.vbo', 'latin1'), 'Shelsley_HillClimb.VBO');
  const F = [[52.2598990, -2.4135109], [52.2598692, -2.4138598]];
  const P = hrd.points;
  const up = P.find(p => p.v > 100).t; let k = P.findIndex(p => p.t >= up - 6); while (k > 0 && P[k - 1].v > 0.5) k--;
  ok(near(P[k].v, 1.61, 0.01), 'the first reading above 0.5 km/h is the move-off reading (1.61 km/h)');
  // Start lines 3 m and 60 m along the road from the move-off point.
  const along = m => { let d = 0; for (let j = k + 1; j < P.length; j++) { d += T.haversine(P[j - 1], P[j]); if (d >= m) return { a: P[j - 1], b: P[j] }; } };
  const across = (m, w = 0.00011) => { const s = along(m), dx = s.b.lng - s.a.lng, dy = s.b.lat - s.a.lat, n = Math.hypot(dx, dy), px = -dy / n, py = dx / n; return [[s.a.lat + py * w, s.a.lng + px * w], [s.a.lat - py * w, s.a.lng - px * w]]; };
  for (const m of [3, 60, 100]) {
    const r = T.analyse(hrd, { venues: [] }, { type: 'sprint', ownLines: true, startLine: across(m), finishLine: F, ignoreFirstFinish: true });
    ok(r.laps.length === 1 && near(r.bestTime, 33.05, 0.06), 'a start line ' + m + ' m past the move-off point gives the same time (clock from the move-off): ' + r.bestTime);
  }
}

// A standing start starts the clock from the recorded accelerometer or the speed, whichever moves first (version 14):
// a logger whose speed column lags the car (Tesla Track Mode) is timed from the g launch, so the time does not shrink.
{
  const hrd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/shelsley-climb-and-descent.vbo', 'latin1'), 'Shelsley_HillClimb.VBO');
  const F = [[52.2598990, -2.4135109], [52.2598692, -2.4138598]];
  const P = hrd.points;
  const up = P.find(p => p.v > 100).t; let k = P.findIndex(p => p.t >= up - 6); while (k > 0 && P[k - 1].v > 0.5) k--;
  const along = m => { let d = 0; for (let j = k + 1; j < P.length; j++) { d += T.haversine(P[j - 1], P[j]); if (d >= m) return { a: P[j - 1], b: P[j] }; } };
  const across = (m, w = 0.00011) => { const s = along(m), dx = s.b.lng - s.a.lng, dy = s.b.lat - s.a.lat, n = Math.hypot(dx, dy), px = -dy / n, py = dx / n; return [[s.a.lat + py * w, s.a.lng + px * w], [s.a.lat - py * w, s.a.lng - px * w]]; };
  const opts = { type: 'sprint', ownLines: true, startLine: across(3), finishLine: F, ignoreFirstFinish: true };
  const base = T.analyse(hrd, { venues: [] }, opts);
  ok(base.launch && base.launch.from === 'speed' && base.launch.lead === 0 && near(base.bestTime, 33.05, 0.06), 'on the VBOX file the g and the speed rise on the same reading, so the clock still starts from the speed: ' + base.bestTime + ' ' + JSON.stringify(base.launch));
  ok(T.ANALYSIS_VERSION >= 14, 'the analysis version moved on');
  // The same file with its speed column 0.3 s late: every reading takes the speed of the one 0.3 s before it.
  function lagged(rd, lag) {
    const c = JSON.parse(JSON.stringify(rd));
    const v = rd.points.map(p => p.v);
    c.points.forEach((p, j) => { let i = j; while (i > 0 && rd.points[i].t > p.t - lag) i--; p.v = v[i]; });
    return c;
  }
  const lag = T.analyse(lagged(hrd, 0.3), { venues: [] }, opts);
  ok(lag.launch && lag.launch.from === 'g' && near(lag.launch.lead, 0.3, 0.11), 'with the speed 0.3 s late the accelerometer starts the clock, 0.3 s ahead of the speed: ' + JSON.stringify(lag.launch));
  ok(near(lag.bestTime, base.bestTime, 0.05), 'so the time is the same as with a true speed column: ' + lag.bestTime + ' against ' + base.bestTime);
  // g worked out from the speed lags just the same, so it is not used: the clock starts from the late speed.
  const derived = lagged(hrd, 0.3); derived.gDerived = true;
  const der = T.analyse(derived, { venues: [] }, opts);
  ok(der.launch && der.launch.from === 'speed' && der.bestTime < base.bestTime - 0.2 && der.bestTime > base.bestTime - 0.6, 'a file whose g was worked out from its speed is still timed from the late speed, so its time shrinks: ' + der.bestTime + ' ' + JSON.stringify(der.launch));
  // A hill start sits on a slope: a constant g while standing is the level, not a launch.
  const slope = lagged(hrd, 0.3); slope.points.forEach(p => { if (isFinite(p.lo)) p.lo += 0.12; });
  const sl = T.analyse(slope, { venues: [] }, opts);
  ok(sl.launch && sl.launch.from === 'g' && near(sl.launch.lead, lag.launch.lead, 0.01) && near(sl.bestTime, base.bestTime, 0.05), 'a slope\'s standing g does not fire the launch early: ' + JSON.stringify(sl.launch) + ' ' + sl.bestTime);
}

// A launch that reaches 30 mph but not 60 mph is a run too, listed with the figures it reached; creeping about is not.
{
  const rows = ['time,latitude,longitude,speed (mph)'];
  let x = 0;
  const vAt = t => t < 4 ? 0 : t < 14 ? 45 * (t - 4) / 10 : t < 24 ? 45 * (24 - t) / 10 : t < 28 ? 0
    : t < 48 ? 100 * (1 - Math.exp(-(t - 28) / 6)) : t < 58 ? 100 * (1 - Math.exp(-20 / 6)) * (58 - t) / 10 : t < 62 ? 0
    : t < 66 ? 5 * (t - 62) / 4 : t < 70 ? 5 * (70 - t) / 4 : 0;
  for (let i = 0; i <= 760; i++) { const t = i / 10, v = Math.max(0, vAt(t)); x += v * 0.44704 * 0.1; rows.push([t.toFixed(1), (51.5 + x / 110540).toFixed(7), (-0.12).toFixed(7), v.toFixed(2)].join(',')); }
  const part = T.analyse(T.read(rows.join('\n'), 'two-launches.csv'), { venues: [] }, { type: 'drag' });
  ok(part.runs.length === 2, 'a launch that stops short of 60 mph is listed, the creeping is not: ' + part.runs.length);
  ok(part.runs[0].s30 && !part.runs[0].s60 && part.runs[0].ft60, 'the short launch has the figures it reached (60 ft, 0-30) and no 0-60');
  ok(part.runs[1].s60 && part.runs[1].s30, 'the full launch has 0-60 too');
  ok(T.ANALYSIS_VERSION >= 10, 'the analysis version moved on');
  ok(!T.sessionNotes(part).some(n => /NaN/.test(n.text)), 'the notes cope with a run that has no 0-60');
}

// The g figures of a lap trace are the biggest in each step, so a peak that falls between two kept readings is not
// lost, and one wild reading is not a peak.
{
  const grd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1'), 'x.vbo');
  const base = T.analyse(grd, lib), L = base.laps.find(l => l.n === base.best), P = grd.points;
  const inLap = [];
  for (let i = 0; i < P.length; i++) if (P[i].t >= L.start && P[i].t <= L.start + L.time) inLap.push(i);
  // Make every reading a quiet 0.2 g, then put a 3-reading peak of 1.27 g and, elsewhere, one wild reading of 3 g.
  const edited = JSON.parse(JSON.stringify(grd));
  inLap.forEach(i => { edited.points[i].la = 0.2; });
  // A two-reading peak on readings the trace does not keep (it keeps the first reading in each 0.2 s), so a trace that
  // only took the kept readings would miss it.
  const kept = new Set(); let nextT = L.start;
  inLap.forEach(i => { if (P[i].t + 1e-9 >= nextT) { kept.add(i); nextT = P[i].t + 0.2; } });
  let peakAt = -1;
  for (let j = Math.floor(inLap.length / 2); j < inLap.length - 3; j++) if (!kept.has(inLap[j]) && !kept.has(inLap[j + 1])) { peakAt = inLap[j]; break; }
  ok(peakAt > 0, 'found two readings the trace does not keep');
  [0, 1].forEach(d => { edited.points[peakAt + d].la = -1.27; });
  edited.points[inLap[10]].la = 3.0;
  const got = T.analyse(edited, lib), tr = got.trace.laps[got.best];
  const peak = Math.max(...tr.map(r => Math.abs(r[5])));
  ok(near(peak, 1.27, 0.011), 'a short corner peak between kept readings reaches the trace: ' + peak.toFixed(2));
  ok(tr.every(r => Math.abs(r[5]) < 2), 'one wild reading is not a peak');
  ok(T.ANALYSIS_VERSION >= 11, 'the analysis version moved on again');
}

// Hundredths of a g round half away from zero, as RaceBox does (-0.935 g of braking reads 0.94, not 0.93), and only a
// glitch over 0.25 g from its neighbours is smoothed out of the peaks: real readings are kept as recorded.
{
  const grd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1'), 'x.vbo');
  const base = T.analyse(grd, lib), L = base.laps.find(l => l.n === base.best), P = grd.points;
  const edited = JSON.parse(JSON.stringify(grd));
  const inLap = []; for (let i = 0; i < P.length; i++) if (P[i].t >= L.start && P[i].t <= L.start + L.time) inLap.push(i);
  inLap.forEach(i => { edited.points[i].lo = 0.1; edited.points[i].la = 0.1; });
  const mid = inLap[Math.floor(inLap.length / 2)];
  [0, 1, 2, 3].forEach(d => { edited.points[mid + d].lo = -0.935; edited.points[mid + d].la = 1.264; });
  const got = T.analyse(edited, lib), tr = got.trace.laps[got.best];
  ok(Math.min(...tr.map(r => r[6])) === -0.94, 'braking of -0.935 g reads 0.94 on the chart: ' + Math.min(...tr.map(r => r[6])));
  ok(Math.max(...tr.map(r => r[5])) === 1.26, 'a real 1.264 g reading is kept as recorded: ' + Math.max(...tr.map(r => r[5])));
  ok(T.ANALYSIS_VERSION >= 13, 'the analysis version moved on once more');
}

// A place listed as both a circuit and a sprint: a day of laps round the circuit is a track day, not a sprint
{
  const rd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/racebox-castle-combe-gpx.gpx', 'utf8'), 'RaceBox_Castle_Combe.gpx');
  const mid = rd.points[Math.floor(rd.points.length / 2)];
  const both = { venues: lib.venues.concat([{ id: 'castle-combe-sprint', name: 'Castle Combe Sprint', type: 'sprint', lat: mid.lat, lng: mid.lng, radius: 1500, layouts: [{ id: 'c', name: 'Course', length: 2000 }] }]) };
  const auto = T.analyse(rd, both, {});
  ok(auto.type === 'track' && auto.venueId === 'castle-combe' && auto.laps.filter(l => l.kind === 'timed').length >= 3, 'laps round a circuit that is also listed as a sprint are timed as a track day (' + auto.type + ', ' + auto.venueId + ')');
  ok(T.analyse(rd, both, { type: 'sprint' }).type === 'sprint', 'a type the member picked is never changed');
  // Two laps are enough, and a circuit listed with no lap lengths yet (a new place) is accepted on the laps alone.
  const th = T.read(fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1'), 'f.vbo');
  const tm = th.points[Math.floor(th.points.length / 2)];
  const bare = { venues: [{ id: 'th-sprint', name: 'Thruxton Sprint', type: 'sprint', lat: tm.lat, lng: tm.lng, radius: 1500, layouts: [] }, { id: 'th-new', name: 'Thruxton', type: 'circuit', lat: tm.lat + 0.002, lng: tm.lng, radius: 2500, layouts: [] }] };
  const two = T.analyse(th, bare, {});
  ok(two.type === 'track' && two.venueId === 'th-new', 'two laps round a new circuit with no lap lengths are a track day, not a sprint (' + two.type + ', ' + two.venueId + ')');
}
// Picking the layout: a listed layout the member names is used whatever its length, and "a different layout" leaves the listed ones out.
{
  const lib2 = JSON.parse(JSON.stringify(lib));
  const tv = lib2.venues.find(v => v.id === 'thruxton');
  tv.layouts.push({ id: 'short', name: 'Short Circuit', length: 1800, startLine: tv.layouts[0].startLine, sectors: [], corners: [] });
  const rd2 = T.read(vbo, 'RaceBox_Track_Session.vbo');
  let a0 = T.analyse(rd2, lib2, {});
  ok(a0.layoutId === 'main', 'with no pick the layout comes from the lap length');
  let a1 = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib2, { layoutId: 'short' });
  ok(a1.layoutId === 'short' && a1.layout === 'Short Circuit' && a1.officialLines === true && a1.laps.length === 2, 'a layout the member picks is used, whatever its listed length');
  let a2 = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib2, { newLayout: true });
  ok(!a2.layoutId && a2.laps.length === 2 && !a2.officialLines, 'a different layout is timed on the member\'s own line and matches none of the listed ones');
}
// A layout with no length is not trusted over one whose length is known, and a different layout never takes a guessed line.
{
  const lib3 = JSON.parse(JSON.stringify(lib));
  const tv3 = lib3.venues.find(v => v.id === 'thruxton');
  const base = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib3, {});
  tv3.layouts[0].length = Math.round(base.laps[0].dist * 1.08);
  tv3.layouts.unshift({ id: 'nolength', name: 'No length', startLine: tv3.layouts[0].startLine, sectors: [], corners: [] });
  const b = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib3, {});
  ok(b.layoutId === 'main', 'a layout with no length does not beat one whose length is within 8% (' + b.layoutId + ')');
  const rd4 = T.read(vbo, 'RaceBox_Track_Session.vbo'); rd4.startLine = null;
  const c = T.analyse(rd4, lib3, { newLayout: true });
  ok(c.needsStartLine === true && !c.layoutId && /new layout|this layout/.test(c.problem), 'a different layout with no line from the file asks the member to mark one, not a guessed line');
  ok(Array.isArray(c.suggestedLine) && c.suggestedLine.length === 2 && c.laps.length === 0, 'and offers the line found from the trace as a suggestion only, with no laps timed on it');
  const rd5 = T.read(vbo, 'RaceBox_Track_Session.vbo'); rd5.startLine = null;
  const d5 = T.analyse(rd5, lib3, {});
  ok(!d5.needsStartLine, 'a track day with no layout pick is still timed from the lap line it finds');
}
// Two layouts on the same line: the lap length decides, a lap more or fewer cannot, and a saved session being re-timed keeps its layout.
{
  const lib4 = JSON.parse(JSON.stringify(lib));
  const tv4 = lib4.venues.find(v => v.id === 'thruxton');
  const base4 = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib4, {});
  const real = base4.laps[0].dist;
  tv4.layouts[0].length = Math.round(real * 1.1);
  tv4.layouts.push({ id: 'closer', name: 'Closer fit', length: Math.round(real * 1.01), startLine: tv4.layouts[0].startLine, sectors: [], corners: [] });
  const w = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib4, {});
  ok(w.layoutId === 'closer', 'of two layouts that fit, the one whose length is closer wins (' + w.layoutId + ')');
  const k = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib4, { keepLayoutId: 'main' });
  ok(k.layoutId === 'main', 'a re-time keeps the session on its own layout while that layout still fits (' + k.layoutId + ')');
}
// A layout the member picked is flagged, and one found from the lap is not.
{
  const lib5 = JSON.parse(JSON.stringify(lib));
  const picked = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib5, { layoutId: 'main' });
  ok(picked.layoutId === 'main' && picked.layoutPicked === true, 'a layout the member picks is marked as picked by them');
  const auto = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib5, {});
  ok(auto.layoutId === 'main' && !auto.layoutPicked, 'a layout worked out from the lap is not marked');
}
// A line the member marked is used even when the line in the file would give a lap more.
{
  const lib5 = JSON.parse(JSON.stringify(lib));
  const rdA = T.read(vbo, 'RaceBox_Track_Session.vbo');
  const fileRes = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib5, { newLayout: true });
  const pr = T.projector(rdA.points[0].lat, rdA.points[0].lng);
  let found = null;
  for (let i = 40; i < rdA.points.length - 40 && !found; i += 25) {
    const p0 = pr.xy(rdA.points[i].lat, rdA.points[i].lng), p1 = pr.xy(rdA.points[i + 8].lat, rdA.points[i + 8].lng);
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * 12, ny = dx / L * 12;
    const line = [pr.ll(p0[0] + nx, p0[1] + ny), pr.ll(p0[0] - nx, p0[1] - ny)];
    const r2 = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib5, { newLayout: true, startLine: line });
    if (r2.laps && r2.laps.length && r2.laps.length < fileRes.laps.length) found = { line, r2 };
  }
  ok(found && found.r2.startLineFromMember === true && JSON.stringify(found.r2.startLine) === JSON.stringify(found.line), 'the member\'s own line is used even when the file\'s line would time more laps');
}
// A picked layout whose saved line the file never crosses is timed on another line, and says how far away that line is.
{
  const lib6 = JSON.parse(JSON.stringify(lib));
  const tv6 = lib6.venues.find(v => v.id === 'thruxton');
  tv6.layouts.push({ id: 'far', name: 'Far Layout', length: 3790, startLine: [[tv6.lat + 0.02, tv6.lng + 0.02], [tv6.lat + 0.0201, tv6.lng + 0.0201]], sectors: [], corners: [] });
  const f = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib6, { layoutId: 'far' });
  ok(f.layoutId === 'far' && f.layoutLineGap > 1000 && !f.officialLines, 'a picked layout whose saved line the file does not cross says how far that line is (' + f.layoutLineGap + ' m)');
  const g = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib6, {});
  ok(g.layoutLineGap === undefined, 'and a layout that is crossed says nothing');
}
// A recording that starts right on the line crosses it once: for a layout the member picked, that start counts as the crossing.
{
  const full = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib, {});
  const l1 = full.laps[0];
  const cut = () => { const r = T.read(vbo, 'RaceBox_Track_Session.vbo'); r.points = r.points.filter(p => p.t >= l1.start + 0.2 && p.t <= l1.start + l1.time + 0.5); return r; };
  const picked = T.analyse(cut(), lib, { layoutId: 'main' });
  ok(picked.layoutId === 'main' && picked.officialLines === true && picked.laps.length === 1 && Math.abs(picked.laps[0].time - (l1.time - 0.2)) < 1, 'a file that starts on the line of a layout the member picked is timed on that line (lap ' + (picked.laps[0] && picked.laps[0].time) + ' of ' + l1.time + ')');
  const unpicked = T.analyse(cut(), lib, {});
  ok(unpicked.layoutId === 'main' && unpicked.officialLines === true && unpicked.laps.length === 1, 'and with no pick the same file goes on that layout too, so a re-time puts it there');
  const lib8 = JSON.parse(JSON.stringify(lib)); lib8.venues.find(v => v.id === 'thruxton').layouts[0].length = 1000;
  const wrongLen = T.analyse(cut(), lib8, {});
  ok(!wrongLen.layoutId, 'but not when the lap is nowhere near that layout\'s length');
}
// A file with no lap from the line back to itself (it starts and stops part way round) still belongs to the layout it drove:
// picked, or the only layout it fits, with the laps timed from the trace and the layout's line kept as the line of record.
{
  const full = T.analyse(T.read(vbo, 'RaceBox_Track_Session.vbo'), lib, {});
  const l1 = full.laps[0], l2 = full.laps[1], official = lib.venues.find(v => v.id === 'thruxton').layouts[0].startLine;
  const cut = () => { const r = T.read(vbo, 'RaceBox_Track_Session.vbo'); r.points = r.points.filter(p => p.t >= l1.start + 5 && p.t <= l1.start + l1.time + l2.time - 5); return r; };
  const picked = T.analyse(cut(), lib, { layoutId: 'main' });
  ok(picked.layoutId === 'main' && picked.lapsFromTrace === true && JSON.stringify(picked.startLine) === JSON.stringify(official) && !picked.autoLine && picked.laps.length >= 1 && picked.layoutLineGap === undefined, 'a picked layout takes a file that has no lap from its line back to itself, laps timed from the trace');
  const found = T.analyse(cut(), lib, {});
  ok(found.layoutId === 'main' && found.lapsFromTrace === true, 'and so does the only layout the drive fits when none is picked, so a re-time puts it there');
  const libLen = JSON.parse(JSON.stringify(lib)); libLen.venues.find(v => v.id === 'thruxton').layouts[0].length = 1000;
  const wrong = T.analyse(cut(), libLen, {});
  ok(!wrong.layoutId && !wrong.lapsFromTrace, 'but not when the laps are nowhere near its length');
  const libFar = JSON.parse(JSON.stringify(lib)); const tvf = libFar.venues.find(v => v.id === 'thruxton'); tvf.layouts[0].startLine = [[tvf.lat + 0.02, tvf.lng + 0.02], [tvf.lat + 0.0201, tvf.lng + 0.0201]];
  const farRes = T.analyse(cut(), libFar, {});
  ok(!farRes.lapsFromTrace && !farRes.layoutId, 'or when the car never passed its line');
}

// Tesla dashcam telemetry (Beta): no time column, only frame numbers at 36 a second. tests/fixtures/tesla-dashcam-castle-combe.csv
// is three dashcam clips joined in one file (frames 30690 to 32828, 32850 to 35009 and 35046 on, so the car dropped 21 and
// 36 frames between clips), cut to the rows where the GPS fix moves. Castle Combe, 24 August 2026.
{
  const text = fs.readFileSync(ROOT + 'tests/fixtures/tesla-dashcam-castle-combe.csv', 'utf8');
  const dc = T.read(text, '8c7c31ce-2026-08-24_12-09-35.csv');
  ok(dc.dashcam === true && dc.format === 'CSV', 'a dashcam file is recognised from its frame numbers');
  const lastFrame = Number(text.trim().split('\n').pop().split(',')[0]), firstFrame = Number(text.split('\n')[1].split(',')[0]);
  ok(near(dc.points[dc.points.length - 1].t, (lastFrame - firstFrame) / 36, 0.3), 'time is the frame count over 36, so the frames dropped between clips are counted');
  ok(dc.points.every((p, i) => i === 0 || p.t > dc.points[i - 1].t), 'time only goes forward');
  ok(dc.fileDate === '2026-08-24' && dc.fileTime === '12:09' && dc.dateSrc === 'name', 'the date and time come from the file name');
  const ds = T.analyse(dc, lib);
  ok(ds.venueId === 'castle-combe' && ds.type === 'track' && ds.dashcam === true, 'Castle Combe found, and the session is marked as dashcam');
  const lt = ds.laps.filter(l => l.kind === 'timed').map(l => l.time);
  ok(lt.length === 2 && lt.every(t => t > 82 && t < 83.5), 'two laps of about 1:22.6 to 1:23 (' + lt.join(', ') + ')');
  const others = T.analyse(T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-thruxton.csv', 'utf8'), 'telemetry-v1-2025-04-25-11_35_49.csv'), lib);
  ok(!('dashcam' in others) && !T.read(vbo, 'x.vbo').dashcam, 'no other format is marked as dashcam');
}
