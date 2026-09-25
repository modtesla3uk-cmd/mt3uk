import { EmailMessage } from 'cloudflare:email';

const OWNER = 'modtesla3uk-cmd';
const REPO = 'mt3uk';
const BASE_BRANCH = 'main';
const FEATURED_PATH = 'data/featured.json';
const REVIEWS_PATH = 'data/reviews.json';
const GALLERY_PUBLIC_BASE_URL = 'https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev';
const MAX_GALLERY_PHOTOS = 3;
const GALLERY_SUBMIT_COOLDOWN_SECONDS = 60 * 60 * 24;
const VOTE_TTL_SECONDS = 60 * 60 * 24 * 3;
const REVIEW_PRODUCTS = ['tee', 'tee-yellow', 'stickers', 'brace', 'pads-street', 'pads-carbotech'];
const REVIEW_PHOTOS_PATH = 'images/reviews';
const MAX_REVIEW_PHOTOS = 3;
const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;
const SHOPIFY_PRODUCTS_URL = 'https://mt3uk.myshopify.com/products.json?limit=250';
const SHOP_PRODUCTS_CACHE_SECONDS = 60 * 2;
const MY_BUILDS_FROM_EMAIL = 'noreply@mt3uk.com';
const MY_BUILDS_LINK_TTL_SECONDS = 15 * 60;
const MY_BUILDS_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MY_BUILDS_SITE_URL = 'https://mt3uk.com';
const SUBSCRIBERS_DIGEST_EMAIL = 'modtesla3uk@gmail.com';
const MAX_COMMENT_LENGTH = 500;
const MAX_COMMENTS_PER_FILE = 500;
const COMMENT_REPORT_HIDE_THRESHOLD = 3;
const PHOTO_REPORT_HIDE_THRESHOLD = 3;
const COMMENT_PROFANITY_WORDS = [
  'fuck', 'shit', 'bitch', 'cunt', 'bastard', 'asshole', 'dick', 'wanker',
  'twat', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut'
];
// Kill switch: flip to true once the duplicate-send issue is confirmed fixed.
const SUBSCRIBERS_DIGEST_ENABLED = true;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Voter-Id, X-Session-Token'
    }
  });
}

