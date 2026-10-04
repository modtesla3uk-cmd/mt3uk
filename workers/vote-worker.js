import { EmailMessage } from 'cloudflare:email';

const OWNER = 'modtesla3uk-cmd';
const REPO = 'mt3uk';
const BASE_BRANCH = 'main';
const FEATURED_PATH = 'data/featured.json';
const REVIEWS_PATH = 'data/reviews.json';
const EVENTS_PATH = 'events-data/events-manifest.json';
const INTERVIEWS_PATH = 'data/interviews.json';
const EVENT_PAGES_PATH = 'data/event-pages.json';
const GALLERY_PUBLIC_BASE_URL = 'https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev';
const MAX_GALLERY_PHOTOS = 3;
const GALLERY_SUBMIT_COOLDOWN_SECONDS = 60 * 60 * 24;
// Votes run for a week (Build of the Week), so they are kept a little longer.
const VOTE_TTL_SECONDS = 60 * 60 * 24 * 10;
const REVIEW_PRODUCTS = ['tee', 'tee-yellow', 'stickers', 'brace', 'pads-street', 'pads-carbotech'];
const REVIEW_PHOTOS_PATH = 'images/reviews';
const MAX_REVIEW_PHOTOS = 3;
const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;
const SHOPIFY_PRODUCTS_URL = 'https://mt3uk.myshopify.com/products.json?limit=250';
const SHOP_PRODUCTS_CACHE_SECONDS = 60 * 2;
// A real address on a domain that receives mail (Cloudflare Email Routing
// forwards hello@mt3uk.com to the MT3UK Gmail), so replies arrive and
// Outlook doesn't see a no-reply sender on a domain with no inbox.
const MY_BUILDS_FROM_EMAIL = 'hello@mt3uk.com';
const MY_BUILDS_LINK_TTL_SECONDS = 15 * 60;
const BUILD_ASSIGNED_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
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
      'Access-Control-Allow-Headers': 'Content-Type, X-Voter-Id, X-Session-Token, X-Admin-Viewer'
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

// Build of the Week voting runs Monday to Sunday, UK time. Vote keys are
// named after the Monday the week starts on (e.g. votes:2026-09-28:<file>),
// and the winner is picked just after midnight on the next Monday.
function voteWeekString(date) {
  var todayStr = ukDateString(date);
  var weekday = new Date(todayStr + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return addDaysToDateString(todayStr, -((weekday + 6) % 7));
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
  // A blank caption makes the upload name the file "photo" (see slugify): not a caption.
  if (words.length === 1 && words[0].toLowerCase() === 'photo') return '';
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
    var carId = null;
    var votableSince = null;
    var color = null;
    var sidecarEmail = null;
    var sidecarOwner = null;
    var sidecarName = null;
    var voteBlocked = false;
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
          if (typeof sidecar.owner === 'string' && sidecar.owner) sidecarOwner = sidecar.owner;
          if (sidecar.voteBlocked === true) voteBlocked = true;
          // As the member wrote it: nicknames keep their own capitals.
          if (typeof sidecar.name === 'string' && sidecar.name.trim()) sidecarName = sidecar.name.trim();
        }
      } catch (e) {}
    }

    var entry = { file: filename, mods: mods, votable: votable, gallery: gallery, reel: reel, added: ukDateString(o.uploaded), uploadedAt: o.uploaded.getTime() };
    if (caption) entry.caption = caption;
    if (sidecarName || split.name) entry.name = sidecarName || split.name;
    if (carId) entry.carId = carId;
    if (color) entry.color = color;
    // Non-sensitive: lets the site show a "Claim this build" control on
    // legacy photos uploaded before My Garage accounts existed, without
    // exposing the actual owner email to public callers.
    if (!sidecarEmail && !sidecarOwner) entry.unclaimed = true;
    // Who the photo belongs to, as a one-way key rather than the email, so
    // the vote can allow one entry per member and stop members voting for
    // their own build.
    if (sidecarOwner) entry.owner = sidecarOwner;
    else if (sidecarEmail) entry.owner = await ownerKey(sidecarEmail);
    // votableSince lets a photo that's re-enabled for voting after being opted
    // out become eligible again immediately, instead of being stuck outside the
    // today/yesterday eligibility window keyed off its original upload date.
    if (votableSince) entry.votableSince = votableSince;
    // Taken out of voting from the Admin page; the owner can't re-enter it.
    if (voteBlocked) entry.voteBlocked = true;
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

// The live photo list for the site, so a new upload shows in the reel and
// gallery within seconds, before the published manifest catches up. Only the
// fields the manifest has: never emails or owner keys. Same edge cache as
// the rest (GALLERY_LIVE_CACHE_SECONDS).
async function handleGalleryLive(request, env, ctx) {
  var entries = (await getLiveGalleryEntries(env, ctx)).slice()
    .sort(function (a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); });
  var groups = {};
  var photos = entries.map(function (e) {
    var p = { file: e.file, added: e.added };
    if (e.caption) p.caption = e.caption;
    if (e.name) p.name = e.name;
    if (e.mods && e.mods.length) p.mods = e.mods;
    if (e.votable === false) p.votable = false;
    if (e.gallery === false) p.gallery = false;
    if (e.reel === false) p.reel = false;
    if (e.color) p.color = e.color;
    if (e.unclaimed) p.unclaimed = true;
    // Same-day photos from one owner share a post in the reel, as in the
    // manifest (scripts/build_gallery_manifest.py).
    var key = (e.owner || e.file) + '|' + e.added;
    p.group = groups[key] || (groups[key] = e.file);
    return p;
  });
  return new Response(JSON.stringify({ success: true, photos: photos }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=' + GALLERY_LIVE_CACHE_SECONDS,
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function titleCaseWords(value) {
  return String(value || '').toLowerCase().replace(/(^|[\s-])([a-z])/g, function (m, sep, c) { return sep + c.toUpperCase(); });
}

async function ownerKey(email) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mt3uk-owner:' + String(email).toLowerCase()));
  return Array.prototype.map.call(new Uint8Array(digest).slice(0, 8), function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

// A photo is open for a week's vote if it was added (or entered into the
// vote) this week or last week and voting is on for it.
function isOpenForVote(p, weekStr) {
  var refDate = p.votableSince || p.added;
  return !!refDate && refDate >= addDaysToDateString(weekStr, -7) && p.votable !== false && !p.voteBlocked;
}

// Every entry in a week's vote, one per member. My Garage switches voting
// off on a member's other photos when they enter one, so normally there is
// only one; if there are more, the one entered first stays in.
function voteEntries(manifest, weekStr) {
  var seen = {};
  return manifest.filter(function (p) { return isOpenForVote(p, weekStr); })
    .sort(function (a, b) {
      var ra = a.votableSince || a.added;
      var rb = b.votableSince || b.added;
      if (ra !== rb) return ra < rb ? -1 : 1;
      return (a.uploadedAt || 0) - (b.uploadedAt || 0);
    })
    .filter(function (p) {
      if (!p.owner) return true;
      if (seen[p.owner]) return false;
      seen[p.owner] = true;
      return true;
    });
}

// Builds shown for this week's vote, newest first. Every entry is shown:
// the homepage lays them out as a grid with Load more.
function votingCandidates(manifest, weekStr) {
  return voteEntries(manifest, weekStr).sort(function (a, b) {
    return (b.uploadedAt || 0) - (a.uploadedAt || 0);
  });
}

// A member's entry in this week's vote, if they have one.
function memberVoteEntry(manifest, weekStr, owner) {
  return voteEntries(manifest, weekStr).filter(function (p) { return p.owner === owner; })[0] || null;
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

// ---------- Events admin ----------
// events-admin.html edits events-data/events-manifest.json in the repo, the
// same file the homepage reads and the Add or Update Event workflow writes.
// Ids are sequential and padded to 3 digits (001, 002, ...), never reused, to
// match scripts/event-utils.js.

function eventsGithubHeaders(env) {
  return {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mt3uk-gallery-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function readEventsManifest(env) {
  var res = await fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + EVENTS_PATH + '?ref=' + BASE_BRANCH,
    { headers: eventsGithubHeaders(env), cf: { cacheTtl: 0 } }
  );
  if (!res.ok) throw new Error('Could not read the events file (' + res.status + ')');
  var data = await res.json();
  var text = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  var manifest = JSON.parse(text);
  if (!Array.isArray(manifest.events)) manifest.events = [];
  return { manifest: manifest, sha: data.sha };
}

function formatEventId(n) {
  return String(n).padStart(3, '0');
}

// lastId remembers the highest id ever given out, so deleting the newest
// event does not free its number for reuse.
function highestEventId(manifest) {
  var max = manifest.lastId || 0;
  manifest.events.forEach(function (ev) {
    var n = parseInt(ev.id, 10);
    if (n > max) max = n;
  });
  return max;
}

function nextEventId(manifest) {
  manifest.lastId = highestEventId(manifest) + 1;
  return formatEventId(manifest.lastId);
}

// Reads the latest file, applies `change` to it and commits the result. If
// something else committed the file in between (a 409), it tries once more
// on the newer copy so that change is not lost.
async function updateEventsManifest(env, message, change) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var current = await readEventsManifest(env);
    var manifest = current.manifest;
    var result = change(manifest);
    manifest.totalEvents = manifest.events.length;
    manifest.generated = new Date().toISOString();
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2) + '\n')));
    var putRes = await fetch(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + EVENTS_PATH,
      {
        method: 'PUT',
        headers: eventsGithubHeaders(env),
        body: JSON.stringify({ message: message(result), content: content, sha: current.sha, branch: BASE_BRANCH })
      }
    );
    if (putRes.ok) return { manifest: manifest, result: result };
    if (putRes.status !== 409 && putRes.status !== 422) {
      throw new Error('Could not save the events file (' + putRes.status + ')');
    }
  }
  throw new Error('The events file was changed by something else at the same time, please try again');
}

function eventsAdminAuthorised(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  return !!env.ADMIN_KEY && key === env.ADMIN_KEY;
}

function eventSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Checks the form fields and turns them into the stored event shape, or
// returns { error } explaining what is wrong.
function buildEventFromInput(input) {
  var str = function (v) { return typeof v === 'string' ? v.trim() : ''; };
  var name = str(input.name);
  var startDate = str(input.startDate);
  var startTime = str(input.startTime);
  var endDate = str(input.endDate) || startDate;
  var endTime = str(input.endTime) || startTime;
  var location = str(input.location);
  var facebookUrl = str(input.facebookUrl);
  var dateRe = /^\d{4}-\d{2}-\d{2}$/;
  var timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!name) return { error: 'Event name is required' };
  if (!dateRe.test(startDate)) return { error: 'Start date is required' };
  if (!timeRe.test(startTime)) return { error: 'Start time is required' };
  if (!dateRe.test(endDate) || !timeRe.test(endTime)) return { error: 'End date or time is not valid' };
  if (endDate + endTime < startDate + startTime) return { error: 'The end is before the start, check the end date and time' };
  if (!location) return { error: 'Location is required' };
  if (!/^https?:\/\/\S+\.\S+/.test(facebookUrl)) return { error: 'Event link must be a full web address starting with https://' };

  var count = function (v) {
    var n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  };

  return {
    event: {
      name: name,
      description: str(input.description),
      startTime: startDate + 'T' + startTime + ':00+0000',
      endTime: endDate + 'T' + endTime + ':00+0000',
      location: { name: location },
      facebookUrl: facebookUrl,
      attendingCount: count(input.attendingCount),
      interestedCount: count(input.interestedCount)
    }
  };
}

async function handleEventsAdminList(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  try {
    var current = await readEventsManifest(env);
    return json({ success: true, events: current.manifest.events });
  } catch (err) {
    return json({ success: false, message: err.message }, 500);
  }
}

async function handleEventsAdminSave(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var built = buildEventFromInput(body || {});
  if (built.error) return json({ success: false, message: built.error }, 400);
  var id = typeof body.id === 'string' ? body.id.trim() : '';

  try {
    var saved = await updateEventsManifest(env,
      function (r) { return (id ? 'Edit event ' : 'Add event ') + r.id + ': ' + built.event.name + ' (events admin)'; },
      function (manifest) {
        var idx = -1;
        if (id) {
          idx = manifest.events.findIndex(function (ev) { return ev.id === id; });
          if (idx < 0) throw new Error('Event ' + id + ' no longer exists, reload the page');
        }
        // Two events with the same name and start date would confuse the
        // Add or Update Event workflow, which matches on those.
        var slug = eventSlug(built.event.name);
        var day = built.event.startTime.slice(0, 10);
        var clash = manifest.events.find(function (ev, i) {
          return i !== idx && eventSlug(ev.name) === slug && ev.startTime.slice(0, 10) === day;
        });
        if (clash) throw new Error('Event ' + clash.id + ' already has that name and start date');

        var record = Object.assign({ id: id || nextEventId(manifest) }, built.event);
        if (idx >= 0) manifest.events[idx] = record;
        else manifest.events.push(record);
        return record;
      });
    return json({ success: true, event: saved.result, events: saved.manifest.events });
  } catch (err) {
    return json({ success: false, message: err.message }, 400);
  }
}

async function handleEventsAdminDelete(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var id = (new URL(request.url).searchParams.get('id') || '').trim();
  if (!id) return json({ success: false, message: 'Missing event id' }, 400);

  try {
    var saved = await updateEventsManifest(env,
      function (r) { return 'Delete event ' + r.id + ': ' + r.name + ' (events admin)'; },
      function (manifest) {
        var idx = manifest.events.findIndex(function (ev) { return ev.id === id; });
        if (idx < 0) throw new Error('Event ' + id + ' no longer exists, reload the page');
        manifest.lastId = highestEventId(manifest);
        return manifest.events.splice(idx, 1)[0];
      });
    return json({ success: true, events: saved.manifest.events });
  } catch (err) {
    return json({ success: false, message: err.message }, 400);
  }
}

// ---------- Interviews admin ----------
// admin.html edits each Owner Interview's publish date, name, title and excerpt in
// data/interviews.json, the file the homepage, blog.html and the interview
// comment threads read. Each save is one commit to main, which redeploys the
// site. Every change carries the value the admin saw ("from"), so a save is
// refused if the file changed in the meantime rather than overwriting it.

var INTERVIEW_TEXT_LIMITS = { name: 60, title: 200, excerpt: 400 };

async function readInterviewsFile(env) {
  var res = await fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + INTERVIEWS_PATH + '?ref=' + BASE_BRANCH,
    { headers: eventsGithubHeaders(env), cf: { cacheTtl: 0 } }
  );
  if (!res.ok) throw new Error('Could not read the interviews file (' + res.status + ')');
  var data = await res.json();
  var text = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  var file = JSON.parse(text);
  if (!Array.isArray(file.interviews)) file.interviews = [];
  return { file: file, sha: data.sha };
}

function isValidIsoDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var d = new Date(value + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === value;
}

// Applies the changes to the file and returns one line per changed field,
// or throws with a message the admin page can show.
function applyInterviewChanges(file, changes) {
  var lines = [];
  changes.forEach(function (change) {
    var iv = file.interviews.find(function (i) { return i.url === change.url; });
    if (!iv) throw new Error('No interview with the page ' + change.url + ', reload the page');
    var from = change.from || {};
    var to = change.to || {};
    Object.keys(to).forEach(function (field) {
      if (field !== 'publish' && !INTERVIEW_TEXT_LIMITS[field]) throw new Error('The ' + field + ' field cannot be edited here');
      var value = typeof to[field] === 'string' ? to[field].trim() : '';
      if (field === 'publish') {
        if (!isValidIsoDay(value)) throw new Error(iv.name + ': the publish date is not a valid date');
      } else {
        if (!value) throw new Error(iv.name + ': the ' + field + ' cannot be empty');
        if (value.length > INTERVIEW_TEXT_LIMITS[field]) throw new Error(iv.name + ': the ' + field + ' is too long');
      }
      if ((iv[field] || '') !== (from[field] || '')) {
        throw new Error(iv.name + ': the ' + (field === 'publish' ? 'publish date' : field) + ' was changed somewhere else since you loaded the page, reload and try again');
      }
      if (iv[field] === value) return;
      if (field === 'publish') lines.push(iv.name + ' publish ' + (iv.publish || 'none') + ' to ' + value);
      else if (field === 'name') lines.push(iv.name + ' renamed to ' + value);
      else lines.push(iv.name + ' ' + field + ' edited');
      iv[field] = value;
    });
  });
  if (!lines.length) throw new Error('Nothing has changed');
  file.interviews.sort(function (a, b) { return (a.publish || '9999') < (b.publish || '9999') ? -1 : (a.publish || '9999') > (b.publish || '9999') ? 1 : 0; });
  return lines;
}

async function handleInterviewsAdminList(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  try {
    var current = await readInterviewsFile(env);
    return json({ success: true, interviews: current.file.interviews });
  } catch (err) {
    return json({ success: false, message: err.message }, 500);
  }
}

async function handleInterviewsAdminSave(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var changes = body && body.changes;
  if (!Array.isArray(changes) || !changes.length || changes.length > 50) {
    return json({ success: false, message: 'No changes to save' }, 400);
  }

  try {
    // One retry on a 409, in case something else committed the file in between.
    for (var attempt = 0; attempt < 2; attempt++) {
      var current = await readInterviewsFile(env);
      var lines = applyInterviewChanges(current.file, changes);
      var content = btoa(unescape(encodeURIComponent(JSON.stringify(current.file, null, 2) + '\n')));
      var message = 'Update Owner Interviews (admin): ' + lines.join(', ');
      if (message.length > 200) message = 'Update Owner Interviews (admin): ' + lines.length + ' changes\n\n' + lines.join('\n');
      var putRes = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + INTERVIEWS_PATH,
        {
          method: 'PUT',
          headers: eventsGithubHeaders(env),
          body: JSON.stringify({ message: message, content: content, sha: current.sha, branch: BASE_BRANCH })
        }
      );
      if (putRes.ok) return json({ success: true, interviews: current.file.interviews, changes: lines });
      if (putRes.status !== 409 && putRes.status !== 422) {
        throw new Error('Could not save the interviews file (' + putRes.status + ')');
      }
    }
    throw new Error('The interviews file was changed by something else at the same time, please try again');
  } catch (err) {
    return json({ success: false, message: err.message }, 400);
  }
}

// ---------- Member profile, friends and messages ----------
// profile.html. A member's own things are each one JSON key read with get():
// profile:<email> (names, nickname, emailsOff, dmBlocked, broadcastsSeenAt),
// friends:<email> (friends and requests) and dm-index:<email> (their message
// threads). Nicknames are unique, with one index key (nickname -> email).
// Other members are only ever shown by nickname or name and an opaque id
// (ownerKey), never by email.

var NICKNAMES_KEY = 'nicknames';
var BROADCASTS_KEY = 'broadcasts';
var DM_REPORTS_KEY = 'dm-reports';
var MAX_FRIENDS = 100;
var MAX_FRIEND_REQUESTS = 50;
var MAX_DM_PER_THREAD = 200;
var MAX_DM_LENGTH = 1000;
var DM_SEND_LIMIT_PER_HOUR = 60;
// Photos in messages: shrunk on the phone first, kept for 90 days (an R2
// lifecycle rule on dm/ deletes them; the worker stops serving them too).
var MAX_DM_PHOTO_BYTES = 2 * 1024 * 1024;
var DM_PHOTO_DAYS = 90;
var MAX_DM_LINKS = 5;
var MAX_BROADCASTS = 50;
var BROADCAST_EMAIL_BATCH = 40;
var PROFILE_URL = MY_BUILDS_SITE_URL + '/profile.html';
// Kept short with no links: Outlook put member emails with a two-link
// footer in Junk, while the same text with no footer reached the inbox.
// The one-click Unsubscribe header (listUnsubscribeHeaders) stays.
var EMAIL_FOOTER = '\n\n--\nYou can turn these emails off in your MT3UK Profile, under Email alerts.';

async function getProfileRecord(env, email) {
  if (!email) return {};
  try {
    var raw = await env.VOTES.get('profile:' + email);
    var parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

async function putProfileRecord(env, email, profile) {
  profile.updatedAt = new Date().toISOString();
  await env.VOTES.put('profile:' + email, JSON.stringify(profile));
}

// The name other members see: the nickname if there is one, otherwise
// first and last name. A member can choose to show their full name instead
// (Visibility in Profile, showName 'name').
function publicName(profile) {
  if (!profile) return '';
  var full = profile.firstName && profile.lastName ? profile.firstName + ' ' + profile.lastName : '';
  if (profile.showName === 'name' && full) return full;
  return profile.nickname || full;
}

async function publicNameFor(env, email) {
  return publicName(await getProfileRecord(env, email)) || displayNameFromEmail(email);
}

// Stop emails: comment, friend and message alerts and messages to
// subscribers. Sign-in codes and links always send.
async function wantsEmails(env, email) {
  return !(await getProfileRecord(env, email)).emailsOff;
}

async function sendMemberEmail(env, toEmail, subject, body) {
  if (!(await wantsEmails(env, toEmail))) return false;
  try {
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body + EMAIL_FOOTER, await memberEmailHeaders(env, toEmail))));
    return true;
  } catch (err) {
    console.log('Member email failed:', err.message);
    return false;
  }
}

function cleanNickname(value) {
  var nick = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/.test(nick) ? nick : null;
}

async function getJsonKey(env, key, fallback) {
  try {
    var raw = await env.VOTES.get(key);
    var parsed = raw ? JSON.parse(raw) : null;
    return parsed == null ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

// Friend search by real name: one key, nickname (lower case) -> the
// member's "first last" in lower case, or '' when they've chosen not to be
// found by it. Kept up to date on profile saves and filled in by the search
// for anyone missing.
var MEMBER_NAMES_KEY = 'member-names';

async function getMemberNames(env) {
  var map = await getJsonKey(env, MEMBER_NAMES_KEY, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

function searchableName(profile) {
  if (!profile || profile.hideRealName || !profile.firstName || !profile.lastName) return '';
  return (profile.firstName + ' ' + profile.lastName).toLowerCase();
}

// Updates the member's entry, and drops the one for an old nickname.
async function syncMemberName(env, email, oldNickname) {
  var profile = await getProfileRecord(env, email);
  var map = await getMemberNames(env);
  var changed = false;
  if (oldNickname && oldNickname.toLowerCase() !== (profile.nickname || '').toLowerCase() && oldNickname.toLowerCase() in map) {
    delete map[oldNickname.toLowerCase()];
    changed = true;
  }
  if (profile.nickname) {
    var nick = profile.nickname.toLowerCase();
    var name = searchableName(profile);
    if (map[nick] !== name) { map[nick] = name; changed = true; }
  }
  if (changed) await env.VOTES.put(MEMBER_NAMES_KEY, JSON.stringify(map));
}

async function getNicknames(env) {
  var map = await getJsonKey(env, NICKNAMES_KEY, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

// Sets (or clears, with '') a member's nickname. Returns an error message,
// or '' when saved.
async function setNickname(env, email, nickname) {
  var profile = await getProfileRecord(env, email);
  var map = await getNicknames(env);
  if (nickname) {
    var owner = map[nickname.toLowerCase()];
    if (owner && owner !== email) return 'That nickname is taken. Try another.';
  }
  if (profile.nickname && map[profile.nickname.toLowerCase()] === email) delete map[profile.nickname.toLowerCase()];
  if (nickname) map[nickname.toLowerCase()] = email;
  await env.VOTES.put(NICKNAMES_KEY, JSON.stringify(map));
  var oldNickname = profile.nickname || '';
  if (nickname) profile.nickname = nickname;
  else delete profile.nickname;
  await putProfileRecord(env, email, profile);
  await syncMemberName(env, email, oldNickname);
  return '';
}

// Which kinds of device the member has the app on (reported by the app),
// so the homepage in Safari stops offering to install it. One read.
async function handleProfileApps(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var profile = await getProfileRecord(env, email);
  return json({ success: true, apps: profile.apps && typeof profile.apps === 'object' ? profile.apps : {} });
}

// Profile's nickname box checks as you type: GET /profile/nickname?nick=
async function handleNicknameCheck(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var raw = String(new URL(request.url).searchParams.get('nick') || '').trim();
  var nick = cleanNickname(raw);
  if (!nick) return json({ success: true, available: false, message: '3 to 20 letters or numbers (you can use _ . -), starting with a letter or number.' });
  var owner = (await getNicknames(env))[nick.toLowerCase()];
  if (owner && owner !== email) return json({ success: true, available: false, message: nick + ' is taken. Try another.' });
  return json({ success: true, available: true, message: owner === email ? 'That\u2019s your nickname.' : nick + ' is available.' });
}

function friendsKey(email) {
  return 'friends:' + email;
}

async function getFriends(env, email) {
  var rec = await getJsonKey(env, friendsKey(email), {});
  return {
    friends: Array.isArray(rec.friends) ? rec.friends : [],
    incoming: Array.isArray(rec.incoming) ? rec.incoming : [],
    outgoing: Array.isArray(rec.outgoing) ? rec.outgoing : []
  };
}

async function putFriends(env, email, rec) {
  await env.VOTES.put(friendsKey(email), JSON.stringify(rec));
}

function withoutEmail(list, email) {
  return list.filter(function (item) { return (item.email || item) !== email; });
}

// Another member as others see them: id, nickname and public name.
async function memberCard(env, email, withBuilds) {
  var profile = await getProfileRecord(env, email);
  var card = { id: await ownerKey(email), nickname: profile.nickname || '', name: publicName(profile) || 'MT3UK member' };
  if (withBuilds) card.builds = await getSubscriberFiles(env, email);
  return card;
}

// Finds which of `emails` has this opaque id.
async function emailForId(emails, id) {
  for (var i = 0; i < emails.length; i++) {
    if ((await ownerKey(emails[i])) === id) return emails[i];
  }
  return null;
}

function dmIndexKey(email) {
  return 'dm-index:' + email;
}

async function getDmIndex(env, email) {
  var rec = await getJsonKey(env, dmIndexKey(email), {});
  return rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : {};
}

async function dmThreadKey(a, b) {
  var ids = [await ownerKey(a), await ownerKey(b)].sort();
  return 'dm:' + ids[0] + ':' + ids[1];
}

// Where a conversation's photos live in R2. Never under gallery/, so they
// stay out of the gallery, and only ever served through the worker.
async function dmPhotoPrefix(a, b) {
  var ids = [await ownerKey(a), await ownerKey(b)].sort();
  return 'dm/' + ids[0] + '-' + ids[1] + '/';
}

function dmPhotoExpired(msg) {
  return Date.now() - new Date(msg.at).getTime() > DM_PHOTO_DAYS * 86400000;
}

async function deleteDmPhotos(env, a, b) {
  if (!env.GALLERY_BUCKET) return;
  var prefix = await dmPhotoPrefix(a, b);
  var cursor;
  do {
    // R2 (not KV), and only when a member leaves.
    var page = await env.GALLERY_BUCKET.list({ prefix: prefix, cursor: cursor });
    var keys = page.objects.map(function (o) { return o.key; });
    if (keys.length) await env.GALLERY_BUCKET.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// Messages between friends: the comment rules, but links are welcome.
function moderateDmText(text) {
  var links = (text.match(/https?:\/\/|www\./gi) || []).length;
  if (links > MAX_DM_LINKS) return { ok: false, message: 'That\u2019s a lot of links for one message. Please send ' + MAX_DM_LINKS + ' or fewer.' };
  var check = moderateCommentText(text.replace(/https?:\/\/\S+|www\.\S+/gi, 'link'));
  if (!check.ok) return { ok: false, message: check.message.replace(/comments/i, 'messages').replace(/Comment/, 'Message') };
  return { ok: true };
}

async function getBroadcasts(env) {
  var list = await getJsonKey(env, BROADCASTS_KEY, []);
  return Array.isArray(list) ? list : [];
}

async function unreadCounts(env, email, profile) {
  var seen = (profile || await getProfileRecord(env, email)).broadcastsSeenAt || '';
  var broadcasts = (await getBroadcasts(env)).filter(function (b) { return b.at > seen; }).length;
  var index = await getDmIndex(env, email);
  var direct = Object.keys(index).reduce(function (n, k) { return n + (index[k].unread || 0); }, 0);
  var fr = await getFriends(env, email);
  return { broadcasts: broadcasts, direct: direct, requests: fr.incoming.length };
}

async function handleProfileGet(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var profile = await getProfileRecord(env, email);
  var files = await getSubscriberFiles(env, email);
  var fr = await getFriends(env, email);
  var friends = await Promise.all(fr.friends.map(function (e) { return memberCard(env, e, true); }));
  var incoming = await Promise.all(fr.incoming.map(function (r) { return memberCard(env, r.email, false); }));
  var outgoing = await Promise.all(fr.outgoing.map(function (r) { return memberCard(env, r.email, false); }));
  return json({
    success: true,
    email: email,
    id: await ownerKey(email),
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    nickname: profile.nickname || '',
    showName: profile.showName === 'name' ? 'name' : 'nickname',
    modQuestionsOff: !!profile.modQuestionsOff,
    hideRealName: !!profile.hideRealName,
    apps: profile.apps && typeof profile.apps === 'object' ? profile.apps : {},
    emailsOff: !!profile.emailsOff,
    member: (await env.VOTES.get('subscriber:' + email)) !== null,
    since: (await env.VOTES.get('subscriber-since:' + email)) || '',
    builds: files,
    friends: friends,
    incoming: incoming,
    outgoing: outgoing,
    unread: await unreadCounts(env, email, profile)
  });
}

async function handleProfileUpdate(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  body = body || {};
  var nameChanged = false;

  if ('nickname' in body) {
    // A nickname is required: friends find members by it.
    var nickname = cleanNickname(body.nickname);
    if (!nickname) return json({ success: false, message: 'Please choose a nickname: 3 to 20 letters or numbers (you can use _ . -), starting with a letter or number.' }, 400);
    var current = (await getProfileRecord(env, email)).nickname || '';
    if (nickname !== current) {
      var err = await setNickname(env, email, nickname);
      if (err) return json({ success: false, message: err }, 409);
      nameChanged = true;
    }
  }
  if ('firstName' in body || 'lastName' in body) {
    var firstName = cleanNamePart(body.firstName);
    var lastName = cleanNamePart(body.lastName);
    if (!firstName || !lastName) return json({ success: false, message: 'Please enter your first and last name' }, 400);
    await saveProfile(env, email, firstName, lastName);
    nameChanged = true;
  }
  if ('emailsOff' in body) {
    var profile = await getProfileRecord(env, email);
    profile.emailsOff = !!body.emailsOff;
    await putProfileRecord(env, email, profile);
  }
  // Visibility: show the nickname or the full name, and whether members can
  // find them by their real name.
  if ('showName' in body || 'hideRealName' in body || 'modQuestionsOff' in body) {
    var vis = await getProfileRecord(env, email);
    // Questions about their mods from members who aren't friends.
    if ('modQuestionsOff' in body) {
      if (body.modQuestionsOff) vis.modQuestionsOff = true;
      else delete vis.modQuestionsOff;
    }
    var before = publicName(vis);
    if ('showName' in body) {
      if (body.showName === 'name') vis.showName = 'name';
      else delete vis.showName;
    }
    if ('hideRealName' in body) {
      if (body.hideRealName) vis.hideRealName = true;
      else delete vis.hideRealName;
    }
    await putProfileRecord(env, email, vis);
    if (publicName(vis) !== before) nameChanged = true;
  }
  // The installed app reports itself once per device, so the website can
  // stop offering to install it on that kind of device (Safari can't see
  // apps on the phone).
  if (body.appInstalled === 'ios' || body.appInstalled === 'android' || body.appInstalled === 'desktop') {
    var withApp = await getProfileRecord(env, email);
    var apps = withApp.apps && typeof withApp.apps === 'object' ? withApp.apps : {};
    // Refreshed at most daily: Safari counts the app as installed only if
    // it has been opened in the last 30 days (deleting an app can't be seen).
    var last = Date.parse(apps[body.appInstalled] || '') || 0;
    if (Date.now() - last > 20 * 60 * 60 * 1000) {
      apps[body.appInstalled] = new Date().toISOString();
      withApp.apps = apps;
      await putProfileRecord(env, email, withApp);
    }
  }
  // The browser says the app isn't installed any more (or they deleted it).
  if (body.appRemoved === 'ios' || body.appRemoved === 'android' || body.appRemoved === 'desktop') {
    var noApp = await getProfileRecord(env, email);
    if (noApp.apps && noApp.apps[body.appRemoved]) {
      delete noApp.apps[body.appRemoved];
      await putProfileRecord(env, email, noApp);
    }
  }
  if (nameChanged) await refreshPublicNameEverywhere(env, email);
  await syncMemberName(env, email);
  var saved = await getProfileRecord(env, email);
  return json({ success: true, firstName: saved.firstName || '', lastName: saved.lastName || '', nickname: saved.nickname || '',
    showName: saved.showName === 'name' ? 'name' : 'nickname', hideRealName: !!saved.hideRealName, emailsOff: !!saved.emailsOff, modQuestionsOff: !!saved.modQuestionsOff });
}

// Leave MT3UK: deletes the member's builds and everything kept about them.
// Comments stay, under the name they were posted with.
async function deleteMemberAccount(env, email) {
  var files = await getSubscriberFiles(env, email);
  await deleteMemberTrackData(env, email);
  for (var i = 0; i < files.length; i++) await deleteMemberPhoto(env, email, files[i]);

  var fr = await getFriends(env, email);
  var others = fr.friends.concat(fr.incoming.map(function (r) { return r.email; }), fr.outgoing.map(function (r) { return r.email; }));
  for (var j = 0; j < others.length; j++) {
    var theirs = await getFriends(env, others[j]);
    await putFriends(env, others[j], {
      friends: withoutEmail(theirs.friends, email),
      incoming: withoutEmail(theirs.incoming, email),
      outgoing: withoutEmail(theirs.outgoing, email)
    });
  }
  var profile = await getProfileRecord(env, email);
  if (profile.nickname) {
    var map = await getNicknames(env);
    if (map[profile.nickname.toLowerCase()] === email) {
      delete map[profile.nickname.toLowerCase()];
      await env.VOTES.put(NICKNAMES_KEY, JSON.stringify(map));
    }
    var names = await getMemberNames(env);
    if (profile.nickname.toLowerCase() in names) {
      delete names[profile.nickname.toLowerCase()];
      await env.VOTES.put(MEMBER_NAMES_KEY, JSON.stringify(names));
    }
  }
  var index = await getDmIndex(env, email);
  for (var k in index) {
    var otherIndex = await getDmIndex(env, index[k].email);
    var mine = await ownerKey(email);
    if (otherIndex[mine]) {
      delete otherIndex[mine];
      await env.VOTES.put(dmIndexKey(index[k].email), JSON.stringify(otherIndex));
    }
    await env.VOTES.delete(await dmThreadKey(email, index[k].email));
    await deleteDmPhotos(env, email, index[k].email);
  }
  var passkeys = await getPasskeys(env, email);
  for (var pk = 0; pk < passkeys.length; pk++) await env.VOTES.delete(passkeyCredKey(passkeys[pk].id));
  // End every sign-in. Kept only as long as an old sign-in could last.
  await env.VOTES.put(sessionVersionKey(email), String((await getSessionVersion(env, email)) + 1), { expirationTtl: 181 * 24 * 60 * 60 });
  await Promise.all(['subscriber:', 'profile:', 'subscriber-since:', 'friends:', 'dm-index:', 'notifications:', 'push:', 'passkeys:'].map(function (prefix) {
    return env.VOTES.delete(prefix + email);
  }));
  if (files.length) await triggerManifestRebuild(env);
}

async function handleProfileLeave(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body || body.confirm !== 'LEAVE') return json({ success: false, message: 'Type LEAVE to confirm' }, 400);
  await deleteMemberAccount(env, email);
  return json({ success: true });
}

async function handleProfileSearch(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var q = String(new URL(request.url).searchParams.get('q') || '').trim().toLowerCase();
  if (q.length < 2) return json({ success: true, results: [] });
  var map = await getNicknames(env);
  // Fill in real names for members not in the search list yet (a few per
  // search, so the list catches up without a slow first search).
  var names = await getMemberNames(env);
  var missing = Object.keys(map).filter(function (n) { return !(n in names); }).slice(0, 50);
  if (missing.length) {
    await Promise.all(missing.map(async function (n) { names[n] = searchableName(await getProfileRecord(env, map[n])); }));
    await env.VOTES.put(MEMBER_NAMES_KEY, JSON.stringify(names));
  }
  // Nickname, or first, last or full name. Best match first: a nickname or
  // name that starts with what they typed.
  var rank = function (n) {
    var name = names[n] || '';
    if (n.indexOf(q) === 0) return 0;
    if (name && (name.indexOf(q) === 0 || name.indexOf(' ' + q) !== -1)) return 1;
    if (n.indexOf(q) !== -1) return 2;
    if (name && name.indexOf(q) !== -1) return 3;
    return -1;
  };
  var matches = Object.keys(map).filter(function (n) { return map[n] !== email && rank(n) !== -1; })
    .sort(function (a, b) { return (rank(a) - rank(b)) || a.localeCompare(b); })
    .slice(0, 10);
  var fr = await getFriends(env, email);
  var results = await Promise.all(matches.map(async function (n) {
    var other = map[n];
    var card = await memberCard(env, other, false);
    card.status = fr.friends.indexOf(other) !== -1 ? 'friend'
      : withoutEmail(fr.outgoing, other).length !== fr.outgoing.length ? 'requested'
      : withoutEmail(fr.incoming, other).length !== fr.incoming.length ? 'incoming' : '';
    return card;
  }));
  return json({ success: true, results: results });
}

// Friend requests: request (by nickname), accept, decline, cancel, remove.
async function handleProfileFriends(request, env, ctx) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var action = body && body.action;
  var mine = await getFriends(env, email);
  var other = null;

  if (action === 'request') {
    var myProfile = await getProfileRecord(env, email);
    if (!myProfile.nickname) return json({ success: false, message: 'Choose a nickname first, so friends can see who you are.' }, 400);
    var nick = cleanNickname(body.nickname);
    other = nick ? (await getNicknames(env))[nick.toLowerCase()] : null;
    if (!other || other === email) return json({ success: false, message: 'No member has that nickname.' }, 404);
    if (mine.friends.indexOf(other) !== -1) return json({ success: false, message: 'You are already friends.' }, 400);
    if (mine.friends.length >= MAX_FRIENDS) return json({ success: false, message: 'You have reached the friends limit.' }, 400);
    var theirs = await getFriends(env, other);
    // They already asked you: that makes you friends.
    if (withoutEmail(mine.incoming, other).length !== mine.incoming.length) {
      action = 'accept';
    } else {
      if (withoutEmail(mine.outgoing, other).length !== mine.outgoing.length) return json({ success: false, message: 'Request already sent.' }, 400);
      if (theirs.incoming.length >= MAX_FRIEND_REQUESTS || mine.outgoing.length >= MAX_FRIEND_REQUESTS) {
        return json({ success: false, message: 'Too many open friend requests. Try again later.' }, 400);
      }
      var at = new Date().toISOString();
      mine.outgoing.push({ email: other, at: at });
      theirs.incoming.push({ email: email, at: at });
      await putFriends(env, email, mine);
      await putFriends(env, other, theirs);
      var fromName = publicName(myProfile);
      await addNotification(env, other, { type: 'friend', link: 'profile.html#friends', fromName: fromName, text: 'sent you a friend request', createdAt: at });
      var pushed = await sendPushToMember(env, other, { title: 'New friend request', body: fromName + ' wants to be friends on MT3UK.', url: '/profile.html#friends' });
      if (!pushed) await sendMemberEmail(env, other, fromName + ' sent you a friend request on MT3UK', fromName + ' would like to be friends on MT3UK. Accept or decline in your Profile:\n\n' + PROFILE_URL + '#friends');
      return json({ success: true, status: 'requested' });
    }
  }

  var pool = action === 'accept' || action === 'decline' ? mine.incoming.map(function (r) { return r.email; })
    : action === 'cancel' ? mine.outgoing.map(function (r) { return r.email; })
    : action === 'remove' ? mine.friends : null;
  if (!pool) return json({ success: false, message: 'Unknown action' }, 400);
  if (!other) other = await emailForId(pool, String(body.id || ''));
  if (!other) return json({ success: false, message: 'That member is no longer in your list.' }, 404);
  var theirRec = await getFriends(env, other);
  mine.incoming = withoutEmail(mine.incoming, other);
  mine.outgoing = withoutEmail(mine.outgoing, other);
  theirRec.incoming = withoutEmail(theirRec.incoming, email);
  theirRec.outgoing = withoutEmail(theirRec.outgoing, email);
  if (action === 'accept') {
    if (mine.friends.indexOf(other) === -1) mine.friends.push(other);
    if (theirRec.friends.indexOf(email) === -1) theirRec.friends.push(email);
  }
  if (action === 'remove') {
    mine.friends = withoutEmail(mine.friends, other);
    theirRec.friends = withoutEmail(theirRec.friends, email);
  }
  await putFriends(env, email, mine);
  await putFriends(env, other, theirRec);
  if (action === 'accept') {
    var name = await publicNameFor(env, email);
    await addNotification(env, other, { type: 'friend', link: 'profile.html#friends', fromName: name, text: 'accepted your friend request', createdAt: new Date().toISOString() });
    await sendPushToMember(env, other, { title: 'Friend request accepted', body: name + ' is now your friend on MT3UK.', url: '/profile.html#friends' });
  }
  return json({ success: true });
}

// Friends hear when a friend adds a new build.
async function notifyFriendsOfBuild(env, email, file, caption) {
  var fr = await getFriends(env, email);
  if (!fr.friends.length) return;
  var name = await publicNameFor(env, email);
  var title = String(caption || '').toLowerCase().replace(/(^|\s)([a-z])/g, function (m, sp, c) { return sp + c.toUpperCase(); });
  await Promise.all(fr.friends.map(async function (friend) {
    await addNotification(env, friend, { type: 'friend-build', link: 'index.html?photo=' + encodeURIComponent(file) + '#build-feed', file: file, fromName: name, text: 'added a new build' + (title ? ': ' + title : ''), createdAt: new Date().toISOString() });
    await sendPushToMember(env, friend, { title: name + ' added a new build', body: title || 'Take a look on MT3UK.', url: '/?photo=' + encodeURIComponent(file) + '#build-feed' });
  }));
}

// Messages: from MT3UK (to every member) and between friends.
async function handleProfileMessages(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var profile = await getProfileRecord(env, email);
  var seen = profile.broadcastsSeenAt || '';
  var since = (await env.VOTES.get('subscriber-since:' + email)) || '';
  var broadcasts = (await getBroadcasts(env)).map(function (b) { return { id: b.id, title: b.title, text: b.text, at: b.at, unread: b.at > seen }; });
  var index = await getDmIndex(env, email);
  var fr = await getFriends(env, email);
  var threads = await Promise.all(Object.keys(index).map(async function (id) {
    var t = index[id];
    var card = await memberCard(env, t.email, false);
    card.lastText = t.lastText || '';
    card.lastAt = t.lastAt || '';
    card.lastFromMe = !!t.lastFromMe;
    card.unread = t.unread || 0;
    card.friend = fr.friends.indexOf(t.email) !== -1;
    return card;
  }));
  threads.sort(function (a, b) { return a.lastAt < b.lastAt ? 1 : -1; });
  return json({ success: true, broadcasts: broadcasts, threads: threads, since: since, dmBlocked: !!profile.dmBlocked });
}

async function handleProfileMessagesRead(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var profile = await getProfileRecord(env, email);
  profile.broadcastsSeenAt = new Date().toISOString();
  await putProfileRecord(env, email, profile);
  return json({ success: true });
}

async function handleProfileThread(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var id = String(new URL(request.url).searchParams.get('with') || '');
  var index = await getDmIndex(env, email);
  var fr = await getFriends(env, email);
  var other = index[id] ? index[id].email : await emailForId(fr.friends, id);
  if (!other) return json({ success: false, message: 'Conversation not found' }, 404);
  var myId = await ownerKey(email);
  var messages = await getJsonKey(env, await dmThreadKey(email, other), []);
  if (index[id] && index[id].unread) {
    index[id].unread = 0;
    await env.VOTES.put(dmIndexKey(email), JSON.stringify(index));
  }
  return json({
    success: true,
    with: await memberCard(env, other, false),
    friend: fr.friends.indexOf(other) !== -1,
    // Friends, or someone who asked about one of your mods (or you theirs).
    canReply: fr.friends.indexOf(other) !== -1 || !!index[id],
    messages: dmMessagesForPage(Array.isArray(messages) ? messages : [], myId)
  });
}

// Messages as the page sees them: no R2 keys or sender emails, plus each
// person's reaction and a short quote of the message it replies to.
function dmMessagesForPage(messages, myId) {
  var byId = {};
  messages.forEach(function (m) { byId[m.id] = m; });
  return messages.filter(function (m) { return !m.removed; }).map(function (m) {
    var out = { id: m.id, text: m.text, at: m.at, mine: m.from === myId };
    if (m.about) out.about = { mod: m.about.mod, file: m.about.file };
    if (m.photo) {
      if (dmPhotoExpired(m)) out.photoGone = true;
      else out.photo = true;
    }
    var reactions = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
    Object.keys(reactions).forEach(function (id) {
      if (id === myId) out.myReaction = reactions[id];
      else out.theirReaction = reactions[id];
    });
    if (m.replyTo) {
      var q = byId[m.replyTo];
      out.replyTo = q && !q.removed
        ? { id: q.id, mine: q.from === myId, text: String(q.text || '').slice(0, 120), photo: !!q.photo }
        : { id: m.replyTo, gone: true };
    }
    return out;
  });
}

// Reactions to a message: one each, from this set. Sending your current
// one again (or none) takes it off.
var DM_REACTIONS = ['\u2764\ufe0f', '\ud83d\ude06', '\ud83d\ude2e', '\ud83d\ude22', '\ud83d\ude21', '\ud83d\udc4d'];

async function handleProfileMessageReact(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var id = String((body && body.with) || '');
  var index = await getDmIndex(env, email);
  var fr = await getFriends(env, email);
  var other = index[id] ? index[id].email : await emailForId(fr.friends, id);
  if (!other) return json({ success: false, message: 'Conversation not found' }, 404);
  var myId = await ownerKey(email);
  var threadKey = await dmThreadKey(email, other);
  var messages = await getJsonKey(env, threadKey, []);
  if (!Array.isArray(messages)) messages = [];
  var msg = messages.filter(function (m) { return m.id === (body && body.messageId) && !m.removed; })[0];
  if (!msg) return json({ success: false, message: 'Message not found' }, 404);
  var emoji = String((body && body.emoji) || '');
  if (emoji && DM_REACTIONS.indexOf(emoji) === -1) return json({ success: false, message: 'Unknown reaction' }, 400);
  var reactions = msg.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
  if (!emoji || reactions[myId] === emoji) delete reactions[myId];
  else reactions[myId] = emoji;
  if (Object.keys(reactions).length) msg.reactions = reactions;
  else delete msg.reactions;
  await env.VOTES.put(threadKey, JSON.stringify(messages));
  return json({ success: true, reaction: reactions[myId] || null, message: dmMessagesForPage(messages, myId).filter(function (m) { return m.id === msg.id; })[0] });
}

// A photo from a conversation, only for the two people in it.
async function handleProfileMessagePhoto(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var params = new URL(request.url).searchParams;
  var id = String(params.get('with') || '');
  var index = await getDmIndex(env, email);
  var fr = await getFriends(env, email);
  var other = index[id] ? index[id].email : await emailForId(fr.friends, id);
  if (!other) return json({ success: false, message: 'Conversation not found' }, 404);
  var messages = await getJsonKey(env, await dmThreadKey(email, other), []);
  var msg = (Array.isArray(messages) ? messages : []).filter(function (m) { return m.id === params.get('m'); })[0];
  if (!msg || !msg.photo || msg.removed) return json({ success: false, message: 'Photo not found' }, 404);
  if (dmPhotoExpired(msg)) return json({ success: false, message: 'Photo no longer available' }, 410);
  return servePrivatePhoto(env, msg.photo);
}

async function servePrivatePhoto(env, key) {
  var obj = await env.GALLERY_BUCKET.get(key);
  if (!obj) return json({ success: false, message: 'Photo no longer available' }, 410);
  return new Response(obj.body, {
    headers: {
      'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Voter-Id, X-Session-Token'
    }
  });
}

async function handleProfileMessageSend(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  // JSON for text, or form data when a photo is attached.
  var body;
  var photo = null;
  if ((request.headers.get('Content-Type') || '').indexOf('multipart/form-data') === 0) {
    var form;
    try { form = await request.formData(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
    body = { with: form.get('with'), text: form.get('text'), replyTo: form.get('replyTo') };
    photo = form.get('photo');
    if (photo && typeof photo !== 'string') {
      if (!photo.type || !/^image\/(jpeg|png|webp|gif)$/.test(photo.type)) return json({ success: false, message: 'Photos need to be JPEG, PNG, WebP or GIF.' }, 400);
      if (photo.size > MAX_DM_PHOTO_BYTES) return json({ success: false, message: 'That photo is too big. Please choose a smaller one.' }, 400);
    } else {
      photo = null;
    }
  } else {
    try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  }
  var profile = await getProfileRecord(env, email);
  if (profile.dmBlocked) return json({ success: false, message: 'Messaging is turned off for your account. Please get in touch through the Contact page.' }, 403);
  var fr = await getFriends(env, email);
  var other = null;
  // A question about a mod on someone's build (the Gallery's Full mods
  // list): any member can ask the photo's owner, unless they've turned mod
  // questions off.
  var about = null;
  if (body && body.about && typeof body.about === 'object' && !body.with) {
    var aboutFile = String(body.about.file || '').slice(0, 200);
    var aboutMod = cleanModText(String(body.about.mod || ''), 150);
    if (!aboutFile || aboutFile.indexOf('/') !== -1 || !aboutMod) return json({ success: false, message: 'Choose a mod to ask about.' }, 400);
    var aboutSidecar = null;
    try {
      var aboutObj = await env.GALLERY_BUCKET.get('gallery/' + aboutFile + '.json');
      if (aboutObj) aboutSidecar = await aboutObj.json();
    } catch (e) {}
    other = aboutSidecar ? await sidecarOwnerEmail(env, aboutFile, aboutSidecar) : null;
    if (!other) return json({ success: false, message: 'This build has no owner to ask yet.' }, 404);
    if (other === email) return json({ success: false, message: 'That\u2019s your own build.' }, 400);
    var ownerRecord = await getProfileRecord(env, other);
    if (ownerRecord.modQuestionsOff || ownerRecord.dmBlocked) return json({ success: false, message: 'This member isn\u2019t taking questions about their mods.' }, 403);
    about = { mod: aboutMod, file: aboutFile };
  } else {
    // Friends, or anyone you already have a conversation with (such as a
    // member who asked about one of your mods).
    var wantId = String((body && body.with) || '');
    var myIndex = await getDmIndex(env, email);
    other = myIndex[wantId] ? myIndex[wantId].email : await emailForId(fr.friends, wantId);
  }
  if (!other) return json({ success: false, message: 'You can only message your friends.' }, 403);
  var text = String((body && body.text) || '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_DM_LENGTH);
  if (!text && !photo) return json({ success: false, message: 'Write a message first.' }, 400);
  if (text) {
    var check = moderateDmText(text);
    if (!check.ok) return json({ success: false, message: check.message }, 400);
  }

  var rateKey = 'dm-rate:' + email;
  var sent = parseInt(await env.VOTES.get(rateKey), 10) || 0;
  if (sent >= DM_SEND_LIMIT_PER_HOUR) return json({ success: false, message: 'You have sent a lot of messages. Please try again in an hour.' }, 429);
  await env.VOTES.put(rateKey, String(sent + 1), { expirationTtl: 3600 });

  var myId = await ownerKey(email);
  var otherId = await ownerKey(other);
  var threadKey = await dmThreadKey(email, other);
  var messages = await getJsonKey(env, threadKey, []);
  if (!Array.isArray(messages)) messages = [];
  var msg = { id: crypto.randomUUID(), from: myId, text: text, at: new Date().toISOString() };
  if (about) msg.about = about;
  // A reply quotes a message in the same conversation.
  var replyTo = String((body && body.replyTo) || '');
  if (replyTo && messages.some(function (m) { return m.id === replyTo && !m.removed; })) msg.replyTo = replyTo;
  if (photo) {
    var ext = { 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[photo.type] || '.jpg';
    msg.photo = (await dmPhotoPrefix(email, other)) + msg.id + ext;
    await env.GALLERY_BUCKET.put(msg.photo, await photo.arrayBuffer(), { httpMetadata: { contentType: photo.type } });
  }
  messages.push(msg);
  // Photos of messages that drop off the end of a long conversation go too.
  var kept = messages.slice(-MAX_DM_PER_THREAD);
  var dropped = messages.slice(0, messages.length - kept.length).filter(function (m) { return m.photo; });
  if (dropped.length) await env.GALLERY_BUCKET.delete(dropped.map(function (m) { return m.photo; }));
  await env.VOTES.put(threadKey, JSON.stringify(kept));
  var preview = text ? text.slice(0, 120) : 'Photo';

  var mine = await getDmIndex(env, email);
  mine[otherId] = { email: other, lastText: preview, lastAt: msg.at, lastFromMe: true, unread: 0 };
  await env.VOTES.put(dmIndexKey(email), JSON.stringify(mine));
  var theirs = await getDmIndex(env, other);
  var was = theirs[myId] || {};
  theirs[myId] = { email: email, lastText: preview, lastAt: msg.at, lastFromMe: false, unread: (was.unread || 0) + 1 };
  await env.VOTES.put(dmIndexKey(other), JSON.stringify(theirs));

  // One alert per quiet spell, not one per message.
  if (!was.unread) {
    var name = publicName(profile) || (about ? 'A member' : 'A friend');
    var title = about ? name + ' asked about your ' + about.mod : 'Message from ' + name;
    var pushed = await sendPushToMember(env, other, { title: title.slice(0, 120), body: text ? text.slice(0, 140) : 'Sent you a photo', url: '/profile.html?with=' + myId + '#messages' });
    if (!pushed) {
      var said = text ? ':\n\n"' + text.slice(0, 500) + '"' + (photo ? '\n\n(and a photo)' : '') : ' a photo.';
      if (about) {
        await sendMemberEmail(env, other, name + ' asked about your ' + about.mod.slice(0, 80) + ' on MT3UK', name + ' asked about your ' + about.mod + ':\n\n"' + text.slice(0, 500) + '"\n\nRead and reply in your Profile:\n\n' + PROFILE_URL + '#messages');
      } else await sendMemberEmail(env, other, name + ' sent you a ' + (text ? 'message' : 'photo') + ' on MT3UK', name + ' sent you' + (text ? ' a message on MT3UK' : '') + said + '\n\nRead and reply in your Profile:\n\n' + PROFILE_URL + '#messages');
    }
  }
  var sentMsg = dmMessagesForPage(kept, myId).filter(function (m) { return m.id === msg.id; })[0];
  return json({ success: true, message: sentMsg });
}

async function handleProfileMessageReport(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var index = await getDmIndex(env, email);
  var id = String((body && body.with) || '');
  var other = index[id] && index[id].email;
  if (!other) return json({ success: false, message: 'Conversation not found' }, 404);
  var messages = await getJsonKey(env, await dmThreadKey(email, other), []);
  var msg = (Array.isArray(messages) ? messages : []).filter(function (m) { return m.id === body.messageId && m.from === id; })[0];
  if (!msg) return json({ success: false, message: 'You can report messages sent to you.' }, 404);
  var reports = await getJsonKey(env, DM_REPORTS_KEY, []);
  if (!Array.isArray(reports)) reports = [];
  if (!reports.some(function (r) { return r.messageId === msg.id; })) {
    reports.unshift({
      id: crypto.randomUUID(), messageId: msg.id, text: msg.text, at: msg.at, photo: !!msg.photo,
      fromEmail: other, fromName: await publicNameFor(env, other),
      toEmail: email, toName: await publicNameFor(env, email),
      reason: String((body && body.reason) || '').trim().slice(0, 300),
      reportedAt: new Date().toISOString()
    });
    await env.VOTES.put(DM_REPORTS_KEY, JSON.stringify(reports.slice(0, 200)));
  }
  return json({ success: true });
}

// ---------- Admin: messages to subscribers and reported messages ----------

// Who each message has been emailed to: one key per message (a list of
// emails), so repeat sends skip them and the admin page can show them.
function broadcastEmailedKey(id) {
  return 'broadcast-emailed:' + id;
}

async function getBroadcastEmailed(env, id) {
  var list = await getJsonKey(env, broadcastEmailedKey(id), []);
  return Array.isArray(list) ? list : [];
}

async function handleAdminBroadcastsGet(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var reports = await getJsonKey(env, DM_REPORTS_KEY, []);
  var broadcasts = await getBroadcasts(env);
  var withCounts = await Promise.all(broadcasts.map(async function (b) {
    return Object.assign({}, b, { emailed: await getBroadcastEmailed(env, b.id) });
  }));
  return json({ success: true, broadcasts: withCounts, reports: Array.isArray(reports) ? reports : [] });
}

// Just the message: no extra link (see EMAIL_FOOTER).
function broadcastEmailText(msg) {
  return msg.text;
}

// Emails one message to one member (1c), unless they've had it already
// (force sends it again).
async function handleAdminBroadcastEmailOne(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var msg = (await getBroadcasts(env)).filter(function (b) { return b.id === (body && body.id); })[0];
  if (!msg) return json({ success: false, message: 'Message not found' }, 404);
  var email = previewEmail(body && body.email);
  if (!email) return json({ success: false, message: 'Enter a valid email' }, 400);
  if ((await env.VOTES.get('subscriber:' + email)) === null) return json({ success: false, message: 'No member with that email' }, 404);
  var emailed = await getBroadcastEmailed(env, msg.id);
  if (emailed.indexOf(email) !== -1 && !body.force) {
    return json({ success: false, already: true, message: email + ' has already been emailed this message. Send again?' }, 409);
  }
  if (!(await wantsEmails(env, email))) return json({ success: false, message: email + ' has turned emails off, so it is only in their Profile inbox.' }, 400);
  var ok = await sendMemberEmail(env, email, msg.title, broadcastEmailText(msg));
  if (!ok) return json({ success: false, message: 'The email could not be sent, please try again.' }, 500);
  if (emailed.indexOf(email) === -1) emailed.push(email);
  await env.VOTES.put(broadcastEmailedKey(msg.id), JSON.stringify(emailed));
  return json({ success: true, emailed: emailed });
}

// Admin: send the message being written to one address as a test, exactly
// as members would get it (footer and one-click unsubscribe included).
// Not saved, not put in inboxes and not recorded as emailed; sent even to
// non-members and whatever their email setting.
async function handleAdminBroadcastTest(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var title = String((body && body.title) || '').trim().slice(0, 120);
  var text = String((body && body.text) || '').trim().slice(0, 4000);
  if (!title || !text) return json({ success: false, message: 'Write a title and message first' }, 400);
  var email = previewEmail(body && body.email);
  if (!email) return json({ success: false, message: 'Enter a valid email' }, 400);
  // Send as (to find what a mail filter objects to):
  //   full        - as members get it (memberEmailHeaders)
  //   withheader  - with the one-click unsubscribe headers
  //   plain       - just the title and message, like a sign-in email
  var variant = body && (body.variant === 'withheader' || body.variant === 'plain') ? body.variant : 'full';
  var emailText = variant === 'plain' ? text : broadcastEmailText({ title: title, text: text }) + EMAIL_FOOTER;
  var headers = variant === 'withheader' ? await listUnsubscribeHeaders(env, email)
    : variant === 'full' ? await memberEmailHeaders(env, email) : [];
  try {
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, email, rawEmail(MY_BUILDS_FROM_EMAIL, email,
      '[Test] ' + title, emailText, headers)));
  } catch (err) {
    console.log('Test email failed:', err.message);
    return json({ success: false, message: 'The email could not be sent: ' + err.message }, 500);
  }
  return json({ success: true, email: email, variant: variant });
}

async function handleAdminBroadcastSave(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var list = await getBroadcasts(env);
  if (body && body.action === 'delete') {
    list = list.filter(function (b) { return b.id !== body.id; });
    await env.VOTES.delete(broadcastEmailedKey(body.id));
  } else {
    var title = String((body && body.title) || '').trim().slice(0, 120);
    var text = String((body && body.text) || '').replace(/\r\n?/g, '\n').trim().slice(0, 5000);
    if (!title || !text) return json({ success: false, message: 'Add a title and a message.' }, 400);
    list.unshift({ id: crypto.randomUUID(), title: title, text: text, at: new Date().toISOString() });
    list = list.slice(0, MAX_BROADCASTS);
  }
  await env.VOTES.put(BROADCASTS_KEY, JSON.stringify(list));
  return json({ success: true, broadcasts: list });
}

// Emails a message to members, a batch per call so it stays within the
// worker's limits; the admin page calls again with `cursor` until done.
// Admin only and rarely used, so list() is fine here.
async function handleAdminBroadcastEmail(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var msg = (await getBroadcasts(env)).filter(function (b) { return b.id === (body && body.id); })[0];
  if (!msg) return json({ success: false, message: 'Message not found' }, 404);
  var page = await env.VOTES.list({ prefix: 'subscriber:', cursor: (body && body.cursor) || undefined, limit: BROADCAST_EMAIL_BATCH });
  var emailed = await getBroadcastEmailed(env, msg.id);
  var sent = 0;
  var skipped = 0;
  var already = 0;
  for (var i = 0; i < page.keys.length; i++) {
    var to = page.keys[i].name.slice('subscriber:'.length);
    // Anyone who has had this message already is skipped.
    if (emailed.indexOf(to) !== -1) { already++; continue; }
    var ok = await sendMemberEmail(env, to, msg.title, broadcastEmailText(msg));
    if (ok) { sent++; emailed.push(to); } else skipped++;
  }
  if (sent) await env.VOTES.put(broadcastEmailedKey(msg.id), JSON.stringify(emailed));
  return json({ success: true, sent: sent, skipped: skipped, already: already, emailedTotal: emailed.length, cursor: page.list_complete ? null : page.cursor });
}

// The photo in a reported message, for the admin page.
async function handleAdminDmPhoto(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var reports = await getJsonKey(env, DM_REPORTS_KEY, []);
  var report = (Array.isArray(reports) ? reports : []).filter(function (r) { return r.id === new URL(request.url).searchParams.get('id'); })[0];
  if (!report) return json({ success: false, message: 'Report not found' }, 404);
  var messages = await getJsonKey(env, await dmThreadKey(report.fromEmail, report.toEmail), []);
  var msg = (Array.isArray(messages) ? messages : []).filter(function (m) { return m.id === report.messageId; })[0];
  if (!msg || !msg.photo) return json({ success: false, message: 'Photo no longer available' }, 410);
  return servePrivatePhoto(env, msg.photo);
}

async function handleAdminDmReports(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var reports = await getJsonKey(env, DM_REPORTS_KEY, []);
  if (!Array.isArray(reports)) reports = [];
  var report = reports.filter(function (r) { return r.id === (body && body.id); })[0];
  if (!report) return json({ success: false, message: 'Report not found' }, 404);
  var action = body.action;
  if (action === 'remove' || action === 'block') {
    var threadKey = await dmThreadKey(report.fromEmail, report.toEmail);
    var messages = await getJsonKey(env, threadKey, []);
    if (Array.isArray(messages)) {
      var removedPhotos = [];
      messages.forEach(function (m) {
        if (m.id !== report.messageId) return;
        m.removed = true;
        m.text = '';
        if (m.photo) { removedPhotos.push(m.photo); delete m.photo; }
      });
      await env.VOTES.put(threadKey, JSON.stringify(messages));
      if (removedPhotos.length) await env.GALLERY_BUCKET.delete(removedPhotos);
    }
  }
  if (action === 'block') {
    var sender = await getProfileRecord(env, report.fromEmail);
    sender.dmBlocked = true;
    await putProfileRecord(env, report.fromEmail, sender);
  }
  if (action === 'unblock') {
    var unblocked = await getProfileRecord(env, report.fromEmail);
    delete unblocked.dmBlocked;
    await putProfileRecord(env, report.fromEmail, unblocked);
    return json({ success: true, reports: reports });
  }
  if (['dismiss', 'remove', 'block'].indexOf(action) === -1) return json({ success: false, message: 'Unknown action' }, 400);
  reports = reports.filter(function (r) { return r.id !== report.id; });
  await env.VOTES.put(DM_REPORTS_KEY, JSON.stringify(reports));
  return json({ success: true, reports: reports });
}

// ---------- Interview previews ----------
// Until an interview's publish date, its page asks for a one-time code
// (js/interview-gate.js). Anyone can have a code emailed, like Sign In. A
// correct code opens that interview in that browser for 4 hours, signs them
// in, and makes them an MT3UK member if they weren't already (the code email
// says so). Each opening is logged for the admin page, which can revoke an
// email's access to an interview ("*" for all of them): that ends any open
// preview and stops new codes. The log and the revoked list are one JSON key
// each, read with get() only.

var PREVIEW_LOG_KEY = 'interview-preview-log';
var PREVIEW_REVOKED_KEY = 'interview-preview-revoked';
var PREVIEW_LOG_MAX = 500;
var PREVIEW_CODE_TTL_SECONDS = 15 * 60;
var PREVIEW_ACCESS_TTL_SECONDS = 4 * 60 * 60;
var PREVIEW_REQUESTS_PER_IP_PER_HOUR = 10;

function previewSlug(value, allowAll) {
  var slug = String(value || '').trim().toLowerCase();
  if (allowAll && slug === '*') return slug;
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(slug) ? slug : '';
}

function previewEmail(value) {
  var email = String(value || '').trim().toLowerCase().slice(0, 200);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

async function getPreviewList(env, key) {
  var raw = await env.VOTES.get(key);
  var list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch (e) { list = []; }
  return Array.isArray(list) ? list : [];
}

async function previewRevoked(env, email, slug) {
  var revoked = await getPreviewList(env, PREVIEW_REVOKED_KEY);
  return revoked.some(function (entry) { return entry.email === email && (entry.slug === '*' || entry.slug === slug); });
}

// One row per email and interview: when first and last opened, how often.
async function logPreviewOpen(env, email, slug, joined) {
  var log = await getPreviewList(env, PREVIEW_LOG_KEY);
  var now = new Date().toISOString();
  var row = null;
  log.forEach(function (entry) { if (entry.email === email && entry.slug === slug) row = entry; });
  if (row) {
    row.lastOpened = now;
    row.opens = (row.opens || 1) + 1;
  } else {
    log.push({ email: email, slug: slug, firstOpened: now, lastOpened: now, opens: 1, joined: !!joined });
  }
  log.sort(function (a, b) { return a.lastOpened < b.lastOpened ? 1 : -1; });
  await env.VOTES.put(PREVIEW_LOG_KEY, JSON.stringify(log.slice(0, PREVIEW_LOG_MAX)));
}

function previewCodeKey(email, slug) {
  return 'interview-preview-code:' + slug + ':' + email;
}

async function handleInterviewPreviewRequest(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  // Admin override: the link and code go to the MT3UK admin inbox only,
  // so anyone can press it without it reaching anyone else.
  var forAdmin = !!(body && body.admin === true);
  var email = forAdmin ? SUBSCRIBERS_DIGEST_EMAIL : previewEmail(body && body.email);
  var slug = previewSlug(body && body.slug, false);
  if (!email) return json({ success: false, message: 'Please enter a valid email' }, 400);
  if (!slug) return json({ success: false, message: 'Invalid interview' }, 400);
  var reply = json({ success: true, admin: forAdmin, message: forAdmin
    ? "We've emailed a one-time link and code to the MT3UK admin inbox. They last 15 minutes."
    : "We've sent a 6-digit code to " + email + ". It lasts 15 minutes. Check your junk folder if it hasn't arrived." });

  var ipKey = 'interview-preview-ip:' + getClientIp(request);
  var ipCount = parseInt(await env.VOTES.get(ipKey), 10) || 0;
  if (ipCount >= PREVIEW_REQUESTS_PER_IP_PER_HOUR) {
    return json({ success: false, message: 'Too many attempts, please try again in an hour.' }, 429);
  }
  await env.VOTES.put(ipKey, String(ipCount + 1), { expirationTtl: 3600 });

  if (await previewRevoked(env, email, slug)) {
    return json({ success: false, message: "This email can't preview this interview. It will be here on its publish date." }, 403);
  }
  var cooldownKey = 'interview-preview-cooldown:' + slug + ':' + email;
  if ((await env.VOTES.get(cooldownKey)) !== null) return reply;
  await env.VOTES.put(cooldownKey, '1', { expirationTtl: 60 });

  var code = signInCode();
  var expires = Math.floor(Date.now() / 1000) + PREVIEW_CODE_TTL_SECONDS;
  // The email's link carries a one-time token instead of the code, so
  // tapping it opens the interview straight away.
  var linkToken = randomToken();
  await env.VOTES.put(previewCodeKey(email, slug), JSON.stringify({ code: code, tries: 0, link: linkToken }), { expiration: expires, metadata: { expires: expires } });
  await env.VOTES.put('interview-preview-link:' + linkToken, JSON.stringify({ email: email, slug: slug }), { expiration: expires });
  try {
    var isMember = (await env.VOTES.get('subscriber:' + email)) !== null;
    var subject = 'MT3UK interview preview: your code is ' + code;
    var text = 'Here is your code to preview the MT3UK Owner Interview before it is published:\n\n' + code +
      '\n\nOr tap this link to open the interview straight away:\n\n' + MY_BUILDS_SITE_URL + '/blog-' + slug + '.html?preview=' + linkToken +
      '\n\nThe code and link expire in 15 minutes and work once. The interview then stays open in that browser for 4 hours.' +
      (isMember ? '' :
        '\n\nUsing this code also subscribes you to MT3UK (it\'s free) with this email address. You\'ll be signed in, so you can like and comment on member builds and Owner Interviews, and add your own car in My Garage whenever you like. You can stop emails or unsubscribe any time from your Profile: ' + PROFILE_URL + '#unsubscribe') +
      '\n\nPlease don\'t share the interview until it is published. If you did not ask for this code, you can ignore this email.';
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, email, rawEmail(MY_BUILDS_FROM_EMAIL, email, subject, text)));
  } catch (err) {
    console.log('Interview preview email failed:', err.message);
  }
  return reply;
}

async function handleInterviewPreviewVerify(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var email = previewEmail(body && body.email);
  var slug = previewSlug(body && body.slug, false);
  var code = String((body && body.code) || '').replace(/\D/g, '');
  var failed = json({ success: false, message: 'That code is not right or has expired. Check the latest email, or send a new code.' }, 400);
  if (!email || !slug || code.length !== 6) return failed;

  var key = previewCodeKey(email, slug);
  var meta = await env.VOTES.getWithMetadata(key);
  var record = null;
  try { record = meta.value ? JSON.parse(meta.value) : null; } catch (e) { record = null; }
  if (!record) return failed;
  if (record.code !== code) {
    record.tries = (record.tries || 0) + 1;
    var expires = (meta.metadata && meta.metadata.expires) || 0;
    if (record.tries >= MAX_SIGN_IN_CODE_TRIES || expires < Math.floor(Date.now() / 1000) + 60) {
      await env.VOTES.delete(key);
    } else {
      await env.VOTES.put(key, JSON.stringify(record), { expiration: expires, metadata: { expires: expires } });
    }
    return failed;
  }
  await env.VOTES.delete(key);
  if (record.link) await env.VOTES.delete('interview-preview-link:' + record.link);
  return grantPreview(env, email, slug, failed);
}

// The link in the code email: a one-time token for that email and interview.
async function handleInterviewPreviewLink(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var slug = previewSlug(body && body.slug, false);
  var linkToken = String((body && body.token) || '');
  var failed = json({ success: false, message: 'That link has expired or has already been used. Enter your email for a new code.' }, 400);
  if (!slug || !/^[A-Za-z0-9_-]{16,128}$/.test(linkToken)) return failed;
  var raw = await env.VOTES.get('interview-preview-link:' + linkToken);
  var link = null;
  try { link = raw ? JSON.parse(raw) : null; } catch (e) { link = null; }
  if (!link || link.slug !== slug) return failed;
  // One use: the link and its matching code are both used up.
  await env.VOTES.delete('interview-preview-link:' + linkToken);
  await env.VOTES.delete(previewCodeKey(link.email, slug));
  return grantPreview(env, link.email, slug, failed);
}

// Opens the interview for 4 hours, joins and signs in the email.
async function grantPreview(env, email, slug, failed) {
  // Revoked since the code was sent: no access.
  if (await previewRevoked(env, email, slug)) return failed;

  var token = randomToken();
  var accessExpires = Date.now() + PREVIEW_ACCESS_TTL_SECONDS * 1000;
  await env.VOTES.put('interview-preview-access:' + token, JSON.stringify({ email: email, slug: slug, expires: accessExpires }), { expirationTtl: PREVIEW_ACCESS_TTL_SECONDS });
  // The code proves the email is theirs, so they join (if new) and are signed in.
  var joined = false;
  if ((await env.VOTES.get('subscriber:' + email)) === null) {
    await env.VOTES.put('subscriber:' + email, JSON.stringify([]));
    await markSubscriberSince(env, email);
    joined = true;
  }
  await logPreviewOpen(env, email, slug, joined);
  var session = await createSession(env, email);
  return json({ success: true, token: token, expires: accessExpires, joined: joined, session: session, email: email });
}

async function handleInterviewPreviewCheck(request, env) {
  var params = new URL(request.url).searchParams;
  var token = String(params.get('token') || '');
  var slug = previewSlug(params.get('slug'), false);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || !slug) return json({ success: false }, 401);
  var raw = await env.VOTES.get('interview-preview-access:' + token);
  var record = null;
  try { record = raw ? JSON.parse(raw) : null; } catch (e) { record = null; }
  if (!record || record.slug !== slug || !(record.expires > Date.now())) return json({ success: false }, 401);
  if (await previewRevoked(env, record.email, slug)) {
    await env.VOTES.delete('interview-preview-access:' + token);
    return json({ success: false }, 401);
  }
  return json({ success: true, expires: record.expires });
}

async function handleInterviewPreviewAdminList(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  return json({ success: true, opened: await getPreviewList(env, PREVIEW_LOG_KEY), revoked: await getPreviewList(env, PREVIEW_REVOKED_KEY) });
}

// Revokes an email's access to an interview ("*" for all), or restores it.
async function handleInterviewPreviewAdminSave(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var email = previewEmail(body && body.email);
  var slug = previewSlug(body && body.slug, true);
  if (!email) return json({ success: false, message: 'Please enter a valid email' }, 400);
  if (!slug) return json({ success: false, message: 'Choose an interview' }, 400);
  var revoked = await getPreviewList(env, PREVIEW_REVOKED_KEY);
  var rest = revoked.filter(function (entry) { return !(entry.email === email && entry.slug === slug); });
  if (body.action === 'revoke') {
    if (rest.length >= 500) return json({ success: false, message: 'The list is full' }, 400);
    rest.push({ email: email, slug: slug, revoked: new Date().toISOString() });
  } else if (body.action !== 'restore') {
    return json({ success: false, message: 'Unknown action' }, 400);
  }
  await env.VOTES.put(PREVIEW_REVOKED_KEY, JSON.stringify(rest));
  return json({ success: true, opened: await getPreviewList(env, PREVIEW_LOG_KEY), revoked: rest });
}

// Draft, Publish now, or schedule a draft: one commit to data/interviews.json.
// A draft has no publish date ("draft": true), which frees its slot and
// keeps its page behind the preview code (js/interview-gate.js).
async function handleInterviewsAdminAction(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var action = body && body.action;
  if (['draft', 'publish-now', 'schedule'].indexOf(action) === -1) return json({ success: false, message: 'Unknown action' }, 400);
  if (action === 'schedule' && !isValidIsoDay(body.date)) return json({ success: false, message: 'Choose a valid date' }, 400);
  var today = ukDateString(new Date());
  try {
    for (var attempt = 0; attempt < 2; attempt++) {
      var current = await readInterviewsFile(env);
      var iv = current.file.interviews.find(function (i) { return i.url === body.url; });
      if (!iv) throw new Error('No interview with the page ' + body.url + ', reload the page');
      if ((iv.publish || '') !== ((body.from && body.from.publish) || '')) {
        throw new Error(iv.name + ' was changed somewhere else since you loaded the page, reload and try again');
      }
      var line;
      if (action === 'draft') {
        if (!iv.publish) throw new Error(iv.name + ' is already a draft');
        if (iv.publish <= today) throw new Error(iv.name + ' is already published');
        line = iv.name + ' set to draft (was ' + iv.publish + ')';
        delete iv.publish;
        iv.draft = true;
      } else {
        var date = action === 'publish-now' ? today : body.date;
        line = iv.name + (action === 'publish-now' ? ' published now (' + date + ')' : ' scheduled for ' + date);
        iv.publish = date;
        delete iv.draft;
      }
      current.file.interviews.sort(function (a, b) { return (a.publish || '9999') < (b.publish || '9999') ? -1 : (a.publish || '9999') > (b.publish || '9999') ? 1 : 0; });
      var content = btoa(unescape(encodeURIComponent(JSON.stringify(current.file, null, 2) + '\n')));
      var putRes = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + INTERVIEWS_PATH,
        {
          method: 'PUT',
          headers: eventsGithubHeaders(env),
          body: JSON.stringify({ message: 'Owner Interviews (admin): ' + line, content: content, sha: current.sha, branch: BASE_BRANCH })
        }
      );
      if (putRes.ok) return json({ success: true, interviews: current.file.interviews, change: line });
      if (putRes.status !== 409 && putRes.status !== 422) throw new Error('Could not save the interviews file (' + putRes.status + ')');
    }
    throw new Error('The interviews file was changed by something else at the same time, please try again');
  } catch (err) {
    return json({ success: false, message: err.message }, 400);
  }
}

// ---------- Event pages ----------
// Every event is an entry in data/event-pages.json, shown at
// event.html?e=<slug> (js/event-page.js). Like Owner Interviews, an entry is a
// draft or has a publish date (UK time), and until it is published its page
// shows only a Coming soon card (js/event-gate.js). Only the admin can open it
// early: Preview on events-admin.html mints a one-time link here (admin key),
// and the page swaps it for a long-lived access token in that browser.
// People the admin shares the link with can ask for a one-time code by email,
// as on Owner Interviews (the code email says it subscribes them). A code
// opens the draft in that browser for 7 days, signs them in, and every
// opening is logged for the admin page, which can revoke an email.
//
// The admin page saves an event's details here. A save is one commit to
// data/event-pages.json (the source of truth, which redeploys the site) and a
// copy in one KV key, so a Preview shows the change straight away instead of
// after the redeploy. Images go to the R2 bucket under events/<slug>/.
// Everything is read with get() only.

var EVENT_PREVIEW_LINK_TTL_SECONDS = 5 * 60;
var EVENT_PREVIEW_ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60;
var EVENT_DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60;
var EVENT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
var EVENT_VIEWER_ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60;
var EVENT_PREVIEW_LOG_KEY = 'event-preview-log';
var EVENT_PREVIEW_REVOKED_KEY = 'event-preview-revoked';

async function readEventPagesFile(env) {
  var res = await fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + EVENT_PAGES_PATH + '?ref=' + BASE_BRANCH,
    { headers: eventsGithubHeaders(env), cf: { cacheTtl: 0 } }
  );
  if (!res.ok) throw new Error('Could not read the event pages file (' + res.status + ')');
  var data = await res.json();
  var text = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  var file = JSON.parse(text);
  if (!Array.isArray(file.events)) file.events = [];
  return { file: file, sha: data.sha };
}

async function writeEventPagesFile(env, current, message) {
  var content = btoa(unescape(encodeURIComponent(JSON.stringify(current.file, null, 2) + '\n')));
  return fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + EVENT_PAGES_PATH,
    {
      method: 'PUT',
      headers: eventsGithubHeaders(env),
      body: JSON.stringify({ message: message, content: content, sha: current.sha, branch: BASE_BRANCH })
    }
  );
}

function eventPageState(ev, today) {
  if (ev.draft || !ev.publish) return 'draft';
  return ev.publish <= today ? 'live' : 'scheduled';
}

function eventSlugOk(value) {
  var slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(slug) ? slug : '';
}

async function putEventDraftCopy(env, entry) {
  await env.VOTES.put('event-page-draft:' + entry.slug, JSON.stringify(entry), { expirationTtl: EVENT_DRAFT_TTL_SECONDS });
}

// The admin page reads the list from here rather than the site's copy, which
// lags a minute or two behind a save while the site redeploys.
async function handleEventPagesAdminList(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  try {
    var current = await readEventPagesFile(env);
    return json({ success: true, events: current.file.events });
  } catch (err) {
    return json({ success: false, message: err.message }, 500);
  }
}

// ---- Checking what the admin form sends ----
function evStr(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function evList(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}
function evImage(value) {
  var v = evStr(value, 400);
  return /^https:\/\/[^\s"'<>]+$/i.test(v) || /^images\/[A-Za-z0-9_\-./]+$/.test(v) ? v : '';
}
function evLink(value) {
  var v = evStr(value, 400);
  return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
}
function evDay(value) {
  var v = evStr(value, 10);
  return v && isValidIsoDay(v) ? v : '';
}
function evTime(value) {
  var v = evStr(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '';
}

// Turns the form's fields into the stored shape, or returns { error }.
function cleanEventEntry(input) {
  var slug = eventSlugOk(input && input.slug);
  if (!slug) return { error: 'The web address name can only use letters, numbers and hyphens' };
  var name = evStr(input.name, 100);
  var title = evStr(input.title, 120);
  if (!name) return { error: 'Give the event a name' };
  if (!title) return { error: 'Give the event a title' };
  var startDate = evDay(input.startDate);
  var endDate = evDay(input.endDate);
  if (endDate && startDate && endDate < startDate) return { error: 'The end date is before the start date' };
  var startTime = evTime(input.startTime);
  var endTime = evTime(input.endTime);
  var venue = evStr(input.venue, 120);
  var town = evStr(input.town, 80);
  var w3w = evStr(input.what3words, 80).replace(/^\/*/, '');
  if (w3w && !/^[a-zA-Z]+\.[a-zA-Z]+\.[a-zA-Z]+$/.test(w3w)) return { error: 'what3words needs three words with dots, like starter.minivans.doted' };

  var tickets = input.tickets || {};
  var entry = {
    slug: slug,
    name: name,
    title: title,
    tagline: evStr(input.tagline, 200),
    organisers: evStr(input.organisers, 200),
    kind: evStr(input.kind, 30),
    // The older Facebook-style event (events-manifest.json) this page belongs to, if any.
    manifestId: /^[A-Za-z0-9_-]{1,20}$/.test(evStr(input.manifestId, 20)) ? evStr(input.manifestId, 20) : '',
    startDate: startDate,
    endDate: endDate,
    startTime: startTime,
    endTime: endTime,
    timeNote: evStr(input.timeNote, 120),
    venue: venue,
    town: town,
    address: evStr(input.address, 250),
    what3words: w3w ? '///' + w3w.toLowerCase() : '',
    location: evStr(input.location, 120) || [venue, town].filter(Boolean).join(', '),
    directions: evStr(input.directions, 600),
    venueNotes: evList(input.venueNotes, 8).map(function (n) { return { label: evStr(n && n.label, 30), value: evStr(n && n.value, 150) }; }).filter(function (n) { return n.label && n.value; }),
    image: evImage(input.image),
    heroImage: evImage(input.heroImage),
    poster: evImage(input.poster),
    galleryTitle: evStr(input.galleryTitle, 60),
    gallery: evList(input.gallery, 8).map(function (g) { return { src: evImage(g && g.src), caption: evStr(g && g.caption, 120) }; }).filter(function (g) { return g.src; }),
    description: evList(input.description, 12).map(function (p) { return evStr(p, 1500); }).filter(Boolean),
    highlights: evList(input.highlights, 10).map(function (h) { return evStr(h, 120); }).filter(Boolean),
    steps: evList(input.steps, 8).map(function (s) { return { title: evStr(s && s.title, 200), text: evStr(s && s.text, 500) }; }).filter(function (s) { return s.title || s.text; }),
    entry: evStr(input.entry, 80),
    entryNote: evStr(input.entryNote, 120),
    tickets: {
      intro: evStr(tickets.intro, 300),
      tiers: evList(tickets.tiers, 6).map(function (t) {
        t = t || {};
        return {
          name: evStr(t.name, 60), price: evStr(t.price, 20), per: evStr(t.per, 40), tag: evStr(t.tag, 30),
          includes: evList(t.includes, 10).map(function (i) { return evStr(i, 100); }).filter(Boolean),
          url: evLink(t.url), buttonLabel: evStr(t.buttonLabel, 30), featured: !!t.featured, soldOut: !!t.soldOut, addOn: !!t.addOn
        };
      }).filter(function (t) { return t.name; }),
      notes: evList(tickets.notes, 6).map(function (n) { return { label: evStr(n && n.label, 30), value: evStr(n && n.value, 150) }; }).filter(function (n) { return n.label && n.value; })
    },
    schedule: evList(input.schedule, 20).map(function (s) { return { time: evStr(s && s.time, 20), title: evStr(s && s.title, 100), text: evStr(s && s.text, 300) }; }).filter(function (s) { return s.title; }),
    faq: evList(input.faq, 15).map(function (f) { return { q: evStr(f && f.q, 150), a: evStr(f && f.a, 800) }; }).filter(function (f) { return f.q && f.a; }),
    ctaUrl: evLink(input.ctaUrl),
    ctaLabel: evStr(input.ctaLabel, 40),
    closing: evStr(input.closing, 200)
  };
  // Empty things are left out of the file to keep it readable.
  Object.keys(entry).forEach(function (k) {
    var v = entry[k];
    if (v === '' || (Array.isArray(v) && !v.length)) delete entry[k];
  });
  if (!entry.tickets.tiers.length && !entry.tickets.notes.length && !entry.tickets.intro) delete entry.tickets;
  else Object.keys(entry.tickets).forEach(function (k) { var v = entry.tickets[k]; if (v === '' || (Array.isArray(v) && !v.length)) delete entry.tickets[k]; });
  return { entry: entry };
}

// Save: adds a new event (as a draft) or updates one. The publish state is
// never changed here, only by the actions below.
async function handleEventPagesAdminSave(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var cleaned = cleanEventEntry(body && body.entry);
  if (cleaned.error) return json({ success: false, message: cleaned.error }, 400);
  var entry = cleaned.entry;
  var today = ukDateString(new Date());
  try {
    for (var attempt = 0; attempt < 2; attempt++) {
      var current = await readEventPagesFile(env);
      var idx = current.file.events.findIndex(function (e) { return e.slug === entry.slug; });
      var line;
      if (idx >= 0) {
        var old = current.file.events[idx];
        if (body.isNew) throw new Error('There is already an event called ' + entry.slug + ', choose another web address name');
        if (old.publish) entry.publish = old.publish;
        if (old.draft) entry.draft = true;
        if (old.created) entry.created = old.created;
        current.file.events[idx] = entry;
        line = entry.name + ' saved';
      } else {
        if (!body.isNew) throw new Error('That event no longer exists, reload the page');
        entry.draft = true;
        entry.created = today;
        current.file.events.push(entry);
        line = entry.name + ' created as a draft';
      }
      var putRes = await writeEventPagesFile(env, current, 'Event pages (admin): ' + line);
      if (putRes.ok) {
        await putEventDraftCopy(env, entry);
        return json({ success: true, events: current.file.events, entry: entry, change: line });
      }
      if (putRes.status !== 409 && putRes.status !== 422) throw new Error('Could not save the event pages file (' + putRes.status + ')');
    }
    throw new Error('The event pages file was changed by something else at the same time, please try again');
  } catch (err) {
    return json({ success: false, message: err.message }, 400);
  }
}

async function handleEventPagesAdminAction(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var action = body && body.action;
  var slug = eventSlugOk(body && body.slug);
  if (!slug) return json({ success: false, message: 'Invalid event' }, 400);
  if (['draft', 'publish-now', 'schedule', 'delete'].indexOf(action) === -1) return json({ success: false, message: 'Unknown action' }, 400);
  if (action === 'schedule' && !isValidIsoDay(body.date)) return json({ success: false, message: 'Choose a valid date' }, 400);
  var today = ukDateString(new Date());
  if (action === 'schedule' && body.date <= today) return json({ success: false, message: 'Choose a date after today, or use Publish now' }, 400);
  try {
    for (var attempt = 0; attempt < 2; attempt++) {
      var current = await readEventPagesFile(env);
      var idx = current.file.events.findIndex(function (e) { return e.slug === slug; });
      if (idx < 0) throw new Error('No event ' + slug + ', reload the page');
      var ev = current.file.events[idx];
      var from = body.from || {};
      if ((ev.publish || '') !== (from.publish || '') || !!ev.draft !== !!from.draft) {
        throw new Error(ev.name + ' was changed somewhere else since you loaded the page, reload and try again');
      }
      var state = eventPageState(ev, today);
      var line;
      if (action === 'delete') {
        if (state === 'live') throw new Error(ev.name + ' is live. Move it to draft before deleting it');
        line = ev.name + ' deleted';
        current.file.events.splice(idx, 1);
      } else if (action === 'draft') {
        if (state === 'draft') throw new Error(ev.name + ' is already a draft');
        line = ev.name + ' set to draft (was ' + ev.publish + ')';
        delete ev.publish;
        ev.draft = true;
      } else if (action === 'publish-now') {
        if (state === 'live') throw new Error(ev.name + ' is already live');
        line = ev.name + ' published now (' + today + ')';
        ev.publish = today;
        delete ev.draft;
      } else {
        line = ev.name + ' scheduled for ' + body.date;
        ev.publish = body.date;
        delete ev.draft;
      }
      var putRes = await writeEventPagesFile(env, current, 'Event pages (admin): ' + line);
      if (putRes.ok) {
        if (action === 'delete') await env.VOTES.delete('event-page-draft:' + slug);
        else await putEventDraftCopy(env, ev);
        return json({ success: true, events: current.file.events, change: line });
      }
      if (putRes.status !== 409 && putRes.status !== 422) throw new Error('Could not save the event pages file (' + putRes.status + ')');
    }
    throw new Error('The event pages file was changed by something else at the same time, please try again');
  } catch (err) {
    return json({ success: false, message: err.message }, 400);
  }
}

// Image upload from the admin form: the body is the image itself. It goes to
// the R2 bucket at events/<slug>/<random>.<ext> and the public address comes
// back. The admin page shrinks photos first, so this is a safety limit.
async function handleEventPagesImage(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var slug = eventSlugOk(new URL(request.url).searchParams.get('slug'));
  if (!slug) return json({ success: false, message: 'Save the event name and web address first' }, 400);
  var bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ success: false, message: 'No image received' }, 400);
  if (bytes.length > EVENT_IMAGE_MAX_BYTES) return json({ success: false, message: 'That image is over 6MB, please use a smaller one' }, 400);
  var type = '';
  var ext = '';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) { type = 'image/jpeg'; ext = 'jpg'; }
  else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) { type = 'image/png'; ext = 'png'; }
  else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) { type = 'image/webp'; ext = 'webp'; }
  if (!type) return json({ success: false, message: 'Images need to be JPEG, PNG or WebP' }, 400);
  var name = 'events/' + slug + '/' + randomToken().slice(0, 16) + '.' + ext;
  await env.GALLERY_BUCKET.put(name, bytes, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  return json({ success: true, url: GALLERY_PUBLIC_BASE_URL + '/' + name });
}

// Admin page's Preview button: a one-time link token for one event.
async function handleEventPreviewMint(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var slug = eventSlugOk(body && body.slug);
  if (!slug) return json({ success: false, message: 'Invalid event' }, 400);
  var token = randomToken();
  await env.VOTES.put('event-preview-link:' + token, JSON.stringify({ slug: slug }), { expirationTtl: EVENT_PREVIEW_LINK_TTL_SECONDS });
  return json({ success: true, token: token });
}

function eventPreviewCodeKey(email, slug) {
  return 'event-preview-code:' + slug + ':' + email;
}

async function eventPreviewRevoked(env, email, slug) {
  var revoked = await getPreviewList(env, EVENT_PREVIEW_REVOKED_KEY);
  return revoked.some(function (entry) { return entry.email === email && (entry.slug === '*' || entry.slug === slug); });
}

// One row per email and event: when first and last opened, how often.
async function logEventPreviewOpen(env, email, slug, joined) {
  var log = await getPreviewList(env, EVENT_PREVIEW_LOG_KEY);
  var now = new Date().toISOString();
  var row = null;
  log.forEach(function (entry) { if (entry.email === email && entry.slug === slug) row = entry; });
  if (row) {
    row.lastOpened = now;
    row.opens = (row.opens || 1) + 1;
  } else {
    log.push({ email: email, slug: slug, firstOpened: now, lastOpened: now, opens: 1, joined: !!joined });
  }
  log.sort(function (a, b) { return a.lastOpened < b.lastOpened ? 1 : -1; });
  await env.VOTES.put(EVENT_PREVIEW_LOG_KEY, JSON.stringify(log.slice(0, PREVIEW_LOG_MAX)));
}

// A real event: the saved copy, or failing that the file in the repo.
async function eventExists(env, slug) {
  if ((await env.VOTES.get('event-page-draft:' + slug)) !== null) return true;
  try {
    var current = await readEventPagesFile(env);
    return current.file.events.some(function (e) { return e.slug === slug; });
  } catch (err) {
    return false;
  }
}

var EVENT_LINK_FAILED = 'That link has expired or has already been used. Enter your email for a new code.';

// Someone the admin shared the link with asks for a code by email.
async function handleEventPreviewRequest(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var email = previewEmail(body && body.email);
  var slug = eventSlugOk(body && body.slug);
  if (!email) return json({ success: false, message: 'Please enter a valid email' }, 400);
  if (!slug) return json({ success: false, message: 'Invalid event' }, 400);
  var reply = json({ success: true, message: "We've sent a 6-digit code to " + email + ". It lasts 15 minutes. Check your junk folder if it hasn't arrived." });

  var ipKey = 'event-preview-ip:' + getClientIp(request);
  var ipCount = parseInt(await env.VOTES.get(ipKey), 10) || 0;
  if (ipCount >= PREVIEW_REQUESTS_PER_IP_PER_HOUR) {
    return json({ success: false, message: 'Too many attempts, please try again in an hour.' }, 429);
  }
  await env.VOTES.put(ipKey, String(ipCount + 1), { expirationTtl: 3600 });

  if (await eventPreviewRevoked(env, email, slug)) {
    return json({ success: false, message: "This email can't preview this event. It will be here once it is published." }, 403);
  }
  var cooldownKey = 'event-preview-cooldown:' + slug + ':' + email;
  if ((await env.VOTES.get(cooldownKey)) !== null) return reply;
  await env.VOTES.put(cooldownKey, '1', { expirationTtl: 60 });
  // Nothing is sent for an event that does not exist.
  if (!(await eventExists(env, slug))) return reply;

  var code = signInCode();
  var expires = Math.floor(Date.now() / 1000) + PREVIEW_CODE_TTL_SECONDS;
  var linkToken = randomToken();
  await env.VOTES.put(eventPreviewCodeKey(email, slug), JSON.stringify({ code: code, tries: 0, link: linkToken }), { expiration: expires, metadata: { expires: expires } });
  await env.VOTES.put('event-preview-link:' + linkToken, JSON.stringify({ email: email, slug: slug }), { expiration: expires });
  try {
    var isMember = (await env.VOTES.get('subscriber:' + email)) !== null;
    var subject = 'MT3UK event preview: your code is ' + code;
    var text = 'Here is your code to preview an MT3UK event page before it is published:\n\n' + code +
      '\n\nOr tap this link to open it straight away:\n\n' + MY_BUILDS_SITE_URL + '/event.html?e=' + slug + '&preview=' + linkToken +
      '\n\nThe code and link expire in 15 minutes and work once. The event page then stays open in that browser for 7 days.' +
      (isMember ? '' :
        '\n\nUsing this code also subscribes you to MT3UK (it\'s free) with this email address. You\'ll be signed in, so you can like and comment on member builds and Owner Interviews, and add your own car in My Garage whenever you like. You can stop emails or unsubscribe any time from your Profile: ' + PROFILE_URL + '#unsubscribe') +
      '\n\nPlease don\'t share the event page until it is published. If you did not ask for this code, you can ignore this email.';
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, email, rawEmail(MY_BUILDS_FROM_EMAIL, email, subject, text)));
  } catch (err) {
    console.log('Event preview email failed:', err.message);
  }
  return reply;
}

async function handleEventPreviewVerify(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var email = previewEmail(body && body.email);
  var slug = eventSlugOk(body && body.slug);
  var code = String((body && body.code) || '').replace(/\D/g, '');
  var failed = json({ success: false, message: 'That code is not right or has expired. Check the latest email, or send a new code.' }, 400);
  if (!email || !slug || code.length !== 6) return failed;

  var key = eventPreviewCodeKey(email, slug);
  var meta = await env.VOTES.getWithMetadata(key);
  var record = null;
  try { record = meta.value ? JSON.parse(meta.value) : null; } catch (e) { record = null; }
  if (!record) return failed;
  if (record.code !== code) {
    record.tries = (record.tries || 0) + 1;
    var expires = (meta.metadata && meta.metadata.expires) || 0;
    if (record.tries >= MAX_SIGN_IN_CODE_TRIES || expires < Math.floor(Date.now() / 1000) + 60) {
      await env.VOTES.delete(key);
    } else {
      await env.VOTES.put(key, JSON.stringify(record), { expiration: expires, metadata: { expires: expires } });
    }
    return failed;
  }
  await env.VOTES.delete(key);
  if (record.link) await env.VOTES.delete('event-preview-link:' + record.link);
  return grantEventViewer(env, email, slug, failed);
}

// Opens the event for 7 days, joins and signs in the email, and logs it.
async function grantEventViewer(env, email, slug, failed) {
  if (await eventPreviewRevoked(env, email, slug)) return failed;
  var token = randomToken();
  var expires = Date.now() + EVENT_VIEWER_ACCESS_TTL_SECONDS * 1000;
  await env.VOTES.put('event-preview-access:' + token, JSON.stringify({ slug: slug, email: email, expires: expires }), { expirationTtl: EVENT_VIEWER_ACCESS_TTL_SECONDS });
  var joined = false;
  if ((await env.VOTES.get('subscriber:' + email)) === null) {
    await env.VOTES.put('subscriber:' + email, JSON.stringify([]));
    await markSubscriberSince(env, email);
    joined = true;
  }
  await logEventPreviewOpen(env, email, slug, joined);
  var session = await createSession(env, email);
  return json({ success: true, token: token, expires: expires, joined: joined, session: session, email: email });
}

// The event page swaps a one-time link for a long-lived access token. The
// link is either the admin's (from Preview) or a shared viewer's (from the
// code email, which carries their email).
async function handleEventPreviewLink(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var slug = eventSlugOk(body && body.slug);
  var linkToken = String((body && body.token) || '');
  var failed = json({ success: false, message: EVENT_LINK_FAILED }, 400);
  if (!slug || !/^[A-Za-z0-9_-]{16,128}$/.test(linkToken)) return failed;
  var raw = await env.VOTES.get('event-preview-link:' + linkToken);
  var link = null;
  try { link = raw ? JSON.parse(raw) : null; } catch (e) { link = null; }
  if (!link || link.slug !== slug) return failed;
  await env.VOTES.delete('event-preview-link:' + linkToken);
  if (link.email) {
    await env.VOTES.delete(eventPreviewCodeKey(link.email, slug));
    return grantEventViewer(env, link.email, slug, failed);
  }
  var token = randomToken();
  var expires = Date.now() + EVENT_PREVIEW_ACCESS_TTL_SECONDS * 1000;
  await env.VOTES.put('event-preview-access:' + token, JSON.stringify({ slug: slug, expires: expires }), { expirationTtl: EVENT_PREVIEW_ACCESS_TTL_SECONDS });
  return json({ success: true, token: token, expires: expires });
}

async function eventPreviewRecord(env, token, slug) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || !slug) return null;
  var raw = await env.VOTES.get('event-preview-access:' + token);
  var record = null;
  try { record = raw ? JSON.parse(raw) : null; } catch (e) { record = null; }
  if (!record || record.slug !== slug || !(record.expires > Date.now())) return null;
  // A revoked email loses its preview straight away.
  if (record.email && (await eventPreviewRevoked(env, record.email, slug))) {
    await env.VOTES.delete('event-preview-access:' + token);
    return null;
  }
  return record;
}

async function handleEventPreviewCheck(request, env) {
  var params = new URL(request.url).searchParams;
  var record = await eventPreviewRecord(env, String(params.get('token') || ''), eventSlugOk(params.get('slug')));
  if (!record) return json({ success: false }, 401);
  return json({ success: true, expires: record.expires, admin: !record.email });
}

// Admin page: who has opened an event with a code, and Revoke or Restore.
async function handleEventPreviewAdminList(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  return json({ success: true, opened: await getPreviewList(env, EVENT_PREVIEW_LOG_KEY), revoked: await getPreviewList(env, EVENT_PREVIEW_REVOKED_KEY) });
}

async function handleEventPreviewAdminSave(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var email = previewEmail(body && body.email);
  var slug = previewSlug(body && body.slug, true);
  if (!email) return json({ success: false, message: 'Please enter a valid email' }, 400);
  if (!slug) return json({ success: false, message: 'Choose an event' }, 400);
  var revoked = await getPreviewList(env, EVENT_PREVIEW_REVOKED_KEY);
  var rest = revoked.filter(function (entry) { return !(entry.email === email && entry.slug === slug); });
  if (body.action === 'revoke') {
    if (rest.length >= 500) return json({ success: false, message: 'The list is full' }, 400);
    rest.push({ email: email, slug: slug, revoked: new Date().toISOString() });
  } else if (body.action !== 'restore') {
    return json({ success: false, message: 'Unknown action' }, 400);
  }
  await env.VOTES.put(EVENT_PREVIEW_REVOKED_KEY, JSON.stringify(rest));
  return json({ success: true, opened: await getPreviewList(env, EVENT_PREVIEW_LOG_KEY), revoked: rest });
}

// The newest saved copy of an event, for the admin's preview only.
async function handleEventPreviewContent(request, env) {
  var params = new URL(request.url).searchParams;
  var slug = eventSlugOk(params.get('slug'));
  var record = await eventPreviewRecord(env, String(params.get('token') || ''), slug);
  if (!record) return json({ success: false }, 401);
  var raw = await env.VOTES.get('event-page-draft:' + slug);
  var entry = null;
  try { entry = raw ? JSON.parse(raw) : null; } catch (e) { entry = null; }
  return json({ success: true, entry: entry });
}

// ---------- Admin viewer and member sessions for previews ----------
// The admin pages leave a long-lived "admin viewer" token in the admin's
// browser (minted with the admin key), so the event and interview gates open
// for the admin without waiting for a Preview or an emailed link. The token
// is tied to the current admin key, so changing the key ends every one.
// Anyone else uses an emailed code, or a passkey (or an existing sign-in),
// which proves they are an MT3UK member just as a code proves their email.

var ADMIN_VIEWER_TTL_SECONDS = 30 * 24 * 60 * 60;

async function adminKeyStamp(env) {
  var hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('admin-viewer:' + env.ADMIN_KEY));
  return Array.from(new Uint8Array(hash)).slice(0, 8).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function handleAdminViewerToken(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var token = randomToken();
  var expires = Date.now() + ADMIN_VIEWER_TTL_SECONDS * 1000;
  await env.VOTES.put('admin-viewer:' + token, JSON.stringify({ k: await adminKeyStamp(env), expires: expires }), { expirationTtl: ADMIN_VIEWER_TTL_SECONDS });
  return json({ success: true, token: token, expires: expires });
}

async function handleAdminViewerCheck(request, env) {
  var token = String(new URL(request.url).searchParams.get('token') || '');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || !env.ADMIN_KEY) return json({ success: false }, 401);
  var raw = await env.VOTES.get('admin-viewer:' + token);
  var record = null;
  try { record = raw ? JSON.parse(raw) : null; } catch (e) { record = null; }
  if (!record || !(record.expires > Date.now()) || record.k !== (await adminKeyStamp(env))) return json({ success: false }, 401);
  return json({ success: true, expires: record.expires });
}

// A signed-in member (for example just signed in with a passkey) opens an
// event preview. The sign-in proves the email, like a code does.
async function handleEventPreviewSession(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var slug = eventSlugOk(body && body.slug);
  if (!slug) return json({ success: false, message: 'Invalid event' }, 400);
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  if (!(await eventExists(env, slug))) return json({ success: false, message: 'That event page is not available' }, 404);
  return grantEventViewer(env, email, slug, json({ success: false, message: "This email can't preview this event. It will be here once it is published." }, 403));
}

async function handleInterviewPreviewSession(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var slug = previewSlug(body && body.slug, false);
  if (!slug) return json({ success: false, message: 'Invalid interview' }, 400);
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  return grantPreview(env, email, slug, json({ success: false, message: "This email can't preview this interview. It will be here on its publish date." }, 403));
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

  var todayStr = voteWeekString(new Date());
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

  var todayStr = voteWeekString(new Date());
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

  var todayStr = voteWeekString(new Date());
  await env.VOTES.put('votes:' + todayStr + ':' + file, String(count), { expirationTtl: VOTE_TTL_SECONDS });

  return json({ success: true, date: todayStr, file: file, votes: count });
}

async function handleVotersList(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  var todayStr = voteWeekString(new Date());
  var prefix = 'voter-meta:' + todayStr + ':';
  var list = await env.VOTES.list({ prefix: prefix });

  var results = await Promise.all(list.keys.map(async function (k) {
    var raw = await env.VOTES.get(k.name);
    var meta = null;
    try { meta = JSON.parse(raw); } catch (e) {}
    return {
      ip: k.name.slice(prefix.length).split('#')[0],
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

// Which build a member has voted for this week.
function memberVoteKey(weekStr, email) {
  return 'voter-member:' + weekStr + ':' + String(email).toLowerCase();
}

async function handleVotesGet(request, env, ctx) {
  var manifest = await getLiveGalleryEntries(env, ctx);
  var todayStr = voteWeekString(new Date());
  var candidates = votingCandidates(manifest, todayStr);
  var voterId = getVoterId(request);

  // Voting is for signed-in members, one vote each a week.
  var sessionEmail = await resolveSession(request, env);
  var votedFile = sessionEmail ? await env.VOTES.get(memberVoteKey(todayStr, sessionEmail)) : null;

  var counts = await getVoteCounts(env, ctx, todayStr, candidates.map(function (p) { return p.file; }));
  var viewer = sessionEmail ? await ownerKey(sessionEmail) : null;
  var results = candidates.map(function (p) {
    var result = {
      file: p.file,
      caption: p.caption || '',
      votes: counts[p.file] || 0,
      mods: p.mods || []
    };
    if (viewer && p.owner === viewer) result.mine = true;
    return result;
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
  var todayStr = voteWeekString(new Date());
  var candidates = votingCandidates(manifest, todayStr);
  var candidate = candidates.filter(function (p) { return p.file === file; })[0];
  if (!candidate) {
    return json({ success: false, message: 'That photo is not open for voting' }, 400);
  }
  // Voting is for signed-in members, one vote each a week (like likes and
  // comments).
  var sessionEmail = await resolveSession(request, env);
  if (!sessionEmail) return signInRequired('Sign in to vote.');
  var viewer = await ownerKey(sessionEmail);
  if (candidate.owner === viewer) {
    return json({ success: false, message: 'You can only vote for other members\u2019 builds.' }, 403);
  }

  var voterId = getVoterId(request);
  var ip = getClientIp(request);
  var memberKey = memberVoteKey(todayStr, sessionEmail);
  var previousVote = await env.VOTES.get(memberKey);
  // A vote this device made before voting needed a sign-in moves rather
  // than counting twice. It's used once, then forgotten, so a second member
  // on the same phone doesn't move it again.
  var deviceKey = 'voter:' + todayStr + ':' + voterId;
  var anonymousVote = previousVote ? null : await env.VOTES.get(deviceKey);
  if (anonymousVote) previousVote = anonymousVote;

  if (previousVote !== file) {
    if (previousVote) {
      var prevCountKey = 'votes:' + todayStr + ':' + previousVote;
      var prevCount = parseInt((await env.VOTES.get(prevCountKey)) || '0', 10);
      await env.VOTES.put(prevCountKey, String(Math.max(0, prevCount - 1)), { expirationTtl: VOTE_TTL_SECONDS });
    }
    var countKey = 'votes:' + todayStr + ':' + file;
    var count = parseInt((await env.VOTES.get(countKey)) || '0', 10);
    await env.VOTES.put(countKey, String(count + 1), { expirationTtl: VOTE_TTL_SECONDS });
    await env.VOTES.put(memberKey, file, { expirationTtl: VOTE_TTL_SECONDS });

    var cf = request.cf || {};
    var meta = {
      file: file,
      asn: cf.asn || null,
      isp: cf.asOrganization || null,
      country: cf.country || null,
      ts: Date.now()
    };
    // One record per member (a household can share an IP address).
    await env.VOTES.put('voter-meta:' + todayStr + ':' + ip + '#' + viewer, JSON.stringify(meta), { expirationTtl: VOTE_TTL_SECONDS });
  }

  if (anonymousVote) {
    // Now kept as this member's vote.
    if (anonymousVote === file) await env.VOTES.put(memberKey, file, { expirationTtl: VOTE_TTL_SECONDS });
    await env.VOTES.delete(deviceKey);
  }

  var results = await Promise.all(candidates.map(async function (p) {
    var c = await env.VOTES.get('votes:' + todayStr + ':' + p.file);
    var result = { file: p.file, caption: p.caption || '', votes: c ? parseInt(c, 10) : 0, mods: p.mods || [] };
    if (viewer && p.owner === viewer) result.mine = true;
    return result;
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

// Photo likes, comment likes and comment reports need a signed-in member.
// They are recorded against "m:<email>" in the same keys anonymous voter
// ids used before, so older anonymous likes still count.
function memberActorId(email) {
  return 'm:' + email;
}

function signInRequired(message) {
  return json({ success: false, signIn: true, message: message }, 401);
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

  // A single JSON-array key per member (one KV get) rather than a list()
  // call, since this runs on every homepage visit and Workers KV's free tier
  // caps list operations far lower than reads. Signed-out visitors have
  // liked nothing.
  var memberEmail = await resolveSession(request, env);
  var liked = memberEmail ? await getLikerFiles(env, memberActorId(memberEmail)) : [];

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

  var likerEmail = await resolveSession(request, env);
  if (!likerEmail) return signInRequired('Sign in to like photos.');

  var manifest = await getLiveGalleryEntries(env, ctx);
  var isKnown = manifest.some(function (p) { return p.file === file; });
  if (!isKnown) {
    return json({ success: false, message: 'Unknown photo' }, 400);
  }

  var voterId = memberActorId(likerEmail);
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
  await updatePhotoLikers(env, file, likerEmail, liked);

  if (liked && ctx && ctx.waitUntil) {
    var likedEntry = manifest.filter(function (p) { return p.file === file; })[0];
    ctx.waitUntil(sendLikeAlert(env, file, voterId, likedEntry && likedEntry.caption, likerEmail).catch(function (err) {
      console.log('Like alert failed:', err.message);
    }));
  }

  return json({ success: true, file: file, liked: liked, count: count });
}

// Who liked each photo, newest first, for the "Liked by" sheet on the reel:
// one JSON key per photo (likers:<file>) holding each member's email, the
// name they had when they liked it, and when. Emails never leave the
// worker. Likes from before sign-in was needed aren't in it, so the sheet
// shows those as a count.
var MAX_LIKERS_PER_PHOTO = 500;

async function getPhotoLikers(env, file) {
  var raw = await env.VOTES.get('likers:' + file);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function updatePhotoLikers(env, file, email, liked) {
  var likers = (await getPhotoLikers(env, file)).filter(function (l) { return l.email !== email; });
  if (liked) {
    likers.unshift({ email: email, name: await publicNameFor(env, email), at: new Date().toISOString() });
    likers = likers.slice(0, MAX_LIKERS_PER_PHOTO);
  }
  await env.VOTES.put('likers:' + file, JSON.stringify(likers));
}

async function handleLikersGet(request, env) {
  var file = (new URL(request.url).searchParams.get('file') || '').toString();
  if (!file) return json({ success: false, message: 'file is required' }, 400);
  var likers = await getPhotoLikers(env, file);
  var count = parseInt((await env.VOTES.get('likes:' + file)) || '0', 10) || 0;
  return json({
    success: true,
    count: Math.max(count, likers.length),
    likers: likers.map(function (l) { return { name: l.name, at: l.at }; }),
    earlier: Math.max(0, count - likers.length)
  });
}

// Tells a photo's owner their build was liked: an entry in their My Garage
// notifications, and a push alert if they have push notifications on. A
// signed-in liker is named, anyone else shows as "Someone". Each visitor
// triggers at most one alert per photo in LIKE_ALERT_TTL_SECONDS, so liking
// and unliking can't spam it, and liking your own photo sends nothing.
var LIKE_ALERT_TTL_SECONDS = 30 * 24 * 60 * 60;

async function sendLikeAlert(env, file, voterId, caption, likerEmail) {
  var sidecar = null;
  try {
    var obj = await env.GALLERY_BUCKET.get('gallery/' + file + '.json');
    if (obj) sidecar = await obj.json();
  } catch (e) {}
  var ownerEmail = await sidecarOwnerEmail(env, file, sidecar);
  if (!ownerEmail || ownerEmail === likerEmail) return;
  var onceKey = 'like-alert:' + file + ':' + voterId;
  if (await env.VOTES.get(onceKey)) return;
  await env.VOTES.put(onceKey, '1', { expirationTtl: LIKE_ALERT_TTL_SECONDS });
  var likerName = likerEmail ? publicName(await getProfileRecord(env, likerEmail)) : '';
  var name = String(caption || '').toLowerCase().replace(/(^|\s)([a-z])/g, function (m, sp, c) { return sp + c.toUpperCase(); });
  await addNotification(env, ownerEmail, {
    type: 'like',
    file: file,
    fromName: likerName || 'Someone',
    text: 'Liked your photo' + (name ? ' of ' + name : '') + '.',
    createdAt: new Date().toISOString()
  });
  await sendPushToMember(env, ownerEmail, {
    title: (likerName || 'Someone') + ' liked your build',
    body: name ? name + ' got a new like.' : 'Your build got a new like.',
    url: commentAlertUrl(file, null)
  });
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

// Owner Interviews: comment threads are keyed "interview:<slug>" (e.g.
// interview:richard for blog-richard.html). A thread only accepts comments
// once that interview is listed in the site's data/interviews.json and its
// publish date (UK) has arrived, so nobody can open arbitrary threads.
var INTERVIEWS_URL = MY_BUILDS_SITE_URL + '/data/interviews.json';

function isInterviewThread(file) {
  return /^interview:[a-z0-9-]{1,40}$/.test(file);
}

async function getPublishedInterview(file) {
  var slug = file.slice('interview:'.length);
  try {
    var res = await fetch(INTERVIEWS_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!res.ok) return null;
    var data = await res.json();
    var list = (data && data.interviews) || [];
    var today = ukDateString(new Date());
    return list.find(function (i) {
      return i && i.url === 'blog-' + slug + '.html' && i.publish && i.publish <= today;
    }) || null;
  } catch (e) {
    return null;
  }
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
  var viewerEmail = await resolveSession(request, env);
  var likedIds = viewerEmail ? await getCommentLikerIds(env, memberActorId(viewerEmail)) : [];
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
  var text = ((body && body.text) || '').toString().trim().slice(0, MAX_COMMENT_LENGTH);
  var parentId = ((body && body.parentId) || '').toString() || null;

  if (!file) return json({ success: false, message: 'file is required' }, 400);
  if (!text) return json({ success: false, message: 'Comment cannot be empty' }, 400);

  // Comments are members-only: the commenter's email comes from their
  // signed-in session, never from the request body.
  var email = await resolveSession(request, env);
  if (!email) return signInRequired('Please sign in to comment.');

  if (isInterviewThread(file)) {
    var interview = await getPublishedInterview(file);
    if (!interview) {
      return json({ success: false, message: 'Comments are not open on this interview yet' }, 400);
    }
  } else {
    var manifest = await getLiveGalleryEntries(env, ctx);
    var isKnown = manifest.some(function (p) { return p.file === file; });
    if (!isKnown) {
      return json({ success: false, message: 'Unknown photo' }, 400);
    }
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
    name: await publicNameFor(env, email),
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

  await notifyCommentRecipients(env, ctx, file, email, comment.name, text, parentComment && parentComment.email, comment.id);

  return json({ success: true, comment: publicComment(comment, [], email) });
}

// A note to the admin about a report (best effort: the report is kept either way). The Admin bell only fills when
// admin.html is open, so these would otherwise wait unseen.
async function sendReportEmail(env, subject, text) {
  try {
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, rawEmail(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, subject, text + '\n\nReview it on the Reports panel: ' + MY_BUILDS_SITE_URL + '/admin.html#grp-reports')));
  } catch (e) { /* the report is saved */ }
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

  var reporterEmail = await resolveSession(request, env);
  if (!reporterEmail) return signInRequired('Sign in to report comments.');
  var voterId = memberActorId(reporterEmail);
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
    var n = comment.reports.length;
    await sendReportEmail(env, 'Reported comment on ' + file + (n > 1 ? ' (' + n + ' reports)' : ''),
      subscriberLabel(await publicNameFor(env, reporterEmail), reporterEmail) + ' reported a comment by ' + (comment.name || 'a member') + ' on ' + file + '.\n\n' +
      '"' + String(comment.text || '').slice(0, 500) + '"' + (comment.hidden ? '\n\nIt has had ' + n + ' reports and is now hidden.' : ''));
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
    await sendReportEmail(env, 'Reported photo: ' + file + (reports.length > 1 ? ' (' + reports.length + ' reports)' : ''),
      'A visitor reported the gallery photo ' + file + '.' + (reports.length >= PHOTO_REPORT_HIDE_THRESHOLD ? '\n\nIt has had ' + reports.length + ' reports and is now off the gallery, reel and voting.' : '') + '\n\n' + MY_BUILDS_SITE_URL + '/gallery.html?photo=' + encodeURIComponent(file));

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
      await putSidecar(env, sidecarKey, sidecar);
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
    await putSidecar(env, sidecarKey, sidecar);
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

  var deletedOwner = await sidecarOwnerEmail(env, file, sidecar);
  if (deletedOwner) {
    await removeSubscriberFile(env, deletedOwner, file);
    await env.VOTES.delete(photoOwnerKey(file));
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

async function sendClaimRequestEmail(env, file, email, note, name, guest) {
  var subject = 'Build claim request: ' + file;
  var body = subscriberLabel(name, email) + (guest ? ' (not signed in, email not yet confirmed)' : '') +
    ' has requested to claim the unclaimed build photo "' + file + '".\n\n' +
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

// A photo is claimed either from a signed-in My Garage account, or by
// someone who isn't a member yet giving their first name, last name and
// email. Either way an admin approves it, and a guest's email is only
// proven when they use the sign-in link sent to it on approval, so the
// build can't be taken over by typing someone else's address.
async function handleGalleryClaim(request, env) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  var email = await resolveSession(request, env);
  var guest = !email;
  var firstName = '';
  var lastName = '';
  if (guest) {
    email = ((body && body.email) || '').toString().trim().toLowerCase().slice(0, 200);
    firstName = cleanNamePart(body && body.firstName);
    lastName = cleanNamePart(body && body.lastName);
    if (!firstName || !lastName) {
      return json({ success: false, message: 'Please enter your first and last name' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, message: 'Please enter a valid email' }, 400);
    }
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
  if (sidecar.email || sidecar.owner) {
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
  if (guest) {
    claim.guest = true;
    claim.firstName = firstName;
    claim.lastName = lastName;
  }
  await saveClaim(env, file, claim);

  var claimantName = guest ? firstName + ' ' + lastName : profileFullName(await getProfile(env, email));
  try {
    await sendClaimRequestEmail(env, file, email, note, claimantName, guest);
  } catch (err) {
    console.log('Claim request email failed:', err.message);
  }

  return json({ success: true, status: 'pending' });
}

// Admin: removes a claim record, e.g. to tidy up decided claims. The
// photo's owner is not changed.
async function handleGalleryClaimsAdminRemove(request, env) {
  var url = new URL(request.url);
  var key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }
  var file = (url.searchParams.get('file') || '').toString();
  if (!file) return json({ success: false, message: 'file is required' }, 400);
  if (!(await getClaim(env, file))) return json({ success: false, message: 'No claim for that file' }, 404);
  await env.VOTES.delete(claimKey(file));
  return json({ success: true });
}

// Admin: emails a member a fresh one-time My Garage sign-in link, valid for
// as long as the links sent when an admin assigns them a build. The link is
// returned too, so it can be passed on another way if the email goes astray.
async function handleGalleryAdminSubscriberLink(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var email = ((body && body.email) || '').toString().trim().toLowerCase();
  if (!email) return json({ success: false, message: 'email is required' }, 400);
  if ((await env.VOTES.get('subscriber:' + email)) === null) {
    return json({ success: false, message: 'Subscriber not found' }, 404);
  }
  var token = randomToken();
  await env.VOTES.put('my-builds-link:' + token, email, { expirationTtl: BUILD_ASSIGNED_LINK_TTL_SECONDS });
  var link = MY_BUILDS_SITE_URL + '/my-builds.html?token=' + token;
  var emailed = true;
  try {
    await sendMyBuildsLinkEmail(env, email, link, '7 days');
  } catch (err) {
    emailed = false;
    console.log('Admin sign-in link email failed:', err.message);
  }
  return json({ success: true, emailed: emailed, link: link });
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
  await Promise.all(parsed.map(async function (c) {
    c.name = profileFullName(await getProfile(env, c.email)) ||
      (c.firstName && c.lastName ? c.firstName + ' ' + c.lastName : '');
  }));

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
    if (claim.guest && claim.firstName && claim.lastName && !(await getProfile(env, claim.email))) {
      await saveProfile(env, claim.email, claim.firstName, claim.lastName);
    }
    var claimName = profileFullName(await getProfile(env, claim.email));
    if (claimName) sidecar.name = claimName;
    await putSidecar(env, sidecarKey, sidecar);
    await addSubscriberFiles(env, claim.email, [file]);
    claim.status = 'approved';
    await triggerManifestRebuild(env);
    await sendPushToMember(env, claim.email, {
      title: 'Your build claim was approved',
      body: 'The build is now in your My Garage.',
      url: '/my-builds.html'
    });
    // Someone who claimed without signing in needs a way into My Garage.
    if (claim.guest) {
      try {
        await sendMyGarageAccessEmail(env, claim.email, 'Your MT3UK build claim was approved',
          'Your claim for a build on MT3UK has been approved, and it is now in your My Garage.');
      } catch (err) {
        console.log('Claim approved email failed:', err.message);
      }
    }
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
    await clearPhotoOwner(env, file, sidecar);
    await putSidecar(env, sidecarKey, sidecar);
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
// Reuses the same one-time sign-in link as the My Garage sign-in flow
// (rather than a plain "go sign in" message) since that email template is
// the one that reliably lands in the inbox instead of junk.
async function sendMyGarageAccessEmail(env, toEmail, subject, introText) {
  var token = randomToken();
  await env.VOTES.put('my-builds-link:' + token, toEmail, { expirationTtl: BUILD_ASSIGNED_LINK_TTL_SECONDS });
  var link = MY_BUILDS_SITE_URL + '/my-builds.html?token=' + token;
  var body = introText + ' Use this one-time link to sign in to My Garage:\n\n' + link +
    '\n\nThis link expires in 7 days and can only be used once. ' +
    'If you did not expect this, you can ignore this email.';
  var message = new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body));
  await env.SEND_EMAIL.send(message);
}

async function sendBuildAssignedEmail(env, toEmail, file) {
  await sendMyGarageAccessEmail(env, toEmail, 'A build was linked to your account', 'An image was assigned to you.');
}

async function sendSubscriberAddedEmail(env, toEmail) {
  await sendMyGarageAccessEmail(env, toEmail, "You've been added to MT3UK My Garage", "An MT3UK admin has set up My Garage access for your account.");
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
  var assignName = profileFullName(await getProfile(env, email));
  if (assignName) sidecar.name = assignName;
  else delete sidecar.name;
  await putSidecar(env, sidecarKey, sidecar);
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

// Admin: this week's Build of the Week entries, and photos taken out of
// voting, with who they belong to.
async function handleAdminVoteEntries(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }
  var week = voteWeekString(new Date());
  var manifest = await listGalleryEntriesFromR2(env);
  function row(p) {
    return { file: p.file, caption: p.caption || '', name: p.name || '', email: '', added: p.votableSince || p.added || '' };
  }
  var entries = await Promise.all(votingCandidates(manifest, week).map(async function (p) {
    var r = row(p);
    // Emails live in KV, not the public sidecars (putSidecar).
    if (p.owner) r.email = (await env.VOTES.get(photoOwnerKey(p.file))) || '';
    r.votes = parseInt((await env.VOTES.get('votes:' + week + ':' + p.file)) || '0', 10) || 0;
    return r;
  }));
  var removed = manifest.filter(function (p) { return p.voteBlocked; })
    .sort(function (a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); })
    .map(row);
  return json({ success: true, week: week, entries: entries, removed: removed });
}

// Admin: take a photo out of voting (the photo itself stays in the gallery
// and reel), or put it back.
async function handleAdminVoteEntryUpdate(request, env) {
  var key = new URL(request.url).searchParams.get('key');
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
  var action = body && body.action;
  if (!file || (action !== 'remove' && action !== 'restore')) {
    return json({ success: false, message: 'file and action (remove or restore) are required' }, 400);
  }
  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var obj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (obj) sidecar = await obj.json();
  } catch (e) {}
  var week = voteWeekString(new Date());
  var message;
  if (action === 'remove') {
    sidecar.votable = false;
    sidecar.voteBlocked = true;
    await env.VOTES.delete('votes:' + week + ':' + file);
    message = 'Removed from voting.';
  } else {
    delete sidecar.voteBlocked;
    // Back into this week's vote, unless the owner has entered another
    // photo since, in which case they can now re-enter this one themselves.
    var manifest = await listGalleryEntriesFromR2(env);
    var owner = sidecar.owner || (sidecar.email ? await ownerKey(sidecar.email) : null);
    var otherEntry = owner ? memberVoteEntry(manifest, week, owner) : null;
    if (otherEntry && otherEntry.file !== file) {
      message = 'Unblocked. The owner has entered another photo this week, so this one stays out until they switch.';
    } else {
      delete sidecar.votable;
      var photo = manifest.filter(function (p) { return p.file === file; })[0];
      if (!photo || !isOpenForVote(Object.assign({}, photo, { votable: true, voteBlocked: false }), week)) {
        sidecar.votableSince = ukDateString(new Date());
      }
      message = 'Back in this week\u2019s vote.';
    }
  }
  await putSidecar(env, sidecarKey, sidecar);
  return json({ success: true, file: file, message: message });
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

  // Upload times from R2, for members added before their join date was
  // recorded.
  var uploadedAt = {};
  try {
    (await listGalleryEntriesFromR2(env)).forEach(function (p) { uploadedAt[p.file] = p.uploadedAt; });
  } catch (e) {}

  var details = await Promise.all(emails.map(async function (email) {
    var profile = await getProfile(env, email);
    var files = await getSubscriberFiles(env, email);
    var added = await env.VOTES.get('subscriber-since:' + email);
    if (!added) {
      var times = files.map(function (f) { return uploadedAt[f]; }).filter(Boolean);
      added = times.length ? new Date(Math.min.apply(null, times)).toISOString() : '';
    }
    return {
      email: email,
      firstName: profile ? profile.firstName : '',
      lastName: profile ? profile.lastName : '',
      nickname: (await getProfileRecord(env, email)).nickname || '',
      added: added,
      files: files
    };
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
  await markSubscriberSince(env, email);
  var newFirst = cleanNamePart(body && body.firstName);
  var newLast = cleanNamePart(body && body.lastName);
  if (newFirst && newLast) await saveProfile(env, email, newFirst, newLast);

  try {
    await sendSubscriberAddedEmail(env, email);
  } catch (err) {
    console.log('Subscriber added email failed:', err.message);
  }

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
  var movedProfile = await getProfile(env, oldEmail);
  if (movedProfile && !(await getProfile(env, newEmail))) {
    await saveProfile(env, newEmail, movedProfile.firstName, movedProfile.lastName);
  }
  await env.VOTES.delete('profile:' + oldEmail);
  var movedSince = await env.VOTES.get('subscriber-since:' + oldEmail);
  if (movedSince && !(await env.VOTES.get('subscriber-since:' + newEmail))) {
    await env.VOTES.put('subscriber-since:' + newEmail, movedSince);
  }
  await env.VOTES.delete('subscriber-since:' + oldEmail);

  for (var i = 0; i < oldFiles.length; i++) {
    var file = oldFiles[i];
    var sidecarKey = 'gallery/' + file + '.json';
    var sidecar = {};
    try {
      var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
      if (existingObj) sidecar = await existingObj.json();
    } catch (e) {}
    if ((await sidecarOwnerEmail(env, file, sidecar)) === oldEmail) {
      sidecar.email = newEmail;
      await putSidecar(env, sidecarKey, sidecar);
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
  if ((await sidecarOwnerEmail(env, file, sidecar)) === email) {
    await clearPhotoOwner(env, file, sidecar);
    delete sidecar.name;
    await putSidecar(env, sidecarKey, sidecar);
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
    if ((await sidecarOwnerEmail(env, file, sidecar)) === email) {
      await clearPhotoOwner(env, file, sidecar);
      delete sidecar.name;
      await putSidecar(env, sidecarKey, sidecar);
      if (sidecar.carId) await clearSidecarCarId(env, file);
    }
  }
  await env.VOTES.delete('subscriber:' + email);
  await env.VOTES.delete('profile:' + email);
  await env.VOTES.delete('subscriber-since:' + email);
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

  var likerEmail = await resolveSession(request, env);
  if (!likerEmail) return signInRequired('Sign in to like comments.');
  var voterId = memberActorId(likerEmail);
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

  return json({ success: true, id: id, liked: liked, likes: comment.likes });
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

// Non-ASCII header text (names, quotes, the • in masked emails) is
// encoded, as unencoded 8-bit headers count against an email in spam checks.
function encodeHeaderText(value) {
  value = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ');
  return /[^\x20-\x7e]/.test(value) ? '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(value))) + '?=' : value;
}

// The full set of headers mail providers expect, so emails don't land in
// Junk: Date, Message-ID, the text encoding and, for member emails,
// List-Unsubscribe (extraHeaders). No Reply-To: a reply address on another
// domain (gmail.com) than the sender is flagged by Outlook as a phishing
// sign, and no MT3UK email asks people to reply.
function rawEmail(from, to, subject, bodyText, extraHeaders) {
  var lines = [
    'From: MT3UK <' + from + '>',
    'To: ' + to,
    'Subject: ' + encodeHeaderText(subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@mt3uk.com>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit'
  ].concat(extraHeaders || []);
  lines.push('', String(bodyText).replace(/\r?\n/g, '\r\n'));
  return lines.join('\r\n');
}

// An email with a plain text version, an HTML version and inline pictures (images: [{ cid, type, name, bytes }]),
// as multipart/related. Mail apps that cannot show HTML or pictures fall back to the text.
function bytesToBase64(bytes) {
  var out = '', chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(out);
}
function rawEmailWithImages(from, to, subject, bodyText, bodyHtml, images) {
  var id = crypto.randomUUID().replace(/-/g, ''), rel = 'rel-' + id, alt = 'alt-' + id;
  var lines = [
    'From: MT3UK <' + from + '>', 'To: ' + to, 'Subject: ' + encodeHeaderText(subject), 'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@mt3uk.com>', 'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="' + rel + '"', '',
    '--' + rel, 'Content-Type: multipart/alternative; boundary="' + alt + '"', '',
    '--' + alt, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', String(bodyText).replace(/\r?\n/g, '\r\n'),
    '--' + alt, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', String(bodyHtml).replace(/\r?\n/g, '\r\n'),
    '--' + alt + '--'
  ];
  (images || []).forEach(function (im) {
    var b64 = bytesToBase64(im.bytes).replace(/(.{76})/g, '$1\r\n');
    lines.push('--' + rel, 'Content-Type: ' + im.type + '; name="' + im.name + '"', 'Content-Transfer-Encoding: base64', 'Content-ID: <' + im.cid + '>',
      'Content-Disposition: inline; filename="' + im.name + '"', '', b64);
  });
  lines.push('--' + rel + '--', '');
  return lines.join('\r\n');
}
function htmlEscape(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// For emails members can turn off (alerts and messages from MT3UK).
// One-click unsubscribe (RFC 8058): Gmail and Outlook show their own
// Unsubscribe button and POST to the signed link, which turns off that
// member's email alerts. Opening the link in a browser asks first, so link
// scanners can't unsubscribe anyone.
var WORKER_PUBLIC_URL = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
var unsubscribeKeyPromise = null;

function unsubscribeKey(env) {
  if (!unsubscribeKeyPromise) {
    unsubscribeKeyPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode('mt3uk-unsubscribe-v1:' + (env.ADMIN_KEY || '')))
      .then(function (raw) {
        return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      });
  }
  return unsubscribeKeyPromise;
}

async function unsubscribeToken(env, email) {
  var sig = await crypto.subtle.sign('HMAC', await unsubscribeKey(env), new TextEncoder().encode(String(email).toLowerCase()));
  return base64UrlFromBytes(new Uint8Array(sig)).slice(0, 32);
}

async function unsubscribeUrl(env, email) {
  return WORKER_PUBLIC_URL + '/email/unsubscribe?e=' + base64UrlFromBytes(new TextEncoder().encode(String(email).toLowerCase())) +
    '&t=' + (await unsubscribeToken(env, email));
}

// Member emails go without the unsubscribe headers: admin tests to
// Outlook with the same text reached the inbox without them and went to
// Junk with them. Members turn emails off in Profile (the footer says
// where), and the one-click link still works if the headers come back
// (UNSUBSCRIBE_HEADERS, or Send as "With unsubscribe header" in Admin).
var UNSUBSCRIBE_HEADERS = false;

async function memberEmailHeaders(env, email) {
  return UNSUBSCRIBE_HEADERS ? listUnsubscribeHeaders(env, email) : [];
}

async function listUnsubscribeHeaders(env, email) {
  return [
    'List-Unsubscribe: <' + (await unsubscribeUrl(env, email)) + '>, <mailto:' + SUBSCRIBERS_DIGEST_EMAIL + '?subject=Unsubscribe%20from%20MT3UK%20emails>',
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click'
  ];
}

function escapeHtmlText(v) {
  return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function unsubscribePage(title, bodyHtml, status) {
  var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + ' | MT3UK</title><style>' +
    'body{margin:0;background:#f3f1ea;color:#16233d;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    'main{max-width:460px;margin:12vh 16px 0;padding:28px 24px;background:#fff;border-top:4px solid #e8542a;box-shadow:0 10px 30px rgba(0,0,0,.08)}' +
    '@media (min-width:500px){main{margin:12vh auto 0}}' +
    'h1{font-size:1.3rem;margin:0 0 12px}p{margin:0 0 16px;color:#4a5568}a{color:#e8542a}' +
    'button{min-height:46px;padding:10px 20px;border:0;background:#e8542a;color:#fff;font:inherit;font-weight:600;cursor:pointer;width:100%}' +
    '.logo{font-weight:800;letter-spacing:.02em;margin-bottom:18px}' +
    '</style></head><body><main><div class="logo">MT3UK</div><h1>' + title + '</h1>' + bodyHtml + '</main></body></html>';
  return new Response(html, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// GET /email/unsubscribe?e=&t= asks first; POST turns off email alerts (the
// one-click POST from Gmail and Outlook, or the button on the page).
async function handleEmailUnsubscribe(request, env) {
  var url = new URL(request.url);
  var email = '';
  try { email = new TextDecoder().decode(bytesFromBase64Url(url.searchParams.get('e') || '')).toLowerCase(); } catch (e) {}
  var token = url.searchParams.get('t') || '';
  var valid = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && token && token === (await unsubscribeToken(env, email));
  if (!valid) {
    return unsubscribePage('This link doesn’t work',
      '<p>The unsubscribe link isn’t complete. You can turn off MT3UK emails in your <a href="' + PROFILE_URL + '#email-alerts">Profile</a>.</p>', 400);
  }
  if (request.method === 'POST') {
    var profile = await getProfileRecord(env, email);
    if (!profile.emailsOff) {
      profile.emailsOff = true;
      await putProfileRecord(env, email, profile);
    }
    return unsubscribePage('You’re unsubscribed',
      '<p>MT3UK won’t email you alerts or messages any more. One-time sign-in codes are still emailed when you ask for one, and you’ll still see everything in the bell when you’re signed in.</p>' +
      '<p>Changed your mind? Turn emails back on in your <a href="' + PROFILE_URL + '#email-alerts">Profile</a>.</p>');
  }
  return unsubscribePage('Unsubscribe from MT3UK emails?',
    '<p>This stops MT3UK emailing <strong>' + escapeHtmlText(email) + '</strong> alerts and messages. Sign-in codes are still emailed when you ask for one.</p>' +
    '<form method="post"><button type="submit">Unsubscribe</button></form>' +
    '<p style="margin-top:16px">Or manage your emails in your <a href="' + PROFILE_URL + '#email-alerts">Profile</a>.</p>');
}

async function sendMyBuildsLinkEmail(env, toEmail, link, expiresIn, code) {
  var subject = code ? 'Your MT3UK sign-in code: ' + code : 'Your MT3UK sign-in link';
  var body = 'Click the link below to sign in to MT3UK, where you can like and comment, manage your builds in My Garage and see your notifications:\n\n' + link +
    (code
      ? '\n\nOr enter this code on the Sign Up / Sign In page (in the MT3UK app from your Home Screen, use the code):\n\n' + code
      : '') +
    '\n\nThis ' + (code ? 'link and code expire' : 'link expires') + ' in ' + (expiresIn || '15 minutes') + ' and can only be used once. ' +
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

async function sendCommentNotificationEmail(env, toEmail, fromName, text, file, commentId, isReply) {
  // The link opens the photo with this comment highlighted (see my-builds.html)
  var link = MY_BUILDS_SITE_URL + '/my-builds.html?file=' + encodeURIComponent(file) +
    (commentId ? '&comment=' + encodeURIComponent(commentId) : '');
  var subject = fromName + (isReply ? ' replied to your comment' : ' commented on your build');
  var body = fromName + (isReply ? ' replied to your comment on an MT3UK build photo:' : ' left a comment on one of your MT3UK build photos:') +
    '\n\n"' + text + '"' +
    '\n\nView and reply: ' + link;
  if (isInterviewThread(file)) {
    link = MY_BUILDS_SITE_URL + '/blog-' + file.slice('interview:'.length) + '.html#comments';
    subject = fromName + ' commented on an Owner Interview';
    body = fromName + ' left a comment on an MT3UK Owner Interview:\n\n"' + text + '"' +
      '\n\nView and reply: ' + link;
  }
  var message = new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body + EMAIL_FOOTER, await memberEmailHeaders(env, toEmail)));
  await env.SEND_EMAIL.send(message);
}

// Notifies the photo's owner (read from the sidecar's stamped `email`
// field - set at upload time) and, on a reply, the author of the comment
// being replied to - both as an in-Garage notification and an email.
// Commenting on your own photo/reply, or a photo whose owner hasn't been
// stamped yet (e.g. an un-migrated legacy photo with no sidecar email), is
// a silent no-op for that recipient.
// ---------- Web Push (phone and desktop notifications) ----------
// Members turn notifications on in My Garage; each browser's push
// subscription is kept under push:<email> (one key per member, read with a
// single get). Messages are encrypted to the browser (RFC 8291, aes128gcm)
// and signed with this worker's VAPID key (RFC 8292). The VAPID key pair is
// made on first use and kept in KV, so there is no secret to set up.

var PUSH_KEYS_KV = 'push-vapid-keys';
var MAX_PUSH_SUBSCRIPTIONS = 10;
var PUSH_CONTACT = 'mailto:' + SUBSCRIBERS_DIGEST_EMAIL;

function b64urlEncode(bytes) {
  var bin = '';
  var arr = new Uint8Array(bytes);
  for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var bin = atob(s);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes() {
  var total = 0;
  for (var i = 0; i < arguments.length; i++) total += arguments[i].length;
  var out = new Uint8Array(total);
  var offset = 0;
  for (var j = 0; j < arguments.length; j++) {
    out.set(arguments[j], offset);
    offset += arguments[j].length;
  }
  return out;
}

// Returns { publicKey: base64url raw P-256 point, privateJwk }.
async function getVapidKeys(env) {
  var raw = await env.VOTES.get(PUSH_KEYS_KV);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) {}
  }
  var pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  var keys = {
    publicKey: b64urlEncode(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey)
  };
  await env.VOTES.put(PUSH_KEYS_KV, JSON.stringify(keys));
  return keys;
}

async function vapidAuthHeader(keys, endpoint) {
  var enc = new TextEncoder();
  var header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  var claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: PUSH_CONTACT
  })));
  var signingKey = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto returns the raw r||s signature ES256 expects.
  var signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, enc.encode(header + '.' + claims));
  return 'vapid t=' + header + '.' + claims + '.' + b64urlEncode(signature) + ', k=' + keys.publicKey;
}

async function hkdf(salt, ikm, info, length) {
  var key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  var bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, key, length * 8);
  return new Uint8Array(bits);
}

// RFC 8291 message encryption, as a single aes128gcm record.
async function encryptPushPayload(subscription, payloadText) {
  var enc = new TextEncoder();
  var uaPublic = b64urlDecode(subscription.keys.p256dh);
  var authSecret = b64urlDecode(subscription.keys.auth);

  var local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  var asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  var uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  var ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  var ikm = await hkdf(authSecret, ecdhSecret, concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  var nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  var plaintext = concatBytes(enc.encode(payloadText), new Uint8Array([2]));
  var aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  var ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  var recordSize = new Uint8Array([0, 0, 16, 0]); // 4096
  return concatBytes(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

async function getPushSubscriptions(env, email) {
  try {
    var parsed = JSON.parse((await env.VOTES.get('push:' + email)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Sends { title, body, url } to every browser the member turned
// notifications on in. Subscriptions the push service says have gone
// (404/410) are dropped. Never throws, so a failed push can't break the
// action that triggered it.
async function sendPushToMember(env, email, message) {
  try {
    var subs = await getPushSubscriptions(env, email);
    if (!subs.length) return 0;
    var keys = await getVapidKeys(env);
    var payload = JSON.stringify(message);
    var gone = [];
    var sent = 0;
    await Promise.all(subs.map(async function (sub) {
      try {
        var res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': await vapidAuthHeader(keys, sub.endpoint),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            'TTL': '86400',
            'Urgency': 'normal'
          },
          body: await encryptPushPayload(sub, payload)
        });
        if (res.status === 404 || res.status === 410) gone.push(sub.endpoint);
        else if (res.ok) sent++;
        else console.log('Push failed:', res.status, await res.text());
      } catch (err) {
        console.log('Push failed:', err.message);
      }
    }));
    if (gone.length) {
      await env.VOTES.put('push:' + email, JSON.stringify(subs.filter(function (s) { return gone.indexOf(s.endpoint) === -1; })));
    }
    return sent;
  } catch (err) {
    console.log('Push failed:', err.message);
    return 0;
  }
}

function validPushSubscription(sub) {
  return sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) &&
    sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
}

async function handlePushKey(request, env) {
  var keys = await getVapidKeys(env);
  return json({ success: true, publicKey: keys.publicKey });
}

async function handlePushSubscribe(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var sub = body && body.subscription;
  if (!validPushSubscription(sub)) return json({ success: false, message: 'Invalid subscription' }, 400);
  var subs = (await getPushSubscriptions(env, email)).filter(function (s) { return s.endpoint !== sub.endpoint; });
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, addedAt: new Date().toISOString() });
  await env.VOTES.put('push:' + email, JSON.stringify(subs.slice(-MAX_PUSH_SUBSCRIPTIONS)));
  return json({ success: true });
}

async function handlePushUnsubscribe(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var endpoint = ((body && body.endpoint) || '').toString();
  var subs = await getPushSubscriptions(env, email);
  await env.VOTES.put('push:' + email, JSON.stringify(subs.filter(function (s) { return s.endpoint !== endpoint; })));
  return json({ success: true });
}

async function handlePushTest(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var sent = await sendPushToMember(env, email, {
    title: 'MT3UK notifications are on',
    body: 'You will get alerts here for likes and comments on your builds, and replies to your comments.',
    url: '/my-builds.html'
  });
  return json({ success: true, sent: sent });
}

// Where a comment alert should open: the reel at the photo and comment, or
// an interview's comments.
function commentAlertUrl(file, commentId) {
  if (isInterviewThread(file)) return '/blog-' + file.slice('interview:'.length) + '.html#comments';
  return '/?photo=' + encodeURIComponent(file) + (commentId ? '&comment=' + encodeURIComponent(commentId) : '') + '#build-feed';
}

async function notifyCommentRecipients(env, ctx, file, commenterEmail, commenterName, text, parentAuthorEmail, commentId) {
  var ownerEmail = null;
  if (isInterviewThread(file)) {
    // Interviews have no photo owner: new comments go to the site owner.
    ownerEmail = SUBSCRIBERS_DIGEST_EMAIL;
  } else {
    var sidecarKey = 'gallery/' + file + '.json';
    var sidecar = null;
    try {
      var obj = await env.GALLERY_BUCKET.get(sidecarKey);
      if (obj) sidecar = await obj.json();
    } catch (e) {}
    ownerEmail = await sidecarOwnerEmail(env, file, sidecar);
  }

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
        commentId: commentId,
        fromName: commenterName,
        text: text,
        createdAt: new Date().toISOString()
      });
      // Members with push notifications on get those instead of emails.
      // The email still goes if no device could be reached.
      var pushed = await sendPushToMember(env, toEmail, {
        title: toEmail === ownerEmail ? 'New comment on your build' : 'New reply to your comment',
        body: commenterName + ': ' + text.slice(0, 140),
        url: commentAlertUrl(file, commentId)
      });
      if (!pushed && await wantsEmails(env, toEmail)) {
        try {
          await sendCommentNotificationEmail(env, toEmail, commenterName, text, file, commentId, toEmail !== ownerEmail);
        } catch (err) {
          console.log('Comment notification email failed:', err.message);
        }
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
  var isNew = (await env.VOTES.get('subscriber:' + email)) === null;
  var existing = await getSubscriberFiles(env, email);
  files.forEach(function (f) {
    if (existing.indexOf(f) === -1) existing.push(f);
  });
  await env.VOTES.put('subscriber:' + email, JSON.stringify(existing));
  if (isNew) await markSubscriberSince(env, email);
}

// When a member was added, for the admin page. Recorded when a member's
// record is first created; members from before this existed fall back to
// their earliest photo's upload date there.
async function markSubscriberSince(env, email) {
  await env.VOTES.put('subscriber-since:' + email, new Date().toISOString());
}

async function removeSubscriberFile(env, email, file) {
  var existing = await getSubscriberFiles(env, email);
  var idx = existing.indexOf(file);
  if (idx === -1) return;
  existing.splice(idx, 1);
  await env.VOTES.put('subscriber:' + email, JSON.stringify(existing));
}

// My Garage sessions are signed tokens (email and expiry, with an HMAC), so
// checking one needs no KV read. A session saved to KV could be missing for
// up to a minute at other Cloudflare locations, which signed members straight
// back out when they reopened the iPhone Home Screen app. Changing ADMIN_KEY
// signs everyone out. Older random tokens in KV still work until they expire.
var sessionHmacKeyPromise = null;

function sessionHmacKey(env) {
  if (!sessionHmacKeyPromise) {
    sessionHmacKeyPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode('mt3uk-session-v1:' + (env.ADMIN_KEY || '')))
      .then(function (raw) {
        return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
      });
  }
  return sessionHmacKeyPromise;
}

function base64UrlFromBytes(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromBase64Url(str) {
  var s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var bin = atob(s);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- Passkeys (WebAuthn) ----------
// Members can sign in with Face ID, a fingerprint or their device's screen
// lock instead of an emailed code. Only the public key is stored:
// passkeys:<email> (a list), and passkey-cred:<credential id> -> email to
// find the member at sign-in. Challenges are one-use keys that expire in
// 5 minutes. Signatures are checked here with WebCrypto (ES256 or RS256).
var PASSKEY_RP_ID = 'mt3uk.com';
var PASSKEY_ORIGINS = ['https://mt3uk.com', 'https://www.mt3uk.com', 'https://laps.mt3uk.com'];
var PASSKEY_CHALLENGE_TTL = 300;
var MAX_PASSKEYS = 10;

function passkeysKey(email) { return 'passkeys:' + email; }
function passkeyCredKey(id) { return 'passkey-cred:' + id; }

async function getPasskeys(env, email) {
  var list = await getJsonKey(env, passkeysKey(email), []);
  return Array.isArray(list) ? list : [];
}

function randomBase64Url(bytes) {
  var b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64UrlFromBytes(b);
}

// A small CBOR reader: enough for WebAuthn attestation objects and COSE keys.
function cborDecode(bytes, start) {
  var pos = start || 0;
  function read() {
    var first = bytes[pos++];
    var major = first >> 5;
    var info = first & 31;
    var len = info;
    if (info === 24) { len = bytes[pos]; pos += 1; }
    else if (info === 25) { len = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; }
    else if (info === 26) { len = ((bytes[pos] << 24) >>> 0) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3]; pos += 4; }
    else if (info === 27) {
      len = 0;
      for (var k = 0; k < 8; k++) len = len * 256 + bytes[pos + k];
      pos += 8;
    } else if (info > 27) throw new Error('Unsupported CBOR');
    if (major === 0) return len;
    if (major === 1) return -1 - len;
    if (major === 2) { var b = bytes.slice(pos, pos + len); pos += len; return b; }
    if (major === 3) { var t = new TextDecoder().decode(bytes.slice(pos, pos + len)); pos += len; return t; }
    if (major === 4) { var arr = []; for (var i = 0; i < len; i++) arr.push(read()); return arr; }
    if (major === 5) { var map = new Map(); for (var j = 0; j < len; j++) { var key = read(); map.set(key, read()); } return map; }
    if (major === 7) { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; }
    throw new Error('Unsupported CBOR');
  }
  var value = read();
  return { value: value, end: pos };
}

function parseAuthData(authData) {
  if (!authData || authData.length < 37) throw new Error('Bad authenticator data');
  var out = {
    rpIdHash: authData.slice(0, 32),
    flags: authData[32],
    signCount: ((authData[33] << 24) >>> 0) + (authData[34] << 16) + (authData[35] << 8) + authData[36]
  };
  if (out.flags & 0x40) {
    var idLen = (authData[53] << 8) | authData[54];
    out.credentialId = authData.slice(55, 55 + idLen);
    out.coseKey = cborDecode(authData, 55 + idLen).value;
  }
  return out;
}

// COSE public key -> { alg, jwk } for crypto.subtle.importKey('jwk', ...).
function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new Error('Bad key');
  var kty = cose.get(1);
  var alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: base64UrlFromBytes(cose.get(-2)), y: base64UrlFromBytes(cose.get(-3)), ext: true } };
  }
  if (kty === 3 && alg === -257) {
    return { alg: -257, jwk: { kty: 'RSA', n: base64UrlFromBytes(cose.get(-1)), e: base64UrlFromBytes(cose.get(-2)), alg: 'RS256', ext: true } };
  }
  throw new Error('Unsupported passkey type');
}

// WebAuthn ECDSA signatures are DER; WebCrypto wants r and s side by side.
function derToRawEcdsa(der) {
  var pos = 2;
  if (der[1] & 0x80) pos = 2 + (der[1] & 0x7f);
  function int() {
    if (der[pos] !== 0x02) throw new Error('Bad signature');
    var len = der[pos + 1];
    var v = der.slice(pos + 2, pos + 2 + len);
    pos += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    var out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  }
  var r = int();
  var sBytes = int();
  var raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(sBytes, 32);
  return raw;
}

async function verifyPasskeySignature(stored, data, signature) {
  if (stored.alg === -7) {
    var ecKey = await crypto.subtle.importKey('jwk', stored.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ecKey, derToRawEcdsa(signature), data);
  }
  if (stored.alg === -257) {
    var rsaKey = await crypto.subtle.importKey('jwk', stored.jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', rsaKey, signature, data);
  }
  return false;
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Checks clientDataJSON and uses up its challenge. Returns the challenge
// record, or null.
async function checkClientData(env, clientDataBytes, type) {
  var clientData;
  try { clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)); } catch (e) { return null; }
  if (!clientData || clientData.type !== type || clientData.crossOrigin === true) return null;
  if (PASSKEY_ORIGINS.indexOf(clientData.origin) === -1) return null;
  var challenge = String(clientData.challenge || '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(challenge)) return null;
  var key = 'passkey-challenge:' + challenge;
  var record = await getJsonKey(env, key, null);
  if (!record) return null;
  await env.VOTES.delete(key);
  return record;
}

async function rpIdHash() {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PASSKEY_RP_ID)));
}

function passkeySummary(list) {
  return list.map(function (k) { return { id: k.id, name: k.name || 'Passkey', created: k.created || '', lastUsed: k.lastUsed || '' }; });
}

async function handlePasskeyRegisterOptions(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var list = await getPasskeys(env, email);
  if (list.length >= MAX_PASSKEYS) return json({ success: false, message: 'You have the most passkeys allowed. Remove one in Profile first.' }, 400);
  var challenge = randomBase64Url(32);
  await env.VOTES.put('passkey-challenge:' + challenge, JSON.stringify({ type: 'register', email: email }), { expirationTtl: PASSKEY_CHALLENGE_TTL });
  var profile = await getProfileRecord(env, email);
  return json({
    success: true,
    publicKey: {
      challenge: challenge,
      rp: { id: PASSKEY_RP_ID, name: 'MT3UK' },
      user: { id: base64UrlFromBytes(new TextEncoder().encode(await ownerKey(email))), name: email, displayName: publicName(profile) || email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      excludeCredentials: list.map(function (k) { return { type: 'public-key', id: k.id }; }),
      attestation: 'none',
      timeout: 120000
    }
  });
}

async function handlePasskeyRegisterVerify(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var failed = json({ success: false, message: 'The passkey could not be set up. Please try again.' }, 400);
  try {
    var response = (body && body.response) || {};
    var record = await checkClientData(env, bytesFromBase64Url(response.clientDataJSON || ''), 'webauthn.create');
    if (!record || record.type !== 'register' || record.email !== email) return failed;
    var attestation = cborDecode(bytesFromBase64Url(response.attestationObject || '')).value;
    var auth = parseAuthData(attestation.get('authData'));
    if (!sameBytes(auth.rpIdHash, await rpIdHash()) || !(auth.flags & 0x01) || !auth.credentialId) return failed;
    var id = base64UrlFromBytes(auth.credentialId);
    if (body.id && body.id !== id) return failed;
    var key = coseToJwk(auth.coseKey);
    var owner = await env.VOTES.get(passkeyCredKey(id));
    if (owner && owner !== email) return failed;
    var list = (await getPasskeys(env, email)).filter(function (k) { return k.id !== id; });
    list.push({
      id: id, alg: key.alg, jwk: key.jwk, counter: auth.signCount,
      name: String((body && body.name) || 'Passkey').replace(/[^\w .()'-]/g, '').slice(0, 40) || 'Passkey',
      created: new Date().toISOString()
    });
    await env.VOTES.put(passkeysKey(email), JSON.stringify(list.slice(-MAX_PASSKEYS)));
    await env.VOTES.put(passkeyCredKey(id), email);
    return json({ success: true, passkeys: passkeySummary(list) });
  } catch (err) {
    console.log('Passkey register failed:', err.message);
    return failed;
  }
}

async function handlePasskeyLoginOptions(request, env) {
  var challenge = randomBase64Url(32);
  await env.VOTES.put('passkey-challenge:' + challenge, JSON.stringify({ type: 'login' }), { expirationTtl: PASSKEY_CHALLENGE_TTL });
  return json({ success: true, publicKey: { challenge: challenge, rpId: PASSKEY_RP_ID, userVerification: 'preferred', allowCredentials: [], timeout: 120000 } });
}

async function handlePasskeyLoginVerify(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var failed = json({ success: false, message: 'That passkey didn’t work. Sign in with an email code instead, then set up the passkey again in Profile.' }, 400);
  try {
    var response = (body && body.response) || {};
    var clientDataBytes = bytesFromBase64Url(response.clientDataJSON || '');
    var record = await checkClientData(env, clientDataBytes, 'webauthn.get');
    if (!record || record.type !== 'login') return failed;
    var id = String((body && body.id) || '');
    var email = id ? await env.VOTES.get(passkeyCredKey(id)) : null;
    if (!email) return failed;
    var list = await getPasskeys(env, email);
    var stored = list.filter(function (k) { return k.id === id; })[0];
    if (!stored) return failed;
    var authData = bytesFromBase64Url(response.authenticatorData || '');
    var auth = parseAuthData(authData);
    if (!sameBytes(auth.rpIdHash, await rpIdHash()) || !(auth.flags & 0x01)) return failed;
    var clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
    var signed = new Uint8Array(authData.length + clientHash.length);
    signed.set(authData, 0);
    signed.set(clientHash, authData.length);
    if (!(await verifyPasskeySignature(stored, signed, bytesFromBase64Url(response.signature || '')))) return failed;
    // A counter that goes backwards means a copied key.
    if (stored.counter && auth.signCount && auth.signCount <= stored.counter) return failed;
    stored.counter = auth.signCount;
    stored.lastUsed = new Date().toISOString();
    await env.VOTES.put(passkeysKey(email), JSON.stringify(list));
    var session = await createSession(env, email);
    return json({ success: true, session: session, email: email });
  } catch (err) {
    console.log('Passkey sign-in failed:', err.message);
    return failed;
  }
}

async function handlePasskeyList(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  return json({ success: true, passkeys: passkeySummary(await getPasskeys(env, email)) });
}

async function handlePasskeyDelete(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { body = {}; }
  var id = String((body && body.id) || '');
  var list = await getPasskeys(env, email);
  var kept = list.filter(function (k) { return k.id !== id; });
  if (kept.length !== list.length) {
    await env.VOTES.put(passkeysKey(email), JSON.stringify(kept));
    if ((await env.VOTES.get(passkeyCredKey(id))) === email) await env.VOTES.delete(passkeyCredKey(id));
  }
  return json({ success: true, passkeys: passkeySummary(kept) });
}

// Sign-ins (sessions). A sign-in lasts 30 days from when it was last used:
// js/account-bar.js asks /session/refresh once a day for a renewed one, so
// active members stay signed in and an unused device is signed out.
// s2.<email>.<expires>.<version>.<signature>. The version is the member's
// session-version: "Sign out of all devices" in Profile raises it, which
// ends every existing sign-in. Older s1 sign-ins (no version) and the old
// stored ones count as version 0.
var SESSION_IDLE_SECONDS = 30 * 24 * 60 * 60;
var SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;

function sessionVersionKey(email) { return 'session-version:' + email; }

async function getSessionVersion(env, email) {
  return Number(await env.VOTES.get(sessionVersionKey(email))) || 0;
}

async function createSession(env, email) {
  var expires = Math.floor(Date.now() / 1000) + SESSION_IDLE_SECONDS;
  var version = await getSessionVersion(env, email);
  var payload = 's2.' + base64UrlFromBytes(new TextEncoder().encode(email)) + '.' + expires + '.' + version;
  var sig = await crypto.subtle.sign('HMAC', await sessionHmacKey(env), new TextEncoder().encode(payload));
  return payload + '.' + base64UrlFromBytes(new Uint8Array(sig));
}

// Details of a valid sign-in token, or null: { email, expires, version }.
async function readSession(env, token) {
  if (!token) return null;
  var parts = token.split('.');
  var signed = null;
  if (parts.length === 5 && parts[0] === 's2') signed = { email: parts[1], expires: Number(parts[2]), version: Number(parts[3]) || 0, sig: parts[4], payload: parts.slice(0, 4).join('.') };
  else if (parts.length === 4 && parts[0] === 's1') signed = { email: parts[1], expires: Number(parts[2]), version: 0, sig: parts[3], payload: parts.slice(0, 3).join('.') };
  var email;
  var info;
  if (signed) {
    if (!env.ADMIN_KEY || !(signed.expires > Date.now() / 1000)) return null;
    try {
      var ok = await crypto.subtle.verify('HMAC', await sessionHmacKey(env), bytesFromBase64Url(signed.sig), new TextEncoder().encode(signed.payload));
      if (!ok) return null;
      email = new TextDecoder().decode(bytesFromBase64Url(signed.email));
    } catch (e) {
      return null;
    }
    info = { email: email, expires: signed.expires, version: signed.version };
  } else {
    email = await env.VOTES.get('my-builds-session:' + token);
    if (!email) return null;
    info = { email: email, expires: 0, version: 0 };
  }
  if (info.version !== (await getSessionVersion(env, info.email))) return null;
  return info;
}

async function resolveSession(request, env) {
  var info = await readSession(env, request.headers.get('X-Session-Token'));
  return info ? info.email : null;
}

// GET /session/refresh: a renewed sign-in (30 more days) once the current
// one is a day old; 401 when it has run out or been signed out.
async function handleSessionRefresh(request, env) {
  var info = await readSession(env, request.headers.get('X-Session-Token'));
  if (!info) return json({ success: false, message: 'Please sign in again' }, 401);
  var now = Math.floor(Date.now() / 1000);
  var renew = !info.expires || info.expires - now < SESSION_IDLE_SECONDS - SESSION_RENEW_AFTER_SECONDS;
  return json({ success: true, session: renew ? await createSession(env, info.email) : null });
}

// POST /session/sign-out-all: ends every sign-in for this member, on every
// device, including this one.
async function handleSessionSignOutAll(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  await env.VOTES.put(sessionVersionKey(email), String((await getSessionVersion(env, email)) + 1));
  return json({ success: true });
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

// Car records sit in the public photo bucket, so they never hold the
// owner's email (older ones lose it in moveSidecarEmails).
async function saveCarRecord(env, car) {
  car = Object.assign({}, car);
  delete car.email;
  await env.GALLERY_BUCKET.put(carRecordKey(car.id), JSON.stringify(car, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
}

async function deleteCarRecord(env, carId) {
  await env.GALLERY_BUCKET.delete(carRecordKey(carId));
  await env.VOTES.delete(carDetailsKey(carId));
  await deleteCarTrackData(env, carId);
}

// A car's model and its mods list, as built in My Garage. Kept in KV, not
// with the car record in the photo bucket, because it holds things only the
// owner sees (fitted dates, who fitted it, cost, plans). Everyone else sees
// the flat mods list made from it by specsToMods().
function carDetailsKey(carId) {
  return 'car-details:' + carId;
}

async function getCarDetails(env, carId) {
  try {
    var raw = await env.VOTES.get(carDetailsKey(carId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function saveCarDetails(env, carId, details) {
  await env.VOTES.put(carDetailsKey(carId), JSON.stringify(details));
}

var CAR_MODELS = ['Model 3', 'Model Y', 'Model S', 'Model X', 'Hyundai Ioniq 5 N', 'Hyundai Ioniq 6 N', 'Porsche Taycan'];

// The areas of the mods builder (js/mods-builder.js has the labels and
// choices). fields: text answers. kinds: bodywork's separate jobs.
// picks: things to tick. items: free text lines.
var COILOVER_SETTINGS = ['road', 'track'].reduce(function (all, use) {
  return all.concat([use + 'ReboundFront', use + 'ReboundRear', use + 'CompressionFront', use + 'CompressionRear']);
}, []);
var MOD_AREAS = {
  wheels: { label: 'Wheels', fields: ['make', 'model', 'sizeFront', 'sizeRear', 'width', 'offset', 'finish', 'type'] },
  tyres: { label: 'Tyres', fields: ['make', 'model', 'size'] },
  // Coilovers also have rebound and compression settings for road and
  // track, front and rear, shown on the build (notes stay owner only).
  suspension: { label: 'Suspension', fields: ['type', 'make', 'model', 'drop', 'notes'].concat(COILOVER_SETTINGS) },
  // Front and rear (calipers, discs, pads are older saves, shown as Brakes).
  brakes: { label: 'Brakes', fields: ['frontCalipers', 'frontDiscs', 'frontPads', 'rearCalipers', 'rearDiscs', 'rearPads', 'fluid', 'calipers', 'discs', 'pads'],
    moreFields: ['part', 'makeModel'] },
  bodywork: { label: 'Bodywork', kinds: {
    wrap: ['make', 'colour'], ppf: ['make', 'model', 'coverage'], tint: ['front', 'rear'],
    aero: ['parts', 'make', 'material'], dechrome: ['what'], lights: ['what']
  }, moreFields: ['part', 'makeModel'] },
  interior: { label: 'Interior', picks: ['Seats', 'Wheel or yoke', 'Carbon trim', 'Mats', 'Screens', 'Wraps'], fields: ['makeModel', 'details'] },
  performance: { label: 'Performance', picks: ['Acceleration Boost', 'Cooling', 'Other'], fields: ['makeModel', 'details'] },
  audio: { label: 'Audio and tech', picks: ['Speakers', 'Amp', 'Sub', 'Dashcam', 'Chargers'], fields: ['makeModel', 'details'] },
  other: { label: 'Anything else', items: true }
};
var MOD_KIND_LABELS = { wrap: 'Wrap', ppf: 'PPF', tint: 'Tint', aero: 'Aero', dechrome: 'De-chrome', lights: 'Lights' };

function cleanModText(v, max) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max || 80) : '';
}

function cleanModFields(input, names) {
  var out = {};
  if (!input || typeof input !== 'object') return out;
  names.forEach(function (n) {
    var v = cleanModText(input[n]);
    if (v) out[n] = v;
  });
  return out;
}

function cleanFitted(input) {
  var out = {};
  if (!input || typeof input !== 'object') return out;
  var month = parseInt(input.month, 10);
  if (month >= 1 && month <= 12) out.month = month;
  var year = parseInt(input.year, 10);
  if (year >= 1990 && year <= new Date().getUTCFullYear() + 1) out.year = year;
  var by = cleanModText(input.by);
  if (by) out.by = by;
  var cost = cleanModText(input.cost, 20);
  if (cost) out.cost = cost;
  return out;
}

// Keeps only the known areas and answers, trimmed. An area with no status is
// still to do.
function cleanSpecs(input) {
  var out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  Object.keys(MOD_AREAS).forEach(function (id) {
    var area = MOD_AREAS[id];
    var src = input[id];
    if (!src || typeof src !== 'object') return;
    if (src.status !== 'stock' && src.status !== 'up') return;
    var a = { status: src.status };
    if (src.status === 'up') {
      if (area.fields) a.fields = cleanModFields(src.fields, area.fields);
      if (area.kinds) {
        a.kinds = {};
        Object.keys(area.kinds).forEach(function (k) {
          if (src.kinds && src.kinds[k] && typeof src.kinds[k] === 'object') {
            a.kinds[k] = cleanModFields(src.kinds[k], area.kinds[k]);
            var kindFitted = cleanFitted(src.kinds[k].fitted);
            if (Object.keys(kindFitted).length) a.kinds[k].fitted = kindFitted;
          }
        });
      }
      if (area.picks) {
        a.picks = Array.isArray(src.picks) ? area.picks.filter(function (p) { return src.picks.indexOf(p) !== -1; }) : [];
      }
      // "+ More": further parts in the same area, such as links as well as
      // coilovers.
      var moreFields = area.moreFields || area.fields;
      if (moreFields && Array.isArray(src.more)) {
        // Each part has its own when and where.
        var more = src.more.map(function (m) {
          var part = cleanModFields(m, moreFields);
          var partFitted = cleanFitted(m && m.fitted);
          if (Object.keys(part).length && Object.keys(partFitted).length) part.fitted = partFitted;
          return part;
        }).filter(function (m) { return Object.keys(m).length; }).slice(0, 10);
        if (more.length) a.more = more;
      }
      // Extra parts, one per line: any area can have them ("Also fitted"),
      // and Anything else is only these.
      var items = Array.isArray(src.items) ? src.items.map(function (i) { return cleanModText(i, 150); }).filter(Boolean).slice(0, 30) : [];
      if (items.length || area.items) a.items = items;
      if (id === 'wheels' && src.spacers && typeof src.spacers === 'object' && src.spacers.on) {
        a.spacers = cleanModFields(src.spacers, ['make', 'front', 'rear']);
        a.spacers.on = true;
        if (src.spacers.hub) a.spacers.hub = true;
      }
      var fitted = cleanFitted(src.fitted);
      if (Object.keys(fitted).length) a.fitted = fitted;
    }
    out[id] = a;
  });
  return out;
}

function cleanPlans(input) {
  if (!Array.isArray(input)) return [];
  return input.map(function (p) {
    if (!p || typeof p !== 'object') return null;
    var what = cleanModText(p.what, 150);
    if (!what) return null;
    var plan = { what: what };
    var area = cleanModText(p.area, 40);
    if (area) plan.area = area;
    var when = cleanModText(p.when, 40);
    if (when) plan.when = when;
    return plan;
  }).filter(Boolean).slice(0, 10);
}

function cleanCarModel(body) {
  var out = {};
  if (!body || typeof body !== 'object') return out;
  if (CAR_MODELS.indexOf(body.model) !== -1) out.model = body.model;
  var version = cleanModText(body.version, 40);
  if (version) out.version = version;
  var year = parseInt(body.year, 10);
  if (year >= 2008 && year <= new Date().getUTCFullYear() + 1) out.year = year;
  return out;
}

function joinParts(parts, sep) {
  return parts.filter(Boolean).join(sep || ', ');
}

// The public mods list: one readable line per upgrade. Never includes fitted
// dates, who fitted it, cost, notes or coilover settings, which only the
// owner sees.
function modLine(id, f, isMore) {
  f = f || {};
  if (id === 'wheels') {
    var size = f.sizeFront && f.sizeRear && f.sizeFront !== f.sizeRear
      ? f.sizeFront + ' front, ' + f.sizeRear + ' rear' : (f.sizeFront || f.sizeRear || '');
    return [['Wheels', joinParts([joinParts([f.make, f.model], ' '), size, f.width, f.offset, f.finish, f.type])]];
  }
  if (id === 'tyres') return [['Tyres', joinParts([joinParts([f.make, f.model], ' '), f.size])]];
  if (id === 'suspension') {
    var lines = [['Suspension', joinParts([joinParts([f.make, f.model, f.type ? f.type.toLowerCase() : ''], ' '), f.drop ? f.drop + ' drop' : ''])]];
    // Coilover settings, for road and track.
    ['road', 'track'].forEach(function (use) {
      function pair(kind) {
        var fr = f[use + kind + 'Front'], re = f[use + kind + 'Rear'];
        if (!fr && !re) return '';
        return kind.toLowerCase() + ' ' + joinParts([fr ? fr + ' front' : '', re ? re + ' rear' : '']);
      }
      lines.push(['Coilover settings (' + use + ')', joinParts([pair('Rebound'), pair('Compression')], '; ')]);
    });
    return lines;
  }
  if (id === 'brakes' && !isMore) {
    function set(c, d, p) {
      return joinParts([c ? c + ' calipers' : '', d ? d + ' discs' : '', p ? p + ' pads' : '']);
    }
    return [
      ['Brakes', set(f.calipers, f.discs, f.pads)],
      ['Front brakes', set(f.frontCalipers, f.frontDiscs, f.frontPads)],
      ['Rear brakes', set(f.rearCalipers, f.rearDiscs, f.rearPads)],
      ['Brake fluid and lines', f.fluid || '']
    ].filter(function (l) { return l[1]; });
  }
  if (id === 'brakes' || id === 'bodywork') return [[MOD_AREAS[id].label, joinParts([f.part, f.makeModel])]];
  return [[MOD_AREAS[id].label, joinParts([f.makeModel, f.details])]];
}

function specsToMods(specs) {
  var lines = [];
  var s = specs || {};
  function up(id) { return s[id] && s[id].status === 'up' ? s[id] : null; }
  function push(pairs) {
    pairs.forEach(function (l) { if (l[1]) lines.push(l[0] + ': ' + l[1]); });
    return pairs.some(function (l) { return l[1]; });
  }
  Object.keys(MOD_AREAS).forEach(function (id) {
    var a = up(id);
    if (!a) return;
    if (id === 'other') {
      (a.items || []).forEach(function (i) { lines.push(i); });
      return;
    }
    var said = false;
    if (id === 'bodywork') {
      var kinds = a.kinds || {};
      Object.keys(MOD_AREAS.bodywork.kinds).forEach(function (k) {
        if (!kinds[k]) return;
        said = true;
        var kf = kinds[k];
        var text;
        if (k === 'tint') text = joinParts([kf.front ? kf.front + ' front' : '', kf.rear ? kf.rear + ' rear' : '']);
        else if (k === 'wrap') text = joinParts([kf.make, kf.colour], ' ');
        else if (k === 'ppf') text = joinParts([joinParts([kf.make, kf.model], ' '), kf.coverage ? kf.coverage.toLowerCase() : '']);
        else if (k === 'aero') text = joinParts([kf.parts, joinParts([kf.make, kf.material ? kf.material.toLowerCase() : ''], ' ')]);
        else text = kf.what || '';
        lines.push(MOD_KIND_LABELS[k] + prefixed(text));
      });
    } else {
      var main = modLine(id, a.fields);
      if (MOD_AREAS[id].picks && (a.picks || []).length) {
        main = [[MOD_AREAS[id].label, joinParts([a.picks.join(', '), main[0][1]])]];
      }
      said = push(main);
    }
    if (id === 'wheels' && a.spacers && a.spacers.on) {
      var sp = a.spacers;
      lines.push('Spacers: ' + joinParts([sp.make, sp.front ? sp.front + ' front' : '', sp.rear ? sp.rear + ' rear' : '', sp.hub ? 'hub-centric' : '']));
      said = true;
    }
    (a.more || []).forEach(function (m) { if (push(modLine(id, m, true))) said = true; });
    (a.items || []).forEach(function (i) { lines.push(i); said = true; });
    // Upgraded with nothing filled in yet: just the area.
    if (!said) lines.push(MOD_AREAS[id].label);
  });
  return lines.map(function (l) { return l.slice(0, 150); }).slice(0, 50);
}

// A car's mods for display (My Garage and the Gallery's Full mods list):
// each area with its parts, worded as the public list. meta (when it was
// fitted, by whom, cost) only when owner is true.
var MOD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fittedMeta(f) {
  if (!f) return '';
  var when = f.year ? 'Fitted ' + (f.month ? MOD_MONTHS[f.month - 1] + ' ' : '') + f.year : '';
  var cost = f.cost ? (/^[£$€]/.test(f.cost) ? f.cost : '£' + f.cost) : '';
  return joinParts([when, f.by, cost], ' · ');
}

function coilSettings(f) {
  var out = null;
  ['road', 'track'].forEach(function (use) {
    var row = {};
    ['ReboundFront', 'ReboundRear', 'CompressionFront', 'CompressionRear'].forEach(function (k) {
      if (f[use + k]) row[k.charAt(0).toLowerCase() + k.slice(1)] = f[use + k];
    });
    if (Object.keys(row).length) { out = out || {}; out[use] = row; }
  });
  return out;
}

function specsToView(specs, owner, flatMods) {
  var s = specs || {};
  if (!specs) {
    // Older cars with a plain list of mods.
    var lines = (flatMods || []).filter(Boolean);
    return lines.length ? [{ id: 'mods', label: 'Mods', status: 'up', parts: lines.map(function (l) { return { what: l }; }) }] : [];
  }
  var KIND_OF = { 'Front brakes': 'Front', 'Rear brakes': 'Rear', 'Brake fluid and lines': 'Fluid and lines' };
  return Object.keys(MOD_AREAS).map(function (id) {
    var a = s[id];
    var status = a && (a.status === 'up' || a.status === 'stock') ? a.status : 'todo';
    var area = { id: id, label: MOD_AREAS[id].label, status: status, parts: [] };
    if (status !== 'up') return area;
    function add(part, fitted) {
      if (owner) { var m = fittedMeta(fitted); if (m) part.meta = m; }
      area.parts.push(part);
    }
    if (id === 'bodywork') {
      var kinds = a.kinds || {};
      Object.keys(MOD_AREAS.bodywork.kinds).forEach(function (k) {
        if (!kinds[k]) return;
        var line = specsToMods({ bodywork: { status: 'up', kinds: (function () { var o = {}; o[k] = kinds[k]; return o; })() } })[0] || '';
        var text = line.indexOf(': ') !== -1 ? line.slice(line.indexOf(': ') + 2) : '';
        if (!text && !owner) return;
        var part = { kind: MOD_KIND_LABELS[k], what: text };
        if (!text) part.empty = true;
        add(part, kinds[k].fitted);
      });
    } else if (id !== 'other') {
      var main = modLine(id, a.fields);
      if (MOD_AREAS[id].picks && (a.picks || []).length) main = [[MOD_AREAS[id].label, joinParts([a.picks.join(', '), main[0][1]])]];
      var first = true;
      main.forEach(function (l) {
        // Coilover settings go in the part's table instead.
        if (!l[1] || /^Coilover settings/.test(l[0])) return;
        var part = { what: l[1] };
        if (KIND_OF[l[0]]) part.kind = KIND_OF[l[0]];
        if (id === 'suspension') { var cs = coilSettings(a.fields || {}); if (cs) part.settings = cs; }
        add(part, first ? a.fitted : null);
        first = false;
      });
      if (id === 'wheels' && a.spacers && a.spacers.on) {
        var sp = a.spacers;
        add({ kind: 'Spacers', what: joinParts([sp.make, sp.front ? sp.front + ' front' : '', sp.rear ? sp.rear + ' rear' : '', sp.hub ? 'hub-centric' : '']) });
      }
    }
    (a.more || []).forEach(function (m) {
      var l = modLine(id, m, true)[0];
      if (!l || !l[1]) return;
      var part = { what: l[1] };
      if (id === 'suspension') { var cs = coilSettings(m); if (cs) part.settings = cs; }
      add(part, m.fitted);
    });
    (a.items || []).forEach(function (i) { add({ what: i }); });
    return area;
  });
}

function prefixed(text) {
  return text ? ': ' + text : '';
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
  if (!sidecar.email && !sidecar.owner && ownerEmail) sidecar.email = ownerEmail;
  await putSidecar(env, sidecarKey, sidecar);
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
  await putSidecar(env, sidecarKey, sidecar);
}

// A photo's owner. Each photo has a small settings file (its "sidecar",
// gallery/<photo>.json) in the photo bucket, which is served publicly, so the
// owner's email is kept in KV instead and the sidecar holds only the one-way
// ownerKey() as `owner`. Older sidecars still carry `email` until
// moveSidecarEmails() has been through them.
function photoOwnerKey(file) {
  return 'photo-owner:' + file;
}

// The only way a sidecar is written: moves any email into KV first.
async function putSidecar(env, sidecarKey, sidecar) {
  var out = Object.assign({}, sidecar);
  if (typeof out.email === 'string' && out.email) {
    var file = sidecarKey.replace(/^gallery\//, '').replace(/\.json$/, '');
    var email = out.email.trim().toLowerCase();
    await env.VOTES.put(photoOwnerKey(file), email);
    out.owner = await ownerKey(email);
  }
  delete out.email;
  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(out, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
}

async function sidecarOwnerEmail(env, file, sidecar) {
  if (sidecar && typeof sidecar.email === 'string' && sidecar.email) return sidecar.email;
  if (sidecar && !sidecar.owner) return null;
  return (await env.VOTES.get(photoOwnerKey(file))) || null;
}

async function clearPhotoOwner(env, file, sidecar) {
  delete sidecar.email;
  delete sidecar.owner;
  await env.VOTES.delete(photoOwnerKey(file));
}

// One-off: takes the emails out of every existing sidecar and car record.
// Runs from scheduled() a batch at a time until done (a KV flag), so it
// never runs on a visitor's request.
var SIDECAR_EMAIL_MOVE_FLAG = 'migrated:sidecar-emails-v1';
var SIDECAR_EMAIL_MOVE_BATCH = 200;
async function moveSidecarEmails(env) {
  if (await env.VOTES.get(SIDECAR_EMAIL_MOVE_FLAG)) return { done: true, moved: 0 };
  var cursor = (await env.VOTES.get(SIDECAR_EMAIL_MOVE_FLAG + ':cursor')) || undefined;
  var listing = await env.GALLERY_BUCKET.list({ prefix: 'gallery/', cursor: cursor, limit: SIDECAR_EMAIL_MOVE_BATCH });
  var moved = 0;
  for (var i = 0; i < listing.objects.length; i++) {
    var key = listing.objects[i].key;
    if (!/\.json$/.test(key)) continue;
    var data;
    try {
      var obj = await env.GALLERY_BUCKET.get(key);
      if (!obj) continue;
      data = await obj.json();
    } catch (e) { continue; }
    if (!data || typeof data !== 'object' || !('email' in data)) continue;
    if (key.indexOf('gallery/cars/') === 0) await saveCarRecord(env, data);
    else await putSidecar(env, key, data);
    moved++;
  }
  if (listing.truncated && listing.cursor) {
    await env.VOTES.put(SIDECAR_EMAIL_MOVE_FLAG + ':cursor', listing.cursor);
    return { done: false, moved: moved };
  }
  await env.VOTES.put(SIDECAR_EMAIL_MOVE_FLAG, new Date().toISOString());
  await env.VOTES.delete(SIDECAR_EMAIL_MOVE_FLAG + ':cursor');
  if (moved) await triggerManifestRebuild(env);
  return { done: true, moved: moved };
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
  await putSidecar(env, sidecarKey, sidecar);
}

// Members' first and last names, one KV key per member (read with a single
// get, never list()). Set from the first-build form when the member has no
// name yet, and changed only from a signed-in My Garage session, so a
// public form can't rename someone else.
function cleanNamePart(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 50);
}

async function getProfile(env, email) {
  if (!email) return null;
  try {
    var raw = await env.VOTES.get('profile:' + email);
    var parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.firstName && parsed.lastName ? parsed : null;
  } catch (e) {
    return null;
  }
}

function profileFullName(profile) {
  return profile ? profile.firstName + ' ' + profile.lastName : '';
}

// Keeps the rest of the record (nickname, email choice and so on).
async function saveProfile(env, email, firstName, lastName) {
  var profile = await getProfileRecord(env, email);
  profile.firstName = firstName;
  profile.lastName = lastName;
  await putProfileRecord(env, email, profile);
  if (profile.nickname) await syncMemberName(env, email);
  return profile;
}

// "ri•••@gmail.com": the repo and its issues are public, so emails there
// are masked.
function maskEmail(email) {
  var at = String(email || '').indexOf('@');
  if (at < 1) return '';
  return email.slice(0, Math.min(2, at)) + '\u2022\u2022\u2022' + email.slice(at);
}

// "First Last (ri•••@gmail.com)" for GitHub issues, which are public.
function publicLabel(name, email) {
  var masked = maskEmail(email);
  if (name && masked) return name + ' (' + masked + ')';
  return name || masked || 'Anonymous';
}

// "First Last (email)" for admin-only emails and records.
function subscriberLabel(name, email) {
  if (name && email) return name + ' (' + email + ')';
  return name || email || 'Anonymous';
}

async function setSidecarName(env, file, name) {
  var sidecarKey = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var existingObj = await env.GALLERY_BUCKET.get(sidecarKey);
    if (existingObj) sidecar = await existingObj.json();
  } catch (e) {}
  if (sidecar.name === name) return;
  sidecar.name = name;
  await putSidecar(env, sidecarKey, sidecar);
}

// Saves the signed-in member's name and puts it on all their photos, so
// the gallery, reel and share pages show "By First Last".
async function handleMyBuildsProfileUpdate(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var firstName = cleanNamePart(body && body.firstName);
  var lastName = cleanNamePart(body && body.lastName);
  if (!firstName || !lastName) {
    return json({ success: false, message: 'Please enter your first and last name' }, 400);
  }
  await saveProfileEverywhere(env, email, firstName, lastName);
  return json({ success: true, firstName: firstName, lastName: lastName });
}

// Saves a member's name and puts it on all their photos, then rebuilds the
// gallery manifest so the site shows it.
async function saveProfileEverywhere(env, email, firstName, lastName) {
  var profile = await saveProfile(env, email, firstName, lastName);
  await refreshPublicNameEverywhere(env, email, profile);
  return profile;
}

// Puts the member's public name (nickname, or first and last name) on all
// their photos and rebuilds the gallery manifest.
async function refreshPublicNameEverywhere(env, email, profile) {
  var name = publicName(profile || await getProfileRecord(env, email));
  if (!name) return;
  // Every photo the member owns: their saved list, plus any whose sidecar
  // names them but that dropped out of it (only when their name changes).
  var files = await getSubscriberFiles(env, email);
  var owned = await listGalleryEntriesFromR2(env).catch(function () { return []; });
  var myOwner = await ownerKey(email);
  owned.forEach(function (p) { if (p.owner === myOwner && files.indexOf(p.file) === -1) files.push(p.file); });
  await Promise.all(files.map(function (f) { return setSidecarName(env, f, name); }));
  if (files.length) await triggerManifestRebuild(env);
}

// Admin: set or change a member's name, e.g. for members from before names
// were collected.
async function handleGalleryAdminSubscriberName(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var email = ((body && body.email) || '').toString().trim().toLowerCase();
  var firstName = cleanNamePart(body && body.firstName);
  var lastName = cleanNamePart(body && body.lastName);
  if (!email) return json({ success: false, message: 'email is required' }, 400);
  if (!firstName || !lastName) return json({ success: false, message: 'Please enter a first and last name' }, 400);
  if ((await env.VOTES.get('subscriber:' + email)) === null) {
    return json({ success: false, message: 'Subscriber not found' }, 404);
  }
  await saveProfileEverywhere(env, email, firstName, lastName);
  return json({ success: true, firstName: firstName, lastName: lastName });
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
  await putSidecar(env, sidecarKey, sidecar);
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

// Starts the device checks on GitHub from the Device Checks page
// (device-checklist.html). Admin only. Only known devices, checks and pages
// are passed on, and the "Run Playwright tests" workflow does the rest.
var RUN_TEST_DEVICES = ['site', 'iphone', 'ipad', 'android', 'desktop-chrome', 'desktop-firefox'];
var RUN_TEST_CHECKS = ['pages', 'likes', 'gallery', 'garage'];
var RUN_TEST_PAGES = ['index', 'gallery', 'my-builds', 'shop', 'reviews', 'contact', 'track-day-on-the-day',
  'track-day-prep', 'track-day-venues', 'blog', 'blog-aaron', 'blog-mark', 'blog-myk-track-day', 'blog-myk',
  'blog-richard', 'blog-richie'];
var RUN_TEST_NAMES = { site: 'Site checks', iphone: 'iPhone', ipad: 'iPad', android: 'Android',
  'desktop-chrome': 'Desktop Chrome', 'desktop-firefox': 'Desktop Firefox' };

async function handleRunTests(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  function pick(list, allowed) {
    return (Array.isArray(list) ? list : []).filter(function (v, i, arr) {
      return allowed.indexOf(v) !== -1 && arr.indexOf(v) === i;
    });
  }
  var devices = pick(body && body.devices, RUN_TEST_DEVICES);
  var checks = pick(body && body.checks, RUN_TEST_CHECKS);
  var pages = pick(body && body.pages, RUN_TEST_PAGES);
  if (!devices.length) return json({ success: false, message: 'Choose at least one device.' }, 400);
  var label = devices.map(function (d) { return RUN_TEST_NAMES[d]; }).join(', ') +
    (checks.length ? ' | ' + checks.join(', ') : '') + (pages.length ? ' | ' + pages.join(', ') : '');
  var res = await fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/dispatches', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'mt3uk-gallery-worker',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ event_type: 'device-tests', client_payload: { devices: devices, checks: checks, pages: pages, label: label } })
  });
  if (!res.ok) {
    return json({ success: false, message: 'GitHub did not accept the request (' + res.status + ').' }, 502);
  }
  return json({ success: true, label: label, requestedAt: new Date().toISOString() });
}

async function triggerManifestRebuild(env, eventType) {
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
        body: JSON.stringify({ event_type: eventType || 'gallery-submission' })
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

  if (await hasMemberAccess(env, email)) {
    await issueSignInLink(env, email, 'my-builds.html', false);
  }

  // Always return the same message, whether or not that email is a member,
  // so this endpoint can't be used to check who has joined.
  return json({ success: true, message: "If that email belongs to an MT3UK member, we've sent a sign-in link and code. New here? Join free instead." });
}

// Members are anyone with a subscriber record (with or without builds, as
// people can join just to like and comment), plus anyone who has commented
// and had a reply, so they have somewhere to read that notification.
async function hasMemberAccess(env, email) {
  if ((await env.VOTES.get('subscriber:' + email)) !== null) return true;
  var notifications = await getNotifications(env, email);
  return notifications.length > 0;
}

// Emails a one-time sign-in link to `page`, plus a 6-digit code for the
// Home Screen app on iPhone: it keeps its own sign-in, separate from
// Safari, and links in emails always open in Safari, so the code is typed
// into the app instead.
async function issueSignInLink(env, email, page, joining) {
  var token = randomToken();
  await env.VOTES.put('my-builds-link:' + token, email, { expirationTtl: MY_BUILDS_LINK_TTL_SECONDS });
  var link = MY_BUILDS_SITE_URL + '/' + page + '?token=' + token;
  var code = signInCode();
  var codeExpires = Math.floor(Date.now() / 1000) + MY_BUILDS_LINK_TTL_SECONDS;
  await env.VOTES.put(signInCodeKey(email), JSON.stringify({ code: code, token: token, tries: 0 }), {
    expiration: codeExpires,
    metadata: { expires: codeExpires }
  });
  try {
    if (joining) await sendJoinEmail(env, email, link, code);
    else await sendMyBuildsLinkEmail(env, email, link, null, code);
  } catch (err) {
    console.log('Sign-in link email failed:', err.message);
  }
}

// ---------- Join (no photos needed) ----------
// signin.html lets anyone join free with their name and email, so they can
// like and comment without adding a car. The account is only created once
// they use the emailed link or code (completePendingJoin), so nothing is
// kept for addresses nobody confirms. A hidden bot field, a one-minute wait
// per email and a per-connection hourly limit stop it being used to send
// lots of emails.

var PENDING_JOIN_TTL_SECONDS = 24 * 60 * 60;
var JOIN_LIMIT_PER_IP_PER_HOUR = 10;

async function handleMyBuildsJoin(request, env) {
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var reply = json({ success: true, message: "Check your email for a link and a 6-digit code to finish joining. If you're already a member, we've sent a sign-in link instead." });
  if (body && body.botcheck) return reply;

  var email = ((body && body.email) || '').toString().trim().toLowerCase().slice(0, 200);
  var firstName = cleanNamePart(body && body.firstName);
  var lastName = cleanNamePart(body && body.lastName);
  if (!firstName || !lastName) return json({ success: false, message: 'Please enter your first and last name' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ success: false, message: 'Please enter a valid email' }, 400);

  var ipKey = 'join-ip:' + getClientIp(request);
  var ipCount = parseInt(await env.VOTES.get(ipKey), 10) || 0;
  if (ipCount >= JOIN_LIMIT_PER_IP_PER_HOUR) {
    return json({ success: false, message: 'Too many attempts, please try again in an hour.' }, 429);
  }
  var cooldownKey = 'join-cooldown:' + email;
  if ((await env.VOTES.get(cooldownKey)) !== null) return reply;
  await env.VOTES.put(ipKey, String(ipCount + 1), { expirationTtl: 3600 });
  await env.VOTES.put(cooldownKey, '1', { expirationTtl: 60 });

  if (await hasMemberAccess(env, email)) {
    await issueSignInLink(env, email, 'my-builds.html', false);
    return reply;
  }
  await env.VOTES.put('pending-join:' + email, JSON.stringify({ firstName: firstName, lastName: lastName }), { expirationTtl: PENDING_JOIN_TTL_SECONDS });
  await issueSignInLink(env, email, 'signin.html', true);
  return reply;
}

// Turns a confirmed join into a member (no builds yet) with their name.
async function completePendingJoin(env, email) {
  var raw = await env.VOTES.get('pending-join:' + email);
  if (!raw) return;
  await env.VOTES.delete('pending-join:' + email);
  if ((await env.VOTES.get('subscriber:' + email)) !== null) return;
  var pending = {};
  try { pending = JSON.parse(raw) || {}; } catch (e) {}
  await env.VOTES.put('subscriber:' + email, JSON.stringify([]));
  await markSubscriberSince(env, email);
  var first = cleanNamePart(pending.firstName);
  var last = cleanNamePart(pending.lastName);
  if (first && last && !(await getProfile(env, email))) await saveProfile(env, email, first, last);
}

async function sendJoinEmail(env, toEmail, link, code) {
  var subject = 'Welcome to MT3UK: your code is ' + code;
  var body = 'Thanks for joining MT3UK. Click the link below to finish joining, and you can like and comment on member builds and owner interviews:\n\n' + link +
    '\n\nOr enter this code on the Sign Up / Sign In page:\n\n' + code +
    '\n\nWant to show off your car too? Add it any time in My Garage, it\'s optional.' +
    '\n\nThis link and code expire in 15 minutes and can only be used once. If you did not ask to join, you can ignore this email.';
  var message = new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body));
  await env.SEND_EMAIL.send(message);
}

var MAX_SIGN_IN_CODE_TRIES = 5;

function signInCodeKey(email) {
  return 'my-builds-code:' + email;
}

function signInCode() {
  var n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return ('00000' + n).slice(-6);
}

// Signs in with the 6-digit code from the sign-in email. Each code allows a
// few wrong guesses before it is thrown away, and using it also uses up the
// matching link.
async function handleMyBuildsVerifyCode(request, env) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  var email = ((body && body.email) || '').toString().trim().toLowerCase().slice(0, 200);
  var code = ((body && body.code) || '').toString().replace(/\D/g, '');
  var failed = json({ success: false, message: 'That code is not right or has expired. Check the latest email, or send a new code.' }, 400);
  if (!email || code.length !== 6) return failed;

  var key = signInCodeKey(email);
  var meta = await env.VOTES.getWithMetadata(key);
  var record = null;
  try { record = meta.value ? JSON.parse(meta.value) : null; } catch (e) { record = null; }
  if (!record) return failed;

  if (record.code !== code) {
    record.tries = (record.tries || 0) + 1;
    if (record.tries >= MAX_SIGN_IN_CODE_TRIES) {
      await env.VOTES.delete(key);
    } else {
      // Keep the code's original expiry, rather than restarting it.
      var expires = (meta.metadata && meta.metadata.expires) || 0;
      var now = Math.floor(Date.now() / 1000);
      if (expires < now + 60) {
        await env.VOTES.delete(key);
      } else {
        await env.VOTES.put(key, JSON.stringify(record), { expiration: expires, metadata: { expires: expires } });
      }
    }
    return failed;
  }

  await env.VOTES.delete(key);
  if (record.token) await env.VOTES.delete('my-builds-link:' + record.token);
  await completePendingJoin(env, email);
  var session = await createSession(env, email);
  return json({ success: true, session: session, email: email });
}

async function handleMyBuildsSession(request, env) {
  var token = new URL(request.url).searchParams.get('token') || '';
  var email = token ? await env.VOTES.get('my-builds-link:' + token) : null;
  if (!email) {
    return json({ success: false, message: 'That link is invalid or has expired.' }, 400);
  }
  await env.VOTES.delete('my-builds-link:' + token);
  // The link has been used, so its matching code can't be.
  await env.VOTES.delete(signInCodeKey(email));
  await completePendingJoin(env, email);

  var session = await createSession(env, email);

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
      manifest = await listGalleryEntriesFromR2(env);
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
  var garageOwner = await ownerKey(email);
  if (manifestOk) {
    var fileSet = {};
    files.forEach(function (f) { fileSet[f] = true; });
    manifest.forEach(function (p) {
      if (p.owner && p.owner === garageOwner && !fileSet[p.file]) {
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

  // Photos showing an old name (from before a nickname or Visibility
  // change reached them) get the member's current name. Only happens when
  // something is out of date, then the gallery is rebuilt.
  var shownAs = publicName(await getProfileRecord(env, email));
  if (manifestOk && shownAs) {
    var stale = entries.filter(function (entry) { return entry.name !== shownAs; });
    if (stale.length) {
      await Promise.all(stale.map(function (entry) {
        entry.name = shownAs;
        return setSidecarName(env, entry.file, shownAs);
      }));
      await triggerManifestRebuild(env).catch(function () {});
    }
  }

  // The member's one entry in this week's Build of the Week vote, and its
  // votes so far, for the warning shown before they switch entry.
  var voteWeek = voteWeekString(new Date());
  var entryPhoto = manifestOk ? memberVoteEntry(manifest, voteWeek, await ownerKey(email)) : null;
  var voteEntry = null;
  if (entryPhoto) {
    voteEntry = {
      file: entryPhoto.file,
      caption: entryPhoto.caption || '',
      votes: parseInt((await env.VOTES.get('votes:' + voteWeek + ':' + entryPhoto.file)) || '0', 10) || 0
    };
  }
  var records = {};
  await Promise.all(groups.map(async function (g) {
    if (!g.virtual) records[g.id] = await getCarRecord(env, g.id);
  }));
  groups.forEach(function (g) {
    var record = records[g.id];
    if (record && Array.isArray(record.photos) && record.photos.length) {
      // Respect the owner's saved/drag-reordered order; any photo not yet
      // in the saved order (e.g. just uploaded) goes first, newest first.
      var byFileMap = {};
      g.entries.forEach(function (entry) { byFileMap[entry.file] = entry; });
      var seen = {};
      var ordered = record.photos.map(function (f) { return byFileMap[f]; }).filter(Boolean);
      ordered.forEach(function (entry) { seen[entry.file] = true; });
      var rest = g.entries.filter(function (entry) { return !seen[entry.file]; })
        .sort(function (a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); });
      g.entries = rest.concat(ordered);
    } else {
      // Newest photo first within a car, so a photo just added is at the
      // top of its list.
      g.entries.sort(function (a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); });
    }
  });
  // Cars stay in the order they were first added (by their oldest photo),
  // so adding a photo doesn't reshuffle the garage.
  function firstAdded(g) {
    return g.entries.reduce(function (min, e) { return Math.min(min, e.uploadedAt || 0); }, Infinity);
  }
  groups.sort(function (a, b) { return firstAdded(a) - firstAdded(b); });

  var cars = await Promise.all(groups.map(async function (g) {
    var record = records[g.id];
    var photos = await Promise.all(g.entries.map(async function (entry) {
      var comments = await getComments(env, entry.file);
      var visibleComments = comments.filter(function (c) { return !c.hidden; });
      var likeCount = parseInt((await env.VOTES.get('likes:' + entry.file)) || '0', 10) || 0;
      return {
        file: entry.file,
        caption: entry.caption || '',
        mods: entry.mods || [],
        gallery: entry.gallery !== false,
        reel: entry.reel !== false,
        votable: entry.votable !== false,
        inVote: !!(voteEntry && voteEntry.file === entry.file),
        added: entry.added || '',
        voteBlocked: !!entry.voteBlocked,
        commentCount: visibleComments.length,
        likeCount: likeCount
      };
    }));
    // A car without a saved record takes its details from its first photo.
    var first = g.entries.reduce(function (o, e) { return (e.uploadedAt || 0) < (o.uploadedAt || 0) ? e : o; }, g.entries[0]);
    var mods = record && Array.isArray(record.mods) ? record.mods : (first.mods || []);
    var color = record && record.color ? record.color : (first.color || '');
    var name = record ? record.name : (first.caption || 'MT3UK member build');
    var createdAt = record ? record.createdAt : new Date(first.uploadedAt || Date.now()).toISOString();
    // The model and mods list (with its owner-only dates and costs) come
    // back only here, to the owner.
    var details = g.virtual ? null : await getCarDetails(env, g.id);
    return {
      id: g.id,
      virtual: !!g.virtual,
      name: name,
      mods: mods,
      color: color,
      model: (details && details.model) || '',
      version: (details && details.version) || '',
      year: (details && details.year) || '',
      specs: (details && details.specs) || null,
      plans: (details && details.plans) || [],
      view: specsToView(details && details.specs, true, mods),
      createdAt: createdAt,
      commentCount: photos.reduce(function (sum, p) { return sum + p.commentCount; }, 0),
      likeCount: photos.reduce(function (sum, p) { return sum + p.likeCount; }, 0),
      photos: photos
    };
  }));

  var profile = await getProfile(env, email);
  return json({
    success: true,
    email: email,
    firstName: profile ? profile.firstName : '',
    lastName: profile ? profile.lastName : '',
    // The name on their builds, comments and likes (nickname, or full name
    // if they chose that in Profile, Visibility).
    shownAs: shownAs || '',
    cars: cars,
    voteEntry: voteEntry
  });
}

// Takes a member's photo out of this week's vote: voting off, and its votes
// this week removed so it can't still win the tally.
async function withdrawVoteEntry(env, file, weekStr) {
  var key = 'gallery/' + file + '.json';
  var sidecar = {};
  try {
    var obj = await env.GALLERY_BUCKET.get(key);
    if (obj) sidecar = await obj.json();
  } catch (e) {}
  sidecar.votable = false;
  await putSidecar(env, key, sidecar);
  await env.VOTES.delete('votes:' + weekStr + ':' + file);
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

  // Voting on means "this is my entry in this week's Build of the Week
  // vote". Each member has one entry: entering a photo takes their other
  // entry out (losing its votes this week, which My Garage warns about
  // first). A photo entered from outside this week's window is stamped
  // with today's date so it counts as entered this week.
  var voteWeek = voteWeekString(new Date());
  var wasVotable = sidecar.votable !== false;
  var withdraw = [];
  var clearVotes = false;
  // My Garage's Voting tick sends vote: 'enter' or 'leave' (after warning
  // the member about lost votes). A plain votable true/false, as the Edit
  // Build pop-up used to send, only sets the flag and never switches the
  // member's entry, so saving other changes can't cost them their votes.
  var voteAction = body && (body.vote === 'enter' || body.vote === 'leave') ? body.vote : null;
  if (!voteAction && body && body.votable === false && wasVotable) voteAction = 'leave';
  if (voteAction === 'enter' && sidecar.voteBlocked === true) {
    return json({ success: false, message: 'This photo was taken out of voting by MT3UK. You can enter a different photo instead.' }, 403);
  }
  if (voteAction === 'enter') {
    var voteManifest = await listGalleryEntriesFromR2(env);
    var owner = await ownerKey(email);
    var thisPhoto = voteManifest.filter(function (p) { return p.file === file; })[0];
    withdraw = voteManifest.filter(function (p) {
      return p.owner === owner && p.file !== file && isOpenForVote(p, voteWeek);
    }).map(function (p) { return p.file; });
    if (!thisPhoto || !isOpenForVote(thisPhoto, voteWeek)) sidecar.votableSince = ukDateString(new Date());
    delete sidecar.votable;
  } else if (voteAction === 'leave') {
    sidecar.votable = false;
    clearVotes = true;
  }
  ['gallery', 'reel'].forEach(function (flag) {
    if (typeof (body && body[flag]) === 'boolean') {
      if (body[flag] === false) {
        sidecar[flag] = false;
      } else {
        delete sidecar[flag];
      }
    }
  });
  // A plain votable: true only turns the flag back on (no entry switching).
  if (!voteAction && body && body.votable === true && !wasVotable && sidecar.voteBlocked !== true) {
    delete sidecar.votable;
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

  await putSidecar(env, sidecarKey, sidecar);
  await Promise.all(withdraw.map(function (f) { return withdrawVoteEntry(env, f, voteWeek); }));
  if (clearVotes) await env.VOTES.delete('votes:' + voteWeek + ':' + file);

  await triggerManifestRebuild(env);

  return json({ success: true, file: file, withdrawn: withdraw });
}

// A car's mods for other members (the Gallery's Full mods list): found from
// one of its photos. Public parts only, never dates, fitters or costs.
async function handleCarPublic(request, env) {
  var url = new URL(request.url);
  var file = String(url.searchParams.get('file') || '');
  if (!file || file.indexOf('/') !== -1 || file.length > 200) return json({ success: false, message: 'file is required' }, 400);
  var sidecar = null;
  try {
    var obj = await env.GALLERY_BUCKET.get('gallery/' + file + '.json');
    if (obj) sidecar = await obj.json();
  } catch (e) {}
  if (!sidecar) return json({ success: false, message: 'Not found' }, 404);
  var ownerEmail = await sidecarOwnerEmail(env, file, sidecar);
  var ownerProfile = ownerEmail ? await getProfileRecord(env, ownerEmail) : null;
  var out = { success: true, file: file, name: '', model: '', version: '', year: '', ownerName: '', ownerId: '', canAsk: false, view: [] };
  var record = sidecar.carId ? await getCarRecord(env, sidecar.carId) : null;
  var details = sidecar.carId ? await getCarDetails(env, sidecar.carId) : null;
  out.name = (record && record.name) || '';
  if (details) {
    out.model = details.model || '';
    out.version = details.version || '';
    out.year = details.year || '';
  }
  var flat = (record && record.mods) || (Array.isArray(sidecar.mods) ? sidecar.mods : []);
  out.view = specsToView(details && details.specs, false, flat);
  if (sidecar.carId) {
    out.carId = sidecar.carId;
    out.track = await trackBestsForCar(env, sidecar.carId);
  }
  if (ownerEmail) {
    out.ownerName = publicName(ownerProfile) || 'MT3UK member';
    out.ownerId = await ownerKey(ownerEmail);
    out.canAsk = !ownerProfile.modQuestionsOff && !ownerProfile.dmBlocked;
    // Signed in: whether it's their own car (no asking yourself).
    var viewer = request.headers.get('X-Session-Token') ? await resolveSession(request, env) : null;
    if (viewer && viewer === ownerEmail) out.mine = true;
  }
  var res = json(out);
  res.headers.set('Cache-Control', 'private, max-age=60');
  return res;
}

// ---------- Track sessions (track.html, js/track-parse.js) ----------
// A member's track days and drag runs. The file is read in the browser and
// only the laps, summary and a trimmed trace come here. Everything is in KV
// under single keys read with get(), never list():
//   track-session:<id>          one session (private unless shared), gzipped
//   track-source:<id>           that session's readings, gzipped, for the owner only (changing its type)
//   track-index:<ownerKey>      that member's session summaries
//   track-public:<carId>        the car's shared session summaries
//   track-board:<venue>:<layout> / drag-board:<venue>   best per car
//   track-library               the admin's tracks, over data/tracks.json
//   track-requests              "new track" requests for the admin
var TRACKS_URL = MY_BUILDS_SITE_URL + '/data/tracks.json';
var TRACK_SESSION_MAX_BYTES = 1500000;
// Sessions are stored gzipped (about 60% smaller). The page sends them
// gzipped too; TRACK_SESSION_MAX_BYTES is the most it may send or that may be
// stored, and a session may be at most this big once unzipped.
var TRACK_UNZIPPED_MAX_BYTES = 6000000;
// The readings kept with a session so its type can be changed later.
var TRACK_SOURCE_MAX_BYTES = 6000000;
var TRACK_SOURCE_UNZIPPED_MAX_BYTES = 22000000;

async function gzipText(text) {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

// Unzips, stopping (and throwing) once past max bytes.
async function gunzipText(data, max) {
  var reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  var chunks = [], n = 0;
  for (;;) {
    var r = await reader.read();
    if (r.done) break;
    n += r.value.length;
    if (n > max) { await reader.cancel(); throw new Error('too big'); }
    chunks.push(r.value);
  }
  var out = new Uint8Array(n), o = 0;
  chunks.forEach(function (c) { out.set(c, o); o += c.length; });
  return new TextDecoder().decode(out);
}

function isGzip(buf) {
  var b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  return b.length === 2 && b[0] === 0x1f && b[1] === 0x8b;
}

// Sessions saved before compression are plain JSON; newer ones gzipped.
async function getTrackSession(env, id) {
  try {
    var buf = await env.VOTES.get('track-session:' + id, 'arrayBuffer');
    if (!buf) return null;
    return JSON.parse(isGzip(buf) ? await gunzipText(buf, TRACK_UNZIPPED_MAX_BYTES) : new TextDecoder().decode(buf));
  } catch (e) {
    return null;
  }
}

async function putTrackSession(env, rec) {
  var gz = await gzipText(JSON.stringify(rec));
  if (gz.byteLength > TRACK_SESSION_MAX_BYTES) return false;
  await env.VOTES.put('track-session:' + rec.id, gz);
  return true;
}
var TRACK_PRIVACY = ['private', 'build', 'board'];
var TRACK_CONDITIONS = ['Dry', 'Damp', 'Wet'];
var TRACK_BOARD_MAX = 300;

function trackText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80);
}
function trackNum(v, lo, hi) {
  // Left blank is blank, not 0.
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
  var n = Number(v);
  return isFinite(n) && n >= lo && n <= hi ? n : null;
}
function trackId(v) {
  var s = String(v || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s;
}
function trackDist(a, b) {
  var R = 6371000, d1 = (b[0] - a[0]) * Math.PI / 180, d2 = (b[1] - a[1]) * Math.PI / 180;
  var h = Math.sin(d1 / 2) * Math.sin(d1 / 2) + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(d2 / 2) * Math.sin(d2 / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function trackLine(v) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  var out = v.map(function (p) { return Array.isArray(p) ? [trackNum(p[0], -90, 90), trackNum(p[1], -180, 180)] : [null, null]; });
  return out.every(function (p) { return p[0] !== null && p[1] !== null; }) ? out : null;
}

// The site's track list with the admin's changes on top.
async function getTrackLibrary(env) {
  var base = { venues: [] };
  try {
    var res = await fetch(TRACKS_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (res.ok) base = await res.json();
  } catch (e) {}
  var extra = await getJsonKey(env, 'track-library', { venues: [] });
  var list = (base.venues || []).slice();
  (extra.venues || []).forEach(function (v) {
    var i = list.findIndex(function (x) { return x.id === v.id; });
    if (v.removed) { if (i !== -1) list.splice(i, 1); return; }
    if (i === -1) list.push(v); else list[i] = v;
  });
  return { venues: list };
}

function cleanTrackVenue(v) {
  if (!v || typeof v !== 'object') return null;
  var id = trackId(v.id || v.name);
  var name = trackText(v.name, 60);
  var lat = trackNum(v.lat, -90, 90), lng = trackNum(v.lng, -180, 180);
  if (!id || !name || lat === null || lng === null) return null;
  var out = { id: id, name: name, type: ['drag', 'sprint'].indexOf(v.type) !== -1 ? v.type : 'circuit', lat: lat, lng: lng, radius: trackNum(v.radius, 200, 10000) || 2000 };
  if (v.check) out.check = true;
  // Added by a member from the Add a session page, live straight away and waiting for the admin's review.
  if (v.review) out.review = true;
  // A sprint-type venue that is a hill climb: the leaderboards list those on their own.
  if (out.type === 'sprint' && v.hill) out.hill = true;
  // Circuits have layouts; sprints and hill climbs have courses, each with
  // a separate finish line.
  if (out.type === 'circuit' || out.type === 'sprint') {
    out.layouts = (Array.isArray(v.layouts) ? v.layouts : []).slice(0, 12).map(function (l) {
      var lid = trackId(l && (l.id || l.name));
      if (!lid) return null;
      var lo = { id: lid, name: trackText(l.name, 60) || lid, length: trackNum(l.length, 300, 30000) || 0 };
      var sl = trackLine(l.startLine);
      if (sl) lo.startLine = sl;
      var fl = out.type === 'sprint' ? trackLine(l.finishLine) : null;
      if (fl) lo.finishLine = fl;
      var lorg = out.type === 'sprint' ? trackText(l.organizer, 40) : '';
      if (lorg) lo.organizer = lorg;
      lo.sectors = (Array.isArray(l.sectors) ? l.sectors : []).map(trackLine).filter(Boolean).slice(0, 8);
      lo.corners = (Array.isArray(l.corners) ? l.corners : []).slice(0, 40).map(function (c) {
        var cn = trackText(c && c.name, 40), clat = trackNum(c && c.lat, -90, 90), clng = trackNum(c && c.lng, -180, 180);
        return cn && clat !== null && clng !== null ? { name: cn, lat: clat, lng: clng } : null;
      }).filter(Boolean);
      if (l.check) lo.check = true;
      return lo;
    }).filter(Boolean);
  }
  return out;
}

// Only finite numbers in nested arrays: the laps' traces.
function cleanNumArrays(v, depth) {
  if (!Array.isArray(v)) return [];
  return v.map(function (x) {
    if (depth > 1) return cleanNumArrays(x, depth - 1);
    var n = Number(x);
    return isFinite(n) ? n : 0;
  });
}

function cleanTrackLaps(laps) {
  return (Array.isArray(laps) ? laps : []).slice(0, 300).map(function (l) {
    var t = trackNum(l && l.time, 1, 36000);
    if (t === null) return null;
    // The car's own figures for this one lap (Track Mode files).
    var lc = l.carData && typeof l.carData === 'object' ? cleanCarData(Object.assign({}, l.carData, { run: 1 }), true) : null;
    if (lc) delete lc.run;
    var out = {
      n: trackNum(l.n, 1, 1000) || 0, start: trackNum(l.start, 0, 864000) || 0, time: t,
      dist: trackNum(l.dist, 0, 100000) || 0, vmax: trackNum(l.vmax, 0, 500) || 0,
      kind: ['timed', 'in', 'out', 'slow', 'short'].indexOf(l.kind) !== -1 ? l.kind : 'timed',
      sectors: cleanNumArrays(l.sectors, 1).slice(0, 10),
      // Which file of the day the lap came from (several files make one session).
      run: trackNum(l.run, 1, 50) || undefined
    };
    if (lc && Object.keys(lc).length) out.carData = lc;
    return out;
  }).filter(Boolean);
}

function cleanTrackRuns(runs) {
  var keys = ['start', 'lat', 'lng', 'ft60', 'ft60Speed', 'eighth', 'eighthSpeed', 'quarter', 'quarterSpeed', 's30', 's60', 's100', 'k100', 's60to100', 'vmax'];
  return (Array.isArray(runs) ? runs : []).slice(0, 50).map(function (r) {
    var o = {};
    keys.forEach(function (k) { var n = Number(r && r[k]); if (r && r[k] != null && isFinite(n)) o[k] = n; });
    o.curve = cleanNumArrays(r && r.curve, 2).slice(0, 400);
    return o.s60 ? o : null;
  }).filter(Boolean);
}

// The parsed session from the browser, checked against the track list.
// Venue and layout names come from the list, not the browser.
// The car's own channels summarised by the page (js/track-parse.js carData):
// only known keys, as numbers within sensible limits.
function cleanCarData(c, inner) {
  if (!c || typeof c !== 'object') return null;
  var out = {};
  function grp(key, fields, lo, hi) {
    var g = c[key];
    if (!g || typeof g !== 'object') return;
    var o = {}, any = false;
    fields.forEach(function (f) { var n = trackNum(g[f], lo, hi); if (n !== null) { o[f] = n; any = true; } });
    if (any) out[key] = o;
  }
  grp('soc', ['start', 'end'], 0, 100);
  grp('power', ['max', 'regen', 'early', 'late'], 0, 5000);
  grp('throttle', ['full'], 0, 1);
  grp('brakePressure', ['max'], 0, 1000);
  grp('batteryTemp', ['start', 'max'], -100, 1000);
  grp('brakeTemp', ['max'], -100, 5000);
  grp('inverterTemp', ['max'], -100, 1000);
  grp('tyrePressure', ['start', 'end', 'max'], 0, 20);
  grp('slip', ['max'], 0, 100);
  // One set per file when a day was made from several (inner: one of those).
  if (inner) {
    var r = trackNum(c.run, 1, 50);
    if (r === null || Object.keys(out).length === 0) return null;
    out.run = Math.round(r);
    return out;
  }
  if (Array.isArray(c.runs)) {
    var runs = c.runs.slice(0, 20).map(function (x) { return cleanCarData(x, true); }).filter(Boolean);
    if (runs.length > 1) out.runs = runs;
  }
  function names(list) { return (Array.isArray(list) ? list : []).slice(0, 12).map(function (x) { return trackText(x, 30); }).filter(Boolean); }
  out.found = names(c.found);
  out.empty = names(c.empty);
  return out.found.length || out.empty.length ? out : null;
}

function cleanTrackSession(s, library) {
  if (!s || typeof s !== 'object') return { error: 'No session sent' };
  // Track day (laps), drag run, sprint or hill climb (start to finish), or
  // other (autotests, road drives: mapped but never on a leaderboard).
  var out = { type: ['drag', 'sprint', 'other'].indexOf(s.type) !== -1 ? s.type : 'track' };
  out.format = ['VBO', 'CSV', 'GPX'].indexOf(s.format) !== -1 ? s.format : 'CSV';
  out.hz = trackNum(s.hz, 0, 1000) || 0;
  out.sats = trackNum(s.sats, 0, 64);
  out.quality = ['good', 'fair', 'rough'].indexOf(s.quality) !== -1 ? s.quality : 'rough';
  out.date = /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') ? s.date : ukDateString(new Date());
  out.time = /^\d{2}:\d{2}$/.test(s.time || '') ? s.time : '';
  ['duration', 'distance', 'vmax', 'latMax', 'brakeMax', 'accMax', 'bestTime', 'possible'].forEach(function (k) { var n = trackNum(s[k], -100, 1e7); if (n !== null) out[k] = n; });
  var fname = trackText(s.fileName, 200);
  if (fname) out.fileName = fname;
  // A lap timer file joined with a Track Mode file: the car file's name and how well they lined up.
  if (s.carSource && typeof s.carSource === 'object') {
    var cs = { name: trackText(s.carSource.name, 120) }, csShift = trackNum(s.carSource.shift, -86400, 86400), csMatch = trackNum(s.carSource.match, 0, 1);
    if (csShift !== null) cs.shift = csShift;
    if (csMatch !== null) cs.match = csMatch;
    if (s.carSource.speed) cs.speed = true;
    if (s.carSource.g) cs.g = true;
    out.carSource = cs;
  }
  // Which version of the timing code worked this out (see MT3UKTrack.ANALYSIS_VERSION); none means the first.
  var av = trackNum(s.analysisVersion, 1, 1000);
  if (av) out.analysisVersion = Math.round(av);
  // Saved without times because its course is not listed yet: the admin has been told.
  var pending = trackText(s.pendingCourse, 60);
  if (pending) out.pendingCourse = pending;
  out.speedDerived = !!s.speedDerived;
  out.gDerived = !!s.gDerived;
  var venue = (library.venues || []).find(function (v) { return v.id === s.venueId; }) || null;
  if (venue) { out.venueId = venue.id; out.venue = venue.name; }
  else out.venue = trackText(s.venueName || s.venue, 60) || (out.type === 'drag' ? 'Drag run' : out.type === 'sprint' ? 'Sprint' : out.type === 'other' ? 'Drive' : 'Unknown track');
  out.origin = cleanNumArrays(s.origin, 1).slice(0, 2);
  var carData = cleanCarData(s.carData);
  if (carData) out.carData = carData;
  if (out.type === 'drag') {
    out.runs = cleanTrackRuns(s.runs);
    if (s.rollout) out.rollout = true;
    if (!out.runs.length) return { error: 'No drag run found in this file' };
    // At a venue only if the first run starts inside a drag venue.
    var r0 = out.runs[0];
    var dv = (library.venues || []).find(function (v) { return v.type === 'drag' && trackDist([v.lat, v.lng], [r0.lat, r0.lng]) <= v.radius; });
    out.atVenue = !!dv;
    if (dv) { out.venueId = dv.id; out.venue = dv.name; } else { delete out.venueId; }
    // The path is kept for street runs only (the save handlers drop it from every other drag run).
    var dol = s.trace && Array.isArray(s.trace.outline) ? s.trace.outline : [];
    out.outline = cleanNumArrays(dol, 2).slice(0, 2000).map(function (p) { return p.slice(0, 3); });
    return out;
  }
  var wantVenue = out.type === 'sprint' ? 'sprint' : 'circuit';
  if (venue && venue.type !== wantVenue) { delete out.venueId; venue = null; }
  var layout = venue && venue.layouts ? venue.layouts.find(function (l) { return l.id === s.layoutId; }) : null;
  if (layout) { out.layoutId = layout.id; out.layout = layout.name; }
  out.laps = cleanTrackLaps(s.laps);
  if (!out.laps.length && out.type !== 'other') return { error: out.type === 'sprint' ? 'No timed runs found in this file' : 'No laps found in this file' };
  if (out.type === 'other') {
    var ol = s.trace && Array.isArray(s.trace.outline) ? s.trace.outline : [];
    out.outline = cleanNumArrays(ol, 2).slice(0, 2000).map(function (p) { return p.slice(0, 3); });
  }
  out.best = trackNum(s.best, 1, 1000);
  var runs = trackNum(s.runs, 2, 50);
  if (runs) out.runs = Math.round(runs);
  out.bestSectors = cleanNumArrays(s.bestSectors, 1).slice(0, 10);
  out.sectorsByThirds = !!s.sectorsByThirds;
  out.startLine = trackLine(s.startLine);
  if (out.type === 'sprint') {
    out.finishLine = trackLine(s.finishLine);
    // Who ran it (B19, say): courses at one venue can have different lines.
    var org = trackText(s.organizer, 40);
    if (org) out.organizer = org;
    if (s.ignoreFinish === false) out.ignoreFinish = false;
    // A hill climb rather than a sprint (the member's pick, or the track list's): both are timed start to finish.
    if (s.hill) out.hill = true;
  }
  out.startLineFromMember = !!s.startLineFromMember;
  // The admin accepted the member's own lines for this session: a re-time keeps them, whatever the course's are.
  if (s.linesAccepted) out.linesAccepted = true;
  // A course with official lines only takes sessions timed on them (within
  // 25 m): lines a member moved never reach its leaderboard.
  if (layout && layout.startLine) {
    var near = function (a, b) { return a && b && trackDist([(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2], [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]) <= 25; };
    var onOfficial = near(out.startLine, layout.startLine) && (out.type !== 'sprint' || !layout.finishLine || near(out.finishLine, layout.finishLine));
    if (!onOfficial) { delete out.layoutId; delete out.layout; layout = null; }
  }
  out.corners = (Array.isArray(s.corners) ? s.corners : []).slice(0, 40).map(function (c) {
    return { n: trackNum(c.n, 1, 100) || 0, d: trackNum(c.d, 0, 100000) || 0, x: trackNum(c.x, -1e6, 1e6) || 0, y: trackNum(c.y, -1e6, 1e6) || 0, v: trackNum(c.v, 0, 500) || 0, lat: trackNum(c.lat, -90, 90), lng: trackNum(c.lng, -180, 180), name: trackText(c.name, 40) };
  });
  var tr = s.trace && s.trace.laps && typeof s.trace.laps === 'object' ? s.trace.laps : {};
  var laps = {};
  Object.keys(tr).slice(0, 300).forEach(function (k) { if (/^\d{1,4}$/.test(k)) laps[k] = cleanNumArrays(tr[k], 2).slice(0, 20000); });
  out.trace = { hz: trackNum(s.trace && s.trace.hz, 0.1, 50) || 5, laps: laps };
  // A best lap faster than the layout allows (over about 300 km/h average) is refused.
  if (layout && layout.length && out.bestTime && out.bestTime < layout.length / 85) return { error: out.type === 'sprint' ? 'That run time is not possible here' : 'That lap time is not possible here' };
  return out;
}

function trackSummary(rec) {
  var o = {
    id: rec.id, carId: rec.carId, type: rec.type, venueId: rec.venueId || '', venue: rec.venue, layoutId: rec.layoutId || '', layout: rec.layout || '',
    date: rec.date, time: rec.time || '', privacy: rec.privacy, conditions: rec.conditions || '', tyres: rec.tyres || '', temp: rec.temp, tempSource: rec.tempSource || '', weather: rec.weather || null,
    vmax: rec.vmax || 0, quality: rec.quality
  };
  if (rec.organizer) o.organizer = rec.organizer;
  // Where it was, to about 100 m: sessions at a track we do not list yet are matched to each other by place.
  if (rec.origin && rec.origin.length === 2 && isFinite(rec.origin[0]) && isFinite(rec.origin[1])) o.origin = [Math.round(rec.origin[0] * 1000) / 1000, Math.round(rec.origin[1] * 1000) / 1000];
  // Battery at the start and end (Track Mode files), so a day's group can add up the charge used.
  if (rec.carData && rec.carData.soc && isFinite(rec.carData.soc.start) && isFinite(rec.carData.soc.end)) o.soc = [rec.carData.soc.start, rec.carData.soc.end];
  if (rec.tyreMake) o.tyreMake = rec.tyreMake;
  if (rec.tyreModel) o.tyreModel = rec.tyreModel;
  if (rec.street) o.street = true;
  if (rec.unlisted) o.unlisted = true;
  if (rec.offBoard) o.offBoard = true;
  if (rec.type === 'drag') {
    var runs = rec.runs || [];
    var bq = runs.filter(function (r) { return r.quarter; }).sort(function (a, b) { return a.quarter - b.quarter; })[0];
    var b60 = runs.slice().sort(function (a, b) { return a.s60 - b.s60; })[0];
    o.runs = runs.length;
    if (bq) { o.quarter = bq.quarter; o.quarterSpeed = bq.quarterSpeed; }
    if (b60) o.s60 = b60.s60;
    o.atVenue = !!rec.atVenue;
  } else {
    o.bestTime = rec.bestTime || null;
    o.laps = (rec.laps || []).length;
  }
  return o;
}

// Parts that matter on a track: wheels, tyres, suspension, brakes,
// performance, aero, and anything that says it saves weight. The same rule as
// isTrackPart in js/track-parse.js (a test keeps the two together).
var TRACK_AREAS = { wheels: 1, tyres: 1, suspension: 1, brakes: 1, performance: 1 };
var TRACK_WORDS = /\b(tyres?|tires?|coilovers?|springs?|dampers?|shocks?|anti[- ]?roll|sway|brakes?|pads?|discs?|rotors?|calipers?|wheels?|rims?|spacers?|aero|wing|splitter|diffuser|canards?|lowering|geometry|alignment|camber|toe|tune|tuned|boost|cooling|cooler)\b/i;
var WEIGHT_WORDS = /\b\d+(?:\.\d+)?\s?kg\b|weight[- ]?(?:saving|saved|reduction|loss)|lightweight|lightened/i;
function isTrackPart(areaId, part) {
  part = part || {};
  var text = (part.kind ? part.kind + ' ' : '') + (part.what || '');
  if (WEIGHT_WORDS.test(text)) return true;
  if (TRACK_AREAS[areaId]) return true;
  if (areaId === 'bodywork') return part.kind === 'Aero';
  if (areaId === 'mods' || areaId === 'other') return TRACK_WORDS.test(text);
  return false;
}

// The track-relevant parts of a build, as short lines for a leaderboard row.
function trackBoardMods(record, details) {
  var out = [];
  specsToView(details && details.specs, false, (record && record.mods) || []).forEach(function (a) {
    (a.parts || []).forEach(function (p) {
      if (p.empty || !p.what || !isTrackPart(a.id, p)) return;
      var tag = p.kind || (a.id === 'mods' ? '' : a.label);
      out.push(trackText((tag ? tag + ': ' : '') + p.what, 90));
    });
  });
  return out.slice(0, 30);
}

// Each car's fastest here for every mix of conditions and tyres, so a board
// can be filtered ("Dry, Michelin") and still rank each car fairly.
var TRACK_BESTS_MAX = 12;
function trackBests(list) {
  var by = {};
  list.forEach(function (s) {
    var k = (s.conditions || '') + '|' + String(s.tyres || '').toLowerCase();
    if (!by[k] || trackScore(s) < trackScore(by[k])) by[k] = s;
  });
  return Object.keys(by).map(function (k) { return by[k]; })
    .sort(function (a, b) { return trackScore(a) - trackScore(b); }).slice(0, TRACK_BESTS_MAX)
    .map(function (s) {
      var b = { sessionId: s.id, date: s.date, conditions: s.conditions || '', tyres: s.tyres || '' };
      if (s.tyreMake) b.tyreMake = s.tyreMake;
      if (s.tyreModel) b.tyreModel = s.tyreModel;
      if (s.type === 'drag') { b.quarter = s.quarter; b.quarterSpeed = s.quarterSpeed; b.s60 = s.s60; } else b.time = s.bestTime;
      return b;
    });
}

function trackBoardKey(rec) {
  if (rec.type === 'drag') return rec.venueId && rec.atVenue && !rec.street ? 'drag-board:' + rec.venueId : '';
  if (rec.type === 'other') return '';
  var kind = rec.type === 'sprint' ? 'sprint-board:' : 'track-board:';
  return rec.venueId && rec.layoutId ? kind + rec.venueId + ':' + rec.layoutId : '';
}
function trackScore(s) { return s.type === 'drag' ? s.quarter : s.bestTime; }

// Whether the signed-in member owns this car (one of their photos is in it).
async function carBelongsTo(env, email, carId) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(carId || ''))) return null;
  var record = await getCarRecord(env, carId);
  if (!record) return null;
  var files = await getSubscriberFiles(env, email);
  var mine = (record.photos || []).some(function (f) { return files.indexOf(f) !== -1; });
  return mine ? record : null;
}

async function isAdminViewerToken(env, token) {
  token = String(token || '');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || !env.ADMIN_KEY) return false;
  var raw = await env.VOTES.get('admin-viewer:' + token);
  var record = null;
  try { record = raw ? JSON.parse(raw) : null; } catch (e) { record = null; }
  return !!(record && record.expires > Date.now() && record.k === (await adminKeyStamp(env)));
}

// Rebuilds this car's place on one board from its shared sessions.
async function refreshTrackBoard(env, boardKey, carId) {
  if (!boardKey) return;
  // Each car's fastest shared session here ("Shared" covers both older
  // "On my build" and "Leaderboard"), unless the admin took it off. The
  // entry also counts the car's shared sessions here, for the track list.
  var shared = await getJsonKey(env, 'track-public:' + carId, []);
  var here = shared.filter(function (s) { return (s.privacy === 'board' || s.privacy === 'build') && !s.street && trackBoardKey(s) === boardKey && trackScore(s); });
  var mine = here.filter(function (s) { return !s.offBoard; }).sort(function (a, b) { return trackScore(a) - trackScore(b); })[0];
  var board = await getJsonKey(env, boardKey, []);
  board = board.filter(function (e) { return e.carId !== carId; });
  if (mine) {
    var record = await getCarRecord(env, carId);
    var details = await getCarDetails(env, carId);
    var ownerEmail = record ? await carOwnerEmail(env, record) : null;
    var entry = {
      carId: carId, sessionId: mine.id, date: mine.date, conditions: mine.conditions || '', tyres: mine.tyres || '', sessions: here.length,
      car: (record && record.name) || 'MT3UK member build', model: (details && details.model) || '', version: (details && details.version) || '', year: (details && details.year) || '',
      owner: ownerEmail ? (publicName(await getProfileRecord(env, ownerEmail)) || 'MT3UK member') : 'MT3UK member',
      photo: record && record.photos && record.photos[0] ? record.photos[0] : '',
      mods: trackBoardMods(record, details),
      bests: trackBests(here.filter(function (s) { return !s.offBoard; }))
    };
    if (mine.tyreMake) entry.tyreMake = mine.tyreMake;
    if (mine.tyreModel) entry.tyreModel = mine.tyreModel;
    if (mine.type === 'drag') { entry.quarter = mine.quarter; entry.quarterSpeed = mine.quarterSpeed; entry.s60 = mine.s60; }
    else entry.time = mine.bestTime;
    board.push(entry);
  }
  board.sort(function (a, b) { return (a.time || a.quarter) - (b.time || b.quarter); });
  board = board.slice(0, TRACK_BOARD_MAX);
  await env.VOTES.put(boardKey, JSON.stringify(board));
  // Shared sessions per board, for the list of tracks (one key).
  var counts = await getJsonKey(env, 'track-board-counts', {});
  var total = board.reduce(function (n, e) { return n + (e.sessions || 1); }, 0);
  if (total) counts[boardKey] = total; else delete counts[boardKey];
  await env.VOTES.put('track-board-counts', JSON.stringify(counts));
  // The top three on each board, so the track list can show them (one key).
  var leaders = await getJsonKey(env, 'track-board-leaders', {});
  if (board.length) {
    leaders[boardKey] = board.slice(0, 3).map(function (e) {
      var l = { car: e.car, owner: e.owner, model: e.model || '', date: e.date };
      if (e.time) l.time = e.time; else { l.quarter = e.quarter; l.quarterSpeed = e.quarterSpeed; }
      return l;
    });
  } else delete leaders[boardKey];
  await env.VOTES.put('track-board-leaders', JSON.stringify(leaders));
}

// The owner of a car record, from its first photo's owner.
async function carOwnerEmail(env, record) {
  var file = record && record.photos && record.photos[0];
  if (!file) return null;
  try {
    var obj = await env.GALLERY_BUCKET.get('gallery/' + file + '.json');
    var sidecar = obj ? await obj.json() : null;
    return sidecar ? await sidecarOwnerEmail(env, file, sidecar) : null;
  } catch (e) {
    return null;
  }
}

async function putTrackIndexes(env, email, rec, removed) {
  return putTrackIndexesFor(env, await ownerKey(email), rec, removed);
}
async function putTrackIndexesFor(env, owner, rec, removed) {
  var oKey = 'track-index:' + owner;
  var index = (await getJsonKey(env, oKey, [])).filter(function (s) { return s.id !== rec.id; });
  if (!removed) index.unshift(trackSummary(rec));
  index.sort(function (a, b) { return (b.date + b.time) < (a.date + a.time) ? -1 : 1; });
  await env.VOTES.put(oKey, JSON.stringify(index));
  var pKey = 'track-public:' + rec.carId;
  var shared = await getJsonKey(env, pKey, []);
  var had = shared.some(function (s) { return s.id === rec.id; });
  shared = shared.filter(function (s) { return s.id !== rec.id; });
  var share = !removed && rec.privacy !== 'private' && !rec.street;
  if (share) shared.unshift(trackSummary(rec));
  if (share || had) {
    shared.sort(function (a, b) { return (b.date + b.time) < (a.date + a.time) ? -1 : 1; });
    await env.VOTES.put(pKey, JSON.stringify(shared));
  }
  await refreshTrackBoard(env, trackBoardKey(rec), rec.carId);
}

// ---- Track sessions: early preview access ----------------------------------
// The tool is an early preview. A member can use it when they are on the
// approved list, when the admin has opened it to everyone, or when they
// already had track sessions before the preview began. Everything is one KV
// key (track-access), read with get(). Shared sessions, leaderboards and the
// track list stay public.
var TRACK_ACCESS_KEY = 'track-access';
async function getTrackAccess(env) {
  var a = await getJsonKey(env, TRACK_ACCESS_KEY, {});
  return { open: !!a.open, imported: typeof a.imported === 'string' ? a.imported : '', allowed: Array.isArray(a.allowed) ? a.allowed : [], pending: Array.isArray(a.pending) ? a.pending : [] };
}
function putTrackAccess(env, a) { return env.VOTES.put(TRACK_ACCESS_KEY, JSON.stringify(a)); }
function accessEmail(e) { return String(e || '').trim().toLowerCase().slice(0, 200); }
async function trackAccessStatus(env, email) {
  var a = await getTrackAccess(env);
  var e = accessEmail(email);
  if (a.open || a.allowed.some(function (x) { return x.email === e; })) return 'approved';
  // Members who already had sessions keep using it, until the admin has put
  // them on the approved list (after that the list decides, so Revoke works).
  if (!a.imported) {
    var had = await getJsonKey(env, 'track-index:' + (await ownerKey(email)), []);
    if (had && had.length) return 'approved';
  }
  return a.pending.some(function (x) { return x.email === e; }) ? 'pending' : 'none';
}
// Null when the member may use the tool (or isn't signed in, which the
// handler itself answers); otherwise the refusal.
async function trackAccessGate(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return null;
  if ((await trackAccessStatus(env, email)) === 'approved') return null;
  return json({ success: false, needsAccess: true, message: 'Track Sessions is an early preview. Request access to use it.' }, 403);
}
async function handleTrackAccess(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  return json({ success: true, access: await trackAccessStatus(env, email) });
}
async function handleTrackAccessRequest(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  var status = await trackAccessStatus(env, email);
  if (status === 'approved') return json({ success: true, access: status });
  if (status === 'pending') return json({ success: true, access: status });
  var a = await getTrackAccess(env);
  var profile = await getProfileRecord(env, email);
  var name = (publicName(profile) || '').slice(0, 60);
  var note = trackText(body.note, 300), use = trackText(body.use, 40);
  a.pending.unshift({ email: accessEmail(email), name: name, use: use, note: note, at: new Date().toISOString() });
  a.pending = a.pending.slice(0, 300);
  await putTrackAccess(env, a);
  // A note to the admin (best effort: the request is kept either way).
  try {
    var subject = 'Track Sessions early access request';
    var text = subscriberLabel(name, email) + ' has asked for early access to Track Sessions.\n\n' +
      (use ? 'Using: ' + use + '\n' : '') + (note ? 'Their note:\n' + note + '\n\n' : '\n') +
      'Approve or decline: ' + MY_BUILDS_SITE_URL + '/track-admin.html#grp-access';
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, rawEmail(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, subject, text)));
  } catch (e) { /* the request is saved */ }
  return json({ success: true, access: 'pending' });
}
async function handleTrackAccessAdmin(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var a = await getTrackAccess(env);
  if (request.method === 'GET') return json({ success: true, open: a.open, imported: a.imported, allowed: a.allowed, pending: a.pending });
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var action = String(body.action || ''), e = accessEmail(body.email);
  if (action === 'open') {
    a.open = !!body.open;
  } else if (action === 'import') {
    // Once only: running it again would put back anyone who had been revoked.
    if (a.imported) return json({ success: false, message: 'The current testers were already added on ' + a.imported.slice(0, 10) + '.' }, 409);
    // Admin only, rarely used, so list() is fine: put everyone who already has
    // track sessions on the approved list, so they can be revoked like anyone else.
    var hashes = {}, idx = await env.VOTES.list({ prefix: 'track-index:', limit: 1000 }), found = [];
    for (var i = 0; i < idx.keys.length && i < 500; i++) {
      var h = idx.keys[i].name.slice('track-index:'.length), arr = await getJsonKey(env, idx.keys[i].name, []);
      if (arr && arr.length) hashes[h] = arr.length;
    }
    var cursor, pages = 0;
    do {
      var page = await env.VOTES.list({ prefix: 'subscriber:', limit: 1000, cursor: cursor });
      for (var k = 0; k < page.keys.length; k++) {
        var em = accessEmail(page.keys[k].name.slice('subscriber:'.length));
        if (hashes[await ownerKey(em)] && !found.some(function (f) { return f.email === em; })) found.push({ email: em, sessions: hashes[await ownerKey(em)] });
      }
      cursor = page.list_complete ? undefined : page.cursor; pages++;
    } while (cursor && pages < 20);
    var added = [];
    for (var m = 0; m < found.length; m++) {
      if (a.allowed.some(function (x) { return x.email === found[m].email; })) continue;
      var nm = '';
      try { nm = (publicName(await getProfileRecord(env, found[m].email)) || '').slice(0, 60); } catch (er) { nm = ''; }
      a.allowed.push({ email: found[m].email, name: nm, at: new Date().toISOString(), existing: true });
      a.pending = a.pending.filter(function (x) { return x.email !== found[m].email; });
      added.push({ email: found[m].email, name: nm });
    }
    a.imported = new Date().toISOString();
    await putTrackAccess(env, a);
    return json({ success: true, open: a.open, imported: a.imported, allowed: a.allowed, pending: a.pending, added: added, found: found.length });
  } else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return json({ success: false, message: 'That does not look like an email address.' }, 400);
    var wasPending = a.pending.filter(function (x) { return x.email === e; })[0];
    a.pending = a.pending.filter(function (x) { return x.email !== e; });
    if (action === 'approve' || action === 'add') {
      if (!a.allowed.some(function (x) { return x.email === e; })) a.allowed.push({ email: e, name: (wasPending && wasPending.name) || '', at: new Date().toISOString() });
      if (action === 'approve' && body.notify !== false) {
        try {
          var text = 'Hello,\n\nYou now have early access to Track Sessions on MT3UK. Sign in and open Track Sessions to add your first session: ' + MY_BUILDS_SITE_URL + '/track.html\n\nIt is an early preview, so please tell us what works and what does not.';
          await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, e, rawEmail(MY_BUILDS_FROM_EMAIL, e, 'You have early access to Track Sessions', text)));
        } catch (err) { /* approved either way */ }
      }
    } else if (action === 'revoke') {
      a.allowed = a.allowed.filter(function (x) { return x.email !== e; });
    } else if (action !== 'deny') {
      return json({ success: false, message: 'Unknown action' }, 400);
    }
  }
  await putTrackAccess(env, a);
  return json({ success: true, open: a.open, imported: a.imported, allowed: a.allowed, pending: a.pending });
}

async function handleTrackSessionsList(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  return json({ success: true, sessions: await getJsonKey(env, 'track-index:' + (await ownerKey(email)), []) });
}

async function handleTrackSessionSave(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var tooBig = json({ success: false, message: 'This session is too big to save. Try a shorter file.' }, 413);
  var buf = await request.arrayBuffer();
  var gzipped = isGzip(buf);
  if (buf.byteLength > (gzipped ? TRACK_SESSION_MAX_BYTES : TRACK_UNZIPPED_MAX_BYTES)) return tooBig;
  var body;
  try {
    body = JSON.parse(gzipped ? await gunzipText(buf, TRACK_UNZIPPED_MAX_BYTES) : new TextDecoder().decode(buf));
  } catch (e) {
    return e && e.message === 'too big' ? tooBig : json({ success: false, message: 'Invalid request body' }, 400);
  }
  var record = await carBelongsTo(env, email, body.carId);
  if (!record) return json({ success: false, message: 'That car is not linked to your account' }, 403);
  var library = await getTrackLibrary(env);
  var rec = cleanTrackSession(body.session, library);
  if (rec.error) return json({ success: false, message: rec.error }, 400);
  // A track day or sprint at a venue we do not list needs its name: it is what the member's list, the admin's view
  // and the request to add the track call it. Mapped drives keep their own words.
  if (!rec.venueId && (rec.type === 'track' || rec.type === 'sprint') && !trackText(body.venueName, 60) && !trackText(body.session.venueName || body.session.venue, 60)) return json({ success: false, message: 'Enter the track name.' }, 400);
  rec.street = false;
  if (rec.type === 'drag' && !rec.atVenue) {
    // Street runs: admins only, and always private. Anyone else's run at a strip we don't list is
    // kept private and off every leaderboard until the strip is added.
    if (body.street && (await isAdminViewerToken(env, body.adminViewer))) rec.street = true;
    else rec.unlisted = true;
  }
  if (rec.type === 'drag' && !rec.street) delete rec.outline;
  rec.id = randomToken().slice(0, 20);
  rec.owner = await ownerKey(email);
  rec.carId = String(body.carId);
  rec.createdAt = new Date().toISOString();
  applyTrackEdits(rec, body);
  if (rec.street || rec.unlisted) rec.privacy = 'private';
  // The same file saved twice (an upload repeated) makes a duplicate: same car, day, start time and result. The
  // member's own list is one key, read with get(). Only a page upload carries a file name, so other saves are not
  // held up by this.
  if (rec.fileName) {
    var mine = await getJsonKey(env, 'track-index:' + rec.owner, []);
    var twin = mine.filter(function (s) { return s.carId === rec.carId && s.type === rec.type && s.date === rec.date && (s.time || '') === (rec.time || '') && sameTrackResult(s, rec); })[0];
    if (twin) return json({ success: false, duplicate: true, session: twin, message: 'You already have this session: ' + (twin.venue || 'the same place') + ', ' + twin.date + (twin.time ? ' at ' + twin.time : '') + '. Open it from your list instead.' }, 409);
  }
  if (!(await putTrackSession(env, rec))) return tooBig;
  await putTrackIndexes(env, email, rec);
  return json({ success: true, session: trackSummary(rec) });
}
// Whether a listed session and a new one have the same result: the same laps and best time, or runs and 60 ft time.
function sameTrackResult(s, rec) {
  if (rec.type === 'drag') {
    var runs = rec.runs || [], b60 = runs.slice().sort(function (a, b) { return a.s60 - b.s60; })[0];
    return s.runs === runs.length && (!b60 || !isFinite(s.s60) || Math.abs(s.s60 - b60.s60) < 0.0005);
  }
  return s.laps === (rec.laps || []).length && ((s.bestTime == null && rec.bestTime == null) || (isFinite(s.bestTime) && isFinite(rec.bestTime) && Math.abs(s.bestTime - rec.bestTime) < 0.0005));
}

function composeTrackTyres(rec) {
  var name = [rec.tyreMake, rec.tyreModel].filter(Boolean).join(' ');
  var size = rec.tyreWidth && rec.tyreProfile && rec.tyreRim ? rec.tyreWidth + '/' + rec.tyreProfile + ' R' + rec.tyreRim : '';
  return trackText([name, size].filter(Boolean).join(', '), 80);
}

function applyTrackEdits(rec, body) {
  if (TRACK_PRIVACY.indexOf(body.privacy) !== -1) rec.privacy = body.privacy;
  if (!rec.privacy) rec.privacy = 'private';
  // Leaderboards need a known track and layout (or drag strip).
  if (rec.privacy === 'board' && !trackBoardKey(rec)) rec.privacy = 'build';
  if ('conditions' in body) rec.conditions = TRACK_CONDITIONS.indexOf(body.conditions) !== -1 ? body.conditions : '';
  // Tyres: make, model and size (width, profile, diameter) as separate parts;
  // the description is built from them. Older free-text entries still work.
  if ('tyreMake' in body || 'tyreModel' in body || 'tyreWidth' in body || 'tyreProfile' in body || 'tyreRim' in body) {
    var tw = trackNum(body.tyreWidth, 125, 395), tp = trackNum(body.tyreProfile, 20, 90), td = trackNum(body.tyreRim, 12, 26);
    rec.tyreMake = trackText(body.tyreMake, 40);
    rec.tyreModel = trackText(body.tyreModel, 50);
    ['tyreWidth', 'tyreProfile', 'tyreRim'].forEach(function (k) { delete rec[k]; });
    if (tw && tp && td) { rec.tyreWidth = Math.round(tw); rec.tyreProfile = Math.round(tp); rec.tyreRim = Math.round(td); }
    rec.tyres = composeTrackTyres(rec);
  } else if ('tyres' in body) rec.tyres = trackText(body.tyres, 80);
  if ('temp' in body) rec.temp = trackNum(body.temp, -30, 50);
  // Where the temperature came from: the logger's file, Open-Meteo weather
  // (shown with credit to Open-Meteo), or typed by the member.
  if ('temp' in body || 'tempSource' in body) {
    rec.tempSource = rec.temp == null ? '' : (['weather', 'file'].indexOf(body.tempSource) !== -1 ? body.tempSource : 'member');
    var w = body.weather;
    if (rec.tempSource === 'weather' && w && typeof w === 'object') {
      rec.weather = { temp: trackNum(w.temp, -30, 50), rain: trackNum(w.rain, 0, 500), wind: trackNum(w.wind, 0, 300), hour: /^\d{2}:00$/.test(w.hour || '') ? w.hour : '', source: 'Open-Meteo' };
    } else {
      delete rec.weather;
    }
  }
  if ('hill' in body && rec.type === 'sprint') { if (body.hill) rec.hill = true; else delete rec.hill; }
  if ('notes' in body) rec.notes = trackText(body.notes, 500);
  if ('venueName' in body && !rec.venueId) rec.venue = trackText(body.venueName, 60) || rec.venue;
}

async function getOwnTrackSession(request, env, id) {
  var email = await resolveSession(request, env);
  if (!email) return { error: json({ success: false, message: 'Please sign in again' }, 401) };
  var rec = await getTrackSession(env, id);
  if (!rec || rec.owner !== (await ownerKey(email))) return { error: json({ success: false, message: 'Session not found' }, 404) };
  return { email: email, rec: rec };
}

async function handleTrackSessionGet(request, env) {
  var id = String(new URL(request.url).searchParams.get('id') || '');
  if (!/^[a-f0-9]{8,40}$/.test(id)) return json({ success: false, message: 'Session not found' }, 404);
  var rec = await getTrackSession(env, id);
  if (!rec) return json({ success: false, message: 'Session not found' }, 404);
  var viewer = request.headers.get('X-Session-Token') ? await resolveSession(request, env) : null;
  var mine = !!viewer && rec.owner === (await ownerKey(viewer));
  // The admin can open a private session, read only and without the member's
  // notes. Every such view is logged (see logTrackAdminView).
  var adminView = false;
  if (!mine && (rec.privacy === 'private' || rec.street)) {
    if (await isAdminViewerToken(env, request.headers.get('X-Admin-Viewer'))) adminView = true;
    else return json({ success: false, message: 'Session not found' }, 404);
  }
  var out = Object.assign({}, rec);
  delete out.owner;
  if (!mine) delete out.notes;
  if (!mine && !adminView) { delete out.fileName; delete out.readingsRefused; }
  out.mine = mine;
  if (adminView) out.adminView = true;
  var car = await getCarRecord(env, rec.carId);
  out.car = car ? car.name : '';
  // Whose it is, as other members see them (nickname or name), so a session opened from a leaderboard says who ran it.
  var ownerEmail = car ? await carOwnerEmail(env, car) : null;
  out.ownerName = ownerEmail ? (publicName(await getProfileRecord(env, ownerEmail)) || 'MT3UK member') : 'MT3UK member';
  if (adminView) await logTrackAdminView(env, rec, out.car);
  return json({ success: true, session: out });
}

// Each time the admin opens a private session: when, which one, whose car.
// One key, newest first, the last 300.
var TRACK_ADMIN_VIEWS_KEY = 'track-admin-views';
async function logTrackAdminView(env, rec, car) {
  var list = await getJsonKey(env, TRACK_ADMIN_VIEWS_KEY, []);
  var last = list[0];
  // Reloading the same session within a minute is one view.
  if (last && last.id === rec.id && Date.now() - Date.parse(last.at) < 60000) return;
  list.unshift({ at: new Date().toISOString(), id: rec.id, car: car || '', venue: rec.venue || '', type: rec.type, date: rec.date, privacy: rec.privacy });
  await env.VOTES.put(TRACK_ADMIN_VIEWS_KEY, JSON.stringify(list.slice(0, 300)));
}
// Admin: a member's sessions by email, and the log of admin views.
async function handleTrackAdminSessions(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var params = new URL(request.url).searchParams, email = accessEmail(params.get('email'));
  if (!email) return json({ success: true, views: await getJsonKey(env, TRACK_ADMIN_VIEWS_KEY, []) });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ success: false, message: 'That does not look like an email address.' }, 400);
  var list = await getJsonKey(env, 'track-index:' + (await ownerKey(email)), []);
  return json({ success: true, sessions: list.map(function (s) { return { id: s.id, type: s.type, venue: s.venue, venueId: s.venueId || '', layout: s.layout || '', date: s.date, time: s.time || '', privacy: s.privacy, car: '', bestTime: s.bestTime || null, quarter: s.quarter || null }; }) });
}

// The admin renames a session at a track we do not list (a typo, or a name the member left vague). A session at a
// listed track takes its name from the library, so that is renamed on the Tracks panel instead. The member's own
// list and the car's shared list are rewritten with the new name.
async function handleTrackAdminSessionRename(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var id = String((body && body.id) || '');
  if (!/^[a-f0-9]{8,40}$/.test(id)) return json({ success: false, message: 'Session not found' }, 404);
  var rec = await getTrackSession(env, id);
  if (!rec) return json({ success: false, message: 'Session not found' }, 404);
  if (rec.venueId) return json({ success: false, message: 'This session is at a listed track, so its name comes from the track list. Rename the track on the Tracks panel.' }, 400);
  var name = trackText(body.venue, 60);
  if (!name) return json({ success: false, message: 'Enter the track name.' }, 400);
  rec.venue = name;
  if (!(await putTrackSession(env, rec))) return json({ success: false, message: 'Could not save the session.' }, 413);
  await putTrackIndexesFor(env, rec.owner, rec);
  return json({ success: true, session: trackSummary(rec) });
}

async function handleTrackSessionUpdate(request, env) {
  var body;
  try {
    var buf = await request.arrayBuffer();
    var gzipped = isGzip(buf);
    if (buf.byteLength > (gzipped ? TRACK_SESSION_MAX_BYTES : TRACK_UNZIPPED_MAX_BYTES)) return json({ success: false, message: 'This session is too big to save. Try a shorter file.' }, 413);
    body = JSON.parse(gzipped ? await gunzipText(buf, TRACK_UNZIPPED_MAX_BYTES) : new TextDecoder().decode(buf));
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ success: false, message: 'Invalid request body' }, 400);
  var got = await getOwnTrackSession(request, env, String(body.id || ''));
  if (got.error) return got.error;
  var rec = got.rec;
  var oldBoard = trackBoardKey(rec);
  if (body.session && typeof body.session === 'object') {
    // A new type: the readings read again as that type. The member's own
    // details (privacy, conditions, tyres, temperature, notes) carry over.
    if (rec.street) return json({ success: false, message: 'Street runs can\'t change type.' }, 400);
    var next = cleanTrackSession(body.session, await getTrackLibrary(env));
    if (next.error) return json({ success: false, message: next.error }, 400);
    // A member never saves moved start or finish lines themselves: they send them for MT3UK to accept (a change of
    // type does not move the lines).
    if (next.type === rec.type && trackLinesMoved(rec, next)) return json({ success: false, needsLineAccess: true, message: 'Moved lines are sent to MT3UK to approve. Use Edit the map on this session\'s page.' }, 403);
    if (next.type === 'drag' && !next.atVenue) next.unlisted = true;
    next.street = false;
    if (next.type === 'drag') delete next.outline;
    next.id = rec.id;
    next.owner = rec.owner;
    next.carId = rec.carId;
    next.createdAt = rec.createdAt;
    ['privacy', 'conditions', 'tyres', 'tyreMake', 'tyreModel', 'tyreWidth', 'tyreProfile', 'tyreRim', 'temp', 'tempSource', 'weather', 'notes', 'hasSource', 'readingsRefused'].forEach(function (k) { if (rec[k] !== undefined) next[k] = rec[k]; });
    rec = next;
    delete body.privacy;
  }
  applyTrackEdits(rec, body);
  if (rec.street || rec.unlisted) rec.privacy = 'private';
  if (!(await putTrackSession(env, rec))) return json({ success: false, message: 'This session is too big to save. Try a shorter file.' }, 413);
  await putTrackIndexes(env, got.email, rec);
  if (oldBoard && oldBoard !== trackBoardKey(rec)) await refreshTrackBoard(env, oldBoard, rec.carId);
  return json({ success: true, session: trackSummary(rec) });
}

// ---- Moving a saved session's start and finish lines ----
// A member never saves moved lines themselves. They press Request Edit Map on their session, the admin allows it
// for that one session (Line editing panel of admin.html), the member moves the lines on the map and sends the
// change, and nothing on the session changes until the admin accepts it (Undo throws it away). The admin then
// revokes the access. One KV key, read with get(): track-line-access = [{ id (session), email, name, note, at,
// status 'pending' | 'granted', grantedAt, proposal: { at, from: { startLine, finishLine, time }, to: { ... } } }].
// Accepting is done by the admin's browser: it works the time out again from the saved readings with the new
// lines (so a made-up time cannot be approved) and saves it through /track/admin/retime.
async function getLineAccess(env) {
  var list = await getJsonKey(env, 'track-line-access', []);
  return Array.isArray(list) ? list : [];
}
function trackSessionLabel(rec) {
  return (rec.venue || (rec.type === 'sprint' ? 'Sprint' : 'Track session')) + (rec.layout && rec.layout !== rec.venue ? ', ' + rec.layout : '');
}
function trackLinesMoved(a, b) {
  function moved(x, y) { return !!(x && y && x.length === 2 && y.length === 2 && (trackDist(x[0], y[0]) > 1 || trackDist(x[1], y[1]) > 1)); }
  return moved(a.startLine, b.startLine) || moved(a.finishLine, b.finishLine);
}
function trackLineText(l) { return l && l.length === 2 ? [l[0][0], l[0][1], l[1][0], l[1][1]].map(function (v) { return Math.round(v * 1e7) / 1e7; }).join(', ') : 'not set'; }
function trackTimeText(t) { return t ? Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60).toFixed(3) : 'no time'; }
async function emailAdminAboutLines(env, subject, text) {
  try { await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, rawEmail(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, subject, text))); } catch (e) { /* the request is kept either way */ }
}
async function emailMemberAboutLines(env, entry, subject, text) {
  if (!entry || !entry.email) return;
  try { await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, entry.email, rawEmail(MY_BUILDS_FROM_EMAIL, entry.email, subject, text))); } catch (e) { /* done either way */ }
}
async function handleTrackLinesStatus(request, env) {
  var got = await getOwnTrackSession(request, env, String(new URL(request.url).searchParams.get('id') || ''));
  if (got.error) return got.error;
  var entry = (await getLineAccess(env)).filter(function (x) { return x.id === got.rec.id; })[0];
  return json({ success: true, state: entry ? entry.status : 'none', proposal: entry && entry.proposal ? entry.proposal : null });
}
async function handleTrackLinesRequest(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  var got = await getOwnTrackSession(request, env, String(body.id || ''));
  if (got.error) return got.error;
  var rec = got.rec;
  if (rec.type !== 'sprint' && rec.type !== 'track') return json({ success: false, message: 'Only a sprint, hill climb or track day has start and finish lines.' }, 400);
  var list = await getLineAccess(env);
  var have = list.filter(function (x) { return x.id === rec.id; })[0];
  if (have) return json({ success: true, state: have.status });
  if (list.filter(function (x) { return x.email === accessEmail(email) && x.status === 'pending'; }).length >= 5) return json({ success: false, message: 'You already have requests waiting. We\'ll get to them soon.' }, 429);
  var name = (publicName(await getProfileRecord(env, email)) || '').slice(0, 60);
  list.unshift({ id: rec.id, email: accessEmail(email), name: name, note: trackText(body.note, 300), at: new Date().toISOString(), status: 'pending' });
  await env.VOTES.put('track-line-access', JSON.stringify(list.slice(0, 300)));
  await emailAdminAboutLines(env, 'Request to edit a map', subscriberLabel(name, email) + ' has asked to edit the start and finish lines on a session: ' + trackSessionLabel(rec) + ', ' + (rec.date || '') + '.\n\n' +
    (body.note ? 'Their note:\n' + trackText(body.note, 300) + '\n\n' : '') + 'Allow it, and revoke it when they are done, on the Line editing panel:\n' + MY_BUILDS_SITE_URL + '/track-admin.html#lines-' + rec.id + '\n\nThe session:\n' + MY_BUILDS_SITE_URL + '/track.html?s=' + rec.id);
  return json({ success: true, state: 'pending' });
}
// The member sends the lines they have moved. Nothing on the session changes: the admin accepts it or undoes it.
async function handleTrackLinesPropose(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var got = await getOwnTrackSession(request, env, String(body.id || ''));
  if (got.error) return got.error;
  var rec = got.rec, list = await getLineAccess(env);
  var entry = list.filter(function (x) { return x.id === rec.id && x.status === 'granted'; })[0];
  if (!entry) return json({ success: false, message: 'Ask MT3UK to let you edit this map first.' }, 403);
  var sprint = rec.type === 'sprint';
  var to = { startLine: trackLine(body.startLine), finishLine: sprint ? trackLine(body.finishLine) : null, time: trackNum(body.time, 0, 100000) };
  if (!to.startLine || (sprint && !to.finishLine)) return json({ success: false, message: sprint ? 'Both the start and the finish line are needed.' : 'The start line is needed.' }, 400);
  if (!trackLinesMoved({ startLine: rec.startLine, finishLine: rec.finishLine }, to) && rec.startLine) return json({ success: false, message: 'The lines have not moved.' }, 400);
  var from = { startLine: rec.startLine || null, finishLine: rec.finishLine || null, time: rec.bestTime || null };
  // The pictures the member's browser drew, if they arrived: the old lines and the new ones.
  var pics = [];
  for (var w = 0; w < 2; w++) {
    var which = w ? 'after' : 'before', bytes = await env.VOTES.get(lineImageKey(rec.id, which), 'arrayBuffer');
    if (bytes) { var u8 = new Uint8Array(bytes), type = lineImageType(u8); if (type) pics.push({ which: which, cid: which + '-' + rec.id.slice(0, 8) + '@mt3uk.com', type: type, name: which + (type === 'image/png' ? '.png' : '.jpg'), bytes: u8 }); }
  }
  entry.proposal = { at: new Date().toISOString(), from: from, to: to, images: { before: pics.some(function (x) { return x.which === 'before'; }), after: pics.some(function (x) { return x.which === 'after'; }) } };
  var label = trackSessionLabel(rec) + ', ' + (rec.date || ''), who = subscriberLabel(entry.name, email);
  var requestUrl = MY_BUILDS_SITE_URL + '/track-admin.html#lines-' + rec.id, sessionUrl = MY_BUILDS_SITE_URL + '/track.html?s=' + rec.id;
  var text = 'AWAITING YOUR APPROVAL\n\n' + who + ' has moved the lines on ' + label + '. Nothing has changed yet: accept it or undo it.\n\n' +
    'Start line\n  from: ' + trackLineText(from.startLine) + '\n  to:   ' + trackLineText(to.startLine) + '\n' + (sprint ? 'Finish line\n  from: ' + trackLineText(from.finishLine) + '\n  to:   ' + trackLineText(to.finishLine) + '\n' : '') +
    'Time\n  from: ' + trackTimeText(from.time) + '\n  to:   ' + trackTimeText(to.time) + ' (their figure, worked out again when you accept)\n\n' +
    (pics.length ? 'The old and new lines are pictured in the HTML version of this email, and on the panel.\n\n' : '') +
    'Accept it or undo it on the Line editing panel:\n' + requestUrl + '\n\nThe session:\n' + sessionUrl;
  var subject = 'Map edit awaiting your approval: ' + label;
  var sent = false;
  try {
    var td = 'style="padding:4px 10px;border-bottom:1px solid #e3e6ec;font-family:Arial,sans-serif;font-size:14px"';
    var row = function (name, a2, b2) { return '<tr><td ' + td + '><b>' + name + '</b></td><td ' + td + '>' + htmlEscape(a2) + '</td><td ' + td + '>' + htmlEscape(b2) + '</td></tr>'; };
    var html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16233d;max-width:640px">' +
      '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.04em;color:#b8421f"><b>AWAITING YOUR APPROVAL</b></p>' +
      '<h2 style="margin:0 0 8px;font-size:18px">' + htmlEscape(label) + '</h2>' +
      '<p>' + htmlEscape(who) + ' has moved the ' + (sprint ? 'start and finish lines' : 'start line') + '. <b>Nothing has changed yet</b>: accept it or undo it.</p>' +
      '<table cellspacing="0" style="border-collapse:collapse;margin:8px 0"><tr><td ' + td + '></td><td ' + td + '><b>From</b></td><td ' + td + '><b>To</b></td></tr>' +
      row('Start line', trackLineText(from.startLine), trackLineText(to.startLine)) + (sprint ? row('Finish line', trackLineText(from.finishLine), trackLineText(to.finishLine)) : '') +
      row('Time', trackTimeText(from.time), trackTimeText(to.time) + ' (their figure)') + '</table>' +
      pics.map(function (x) { return '<p style="margin:12px 0 4px"><b>' + (x.which === 'before' ? 'Old lines' : 'New lines') + '</b></p><img src="cid:' + x.cid + '" alt="' + (x.which === 'before' ? 'The old lines on the map' : 'The new lines on the map') + '" style="max-width:100%;border:1px solid #e3e6ec;border-radius:6px">'; }).join('') +
      '<p style="margin:16px 0"><a href="' + requestUrl + '" style="background:#e8562a;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Accept or undo</a></p>' +
      '<p style="font-size:13px;color:#6b7385">The time is worked out again from the saved readings when you accept. <a href="' + sessionUrl + '">Open the session</a></p></div>';
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, rawEmailWithImages(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, subject, text, html, pics)));
    sent = true;
  } catch (e) { /* the change is kept either way; the panel says if the email did not go */ }
  if (!sent) entry.proposal.emailFailed = true;
  await env.VOTES.put('track-line-access', JSON.stringify(list));
  return json({ success: true, state: 'granted', proposal: entry.proposal });
}
// The before and after pictures of a change (drawn in the member's browser), kept in KV for a month at most and
// removed when the change is dealt with. JPEG or PNG, up to 1.5 MB.
var LINE_IMAGE_MAX = 1500000;
function lineImageKey(id, which) { return 'track-line-image:' + id + ':' + which; }
function lineImageType(bytes) {
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return '';
}
async function dropLineImages(env, id) {
  await env.VOTES.delete(lineImageKey(id, 'before'));
  await env.VOTES.delete(lineImageKey(id, 'after'));
}
async function handleTrackLinesImage(request, env) {
  var params = new URL(request.url).searchParams, which = params.get('which');
  if (which !== 'before' && which !== 'after') return json({ success: false, message: 'Unknown picture' }, 400);
  var id = String(params.get('id') || '');
  if (request.method === 'GET') {
    // The admin looks at them on the Line editing panel.
    if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
    var stored = /^[a-f0-9]{8,40}$/.test(id) ? await env.VOTES.get(lineImageKey(id, which), 'arrayBuffer') : null;
    if (!stored) return json({ success: false, message: 'No picture' }, 404);
    return new Response(stored, { status: 200, headers: { 'Content-Type': lineImageType(new Uint8Array(stored)) || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  }
  var got = await getOwnTrackSession(request, env, id);
  if (got.error) return got.error;
  var entry = (await getLineAccess(env)).filter(function (x) { return x.id === got.rec.id && x.status === 'granted'; })[0];
  if (!entry) return json({ success: false, message: 'Ask MT3UK to let you edit this map first.' }, 403);
  var buf = await request.arrayBuffer();
  if (buf.byteLength > LINE_IMAGE_MAX) return json({ success: false, message: 'That picture is too big.' }, 413);
  if (!lineImageType(new Uint8Array(buf))) return json({ success: false, message: 'That is not a picture.' }, 400);
  await env.VOTES.put(lineImageKey(got.rec.id, which), buf, { expirationTtl: 60 * 60 * 24 * 30 });
  return json({ success: true });
}
async function handleTrackLinesAdmin(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var list = await getLineAccess(env);
  if (request.method === 'GET') {
    // A few entries at most, each one get(): no list().
    var rows = await Promise.all(list.map(async function (x) {
      var rec = await getTrackSession(env, x.id);
      return { id: x.id, name: x.name || '', email: maskEmailForAdmin(x.email), note: x.note || '', at: x.at, status: x.status, grantedAt: x.grantedAt || '', proposal: x.proposal || null,
        what: rec ? trackSessionLabel(rec) + ', ' + (rec.date || '') : 'a session that has gone', type: rec ? rec.type : '', best: rec && rec.bestTime ? rec.bestTime : null };
    }));
    return json({ success: true, requests: rows });
  }
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var entry = list.filter(function (x) { return x.id === String(body.id || ''); })[0];
  if (!entry) return json({ success: false, message: 'Request not found' }, 404);
  var action = String(body.action || ''), url = MY_BUILDS_SITE_URL + '/track.html?s=' + entry.id;
  if (action === 'grant') {
    if (entry.status === 'granted') return json({ success: true });
    entry.status = 'granted'; entry.grantedAt = new Date().toISOString();
    if (body.notify !== false) await emailMemberAboutLines(env, entry, 'You can edit the map on your session', 'Hello,\n\nYou can now edit the start and finish lines on your session. Open it, press "Edit the map", move the lines, check the time and send the change. The map only changes once MT3UK has approved it.\n\n' + url);
  } else if (action === 'undo') {
    if (!entry.proposal) return json({ success: false, message: 'There is no change waiting.' }, 400);
    entry.proposal = null;
    await dropLineImages(env, entry.id);
    await emailMemberAboutLines(env, entry, 'Your map change was not used', 'Hello,\n\nMT3UK did not use the change you sent to the lines on your session, so it is as it was. You can send another if you like:\n\n' + url);
  } else if (action === 'accepted') {
    // The admin's browser has already saved the new timing through /track/admin/retime: this clears the change.
    if (!entry.proposal) return json({ success: false, message: 'There is no change waiting.' }, 400);
    entry.proposal = null;
    await dropLineImages(env, entry.id);
    await emailMemberAboutLines(env, entry, 'Your map change was accepted', 'Hello,\n\nMT3UK accepted the change you sent to the lines on your session. The new time is on it now:\n\n' + url);
  } else if (action === 'revoke' || action === 'dismiss') {
    list = list.filter(function (x) { return x !== entry; });
    await dropLineImages(env, entry.id);
  } else {
    return json({ success: false, message: 'Unknown action' }, 400);
  }
  await env.VOTES.put('track-line-access', JSON.stringify(list));
  return json({ success: true });
}

// The readings behind a session, kept (gzipped, owner only) so the member can
// change its type later. The page sends them just after saving; a session
// without them simply can't change type.
async function handleTrackSourceSave(request, env) {
  var got = await getOwnTrackSession(request, env, String(new URL(request.url).searchParams.get('id') || ''));
  if (got.error) return got.error;
  var buf = await request.arrayBuffer();
  if (!isGzip(buf)) return json({ success: false, message: 'Send the readings gzipped.' }, 400);
  if (buf.byteLength > TRACK_SOURCE_MAX_BYTES) return await refuseTrackSource(env, got, buf.byteLength, 'Those readings are too big to keep (' + (buf.byteLength / 1e6).toFixed(1) + ' MB zipped, the limit is ' + (TRACK_SOURCE_MAX_BYTES / 1e6) + ' MB).');
  var src;
  try { src = JSON.parse(await gunzipText(buf, TRACK_SOURCE_UNZIPPED_MAX_BYTES)); } catch (e) {
    if (e && e.message === 'too big') return await refuseTrackSource(env, got, buf.byteLength, 'Those readings are too big to keep (over ' + (TRACK_SOURCE_UNZIPPED_MAX_BYTES / 1e6) + ' MB once unzipped).');
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  var rows = src && src.v === 1 && src.rd && typeof src.rd === 'object' && Array.isArray(src.p) ? src.p : null;
  if (rows && rows.length > TRACK_SOURCE_MAX_ROWS) return await refuseTrackSource(env, got, buf.byteLength, 'Those readings are too long to keep (' + rows.length + ' readings, the limit is ' + TRACK_SOURCE_MAX_ROWS + ').');
  if (!rows || rows.length < 10) return json({ success: false, message: 'Invalid readings' }, 400);
  var ends = [rows[0], rows[rows.length - 1]];
  if (!ends.every(function (r) { return Array.isArray(r) && r.length >= 3 && r.length <= 12 && isFinite(r[0]) && isFinite(r[1]) && isFinite(r[2]); })) return json({ success: false, message: 'Invalid readings' }, 400);
  await env.VOTES.put('track-source:' + got.rec.id, buf);
  if (!got.rec.hasSource || got.rec.readingsRefused) { got.rec.hasSource = true; delete got.rec.readingsRefused; await putTrackSession(env, got.rec); }
  return json({ success: true });
}

// Readings that are over a limit are refused, and the session keeps a note of it (so the member is still told
// after a refresh) and the admin is emailed who tried it, with the size, so the limit can be looked at. The
// emails stop after three tries on one session.
var TRACK_SOURCE_MAX_ROWS = 400000;
async function refuseTrackSource(env, got, zippedBytes, message) {
  var rec = got.rec, tries = ((rec.readingsRefused && rec.readingsRefused.tries) || 0) + 1;
  rec.readingsRefused = { at: new Date().toISOString(), message: message, zippedMB: Math.round(zippedBytes / 1e5) / 10, tries: tries };
  await putTrackSession(env, rec);
  if (tries <= 3) {
    var name = (publicName(await getProfileRecord(env, got.email)) || '').slice(0, 60);
    await emailAdminAboutLines(env, 'Readings too big to keep', subscriberLabel(name, got.email) + ' tried to keep the readings of a session and they were refused.\n\n' +
      'Session: ' + trackSessionLabel(rec) + ', ' + (rec.date || '') + ' (' + (rec.type || '') + ')\n' +
      (rec.fileName ? 'File: ' + rec.fileName + '\n' : '') +
      'Why: ' + message + '\n' +
      'Attempt: ' + tries + (tries === 3 ? ' (no more emails about this session)' : '') + '\n\n' +
      'The limits are ' + (TRACK_SOURCE_MAX_BYTES / 1e6) + ' MB zipped, ' + (TRACK_SOURCE_UNZIPPED_MAX_BYTES / 1e6) + ' MB unzipped and ' + TRACK_SOURCE_MAX_ROWS + ' readings.\n\n' +
      'The session:\n' + MY_BUILDS_SITE_URL + '/track.html?s=' + rec.id);
  }
  return json({ success: false, message: message }, 413);
}

// Back out as the stored gzip, which the browser unzips (Content-Encoding).
async function handleTrackSourceGet(request, env) {
  var got = await getOwnTrackSession(request, env, String(new URL(request.url).searchParams.get('id') || ''));
  if (got.error) return got.error;
  var buf = await env.VOTES.get('track-source:' + got.rec.id, 'arrayBuffer');
  if (!buf) return json({ success: false, message: 'No readings were kept for this session.' }, 404);
  return new Response(buf, { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

async function handleTrackSessionDelete(request, env) {
  var got = await getOwnTrackSession(request, env, String(new URL(request.url).searchParams.get('id') || ''));
  if (got.error) return got.error;
  await env.VOTES.delete('track-session:' + got.rec.id);
  await env.VOTES.delete('track-source:' + got.rec.id);
  await putTrackIndexes(env, got.email, got.rec, true);
  return json({ success: true });
}

async function handleTrackPublic(request, env) {
  var carId = String(new URL(request.url).searchParams.get('car') || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(carId)) return json({ success: false, message: 'car is required' }, 400);
  var record = await getCarRecord(env, carId);
  if (!record) return json({ success: false, message: 'Not found' }, 404);
  var details = await getCarDetails(env, carId);
  var ownerEmail = await carOwnerEmail(env, record);
  var viewer = request.headers.get('X-Session-Token') ? await resolveSession(request, env) : null;
  var res = json({
    success: true,
    car: { id: carId, name: record.name || '', model: (details && details.model) || '', version: (details && details.version) || '', year: (details && details.year) || '', photo: (record.photos || [])[0] || '', owner: ownerEmail ? (publicName(await getProfileRecord(env, ownerEmail)) || 'MT3UK member') : '' },
    mine: !!viewer && viewer === ownerEmail,
    sessions: await getJsonKey(env, 'track-public:' + carId, [])
  });
  res.headers.set('Cache-Control', 'private, max-age=60');
  return res;
}

// Best shared lap per track for a car (Gallery and My Garage), one get.
async function trackBestsForCar(env, carId) {
  if (!carId) return [];
  var shared = await getJsonKey(env, 'track-public:' + carId, []);
  var best = {};
  shared.forEach(function (s) {
    var k = s.type === 'drag' ? 'drag:' + (s.venueId || s.venue) : s.type + ':' + (s.venueId || s.venue) + ':' + (s.layoutId || '');
    var score = trackScore(s);
    if (!score) return;
    if (!best[k] || score < trackScore(best[k])) best[k] = s;
  });
  return Object.keys(best).map(function (k) {
    var s = best[k];
    return { type: s.type, venue: s.venue, layout: s.layout || '', venueId: s.venueId, layoutId: s.layoutId, date: s.date, bestTime: s.bestTime, quarter: s.quarter, quarterSpeed: s.quarterSpeed, id: s.id };
  });
}

async function handleTrackBoard(request, env, drag) {
  var params = new URL(request.url).searchParams;
  var venue = trackId(params.get('venue')), layout = trackId(params.get('layout'));
  if (!venue || (drag !== true && !layout)) return json({ success: false, message: 'venue is required' }, 400);
  var key = drag === 'sprint' ? 'sprint-board:' + venue + ':' + layout : drag ? 'drag-board:' + venue : 'track-board:' + venue + ':' + layout;
  var res = json({ success: true, entries: await getJsonKey(env, key, []) });
  res.headers.set('Cache-Control', 'public, max-age=60');
  return res;
}

// The tyre makes and models: data/tyres.json is the starting list and the
// admin's changes (the Tyres panel on admin.html) sit on top of it in one KV key.
// Everything is read with get() only.
var TYRE_LIBRARY_KEY = 'tyre-library';

function cleanTyreSizes(list, lo, hi) {
  var out = [];
  (Array.isArray(list) ? list : []).slice(0, 80).forEach(function (v) {
    var n = trackNum(v, lo, hi);
    if (n !== null && out.indexOf(Math.round(n)) === -1) out.push(Math.round(n));
  });
  return out.sort(function (a, b) { return a - b; });
}

function cleanTyreLibrary(input) {
  input = input && typeof input === 'object' ? input : {};
  var seen = {}, makes = [];
  (Array.isArray(input.makes) ? input.makes : []).slice(0, 300).forEach(function (m) {
    var name = trackText(m && m.name, 40);
    if (!name || seen[name.toLowerCase()]) return;
    seen[name.toLowerCase()] = true;
    if (m.removed) { makes.push({ name: name, removed: true }); return; }
    var models = [], have = {};
    (Array.isArray(m.models) ? m.models : []).slice(0, 400).forEach(function (md) {
      var t = trackText(md, 60);
      if (t && !have[t.toLowerCase()]) { have[t.toLowerCase()] = true; models.push(t); }
    });
    makes.push({ name: name, models: models });
  });
  var out = { makes: makes };
  var w = cleanTyreSizes(input.widths, 100, 500), p = cleanTyreSizes(input.profiles, 15, 100), r = cleanTyreSizes(input.rims, 10, 30);
  if (w.length) out.widths = w;
  if (p.length) out.profiles = p;
  if (r.length) out.rims = r;
  return out;
}

async function handleTyresPublic(request, env) {
  var res = json({ success: true, extra: await getJsonKey(env, TYRE_LIBRARY_KEY, {}) });
  res.headers.set('Cache-Control', 'public, max-age=60');
  return res;
}

async function handleTyresAdmin(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  if (request.method === 'GET') return json({ success: true, extra: await getJsonKey(env, TYRE_LIBRARY_KEY, {}) });
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var library = cleanTyreLibrary(body && body.library);
  await env.VOTES.put(TYRE_LIBRARY_KEY, JSON.stringify(library));
  return json({ success: true, extra: library });
}

// ---------- Track Sessions welcome text ----------
// The card a visitor who is not signed in sees on track.html (heading, intro and tick list), editable on the
// Welcome text panel of admin.html. One KV key (track-copy), read with get(); empty means the page's built-in text.
var TRACK_COPY_KEY = 'track-copy';
function cleanTrackCopy(body) {
  var out = {}, heading = trackText(body && body.heading, 80), intro = trackText(body && body.intro, 600);
  if (heading) out.heading = heading;
  if (intro) out.intro = intro;
  var bullets = Array.isArray(body && body.bullets) ? body.bullets : String((body && body.bullets) || '').split(/\r?\n/);
  bullets = bullets.map(function (b) { return trackText(b, 120); }).filter(Boolean).slice(0, 8);
  if (bullets.length) out.bullets = bullets;
  return out;
}
async function handleTrackCopyPublic(request, env) {
  var res = json({ success: true, copy: await getJsonKey(env, TRACK_COPY_KEY, {}) });
  res.headers.set('Cache-Control', 'public, max-age=120');
  return res;
}
async function handleTrackCopyAdmin(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  if (request.method === 'GET') return json({ success: true, copy: await getJsonKey(env, TRACK_COPY_KEY, {}) });
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var copy = body && body.reset ? {} : cleanTrackCopy(body);
  if (Object.keys(copy).length) await env.VOTES.put(TRACK_COPY_KEY, JSON.stringify(copy));
  else await env.VOTES.delete(TRACK_COPY_KEY);
  return json({ success: true, copy: copy });
}

// ---------- Link preview pictures ----------
// The picture a shared link previews with, for the Track Sessions page (slot track) and the homepage (slot home).
// The admin saves pictures (a card drawn from a session, or a photo) to the bucket under share/<slot>/, each with
// a caption, in one KV key per slot read with get(): { rotate, current, version, items: [{ id, kind, file, caption,
// label, sessionId, at }] }. With rotation on, the week's picture is taken in turn; off, it is the chosen one. The
// share page build reads /share/<slot> and stamps the week into the picture's address; the share button puts the
// version (every change counts one) in the link, so chat apps fetch a fresh preview card.
var SHARE_SLOTS = { track: { key: 'track-share', prefix: 'share/track/' }, home: { key: 'home-share', prefix: 'share/home/' } };
var TRACK_SHARE_MAX_BYTES = 400000;
var TRACK_SHARE_MAX_ITEMS = 30;
function trackShareWeek(d) {
  // ISO week: the Thursday of the week decides the year.
  var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  var day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  var wk = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return { label: t.getUTCFullYear() + '-W' + (wk < 10 ? '0' : '') + wk, n: Math.floor(t.getTime() / (7 * 86400000)) };
}
function trackSharePick(state, now) {
  var items = state.items || [];
  if (!items.length) return null;
  if (!state.rotate) return items.filter(function (i) { return i.id === state.current; })[0] || items[0];
  return items[trackShareWeek(now).n % items.length];
}
// The public view (the share page build and the share buttons) carries each picture's address and caption only;
// the admin's view adds the label and which session a card was drawn from.
function trackShareView(state, admin) {
  var now = new Date(), pick = trackSharePick(state, now);
  function pub(i) {
    var o = { id: i.id, kind: i.kind, caption: i.caption || '', at: i.at, url: GALLERY_PUBLIC_BASE_URL + '/' + i.file };
    if (admin) { o.label = i.label || ''; o.sessionId = i.sessionId || ''; }
    return o;
  }
  return { rotate: !!state.rotate, current: state.current || '', version: state.version || 0, week: trackShareWeek(now).label, items: (state.items || []).map(pub), pick: pick ? pub(pick) : null };
}
async function getSharePictures(env, slot) {
  var state = await getJsonKey(env, SHARE_SLOTS[slot].key, {});
  if (!state || typeof state !== 'object') state = {};
  if (!Array.isArray(state.items)) state.items = [];
  return state;
}
async function putSharePictures(env, slot, state) {
  state.version = (state.version || 0) + 1;
  await env.VOTES.put(SHARE_SLOTS[slot].key, JSON.stringify(state));
  await triggerManifestRebuild(env, 'track-share');
}
async function handleSharePublic(request, env, slot) {
  var res = json(Object.assign({ success: true, slot: slot }, trackShareView(await getSharePictures(env, slot))));
  res.headers.set('Cache-Control', 'public, max-age=300');
  return res;
}
// Every slot's version in one answer, for the share buttons (two keys, both read with get()).
async function handleShareVersions(request, env) {
  var out = {}, slots = Object.keys(SHARE_SLOTS);
  for (var i = 0; i < slots.length; i++) out[slots[i]] = (await getSharePictures(env, slots[i])).version || 0;
  var res = json({ success: true, versions: out });
  res.headers.set('Cache-Control', 'public, max-age=300');
  return res;
}
async function handleShareAdmin(request, env, slot) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var state = await getSharePictures(env, slot);
  if (request.method === 'GET') return json(Object.assign({ success: true, slot: slot }, trackShareView(state, true)));
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var action = String((body && body.action) || ''), item = state.items.filter(function (i) { return i.id === body.id; })[0];
  if (action === 'rotate') state.rotate = !!body.on;
  else if (action === 'use' && item) { state.current = item.id; state.rotate = false; }
  else if (action === 'caption' && item) item.caption = trackText(body.caption, 200);
  else if (action === 'delete' && item) {
    state.items = state.items.filter(function (i) { return i !== item; });
    if (state.current === item.id) state.current = '';
    try { await env.GALLERY_BUCKET.delete(item.file); } catch (e) { /* the record is what matters */ }
  } else return json({ success: false, message: 'Unknown action' }, 400);
  await putSharePictures(env, slot, state);
  return json(Object.assign({ success: true, slot: slot }, trackShareView(state, true)));
}
async function handleShareImage(request, env, slot) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var form;
  try { form = await request.formData(); } catch (e) { return json({ success: false, message: 'Send the picture as a form upload' }, 400); }
  var file = form.get('file');
  if (!file || typeof file === 'string' || !file.arrayBuffer) return json({ success: false, message: 'No picture was sent' }, 400);
  if (!/^image\/(jpeg|png|webp)$/.test(file.type || '')) return json({ success: false, message: 'The picture must be a JPEG, PNG or WebP' }, 400);
  var bytes = await file.arrayBuffer();
  if (bytes.byteLength > TRACK_SHARE_MAX_BYTES) return json({ success: false, message: 'The picture must be under 400 KB: chat apps drop bigger previews' }, 413);
  var state = await getSharePictures(env, slot);
  if (state.items.length >= TRACK_SHARE_MAX_ITEMS) return json({ success: false, message: 'There are already ' + TRACK_SHARE_MAX_ITEMS + ' pictures. Delete one first.' }, 400);
  var id = randomToken().slice(0, 12), ext = file.type === 'image/png' ? '.png' : file.type === 'image/webp' ? '.webp' : '.jpg';
  var shareKey = SHARE_SLOTS[slot].prefix + id + ext;
  await env.GALLERY_BUCKET.put(shareKey, bytes, { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' } });
  var item = { id: id, kind: form.get('kind') === 'photo' ? 'photo' : 'session', file: shareKey, caption: trackText(form.get('caption'), 200), label: trackText(form.get('label'), 80), at: new Date().toISOString() };
  var sid = trackId(form.get('sessionId'));
  if (sid) item.sessionId = sid;
  state.items.push(item);
  await putSharePictures(env, slot, state);
  return json(Object.assign({ success: true, slot: slot, id: id }, trackShareView(state, true)));
}

// The admin picking a build gallery photo for a preview picture: the page draws it onto a canvas, so it comes through
// here with open CORS headers rather than straight from the public bucket. One object read, admin only.
async function handleShareGalleryPhoto(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var file = new URL(request.url).searchParams.get('file') || '';
  if (!/^[^\/\\]+\.(jpe?g|png|webp)$/i.test(file)) return json({ success: false, message: 'Not a gallery photo' }, 400);
  var obj = await env.GALLERY_BUCKET.get('gallery/' + file);
  if (!obj) return json({ success: false, message: 'That photo is not in the gallery' }, 404);
  return new Response(obj.body, { headers: { 'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=300' } });
}

async function handleTrackTracks(request, env) {
  var res = json({ success: true, extra: await getJsonKey(env, 'track-library', { venues: [] }) });
  res.headers.set('Cache-Control', 'public, max-age=60');
  return res;
}

async function handleTrackRequest(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var list = await getJsonKey(env, 'track-requests', []);
  var mineRecent = list.filter(function (r) { return r.from === email && !r.done; }).length;
  if (mineRecent >= 10) return json({ success: false, message: 'You already have requests waiting. We\'ll get to them soon.' }, 429);
  var outline = cleanNumArrays(body.outline, 2).slice(0, 400).map(function (p) { return p.slice(0, 2); });
  var req = {
    id: randomToken().slice(0, 12), at: new Date().toISOString(), from: email,
    kind: ['drag', 'sprint'].indexOf(body.kind) !== -1 ? body.kind : 'circuit', hill: body.kind === 'sprint' && !!body.hill,
    organizer: ['drag', 'sprint'].indexOf(body.kind) === 1 ? trackText(body.organizer, 40) : '',
    name: trackText(body.name, 60), note: trackText(body.note, 300),
    venueId: trackId(body.venueId), layoutId: trackId(body.layoutId), startLine: trackLine(body.startLine), finishLine: trackLine(body.finishLine), lapLength: trackNum(body.lapLength, 0, 30000),
    lat: trackNum(body.lat, -90, 90), lng: trackNum(body.lng, -180, 180), outline: outline
  };
  if (req.lat === null && outline.length) { req.lat = outline[0][0]; req.lng = outline[0][1]; }
  if (req.lat === null) return json({ success: false, message: 'Where is it? The request needs a position.' }, 400);
  // One waiting request per course is enough.
  if (req.venueId && list.some(function (r) { return !r.done && r.venueId === req.venueId && (r.layoutId || '') === (req.layoutId || '') && (r.organizer || '') === (req.organizer || ''); })) return json({ success: true });
  list.unshift(req);
  await env.VOTES.put('track-requests', JSON.stringify(list.slice(0, 200)));
  // A note to the admin, as for early access (best effort: the request is kept either way).
  try {
    var what = req.kind === 'drag' ? 'drag strip' : req.kind === 'sprint' ? 'sprint or hill climb course' : 'track';
    var subject = 'New ' + what + ' request: ' + (req.name || 'unnamed');
    var text = subscriberLabel(await publicNameFor(env, email), email) + ' has uploaded a session at a ' + what + ' MT3UK does not have yet.\n\n' +
      'Name: ' + (req.name || 'not given') + '\n' + (req.organizer ? 'Organiser: ' + req.organizer + '\n' : '') + (req.note ? 'Note: ' + req.note + '\n' : '') +
      (req.lat !== null ? 'Position: ' + req.lat.toFixed(4) + ', ' + req.lng.toFixed(4) + '\n' : '') +
      '\nApprove and add it, or dismiss it, on the Tracks panel: ' + MY_BUILDS_SITE_URL + '/track-admin.html#grp-tracks';
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, rawEmail(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, subject, text)));
  } catch (e) { /* the request is saved */ }
  return json({ success: true });
}

// A member adds the track, course or layout themselves from the Add a session page, instead of waiting for the
// admin: the same course "Approve and add track" would build from their lines, live at once and flagged for the
// admin's review (the request stays in the Admin bell, marked as added). Behind the early preview gate like saves.
async function handleTrackCourseAdd(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var sprint = body.kind === 'sprint';
  var outline = cleanNumArrays(body.outline, 2).slice(0, 400).map(function (p) { return p.slice(0, 2); });
  var req = {
    id: randomToken().slice(0, 12), at: new Date().toISOString(), from: email, added: true,
    kind: sprint ? 'sprint' : 'circuit', hill: sprint && !!body.hill, organizer: sprint ? trackText(body.organizer, 40) : '',
    name: trackText(body.name, 60), note: 'Added by the member: check the lines',
    venueId: trackId(body.venueId), layoutId: '', startLine: trackLine(body.startLine), finishLine: sprint ? trackLine(body.finishLine) : null, lapLength: trackNum(body.lapLength, 0, 30000),
    lat: trackNum(body.lat, -90, 90), lng: trackNum(body.lng, -180, 180), outline: outline
  };
  if (req.lat === null && outline.length) { req.lat = outline[0][0]; req.lng = outline[0][1]; }
  if (!req.name && !req.venueId) return json({ success: false, message: 'Enter the track name.' }, 400);
  if (!req.startLine || (sprint && !req.finishLine)) return json({ success: false, message: sprint ? 'The course needs a start and a finish line first.' : 'The track needs a start line first.' }, 400);
  if (req.lat === null) return json({ success: false, message: 'Where is it? The track needs a position.' }, 400);
  var list = await getJsonKey(env, 'track-requests', []);
  if (list.filter(function (r) { return r.from === email && !r.done; }).length >= 10) return json({ success: false, message: 'You already have tracks waiting for review. We\'ll get to them soon.' }, 429);
  var added = await addTrackFromRequest(env, req, { review: true });
  if (added.error) return json({ success: false, message: added.error }, 400);
  req.venueId = added.venueId; req.layoutId = added.layoutId;
  list.unshift(req);
  await env.VOTES.put('track-requests', JSON.stringify(list.slice(0, 200)));
  try {
    var what = sprint ? 'sprint or hill climb course' : 'track';
    var subject = 'New ' + what + ' added by a member: ' + req.name;
    var text = subscriberLabel(await publicNameFor(env, email), email) + ' has added a ' + what + ' to the list from their session, so it is live and timing sessions now.\n\n' +
      'Name: ' + req.name + '\n' + (req.organizer ? 'Organiser: ' + req.organizer + '\n' : '') + 'Position: ' + req.lat.toFixed(4) + ', ' + req.lng.toFixed(4) + '\n' +
      '\nCheck its lines on the Tracks panel and mark it reviewed: ' + MY_BUILDS_SITE_URL + '/track-admin.html#grp-tracks';
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, rawEmail(MY_BUILDS_FROM_EMAIL, SUBSCRIBERS_DIGEST_EMAIL, subject, text)));
  } catch (e) { /* the track is added */ }
  return json({ success: true, venueId: added.venueId, layoutId: added.layoutId, relinked: added.relinked, library: await getTrackLibrary(env) });
}
// The admin has looked at a member-added track: it is an ordinary listed track from here.
async function clearTrackReview(env, venueId) {
  var extra = await getJsonKey(env, 'track-library', { venues: [] });
  var v = (extra.venues || []).find(function (x) { return x.id === venueId; });
  if (!v || !v.review) return;
  delete v.review;
  await env.VOTES.put('track-library', JSON.stringify({ venues: extra.venues }));
}

async function handleTrackAdminTracks(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var extra = await getJsonKey(env, 'track-library', { venues: [] });
  if (request.method === 'GET') return json({ success: true, extra: extra, library: await getTrackLibrary(env) });
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var venues = (extra.venues || []).slice();
  if (body.remove) {
    var rid = trackId(body.remove);
    venues = venues.filter(function (v) { return v.id !== rid; });
    venues.push({ id: rid, removed: true });
  } else {
    var bv = body.venue;
    // A new entry whose name is already listed (the same place as a sprint, hill climb or track day) gets its own id
    // instead of overwriting the other one.
    if (bv && typeof bv === 'object' && !bv.id) {
      var lib = await getTrackLibrary(env), baseId = trackId(bv.name);
      if (baseId && lib.venues.some(function (x) { return x.id === baseId; })) {
        var kindId = bv.type === 'sprint' ? (bv.hill ? 'hill-climb' : 'sprint') : bv.type === 'drag' ? 'drag' : 'circuit', nid = baseId + '-' + kindId, n = 2;
        while (lib.venues.some(function (x) { return x.id === nid; })) nid = baseId + '-' + kindId + '-' + (n++);
        bv = Object.assign({}, bv, { id: nid });
      }
    }
    var v = cleanTrackVenue(bv);
    if (!v) return json({ success: false, message: 'A track needs a name and a centre (latitude and longitude).' }, 400);
    venues = venues.filter(function (x) { return x.id !== v.id; });
    venues.push(v);
  }
  await env.VOTES.put('track-library', JSON.stringify({ venues: venues }));
  var relinkedHand = 0;
  if (!body.remove) { try { relinkedHand = await relinkRequestsToVenue(env, v); } catch (err) { /* the course is saved either way */ } }
  return json({ success: true, relinked: relinkedHand, library: await getTrackLibrary(env) });
}

// The admin, from the Add a session page: makes the lines they just set the
// official ones for that course, straight away (no request to wait on). The
// admin viewer token proves who they are; the new course is linked to their
// own saved sessions the same way "Approve and add track" does it.
async function handleTrackAdminCourse(request, env) {
  if (!(await trackAdminOrViewer(request, env))) return json({ success: false, message: 'Unauthorised' }, 401);
  var email = await resolveSession(request, env);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var kind = ['sprint'].indexOf(body.kind) !== -1 ? 'sprint' : 'circuit';
  var req = {
    kind: kind, hill: kind === 'sprint' && !!body.hill, name: trackText(body.name, 60), organizer: kind === 'sprint' ? trackText(body.organizer, 40) : '',
    venueId: trackId(body.venueId), layoutId: body.replace ? trackId(body.layoutId) : '', replace: !!body.replace && !!body.layoutId,
    startLine: trackLine(body.startLine), finishLine: kind === 'sprint' ? trackLine(body.finishLine) : null,
    lapLength: trackNum(body.lapLength, 0, 30000), lat: trackNum(body.lat, -90, 90), lng: trackNum(body.lng, -180, 180), from: email || ''
  };
  if (req.lat === null || req.lng === null) return json({ success: false, message: 'Where is it? The course needs a position.' }, 400);
  var added = await addTrackFromRequest(env, req);
  if (added.error) return json({ success: false, message: added.error }, 400);
  return json({ success: true, relinked: added.relinked, venueId: added.venueId, layoutId: added.layoutId, library: await getTrackLibrary(env) });
}

async function handleTrackAdminRequests(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var list = await getJsonKey(env, 'track-requests', []);
  if (request.method === 'GET') {
    return json({ success: true, requests: list.map(function (r) { var o = Object.assign({}, r); o.from = maskEmailForAdmin(r.from); return o; }) });
  }
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var req = list.find(function (r) { return r.id === body.id; });
  if (!req) return json({ success: false, message: 'Request not found' }, 404);
  var relinked = 0, filled = false;
  if (body.action === 'add') {
    if (req.done) return json({ success: false, message: 'This request is already done.' }, 400);
    var added = await addTrackFromRequest(env, req);
    if (added.error) return json({ success: false, message: added.error }, 400);
    relinked = added.relinked; filled = !!added.filled;
    req.venueId = added.venueId; req.layoutId = added.layoutId;
  }
  req.done = body.action === 'approve' || body.action === 'add' ? 'approved' : 'dismissed';
  req.doneAt = new Date().toISOString();
  await env.VOTES.put('track-requests', JSON.stringify(list));
  if (req.added && req.venueId) await clearTrackReview(env, req.venueId);
  return json({ success: true, relinked: relinked, filled: filled, library: body.action === 'add' ? await getTrackLibrary(env) : undefined });
}

// Links a member's own saved sessions to a course: same kind, not on a course
// yet, and either the same venue name or a start line within 60 m of the
// request's. Returns how many were linked. Admin routes only.
async function linkMemberSessions(env, req, venue, layout) {
  var sprint = req.kind === 'sprint', relinked = 0, email = req.from;
  if (!email || !layout) return 0;
  var line = req.startLine || layout.startLine || null;
  var lib = await getTrackLibrary(env);
  // On a course that still exists. A session pointing at a course that was renamed or removed counts as unlinked.
  function onCourse(x) {
    if (!x.layoutId) return false;
    var v = (lib.venues || []).find(function (vv) { return vv.id === x.venueId; });
    return !!(v && (v.layouts || []).some(function (l) { return l.id === x.layoutId; }));
  }
  var index = await getJsonKey(env, 'track-index:' + (await ownerKey(email)), []);
  for (var i = 0; i < index.length; i++) {
    var e = index[i];
    if (e.type !== (sprint ? 'sprint' : 'track') || onCourse(e)) continue;
    var rec = await getTrackSession(env, e.id);
    if (!rec || onCourse(rec) || rec.street) continue;
    var oldBoard = trackBoardKey(rec);
    var near = line && rec.startLine && trackDist(rec.startLine[0], line[0]) <= 60 && trackDist(rec.startLine[1], line[1]) <= 60;
    var same = trackText(rec.venue, 60).toLowerCase() === String(venue.name || '').toLowerCase();
    // A renamed track still matches by place: the session started inside the venue's radius.
    var inside = !!(rec.origin && rec.origin.length === 2 && venue.lat != null && trackDist([venue.lat, venue.lng], rec.origin) <= (venue.radius || 1500));
    if (!near && !same && !inside) continue;
    if (req.organizer && rec.organizer && rec.organizer.toLowerCase() !== req.organizer.toLowerCase()) continue;
    rec.venueId = venue.id; rec.venue = venue.name; rec.layoutId = layout.id;
    rec.layout = layout.name;
    if (!(await putTrackSession(env, rec))) continue;
    await putTrackIndexes(env, email, rec);
    if (oldBoard && oldBoard !== trackBoardKey(rec)) await refreshTrackBoard(env, oldBoard, rec.carId);
    relinked++;
  }
  return relinked;
}

// The layout of a circuit that a lap of this length belongs to (within 12%), or its only layout (within 35%). Null when none.
function layoutByLength(layouts, length) {
  layouts = layouts || [];
  var best = null;
  if (length > 0) layouts.forEach(function (l) {
    var e = l.length ? Math.abs(length - l.length) / l.length : 1;
    if (e < 0.12 && (!best || e < best.e)) best = { l: l, e: e };
  });
  if (best) return best.l;
  // The only layout, unless the lap is clearly another length (over 35% out).
  var only = layouts.length === 1 ? layouts[0] : null;
  return only && (!(length > 0) || !only.length || Math.abs(length - only.length) / only.length <= 0.35) ? only : null;
}

// After the admin saves a course by hand: links the waiting or approved
// requests' members' sessions to it (the course for a sprint request is the
// one with the same organiser; for a circuit, the request's own layout).
async function relinkRequestsToVenue(env, venue) {
  var list = await getJsonKey(env, 'track-requests', []);
  var total = 0;
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (r.kind === 'drag' || !r.from || (r.venueId && r.venueId !== venue.id)) continue;
    if (!r.venueId && trackText(r.name, 60).toLowerCase() !== String(venue.name || '').toLowerCase() &&
      !(r.lat != null && r.lng != null && venue.lat != null && trackDist([venue.lat, venue.lng], [r.lat, r.lng]) <= (venue.radius || 1500))) continue;
    if ((r.kind === 'sprint') !== (venue.type === 'sprint')) continue;
    var layout = (venue.layouts || []).find(function (l) {
      return r.kind === 'sprint' ? !!r.organizer && String(l.organizer || l.name).toLowerCase() === r.organizer.toLowerCase() : l.id === r.layoutId;
    });
    // A track day at a place that was not listed has no layout of its own to name: the circuit just added by hand takes
    // it by lap length (within 12%), or as its only layout.
    if (!layout && r.kind !== 'sprint') layout = layoutByLength(venue.layouts, r.lapLength);
    // A sprint course renamed by hand (just "Course", no organiser): when it is the only one with no organiser, it is the one.
    if (!layout && r.kind === 'sprint') {
      var open = (venue.layouts || []).filter(function (l) { return !l.organizer; });
      if (open.length === 1) layout = open[0];
    }
    if (layout) total += await linkMemberSessions(env, r, venue, layout);
  }
  return total;
}

// "Approve and add track": makes the circuit or sprint course from what the
// member marked (the start and finish lines, the length and the position),
// then links that member's saved sessions for it to the new course so they
// reach the leaderboard. Admin only, so the list() free reads here are fine.
async function addTrackFromRequest(env, req, opts) {
  if (req.kind === 'drag') return { error: 'Drag strips are added by hand: they need a venue radius.' };
  if (!req.startLine) return { error: 'This request has no start line to build a course from.' };
  var sprint = req.kind === 'sprint';
  if (sprint && !req.finishLine) return { error: 'A sprint or hill climb needs a finish line, and this request has none.' };
  var extra = await getJsonKey(env, 'track-library', { venues: [] });
  var library = await getTrackLibrary(env);
  var venues = (extra.venues || []).slice();
  // A listed layout with no official line yet: the request fills it in.
  if (req.layoutId && req.venueId) {
    var lv = (library.venues || []).find(function (v) { return v.id === req.venueId; });
    var ll = lv && (lv.layouts || []).find(function (l) { return l.id === req.layoutId; });
    if (ll) {
      // req.replace: the admin moving a course's official lines on the map. A request never does.
      if (ll.startLine && !req.replace) return { error: 'That course already has official lines. Dismiss this request.' };
      var upd = JSON.parse(JSON.stringify(lv));
      var ul = upd.layouts.find(function (l) { return l.id === req.layoutId; });
      ul.startLine = req.startLine;
      if (sprint) ul.finishLine = req.finishLine;
      if (!ul.length && req.lapLength) ul.length = Math.round(req.lapLength);
      if (sprint && req.organizer && !ul.organizer) ul.organizer = req.organizer;
      var cleanV = cleanTrackVenue(upd);
      if (!cleanV) return { error: 'Could not update that course.' };
      venues = venues.filter(function (x) { return x.id !== cleanV.id; });
      venues.push(cleanV);
      await env.VOTES.put('track-library', JSON.stringify({ venues: venues }));
      var filledLayout = cleanV.layouts.find(function (l) { return l.id === req.layoutId; });
      return { venueId: cleanV.id, layoutId: req.layoutId, relinked: await linkMemberSessions(env, req, cleanV, filledLayout), filled: true };
    }
  }
  var existing = req.venueId ? (library.venues || []).find(function (v) { return v.id === req.venueId; }) : null;
  var wantType = sprint ? 'sprint' : 'circuit';
  if (existing && existing.type !== wantType) existing = null;
  // A request with no track picked (it was made before the track was listed) joins the listed one of the same kind
  // with its name, or that its position falls inside: a track day at a place that is also listed as a sprint joins
  // the circuit, not the sprint.
  if (!existing && !req.venueId && !(opts && opts.review)) {
    var rname = trackText(req.name, 60).toLowerCase();
    existing = (library.venues || []).find(function (v) {
      return v.type === wantType && rname && String(v.name || '').toLowerCase() === rname &&
        !(req.lat != null && req.lng != null && v.lat != null && trackDist([v.lat, v.lng], [req.lat, req.lng]) > Math.max(v.radius || 1500, 5000));
    }) ||
      (req.lat != null && req.lng != null ? (library.venues || []).find(function (v) { return v.type === wantType && v.lat != null && trackDist([v.lat, v.lng], [req.lat, req.lng]) <= (v.radius || 1500); }) : null) || null;
  }
  var layout = { name: (sprint && req.organizer) || trackText(req.name, 60) || (sprint ? 'Course' : 'Layout'), length: req.lapLength || 0, startLine: req.startLine, sectors: [], corners: [] };
  if (sprint) { layout.finishLine = req.finishLine; if (req.organizer) layout.organizer = req.organizer; }
  var venue;
  if (existing) {
    venue = JSON.parse(JSON.stringify(existing));
    venue.layouts = (venue.layouts || []).slice();
    // A layout listed by hand with no line yet (and the same length, or the only one) is filled in, not copied.
    var fill = sprint ? (req.organizer ? venue.layouts.find(function (l) { return !l.startLine && String(l.organizer || l.name).toLowerCase() === req.organizer.toLowerCase(); }) : null)
      : layoutByLength(venue.layouts.filter(function (l) { return !l.startLine; }), req.lapLength);
    if (fill) {
      fill.startLine = req.startLine;
      if (sprint) fill.finishLine = req.finishLine;
      if (!fill.length && req.lapLength) fill.length = Math.round(req.lapLength);
      layout = fill;
    } else {
      var base = trackId(layout.name) || 'course', lid = base, n = 2;
      while (venue.layouts.some(function (l) { return l.id === lid; })) lid = base + '-' + (n++);
      layout.id = lid;
      venue.layouts.push(layout);
    }
  } else {
    layout.id = (sprint && trackId(req.organizer)) || 'course';
    venue = { id: trackId(req.name), name: trackText(req.name, 60), type: wantType, lat: req.lat, lng: req.lng, radius: sprint ? 1500 : 2000, layouts: [layout] };
    // A sprint-type place named for a hill climb is listed as one (the admin can change it on the Tracks panel).
    if (sprint && (req.hill || /hill\s*-?\s*climb/i.test(req.name || ''))) venue.hill = true;
    if (!venue.id || !venue.name) return { error: 'The request needs a name to make a track.' };
    // The same place listed as another kind (a sprint and a track day) gets its own id, as when added by hand.
    var taken = (library.venues || []).find(function (v) { return v.id === venue.id; });
    if (taken && taken.type === wantType) return { error: 'A track called "' + taken.name + '" is already listed. Pick that track in the request or rename this one.' };
    var kindId = sprint ? 'sprint' : 'circuit', baseId = venue.id, nid = baseId, k = 1;
    while ((library.venues || []).some(function (v) { return v.id === nid; })) { nid = baseId + '-' + kindId + (k > 1 ? '-' + k : ''); k++; }
    venue.id = nid;
  }
  if (opts && opts.review) venue.review = true;
  var clean = cleanTrackVenue(venue);
  if (!clean) return { error: 'Could not build a track from this request.' };
  venues = venues.filter(function (x) { return x.id !== clean.id; });
  venues.push(clean);
  await env.VOTES.put('track-library', JSON.stringify({ venues: venues }));
  var made = clean.layouts.find(function (l) { return l.id === layout.id; }) || clean.layouts[clean.layouts.length - 1];
  var relinked = await linkMemberSessions(env, req, clean, made);
  return { venueId: clean.id, layoutId: made.id, relinked: relinked };
}

function maskEmailForAdmin(email) {
  var m = String(email || '').match(/^(.)(.*)(@.*)$/);
  return m ? m[1] + '***' + m[3] : '';
}

// "Why is this session not on a leaderboard?" The reasons, in plain words, for a session (a full record, or a
// summary from the member's list), given the track list and the board's entries (an array, or null when it has no
// board). Used for one session (the admin pastes a link) and for the list of every problem.
function trackBoardWhy(rec, lib, entries) {
  var venue = rec.venueId ? (lib.venues || []).find(function (v) { return v.id === rec.venueId; }) : null;
  var layout = venue ? (venue.layouts || []).find(function (l) { return l.id === rec.layoutId; }) : null;
  var key = trackBoardKey(rec), reasons = [], fixable = false;
  function bad(t) { reasons.push(t); fixable = true; }
  if (rec.type === 'other') reasons.push('Its type is Other, which is never on a leaderboard. The member can change the type in Session settings.');
  if (rec.street) reasons.push('It is an admin street run, which is never on a leaderboard.');
  if (rec.pendingCourse) bad('It was saved without times because its course ("' + rec.pendingCourse + '") is not listed yet. Approve the request on the Tracks panel.');
  if (rec.type === 'drag') {
    if (!rec.venueId) bad('No drag strip was matched.');
    else if (!rec.atVenue) reasons.push('The run was not at the strip, so it is not on its board.');
    if (rec.unlisted) bad('The strip is not listed yet (a request is waiting on the Tracks panel).');
  } else if (rec.type !== 'other') {
    if (!rec.venueId) bad('No track was matched (it says "' + (rec.venue || 'no name') + '"). Its track is not listed, so a request is waiting on the Tracks panel: Approve and add track links it.');
    else if (!venue) bad('Its track (' + rec.venueId + ') is no longer in the track list.');
    if (rec.venueId && venue && !rec.layoutId) bad('No layout or course was matched at ' + venue.name + ' (the lap length or start line did not fit a listed one). A layout request is waiting on the Tracks panel.');
    else if (rec.layoutId && venue && !layout) bad('Its layout (' + rec.layoutId + ') is no longer listed at ' + venue.name + '.');
    if (venue && rec.type === 'track' && venue.type !== 'circuit') bad(venue.name + ' is listed as a ' + (venue.type === 'sprint' ? (venue.hill ? 'hill climb' : 'sprint') : venue.type) + ', not a circuit, so a track day there belongs to a circuit entry of its own.');
    if (venue && rec.type === 'sprint' && venue.type !== 'sprint') bad(venue.name + ' is listed as a circuit, so a sprint there belongs to a sprint entry of its own.');
  }
  if (rec.privacy === 'private') reasons.push('Its sharing is "Only me", so it is not on any board. The member turns Shared on in Session settings.');
  if (rec.offBoard) reasons.push('It was taken off the leaderboard by the admin.');
  var score = rec.type === 'drag' ? rec.quarter : rec.bestTime;
  if (!score && rec.type !== 'other') bad('It has no timed ' + (rec.type === 'drag' ? 'quarter mile' : rec.type === 'sprint' ? 'run' : 'lap') + ', so there is nothing to rank.');
  var mine = entries ? entries.find(function (e) { return e.carId === rec.carId; }) : null;
  var tab = rec.type === 'drag' ? 'Drag' : rec.type === 'sprint' ? ((venue && venue.hill) || rec.hill || /hill\s*-?\s*climb/i.test((venue && venue.name) || rec.venue || '') ? 'Hill climb' : 'Sprint') : 'Track days';
  var onBoard = !!(mine && mine.sessionId === rec.id);
  if (key && mine && !onBoard) reasons.push('Its car is on the board, but with another session (' + (mine.date || '') + ', ' + (mine.time || mine.quarter || '') + '): each car shows only its fastest. This session still counts in the car\'s number of sessions and its bests by conditions and tyres.');
  var shared = rec.privacy !== 'private' && !rec.street && !rec.offBoard;
  if (key && shared && !mine && !fixable && score) { bad('Everything looks right, but the board has no entry for this car yet. Rebuild all leaderboards on the Tracks panel (or save the session again) to refresh it.'); }
  return { key: key, tab: tab, reasons: reasons, onBoard: onBoard, fixable: fixable && shared, venue: venue, layout: layout, mine: mine || null };
}

async function handleTrackAdminBoardCheck(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var raw = String(new URL(request.url).searchParams.get('id') || '');
  var m = raw.match(/[?&]s=([a-f0-9]{8,40})/) || raw.match(/\b([a-f0-9]{8,40})\b/);
  var rec = m ? await getTrackSession(env, m[1]) : null;
  if (!rec) return json({ success: false, message: 'No session with that link or id.' }, 404);
  var lib = await getTrackLibrary(env), key = trackBoardKey(rec);
  var entries = key ? await getJsonKey(env, key, []) : null;
  var why = trackBoardWhy(rec, lib, entries);
  var reasons = why.reasons.slice(), repairable = false;
  // The lists the board is built from: the member's list, and the car's shared list (what a board reads).
  if (key && rec.privacy !== 'private' && !rec.street && !rec.offBoard) {
    var shared = await getJsonKey(env, 'track-public:' + rec.carId, []);
    var inShared = shared.find(function (x) { return x.id === rec.id; });
    if (!inShared) { reasons.push('The car\'s shared list does not have this session, so a board cannot include it. Repair rebuilds the lists from the session.'); repairable = true; }
    else if (trackBoardKey(inShared) !== key) { reasons.push('The car\'s shared list has this session under another board (' + (trackBoardKey(inShared) || 'none') + '). Repair rebuilds the lists from the session.'); repairable = true; }
    var counts = await getJsonKey(env, 'track-board-counts', {});
    if (entries && entries.length && !(counts[key] > 0)) { reasons.push('The board has cars but the track list is not counting it, so the venue shows as having no sessions. Repair puts the count back.'); repairable = true; }
    if (why.fixable) repairable = true;
  }
  return json({
    success: true,
    session: { id: rec.id, type: rec.type, hill: !!rec.hill, venue: rec.venue || '', venueId: rec.venueId || '', layout: rec.layout || '', layoutId: rec.layoutId || '', privacy: rec.privacy || '', date: rec.date || '', bestTime: rec.bestTime || null, car: rec.carId },
    board: why.key || '', tab: why.tab, onBoard: why.onBoard, entries: entries ? entries.length : 0, reasons: reasons, repairable: repairable
  });
}

// Every session that was shared but is not on a leaderboard for a reason that can be fixed, with the reason, and every
// board whose list entry is missing from the track list's counts. Admin only, so the list() over members is fine
// (it reads each member's session list and each board once).
async function handleTrackAdminBoardProblems(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var lib = await getTrackLibrary(env);
  var idx = await env.VOTES.list({ prefix: 'track-index:', limit: 700 });
  var boards = {}, counts = await getJsonKey(env, 'track-board-counts', {});
  var total = 0, privateN = 0, onBoardN = 0, other = 0, problems = [], carNames = {}, sharedByCar = {};
  for (var i = 0; i < idx.keys.length; i++) {
    var sessions = await getJsonKey(env, idx.keys[i].name, []);
    for (var j = 0; j < sessions.length; j++) {
      var s = sessions[j];
      total++;
      if (s.privacy === 'private' || s.street) { privateN++; continue; }
      if (s.type === 'other') { other++; continue; }
      var key = trackBoardKey(s);
      if (key && !(key in boards)) boards[key] = await getJsonKey(env, key, []);
      var why = trackBoardWhy(s, lib, key ? boards[key] : null);
      if (why.onBoard || (why.mine && !why.fixable)) { onBoardN++; continue; }
      if (!why.fixable) continue;
      if (!(s.carId in carNames)) { var cr = await getCarRecord(env, s.carId); carNames[s.carId] = (cr && cr.name) || 'a build'; }
      // A session the car's shared list does not have cannot be on a board: say so (Repair rebuilds it).
      if (key && !(s.carId in sharedByCar)) sharedByCar[s.carId] = await getJsonKey(env, 'track-public:' + s.carId, []);
      if (key && !sharedByCar[s.carId].some(function (x) { return x.id === s.id; })) why.reasons.push('The car\'s shared list does not have this session, so a board cannot include it. Repair rebuilds the lists from the session.');
      problems.push({ id: s.id, carId: s.carId, board: why.key, car: carNames[s.carId], type: s.type === 'sprint' && why.tab === 'Hill climb' ? 'hill climb' : s.type, venue: s.venue || '', layout: s.layout || '', date: s.date || '', bestTime: s.bestTime || s.quarter || null, tab: why.tab, reasons: why.reasons.filter(function (t) { return !/Only me/.test(t); }) });
    }
  }
  problems.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  // A board with entries that the track list does not count: its venue shows as "No sessions yet", hidden by default.
  var hidden = Object.keys(boards).filter(function (k) { return boards[k].length && !(counts[k] > 0); }).map(function (k) { return k; });
  return json({ success: true, members: idx.keys.length, more: !idx.list_complete, sessions: total, privateOrStreet: privateN, other: other, onBoard: onBoardN, problems: problems.slice(0, 200), hiddenBoards: hidden });
}

// Brings one board (and the track list's count and top three for it) up to date: for one car, or for every car on it.
async function handleTrackAdminBoardRepair(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request body' }, 400); }
  var board = String((body && body.board) || '');
  // From a session: its own record is the truth, so the member's list, the car's shared list and the board are all
  // written again from it (the board then follows what the record says it belongs on).
  var sid = String((body && body.sessionId) || '');
  if (/^[a-f0-9]{8,40}$/.test(sid)) {
    var rec = await getTrackSession(env, sid);
    if (!rec) return json({ success: false, message: 'No session with that id.' }, 404);
    await putTrackIndexesFor(env, rec.owner, rec);
    var key = trackBoardKey(rec);
    if (key) board = key;
  }
  if (!/^((track|sprint)-board:[a-z0-9-]+:[a-z0-9-]+|drag-board:[a-z0-9-]+)$/.test(board)) return json({ success: false, message: sid ? 'That session does not belong on a board.' : 'Unknown board' }, 400);
  var cars = [];
  if (body.carId && /^[A-Za-z0-9_-]{1,80}$/.test(String(body.carId))) cars.push(String(body.carId));
  else (await getJsonKey(env, board, [])).forEach(function (e) { if (e.carId && cars.indexOf(e.carId) === -1) cars.push(e.carId); });
  cars = cars.slice(0, 60);
  for (var i = 0; i < cars.length; i++) await refreshTrackBoard(env, board, cars[i]);
  var counts = await getJsonKey(env, 'track-board-counts', {});
  return json({ success: true, refreshed: cars.length, count: counts[board] || 0 });
}

async function handleTrackAdminBoardEntry(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var params = new URL(request.url).searchParams;
  var board = String(params.get('board') || ''), sessionId = String(params.get('session') || '');
  if (!/^((track|sprint)-board:[a-z0-9-]+:[a-z0-9-]+|drag-board:[a-z0-9-]+)$/.test(board)) return json({ success: false, message: 'Unknown board' }, 400);
  var entries = await getJsonKey(env, board, []);
  var entry = entries.find(function (e) { return e.sessionId === sessionId; });
  if (!entry) return json({ success: false, message: 'Not on this leaderboard' }, 404);
  // Kept off the leaderboard; the session stays on the build.
  var rec = await getTrackSession(env, sessionId);
  if (rec) {
    rec.offBoard = true;
    await putTrackSession(env, rec);
  }
  var shared = await getJsonKey(env, 'track-public:' + entry.carId, []);
  shared.forEach(function (s) { if (s.id === sessionId) s.offBoard = true; });
  await env.VOTES.put('track-public:' + entry.carId, JSON.stringify(shared));
  await refreshTrackBoard(env, board, entry.carId);
  return json({ success: true });
}

async function handleTrackCounts(request, env) {
  var res = json({ success: true, counts: await getJsonKey(env, 'track-board-counts', {}), leaders: await getJsonKey(env, 'track-board-leaders', {}) });
  res.headers.set('Cache-Control', 'public, max-age=60');
  return res;
}

// Admin: rebuilds every leaderboard entry from the shared lists, a few cars at
// a time (call again with the cursor until it says done). Used after the board
// entries gained tyres and track parts. list() is fine here: admin only, and
// rarely used.
var TRACK_REBUILD_CARS = 2;
// Admin: bring saved sessions up to date after the timing code changes. The
// timing runs in the browser, so the admin page reads each session and its
// readings here, works it out again and posts it back. Admin only, so
// list() is fine here.
//   GET  /track/admin/retime?cursor=   a page of sessions: id, type, analysis version, readings kept
//   GET  /track/admin/retime?id=       one saved session
//   GET  /track/admin/retime/source?id=  its readings (gzipped)
//   POST /track/admin/retime           { id, session } replaces the timing, keeps the member's details
var TRACK_RETIME_PAGE = 20;
// The admin key, or the admin viewer token the session page holds (the admin moving one session's lines on the map).
async function trackAdminOrViewer(request, env) {
  return eventsAdminAuthorised(request, env) || await isAdminViewerToken(env, request.headers.get('X-Admin-Viewer'));
}

async function handleTrackAdminRetime(request, env) {
  if (!(await trackAdminOrViewer(request, env))) return json({ success: false, message: 'Unauthorised' }, 401);
  var params = new URL(request.url).searchParams;
  if (request.method === 'GET') {
    var one = params.get('id');
    // The list of every session uses KV list(), so it stays on the admin key.
    if (!one && !eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
    if (one) {
      if (!/^[a-f0-9]{8,40}$/.test(one)) return json({ success: false, message: 'Session not found' }, 404);
      var found = await getTrackSession(env, one);
      return found ? json({ success: true, session: found }) : json({ success: false, message: 'Session not found' }, 404);
    }
    var page = await env.VOTES.list({ prefix: 'track-session:', limit: TRACK_RETIME_PAGE, cursor: params.get('cursor') || undefined });
    var recs = (await Promise.all(page.keys.map(function (k) { return getTrackSession(env, k.name.slice('track-session:'.length)); }))).filter(Boolean);
    // Whose each is, as members see them, so the admin's pickers can say: one lookup per car, all at once, and a
    // lookup that fails leaves the name blank rather than failing the page.
    var owners = {};
    await Promise.all(recs.map(function (r) { return r.carId; }).filter(function (c, i, a) { return c && a.indexOf(c) === i; }).map(async function (carId) {
      try {
        var car = await getCarRecord(env, carId), email = car ? await carOwnerEmail(env, car) : null;
        owners[carId] = email ? (publicName(await getProfileRecord(env, email)) || 'MT3UK member') : 'MT3UK member';
      } catch (e) { owners[carId] = ''; }
    }));
    var rows = recs.map(function (rec) {
      return { id: rec.id, type: rec.type, venue: rec.venue || '', date: rec.date || '', best: rec.bestTime || null, version: rec.analysisVersion || 1, hasSource: !!rec.hasSource, street: !!rec.street, privacy: rec.privacy || 'private', owner: owners[rec.carId] || '', venueId: rec.venueId || '', layoutId: rec.layoutId || '' };
    });
    return json({ success: true, sessions: rows, done: !!page.list_complete, cursor: page.list_complete ? '' : page.cursor });
  }
  var body;
  try {
    var buf = await request.arrayBuffer();
    var gzipped = isGzip(buf);
    if (buf.byteLength > (gzipped ? TRACK_SESSION_MAX_BYTES : TRACK_UNZIPPED_MAX_BYTES)) return json({ success: false, message: 'This session is too big to save.' }, 413);
    body = JSON.parse(gzipped ? await gunzipText(buf, TRACK_UNZIPPED_MAX_BYTES) : new TextDecoder().decode(buf));
  } catch (e) {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }
  if (!body || typeof body !== 'object' || !/^[a-f0-9]{8,40}$/.test(String(body.id || ''))) return json({ success: false, message: 'Invalid request body' }, 400);
  var old = await getTrackSession(env, String(body.id));
  if (!old) return json({ success: false, message: 'Session not found' }, 404);
  var next = cleanTrackSession(body.session, await getTrackLibrary(env));
  if (next.error) return json({ success: false, message: next.error }, 400);
  next.id = old.id;
  next.owner = old.owner;
  next.carId = old.carId;
  next.createdAt = old.createdAt;
  // Street runs and runs at an unlisted strip stay private and off every board.
  next.street = !!old.street;
  if (next.type === 'drag') {
    if (old.unlisted || (!next.atVenue && !old.street)) next.unlisted = true;
    if (!old.street) delete next.outline;
  }
  ['privacy', 'conditions', 'tyres', 'tyreMake', 'tyreModel', 'tyreWidth', 'tyreProfile', 'tyreRim', 'temp', 'tempSource', 'weather', 'notes', 'hasSource', 'readingsRefused', 'fileName'].forEach(function (k) { if (old[k] !== undefined) next[k] = old[k]; });
  // The saved readings carry no car channels, so a re-time cannot work the Track Mode figures out again: keep the ones the upload made.
  if (old.carData && !next.carData) next.carData = old.carData;
  if (old.carSource && !next.carSource) next.carSource = old.carSource;
  if (next.street || next.unlisted) next.privacy = 'private';
  if (next.privacy === 'board' && !trackBoardKey(next)) next.privacy = 'build';
  var oldBoard = trackBoardKey(old);
  if (!(await putTrackSession(env, next))) return json({ success: false, message: 'This session is too big to save.' }, 413);
  await putTrackIndexesFor(env, old.owner, next);
  if (oldBoard && oldBoard !== trackBoardKey(next)) await refreshTrackBoard(env, oldBoard, next.carId);
  return json({ success: true, session: trackSummary(next) });
}

async function handleTrackAdminRetimeSource(request, env) {
  if (!(await trackAdminOrViewer(request, env))) return json({ success: false, message: 'Unauthorised' }, 401);
  var id = String(new URL(request.url).searchParams.get('id') || '');
  if (!/^[a-f0-9]{8,40}$/.test(id)) return json({ success: false, message: 'Session not found' }, 404);
  var buf = await env.VOTES.get('track-source:' + id, 'arrayBuffer');
  if (!buf) return json({ success: false, message: 'No readings were kept for this session.' }, 404);
  // As a plain file of the stored gzip bytes, not Content-Encoding: nothing on the way can re-encode a large one
  // and leave the browser unable to read it. The admin page unzips it itself.
  return new Response(buf, { status: 200, headers: { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

async function handleTrackBoardsRebuild(request, env) {
  if (!eventsAdminAuthorised(request, env)) return json({ success: false, message: 'Unauthorised' }, 401);
  var params = new URL(request.url).searchParams;
  var cursor = params.get('cursor') || undefined;
  var page = await env.VOTES.list({ prefix: 'track-public:', limit: TRACK_REBUILD_CARS, cursor: cursor });
  var done = 0;
  for (var i = 0; i < page.keys.length; i++) {
    var carId = page.keys[i].name.slice('track-public:'.length);
    var shared = await getJsonKey(env, page.keys[i].name, []);
    var boards = {};
    shared.forEach(function (s) { var k = trackBoardKey(s); if (k) boards[k] = true; });
    var keys = Object.keys(boards);
    for (var b = 0; b < keys.length; b++) await refreshTrackBoard(env, keys[b], carId);
    done++;
  }
  return json({ success: true, cars: done, done: !!page.list_complete, cursor: page.list_complete ? '' : page.cursor });
}

// A member leaving: their sessions, index, shared lists and board places.
async function deleteMemberTrackData(env, email) {
  // Off the early preview lists too.
  var acc = await getTrackAccess(env), em = accessEmail(email);
  if (acc.allowed.some(function (x) { return x.email === em; }) || acc.pending.some(function (x) { return x.email === em; })) {
    acc.allowed = acc.allowed.filter(function (x) { return x.email !== em; });
    acc.pending = acc.pending.filter(function (x) { return x.email !== em; });
    await putTrackAccess(env, acc);
  }
  var oKey = 'track-index:' + (await ownerKey(email));
  var index = await getJsonKey(env, oKey, []);
  var cars = {};
  for (var i = 0; i < index.length; i++) {
    await env.VOTES.delete('track-session:' + index[i].id);
    await env.VOTES.delete('track-source:' + index[i].id);
    cars[index[i].carId] = true;
  }
  await env.VOTES.delete(oKey);
  var carIds = Object.keys(cars);
  for (var c = 0; c < carIds.length; c++) await deleteCarTrackData(env, carIds[c]);
}

// A car going: its shared list and board places (the sessions stay with
// the member).
async function deleteCarTrackData(env, carId) {
  var shared = await getJsonKey(env, 'track-public:' + carId, null);
  if (!shared) return;
  await env.VOTES.delete('track-public:' + carId);
  var boards = {};
  shared.forEach(function (s) { var k = trackBoardKey(s); if (k) boards[k] = true; });
  var keys = Object.keys(boards);
  for (var i = 0; i < keys.length; i++) await refreshTrackBoard(env, keys[i], carId);
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

  // Model and the mods list from the builder (js/mods-builder.js). The
  // public mods list on every photo is made from the specs.
  var details = null;
  var hasModel = body && ('model' in body || 'version' in body || 'year' in body);
  var hasSpecs = body && body.specs && typeof body.specs === 'object';
  if (hasModel || hasSpecs || (body && Array.isArray(body.plans))) {
    details = (await getCarDetails(env, realCarId)) || {};
    if (hasModel) {
      // Only the ones sent change; an empty one clears it.
      var model = cleanCarModel(body);
      ['model', 'version', 'year'].forEach(function (k) {
        if (!(k in body)) return;
        if (model[k] !== undefined) details[k] = model[k];
        else delete details[k];
      });
    }
    if (hasSpecs) {
      details.specs = cleanSpecs(body.specs);
      var specMods = specsToMods(details.specs);
      record.mods = specMods;
      await Promise.all(photos.map(function (f) { return setSidecarMods(env, f, specMods); }));
    }
    if (body && Array.isArray(body.plans)) details.plans = cleanPlans(body.plans);
    details.updatedAt = new Date().toISOString();
    await saveCarDetails(env, realCarId, details);
  }

  await saveCarRecord(env, record);
  await triggerManifestRebuild(env);

  var carOut = Object.assign({}, record);
  if (details) {
    ['model', 'version', 'year', 'specs', 'plans'].forEach(function (k) { if (details[k] !== undefined) carOut[k] = details[k]; });
  }
  var viewDetails = details || (await getCarDetails(env, realCarId));
  carOut.view = specsToView(viewDetails && viewDetails.specs, true, record.mods);
  return json({ success: true, car: carOut });
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

  // Check the target build is the member's before changing anything. Car
  // records no longer hold an email (saveCarRecord strips it), so ownership
  // comes from the member's own photos, as in carBelongsTo.
  var targetRecord = null;
  if (targetCarId !== 'new' && targetCarId !== LEGACY_VIRTUAL_CAR_ID) {
    targetRecord = await carBelongsTo(env, email, targetCarId);
    if (!targetRecord) {
      return json({ success: false, message: 'That build is not linked to your account' }, 403);
    }
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

  if (!file || typeof file === 'string') {
    return json({ success: false, message: 'Photo is required' }, 400);
  }
  if (file.size > 10 * 1024 * 1024) {
    return json({ success: false, message: 'Photo must be under 10MB' }, 400);
  }
  if (!file.type || file.type.indexOf('image/') !== 0) {
    return json({ success: false, message: 'File must be an image' }, 400);
  }
  // One entry per member in the weekly vote: if they already have one, it
  // stays and the new photo isn't entered (they can switch in My Garage).
  var keptEntry = null;
  if (votable) {
    var entryManifest = await listGalleryEntriesFromR2(env).catch(function () { return []; });
    keptEntry = memberVoteEntry(entryManifest, voteWeekString(new Date()), await ownerKey(email));
    if (keptEntry) {
      if (!gallery && !reel) {
        return json({ success: false, message: 'You already have a build in this week’s vote. Turn on Gallery or Reel for this photo, or switch your vote entry in My Garage.' }, 400);
      }
      votable = false;
    }
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

    var uploaderName = profileFullName(await getProfile(env, email));
    var uploaderPublicName = publicName(await getProfileRecord(env, email));
    var sidecar = { email: email };
    if (uploaderPublicName) sidecar.name = uploaderPublicName;
    if (mods.length) sidecar.mods = mods;
    if (!gallery) sidecar.gallery = false;
    if (!reel) sidecar.reel = false;
    if (!votable) sidecar.votable = false;
    await putSidecar(env, 'gallery/' + filename + '.json', sidecar);

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
            title: 'My Builds upload: ' + (caption || filename),
            body: '**Caption:** ' + (caption || '(none)') + '\n**Submitted by (account):** ' + publicLabel(uploaderName, email) +
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
    try {
      await notifyFriendsOfBuild(env, email, filename, caption);
    } catch (friendErr) {
      console.log('Friend build alerts failed (non-critical):', friendErr.message);
    }

    var result = { success: true, file: filename };
    if (keptEntry) {
      result.voteNote = (keptEntry.caption ? titleCaseWords(keptEntry.caption) : 'Your other build') +
        ' stays as your entry in this week’s vote. You can switch to this photo in My Garage.';
    }
    return json(result);
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

  await deleteMemberPhoto(env, email, file);
  await triggerManifestRebuild(env);

  return json({ success: true, deleted: file });
}

// Deletes one of a member's photos and everything kept about it. The caller
// rebuilds the gallery manifest.
async function deleteMemberPhoto(env, email, file) {
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

  var todayStr = voteWeekString(new Date());
  await env.VOTES.delete('votes:' + todayStr + ':' + file);
  await env.VOTES.delete('likes:' + file);

  try {
    await clearFeaturedIfMatches(env, file);
  } catch (e) {
    console.log('Clearing featured build failed (non-critical):', e.message);
  }
}

async function handleMyBuildsNotificationsGet(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var list = await getNotifications(env, email);
  var unread = list.reduce(function (n, item) { return item.read ? n : n + 1; }, 0);
  // Unread messages (from MT3UK and friends) are counted in Profile.
  var counts = await unreadCounts(env, email);
  return json({ success: true, notifications: list, unread: unread, messagesUnread: counts.broadcasts + counts.direct });
}

async function handleMyBuildsNotificationsRead(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var list = await getNotifications(env, email);
  list.forEach(function (item) { item.read = true; });
  await env.VOTES.put(notificationsKey(email), JSON.stringify(list));

  return json({ success: true });
}

// Clears notifications from the member's list: one ({ id }) or all
// ({ all: true }). A single key get/put, like the rest of notifications.
async function handleMyBuildsNotificationsClear(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);

  var body = {};
  try { body = await request.json(); } catch (e) {}
  var list = await getNotifications(env, email);
  if (body && body.all === true) {
    list = [];
  } else if (body && typeof body.id === 'string' && body.id) {
    list = list.filter(function (item) { return item.id !== body.id; });
  } else {
    return json({ success: false, message: 'id or all is required' }, 400);
  }
  await env.VOTES.put(notificationsKey(email), JSON.stringify(list));
  var unread = list.reduce(function (n, item) { return item.read ? n : n + 1; }, 0);
  return json({ success: true, unread: unread, remaining: list.length });
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

  // Build of the Week: the week's vote closes at midnight going into Monday.
  var todayStr = ukDateString(now);
  if (voteWeekString(now) !== todayStr) return;
  var closedDay = addDaysToDateString(todayStr, -7);
  var prefix = 'votes:' + closedDay + ':';

  var list = await env.VOTES.list({ prefix: prefix });
  if (!list.keys.length) return;

  var counts = [];
  var winnerVotes = 0;
  for (var i = 0; i < list.keys.length; i++) {
    var key = list.keys[i];
    var count = parseInt((await env.VOTES.get(key.name)) || '0', 10);
    counts.push({ file: key.name.slice(prefix.length), votes: count });
  }
  // Only members' current entries count (one per member), in case a
  // member had more than one photo open for the vote.
  try {
    var entryFiles = {};
    voteEntries(await listGalleryEntriesFromR2(env), closedDay).forEach(function (p) { entryFiles[p.file] = true; });
    counts = counts.filter(function (c) { return entryFiles[c.file]; });
  } catch (e) {}
  counts.forEach(function (c) { if (c.votes > winnerVotes) winnerVotes = c.votes; });
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
        message: 'Feature ' + winnerFile + ' as Build of the Week (week of ' + closedDay + ')',
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
    if (url.pathname === '/likes/who' && request.method === 'GET') {
      return handleLikersGet(request, env);
    }
    if (url.pathname === '/likes' && request.method === 'POST') {
      return handleLikePost(request, env, ctx);
    }
    if (url.pathname === '/events/admin' && request.method === 'GET') {
      return handleEventsAdminList(request, env);
    }
    if (url.pathname === '/events/admin' && request.method === 'POST') {
      return handleEventsAdminSave(request, env);
    }
    if (url.pathname === '/events/admin' && request.method === 'DELETE') {
      return handleEventsAdminDelete(request, env);
    }
    if (url.pathname === '/events/pages/admin' && request.method === 'GET') {
      return handleEventPagesAdminList(request, env);
    }
    if (url.pathname === '/events/pages/admin/save' && request.method === 'POST') {
      return handleEventPagesAdminSave(request, env);
    }
    if (url.pathname === '/events/pages/admin/action' && request.method === 'POST') {
      return handleEventPagesAdminAction(request, env);
    }
    if (url.pathname === '/events/pages/admin/image' && request.method === 'POST') {
      return handleEventPagesImage(request, env);
    }
    if (url.pathname === '/events/pages/admin/preview-link' && request.method === 'POST') {
      return handleEventPreviewMint(request, env);
    }
    if (url.pathname === '/admin/viewer-token' && request.method === 'POST') {
      return handleAdminViewerToken(request, env);
    }
    if (url.pathname === '/admin/viewer-check' && request.method === 'GET') {
      return handleAdminViewerCheck(request, env);
    }
    if (url.pathname === '/events/pages/preview/session' && request.method === 'POST') {
      return handleEventPreviewSession(request, env);
    }
    if (url.pathname === '/interviews/preview/session' && request.method === 'POST') {
      return handleInterviewPreviewSession(request, env);
    }
    if (url.pathname === '/events/pages/preview/request' && request.method === 'POST') {
      return handleEventPreviewRequest(request, env);
    }
    if (url.pathname === '/events/pages/preview/verify' && request.method === 'POST') {
      return handleEventPreviewVerify(request, env);
    }
    if (url.pathname === '/events/pages/admin/preview' && request.method === 'GET') {
      return handleEventPreviewAdminList(request, env);
    }
    if (url.pathname === '/events/pages/admin/preview' && request.method === 'POST') {
      return handleEventPreviewAdminSave(request, env);
    }
    if (url.pathname === '/events/pages/preview/link' && request.method === 'POST') {
      return handleEventPreviewLink(request, env);
    }
    if (url.pathname === '/events/pages/preview/check' && request.method === 'GET') {
      return handleEventPreviewCheck(request, env);
    }
    if (url.pathname === '/events/pages/preview/content' && request.method === 'GET') {
      return handleEventPreviewContent(request, env);
    }
    if (url.pathname === '/interviews/admin' && request.method === 'GET') {
      return handleInterviewsAdminList(request, env);
    }
    if (url.pathname === '/interviews/admin/action' && request.method === 'POST') {
      return handleInterviewsAdminAction(request, env);
    }
    if (url.pathname === '/interviews/admin' && request.method === 'POST') {
      return handleInterviewsAdminSave(request, env);
    }
    if (url.pathname === '/profile' && request.method === 'GET') {
      return handleProfileGet(request, env);
    }
    if (url.pathname === '/profile' && request.method === 'POST') {
      return handleProfileUpdate(request, env);
    }
    if (url.pathname === '/profile/leave' && request.method === 'POST') {
      return handleProfileLeave(request, env);
    }
    if (url.pathname === '/email/unsubscribe' && (request.method === 'GET' || request.method === 'POST')) {
      return handleEmailUnsubscribe(request, env);
    }
    if (url.pathname === '/profile/apps' && request.method === 'GET') {
      return handleProfileApps(request, env);
    }
    if (url.pathname === '/profile/nickname' && request.method === 'GET') {
      return handleNicknameCheck(request, env);
    }
    if (url.pathname === '/profile/search' && request.method === 'GET') {
      return handleProfileSearch(request, env);
    }
    if (url.pathname === '/profile/friends' && request.method === 'POST') {
      return handleProfileFriends(request, env, ctx);
    }
    if (url.pathname === '/profile/messages' && request.method === 'GET') {
      return handleProfileMessages(request, env);
    }
    if (url.pathname === '/profile/messages/read' && request.method === 'POST') {
      return handleProfileMessagesRead(request, env);
    }
    if (url.pathname === '/profile/messages/thread' && request.method === 'GET') {
      return handleProfileThread(request, env);
    }
    if (url.pathname === '/profile/messages/send' && request.method === 'POST') {
      return handleProfileMessageSend(request, env);
    }
    if (url.pathname === '/profile/messages/react' && request.method === 'POST') {
      return handleProfileMessageReact(request, env);
    }
    if (url.pathname === '/profile/messages/photo' && request.method === 'GET') {
      return handleProfileMessagePhoto(request, env);
    }
    if (url.pathname === '/admin/dm-photo' && request.method === 'GET') {
      return handleAdminDmPhoto(request, env);
    }
    if (url.pathname === '/profile/messages/report' && request.method === 'POST') {
      return handleProfileMessageReport(request, env);
    }
    if (url.pathname === '/admin/broadcasts' && request.method === 'GET') {
      return handleAdminBroadcastsGet(request, env);
    }
    if (url.pathname === '/admin/broadcasts' && request.method === 'POST') {
      return handleAdminBroadcastSave(request, env);
    }
    if (url.pathname === '/admin/broadcasts/test' && request.method === 'POST') {
      return handleAdminBroadcastTest(request, env);
    }
    if (url.pathname === '/admin/broadcasts/email-one' && request.method === 'POST') {
      return handleAdminBroadcastEmailOne(request, env);
    }
    if (url.pathname === '/admin/broadcasts/email' && request.method === 'POST') {
      return handleAdminBroadcastEmail(request, env);
    }
    if (url.pathname === '/admin/dm-reports' && request.method === 'POST') {
      return handleAdminDmReports(request, env);
    }
    if (url.pathname === '/interviews/preview/request' && request.method === 'POST') {
      return handleInterviewPreviewRequest(request, env);
    }
    if (url.pathname === '/interviews/preview/verify' && request.method === 'POST') {
      return handleInterviewPreviewVerify(request, env);
    }
    if (url.pathname === '/interviews/preview/link' && request.method === 'POST') {
      return handleInterviewPreviewLink(request, env);
    }
    if (url.pathname === '/interviews/preview/check' && request.method === 'GET') {
      return handleInterviewPreviewCheck(request, env);
    }
    if (url.pathname === '/interviews/admin/preview' && request.method === 'GET') {
      return handleInterviewPreviewAdminList(request, env);
    }
    if (url.pathname === '/interviews/admin/preview' && request.method === 'POST') {
      return handleInterviewPreviewAdminSave(request, env);
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
    if (url.pathname === '/gallery/live' && request.method === 'GET') {
      return handleGalleryLive(request, env, ctx);
    }
    if (url.pathname === '/gallery/admin/reports' && request.method === 'GET') {
      return handlePhotoReportsAdminList(request, env);
    }
    if (url.pathname === '/gallery/admin/reports/dismiss' && request.method === 'POST') {
      return handlePhotoReportsAdminDismiss(request, env);
    }
    if (url.pathname === '/admin/vote-entries' && request.method === 'GET') {
      return handleAdminVoteEntries(request, env);
    }
    if (url.pathname === '/admin/vote-entries' && request.method === 'POST') {
      return handleAdminVoteEntryUpdate(request, env);
    }
    if (url.pathname === '/gallery/admin/photo' && request.method === 'DELETE') {
      return handleGalleryAdminPhotoDelete(request, env);
    }
    if (url.pathname === '/gallery/claim' && request.method === 'POST') {
      return handleGalleryClaim(request, env);
    }
    if (url.pathname === '/admin/run-tests' && request.method === 'POST') {
      return handleRunTests(request, env);
    }
    if (url.pathname === '/gallery/admin/claims' && request.method === 'GET') {
      return handleGalleryClaimsAdminList(request, env);
    }
    if (url.pathname === '/gallery/admin/claims' && request.method === 'DELETE') {
      return handleGalleryClaimsAdminRemove(request, env);
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
    if (url.pathname === '/gallery/admin/subscribers/link' && request.method === 'POST') {
      return handleGalleryAdminSubscriberLink(request, env);
    }
    if (url.pathname === '/gallery/admin/subscribers/name' && request.method === 'POST') {
      return handleGalleryAdminSubscriberName(request, env);
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
    if (url.pathname === '/my-builds/join' && request.method === 'POST') {
      return handleMyBuildsJoin(request, env);
    }
    if (url.pathname === '/session/refresh' && request.method === 'GET') {
      return handleSessionRefresh(request, env);
    }
    if (url.pathname === '/session/sign-out-all' && request.method === 'POST') {
      return handleSessionSignOutAll(request, env);
    }
    if (url.pathname === '/passkey/register/options' && request.method === 'POST') {
      return handlePasskeyRegisterOptions(request, env);
    }
    if (url.pathname === '/passkey/register/verify' && request.method === 'POST') {
      return handlePasskeyRegisterVerify(request, env);
    }
    if (url.pathname === '/passkey/login/options' && request.method === 'POST') {
      return handlePasskeyLoginOptions(request, env);
    }
    if (url.pathname === '/passkey/login/verify' && request.method === 'POST') {
      return handlePasskeyLoginVerify(request, env);
    }
    if (url.pathname === '/passkey/list' && request.method === 'GET') {
      return handlePasskeyList(request, env);
    }
    if (url.pathname === '/passkey/delete' && request.method === 'POST') {
      return handlePasskeyDelete(request, env);
    }
    if (url.pathname === '/my-builds/verify-code' && request.method === 'POST') {
      return handleMyBuildsVerifyCode(request, env);
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
    if (url.pathname === '/cars/public' && request.method === 'GET') {
      return handleCarPublic(request, env);
    }
    if (url.pathname === '/track/access' && request.method === 'GET') {
      return handleTrackAccess(request, env);
    }
    if (url.pathname === '/track/access/request' && request.method === 'POST') {
      return handleTrackAccessRequest(request, env);
    }
    if (url.pathname === '/track/access/admin' && (request.method === 'GET' || request.method === 'POST')) {
      return handleTrackAccessAdmin(request, env);
    }
    if (url.pathname === '/track/admin/course' && request.method === 'POST') {
      return handleTrackAdminCourse(request, env);
    }
    if (url.pathname === '/track/admin/boardcheck' && request.method === 'GET') {
      return handleTrackAdminBoardCheck(request, env);
    }
    if (url.pathname === '/track/admin/boardrepair' && request.method === 'POST') {
      return handleTrackAdminBoardRepair(request, env);
    }
    if (url.pathname === '/track/admin/boardproblems' && request.method === 'GET') {
      return handleTrackAdminBoardProblems(request, env);
    }
    if (url.pathname === '/track/admin/sessions' && request.method === 'GET') {
      return handleTrackAdminSessions(request, env);
    }
    if (url.pathname === '/track/admin/session' && request.method === 'POST') {
      return handleTrackAdminSessionRename(request, env);
    }
    if (url.pathname === '/track/admin/retime' && (request.method === 'GET' || request.method === 'POST')) {
      return handleTrackAdminRetime(request, env);
    }
    if (url.pathname === '/track/admin/retime/source' && request.method === 'GET') {
      return handleTrackAdminRetimeSource(request, env);
    }
    // The member's own sessions need access (early preview): lists, saves,
    // changes, readings and deletes. Shared sessions and boards stay public.
    if ((url.pathname === '/track/sessions' || url.pathname === '/track/session/source' || url.pathname === '/track/courses' ||
        url.pathname === '/track/lines/status' || url.pathname === '/track/lines/request' || url.pathname === '/track/lines/propose' || (url.pathname === '/track/lines/image' && request.method === 'POST') ||
        (url.pathname === '/track/session' && request.method !== 'GET')) && request.method !== 'OPTIONS') {
      var noAccess = await trackAccessGate(request, env);
      if (noAccess) return noAccess;
    }
    if (url.pathname === '/track/sessions' && request.method === 'GET') {
      return handleTrackSessionsList(request, env);
    }
    if (url.pathname === '/track/sessions' && request.method === 'POST') {
      return handleTrackSessionSave(request, env);
    }
    if (url.pathname === '/track/session' && request.method === 'GET') {
      return handleTrackSessionGet(request, env);
    }
    if (url.pathname === '/track/session' && request.method === 'PUT') {
      return handleTrackSessionUpdate(request, env);
    }
    if (url.pathname === '/track/lines/status' && request.method === 'GET') {
      return handleTrackLinesStatus(request, env);
    }
    if (url.pathname === '/track/lines/request' && request.method === 'POST') {
      return handleTrackLinesRequest(request, env);
    }
    if (url.pathname === '/track/lines/image' && (request.method === 'POST' || request.method === 'GET')) {
      return handleTrackLinesImage(request, env);
    }
    if (url.pathname === '/track/lines/propose' && request.method === 'POST') {
      return handleTrackLinesPropose(request, env);
    }
    if (url.pathname === '/track/lines/admin' && (request.method === 'GET' || request.method === 'POST')) {
      return handleTrackLinesAdmin(request, env);
    }
    if (url.pathname === '/tyres' && request.method === 'GET') {
      return handleTyresPublic(request, env);
    }
    if (url.pathname === '/tyres/admin' && (request.method === 'GET' || request.method === 'PUT')) {
      return handleTyresAdmin(request, env);
    }
    if (url.pathname === '/track/session/source' && request.method === 'POST') {
      return handleTrackSourceSave(request, env);
    }
    if (url.pathname === '/track/session/source' && request.method === 'GET') {
      return handleTrackSourceGet(request, env);
    }
    if (url.pathname === '/track/session' && request.method === 'DELETE') {
      return handleTrackSessionDelete(request, env);
    }
    if (url.pathname === '/track/public' && request.method === 'GET') {
      return handleTrackPublic(request, env);
    }
    if (url.pathname === '/track/board' && request.method === 'GET') {
      return handleTrackBoard(request, env, false);
    }
    if (url.pathname === '/drag/board' && request.method === 'GET') {
      return handleTrackBoard(request, env, true);
    }
    if (url.pathname === '/sprint/board' && request.method === 'GET') {
      return handleTrackBoard(request, env, 'sprint');
    }
    if (url.pathname === '/track/boards/rebuild' && request.method === 'POST') {
      return handleTrackBoardsRebuild(request, env);
    }
    if (url.pathname === '/track/counts' && request.method === 'GET') {
      return handleTrackCounts(request, env);
    }
    if (url.pathname === '/track/copy' && request.method === 'GET') {
      return handleTrackCopyPublic(request, env);
    }
    if (url.pathname === '/track/copy/admin' && (request.method === 'GET' || request.method === 'POST')) {
      return handleTrackCopyAdmin(request, env);
    }
    if (url.pathname === '/share/versions' && request.method === 'GET') {
      return handleShareVersions(request, env);
    }
    var shareRoute = /^\/share\/(track|home)(\/admin(\/image|\/photo)?)?$/.exec(url.pathname);
    if (shareRoute) {
      if (shareRoute[3] === '/photo' && request.method === 'GET') return handleShareGalleryPhoto(request, env);
      if (shareRoute[3] && request.method === 'POST') return handleShareImage(request, env, shareRoute[1]);
      if (shareRoute[2] && !shareRoute[3] && (request.method === 'GET' || request.method === 'POST')) return handleShareAdmin(request, env, shareRoute[1]);
      if (!shareRoute[2] && request.method === 'GET') return handleSharePublic(request, env, shareRoute[1]);
    }
    if (url.pathname === '/track/tracks' && request.method === 'GET') {
      return handleTrackTracks(request, env);
    }
    if (url.pathname === '/track/requests' && request.method === 'POST') {
      return handleTrackRequest(request, env);
    }
    if (url.pathname === '/track/courses' && request.method === 'POST') {
      return handleTrackCourseAdd(request, env);
    }
    if (url.pathname === '/track/admin/tracks' && (request.method === 'GET' || request.method === 'PUT')) {
      return handleTrackAdminTracks(request, env);
    }
    if (url.pathname === '/track/admin/requests' && (request.method === 'GET' || request.method === 'POST')) {
      return handleTrackAdminRequests(request, env);
    }
    if (url.pathname === '/track/admin/board-entry' && request.method === 'DELETE') {
      return handleTrackAdminBoardEntry(request, env);
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
    if (url.pathname === '/push/key' && request.method === 'GET') {
      return handlePushKey(request, env);
    }
    if (url.pathname === '/push/subscribe' && request.method === 'POST') {
      return handlePushSubscribe(request, env);
    }
    if (url.pathname === '/push/unsubscribe' && request.method === 'POST') {
      return handlePushUnsubscribe(request, env);
    }
    if (url.pathname === '/push/test' && request.method === 'POST') {
      return handlePushTest(request, env);
    }
    if (url.pathname === '/my-builds/profile' && request.method === 'POST') {
      return handleMyBuildsProfileUpdate(request, env);
    }
    if (url.pathname === '/my-builds/notifications' && request.method === 'GET') {
      return handleMyBuildsNotificationsGet(request, env);
    }
    if (url.pathname === '/my-builds/notifications/read' && request.method === 'POST') {
      return handleMyBuildsNotificationsRead(request, env);
    }
    if (url.pathname === '/my-builds/notifications/clear' && request.method === 'POST') {
      return handleMyBuildsNotificationsClear(request, env);
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
    // A member's saved name wins; otherwise the first and last name from the
    // form become their saved name. Only an email with no name yet can be
    // named here, as this form doesn't need a sign-in.
    var submitProfile = await getProfile(env, email);
    var submitFirst = cleanNamePart(formData.get('firstName'));
    var submitLast = cleanNamePart(formData.get('lastName'));
    if (!submitProfile && submitFirst && submitLast) {
      submitProfile = await saveProfile(env, email, submitFirst, submitLast);
    }
    if (submitProfile) name = profileFullName(submitProfile);
    var caption = (formData.get('caption') || '').toString().trim().slice(0, 150);
    var carName = (formData.get('carName') || '').toString().trim().slice(0, 150);
    var modsRaw = (formData.get('mods') || '').toString().trim().slice(0, 1000);
    var mods = modsRaw
      ? modsRaw.split(/[,\n]/).map(function (m) { return m.trim(); }).filter(Boolean).slice(0, 20)
      : [];
    var color = (formData.get('color') || '').toString().trim().slice(0, 20);
    if (color && CAR_COLORS.indexOf(color) === -1) color = '';
    var files = formData.getAll('photo').filter(function (f) { return f && typeof f !== 'string'; });

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

      // One entry per member in the weekly vote: a member who already has
      // one keeps it, and this submission isn't entered.
      var entryManifest = await listGalleryEntriesFromR2(env).catch(function () { return []; });
      var hasVoteEntry = !!memberVoteEntry(entryManifest, voteWeekString(new Date()), await ownerKey(email));

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
        if (name) sidecar.name = name;
        if (isPrimary && mods.length) sidecar.mods = mods;
        // Colour is a whole-car attribute (used for gallery filtering), so
        // every photo in the submission carries it, unlike mods which are
        // only credited against the primary/voting shot.
        if (color) sidecar.color = color;
        if (!isPrimary || hasVoteEntry) sidecar.votable = false;
        await putSidecar(env, 'gallery/' + filename + '.json', sidecar);

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
        var submitModel = cleanCarModel({
          model: (formData.get('model') || '').toString(),
          version: (formData.get('version') || '').toString(),
          year: (formData.get('year') || '').toString()
        });
        if (Object.keys(submitModel).length) {
          submitModel.updatedAt = new Date().toISOString();
          await saveCarDetails(env, newCarId, submitModel);
        }
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
              title: 'Gallery submission: ' + (caption || carName || 'new build'),
              body: '**Caption:** ' + (caption || '(none)') + '\n**Submitted by:** ' + publicLabel(name, email) +
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

      var submitResult = { success: true, photo_url: photoUrls[0], photo_urls: photoUrls };
      if (newCarId) submitResult.carId = newCarId;
      if (hasVoteEntry) submitResult.voteNote = 'You already have a build in this week’s vote, so this one isn’t entered. You can switch your entry in My Garage.';
      return json(submitResult);
    } catch (err) {
      return json({ success: false, message: err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tallyVotesIfUkMidnight(env));
    ctx.waitUntil(sendSubscribersDigestIfUk8pm(env).catch(function (e) {
      console.log('Subscribers digest failed:', e.message);
    }));
    ctx.waitUntil(moveSidecarEmails(env).catch(function (e) {
      console.log('Moving sidecar emails failed:', e.message);
    }));
  }
};
