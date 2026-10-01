// Run by tests/test_photo_move_worker.py: My Garage "Move to another build"
// (PUT /my-builds/photo/move) in the real worker, with a fake KV store and
// photo bucket. Car records hold no email, so ownership comes from the
// member's own photos. WORKER_MODULE is a copy of the worker node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const bucket = new Map();
const env = {
  VOTES: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
  GALLERY_BUCKET: {
    get: async k => bucket.has(k) ? { json: async () => JSON.parse(bucket.get(k)) } : null,
    put: async (k, v) => { bucket.set(k, typeof v === 'string' ? v : 'binary'); },
    delete: async k => { bucket.delete(k); },
    list: async () => { throw new Error('list() used'); }
  }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const A = 'a@example.com', B = 'b@example.com';
kv.set('my-builds-session:tok-a', A);
kv.set('subscriber:' + A, JSON.stringify(['a1.jpg', 'a2.jpg', 'a3.jpg']));
kv.set('subscriber:' + B, JSON.stringify(['b1.jpg']));
await mod.putSidecar(env, 'gallery/a1.jpg.json', { email: A, carId: 'car1' });
await mod.putSidecar(env, 'gallery/a2.jpg.json', { email: A, carId: 'car1' });
await mod.putSidecar(env, 'gallery/a3.jpg.json', { email: A, carId: 'car2' });
await mod.putSidecar(env, 'gallery/b1.jpg.json', { email: B, carId: 'carb' });
await mod.saveCarRecord(env, { id: 'car1', name: 'Project 1', photos: ['a1.jpg', 'a2.jpg'], mods: ['KW V3'], color: 'blue' });
await mod.saveCarRecord(env, { id: 'car2', name: 'Project 3', photos: ['a3.jpg'], mods: ['Tevo pads'], color: 'green' });
await mod.saveCarRecord(env, { id: 'carb', name: 'Not mine', photos: ['b1.jpg'], mods: [] });
const record = id => { const k = 'gallery/cars/' + id + '.json'; return bucket.has(k) ? JSON.parse(bucket.get(k)) : null; };
ok(record('car1') && !record('car1').email, 'car records hold no email');

const move = async (body, token = 'tok-a') => {
  const r = await worker.fetch(new Request('https://w.test/my-builds/photo/move', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Session-Token': token }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

let r = await move({ file: 'a1.jpg', targetCarId: 'carb' });
ok(r.status === 403, 'cannot move into someone else\'s build');
ok(record('car1').photos.join() === 'a1.jpg,a2.jpg', 'a refused move leaves the old build alone');

r = await move({ file: 'a1.jpg', targetCarId: 'car2' });
ok(r.status === 200 && r.body.success && r.body.carId === 'car2', 'moves into another of my builds ' + JSON.stringify(r.body));
ok(record('car1').photos.join() === 'a2.jpg', 'gone from the old build');
ok(record('car2').photos.join() === 'a3.jpg,a1.jpg', 'added to the new build');
const side = JSON.parse(bucket.get('gallery/a1.jpg.json'));
ok(side.carId === 'car2', 'the photo now points at the new build');

r = await move({ file: 'b1.jpg', targetCarId: 'car2' });
ok(r.status === 403, 'cannot move someone else\'s photo');