function arrayBufferToBase64(buffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var chunkSize = 0x8000;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function parseImageDataUrl(dataUrl) {
  var match = /^data:(image\/(jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) return null;
  var ext = match[2] === 'jpeg' ? '.jpg' : '.' + match[2];
  return { mime: match[1], ext: ext, base64: match[3] };
}

function base64ByteLength(base64) {
  var padding = (base64.match(/=+$/) || [''])[0].length;
  return Math.floor(base64.length * 0.75) - padding;
}

function slugify(caption) {
  var slug = caption.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'photo';
}

function ukDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(date);
}

function addDaysToDateString(dateStr, days) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Mirrors the caption/name derivation in scripts/build_gallery_manifest.py,
// so entries built from a live R2 listing (see listGalleryEntriesFromR2)
// match what that script would eventually commit to manifest.json.
function captionFromFilenameStem(stem) {
  stem = stem.replace(/^\d+[-_]/, '');
  stem = stem.replace(/[-_]\d{8,}$/, '');
  var words = stem.split(/[-_]+/).filter(Boolean);
  var isRealCaption = words.some(function (w) { return !(/^\d{8,}$/.test(w)); });
  if (!isRealCaption) return '';
  return words.map(function (w) { return w.toUpperCase(); }).join(' ');
}

function splitSubmitterName(stem) {
  var m = /--by-([a-z0-9-]+)$/.exec(stem);
  if (!m) return { stem: stem, name: null };
  var nameSlug = m[1].replace(/-\d+$/, '');
  var words = nameSlug.split(/[-_]+/).filter(Boolean);
  var name = words.map(function (w) { return w.toUpperCase(); }).join(' ');
  return { stem: stem.slice(0, m.index), name: name || null };
}

// Builds the same shape of entry as manifest.json, but straight from the R2
// bucket instead of the GitHub-committed manifest, so a photo uploaded (or
// edited) seconds ago is immediately eligible for voting/liking instead of
// waiting on the sync-manifests Action to run and be published.
async function listGalleryEntriesFromR2(env, opts) {
  var includeEmail = opts && opts.includeEmail;
  var objects = [];
  var cursor;
  do {
    var page = await env.GALLERY_BUCKET.list({ prefix: 'gallery/', cursor: cursor });
    objects = objects.concat(page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  var sidecarKeys = {};
  objects.forEach(function (o) { if (o.key.slice(-5) === '.json') sidecarKeys[o.key] = true; });

  var photoObjects = objects.filter(function (o) { return /\.(jpe?g|png|webp)$/i.test(o.key); });

  return Promise.all(photoObjects.map(async function (o) {
    var filename = o.key.slice('gallery/'.length);
    var stem = filename.replace(/\.[a-zA-Z0-9]+$/, '');
    var split = splitSubmitterName(stem);
    var caption = captionFromFilenameStem(split.stem);

    var mods = [];
    var votable = true;
    var gallery = true;
    var reel = true;
    var carId = null;
    var votableSince = null;
    var color = null;
    var sidecarEmail = null;
    var sidecarKey = o.key + '.json';
    if (sidecarKeys[sidecarKey]) {
      try {
        var sidecarObj = await env.GALLERY_BUCKET.get(sidecarKey);
        if (sidecarObj) {
          var sidecar = await sidecarObj.json();
          if (Array.isArray(sidecar.mods)) {
            mods = sidecar.mods.map(function (m) { return String(m).trim(); }).filter(Boolean).slice(0, 50);
          }
          if (typeof sidecar.votable === 'boolean') votable = sidecar.votable;
          if (typeof sidecar.gallery === 'boolean') gallery = sidecar.gallery;
          if (typeof sidecar.reel === 'boolean') reel = sidecar.reel;
          if (typeof sidecar.carId === 'string' && sidecar.carId) carId = sidecar.carId;
          if (typeof sidecar.votableSince === 'string' && sidecar.votableSince) votableSince = sidecar.votableSince;
          if (typeof sidecar.color === 'string' && sidecar.color) color = sidecar.color;
          if (typeof sidecar.email === 'string' && sidecar.email) sidecarEmail = sidecar.email;
        }
      } catch (e) {}
    }

    var entry = { file: filename, mods: mods, votable: votable, gallery: gallery, reel: reel, added: ukDateString(o.uploaded), uploadedAt: o.uploaded.getTime() };
    if (caption) entry.caption = caption;
    if (split.name) entry.name = split.name;
    if (carId) entry.carId = carId;
    if (color) entry.color = color;
    // Non-sensitive: lets the site show a "Claim this build" control on
    // legacy photos uploaded before My Garage accounts existed, without
    // exposing the actual owner email to public callers.
    if (!sidecarEmail) entry.unclaimed = true;
    if (includeEmail && sidecarEmail) entry.email = sidecarEmail;
    // votableSince lets a photo that's re-enabled for voting after being opted
    // out become eligible again immediately, instead of being stuck outside the
    // today/yesterday eligibility window keyed off its original upload date.
    if (votableSince) entry.votableSince = votableSince;
    return entry;
  }));
}

var GALLERY_LIVE_CACHE_SECONDS = 15;

// Live R2 listing is heavier than the vote/like count reads, so it's cached
// at the edge for a short window (same Cache API pattern as getVoteCounts),
// trading a few seconds of freshness for far fewer R2 list/get calls.
async function getLiveGalleryEntries(env, ctx) {
  var cacheKey = new Request('https://mt3uk-cache.internal/gallery-live-entries');
  var cache = caches.default;
  var cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  var entries = await listGalleryEntriesFromR2(env);

  var response = new Response(JSON.stringify(entries), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + GALLERY_LIVE_CACHE_SECONDS }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return entries;
}

function votingCandidates(manifest, todayStr) {
  var yesterdayStr = addDaysToDateString(todayStr, -1);
  return manifest.filter(function (p) {
    var refDate = p.votableSince || p.added;
    return (refDate === todayStr || refDate === yesterdayStr) && p.votable !== false;
  }).sort(function (a, b) {
    return (b.uploadedAt || 0) - (a.uploadedAt || 0);
  }).slice(0, 9);
}

function getVoterId(request) {
  var id = request.headers.get('X-Voter-Id');
  if (id && /^[a-zA-Z0-9-]{8,64}$/.test(id)) return id;
  return crypto.randomUUID();
}

function ipv6Prefix64(ip) {
  var halves = ip.split('::');
  var head = halves[0] ? halves[0].split(':') : [];
  var tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  var missing = 8 - head.length - tail.length;
  var groups = head.concat(new Array(Math.max(missing, 0)).fill('0')).concat(tail);
  return groups.slice(0, 4).join(':') + '::/64';
}

function getClientIp(request) {
  var ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  // IPv6 addresses rotate their host portion (privacy extensions) while
  // keeping the same /64 network prefix, so dedup on the prefix instead of
  // the full address to treat one household/connection as one voter.
  if (ip.indexOf(':') !== -1) {
    return ipv6Prefix64(ip);
  }
  return ip;
}

async function handleShopProducts(request, ctx) {
  var cacheKey = new Request('https://mt3uk-shop-products.internal/cache', request);
  var cache = caches.default;
  var cached = await cache.match(cacheKey);
  if (cached) return cached;

  var upstream = await fetch(SHOPIFY_PRODUCTS_URL, {
    headers: { 'User-Agent': 'mt3uk-shop-sync' }
  });
  if (!upstream.ok) {
    return json({ success: false, message: 'Could not reach Shopify' }, 502);
  }
  var data = await upstream.json();
  var products = (data.products || []).map(function (p) {
    var images = (p.images || []).map(function (img) { return img.src; });
    var variants = (p.variants || []).map(function (v) {
      return {
        id: v.id,
        title: v.title,
        price: v.price,
        available: v.available
      };
    });
    var prices = variants.map(function (v) { return parseFloat(v.price); }).filter(function (n) { return !isNaN(n); });
    return {
      handle: p.handle,
      title: p.title,
      images: images,
      minPrice: prices.length ? Math.min.apply(null, prices) : null,
      maxPrice: prices.length ? Math.max.apply(null, prices) : null,
      available: variants.some(function (v) { return v.available; }),
      variants: variants,
      url: 'https://mt3uk.myshopify.com/products/' + p.handle
    };
  });

  var response = json({ success: true, products: products });
  response.headers.set('Cache-Control', 'public, max-age=' + SHOP_PRODUCTS_CACHE_SECONDS);
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

var DIGEST_MANUAL_COOLDOWN_SECONDS = 120;

async function handleAdminSendDigest(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }
  if (!SUBSCRIBERS_DIGEST_ENABLED) {
    return json({ success: false, message: 'Digest is currently disabled (kill switch).' }, 503);
  }

  // Guards against repeated/duplicate calls (e.g. a client retrying or a
  // double-tap) firing more than one email in quick succession.
  var cooldownKey = 'subscribers-digest-manual-cooldown';
  if (await env.VOTES.get(cooldownKey)) {
    return json({ success: false, message: 'Already sent in the last ' + DIGEST_MANUAL_COOLDOWN_SECONDS + 's, skipped to avoid a duplicate.' }, 429);
  }
  await env.VOTES.put(cooldownKey, '1', { expirationTtl: DIGEST_MANUAL_COOLDOWN_SECONDS });

  await sendSubscribersDigest(env);
  return json({ success: true });
}

async function handleVotesAll(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var todayStr = ukDateString(new Date());
  var prefix = 'votes:' + todayStr + ':';
  var list = await env.VOTES.list({ prefix: prefix });

  var results = await Promise.all(list.keys.map(async function (k) {
    var count = parseInt((await env.VOTES.get(k.name)) || '0', 10);
    return { file: k.name.slice(prefix.length), votes: count };
  }));

  results.sort(function (a, b) { return b.votes - a.votes; });

  return json({ success: true, date: todayStr, results: results });
}

async function handleVoteDelete(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var file = url.searchParams.get('file');
  if (!file) {
    return json({ success: false, message: 'file is required' }, 400);
  }

  var todayStr = ukDateString(new Date());
  await env.VOTES.delete('votes:' + todayStr + ':' + file);

  return json({ success: true, date: todayStr, deleted: file });
}

async function handleVoteSet(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var file = url.searchParams.get('file');
  if (!file) {
    return json({ success: false, message: 'file is required' }, 400);
  }

  var count = parseInt(url.searchParams.get('count'), 10);
  if (isNaN(count) || count < 0) {
    return json({ success: false, message: 'count must be a non-negative integer' }, 400);
  }

  var todayStr = ukDateString(new Date());
  await env.VOTES.put('votes:' + todayStr + ':' + file, String(count), { expirationTtl: VOTE_TTL_SECONDS });

  return json({ success: true, date: todayStr, file: file, votes: count });
}

async function handleVotersList(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var todayStr = ukDateString(new Date());
  var prefix = 'voter-meta:' + todayStr + ':';
  var list = await env.VOTES.list({ prefix: prefix });

  var results = await Promise.all(list.keys.map(async function (k) {
    var raw = await env.VOTES.get(k.name);
    var meta = null;
    try { meta = JSON.parse(raw); } catch (e) {}
    return {
      ip: k.name.slice(prefix.length),
      file: meta && meta.file,
      asn: meta && meta.asn,
      isp: meta && meta.isp,
      country: meta && meta.country,
      votedAt: meta && meta.ts ? new Date(meta.ts).toISOString() : null
    };
  }));

  results.sort(function (a, b) { return (a.votedAt || '').localeCompare(b.votedAt || ''); });

  return json({ success: true, date: todayStr, voters: results });
}

var VOTES_CACHE_SECONDS = 20;
var LIKES_CACHE_SECONDS = 30;

// Vote/like counts are the same for every visitor, so they're cached at the
// edge (Cache API, not KV) for a short window. This is what actually reads
// KV; everything else in this file just serves the cached JSON. Keeping the
// window short (seconds) means counts still feel live while cutting the KV
// read/list volume roughly in proportion to (window / time-between-requests),
// which is what was pushing the account toward the Workers KV free tier cap.
async function getVoteCounts(env, ctx, todayStr, files) {
  var cacheKey = new Request('https://mt3uk-cache.internal/votes-agg/' + todayStr);
  var cache = caches.default;
  var cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  var counts = {};
  await Promise.all(files.map(async function (f) {
    var c = await env.VOTES.get('votes:' + todayStr + ':' + f);
    counts[f] = c ? parseInt(c, 10) : 0;
  }));

  var response = new Response(JSON.stringify(counts), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + VOTES_CACHE_SECONDS }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return counts;
}

async function handleVotesGet(request, env, ctx) {
  var manifest = await getLiveGalleryEntries(env, ctx);
  var todayStr = ukDateString(new Date());
  var candidates = votingCandidates(manifest, todayStr);
  var voterId = getVoterId(request);
  var ip = getClientIp(request);

  var votedFile = await env.VOTES.get('voter-ip:' + todayStr + ':' + ip);
  if (!votedFile) {
    votedFile = await env.VOTES.get('voter:' + todayStr + ':' + voterId);
  }

  var counts = await getVoteCounts(env, ctx, todayStr, candidates.map(function (p) { return p.file; }));
  var results = candidates.map(function (p) {
    return {
      file: p.file,
      caption: p.caption || '',
      votes: counts[p.file] || 0,
      mods: p.mods || []
    };
  });

  return json({
    success: true,
    voterId: voterId,
    voted: votedFile || null,
    candidates: results
  });
}

async function handleVotePost(request, env, ctx) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  if (!file) {
    return json({ success: false, message: 'file is required' }, 400);
  }

  var manifest = await getLiveGalleryEntries(env, ctx);
  var todayStr = ukDateString(new Date());
  var candidates = votingCandidates(manifest, todayStr);
  var isCandidate = candidates.some(function (p) { return p.file === file; });
  if (!isCandidate) {
    return json({ success: false, message: 'That photo is not open for voting' }, 400);
  }

  var voterId = getVoterId(request);
  var ip = getClientIp(request);
  var ipKey = 'voter-ip:' + todayStr + ':' + ip;
  var previousVote = await env.VOTES.get(ipKey);

  if (previousVote !== file) {
    if (previousVote) {
      var prevCountKey = 'votes:' + todayStr + ':' + previousVote;
      var prevCount = parseInt((await env.VOTES.get(prevCountKey)) || '0', 10);
      await env.VOTES.put(prevCountKey, String(Math.max(0, prevCount - 1)), { expirationTtl: VOTE_TTL_SECONDS });
    }
    var countKey = 'votes:' + todayStr + ':' + file;
    var count = parseInt((await env.VOTES.get(countKey)) || '0', 10);
    await env.VOTES.put(countKey, String(count + 1), { expirationTtl: VOTE_TTL_SECONDS });
    await env.VOTES.put(ipKey, file, { expirationTtl: VOTE_TTL_SECONDS });
    await env.VOTES.put('voter:' + todayStr + ':' + voterId, file, { expirationTtl: VOTE_TTL_SECONDS });

    var cf = request.cf || {};
    var meta = {
      file: file,
      asn: cf.asn || null,
      isp: cf.asOrganization || null,
      country: cf.country || null,
      ts: Date.now()
    };
    await env.VOTES.put('voter-meta:' + todayStr + ':' + ip, JSON.stringify(meta), { expirationTtl: VOTE_TTL_SECONDS });
  }

  var results = await Promise.all(candidates.map(async function (p) {
    var c = await env.VOTES.get('votes:' + todayStr + ':' + p.file);
    return { file: p.file, caption: p.caption || '', votes: c ? parseInt(c, 10) : 0, mods: p.mods || [] };
  }));

  return json({ success: true, voterId: voterId, voted: file, candidates: results });
}

async function getLikesAggregate(env, ctx) {
  var cacheKey = new Request('https://mt3uk-cache.internal/likes-agg');
  var cache = caches.default;
  var cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  var likesList = await env.VOTES.list({ prefix: 'likes:' });
  var likes = {};
  await Promise.all(likesList.keys.map(async function (k) {
    var count = await env.VOTES.get(k.name);
    likes[k.name.slice('likes:'.length)] = count ? parseInt(count, 10) : 0;
  }));

  var response = new Response(JSON.stringify(likes), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + LIKES_CACHE_SECONDS }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return likes;
}

async function getCommentCountsAggregate(env, ctx) {
  var cacheKey = new Request('https://mt3uk-cache.internal/comment-counts-agg');
  var cache = caches.default;
  var cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  var commentsList = await env.VOTES.list({ prefix: 'comments:' });
  var counts = {};
  await Promise.all(commentsList.keys.map(async function (k) {
    var file = k.name.slice('comments:'.length);
    var comments = await getComments(env, file);
    var visible = comments.filter(function (c) { return !c.hidden; });
    if (visible.length) counts[file] = visible.length;
  }));

  var response = new Response(JSON.stringify(counts), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + LIKES_CACHE_SECONDS }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return counts;
}

async function handleCommentCountsGet(request, env, ctx) {
  var counts = await getCommentCountsAggregate(env, ctx);
  return json({ success: true, counts: counts });
}

async function getLikerFiles(env, voterId) {
  var raw = await env.VOTES.get('liker-files:' + voterId);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function handleLikesGet(request, env, ctx) {
  var voterId = getVoterId(request);
  var likes = await getLikesAggregate(env, ctx);

  // A single JSON-array key per voter (one KV get) rather than a list() call,
  // since this runs on every homepage visit and Workers KV's free tier caps
  // list operations far lower than reads.
  var liked = await getLikerFiles(env, voterId);

  return json({ success: true, voterId: voterId, likes: likes, liked: liked });
}

async function handleLikePost(request, env, ctx) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  if (!file) {
    return json({ success: false, message: 'file is required' }, 400);
  }

  var manifest = await getLiveGalleryEntries(env, ctx);
  var isKnown = manifest.some(function (p) { return p.file === file; });
  if (!isKnown) {
    return json({ success: false, message: 'Unknown photo' }, 400);
  }

  var voterId = getVoterId(request);
  var countKey = 'likes:' + file;
  var likerFiles = await getLikerFiles(env, voterId);
  var idx = likerFiles.indexOf(file);
  var count = parseInt((await env.VOTES.get(countKey)) || '0', 10);

  var liked;
  if (idx !== -1) {
    likerFiles.splice(idx, 1);
    count = Math.max(0, count - 1);
    liked = false;
  } else {
    likerFiles.push(file);
    count = count + 1;
    liked = true;
  }
  await env.VOTES.put('liker-files:' + voterId, JSON.stringify(likerFiles));
  await env.VOTES.put(countKey, String(count));

  return json({ success: true, voterId: voterId, file: file, liked: liked, count: count });
}

function displayNameFromEmail(email) {
  var local = email.split('@')[0] || 'guest';
  local = local.replace(/[._+-]+/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!local) return 'Guest';
  return local.split(' ').filter(Boolean).map(function (part) {
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ').slice(0, 40);
}

function moderateCommentText(text) {
  var lower = text.toLowerCase();
  for (var i = 0; i < COMMENT_PROFANITY_WORDS.length; i++) {
    var word = COMMENT_PROFANITY_WORDS[i];
    if (new RegExp('\\b' + word + '\\b', 'i').test(lower)) {
      return { ok: false, message: 'Please keep comments free of inappropriate language.' };
    }
  }

  var urlCount = (text.match(/https?:\/\//gi) || []).length;
  if (urlCount > 1) {
    return { ok: false, message: 'Comment looks like spam (too many links).' };
  }
  if (/(.)\1{6,}/.test(text)) {
    return { ok: false, message: 'Comment looks like spam.' };
  }
  var letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 15) {
    var upper = letters.replace(/[^A-Z]/g, '');
    if (upper.length / letters.length > 0.8) {
      return { ok: false, message: 'Please avoid writing in all caps.' };
    }
  }

  return { ok: true };
}

async function getComments(env, file) {
  var raw = await env.VOTES.get('comments:' + file);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function saveComments(env, file, comments) {
  await env.VOTES.put('comments:' + file, JSON.stringify(comments));
}

function publicComment(c, likedIds, viewerEmail) {
  return {
    id: c.id,
    parentId: c.parentId || null,
    name: c.name,
    text: c.text,
    createdAt: c.createdAt,
    likes: c.likes || 0,
    liked: likedIds.indexOf(c.id) !== -1,
    mine: !!viewerEmail && c.email === viewerEmail
  };
}

async function getCommentLikerIds(env, voterId) {
  var raw = await env.VOTES.get('comment-likes:' + voterId);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function handleCommentsGet(request, env, ctx) {
  var url = new URL(request.url);
  var file = (url.searchParams.get('file') || '').toString();
  if (!file) {
    return json({ success: false, message: 'file is required' }, 400);
  }

  var voterId = getVoterId(request);
  var comments = await getComments(env, file);
  var likedIds = await getCommentLikerIds(env, voterId);
  var viewerEmail = await resolveSession(request, env);
  var visible = comments.filter(function (c) { return !c.hidden; }).map(function (c) {
    return publicComment(c, likedIds, viewerEmail);
  });

  return json({ success: true, file: file, voterId: voterId, comments: visible });
}

async function handleCommentsPost(request, env, ctx) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  var email = ((body && body.email) || '').toString().trim().toLowerCase();
  var text = ((body && body.text) || '').toString().trim().slice(0, MAX_COMMENT_LENGTH);
  var parentId = ((body && body.parentId) || '').toString() || null;

  if (!file) return json({ success: false, message: 'file is required' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, message: 'Please enter a valid email' }, 400);
  }
  if (!text) return json({ success: false, message: 'Comment cannot be empty' }, 400);

  var manifest = await getLiveGalleryEntries(env, ctx);
  var isKnown = manifest.some(function (p) { return p.file === file; });
  if (!isKnown) {
    return json({ success: false, message: 'Unknown photo' }, 400);
  }

  var moderation = moderateCommentText(text);
  if (!moderation.ok) {
    return json({ success: false, message: moderation.message }, 400);
  }

  var comments = await getComments(env, file);
  var parentComment = parentId ? comments.find(function (c) { return c.id === parentId; }) : null;
  if (parentId && !parentComment) {
    return json({ success: false, message: 'Comment being replied to no longer exists' }, 400);
  }

  var comment = {
    id: crypto.randomUUID(),
    parentId: parentId,
    name: displayNameFromEmail(email),
    email: email,
    text: text,
    createdAt: new Date().toISOString(),
    reports: [],
    hidden: false,
    likes: 0
  };
  comments.push(comment);
  if (comments.length > MAX_COMMENTS_PER_FILE) {
    comments = comments.slice(comments.length - MAX_COMMENTS_PER_FILE);
  }
  await saveComments(env, file, comments);

  await notifyCommentRecipients(env, ctx, file, email, comment.name, text, parentComment && parentComment.email);

  return json({ success: true, comment: publicComment(comment, [], email) });
}

async function handleCommentReport(request, env, ctx) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  var id = ((body && body.id) || '').toString();
  if (!file || !id) {
    return json({ success: false, message: 'file and id are required' }, 400);
  }

  var voterId = getVoterId(request);
  var comments = await getComments(env, file);
  var comment = comments.find(function (c) { return c.id === id; });
  if (!comment) {
    return json({ success: false, message: 'Comment not found' }, 404);
  }

  if (!Array.isArray(comment.reports)) comment.reports = [];
  if (comment.reports.indexOf(voterId) === -1) {
    comment.reports.push(voterId);
    if (comment.reports.length >= COMMENT_REPORT_HIDE_THRESHOLD) {
      comment.hidden = true;
    }
    await saveComments(env, file, comments);
  }

  return json({ success: true, reported: true });
}

async function getPhotoReports(env, file) {
  var raw = await env.VOTES.get('photo-reports:' + file);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function savePhotoReports(env, file, reports) {
  await env.VOTES.put('photo-reports:' + file, JSON.stringify(reports));
}

async function handlePhotoReport(request, env) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  if (!file) {
    return json({ success: false, message: 'file is required' }, 400);
  }

  var voterId = getVoterId(request);
  var reports = await getPhotoReports(env, file);
  if (reports.indexOf(voterId) === -1) {
    reports.push(voterId);
    await savePhotoReports(env, file, reports);

    if (reports.length >= PHOTO_REPORT_HIDE_THRESHOLD) {
      var sidecarKey = 'gallery/' + file + '.json';
      var sidecar = {};
      try {
        var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
        if (existingObj) sidecar = await existingObj.json();
      } catch (e) {}
      sidecar.gallery = false;
      sidecar.reel = false;
      sidecar.votable = false;
      await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
        httpMetadata: { contentType: 'application/json' }
      });
      await triggerManifestRebuild(env);
    }
  }

  return json({ success: true, reported: true });
}

async function handlePhotoReportsAdminList(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  // Admin-only aggregate scan across all files, not a per-visitor path, so a
  // one-time list() call here is fine per the KV list-vs-get rule.
  var list = await env.VOTES.list({ prefix: 'photo-reports:' });
  var reported = [];
  await Promise.all(list.keys.map(async function (k) {
    var reports = await getPhotoReports(env, k.name.slice('photo-reports:'.length));
    if (reports.length > 0) {
      reported.push({ file: k.name.slice('photo-reports:'.length), reports: reports.length });
    }
  }));

  return json({ success: true, reported: reported });
}

async function handlePhotoReportsAdminDismiss(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  var file = ((body && body.file) || '').toString();
  if (!file) return json({ success: false, message: 'file is required' }, 400);

  await env.VOTES.delete('photo-reports:' + file);

  // Dismissing means the report was unfounded, so undo the auto-hide (if
  // the report threshold had been hit) rather than leaving the photo
  // suppressed with no report record left to explain why.
  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = null;
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  if (sidecar && (sidecar.gallery === false || sidecar.reel === false || sidecar.votable === false)) {
    sidecar.gallery = true;
    sidecar.reel = true;
    sidecar.votable = true;
    await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
      httpMetadata: { contentType: 'application/json' }
    });
    await triggerManifestRebuild(env);
  }

  return json({ success: true });
}

