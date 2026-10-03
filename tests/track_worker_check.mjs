// Run by tests/test_track_worker.py: the worker's track session routes with a fake KV store and
// photo bucket. Sessions come from js/track-parse.js reading tests/fixtures/thruxton-trimmed.vbo,
// as the page does. WORKER_MODULE is a copy of the worker that node can load.
import { createRequire } from 'module';
import fs from 'fs';
import zlib from 'zlib';
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
  // Like KV: strings or ArrayBuffers in, read back as text or 'arrayBuffer'.
  VOTES: {
    get: async (k, type) => {
      if (!kv.has(k)) return null;
      const v = kv.get(k);
      if (type === 'arrayBuffer') return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v;
      return typeof v === 'string' ? v : new TextDecoder().decode(v);
    },
    put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    // Like KV list(): keys by prefix, a page at a time, in name order.
    list: async ({ prefix = '', limit = 1000, cursor } = {}) => {
      const all = [...kv.keys()].filter(k => k.startsWith(prefix)).sort();
      const from = cursor ? parseInt(cursor, 10) : 0;
      const keys = all.slice(from, from + limit).map(name => ({ name }));
      const more = from + limit < all.length;
      return { keys, list_complete: !more, cursor: more ? String(from + limit) : undefined };
    }
  },
  GALLERY_BUCKET: {
    get: async k => bucket.has(k) ? { json: async () => JSON.parse(bucket.get(k)) } : null,
    put: async (k, v) => { bucket.set(k, typeof v === 'string' ? v : 'binary'); },
    delete: async k => { bucket.delete(k); },
    list: async () => { throw new Error('list() used'); }
  },
  SEND_EMAIL: { sent: [], send: async function (m) { this.sent.push(m.raw); } }
};
globalThis.fetch = async url => String(url).endsWith('/data/tracks.json') ? new Response(tracksJson, { status: 200 }) : new Response('{}', { status: 200 });
// A stored session, unzipped.
const stored = k => { const v = kv.get(k); return JSON.parse(typeof v === 'string' ? v : zlib.gunzipSync(Buffer.from(v)).toString()); };
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const A = 'a@example.com', B = 'b@example.com';
// Track Sessions is an early preview: these two members are approved (the gate has its own tests below).
kv.set('track-access', JSON.stringify({ open: false, allowed: [{ email: A }, { email: B }], pending: [] }));
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

const call = async (method, path, body, token, extra) => {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) init.headers['X-Session-Token'] = token;
  if (extra) Object.assign(init.headers, extra);
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
{
  const v = kv.get('track-session:' + id1), raw = JSON.stringify(stored('track-session:' + id1)).length;
  ok(v instanceof ArrayBuffer && new Uint8Array(v)[0] === 0x1f && v.byteLength < raw * 0.6, 'stored gzipped: ' + (v.byteLength || 0) + ' bytes, ' + raw + ' unzipped');
}
ok(r.body.session.venue === 'Thruxton' && r.body.session.layout === 'Thruxton' && Math.abs(r.body.session.bestTime - 99.786) < 0.01, 'venue and layout names come from the track list');
r = await call('GET', '/track/sessions', undefined, 'tok-a');
ok(r.body.sessions.length === 1 && r.body.sessions[0].id === id1 && r.body.sessions[0].tyres === 'Pilot Sport 4S', 'in my list');
r = await call('GET', '/track/session?id=' + id1, undefined, 'tok-a');
ok(r.status === 200 && r.body.session.mine && r.body.session.notes === 'First go' && r.body.session.trace.laps['2'].length > 100 && !r.body.session.owner, 'the owner opens it with the trace');
ok(r.body.session.ownerName === 'Rich', 'a session says whose it is (the owner\'s public name)');
ok(!JSON.stringify(r.body.session).includes(A), 'and never gives their email');
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
r = await call('POST', '/track/sessions', '{"carId":"cara1","session":{"laps":[]},"pad":"' + 'x'.repeat(6100000) + '"}', 'tok-a');
ok(r.status === 413, 'an uncompressed upload over 6 MB is refused');
const unknown = JSON.parse(JSON.stringify(session)); delete unknown.venueId; delete unknown.layoutId; unknown.venueName = 'My airfield';
r = await call('POST', '/track/sessions', { carId: 'cara1', session: unknown, privacy: 'board', venueName: 'Old airfield' }, 'tok-a');
ok(r.status === 200 && r.body.session.venue === 'Old airfield' && r.body.session.privacy === 'build', 'a track not in the list can be shared on the build but not on a board');
const unknownId = r.body.session.id;
{
  // A track we do not list needs its name from the member.
  const nameless = JSON.parse(JSON.stringify(unknown)); delete nameless.venueName; delete nameless.venue;
  r = await call('POST', '/track/sessions', { carId: 'cara1', session: nameless }, 'tok-a');
  ok(r.status === 400 && r.body.message === 'Enter the track name.', 'an unlisted track day with no name is refused ' + r.status);
  const ns = JSON.parse(JSON.stringify(nameless)); ns.type = 'sprint';
  r = await call('POST', '/track/sessions', { carId: 'cara1', session: ns }, 'tok-a');
  ok(r.status === 400, 'an unlisted sprint with no name is refused too');
  r = await call('POST', '/track/sessions', { carId: 'cara1', session: nameless, venueName: 'Typed in the box' }, 'tok-a');
  ok(r.status === 200 && r.body.session.venue === 'Typed in the box', 'the name typed in the box is enough');
  await call('DELETE', '/track/session?id=' + r.body.session.id, undefined, 'tok-a');
  const drive = JSON.parse(JSON.stringify(nameless)); drive.type = 'other';
  r = await call('POST', '/track/sessions', { carId: 'cara1', session: drive }, 'tok-a');
  ok(r.status === 200 && r.body.session.venue === 'Drive', 'a mapped drive needs no name');
  await call('DELETE', '/track/session?id=' + r.body.session.id, undefined, 'tok-a');
}

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
ok(r.status === 200 && r.body.session.unlisted === true && r.body.session.privacy === 'private' && !r.body.session.venueId, 'a drag run claiming a venue is not trusted: it is saved private and unlisted (the server checks the position)');
const lyingId = r.body.session.id;
ok(stored('track-session:' + lyingId).outline === undefined, 'only street runs keep the path of the drive');
r = await call('POST', '/track/sessions', { carId: 'carb1', session: street, street: true, adminViewer: 'not-a-real-token-123456' }, 'tok-b');
ok(r.status === 200 && !r.body.session.street && r.body.session.unlisted === true, 'without an admin it is an unlisted private run, never a street run');
await call('DELETE', '/track/session?id=' + r.body.session.id, undefined, 'tok-b');
const tok = (await call('POST', '/admin/viewer-token?key=secret', {})).body.token;
r = await call('POST', '/track/sessions', { carId: 'carb1', session: street, street: true, adminViewer: tok, privacy: 'board' }, 'tok-b');
ok(r.status === 200 && r.body.session.street === true && r.body.session.privacy === 'private', 'admin street run saved, forced private');
const streetId = r.body.session.id;
r = await call('PUT', '/track/session', { id: streetId, privacy: 'build' }, 'tok-b');
ok(r.body.session.privacy === 'private', 'a street run cannot be shared');
r = await call('GET', '/track/public?car=carb1');
ok(r.body.sessions.length === 1 && !r.body.sessions.some(s => s.street), 'street runs never public');

// Track list and requests
const reqMails = env.SEND_EMAIL.sent.length;
r = await call('POST', '/track/requests', { name: 'Old airfield', startLine: [[53.1, -1.1], [53.1001, -1.1001]], outline: [[53.1, -1.1], [53.11, -1.11]], lapLength: 2100 }, 'tok-a');
ok(r.status === 200, 'member asks for a new track');
ok(env.SEND_EMAIL.sent.length === reqMails + 1 && /modtesla3uk@gmail\.com/.test(env.SEND_EMAIL.sent[reqMails]) && /New track request: Old airfield/.test(env.SEND_EMAIL.sent[reqMails]) && /admin\.html#grp-tracks/.test(env.SEND_EMAIL.sent[reqMails]), 'the admin is emailed about the new track');
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
// A sprint-type venue can be marked as a hill climb; the flag only counts for sprint venues.
{
  const base = { id: 'test-hill', name: 'Test Hill', lat: 52, lng: -2, radius: 1500, layouts: [{ name: 'Hill climb', length: 900 }] };
  await call('PUT', '/track/admin/tracks?key=secret', { venue: Object.assign({}, base, { type: 'sprint', hill: true }) });
  await call('PUT', '/track/admin/tracks?key=secret', { venue: Object.assign({}, base, { id: 'test-circuit', name: 'Test Circuit', type: 'circuit', hill: true }) });
  const got = (await call('GET', '/track/tracks')).body.extra.venues;
  ok(got.find(v => v.id === 'test-hill').hill === true && got.find(v => v.id === 'test-hill').type === 'sprint', 'a hill climb is kept as a sprint venue marked hill');
  ok(!('hill' in got.find(v => v.id === 'test-circuit')), 'the hill flag is only kept on sprint venues');
}
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

// Several files from one day: each lap keeps its run.
{
  const vboText = fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1');
  const r1 = T.read(vboText, 'a.vbo'), r2 = T.read(vboText, 'b.vbo');
  r2.startedAt = r1.startedAt + 3600000;
  const day = T.analyse(T.combine([r1, r2]), lib);
  const rr = await call('POST', '/track/sessions', { carId: 'cara1', session: day }, 'tok-a');
  const got = await call('GET', '/track/session?id=' + rr.body.session.id, undefined, 'tok-a');
  ok(rr.status === 200 && got.body.session.runs === 2 && got.body.session.laps.filter(l => l.run === 2).length === day.laps.filter(l => l.run === 2).length, 'runs kept on a day of several files');
  await call('DELETE', '/track/session?id=' + rr.body.session.id, undefined, 'tok-a');
}

// The page sends sessions gzipped; old sessions stored as plain JSON still open.
{
  const gz = zlib.gzipSync(JSON.stringify({ carId: 'cara1', session, privacy: 'build' }));
  const res = await worker.fetch(new Request('https://w.test/track/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': 'tok-a' }, body: gz }), env, { waitUntil() {} });
  const d = await res.json();
  ok(res.status === 200 && Math.abs(d.session.bestTime - 99.786) < 0.01, 'a gzipped upload is saved');
  const id = d.session.id;
  kv.set('track-session:' + id, JSON.stringify(stored('track-session:' + id)));
  r = await call('GET', '/track/session?id=' + id, undefined, 'tok-a');
  ok(r.status === 200 && r.body.session.trace.laps['2'].length > 100, 'a session stored before compression still opens');
  r = await call('PUT', '/track/session', { id, tyres: 'AD08R' }, 'tok-a');
  ok(r.body.session.tyres === 'AD08R' && kv.get('track-session:' + id) instanceof ArrayBuffer, 'and is gzipped when next changed');
  await call('DELETE', '/track/session?id=' + id, undefined, 'tok-a');
  const bomb = zlib.gzipSync(JSON.stringify({ carId: 'cara1', session, pad: 'x'.repeat(7000000) }));
  const res2 = await worker.fetch(new Request('https://w.test/track/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': 'tok-a' }, body: bomb }), env, { waitUntil() {} });
  ok(res2.status === 413, 'a gzipped upload too big once unzipped is refused: ' + res2.status);
}

