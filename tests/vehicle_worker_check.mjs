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
  VOTES: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) },
  GALLERY_BUCKET: {
    get: async k => bucket.has(k) ? { json: async () => JSON.parse(bucket.get(k)) } : null,
    put: async (k, v) => { bucket.set(k, typeof v === 'string' ? v : 'binary'); },
    delete: async k => { bucket.delete(k); },
    // The live photo listing the garage reads.
    list: async ({ prefix = '' } = {}) => ({ objects: [...bucket.keys()].filter(k => k.startsWith(prefix) && (prefix.indexOf('/cars/') !== -1 || k.indexOf('/cars/') === -1)).map(key => ({ key, uploaded: new Date('2026-01-01T00:00:00Z') })), truncated: false })
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

// ---- Driven wheels by model: kept in the library, set through /track/admin/drive, never wiped by a makes save ----
r = await call('POST', '/track/admin/drive?key=secret', { make: 'BMW', model: 'M3', drive: 'AWD' });
ok(r.status === 200 && r.body.success && r.body.key === 'bmw|m3' && r.body.drive === 'AWD' && r.body.vehicles === 0, 'the admin sets a default for a model (no vehicle with sessions here)');
r = await call('POST', '/track/admin/drive?key=secret', { make: 'Kia', model: 'EV6', drive: 'sideways' });
ok(r.body.success && r.body.drive === '', 'a value that is not FWD, RWD or AWD clears it');
r = await call('POST', '/track/admin/drive?key=secret', { make: '', model: 'M3', drive: 'AWD' });
ok(r.status === 400, 'a make and a model are needed');
r = await call('GET', '/vehicles');
ok(JSON.stringify(r.body.extra.drives) === '{"bmw|m3":"AWD"}' && r.body.extra.makes.length === 4, 'the default is served with the library');
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [{ name: 'Kia', type: 'car', models: ['EV6'] }] } });
ok(r.body.extra.drives['bmw|m3'] === 'AWD' && r.body.extra.makes.length === 1, 'a makes save that does not carry the defaults keeps them');
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], drives: { 'BMW|M3': 'RWD', 'kia|ev6': 'AWD', 'bad': 'AWD', 'tesla|model 3': 'up' } } });
ok(JSON.stringify(r.body.extra.drives) === '{"bmw|m3":"RWD","kia|ev6":"AWD"}', 'a save that carries them replaces them, keys lowercased and bad ones dropped');
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], drives: { 'Hyundai|Ioniq 5|N Line': 'AWD', 'a|b|c|d': 'AWD', 'hyundai|ioniq 5|x': 'up' } } });
ok(JSON.stringify(r.body.extra.drives) === '{"hyundai|ioniq 5|n line":"AWD"}', 'a variant\'s own driven wheels (make|model|version) are kept, with four parts or a bad value dropped');
// A car with sessions, a Hyundai Ioniq 5 N Line: saving the variant's wheels re-stamps its session.
await mod.saveCarRecord(env, { id: 'carh', name: 'Blue Five', photos: ['h1.jpg'], mods: [] });
await mod.putSidecar(env, 'gallery/h1.jpg.json', { email: A, carId: 'carh' });
bucket.set('gallery/h1.jpg', 'binary');
kv.set('car-details:carh', JSON.stringify({ make: 'Hyundai', model: 'Ioniq 5', version: 'N Line' }));
const oKeyH = 'track-index:' + (await mod.ownerKey(A));
kv.set(oKeyH, JSON.stringify([{ id: 'sh1', carId: 'carh' }]));
await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], drives: {} } });
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], drives: { 'hyundai|ioniq 5|n line': 'AWD' } } });
ok(r.status === 200 && r.body.restamped.vehicles === 1 && r.body.restamped.stamped === 1 && JSON.parse(kv.get(oKeyH))[0].drive === 'AWD', 'saving a variant\'s wheels re-stamps the sessions of the cars it reaches');
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [{ name: 'Kia', type: 'car', models: ['EV6'] }], drives: { 'hyundai|ioniq 5|n line': 'AWD' } } });
ok(r.body.restamped.vehicles === 0, 'a save that changes no wheels re-stamps nothing');
kv.set('car-details:carh', JSON.stringify({ make: 'Hyundai', model: 'Ioniq 5', version: 'N Line', drive: 'FWD' }));
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], drives: { 'hyundai|ioniq 5|n line': 'RWD' } } });
ok(r.body.restamped.vehicles === 0, 'a car whose wheels the owner set by hand is left alone');
kv.delete('car-details:carh'); kv.delete(oKeyH); bucket.delete('gallery/cars/carh.json'); bucket.delete('gallery/h1.jpg'); bucket.delete('gallery/h1.jpg.json');
await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], drives: {} } });
// ---- Kerb weights ----
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], weights: { 'Tesla|Model 3': 1847.6, 'tesla|model 3|performance': '1919', 'kia|ev6': 50, 'bad': 1800, 'a|b|c|d': 1800 } } });
ok(JSON.stringify(r.body.extra.weights) === '{"tesla|model 3":1848,"tesla|model 3|performance":1919}', 'kerb weights kept by model or variant, lowercased, sensible ones only: ' + JSON.stringify(r.body.extra.weights));
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [{ name: 'Kia', type: 'car', models: ['EV6'] }] } });
ok(r.body.extra.weights['tesla|model 3'] === 1848, 'a save that does not carry the weights keeps them');
r = await call('GET', '/vehicles');
ok(r.body.extra.weights['tesla|model 3|performance'] === 1919, 'and they are served with the library');
await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], weights: {} } });
// ---- Variants (versions) by model ----
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [
  { name: 'Kia', type: 'car', models: ['EV6', 'EV9'], versions: { EV6: [' GT-Line ', 'GT-Line', 'gt-line', ''], Nope: ['x'], EV9: 'Air' } }] } });