async function handleGalleryAdminPhotoDelete(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var file = url.searchParams.get('file') || '';
  if (!file) return json({ success: false, message: 'file is required' }, 400);

  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = null;
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}

  await env.GALLERY_BUCKET.delete('gallery/' + file);
  await env.GALLERY_BUCKET.delete(sidecarKey);
  await env.VOTES.delete('photo-reports:' + file);
  await env.VOTES.delete('likes:' + file);
  await env.VOTES.delete(claimKey(file));

  if (sidecar && sidecar.email) {
    await removeSubscriberFile(env, sidecar.email, file);
  }
  if (sidecar && sidecar.carId) {
    var carRecordForDelete = await getCarRecord(env, sidecar.carId);
    if (carRecordForDelete) {
      var remainingPhotos = (carRecordForDelete.photos || []).filter(function (f) { return f !== file; });
      if (remainingPhotos.length) {
        carRecordForDelete.photos = remainingPhotos;
        await saveCarRecord(env, carRecordForDelete);
      } else {
        await deleteCarRecord(env, sidecar.carId);
      }
    }
  }

  await triggerManifestRebuild(env);

  return json({ success: true, deleted: file });
}

function claimKey(file) {
  return 'claim:' + file;
}

async function getClaim(env, file) {
  var raw = await env.VOTES.get(claimKey(file));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function saveClaim(env, file, claim) {
  await env.VOTES.put(claimKey(file), JSON.stringify(claim));
}

async function sendClaimRequestEmail(env, file, email, note) {
  var subject = 'Build claim request: ' + file;
  var body = email + ' has requested to claim the unclaimed build photo "' + file + '".\n\n' +
    (note ? 'Their note:\n' + note + '\n\n' : '') +
    'Photo: ' + GALLERY_PUBLIC_BASE_URL + '/gallery/' + file + '\n\n' +
    'Review and approve/reject: ' + MY_BUILDS_SITE_URL + '/gallery-claims-admin.html';
  var message = new EmailMessage(
    MY_BUILDS_FROM_EMAIL,
    SUBSCRIBERS_DIGEST_EMAIL,
    rawEmail(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, subject, body)
  );
  await env.SEND_EMAIL.send(message);
}

// A photo can only be claimed by a signed-in My Garage account (never by an
// anonymous voterId, unlike likes/reports) so the resulting ownership
// transfer is always tied to a verified email, and the admin decision below
// has a real account to attach the build to.
async function handleGalleryClaim(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in to My Garage first' }, 401);

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  if (!file) return json({ success: false, message: 'file is required' }, 400);
  var note = ((body && body.note) || '').toString().trim().slice(0, 500);

  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  if (sidecar.email) {
    return json({ success: false, message: 'This build has already been claimed.' }, 400);
  }

  var existingClaim = await getClaim(env, file);
  if (existingClaim && existingClaim.status === 'pending') {
    if (existingClaim.email === email) {
      return json({ success: true, status: 'pending' });
    }
    return json({ success: false, message: 'This build already has a claim under review.' }, 409);
  }

  var claim = { file: file, email: email, note: note, requestedAt: new Date().toISOString(), status: 'pending' };
  await saveClaim(env, file, claim);

  try {
    await sendClaimRequestEmail(env, file, email, note);
  } catch (err) {
    console.log('Claim request email failed:', err.message);
  }

  return json({ success: true, status: 'pending' });
}

async function handleGalleryClaimsAdminList(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  // Admin-only aggregate scan across all files, not a per-visitor path, so a
  // one-time list() call here is fine per the KV list-vs-get rule.
  var list = await env.VOTES.list({ prefix: 'claim:' });
  var claims = await Promise.all(list.keys.map(function (k) { return env.VOTES.get(k.name); }));
  var parsed = claims.map(function (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
  parsed.sort(function (a, b) { return (b.requestedAt || '').localeCompare(a.requestedAt || ''); });

  return json({ success: true, claims: parsed });
}

async function handleGalleryClaimsAdminDecide(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  var decision = ((body && body.decision) || '').toString();
  if (!file || (decision !== 'approve' && decision !== 'reject')) {
    return json({ success: false, message: 'file and a valid decision are required' }, 400);
  }

  var claim = await getClaim(env, file);
  if (!claim || claim.status !== 'pending') {
    return json({ success: false, message: 'No pending claim for that file' }, 404);
  }

  if (decision === 'approve') {
    var sidecarKey = 'gallery/' + file + '.json';
    var sidecar = {};
    try {
      var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
      if (existingObj) sidecar = await existingObj.json();
    } catch (e) {}
    sidecar.email = claim.email;
    await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
      httpMetadata: { contentType: 'application/json' }
    });
    await addSubscriberFiles(env, claim.email, [file]);
    claim.status = 'approved';
    await triggerManifestRebuild(env);
  } else {
    claim.status = 'rejected';
  }
  claim.decidedAt = new Date().toISOString();
  await saveClaim(env, file, claim);

  return json({ success: true, status: claim.status });
}

// Reverts a decided (approved/rejected) claim back to pending so the admin
// can re-decide it — e.g. an approval was a mistake, or a rejection should
// be reconsidered after more evidence came in.
async function handleGalleryClaimsAdminUndo(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  var file = ((body && body.file) || '').toString();
  if (!file) return json({ success: false, message: 'file is required' }, 400);

  var claim = await getClaim(env, file);
  if (!claim || claim.status === 'pending') {
    return json({ success: false, message: 'No decided claim for that file' }, 404);
  }

  if (claim.status === 'approved') {
    var sidecarKey = 'gallery/' + file + '.json';
    var sidecar = {};
    try {
      var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
      if (existingObj) sidecar = await existingObj.json();
    } catch (e) {}
    delete sidecar.email;
    await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
      httpMetadata: { contentType: 'application/json' }
    });
    await removeSubscriberFile(env, claim.email, file);
    if (sidecar.carId) await clearSidecarCarId(env, file);
    await triggerManifestRebuild(env);
  }

  claim.status = 'pending';
  delete claim.decidedAt;
  await saveClaim(env, file, claim);

  return json({ success: true, status: 'pending' });
}

// Lets the admin directly assign ownership of an unclaimed legacy photo to a
// subscriber's email, bypassing the request/approve flow — for cases where
// the admin already knows who the build belongs to.
async function sendBuildAssignedEmail(env, toEmail, file) {
  var link = MY_BUILDS_SITE_URL + '/my-builds.html';
  var subject = 'A build was linked to your account';
  var body = 'An MT3UK admin has linked the build photo "' + file + '" to your email address.\n\n' +
    'Photo: ' + GALLERY_PUBLIC_BASE_URL + '/gallery/' + file + '\n\n' +
    'Sign in to My Garage to view and manage it: ' + link + '\n\n' +
    'If you don\'t recognise this, reply to let us know.';
  var message = new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body));
  await env.SEND_EMAIL.send(message);
}

async function handleGalleryClaimsAdminAssign(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  var file = ((body && body.file) || '').toString();
  var email = ((body && body.email) || '').toString().trim().toLowerCase();
  if (!file || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, message: 'file and a valid email are required' }, 400);
  }

  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  sidecar.email = email;
  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
  await addSubscriberFiles(env, email, [file]);
  await triggerManifestRebuild(env);

  var existingClaim = await getClaim(env, file);
  if (existingClaim && existingClaim.status === 'pending') {
    existingClaim.status = 'approved';
    existingClaim.decidedAt = new Date().toISOString();
    await saveClaim(env, file, existingClaim);
  }

  try {
    await sendBuildAssignedEmail(env, email, file);
  } catch (err) {
    console.log('Build assigned email failed:', err.message);
  }

  return json({ success: true });
}

async function handleGalleryAdminUnclaimedList(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var entries = await listGalleryEntriesFromR2(env);
  var unclaimed = entries.filter(function (e) { return e.unclaimed; });

  var list = await env.VOTES.list({ prefix: 'claim:' });
  var claims = await Promise.all(list.keys.map(function (k) { return env.VOTES.get(k.name); }));
  var claimStatusByFile = {};
  claims.forEach(function (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.file) claimStatusByFile[parsed.file] = parsed.status;
    } catch (e) {}
  });

  unclaimed.forEach(function (e) {
    e.claimStatus = claimStatusByFile[e.file] || null;
  });
  unclaimed.sort(function (a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); });

  return json({ success: true, unclaimed: unclaimed });
}

// Lets the admin pick an existing subscriber from a list rather than typing
// their email from memory when assigning an unclaimed photo.
async function handleGalleryAdminSubscribersList(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var list = await env.VOTES.list({ prefix: 'subscriber:' });
  var emails = list.keys.map(function (k) { return k.name.slice('subscriber:'.length); });
  emails.sort();

  var details = await Promise.all(emails.map(async function (email) {
    return { email: email, files: await getSubscriberFiles(env, email) };
  }));

  return json({ success: true, subscribers: emails, details: details });
}

// Pre-registers a subscriber with no photos yet, e.g. so an admin can
// assign builds to someone before their first upload exists.
async function handleGalleryAdminSubscriberCreate(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  var email = ((body && body.email) || '').toString().trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, message: 'A valid email is required' }, 400);
  }

  var existing = await env.VOTES.get('subscriber:' + email);
  if (existing !== null) {
    return json({ success: false, message: 'That subscriber already exists' }, 409);
  }

  await env.VOTES.put('subscriber:' + email, JSON.stringify([]));
  return json({ success: true });
}