// The tyre makes and models: public list, and the admin's changes on top of data/tyres.json.
{
  r = await call('GET', '/tyres');
  ok(r.status === 200 && r.body.success && Object.keys(r.body.extra).length === 0, 'no changes to the tyre list to start with');
  r = await call('GET', '/tyres/admin');
  ok(r.status === 401, 'the admin list needs the key');
  r = await call('PUT', '/tyres/admin?key=wrong', { library: { makes: [] } });
  ok(r.status === 401, 'and so does saving');
  r = await call('PUT', '/tyres/admin?key=secret', { library: {
    makes: [
      { name: 'Acme <b>Tyres', models: ['Rocket', 'rocket', ' Bolt ', '', 'X'.repeat(90)] },
      { name: 'Kumho', removed: true },
      { name: 'acme <b>tyres', models: ['Duplicate'] },
      { name: '', models: ['Nameless'] }
    ],
    widths: [215, '205', 205, 9999, 'x', 50], profiles: [], rims: [17, 18, 99]
  } }, undefined);
  ok(r.status === 200 && r.body.success, 'saved');
  const ex = r.body.extra;
  ok(ex.makes.length === 2 && ex.makes[0].name === 'Acme b Tyres' && ex.makes[0].models.length === 3 && ex.makes[0].models[0] === 'Rocket' && ex.makes[0].models[2].length === 60, 'makes cleaned: markup out, duplicates dropped, names and models trimmed: ' + JSON.stringify(ex.makes[0]));
  ok(ex.makes[1].name === 'Kumho' && ex.makes[1].removed === true && !('models' in ex.makes[1]), 'a make can be taken off');
  ok(JSON.stringify(ex.widths) === '[205,215]' && !('profiles' in ex) && JSON.stringify(ex.rims) === '[17,18]', 'sizes kept only when sensible: ' + JSON.stringify(ex));
  r = await call('GET', '/tyres');
  ok(r.body.extra.makes.length === 2 && JSON.stringify(r.body.extra.widths) === '[205,215]', 'the public list serves the admin changes');
  r = await call('GET', '/tyres/admin?key=secret');
  ok(r.status === 200 && r.body.extra.makes[0].name === 'Acme b Tyres', 'and the admin list returns them');
  r = await call('PUT', '/tyres/admin?key=secret', { library: 'nonsense' });
  ok(r.status === 200 && r.body.extra.makes.length === 0, 'rubbish saves as an empty list');
  await call('PUT', '/tyres/admin?key=secret', { library: { makes: [] } });
}

// Tyres: make, model and size as separate parts; the description is built from them.
{
  r = await call('POST', '/track/sessions', { carId: 'cara1', session, tyreMake: 'Michelin', tyreModel: 'Pilot Sport 4S', tyreWidth: 245, tyreProfile: 35, tyreRim: 19, tyres: 'ignored' }, 'tok-a');
  const tid = r.body.session.id;
  ok(r.body.session.tyres === 'Michelin Pilot Sport 4S, 245/35 R19', 'the tyre description is built from make, model and size: ' + r.body.session.tyres);
  let g = await call('GET', '/track/session?id=' + tid, undefined, 'tok-a');
  ok(g.body.session.tyreMake === 'Michelin' && g.body.session.tyreModel === 'Pilot Sport 4S' && g.body.session.tyreWidth === 245 && g.body.session.tyreProfile === 35 && g.body.session.tyreRim === 19, 'the parts are kept');
  r = await call('PUT', '/track/session', { id: tid, tyreMake: 'Pirelli', tyreModel: 'P Zero Trofeo R', tyreWidth: 265, tyreProfile: 35, tyreRim: 20 }, 'tok-a');
  ok(r.body.session.tyres === 'Pirelli P Zero Trofeo R, 265/35 R20', 'changed in the settings');
  r = await call('PUT', '/track/session', { id: tid, tyreMake: 'Pirelli', tyreModel: 'P Zero', tyreWidth: 265, tyreProfile: null, tyreRim: 20 }, 'tok-a');
  ok(r.body.session.tyres === 'Pirelli P Zero', 'a part-filled size is left out: ' + r.body.session.tyres);
  g = await call('GET', '/track/session?id=' + tid, undefined, 'tok-a');
  ok(!('tyreWidth' in g.body.session) && !('tyreRim' in g.body.session), 'and not stored');
  r = await call('PUT', '/track/session', { id: tid, tyreMake: 'X<b>', tyreModel: 'Y', tyreWidth: 5000, tyreProfile: 35, tyreRim: 19 }, 'tok-a');
  ok(r.body.session.tyres === 'X b Y' && !r.body.session.tyres.includes('<') , 'odd sizes are refused and markup is cleaned: ' + r.body.session.tyres);
  r = await call('PUT', '/track/session', { id: tid, tyreMake: '', tyreModel: '', tyreWidth: null, tyreProfile: null, tyreRim: null }, 'tok-a');
  ok(r.body.session.tyres === '', 'cleared');
  r = await call('PUT', '/track/session', { id: tid, tyres: 'AD08R 255/40 ZR18' }, 'tok-a');
  ok(r.body.session.tyres === 'AD08R 255/40 ZR18', 'free text from before still works');
  await call('DELETE', '/track/session?id=' + tid, undefined, 'tok-a');
}

// Keeping a session's readings so its type can be changed later.
{
  const text = fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1');
  const rd = T.read(text, 'f.vbo');
  const meta = Object.assign({}, rd); delete meta.points;
  const src = { v: 1, rd: meta, p: rd.points.map(q => [q.t, q.lat, q.lng, q.v, q.la, q.lo, q.sats, q.temp, 0]) };
  const send = (path, body, token, method) => worker.fetch(new Request('https://w.test' + path, { method: method || 'POST', headers: token ? { 'X-Session-Token': token } : {}, body }), env, { waitUntil() {} });
  r = await call('POST', '/track/sessions', { carId: 'cara1', session, tyres: 'AD08R', notes: 'keep me', conditions: 'Wet', privacy: 'board' }, 'tok-a');
  const sid = r.body.session.id;
  ok(!(await call('GET', '/track/session?id=' + sid, undefined, 'tok-a')).body.session.hasSource, 'no readings kept until they are sent');
  let res = await send('/track/session/source?id=' + sid, JSON.stringify(src), 'tok-a');
  ok(res.status === 400, 'readings must be gzipped: ' + res.status);
  res = await send('/track/session/source?id=' + sid, zlib.gzipSync(JSON.stringify(src)), 'tok-b');
  ok(res.status === 404, 'only the owner can keep readings: ' + res.status);
  res = await send('/track/session/source?id=' + sid, zlib.gzipSync(JSON.stringify({ v: 1, rd: {}, p: [[1, 2, 3]] })), 'tok-a');
  ok(res.status === 400, 'too few readings are refused: ' + res.status);
  res = await send('/track/session/source?id=' + sid, zlib.gzipSync(JSON.stringify({ v: 1, rd: {}, pad: 'x'.repeat(23000000), p: src.p })), 'tok-a');
  ok(res.status === 413 && /MB once unzipped/.test(JSON.parse(await res.text()).message), 'readings too big once unzipped are refused and say the limit: ' + res.status);
  const trimmed = { v: 1, rd: meta, p: src.p.map(a => { const b = a.slice(); while (b.length > 4 && (b[b.length - 1] === null || b[b.length - 1] === 0)) b.pop(); return b; }) };
  res = await send('/track/session/source?id=' + sid, zlib.gzipSync(JSON.stringify(trimmed)), 'tok-a');
  ok(res.status === 200, 'readings with empty trailing columns left off are kept: ' + res.status);
  res = await send('/track/session/source?id=' + sid, zlib.gzipSync(JSON.stringify(src)), 'tok-a');
  ok(res.status === 200, 'readings kept: ' + res.status);
  r = await call('GET', '/track/session?id=' + sid, undefined, 'tok-a');
  ok(r.body.session.hasSource === true, 'the session knows it has its readings');
  res = await send('/track/session/source?id=' + sid, undefined, 'tok-a', 'GET');
  const back = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
  ok(res.status === 200 && res.headers.get('Content-Encoding') === 'gzip' && back.p.length === src.p.length && back.rd.format === rd.format, 'the owner gets the readings back');
  // The admin's copy comes as a plain gzip file, not Content-Encoding, so nothing en route can re-encode it.
  res = await send('/track/admin/retime/source?key=secret&id=' + sid, undefined, undefined, 'GET');
  const adminBack = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
  ok(res.status === 200 && !res.headers.get('Content-Encoding') && res.headers.get('Content-Type') === 'application/gzip' && adminBack.p.length === src.p.length, 'the admin gets the readings as a gzip file to unzip');
  res = await send('/track/session/source?id=' + sid, undefined, 'tok-b', 'GET');
  ok(res.status === 404, 'others cannot read them: ' + res.status);
  res = await send('/track/session/source?id=' + sid, undefined, undefined, 'GET');
  ok(res.status === 401, 'nor can visitors: ' + res.status);
  // Changing the type: the new analysis replaces the old, the member's details stay.
  let board = await call('GET', '/track/board?venue=thruxton&layout=main');
  ok(board.body.entries.some(e => e.sessionId === sid), 'on the leaderboard as a track day');
  const other = T.analyse(T.read(text, 'f.vbo'), lib, { type: 'other' });
  r = await call('PUT', '/track/session', { id: sid, session: other, venueName: 'Autotest' }, 'tok-a');
  ok(r.status === 200 && r.body.session.id === sid && r.body.session.type === 'other', 'the type is changed: ' + JSON.stringify(r.body).slice(0, 160));
  r = await call('GET', '/track/session?id=' + sid, undefined, 'tok-a');
  const sx = r.body.session;
  ok(sx.type === 'other' && sx.tyres === 'AD08R' && sx.notes === 'keep me' && sx.conditions === 'Wet' && sx.hasSource === true && sx.carId === 'cara1' && sx.owner === undefined, 'details and readings carry over');
  board = await call('GET', '/track/board?venue=thruxton&layout=main');
  ok(!board.body.entries.some(e => e.sessionId === sid), 'an other session is not on the leaderboard');
  r = await call('GET', '/track/sessions', undefined, 'tok-a');
  ok(r.body.sessions.filter(x => x.id === sid).length === 1 && r.body.sessions.find(x => x.id === sid).type === 'other', 'one entry in my list, with the new type');
  r = await call('PUT', '/track/session', { id: sid, session: T.analyse(T.read(text, 'f.vbo'), lib, { type: 'drag' }) }, 'tok-a');
  ok(r.status === 400, 'cannot become a drag run away from a strip: ' + r.status);
  r = await call('PUT', '/track/session', { id: sid, session: session }, 'tok-b');
  ok(r.status === 404, 'only the owner changes the type');
  r = await call('PUT', '/track/session', { id: sid, session }, 'tok-a');
  board = await call('GET', '/track/board?venue=thruxton&layout=main');
  ok(r.status === 200 && r.body.session.type === 'track' && r.body.session.privacy !== 'private' && board.body.entries.some(e => e.sessionId === sid), 'and back to a track day, still shared and on the leaderboard');
  const gzPut = zlib.gzipSync(JSON.stringify({ id: sid, session: other }));
  res = await send('/track/session', gzPut, 'tok-a', 'PUT');
  ok(res.status === 200 && (await res.json()).session.type === 'other', 'a gzipped change is accepted');
  await call('DELETE', '/track/session?id=' + sid, undefined, 'tok-a');
  ok(!kv.has('track-source:' + sid), 'deleting the session deletes its readings');
}


