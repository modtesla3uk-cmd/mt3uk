// Run by tests/test_mod_questions.py: asking about a mod on someone's build
// (the Gallery's Full mods list) through the real worker, with a fake KV
// store and photo bucket. WORKER_MODULE is a copy of the worker node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const bucket = new Map();
const env = {
  ADMIN_KEY: 'secret',
  VOTES: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    // Like KV list(): keys by prefix, a page at a time, in name order.
    list: async ({ prefix = '', limit = 1000, cursor } = {}) => {
      const all = [...kv.keys()].filter(k => k.startsWith(prefix)).sort();
      const from = cursor ? parseInt(cursor, 10) : 0;
      const keys = all.slice(from, from + limit).map(name => ({ name }));
      const more = from + limit < all.length;
      return { keys, list_complete: !more, cursor: more ? String(from + limit) : undefined };
    } },
  GALLERY_BUCKET: {
    get: async k => bucket.has(k) ? { json: async () => JSON.parse(bucket.get(k)) } : null,
    put: async (k, v) => { bucket.set(k, typeof v === 'string' ? v : 'binary'); },
    delete: async k => { bucket.delete(k); }
  },
  SEND_EMAIL: { sent: [], send: async function (m) { this.sent.push(m.raw); } }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const OWNER = 'owner@example.com', ASKER = 'asker@example.com';
kv.set('my-builds-session:tok-owner', OWNER);
kv.set('my-builds-session:tok-asker', ASKER);
kv.set('profile:' + OWNER, JSON.stringify({ firstName: 'Rich', lastName: 'H', nickname: 'Rich' }));
kv.set('profile:' + ASKER, JSON.stringify({ firstName: 'Ann', lastName: 'B', nickname: 'Ann' }));
// A photo of the owner's car, with its mods list.
await mod.putSidecar(env, 'gallery/car.jpg.json', { email: OWNER, carId: 'c1' });
await mod.saveCarRecord(env, { id: 'c1', name: 'Arctic Three', photos: ['car.jpg'], mods: [] });
kv.set('car-details:c1', JSON.stringify({ model: 'Model 3', specs: {
  suspension: { status: 'up', fields: { type: 'Coilovers', make: 'KW', model: 'V3', roadReboundFront: '8 clicks' }, fitted: { year: 2023, cost: '1650' } },
  brakes: { status: 'stock' }
} }));

const call = async (method, path, body, token) => {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) init.headers['X-Session-Token'] = token;
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// The public mods list: parts, the coilover table, never dates or costs.
let r = await call('GET', '/cars/public?file=car.jpg');
ok(r.status === 200 && r.body.name === 'Arctic Three' && r.body.canAsk === true && !r.body.mine, 'public list for a visitor');
const susp = r.body.view.filter(a => a.id === 'suspension')[0];
ok(susp && susp.parts[0].what === 'KW V3 coilovers' && susp.parts[0].settings.road.reboundFront === '8 clicks', 'parts and coilover settings');
ok(!JSON.stringify(r.body).includes('1650') && !JSON.stringify(r.body).includes('2023') && !JSON.stringify(r.body).includes(OWNER), 'no costs, dates or email');
r = await call('GET', '/cars/public?file=car.jpg', undefined, 'tok-owner');
ok(r.body.mine === true, 'the owner is told it is their own car');

// Asking about a mod reaches the owner, though they aren't friends.
r = await call('POST', '/profile/messages/send', { about: { file: 'car.jpg', mod: 'KW V3 coilovers' }, text: 'How do you find them on the road?' }, 'tok-asker');
ok(r.status === 200 && r.body.message.about.mod === 'KW V3 coilovers', 'mod question sent');
const ownerIndex = JSON.parse(kv.get('dm-index:' + OWNER) || '{}');
const askerId = Object.keys(ownerIndex)[0];
ok(ownerIndex[askerId] && ownerIndex[askerId].email === ASKER && ownerIndex[askerId].unread === 1, 'the owner has it, unread');
ok(env.SEND_EMAIL.sent.some(raw => raw.includes('asked about your KW V3 coilovers')), 'the owner is emailed about the question');

// The owner can reply, and reads the mod on the question.
r = await call('GET', '/profile/messages/thread?with=' + askerId, undefined, 'tok-owner');
ok(r.status === 200 && r.body.canReply === true && r.body.messages[0].about.mod === 'KW V3 coilovers', 'the owner sees the tagged mod and can reply');
r = await call('POST', '/profile/messages/send', { with: askerId, text: 'Great, a bit firm on 8.' }, 'tok-owner');
ok(r.status === 200, 'the owner replies to a non-friend who asked');

