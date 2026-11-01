// The /share/add route: the link preview names the car, the page forwards to the car's Add page,
// and a missing or odd car id still gives a working page. Run with: node tests/share_add_check.mjs
import fs from 'node:fs';
// The worker imports Cloudflare-only modules, so take the share route's functions from its source, as the event-worker check does.
const src = fs.readFileSync(new URL('../workers/vote-worker.js', import.meta.url), 'utf8');
// Pull one top-level function out of the source by matching its braces.
function grabFunction(name) {
  let start = src.indexOf('function ' + name + '(');
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
const code = ['carRecordKey', 'getCarRecord', 'handleShareAdd'].map(grabFunction).join('\n');
const api = new Function(code + '\nreturn { handleShareAdd, getCarRecord };')();

const records = {
  'gallery/cars/abc123.json': JSON.stringify({ id: 'abc123', name: 'PROJECTILE <3 "quick"' }),
};
const env = {
  GALLERY_BUCKET: { get: async (key) => (records[key] ? { json: async () => JSON.parse(records[key]) } : null) },
  VOTES: { get: async () => null, put: async () => {}, delete: async () => {} },
};
const ask = async (path) => {
  const res = await api.handleShareAdd(new Request('https://laps.mt3uk.com' + path), env);
  return { status: res.status, type: res.headers.get('Content-Type'), html: await res.text() };
};
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.error('FAIL: ' + msg); } else console.log('ok: ' + msg); };

const car = await ask('/share/add?car=abc123');
check(car.status === 200 && /text\/html/.test(car.type), 'car link returns an HTML page');
check(car.html.includes('<title>Add a session: PROJECTILE &lt;3 &quot;quick&quot; | Laps by MT3UK</title>'), 'title names the car, escaped');
check(car.html.includes('og:title'), 'has an og:title for link previews');
check(car.html.includes('/track.html?add=1&car=abc123'), 'forwards to the Add page for the car');
check(!car.html.includes('owner') && !car.html.includes('@'), 'shows no owner details');

const unknown = await ask('/share/add?car=nope');
check(unknown.status === 200 && unknown.html.includes('<title>Add a session | Laps by MT3UK</title>'), 'unknown car gives the generic page');
check(unknown.html.includes('location.replace("/track.html?add=1")'), 'unknown car forwards to the plain Add page');

const odd = await ask('/share/add?car=' + encodeURIComponent('<script>x</script>'));
check(odd.status === 200 && !odd.html.includes('<script>x</script>'), 'an odd car id is not written into the page');

const none = await ask('/share/add');
check(none.status === 200 && none.html.includes('/track.html?add=1"'), 'no car id still gives a working page');

console.log(failed ? failed + ' failed' : 'all share add checks passed');
process.exit(failed ? 1 : 0);
