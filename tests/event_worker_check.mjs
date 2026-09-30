// Run by tests/test_event_worker.py: exercises the worker's event page routes with a fake
// KV store, image bucket and GitHub. WORKER_MODULE is a copy of the worker that node can load.
const worker = (await import(process.env.WORKER_MODULE)).default;
const kv = new Map(); 
const env = {
  ADMIN_KEY: 'secret',
  VOTES: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); }, getWithMetadata: async k => ({ value: kv.get(k) || null }) },
  GALLERY_BUCKET: { objects: {}, put: async function (k, v, o) { this.objects[k] = { size: v.length, o }; } },
  GITHUB_TOKEN: 'x'
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
const call = async (method, path, body, raw) => {
  const init = { method, headers: raw ? {} : { 'Content-Type': 'application/json' } };
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
r = await call('POST', '/events/pages/admin/action' + K, { action: 'delete', slug: 'frunk', from: { publish: '', draft: true } });
ok(r.status === 200 && file.events.length === 0 && !kv.has('event-page-draft:frunk'), 'delete a draft');