ok(JSON.stringify(r.body.extra.makes[0].versions) === '{"EV6":["GT-Line"]}', 'each model\'s variants are kept, trimmed and not repeated, and a list that is not a list is dropped');
r = await call('GET', '/vehicles');
ok(r.body.extra.makes[0].versions.EV6[0] === 'GT-Line', 'the variants are served with the library');
let mv = V.merge({ makes: [{ name: 'Tesla', type: 'car', models: ['Model 3'], versions: { 'Model 3': ['Performance'] } }, { name: 'Kia', type: 'car', models: ['EV6'] }] }, r.body.extra);
ok(mv.versions.car.Tesla['Model 3'][0] === 'Performance' && mv.versions.car.Kia.EV6[0] === 'GT-Line', 'merge: the variants come from the file and the admin\'s changes');
V.versions = mv.versions;
ok(V.versionsFor({ model: 'Model 3' })[0] === 'Performance' && V.versionsFor({ make: 'Kia', model: 'Kia EV6' })[0] === 'GT-Line' && V.versionsFor({ make: 'Kia', model: 'EV9' }).length === 0, 'versionsFor: by make and model, a make inside the model, and none for a model without any');
// ---- The Version box rule by model: required, free text ----
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [
  { name: 'Kia', type: 'car', models: ['EV6', 'EV9'], versions: { EV6: ['GT-Line'] }, versionRules: { EV6: { required: true, free: 'yes' }, EV9: { required: false }, Nope: { free: true } } }] } });
ok(JSON.stringify(r.body.extra.makes[0].versionRules) === '{"EV6":{"required":true}}', 'each model\'s Version rule is kept, only when set, and only true counts');
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [{ name: 'Kia', type: 'car', models: ['EV6'], versions: { EV6: ['GT-Line'] } }] } });
ok(r.body.extra.makes[0].versionRules === undefined, 'a make saved without rules carries none (so the file\'s stand)');
mv = V.merge({ makes: [{ name: 'Tesla', type: 'car', models: ['Model 3'], versionRules: { 'Model 3': { free: true } } }, { name: 'Kia', type: 'car', models: ['EV6', 'EV9'], versionRules: { EV6: { required: true }, EV9: { required: true } } }] },
  { makes: [{ name: 'Kia', type: 'car', models: ['EV6', 'EV9'], versionRules: { EV9: { free: true } } }] });
