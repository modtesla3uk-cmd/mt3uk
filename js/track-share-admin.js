/*
  Admin: the picture a shared Track Sessions link previews with. Pictures are drawn from a saved session (the map,
  times and g chart) or uploaded as photos, each with a caption; with rotation on, a different one shows each week.
  The worker keeps the set (KV track-share, bucket share/track/) and the share page build picks it up.
*/
(function () {
  var wrap = document.getElementById('share-wrap');
  if (!wrap) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var note = document.getElementById('ts-note'), list = document.getElementById('ts-list'), rotate = document.getElementById('ts-rotate');
  var pick = document.getElementById('ts-session'), canvas = document.getElementById('ts-preview'), makeBtn = document.getElementById('ts-make');
  var photoIn = document.getElementById('ts-photo'), captionIn = document.getElementById('ts-caption'), previewNote = document.getElementById('ts-preview-note');
  var state = null, sessions = [], previewFrom = null, loaded = false, wordmark = new Image();
  wordmark.src = 'images/site/mt3uk-wordmark-dark.png';
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
    if (!state.items.length) { list.innerHTML = '<p class="empty">No pictures yet. The link previews with the built-in Thruxton picture until one is saved.</p>'; return; }
    list.innerHTML = state.items.map(function (it) {
      var now = it.id === pickId, chosen = !state.rotate && it.id === state.current;
      return '<div class="ts-item' + (now ? ' is-now' : '') + '" data-id="' + esc(it.id) + '">' +
        '<img class="ts-thumb" src="' + esc(it.url) + '" alt="" loading="lazy">' +
        '<div class="ts-body"><div class="ts-head"><b>' + esc(it.label || (it.kind === 'photo' ? 'Photo' : 'Session')) + '</b>' +
        '<span class="iv-sub">' + (it.kind === 'photo' ? 'Photo' : 'Drawn from a session') + (now ? ' <span class="ts-now">' + (state.rotate ? 'This week' : 'In use') + '</span>' : '') + '</span></div>' +
        '<label class="ts-cap">Caption<input type="text" maxlength="200" value="' + esc(it.caption) + '" data-caption="' + esc(it.id) + '" placeholder="A line for the preview, for example: ' + esc(it.label || 'Snetterton, 2:25 laps in the wet') + '"></label>' +
        '<div class="iv-toolbar">' + (chosen ? '' : '<button type="button" class="secondary" data-use="' + esc(it.id) + '">Use this now</button>') +
        (it.sessionId ? '<a class="secondary ts-open" href="track.html?s=' + esc(it.sessionId) + '" target="_blank" rel="noopener">Open session</a>' : '') +
        '<button type="button" class="danger" data-delete="' + esc(it.id) + '">Delete</button></div></div></div>';
    }).join('');
  }
  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    say('Loading...');
    Promise.all([call('GET', '/share/track/admin'), loadSessions()]).then(function (r) {
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
        return '<option value="' + esc(r.id) + '">' + esc((r.venue || 'Unknown track') + ', ' + (r.date || '') + ', ' + window.MT3UKTrack.fmtLap(r.best)) + '</option>';
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
      return call('POST', '/share/track/admin/image', fd);
    }).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not save it.');
      state = d; draw();
      if (captionIn) captionIn.value = '';
      say('Saved. The link previews update within a few minutes; a link already sent in a chat may keep its old picture for a while.');
    }).catch(function (e) { say(e.message || 'Could not save it.', true); makeBtn.disabled = false; });
  }
  function act(body, done) {
    call('POST', '/share/track/admin', body).then(function (d) {
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
  list.addEventListener('click', function (e) {
    var use = e.target.closest('[data-use]'), del = e.target.closest('[data-delete]');
    if (use) act({ action: 'use', id: use.getAttribute('data-use') }, function () { say('That picture is in use now. Rotation is off.'); });
    if (del && window.confirm('Delete this picture from the rotation?')) act({ action: 'delete', id: del.getAttribute('data-delete') }, function () { say('Deleted.'); });
  });
  list.addEventListener('change', function (e) {
    var cap = e.target.closest('[data-caption]');
    if (cap) act({ action: 'caption', id: cap.getAttribute('data-caption'), caption: cap.value.trim() }, function () { say('Caption saved.'); });
  });
})();
