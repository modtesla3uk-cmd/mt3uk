// Run by tests/test_no_photo_car.py: a car added without a photo (Laps "Add your car"), through the real worker
// with a fake KV store and photo bucket. WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const bucket = new Map();
const env = {
  ADMIN_KEY: 'secret',
  GITHUB_TOKEN: 'x',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true })
  },
  GALLERY_BUCKET: {
    get: async k => bucket.has(k) ? { json: async () => JSON.parse(bucket.get(k)) } : null,
    put: async (k, v) => { bucket.set(k, typeof v === 'string' ? v : 'binary'); },
    delete: async k => { bucket.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ objects: [...bucket.keys()].filter(k => k.startsWith(prefix) && k.indexOf('/cars/') === -1).map(key => ({ key, uploaded: new Date('2026-01-01T00:00:00Z') })), truncated: false })
  },
  SEND_EMAIL: { send: async () => {} }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const A = 'a@example.com', B = 'b@example.com';
kv.set('my-builds-session:tok-a', A);
kv.set('my-builds-session:tok-b', B);
kv.set('profile:' + A, JSON.stringify({ firstName: 'Pat', lastName: 'P', nickname: 'Pat' }));
kv.set('track-access', JSON.stringify({ open: true, allowed: [], pending: [] }));
const call = async (method, path, body, token) => {
  const init = { method, headers: {} };
  if (token) init.headers['X-Session-Token'] = token;
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const garage = async t => (await call('GET', '/my-builds', undefined, t || 'tok-a')).body.cars || [];

let r = await call('POST', '/my-builds/car/new', { make: 'Porsche', model: '911 GT3' });
ok(r.status === 401, 'adding a car needs a sign-in');
r = await call('POST', '/my-builds/car/new', { model: '911 GT3' }, 'tok-a');
ok(r.status === 400, 'a make is needed');
r = await call('POST', '/my-builds/car/new', { make: 'Porsche' }, 'tok-a');
ok(r.status === 400, 'a model is needed');
r = await call('POST', '/my-builds/car/new', { make: 'Porsche', model: '911 GT3', year: '2019', vehicleType: 'car' }, 'tok-a');
const gt3 = r.body.car && r.body.car.id;
ok(r.body.success && gt3 && r.body.car.name === 'Porsche 911 GT3' && r.body.car.garageOnly === true, 'a car of another make is added with no photo, named from its make and model, kept in the garage');
const rec = JSON.parse(bucket.get('gallery/cars/' + gt3 + '.json'));
ok(!JSON.stringify(rec).includes(A) && rec.photos.length === 0 && rec.garageOnly === true, 'its public record has no email and no photos');
ok(kv.get('car-owner:' + gt3) === A && JSON.parse(kv.get('member-cars:' + A)).includes(gt3), 'its owner is kept privately');
let cars = await garage();
let c = cars.find(x => x.id === gt3);
ok(c && c.photos.length === 0 && c.make === 'Porsche' && c.model === '911 GT3' && c.year === 2019 && c.garageOnly, 'My Garage lists it with its make, model and year');
ok(!(await garage('tok-b')).some(x => x.id === gt3), 'another member does not see it');
r = await call('POST', '/my-builds/car/new', { make: 'tesla', model: 'Model 3', name: 'Daily' }, 'tok-a');
const m3 = r.body.car.id;
ok(r.body.success && r.body.car.garageOnly === false && r.body.car.name === 'Daily' && r.body.car.make === 'Tesla', 'a Tesla is not kept in the garage, and can be named');
r = await call('POST', '/my-builds/car/new', { make: 'Ducati', model: 'Panigale V4', vehicleType: 'bike', year: '1962' }, 'tok-a');
const bike = r.body.car.id;
ok(r.body.success && r.body.car.vehicleType === 'bike' && r.body.car.year === 1962, 'a bike can be added, and an older year is kept');

// It works like any other car: renaming, its details, Track sessions.
r = await call('PUT', '/my-builds/car', { carId: gt3, name: 'Track toy', year: 2020 }, 'tok-a');
ok(r.body.success, 'the owner can rename it and change its details');
r = await call('PUT', '/my-builds/car', { carId: gt3, name: 'Mine now' }, 'tok-b');
ok(r.status === 403, 'another member cannot');
cars = await garage();
ok(cars.find(x => x.id === gt3).name === 'Track toy', 'the new name is kept');
const sess = { type: 'track', venue: 'Somewhere', date: '2026-09-01', time: '10:00', laps: [{ n: 1, time: 90.5 }], bestTime: 90.5 };
r = await call('POST', '/track/sessions', { carId: gt3, session: sess, privacy: 'private' }, 'tok-a');
ok(r.status !== 403, 'a Track session can be saved for it (' + r.status + ' ' + (r.body.message || '') + ')');
r = await call('POST', '/track/sessions', { carId: gt3, session: sess, privacy: 'private' }, 'tok-b');
ok(r.status === 403, 'but not by another member');
r = await call('GET', '/track/public?car=' + gt3, undefined, 'tok-a');
ok(r.body.success && r.body.mine === true && r.body.car.owner === 'Pat', 'its public page knows the owner without a photo');

// Removing: only the owner's own photoless cars.
r = await call('POST', '/my-builds/car/remove', { carId: bike }, 'tok-b');
ok(r.status === 403, 'another member cannot remove it');
r = await call('POST', '/my-builds/car/remove', { carId: bike }, 'tok-a');
ok(r.body.success && !bucket.has('gallery/cars/' + bike + '.json') && !kv.has('car-owner:' + bike) && !JSON.parse(kv.get('member-cars:' + A)).includes(bike), 'the owner can remove it');
ok(!(await garage()).some(x => x.id === bike), 'and it has gone from My Garage');

// A record that has gone is left out quietly.
bucket.delete('gallery/cars/' + m3 + '.json');
cars = await garage();
ok(!cars.some(x => x.id === m3) && cars.some(x => x.id === gt3), 'a listed car whose record has gone is left out');

// Leaving removes them.
r = await call('POST', '/profile/leave', { confirm: 'LEAVE' }, 'tok-a');
ok(r.body.success && !bucket.has('gallery/cars/' + gt3 + '.json') && !kv.has('member-cars:' + A) && !kv.has('car-owner:' + gt3), 'a member who leaves takes their photoless cars with them');