// The car's own channels are kept, cleaned, with the session.
{
  const withData = JSON.parse(JSON.stringify(session));
  withData.carData = { soc: { start: 80, end: 74.5 }, power: { max: 250, regen: 120, early: 250, late: 190 }, batteryTemp: { start: 50, max: 62 }, tyrePressure: { start: 'x', end: 2.5 }, slip: { max: 9999 }, evil: { a: 1 }, found: ['State of charge', 'Power', '<b>x</b>'], empty: ['Tyre pressure'], runs: [{ run: 1, soc: { start: 80, end: 77 } }, { run: 2, soc: { start: 77, end: 74.5 }, evil: 1 }, { run: 'x', soc: { start: 1, end: 0 } }] };
  r = await call('POST', '/track/sessions', { carId: 'cara1', session: withData, privacy: 'private' }, 'tok-a');
  const cid = r.body.session.id;
  r = await call('GET', '/track/session?id=' + cid, undefined, 'tok-a');
  const cd = r.body.session.carData;
  ok(cd && cd.soc.start === 80 && cd.power.regen === 120 && cd.power.late === 190 && cd.batteryTemp.max === 62 && cd.tyrePressure.end === 2.5 && !('start' in cd.tyrePressure) && !cd.slip && !cd.evil, 'car data kept, bad values dropped: ' + JSON.stringify(cd));
  ok(cd.found.length === 3 && cd.empty[0] === 'Tyre pressure', 'which channels the file had');
  ok(cd.runs && cd.runs.length === 2 && cd.runs[1].run === 2 && cd.runs[1].soc.end === 74.5 && !cd.runs[1].evil, 'figures for each file of a day kept, cleaned: ' + JSON.stringify(cd.runs));
  await call('DELETE', '/track/session?id=' + cid, undefined, 'tok-a');
}


// Early preview: members need access; shared sessions and boards stay public.
{
  const C = 'c@example.com', D = 'd@example.com';
  kv.set('my-builds-session:tok-c', C);
  kv.set('profile:' + C, JSON.stringify({ firstName: 'Chris', lastName: 'N', nickname: 'Chris' }));
  kv.set('my-builds-session:tok-d', D);
  const before = env.SEND_EMAIL.sent.length;
  r = await call('GET', '/track/access', undefined, 'tok-c');
  ok(r.status === 200 && r.body.access === 'none', 'a new member has no access yet');
  r = await call('GET', '/track/access');
  ok(r.status === 401, 'checking access needs a sign in');
  r = await call('GET', '/track/sessions', undefined, 'tok-c');
  ok(r.status === 403 && r.body.needsAccess === true, 'their sessions are refused until approved: ' + r.status);
  r = await call('POST', '/track/sessions', { carId: 'carc1', session: session }, 'tok-c');
  ok(r.status === 403 && r.body.needsAccess, 'saving is refused too (the worker checks, not just the page)');
  r = await call('GET', '/track/sessions');
  ok(r.status === 401, 'a visitor still gets the sign in answer');
  r = await call('GET', '/track/board?venue=thruxton&layout=main');
  ok(r.status === 200, 'boards stay public');
  r = await call('GET', '/track/counts');
  ok(r.status === 200, 'the track list stays public');
  // Requesting
  r = await call('POST', '/track/access/request', { use: 'Tesla Track Mode', note: 'Thruxton days <b>x</b>' }, 'tok-c');
  ok(r.status === 200 && r.body.access === 'pending', 'a request is kept as pending');
  const sent = env.SEND_EMAIL.sent.slice(before).join('\n');
  ok(/modtesla3uk@gmail\.com/.test(sent) && /Chris/.test(sent) && /Tesla Track Mode/.test(sent), 'the admin is emailed with who and what for');
  const emails = env.SEND_EMAIL.sent.length;
  r = await call('POST', '/track/access/request', {}, 'tok-c');
  ok(r.body.access === 'pending' && env.SEND_EMAIL.sent.length === emails && stored('track-access').pending.length === 1, 'asking again does not add a second request or email');
  // Admin
  r = await call('GET', '/track/access/admin');
  ok(r.status === 401, 'the admin list needs the admin key');
  r = await call('GET', '/track/access/admin?key=secret');
  ok(r.body.pending.length === 1 && r.body.pending[0].email === C && r.body.pending[0].use === 'Tesla Track Mode' && r.body.allowed.length === 2, 'the admin sees who is waiting');
  r = await call('POST', '/track/access/admin?key=secret', { action: 'approve', email: C });
  ok(r.body.pending.length === 0 && r.body.allowed.some(x => x.email === C), 'approving moves them to the list');
  ok(env.SEND_EMAIL.sent.slice(emails).join('\n').includes(C), 'and tells them');
  r = await call('GET', '/track/sessions', undefined, 'tok-c');
  ok(r.status === 200, 'approved: their sessions open');
  r = await call('POST', '/track/access/admin?key=secret', { action: 'revoke', email: C });
  r = await call('GET', '/track/sessions', undefined, 'tok-c');
  ok(r.status === 403, 'revoked: refused again');
  r = await call('POST', '/track/access/admin?key=secret', { action: 'bad', email: C });
  ok(r.status === 400, 'an unknown action is refused');
  r = await call('POST', '/track/access/admin?key=secret', { action: 'approve', email: 'nope' });
  ok(r.status === 400, 'a bad email is refused');
  // Denied requests can ask again
  await call('POST', '/track/access/request', {}, 'tok-c');
  r = await call('POST', '/track/access/admin?key=secret', { action: 'deny', email: C });
  ok(r.body.pending.length === 0 && !r.body.allowed.some(x => x.email === C), 'declined: off the waiting list, not on the approved list');
  // Open to everyone
  r = await call('POST', '/track/access/admin?key=secret', { action: 'open', open: true });
  r = await call('GET', '/track/sessions', undefined, 'tok-c');
  ok(r.status === 200, 'open to all members: everyone is in');
  r = await call('POST', '/track/access/admin?key=secret', { action: 'open', open: false });
  r = await call('GET', '/track/sessions', undefined, 'tok-c');
  ok(r.status === 403, 'and closed again');
  // Members who already had sessions keep using it
  kv.set('track-index:' + (await mod.ownerKey(D)), JSON.stringify([{ id: 'old1' }]));
  r = await call('GET', '/track/access', undefined, 'tok-d');
  ok(r.body.access === 'approved', 'a member with sessions from before the preview keeps access');
  r = await call('GET', '/track/sessions', undefined, 'tok-d');
  ok(r.status === 200, 'and can open them');
  // Putting the current testers on the approved list, so they can be revoked.
  kv.set('subscriber:' + D, JSON.stringify([]));
  r = await call('POST', '/track/access/admin?key=secret', { action: 'import' });
  ok(r.status === 200 && r.body.added.length === 1 && r.body.added[0].email === D && r.body.found >= 1, 'import finds members who have sessions and adds them: ' + JSON.stringify(r.body.added));
  ok(r.body.allowed.some(x => x.email === D && x.existing) && r.body.imported, 'they are on the approved list, marked as existing testers');
  ok(!r.body.allowed.some(x => x.email === C), 'members without sessions are not added');
  r = await call('POST', '/track/access/admin?key=secret', { action: 'import' });
  ok(r.status === 409, 'importing twice is refused (it would put back anyone revoked)');
  r = await call('GET', '/track/sessions', undefined, 'tok-d');
  ok(r.status === 200, 'they still have access');
  r = await call('POST', '/track/access/admin?key=secret', { action: 'revoke', email: D });
  r = await call('GET', '/track/sessions', undefined, 'tok-d');
  ok(r.status === 403, 'revoked: refused even though they have sessions');
  r = await call('GET', '/track/access', undefined, 'tok-d');
  ok(r.body.access === 'none', 'and shown the request page');
  kv.delete('track-index:' + (await mod.ownerKey(D)));
  kv.delete('subscriber:' + D);
  { const acc = stored('track-access'); delete acc.imported; acc.allowed = acc.allowed.filter(x => x.email !== D); kv.set('track-access', JSON.stringify(acc)); }
}

