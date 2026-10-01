// Run by tests/test_track_worker.py: the worker's track session routes with a fake KV store and
// photo bucket. Sessions come from js/track-parse.js reading tests/fixtures/thruxton-trimmed.vbo,
// as the page does. WORKER_MODULE is a copy of the worker that node can load.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const T = require(ROOT + 'js/track-parse.js');
const tracksJson = fs.readFileSync(ROOT + 'data/tracks.json', 'utf8');
const lib = JSON.parse(tracksJson);
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const bucket = new Map();
const env = {
  ADMIN_KEY: 'secret',
  VOTES: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
  GALLERY_BUCKET: {
    get: async k => bucket.has(k) ? { json: async () => JSON.parse(bucket.get(k)) } : null,
    put: async (k, v) => { bucket.set(k, typeof v === 'string' ? v : 'binary'); },
    delete: async k => { bucket.delete(k); },
    list: async () => { throw new Error('list() used'); }
  },
  SEND_EMAIL: { sent: [], send: async function (m) { this.sent.push(m.raw); } }
};
globalThis.fetch = async url => String(url).endsWith('/data/tracks.json') ? new Response(tracksJson, { status: 200 }) : new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const A = 'a@example.com', B = 'b@example.com';
kv.set('my-builds-session:tok-a', A);
kv.set('my-builds-session:tok-b', B);
kv.set('profile:' + A, JSON.stringify({ firstName: 'Rich', lastName: 'H', nickname: 'Rich' }));
kv.set('profile:' + B, JSON.stringify({ firstName: 'Ann', lastName: 'B', nickname: 'Ann' }));
kv.set('subscriber:' + A, JSON.stringify(['a1.jpg']));
kv.set('subscriber:' + B, JSON.stringify(['b1.jpg']));
await mod.putSidecar(env, 'gallery/a1.jpg.json', { email: A, carId: 'cara1' });
await mod.saveCarRecord(env, { id: 'cara1', name: 'Arctic Three', photos: ['a1.jpg'], mods: ['KW V3 coilovers'] });
kv.set('car-details:cara1', JSON.stringify({ model: 'Model 3', version: 'Performance' }));
await mod.putSidecar(env, 'gallery/b1.jpg.json', { email: B, carId: 'carb1' });
await mod.saveCarRecord(env, { id: 'carb1', name: 'Blue Y', photos: ['b1.jpg'], mods: [] });
kv.set('car-details:carb1', JSON.stringify({ model: 'Model Y' }));

