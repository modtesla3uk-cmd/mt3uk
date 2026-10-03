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
// The admin makes the lines they just set the official ones from the Add a session page.
{
  const course = { kind: 'sprint', name: 'Quick Course', organizer: 'A1', startLine: [[51.3, -0.8], [51.3002, -0.8002]], finishLine: [[51.31, -0.81], [51.3102, -0.8102]], lapLength: 700, lat: 51.3, lng: -0.8 };
  r = await call('POST', '/track/admin/course', course, 'tok-a');
  ok(r.status === 401, 'making a course official needs the admin');
  r = await call('POST', '/track/admin/course', course, 'tok-a', { 'X-Admin-Viewer': tok });
  const qv = r.body.library && r.body.library.venues.find(v => v.id === 'quick-course');
  ok(r.status === 200 && qv && qv.type === 'sprint' && qv.layouts[0].id === 'a1' && qv.layouts[0].startLine && qv.layouts[0].finishLine && qv.layouts[0].organizer === 'A1', 'the admin makes a course official in one step');
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
  const lapSaved = await call('POST', '/track/sessions', { carId: 'cara1', session: lapSess }, 'tok-a');
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

// Leaving the site clears everything.
await mod.deleteMemberAccount(env, A);
ok(!kv.has('track-index:' + (await mod.ownerKey(A))) && ![...kv.keys()].some(k => k.startsWith('track-session:') && stored(k).carId === 'cara1') && !kv.has('track-public:cara1'), 'a member leaving removes their sessions');
