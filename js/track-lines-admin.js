/*
  track-admin.html, Line editing panel: members who asked to edit the start and finish lines on a session they
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
  function lineText(l) { return l && l.length === 2 ? [l[0][0], l[0][1], l[1][0], l[1][1]].map(function (v) { return Math.round(v * 1e7) / 1e7; }).join(', ') : 'not set'; }
  function timeText(t) { return t ? window.MT3UKTrack.fmtLap(t) : 'no time'; }
  function same(a, b) { return lineText(a) === lineText(b); }

  // What the member changed, from and to, for the admin to see before accepting or undoing.
  function changeHtml(r) {
    var p = r.proposal, sprint = r.type === 'sprint';
    function row(label, from, to) { return same(from, to) ? '' : '<tr><td>' + label + '</td><td>' + esc(lineText(from)) + '</td><td>' + esc(lineText(to)) + '</td></tr>'; }
    function pic(which, label) { return p.images && p.images[which] ? '<figure class="ln-pic"><a href="' + esc(url('/track/lines/image?id=' + encodeURIComponent(r.id) + '&which=' + which)) + '" target="_blank" rel="noopener"><img alt="' + esc(label) + ' on the map" src="' + esc(url('/track/lines/image?id=' + encodeURIComponent(r.id) + '&which=' + which)) + '"></a><figcaption>' + label + '</figcaption></figure>' : ''; }
    return '<div class="iv-sub">Changed ' + esc(when(p.at)) + '. The session has not changed yet.</div>' + (p.emailFailed ? '<div class="iv-sub tk-miss">The email about this change could not be sent, so this panel is the only place it shows.</div>' : '') +
      '<table class="iv-table"><thead><tr><th></th><th>From</th><th>To</th></tr></thead><tbody>' +
      row('Start line', p.from.startLine, p.to.startLine) + (sprint ? row('Finish line', p.from.finishLine, p.to.finishLine) : '') +
      '<tr><td>Time</td><td>' + esc(timeText(p.from.time)) + '</td><td>' + esc(timeText(p.to.time)) + ' <span class="iv-sub">(their figure, worked out again when you accept)</span></td></tr></tbody></table>' +
      (p.images && (p.images.before || p.images.after) ? '<div class="ln-pics">' + pic('before', 'Old lines') + pic('after', 'New lines') + '</div>' : '');
  }
  // A rename of the track on a session at an unlisted track: the same steps, but Accept changes the name on the worker.
  function renameHtml(r) {
    var p = r.proposal;
    return '<div class="iv-sub">Suggested ' + esc(when(p.at)) + '. Nothing has changed yet: accept it or deny it, and they are emailed either way.</div><table class="iv-table"><thead><tr><th></th><th>From</th><th>To</th></tr></thead><tbody><tr><td>' + (r.target === 'layout' ? 'Layout name' : 'Track name') + '</td><td>' + esc(p.from || 'none') + '</td><td>' + esc(p.to) + '</td></tr></tbody></table>';
  }
  function draw() {
    var changed = rows.filter(function (r) { return r.proposal; }).length, waiting = rows.filter(function (r) { return r.status === 'pending'; }).length;
    countEl.textContent = changed ? changed + ' to review' : waiting ? waiting + ' waiting' : (rows.length ? rows.length + ' allowed' : '');
    listEl.innerHTML = rows.length ? '<table class="iv-table"><thead><tr><th>Member</th><th>Map</th><th>Status</th><th></th></tr></thead><tbody>' + rows.map(function (r) {
      var rn = r.kind === 'rename', kindAttr = rn ? ' data-kind="rename"' : '';
      var state = r.status === 'pending' ? 'Asked ' + esc(when(r.at)) + (r.note ? '<br><span class="iv-sub">' + esc(r.note) + '</span>' : '')
        : r.proposal ? (rn ? renameHtml(r) : changeHtml(r))
        : 'Allowed ' + esc(when(r.grantedAt)) + '<br><span class="iv-sub">Waiting for them to ' + (rn ? (r.target === 'layout' ? 'rename the layout.' : 'rename the track.') : 'change the map.') + '</span>';
      var actions = r.status === 'pending'
        ? '<button type="button" class="iv-act" data-grant="' + esc(r.id) + '"' + kindAttr + '>Allow</button><button type="button" class="secondary iv-act" data-dismiss="' + esc(r.id) + '"' + kindAttr + '>Decline</button>'
        : (r.proposal ? '<button type="button" class="iv-act" data-accept="' + esc(r.id) + '"' + kindAttr + '>Accept</button><button type="button" class="secondary iv-act" data-undo="' + esc(r.id) + '"' + kindAttr + '>' + (rn ? 'Deny' : 'Undo') + '</button>' : '') +
          (rn && r.proposal ? '' : '<button type="button" class="danger iv-act" data-revoke="' + esc(r.id) + '"' + kindAttr + '>Revoke</button>');
      // For the notification bell: what this row is, and a key that changes when there is something new to see.
      var rowState = r.status === 'pending' ? 'pending' : r.proposal ? 'changed' : 'allowed';
      return '<tr' + kindAttr + ' data-id="' + esc(r.id) + '" data-state="' + rowState + '" data-key="' + esc((rn ? 'rename:' : '') + r.id + ':' + rowState + ':' + (r.proposal ? r.proposal.at : r.at)) + '"' + (r.id === targetId ? ' class="is-target"' : '') + '><td>' + esc(r.name ? r.name + ' ' : '') + '<span class="iv-sub">' + esc(r.email) + '</span></td>' +
        '<td><a href="track.html?s=' + encodeURIComponent(r.id) + '" target="_blank" rel="noopener">' + esc(r.what) + '</a>' + (rn ? '<br><span class="iv-sub">' + (r.target === 'layout' ? 'Rename the layout, for everyone' : 'Rename the track') + '</span>' : '') + '</td><td>' + state + '</td>' +
        '<td><div class="iv-actions">' + actions + '</div></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody has asked to edit a map or rename a track.</p>';
  }
  function load(keepNote) {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the list. Check the admin key.', 'error'); return; }
      rows = d.requests || []; if (!keepNote) note(''); draw(); focusFromLink();
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
  // The course a session is on: the track in the library and the course there, from the session's own course,
  // else its organiser, else the only course at the track. Nothing found means the session is on no listed course.
  function findCourse(lib, old) {
    var v = ((lib && lib.venues) || []).filter(function (x) { return x.id === old.venueId; })[0];
    if (!v || v.type === 'drag') return null;
    var ls = v.layouts || [], l = ls.filter(function (x) { return x.id === old.layoutId; })[0];
    if (!l) {
      var org = String(old.organizer || '').trim().toLowerCase();
      l = org ? ls.filter(function (x) { return String(x.organizer || x.name || '').trim().toLowerCase() === org; })[0] : (ls.length === 1 ? ls[0] : null);
    }
    return l ? { venue: v, layout: l } : null;
  }
  function postJson(path, body) {
    return fetch(url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (x) { return x.json().catch(function () { return {}; }).then(function (d) { if (!x.ok || !d.success) throw new Error(d.message || 'That did not work.'); return d; }); });
  }
  // Accept. On a listed course the member's lines become the course's official lines, the member's own session is
  // re-timed on them, and every other session at the track is re-timed from its saved readings (a time that moves
  // by over 10% is held back, as in Re-time sessions). A session on no listed course is changed on its own, and
  // keeps its lines through later re-times (linesAccepted). Either way the time is worked out again from the
  // readings here and shown first, never taken from the member.
  function accept(id) {
    var T = window.MT3UKTrack, r = rows.filter(function (x) { return x.id === id && x.kind !== 'rename'; })[0];
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
      var old = res[2].session, src = res[3], sprint = old && old.type === 'sprint';
      if (!old || !src.p || !src.rd) throw new Error('Could not read the session.');
      var lib = T.mergeLibrary(res[0], res[1] && res[1].extra);
      function options(extra) {
        var o = { type: old.type, ignoreFirstFinish: old.ignoreFinish !== false };
        if (old.rollout) o.rollout = true;
        if (old.organizer) o.organizer = old.organizer;
        if (old.finishCrossing) o.finishCrossing = old.finishCrossing;
        return Object.assign(o, extra || {});
      }
      function carry(next) {
        next.date = old.date; next.time = old.time || next.time; next.fileName = old.fileName;
        if (old.ignoreFinish === false) next.ignoreFinish = false;
        if (!old.venueId) next.venueName = old.venue;
        return next;
      }
      // The lines the member sent, and only those: the course's own lines are not used for this preview.
      var next = carry(T.analyse(restoreSource(src), lib, options({ ownLines: true, startLine: p.to.startLine, finishLine: sprint ? p.to.finishLine : undefined })));
      if ((next.problem || next.needsStartLine) && !(next.laps && next.laps.length)) throw new Error('Those lines give no ' + (sprint ? 'run' : 'laps') + ' in the saved readings, so they cannot be accepted. Undo it.');
      var course = findCourse(lib, old), was = old.bestTime, now = next.bestTime, name = course ? course.venue.name + (course.layout.name && course.layout.name !== course.venue.name ? ', ' + course.layout.name : '') : '';
      var ask = 'Accept this change?\n\n' + r.what + '\nTime: ' + timeText(was) + ' to ' + timeText(now) + (p.to.time && Math.abs(p.to.time - now) > 0.05 ? '\n(They saw ' + timeText(p.to.time) + ', but from the saved readings it works out as ' + timeText(now) + '.)' : '') + '\n\n' +
        (course ? 'This makes these the official ' + (sprint ? 'start and finish lines' : 'start line') + ' for ' + name + ', then re-times every other session at ' + course.venue.name + ' from its saved readings (a time that moves by over 10% is held back). That changes other members\' times and the leaderboards.\n\nIt all happens as soon as you accept.'
          : 'This session is not on a listed course, so only it changes. It changes as soon as you accept.');
      if (!window.confirm(ask)) { note('Not accepted. It is still waiting.'); return; }
      if (!course) {
        next.linesAccepted = true;
        return postJson('/track/admin/retime', { id: id, session: next })
          .then(function () { return act({ action: 'accepted', id: id }, 'Accepted. The session is now ' + timeText(now) + '. Revoke their access when they are done.'); });
      }
      note('Making these the official lines for ' + name + '...');
      return postJson('/track/admin/course', { kind: sprint ? 'sprint' : 'circuit', name: course.venue.name, organizer: course.layout.organizer || old.organizer || '', venueId: course.venue.id, layoutId: course.layout.id, replace: true,
        startLine: p.to.startLine, finishLine: sprint ? p.to.finishLine : null, lapLength: course.layout.length || 0, lat: course.venue.lat, lng: course.venue.lng })
        .then(function (d) {
          // The member's session first, now on the course's lines (which are theirs), so it is never held back.
          var mine = carry(T.analyse(restoreSource(src), d.library, options()));
          return postJson('/track/admin/retime', { id: id, session: mine }).then(function () { return mine; });
        })
        .then(function (mine) { return act({ action: 'accepted', id: id }, 'Accepted. The lines for ' + name + ' are updated and this session is ' + timeText(mine.bestTime) + '.').then(function () { return mine; }); })
        .then(function () {
          // The Tracks panel picks up the new lines, then every other session at the track is re-timed.
          document.dispatchEvent(new Event('mt3uk-admin-refresh'));
          if (!window.MT3UKTrackAdmin) { note('Accepted. The lines are updated: now press Re-time sessions here for ' + course.venue.name + ' on the Tracks panel.'); return; }
          return new Promise(function (resolve) {
            window.MT3UKTrackAdmin.retimeTrack(course.venue.id, course.venue.name, function (t) { note(t); }, function (msg) { note('Accepted. ' + msg + ' Revoke their access when they are done.'); resolve(); });
          });
        });
    }).catch(function (e) { note((e && e.message) || 'That did not work.', 'error'); });
  }

  // The link in the email, track-admin.html#lines-<session id>, opens this panel and shows that request (also when the
  // admin page is already open and only the end of the address changes).
  // targetId stays marked through every redraw of the list; the scroll (or the note that it is gone) happens once.
  var targetId = '', linkPending = false;
  function focusFromLink() {
    if (!linkPending) return;
    linkPending = false;
    var tr = targetId && listEl.querySelector('tr[data-id="' + targetId + '"]');
    if (tr) tr.scrollIntoView({ block: 'center' }); else if (targetId) note('That request is not waiting any more: it may already have been dealt with.');
  }
  function applyHash() {
    targetId = (/^#lines-([a-f0-9]{8,40})$/.exec(location.hash) || [])[1] || '';
    linkPending = !!targetId;
    if (!targetId && location.hash !== '#lines-wrap') return;
    wrap.scrollIntoView({ block: 'start' });
    if (wrap.open) load(); else wrap.open = true;
  }
  // A layout rename: the track list is changed first, then the saved sessions at the layout get the name a page at a time
  // (there can be many), and the member is emailed at the end.
  function applyLayoutRename(row) {
    var changed = 0;
    note('Renaming the layout in the track list...');
    function step(cursor) {
      return postJson('/track/lines/admin', { kind: 'rename', action: 'apply', id: row.id, cursor: cursor }).then(function (d) {
        changed += d.changed || 0;
        if (!d.done) { note('Renaming the layout on saved sessions... ' + changed + ' so far.'); return step(d.cursor); }
        note('Done. The layout is renamed in the track list and on ' + changed + (changed === 1 ? ' saved session.' : ' saved sessions.') + ' The member has been emailed.');
        load(true);
      });
    }
    postJson('/track/lines/admin', { kind: 'rename', action: 'accepted', id: row.id }).then(function () { return step(''); })
      .catch(function (e) { note((e && e.message) || 'That did not work.', 'error'); load(true); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  wrap.addEventListener('click', function (e) {
    var g = e.target.closest('[data-grant]'), d = e.target.closest('[data-dismiss]'), r = e.target.closest('[data-revoke]'), a = e.target.closest('[data-accept]'), u = e.target.closest('[data-undo]');
    var btn = g || d || r || a || u, rn = !!(btn && btn.getAttribute('data-kind') === 'rename'), kind = rn ? { kind: 'rename' } : {};
    function body(action, id) { return Object.assign({ action: action, id: id }, kind); }
    if (g) act(body('grant', g.getAttribute('data-grant')), 'Allowed. They have been emailed.');
    else if (d) act(body('dismiss', d.getAttribute('data-dismiss')), 'Declined.');
    else if (a && rn) {
      var row = rows.filter(function (x) { return x.id === a.getAttribute('data-accept') && x.kind === 'rename'; })[0];
      if (row && row.target === 'layout') {
        if (window.confirm('Rename this layout for everyone?\n\n' + row.what + '\nFrom: ' + (row.proposal.from || 'none') + '\nTo: ' + row.proposal.to + '\n\nIt is renamed in the track list and on every saved session at the layout. Nothing is re-timed.')) applyLayoutRename(row);
      }
      else if (row && window.confirm('Rename the track on this session?\n\n' + row.what + '\nFrom: ' + (row.proposal.from || 'none') + '\nTo: ' + row.proposal.to + '\n\nOnly this session changes. It changes as soon as you accept.')) act(body('accepted', row.id), 'Accepted. The track name is changed and the member has been emailed.');
    }
    else if (a) accept(a.getAttribute('data-accept'));
    else if (u && rn && window.confirm('Deny this name? Nothing changes and the member is emailed to say so.')) act(body('undo', u.getAttribute('data-undo')), 'Denied. The member has been emailed.');
    else if (u && !rn && window.confirm('Undo this change? The session stays as it is and they keep their access.')) act(body('undo', u.getAttribute('data-undo')), 'Undone. The session was not changed.');
    else if (r && window.confirm(rn ? 'Switch off renaming for this session? A name you have already accepted stays.' : 'Switch off map editing for this session? Anything you have already accepted stays.')) act(body('revoke', r.getAttribute('data-revoke')), 'Switched off.');
  });
  window.addEventListener('hashchange', applyHash);
  applyHash();
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  // The count shows without opening the panel, once the key is known.
  if (key()) load();
})();
