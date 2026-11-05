// The Android app's Firebase pushes (workers/vote-worker.js: sendFcm, fcmAccessToken, sendPushToMember).
// Run from tests/test_fcm_push.py, which builds the worker into a module (WORKER_MODULE) and passes it in.
import { webcrypto } from 'node:crypto';
const mod = await import(process.env.WORKER_MODULE);
const subtle = webcrypto.subtle;
let failed = 0;
const ok = (cond, label) => { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) failed++; };

const kp = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const pem = '-----BEGIN PRIVATE KEY-----\n' + pkcs8.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
const sa = { project_id: 'laps-test', client_email: 'push@laps-test.iam.gserviceaccount.com', private_key: pem };
const env = { FCM_SERVICE_ACCOUNT: JSON.stringify(sa) };

let fcmStatus = 200;
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 });
  return new Response(fcmStatus === 200 ? '{}' : JSON.stringify({ error: { status: 'NOT_FOUND', message: 'UNREGISTERED' } }), { status: fcmStatus });
};

// The access token is signed with the service account key and says who it is for.
const ok1 = await mod.sendFcm(env, 'device-token-abc', { title: 'Friend request', body: 'Sue wants to be friends.', url: '/profile.html#friends' });
ok(ok1 === true, 'a sent notification resolves true');
const oauth = calls.find(c => c.url.includes('oauth2.googleapis.com'));
const assertion = new URLSearchParams(oauth.opts.body).get('assertion');
const [h, c, sig] = assertion.split('.');
const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
ok(JSON.parse(Buffer.from(h, 'base64url').toString()).alg === 'RS256', 'the token is signed with RS256');
ok(claims.iss === sa.client_email && claims.scope === 'https://www.googleapis.com/auth/firebase.messaging', 'the token names the service account and the Firebase scope');
const valid = await subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(h + '.' + c));
ok(valid, 'the signature checks out against the key');

const fcm = calls.find(c2 => c2.url.includes('fcm.googleapis.com'));
ok(fcm.url === 'https://fcm.googleapis.com/v1/projects/laps-test/messages:send', 'sends to the project in the service account');
ok(fcm.opts.headers.Authorization === 'Bearer tok-1', 'uses the Google access token');
const body = JSON.parse(fcm.opts.body).message;
ok(body.token === 'device-token-abc' && body.notification.title === 'Friend request' && body.data.url === '/profile.html#friends', 'the message carries the token, title, body and link');

fcmStatus = 404;
const gone = await mod.sendFcm(env, 'old-token', { title: 'x', body: 'y', url: '/' });
ok(gone === 'gone', 'a token FCM no longer knows is reported as gone');

// A member's app device is one of their push devices: it is sent through FCM, and a gone token is dropped.
const kv = new Map([['push:member@example.com', JSON.stringify([{ endpoint: 'fcm:device-token-abc', fcm: 'device-token-abc' }, { endpoint: 'fcm:old-token', fcm: 'old-token' }])]]);
const envKv = { FCM_SERVICE_ACCOUNT: env.FCM_SERVICE_ACCOUNT, VOTES: { get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v), delete: async k => kv.delete(k) } };
fcmStatus = 200;
calls.length = 0;
const sent = await mod.sendPushToMember(envKv, 'member@example.com', { title: 'Hi', body: 'There', url: '/' });
ok(sent === 2, 'both of the member\'s app devices are sent to');
ok(!calls.some(c3 => c3.url.includes('push.services') || c3.url.startsWith('https://fcm.googleapis.com') === false && !c3.url.includes('oauth2')), 'no web push is sent to an app token');
fcmStatus = 404;
calls.length = 0;
await mod.sendPushToMember(envKv, 'member@example.com', { title: 'Hi', body: 'There', url: '/' });
const left = JSON.parse(kv.get('push:member@example.com'));
ok(left.length === 0, 'a token FCM says is gone is taken off the list');

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all app push checks passed');
