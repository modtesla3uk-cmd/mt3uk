// Run by tests/test_navigate.py: the Navigate route on the worker (POST /navigate/route). A member who is not signed in
// is refused, the route is wired, and a bad request is refused. WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const env = {
  ADMIN_KEY: 'secret',
  ORS_API_KEY: 'test-key',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null,
    getWithMetadata: async k => ({ value: kv.has(k) ? kv.get(k) : null, metadata: null }),
    put: async (k, v) => { kv.set(k, v); },
    delete: async k => { kv.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true })
  }
};
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const post = (body, token) => {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.1.0.1' };
  if (token) headers['X-Session-Token'] = token;
  return worker.fetch(new Request('https://w.test/navigate/route', { method: 'POST', headers, body: JSON.stringify(body) }), env, { waitUntil() {} });
};
const r1 = await post({ from: [52.12, -0.99], to: [52.13, -0.98] });
ok(r1.status === 401, 'a member who is not signed in is refused (401)');
const j1 = await r1.json();
ok(j1.success === false, 'the refusal says it failed');
const r2 = await post({ from: 'nope', to: [52.13, -0.98] }, 'not-a-real-token');
ok(r2.status === 401, 'a made-up session token is refused');
ok(r2.status !== 404, 'the route is wired (not a 404)');