V.versionRules = mv.versionRules;
ok(V.versionRule({ model: 'Model 3' }).free === true && V.versionRule({ model: 'Model 3' }).required === false && V.versionRule({ make: 'Kia', model: 'EV6' }).required === false && V.versionRule({ make: 'Kia', model: 'Kia EV9' }).free === true && V.versionRule({ make: 'Kia', model: 'EV9' }).required === false, 'versionRule: the file\'s rules, replaced by the admin\'s for a make saved with any, and both off unless set');
await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [{ name: 'Kia', type: 'car', models: ['EV6', 'EV9'], versions: { EV6: ['GT-Line'] } }] } });
kv.set('car-details:cara1', JSON.stringify({ make: 'Kia', model: 'EV6' }));
r = await call('GET', '/my-builds', undefined, 'tok-a');
ok(r.body.cars[0].drive === 'RWD' && r.body.cars[0].driveSet === false, 'a Kia EV6 is RWD by the rule');
await call('POST', '/track/admin/drive?key=secret', { make: 'Kia', model: 'EV6', drive: 'AWD' });
r = await call('GET', '/my-builds', undefined, 'tok-a');
ok(r.body.cars[0].drive === 'AWD' && r.body.cars[0].driveSet === false, 'with a default for the model, My Garage shows it (not as set by hand)');
kv.set('car-details:cara1', JSON.stringify({ make: 'Kia', model: 'EV6', version: 'RWD Long Range' }));
r = await call('GET', '/my-builds', undefined, 'tok-a');
ok(r.body.cars[0].drive === 'RWD', 'a version that says otherwise still wins over the default');
kv.set('car-details:cara1', JSON.stringify({ make: 'Kia', model: 'EV6', drive: 'FWD' }));
r = await call('GET', '/my-builds', undefined, 'tok-a');
ok(r.body.cars[0].drive === 'FWD' && r.body.cars[0].driveSet === true, 'and a car set by hand keeps its own');
await call('POST', '/track/admin/drive?key=secret', { make: 'Kia', model: 'EV6', drive: '' });
kv.set('car-details:cara1', JSON.stringify({ model: 'Model Y', version: 'Long Range AWD', year: 2022 }));

// ---- Members' cars: the admin lists every car with its settings and changes them ----
r = await call('GET', '/track/admin/cars');
ok(r.status === 401, 'the members\' cars list needs the admin key');
r = await call('GET', '/track/admin/cars?key=secret');
let ac = (r.body.cars || []).find(c => c.carId === 'cara1');
ok(r.status === 200 && ac && ac.car === 'Arctic Three' && ac.email === A && ac.owner && ac.model === 'Model Y' && ac.version === 'Long Range AWD' && ac.year === 2022 && ac.drive === 'AWD' && ac.set === false && ac.photos === 1 && ac.vehicleType === 'car', 'it lists the car with its owner and settings');
r = await call('POST', '/track/admin/cars?key=secret', { carId: 'cara1', make: '', model: 'Model Q', version: 'Plaid', year: '2021', vehicleType: 'car', drive: 'RWD' });
ok(r.status === 200 && r.body.car.model === 'Model Q' && r.body.car.version === 'Plaid' && r.body.car.year === 2021 && r.body.car.drive === 'RWD' && r.body.car.set === true, 'the admin can set any model, the version, year and driven wheels');
ok(JSON.parse(kv.get('car-details:cara1')).model === 'Model Q' && JSON.parse(kv.get('car-details:cara1')).drive === 'RWD', 'and they are saved to the car');
r = await call('POST', '/track/admin/cars?key=secret', { carId: 'cara1', drive: '' });
ok(r.status === 200 && r.body.car.set === false && r.body.car.model === 'Model Q', 'only the settings sent change; clearing the driven wheels goes back to the model\'s');
r = await call('POST', '/track/admin/cars?key=secret', { carId: 'nope', model: 'x' });
ok(r.status === 404, 'a car that does not exist is refused');
// A stale record: its photos are gone, so no owner, no live photo and no sessions.
await mod.saveCarRecord(env, { id: 'carz', name: 'Old Project', photos: ['gone.jpg'], mods: [] });
r = await call('GET', '/track/admin/cars?key=secret');
let stale = r.body.cars.find(c => c.carId === 'carz'), liveRow = r.body.cars.find(c => c.carId === 'cara1');
ok(stale && stale.stale === true && stale.photos === 1 && stale.livePhotos === 0 && liveRow.stale === false && liveRow.livePhotos === 1, 'a record whose photos are gone is marked stale; a live car is not');
r = await call('POST', '/track/admin/cars?key=secret', { carId: 'cara1', action: 'remove' });
ok(r.status === 400, 'a live car cannot be removed this way');
r = await call('POST', '/track/admin/cars?key=secret', { carId: 'carz', action: 'remove' });
ok(r.status === 200 && r.body.removed === 'carz' && !bucket.has('gallery/cars/carz.json'), 'a stale record is removed');
kv.set('car-details:cara1', JSON.stringify({ model: 'Model Y', version: 'Long Range AWD', year: 2022 }));

