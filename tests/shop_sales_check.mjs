// Run by tests/test_shop_sales.py: the units sold per product, typed in on the admin's Shop panel (GET and POST
// /shop/sales/admin) and read by the shop page (GET /shop/sales), through the real worker with a fake KV store.
// WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const env = {
  ADMIN_KEY: 'secret',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async k => { kv.delete(k); }
  },
  SEND_EMAIL: { send: async () => {} }
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const call = async (method, path, body) => {
  const init = { method, headers: {} };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await worker.fetch(new Request('https://worker.test' + path, init), env, ctx);
  return { status: res.status, body: await res.json() };
};

let r = await call('GET', '/shop/sales');
ok(r.status === 200 && r.body.success && Object.keys(r.body.byHandle).length === 0, 'with nothing typed in, the shop is told there are no figures (the file applies)');

r = await call('POST', '/shop/sales/admin', { byHandle: { 'master-cylinder-brace': 3 } });
ok(r.status === 401, 'typing the figures in needs the admin key');
r = await call('GET', '/shop/sales/admin');
ok(r.status === 401, 'reading the admin figures needs the admin key');

r = await worker.fetch(new Request('https://worker.test/shop/sales/admin?key=secret', { method: 'POST', body: JSON.stringify({ byHandle: {
  'master-cylinder-brace': 3, 'black-mt3uk-tee-red-underline-super-soft': 0, 'untouched-sticker': 5.7, 'bad-one': -2, 'huge': 999999
} }) }), env, ctx);
const saved = await r.json();
ok(r.status === 200 && saved.byHandle['master-cylinder-brace'] === 3, 'the figures are saved');
ok(saved.byHandle['black-mt3uk-tee-red-underline-super-soft'] === 0, 'a zero is kept, so it overrides the file');
ok(saved.byHandle['untouched-sticker'] === 5, 'a figure is a whole number');
ok(!('bad-one' in saved.byHandle) && !('huge' in saved.byHandle), 'a negative or huge figure is left out');

r = await call('GET', '/shop/sales');
ok(r.body.byHandle['master-cylinder-brace'] === 3, 'the shop page reads the figures');

r = await worker.fetch(new Request('https://worker.test/shop/sales/admin?key=secret'), env, ctx);
const read = await r.json();
ok(read.byHandle['master-cylinder-brace'] === 3, 'the admin panel reads them back');

r = await worker.fetch(new Request('https://worker.test/shop/sales/admin?key=secret', { method: 'POST', body: JSON.stringify({ byHandle: { 'master-cylinder-brace': 3 } }) }), env, ctx);
const cleared = await r.json();
ok(!('untouched-sticker' in cleared.byHandle), 'a product left blank on the panel is removed, so the file applies again');