// Renames a subscriber's email, moving their KV record and restamping
// every one of their photos' sidecars so the site stays consistent.
async function handleGalleryAdminSubscriberRename(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  var oldEmail = ((body && body.oldEmail) || '').toString().trim().toLowerCase();
  var newEmail = ((body && body.newEmail) || '').toString().trim().toLowerCase();
  if (!oldEmail || !newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return json({ success: false, message: 'oldEmail and a valid newEmail are required' }, 400);
  }
  if (oldEmail === newEmail) return json({ success: true });

  var oldRaw = await env.VOTES.get('subscriber:' + oldEmail);
  if (oldRaw === null) return json({ success: false, message: 'Subscriber not found' }, 404);
  var oldFiles = [];
  try {
    var parsed = JSON.parse(oldRaw);
    oldFiles = Array.isArray(parsed) ? parsed : [];
  } catch (e) {}

  var newFiles = await getSubscriberFiles(env, newEmail);
  oldFiles.forEach(function (f) {
    if (newFiles.indexOf(f) === -1) newFiles.push(f);
  });
  await env.VOTES.put('subscriber:' + newEmail, JSON.stringify(newFiles));
  await env.VOTES.delete('subscriber:' + oldEmail);

  for (var i = 0; i < oldFiles.length; i++) {
    var file = oldFiles[i];
    var sidecarKey = 'gallery/' + file + '.json';
    var sidecar = {};
    try {
      var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
      if (existingObj) sidecar = await existingObj.json();
    } catch (e) {}
    if (sidecar.email === oldEmail) {
      sidecar.email = newEmail;
      await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
        httpMetadata: { contentType: 'application/json' }
      });
    }
  }
  if (oldFiles.length) await triggerManifestRebuild(env);

  return json({ success: true });
}

// Unassigns a single photo from a subscriber, clearing its sidecar email so
// it goes back to being unclaimed, without touching the subscriber's other
// photos.
async function handleGalleryAdminSubscriberUnassign(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  var email = ((body && body.email) || '').toString().trim().toLowerCase();
  var file = ((body && body.file) || '').toString();
  if (!email || !file) return json({ success: false, message: 'email and file are required' }, 400);

  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  if (sidecar.email === email) {
    delete sidecar.email;
    await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
      httpMetadata: { contentType: 'application/json' }
    });
    if (sidecar.carId) await clearSidecarCarId(env, file);
  }
  await removeSubscriberFile(env, email, file);
  await triggerManifestRebuild(env);

  return json({ success: true });
}

// Fully removes a subscriber: clears every one of their photos back to
// unclaimed and deletes their KV record.
async function handleGalleryAdminSubscriberDelete(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var email = (url.searchParams.get('email') || '').toString().trim().toLowerCase();
  if (!email) return json({ success: false, message: 'email is required' }, 400);

  var files = await getSubscriberFiles(env, email);
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var sidecarKey = 'gallery/' + file + '.json';
    var sidecar = {};
    try {
      var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
      if (existingObj) sidecar = await existingObj.json();
    } catch (e) {}
    if (sidecar.email === email) {
      delete sidecar.email;
      await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
        httpMetadata: { contentType: 'application/json' }
      });
      if (sidecar.carId) await clearSidecarCarId(env, file);
    }
  }
  await env.VOTES.delete('subscriber:' + email);
  if (files.length) await triggerManifestRebuild(env);

  return json({ success: true });
}

async function handleCommentLike(request, env, ctx) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  var id = ((body && body.id) || '').toString();
  if (!file || !id) {
    return json({ success: false, message: 'file and id are required' }, 400);
  }

  var comments = await getComments(env, file);
  var comment = comments.find(function (c) { return c.id === id; });
  if (!comment) {
    return json({ success: false, message: 'Comment not found' }, 404);
  }

  var voterId = getVoterId(request);
  var likerIds = await getCommentLikerIds(env, voterId);
  var idx = likerIds.indexOf(id);
  var liked;
  if (idx !== -1) {
    likerIds.splice(idx, 1);
    comment.likes = Math.max(0, (comment.likes || 0) - 1);
    liked = false;
  } else {
    likerIds.push(id);
    comment.likes = (comment.likes || 0) + 1;
    liked = true;
  }

  await env.VOTES.put('comment-likes:' + voterId, JSON.stringify(likerIds));
  await saveComments(env, file, comments);

  return json({ success: true, voterId: voterId, id: id, liked: liked, likes: comment.likes });
}

async function handleCommentsAdminList(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var file = (url.searchParams.get('file') || '').toString();
  if (file) {
    var comments = await getComments(env, file);
    return json({ success: true, file: file, comments: comments });
  }

  // Admin-only aggregate scan across all files, not a per-visitor path, so a
  // one-time list() call here is fine per the KV list-vs-get rule.
  var list = await env.VOTES.list({ prefix: 'comments:' });
  var reported = [];
  await Promise.all(list.keys.map(async function (k) {
    var fileComments = await getComments(env, k.name.slice('comments:'.length));
    fileComments.forEach(function (c) {
      if (c.reports && c.reports.length > 0) {
        reported.push(Object.assign({ file: k.name.slice('comments:'.length) }, c));
      }
    });
  }));

  return json({ success: true, reported: reported });
}

async function handleCommentsSelfDelete(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var url = new URL(request.url);
  var file = (url.searchParams.get('file') || '').toString();
  var id = (url.searchParams.get('id') || '').toString();
  if (!file || !id) {
    return json({ success: false, message: 'file and id are required' }, 400);
  }

  var comments = await getComments(env, file);
  var comment = comments.find(function (c) { return c.id === id; });
  if (!comment) {
    return json({ success: false, message: 'Comment not found' }, 404);
  }
  if (comment.email !== email) {
    return json({ success: false, message: 'You can only delete your own comments' }, 403);
  }

  var next = comments.filter(function (c) { return c.id !== id; });
  await saveComments(env, file, next);

  return json({ success: true, deleted: id });
}

async function handleCommentsAdminDelete(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var file = (url.searchParams.get('file') || '').toString();
  var id = (url.searchParams.get('id') || '').toString();
  if (!file || !id) {
    return json({ success: false, message: 'file and id are required' }, 400);
  }

  var comments = await getComments(env, file);
  var next = comments.filter(function (c) { return c.id !== id; });
  if (next.length === comments.length) {
    return json({ success: false, message: 'Comment not found' }, 404);
  }
  await saveComments(env, file, next);

  return json({ success: true, deleted: id });
}

function randomToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

function rawEmail(from, to, subject, bodyText) {
  var lines = [
    'From: MT3UK <' + from + '>',
    'To: ' + to,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    bodyText
  ];
  return lines.join('\r\n');
}

async function sendMyBuildsLinkEmail(env, toEmail, link) {
  var subject = 'Your My Builds sign-in link';
  var body = 'Click the link below to sign in to My Garage, manage your build(s) and view your notifications:\n\n' + link +
    '\n\nThis link expires in 15 minutes and can only be used once. ' +
    'If you did not request this, you can ignore this email.';
  var message = new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body));
  await env.SEND_EMAIL.send(message);
}

var MAX_NOTIFICATIONS_PER_USER = 40;

function notificationsKey(email) {
  return 'notifications:' + email;
}

async function getNotifications(env, email) {
  var raw = await env.VOTES.get(notificationsKey(email));
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function addNotification(env, toEmail, notif) {
  var list = await getNotifications(env, toEmail);
  list.unshift(Object.assign({ id: crypto.randomUUID(), read: false }, notif));
  if (list.length > MAX_NOTIFICATIONS_PER_USER) {
    list = list.slice(0, MAX_NOTIFICATIONS_PER_USER);
  }
  await env.VOTES.put(notificationsKey(toEmail), JSON.stringify(list));
}

async function sendCommentNotificationEmail(env, toEmail, fromName, text, file) {
  var link = MY_BUILDS_SITE_URL + '/my-builds.html?file=' + encodeURIComponent(file);
  var subject = fromName + ' commented on your build';
  var body = fromName + ' left a comment on one of your MT3UK build photos:\n\n"' + text + '"' +
    '\n\nView and reply: ' + link;
  var message = new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body));
  await env.SEND_EMAIL.send(message);
}

// Notifies the photo's owner (read from the sidecar's stamped `email`
// field - set at upload time) about a new comment/reply, both as an
// in-Garage notification and an email. Commenting on your own photo, or on
// a photo whose owner hasn't been stamped yet (e.g. an un-migrated legacy
// photo with no sidecar email), is a silent no-op.
// Notifies the photo's owner (read from the sidecar's stamped `email`
// field - set at upload time) and, on a reply, the author of the comment
// being replied to - both as an in-Garage notification and an email.
// Commenting on your own photo/reply, or a photo whose owner hasn't been
// stamped yet (e.g. an un-migrated legacy photo with no sidecar email), is
// a silent no-op for that recipient.
async function notifyCommentRecipients(env, ctx, file, commenterEmail, commenterName, text, parentAuthorEmail) {
  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = null;
  try {
    var obj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (obj) sidecar = await obj.json();
  } catch (e) {}
  var ownerEmail = sidecar && sidecar.email;

  var recipients = {};
  if (ownerEmail && ownerEmail !== commenterEmail) recipients[ownerEmail] = true;
  if (parentAuthorEmail && parentAuthorEmail !== commenterEmail) recipients[parentAuthorEmail] = true;
  var toEmails = Object.keys(recipients);
  if (!toEmails.length) return;

  var notify = async function () {
    await Promise.all(toEmails.map(async function (toEmail) {
      await addNotification(env, toEmail, {
        type: 'comment',
        file: file,
        fromName: commenterName,
        text: text,
        createdAt: new Date().toISOString()
      });
      try {
        await sendCommentNotificationEmail(env, toEmail, commenterName, text, file);
      } catch (err) {
        console.log('Comment notification email failed:', err.message);
      }
    }));
  };

  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(notify());
  } else {
    await notify();
  }
}

async function sendSubscribersDigestIfUk8pm(env) {
  var now = new Date();
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  var ukHour = parts.find(function (p) { return p.type === 'hour'; }).value;
  var ukMinute = parts.find(function (p) { return p.type === 'minute'; }).value;
  // Narrowed to the top of the 20:00 hour (not the whole hour) so that on a
  // busy site, far fewer concurrent requests are racing to claim the send
  // below - KV writes take up to ~60s to propagate globally, so a wide
  // window let a burst of simultaneous requests from different edge
  // locations all read "not sent yet" and each send a duplicate email. The
  // window is a few minutes wide (rather than exactly :00) so the */5 cron
  // trigger below - which can land a little after the scheduled tick - still
  // has a chance to catch it even without any site traffic to piggyback on.
  if (ukHour !== '20' || Number(ukMinute) >= 5) return;

  var todayStr = ukDateString(now);

  // Cache API is colo-local and consistent within a colo immediately, so it
  // catches most of the burst (same region) before falling through to the
  // slower, eventually-consistent KV check below as a cross-region backstop.
  var cache = caches.default;
  var cacheKey = new Request('https://mt3uk-cache.internal/subscribers-digest-lock/' + todayStr);
  if (await cache.match(cacheKey)) return;
  await cache.put(cacheKey, new Response('1', { headers: { 'Cache-Control': 'max-age=120' } }));

  var dedupKey = 'subscribers-digest-sent:' + todayStr;
  if (await env.VOTES.get(dedupKey)) return;
  // Claim the slot immediately so concurrent requests in the same minute don't double-send.
  await env.VOTES.put(dedupKey, '1', { expirationTtl: 60 * 60 * 24 * 3 });

  await sendSubscribersDigest(env);
}

async function sendSubscribersDigest(env) {
  if (!SUBSCRIBERS_DIGEST_ENABLED) return;
  var todayStr = ukDateString(new Date());
  var list = await env.VOTES.list({ prefix: 'subscriber:' });
  var subscribers = await Promise.all(list.keys.map(async function (k) {
    var raw = await env.VOTES.get(k.name);
    var files = [];
    try { files = JSON.parse(raw) || []; } catch (e) {}
    return { email: k.name.slice('subscriber:'.length), buildCount: files.length };
  }));
  subscribers.sort(function (a, b) { return a.email.localeCompare(b.email); });

  var lines = subscribers.length
    ? subscribers.map(function (s) {
        return s.email + ' — ' + s.buildCount + ' build' + (s.buildCount === 1 ? '' : 's');
      }).join('\n')
    : 'No subscribers yet.';

  var subject = 'My Builds subscribers, ' + todayStr + ' (' + subscribers.length + ' total)';
  var body = 'Daily My Builds subscriber list for ' + todayStr + '.\n\n' +
    'Total subscribers: ' + subscribers.length + '\n\n' + lines;

  var message = new EmailMessage(
    MY_BUILDS_FROM_EMAIL,
    SUBSCRIBERS_DIGEST_EMAIL,
    rawEmail(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, subject, body)
  );
  await env.SEND_EMAIL.send(message);
}