// Leaderboard entries carry the tyres, each car's best for every mix of
// conditions and tyres, and only the parts that matter on a track.
{
  await mod.saveCarRecord(env, { id: 'cara1', name: 'Arctic Three', photos: ['a1.jpg'], mods: ['KW V3 coilovers', 'Matte grey wrap', 'Leather seat covers', 'Carbon seats, saves 12 kg', 'Front splitter'] });
  const mk = (t, cond, make, model, privacy = 'board') => {
    const x = JSON.parse(JSON.stringify(session)); x.bestTime = t;
    return call('POST', '/track/sessions', { carId: 'cara1', session: x, privacy, conditions: cond, tyreMake: make, tyreModel: model, tyreWidth: 245, tyreProfile: 35, tyreRim: 19 }, 'tok-a');
  };
  const s1 = await mk(99.0, 'Dry', 'Michelin', 'Pilot Sport 4S');
  const s2 = await mk(100.0, 'Dry', 'Kumho', 'Ecsta PS71');
  const s3 = await mk(105.0, 'Wet', 'Kumho', 'Ecsta PS71');
  const s4 = await mk(101.0, 'Dry', 'Michelin', 'Pilot Sport 4S');
  ok([s1, s2, s3, s4].every(x => x.status === 200), 'four sessions with tyres saved');
  let b = (await call('GET', '/track/board?venue=thruxton&layout=main')).body.entries;
  const e = b.find(x => x.carId === 'cara1');
  ok(b.filter(x => x.carId === 'cara1').length === 1 && Math.abs(e.time - 99.0) < 0.01 && e.tyreMake === 'Michelin' && e.tyreModel === 'Pilot Sport 4S' && e.tyres === 'Michelin Pilot Sport 4S, 245/35 R19', 'the entry names the tyres of its best');
  ok(e.bests.length === 3 && e.bests[0].time === 99 && e.bests.map(x => x.conditions + ':' + x.tyreMake).join() === 'Dry:Michelin,Dry:Kumho,Wet:Kumho', 'a best for each mix of conditions and tyres: ' + JSON.stringify(e.bests.map(x => [x.conditions, x.tyreMake, x.time])));
  ok(e.bests.every(x => x.sessionId && x.date), 'each best opens its session');
  ok(JSON.stringify(e.mods) === JSON.stringify(['KW V3 coilovers', 'Carbon seats, saves 12 kg', 'Front splitter']), 'only track parts, weight savings kept: ' + JSON.stringify(e.mods));
  r = await call('GET', '/track/counts');
  const lead = r.body.leaders['track-board:thruxton:main'];
  ok(lead && lead.length === 1 && lead[0].owner === 'Rich' && lead[0].car === 'Arctic Three' && Math.abs(lead[0].time - 99) < 0.01 && !('mods' in lead[0]), 'the track list gets the top of each board: ' + JSON.stringify(lead));
  r = await call('GET', '/track/sessions', undefined, 'tok-a');
  ok(r.body.sessions.find(x => x.id === s2.body.session.id).tyreMake === 'Kumho', 'the summary has the tyre make and model');
  // A session taken off the board drops out of the bests.
  await call('PUT', '/track/session', { id: s3.body.session.id, privacy: 'private' }, 'tok-a');
  b = (await call('GET', '/track/board?venue=thruxton&layout=main')).body.entries.find(x => x.carId === 'cara1');
  ok(b.bests.length === 2, 'a private session is not in the bests');

  // The admin rebuild fills in entries made before this existed.
  const key = 'track-board:thruxton:main';
  kv.set(key, JSON.stringify([{ carId: 'cara1', sessionId: s1.body.session.id, date: '2025-01-01', time: 99, car: 'Old', mods: ['Seat covers'], sessions: 4 }]));
  r = await call('POST', '/track/boards/rebuild');
  ok(r.status === 401, 'rebuilding the boards needs the admin key');
  let rounds = 0, cars = 0;
  do { r = await call('POST', '/track/boards/rebuild?key=secret' + (r.body && r.body.cursor ? '&cursor=' + r.body.cursor : '')); cars += r.body.cars || 0; rounds++; } while (r.body.success && !r.body.done && rounds < 20);
  const rebuilt = stored(key).find(x => x.carId === 'cara1');
  ok(r.body.done && cars >= 1 && rebuilt.bests.length === 2 && rebuilt.car === 'Arctic Three' && rebuilt.mods.length === 3, 'the rebuild gives old entries their bests and track parts (' + cars + ' cars, ' + rounds + ' calls)');

  // The page's rule and the worker's rule agree.
  const cases = [['wheels', { what: '19in forged' }], ['tyres', { what: 'PS4S' }], ['suspension', { what: 'KW V3' }], ['brakes', { what: 'pads' }], ['performance', { what: 'tune' }], ['interior', { what: 'Carbon seats' }], ['interior', { what: 'Saves 8 kg' }], ['bodywork', { kind: 'Aero', what: 'wing' }], ['bodywork', { kind: 'Wrap', what: 'matte' }], ['mods', { what: 'KW coilovers' }], ['mods', { what: 'Leather seats' }], ['other', { what: 'Lightweight battery' }], ['audio', { what: 'Subwoofer' }]];
  ok(cases.every(([a, p]) => mod.isTrackPart(a, p) === T.isTrackPart(a, p)), 'the worker and the page agree on which parts matter on a track');
  await mod.saveCarRecord(env, { id: 'cara1', name: 'Arctic Three', photos: ['a1.jpg'], mods: ['KW V3 coilovers'] });
  for (const x of [s1, s2, s3, s4]) await call('DELETE', '/track/session?id=' + x.body.session.id, undefined, 'tok-a');
}

// Approve and add track: the course is made from the member's markers and their sessions are linked.
{
  const sl = [[51.2, -0.9], [51.2002, -0.9002]], fl = [[51.21, -0.91], [51.2102, -0.9102]];
  const sp = JSON.parse(JSON.stringify(session)); sp.type = 'sprint'; sp.venueName = 'Newfield Sprint'; sp.organizer = 'B19'; sp.startLine = sl; sp.finishLine = fl; delete sp.venueId; delete sp.layoutId;
  r = await call('POST', '/track/sessions', { carId: 'cara1', session: sp, privacy: 'board' }, 'tok-a');
  ok(r.status === 200 && !r.body.session.layoutId, 'an unknown sprint course saves with no course ' + JSON.stringify(r.body).slice(0, 120));
  const spId = r.body.session.id;
  await call('POST', '/track/requests', { kind: 'sprint', name: 'Newfield Sprint', organizer: 'B19', startLine: sl, finishLine: fl, lapLength: 800, lat: 51.2, lng: -0.9 }, 'tok-a');
  const reqs = (await call('GET', '/track/admin/requests?key=secret')).body.requests;
  const rq = reqs.find(x => x.name === 'Newfield Sprint');
  r = await call('POST', '/track/admin/requests?key=nope', { id: rq.id, action: 'add' });
  ok(r.status === 401, 'adding a track needs the admin key');
  r = await call('POST', '/track/admin/requests?key=secret', { id: rq.id, action: 'add' });
  ok(r.status === 200 && r.body.relinked === 1, 'track added and one session linked ' + JSON.stringify(r.body).slice(0, 200));
  const nv = r.body.library.venues.find(v => v.id === 'newfield-sprint');
  ok(nv && nv.type === 'sprint' && nv.layouts[0].finishLine && nv.layouts[0].startLine && nv.layouts[0].organizer === 'B19' && nv.layouts[0].name === 'B19', 'the sprint course has both lines and is named for its organiser');
  const lk = stored('track-session:' + spId);
  ok(lk.venueId === 'newfield-sprint' && lk.layoutId === 'b19' && lk.organizer === 'B19', 'the saved session is linked to the organiser\'s course');
  ok(kv.has('sprint-board:newfield-sprint:b19') && JSON.stringify(stored('sprint-board:newfield-sprint:b19')).includes(spId), 'and it reached the sprint leaderboard');
  r = await call('POST', '/track/admin/requests?key=secret', { id: rq.id, action: 'add' });
  ok(r.status === 400, 'adding the same track twice is refused');
  // Another organiser at the same venue gets its own course beside the first.
  await call('POST', '/track/requests', { kind: 'sprint', name: 'Newfield Sprint', venueId: 'newfield-sprint', organizer: 'CSCC', startLine: [[51.205, -0.905], [51.2052, -0.9052]], finishLine: [[51.215, -0.915], [51.2152, -0.9152]], lapLength: 900, lat: 51.2, lng: -0.9 }, 'tok-a');
  const rq2 = (await call('GET', '/track/admin/requests?key=secret')).body.requests.find(x => x.organizer === 'CSCC');
  r = await call('POST', '/track/admin/requests?key=secret', { id: rq2.id, action: 'add' });
  const nv2 = r.body.library.venues.find(v => v.id === 'newfield-sprint');
  ok(r.status === 200 && nv2.layouts.length === 2 && nv2.layouts.some(l => l.id === 'cscc' && l.organizer === 'CSCC'), 'a second organiser adds a second course to the venue');
  await call('DELETE', '/track/session?id=' + spId, undefined, 'tok-a');
}

