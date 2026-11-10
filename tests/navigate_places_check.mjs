// Run by tests/test_navigate.py: the Navigate address list on the worker. The admin key adds and removes addresses; a
// bad position or an unknown action is refused; a wrong key is refused. WORKER_MODULE is a copy of the worker that node
// can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const env = {
  ADMIN_KEY: 'secret',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async k => { kv.delete(k); }
  }
};
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const admin = (method, body, key = 'secret') => worker.fetch(new Request('https://w.test/navigate/places/admin?key=' + encodeURIComponent(key), {
  method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.2.0.1' }, body: body === undefined ? undefined : JSON.stringify(body)
}), env, { waitUntil() {} });

const refused = await admin('GET', undefined, 'wrong');
ok(refused.status === 401, 'a wrong admin key is refused (401)');

const empty = await (await admin('GET')).json();
ok(empty.success === true && empty.places.length === 0, 'the list starts empty');

const added = await (await admin('POST', { action: 'add', place: { house: '17', name: 'Ryder Way', town: 'Flitwick', postcode: 'mk45 1gn', lat: 52.0109, lng: -0.509 } })).json();
ok(added.success === true && added.places.length === 1, 'an address is added');
ok(added.places[0].postcode === 'MK45 1GN' && added.places[0].house === '17', 'the postcode is kept in capitals and the house number is kept');
const id = added.places[0].id;

const badPos = await admin('POST', { action: 'add', place: { name: 'Nowhere', lat: 'north', lng: -0.5 } });
ok(badPos.status === 400, 'an address with no position is refused (400)');
const noName = await admin('POST', { action: 'add', place: { lat: 52, lng: -0.5 } });
ok(noName.status === 400, 'an address with no name is refused (400)');
const unknown = await admin('POST', { action: 'wipe' });
ok(unknown.status === 400, 'an unknown action is refused (400)');

const removed = await (await admin('POST', { action: 'remove', id })).json();
ok(removed.success === true && removed.places.length === 0, 'the address is removed');
// The address search is for members who can use Navigate: without a session it is refused.
const search = await worker.fetch(new Request('https://w.test/navigate/search?q=17%20ryder%20way%20flitwick', { headers: { 'CF-Connecting-IP': '10.2.0.2' } }), env, { waitUntil() {} });
ok(search.status === 401, 'the address search is refused without a signed-in member (401)');