// ---- Hidden makes: kept in the library, never wiped by a save that does not carry them ----
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], hiddenMakes: [{ name: ' Kia ', type: 'car' }, { name: 'kia', type: 'car' }, { name: 'Ducati', type: 'bike' }, { name: '', type: 'car' }, { name: 'Zero', type: 'boat' }] } });
ok(JSON.stringify(r.body.extra.hiddenMakes) === '[{"name":"Kia","type":"car"},{"name":"Ducati","type":"bike"},{"name":"Zero","type":"car"}]', 'hidden makes are kept trimmed, once each, with a blank one dropped and an unknown type counting as a car');
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [{ name: 'Kia', type: 'car', models: ['EV6'] }] } });
ok(r.body.extra.hiddenMakes.length === 3 && r.body.extra.makes.length === 1, 'a save that does not carry the hidden makes keeps them');
r = await call('GET', '/vehicles');
ok(r.body.extra.hiddenMakes.length === 3, 'the hidden makes are served with the library');
r = await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], hiddenMakes: [] } });
ok(r.body.extra.hiddenMakes.length === 0, 'a save that carries an empty list shows them all again');
await call('PUT', '/vehicles/admin?key=secret', { library: { makes: [], drives: {} } });

// ---- js/vehicle-data.js ----
const base = { makes: [
  { name: 'Tesla', type: 'car', models: ['Model 3', 'Model Y'] }, { name: 'BMW', type: 'car', models: ['M3'] }, { name: 'BMW', type: 'bike', models: ['S 1000 RR'] }, { name: 'Ducati', type: 'bike', models: ['Monster'] }] };
let m = V.merge(base, { makes: [] });
ok(Object.keys(m.car).join() === 'BMW,Tesla' && Object.keys(m.bike).join() === 'BMW,Ducati', 'merge: cars and bikes are kept apart, in order, and BMW is both');
m = V.merge(base, { makes: [{ name: 'Tesla', type: 'car', removed: true }, { name: 'BMW', type: 'bike', models: ['M 1000 RR'] }, { name: 'Kia', type: 'car', models: ['EV6'] }] });
ok(!m.car.Tesla && m.car.BMW[0] === 'M3' && m.bike.BMW[0] === 'M 1000 RR' && m.car.Kia[0] === 'EV6', 'merge: a make is taken off or replaced by name and type, or added');
const hideBase = { makes: [{ name: 'Kia', type: 'car', models: ['EV6'], versions: { EV6: ['GT'] } }, { name: 'Tesla', type: 'car', models: ['Model 3'] }, { name: 'Ducati', type: 'bike', models: ['Monster'] }] };
let hm = V.merge(hideBase, { hiddenMakes: [{ name: 'kia', type: 'car' }, { name: 'Ducati', type: 'car' }] });
ok(!hm.car.Kia && hm.car.Tesla && hm.bike.Ducati && !hm.versions.car.Kia && hm.hidden.car.Kia === true, 'merge: a hidden make is left out of the lists members pick from, whatever the case, and only for its own type');
hm = V.merge(hideBase, { hiddenMakes: [{ name: 'Kia', type: 'car' }] }, { all: true });
ok(hm.car.Kia[0] === 'EV6' && hm.versions.car.Kia.EV6[0] === 'GT' && hm.hidden.car.Kia === true && !hm.hidden.car.Tesla, 'merge with all: the panel still sees it, with its models and variants, marked hidden');
ok(V.title({ model: 'Model 3' }) === 'Model 3' && V.title({ model: 'Hyundai Ioniq 5 N' }) === 'Hyundai Ioniq 5 N', 'title: a car with no make shows its model, as before');
ok(V.title({ make: 'Kia', model: 'EV6 GT' }) === 'Kia EV6 GT' && V.title({ make: 'Hyundai', model: 'Hyundai Ioniq 5 N' }) === 'Hyundai Ioniq 5 N', 'title: the make goes in front, unless the model starts with it');
ok(V.title({ make: 'Ducati' }) === 'Ducati', 'title: a make alone is shown');
ok(V.modelKey({ car: 'DEVIANT MODEL S' }) === 'Model S' && V.modelKey({ car: 'Deviant', model: 'Model 3' }) === 'Model 3' && V.modelKey({ car: 'My model 3' , make: 'Kia', model: 'EV6' }) === 'Kia EV6' && V.modelInName('model y, the daily') === 'Model Y' && V.modelInName('Modelling car') === '', 'modelKey: a car with no make or model takes the Tesla model its name gives away');
ok(V.modelKey({ make: 'Tesla', model: 'Model 3' }) === 'Model 3' && V.modelKey({ model: 'Model 3' }) === 'Model 3' && V.modelKey({ make: 'Porsche', model: 'Taycan' }) === 'Porsche Taycan', 'modelKey: Tesla models match the leaderboard chips as before');