const call = async (method, path, body, token) => {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) init.headers['X-Session-Token'] = token;
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const session = T.analyse(T.read(fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1'), 'f.vbo'), lib);

// Saving
let r = await call('POST', '/track/sessions', { carId: 'cara1', session });
ok(r.status === 401, 'saving needs a sign-in');
r = await call('POST', '/track/sessions', { carId: 'carb1', session }, 'tok-a');
ok(r.status === 403, 'only to your own car');
r = await call('POST', '/track/sessions', { carId: 'cara1', session, temp: '' }, 'tok-a');
ok(r.status === 200 && r.body.session.temp === null, 'a blank temperature stays blank, not 0');
await call('DELETE', '/track/session?id=' + r.body.session.id, undefined, 'tok-a');
r = await call('POST', '/track/sessions', { carId: 'cara1', session, temp: 19, tempSource: 'weather', weather: { temp: 19, rain: 0, wind: 12, hour: '14:00', source: 'evil' } }, 'tok-a');
ok(r.body.session.temp === 19 && r.body.session.tempSource === 'weather' && r.body.session.weather.source === 'Open-Meteo' && r.body.session.weather.hour === '14:00', 'temperature from Open-Meteo is kept with its source');
const wid = r.body.session.id;
r = await call('PUT', '/track/session', { id: wid, temp: 21 }, 'tok-a');
ok(r.body.session.temp === 21 && r.body.session.tempSource === 'member' && !r.body.session.weather, 'typing a temperature makes it the member\'s');
await call('DELETE', '/track/session?id=' + r.body.session.id, undefined, 'tok-a');
const fake = JSON.parse(JSON.stringify(session)); fake.venue = 'Made up <b>'; fake.layout = 'X';
r = await call('POST', '/track/sessions', { carId: 'cara1', session: fake, conditions: 'Dry', tyres: 'Pilot Sport 4S', temp: 19, notes: 'First go' }, 'tok-a');
ok(r.status === 200 && r.body.session.privacy === 'private', 'saved, private by default ' + JSON.stringify(r.body).slice(0, 200));
const id1 = r.body.session.id;
ok(r.body.session.venue === 'Thruxton' && r.body.session.layout === 'Thruxton' && Math.abs(r.body.session.bestTime - 99.786) < 0.01, 'venue and layout names come from the track list');
r = await call('GET', '/track/sessions', undefined, 'tok-a');
ok(r.body.sessions.length === 1 && r.body.sessions[0].id === id1 && r.body.sessions[0].tyres === 'Pilot Sport 4S', 'in my list');
r = await call('GET', '/track/session?id=' + id1, undefined, 'tok-a');
ok(r.status === 200 && r.body.session.mine && r.body.session.notes === 'First go' && r.body.session.trace.laps['2'].length > 100 && !r.body.session.owner, 'the owner opens it with the trace');
r = await call('GET', '/track/session?id=' + id1, undefined, 'tok-b');
ok(r.status === 404, 'private: others cannot open it');
r = await call('GET', '/track/session?id=' + id1);
ok(r.status === 404, 'private: visitors cannot open it');
r = await call('GET', '/track/public?car=cara1');
ok(r.status === 200 && r.body.sessions.length === 0 && r.body.car.name === 'Arctic Three', 'nothing shared yet');

// Sharing
r = await call('PUT', '/track/session', { id: id1, privacy: 'build' }, 'tok-a');
ok(r.status === 200 && r.body.session.privacy === 'build', 'shared on the build');
r = await call('GET', '/track/session?id=' + id1);
ok(r.status === 200 && !r.body.session.mine && !('notes' in r.body.session) && !JSON.stringify(r.body).includes(A), 'others see it, without notes or email');
r = await call('GET', '/track/public?car=cara1');
ok(r.body.sessions.length === 1 && r.body.car.owner === 'Rich' && r.body.car.model === 'Model 3', 'on the build page');
r = await call('GET', '/track/board?venue=thruxton&layout=main');
ok(r.body.entries.length === 1 && r.body.entries[0].sessionId === id1, 'shared on the build: on the leaderboard too');
r = await call('PUT', '/track/session', { id: id1, privacy: 'board' }, 'tok-a');
r = await call('GET', '/track/board?venue=thruxton&layout=main');
ok(r.body.entries.length === 1 && r.body.entries[0].owner === 'Rich' && r.body.entries[0].model === 'Model 3' && r.body.entries[0].mods[0] === 'KW V3 coilovers' && Math.abs(r.body.entries[0].time - 99.786) < 0.01, 'on the leaderboard with the car and mods');
r = await call('GET', '/cars/public?file=a1.jpg');
ok(r.body.carId === 'cara1' && r.body.track.length === 1 && r.body.track[0].venue === 'Thruxton', 'the Gallery list gets the shared best');

// A slower session doesn't replace the best; deleting the best brings the other back.
const slow = JSON.parse(JSON.stringify(session)); slow.bestTime = 101.5;
r = await call('POST', '/track/sessions', { carId: 'cara1', session: slow, privacy: 'board' }, 'tok-a');
const id2 = r.body.session.id;
r = await call('GET', '/track/board?venue=thruxton&layout=main');
ok(r.body.entries.length === 1 && Math.abs(r.body.entries[0].time - 99.786) < 0.01 && r.body.entries[0].sessions === 2, 'one place per car, its fastest, with how many sessions it has here');
r = await call('GET', '/track/counts');
ok(r.body.counts['track-board:thruxton:main'] === 2, 'session count for the track list');
r = await call('DELETE', '/track/session?id=' + id1, undefined, 'tok-b');
ok(r.status === 404, 'others cannot delete it');
r = await call('DELETE', '/track/session?id=' + id1, undefined, 'tok-a');
r = await call('GET', '/track/board?venue=thruxton&layout=main');
ok(r.body.entries.length === 1 && r.body.entries[0].time === 101.5 && r.body.entries[0].sessionId === id2, 'deleting the fastest brings back the next');
ok(!kv.has('track-session:' + id1), 'session removed');
r = await call('PUT', '/track/session', { id: id2, privacy: 'private' }, 'tok-a');
r = await call('GET', '/track/board?venue=thruxton&layout=main');
ok(r.body.entries.length === 0, 'made private: off the board');
r = await call('GET', '/track/counts');
ok(!('track-board:thruxton:main' in r.body.counts), 'count gone with the last session');

// Checks on what is sent.
const bad = JSON.parse(JSON.stringify(session)); bad.bestTime = 20;
r = await call('POST', '/track/sessions', { carId: 'cara1', session: bad }, 'tok-a');
ok(r.status === 400 && /not possible/.test(r.body.message), 'impossible lap time refused');
r = await call('POST', '/track/sessions', '{"carId":"cara1","session":{"laps":[]},"pad":"' + 'x'.repeat(1600000) + '"}', 'tok-a');
ok(r.status === 413, 'too big refused');
const unknown = JSON.parse(JSON.stringify(session)); delete unknown.venueId; delete unknown.layoutId; unknown.venueName = 'My airfield';
r = await call('POST', '/track/sessions', { carId: 'cara1', session: unknown, privacy: 'board', venueName: 'Old airfield' }, 'tok-a');
ok(r.status === 200 && r.body.session.venue === 'Old airfield' && r.body.session.privacy === 'build', 'a track not in the list can be shared on the build but not on a board');

// Drag runs
function dragCsv(lat, lng) {
  const rows = ['time,latitude,longitude,speed (mph)'];
  let x = 0;
  for (let i = 0; i <= 200; i++) { const t = i / 10, v = t < 2 ? 0 : 150 * (1 - Math.exp(-(t - 2) / 6.65)); x += v * 0.44704 * 0.1; rows.push([t.toFixed(1), (lat + x / 110540).toFixed(7), lng.toFixed(7), v.toFixed(2)].join(',')); }
  for (let i = 1; i <= 60; i++) rows.push([(20 + i / 10).toFixed(1), (lat + (x + i) / 110540).toFixed(7), lng.toFixed(7), Math.max(0, 140 - i * 3).toFixed(2)].join(','));
  return rows.join('\n');
}
const pod = T.analyse(T.read(dragCsv(52.2365, -0.596), 'd.csv'), lib);
r = await call('POST', '/track/sessions', { carId: 'carb1', session: pod, privacy: 'board' }, 'tok-b');
ok(r.status === 200 && r.body.session.atVenue && r.body.session.venue === 'Santa Pod Raceway' && r.body.session.privacy === 'board', 'drag run at Santa Pod saved to the board');
const podId = r.body.session.id;
r = await call('GET', '/drag/board?venue=santa-pod');
ok(r.body.entries.length === 1 && r.body.entries[0].quarter > 10 && r.body.entries[0].model === 'Model Y', 'drag board');
const street = T.analyse(T.read(dragCsv(51.5, -0.12), 's.csv'), lib, { type: 'drag' });
const lying = JSON.parse(JSON.stringify(street)); lying.atVenue = true; lying.venueId = 'santa-pod';
r = await call('POST', '/track/sessions', { carId: 'carb1', session: lying }, 'tok-b');
ok(r.status === 400 && /drag strip/.test(r.body.message), 'a street run claiming a venue is refused (the server checks the position)');
r = await call('POST', '/track/sessions', { carId: 'carb1', session: street, street: true, adminViewer: 'not-a-real-token-123456' }, 'tok-b');
ok(r.status === 400, 'street run refused without an admin');
const tok = (await call('POST', '/admin/viewer-token?key=secret', {})).body.token;
r = await call('POST', '/track/sessions', { carId: 'carb1', session: street, street: true, adminViewer: tok, privacy: 'board' }, 'tok-b');
ok(r.status === 200 && r.body.session.street === true && r.body.session.privacy === 'private', 'admin street run saved, forced private');
const streetId = r.body.session.id;
r = await call('PUT', '/track/session', { id: streetId, privacy: 'build' }, 'tok-b');
ok(r.body.session.privacy === 'private', 'a street run cannot be shared');
r = await call('GET', '/track/public?car=carb1');
ok(r.body.sessions.length === 1 && !r.body.sessions.some(s => s.street), 'street runs never public');

// Track list and requests
r = await call('POST', '/track/requests', { name: 'Old airfield', startLine: [[53.1, -1.1], [53.1001, -1.1001]], outline: [[53.1, -1.1], [53.11, -1.11]], lapLength: 2100 }, 'tok-a');
ok(r.status === 200, 'member asks for a new track');
r = await call('GET', '/track/admin/requests');
ok(r.status === 401, 'requests need the admin key');
r = await call('GET', '/track/admin/requests?key=secret');
ok(r.body.requests.length === 1 && r.body.requests[0].name === 'Old airfield' && !r.body.requests[0].from.includes('a@example'), 'admin sees the request, email masked');
const reqId = r.body.requests[0].id;
r = await call('PUT', '/track/admin/tracks?key=secret', { venue: { name: 'Old Airfield', lat: 53.1, lng: -1.1, radius: 1500, layouts: [{ name: 'Full', length: 2100, startLine: [[53.1, -1.1], [53.1001, -1.1001]], corners: [{ name: 'Hangar', lat: 53.105, lng: -1.105 }, { name: '', lat: 1, lng: 1 }] }] } });
ok(r.status === 200 && r.body.library.venues.some(v => v.id === 'old-airfield' && v.layouts[0].id === 'full' && v.layouts[0].corners.length === 1), 'admin adds a track');
r = await call('POST', '/track/admin/requests?key=secret', { id: reqId, action: 'approve' });
ok(r.status === 200 && JSON.parse(kv.get('track-requests'))[0].done === 'approved', 'request approved');
const thr = JSON.parse(tracksJson).venues.find(v => v.id === 'thruxton');
thr.layouts[0].corners = [{ name: 'Allard', lat: session.corners[0].lat, lng: session.corners[0].lng }];
r = await call('PUT', '/track/admin/tracks?key=secret', { venue: thr });
r = await call('GET', '/track/tracks');
const merged = T.mergeLibrary(lib, r.body.extra);
ok(merged.venues.find(v => v.id === 'thruxton').layouts[0].corners[0].name === 'Allard', 'corner names from the admin reach the reader');
const again = T.analyse(T.read(fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1'), 'f.vbo'), merged);
ok(again.corners[0].name === 'Allard', 'and the corner is named on the next upload');
r = await call('PUT', '/track/admin/tracks?key=secret', { remove: 'old-airfield' });
ok(!r.body.library.venues.some(v => v.id === 'old-airfield'), 'admin removes a track');

// Admin takes an entry off a board.
r = await call('DELETE', '/track/admin/board-entry?key=secret&board=drag-board:santa-pod&session=' + podId);
r = await call('GET', '/drag/board?venue=santa-pod');
ok(r.body.entries.length === 0 && JSON.parse(kv.get('track-public:carb1')).find(s => s.venueId === 'santa-pod').offBoard === true, 'board entry removed, the session stays on the build');
r = await call('PUT', '/track/session', { id: podId, privacy: 'board' }, 'tok-b');
r = await call('GET', '/drag/board?venue=santa-pod');
ok(r.body.entries.length === 0, 'and it stays off when the member saves it again');

// Leaving the site clears everything.
await mod.deleteMemberAccount(env, A);
ok(!kv.has('track-index:' + (await mod.ownerKey(A))) && ![...kv.keys()].some(k => k.startsWith('track-session:') && JSON.parse(kv.get(k)).carId === 'cara1') && !kv.has('track-public:cara1'), 'a member leaving removes their sessions');
