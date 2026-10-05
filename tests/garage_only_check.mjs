// Run by tests/test_garage_only.py: a car of another make, kept in the member's garage, through the real worker
// with a fake KV store and photo bucket. Its photos stay out of the Gallery, the Reel and Build of the Week, and
// only MT3UK can show it. WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const bucket = new Map();
const sent = [];
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
  SEND_EMAIL: { send: async m => { sent.push(m.raw); } }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const A = 'a@example.com';
kv.set('my-builds-session:tok-a', A);
kv.set('profile:' + A, JSON.stringify({ firstName: 'Rich', lastName: 'H', nickname: 'Rich' }));

const call = async (method, path, body, token) => {
  const init = { method, headers: {} };
  if (token) init.headers['X-Session-Token'] = token;
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const photo = name => new File([new Uint8Array([255, 216, 255, 0])], name, { type: 'image/jpeg' });
const sidecar = file => JSON.parse(bucket.get('gallery/' + file + '.json'));
const addCar = async fields => {
  const fd = new FormData();
  fd.set('email', A);
  Object.keys(fields).forEach(k => fd.set(k, fields[k]));
  fd.append('photo', photo('one.jpg'));
  fd.append('photo', photo('two.jpg'));
  return call('POST', '/', fd);
};
const garage = async () => (await call('GET', '/my-builds', undefined, 'tok-a')).body.cars || [];

// ---- A Tesla goes in the Gallery as before ----
let r = await addCar({ carName: 'Arctic Three', caption: 'Arctic three', color: 'White', model: 'Model 3' });
ok(r.body.success && r.body.carId, 'a Tesla is added');
const tesla = r.body.carId;
let cars = await garage();
let t = cars.find(c => c.id === tesla);
ok(t && t.garageOnly === false && t.photos.every(p => p.gallery && p.reel), 'a Tesla is in the Gallery and the Reel, as before');
ok(t.model === 'Model 3' && t.make === '', 'and keeps its model with no make');

// ---- Another make is kept in the garage ----
r = await addCar({ carName: 'Kit', caption: 'Kia ev6', color: 'Grey', model: 'EV6 GT', otherMake: '1', make: '', vehicleType: 'car' });
ok(r.status === 400 && /make/.test(r.body.message), 'another make needs a make');
r = await addCar({ carName: 'Kit', caption: 'Kia ev6', color: 'Grey', model: 'EV6 GT', otherMake: '1', make: 'Kia', vehicleType: 'car', year: '2023' });
ok(r.body.success && r.body.carId && !r.body.voteNote, 'a car of another make is added');
const kia = r.body.carId;
cars = await garage();
let k = cars.find(c => c.id === kia);
ok(k && k.garageOnly === true && k.galleryAsked === false, 'it is kept in the garage');
ok(k.make === 'Kia' && k.model === 'EV6 GT' && k.vehicleType === 'car' && k.year === 2023, 'with its make, model, type and year');
ok(k.photos.length === 2 && k.photos.every(p => !p.gallery && !p.reel && !p.votable), 'its photos are not in the Gallery, the Reel or the vote');
const kFile = k.photos[0].file;
ok(sidecar(kFile).garageOnly === true, 'each photo is marked as kept in the garage');

// ---- Its photos cannot be switched on, but other details can change ----
r = await call('PUT', '/my-builds', { file: kFile, gallery: true }, 'tok-a');
ok(r.status === 403 && r.body.garageOnly, 'Gallery cannot be switched on');
r = await call('PUT', '/my-builds', { file: kFile, vote: 'enter' }, 'tok-a');
ok(r.status === 403, 'nor can it be entered in Build of the Week');
r = await call('PUT', '/my-builds', { file: kFile, mods: ['Coilovers'] }, 'tok-a');
ok(r.status === 200 && JSON.stringify(sidecar(kFile).mods) === '["Coilovers"]', 'its mods can still change, with everything off');

// ---- A new photo of it stays private, whatever is sent ----
let fd = new FormData();
fd.set('caption', 'side'); fd.set('carId', kia); fd.set('gallery', '1'); fd.set('reel', '1'); fd.set('votable', '1');
fd.append('photo', photo('three.jpg'));
r = await call('POST', '/my-builds/upload', fd, 'tok-a');
ok(r.body.success, 'a photo can be added to it');
cars = await garage();
k = cars.find(c => c.id === kia);
ok(k.photos.length === 3 && k.photos.every(p => !p.gallery && !p.reel && !p.votable), 'and it stays out of the Gallery, the Reel and the vote');

// ---- Moving photos never crosses between the garage and the Gallery ----
const tFile = t.photos[0].file;
r = await call('PUT', '/my-builds/photo/move', { file: kFile, targetCarId: tesla }, 'tok-a');
ok(r.status === 400, 'a garage photo cannot move into a car in the Gallery');
r = await call('PUT', '/my-builds/photo/move', { file: tFile, targetCarId: kia }, 'tok-a');
ok(r.status === 400, 'a Gallery photo cannot move into a car kept in the garage');
r = await call('PUT', '/my-builds/photo/move', { file: kFile, targetCarId: 'new', newCarName: 'Spare' }, 'tok-a');
ok(r.status === 200 && JSON.parse(bucket.get('gallery/cars/' + r.body.carId + '.json')).garageOnly === true, 'a garage photo moved to a new car makes a car kept in the garage');

// ---- Asking to show it, and MT3UK deciding ----
r = await call('POST', '/my-builds/car/gallery-request', { carId: tesla }, 'tok-a');
ok(r.status === 400, 'a car already in the Gallery cannot ask');
r = await call('POST', '/my-builds/car/gallery-request', { carId: kia }, 'tok-b');
ok(r.status === 401, 'asking needs the owner signed in');
sent.length = 0;
r = await call('POST', '/my-builds/car/gallery-request', { carId: kia, note: 'Track build' }, 'tok-a');
ok(r.body.success && r.body.asked, 'the owner can ask for it to be shown');
ok(sent.length === 1 && /Gallery request/.test(sent[0]) && /Kit/.test(sent[0]), 'MT3UK is emailed');
r = await call('POST', '/my-builds/car/gallery-request', { carId: kia }, 'tok-a');
ok(r.body.success && JSON.parse(kv.get('garage-gallery-requests')).pending.length === 1, 'asking twice keeps one request');
cars = await garage();
ok(cars.find(c => c.id === kia).galleryAsked === true, 'My Garage shows it has been asked');
r = await call('GET', '/my-builds/admin/garage-gallery');
ok(r.status === 401, 'the requests need the admin key');
r = await call('GET', '/my-builds/admin/garage-gallery?key=secret');
ok(r.body.pending.length === 1 && r.body.pending[0].title === 'Kia EV6 GT' && r.body.pending[0].note === 'Track build' && r.body.pending[0].photos.length >= 1, 'the admin sees the car, its make and model, the note and its photos');
sent.length = 0;
r = await call('POST', '/my-builds/admin/garage-gallery?key=secret', { carId: kia, action: 'approve' });
ok(r.body.success && r.body.pending.length === 0, 'approving takes it off the list');
cars = await garage();
k = cars.find(c => c.id === kia);
ok(k.garageOnly === false && k.photos.every(p => p.gallery && p.reel && !p.votable), 'approved: its photos are in the Gallery and the Reel, Voting stays off');
ok(k.photos.every(p => sidecar(p.file).garageOnly === undefined), 'and its photos are no longer marked');
ok(sent.length === 1 && /is now shown in the MT3UK Gallery/.test(sent[0]), 'the owner is emailed');
r = await call('PUT', '/my-builds', { file: k.photos[0].file, vote: 'enter' }, 'tok-a');
ok(r.status === 200, 'the owner can now enter a photo in Build of the Week');

// ---- Declining ----
r = await addCar({ carName: 'Bike', caption: 'ducati', color: 'Red', model: 'Panigale V4', otherMake: '1', make: 'Ducati', vehicleType: 'bike' });
const bike = r.body.carId;
await call('POST', '/my-builds/car/gallery-request', { carId: bike }, 'tok-a');
sent.length = 0;
r = await call('POST', '/my-builds/admin/garage-gallery?key=secret', { carId: bike, action: 'decline' });
cars = await garage();
const b = cars.find(c => c.id === bike);
ok(r.body.success && b.garageOnly === true && b.galleryAsked === false && b.vehicleType === 'bike', 'declined: it stays in the garage, and can be asked about again');
ok(sent.length === 1 && /stays in your garage/.test(sent[0]), 'the owner is emailed');
r = await call('POST', '/my-builds/admin/garage-gallery?key=secret', { carId: bike, action: 'approve' });
ok(r.status === 404, 'a request that is not waiting cannot be decided');

// ---- The Ioniq and Taycan are other makes too ----
r = await addCar({ carName: 'Grey T', caption: 'taycan', color: 'Grey', model: 'Porsche Taycan', version: 'Turbo S', year: '2022' });
const tay = r.body.carId;
cars = await garage();
const ty = cars.find(c => c.id === tay);
ok(ty.garageOnly === true && ty.photos.every(p => !p.gallery && !p.reel && !p.votable), 'a Taycan from its own chip is kept in the garage');
ok(ty.make === 'Porsche' && ty.model === 'Porsche Taycan' && ty.version === 'Turbo S' && ty.vehicleType === 'car', 'with its make filled in and its version kept');

// ---- An Ioniq added before only Teslas went in, still in the Gallery ----
bucket.set('gallery/ioniq.jpg', 'binary');
await mod.putSidecar(env, 'gallery/ioniq.jpg.json', { email: A, carId: 'old5n' });
await mod.saveCarRecord(env, { id: 'old5n', name: 'Blue N', photos: ['ioniq.jpg'], mods: [] });
kv.set('car-details:old5n', JSON.stringify({ model: 'Hyundai Ioniq 5 N', version: 'Ioniq 5 N' }));
kv.set('votes:2099-W01:ioniq.jpg', '3');
r = await call('GET', '/my-builds/admin/other-makes');
ok(r.status === 401, 'the list of other makes needs the admin key');
r = await call('GET', '/my-builds/admin/other-makes?key=secret');
ok(r.body.success && r.body.cars.length === 1 && r.body.cars[0].carId === 'old5n' && r.body.cars[0].title === 'Hyundai Ioniq 5 N' && r.body.cars[0].email === A,
  'it lists only an other make still in the Gallery (not the Tesla, the approved Kia or the cars already kept in the garage)');
sent.length = 0;
r = await call('POST', '/my-builds/admin/other-makes?key=secret', { carId: 'old5n', action: 'garage', email: true });
ok(r.body.success, 'it can be kept in the garage');
cars = await garage();
const n = cars.find(c => c.id === 'old5n');
ok(n.garageOnly === true && n.photos.every(p => !p.gallery && !p.reel && !p.votable) && n.make === 'Hyundai' && n.vehicleType === 'car', 'it leaves the Gallery, the Reel and the vote, and gets its make');
ok(sidecar('ioniq.jpg').garageOnly === true, 'its photos are marked');
ok(sent.length === 1 && /kept in your garage/.test(sent[0]), 'the owner is emailed');
r = await call('GET', '/my-builds/admin/other-makes?key=secret');
ok(r.body.cars.length === 0, 'and it is off the list');
r = await call('POST', '/my-builds/admin/other-makes?key=secret', { carId: 'nope', action: 'garage' });
ok(r.status === 404, 'an unknown car is refused');
// With Email the owner off, the car is kept in the garage and nobody is emailed.
bucket.set('gallery/taycan-old.jpg', 'binary');
await mod.putSidecar(env, 'gallery/taycan-old.jpg.json', { email: A, carId: 'oldtay' });
await mod.saveCarRecord(env, { id: 'oldtay', name: 'White T', photos: ['taycan-old.jpg'], mods: [] });
kv.set('car-details:oldtay', JSON.stringify({ model: 'Porsche Taycan' }));
sent.length = 0;
r = await call('POST', '/my-builds/admin/other-makes?key=secret', { carId: 'oldtay', action: 'garage', email: false });
ok(r.body.success && sidecar('taycan-old.jpg').garageOnly === true && sent.length === 0, 'with the email switched off it is kept in the garage and the owner is not emailed');

// ---- A car whose record's list of photos has fallen behind (as an older car's can) ----
r = await addCar({ carName: 'Stale', caption: 'stale ioniq', color: 'White', model: 'Hyundai Ioniq 5 N', version: 'Ioniq 5 N' });
const stale = r.body.carId;
const staleRec = JSON.parse(bucket.get('gallery/cars/' + stale + '.json'));
const staleFiles = staleRec.photos.slice();
bucket.set('gallery/cars/' + stale + '.json', JSON.stringify(Object.assign({}, staleRec, { photos: [] })));
cars = await garage();
ok(cars.some(c => c.id === stale && c.garageOnly), 'My Garage still shows the car as the member\'s (its photos name it)');
r = await call('POST', '/my-builds/car/gallery-request', { carId: stale }, 'tok-a');
ok(r.body.success && r.body.asked, 'so asking to show it works too');
ok(JSON.stringify(JSON.parse(bucket.get('gallery/cars/' + stale + '.json')).photos.sort()) === JSON.stringify(staleFiles.slice().sort()), 'and the record\'s list of photos is brought up to date');
// The record falls behind again before MT3UK decides: approving still shows every photo.
bucket.set('gallery/cars/' + stale + '.json', JSON.stringify(Object.assign({}, JSON.parse(bucket.get('gallery/cars/' + stale + '.json')), { photos: [] })));
r = await call('POST', '/my-builds/admin/garage-gallery?key=secret', { carId: stale, action: 'approve' });
ok(r.body.success && staleFiles.every(f => sidecar(f).gallery === undefined && sidecar(f).garageOnly === undefined), 'approving shows every photo of the car, whatever its record lists');
// Removing a car from public view also finds every photo, and Find them lists a car whose record lists none.
bucket.set('gallery/cars/' + stale + '.json', JSON.stringify(Object.assign({}, JSON.parse(bucket.get('gallery/cars/' + stale + '.json')), { photos: [], galleryApproved: undefined })));
r = await call('GET', '/my-builds/admin/other-makes?key=secret');
ok(r.body.cars.some(c => c.carId === stale && c.photos.length === staleFiles.length && c.email === A), 'Find them lists a car whose record lists no photos, with its photos and owner');
r = await call('POST', '/my-builds/admin/other-makes?key=secret', { carId: stale, action: 'garage', email: false });
ok(r.body.success && staleFiles.every(f => sidecar(f).gallery === false && sidecar(f).reel === false && sidecar(f).garageOnly === true), 'removing it from public view hides every photo of the car');
// Someone else's car is still refused.
kv.set('my-builds-session:tok-b', 'b@example.com');
r = await call('POST', '/my-builds/car/gallery-request', { carId: kia }, 'tok-b');
ok(r.status === 403, 'another member cannot ask about my car');
r = await call('POST', '/my-builds/car/gallery-request', { carId: 'not a car' }, 'tok-a');
ok(r.status === 403, 'nor about a car id that is not one');

// ---- A record that lists a photo which has since gone (the 5 N case) ----
r = await addCar({ carName: 'Ghost', caption: 'ghost ioniq', color: 'White', model: 'Hyundai Ioniq 5 N' });
const ghost = r.body.carId;
const ghostRec = JSON.parse(bucket.get('gallery/cars/' + ghost + '.json'));
const realFile = ghostRec.photos[0];
bucket.set('gallery/cars/' + ghost + '.json', JSON.stringify(Object.assign({}, ghostRec, { photos: ['deleted-long-ago.jpg'] })));
r = await call('POST', '/my-builds/car/gallery-request', { carId: ghost }, 'tok-a');
const ghostAsk = JSON.parse(kv.get('garage-gallery-requests')).pending.find(p => p.carId === ghost);
ok(r.body.success && ghostAsk && ghostAsk.photos.indexOf('deleted-long-ago.jpg') === -1 && ghostAsk.photos.indexOf(realFile) !== -1, 'asking drops a photo the record still lists but which has gone, and keeps the real ones');
ok(JSON.parse(bucket.get('gallery/cars/' + ghost + '.json')).photos.indexOf('deleted-long-ago.jpg') === -1, 'the record no longer lists it');
bucket.set('gallery/cars/' + ghost + '.json', JSON.stringify(Object.assign({}, JSON.parse(bucket.get('gallery/cars/' + ghost + '.json')), { photos: ['deleted-long-ago.jpg', realFile] })));
r = await call('POST', '/my-builds/admin/garage-gallery?key=secret', { carId: ghost, action: 'approve' });
ok(r.body.success && JSON.parse(bucket.get('gallery/cars/' + ghost + '.json')).photos.slice().sort().join() === ghostRec.photos.slice().sort().join(), 'approving keeps only the photos that exist');
