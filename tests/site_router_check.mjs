// Checks site-router.js: /share/add goes to the vote worker, everything else to the assets.
import router from '../site-router.js';

const calls = [];
const env = {
  VOTE: { fetch: async (req) => { calls.push(['VOTE', new URL(req.url).pathname]); return new Response('vote'); } },
  ASSETS: { fetch: async (req) => { calls.push(['ASSETS', new URL(req.url).pathname]); return new Response('asset'); } },
};
let failed = 0;
const ok = (cond, label) => { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) failed++; };

for (const path of ['/share/add?car=abc', '/share/add']) {
  calls.length = 0;
  const res = await router.fetch(new Request('https://laps.mt3uk.com' + path), env);
  ok(calls.length === 1 && calls[0][0] === 'VOTE', 'share add goes to the vote worker: ' + path);
  ok(await res.text() === 'vote', 'share add answer is the vote worker answer: ' + path);
}
for (const path of ['/', '/laps.html', '/share/section/laps.html', '/share/addition.html', '/track.html']) {
  calls.length = 0;
  const res = await router.fetch(new Request('https://mt3uk.com' + path), env);
  ok(calls.length === 1 && calls[0][0] === 'ASSETS', 'static path goes to the assets: ' + path);
  ok(await res.text() === 'asset', 'static path answer is the asset: ' + path);
}
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all site router checks passed');