// A member adds a new track themselves from the Add a session page: live at once, flagged for review.
{
  const sl = [[51.30, -0.70], [51.3002, -0.7002]];
  const nc = JSON.parse(JSON.stringify(session)); delete nc.venueId; delete nc.layoutId; nc.venueName = 'Blyton Park'; nc.startLine = sl; nc.startLineFromMember = true;
  const course = { kind: 'circuit', name: 'Blyton Park', startLine: sl, lapLength: 2400, lat: 51.3, lng: -0.7, outline: [[51.3, -0.7], [51.301, -0.701]] };
  r = await call('POST', '/track/courses', course);
  ok(r.status === 401, 'adding a track needs a sign-in');
  r = await call('POST', '/track/courses', Object.assign({}, course, { name: '' }), 'tok-a');
  ok(r.status === 400 && r.body.message === 'Enter the track name.', 'a new track needs a name');
  r = await call('POST', '/track/courses', Object.assign({}, course, { startLine: null }), 'tok-a');
  ok(r.status === 400 && /start line/.test(r.body.message), 'and a start line');
  r = await call('POST', '/track/courses', Object.assign({}, course, { kind: 'sprint' }), 'tok-a');
  ok(r.status === 400 && /finish/.test(r.body.message), 'a sprint course needs a finish line too');
  r = await call('POST', '/track/courses', course, 'tok-a');
  ok(r.status === 200 && r.body.venueId === 'blyton-park' && r.body.layoutId === 'course', 'the member adds the track ' + JSON.stringify(r.body).slice(0, 160));
  const bv = r.body.library.venues.find(v => v.id === 'blyton-park');
  ok(bv && bv.review === true && bv.layouts[0].startLine && bv.layouts[0].length === 2400, 'it is in the list with the member\'s line as the official one, flagged for review');
  r = await call('GET', '/track/tracks');
  ok(r.body.extra.venues.some(v => v.id === 'blyton-park' && v.review), 'and everyone sees it');
  let reqs = (await call('GET', '/track/admin/requests?key=secret')).body.requests;
  const addedReq = reqs.find(x => x.name === 'Blyton Park');
  ok(addedReq && addedReq.added === true && !addedReq.done && addedReq.venueId === 'blyton-park' && addedReq.layoutId === 'course', 'the Admin bell keeps it as a request marked added');
  r = await call('POST', '/track/courses', course, 'tok-a');
  ok(r.status === 400 && /already listed/.test(r.body.message), 'adding it twice is refused');
  // The session saved after that is on the new course and its leaderboard.
  nc.venueId = 'blyton-park'; nc.layoutId = 'course';
  r = await call('POST', '/track/sessions', { carId: 'cara1', session: nc, privacy: 'board' }, 'tok-a');
  ok(r.status === 200 && r.body.session.venueId === 'blyton-park' && r.body.session.layoutId === 'course' && r.body.session.venue === 'Blyton Park', 'a session saves on the new course ' + JSON.stringify(r.body).slice(0, 160));
  const bb = await call('GET', '/track/board?venue=blyton-park&layout=course');
  ok(bb.status === 200 && bb.body.entries.some(e => e.sessionId === r.body.session.id), 'and is on its leaderboard');
  await call('DELETE', '/track/session?id=' + r.body.session.id, undefined, 'tok-a');
  // The admin marks it reviewed: an ordinary listed track from then on.
  r = await call('POST', '/track/admin/requests?key=secret', { id: addedReq.id, action: 'approve' });
  ok(r.status === 200, 'the admin marks it reviewed');
  r = await call('GET', '/track/admin/tracks?key=secret');
  ok(!r.body.library.venues.find(v => v.id === 'blyton-park').review, 'the review flag is cleared');
  reqs = (await call('GET', '/track/admin/requests?key=secret')).body.requests;
  ok(reqs.find(x => x.id === addedReq.id).done === 'approved', 'and the request is done');
}
// The admin makes the lines they just set the official ones from the Add a session page.
{
  const course = { kind: 'sprint', name: 'Quick Course', organizer: 'A1', startLine: [[51.3, -0.8], [51.3002, -0.8002]], finishLine: [[51.31, -0.81], [51.3102, -0.8102]], lapLength: 700, lat: 51.3, lng: -0.8 };
  r = await call('POST', '/track/admin/course', course, 'tok-a');
  ok(r.status === 401, 'making a course official needs the admin');
  r = await call('POST', '/track/admin/course', course, 'tok-a', { 'X-Admin-Viewer': tok });
  const qv = r.body.library && r.body.library.venues.find(v => v.id === 'quick-course');
  ok(r.status === 200 && qv && qv.type === 'sprint' && qv.layouts[0].id === 'a1' && qv.layouts[0].startLine && qv.layouts[0].finishLine && qv.layouts[0].organizer === 'A1', 'the admin makes a course official in one step');
}
// The admin moves an existing course's official lines on the map from a session: the course route replaces them
// in place when asked to (replace + the layout), needing the admin.
{
  const moved = { kind: 'sprint', name: 'Quick Course', organizer: 'A1', venueId: 'quick-course', layoutId: 'a1', startLine: [[51.3001, -0.8001], [51.3003, -0.8003]], finishLine: [[51.311, -0.811], [51.3112, -0.8112]], lapLength: 700, lat: 51.3, lng: -0.8 };
  r = await call('POST', '/track/admin/course', Object.assign({}, moved, { replace: true }), 'tok-a');
  ok(r.status === 401, 'replacing a course\'s lines needs the admin');
  r = await call('POST', '/track/admin/course?key=secret', Object.assign({}, moved, { replace: true, startLine: [[51.3004, -0.8004], [51.3006, -0.8006]] }));
  ok(r.status === 200 && r.body.library.venues.find(v => v.id === 'quick-course').layouts.find(l => l.id === 'a1').startLine[0][0] === 51.3004, 'the Line editing panel replaces a course\'s lines with the admin key too');
  r = await call('POST', '/track/admin/course', Object.assign({}, moved, { replace: true }), 'tok-a', { 'X-Admin-Viewer': tok });
  const ql = r.body.library && r.body.library.venues.find(v => v.id === 'quick-course').layouts.find(l => l.id === 'a1');
  ok(r.status === 200 && ql && ql.startLine[0][0] === 51.3001 && ql.finishLine[0][0] === 51.311 && ql.organizer === 'A1' && r.body.library.venues.filter(v => v.id === 'quick-course').length === 1, 'the admin replaces the lines of a course in place (' + (ql && ql.startLine[0][0]) + ', ' + (ql && ql.finishLine[0][0]) + ')');
}
// A member asks to edit the map, the admin allows it, the member sends moved lines, and nothing on the session changes until
// the admin accepts (Undo throws it away). A member can never save moved lines themselves, granted or not.
{
  const saved = await call('POST', '/track/sessions', { carId: 'cara1', session, conditions: 'Dry', privacy: 'build', tyres: 'Test tyre' }, 'tok-a');
  const lid = saved.body.session.id;
  const startOf = () => stored('track-session:' + lid).startLine[0][0];
  const orig = session.startLine[0][0];
  const moved = (d = 0.0003) => { const c = JSON.parse(JSON.stringify(session)); c.startLine = c.startLine.map(p => [p[0] + d, p[1]]); return c; };
  const proposal = (d = 0.0003, time = 99.5) => ({ id: lid, startLine: moved(d).startLine, time });
  const mails = env.SEND_EMAIL.sent.length;
  r = await call('PUT', '/track/session', { id: lid, session }, 'tok-a');
  ok(r.status === 200, 'saving the session with its lines where they were is fine');
  r = await call('PUT', '/track/session', { id: lid, session: moved() }, 'tok-a');
  ok(r.status === 403 && r.body.needsLineAccess === true, 'a member saving moved lines is refused (' + r.status + ')');
  r = await call('GET', '/track/lines/status?id=' + lid, undefined, 'tok-a');
  ok(r.status === 200 && r.body.state === 'none' && r.body.proposal === null, 'no request yet');
  r = await call('GET', '/track/lines/status?id=' + lid, undefined, 'tok-b');
  ok(r.status !== 200, 'another member cannot see it');
  r = await call('POST', '/track/lines/request', { id: lid }, 'tok-b');
  ok(r.status !== 200, 'another member cannot ask for it');
  r = await call('POST', '/track/lines/propose', proposal(), 'tok-a');
  ok(r.status === 403, 'lines cannot be sent before the admin allows it');
  r = await call('POST', '/track/lines/request', { id: lid, note: 'The finish is in the wrong place' }, 'tok-a');
  ok(r.status === 200 && r.body.state === 'pending', 'the owner presses Request Edit Map');
  ok(env.SEND_EMAIL.sent.length === mails + 1 && /Request to edit a map/.test(env.SEND_EMAIL.sent[mails]) && /modtesla3uk@gmail\.com/.test(env.SEND_EMAIL.sent[mails]) && /wrong place/.test(env.SEND_EMAIL.sent[mails]), 'the admin is emailed about the request');
  ok(new RegExp('https://mt3uk\\.com/admin\\.html#lines-' + lid).test(env.SEND_EMAIL.sent[mails]) && new RegExp('https://mt3uk\\.com/track\\.html\\?s=' + lid).test(env.SEND_EMAIL.sent[mails]), 'and the email links straight to the request on the admin page and to the session');
  r = await call('POST', '/track/lines/request', { id: lid }, 'tok-a');
  ok(r.status === 200 && r.body.state === 'pending' && stored('track-line-access').length === 1, 'asking again does not add another request');
  r = await call('POST', '/track/lines/propose', proposal(), 'tok-a');
  ok(r.status === 403, 'still not allowed to send lines while it is only asked for');
  r = await call('GET', '/track/lines/admin');
  ok(r.status === 401, 'the list of requests needs the admin key');
  r = await call('GET', '/track/lines/admin?key=secret');
  const row = r.body.requests && r.body.requests.find(x => x.id === lid);
  ok(r.status === 200 && row && row.status === 'pending' && row.proposal === null && row.note.includes('wrong place') && /^.\*\*\*@/.test(row.email) && row.what.includes('Thruxton'), 'the admin sees who asked for which map, with the member masked: ' + (row && row.email) + ', ' + (row && row.what));
  r = await call('POST', '/track/lines/admin', { id: lid, action: 'grant' }, 'tok-a');
  ok(r.status === 401, 'a member cannot allow it themselves');
  r = await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'grant' });
  ok(r.status === 200 && (await call('GET', '/track/lines/status?id=' + lid, undefined, 'tok-a')).body.state === 'granted', 'the admin allows it and the member sees that');
  r = await call('PUT', '/track/session', { id: lid, session: moved() }, 'tok-a');
  ok(r.status === 403 && startOf() === orig, 'even when allowed, saving moved lines directly is refused');
  r = await call('POST', '/track/lines/propose', { id: lid, startLine: session.startLine, time: 99 }, 'tok-a');
  ok(r.status === 400, 'lines that have not moved are not sent');
  r = await call('POST', '/track/lines/propose', { id: lid, startLine: [[95, 0], [0, 0]], time: 99 }, 'tok-a');
  ok(r.status === 400, 'lines that are not on the earth are refused');
  r = await call('POST', '/track/lines/propose', proposal(), 'tok-b');
  ok(r.status !== 200, 'another member cannot send lines for it');
  const before = env.SEND_EMAIL.sent.length;
  r = await call('POST', '/track/lines/propose', proposal(), 'tok-a');
  ok(r.status === 200 && r.body.proposal && r.body.proposal.to.time === 99.5, 'the member sends the moved lines');
  ok(startOf() === orig, 'and nothing on the session has changed');
  const note = env.SEND_EMAIL.sent[before] || '';
  ok(env.SEND_EMAIL.sent.length === before + 1 && /awaiting your approval/i.test(note) && /from: /.test(note) && /to:   /.test(note) && /1:39\.500/.test(note) && new RegExp('admin\\.html#lines-' + lid).test(note) && new RegExp('track\\.html\\?s=' + lid).test(note), 'the admin is emailed what the lines and time were and would be, with a link to the request and the session');
  r = await call('GET', '/track/lines/admin?key=secret');
  const row2 = r.body.requests.find(x => x.id === lid);
  ok(row2.status === 'granted' && row2.proposal && row2.proposal.from.startLine[0][0] === orig && Math.abs(row2.proposal.to.startLine[0][0] - (orig + 0.0003)) < 1e-9, 'the admin sees the change from and to');
  r = await call('GET', '/track/lines/status?id=' + lid, undefined, 'tok-a');
  ok(r.body.proposal && r.body.proposal.to.time === 99.5, 'and the member sees theirs is waiting');
  r = await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'undo' });
  ok(r.status === 200 && startOf() === orig && stored('track-line-access')[0].proposal === null && stored('track-line-access')[0].status === 'granted', 'undo throws the change away and leaves access on');
  r = await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'undo' });
  ok(r.status === 400, 'there is nothing to undo twice');
  r = await call('POST', '/track/lines/propose', proposal(0.0006), 'tok-a');
  ok(r.status === 200, 'the member can send another');
  r = await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'accepted' });
  ok(r.status === 200 && stored('track-line-access')[0].proposal === null, 'accepting clears the change (the admin page has saved the new timing)');
  r = await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'revoke' });
  ok(r.status === 200 && stored('track-line-access').length === 0, 'the admin revokes access to that map');
  r = await call('POST', '/track/lines/propose', proposal(), 'tok-a');
  ok(r.status === 403, 'after that no more lines can be sent');
  r = await call('GET', '/track/lines/status?id=' + lid, undefined, 'tok-a');
  ok(r.body.state === 'none', 'and the status is back to none');
  r = await call('POST', '/track/lines/admin?key=secret', { id: 'nope', action: 'grant' });
  ok(r.status === 404, 'an unknown request is refused');
}
// Pictures of a change: the old and new lines, drawn in the member's browser, come with it, show in the admin's email
// (embedded) and on the panel, and go when the change is dealt with. They are optional: a change never waits on them.
{
  const saved = await call('POST', '/track/sessions', { carId: 'cara1', session, conditions: 'Dry', privacy: 'build', tyres: 'Test tyre' }, 'tok-a');
  const lid = saved.body.session.id;
  const raw = async (method, path, bytes, token) => {
    const init = { method, headers: { 'Content-Type': 'application/octet-stream' } };
    if (token) init.headers['X-Session-Token'] = token;
    if (bytes !== undefined) init.body = bytes;
    const res = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
    return { status: res.status, type: res.headers.get('Content-Type') || '', bytes: new Uint8Array(await res.arrayBuffer()) };
  };
  const jpeg = n => { const b = new Uint8Array(n); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; for (let i = 4; i < n; i++) b[i] = i % 251; return b; };
  const moved = JSON.parse(JSON.stringify(session)); moved.startLine = moved.startLine.map(p => [p[0] + 0.0003, p[1]]);
  const send = () => call('POST', '/track/lines/propose', { id: lid, startLine: moved.startLine, time: 99.5 }, 'tok-a');
  const pic = (which, token) => raw('POST', '/track/lines/image?id=' + lid + '&which=' + which, jpeg(2000), token);
  await call('POST', '/track/lines/request', { id: lid }, 'tok-a');
  r = await pic('before', 'tok-a');
  ok(r.status === 403, 'pictures cannot be sent before the admin allows editing');
  await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'grant' });
  r = await raw('POST', '/track/lines/image?id=' + lid + '&which=before', new TextEncoder().encode('not a picture at all'), 'tok-a');
  ok(r.status === 400, 'a file that is not a picture is refused');
  r = await raw('POST', '/track/lines/image?id=' + lid + '&which=before', jpeg(1600000), 'tok-a');
  ok(r.status === 413, 'a picture over 1.5 MB is refused');
  r = await raw('POST', '/track/lines/image?id=' + lid + '&which=sideways', jpeg(2000), 'tok-a');
  ok(r.status === 400, 'only a before and an after picture');
  r = await pic('before', 'tok-b');
  ok(r.status !== 200, 'another member cannot send one');
  r = await pic('before', 'tok-a');
  const r2 = await pic('after', 'tok-a');
  ok(r.status === 200 && r2.status === 200, 'the member sends the old and the new picture');
  const before = env.SEND_EMAIL.sent.length;
  r = await send();
  ok(r.status === 200 && r.body.proposal.images.before === true && r.body.proposal.images.after === true, 'the change says it has both pictures');
  const mail = env.SEND_EMAIL.sent[before] || '';
  ok(env.SEND_EMAIL.sent.length === before + 1 && /Subject: Map edit awaiting your approval: Thruxton/.test(mail) && /AWAITING YOUR APPROVAL/.test(mail), 'the admin is emailed that a change is awaiting approval');
  ok(/multipart\/related/.test(mail) && /multipart\/alternative/.test(mail) && /Content-Type: text\/plain/.test(mail) && /Content-Type: text\/html/.test(mail), 'with a text version and an HTML version');
  ok((mail.match(/Content-Type: image\/jpeg/g) || []).length === 2 && /Content-ID: <before-/.test(mail) && /Content-ID: <after-/.test(mail) && /src="cid:before-/.test(mail) && /src="cid:after-/.test(mail) && /\/9j\/4A/.test(mail), 'and both pictures embedded in it');
  ok(new RegExp('admin\\.html#lines-' + lid).test(mail) && new RegExp('track\\.html\\?s=' + lid).test(mail), 'with the links to the request and the session');
  r = await raw('GET', '/track/lines/image?id=' + lid + '&which=before');
  ok(r.status === 401, 'the pictures need the admin key to look at');
  r = await raw('GET', '/track/lines/image?key=secret&id=' + lid + '&which=after');
  ok(r.status === 200 && r.type === 'image/jpeg' && r.bytes.length === 2000 && r.bytes[0] === 0xff, 'the admin can look at them');
  r = await raw('GET', '/track/lines/image?key=secret&id=nothex&which=after');
  ok(r.status === 404, 'and only for a real session');
  r = await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'undo' });
  r = await raw('GET', '/track/lines/image?key=secret&id=' + lid + '&which=before');
  ok(r.status === 404 && !kv.has('track-line-image:' + lid + ':after'), 'undoing the change removes the pictures');
  // Without pictures the change still goes, with the same email and no pictures in it.
  const before2 = env.SEND_EMAIL.sent.length;
  r = await send();
  const mail2 = env.SEND_EMAIL.sent[before2] || '';
  ok(r.status === 200 && r.body.proposal.images.before === false && !/Content-Type: image/.test(mail2) && /awaiting your approval/.test(mail2), 'a change with no pictures is still sent and emailed');
  // An email that cannot be sent is kept and flagged, so the panel can say so.
  const realSend = env.SEND_EMAIL.send;
  env.SEND_EMAIL.send = async () => { throw new Error('mail is down'); };
  await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'undo' });
  r = await send();
  env.SEND_EMAIL.send = realSend;
  ok(r.status === 200 && r.body.proposal.emailFailed === true && stored('track-line-access').find(x => x.id === lid).proposal, 'a change is kept and flagged when its email could not be sent');
  await pic('before', 'tok-a');
  await call('POST', '/track/lines/admin?key=secret', { id: lid, action: 'revoke' });
  ok(!kv.has('track-line-image:' + lid + ':before'), 'revoking removes any pictures left');
}
// A layout with no official line: the first request fills it in, and one request per course waits.
{
  const body = { kind: 'circuit', name: 'Silverstone', venueId: 'silverstone', layoutId: 'gp', startLine: [[52.0725, -1.0148], [52.0726, -1.0150]], lapLength: 5891, lat: 52.0725, lng: -1.0148 };
  await call('POST', '/track/requests', body, 'tok-a');
  await call('POST', '/track/requests', body, 'tok-b');
  const waiting = (await call('GET', '/track/admin/requests?key=secret')).body.requests.filter(x => !x.done && x.layoutId === 'gp');
  ok(waiting.length === 1, 'one request waits per course');
  r = await call('POST', '/track/admin/requests?key=secret', { id: waiting[0].id, action: 'add' });
  const gp = r.body.library && r.body.library.venues.find(v => v.id === 'silverstone').layouts.find(l => l.id === 'gp');
  ok(r.status === 200 && r.body.filled === true && gp.startLine && gp.length, 'approving sets the official line on the existing layout ' + r.status + JSON.stringify(r.body).slice(0, 200));
}
// A course with official lines does not take a session timed on lines that were moved.
{
  const moved = JSON.parse(JSON.stringify(session));
  const lay = JSON.parse(tracksJson).venues.find(v => v.id === 'thruxton').layouts[0];
  if (lay.startLine && moved.startLine) {
    moved.startLine = moved.startLine.map(p => [p[0] + 0.001, p[1]]); moved.startLineFromMember = true;
    r = await call('POST', '/track/sessions', { carId: 'cara1', session: moved, privacy: 'board' }, 'tok-a');
    ok(r.status === 200 && !r.body.session.layoutId, 'lines moved off the official ones: no course, so no leaderboard place');
    await call('DELETE', '/track/session?id=' + r.body.session.id, undefined, 'tok-a');
  }
}
// Admin read-only view of a private session, logged.
{
  // Its own start time: a session with a file name that matches one already saved would be refused as a duplicate.
  const fileSession = JSON.parse(JSON.stringify(session)); fileSession.fileName = 'VBOX0016.vbo'; fileSession.time = '09:09';
  r = await call('POST', '/track/sessions', { carId: 'cara1', session: fileSession, notes: 'Secret note', privacy: 'private' }, 'tok-a');
  const pid = r.body.session.id;
  r = await call('GET', '/track/session?id=' + pid);
  ok(r.status === 404, 'a private session is hidden from the public');
  r = await call('GET', '/track/session?id=' + pid, undefined, undefined, { 'X-Admin-Viewer': 'not-a-real-token-1234567' });
  ok(r.status === 404, 'a bad admin token does not open it');
  r = await call('GET', '/track/session?id=' + pid, undefined, undefined, { 'X-Admin-Viewer': tok });
  ok(r.status === 200 && r.body.session.adminView === true && r.body.session.notes === undefined && r.body.session.owner === undefined && !r.body.session.mine, 'admin opens a private session read only, no notes ' + r.status + JSON.stringify(r.body).slice(0, 200));
  ok(r.body.session.fileName === 'VBOX0016.vbo', 'the admin sees the file name');
  { const own = await call('GET', '/track/session?id=' + pid, undefined, 'tok-a'); ok(own.body.session.fileName === 'VBOX0016.vbo', 'the owner sees the file name'); await call('PUT', '/track/session', { id: pid, privacy: 'build' }, 'tok-a'); const pub = await call('GET', '/track/session?id=' + pid); ok(pub.status === 200 && pub.body.session.fileName === undefined, 'other people never see the file name'); await call('PUT', '/track/session', { id: pid, privacy: 'private' }, 'tok-a'); }
  await call('GET', '/track/session?id=' + pid, undefined, undefined, { 'X-Admin-Viewer': tok });
  const logged = stored('track-admin-views');
  ok(logged.length === 1 && logged[0].id === pid, 'the view is logged once (repeat within a minute merges)');
  r = await call('GET', '/track/admin/sessions?email=' + encodeURIComponent(A));
  ok(r.status === 401, 'finding a member needs the admin key');
  r = await call('GET', '/track/admin/sessions?key=secret&email=' + encodeURIComponent(A));
  ok(r.status === 200 && r.body.sessions.some(x => x.id === pid), 'admin lists a member\'s sessions');
  r = await call('GET', '/track/admin/sessions?key=secret');
  ok(r.status === 200 && r.body.views.length === 1, 'admin reads the view log');
  // Renaming a session at a track we do not list.
  r = await call('GET', '/track/admin/sessions?key=secret&email=' + encodeURIComponent(A));
  const unl = r.body.sessions.find(x => x.id === unknownId);
  ok(unl && unl.venueId === '' && r.body.sessions.find(x => x.id === pid).venueId === 'thruxton', 'the admin list says which sessions are at a listed track');
  r = await call('POST', '/track/admin/session', { id: unknownId, venue: 'Abingdon Airfield' });
  ok(r.status === 401, 'renaming needs the admin key');
  r = await call('POST', '/track/admin/session?key=secret', { id: unknownId, venue: '  ' });
  ok(r.status === 400, 'a blank name is refused');
  r = await call('POST', '/track/admin/session?key=secret', { id: pid, venue: 'Not Thruxton' });
  ok(r.status === 400 && /Tracks panel/.test(r.body.message), 'a session at a listed track is not renamed here');
  r = await call('POST', '/track/admin/session?key=secret', { id: unknownId, venue: '  Abingdon Airfield  ' });
  ok(r.status === 200 && r.body.session.venue === 'Abingdon Airfield', 'renamed and trimmed ' + JSON.stringify(r.body).slice(0, 120));
  r = await call('GET', '/track/session?id=' + unknownId, undefined, 'tok-a');
  ok(r.body.session.venue === 'Abingdon Airfield', 'the session carries the new name');
  r = await call('GET', '/track/sessions', undefined, 'tok-a');
  ok(r.body.sessions.find(x => x.id === unknownId).venue === 'Abingdon Airfield', 'and so does the member\'s list');
  r = await call('GET', '/track/public?car=cara1');
  ok(r.status === 200 && r.body.sessions.find(x => x.id === unknownId).venue === 'Abingdon Airfield', 'and the car\'s shared list');
  r = await call('POST', '/track/admin/session?key=secret', { id: 'deadbeef00', venue: 'X' });
  ok(r.status === 404, 'an unknown session is not found');
}
// A member leaving is taken off the early preview lists.
kv.set('track-access', JSON.stringify({ open: false, allowed: [{ email: A }, { email: B }, { email: 'gone@example.com' }], pending: [{ email: 'gone@example.com' }] }));
await mod.deleteMemberAccount(env, 'gone@example.com');
ok(!JSON.stringify(stored('track-access')).includes('gone@example.com') && stored('track-access').allowed.length === 2, 'a member who leaves comes off the early preview lists');

