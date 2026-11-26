// Run by tests/test_shop_checkout.py: the Shop checkout through the real worker, with a fake catalogue (the Shopify feed)
// and a fake Stripe, and a fake KV store. WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map();
const CATALOGUE = {
  products: [
    { handle: 'black-mt3uk-tee-red-underline-super-soft', title: 'Black MT3UK TEE - Red underline', variants: [{ id: 1001, title: 'M', price: '24.99', available: true }] },
    { handle: 'mt3uk-fire-red-hoodie-yellow-line', title: 'MT3UK Fire Red Hoodie', variants: [{ id: 2001, title: 'M', price: '29.99', available: true }] },
    { handle: 'mt3uk-official-stickers-white-red-line-3-pack', title: 'MT3UK Stickers', variants: [{ id: 3001, title: 'Default Title', price: '8.50', available: false }] }
  ]
};
let stripeReply = { url: 'https://checkout.stripe.test/c/pay/abc' };
let stripeStatus = 200;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('shopify') || String(url).includes('products.json')) return new Response(JSON.stringify(CATALOGUE), { status: 200 });
  if (String(url).includes('api.stripe.com')) {
    sent.push(new URLSearchParams(init.body));
    if (String(url).includes('/coupons')) return new Response(JSON.stringify({ id: 'coupon_test' }), { status: 200 });
    return new Response(JSON.stringify(stripeReply), { status: stripeStatus });
  }
  return new Response('{}', { status: 200 });
};
const env = {
  ADMIN_KEY: 'secret',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  VOTES: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
  SEND_EMAIL: { send: async () => {} }
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const checkout = async (body, e = env) => {
  const r = await worker.fetch(new Request('https://worker.test/shop/checkout', { method: 'POST', body: JSON.stringify(body) }), e, ctx);
  return { status: r.status, body: await r.json() };
};
const lastStripe = () => sent[sent.length - 1];

let r = await checkout({ country: 'GB', items: [] });
ok(r.status === 400, 'an empty basket is refused');
r = await checkout({ country: 'US', items: [{ variantId: 1001, qty: 1 }] });
ok(r.status === 400, 'a country we do not ship to is refused');
r = await checkout({ country: 'GB', items: [{ variantId: 3001, qty: 1 }] });
ok(r.status === 400 && /sold out/.test(r.body.message), 'a sold-out item is refused');
r = await checkout({ country: 'GB', items: [{ variantId: 9999, qty: 1 }] });
ok(r.status === 400, 'an unknown item is refused');

r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 2 }] });
ok(r.status === 200 && r.body.url === stripeReply.url, 'a UK basket returns the Stripe checkout address');
ok(r.body.summary.subtotal === 4998 && r.body.summary.shipping.amount === 499 && r.body.summary.total === 5497, 'UK: £49.98 plus £4.99 standard shipping');
let s = lastStripe();
ok(s.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]') === '499', 'the shipping option sent to Stripe is £4.99');
ok(s.get('shipping_address_collection[allowed_countries][0]') === 'GB', 'the address is collected for the UK only');
ok(s.get('line_items[0][price_data][unit_amount]') === '2499' && s.get('line_items[0][quantity]') === '2', 'the line goes to Stripe at the pence price and quantity');

r = await checkout({ country: 'GB', items: [{ variantId: 2001, qty: 4 }] });
ok(r.body.summary.shipping.amount === 0, 'UK orders of £78.98 or more ship free');

r = await checkout({ country: 'IE', items: [{ variantId: 1001, qty: 1 }] });
ok(r.body.summary.shipping.amount === 1200 && r.body.summary.weight === 0.75, 'Ireland: one tee (0.75 lb packed, with SellShirts packaging) is in the £12 band');
ok(lastStripe().get('shipping_address_collection[allowed_countries][0]') === 'IE', 'the address is collected for Ireland only');
ok(/Customs/.test(lastStripe().get('custom_text[shipping_address][message]') || ''), 'the Irish checkout says customs may be payable on delivery');

r = await checkout({ country: 'IE', items: [{ variantId: 1001, qty: 2 }] });
ok(r.body.summary.shipping.amount === 1700 && r.body.summary.weight === 1.5, 'Ireland: two tees (1.5 lb) move up to the £17 band');

