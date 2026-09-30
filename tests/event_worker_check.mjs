// Run by tests/test_event_worker.py: exercises the worker's event page routes with a fake
// KV store, image bucket and GitHub. WORKER_MODULE is a copy of the worker that node can load.
const worker = (await import(process.env.WORKER_MODULE)).default;
const kv = new Map(); const meta = new Map();
const env = {
  ADMIN_KEY: 'secret',
  VOTES: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v, o) => { kv.set(k, v); meta.set(k, o && o.metadata); }, delete: async k => { kv.delete(k); meta.delete(k); }, getWithMetadata: async k => ({ value: kv.has(k) ? kv.get(k) : null, metadata: meta.get(k) || null }) },
  GALLERY_BUCKET: { objects: {}, put: async function (k, v, o) { this.objects[k] = { size: v.length, o }; } },
  GITHUB_TOKEN: 'x',
  SEND_EMAIL: { sent: [], send: async function (m) { this.sent.push(m.raw); } }
};
// Fake GitHub contents API holding data/event-pages.json
let file = { _note: 'n', events: [] }; let sha = 1;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes('api.github.com')) {
    if ((opts.method || 'GET') === 'GET') return new Response(JSON.stringify({ sha: String(sha), content: btoa(unescape(encodeURIComponent(JSON.stringify(file)))) }), { status: 200 });
    const b = JSON.parse(opts.body);
    if (b.sha !== String(sha)) return new Response('{}', { status: 409 });
    file = JSON.parse(decodeURIComponent(escape(atob(b.content)))); sha++; globalThis.lastMsg = b.message;
    return new Response('{}', { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
};
const call = async (method, path, body, raw, extra) => {
  const init = { method, headers: Object.assign(raw ? {} : { 'Content-Type': 'application/json' }, extra || {}) };
  if (body !== undefined) init.body = raw ? body : JSON.stringify(body);
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const K = '?key=secret';
let r = await call('POST', '/events/pages/admin/save' + K, { isNew: true, entry: { slug: 'Bad Slug', name: 'x', title: 'y' } });
ok(r.status === 400, 'bad slug refused');
r = await call('POST', '/events/pages/admin/save', { isNew: true, entry: { slug: 'frunk', name: 'Frunk', title: 'Frunk or Treat' } });
ok(r.status === 401, 'save needs the admin key');
r = await call('POST', '/events/pages/admin/save' + K, { isNew: true, entry: { slug: 'frunk', name: 'Frunk', title: 'Frunk or Treat UK', startDate: '2026-10-31', startTime: '14:00', endTime: '17:00', what3words: '///Starter.Minivans.Doted', image: 'javascript:alert(1)', poster: 'images/events/x/poster.jpg', ctaUrl: 'http://insecure', description: ['a', '', 'b'], tickets: { tiers: [{ name: 'Free', price: 'Free', includes: ['x', ''], url: 'https://ok.example/t', featured: 1 }] } } });
ok(r.status === 200 && r.body.entry.draft === true && r.body.entry.created, 'new event is a draft with a created date');
ok(r.body.entry.what3words === '///starter.minivans.doted', 'what3words tidied');
ok(!('image' in r.body.entry) && !('ctaUrl' in r.body.entry), 'unsafe image and link dropped');
ok(r.body.entry.description.length === 2 && r.body.entry.tickets.tiers[0].includes.length === 1, 'blank lines dropped');
ok(file.events.length === 1 && kv.has('event-page-draft:frunk'), 'saved to the file and to the preview copy');
r = await call('POST', '/events/pages/admin/save' + K, { isNew: true, entry: { slug: 'frunk', name: 'Again', title: 'Again' } });
ok(r.status === 400 && /already/.test(r.body.message), 'duplicate slug refused');
r = await call('POST', '/events/pages/admin/save' + K, { entry: { slug: 'frunk', name: 'Frunk', title: 'Frunk or Treat UK v2', endDate: '2026-10-30', startDate: '2026-10-31' } });
ok(r.status === 400 && /before/.test(r.body.message), 'end before start refused');
r = await call('POST', '/events/pages/admin/save' + K, { entry: { slug: 'frunk', name: 'Frunk', title: 'Frunk or Treat UK v2' } });
ok(r.status === 200 && file.events[0].title.endsWith('v2') && file.events[0].draft === true, 'update keeps draft state');
r = await call('GET', '/events/pages/admin' + K);
ok(r.status === 200 && r.body.events.length === 1, 'list is read live');
r = await call('POST', '/events/pages/admin/action' + K, { action: 'publish-now', slug: 'frunk', from: { publish: '', draft: true } });
ok(r.status === 200 && file.events[0].publish && !file.events[0].draft, 'publish now');
r = await call('POST', '/events/pages/admin/action' + K, { action: 'delete', slug: 'frunk', from: { publish: file.events[0].publish, draft: false } });
ok(r.status === 400 && /live/.test(r.body.message), 'cannot delete a live event');
r = await call('POST', '/events/pages/admin/action' + K, { action: 'draft', slug: 'frunk', from: { publish: file.events[0].publish, draft: false } });
ok(r.status === 200 && file.events[0].draft && !file.events[0].publish, 'back to draft');
r = await call('POST', '/events/pages/admin/action' + K, { action: 'schedule', slug: 'frunk', date: '2020-01-01', from: { publish: '', draft: true } });
ok(r.status === 400, 'schedule in the past refused');
// preview flow
r = await call('POST', '/events/pages/admin/preview-link', { slug: 'frunk' });
ok(r.status === 401, 'preview link needs the admin key');
r = await call('POST', '/events/pages/admin/preview-link' + K, { slug: 'frunk' });
const link = r.body.token; ok(r.status === 200 && link, 'admin mints a link');
r = await call('POST', '/events/pages/preview/link', { slug: 'other', token: link });
ok(r.status === 400, 'link is for one event only');
r = await call('POST', '/events/pages/preview/link', { slug: 'frunk', token: link });
const access = r.body.token; ok(r.status === 200 && access && r.body.expires > Date.now() + 25 * 864e5, 'link swaps for a long access');
r = await call('POST', '/events/pages/preview/link', { slug: 'frunk', token: link });
ok(r.status === 400, 'link works once');
r = await call('GET', '/events/pages/preview/check?slug=frunk&token=' + access); ok(r.status === 200, 'access checks out');
r = await call('GET', '/events/pages/preview/check?slug=other&token=' + access); ok(r.status === 401, 'access is per event');
r = await call('GET', '/events/pages/preview/content?slug=frunk&token=' + access);
ok(r.status === 200 && r.body.entry.title.endsWith('v2'), 'preview content is the saved copy');
r = await call('GET', '/events/pages/preview/content?slug=frunk&token=nope-nope-nope-nope'); ok(r.status === 401, 'no content without access');
// images
const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
r = await call('POST', '/events/pages/admin/image?slug=frunk&key=secret', jpg, true);
ok(r.status === 200 && /\/events\/frunk\/[a-f0-9]+\.jpg$/.test(r.body.url) && Object.keys(env.GALLERY_BUCKET.objects).length === 1, 'jpeg stored in R2');
r = await call('POST', '/events/pages/admin/image?slug=frunk&key=secret', new Uint8Array([1, 2, 3, 4]), true);
ok(r.status === 400, 'non-image refused');
r = await call('POST', '/events/pages/admin/image?slug=frunk', jpg, true); ok(r.status === 401, 'image needs the key');
// shared viewers: emailed code
const lastMail = () => env.SEND_EMAIL.sent[env.SEND_EMAIL.sent.length - 1] || '';
r = await call('POST', '/events/pages/preview/request', { email: 'not-an-email', slug: 'frunk' });
ok(r.status === 400, 'request needs a real email');
r = await call('POST', '/events/pages/preview/request', { email: 'friend@example.com', slug: 'no-such-event' });
ok(r.status === 200 && env.SEND_EMAIL.sent.length === 0, 'no email for an event that does not exist');
r = await call('POST', '/events/pages/preview/request', { email: 'friend@example.com', slug: 'frunk' });
ok(r.status === 200 && env.SEND_EMAIL.sent.length === 1, 'code emailed for a real event');
let mail = lastMail();
const code = (mail.match(/\r\n\r\n(\d{6})\r\n/) || [])[1];
const linkTok = (mail.match(/event\.html\?e=frunk&preview=([A-Za-z0-9_-]+)/) || [])[1];
ok(code && linkTok, 'email has a code and a link to the event page');
ok(/subscribes you to MT3UK/.test(mail) && /7 days/.test(mail), 'email says it subscribes them and how long it lasts');
r = await call('POST', '/events/pages/preview/verify', { email: 'friend@example.com', slug: 'frunk', code: '000000' });
ok(r.status === 400, 'wrong code refused');
r = await call('POST', '/events/pages/preview/verify', { email: 'friend@example.com', slug: 'other', code });
ok(r.status === 400, 'code is for one event only');
r = await call('POST', '/events/pages/preview/verify', { email: 'friend@example.com', slug: 'frunk', code });
const viewer = r.body.token;
const memberSession = r.body.session;
ok(r.status === 200 && viewer && r.body.joined === true && r.body.session && r.body.expires > Date.now() + 6 * 864e5, 'right code opens it for a week, joins and signs in');
r = await call('GET', '/events/pages/preview/check?slug=frunk&token=' + viewer);
ok(r.status === 200 && r.body.admin === false, 'viewer access checks out and is not admin');
r = await call('GET', '/events/pages/preview/check?slug=frunk&token=' + access);
ok(r.status === 200 && r.body.admin === true, 'admin access is marked admin');
r = await call('GET', '/events/pages/preview/content?slug=frunk&token=' + viewer);
ok(r.status === 200 && r.body.entry, 'viewer sees the saved copy');
r = await call('POST', '/events/pages/preview/verify', { email: 'friend@example.com', slug: 'frunk', code });
ok(r.status === 400, 'a code works once');
// signed-in members (for example after a passkey) and the admin viewer
r = await call('POST', '/events/pages/preview/session', { slug: 'frunk' });
ok(r.status === 401, 'a session is needed to open a preview with one');
r = await call('POST', '/events/pages/preview/session', { slug: 'frunk' }, false, { 'X-Session-Token': 'not-a-session' });
ok(r.status === 401, 'a bad session is refused');
r = await call('POST', '/events/pages/preview/session', { slug: 'no-such-event' }, false, { 'X-Session-Token': memberSession });
ok(r.status === 404, 'a session cannot open an event that does not exist');
r = await call('POST', '/events/pages/preview/session', { slug: 'frunk' }, false, { 'X-Session-Token': memberSession });
ok(r.status === 200 && r.body.token && r.body.admin === undefined, 'a signed-in member opens the event preview');
r = await call('GET', '/events/pages/preview/check?slug=frunk&token=' + r.body.token);
ok(r.status === 200 && r.body.admin === false, 'that access is a viewer, not admin');
r = await call('POST', '/interviews/preview/session', { slug: 'richard' }, false, { 'X-Session-Token': memberSession });
ok(r.status === 200 && r.body.token, 'a signed-in member opens an interview preview');
r = await call('POST', '/interviews/preview/session', { slug: 'richard' });
ok(r.status === 401, 'an interview preview needs a session too');
r = await call('POST', '/admin/viewer-token', {});
ok(r.status === 401, 'the admin viewer token needs the admin key');
r = await call('POST', '/admin/viewer-token' + K, {});
const adminViewer = r.body.token;
ok(r.status === 200 && adminViewer && r.body.expires > Date.now() + 25 * 864e5, 'admin key mints a month-long viewer token');
r = await call('GET', '/admin/viewer-check?token=' + adminViewer); ok(r.status === 200, 'the admin viewer token checks out');
r = await call('GET', '/admin/viewer-check?token=' + 'x'.repeat(40)); ok(r.status === 401, 'a made-up token does not');
env.ADMIN_KEY = 'rotated';
r = await call('GET', '/admin/viewer-check?token=' + adminViewer); ok(r.status === 401, 'changing the admin key ends every admin viewer token');
env.ADMIN_KEY = 'secret';
// the emailed link
kv.delete('event-preview-cooldown:frunk:friend@example.com');
await call('POST', '/events/pages/preview/request', { email: 'friend@example.com', slug: 'frunk' });
mail = lastMail();
const link2 = (mail.match(/event\.html\?e=frunk&preview=([A-Za-z0-9_-]+)/) || [])[1];
ok(!/subscribes you to MT3UK/.test(mail), 'members are not told they are being subscribed again');
r = await call('POST', '/events/pages/preview/link', { slug: 'frunk', token: link2 });
ok(r.status === 200 && r.body.token && r.body.session, 'the emailed link opens it');
r = await call('POST', '/events/pages/preview/link', { slug: 'frunk', token: link2 });
ok(r.status === 400, 'the emailed link works once');
// admin sees who opened it, and can revoke
r = await call('GET', '/events/pages/admin/preview');
ok(r.status === 401, 'previews list needs the admin key');
r = await call('GET', '/events/pages/admin/preview' + K);
ok(r.status === 200 && r.body.opened.length === 1 && r.body.opened[0].email === 'friend@example.com' && r.body.opened[0].opens === 3 && r.body.opened[0].joined === true, 'opening is logged once per email with a count');
r = await call('POST', '/events/pages/admin/preview' + K, { action: 'revoke', email: 'friend@example.com', slug: 'frunk' });
ok(r.status === 200 && r.body.revoked.length === 1, 'revoke');
r = await call('GET', '/events/pages/preview/check?slug=frunk&token=' + viewer);
ok(r.status === 401, 'revoking ends an open preview straight away');
r = await call('GET', '/events/pages/preview/check?slug=frunk&token=' + access);
ok(r.status === 200, 'revoking a viewer does not touch the admin preview');
kv.delete('event-preview-cooldown:frunk:friend@example.com');
r = await call('POST', '/events/pages/preview/request', { email: 'friend@example.com', slug: 'frunk' });
ok(r.status === 403, 'a revoked email cannot ask for a new code');
r = await call('POST', '/events/pages/admin/preview' + K, { action: 'restore', email: 'friend@example.com', slug: 'frunk' });
ok(r.status === 200 && r.body.revoked.length === 0, 'restore');
r = await call('POST', '/events/pages/admin/preview' + K, { action: 'revoke', email: 'bad', slug: 'frunk' });
ok(r.status === 400, 'revoke needs a real email');
r = await call('POST', '/events/pages/admin/action' + K, { action: 'delete', slug: 'frunk', from: { publish: '', draft: true } });
ok(r.status === 200 && file.events.length === 0 && !kv.has('event-page-draft:frunk'), 'delete a draft');