async function getSubscriberFiles(env, email) {
  var raw = await env.VOTES.get('subscriber:' + email);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function addSubscriberFiles(env, email, files) {
  var existing = await getSubscriberFiles(env, email);
  files.forEach(function (f) {
    if (existing.indexOf(f) === -1) existing.push(f);
  });
  await env.VOTES.put('subscriber:' + email, JSON.stringify(existing));
}

async function removeSubscriberFile(env, email, file) {
  var existing = await getSubscriberFiles(env, email);
  var idx = existing.indexOf(file);
  if (idx === -1) return;
  existing.splice(idx, 1);
  await env.VOTES.put('subscriber:' + email, JSON.stringify(existing));
}

async function resolveSession(request, env) {
  var token = request.headers.get('X-Session-Token');
  if (!token) return null;
  return env.VOTES.get('my-builds-session:' + token);
}

function carRecordKey(carId) {
  return 'gallery/cars/' + carId + '.json';
}

async function getCarRecord(env, carId) {
  try {
    var obj = await env.GALLERY_BUCKET.get(carRecordKey(carId));
    if (!obj) return null;
    return await obj.json();
  } catch (e) {
    return null;
  }
}

async function saveCarRecord(env, car) {
  await env.GALLERY_BUCKET.put(carRecordKey(car.id), JSON.stringify(car, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
}

async function deleteCarRecord(env, carId) {
  await env.GALLERY_BUCKET.delete(carRecordKey(carId));
}

async function setSidecarCarId(env, file, carId, ownerEmail) {
  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  sidecar.carId = carId;
  // Backfills the owner email onto legacy sidecars that predate comment
  // notifications, so this photo starts receiving them from here on.
  if (!sidecar.email && ownerEmail) sidecar.email = ownerEmail;
  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
}

// Un-stamps a photo's carId so it drops back into the shared "legacy"
// virtual grouping instead of belonging to any real car record.
async function clearSidecarCarId(env, file) {
  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  delete sidecar.carId;
  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
}

async function setSidecarMods(env, file, mods) {
  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  if (mods.length) {
    sidecar.mods = mods;
  } else {
    delete sidecar.mods;
  }
  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
}

var CAR_COLORS = ['Red', 'White', 'Black', 'Grey', 'Silver', 'Pink', 'Green', 'Other'];

async function setSidecarColor(env, file, color) {
  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  if (color) {
    sidecar.color = color;
  } else {
    delete sidecar.color;
  }
  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
}

// Virtual car id used to group all of a subscriber's legacy (pre-carId)
// photos into a single car, since they predate the carId field entirely.
var LEGACY_VIRTUAL_CAR_ID = 'virtual:legacy';

// Groups a subscriber's live gallery entries into cars. Entries with an
// explicit carId are grouped by it (real cars); every other entry belongs
// to one shared "virtual" car that doesn't exist in R2 yet - the first
// PUT /my-builds/car against it persists a real record and stamps carId
// onto each of its photos.
function groupEntriesIntoCars(entries) {
  var byRealCarId = {};
  var virtualGroup = null;
  var order = [];

  entries.forEach(function (entry) {
    if (entry.carId) {
      if (!byRealCarId[entry.carId]) {
        byRealCarId[entry.carId] = { id: entry.carId, virtual: false, entries: [] };
        order.push(byRealCarId[entry.carId]);
      }
      byRealCarId[entry.carId].entries.push(entry);
    } else {
      if (!virtualGroup) {
        virtualGroup = { id: LEGACY_VIRTUAL_CAR_ID, virtual: true, entries: [] };
        order.push(virtualGroup);
      }
      virtualGroup.entries.push(entry);
    }
  });

  return order;
}

async function triggerManifestRebuild(env) {
  var ghHeaders = {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mt3uk-gallery-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  try {
    await fetch(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/dispatches',
      {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({ event_type: 'gallery-submission' })
      }
    );
  } catch (dispatchErr) {
    console.log('Manifest rebuild dispatch failed (non-critical):', dispatchErr.message);
  }
}

async function handleMyBuildsRequestLink(request, env) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var email = ((body && body.email) || '').toString().trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, message: 'Please enter a valid email' }, 400);
  }

  var files = await getSubscriberFiles(env, email);
  // Anyone who has commented and had someone reply also gets an account -
  // not just car owners - so they have somewhere to read/manage that
  // notification. getNotifications is skipped once files.length already
  // grants access, to avoid the extra KV read on the common (owner) path.
  var hasAccess = files.length > 0;
  if (!hasAccess) {
    var notifications = await getNotifications(env, email);
    hasAccess = notifications.length > 0;
  }
  if (hasAccess) {
    var token = randomToken();
    await env.VOTES.put('my-builds-link:' + token, email, { expirationTtl: MY_BUILDS_LINK_TTL_SECONDS });
    var link = MY_BUILDS_SITE_URL + '/my-builds.html?token=' + token;
    try {
      await sendMyBuildsLinkEmail(env, email, link);
    } catch (err) {
      console.log('My Builds link email failed:', err.message);
    }
  }

  // Always return the same message, whether or not that email has any
  // builds on file, so this endpoint can't be used to check who's submitted.
  return json({ success: true, message: "If that email has submitted a build, we've sent a sign-in link." });
}

async function handleMyBuildsSession(request, env) {
  var token = new URL(request.url).searchParams.get('token') || '';
  var email = token ? await env.VOTES.get('my-builds-link:' + token) : null;
  if (!email) {
    return json({ success: false, message: 'That link is invalid or has expired.' }, 400);
  }
  await env.VOTES.delete('my-builds-link:' + token);

  var session = randomToken();
  await env.VOTES.put('my-builds-session:' + session, email, { expirationTtl: MY_BUILDS_SESSION_TTL_SECONDS });

  return json({ success: true, session: session, email: email });
}

async function handleMyBuildsGet(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var files = await getSubscriberFiles(env, email);
  // Read straight from an uncached live R2 listing (caption/name derived
  // from the filename, mods/gallery/reel/votable from each photo's
  // sidecar) so a build the owner just uploaded or edited shows up right
  // away, not just after the (cached, for /votes and /likes) window or the
  // manifest rebuild pipeline catches up.
  var manifestOk = true;
  var manifest = [];
  if (files.length) {
    try {
      manifest = await listGalleryEntriesFromR2(env, { includeEmail: true });
    } catch (e) {
      manifestOk = false;
    }
  }
  var byFile = {};
  manifest.forEach(function (p) { byFile[p.file] = p; });

  // R2's list() (used by listGalleryEntriesFromR2) is only eventually
  // consistent, unlike get/put by key - a photo just uploaded (e.g. via
  // "Add Another Car", which reloads this page immediately after) can
  // briefly be missing from it. Self-heal by re-adding any live photo
  // whose sidecar names this subscriber as the owner but that dropped out
  // of their saved file list, so a lagging listing can never look like a
  // deleted build and get pruned away below.
  var filesChanged = false;
  if (manifestOk) {
    var fileSet = {};
    files.forEach(function (f) { fileSet[f] = true; });
    manifest.forEach(function (p) {
      if (p.email === email && !fileSet[p.file]) {
        files.push(p.file);
        fileSet[p.file] = true;
        filesChanged = true;
      }
    });
  }

  // If the live listing failed, fall back to a bare-bones entry built from
  // each filename (no mods/colour/carId - those only live in sidecars) so
  // a transient R2 error degrades to a temporarily ungrouped view instead
  // of making the subscriber's builds vanish or signing them out.
  if (!manifestOk) {
    files.forEach(function (f) {
      var stem = f.replace(/\.[a-zA-Z0-9]+$/, '');
      var split = splitSubmitterName(stem);
      var caption = captionFromFilenameStem(split.stem);
      var entry = { file: f, mods: [], votable: true, gallery: true, reel: true, uploadedAt: 0 };
      if (caption) entry.caption = caption;
      if (split.name) entry.name = split.name;
      byFile[f] = entry;
    });
  }

  // A file can be missing from the live listing if it was deleted straight
  // from R2 (e.g. via the Delete Photo GitHub Action) rather than through
  // this API, which wouldn't have had a chance to prune it from the
  // subscriber's saved file list. Drop it here, and persist the cleanup so
  // it doesn't keep resurfacing as an empty placeholder on every load.
  // Only trust this when the listing actually succeeded - a transient R2
  // error must never be allowed to look like "every photo was deleted" and
  // wipe out the subscriber's saved file list.
  var liveFiles = files.filter(function (f) { return byFile[f]; });
  if (manifestOk && (filesChanged || liveFiles.length !== files.length)) {
    await env.VOTES.put('subscriber:' + email, JSON.stringify(liveFiles));
  }

  var entries = liveFiles.map(function (f) { return byFile[f]; });
  var groups = groupEntriesIntoCars(entries);
  var records = {};
  await Promise.all(groups.map(async function (g) {
    if (!g.virtual) records[g.id] = await getCarRecord(env, g.id);
  }));
  groups.forEach(function (g) {
    var record = records[g.id];
    if (record && Array.isArray(record.photos) && record.photos.length) {
      // Respect the owner's saved/drag-reordered order; any photo not yet
      // in the saved order (e.g. just uploaded) is appended, oldest first.
      var byFileMap = {};
      g.entries.forEach(function (entry) { byFileMap[entry.file] = entry; });
      var seen = {};
      var ordered = record.photos.map(function (f) { return byFileMap[f]; }).filter(Boolean);
      ordered.forEach(function (entry) { seen[entry.file] = true; });
      var rest = g.entries.filter(function (entry) { return !seen[entry.file]; })
        .sort(function (a, b) { return (a.uploadedAt || 0) - (b.uploadedAt || 0); });
      g.entries = ordered.concat(rest);
    } else {
      // Oldest photo first within a car so new photos append to the end
      // rather than reshuffling the garage.
      g.entries.sort(function (a, b) { return (a.uploadedAt || 0) - (b.uploadedAt || 0); });
    }
  });
  groups.sort(function (a, b) {
    return (a.entries[0].uploadedAt || 0) - (b.entries[0].uploadedAt || 0);
  });

  var cars = await Promise.all(groups.map(async function (g) {
    var record = records[g.id];
    var photos = await Promise.all(g.entries.map(async function (entry) {
      var comments = await getComments(env, entry.file);
      var visibleComments = comments.filter(function (c) { return !c.hidden; });
      return {
        file: entry.file,
        caption: entry.caption || '',
        mods: entry.mods || [],
        gallery: entry.gallery !== false,
        reel: entry.reel !== false,
        votable: entry.votable !== false,
        commentCount: visibleComments.length
      };
    }));
    var mods = record && Array.isArray(record.mods) ? record.mods : (g.entries[0].mods || []);
    var color = record && record.color ? record.color : (g.entries[0].color || '');
    var name = record ? record.name : (g.entries[0].caption || 'MT3UK member build');
    var createdAt = record ? record.createdAt : new Date(g.entries[0].uploadedAt || Date.now()).toISOString();
    return {
      id: g.id,
      virtual: !!g.virtual,
      name: name,
      mods: mods,
      color: color,
      createdAt: createdAt,
      commentCount: photos.reduce(function (sum, p) { return sum + p.commentCount; }, 0),
      photos: photos
    };
  }));

  return json({ success: true, email: email, cars: cars });
}