// Not your own car, and not when the owner has turned questions off.
r = await call('POST', '/profile/messages/send', { about: { file: 'car.jpg', mod: 'KW V3 coilovers' }, text: 'Hi' }, 'tok-owner');
ok(r.status === 400, 'no asking about your own mods');
kv.set('profile:' + OWNER, JSON.stringify({ firstName: 'Rich', nickname: 'Rich', modQuestionsOff: true }));
r = await call('POST', '/profile/messages/send', { about: { file: 'car.jpg', mod: 'KW V3 coilovers' }, text: 'Hi again' }, 'tok-asker');
ok(r.status === 403, 'refused when mod questions are off');
r = await call('GET', '/cars/public?file=car.jpg');
ok(r.body.canAsk === false, 'the public list says questions are off');
// Strangers still can't message out of the blue.
r = await call('POST', '/profile/messages/send', { with: 'nobody', text: 'Hi' }, 'tok-asker');
ok(r.status === 403, 'no messages to strangers without a mod question');

// A nickname is optional (October 2026): clearing it saves and the full name is shown; a bad one is refused;
// a member with no nickname but a name can still send a friend request.
r = await call('POST', '/profile', { nickname: '' }, 'tok-asker');
ok(r.status === 200 && r.body.success && !JSON.parse(kv.get('profile:' + ASKER)).nickname, 'a nickname can be cleared');
ok(!(JSON.parse(kv.get('nicknames') || '{}')).ann, 'and it is freed for others');
r = await call('GET', '/profile', undefined, 'tok-asker');
ok(r.status === 200 && !r.body.nickname, 'the profile has no nickname, and is not given one again');
// A member from before nicknames were automatic gets one the first time their profile is opened.
kv.set('profile:' + OWNER, JSON.stringify({ firstName: 'Rich', lastName: 'H' }));
r = await call('GET', '/profile', undefined, 'tok-owner');
ok(r.status === 200 && r.body.nickname === 'RH1' && JSON.parse(kv.get('profile:' + OWNER)).nickname === 'RH1', 'a returning member with no nickname gets first initial and last name: ' + r.body.nickname);
kv.set('profile:' + OWNER, JSON.stringify({ firstName: 'Rich', lastName: 'H', nickname: 'Rich' }));
r = await call('POST', '/profile', { nickname: 'a' }, 'tok-asker');
ok(r.status === 400 && /3 to 20/.test(r.body.message), 'a nickname that is not valid is still refused');
kv.set('nicknames', JSON.stringify({ rich: OWNER }));
r = await call('POST', '/profile/friends', { action: 'request', nickname: 'Rich' }, 'tok-asker');
ok(r.status === 200 && r.body.success, 'a member with a name but no nickname can ask to be friends: ' + r.status + ' ' + (r.body.message || ''));

// The admin's one-off: every member with a name but no nickname gets the automatic one; cleared ones are left.
kv.set('profile:' + ASKER, JSON.stringify({ firstName: 'Ann', lastName: 'B', nicknameCleared: true }));
kv.set('profile:' + OWNER, JSON.stringify({ firstName: 'Rich', lastName: 'H' }));
kv.set('profile:old@example.com', JSON.stringify({ firstName: 'Olga', lastName: 'Dubois-Smith' }));
kv.set('profile:noname@example.com', JSON.stringify({}));
kv.set('nicknames', JSON.stringify({}));
r = await call('POST', '/profile/admin/nicknames');
ok(r.status === 401, 'the one-off needs the admin key');
r = await call('POST', '/profile/admin/nicknames?key=secret');
ok(r.status === 200 && r.body.given === 2 && r.body.cleared === 1 && r.body.noName === 1 && r.body.total === 4, 'it gives nicknames to members with a name and none: ' + JSON.stringify(r.body));
ok(JSON.parse(kv.get('profile:' + OWNER)).nickname === 'RH1' && JSON.parse(kv.get('profile:old@example.com')).nickname === 'ODubois-Smith' && !JSON.parse(kv.get('profile:' + ASKER)).nickname, 'first initial and last name, and a cleared one is left alone');
ok(JSON.parse(kv.get('nicknames'))['odubois-smith'] === 'old@example.com', 'and the nickname index knows them');
r = await call('POST', '/profile/admin/nicknames?key=secret');
ok(r.body.given === 0 && r.body.had === 2, 'running it again gives none');
