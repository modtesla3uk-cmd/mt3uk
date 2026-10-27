// Run by tests/test_photo_rename.py: the photo rename plan (GET /my-builds/admin/photo-rename-plan) through the real worker
// with a fake KV store and photo bucket. It only reads: the fake store refuses any write, so a write would fail the check.
// WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const bucket = new Map();
const uploaded = {};
let writes = 0;
const env = {
  ADMIN_KEY: 'secret',
  GITHUB_TOKEN: 'x',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null,
    put: async () => { writes++; throw new Error('read-only check: KV write'); },
    delete: async () => { writes++; throw new Error('read-only check: KV delete'); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true })
  },
  GALLERY_BUCKET: {
    get: async k => bucket.has(k) ? { json: async () => JSON.parse(bucket.get(k)) } : null,
    put: async () => { writes++; throw new Error('read-only check: bucket write'); },
    delete: async () => { writes++; throw new Error('read-only check: bucket delete'); },
    list: async ({ prefix = '' } = {}) => ({ objects: [...bucket.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key, uploaded: uploaded[key] })), truncated: false })
  },
  SEND_EMAIL: { send: async () => {} }
};
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const photo = (key, date) => { bucket.set(key, 'binary'); uploaded[key] = new Date(date); };

photo('gallery/photo--by-helen-little.jpg', '2026-03-01T10:00:00Z');
photo('gallery/photo-10.jpg', '2026-02-01T10:00:00Z');
photo('gallery/15-model-3-pin-stripes.jpg', '2026-09-18T16:20:00Z');
photo('gallery/2021-model-3-performance--by-martyn-heath-2.jpeg', '2026-10-14T06:39:00Z');
bucket.set('gallery/photo-10.jpg.json', JSON.stringify({ mods: ['Wheels'] }));
bucket.set('gallery/cars/car-1.json', JSON.stringify({ id: 'car-1', photos: ['photo-10.jpg', 'photo--by-helen-little.jpg'] }));
kv.set('likes:photo-10.jpg', '3');
kv.set('comments:photo-10.jpg', '[]');
kv.set('like-alert:photo-10.jpg:voter1', '1');
kv.set('like-alert:photo-10.jpg:voter2', '1');
kv.set('photo-reports:photo-10.jpg', '[]');

const call = async (path, key) => {
  const url = 'https://worker.test' + path + (key ? (path.includes('?') ? '&' : '?') + 'key=' + key : '');
  const res = await worker.fetch(new Request(url, { method: 'GET' }), env, { waitUntil() {}, passThroughOnException() {} });
  return { status: res.status, body: await res.json() };
};

let r = await call('/my-builds/admin/photo-rename-plan');
ok(r.status === 401, 'the plan needs the admin key');
r = await call('/my-builds/admin/photo-rename-plan', 'secret');
ok(r.status === 200 && r.body.success && r.body.dryRun === true && r.body.changed === 0, 'the plan is a dry run that changes nothing');
ok(writes === 0, 'nothing is written to the bucket or the store');
ok(r.body.photos === 4 && r.body.numbered === 1 && r.body.toNumber === 3 && r.body.highestNumberInUse === 15, 'four photos: one already numbered, three to number, the highest in use is 15');
const byFrom = Object.fromEntries(r.body.plan.map(p => [p.from, p]));
ok(byFrom['photo-10.jpg'].to === '16-photo-10.jpg', 'the oldest unnumbered photo gets the next number after the highest in use');
ok(byFrom['photo--by-helen-little.jpg'].to === '17-photo--by-helen-little.jpg', 'then the next one in upload order');
ok(byFrom['2021-model-3-performance--by-martyn-heath-2.jpeg'].to === '18-2021-model-3-performance--by-martyn-heath-2.jpeg', 'a year at the start is not taken for a number');
ok(!('15-model-3-pin-stripes.jpg' in byFrom), 'a photo already numbered is left out of the plan');
ok(byFrom['photo-10.jpg'].sidecar === true && byFrom['photo-10.jpg'].cars.join() === 'car-1', 'the plan shows the sidecar and the car that lists the photo');
ok(byFrom['photo-10.jpg'].keys['likes:'] === 1 && byFrom['photo-10.jpg'].keys['like-alert:'] === 2 && byFrom['photo-10.jpg'].keys['comments:'] === 1 && byFrom['photo-10.jpg'].keys['photo-reports:'] === 1, 'the plan counts the keys kept under the name, alerts per voter');
ok(byFrom['photo--by-helen-little.jpg'].sidecar === false && Object.keys(byFrom['photo--by-helen-little.jpg'].keys).length === 0, 'a photo with nothing kept under its name shows none');
ok(byFrom['photo-10.jpg'].uploaded === '2026-02-01T10:00:00.000Z', 'each photo shows when it was uploaded');