async function handleMyBuildsUpdate(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  var files = await getSubscriberFiles(env, email);
  if (files.indexOf(file) === -1) {
    return json({ success: false, message: 'That build is not linked to your account' }, 403);
  }

  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  // Backfills the owner email onto legacy sidecars that predate comment
  // notifications, so this photo starts receiving them from here on.
  if (!sidecar.email) sidecar.email = email;

  // A photo re-enabled for voting after being opted out is stamped with
  // today's date so it becomes eligible immediately, rather than staying
  // outside the today/yesterday window keyed off its original upload date.
  var wasVotable = sidecar.votable !== false;
  ['gallery', 'reel', 'votable'].forEach(function (flag) {
    if (typeof (body && body[flag]) === 'boolean') {
      if (body[flag] === false) {
        sidecar[flag] = false;
      } else {
        delete sidecar[flag];
      }
    }
  });
  if (body && body.votable === true && !wasVotable) {
    sidecar.votableSince = ukDateString(new Date());
  }

  if (sidecar.gallery === false && sidecar.reel === false && sidecar.votable === false) {
    return json({ success: false, message: 'At least one of Gallery, Reel or Voting must stay on, otherwise the photo won’t be visible anywhere.' }, 400);
  }

  if (body && Array.isArray(body.mods)) {
    var mods = body.mods.map(function (m) { return String(m).trim(); }).filter(Boolean).slice(0, 50);
    if (mods.length) {
      sidecar.mods = mods;
    } else {
      delete sidecar.mods;
    }
  }

  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });

  await triggerManifestRebuild(env);

  return json({ success: true, file: file });
}

async function handleMyBuildsCarUpdate(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var carId = ((body && body.carId) || '').toString();
  if (!carId) return json({ success: false, message: 'carId is required' }, 400);

  var files = await getSubscriberFiles(env, email);
  var manifest = await listGalleryEntriesFromR2(env).catch(function () { return []; });
  var byFile = {};
  manifest.forEach(function (p) { byFile[p.file] = p; });

  var isVirtual = carId.indexOf('virtual:') === 0;
  var currentPhotos;
  if (isVirtual) {
    currentPhotos = files.filter(function (f) {
      return byFile[f] && !byFile[f].carId;
    });
  } else {
    currentPhotos = files.filter(function (f) { return byFile[f] && byFile[f].carId === carId; });
  }

  if (!currentPhotos.length) {
    return json({ success: false, message: 'That car is not linked to your account' }, 403);
  }

  // Reordering also doubles as the definitive photo set for this car.
  var photos = currentPhotos;
  if (body && Array.isArray(body.photos)) {
    var requested = body.photos.map(function (f) { return String(f); });
    var sameSet = requested.length === currentPhotos.length &&
      requested.every(function (f) { return currentPhotos.indexOf(f) !== -1; });
    if (!sameSet) {
      return json({ success: false, message: 'Photo list does not match this car' }, 400);
    }
    photos = requested;
  }

  var realCarId = carId;
  var record = isVirtual ? null : await getCarRecord(env, carId);
  var isNewRecord = isVirtual || !record;

  if (isNewRecord) {
    realCarId = isVirtual ? randomToken() : carId;
    record = {
      id: realCarId,
      email: email,
      name: (body && body.name) || byFile[photos[0]].caption || 'MT3UK member build',
      photos: photos,
      mods: byFile[photos[0]].mods || [],
      color: byFile[photos[0]].color || '',
      createdAt: new Date().toISOString()
    };
    // Stamp every photo in this car with the (possibly newly-generated) carId
    // so it stops being grouped by the filename heuristic from now on.
    await Promise.all(photos.map(function (f) { return setSidecarCarId(env, f, realCarId, email); }));
  }

  if (body && typeof body.name === 'string' && body.name.trim()) {
    record.name = body.name.trim().slice(0, 150);
  }
  record.photos = photos;

  if (body && Array.isArray(body.mods)) {
    var mods = body.mods.map(function (m) { return String(m).trim(); }).filter(Boolean).slice(0, 50);
    record.mods = mods;
    await Promise.all(photos.map(function (f) { return setSidecarMods(env, f, mods); }));
  }

  if (body && typeof body.color === 'string' && CAR_COLORS.indexOf(body.color) !== -1) {
    record.color = body.color;
    await Promise.all(photos.map(function (f) { return setSidecarColor(env, f, body.color); }));
  }

  await saveCarRecord(env, record);
  await triggerManifestRebuild(env);

  return json({ success: true, car: record });
}

// Moves a single photo from whichever car (real or the shared virtual/
// legacy grouping) it currently belongs to into another one - used both as
// a general "tidy up my garage" tool and to fix a freshly-claimed legacy
// photo (which has no carId, so it defaults into its own virtual group)
// landing as a separate car instead of joining an existing one.
async function handleMyBuildsPhotoMove(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var file = ((body && body.file) || '').toString();
  var targetCarId = ((body && body.targetCarId) || '').toString();
  var newCarName = ((body && body.newCarName) || '').toString().trim().slice(0, 150);
  if (!file || !targetCarId) {
    return json({ success: false, message: 'file and targetCarId are required' }, 400);
  }

  var files = await getSubscriberFiles(env, email);
  if (files.indexOf(file) === -1) {
    return json({ success: false, message: 'That build is not linked to your account' }, 403);
  }

  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  var currentCarId = sidecar.carId || null;

  if (targetCarId === (currentCarId || LEGACY_VIRTUAL_CAR_ID)) {
    return json({ success: false, message: 'That photo is already in that build' }, 400);
  }

  // Detach from its current real car (if any) before attaching elsewhere.
  if (currentCarId) {
    var currentRecord = await getCarRecord(env, currentCarId);
    if (currentRecord) {
      var remaining = (currentRecord.photos || []).filter(function (f) { return f !== file; });
      if (remaining.length) {
        currentRecord.photos = remaining;
        await saveCarRecord(env, currentRecord);
      } else {
        await deleteCarRecord(env, currentCarId);
      }
    }
  }

  var resultCarId;
  if (targetCarId === 'new') {
    resultCarId = randomToken();
    var newRecord = {
      id: resultCarId,
      email: email,
      name: newCarName || 'New build',
      photos: [file],
      mods: [],
      color: '',
      createdAt: new Date().toISOString()
    };
    await saveCarRecord(env, newRecord);
    await setSidecarCarId(env, file, resultCarId, email);
  } else if (targetCarId === LEGACY_VIRTUAL_CAR_ID) {
    resultCarId = LEGACY_VIRTUAL_CAR_ID;
    await clearSidecarCarId(env, file);
  } else {
    var targetRecord = await getCarRecord(env, targetCarId);
    if (!targetRecord || targetRecord.email !== email) {
      return json({ success: false, message: 'That build is not linked to your account' }, 403);
    }
    resultCarId = targetCarId;
    if ((targetRecord.photos || []).indexOf(file) === -1) {
      targetRecord.photos = (targetRecord.photos || []).concat([file]);
    }
    await saveCarRecord(env, targetRecord);
    await setSidecarCarId(env, file, targetCarId, email);
    // Shared mods/colour apply to every photo in a car, so a moved-in photo
    // should pick up its new car's, the same as one added via upload.
    await setSidecarMods(env, file, targetRecord.mods || []);
    if (targetRecord.color) await setSidecarColor(env, file, targetRecord.color);
  }

  await triggerManifestRebuild(env);

  return json({ success: true, carId: resultCarId });
}

async function handleMyBuildsUpload(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return json({ success: false, message: 'Invalid form submission' }, 400);
  }

  var caption = (formData.get('caption') || '').toString().trim().slice(0, 150);
  var modsRaw = (formData.get('mods') || '').toString().trim().slice(0, 1000);
  var mods = modsRaw
    ? modsRaw.split(/[,\n]/).map(function (m) { return m.trim(); }).filter(Boolean).slice(0, 20)
    : [];
  var file = formData.get('photo');
  var gallery = formData.get('gallery') === '1';
  var reel = formData.get('reel') === '1';
  var votable = formData.get('votable') === '1';
  var carId = (formData.get('carId') || '').toString();

  if (!caption) {
    return json({ success: false, message: 'Caption is required' }, 400);
  }
  if (!file || typeof file === 'string') {
    return json({ success: false, message: 'Photo is required' }, 400);
  }
  if (file.size > 10 * 1024 * 1024) {
    return json({ success: false, message: 'Photo must be under 10MB' }, 400);
  }
  if (!file.type || file.type.indexOf('image/') !== 0) {
    return json({ success: false, message: 'File must be an image' }, 400);
  }
  if (!gallery && !reel && !votable) {
    return json({ success: false, message: 'At least one of Gallery, Reel or Voting must stay on, otherwise the photo won’t be visible anywhere.' }, 400);
  }

  try {
    var slug = slugify(caption);
    var listed = await env.GALLERY_BUCKET.list({ prefix: 'gallery/' });
    var existingNames = listed.objects.map(function (obj) { return obj.key.slice('gallery/'.length); });

    var extMatch = (file.name || '').match(/\.[a-zA-Z0-9]+$/);
    var ext = extMatch ? extMatch[0].toLowerCase() : '.jpg';
    var filename = slug + ext;
    var suffix = 2;
    while (existingNames.indexOf(filename) !== -1 && suffix < 100) {
      filename = slug + '-' + suffix + ext;
      suffix++;
    }

    var arrayBuffer = await file.arrayBuffer();
    await env.GALLERY_BUCKET.put('gallery/' + filename, arrayBuffer, {
      httpMetadata: { contentType: file.type }
    });

    var sidecar = { email: email };
    if (mods.length) sidecar.mods = mods;
    if (!gallery) sidecar.gallery = false;
    if (!reel) sidecar.reel = false;
    if (!votable) sidecar.votable = false;
    await env.GALLERY_BUCKET.put(
      'gallery/' + filename + '.json',
      JSON.stringify(sidecar, null, 2) + '\n',
      { httpMetadata: { contentType: 'application/json' } }
    );

    await addSubscriberFiles(env, email, [filename]);

    if (carId) {
      var subscriberFiles = await getSubscriberFiles(env, email);
      var carManifest = await listGalleryEntriesFromR2(env).catch(function () { return []; });
      var byFileForCar = {};
      carManifest.forEach(function (p) { byFileForCar[p.file] = p; });

      var isVirtualCar = carId.indexOf('virtual:') === 0;
      var siblingPhotos = subscriberFiles.filter(function (f) {
        if (f === filename) return false;
        var entry = byFileForCar[f];
        if (!entry) return false;
        return isVirtualCar
          ? !entry.carId
          : entry.carId === carId;
      });

      if (isVirtualCar ? siblingPhotos.length > 0 : true) {
        var carRecordForUpload = isVirtualCar ? null : await getCarRecord(env, carId);
        var realCarIdForUpload = carId;
        if (isVirtualCar || !carRecordForUpload) {
          realCarIdForUpload = isVirtualCar ? randomToken() : carId;
          carRecordForUpload = {
            id: realCarIdForUpload,
            email: email,
            name: caption || 'MT3UK member build',
            photos: siblingPhotos.concat([filename]),
            mods: mods.length ? mods : (siblingPhotos.length ? (byFileForCar[siblingPhotos[0]].mods || []) : []),
            color: siblingPhotos.length ? (byFileForCar[siblingPhotos[0]].color || '') : '',
            createdAt: new Date().toISOString()
          };
          await Promise.all(siblingPhotos.map(function (f) { return setSidecarCarId(env, f, realCarIdForUpload, email); }));
        } else {
          carRecordForUpload.photos = (carRecordForUpload.photos || []).concat([filename]);
        }
        await setSidecarCarId(env, filename, realCarIdForUpload, email);
        await saveCarRecord(env, carRecordForUpload);
        if (carRecordForUpload.color) {
          await setSidecarColor(env, filename, carRecordForUpload.color);
        }
      }
    }

    try {
      var ghHeaders = {
        'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mt3uk-gallery-worker',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/issues',
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            title: 'My Builds upload: ' + caption,
            body: '**Caption:** ' + caption + '\n**Submitted by (account):** ' + email +
              (mods.length ? '\n**Mods:** ' + mods.join(', ') : '') +
              '\n**Flags:** gallery=' + gallery + ', reel=' + reel + ', votable=' + votable +
              '\n\n![photo](' + GALLERY_PUBLIC_BASE_URL + '/gallery/' + filename + ')' +
              '\n\nThis photo is already live in the gallery. Close this issue once reviewed.'
          })
        }
      );
    } catch (issueErr) {
      console.log('Issue creation failed (non-critical):', issueErr.message);
    }

    await triggerManifestRebuild(env);

    return json({ success: true, file: filename });
  } catch (err) {
    return json({ success: false, message: err.message }, 500);
  }
}

