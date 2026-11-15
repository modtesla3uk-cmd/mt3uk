// Run by tests/test_signed_out_pro.py: GET /track/tiers/public through the real worker with a fake KV store. WORKER_MODULE is a
// copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const env = {
  ADMIN_KEY: 'secret',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async k => { kv.delete(k); },
    list: async () => ({ keys: [], list_complete: true })
  }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const call = async (path) => {
  const r = await worker.fetch(new Request('https://w.test' + path), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})), cache: r.headers.get('Cache-Control') };
};
let r = await call('/track/tiers/public');
ok(r.status === 200 && r.body.success && r.body.applies === false, 'with nothing set the free tier does not apply to visitors');
kv.set('track-tiers', JSON.stringify({ mode: 'testers', testers: [{ email: 'a@example.com' }] }));
r = await call('/track/tiers/public');
ok(r.body.applies === false, 'Testers only does not lock a visitor who is not signed in');
kv.set('track-tiers', JSON.stringify({ mode: 'all' }));
r = await call('/track/tiers/public');
ok(r.body.applies === true, 'Everyone locks the Laps Pro tiles for a visitor who is not signed in');
ok(r.cache === 'no-cache', 'the answer is not cached');
ok(!JSON.stringify(r.body).includes('@'), 'it carries nothing personal');
kv.set('track-tiers', JSON.stringify({ mode: 'off' }));
r = await call('/track/tiers/public');
ok(r.body.applies === false, 'Off locks nothing');
