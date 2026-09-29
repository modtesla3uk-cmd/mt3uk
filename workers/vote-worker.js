import { EmailMessage } from 'cloudflare:email';

const OWNER = 'modtesla3uk-cmd';
const REPO = 'mt3uk';
const BASE_BRANCH = 'main';
const FEATURED_PATH = 'data/featured.json';
const REVIEWS_PATH = 'data/reviews.json';
const EVENTS_PATH = 'events-data/events-manifest.json';
const INTERVIEWS_PATH = 'data/interviews.json';
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
const MY_BUILDS_FROM_EMAIL = 'noreply@mt3uk.com';
const MY_BUILDS_LINK_TTL_SECONDS = 15 * 60;
const BUILD_ASSIGNED_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const MY_BUILDS_SESSION_TTL_SECONDS = 60 * 60 * 24 * 180;
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
          if (sidecar.voteBlocked === true) voteBlocked = true;
          if (typeof sidecar.name === 'string' && sidecar.name.trim()) sidecarName = sidecar.name.trim().toUpperCase();
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
    if (!sidecarEmail) entry.unclaimed = true;
    if (includeEmail && sidecarEmail) entry.email = sidecarEmail;
    // Who the photo belongs to, as a one-way key rather than the email, so
    // the vote can allow one entry per member and stop members voting for
    // their own build.
    if (sidecarEmail) entry.owner = await ownerKey(sidecarEmail);
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
var MAX_BROADCASTS = 50;
var BROADCAST_EMAIL_BATCH = 40;
var PROFILE_URL = MY_BUILDS_SITE_URL + '/profile.html';
var EMAIL_FOOTER = '\n\n--\nManage your MT3UK emails or unsubscribe: ' + PROFILE_URL + '#unsubscribe' +
  '\nPrivacy: ' + MY_BUILDS_SITE_URL + '/privacy.html';

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
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body + EMAIL_FOOTER, await listUnsubscribeHeaders(env, toEmail))));
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
  if ('showName' in body || 'hideRealName' in body) {
    var vis = await getProfileRecord(env, email);
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
    showName: saved.showName === 'name' ? 'name' : 'nickname', hideRealName: !!saved.hideRealName, emailsOff: !!saved.emailsOff });
}

// Leave MT3UK: deletes the member's builds and everything kept about them.
// Comments stay, under the name they were posted with.
async function deleteMemberAccount(env, email) {
  var files = await getSubscriberFiles(env, email);
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
  }
  await Promise.all(['subscriber:', 'profile:', 'subscriber-since:', 'friends:', 'dm-index:', 'notifications:', 'push:'].map(function (prefix) {
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
    messages: (Array.isArray(messages) ? messages : []).filter(function (m) { return !m.removed; }).map(function (m) {
      return { id: m.id, text: m.text, at: m.at, mine: m.from === myId };
    })
  });
}

