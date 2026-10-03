/*
  admin.html, Line editing panel: members who asked to edit the start and finish lines on a session they
  saved. Allow switches it on for that one session (the member is emailed). They move the lines and send the
  change: nothing on the session changes until you Accept it, which works the time out again from the saved
  readings with the new lines and shows you the result before it is saved. Undo throws the change away, and
  Revoke switches the editing off again. The list is one KV key (track-line-access) kept by the worker
  (/track/lines/admin).
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('lines-wrap');
  if (!wrap) return;
  var listEl = document.getElementById('ln-list'), noteEl = document.getElementById('ln-note'), countEl = document.getElementById('lines-count');
  var rows = [];

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function url(path) { return API + path + (path.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key()); }
  function call(method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(url('/track/lines/admin'), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function lineText(l) { return l && l.length === 2 ? [l[0][0], l[0][1], l[1][0], l[1][1]].join(', ') : 'not set'; }
  function timeText(t) { return t ? window.MT3UKTrack.fmtLap(t) : 'no time'; }
  function same(a, b) { return lineText(a) === lineText(b); }

  // What the member changed, from and to, for the admin to see before accepting or undoing.
  function changeHtml(r) {
    var p = r.proposal, sprint = r.type === 'sprint';
    function row(label, from, to) { return same(from, to) ? '' : '<tr><td>' + label + '</td><td>' + esc(lineText(from)) + '</td><td>' + esc(lineText(to)) + '</td></tr>'; }
    return '<div class="iv-sub">Changed ' + esc(when(p.at)) + '. The session has not changed yet.</div>' +
      '<table class="iv-table"><thead><tr><th></th><th>From</th><th>To</th></tr></thead><tbody>' +
      row('Start line', p.from.startLine, p.to.startLine) + (sprint ? row('Finish line', p.from.finishLine, p.to.finishLine) : '') +
      '<tr><td>Time</td><td>' + esc(timeText(p.from.time)) + '</td><td>' + esc(timeText(p.to.time)) + ' <span class="iv-sub">(their figure, worked out again when you accept)</span></td></tr></tbody></table>';
  }
  function draw() {
    var changed = rows.filter(function (r) { return r.proposal; }).length, waiting = rows.filter(function (r) { return r.status === 'pending'; }).length;
    countEl.textContent = changed ? changed + ' to review' : waiting ? waiting + ' waiting' : (rows.length ? rows.length + ' allowed' : '');
    listEl.innerHTML = rows.length ? '<table class="iv-table"><thead><tr><th>Member</th><th>Map</th><th>Status</th><th></th></tr></thead><tbody>' + rows.map(function (r) {
      var state = r.status === 'pending' ? 'Asked ' + esc(when(r.at)) + (r.note ? '<br><span class="iv-sub">' + esc(r.note) + '</span>' : '')
        : r.proposal ? changeHtml(r)
        : 'Allowed ' + esc(when(r.grantedAt)) + '<br><span class="iv-sub">Waiting for them to change the map.</span>';
      var actions = r.status === 'pending'
        ? '<button type="button" class="iv-act" data-grant="' + esc(r.id) + '">Allow</button><button type="button" class="secondary iv-act" data-dismiss="' + esc(r.id) + '">Decline</button>'
        : (r.proposal ? '<button type="button" class="iv-act" data-accept="' + esc(r.id) + '">Accept</button><button type="button" class="secondary iv-act" data-undo="' + esc(r.id) + '">Undo</button>' : '') +
          '<button type="button" class="danger iv-act" data-revoke="' + esc(r.id) + '">Revoke</button>';
      return '<tr><td>' + esc(r.name ? r.name + ' ' : '') + '<span class="iv-sub">' + esc(r.email) + '</span></td>' +
        '<td><a href="track.html?s=' + encodeURIComponent(r.id) + '" target="_blank" rel="noopener">' + esc(r.what) + '</a></td><td>' + state + '</td>' +
        '<td><div class="iv-actions">' + actions + '</div></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody has asked to edit a map.</p>';
  }
  function load(keepNote) {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the list. Check the admin key.', 'error'); return; }
      rows = d.requests || []; if (!keepNote) note(''); draw();
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  function act(body, done) {
    return call('POST', body).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); return false; }
      note(done || ''); load(true); return true;
    }).catch(function () { note('Could not reach the server.', 'error'); return false; });
  }

  // Accept: the readings saved with the session are timed again on the new lines, in this browser, and the
  // result is shown before anything is saved. Only then is the session changed and the change cleared.
  function readSource(buf) {
    var b = new Uint8Array(buf);
    if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unzip the readings.');
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
    }
    return JSON.parse(new TextDecoder().decode(buf));
  }
  function restoreSource(src) {
    var rd = Object.assign({}, src.rd);
    function n(v) { return v == null ? NaN : v; }
    rd.points = src.p.map(function (a) {
      var q = { t: a[0], lat: a[1], lng: a[2], v: n(a[3]), la: n(a[4]), lo: n(a[5]), sats: n(a[6]), temp: n(a[7]) };
      if (a[8]) q.run = a[8];
      return q;
    });
    return rd;
  }
  function getJson(path) { return fetch(url(path), { cache: 'no-store' }).then(function (r) { return r.json().catch(function () { return {}; }); }); }
  function accept(id) {
    var T = window.MT3UKTrack, r = rows.filter(function (x) { return x.id === id; })[0];
    if (!T || !r || !r.proposal) { note('The timing code has not loaded yet.', 'error'); return; }
    var p = r.proposal;
    note('Working the time out again from the saved readings...');
    Promise.all([
      fetch('data/tracks.json', { cache: 'no-store' }).then(function (x) { return x.json(); }).catch(function () { return { venues: [] }; }),
      getJson('/track/admin/tracks'), getJson('/track/admin/retime?id=' + encodeURIComponent(id)),
      fetch(url('/track/admin/retime/source?id=' + encodeURIComponent(id)), { cache: 'no-store' }).then(function (x) {
        if (x.status === 404) throw new Error('No readings were kept for this session, so the time cannot be worked out again.');
        if (!x.ok) throw new Error('The readings could not be downloaded.');
        return x.arrayBuffer();
      }).then(readSource)
    ]).then(function (res) {
      var old = res[2].session, src = res[3];
      if (!old || !src.p || !src.rd) throw new Error('Could not read the session.');
      var lib = T.mergeLibrary(res[0], res[1] && res[1].extra);
      // The lines the member sent, and only those: the course's own lines are not used for this.
      var opts = { type: old.type, ignoreFirstFinish: old.ignoreFinish !== false, ownLines: true, startLine: p.to.startLine };
      if (old.type === 'sprint') opts.finishLine = p.to.finishLine;
      if (old.rollout) opts.rollout = true;
      if (old.organizer) opts.organizer = old.organizer;
      if (old.finishCrossing) opts.finishCrossing = old.finishCrossing;
      var next = T.analyse(restoreSource(src), lib, opts);
      if ((next.problem || next.needsStartLine) && !(next.laps && next.laps.length)) throw new Error('Those lines give no ' + (old.type === 'sprint' ? 'run' : 'laps') + ' in the saved readings, so they cannot be accepted. Undo it.');
      next.date = old.date; next.time = old.time || next.time; next.fileName = old.fileName;
      if (old.ignoreFinish === false) next.ignoreFinish = false;
      if (!old.venueId) next.venueName = old.venue;
      var was = old.bestTime, now = next.bestTime;
      if (!window.confirm('Accept this change?\n\n' + r.what + '\nTime: ' + timeText(was) + ' to ' + timeText(now) + (p.to.time && Math.abs(p.to.time - now) > 0.05 ? '\n(They saw ' + timeText(p.to.time) + ', but from the saved readings it works out as ' + timeText(now) + '.)' : '') + '\n\nThe session changes as soon as you accept.')) { note('Not accepted. It is still waiting.'); return; }
      return fetch(url('/track/admin/retime'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, session: next }) })
        .then(function (x) { return x.json().catch(function () { return {}; }).then(function (d) { if (!x.ok || !d.success) throw new Error(d.message || 'Could not save the session.'); }); })
        .then(function () { return act({ action: 'accepted', id: id }, 'Accepted. The session is now ' + timeText(now) + '. Revoke their access when they are done.'); });
    }).catch(function (e) { note((e && e.message) || 'That did not work.', 'error'); });
  }

  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  wrap.addEventListener('click', function (e) {
    var g = e.target.closest('[data-grant]'), d = e.target.closest('[data-dismiss]'), r = e.target.closest('[data-revoke]'), a = e.target.closest('[data-accept]'), u = e.target.closest('[data-undo]');
    if (g) act({ action: 'grant', id: g.getAttribute('data-grant') }, 'Allowed. They have been emailed.');
    else if (d) act({ action: 'dismiss', id: d.getAttribute('data-dismiss') }, 'Declined.');
    else if (a) accept(a.getAttribute('data-accept'));
    else if (u && window.confirm('Undo this change? The session stays as it is and they keep their access.')) act({ action: 'undo', id: u.getAttribute('data-undo') }, 'Undone. The session was not changed.');
    else if (r && window.confirm('Switch off map editing for this session? Anything you have already accepted stays.')) act({ action: 'revoke', id: r.getAttribute('data-revoke') }, 'Switched off.');
  });
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  // The count shows without opening the panel, once the key is known.
  if (key()) load();
})();
