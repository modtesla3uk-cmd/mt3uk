/*
  admin.html, Tracks panel: the track list used by Track sessions
  (track.html). data/tracks.json is the starting list; changes made here are
  stored by the worker (KV track-library, /track/admin/tracks) on top of it.
  Also members' "new track" requests and taking entries off a leaderboard.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('tracks-wrap');
  if (!wrap) return;
  var listEl = document.getElementById('tk-list'), reqEl = document.getElementById('tk-requests'), formEl = document.getElementById('tk-form'), noteEl = document.getElementById('tk-note');
  var boardSel = document.getElementById('tk-board-pick'), boardEl = document.getElementById('tk-board');
  var library = null, base = null, extra = null, editing = null;

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path + (path.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }

  wrap.addEventListener('toggle', function () { if (wrap.open && !library) load(); });
  // The new-track requests show in the bell, so they load once the key is known and again on each check.
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(true); });
  if (key()) load(true);

  function load(quiet) {
    if (!key()) { note('Enter the admin key at the top of the page first.', 'error'); return; }
    if (!quiet) note('Loading tracks...');
    Promise.all([
      fetch('data/tracks.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { venues: [] }; }),
      call('GET', '/track/admin/tracks'),
      call('GET', '/track/admin/requests')
    ]).then(function (r) {
      if (!r[1].ok) { if (!quiet) note('The admin key is not right.', 'error'); return; }
      base = r[0]; extra = r[1].extra || { venues: [] }; library = r[1].library || base;
      note('');
      drawList(); drawRequests(r[2].requests || []); drawBoardPick();
    }).catch(function () { note('Could not load the tracks.', 'error'); });
  }

  // A map of a course: the trace a member sent (when there is one), the start
  // line (green) and the finish line (red), over the satellite picture.
  function openMap(title, outline, startLine, finishLine, note) {
    var T = window.MT3UKTrack, V = window.MT3UKTrackView;
    if (!T || !V) { window.alert('The map is still loading. Try again in a moment.'); return; }
    var first = (outline && outline[0]) || (startLine && startLine[0]) || (finishLine && finishLine[0]);
    if (!first) return;
    var proj = T.projector(first[0], first[1]);
    var lineXY = function (l) { return l ? l.map(function (p) { return proj.xy(p[0], p[1]); }) : null; };
    var pts = outline && outline.length > 1 ? outline.map(function (p) { return proj.xy(p[0], p[1]); }) : null;
    if (!pts) {
      // No trace: a stretch through the lines, along the way a car would drive.
      var s = lineXY(startLine), f = lineXY(finishLine);
      if (s && f) pts = [[(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2], [(f[0][0] + f[1][0]) / 2, (f[0][1] + f[1][1]) / 2]];
      else if (s) {
        var dx = s[1][0] - s[0][0], dy = s[1][1] - s[0][1], L = Math.hypot(dx, dy) || 1, cx = (s[0][0] + s[1][0]) / 2, cy = (s[0][1] + s[1][1]) / 2;
        pts = [[cx + dy / L * 100, cy - dx / L * 100], [cx - dy / L * 100, cy + dx / L * 100]];
      }
    }
    if (!pts) return;
    var d = 0, trace = pts.map(function (p, i) { if (i) d += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]); return [d, 0, p[0], p[1], 0, 0, 0]; });
    var old = document.getElementById('tk-map-modal');
    if (old) old.remove();
    var modal = document.createElement('div');
    modal.className = 'tk-map-modal'; modal.id = 'tk-map-modal';
    modal.innerHTML = '<div class="tk-map-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="tk-map-head"><h3>' + esc(title) + '</h3><button type="button" class="secondary iv-act" data-close-map>Close</button></div>' +
      '<div class="tk-map-box" id="tk-map-box"><svg class="tv-chart" id="tk-map-svg" role="img" aria-label="' + esc(title) + '"></svg></div>' +
      '<p class="tk-map-note">' + esc(note || 'Green is the start line, red is the finish line. Zoom with the + button, the wheel or a pinch.') + '</p></div>';
    document.body.appendChild(modal);
    var box = document.getElementById('tk-map-box'), svg = document.getElementById('tk-map-svg');
    V.map(svg, trace, { mono: true, fill: { w: box.clientWidth, h: box.clientHeight }, origin: first, startLine: lineXY(startLine), finishLine: finishLine && startLine ? lineXY(finishLine) : null });
    function close() { modal.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', function (e) { if (e.target === modal || e.target.closest('[data-close-map]')) close(); });
  }

  function lineText(l) { return l && l.length === 2 ? [l[0][0], l[0][1], l[1][0], l[1][1]].join(', ') : ''; }
  function parseLine(t) {
    var n = String(t || '').split(/[\s,]+/).filter(Boolean).map(Number);
    return n.length === 4 && n.every(isFinite) ? [[n[0], n[1]], [n[2], n[3]]] : null;
  }

  function drawList() {
    var changed = {};
    (extra.venues || []).forEach(function (v) { changed[v.id] = true; });
    listEl.innerHTML = '<table class="iv-table tk-table"><thead><tr><th>Track</th><th>Layouts</th><th>Set up</th><th></th></tr></thead><tbody>' + library.venues.map(function (v) {
      var layouts = v.layouts || [];
      var ready = v.type === 'drag' ? 'Drag strip' : layouts.map(function (l) { return esc(l.name) + ': ' + (l.startLine ? 'start line' : '<span class="tk-miss">no start line</span>') + (v.type === 'sprint' ? (l.finishLine ? ', finish line' : ', <span class="tk-miss">no finish line</span>') : '') + (l.corners && l.corners.length ? ', ' + l.corners.length + ' corners' : '') + (l.sectors && l.sectors.length ? ', ' + l.sectors.length + ' sector lines' : ''); }).join('<br>');
      return '<tr><td><b>' + esc(v.name) + '</b>' + (changed[v.id] ? ' <span class="iv-sub">(changed here)</span>' : '') + (v.check ? '<span class="iv-sub">Centre or lengths to check</span>' : '') + '</td><td>' + (v.type === 'drag' ? '-' : layouts.length) + '</td><td class="iv-sub">' + ready + '</td>' +
        '<td><div class="iv-actions">' + layouts.filter(function (l) { return l.startLine; }).map(function (l) { return '<button type="button" class="secondary iv-act" data-map="' + esc(v.id + ':' + l.id) + '">Map' + (layouts.length > 1 ? ': ' + esc(l.name) : '') + '</button>'; }).join('') + '<button type="button" class="secondary iv-act" data-edit="' + esc(v.id) + '">Edit</button><button type="button" class="danger iv-act" data-remove="' + esc(v.id) + '">Remove</button></div></td></tr>';
    }).join('') + '</tbody></table><div class="iv-toolbar tk-top"><button type="button" class="secondary" data-new>Add a track</button></div>';
  }

  listEl.addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]'), rm = e.target.closest('[data-remove]'), mp = e.target.closest('[data-map]');
    if (mp) {
      var ids = mp.getAttribute('data-map').split(':'), mv = library.venues.filter(function (v) { return v.id === ids[0]; })[0];
      var ml = mv && (mv.layouts || []).filter(function (l) { return l.id === ids[1]; })[0];
      if (ml) openMap(mv.name + (ml.name && ml.name !== mv.name ? ', ' + ml.name : ''), null, ml.startLine, mv.type === 'sprint' ? ml.finishLine : null, 'The official lines for this course. The line between them is only a guide; the picture shows the real ground.');
      return;
    }
    if (e.target.closest('[data-new]')) return openForm({ id: '', name: '', type: 'circuit', lat: '', lng: '', radius: 2000, layouts: [{ id: '', name: '', length: '' }] });
    if (ed) return openForm(JSON.parse(JSON.stringify(library.venues.filter(function (v) { return v.id === ed.getAttribute('data-edit'); })[0])));
    if (rm) {
      var id = rm.getAttribute('data-remove');
      if (!window.confirm('Remove this track? Sessions already saved there keep their times, but new files won\'t be matched to it.')) return;
      call('PUT', '/track/admin/tracks', { remove: id }).then(function (d) {
        if (!d.ok) { note(d.message || 'Could not remove it.', 'error'); return; }
        library = d.library; extra.venues = (extra.venues || []).filter(function (v) { return v.id !== id; }).concat([{ id: id, removed: true }]);
        drawList(); note('Removed.', 'ok');
      });
    }
  });

  function layoutHtml(l, i) {
    var sprint = editing && editing.type === 'sprint';
    return '<fieldset class="tk-layout" data-i="' + i + '"><legend>' + (sprint ? 'Course ' : 'Layout ') + (i + 1) + '</legend>' +
      '<div class="tk-row"><label>Name<input type="text" data-l="name" value="' + esc(l.name) + '"></label><label>' + (sprint ? 'Course length (m)' : 'Lap length (m)') + '<input type="text" inputmode="numeric" data-l="length" value="' + esc(l.length || '') + '"></label></div>' +
      (sprint ? '<label>Organiser (for example B19): courses at one venue can differ<input type="text" data-l="organizer" value="' + esc(l.organizer || '') + '"></label>' : '') +
      '<label>Start line: two points, as lat, lng, lat, lng<input type="text" data-l="startLine" placeholder="51.2077017, -1.6088667, 51.2076237, -1.6091363" value="' + esc(lineText(l.startLine)) + '"></label>' +
      (sprint ? '<label>Finish line: two points, as lat, lng, lat, lng<input type="text" data-l="finishLine" value="' + esc(lineText(l.finishLine)) + '"></label>' : '') +
      '<label>Sector lines, one per line (lat, lng, lat, lng)<textarea data-l="sectors" rows="2">' + esc((l.sectors || []).map(lineText).join('\n')) + '</textarea></label>' +
      '<label>Corners in order, one per line (Name, lat, lng)<textarea data-l="corners" rows="3" placeholder="Allard, 51.2094, -1.6093">' + esc((l.corners || []).map(function (c) { return c.name + ', ' + c.lat + ', ' + c.lng; }).join('\n')) + '</textarea></label>' +
      '<button type="button" class="danger iv-act" data-drop-layout="' + i + '">Remove layout</button></fieldset>';
  }

  function openForm(v) {
    editing = v;
    formEl.hidden = false;
    formEl.innerHTML = '<h3>' + (v.id ? 'Edit ' + esc(v.name) : 'Add a track') + '</h3>' +
      '<div class="tk-row"><label>Name<input type="text" id="tk-name" value="' + esc(v.name) + '"></label><label>Type<select id="tk-type"><option value="circuit"' + (v.type === 'circuit' || !v.type ? ' selected' : '') + '>Circuit</option><option value="drag"' + (v.type === 'drag' ? ' selected' : '') + '>Drag strip</option><option value="sprint"' + (v.type === 'sprint' && !v.hill ? ' selected' : '') + '>Sprint</option><option value="hill"' + (v.type === 'sprint' && v.hill ? ' selected' : '') + '>Hill climb</option></select></label></div>' +
      '<div class="tk-row"><label>Centre latitude<input type="text" inputmode="decimal" id="tk-lat" value="' + esc(v.lat) + '"></label><label>Centre longitude<input type="text" inputmode="decimal" id="tk-lng" value="' + esc(v.lng) + '"></label><label>Radius (m)<input type="text" inputmode="numeric" id="tk-radius" value="' + esc(v.radius || 2000) + '"></label></div>' +
      '<p class="iv-note">A file is matched to this track when most of it is inside the radius. Layouts are told apart by lap length.</p>' +
      '<div id="tk-layouts">' + (v.type === 'drag' ? '' : (v.layouts || []).map(layoutHtml).join('')) + '</div>' +
      (v.type === 'drag' ? '' : '<div class="iv-toolbar"><button type="button" class="secondary" id="tk-add-layout">' + (v.type === 'sprint' ? 'Add a course' : 'Add a layout') + '</button>' +
        '<label class="tk-from">Corners from a shared session<input type="text" id="tk-session" placeholder="Session link or id"></label><button type="button" class="secondary" id="tk-corners">Fill corners</button></div>') +
      '<div class="iv-toolbar"><button type="button" id="tk-save">Save track</button><button type="button" class="secondary" id="tk-cancel">Cancel</button>' +
      '<button type="button" class="tk-switch" role="switch" id="tk-check" aria-checked="' + !!v.check + '"><span class="tk-track"></span>Still to check</button></div>';
    formEl.scrollIntoView({ block: 'nearest' });
  }

  function readForm() {
    var v = { id: editing.id || '', name: document.getElementById('tk-name').value.trim(), type: document.getElementById('tk-type').value === 'hill' ? 'sprint' : document.getElementById('tk-type').value, hill: document.getElementById('tk-type').value === 'hill', lat: parseFloat(document.getElementById('tk-lat').value), lng: parseFloat(document.getElementById('tk-lng').value), radius: parseInt(document.getElementById('tk-radius').value, 10) || 2000, check: document.getElementById('tk-check').getAttribute('aria-checked') === 'true' };
    if (v.type !== 'drag') {
      v.layouts = [].slice.call(formEl.querySelectorAll('.tk-layout')).map(function (fs) {
        function f(k) { var el = fs.querySelector('[data-l="' + k + '"]'); return el ? el.value : ''; }
        return {
          id: (editing.layouts && editing.layouts[+fs.getAttribute('data-i')] || {}).id || '',
          name: f('name').trim(), organizer: f('organizer').trim(), length: parseInt(f('length'), 10) || 0, startLine: parseLine(f('startLine')), finishLine: parseLine(f('finishLine')),
          sectors: f('sectors').split('\n').map(parseLine).filter(Boolean),
          corners: f('corners').split('\n').map(function (row) { var p = row.split(','); return p.length >= 3 ? { name: p.slice(0, p.length - 2).join(',').trim(), lat: parseFloat(p[p.length - 2]), lng: parseFloat(p[p.length - 1]) } : null; }).filter(function (c) { return c && c.name && isFinite(c.lat) && isFinite(c.lng); })
        };
      }).filter(function (l) { return l.name; });
    }
    return v;
  }

  formEl.addEventListener('change', function (e) {
    if (e.target.id === 'tk-type') { editing = Object.assign(editing, readForm()); if (editing.type !== 'drag' && !(editing.layouts || []).length) editing.layouts = [{ name: '', length: '' }]; openForm(editing); }
  });
  formEl.addEventListener('click', function (e) {
    var sw = e.target.closest('#tk-check');
    if (sw) { sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); return; }
    if (e.target.id === 'tk-cancel') { formEl.hidden = true; editing = null; return; }
    if (e.target.id === 'tk-add-layout') { editing = Object.assign(editing, readForm()); editing.layouts.push({ name: '', length: '' }); return openForm(editing); }
    var drop = e.target.closest('[data-drop-layout]');
    if (drop) { var cur = readForm(); cur.layouts.splice(+drop.getAttribute('data-drop-layout'), 1); editing = Object.assign(editing, cur); return openForm(editing); }
    if (e.target.id === 'tk-corners') return fillCorners();
    if (e.target.id === 'tk-save') {
      var v = readForm();
      if (!v.name || !isFinite(v.lat) || !isFinite(v.lng)) { note('A track needs a name and a centre.', 'error'); return; }
      call('PUT', '/track/admin/tracks', { venue: v }).then(function (d) {
        if (!d.ok) { note(d.message || 'Could not save it.', 'error'); return; }
        library = d.library;
        extra.venues = (extra.venues || []).filter(function (x) { return x.id !== v.id; }).concat([v]);
        formEl.hidden = true; editing = null;
        drawList(); drawBoardPick(); note('Saved. New uploads use it straight away.', 'ok');
      });
    }
  });

  // Corners found on a shared session's best lap, numbered for naming.
  function fillCorners() {
    var raw = document.getElementById('tk-session').value.trim();
    var m = raw.match(/[?&]s=([a-f0-9]+)/) || raw.match(/^([a-f0-9]{8,40})$/);
    if (!m) { note('Paste a session link (track.html?s=...) or its id.', 'error'); return; }
    fetch(API + '/track/session?id=' + encodeURIComponent(m[1]), { headers: { 'X-Session-Token': localStorage.getItem('mt3ukMyBuildsSession') || '' }, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var s = d.session;
        if (!s || !s.corners || !s.corners.length) { note('That session has no corners, or isn\'t shared.', 'error'); return; }
        var box = formEl.querySelector('.tk-layout [data-l="corners"]');
        var lay = s.layoutId && editing.layouts ? editing.layouts.map(function (l) { return l.id; }).indexOf(s.layoutId) : 0;
        var boxes = formEl.querySelectorAll('.tk-layout [data-l="corners"]');
        if (lay >= 0 && boxes[lay]) box = boxes[lay];
        box.value = s.corners.map(function (c) { return (c.name || 'Corner ' + c.n) + ', ' + c.lat + ', ' + c.lng; }).join('\n');
        if (s.startLine && !box.closest('.tk-layout').querySelector('[data-l="startLine"]').value) box.closest('.tk-layout').querySelector('[data-l="startLine"]').value = lineText(s.startLine);
        note('Corners filled in from that session. Rename them, then Save track.', 'ok');
      }).catch(function () { note('Could not load that session.', 'error'); });
  }

  function outlineSvg(pts) {
    if (!pts || pts.length < 3) return '';
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p[1]); x1 = Math.max(x1, p[1]); y0 = Math.min(y0, p[0]); y1 = Math.max(y1, p[0]); });
    var k = Math.cos(y0 * Math.PI / 180), sc = Math.min(110 / (((x1 - x0) * k) || 1e-6), 70 / ((y1 - y0) || 1e-6));
    return '<svg class="tk-outline" viewBox="0 0 120 80" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="' + pts.map(function (p) { return (5 + (p[1] - x0) * k * sc).toFixed(1) + ',' + (75 - (p[0] - y0) * sc).toFixed(1); }).join(' ') + '"/></svg>';
  }

  function drawRequests(list) {
    var open = list.filter(function (r) { return !r.done; });
    document.getElementById('tracks-count').textContent = open.length ? '(' + open.length + ' new)' : '';
    reqEl.innerHTML = open.length ? open.map(function (r) {
      return '<div class="tk-req" data-id="' + esc(r.id) + '">' + outlineSvg(r.outline) + '<div><b>' + esc(r.name || 'Unnamed') + '</b> <span class="iv-sub">' + (r.kind === 'drag' ? 'Drag strip' : r.kind === 'sprint' ? 'Sprint or hill climb' : 'Circuit') + (r.venueId ? ', layout at ' + esc(r.venueId) : '') + (r.lapLength ? ', lap about ' + Math.round(r.lapLength) + ' m' : '') + ', from ' + esc(r.from) + ', ' + esc(String(r.at).slice(0, 10)) + '</span>' +
        (r.note ? '<p class="iv-sub">' + esc(r.note) + '</p>' : '') +
        '<p class="iv-sub"><a href="https://www.google.com/maps?q=' + r.lat + ',' + r.lng + '" target="_blank" rel="noopener">See it on a map</a>' + (r.startLine ? ' &middot; start line ' + esc(lineText(r.startLine)) : '') + '</p>' +
        '<div class="iv-actions">' + (r.startLine || (r.outline && r.outline.length > 1) ? '<button type="button" class="secondary iv-act" data-map-req="' + esc(r.id) + '">Open map</button>' : '') + (r.kind !== 'drag' && r.startLine && (r.kind !== 'sprint' || r.finishLine) ? '<button type="button" class="iv-act" data-add="' + esc(r.id) + '">Approve and add track</button>' : '') + '<button type="button" class="secondary iv-act" data-use="' + esc(r.id) + '">Set up by hand</button><button type="button" class="secondary iv-act" data-done="' + esc(r.id) + '">Dismiss</button></div></div></div>';
    }).join('') : '<p class="empty">No new requests.</p>';
    reqEl._list = list;
  }

  reqEl.addEventListener('click', function (e) {
    var mp = e.target.closest('[data-map-req]');
    if (mp) {
      var mr = reqEl._list.filter(function (x) { return x.id === mp.getAttribute('data-map-req'); })[0];
      if (mr) openMap((mr.name || 'New track') + (mr.organizer ? ', ' + mr.organizer : '') + ' (from a member\'s file)', mr.outline, mr.startLine, mr.kind === 'sprint' ? mr.finishLine : null, 'The line is the member\'s trace. Check the green start and red finish are where the course really starts and finishes before approving.');
      return;
    }
    var add = e.target.closest('[data-add]');
    if (add) {
      var aid = add.getAttribute('data-add');
      add.disabled = true;
      call('POST', '/track/admin/requests', { id: aid, action: 'add' }).then(function (d) {
        if (!d || !d.success) { add.disabled = false; note((d && d.message) || 'Could not add that track.', 'error'); return; }
        if (d.library) library = d.library;
        drawRequests(reqEl._list.map(function (x) { return x.id === aid ? Object.assign({}, x, { done: 'approved' }) : x; }));
        drawList();
        note(d.filled ? 'Official lines set for that course.' : 'Track added. ' + d.relinked + ' of the member\'s saved session' + (d.relinked === 1 ? '' : 's') + ' linked to it.', 'ok');
      });
      return;
    }
    var use = e.target.closest('[data-use]'), done = e.target.closest('[data-done]');
    var id = (use || done || {}).getAttribute ? (use || done).getAttribute(use ? 'data-use' : 'data-done') : null;
    if (!id) return;
    var r = reqEl._list.filter(function (x) { return x.id === id; })[0];
    if (use) {
      var known = r.venueId && library.venues.filter(function (v) { return v.id === r.venueId; })[0];
      var v = known ? JSON.parse(JSON.stringify(known)) : { id: '', name: r.name || '', type: r.kind || 'circuit', lat: r.lat, lng: r.lng, radius: r.kind === 'circuit' ? 2000 : 1500, layouts: [] };
      editing = v;
      if (v.type === 'circuit') v.layouts.push({ name: known ? 'New layout' : 'Full circuit', length: r.lapLength ? Math.round(r.lapLength) : '', startLine: r.startLine });
      if (v.type === 'sprint') v.layouts.push({ name: known ? 'New course' : 'Course', length: r.lapLength ? Math.round(r.lapLength) : '', startLine: r.startLine, finishLine: r.finishLine });
      openForm(v);
      call('POST', '/track/admin/requests', { id: id, action: 'approve' });
    } else {
      call('POST', '/track/admin/requests', { id: id, action: 'dismiss' }).then(function () {
        drawRequests(reqEl._list.map(function (x) { return x.id === id ? Object.assign({}, x, { done: 'dismissed' }) : x; }));
      });
    }
  });

  function drawBoardPick() {
    var opts = ['<option value="">Choose a leaderboard</option>'];
    library.venues.forEach(function (v) {
      if (v.type === 'drag') opts.push('<option value="drag-board:' + esc(v.id) + '">' + esc(v.name) + ' (drag)</option>');
      else (v.layouts || []).forEach(function (l) { opts.push('<option value="' + (v.type === 'sprint' ? 'sprint-board:' : 'track-board:') + esc(v.id) + ':' + esc(l.id) + '">' + esc(v.name + (l.name !== v.name ? ', ' + l.name : '')) + (v.type === 'sprint' ? ' (sprint)' : '') + '</option>'); });
    });
    boardSel.innerHTML = opts.join('');
  }
  boardSel.addEventListener('change', drawBoard);
  function drawBoard() {
    var b = boardSel.value;
    if (!b) { boardEl.innerHTML = ''; return; }
    var parts = b.split(':');
    var path = parts[0] === 'drag-board' ? '/drag/board?venue=' + parts[1] : (parts[0] === 'sprint-board' ? '/sprint/board?venue=' : '/track/board?venue=') + parts[1] + '&layout=' + parts[2];
    fetch(API + path, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var entries = d.entries || [];
      boardEl.innerHTML = entries.length ? '<table class="iv-table"><tbody>' + entries.map(function (en, i) {
        var res = en.time ? Math.floor(en.time / 60) + ':' + ((en.time % 60) < 10 ? '0' : '') + (en.time % 60).toFixed(3) : en.quarter ? en.quarter.toFixed(2) + ' s' : '';
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(en.car) + '<span class="iv-sub"> ' + esc(en.owner) + ', ' + esc(en.model) + '</span></td><td>' + res + '</td><td><a class="iv-sub" href="track.html?s=' + esc(en.sessionId) + '" target="_blank" rel="noopener">View</a></td><td><button type="button" class="danger iv-act" data-session="' + esc(en.sessionId) + '">Remove</button></td></tr>';
      }).join('') + '</tbody></table>' : '<p class="empty">Nobody on this board yet.</p>';
    });
  }
  boardEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-session]');
    if (!b || !window.confirm('Take this session off the leaderboard? It stays on the build.')) return;
    call('DELETE', '/track/admin/board-entry?board=' + encodeURIComponent(boardSel.value) + '&session=' + encodeURIComponent(b.getAttribute('data-session'))).then(function (d) {
      if (!d.ok) { note(d.message || 'Could not remove it.', 'error'); return; }
      drawBoard();
    });
  });

  // Brings every leaderboard place up to date, a few cars at a time.
  var rebuildBtn = document.getElementById('tk-rebuild'), rebuildNote = document.getElementById('tk-rebuild-note');
  if (rebuildBtn) rebuildBtn.addEventListener('click', function () {
    var cars = 0;
    rebuildBtn.disabled = true;
    function step(cursor) {
      call('POST', '/track/boards/rebuild' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
        if (!d.ok || !d.success) { rebuildNote.textContent = d.message || 'Could not rebuild the leaderboards.'; rebuildBtn.disabled = false; return; }
        cars += d.cars || 0;
        if (d.done) { rebuildNote.textContent = 'Done: ' + cars + ' car' + (cars === 1 ? '' : 's') + ' brought up to date.'; rebuildBtn.disabled = false; if (boardSel.value) drawBoard(); return; }
        rebuildNote.textContent = 'Working... ' + cars + ' cars so far.';
        step(d.cursor);
      }).catch(function () { rebuildNote.textContent = 'Could not reach the server.'; rebuildBtn.disabled = false; });
    }
    rebuildNote.textContent = 'Working...';
    step('');
  });
})();
