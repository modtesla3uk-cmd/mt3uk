/*
  Admin: the picture a shared link previews with, one panel per slot (details[data-share-slot]: the Track sessions
  page and the homepage). Pictures are drawn from a saved session (the map, times and g chart) or uploaded as
  photos, each with a caption; with rotation on, a different one shows each week. The worker keeps each set (KV,
  bucket share/<slot>/) and the share page build picks it up.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev', SITE = 'https://mt3uk.com', wordmark = new Image();
  wordmark.src = 'images/site/mt3uk-wordmark-dark.png';
  // What each slot's link is and says, as js/share.js makes it, so a share from here matches one from the page.
  var SLOT_PAGE = { track: { stem: 'track', title: 'Track sessions', intro: 'Your track days and drag runs from your lap timer file: every lap mapped, where you gained and lost time, and what your mods did to your times.' }, home: { stem: 'index', title: 'MT3UK', intro: 'The UK\'s modified Tesla community.' } };
  function isoWeek() {
    var t = new Date(), d = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())), day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var wk = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
    return d.getUTCFullYear() + '-W' + (wk < 10 ? '0' : '') + wk;
  }
  [].slice.call(document.querySelectorAll('details[data-share-slot]')).forEach(initPanel);
  function initPanel(wrap) {
  var slot = wrap.getAttribute('data-share-slot'), q = function (c) { return wrap.querySelector('.' + c); };
  var note = q('ts-note'), list = q('ts-list'), rotate = q('ts-rotate');
  var pick = q('ts-session'), canvas = q('ts-preview'), makeBtn = q('ts-make');
  var photoIn = q('ts-photo'), captionIn = q('ts-caption'), previewNote = q('ts-preview-note');
  var state = null, sessions = [], previewFrom = null, loaded = false;
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function call(method, path, body) {
    var opts = { method: method, cache: 'no-store' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    return fetch(API + path + (path.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function say(t, bad) { if (note) { note.textContent = t || ''; note.classList.toggle('is-bad', !!bad); } }
  function draw() {
    if (!state) return;
    if (rotate) rotate.setAttribute('aria-checked', state.rotate ? 'true' : 'false');
    var pickId = state.pick ? state.pick.id : '';
    if (!state.items.length) { list.innerHTML = '<p class="empty">No pictures yet. The link previews with its usual picture until one is saved.</p>'; return; }
    list.innerHTML = state.items.map(function (it) {
      var now = it.id === pickId, chosen = !state.rotate && it.id === state.current;
      return '<div class="ts-item' + (now ? ' is-now' : '') + '" data-id="' + esc(it.id) + '">' +
        '<img class="ts-thumb" src="' + esc(it.url) + '" alt="" loading="lazy">' +
        '<div class="ts-body"><div class="ts-head"><b>' + esc(it.label || (it.kind === 'photo' ? 'Photo' : 'Session')) + '</b>' +
        '<span class="iv-sub">' + (it.kind === 'photo' ? 'Photo' : 'Drawn from a session') + (now ? ' <span class="ts-now">' + (state.rotate ? 'This week' : 'In use') + '</span>' : '') + '</span></div>' +
        '<label class="ts-cap">Caption<input type="text" maxlength="200" value="' + esc(it.caption) + '" data-caption="' + esc(it.id) + '" placeholder="A line for the preview, for example: ' + esc(it.label || 'Snetterton, 2:25 laps in the wet') + '"></label>' +
        '<div class="iv-toolbar">' + (now ? '<button type="button" class="secondary" data-share="' + esc(it.id) + '">Share</button>' : '') + (chosen ? '' : '<button type="button" class="secondary" data-use="' + esc(it.id) + '">Use this now</button>') +
        (it.sessionId ? '<a class="secondary ts-open" href="track.html?s=' + esc(it.sessionId) + '" target="_blank" rel="noopener">Open session</a>' : '') +
        '<button type="button" class="danger" data-delete="' + esc(it.id) + '">Delete</button></div></div></div>';
    }).join('');
  }
  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    say('Loading...');
    Promise.all([call('GET', '/share/' + slot + '/admin'), loadSessions()]).then(function (r) {
      if (!r[0].success) { say(r[0].message || 'Could not load the pictures.', true); return; }
      state = r[0]; loaded = true; draw(); say(state.rotate ? 'A different picture each week (' + state.week + ').' : 'One picture, until you change it.');
    }).catch(function () { say('Could not reach the server.', true); });
  }
  // Every saved session with laps, newest first, for the picker: the admin's re-time listing, a page at a time.
  function loadSessions() {
    sessions = [];
    function page(cursor) {
      return call('GET', '/track/admin/retime' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
        if (!d.success) return;
        (d.sessions || []).forEach(function (r) { if ((r.type === 'track' || r.type === 'sprint') && r.best && !r.street) sessions.push(r); });
        if (!d.done && d.cursor && sessions.length < 400) return page(d.cursor);
      });
    }
    return page('').then(function () {
      sessions.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      if (!pick) return;
      pick.innerHTML = '<option value="">Choose a session</option>' + sessions.map(function (r) {
        // Whose session it is, and whether it is private, so the admin knows what they are putting in a public picture.
        return '<option value="' + esc(r.id) + '">' + esc((r.venue || 'Unknown track') + ', ' + (r.date || '') + ', ' + window.MT3UKTrack.fmtLap(r.best) + (r.owner ? ', ' + r.owner : '') + (r.privacy === 'private' ? ' (private)' : '')) + '</option>';
      }).join('');
    });
  }
  function fitCanvas() { if (canvas) { canvas.style.aspectRatio = '1200 / 630'; canvas.hidden = false; } }
  function previewSession(id) {
    previewFrom = null;
    if (makeBtn) makeBtn.disabled = true;
    if (!id) { if (canvas) canvas.hidden = true; return; }
    if (previewNote) previewNote.textContent = 'Drawing...';
    call('GET', '/track/admin/retime?id=' + encodeURIComponent(id)).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not read the session.');
      return (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { return d.session; });
    }).then(function (s) {
      window.MT3UKTrackShareCard.draw(canvas, s, { wordmark: wordmark });
      fitCanvas();
      // The label names the track and day only: whose session it was stays in the picker, for the admin alone.
      previewFrom = { kind: 'session', sessionId: s.id, label: (s.venue || 'Track session') + (s.layout && s.layout !== s.venue ? ', ' + s.layout : '') + ', ' + (s.date || '') };
      if (makeBtn) makeBtn.disabled = false;
      if (previewNote) previewNote.textContent = 'This is how the preview will look. Add a caption and save it.';
    }).catch(function (e) { if (previewNote) previewNote.textContent = e.message || 'Could not draw it.'; });
  }
  function previewPhoto(file) {
    previewFrom = null;
    if (makeBtn) makeBtn.disabled = true;
    if (!file) return;
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      window.MT3UKTrackShareCard.photo(canvas, img);
      fitCanvas();
      previewFrom = { kind: 'photo', label: (file.name || 'Photo').replace(/\.[a-z0-9]+$/i, '').slice(0, 80) };
      if (makeBtn) makeBtn.disabled = false;
      if (previewNote) previewNote.textContent = 'Cropped to the preview shape. Add a caption and save it.';
    };
    img.onerror = function () { URL.revokeObjectURL(url); if (previewNote) previewNote.textContent = 'That file could not be read as a picture.'; };
    img.src = url;
  }
  function save() {
    if (!previewFrom) return;
    makeBtn.disabled = true; say('Saving the picture...');
    window.MT3UKTrackShareCard.toJpeg(canvas, 290000).then(function (blob) {
      var fd = new FormData();
      fd.append('file', blob, 'share.jpg');
      fd.append('kind', previewFrom.kind);
      fd.append('label', previewFrom.label);
      fd.append('caption', captionIn ? captionIn.value.trim() : '');
      if (previewFrom.sessionId) fd.append('sessionId', previewFrom.sessionId);
      return call('POST', '/share/' + slot + '/admin/image', fd);
    }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not save it.');
      state = d; draw();
      if (captionIn) captionIn.value = '';
      say('Saved. The link previews update within a few minutes; a link already sent in a chat may keep its old picture for a while.');
    }).catch(function (e) { say(e.message || 'Could not save it.', true); makeBtn.disabled = false; });
  }
  function act(body, done) {
    call('POST', '/share/' + slot + '/admin', body).then(function (d) {
      if (!d.success) { say(d.message || 'Could not save that.', true); return; }
      state = d; draw(); if (done) done();
    }).catch(function () { say('Could not reach the server.', true); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open && !loaded) load(); });
  if (rotate) rotate.addEventListener('click', function () {
    var on = rotate.getAttribute('aria-checked') !== 'true';
    act({ action: 'rotate', on: on }, function () { say(on ? 'A different picture each week.' : 'One picture, until you change it.'); });
  });
  if (pick) pick.addEventListener('change', function () { if (photoIn) photoIn.value = ''; previewSession(pick.value); });
  if (photoIn) photoIn.addEventListener('change', function () { if (pick) pick.value = ''; previewPhoto(photoIn.files && photoIn.files[0]); });
  if (makeBtn) makeBtn.addEventListener('click', save);
  // The link, with the week and the set's version, and the message the page's share button would send.
  function shareNow(it) {
    var pg = SLOT_PAGE[slot], url = SITE + '/share/section/' + pg.stem + '.html?utm_source=share_sheet&utm_medium=share&utm_campaign=page_' + pg.stem + '&w=' + isoWeek() + (state && state.version > 0 ? '.' + state.version : '');
    var text = pg.title + (pg.stem === 'index' ? ': ' : ' on MT3UK: ') + ((it && it.caption) || pg.intro);
    if (navigator.share) {
      navigator.share({ title: pg.title, text: text, url: url }).then(function () { say('Shared.'); }).catch(function () {});
      return;
    }
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text + ' ' + url) : Promise.reject()).then(function () { say('Link copied, with the message.'); }, function () { window.prompt('Copy the link', url); });
  }
  list.addEventListener('click', function (e) {
    var use = e.target.closest('[data-use]'), del = e.target.closest('[data-delete]'), sh = e.target.closest('[data-share]');
    if (sh && state) shareNow(state.items.filter(function (i) { return i.id === sh.getAttribute('data-share'); })[0]);
    if (use) act({ action: 'use', id: use.getAttribute('data-use') }, function () { say('That picture is in use now. Rotation is off.'); });
    if (del && window.confirm('Delete this picture from the rotation?')) act({ action: 'delete', id: del.getAttribute('data-delete') }, function () { say('Deleted.'); });
  });
  list.addEventListener('change', function (e) {
    var cap = e.target.closest('[data-caption]');
    if (cap) act({ action: 'caption', id: cap.getAttribute('data-caption'), caption: cap.value.trim() }, function () { say('Caption saved.'); });
  });
  }
})();
