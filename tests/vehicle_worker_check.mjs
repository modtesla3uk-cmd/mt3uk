// Run by tests/test_vehicles.py: the vehicle lists and a car's make, model and type, through the real worker
// with a fake KV store and photo bucket, plus the helpers in js/vehicle-data.js.
// WORKER_MODULE is a copy of the worker that node can load.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
require(ROOT + 'js/vehicle-data.js');
const V = globalThis.MT3UKVehicles;
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
    // The live photo listing the garage reads.
    list: async ({ prefix = '' } = {}) => ({ objects: [...bucket.keys()].filter(k => k.startsWith(prefix) && k.indexOf('/cars/') === -1).map(key => ({ key, uploaded: new Date('2026-01-01T00:00:00Z') })), truncated: false })
  },
  SEND_EMAIL: { sent: [], send: async function (m) { this.sent.push(m.raw); } }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const A = 'a@example.com';
kv.set('my-builds-session:tok-a', A);
kv.set('profile:' + A, JSON.stringify({ firstName: 'Rich', lastName: 'H', nickname: 'Rich' }));
kv.set('subscriber:' + A, JSON.stringify(['a1.jpg']));
bucket.set('gallery/a1.jpg', 'binary');
await mod.putSidecar(env, 'gallery/a1.jpg.json', { email: A, carId: 'cara1' });
await mod.saveCarRecord(env, { id: 'cara1', name: 'Arctic Three', photos: ['a1.jpg'], mods: [] });
kv.set('car-details:cara1', JSON.stringify({ model: 'Model 3', version: 'Performance' }));

const call = async (method, path, body, token) => {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) init.headers['X-Session-Token'] = token;
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// ---- A car's make, model and type (a car with neither is unchanged) ----
let r = await call('GET', '/my-builds', undefined, 'tok-a');
let car = (r.body.cars || [])[0] || {};
ok(r.status === 200 && car.model === 'Model 3' && car.make === '' && car.vehicleType === '', 'a car with no make or type shows neither in My Garage');
r = await call('PUT', '/my-builds/car', { carId: 'cara1', make: 'Kia', model: 'EV6 GT', vehicleType: 'car' }, 'tok-a');
ok(r.status === 200 && r.body.car.make === 'Kia' && r.body.car.model === 'EV6 GT' && r.body.car.vehicleType === 'car', 'a make, a typed model and a type are saved with the car');
ok(JSON.parse(kv.get('car-details:cara1')).version === 'Performance', 'the version it already had is kept');
r = await call('GET', '/my-builds', undefined, 'tok-a');
car = r.body.cars[0];
ok(car.make === 'Kia' && car.model === 'EV6 GT' && car.vehicleType === 'car', 'My Garage lists the make and type');
r = await call('PUT', '/my-builds/car', { carId: 'cara1', model: 'EV6' }, 'tok-a');
ok(r.status === 200 && r.body.car.model === 'EV6' && r.body.car.make === 'Kia', 'changing only the model keeps the make, so a typed model is not lost');
r = await call('GET', '/cars/public?file=a1.jpg');
ok(r.body.make === 'Kia' && r.body.model === 'EV6' && r.body.vehicleType === 'car', 'the Gallery car sheet carries them too');
r = await call('PUT', '/my-builds/car', { carId: 'cara1', model: 'Model 3', make: '', vehicleType: '' }, 'tok-a');
ok(r.status === 200 && r.body.car.model === 'Model 3' && r.body.car.make === undefined && r.body.car.vehicleType === undefined, 'a listed model with the make cleared puts the car back as it was');
r = await call('PUT', '/my-builds/car', { carId: 'cara1', model: 'Model Q' }, 'tok-a');
ok(r.status === 200 && r.body.car.model === undefined, 'a model that is not listed, with no make, is still dropped, as before');
r = await call('PUT', '/my-builds/car', { carId: 'cara1', model: 'Model Y', version: 'Long Range AWD', year: '2022' }, 'tok-a');
ok(r.status === 200 && r.body.car.model === 'Model Y' && r.body.car.version === 'Long Range AWD' && r.body.car.year === 2022 && r.body.car.make === undefined, 'the garage form as it is today still works');

