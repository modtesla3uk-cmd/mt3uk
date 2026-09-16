const OWNER = 'modtesla3uk-cmd';
const REPO = 'mt3uk';
const BASE_BRANCH = 'main';
const FEATURED_PATH = 'data/featured.json';
const REVIEWS_PATH = 'data/reviews.json';
const GALLERY_MANIFEST_URL = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BASE_BRANCH + '/images/gallery/manifest.json';
const VOTE_TTL_SECONDS = 60 * 60 * 24 * 3;
const REVIEW_PRODUCTS = ['tee', 'stickers', 'brace', 'pads-street', 'pads-carbotech'];
const REVIEW_PHOTOS_PATH = 'images/reviews';
const MAX_REVIEW_PHOTOS = 3;
const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Voter-Id'
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

async function fetchGalleryManifest() {
  var res = await fetch(GALLERY_MANIFEST_URL, { cf: { cacheTtl: 60 } });
  if (!res.ok) throw new Error('Could not read gallery manifest (' + res.status + ')');
  return res.json();
}

function votingCandidates(manifest, todayStr) {
  var yesterdayStr = addDaysToDateString(todayStr, -1);
  return manifest.filter(function (p) {
    return p.added === todayStr || p.added === yesterdayStr;
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

async function handleVotesGet(request, env) {
  var manifest = await fetchGalleryManifest();
  var todayStr = ukDateString(new Date());
  var candidates = votingCandidates(manifest, todayStr);
  var voterId = getVoterId(request);
  var ip = getClientIp(request);

  var votedFile = await env.VOTES.get('voter-ip:' + todayStr + ':' + ip);
  if (!votedFile) {
    votedFile = await env.VOTES.get('voter:' + todayStr + ':' + voterId);
  }

  var results = await Promise.all(candidates.map(async function (p) {
    var count = await env.VOTES.get('votes:' + todayStr + ':' + p.file);
    return {
      file: p.file,
      caption: p.caption || '',
      votes: count ? parseInt(count, 10) : 0,
      mods: p.mods || []
    };
  }));

  return json({
    success: true,
    voterId: voterId,
    voted: votedFile || null,
    candidates: results
  });
}

async function handleVotePost(request, env) {
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

  var manifest = await fetchGalleryManifest();
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

    if (url.pathname === '/votes' || url.pathname === '/vote') {
      // Cron triggers aren't reliably invoking `scheduled` on this account, so
      // piggyback the midnight tally on normal vote traffic as a safety net.
      ctx.waitUntil(tallyVotesIfUkMidnight(env).catch(function (e) {
        console.log('Tally failed:', e.message);
      }));
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
      return handleVotesGet(request, env);
    }
    if (url.pathname === '/vote' && request.method === 'POST') {
      return handleVotePost(request, env);
    }
    if (url.pathname === '/review' && request.method === 'POST') {
      return handleReviewPost(request, env);
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

    var name = (formData.get('name') || '').toString().trim().slice(0, 100);
    var caption = (formData.get('caption') || '').toString().trim().slice(0, 150);
    var modsRaw = (formData.get('mods') || '').toString().trim().slice(0, 1000);
    var mods = modsRaw
      ? modsRaw.split(/[,\n]/).map(function (m) { return m.trim(); }).filter(Boolean).slice(0, 20)
      : [];
    var file = formData.get('photo');

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

    var ghHeaders = {
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'mt3uk-gallery-worker',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    try {
      var extMatch = (file.name || '').match(/\.[a-zA-Z0-9]+$/);
      var ext = extMatch ? extMatch[0].toLowerCase() : '.jpg';
      var slug = slugify(caption);
      var timestamp = Date.now();
      var branchName = 'submission/' + timestamp + '-' + slug;

      var listRes = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/images/gallery?ref=' + BASE_BRANCH,
        { headers: ghHeaders }
      );
      var existingNames = [];
      if (listRes.ok) {
        var listData = await listRes.json();
        if (Array.isArray(listData)) {
          existingNames = listData.map(function (item) { return item.name; });
        }
      }
      var nameSlug = name ? slugify(name) : '';
      var baseSlug = nameSlug ? slug + '--by-' + nameSlug : slug;
      var filename = baseSlug + ext;
      var suffix = 2;
      while (existingNames.indexOf(filename) !== -1 && suffix < 100) {
        filename = baseSlug + '-' + suffix + ext;
        suffix++;
      }

      var refRes = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + BASE_BRANCH,
        { headers: ghHeaders }
      );
      if (!refRes.ok) throw new Error('Could not read base branch (' + refRes.status + ')');
      var refData = await refRes.json();
      var baseSha = refData.object.sha;

      var createRefRes = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/git/refs',
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({ ref: 'refs/heads/' + branchName, sha: baseSha })
        }
      );
      if (!createRefRes.ok) throw new Error('Could not create branch (' + createRefRes.status + ')');

      var arrayBuffer = await file.arrayBuffer();
      var base64Content = arrayBufferToBase64(arrayBuffer);

      var putRes = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/images/gallery/' + filename,
        {
          method: 'PUT',
          headers: ghHeaders,
          body: JSON.stringify({
            message: 'Add gallery submission: ' + caption,
            content: base64Content,
            branch: branchName
          })
        }
      );
      if (!putRes.ok) throw new Error('Could not commit photo (' + putRes.status + ')');

      if (mods.length) {
        var modsPutRes = await fetch(
          'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/images/gallery/' + filename + '.json',
          {
            method: 'PUT',
            headers: ghHeaders,
            body: JSON.stringify({
              message: 'Add mods list for gallery submission: ' + caption,
              content: arrayBufferToBase64(new TextEncoder().encode(JSON.stringify({ mods: mods }, null, 2) + '\n')),
              branch: branchName
            })
          }
        );
        if (!modsPutRes.ok) throw new Error('Could not commit mods list (' + modsPutRes.status + ')');
      }

      var prBody = '**Caption:** ' + caption + '\n**Submitted by:** ' + (name || 'Anonymous') +
        (mods.length ? '\n**Mods:** ' + mods.join(', ') : '') +
        '\n\nMerge this PR to publish the photo to the live gallery, or close it to reject the submission.';

      var prRes = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + REPO + '/pulls',
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            title: 'Gallery submission: ' + caption,
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
              body: '@' + OWNER + ' New photo submission for review!'
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
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tallyVotesIfUkMidnight(env));
  }
};