async function clearFeaturedIfMatches(env, file) {
  var ghHeaders = {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mt3uk-gallery-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  var getRes = await fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + FEATURED_PATH + '?ref=' + BASE_BRANCH,
    { headers: ghHeaders }
  );
  if (!getRes.ok) return;
  var getData = await getRes.json();
  var current = null;
  try { current = JSON.parse(atob(getData.content.replace(/\n/g, ''))); } catch (e) {}
  if (!current || current.file !== file) return;

  var newContent = btoa(JSON.stringify({ file: '', votes: 0, date: '' }, null, 2) + '\n');
  await fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + FEATURED_PATH,
    {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify({
        message: 'Clear featured build (deleted from My Builds: ' + file + ')',
        content: newContent,
        sha: getData.sha,
        branch: BASE_BRANCH
      })
    }
  );
}

async function handleMyBuildsDelete(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var file = new URL(request.url).searchParams.get('file') || '';
  var files = await getSubscriberFiles(env, email);
  if (files.indexOf(file) === -1) {
    return json({ success: false, message: 'That build is not linked to your account' }, 403);
  }

  var carId = null;
  try {
    var sidecarObjForDelete = await env.GALLERY_BUCKET.get('gallery/' + file + '.json');
    if (sidecarObjForDelete) {
      var sidecarForDelete = await sidecarObjForDelete.json();
      if (sidecarForDelete && sidecarForDelete.carId) carId = sidecarForDelete.carId;
    }
  } catch (e) {}

  await env.GALLERY_BUCKET.delete('gallery/' + file);
  await env.GALLERY_BUCKET.delete('gallery/' + file + '.json');
  await removeSubscriberFile(env, email, file);

  if (carId) {
    var carRecordForDelete = await getCarRecord(env, carId);
    if (carRecordForDelete) {
      var remainingPhotos = (carRecordForDelete.photos || []).filter(function (f) { return f !== file; });
      if (remainingPhotos.length) {
        carRecordForDelete.photos = remainingPhotos;
        await saveCarRecord(env, carRecordForDelete);
      } else {
        await deleteCarRecord(env, carId);
      }
    }
  }

  var todayStr = ukDateString(new Date());
  await env.VOTES.delete('votes:' + todayStr + ':' + file);
  await env.VOTES.delete('likes:' + file);

  try {
    await clearFeaturedIfMatches(env, file);
  } catch (e) {
    console.log('Clearing featured build failed (non-critical):', e.message);
  }

  await triggerManifestRebuild(env);

  return json({ success: true, deleted: file });
}

async function handleMyBuildsNotificationsGet(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var list = await getNotifications(env, email);
  var unread = list.reduce(function (n, item) { return item.read ? n : n + 1; }, 0);
  return json({ success: true, notifications: list, unread: unread });
}

async function handleMyBuildsNotificationsRead(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var list = await getNotifications(env, email);
  list.forEach(function (item) { item.read = true; });
  await env.VOTES.put(notificationsKey(email), JSON.stringify(list));

  return json({ success: true });
}

async function handleReviewPost(request, env) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var botcheck = ((body && body.botcheck) || '').toString();
  if (botcheck) {
    return json({ success: false, message: 'Rejected' }, 400);
  }

  var name = ((body && body.name) || '').toString().trim().slice(0, 100);
  var product = ((body && body.product) || '').toString().trim();
  var date = ((body && body.date) || '').toString().trim();
  var rating = parseInt((body && body.rating), 10);
  var comment = ((body && body.comment) || '').toString().trim().slice(0, 500);

  if (!name) return json({ success: false, message: 'Name is required' }, 400);
  if (REVIEW_PRODUCTS.indexOf(product) === -1) return json({ success: false, message: 'Please pick what you purchased' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ success: false, message: 'Please pick a valid date' }, 400);
  if (isNaN(rating) || rating < 1 || rating > 5) return json({ success: false, message: 'Rating must be between 1 and 5' }, 400);
  if (!comment) return json({ success: false, message: 'Please add a short comment' }, 400);

  var rawPhotos = Array.isArray(body && body.photos) ? body.photos.slice(0, MAX_REVIEW_PHOTOS) : [];
  var photos = [];
  for (var i = 0; i < rawPhotos.length; i++) {
    var parsed = parseImageDataUrl(rawPhotos[i]);
    if (!parsed) return json({ success: false, message: 'One of the photos could not be read' }, 400);
    if (base64ByteLength(parsed.base64) > MAX_REVIEW_PHOTO_BYTES) {
      return json({ success: false, message: 'Photos must be under 5MB each' }, 400);
    }
    photos.push(parsed);
  }

  var ghHeaders = {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mt3uk-gallery-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    var getRes = await fetch(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + REVIEWS_PATH + '?ref=' + BASE_BRANCH,
      { headers: ghHeaders }
    );

    var reviews = [];
    var baseSha = null;
    if (getRes.ok) {
      var getData = await getRes.json();
      baseSha = getData.sha;
      try { reviews = JSON.parse(atob(getData.content.replace(/\n/g, ''))); } catch (e) {}
      if (!Array.isArray(reviews)) reviews = [];
    } else if (getRes.status !== 404) {
      throw new Error('Could not read reviews.json (' + getRes.status + ')');
    }

    var timestamp = Date.now();
    var branchName = 'review/' + timestamp + '-' + product;

    var refRes = await fetch(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + BASE_BRANCH,
      { headers: ghHeaders }
    );
    if (!refRes.ok) throw new Error('Could not read base branch (' + refRes.status + ')');
    var refData = await refRes.json();
    var baseBranchSha = refData.object.sha;

    var createRefRes = await fetch(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/git/refs',
      {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({ ref: 'refs/heads/' + branchName, sha: baseBranchSha })
      }
    );
    if (!createRefRes.ok) throw new Error('Could not create branch (' + createRefRes.status + ')');

    var photoPaths = [];
    for (var p = 0; p < photos.length; p++) {
      var photoPath = REVIEW_PHOTOS_PATH + '/' + timestamp + '-' + slugify(product) + '-' + (p + 1) + photos[p].ext;
      var photoPutRes = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + photoPath,
        {
          method: 'PUT',
          headers: ghHeaders,
          body: JSON.stringify({
            message: 'Add review photo for ' + product + ' from ' + name,
            content: photos[p].base64,
            branch: branchName
          })
        }
      );
      if (!photoPutRes.ok) throw new Error('Could not commit review photo (' + photoPutRes.status + ')');
      photoPaths.push(photoPath);
    }

    reviews.push({ product: product, name: name, date: date, rating: rating, comment: comment, photos: photoPaths });

    var newContent = btoa(unescape(encodeURIComponent(JSON.stringify(reviews, null, 2) + '\n')));

    var putBody = {
      message: 'Add review for ' + product + ' from ' + name,
      content: newContent,
      branch: branchName
    };
    if (baseSha) putBody.sha = baseSha;

    var putRes = await fetch(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + REVIEWS_PATH,
      {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify(putBody)
      }
    );
    if (!putRes.ok) throw new Error('Could not commit review (' + putRes.status + ')');

    var prBody = '**Product:** ' + product + '\n**Rating:** ' + rating + '/5\n**Submitted by:** ' + name +
      '\n**Comment:** ' + comment + '\n**Photos:** ' + photoPaths.length +
      '\n\nMerge this PR to publish the review on the site, or close it to reject the submission.';

    var prRes = await fetch(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/pulls',
      {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({
          title: 'Review submission: ' + product + ' (' + rating + '/5 by ' + name + ')',
          head: branchName,
          base: BASE_BRANCH,
          body: prBody
        })
      }
    );
    if (!prRes.ok) throw new Error('Could not open pull request (' + prRes.status + ')');
    var prData = await prRes.json();

    try {
      await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/issues/' + prData.number + '/comments',
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            body: '@' + OWNER + ' New review submission for review!'
          })
        }
      );
    } catch (commentErr) {
      console.log('Comment creation failed (non-critical):', commentErr.message);
    }

    return json({ success: true, pr_url: prData.html_url });
  } catch (err) {
    return json({ success: false, message: err.message }, 500);
  }
}

