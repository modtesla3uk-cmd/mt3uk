// Run by tests/test_shop_sales.py: the units sold per product (GET /shop/sales) through the real worker, with a fake
// Shopify (the token, the product list and two pages of orders) and a fake KV store. WORKER_MODULE is a copy of the
// worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const env = {
  ADMIN_KEY: 'secret',
  SHOPIFY_CLIENT_ID: 'client-id',
  SHOPIFY_CLIENT_SECRET: 'client-secret',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async k => { kv.delete(k); }
  },
  SEND_EMAIL: { send: async () => {} }
};
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const orders1 = { orders: [
  { id: 1, financial_status: 'paid', cancelled_at: null, line_items: [{ product_id: 101, quantity: 2 }, { product_id: 102, quantity: 1 }], refunds: [] },
  { id: 2, financial_status: 'paid', cancelled_at: '2026-10-05T10:00:00Z', line_items: [{ product_id: 101, quantity: 5 }], refunds: [] }
] };
const orders2 = { orders: [
  { id: 3, financial_status: 'partially_refunded', cancelled_at: null, line_items: [{ product_id: 102, quantity: 3 }],
    refunds: [{ refund_line_items: [{ quantity: 1, line_item: { product_id: 102 } }] }] },
  { id: 4, financial_status: 'voided', cancelled_at: null, line_items: [{ product_id: 103, quantity: 4 }], refunds: [] }
] };
const products = { products: [
  { handle: 'master-cylinder-brace', id: 101 },
  { handle: 'black-mt3uk-tee-red-underline-super-soft', id: 102 },
  { handle: 'untouched-sticker', id: 103 }
] };

let tokenFails = false, shopifyCalls = [], tokenBody = '';
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  shopifyCalls.push(u);
  if (u.includes('/admin/oauth/access_token')) {
    tokenBody = String(init.body || '');
    if (tokenFails) return new Response('no', { status: 500 });
    return json({ access_token: 'tok-1' });
  }
  if (u.includes('products.json')) return json(products);
  if (u.includes('page_info=p2')) return json(orders2);
  if (u.includes('/admin/api/2026-10/orders.json')) {
    return json(orders1, 200, { Link: '<https://mt3uk.myshopify.com/admin/api/2026-10/orders.json?page_info=p2&limit=250>; rel="next"' });
  }
  return new Response('{}', { status: 404 });
};
const sales = async () => {
  const res = await worker.fetch(new Request('https://worker.test/shop/sales'), env, { waitUntil() {}, passThroughOnException() {} });
  return { status: res.status, body: await res.json() };
};

let r = await sales();
ok(r.status === 200 && r.body.success && r.body.source === 'shopify', 'the sales come from Shopify');
ok(r.body.byHandle['master-cylinder-brace'] === 2, 'units sold are counted per product: the brace sold 2 (the cancelled order is left out)');
ok(r.body.byHandle['black-mt3uk-tee-red-underline-super-soft'] === 3, 'refunds come off: the tee sold 1 + 3 - 1 = 3');
ok(!('untouched-sticker' in r.body.byHandle), 'a voided order is left out, so the sticker has no count');
ok(r.body.since === '2026-10-01', 'the count runs from 1 October');
ok(tokenBody.includes('grant_type=client_credentials') && tokenBody.includes('client_id=client-id') && tokenBody.includes('client_secret=client-secret'), 'the token is asked for with the client ID and secret');
ok(shopifyCalls.some(u => u.includes('created_at_min=2026-10-01T00:00:00%2B01:00')), 'the orders are read from 1 October, UK time');
ok(shopifyCalls.some(u => u.includes('page_info=p2')), 'every page of orders is read');

const before = shopifyCalls.length;
r = await sales();
ok(r.body.source === 'shopify' && r.body.byHandle['master-cylinder-brace'] === 2, 'the answer is kept, and comes back the same');
ok(shopifyCalls.length === before, 'within the hour Shopify is not asked again');

// Shopify cannot be read and there is no kept answer: the page falls back to its file.
kv.clear();
tokenFails = true;
r = await sales();
ok(r.status === 200 && r.body.success && r.body.source === 'manual', 'with Shopify down and nothing kept, the page is told to use the manual file');

// Shopify cannot be read but a kept answer is there (an old one): it is shown rather than the manual file.
kv.set('shop-sales', JSON.stringify({ success: true, source: 'shopify', since: '2026-10-01', updated: '2026-10-20T10:00:00.000Z', byHandle: { 'master-cylinder-brace': 2 } }));
r = await sales();
ok(r.body.source === 'shopify' && r.body.byHandle['master-cylinder-brace'] === 2, 'with Shopify down, the last good count is shown');

// No client secret set: the same fallback, and nothing is asked of Shopify.
kv.clear();
tokenFails = false;
const noSecret = { ...env, SHOPIFY_CLIENT_SECRET: '' };
shopifyCalls = [];
const res = await worker.fetch(new Request('https://worker.test/shop/sales'), noSecret, { waitUntil() {}, passThroughOnException() {} });
const body = await res.json();
ok(body.source === 'manual' && !shopifyCalls.some(u => u.includes('access_token')), 'without the secret, Shopify is not asked and the manual file is used');
