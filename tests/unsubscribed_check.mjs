// Run by tests/test_unsubscribed.py: a member who is removed by MT3UK (DELETE /gallery/admin/subscribers) or who
// leaves (POST /profile/leave) is signed out and emailed a link to subscribe again, as MT3UK or as Laps by MT3UK.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const emails = [];
const env = {
  ADMIN_KEY: 'secret',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true })
  },
  GALLERY_BUCKET: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ objects: [], truncated: false }) },
  SEND_EMAIL: { send: async m => { emails.push(m.raw); } }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const A = 'a@example.com', L = 'laps@example.com', Q = 'quiet@example.com', S = 'stranger@example.com', G = 'gone@example.com';
for (const e of [A, Q, G]) kv.set('subscriber:' + e, '[]');
kv.set('laps-account:' + L, '{}');
kv.set('profile:' + Q, JSON.stringify({ emailsOff: true }));
const del = async (email, extra = '') => {
  const r = await worker.fetch(new Request('https://w.test/gallery/admin/subscribers?key=secret&email=' + encodeURIComponent(email) + extra, { method: 'DELETE' }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const text = m => m.replace(/=\r?\n/g, '').replace(/=3D/g, '=');

// A signed session works until the member is removed, then stops.
const { createSession } = mod;
const profile = async tok => (await worker.fetch(new Request('https://w.test/profile', { headers: { 'X-Session-Token': tok } }), env, { waitUntil() {} })).status;
const tokA = (await createSession(env, A)).token || (await createSession(env, A));
ok(await profile(tokA) !== 401, 'a member signed in on a device can use the site');

let r = await del(A);
ok(r.body.success && r.body.emailed === true && emails.length === 1, 'removing a member emails them');
const m1 = text(emails[0]);
ok(/To: a@example\.com/.test(m1) && /unsubscribed from MT3UK/.test(m1) && /https:\/\/mt3uk\.com\/signin\.html#si-join/.test(m1) && /laps-signin\.html/.test(m1), 'it says unsubscribed from MT3UK and links to subscribe again (and Laps)');
ok(!/—/.test(m1), 'no em dashes');
ok(await profile(tokA) === 401 && Number(kv.get('session-version:' + A)) === 1 && !kv.has('subscriber:' + A), 'their sign-ins end (the session version moves on) and the subscriber record goes');

r = await del(L);
ok(r.body.emailed === true && emails.length === 2 && /Laps by MT3UK/.test(text(emails[1])) && /laps\.mt3uk\.com\/laps-signin\.html#si-join/.test(text(emails[1])) && !kv.has('laps-account:' + L), 'a Laps-only account is signed out and gets the Laps email');

r = await del(Q);
ok(r.body.success && r.body.emailed === false && emails.length === 2 && Number(kv.get('session-version:' + Q)) === 1, 'a member with emails off is signed out but not emailed');

r = await del(S);
ok(r.body.success && r.body.emailed === false && emails.length === 2, 'an address that was never a member is not emailed');

kv.set('subscriber:' + G + 'x', '[]');
r = await del(G + 'x', '&notify=0');
ok(r.body.success && r.body.emailed === false && emails.length === 2 && Number(kv.get('session-version:' + G + 'x')) === 1, 'notify=0 removes without the email');

// Leaving: the member's own request signs them out and emails them too.
kv.set('subscriber:' + G, '[]');
const tokG = (await createSession(env, G)).token || (await createSession(env, G));
const leave = await worker.fetch(new Request('https://w.test/profile/leave', { method: 'POST', headers: { 'X-Session-Token': tokG, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'LEAVE' }) }), env, { waitUntil() {} });
ok(leave.status === 200 && emails.length === 3 && /As you asked/.test(text(emails[2])) && /signin\.html#si-join/.test(text(emails[2])), 'a member who leaves is emailed a link to subscribe again');
ok(await profile(tokG) === 401, 'and is signed out');

// The Laps members list: Laps-only accounts, with Remove.
const members = async (method = 'GET', body, key = 'secret') => {
  const r = await worker.fetch(new Request('https://w.test/laps/members/admin?key=' + key, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const P = 'pat@example.com', R = 'rae@example.com', M = 'member@example.com';
kv.set('laps-account:' + P, JSON.stringify({ since: '2026-10-01T10:00:00Z' }));
kv.set('laps-account:' + R, JSON.stringify({ since: '2026-10-05T10:00:00Z' }));
kv.set('profile:' + P, JSON.stringify({ firstName: 'Pat', lastName: 'Lee' }));
kv.set('subscriber:' + M, '[]');
kv.set('track-access', JSON.stringify({ open: false, allowed: [{ email: P }, { email: 'other@example.com' }], pending: [{ email: R }] }));
kv.set('laps-signups', JSON.stringify([{ email: P, name: 'Pat Lee', account: 'laps' }, { email: R, name: 'Rae', account: 'laps' }, { email: M, name: 'Em', account: 'mt3uk' }]));

let m = await members('GET', undefined, 'wrong');
ok(m.status === 401, 'the Laps members list needs the admin key');
m = await members();
ok(m.body.success && m.body.members.length === 2 && m.body.members[0].email === R && m.body.members[1].name === 'Pat Lee', 'it lists the Laps-only accounts, newest first, with names');
const before = emails.length;
m = await members('POST', { remove: M });
ok(m.status === 400 && /Subscribers panel/.test(m.body.message) && emails.length === before, 'a full MT3UK member is refused (removed on the Subscribers panel)');
m = await members('POST', { remove: 'nobody@example.com' });
ok(m.status === 404, 'an address with no Laps account is refused');

const stampBefore = kv.get('admin-alert-stamp');
m = await members('POST', { remove: P, notify: true });
ok(m.body.success && m.body.emailed === true && m.body.members.length === 1 && m.body.members[0].email === R, 'removing one account emails them and leaves the other');
ok(emails.length === before + 1 && /Laps by MT3UK/.test(text(emails[emails.length - 1])) && /To: pat@example\.com/.test(text(emails[emails.length - 1])) && /laps-signin\.html#si-join/.test(text(emails[emails.length - 1])), 'the Laps email goes with a link to subscribe again');
ok(!kv.has('laps-account:' + P) && !kv.has('profile:' + P) && Number(kv.get('session-version:' + P)) >= 1, 'their account and settings go and their sign-ins end');
let access = JSON.parse(kv.get('track-access'));
ok(!access.allowed.some(x => x.email === P) && access.allowed.some(x => x.email === 'other@example.com') && access.pending.some(x => x.email === R), 'they come off the early access list and nobody else does');
let ups = JSON.parse(kv.get('laps-signups'));
ok(!ups.some(x => x.email === P) && ups.length === 2, 'they come off the New Laps sign-ups list');
ok(kv.get('admin-alert-stamp') !== stampBefore, 'the admin bells are told to catch up');

m = await members('POST', { remove: R, notify: false });
ok(m.body.success && m.body.emailed === false && emails.length === before + 1 && m.body.members.length === 0, 'with the switch off nobody is emailed');
access = JSON.parse(kv.get('track-access'));
ok(access.pending.length === 0, 'a waiting early access request is taken off too');

// Removing an MT3UK subscriber who is also on the Laps lists takes them off those too.
kv.set('track-access', JSON.stringify({ open: false, allowed: [{ email: M }], pending: [] }));
kv.set('laps-signups', JSON.stringify([{ email: M, name: 'Em', account: 'mt3uk' }]));
r = await del(M);
ok(r.body.success && JSON.parse(kv.get('track-access')).allowed.length === 0 && JSON.parse(kv.get('laps-signups')).length === 0, 'removing an MT3UK member also clears the early access and New Laps sign-ups lists');