// ---- cleanCarModel ----
ok(JSON.stringify(mod.cleanCarModel({ model: 'Model Q', year: '1900' })) === '{}', 'cleanCarModel: an unlisted model with no make is dropped');
ok(mod.cleanCarModel({ model: 'Hyundai Ioniq 5 N', year: '2024' }).model === 'Hyundai Ioniq 5 N', 'cleanCarModel: the listed models work with no make');
let cm = mod.cleanCarModel({ make: 'Ducati', model: 'Panigale V4', vehicleType: 'bike' });
ok(cm.make === 'Ducati' && cm.model === 'Panigale V4' && cm.vehicleType === 'bike', 'cleanCarModel: a bike keeps its make, typed model and type');
cm = mod.cleanCarModel({ model: 'EV6 GT' }, 'Kia');
ok(cm.model === 'EV6 GT' && cm.make === undefined, 'cleanCarModel: a typed model is kept when the car already has a make');
cm = mod.cleanCarModel({ make: '', model: 'EV6 GT' }, 'Kia');
ok(cm.model === undefined && cm.make === undefined, 'cleanCarModel: clearing the make drops an unlisted model');
ok(mod.cleanCarModel({ vehicleType: 'boat' }).vehicleType === undefined, 'cleanCarModel: a vehicle type is car or bike');
ok(mod.cleanCarModel({ make: 'Kia', model: 'x'.repeat(200) }).model.length === 50, 'cleanCarModel: a typed model is cut to 50 characters');

// ---- The vehicle lists: the file is the start, the admin's changes sit on top in one key ----
r = await call('GET', '/vehicles');
ok(r.status === 200 && r.body.success && Object.keys(r.body.extra).length === 0, 'no vehicle changes to begin with');
r = await call('PUT', '/vehicles/admin?key=wrong', { library: { makes: [] } });
ok(r.status === 401, 'vehicle changes need the admin key');
r = await call('GET', '/vehicles/admin');
ok(r.status === 401, 'so does reading them as the admin');
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [
  { name: 'BMW', type: 'car', models: ['M3', 'm3', ' i4 M50 '] }, { name: 'BMW', type: 'bike', models: ['S 1000 RR'] }, { name: 'bmw', type: 'car', models: ['dupe'] },
  { name: 'Tesla', type: 'car', removed: true }, { name: '', type: 'car' }, { name: 'Zero', type: 'boat', models: ['SR/S'] }] } });
const makes = (r.body.extra || {}).makes || [];
ok(r.status === 200 && makes.length === 4, 'a make can be both a car and a bike; a repeat and a blank one are dropped');
ok(makes[0].name === 'BMW' && makes[0].type === 'car' && JSON.stringify(makes[0].models) === '["M3","i4 M50"]', 'models are trimmed and not repeated');
ok(makes[1].type === 'bike' && makes[2].removed === true && makes[3].type === 'car', 'a make can be taken off, and an unknown type counts as a car');
r = await call('GET', '/vehicles');
ok(r.body.extra.makes.length === 4, 'the changes are served to everyone');

// ---- js/vehicle-data.js ----
const base = { makes: [
  { name: 'Tesla', type: 'car', models: ['Model 3', 'Model Y'] }, { name: 'BMW', type: 'car', models: ['M3'] }, { name: 'BMW', type: 'bike', models: ['S 1000 RR'] }, { name: 'Ducati', type: 'bike', models: ['Monster'] }] };
let m = V.merge(base, { makes: [] });
ok(Object.keys(m.car).join() === 'BMW,Tesla' && Object.keys(m.bike).join() === 'BMW,Ducati', 'merge: cars and bikes are kept apart, in order, and BMW is both');
m = V.merge(base, { makes: [{ name: 'Tesla', type: 'car', removed: true }, { name: 'BMW', type: 'bike', models: ['M 1000 RR'] }, { name: 'Kia', type: 'car', models: ['EV6'] }] });
ok(!m.car.Tesla && m.car.BMW[0] === 'M3' && m.bike.BMW[0] === 'M 1000 RR' && m.car.Kia[0] === 'EV6', 'merge: a make is taken off or replaced by name and type, or added');
ok(V.title({ model: 'Model 3' }) === 'Model 3' && V.title({ model: 'Hyundai Ioniq 5 N' }) === 'Hyundai Ioniq 5 N', 'title: a car with no make shows its model, as before');
ok(V.title({ make: 'Kia', model: 'EV6 GT' }) === 'Kia EV6 GT' && V.title({ make: 'Hyundai', model: 'Hyundai Ioniq 5 N' }) === 'Hyundai Ioniq 5 N', 'title: the make goes in front, unless the model starts with it');
ok(V.title({ make: 'Ducati' }) === 'Ducati', 'title: a make alone is shown');
ok(V.modelKey({ make: 'Tesla', model: 'Model 3' }) === 'Model 3' && V.modelKey({ model: 'Model 3' }) === 'Model 3' && V.modelKey({ make: 'Porsche', model: 'Taycan' }) === 'Porsche Taycan', 'modelKey: Tesla models match the leaderboard chips as before');
