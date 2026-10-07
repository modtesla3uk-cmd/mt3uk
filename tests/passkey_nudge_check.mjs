// Run by tests/test_passkeys.py: the Passkey reminders route (POST /admin/passkeys/nudge) through the real worker
// with a fake KV store. WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const emails = [];
const env = {
  ADMIN_KEY: 'secret',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix = '', cursor, limit = 1000 } = {}) => {
      const all = [...kv.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = all.slice(start, start + limit).map(name => ({ name }));
      const done = start + limit >= all.length;
      return { keys, list_complete: done, cursor: done ? undefined : String(start + limit) };
    }
  },
  GALLERY_BUCKET: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ objects: [], truncated: false }) },
  SEND_EMAIL: { send: async m => { emails.push(m.raw); } }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const A = 'a@example.com', B = 'b@example.com', C = 'c@example.com', D = 'd@example.com';
for (const e of [A, B, C, D]) kv.set('subscriber:' + e, '[]');
kv.set('passkeys:' + B, JSON.stringify([{ id: 'k1', name: 'iPhone', publicKey: 'x', alg: -7 }]));
kv.set('profile:' + D, JSON.stringify({ firstName: 'Dee', emailsOff: true }));
const call = async (body, key = 'secret') => {
  const r = await worker.fetch(new Request('https://w.test/admin/passkeys/nudge?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const notes = e => JSON.parse(kv.get('notifications:' + e) || '[]');

let r = await call({ dry: true }, 'wrong');
ok(r.status === 401, 'the admin key is needed');
r = await call({ dry: true });
ok(r.body.success && r.body.sent === 3 && r.body.havePasskey === 1 && r.body.already === 0 && r.body.cursor === null, 'a count says 3 members have no passkey and 1 has');
ok(!kv.has('passkey-nudged') && notes(A).length === 0, 'a count sends nothing');

// Batches: 2 at a time through 4 members.
const old = env.VOTES.list;
env.VOTES.list = opts => old(Object.assign({}, opts, { limit: 2 }));
r = await call({ email: true });
ok(r.body.success && r.body.sent === 1 && r.body.havePasskey === 1 && r.body.cursor === '2', 'the first batch reminds 1 of its 2 (the other has a passkey) and says there is more');
let r2 = await call({ email: true, cursor: r.body.cursor });
ok(r2.body.success && r2.body.sent === 2 && r2.body.emailed === 1 && r2.body.cursor === null, 'the second batch reminds the other 2, emailing only the one with emails on');
env.VOTES.list = old;
const nA = notes(A);
ok(nA.length === 1 && nA[0].type === 'passkey' && nA[0].link === 'profile.html#passkey-setup' && nA[0].fromName === 'MT3UK' && /passkey/i.test(nA[0].text) && nA[0].read === false, 'the reminder is on the bell, linking to Set up a passkey in Profile');
ok(notes(B).length === 0, 'a member with a passkey gets nothing');
ok(notes(C).length === 1 && notes(D).length === 1, 'the others are reminded');
ok(emails.length === 2 && emails.every(m => /Set up a passkey/.test(m) && /profile\.html#passkey-setup/.test(m)) && !emails.some(m => m.includes(D)), 'two emails went, to the members with emails on, pointing at the card');
ok(JSON.parse(kv.get('passkey-nudged')).sort().join() === [A, C, D].join(), 'who was reminded is kept in one key');

r = await call({ email: true });
ok(r.body.sent === 0 && r.body.already === 3 && r.body.havePasskey === 1 && notes(A).length === 1 && emails.length === 2, 'sending again reminds nobody twice');
kv.set('subscriber:e@example.com', '[]');
r = await call({});
ok(r.body.sent === 1 && notes('e@example.com').length === 1 && emails.length === 2, 'a member who joined since is reminded, without an email when the box is off');