// ---- Driven wheels: the page's rule and the worker's agree, and know the cars ----
const DRIVE_CASES = [
  [{ model: 'Model 3', version: 'Performance' }, 'AWD'], [{ model: 'Model 3', version: 'Long Range RWD' }, 'RWD'], [{ model: 'Model 3', version: 'Highland Long Range AWD' }, 'AWD'],
  [{ model: 'Model 3', version: 'Standard Range Plus' }, 'RWD'], [{ model: 'Model 3', version: 'Rear-Wheel Drive' }, 'RWD'], [{ model: 'Model 3' }, ''],
  [{ make: 'Tesla', model: 'Model Y', version: 'Juniper Performance' }, 'AWD'], [{ model: 'Model Y', version: 'Juniper Rear-Wheel Drive' }, 'RWD'],
  [{ model: 'Model S', version: 'P85D' }, 'AWD'], [{ model: 'Model S', version: 'P85+' }, 'RWD'], [{ model: 'Model S', version: 'Plaid' }, 'AWD'], [{ model: 'Model X' }, 'AWD'],
  [{ model: 'Hyundai Ioniq 5 N' }, 'AWD'], [{ make: 'Hyundai', model: 'Hyundai Ioniq 5 N' }, 'AWD'], [{ make: 'Porsche', model: 'Porsche Taycan' }, 'RWD'], [{ make: 'Hyundai', model: 'Ioniq 6 N' }, 'AWD'], [{ make: 'Hyundai', model: 'Kona N' }, 'FWD'],
  [{ make: 'Hyundai', model: 'Ioniq 5', version: 'N 84 kWh AWD' }, 'AWD'], [{ make: 'Hyundai', model: 'Ioniq 6', version: 'N 84 kWh AWD' }, 'AWD'], [{ make: 'Hyundai', model: 'Ioniq 6', version: '53 kWh RWD' }, 'RWD'],
  [{ make: 'Hyundai', model: 'Ioniq 5', version: '84 kWh AWD' }, 'AWD'], [{ make: 'Hyundai', model: 'Ioniq 9', version: 'Long Range RWD' }, 'RWD'], [{ make: 'Hyundai', model: 'Ioniq 9', version: 'Performance AWD' }, 'AWD'],
  [{ make: 'Hyundai', model: 'i30 N', version: 'i30 N Performance' }, 'FWD'], [{ make: 'Hyundai', model: 'Kona Electric', version: '65 kWh' }, 'FWD'], [{ make: 'Hyundai', model: 'Inster' }, 'FWD'],
  [{ model: 'Porsche Taycan', version: 'Taycan' }, 'RWD'], [{ model: 'Porsche Taycan', version: '4S' }, 'AWD'], [{ make: 'Porsche', model: 'Taycan', version: 'Turbo S Cross Turismo' }, 'AWD'],
  [{ make: 'Porsche', model: '911', version: 'GT3' }, 'RWD'], [{ make: 'Porsche', model: '911', version: 'Carrera 4S' }, 'AWD'],
  [{ make: 'Kia', model: 'EV6 GT' }, 'AWD'], [{ make: 'Alpine', model: 'A290' }, 'FWD'], [{ make: 'Kia', model: 'EV6' }, 'RWD'], [{ make: 'BMW', model: 'M3', version: 'Competition xDrive' }, 'AWD'], [{ make: 'BMW', model: 'M2' }, 'RWD'],
  [{ make: 'Polestar', model: '2', version: 'Long range Single motor', year: 2022 }, 'FWD'], [{ make: 'Polestar', model: '2', version: 'Long range Single motor', year: 2024 }, 'RWD'], [{ make: 'Polestar', model: '2', version: 'Dual motor' }, 'AWD'],
  [{ make: 'Honda', model: 'Civic Type R' }, 'FWD'], [{ make: 'Honda', model: 'NSX', year: 2017 }, 'AWD'], [{ make: 'Honda', model: 'NSX', year: 1995 }, 'RWD'],
  [{ make: 'Ducati', model: 'Panigale V4', vehicleType: 'bike' }, ''], [{ make: 'Zeekr', model: '001 FR' }, ''], [{ make: 'Ford', model: 'Mustang Mach-E', version: 'AWD Extended Range' }, 'AWD'],
];
let agree = true, right = true;
DRIVE_CASES.forEach(([v, want]) => {
  const a = V.drive(v), b = mod.driveFor(v);
  if (a !== b) { agree = false; console.log('  differ', JSON.stringify(v), a, b); }
  if (a !== want) { right = false; console.log('  wrong', JSON.stringify(v), 'got', a, 'want', want); }
});
ok(agree, 'drive: the page and the worker give the same answer for every case');
ok(right, 'drive: FWD, RWD and AWD are right for ' + DRIVE_CASES.length + ' cars and versions');
const DEFAULTS = { 'tesla|model 3': 'RWD', 'porsche|taycan': 'AWD', 'porsche|911': 'AWD', 'zeekr|001 fr': 'AWD', 'ducati|panigale v4': 'AWD',
  'hyundai|ioniq 5|n line': 'AWD', 'hyundai|ioniq 5|84 kwh awd': 'RWD', 'hyundai|kona electric|n line': 'AWD', 'tesla|model y|standard range': 'AWD' };