r = await checkout({ country: 'IE', items: [{ variantId: 2001, qty: 1 }, { variantId: 1001, qty: 1 }] });
ok(r.body.summary.shipping.amount === 1700 && r.body.summary.weight === 2.25, 'Ireland: a hoodie (1.5 lb packed) and a tee is £17');
r = await checkout({ country: 'IE', items: [{ variantId: 2001, qty: 1 }] });
ok(r.body.summary.weight === 1.5 && r.body.summary.shipping.amount === 1700, 'Ireland: one hoodie is 1.5 lb packed, so £17');
r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 1 }], utm: { source: 'mt3uk_shop', medium: 'internal', campaign: 'brace_order' } });
s = lastStripe();
ok(/utm_campaign=brace_order/.test(s.get('success_url')) && /utm_source=mt3uk_shop/.test(s.get('success_url')) && /order=thanks/.test(s.get('success_url')), 'the UTM tags reach the thank-you address sent to Stripe');
ok(/utm_campaign=brace_order/.test(s.get('cancel_url')) && /#merch$/.test(s.get('cancel_url')), 'the UTM tags reach the back-to-shop address too');
ok(s.get('metadata[utm_campaign]') === 'brace_order' && s.get('metadata[utm_medium]') === 'internal', 'the UTM tags are kept on the Stripe session as metadata');
r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 1 }], utm: { source: 'x', medium: 'y', campaign: 'bad value; drop' } });
ok(lastStripe().get('metadata[utm_campaign]') === 'live_merch', 'a campaign with spaces or symbols is replaced with the default, not sent on');

await worker.fetch(new Request('https://worker.test/shop/discounts/admin?key=secret', { method: 'POST', body: JSON.stringify({ byHandle: { 'black-mt3uk-tee-red-underline-super-soft': 20 } }) }), env, ctx);
r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 1 }] });
ok(r.body.summary.lines[0].unit === 1999 && r.body.summary.lines[0].percent === 20, 'a discount set on the Shop panel is taken off the price in the basket (£24.99 less 20% is £19.99)');
s = lastStripe();
ok(s.get('line_items[0][price_data][unit_amount]') === '2499' && s.get('discounts[0][coupon]') === 'coupon_test', 'Stripe gets the item at its full £24.99 with a discount, so the page shows the saving');
const coupon = sent.filter(p => p.get('amount_off') !== null).pop();
ok(coupon && coupon.get('amount_off') === '500' && coupon.get('currency') === 'gbp' && coupon.get('duration') === 'once', 'the saving is one £5.00 once-only coupon');
r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 1 }] });
s = lastStripe();
ok(s.get('discounts[0][coupon]') === 'coupon_test' && s.get('line_items[0][price_data][unit_amount]') === '2499', 'the same basket is sent again with its coupon');

// The homepage offer's percentage is charged for an item in a live offer with no discount of its own, and not outside its dates.
await worker.fetch(new Request('https://worker.test/shop/discounts/admin?key=secret', { method: 'POST', body: JSON.stringify({ byHandle: {} }) }), env, ctx);
const offerOn = (start, end) => kv.set('shop-home', JSON.stringify({ offer: { on: true, heading: 'Autumn', percent: 40, code: 'MT3UKMC40', start, end, items: [{ id: 'black-mt3uk-tee-red-underline-super-soft', name: 'MT3UK Tee' }] } }));
offerOn('2000-01-01', '2999-12-31');
r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 1 }] });
ok(r.body.summary.lines[0].unit === 1499 && r.body.summary.lines[0].percent === 40, 'a live homepage offer takes its percentage off an item in it (£24.99 less 40% is £14.99)');
s = lastStripe();
ok(s.get('line_items[0][price_data][unit_amount]') === '2499' && sent.filter(p => p.get('amount_off') !== null).pop().get('amount_off') === '1000', 'the offer saving (£10.00) is the coupon, the item is at £24.99');
offerOn('2000-01-01', '2000-01-02');
r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 1 }] });
ok(r.body.summary.lines[0].unit === 2499 && r.body.summary.lines[0].percent === 0, 'an offer that has ended is not charged');
kv.delete('shop-home');

stripeStatus = 500; stripeReply = { error: 'boom' };
r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 1 }] });
ok(r.status === 502, 'a Stripe failure is reported, not sent on');
stripeStatus = 200; stripeReply = { url: 'https://checkout.stripe.test/c/pay/abc' };

r = await checkout({ country: 'GB', items: [{ variantId: 1001, qty: 1 }] }, { ...env, STRIPE_SECRET_KEY: '' });
ok(r.status === 503, 'without the Stripe secret the shop says payments are not set up, and sends nothing');
