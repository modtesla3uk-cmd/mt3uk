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
    svgEl('circle', { cx: 150, cy: 150, r: 70, fill: 'none', stroke: '#5b6475', 'stroke-width': 2 }, s);
    svgEl('circle', { cx: 150, cy: 150, r: 47, fill: 'none', stroke: '#9aa1ad', 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, s);
    svgEl('circle', { cx: 150, cy: 150, r: 23, fill: 'none', stroke: '#9aa1ad', 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, s);
    svgEl('line', { x1: 75, y1: 150, x2: 225, y2: 150, stroke: '#9aa1ad', 'stroke-width': 1.5 }, s);
    svgEl('line', { x1: 150, y1: 75, x2: 150, y2: 225, stroke: '#9aa1ad', 'stroke-width': 1.5 }, s);
    var g = svgEl('g', { fill: '#5b6475', 'font-size': 11, 'font-weight': 700 }, s);
    svgEl('text', { x: 175, y: 145 }, g).textContent = '0.5g';
    svgEl('text', { x: 199, y: 145 }, g).textContent = '1.0g';
    svgEl('text', { x: 222, y: 145 }, g).textContent = '1.5g';
    svgEl('line', { id: 'rbt-tm-needle', x1: 150, y1: 150, x2: 150, y2: 44, stroke: '#e8542a', 'stroke-width': 5, 'stroke-linecap': 'round' }, s);
    var lab = svgEl('g', { id: 'rbt-tm-glabel' }, s);
    svgEl('rect', { x: 100, y: 236, width: 100, height: 26, rx: 3, fill: '#ececec', stroke: '#5b6475', 'stroke-width': 1.5 }, lab);
    var words = svgEl('text', { x: 150, y: 255, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: '#5b6475' }, lab);
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
    set('rbt-tm-text', !rbConnected ? 'Not connected' : rbFix ? rbSats + (rbSats === 1 ? ' satellite' : ' satellites') : 'Waiting for a GPS fix');
  }

  function setGo(text, go) {
    var b = $('rbt-tm-go');
    if (!b) return;
    b.textContent = text;
    b.classList.toggle('is-go', !!go);
  }
  // Until the RaceBox is connected the button asks for it; once connected it waits for the GPS fix, then it is ready.
  function idleLabel() { return !rbConnected ? 'Connect to RaceBox' : rbFix ? 'Time a run' : 'Acquiring GPS fix'; }

  // The runs: the timed runs (saved to the profile) and the runs in the saved Drag run drives, newest first. The best is
  // over both, and the latest five show, numbered as timed: the newest is the highest.
  var driveRunList = [];
  function allRuns() {
    return runs.map(function (r) { return { t: r.t, t30: r.t30, at: r.at, drive: false }; })
      .concat(driveRunList.map(function (r) { return { t: r.t, t30: r.t30, at: r.at, drive: true }; }))
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

  // The 0 to 60 timer: it arms on Go only from a standstill (under 1 mph), starts when the car moves off, and stops
  // at 60 mph. A car already moving when armed is not timed.
  function tap() {
    // Not connected yet: the button connects to the RaceBox, through the page's own connect switch.
    if (!rbConnected && launch.state !== 'armed') {
      var c = document.getElementById('rbt-connect');
      if (c && c.getAttribute('aria-checked') !== 'true') c.click();
      setGo('Connecting to RaceBox', false);
      return;
    }
    if (launch.state === 'armed') { launch.state = 'idle'; setGo(idleLabel(), false); return; }
    if (launch.stopped !== true) {
      setGo(launch.stopped === null ? 'Acquiring GPS fix' : 'Stop first, then tap Time a run', false);
      setTimeout(function () { if (launch.state === 'idle') setGo(idleLabel(), false); }, 2500);
      return;
    }
    launch.state = 'armed';
    launch.t30 = null;
    setGo('Go', true);
  }
  function step(speedMs, ts) {
    var speedMph = speedMs * 2.23694;
    var wasStopped = launch.stopped === true;
    launch.stopped = speedMph < STOP_MPH;
    if (launch.state === 'armed' && speedMph > STOP_MPH) {
      if (wasStopped) { launch.state = 'running'; launch.t0 = ts; }
      else { launch.state = 'idle'; setGo('Not from a stop, not saved. Stop, then tap Time a run.', false); return; }
    }
    if (launch.state !== 'running') return;
    var now = (ts - launch.t0) / 1000;
    if (launch.t30 === null && speedMph >= 30) launch.t30 = now;
    if (speedMph >= 60) {
      launch.state = 'done';
      addRun(now, launch.t30);
      setGo('Run ' + runs.length + ': ' + (launch.t30 !== null ? '0–30 ' + launch.t30.toFixed(2) + ' s · ' : '') + '0–60 ' + now.toFixed(2) + ' s', false);
    } else {
      var shown = useMph() ? speedMph : speedMs * 3.6;
      setGo(now.toFixed(2) + ' s · ' + Math.round(shown) + (useMph() ? ' mph' : ' km/h'), false);
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
    if (ev.state === 'connected') rbConnected = true;
    else if (ev.state === 'disconnected' || ev.state === 'notfound' || ev.state === 'failed') { rbConnected = false; rbFix = false; }
    refresh();
  }
  function onReading(r) {
    if (!r) return;
    rbConnected = true;
    rbSats = r.satellites || 0;
    rbFix = !!(r.fixOk && r.coordinatesValid);
    drawSats();
    if (launch.state === 'idle') setGo(idleLabel(), false);
    drawDial(r.speedMs || 0, r.gForce || null);
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
