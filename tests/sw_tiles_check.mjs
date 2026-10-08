// Run by tests/test_laps_offline.py: the map tile handling in sw.js (Offline mode), with sw.js loaded into a stand-in
// for a service worker: a fake Cache Storage, fake fetch, and the handlers it registers.
import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

function build() {
  const stores = new Map();
  const handlers = {};
  const calls = [];
  let online = true;
  const mkCache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const key = r => typeof r === 'string' ? r : r.url;
    return {
      match: async r => m.get(key(r)),
      put: async (r, res) => { m.set(key(r), res); },
      delete: async r => m.delete(key(r)),
      keys: async () => [...m.keys()].map(url => ({ url })),
      addAll: async () => {}
    };
  };
  const caches = {
    open: async n => mkCache(n),
    has: async n => stores.has(n),
    delete: async n => stores.delete(n),
    keys: async () => [...stores.keys()],
    match: async () => undefined
  };
  const fakeFetch = async (r, opts) => {
    const url = typeof r === 'string' ? r : r.url;
    calls.push({ url, mode: (opts && opts.mode) || '', asked: !opts });
    if (!online) throw new TypeError('Failed to fetch');
    return new Response('tile', { status: 200 });
  };
  const self = { location: { origin: 'https://laps.test' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() } };
  const ctx = vm.createContext({ self, caches, fetch: fakeFetch, URL, Request, Response, Promise, Object, Array, JSON, console });
  vm.runInContext(code, ctx);
  return { stores, handlers, calls, caches, setOnline: v => { online = v; } };
}
const TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/10937/32500';
const tileEvent = () => {
  let answer;
  const ev = { request: new Request(TILE), respondWith: p => { answer = p; } };
  return { ev, answer: () => answer };
};

{ // Offline mode off: the tile goes through exactly as the page asked, nothing kept.
  const w = build();
  const t = tileEvent();
  w.handlers.fetch(t.ev);
  const res = await t.answer();
  ok(res && res.status === 200, 'with Offline mode off a tile is fetched as normal');
  ok(w.calls.length === 1 && w.calls[0].asked, 'it is fetched exactly as the page asked');
  ok(!w.stores.has('mt3uk-laps-tiles-v1'), 'and nothing is kept');
}
{ // Offline mode on: fetched with CORS, kept, and served from the copy afterwards, also with no connection.
  const w = build();
  w.stores.set('mt3uk-laps-offline-v1', new Map());
  let t = tileEvent();
  w.handlers.fetch(t.ev);
  await t.answer();
  await new Promise(r => setTimeout(r, 20));
  ok(w.calls[0].mode === 'cors', 'with Offline mode on a tile is fetched with CORS');
  ok(w.stores.get('mt3uk-laps-tiles-v1').has(TILE), 'and kept');
  w.setOnline(false);
  const before = w.calls.length;
  t = tileEvent();
  w.handlers.fetch(t.ev);
  const res = await t.answer();
  ok(res && res.status === 200 && w.calls.length === before, 'a kept tile opens with no connection, without a request');
  const other = new Request(TILE.replace('10937', '10999'));
  let answer;
  w.handlers.fetch({ request: other, respondWith: p => { answer = p; } });
  let failed = false;
  try { await answer; } catch (e) { failed = true; }
  ok(failed, 'a tile not kept fails as it always did with no connection');
}
{ // Tiles fetched ahead for the member's sessions, through the page's message; only the tile host is accepted.
  const w = build();
  w.stores.set('mt3uk-laps-offline-v1', new Map());
  const sent = [];
  let waited;
  const port = { postMessage: m => sent.push(m) };
  const urls = [TILE, TILE.replace('10937', '10938'), 'https://evil.test/x', TILE];
  w.handlers.message({ data: { type: 'laps-offline-tiles', urls }, ports: [port], waitUntil: p => { waited = p; } });
  await waited;
  ok(sent[0] && sent[0].ok && sent[0].kept === 3 && sent[0].total === 3, 'tiles asked for ahead are kept, one is a repeat and another host is left out (' + JSON.stringify(sent[0]) + ')');
  ok((await w.caches.open('mt3uk-laps-tiles-v1').then(c => c.keys())).length === 2, 'two distinct tiles are in the copy');
  // Switching Offline mode off removes the pages and the maps.
  w.handlers.message({ data: { type: 'laps-offline-off' }, ports: [port], waitUntil: p => { waited = p; } });
  await waited;
  ok(!w.stores.has('mt3uk-laps-offline-v1') && !w.stores.has('mt3uk-laps-tiles-v1'), 'off removes the pages and the tiles');
}
{ // The old shell cache is cleaned up on activate, but the Laps copy and the tiles are left.
  const w = build();
  for (const n of ['mt3uk-shell-v9', 'mt3uk-laps-offline-v1', 'mt3uk-laps-tiles-v1', 'mt3uk-shell-v11']) w.stores.set(n, new Map());
  let waited;
  w.handlers.activate({ waitUntil: p => { waited = p; } });
  await waited;
  ok(!w.stores.has('mt3uk-shell-v9') && w.stores.has('mt3uk-laps-offline-v1') && w.stores.has('mt3uk-laps-tiles-v1'), 'activate keeps the Laps copy and the tiles and drops old shells');
}
{ // A newer script fetched online replaces the older kept copy of the same file, so an offline match cannot find the old one.
  const w = build();
  const laps = new Map([['https://laps.test/js/x.js?v=1', 'old']]);
  w.stores.set('mt3uk-laps-offline-v1', laps);
  w.stores.set('mt3uk-shell-v11', new Map([['https://laps.test/js/x.js?v=0', 'older']]));
  let answer;
  w.handlers.fetch({ request: new Request('https://laps.test/js/x.js?v=2'), respondWith: p => { answer = p; } });
  await answer;
  await new Promise(r => setTimeout(r, 20));
  ok([...laps.keys()].join() === 'https://laps.test/js/x.js?v=2', 'the kept copy of a script is replaced by the newer tag (' + [...laps.keys()].join() + ')');
  ok([...w.stores.get('mt3uk-shell-v11').keys()].join() === 'https://laps.test/js/x.js?v=2', 'and the shell copy keeps one tag only');
  // A device without Offline mode never gets a Laps copy made for it.
  const w2 = build();
  w2.handlers.fetch({ request: new Request('https://laps.test/js/x.js?v=2'), respondWith: p => { answer = p; } });
  await answer;
  await new Promise(r => setTimeout(r, 20));
  ok(!w2.stores.has('mt3uk-laps-offline-v1'), 'a device with Offline mode off gets no Laps copy');
}
