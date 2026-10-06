// Run by tests/test_laps_signin.py: signing in and joining from mt3uk.com and from laps.mt3uk.com, for new people,
// MT3UK members and Laps-only accounts, through the real worker with a fake KV store and a fake mailer, and the
// admin's settings (/laps/signin/admin). WORKER_MODULE is a copy of the worker that node can load.
const mod = await import(process.env.WORKER_MODULE);
const worker = mod.default;
const kv = new Map(), meta = new Map();
const sent = [];
const env = {
  ADMIN_KEY: 'secret',
  VOTES: {
    get: async k => kv.has(k) ? kv.get(k) : null,
    getWithMetadata: async k => ({ value: kv.has(k) ? kv.get(k) : null, metadata: meta.get(k) || null }),
    put: async (k, v, o) => { kv.set(k, v); if (o && o.metadata) meta.set(k, o.metadata); },
    delete: async k => { kv.delete(k); meta.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true })
  },
  SEND_EMAIL: { send: async m => { sent.push(m.raw); } }
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
let ip = 0;
const call = async (method, path, body) => {
  const init = { method, headers: { 'CF-Connecting-IP': '10.0.0.' + (++ip) } };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await worker.fetch(new Request('https://w.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
// The last email: who it is from, its subject, its link and its code.
const mail = () => {
  const raw = sent[sent.length - 1] || '';
  const header = n => ((new RegExp('^' + n + ': (.*)$', 'm')).exec(raw) || [])[1] || '';
  const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  return { raw, from: header('From'), subject: header('Subject'), body, link: (/https:\/\/\S+token=\S+/.exec(body) || [''])[0], code: (/^\d{6}$/m.exec(body) || [''])[0] };
};
const tokenOf = link => new URL(link).searchParams.get('token');

const M = 'member@example.com';
kv.set('subscriber:' + M, '[]');

// ---- An MT3UK member signing in on mt3uk.com: as before ----
let r = await call('POST', '/my-builds/request-link', { email: M });
let m = mail();
ok(r.body.success && /MT3UK member/.test(r.body.message), 'mt3uk.com: the usual reply');
ok(m.from === 'MT3UK <hello@mt3uk.com>' && /^Your MT3UK sign-in code: \d{6}$/.test(m.subject), 'mt3uk.com: the MT3UK email (' + m.subject + ')');
ok(m.link.startsWith('https://mt3uk.com/my-builds.html?token='), 'mt3uk.com: the link goes to My Garage on mt3uk.com, as before');

// ---- The same member signing in on Laps ----
r = await call('POST', '/my-builds/request-link', { email: M, site: 'laps', next: '/track.html?add=1' });
m = mail();
ok(/Laps or MT3UK account/.test(r.body.message), 'Laps: the reply talks about Laps');
ok(m.from === 'Laps by MT3UK <hello@mt3uk.com>' && /^Your Laps sign-in code: \d{6}$/.test(m.subject), 'Laps: from Laps by MT3UK, a Laps subject (' + m.subject + ')');
ok(m.link.startsWith('https://laps.mt3uk.com/laps-signin.html?token=') && new URL(m.link).searchParams.get('next') === '/track.html?add=1', 'Laps: the link comes back to laps.mt3uk.com, to the page they were on (' + m.link + ')');
ok(/sign in to Laps by MT3UK/.test(m.body) && !/My Garage/.test(m.body), 'Laps: the email talks about Laps, not My Garage');
r = await call('GET', '/my-builds/session?token=' + tokenOf(m.link));
ok(r.body.success && r.body.email === M && r.body.joined === '', 'Laps: the link signs the member in (not a new account)');
r = await call('POST', '/my-builds/request-link', { email: M, site: 'laps', next: '/track.html' });
m = mail();
r = await call('POST', '/my-builds/verify-code', { email: M, code: m.code });
ok(r.body.success && r.body.session, 'Laps: the code works too');
for (const bad of ['/my-builds.html', 'https://evil.example/track.html', '//evil.example/track.html', '/track.html extra']) {
  await call('POST', '/my-builds/request-link', { email: M, site: 'laps', next: bad });
  ok(!new URL(mail().link).searchParams.has('next'), 'Laps: a page that is not a Laps page is not carried (' + bad + ')');
}
let before = sent.length;
r = await call('POST', '/my-builds/request-link', { email: 'nobody@example.com', site: 'laps' });
ok(r.body.success && sent.length === before, 'Laps: an unknown email gets the same reply and no email');

// ---- Someone new joining on Laps, MT3UK membership on (the default) ----
const N = 'new@example.com';
r = await call('POST', '/my-builds/join', { email: N, firstName: 'Nia', lastName: 'Jones', site: 'laps', next: '/track.html' });
m = mail();
ok(r.body.success && /^Welcome to Laps by MT3UK: your code is \d{6}$/.test(m.subject) && m.from.startsWith('Laps by MT3UK'), 'Laps join: the Laps welcome email (' + m.subject + ')');
ok(m.link.startsWith('https://laps.mt3uk.com/laps-signin.html?token=') && /works on MT3UK too/.test(m.body), 'Laps join: back to Laps, and says the account works on MT3UK too');
ok(/Laps is in early preview/.test(m.body), 'Laps join: the welcome says Laps is in early preview');
let adminBefore = sent.length;
r = await call('GET', '/my-builds/session?token=' + tokenOf(m.link));
ok(r.body.success && r.body.joined === 'mt3uk' && kv.has('subscriber:' + N) && !kv.has('laps-account:' + N), 'Laps join: an MT3UK member is made');
const profileOf = e => JSON.parse(kv.get('profile:' + e) || '{}');
ok(profileOf(N).nickname === 'NJones', 'Laps join: their nickname is their first initial and last name (' + profileOf(N).nickname + ')');
const access = () => JSON.parse(kv.get('track-access') || '{}');
const waiting = e => (access().pending || []).find(x => x.email === e);
ok(waiting(N) && waiting(N).signedUp === true && r.body.access === 'pending', 'Laps join: they are put on the early access list, and the page is told');
ok(sent.slice(adminBefore).some(raw => /Subject: New Laps sign-up waiting for early access/.test(raw)), 'Laps join: the admin is told');
const signups = () => JSON.parse(kv.get('laps-signups') || '[]');
const signup = e => signups().find(x => x.email === e);
ok(signup(N) && signup(N).waiting === true && signup(N).account === 'mt3uk' && signup(N).name === 'Nia Jones', 'Laps join: listed under New Laps sign-ups, waiting for early access');
ok(!sent.slice(adminBefore).some(raw => /Subject: New Laps sign-up: /.test(raw)), 'Laps join: no second email while the early access request covers it');
// Another N Jones gets NJones2; a short name is padded to three characters.
await call('POST', '/my-builds/join', { email: 'nat@example.com', firstName: 'Nat', lastName: 'Jones', site: 'laps' });
await call('GET', '/my-builds/session?token=' + tokenOf(mail().link));
ok(profileOf('nat@example.com').nickname === 'NJones2', 'Laps join: a nickname already taken gets a number (' + profileOf('nat@example.com').nickname + ')');
await call('POST', '/my-builds/join', { email: 'ao@example.com', firstName: 'Al', lastName: "O'", site: 'laps' });
await call('GET', '/my-builds/session?token=' + tokenOf(mail().link));
ok(/^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/.test(profileOf('ao@example.com').nickname || ''), 'Laps join: a short name still makes a valid nickname (' + profileOf('ao@example.com').nickname + ')');
// Joining on mt3uk.com is unchanged: no access request, no nickname chosen for them.
await call('POST', '/my-builds/join', { email: 'main@example.com', firstName: 'Mo', lastName: 'Main' });
r = await call('GET', '/my-builds/session?token=' + tokenOf(mail().link));
ok(r.body.joined === 'mt3uk' && !waiting('main@example.com'), 'mt3uk.com join: no early access request');
ok(profileOf('main@example.com').nickname === 'MMain', 'mt3uk.com join: the nickname is their first initial and last name too (' + profileOf('main@example.com').nickname + ')');
ok(!signup('main@example.com'), 'mt3uk.com join: not listed as a Laps sign-up');

// ---- The admin's settings ----
r = await call('GET', '/laps/signin/admin');
ok(r.status === 401, 'the settings need the admin key');
r = await call('GET', '/laps/signin');
ok(r.body.success && r.body.separate === true, 'the public setting: Laps has its own sign-in to begin with');
r = await call('POST', '/laps/signin/admin?key=secret', { separate: true, mt3ukToo: false, signinIntro: 'Hello <b>racer</b>, sign in here:', joinIntro: '' });
ok(r.body.success && r.body.settings.mt3ukToo === false && r.body.settings.signinIntro === 'Hello  b racer /b , sign in here:' && r.body.lapsAccounts === 0, 'the admin saves them, the words cleaned (' + r.body.settings.signinIntro + ')');
await call('POST', '/my-builds/request-link', { email: M, site: 'laps' });
ok(mail().body.startsWith('Hello  b racer /b , sign in here:'), 'the admin\'s opening line starts the Laps sign-in email');

// ---- Someone new joining on Laps with MT3UK membership off: a Laps-only account ----
const L = 'laps@example.com';
r = await call('POST', '/my-builds/join', { email: L, firstName: 'Lou', lastName: 'Reed', site: 'laps' });
m = mail();
ok(!/works on MT3UK too/.test(m.body) && /Thanks for joining Laps by MT3UK/.test(m.body), 'Laps-only join: the built-in welcome, without the MT3UK line');
r = await call('POST', '/my-builds/verify-code', { email: L, code: m.code });
ok(r.body.success && kv.has('laps-account:' + L) && !kv.has('subscriber:' + L), 'Laps-only join: a Laps account is made, not an MT3UK member');
ok(JSON.parse(kv.get('profile:' + L) || '{}').firstName === 'Lou', 'Laps-only join: their name is kept');
ok(signup(L) && signup(L).account === 'laps', 'Laps-only join: listed as a Laps-only account');
r = await call('GET', '/laps/signin/admin?key=secret');
ok(r.body.lapsAccounts === 1, 'the panel counts the Laps-only account');
before = sent.length;
await call('POST', '/my-builds/request-link', { email: L, site: 'laps' });
ok(sent.length === before + 1 && mail().link.includes('laps.mt3uk.com'), 'Laps-only: they can sign in on Laps');
before = sent.length;
await call('POST', '/my-builds/request-link', { email: L });
ok(sent.length === before, 'Laps-only: not on mt3uk.com (no email sent)');
kv.delete('join-cooldown:' + L); // a minute later
await call('POST', '/my-builds/join', { email: L, firstName: 'Lou', lastName: 'Reed' });
m = mail();
ok(/Welcome to MT3UK/.test(m.subject) && m.link.startsWith('https://mt3uk.com/signin.html?token='), 'Laps-only: joining on mt3uk.com sends the MT3UK welcome');
r = await call('GET', '/my-builds/session?token=' + tokenOf(m.link));
ok(r.body.joined === 'mt3uk' && kv.has('subscriber:' + L) && !kv.has('laps-account:' + L), 'Laps-only: joining MT3UK makes them a full member');

// ---- Laps open to all members: no early preview line, no request ----
kv.set('track-access', JSON.stringify(Object.assign(access(), { open: true })));
r = await call('GET', '/laps/signin');
ok(r.body.preview === false, 'the public setting says Laps is no longer a preview');
await call('POST', '/my-builds/join', { email: 'open@example.com', firstName: 'Ola', lastName: 'Open', site: 'laps' });
m = mail();
ok(!/early preview/.test(m.body), 'open: the welcome has no early preview line');
r = await call('GET', '/my-builds/session?token=' + tokenOf(m.link));
ok(r.body.access === 'approved' && !waiting('open@example.com'), 'open: they are in straight away, with no request');
ok(signup('open@example.com') && signup('open@example.com').waiting === false && signups()[0].email === 'open@example.com', 'open: listed first, not waiting');
ok(sent.some(raw => /Subject: New Laps sign-up: Ola Open/.test(raw) && /track-admin\.html#signin-wrap/.test(raw)), 'open: the admin is emailed the new sign-up');
r = await call('GET', '/laps/signups/admin');
ok(r.status === 401, 'the sign-ups list needs the admin key');
r = await call('GET', '/laps/signups/admin?key=secret');
ok(r.body.success && r.body.signups.length === signups().length && r.body.signups.length >= 4, 'the admin reads the list (' + r.body.signups.length + ')');
r = await call('POST', '/laps/signups/admin?key=secret', { clear: 'OPEN@example.com' });
ok(r.body.success && !signup('open@example.com') && signup(N), 'Clear takes one off the list');
r = await call('POST', '/laps/signups/admin?key=secret', { clear: 'all' });
ok(r.body.success && signups().length === 0 && kv.has('subscriber:' + N), 'Clear all empties it, the accounts kept');
kv.set('track-access', JSON.stringify(Object.assign(access(), { open: false })));

// ---- Separate Laps sign-in switched off: the MT3UK page and emails, still back to laps.mt3uk.com ----
await call('POST', '/laps/signin/admin?key=secret', { separate: false, mt3ukToo: true });
r = await call('GET', '/laps/signin');
ok(r.body.separate === false, 'the public setting says so');
await call('POST', '/my-builds/request-link', { email: M, site: 'laps', next: '/leaderboards.html' });
m = mail();
ok(m.from === 'MT3UK <hello@mt3uk.com>' && /MT3UK sign-in code/.test(m.subject), 'switched off: the MT3UK email');
ok(m.link.startsWith('https://laps.mt3uk.com/signin.html?token=') && new URL(m.link).searchParams.get('next') === '/leaderboards.html', 'switched off: the link still comes back to laps.mt3uk.com (' + m.link + ')');
