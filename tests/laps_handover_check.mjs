// Run by tests/test_laps_handover.py: the sign-in handover between mt3uk.com and laps.mt3uk.com through the real
// worker with a fake KV store. WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const ttl = {};
const env = {
  ADMIN_KEY: 'secret',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null,
    put: async (k, v, o) => { kv.set(k, v); if (o && o.expirationTtl) ttl[k] = o.expirationTtl; },
    delete: async k => { kv.delete(k); },
    list: async () => ({ keys: [], list_complete: true })
  }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
kv.set('my-builds-session:tok-a', 'a@example.com');
const call = async (method, path, body, token) => {
  const init = { method, headers: {} };
  if (token) init.headers['X-Session-Token'] = token;
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

let r = await call('POST', '/session/handover', {});
ok(r.status === 401, 'a code needs a sign-in');
r = await call('POST', '/session/handover', { firstName: 'Rich' }, 'tok-a');
const code = r.body.code;
ok(r.body.success && /^[a-f0-9]{64}$/.test(code), 'a signed-in member gets a long random code');
ok(ttl['session-handover:' + code] === 120, 'the code lasts 2 minutes');
ok(!kv.get('session-handover:' + code).includes('tok-a'), 'the code does not hold the sign-in itself');
r = await call('POST', '/session/handover/redeem', { code: 'nope' });
ok(r.status === 400, 'a made-up code is refused');
r = await call('POST', '/session/handover/redeem', { code: 'b'.repeat(64) });
ok(r.status === 404, 'an unknown code is refused');
r = await call('POST', '/session/handover/redeem', { code });
ok(r.body.success && r.body.email === 'a@example.com' && r.body.firstName === 'Rich' && r.body.session, 'the code gives a sign-in for the same member');
const session = r.body.session;
r = await call('GET', '/session/refresh', undefined, session);
ok(r.status === 200 && r.body.success, 'and that sign-in works');
r = await call('POST', '/session/handover/redeem', { code });
ok(r.status === 404, 'a code works only once');
r = await call('POST', '/session/sign-out-all', undefined, session);
r = await call('POST', '/session/handover', {}, session);
ok(r.status === 401, 'after Sign out of all devices the old sign-in cannot make a code');
