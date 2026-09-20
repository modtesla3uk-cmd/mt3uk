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
async function listGalleryEntriesFromR2(env) {
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
        }
      } catch (e) {}
    }

    var entry = { file: filename, mods: mods, votable: votable, gallery: gallery, reel: reel, added: ukDateString(o.uploaded), uploadedAt: o.uploaded.getTime() };
    if (caption) entry.caption = caption;
    if (split.name) entry.name = split.name;
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
    return (p.added === todayStr || p.added === yesterdayStr) && p.votable !== false;
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

function publicComment(c, likedIds) {
  return {
    id: c.id,
    parentId: c.parentId || null,
    name: c.name,
    text: c.text,
    createdAt: c.createdAt,
    likes: c.likes || 0,
    liked: likedIds.indexOf(c.id) !== -1
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
  var visible = comments.filter(function (c) { return !c.hidden; }).map(function (c) {
    return publicComment(c, likedIds);
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
  if (parentId && !comments.some(function (c) { return c.id === parentId; })) {
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

  return json({ success: true, comment: publicComment(comment, []) });
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
  var body = 'Click the link below to manage your MT3UK build(s):\n\n' + link +
    '\n\nThis link expires in 15 minutes and can only be used once. ' +
    'If you did not request this, you can ignore this email.';
  var message = new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body));
  await env.SEND_EMAIL.send(message);
}

async function sendSubscribersDigestIfUk8pm(env) {
  var now = new Date();
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  var ukHour = parts.find(function (p) { return p.type === 'hour'; }).value;
  var ukMinute = parts.find(function (p) { return p.type === 'minute'; }).value;
  // Narrowed to the 20:00 minute (not the whole hour) so that on a busy site,
  // far fewer concurrent requests are racing to claim the send below - KV
  // writes take up to ~60s to propagate globally, so a wide window let a
  // burst of simultaneous requests from different edge locations all read
  // "not sent yet" and each send a duplicate email.
  if (ukHour !== '20' || ukMinute !== '00') return;

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
  if (files.length) {
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
  var manifest = files.length ? await listGalleryEntriesFromR2(env).catch(function () { return []; }) : [];
  var byFile = {};
  manifest.forEach(function (p) { byFile[p.file] = p; });

  // A file can be missing from the live listing if it was deleted straight
  // from R2 (e.g. via the Delete Photo GitHub Action) rather than through
  // this API, which wouldn't have had a chance to prune it from the
  // subscriber's saved file list. Drop it here, and persist the cleanup so
  // it doesn't keep resurfacing as an empty placeholder on every load.
  var liveFiles = files.filter(function (f) { return byFile[f]; });
  if (liveFiles.length !== files.length) {
    await env.VOTES.put('subscriber:' + email, JSON.stringify(liveFiles));
  }

  var builds = await Promise.all(liveFiles.map(async function (f) {
    var entry = byFile[f];
    var comments = await getComments(env, f);
    var visibleComments = comments.filter(function (c) { return !c.hidden; });
    return {
      file: f,
      caption: entry.caption || '',
      mods: entry.mods || [],
      gallery: entry.gallery !== false,
      reel: entry.reel !== false,
      votable: entry.votable !== false,
      commentCount: visibleComments.length
    };
  }));

  return json({ success: true, email: email, builds: builds });
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

  ['gallery', 'reel', 'votable'].forEach(function (flag) {
    if (typeof (body && body[flag]) === 'boolean') {
      if (body[flag] === false) {
        sidecar[flag] = false;
      } else {
        delete sidecar[flag];
      }
    }
  });

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

    var sidecar = {};
    if (mods.length) sidecar.mods = mods;
    if (!gallery) sidecar.gallery = false;
    if (!reel) sidecar.reel = false;
    if (!votable) sidecar.votable = false;
    if (Object.keys(sidecar).length) {
      await env.GALLERY_BUCKET.put(
        'gallery/' + filename + '.json',
        JSON.stringify(sidecar, null, 2) + '\n',
        { httpMetadata: { contentType: 'application/json' } }
      );
    }

    await addSubscriberFiles(env, email, [filename]);

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

  await env.GALLERY_BUCKET.delete('gallery/' + file);
  await env.GALLERY_BUCKET.delete('gallery/' + file + '.json');
  await removeSubscriberFile(env, email, file);

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
    if (url.pathname === '/my-builds' && request.method === 'DELETE') {
      return handleMyBuildsDelete(request, env);
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
    var modsRaw = (formData.get('mods') || '').toString().trim().slice(0, 1000);
    var mods = modsRaw
      ? modsRaw.split(/[,\n]/).map(function (m) { return m.trim(); }).filter(Boolean).slice(0, 20)
      : [];
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
        var sidecar = {};
        if (isPrimary && mods.length) sidecar.mods = mods;
        if (!isPrimary) sidecar.votable = false;
        if (Object.keys(sidecar).length) {
          await env.GALLERY_BUCKET.put(
            'gallery/' + filename + '.json',
            JSON.stringify(sidecar, null, 2) + '\n',
            { httpMetadata: { contentType: 'application/json' } }
          );
        }

        photoUrls.push(GALLERY_PUBLIC_BASE_URL + '/gallery/' + filename);
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
  }
};
