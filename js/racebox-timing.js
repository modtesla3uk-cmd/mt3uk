/*
 * Drag run timing on the RaceBox page (the Drag run mode). A 0 to 60 mph timer, with the 0 to 30 on the way, the runs
 * saved to the member's profile (the worker's /navigate/runs), a speed dial with a G meter, and the satellites.
 * It reads the RaceBox's own readings through window.MT3UKRaceBoxApp, so js/racebox-app.js must load first.
 * The section (#rbt-timing) is shown by racebox-test.js only in the Drag run mode.
 */
(function () {
  'use strict';
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var NS = 'http://www.w3.org/2000/svg';
  var MAX_MPH = 140, STOP_MPH = 1, SEGS = 12, LIST = 5, KEEP = 20;
  // The G drawing: 1.0 g is 47 across the dial (dotted rings at 0.5 g and 1.0 g, a solid ring at 1.5 g).
  var G_PER_RING = 47;

  function $(id) { return document.getElementById(id); }
  function set(id, t) { var e = $(id); if (e) e.textContent = t; }
  function svgEl(tag, attrs, parent) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(el);
    return el;
  }
  function useMph() { try { return localStorage.getItem('mt3ukRaceBoxUnit') !== 'kmh'; } catch (e) { return true; } }
  function token() { try { return localStorage.getItem('mt3ukMyBuildsSession'); } catch (e) { return null; } }
  function clamp(v, m) { return Math.max(-m, Math.min(m, v)); }

  var runs = [];
  var rbFix = false, rbSats = 0, rbConnected = false, gTare = { x: 0, y: 0 };
  var launch = { state: 'idle', t0: 0, t30: null, stopped: null };

  function bestOf(a) { return a.length ? Math.min.apply(null, a.map(function (r) { return r.t; })) : null; }

  // The dial: the speed ring with its numbers, the needle, and the G meter inside it.
  function buildDial() {
    var host = $('rbt-tm-dial');
    if (!host || host.firstChild) return;
    var s = svgEl('svg', { viewBox: '0 0 300 300', role: 'img', 'aria-label': 'Speed and G meter' }, host);
    svgEl('circle', { cx: 150, cy: 150, r: 112, fill: 'none', stroke: '#9aa1ad', 'stroke-width': 3 }, s);
    var ticks = svgEl('g', { stroke: '#9aa1ad' }, s);
    var labels = svgEl('g', { fill: '#5b6475', 'font-size': 15, 'font-weight': 700, 'text-anchor': 'middle' }, s);
    // A tick every 5 mph: longest with the number every 20 mph, medium every 10.
    for (var m = 0; m <= MAX_MPH; m += 5) {
      var a = (-135 + 270 * m / MAX_MPH) * Math.PI / 180, major = m % 20 === 0, medium = m % 10 === 0;
      var r1 = major ? 96 : medium ? 101 : 106;
      svgEl('line', {
        x1: 150 + Math.sin(a) * r1, y1: 150 - Math.cos(a) * r1,
        x2: 150 + Math.sin(a) * 112, y2: 150 - Math.cos(a) * 112,
        'stroke-width': major ? 3 : medium ? 2 : 1.2
      }, ticks);
      if (major) {
        var t = svgEl('text', { x: 150 + Math.sin(a) * 130, y: 150 - Math.cos(a) * 130 + 5 }, labels);
        t.textContent = String(m);
      }
    }
    // The same needle reads km/h on the inside, with the same increments as the mph scale: a tick every 5 km/h, a medium
    // one every 10, and a long one with its number every 20.
    var KPH_FULL = MAX_MPH * 1.60934;
    var kphTicks = svgEl('g', { stroke: '#8f9bb3', 'stroke-linecap': 'butt' }, s);
    var kphLabels = svgEl('g', { fill: '#6b7790', 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' }, s);
    for (var k = 0; k <= KPH_FULL; k += 5) {
      var ka = (-135 + 270 * k / KPH_FULL) * Math.PI / 180, kmajor = k % 20 === 0, kmed = k % 10 === 0;
      var kr1 = kmajor ? 84 : kmed ? 86 : 87;
      svgEl('line', { x1: 150 + Math.sin(ka) * kr1, y1: 150 - Math.cos(ka) * kr1, x2: 150 + Math.sin(ka) * 90, y2: 150 - Math.cos(ka) * 90, 'stroke-width': kmajor ? 1.8 : kmed ? 1.5 : 1.2 }, kphTicks);
      if (kmajor) {
        // Each number sits clear of the G ring (radius 70), outside it, between the rings.
        // Labels that sit near the horizontal (near 180 km/h, say) move up a little, to clear the G values on their row.
        var nudge = Math.abs(Math.cos(ka)) < 0.3 ? -10 : 0;
        var kt = svgEl('text', { x: 150 + Math.sin(ka) * 77, y: 150 - Math.cos(ka) * 77 + 3 + nudge }, kphLabels);
        kt.textContent = String(k);
      }
    }
    var unitT = svgEl('text', { x: 150, y: 62, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#6b7790' }, s);
    unitT.textContent = 'km/h';
    svgEl('circle', { cx: 150, cy: 150, r: 70, fill: 'none', stroke: '#5b6475', 'stroke-width': 2 }, s);
    svgEl('circle', { cx: 150, cy: 150, r: 47, fill: 'none', stroke: '#9aa1ad', 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, s);
    svgEl('circle', { cx: 150, cy: 150, r: 23, fill: 'none', stroke: '#9aa1ad', 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, s);
    svgEl('line', { x1: 75, y1: 150, x2: 225, y2: 150, stroke: '#9aa1ad', 'stroke-width': 1.5 }, s);
    svgEl('line', { x1: 150, y1: 75, x2: 150, y2: 225, stroke: '#9aa1ad', 'stroke-width': 1.5 }, s);
    var g = svgEl('g', { fill: '#5b6475', 'font-size': 11, 'font-weight': 700 }, s);
    // The values sit together on one line just right of the centre dot, with commas between them.
    svgEl('text', { x: 164, y: 145, 'font-size': 9.5 }, g).textContent = '0.5, 1.0, 1.5';
    svgEl('line', { id: 'rbt-tm-needle', x1: 150, y1: 150, x2: 150, y2: 44, stroke: '#e8542a', 'stroke-width': 5, 'stroke-linecap': 'round' }, s);
    var lab = svgEl('g', { id: 'rbt-tm-glabel' }, s);
    // The G Forces label, straight, under the inner G rings.
    var words = svgEl('text', { x: 150, y: 236, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#5b6475', 'letter-spacing': 0.6 }, lab);
    words.textContent = 'G Forces';
    svgEl('circle', { id: 'rbt-tm-gdot', cx: 150, cy: 150, r: 9, fill: '#b3261e' }, s);
  }

  // The needle and the speed; the dot is the G forces, zeroed while the car is still.
  function drawDial(speedMs, g) {
    var mphNow = (speedMs || 0) * 2.23694;
    var frac = Math.max(0, Math.min(1, mphNow / MAX_MPH));
    var needle = $('rbt-tm-needle');
    if (needle) needle.setAttribute('transform', 'rotate(' + (-135 + 270 * frac) + ' 150 150)');
    var shown = useMph() ? mphNow : (speedMs || 0) * 3.6;
    set('rbt-tm-speed', String(Math.round(shown)));
    set('rbt-tm-unit', useMph() ? 'mph' : 'km/h');
    var dot = $('rbt-tm-gdot');
    if (dot && g) {
      if (mphNow < STOP_MPH) gTare = { x: g.x || 0, y: g.y || 0 };
      var side = clamp((g.y || 0) - gTare.y, 1.2), fwd = clamp((g.x || 0) - gTare.x, 1.2);
      dot.setAttribute('cx', 150 + side * G_PER_RING);
      dot.setAttribute('cy', 150 - fwd * G_PER_RING);
    }
  }

  // The satellites: empty until the RaceBox has a fix, then a segment for each satellite (up to 12).
  var segsBuilt = false;
  function drawSats() {
    // The dial glows red from the GPS fix on, and stays red (no pulse).
    var dial = $('rbt-tm-dial');
    if (dial) dial.classList.toggle('rbt-tm-fixed', !!rbFix);
    var bars = $('rbt-tm-bars');
    if (!bars) return;
    if (!segsBuilt) {
      segsBuilt = true;
      for (var i = 0; i < SEGS; i++) {
        var seg = document.createElement('span');
        seg.className = 'rbt-tm-seg';
        bars.appendChild(seg);
      }
    }
    var on = rbFix ? Math.min(rbSats, SEGS) : 0;
    var segs = bars.children;
    for (var k = 0; k < segs.length; k++) segs[k].classList.toggle('is-on', k < on);
    set('rbt-tm-text', !rbConnected ? (btOff ? 'Bluetooth is off. Turn it on, then tap Connect to RaceBox.' : 'Not connected') : rbFix ? rbSats + (rbSats === 1 ? ' satellite' : ' satellites') : '');
    var tmText = document.getElementById('rbt-tm-text'); if (tmText) tmText.classList.toggle('rbt-tm-bt', !!(btOff && !rbConnected));
    // While waiting for a GPS fix, five dots light up across and then reset, until the fix comes.
    var waitingFix = rbConnected && !rbFix;
    if (tmText) tmText.classList.toggle('rbt-tm-wait', waitingFix);
    var dots = document.getElementById('rbt-tm-wait-dots'); if (dots) dots.hidden = !waitingFix;
  }

  function setGo(text, go) {
    var b = $('rbt-tm-go');
    if (!b) return;
    b.textContent = text;
    b.classList.toggle('is-go', !!go);
  }
  // Until the RaceBox is connected the button asks for it; once connected it waits for the GPS fix, then it is ready.
  // Connecting: the button is greyed out from the tap until the RaceBox connects or fails, so it is not pressed again.
  var busy = false, busyTimer = null;
  function setBusy(on) {
    busy = on;
    clearTimeout(busyTimer);
    var b = $('rbt-tm-go');
    if (b) {
      b.disabled = on;
      b.classList.toggle('is-busy', on);
      b.setAttribute('aria-busy', on ? 'true' : 'false');
    }
    // A connection that never answers is given up after half a minute, so the button is not stuck grey.
    if (on) busyTimer = setTimeout(function () { setBusy(false); refresh(); }, 30000);
  }
  var btOff = false;
  function idleLabel() {
    if (busy) return 'Connecting to RaceBox';
    return !rbConnected ? 'Connect to RaceBox' : rbFix ? 'Time a run' : 'Acquiring GPS fix';
  }

  // The runs: the timed runs (saved to the profile) and the runs in the saved Drag run drives, newest first. The best is
  // over both, and the latest five show, numbered as timed: the newest is the highest.
  var driveRunList = [];
  function allRuns() {
    var timed = runs.map(function (r) { return { t: r.t, t30: r.t30, at: r.at, drive: false }; });
    // A run timed while its drive was recorded is listed once, as the timed run: the drive has the same figures.
    var drives = driveRunList.filter(function (d) {
      return !timed.some(function (r) { return Math.abs(r.t - d.t) < 0.05; });
    }).map(function (r) { return { t: r.t, t30: r.t30, at: r.at, drive: true }; });
    return timed.concat(drives)
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }
  function drawRuns() {
    var all = allRuns();
    var best = bestOf(all);
    set('rbt-tm-best', best === null ? '' : 'Best ' + best.toFixed(2) + ' s');
    var none = $('rbt-tm-none'), list = $('rbt-tm-list'), clear = $('rbt-tm-clear');
    if (none) none.hidden = all.length > 0;
    if (clear) clear.hidden = runs.length === 0;
    if (!list) return;
    list.innerHTML = '';
    all.slice(0, LIST).forEach(function (r, i) {
      var li = document.createElement('li');
      if (r.t === best) li.className = 'is-best';
      var no = document.createElement('span'), half = document.createElement('span'), sixty = document.createElement('span');
      no.className = 'rbt-tm-no';
      no.textContent = 'Run ' + (all.length - i) + (r.drive ? ' (drive)' : '');
      half.className = 'rbt-tm-half';
      half.textContent = typeof r.t30 === 'number' ? '0\u201330 ' + r.t30.toFixed(2) + ' s' : '';
      sixty.className = 'rbt-tm-sixty';
      sixty.textContent = '0\u201360 ' + r.t.toFixed(2) + ' s';
      li.appendChild(no);
      li.appendChild(half);
      li.appendChild(sixty);
      list.appendChild(li);
    });
  }
  // The saved Drag run drives are read again whenever they change (the page announces it).
  function refreshDrives() {
    if (!window.MT3UKRaceBoxDrives || !window.MT3UKRaceBoxDrives.dragRuns) return;
    window.MT3UKRaceBoxDrives.dragRuns().then(function (list) { driveRunList = list; drawRuns(); }).catch(function () {});
  }
  function loadRuns() {
    var s = token();
    if (!s) return;
    fetch(API + '/navigate/runs', { cache: 'no-store', headers: { 'X-Session-Token': s } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.success || !Array.isArray(d.runs)) return;
        runs = d.runs;
        drawRuns();
      })
      .catch(function () {});
  }
  // A finished run shows at once and is saved to the profile.
  function addRun(t, t30) {
    var s = token(), rounded = Math.round(t * 100) / 100;
    var split = typeof t30 === 'number' ? Math.round(t30 * 100) / 100 : null;
    runs = [{ t: rounded, t30: split, at: Date.now() }].concat(runs).slice(0, KEEP);
    drawRuns();
    if (!s) return;
    fetch(API + '/navigate/runs', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Session-Token': s }, body: JSON.stringify({ t: rounded, t30: split }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.success && Array.isArray(d.runs)) { runs = d.runs; drawRuns(); } })
      .catch(function () {});
  }
  function clearRuns() {
    if (!window.confirm('Clear all your saved 0 to 60 runs? This cannot be undone.')) return;
    runs = [];
    drawRuns();
    var s = token();
    if (!s) return;
    fetch(API + '/navigate/runs', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Session-Token': s }, body: JSON.stringify({ clear: true }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.success && Array.isArray(d.runs)) { runs = d.runs; drawRuns(); } })
      .catch(function () {});
  }

  // A timed run records its own drive, against the strip chosen (Drag run has no Start recording). A drive that was
  // already recording (Record a drive in Controls) belongs to its owner, so only a drive started here is stopped here.
  var ownRec = false;
  function recordRun() { var rr = window.MT3UKRaceBoxRecord; ownRec = !!(rr && rr.start()); }
  function endRecord() { var rr = window.MT3UKRaceBoxRecord; if (ownRec && rr) rr.stop(); ownRec = false; }

  // The 0 to 60 timer: it arms on Go only from a standstill (under 1 mph), starts when the car moves off, and stops
  // at 60 mph. A car already moving when armed is not timed.
  // The timer card shows the run: "Move off to start" when armed, the live time while running, and the final time when done.
  function timerCard(kind, sec, mph, t30, label) {
    var c = $('rbt-timer-card'); if (!c) return;
    if (kind === 'hidden') { c.hidden = true; return; }
    c.hidden = false;
    set('rbt-timer-label', label);
    set('rbt-timer-time', (sec || 0).toFixed(2));
    var sub = (t30 !== null && t30 !== undefined ? '0\u201330 ' + t30.toFixed(2) + ' s · ' : '') + Math.round(mph || 0) + ' mph';
    set('rbt-timer-sub', kind === 'armed' ? '' : sub);
  }
  function tap() {
    // Not connected yet: the button connects to the RaceBox, through the page's own connect switch.
    if (!rbConnected && launch.state !== 'armed') {
      if (busy) return;
      var c = document.getElementById('rbt-connect');
      if (c && c.getAttribute('aria-checked') !== 'true') c.click();
      setBusy(true);
      setGo('Connecting to RaceBox', false);
      return;
    }
    if (launch.state === 'armed') { launch.state = 'idle'; endRecord(); timerCard('hidden'); setGo(idleLabel(), false); return; }
    if (launch.stopped !== true) {
      setGo(launch.stopped === null ? 'Acquiring GPS fix' : 'Stop first, then tap Time a run', false);
      setTimeout(function () { if (launch.state === 'idle') setGo(idleLabel(), false); }, 2500);
      return;
    }
    launch.state = 'armed';
    launch.t30 = null;
    timerCard('armed', 0, 0, null, 'Move off to start');
    recordRun();
    setGo('Go', true);
  }
  function step(speedMs, ts) {
    var speedMph = speedMs * 2.23694;
    var wasStopped = launch.stopped === true;
    launch.stopped = speedMph < STOP_MPH;
    if (launch.state === 'armed' && speedMph > STOP_MPH) {
      if (wasStopped) { launch.state = 'running'; launch.t0 = ts; }
      else { launch.state = 'idle'; endRecord(); timerCard('hidden'); setGo('Not from a stop, not saved. Stop, then tap Time a run.', false); return; }
    }
    if (launch.state !== 'running') return;
    var now = (ts - launch.t0) / 1000;
    if (launch.t30 === null && speedMph >= 30) launch.t30 = now;
    if (speedMph >= 60) {
      launch.state = 'done';
      addRun(now, launch.t30);
      endRecord();
      setGo('Go', false);
      timerCard('done', now, speedMph, launch.t30, 'Run ' + runs.length + ' · 0–60');
    } else {
      var shown = useMph() ? speedMph : speedMs * 3.6;
      setGo(now.toFixed(2) + ' s · ' + Math.round(shown) + (useMph() ? ' mph' : ' km/h'), false);
      timerCard('running', now, speedMph, launch.t30, 'Running');
    }
  }

  // Every reading from the RaceBox: the satellites, the dial and the G meter, and the timer on a fix.
  // The RaceBox's connection, from its status: connected, or not (searching, not found, dropped).
  function refresh() {
    drawSats();
    if (launch.state === 'idle') setGo(idleLabel(), false);
  }
  function onStatus(ev) {
    if (!ev) return;
    if (ev.state !== 'disconnected' || ev.detail !== 'bluetooth') btOff = false;
    if (ev.state === 'connected') { rbConnected = true; setBusy(false); }
    else if (ev.state === 'disconnected' && ev.detail === 'bluetooth') {
      // The phone's Bluetooth is off: the full-screen view hides the page's own message, so say it here too.
      rbConnected = false; rbFix = false; btOff = true; setBusy(false);
    }
    else if (ev.state === 'disconnected' || ev.state === 'notfound' || ev.state === 'failed') { rbConnected = false; rbFix = false; setBusy(false); }
    else if (!rbConnected && (ev.state === 'scanning' || ev.state === 'connecting' || ev.state === 'discovering') && !busy) setBusy(true);
    refresh();
  }
  function onReading(r) {
    if (!r) return;
    rbConnected = true;
    rbSats = r.satellites || 0;
    var fixNow = !!(r.fixOk && r.coordinatesValid);
    rbFix = fixNow;
    drawSats();
    if (launch.state === 'idle') setGo(idleLabel(), false);
    drawDial(r.speedMs || 0, r.gForce || null);
    if (busy) setBusy(false);
    if (rbFix) step(r.speedMs || 0, r.utc);
  }

  // Full screen: the timing fills the screen, with its button to come back (the page's own map has its own).
  var FULL_ICON = { expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', exit: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' };
  function setFull(on) {
    var sec = $('rbt-timing'), fs = $('rbt-tm-fs');
    if (!sec) return;
    sec.classList.toggle('rbt-tm-full', !!on);
    document.documentElement.classList.toggle('rbt-tm-full-on', !!on);
    if (fs) {
      fs.setAttribute('aria-pressed', on ? 'true' : 'false');
      fs.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      var path = fs.querySelector('path');
      if (path) path.setAttribute('d', on ? FULL_ICON.exit : FULL_ICON.expand);
    }
  }
  function init() {
    if (!$('rbt-timing')) return;
    var fsBtn = $('rbt-tm-fs');
    if (fsBtn) fsBtn.addEventListener('click', function () { setFull(!$('rbt-timing').classList.contains('rbt-tm-full')); });
    buildDial();
    // The needle starts at 0 mph, not at its drawn position (straight up, which is 70 mph).
    drawDial(0, null);
    drawSats();
    setGo(idleLabel(), false);
    var go = $('rbt-tm-go');
    if (go) go.addEventListener('click', tap);
    var clear = $('rbt-tm-clear');
    if (clear) clear.addEventListener('click', clearRuns);
    drawRuns();
    loadRuns();
    refreshDrives();
    window.addEventListener('mt3uk-drives-changed', refreshDrives);
    if (window.MT3UKRaceBoxApp && window.MT3UKRaceBoxApp.onReading) window.MT3UKRaceBoxApp.onReading(onReading);
    if (window.MT3UKRaceBoxApp && window.MT3UKRaceBoxApp.onStatus) window.MT3UKRaceBoxApp.onStatus(onStatus);
    // A connection made before this page was opened is shown at once.
    if (window.MT3UKRaceBoxApp && window.MT3UKRaceBoxApp.status) window.MT3UKRaceBoxApp.status().then(function (st) { if (st && st.connected) { rbConnected = true; refresh(); } }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // For the page's own checks.
  window.MT3UKRaceBoxTiming = { full: setFull, refreshDrives: refreshDrives, state: function () { return { state: launch.state, runs: runs.length, fix: rbFix, sats: rbSats }; } };
})();