// Admin: re-time saved sessions (list, read one, read its readings, save the new timing)
{
  const saved = await call('POST', '/track/sessions', { carId: 'cara1', session: Object.assign({}, session, { analysisVersion: undefined }), conditions: 'Dry', privacy: 'build', tyres: 'Test tyre', notes: 'keep me' }, 'tok-a');
  const id = saved.body.session.id;
  ok(saved.status === 200, 'a session saved without a version');
  ok(stored('track-session:' + id).analysisVersion === undefined, 'sessions timed before the version stamp have none');
  let x = await call('GET', '/track/admin/retime');
  ok(x.status === 401, 're-time needs the admin key');
  x = await call('GET', '/track/admin/retime?key=secret');
  const row = x.body.sessions.find(s => s.id === id);
  ok(x.status === 200 && row && row.version === 1 && x.body.done === true, 're-time lists sessions with their version (none counts as 1)');
  ok(typeof row.owner === 'string' && row.owner.length > 0 && ['private', 'build', 'board'].includes(row.privacy), 'and whose each is, and whether it is private: ' + row.owner + ', ' + row.privacy);
  x = await call('GET', '/track/admin/retime?key=secret&id=' + id);
  ok(x.status === 200 && x.body.session.id === id, 're-time reads one session');
  x = await call('GET', '/track/admin/retime/source?key=secret&id=' + id);
  ok(x.status === 404, 'no readings kept gives a clear answer');
  const fresh = T.analyse(T.read(fs.readFileSync(ROOT + 'tests/fixtures/thruxton-trimmed.vbo', 'latin1'), 'f.vbo'), lib);
  ok(fresh.analysisVersion === T.ANALYSIS_VERSION, 'the parser stamps its version on a new analysis');
  x = await call('POST', '/track/admin/retime', { id, session: fresh });
  ok(x.status === 401, 'saving a re-timed session needs the admin key');
  x = await call('POST', '/track/admin/retime?key=secret', { id, session: fresh });
  const after = stored('track-session:' + id);
  ok(x.status === 200 && after.analysisVersion === T.ANALYSIS_VERSION, 're-timing stores the new version');
  ok(after.owner === stored('track-session:' + id).owner && after.carId === 'cara1' && after.notes === 'keep me' && after.tyres === 'Test tyre' && after.privacy === 'build', "the member's details and owner carry over");
  const idx = JSON.parse(kv.get('track-index:' + after.owner));
  ok(idx.some(s => s.id === id), 'the owner list still has it');
  // The session page moves one session's lines with the admin viewer token, not the key: one session, never the list.
  x = await call('GET', '/track/admin/retime?id=' + id, undefined, undefined, { 'X-Admin-Viewer': 'not-a-real-token-1234567' });
  ok(x.status === 401, 'a made-up viewer token cannot read a session to re-time');
  x = await call('GET', '/track/admin/retime?id=' + id, undefined, undefined, { 'X-Admin-Viewer': tok });
  ok(x.status === 200 && x.body.session.id === id, 'the admin viewer token reads one session to re-time');
  x = await call('GET', '/track/admin/retime', undefined, undefined, { 'X-Admin-Viewer': tok });
  ok(x.status === 401, 'but the list of every session still needs the admin key');
  x = await call('GET', '/track/admin/retime/source?id=' + id, undefined, undefined, { 'X-Admin-Viewer': tok });
  ok(x.status === 404, 'the viewer token is let in to read the readings (none kept here)');
  x = await call('POST', '/track/admin/retime', { id, session: Object.assign({}, fresh, { bestTime: fresh.bestTime }) }, undefined, { 'X-Admin-Viewer': tok });
  ok(x.status === 200 && stored('track-session:' + id).notes === 'keep me', 'the admin viewer token saves a session with new lines, keeping the member\'s details');
  // The re-time list says which track and course each session is on, so one track's sessions can be re-timed together,
  // and a session whose lines the admin accepted keeps that mark through a save.
  x = await call('GET', '/track/admin/retime?key=secret');
  const row3 = x.body.sessions.find(s => s.id === id);
  ok(row3.venueId === 'thruxton' && row3.layoutId === 'main', 'the re-time list carries the track and course (' + row3.venueId + ', ' + row3.layoutId + ')');
  x = await call('POST', '/track/admin/retime?key=secret', { id, session: Object.assign({}, fresh, { linesAccepted: true }) });
  ok(x.status === 200 && stored('track-session:' + id).linesAccepted === true, 'the mark that the admin accepted this session\'s lines is kept');
  x = await call('POST', '/track/admin/retime?key=secret', { id, session: fresh });
  ok(x.status === 200 && stored('track-session:' + id).linesAccepted === undefined, 'and it is not added to other sessions');
  x = await call('POST', '/track/admin/retime?key=secret', { id: 'deadbeefdeadbeef', session: fresh });
  ok(x.status === 404, 'an unknown session is refused');
}

