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
  // Re-time sessions: when the timing code changes, saved sessions keep their old times. This reads each
  // session that was timed with an older version (MT3UKTrack.ANALYSIS_VERSION) and still has its readings,
  // works it out again with the member's own settings, saves it, then rebuilds the leaderboards.
  // Check sessions only counts and lists what would change.
  var retimeBtn = document.getElementById('tk-retime'), checkBtn = document.getElementById('tk-retime-check');
  var retimeNote = document.getElementById('tk-retime-note'), retimeList = document.getElementById('tk-retime-list');
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
  // The readings come back gzipped. The browser usually unzips them on the way in, but not always, so
  // look at the first two bytes and unzip here when they are still the gzip marker.
  function readSource(buf) {
    var b = new Uint8Array(buf);
    if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unzip the readings.');
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
    }
    return JSON.parse(new TextDecoder().decode(buf));
  }
  function fmtTime(t) { return t == null ? '-' : window.MT3UKTrack.fmtLap(t); }
  // The saved session's own settings, as the options the Add a session page would have used.
  function retimeOpts(old) {
    var o = { type: old.type, ignoreFirstFinish: old.ignoreFinish !== false };
    if (old.rollout) o.rollout = true;
    if (old.organizer) o.organizer = old.organizer;
    if (old.finishCrossing) o.finishCrossing = old.finishCrossing;
    if (old.startLineFromMember && old.startLine) { o.startLine = old.startLine; if (old.finishLine) o.finishLine = old.finishLine; }
    return o;
  }
  // A best time that moves by more than this is held back for a look: Check sessions flags it and Re-time
  // skips it unless the switch beside the button is on.
  var BIG_CHANGE = 0.1;
  function isBig(c) { return c.from != null && c.to != null && c.from > 0 && Math.abs(c.to - c.from) / c.from > BIG_CHANGE; }
  function retimeOne(row, apply, lib, allowBig) {
    var T = window.MT3UKTrack;
    return call('GET', '/track/admin/retime?id=' + encodeURIComponent(row.id)).then(function (d) {
      if (!d.success) throw new Error(d.message || 'Could not read the session.');
      var old = d.session;
      // The readings come as a gzip file. A transfer that fails once (a large file cut off) is tried again.
      function getSource(tries) {
        return fetch(API + '/track/admin/retime/source?id=' + encodeURIComponent(row.id) + '&key=' + encodeURIComponent(key()), { cache: 'no-store' }).then(function (r) {
          if (r.status === 404) throw new Error('No readings kept.');
          if (!r.ok) throw new Error('The readings could not be downloaded (' + r.status + ').');
          return r.arrayBuffer();
        }).catch(function (e) {
          if (tries > 0 && !/readings kept/.test(e && e.message || '')) return getSource(tries - 1);
          throw new Error(/readings/.test(e && e.message || '') ? e.message : 'The readings could not be downloaded.');
        });
      }
      return getSource(1).then(readSource).then(function (src) {
        if (!src.p || !src.rd) throw new Error('No readings kept.');
        var next = T.analyse(restoreSource(src), lib, retimeOpts(old));
        if (next.problem && !(next.laps && next.laps.length) && !(next.runs && next.runs.length)) throw new Error(next.problem);
        // The member's details and the date they typed carry over.
        next.date = old.date; next.time = old.time || next.time;
        next.fileName = old.fileName;
        if (old.ignoreFinish === false) next.ignoreFinish = false;
        if (!old.venueId) next.venueName = old.venue;
        var change = { id: row.id, venue: old.venue, date: old.date, type: old.type, from: old.type === 'drag' ? (old.runs && old.runs[0] && old.runs[0].s60) : old.bestTime, to: next.type === 'drag' ? (next.runs && next.runs[0] && next.runs[0].s60) : next.bestTime };
        change.big = isBig(change);
        if (!apply || (change.big && !allowBig)) return change;
        change.saved = true;
        return call('POST', '/track/admin/retime', { id: row.id, session: next }).then(function (res) {
          if (!res.ok || !res.success) throw new Error(res.message || 'Could not save.');
          return change;
        });
      });
    });
  }
  function runRetime(apply) {
    if (!key()) { retimeNote.textContent = 'Enter the admin key at the top of the page first.'; return; }
    if (!window.MT3UKTrack) { retimeNote.textContent = 'The timing code has not loaded yet.'; return; }
    var V = window.MT3UKTrack.ANALYSIS_VERSION;
    var seen = 0, old = 0, noSource = 0, done = 0, failed = 0, unchanged = 0, held = 0;
    var allowBig = bigSwitch && bigSwitch.getAttribute('aria-checked') === 'true';
    retimeBtn.disabled = checkBtn.disabled = true;
    retimeList.innerHTML = '';
    function say(t) { retimeNote.textContent = t; }
    function finish(msg) {
      say(msg);
      retimeBtn.disabled = checkBtn.disabled = false;
    }
    // Each line links to the session, which the admin can open read only to see whose it is.
    function line(t, id) {
      var li = document.createElement('li');
      if (id) { var a = document.createElement('a'); a.href = 'track.html?s=' + encodeURIComponent(id); a.target = '_blank'; a.rel = 'noopener'; a.textContent = t; li.appendChild(a); }
      else li.textContent = t;
      retimeList.appendChild(li);
    }
    Promise.all([
      fetch('data/tracks.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { venues: [] }; }),
      call('GET', '/track/admin/tracks')
    ]).then(function (res) {
      var lib = window.MT3UKTrack.mergeLibrary(res[0], res[1] && res[1].extra);
      function page(cursor) {
        call('GET', '/track/admin/retime' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
          if (!d.ok || !d.success) { finish(d.message || 'Could not list the sessions.'); return; }
          var todo = [];
          d.sessions.forEach(function (r) {
            seen++;
            if (r.type === 'other' || r.version >= V) return;
            old++;
            if (!r.hasSource) { noSource++; return; }
            todo.push(r);
          });
          var chain = Promise.resolve();
          todo.forEach(function (r) {
            chain = chain.then(function () {
              return retimeOne(r, apply, lib, allowBig).then(function (c) {
                var same = c.from === c.to || (c.from != null && c.to != null && Math.abs(c.from - c.to) < 0.0005);
                var text = c.venue + ', ' + c.date + ' (' + c.type + '): ' + fmtTime(c.from) + ' to ' + fmtTime(c.to);
                if (c.big && (!apply || !allowBig)) { held++; line(text + (apply ? ' (over 10%, not saved)' : ' (over 10%, held back unless you allow big changes)'), c.id); return; }
                // Every session saved is listed, so the admin can see what was touched; a check lists only what moves.
                if (same) { unchanged++; if (apply) line(c.venue + ', ' + c.date + ' (' + c.type + '): ' + fmtTime(c.to) + ' (same time)', c.id); } else line(text, c.id);
                done++;
              }).catch(function (e) { failed++; line(r.venue + ', ' + r.date + ': skipped (' + (e && e.message || 'error') + ')', r.id); });
            });
          });
          chain.then(function () {
            say((apply ? 'Working... ' : 'Checking... ') + seen + ' sessions looked at, ' + old + ' out of date.');
            if (!d.done) { page(d.cursor); return; }
            var summary = seen + ' sessions looked at. ' + old + ' were timed with older code: ' + done + (apply ? ' re-timed' : ' can be re-timed') + ' (' + unchanged + ' came out the same), ' + held + ' held back for moving over 10%, ' + noSource + ' have no readings kept so the member needs to upload again, ' + failed + ' skipped.';
            if (!apply) { finish(summary); return; }
            say(summary + ' Rebuilding the leaderboards...');
            var cars = 0;
            (function step(c) {
              call('POST', '/track/boards/rebuild' + (c ? '?cursor=' + encodeURIComponent(c) : '')).then(function (b) {
                if (!b.ok || !b.success) { finish(summary + ' The leaderboards could not be rebuilt: use Rebuild all leaderboards.'); return; }
                cars += b.cars || 0;
                if (b.done) { finish(summary + ' Leaderboards rebuilt (' + cars + ' cars).'); return; }
                step(b.cursor);
              }).catch(function () { finish(summary + ' The leaderboards could not be rebuilt: use Rebuild all leaderboards.'); });
            })('');
          });
        }).catch(function () { finish('Could not reach the server.'); });
      }
      say('Looking at the sessions...');
      page('');
    }).catch(function () { finish('Could not load the track list.'); });
  }
  var bigSwitch = document.getElementById('tk-retime-big');
  if (bigSwitch) bigSwitch.addEventListener('click', function () { bigSwitch.setAttribute('aria-checked', bigSwitch.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); });
  if (checkBtn) checkBtn.addEventListener('click', function () { runRetime(false); });
  if (retimeBtn) retimeBtn.addEventListener('click', function () {
    if (!window.confirm('Re-time every session that was timed with older code? Their times will change. Run Check sessions first to see what moves.')) return;
    runRetime(true);
  });
})();