const DEFAULT_CASES = [
  [{ model: 'Model 3' }, 'RWD'], [{ model: 'Model 3', version: 'Performance' }, 'AWD'], [{ model: 'Model 3 Long Range AWD' }, 'AWD'],
  [{ model: 'Porsche Taycan', version: 'Taycan' }, 'AWD'], [{ make: 'Porsche', model: 'Taycan 4S' }, 'AWD'], [{ make: 'Porsche', model: '911', version: 'GT3' }, 'AWD'], [{ make: 'Porsche', model: '911 Carrera 4S' }, 'AWD'],
  [{ make: 'Hyundai', model: 'Ioniq 5', version: 'N Line' }, 'AWD'], [{ make: 'Hyundai', model: 'Ioniq 5', version: '84 kWh AWD' }, 'RWD'], [{ make: 'Hyundai', model: 'Ioniq 5', version: '58 kWh RWD' }, 'RWD'],
  [{ make: 'Hyundai', model: 'Kona Electric', version: 'N Line' }, 'AWD'], [{ make: 'Hyundai', model: 'Kona Electric', version: '65 kWh' }, 'FWD'], [{ model: 'Model Y', version: 'Standard Range' }, 'AWD'],
  [{ make: 'Zeekr', model: '001 FR' }, 'AWD'], [{ make: 'Zeekr', model: '001 FR', version: 'RWD' }, 'RWD'], [{ make: 'Ducati', model: 'Panigale V4', vehicleType: 'bike' }, ''], [{ make: 'Kia', model: 'EV6' }, 'RWD'], [{ make: 'Kia', model: 'EV6', version: 'RWD Long Range' }, 'RWD'],
];
let agree2 = true, right2 = true;
DEFAULT_CASES.forEach(([v, want]) => {
  const a = V.drive(v, DEFAULTS), b = mod.carDrive(v, DEFAULTS);
  if (a !== b) { agree2 = false; console.log('  differ', JSON.stringify(v), a, b); }
  if (a !== want) { right2 = false; console.log('  wrong', JSON.stringify(v), 'got', a, 'want', want); }
});
ok(agree2, 'drive with defaults: the page and the worker agree');
ok(V.driveVariantKey({ make: 'Hyundai', model: 'Ioniq 5', version: ' N Line ' }) === 'hyundai|ioniq 5|n line' && V.driveVariantKey({ model: 'Model 3', version: 'Performance' }) === 'tesla|model 3|performance', 'driveVariantKey: a variant\'s key is make, model and version, lowercased');
ok(right2, 'drive with defaults: a default fills in or replaces the model\'s answer, a telling version still wins, a bike has none');
ok(V.driveKey({ model: 'Porsche Taycan 4S' }) === 'porsche|taycan' && mod.driveModelKey({ make: 'Kia', model: ' EV6 ' }) === 'kia|ev6', 'driveKey: a model\'s key drops the make inside it and a typed trim');
ok(mod.cleanCarModel({ drive: 'AWD', make: 'Kia', model: 'EV6' }, '').drive === 'AWD' && mod.cleanCarModel({ drive: 'sideways' }).drive === undefined, 'cleanCarModel: a drive is kept only when it is FWD, RWD or AWD');