// A Track Mode session's summary carries its battery start and end, so a day's group can add up the charge used
{
  const tesla = T.analyse(T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-no-timestamps.csv', 'utf8'), 'telemetry-v1-2024-02-23-15_10_30.csv'), lib, { type: 'other' });
  ok(tesla.carData && tesla.carData.soc, 'the Track Mode drive file has battery figures');
  const saved = await call('POST', '/track/sessions', { carId: 'cara1', session: tesla }, 'tok-a');
  const list = await call('GET', '/track/sessions', undefined, 'tok-a');
  const row = list.body.sessions.find(x => x.id === saved.body.session.id);
  ok(row && Array.isArray(row.soc) && row.soc.length === 2 && row.soc[0] >= row.soc[1] && row.soc.every(Number.isFinite), 'the list entry has the battery at the start and end (' + (row && row.soc) + ')');
  ok(Array.isArray(row.origin) && row.origin.length === 2 && row.origin.every(Number.isFinite), 'the list entry says where it was, so sessions at an unlisted track can be matched');
  // A lap's own Track Mode figures are kept with the session
  const lapSess = T.analyse(T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-no-timestamps-lap.csv', 'utf8'), 'telemetry-v1-2024-02-23-15_10_30.csv'), lib);
  const lapSaved = await call('POST', '/track/sessions', { carId: 'cara1', session: lapSess, venueName: 'Test track' }, 'tok-a');
  const lapGot = await call('GET', '/track/session?id=' + lapSaved.body.session.id, undefined, 'tok-a');
  const l0 = lapGot.body.session.laps && lapGot.body.session.laps[0];
  ok(l0 && l0.carData && l0.carData.soc && Number.isFinite(l0.carData.soc.start) && !('run' in l0.carData), 'a lap\'s own car figures are kept when the session is saved');
  // A lap timer file joined with a Track Mode file keeps which car file it came from, and how well they lined up
  const rbRd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/racebox-drive-2026-10-02.gpx', 'utf8'), 'RaceBox_Drag_Session_on_02-10-2026_23-03.gpx');
  const tmRd = T.read(fs.readFileSync(ROOT + 'tests/fixtures/tesla-track-mode-drive-2026-10-02.csv', 'utf8'), 'telemetry-v1-2026-10-02-23_01_21.csv');
  const joined = T.mergeSources(rbRd, tmRd);
  const joinedSess = T.analyse(Object.assign({}, joined.rd, { carSource: Object.assign({}, joined.rd.carSource, { name: 'telemetry-v1-2026-10-02-23_01_21.csv' }) }), lib, { type: 'other' });
  const joinedSaved = await call('POST', '/track/sessions', { carId: 'cara1', session: joinedSess }, 'tok-a');
  const joinedGot = await call('GET', '/track/session?id=' + joinedSaved.body.session.id, undefined, 'tok-a');
  const cs = joinedGot.body.session.carSource;
  ok(cs && cs.name === 'telemetry-v1-2026-10-02-23_01_21.csv' && cs.match > 0.99 && cs.g === true && cs.speed === true, 'a joined session keeps its car file name and how well it lined up');
  const plain = await call('POST', '/track/sessions', { carId: 'cara1', session }, 'tok-a');
  const list2 = await call('GET', '/track/sessions', undefined, 'tok-a');
  ok(!('soc' in list2.body.sessions.find(x => x.id === plain.body.session.id)), 'a session with no battery figures has none');
}

// Reports email the admin too (the Admin bell only fills while admin.html is open).
{
  kv.set('comments:car-9.jpg', JSON.stringify([{ id: 'cm1', name: 'Sam', text: 'A rude <b>remark</b>', at: '2026-10-01T10:00:00Z' }]));
  const before = env.SEND_EMAIL.sent.length;
  r = await call('POST', '/comments/report', { file: 'car-9.jpg', id: 'cm1' }, 'tok-a');
  const mail = env.SEND_EMAIL.sent.slice(before).join('\n');
  ok(r.status === 200 && env.SEND_EMAIL.sent.length === before + 1 && /Reported comment on car-9\.jpg/.test(mail) && /Sam/.test(mail) && /A rude/.test(mail) && /admin\.html#grp-reports/.test(mail), 'a reported comment emails the admin with who said what');
  r = await call('POST', '/comments/report', { file: 'car-9.jpg', id: 'cm1' }, 'tok-a');
  ok(env.SEND_EMAIL.sent.length === before + 1, 'the same member reporting it again sends nothing more');
  r = await call('POST', '/gallery/report', { file: 'car-9.jpg' }, undefined, { 'X-Voter-Id': 'visitor-0001' });
  const pm = env.SEND_EMAIL.sent[before + 1] || '';
  ok(r.status === 200 && env.SEND_EMAIL.sent.length === before + 2 && /Reported photo: car-9\.jpg/.test(pm) && /gallery\.html\?photo=car-9\.jpg/.test(pm), 'a reported photo emails the admin');
  r = await call('POST', '/gallery/report', { file: 'car-9.jpg' }, undefined, { 'X-Voter-Id': 'visitor-0001' });
  ok(env.SEND_EMAIL.sent.length === before + 2, 'the same visitor reporting it again sends nothing more');
}

// The same file saved twice is refused, pointing at the one already there.
{
  const up = Object.assign({}, session, { fileName: 'Thruxton 14-05.vbo', time: '09:21' });
  const first = await call('POST', '/track/sessions', { carId: 'cara1', session: up }, 'tok-a');
  const again = await call('POST', '/track/sessions', { carId: 'cara1', session: up }, 'tok-a');
  ok(first.status === 200 && again.status === 409 && again.body.duplicate === true && again.body.session.id === first.body.session.id && /already have this session/.test(again.body.message), 'uploading the same file again is refused and names the session it already is');
  const otherCar = await call('POST', '/track/sessions', { carId: 'cara2', session: up }, 'tok-a');
  const otherTime = await call('POST', '/track/sessions', { carId: 'cara1', session: Object.assign({}, up, { time: '09:22' }) }, 'tok-a');
  ok(otherCar.status !== 409 && otherTime.status === 200, 'another car or another start time is not a duplicate (' + otherCar.status + ', ' + otherTime.status + ')');
  for (const x of [first, otherCar, otherTime]) if (x.body.session) await call('DELETE', '/track/session?id=' + x.body.session.id, undefined, 'tok-a');
}

// The welcome text on track.html: nothing set means the built-in words; the admin's words are cleaned and kept.
{
  let cp = await call('GET', '/track/copy');
  ok(cp.status === 200 && cp.body.success && Object.keys(cp.body.copy).length === 0, 'no welcome text set: the page uses its own');
  ok((await call('POST', '/track/copy/admin', { heading: 'x' })).status === 401, 'the welcome text needs the admin key');
  cp = await call('POST', '/track/copy/admin?key=secret', { heading: 'Lap times for <every> car', intro: '  Bring your file.  ', bullets: ['One', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'] });
  ok(cp.body.success && cp.body.copy.heading === 'Lap times for every car' && cp.body.copy.intro === 'Bring your file.' && cp.body.copy.bullets.length === 8 && cp.body.copy.bullets[1] === 'Two', 'the words are trimmed, angle brackets dropped, blanks dropped and the list kept to eight: ' + JSON.stringify(cp.body.copy).slice(0, 120));
  ok((await call('GET', '/track/copy')).body.copy.heading === 'Lap times for every car', 'the page reads them');
  cp = await call('POST', '/track/copy/admin?key=secret', { heading: '', intro: '', bullets: 'A\nB' });
  ok(!cp.body.copy.heading && cp.body.copy.bullets.length === 2, 'blank fields fall back to the built-in words, a list may come as lines');
  cp = await call('POST', '/track/copy/admin?key=secret', { reset: true });
  ok(cp.body.success && Object.keys(cp.body.copy).length === 0 && !kv.has('track-copy'), 'reset clears the words');
}

// The Track sessions link preview picture: pictures in the bucket, one KV key, a week's pick.
{
  let sp = await call('GET', '/share/track');
  ok(sp.status === 200 && sp.body.success && sp.body.items.length === 0 && sp.body.pick === null && /^\d{4}-W\d{2}$/.test(sp.body.week), 'no pictures yet: the share page keeps its own');
  ok((await call('GET', '/share/track/admin')).status === 401 && (await call('POST', '/share/track/admin', { action: 'rotate', on: true })).status === 401, 'the picture set needs the admin key');
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])], { type: 'image/jpeg' });
  async function upload(fields, keyed) {
    const fd = new FormData();
    fd.append('file', jpeg, 'share.jpg');
    Object.keys(fields).forEach(k => fd.append(k, fields[k]));
    const r = await worker.fetch(new Request('https://w.test/share/track/admin/image' + (keyed === false ? '' : '?key=secret'), { method: 'POST', body: fd }), env, { waitUntil() {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  ok((await upload({ kind: 'session' }, false)).status === 401, 'uploading a picture needs the admin key');
  let up = await upload({ kind: 'session', label: 'Thruxton, 2026-05-28', caption: 'Every lap mapped and timed', sessionId: 'abcdef1234' });
  ok(sp.body.version === 0 && up.body.version === 1, 'the set has a version that counts changes, for the share links');
  ok(up.status === 200 && up.body.success && up.body.items.length === 1 && up.body.items[0].kind === 'session' && up.body.items[0].sessionId === 'abcdef1234' && up.body.items[0].caption === 'Every lap mapped and timed' && /r2\.dev\/share\/track\/[a-z0-9]+\.jpg$/i.test(up.body.items[0].url), 'a picture drawn from a session is saved to the bucket with its caption: ' + JSON.stringify(up.body).slice(0, 160));
  const id1 = up.body.items[0].id;
  ok(bucket.has('share/track/' + id1 + '.jpg'), 'the bytes are in the bucket under share/track/');
  sp = await call('GET', '/share/track');
  ok(sp.body.items.length === 1 && !('label' in sp.body.items[0]) && !('sessionId' in sp.body.items[0]) && !('label' in sp.body.pick) && sp.body.pick.url && sp.body.pick.caption === 'Every lap mapped and timed', 'the public list carries only each picture\'s address and caption, never whose session it was');
  const bad = new FormData(); bad.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  const badR = await worker.fetch(new Request('https://w.test/share/track/admin/image?key=secret', { method: 'POST', body: bad }), env, { waitUntil() {} });
  ok(badR.status === 400, 'only a picture is accepted: ' + badR.status);
  up = await upload({ kind: 'photo', label: 'Paddock' });
  const id2 = up.body.items[1].id;
  ok(up.body.items.length === 2 && up.body.items[1].kind === 'photo', 'a photo joins the set');
  sp = await call('GET', '/share/track');
  ok(sp.body.rotate === false && sp.body.pick && sp.body.pick.id === id1, 'with no rotation and nothing chosen, the first picture is the one');
  let ad = await call('POST', '/share/track/admin?key=secret', { action: 'rotate', on: true });
  ok(ad.body.rotate === true && ad.body.pick && [id1, id2].includes(ad.body.pick.id), 'rotation on: the week picks one of them in turn');
  ad = await call('POST', '/share/track/admin?key=secret', { action: 'use', id: id2 });
  ok(ad.body.rotate === false && ad.body.current === id2 && ad.body.pick.id === id2, 'Use this now picks one and turns rotation off');
  ad = await call('POST', '/share/track/admin?key=secret', { action: 'caption', id: id2, caption: 'Our paddock at Snetterton' });
  ok(ad.body.items[1].caption === 'Our paddock at Snetterton' && (await call('GET', '/share/track')).body.pick.caption === 'Our paddock at Snetterton', 'a caption is saved and shows on the pick');
  ok((await call('POST', '/share/track/admin?key=secret', { action: 'nonsense' })).status === 400, 'an unknown action is refused');
  ad = await call('POST', '/share/track/admin?key=secret', { action: 'delete', id: id2 });
  ok(ad.body.items.length === 1 && ad.body.current === '' && ad.body.pick.id === id1 && !bucket.has('share/track/' + id2 + '.jpg'), 'deleting takes the picture out of the bucket and the set');
  ok(ad.body.version === 6 && (await call('GET', '/share/track')).body.version === 6, 'every change moves the version on (two uploads, rotate, use, caption, delete)');
  await call('POST', '/share/track/admin?key=secret', { action: 'delete', id: id1 });
  // The homepage has a slot of its own, kept apart, and the share buttons read every slot's version at once.
  const hv = (await call('GET', '/share/versions')).body.versions;
  ok(hv.track === 7 && hv.home === 0, 'every slot\'s version in one answer: ' + JSON.stringify(hv));
  const hf = new FormData(); hf.append('file', jpeg, 'home.jpg'); hf.append('kind', 'photo'); hf.append('label', 'Meet');
  const hr = await worker.fetch(new Request('https://w.test/share/home/admin/image?key=secret', { method: 'POST', body: hf }), env, { waitUntil() {} });
  const hb = await hr.json();
  ok(hr.status === 200 && hb.slot === 'home' && hb.items.length === 1 && bucket.has(hb.items[0].url.replace(/^.*r2\.dev\//, '')) && hb.items[0].url.includes('/share/home/'), 'a homepage picture goes under share/home/');
  ok((await call('GET', '/share/track')).body.items.length === 0 && (await call('GET', '/share/home')).body.pick.id === hb.items[0].id, 'the two sets are kept apart');
  ok((await call('GET', '/share/paddock')).status === 404 || (await call('GET', '/share/paddock')).status === 405 || !(await call('GET', '/share/paddock')).body.success, 'an unknown slot is not a set');
  await call('POST', '/share/home/admin?key=secret', { action: 'delete', id: hb.items[0].id });
}

// Leaving the site clears everything.
await mod.deleteMemberAccount(env, A);
ok(!kv.has('track-index:' + (await mod.ownerKey(A))) && ![...kv.keys()].some(k => k.startsWith('track-session:') && stored(k).carId === 'cara1') && !kv.has('track-public:cara1'), 'a member leaving removes their sessions');