async function handleProfileMessageSend(request, env) {
  var email = await resolveSession(request, env);
  if (!email) return json({ success: false, message: 'Please sign in again' }, 401);
  var body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'Invalid request' }, 400); }
  var profile = await getProfileRecord(env, email);
  if (profile.dmBlocked) return json({ success: false, message: 'Messaging is turned off for your account. Please get in touch through the Contact page.' }, 403);
  var fr = await getFriends(env, email);
  var other = await emailForId(fr.friends, String((body && body.with) || ''));
  if (!other) return json({ success: false, message: 'You can only message your friends.' }, 403);
  var text = String((body && body.text) || '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_DM_LENGTH);
  if (!text) return json({ success: false, message: 'Write a message first.' }, 400);
  var check = moderateCommentText(text);
  if (!check.ok) return json({ success: false, message: check.message.replace(/comments/i, 'messages') }, 400);

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
  messages.push(msg);
  await env.VOTES.put(threadKey, JSON.stringify(messages.slice(-MAX_DM_PER_THREAD)));

  var mine = await getDmIndex(env, email);
  mine[otherId] = { email: other, lastText: text.slice(0, 120), lastAt: msg.at, lastFromMe: true, unread: 0 };
  await env.VOTES.put(dmIndexKey(email), JSON.stringify(mine));
  var theirs = await getDmIndex(env, other);
  var was = theirs[myId] || {};
  theirs[myId] = { email: email, lastText: text.slice(0, 120), lastAt: msg.at, lastFromMe: false, unread: (was.unread || 0) + 1 };
  await env.VOTES.put(dmIndexKey(other), JSON.stringify(theirs));

  // One alert per quiet spell, not one per message.
  if (!was.unread) {
    var name = publicName(profile) || 'A friend';
    var pushed = await sendPushToMember(env, other, { title: 'Message from ' + name, body: text.slice(0, 140), url: '/profile.html?with=' + myId + '#messages' });
    if (!pushed) await sendMemberEmail(env, other, name + ' sent you a message on MT3UK', name + ' sent you a message on MT3UK:\n\n"' + text.slice(0, 500) + '"\n\nRead and reply in your Profile:\n\n' + PROFILE_URL + '#messages');
  }
  return json({ success: true, message: { id: msg.id, text: msg.text, at: msg.at, mine: true } });
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
      id: crypto.randomUUID(), messageId: msg.id, text: msg.text, at: msg.at,
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

function broadcastEmailText(msg) {
  return msg.text + '\n\nSee all messages in your Profile: ' + PROFILE_URL + '#messages';
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
  var ok = await sendMemberEmail(env, email, 'MT3UK: ' + msg.title, broadcastEmailText(msg));
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
  //   full      - as members get it: footer and unsubscribe headers
  //   noheader  - the same, without the unsubscribe headers
  //   plain     - just the title and message, like a sign-in email
  var variant = body && (body.variant === 'noheader' || body.variant === 'plain') ? body.variant : 'full';
  var emailText = variant === 'plain' ? text : broadcastEmailText({ title: title, text: text }) + EMAIL_FOOTER;
  var headers = variant === 'full' ? await listUnsubscribeHeaders(env, email) : [];
  try {
    await env.SEND_EMAIL.send(new EmailMessage(MY_BUILDS_FROM_EMAIL, email, rawEmail(MY_BUILDS_FROM_EMAIL, email,
      '[Test] ' + (variant === 'plain' ? '' : 'MT3UK: ') + title, emailText, headers)));
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
    var ok = await sendMemberEmail(env, to, 'MT3UK: ' + msg.title, broadcastEmailText(msg));
    if (ok) { sent++; emailed.push(to); } else skipped++;
  }
  if (sent) await env.VOTES.put(broadcastEmailedKey(msg.id), JSON.stringify(emailed));
  return json({ success: true, sent: sent, skipped: skipped, already: already, emailedTotal: emailed.length, cursor: page.list_complete ? null : page.cursor });
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
      messages.forEach(function (m) { if (m.id === report.messageId) { m.removed = true; m.text = ''; } });
      await env.VOTES.put(threadKey, JSON.stringify(messages));
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
  var todayStr = voteWeekString(new Date());
  var candidates = votingCandidates(manifest, todayStr);
  var voterId = getVoterId(request);
  var ip = getClientIp(request);

  var votedFile = await env.VOTES.get('voter-ip:' + todayStr + ':' + ip);
  if (!votedFile) {
    votedFile = await env.VOTES.get('voter:' + todayStr + ':' + voterId);
  }

  var counts = await getVoteCounts(env, ctx, todayStr, candidates.map(function (p) { return p.file; }));
  var sessionEmail = await resolveSession(request, env);
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
  var sessionEmail = await resolveSession(request, env);
  var viewer = sessionEmail ? await ownerKey(sessionEmail) : null;
  if (viewer && candidate.owner === viewer) {
    return json({ success: false, message: 'You can only vote for other members\u2019 builds.' }, 403);
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
  var ownerEmail = sidecar && sidecar.email;
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
  var email = ((body && body.email) || '').toString().trim().toLowerCase();
  var text = ((body && body.text) || '').toString().trim().slice(0, MAX_COMMENT_LENGTH);
  var parentId = ((body && body.parentId) || '').toString() || null;

  if (!file) return json({ success: false, message: 'file is required' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, message: 'Please enter a valid email' }, 400);
  }
  if (!text) return json({ success: false, message: 'Comment cannot be empty' }, 400);

  if (isInterviewThread(file)) {
    // Interview comments are members-only: the commenter's email comes from
    // their signed-in My Garage session, not from the request body.
    var sessionEmail = await resolveSession(request, env);
    if (!sessionEmail) {
      return json({ success: false, message: 'Please sign in to My Garage to comment' }, 401);
    }
    email = sessionEmail;
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
    await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
      httpMetadata: { contentType: 'application/json' }
    });
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

// Admin: this week's Build of the Week entries, and photos taken out of
// voting, with who they belong to.
async function handleAdminVoteEntries(request, env) {
  var key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }
  var week = voteWeekString(new Date());
  var manifest = await listGalleryEntriesFromR2(env, { includeEmail: true });
  function row(p) {
    return { file: p.file, caption: p.caption || '', name: p.name || '', email: p.email || '', added: p.votableSince || p.added || '' };
  }
  var entries = await Promise.all(votingCandidates(manifest, week).map(async function (p) {
    var r = row(p);
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
    var owner = sidecar.email ? await ownerKey(sidecar.email) : null;
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
  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
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
    delete sidecar.name;
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
      delete sidecar.name;
      await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
        httpMetadata: { contentType: 'application/json' }
      });
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
// Junk: Date, Message-ID, Reply-To (noreply@ has no inbox), the text
// encoding and, for member emails, List-Unsubscribe (extraHeaders).
function rawEmail(from, to, subject, bodyText, extraHeaders) {
  var lines = [
    'From: MT3UK <' + from + '>',
    'Reply-To: MT3UK <' + SUBSCRIBERS_DIGEST_EMAIL + '>',
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
  var message = new EmailMessage(MY_BUILDS_FROM_EMAIL, toEmail, rawEmail(MY_BUILDS_FROM_EMAIL, toEmail, subject, body + EMAIL_FOOTER, await listUnsubscribeHeaders(env, toEmail)));
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
    ownerEmail = sidecar && sidecar.email;
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

async function createSession(env, email) {
  var expires = Math.floor(Date.now() / 1000) + MY_BUILDS_SESSION_TTL_SECONDS;
  var payload = 's1.' + base64UrlFromBytes(new TextEncoder().encode(email)) + '.' + expires;
  var sig = await crypto.subtle.sign('HMAC', await sessionHmacKey(env), new TextEncoder().encode(payload));
  return payload + '.' + base64UrlFromBytes(new Uint8Array(sig));
}

async function resolveSession(request, env) {
  var token = request.headers.get('X-Session-Token');
  if (!token) return null;
  var parts = token.split('.');
  if (parts.length === 4 && parts[0] === 's1') {
    if (!env.ADMIN_KEY || !(Number(parts[2]) > Date.now() / 1000)) return null;
    try {
      var ok = await crypto.subtle.verify('HMAC', await sessionHmacKey(env), bytesFromBase64Url(parts[3]),
        new TextEncoder().encode(parts.slice(0, 3).join('.')));
      return ok ? new TextDecoder().decode(bytesFromBase64Url(parts[1])) : null;
    } catch (e) {
      return null;
    }
  }
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
  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
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
  var files = await getSubscriberFiles(env, email);
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
  await env.GALLERY_BUCKET.put(key, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
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

  await env.GALLERY_BUCKET.put(sidecarKey, JSON.stringify(sidecar, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' }
  });
  await Promise.all(withdraw.map(function (f) { return withdrawVoteEntry(env, f, voteWeek); }));
  if (clearVotes) await env.VOTES.delete('votes:' + voteWeek + ':' + file);

  await triggerManifestRebuild(env);

  return json({ success: true, file: file, withdrawn: withdraw });
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
            body: '**Caption:** ' + caption + '\n**Submitted by (account):** ' + publicLabel(uploaderName, email) +
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
              body: '**Caption:** ' + caption + '\n**Submitted by:** ' + publicLabel(name, email) +
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
  }
};
