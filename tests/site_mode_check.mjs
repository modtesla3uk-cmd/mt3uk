// Run by tests/test_site_theme.py: the Laps light or dark settings on the site theme routes, through the real worker with a
// fake KV store. WORKER_MODULE is a copy of the worker that node can load.
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
const call = async (method, path, body) => {
  const init = { method, headers: {} };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

let r = await call('GET', '/site/theme');
ok(r.body.success && r.body.mode.laps === 'light' && r.body.mode.darkAll === false, 'with nothing set, Laps opens light and Dark for everyone is off');
r = await call('POST', '/site/theme/admin?key=wrong', { mode: 'dark' });
ok(r.status === 401, 'the settings need the admin key');
r = await call('POST', '/site/theme/admin?key=secret', { mode: 'sepia' });
ok(r.status === 400, 'only light, dark or system are taken');
r = await call('POST', '/site/theme/admin?key=secret', { site: 'laps', theme: 'gold' });
r = await call('POST', '/site/theme/admin?key=secret', { mode: 'system' });
ok(r.body.success && r.body.mode.laps === 'system', 'the default can follow the device');
ok(r.body.themes.laps === 'gold', 'setting the mode keeps the theme');
const before = Date.now();
r = await call('POST', '/site/theme/admin?key=secret', { darkAll: true });
ok(r.body.mode.darkAll === true && r.body.mode.darkAllAt >= before, 'Dark for everyone is stamped with when it went on');
const at = r.body.mode.darkAllAt;
r = await call('POST', '/site/theme/admin?key=secret', { darkAll: true });
ok(r.body.mode.darkAllAt === at, 'switching it on again keeps the first stamp');
r = await call('POST', '/site/theme/admin?key=secret', { site: 'main', theme: 'jade' });
ok(r.body.mode.darkAll === true && r.body.mode.laps === 'system', 'saving a theme keeps the light or dark settings');
r = await call('GET', '/site/theme');
ok(r.body.mode.darkAll === true && r.body.mode.laps === 'system' && r.body.themes.main === 'jade' && r.body.themes.laps === 'gold', 'the public route gives the themes and the settings');
r = await call('POST', '/site/theme/admin?key=secret', { darkAll: false });
ok(r.body.mode.darkAll === false, 'Dark for everyone can be switched off');