async function tallyVotesIfUkMidnight(env) {
  var now = new Date();
  var ukHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(now);
  if (ukHour !== '00') return;

  var todayStr = ukDateString(now);
  var closedDay = addDaysToDateString(todayStr, -1);
  var prefix = 'votes:' + closedDay + ':';

  var list = await env.VOTES.list({ prefix: prefix });
  if (!list.keys.length) return;

  var counts = [];
  var winnerVotes = 0;
  for (var i = 0; i < list.keys.length; i++) {
    var key = list.keys[i];
    var count = parseInt((await env.VOTES.get(key.name)) || '0', 10);
    counts.push({ file: key.name.slice(prefix.length), votes: count });
    if (count > winnerVotes) winnerVotes = count;
  }
  if (winnerVotes < 1) return;

  var tied = counts.filter(function (c) { return c.votes === winnerVotes; });
  var winnerFile = tied[0].file;

  if (tied.length > 1) {
    // Tie-break: the candidate whose most recent counted vote came in
    // earliest is treated as the first to reach the tied vote count.
    var metaPrefix = 'voter-meta:' + closedDay + ':';
    var metaList = await env.VOTES.list({ prefix: metaPrefix });
    var latestVoteAt = {};
    await Promise.all(metaList.keys.map(async function (k) {
      var raw = await env.VOTES.get(k.name);
      var meta = null;
      try { meta = JSON.parse(raw); } catch (e) {}
      if (!meta || !meta.file || !meta.ts) return;
      if (!latestVoteAt[meta.file] || meta.ts > latestVoteAt[meta.file]) {
        latestVoteAt[meta.file] = meta.ts;
      }
    }));

    var earliest = tied[0];
    var earliestTs = latestVoteAt[earliest.file] || Infinity;
    for (var t = 1; t < tied.length; t++) {
      var ts = latestVoteAt[tied[t].file] || Infinity;
      if (ts < earliestTs) {
        earliestTs = ts;
        earliest = tied[t];
      }
    }
    winnerFile = earliest.file;
  }

  var ghHeaders = {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mt3uk-gallery-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  var getRes = await fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + FEATURED_PATH + '?ref=' + BASE_BRANCH,
    { headers: ghHeaders }
  );
  if (!getRes.ok) throw new Error('Could not read featured.json (' + getRes.status + ')');
  var getData = await getRes.json();

  var currentDecoded = null;
  try { currentDecoded = JSON.parse(atob(getData.content.replace(/\n/g, ''))); } catch (e) {}
  if (currentDecoded && currentDecoded.file === winnerFile && currentDecoded.date === closedDay) return;

  var newContent = btoa(JSON.stringify({ file: winnerFile, votes: winnerVotes, date: closedDay }, null, 2) + '\n');

  var putRes = await fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + FEATURED_PATH,
    {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify({
        message: 'Feature ' + winnerFile + ' as Build of the Day (daily vote, ' + closedDay + ')',
        content: newContent,
        sha: getData.sha,
        branch: BASE_BRANCH
      })
    }
  );
  if (!putRes.ok) throw new Error('Could not update featured.json (' + putRes.status + ')');
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    // Piggyback the 8pm subscribers digest on any request, same reasoning
    // as the vote tally below: cron triggers aren't reliably firing on this account.
    ctx.waitUntil(sendSubscribersDigestIfUk8pm(env).catch(function (e) {
      console.log('Subscribers digest failed:', e.message);
    }));

    if (url.pathname === '/votes' || url.pathname === '/vote') {
      // Cron triggers aren't reliably invoking `scheduled` on this account, so
      // piggyback the midnight tally on normal vote traffic as a safety net.
      ctx.waitUntil(tallyVotesIfUkMidnight(env).catch(function (e) {
        console.log('Tally failed:', e.message);
      }));
    }

    if (url.pathname === '/admin/send-digest' && request.method === 'POST') {
      return handleAdminSendDigest(request, env);
    }

    if (url.pathname === '/votes/all' && request.method === 'GET') {
      return handleVotesAll(request, env);
    }
    if (url.pathname === '/votes/all' && request.method === 'DELETE') {
      return handleVoteDelete(request, env);
    }
    if (url.pathname === '/votes/all' && request.method === 'PUT') {
      return handleVoteSet(request, env);
    }
    if (url.pathname === '/votes/voters' && request.method === 'GET') {
      return handleVotersList(request, env);
    }
    if (url.pathname === '/votes' && request.method === 'GET') {
      return handleVotesGet(request, env, ctx);
    }
    if (url.pathname === '/vote' && request.method === 'POST') {
      return handleVotePost(request, env, ctx);
    }
    if (url.pathname === '/review' && request.method === 'POST') {
      return handleReviewPost(request, env);
    }
    if (url.pathname === '/likes' && request.method === 'GET') {
      return handleLikesGet(request, env, ctx);
    }
    if (url.pathname === '/likes' && request.method === 'POST') {
      return handleLikePost(request, env, ctx);
    }
    if (url.pathname === '/comments/admin' && request.method === 'GET') {
      return handleCommentsAdminList(request, env);
    }
    if (url.pathname === '/comments/admin' && request.method === 'DELETE') {
      return handleCommentsAdminDelete(request, env);
    }
    if (url.pathname === '/comments/report' && request.method === 'POST') {
      return handleCommentReport(request, env, ctx);
    }
    if (url.pathname === '/gallery/report' && request.method === 'POST') {
      return handlePhotoReport(request, env);
    }
    if (url.pathname === '/gallery/admin/reports' && request.method === 'GET') {
      return handlePhotoReportsAdminList(request, env);
    }
    if (url.pathname === '/gallery/admin/reports/dismiss' && request.method === 'POST') {
      return handlePhotoReportsAdminDismiss(request, env);
    }
    if (url.pathname === '/gallery/admin/photo' && request.method === 'DELETE') {
      return handleGalleryAdminPhotoDelete(request, env);
    }
    if (url.pathname === '/gallery/claim' && request.method === 'POST') {
      return handleGalleryClaim(request, env);
    }
    if (url.pathname === '/gallery/admin/claims' && request.method === 'GET') {
      return handleGalleryClaimsAdminList(request, env);
    }
    if (url.pathname === '/gallery/admin/claims/decide' && request.method === 'POST') {
      return handleGalleryClaimsAdminDecide(request, env);
    }
    if (url.pathname === '/gallery/admin/claims/undo' && request.method === 'POST') {
      return handleGalleryClaimsAdminUndo(request, env);
    }
    if (url.pathname === '/gallery/admin/claims/assign' && request.method === 'POST') {
      return handleGalleryClaimsAdminAssign(request, env);
    }
    if (url.pathname === '/gallery/admin/unclaimed' && request.method === 'GET') {
      return handleGalleryAdminUnclaimedList(request, env);
    }
    if (url.pathname === '/gallery/admin/subscribers' && request.method === 'GET') {
      return handleGalleryAdminSubscribersList(request, env);
    }
    if (url.pathname === '/gallery/admin/subscribers' && request.method === 'POST') {
      return handleGalleryAdminSubscriberCreate(request, env);
    }
    if (url.pathname === '/gallery/admin/subscribers/rename' && request.method === 'POST') {
      return handleGalleryAdminSubscriberRename(request, env);
    }
    if (url.pathname === '/gallery/admin/subscribers/unassign' && request.method === 'POST') {
      return handleGalleryAdminSubscriberUnassign(request, env);
    }
    if (url.pathname === '/gallery/admin/subscribers' && request.method === 'DELETE') {
      return handleGalleryAdminSubscriberDelete(request, env);
    }
    if (url.pathname === '/comments/like' && request.method === 'POST') {
      return handleCommentLike(request, env, ctx);
    }
    if (url.pathname === '/comments' && request.method === 'GET') {
      return handleCommentsGet(request, env, ctx);
    }
    if (url.pathname === '/comment-counts' && request.method === 'GET') {
      return handleCommentCountsGet(request, env, ctx);
    }
    if (url.pathname === '/comments' && request.method === 'POST') {
      return handleCommentsPost(request, env, ctx);
    }
    if (url.pathname === '/comments/mine' && request.method === 'DELETE') {
      return handleCommentsSelfDelete(request, env);
    }
    if (url.pathname === '/shop-products' && request.method === 'GET') {
      return handleShopProducts(request, ctx);
    }
    if (url.pathname === '/my-builds/request-link' && request.method === 'POST') {
      return handleMyBuildsRequestLink(request, env);
    }
    if (url.pathname === '/my-builds/session' && request.method === 'GET') {
      return handleMyBuildsSession(request, env);
    }
    if (url.pathname === '/my-builds' && request.method === 'GET') {
      return handleMyBuildsGet(request, env);
    }
    if (url.pathname === '/my-builds/upload' && request.method === 'POST') {
      return handleMyBuildsUpload(request, env);
    }
    if (url.pathname === '/my-builds' && request.method === 'PUT') {
      return handleMyBuildsUpdate(request, env);
    }
    if (url.pathname === '/my-builds/car' && request.method === 'PUT') {
      return handleMyBuildsCarUpdate(request, env);
    }
    if (url.pathname === '/my-builds/photo/move' && request.method === 'PUT') {
      return handleMyBuildsPhotoMove(request, env);
    }
    if (url.pathname === '/my-builds' && request.method === 'DELETE') {
      return handleMyBuildsDelete(request, env);
    }
    if (url.pathname === '/my-builds/notifications' && request.method === 'GET') {
      return handleMyBuildsNotificationsGet(request, env);
    }
    if (url.pathname === '/my-builds/notifications/read' && request.method === 'POST') {
      return handleMyBuildsNotificationsRead(request, env);
    }

    if (request.method !== 'POST') {
      return json({ success: false, message: 'Method not allowed' }, 405);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return json({ success: false, message: 'Invalid form submission' }, 400);
    }

    var botcheck = (formData.get('botcheck') || '').toString();
    if (botcheck) {
      return json({ success: false, message: 'Rejected' }, 400);
    }

    var submitIp = getClientIp(request);
    var cooldownKey = 'gallery-submit-ip:' + submitIp;
    // Temporarily disabled for testing - re-enable once My Builds/upload
    // flow testing is done.
    // var onCooldown = await env.VOTES.get(cooldownKey);
    // if (onCooldown) {
    //   return json({ success: false, message: "You've already submitted a build in the last 24 hours. Please try again tomorrow." }, 429);
    // }

    var name = (formData.get('name') || '').toString().trim().slice(0, 100);
    var email = (formData.get('email') || '').toString().trim().toLowerCase().slice(0, 200);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, message: 'Please enter a valid email' }, 400);
    }
    var caption = (formData.get('caption') || '').toString().trim().slice(0, 150);
    var carName = (formData.get('carName') || '').toString().trim().slice(0, 150);
    var modsRaw = (formData.get('mods') || '').toString().trim().slice(0, 1000);
    var mods = modsRaw
      ? modsRaw.split(/[,\n]/).map(function (m) { return m.trim(); }).filter(Boolean).slice(0, 20)
      : [];
    var color = (formData.get('color') || '').toString().trim().slice(0, 20);
    if (color && CAR_COLORS.indexOf(color) === -1) color = '';
    var files = formData.getAll('photo').filter(function (f) { return f && typeof f !== 'string'; });

    if (!caption) {
      return json({ success: false, message: 'Caption is required' }, 400);
    }
    if (!files.length) {
      return json({ success: false, message: 'Photo is required' }, 400);
    }
    if (files.length > MAX_GALLERY_PHOTOS) {
      return json({ success: false, message: 'You can upload up to ' + MAX_GALLERY_PHOTOS + ' photos at once' }, 400);
    }
    for (var fi = 0; fi < files.length; fi++) {
      if (files[fi].size > 10 * 1024 * 1024) {
        return json({ success: false, message: 'Each photo must be under 10MB' }, 400);
      }
      if (!files[fi].type || files[fi].type.indexOf('image/') !== 0) {
        return json({ success: false, message: 'Files must be images' }, 400);
      }
    }

    var ghHeaders = {
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'mt3uk-gallery-worker',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    try {
      var slug = slugify(caption);
      var nameSlug = name ? slugify(name) : '';
      var baseSlug = nameSlug ? slug + '--by-' + nameSlug : slug;

      var listed = await env.GALLERY_BUCKET.list({ prefix: 'gallery/' });
      var existingNames = listed.objects.map(function (obj) { return obj.key.slice('gallery/'.length); });

      var photoUrls = [];
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var extMatch = (file.name || '').match(/\.[a-zA-Z0-9]+$/);
        var ext = extMatch ? extMatch[0].toLowerCase() : '.jpg';

        var filename = baseSlug + ext;
        var suffix = 2;
        while (existingNames.indexOf(filename) !== -1 && suffix < 100) {
          filename = baseSlug + '-' + suffix + ext;
          suffix++;
        }
        existingNames.push(filename);

        var arrayBuffer = await file.arrayBuffer();
        await env.GALLERY_BUCKET.put('gallery/' + filename, arrayBuffer, {
          httpMetadata: { contentType: file.type }
        });

        // The first photo is the primary: it carries the mods list and is
        // the one eligible to appear in the voting gallery. Extra photos
        // in the same submission are marked non-votable so only the
        // primary shot shows up for votes.
        var isPrimary = i === 0;
        var sidecar = { email: email };
        if (isPrimary && mods.length) sidecar.mods = mods;
        // Colour is a whole-car attribute (used for gallery filtering), so
        // every photo in the submission carries it, unlike mods which are
        // only credited against the primary/voting shot.
        if (color) sidecar.color = color;
        if (!isPrimary) sidecar.votable = false;
        await env.GALLERY_BUCKET.put(
          'gallery/' + filename + '.json',
          JSON.stringify(sidecar, null, 2) + '\n',
          { httpMetadata: { contentType: 'application/json' } }
        );

        photoUrls.push(GALLERY_PUBLIC_BASE_URL + '/gallery/' + filename);
      }

      // A car name means this submission came from My Garage's "add a car"
      // flow - create a real car record right away instead of relying on
      // the filename-based heuristic grouping used for legacy/public
      // submissions.
      if (carName) {
        var submittedFilenames = existingNames.slice(existingNames.length - photoUrls.length);
        var newCarId = randomToken();
        await Promise.all(submittedFilenames.map(function (f) { return setSidecarCarId(env, f, newCarId, email); }));
        await saveCarRecord(env, {
          id: newCarId,
          email: email,
          name: carName,
          photos: submittedFilenames,
          mods: mods,
          color: color,
          createdAt: new Date().toISOString()
        });
      }

      // No PR/review gate now the photos land straight in R2 - open an
      // issue instead so there's still a notification to act on if a
      // submission needs pulling.
      try {
        var issueRes = await fetch(
          'https://api.github.com/repos/' + OWNER + '/' + REPO + '/issues',
          {
            method: 'POST',
            headers: ghHeaders,
            body: JSON.stringify({
              title: 'Gallery submission: ' + caption,
              body: '**Caption:** ' + caption + '\n**Submitted by:** ' + (name || 'Anonymous') +
                (mods.length ? '\n**Mods (on primary photo):** ' + mods.join(', ') : '') +
                '\n\n' + photoUrls.map(function (u, idx) { return '![photo ' + (idx + 1) + '](' + u + ')'; }).join('\n\n') +
                '\n\nThese photos are already live in the gallery' + (photoUrls.length > 1 ? ' (first one is the primary/voting entry)' : '') + '. Close this issue once reviewed, ' +
                'or say the word to have any of them pulled from R2 and the manifest regenerated.'
            })
          }
        );
        if (!issueRes.ok) console.log('Issue creation failed (non-critical):', issueRes.status);
      } catch (issueErr) {
        console.log('Issue creation failed (non-critical):', issueErr.message);
      }

      // Kick off the manifest/sitemap rebuild now the bucket has new photos.
      try {
        await fetch(
          'https://api.github.com/repos/' + OWNER + '/' + REPO + '/dispatches',
          {
            method: 'POST',
            headers: ghHeaders,
            body: JSON.stringify({ event_type: 'gallery-submission' })
          }
        );
      } catch (dispatchErr) {
        console.log('Manifest rebuild dispatch failed (non-critical):', dispatchErr.message);
      }

      await env.VOTES.put(cooldownKey, '1', { expirationTtl: GALLERY_SUBMIT_COOLDOWN_SECONDS });

      if (email) {
        var submittedFiles = existingNames.slice(existingNames.length - photoUrls.length);
        await addSubscriberFiles(env, email, submittedFiles);

        try {
          var signinToken = randomToken();
          await env.VOTES.put('my-builds-link:' + signinToken, email, { expirationTtl: MY_BUILDS_LINK_TTL_SECONDS });
          var signinLink = MY_BUILDS_SITE_URL + '/my-builds.html?token=' + signinToken;
          await sendMyBuildsLinkEmail(env, email, signinLink);
        } catch (linkErr) {
          console.log('My Builds link email failed:', linkErr.message);
        }
      }

      return json({ success: true, photo_url: photoUrls[0], photo_urls: photoUrls });
    } catch (err) {
      return json({ success: false, message: err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tallyVotesIfUkMidnight(env));
    ctx.waitUntil(sendSubscribersDigestIfUk8pm(env).catch(function (e) {
      console.log('Subscribers digest failed:', e.message);
    }));
  }
};
