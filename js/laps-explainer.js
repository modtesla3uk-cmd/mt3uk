/*
  The Laps explainer: a short animated picture of what Laps does, drawn live on a canvas so it can be changed without
  re-rendering a video. The choices (the circuit, mph or km/h, the words in each scene, the sound) are saved by the
  admin on track-admin.html ("Laps video" panel, KV laps-explainer, /laps/explainer/admin) and read by everyone from
  /laps/explainer. Sound is made in the browser (no audio file). It starts only when a viewer presses Sound on, because
  browsers do not let a page make sound by itself.

  window.MT3UKExplainer.mount(el, settings, opts) draws it inside el and returns { set(settings), destroy() }.
  opts.autoplay (default true). A page with [data-laps-explainer] is mounted on load from the worker's settings.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var W = 960, H = 540, TOTAL = 17, FADE = 0.35, PATH_N = 720;
  // How fast the picture runs. Slow (0.77) is the default: the 17 second loop takes about 22 seconds.
  var PACES = { slowest: { name: 'Slowest', rate: 0.6 }, slow: { name: 'Slow', rate: 0.77 }, normal: { name: 'Normal', rate: 1 }, quick: { name: 'Quick', rate: 1.3 } };
  var NAVY = '#14213d', NAVY2 = '#1d2d52', ORANGE = '#e8572a', CREAM = '#f4f1ea', MUTED = '#a9b6cf', BLUE = '#5aa9e6', LINE = 'rgba(244,241,234,0.14)';
  // The picture follows the site's theme: Jade and mist on a page with data-theme="jade", and the navy and orange otherwise.
  var CURRENT = { navy: '#14213d', navy2: '#1d2d52', orange: '#e8572a', cream: '#f4f1ea', muted: '#a9b6cf', blue: '#5aa9e6' };
  // Jade keeps the navy background and the cream, but the accents are warm orange and sky blue, not more green.
  var JADE = { navy: '#0d3b33', navy2: '#145a4d', orange: '#f58a68', cream: '#f1f6f3', muted: '#b5c9c1', blue: '#7fb8f0' };
  var RGB_CURRENT = { navy: '20,33,61', cream: '244,241,234', orange: '232,87,42', blue: '90,169,230' };
  var RGB_JADE = { navy: '13,59,51', cream: '241,246,243', orange: '245,138,104', blue: '127,184,240' };
  var RGB = RGB_CURRENT;
  function rgba(name, a) { return 'rgba(' + RGB[name] + ',' + a + ')'; }
  function setPalette() {
    var jade = document.documentElement.getAttribute('data-theme') === 'jade';
    var p = jade ? JADE : CURRENT;
    RGB = jade ? RGB_JADE : RGB_CURRENT;
    NAVY = p.navy; NAVY2 = p.navy2; ORANGE = p.orange; CREAM = p.cream; MUTED = p.muted; BLUE = p.blue;
    LINE = rgba('cream', 0.14);
  }
  var FONT = '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif';
  var HEAD = '"Archivo", "Arial Black", Arial, sans-serif';

  // Made-up circuits (unit space, y down). They are not real tracks.
  var MAPS = {
    club: { name: 'Club circuit', phase: 0.4, pts: [[-0.7, -0.1], [-0.55, -0.45], [-0.1, -0.5], [0.25, -0.35], [0.15, -0.05], [0.45, 0.1], [0.75, 0.4], [0.35, 0.5], [-0.1, 0.35], [-0.45, 0.45], [-0.8, 0.15]] },
    sweeper: { name: 'Fast sweeper', phase: 1.2, pts: [[-0.85, 0], [-0.7, -0.35], [-0.2, -0.5], [0.35, -0.42], [0.8, -0.2], [0.85, 0.2], [0.45, 0.42], [0, 0.25], [-0.4, 0.42], [-0.82, 0.28]] },
    hairpin: { name: 'Hairpin', phase: 2.1, pts: [[-0.8, -0.2], [-0.3, -0.45], [0.2, -0.3], [0.55, -0.4], [0.85, -0.1], [0.6, 0.12], [0.7, 0.45], [0.1, 0.5], [-0.2, 0.2], [-0.55, 0.42], [-0.85, 0.25]] }
  };
  var SCENES = [
    { id: 'upload', t0: 0, t1: 3 },
    { id: 'map', t0: 3, t1: 6.4 },
    { id: 'delta', t0: 6.4, t1: 9.6 },
    { id: 'compare', t0: 9.6, t1: 12.8 },
    { id: 'car', t0: 12.8, t1: 15.2 },
    { id: 'end', t0: 15.2, t1: 17 }
  ];
  var TEXT = {
    upload: { title: 'Upload the file from your lap timer', caption: 'The file your timer already saves. Nothing to set up first.' },
    map: { title: 'Every lap, mapped', caption: 'Each lap is drawn on the track, from your own lap timer.' },
    delta: { title: 'Where you gained and lost time', caption: 'Seconds ahead or behind your best lap, corner by corner.' },
    compare: { title: 'Compare any two laps', caption: 'Play two laps together and see where the time went.' },
    car: { title: 'Your car, not just the track', caption: 'Track Mode telemetry shows what the car was doing, lap by lap.' },
    end: { title: 'Laps by MT3UK', caption: 'Every lap, mapped and measured.' }
  };
  // The sounds the admin can choose. Each is made here in the browser (no audio file). Silent offers no Sound button.
  var SOUNDS = { pad: 'Soft pad', pulse: 'Pulse', engine: 'Engine hum', chime: 'Chime', stopwatch: 'Stopwatch', whoosh: 'Whoosh', silent: 'Silent (no Sound button)' };
  var DEFAULTS = { map: 'club', units: 'mph', sound: true, soundStyle: 'pad', pace: 'slow', volume: 60, loop: true, previewLabel: true, texts: {} };
  // Where the end card's picture goes when pressed on the Laps front page.
  function signInTarget() {
    return typeof window.mt3ukSignInUrl === 'function' ? window.mt3ukSignInUrl('track.html') : 'laps-signin.html?next=track.html';
  }

  function clamp(x, a, b) { return Math.max(a === undefined ? 0 : a, Math.min(b === undefined ? 1 : b, x)); }
  function ease(x) { x = clamp(x); return x * x * (3 - 2 * x); }

  // Settings as the page uses them: defaults, then the saved choices, then the words (blank keeps the built-in ones).
  function merge(s) {
    s = s || {};
    var audio = s.audio && s.audio.url ? { url: String(s.audio.url), name: String(s.audio.name || '') } : null;
    var out = { map: MAPS[s.map] ? s.map : DEFAULTS.map, units: s.units === 'kph' ? 'kph' : 'mph',
      soundDelay: typeof s.soundDelay === 'number' ? clamp(s.soundDelay, 0, 10) : 0,
      loop: s.loop !== false, audioLoop: typeof s.audioLoop === 'boolean' ? s.audioLoop : undefined, previewLabel: s.previewLabel !== false, pace: PACES[s.pace] ? s.pace : 'slow', audio: audio, soundStyle: s.soundStyle === 'custom' ? (audio ? 'custom' : 'pad') : (SOUNDS[s.soundStyle] ? s.soundStyle : 'pad'), sound: s.sound !== false && s.soundStyle !== 'silent',
      volume: typeof s.volume === 'number' ? clamp(s.volume, 0, 100) : DEFAULTS.volume, texts: {} };
    SCENES.forEach(function (sc) {
      var mine = (s.texts && s.texts[sc.id]) || {};
      out.texts[sc.id] = {
        title: String(mine.title || '').trim() || TEXT[sc.id].title,
        caption: String(mine.caption || '').trim() || TEXT[sc.id].caption
      };
    });
    return out;
  }

  // Catmull-Rom closed spline through the control points, resampled evenly by length, then placed on the screen.
  var pathCache = {};
  function pathFor(mapId) {
    if (pathCache[mapId]) return pathCache[mapId];
    var pts = MAPS[mapId].pts, n = pts.length, raw = [], STEPS = 40;
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (var k = 0; k < STEPS; k++) {
        var t = k / STEPS, t2 = t * t, t3 = t2 * t, xy = [0, 0];
        for (var c = 0; c < 2; c++) {
          xy[c] = 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
        }
        raw.push(xy);
      }
    }
    var cum = [0];
    for (i = 1; i <= raw.length; i++) {
      var a = raw[i - 1], b = raw[i % raw.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    var total = cum[cum.length - 1], out = [], j = 0;
    for (var m = 0; m < PATH_N; m++) {
      var d = total * m / PATH_N;
      while (cum[j + 1] < d) j++;
      var seg = cum[j + 1] - cum[j], f = seg ? (d - cum[j]) / seg : 0;
      var ra = raw[j], rb = raw[(j + 1) % raw.length];
      out.push({ x: 480 + (ra[0] + (rb[0] - ra[0]) * f) * 330, y: 292 + (ra[1] + (rb[1] - ra[1]) * f) * 250 });
    }
    return (pathCache[mapId] = out);
  }
  function at(path, s) { var n = path.length; return path[(Math.floor((((s % 1) + 1) % 1) * n)) % n]; }

  function speedKph(s, phase) { return 118 + 40 * Math.sin(s * Math.PI * 2 * 3 + phase); }
  function fmtSpeed(kph, units) {
    return units === 'kph' ? Math.round(kph) + ' km/h' : Math.round(kph * 0.621371) + ' mph';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(ctx, str, x, y, size, color, font, weight, align, alpha) {
    ctx.save(); ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.font = (weight || 400) + ' ' + size + 'px ' + (font || FONT); ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y); ctx.restore();
  }
  function pill(ctx, str, x, y, a) {
    ctx.save(); ctx.globalAlpha = a;
    ctx.font = '600 18px ' + FONT;
    var w = ctx.measureText(str).width + 28;
    roundRect(ctx, x, y, w, 34, 17); ctx.fillStyle = ORANGE; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(str, x + 14, y + 23);
    ctx.restore();
  }
  function drawTrack(ctx, path, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.strokeStyle = rgba('cream', 0.22); ctx.lineWidth = 26; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    path.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.closePath(); ctx.stroke(); ctx.restore();
  }
  function drawTrace(ctx, path, s0, s1, color, width) {
    var n = path.length, from = Math.floor(s0 * n), to = Math.floor(s1 * n);
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = from; i <= to; i++) {
      var p = path[((i % n) + n) % n], w = 3 * Math.sin(i * 0.9);
      (i === from) ? ctx.moveTo(p.x + w, p.y - w) : ctx.lineTo(p.x + w, p.y - w);
    }
    ctx.stroke(); ctx.restore();
  }
  function dot(ctx, path, s, color, r) {
    var p = at(path, s);
    ctx.beginPath(); ctx.fillStyle = color; ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = NAVY; ctx.stroke();
    return p;
  }
  function caption(ctx, sc, a) {
    text(ctx, sc.title, 48, 86, 40, CREAM, HEAD, 700, 'left', a);
    text(ctx, sc.caption, 48, 126, 22, MUTED, FONT, 400, 'left', a);
  }

  // Each scene draws itself from the time into the scene (local), its fade (a) and the settings (S).
  var SCENE_DRAW = {
    upload: function (ctx, local, a, S) {
      var sc = S.texts.upload; caption(ctx, sc, a);
      var y = 200 + (1 - ease(clamp(local / 0.9))) * -40;
      ctx.save(); ctx.globalAlpha = a * ease(clamp(local / 0.9));
      roundRect(ctx, 300, y, 360, 200, 18); ctx.fillStyle = NAVY2; ctx.fill();
      ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, 'Your session', 480, y + 56, 24, CREAM, FONT, 600, 'center');
      text(ctx, 'RaceBox import', 480, y + 88, 18, MUTED, FONT, 400, 'center');
      var p = ease(clamp((local - 0.9) / 2.0));
      roundRect(ctx, 330, y + 130, 300, 12, 6); ctx.fillStyle = rgba('cream', 0.12); ctx.fill();
      roundRect(ctx, 330, y + 130, Math.max(12, 300 * p), 12, 6); ctx.fillStyle = ORANGE; ctx.fill();
      text(ctx, p >= 1 ? 'Done: 9 laps, 412 readings' : 'Reading the file…', 480, y + 172, 18, p >= 1 ? CREAM : MUTED, FONT, 500, 'center');
      ctx.restore();
    },
    map: function (ctx, local, a, S) {
      caption(ctx, S.texts.map, a);
      var path = pathFor(S.map);
      ctx.save(); drawTrack(ctx, path, a);
      var reveal = clamp(local / 2.4), laps = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]];
      laps.forEach(function (l, i) {
        drawTrace(ctx, path, l[0], l[0] + (l[1] - l[0]) * reveal, i === 2 ? ORANGE : rgba('blue', 0.85), 6);
      });
      dot(ctx, path, reveal, CREAM, 10);
      ctx.restore();
      pill(ctx, 'Lap ' + (1 + Math.min(3, Math.floor(reveal * 4))), 48, 430, a);
    },
    delta: function (ctx, local, a, S) {
      caption(ctx, S.texts.delta, a);
      var x0 = 80, x1 = 880, y0 = 430, y1 = 250;
      ctx.save(); ctx.globalAlpha = a;
      ctx.strokeStyle = LINE; ctx.lineWidth = 2;
      [y0, (y0 + y1) / 2, y1].forEach(function (y) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); });
      text(ctx, '0.0 s', 40, y0 + 6, 16, MUTED, FONT, 400, 'left');
      text(ctx, '+0.6 s', 40, y1 + 6, 16, MUTED, FONT, 400, 'left');
      var pts = [0, 0.12, 0.26, 0.4, 0.55, 0.7, 0.85, 1], vals = [0, 0.18, 0.05, 0.42, 0.3, 0.55, 0.22, 0.31];
      var prog = clamp(local / 3.2), N = 120;
      ctx.beginPath(); ctx.strokeStyle = ORANGE; ctx.lineWidth = 5; ctx.lineJoin = 'round';
      for (var i = 0; i <= N * prog; i++) {
        var u = i / N, k = 0;
        while (k < pts.length - 2 && u > pts[k + 1]) k++;
        var f = (u - pts[k]) / (pts[k + 1] - pts[k]);
        var v = vals[k] + (vals[k + 1] - vals[k]) * clamp(f);
        var X = x0 + (x1 - x0) * u, Y = y0 - (y0 - y1) * (v / 0.6);
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
      ctx.stroke();
      [[0.12, 'T1', 0.18], [0.4, 'T4', 0.42], [0.7, 'T8', 0.55], [0.85, 'T10', -0.23]].forEach(function (m) {
        var on = clamp((prog - m[0]) * 8);
        if (on <= 0) return;
        var X2 = x0 + (x1 - x0) * m[0], val = m[2], Y2 = y0 - (y0 - y1) * (Math.abs(val) / 0.6);
        ctx.globalAlpha = a * on;
        ctx.beginPath(); ctx.fillStyle = CREAM; ctx.arc(X2, Y2, 8, 0, Math.PI * 2); ctx.fill();
        text(ctx, m[1], X2, y0 + 34, 18, CREAM, FONT, 600, 'center');
        text(ctx, (val > 0 ? '+' : '-') + Math.abs(val).toFixed(2) + ' s', X2, Y2 - 18, 20, val < 0 ? BLUE : ORANGE, HEAD, 700, 'center');
        ctx.globalAlpha = a;
      });
      ctx.restore();
    },
    compare: function (ctx, local, a, S) {
      caption(ctx, S.texts.compare, a);
      var path = pathFor(S.map), s = clamp(local / 4.5);
      ctx.save(); drawTrack(ctx, path, a);
      drawTrace(ctx, path, 0, 1, rgba('blue', 0.35), 4);
      dot(ctx, path, s, BLUE, 12);
      dot(ctx, path, s * 0.985, ORANGE, 12);
      ctx.restore();
      pill(ctx, 'Lap A  ' + fmtSpeed(speedKph(s, 0), S.units), 48, 430, a);
      text(ctx, 'Lap B  ' + fmtSpeed(speedKph(s * 0.985, 0.3), S.units), 330, 456, 18, ORANGE, FONT, 600, 'left', a);
    },
    car: function (ctx, local, a, S) {
      caption(ctx, S.texts.car, a);
      var bars = [['Power', 0.82], ['Brake pressure', 0.64], ['Battery temp', 0.48], ['Tyre pressure', 0.71]];
      bars.forEach(function (b, i) {
        var y = 210 + i * 70, p = ease(clamp((local - i * 0.25) / 1.4));
        ctx.save(); ctx.globalAlpha = a;
        text(ctx, b[0], 80, y + 4, 22, CREAM, FONT, 500, 'left');
        roundRect(ctx, 330, y - 14, 540, 22, 11); ctx.fillStyle = rgba('cream', 0.1); ctx.fill();
        roundRect(ctx, 330, y - 14, Math.max(22, 540 * b[1] * p), 22, 11); ctx.fillStyle = i === 0 ? ORANGE : BLUE; ctx.fill();
        ctx.restore();
      });
    },
    end: function (ctx, local, a, S) {
      ctx.save(); ctx.globalAlpha = a;
      text(ctx, S.texts.end.title, 480, 230, 56, CREAM, HEAD, 700, 'center');
      text(ctx, S.texts.end.caption, 480, 282, 26, MUTED, FONT, 400, 'center');
      ctx.restore();
      if (S.previewLabel) pill(ctx, 'Early preview', 480 - 70, 320, a);
      text(ctx, 'Sign in to start', 480, 410, 24, ORANGE, HEAD, 700, 'center', a);
    }
  };

  function drawFrame(ctx, t, S) {
    setPalette();
    ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);
    var g = ctx.createRadialGradient(480, 260, 40, 480, 260, 520);
    g.addColorStop(0, rgba('orange', 0.10)); g.addColorStop(1, rgba('navy', 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var k = sceneIndex(t);
    SCENES.forEach(function (sc, i) {
      if (t < sc.t0 - 0.001 || t > sc.t1 + 0.001) return;
      // The end card fades in and then stays, so the sign-in line is there when the animation stops.
      var a = sc.id === 'end' ? clamp((t - sc.t0) / FADE) : Math.min(clamp((t - sc.t0) / FADE), clamp((sc.t1 - t) / FADE));
      SCENE_DRAW[sc.id](ctx, t - sc.t0, a, S);
    });
    SCENES.forEach(function (sc, i) {
      ctx.beginPath(); ctx.fillStyle = i === k ? ORANGE : rgba('cream', 0.25);
      ctx.arc(48 + i * 18, 500, 5, 0, Math.PI * 2); ctx.fill();
    });
  }
  // The shift (data-shift) eases in at the start and out before the end card, so the end card sits in the middle.
  function shiftAt(t, s) {
    if (!s) return 0;
    var a = Math.min(1, Math.max(0, t) / 0.6);
    var b = Math.min(1, Math.max(0, (SCENES[SCENES.length - 1].t0 - t) / 0.6));
    return s * Math.min(a, b);
  }
  function sceneIndex(t) {
    for (var i = 0; i < SCENES.length; i++) if (t >= SCENES[i].t0 && t < SCENES[i].t1) return i;
    return SCENES.length - 1;
  }

  // Sounds: made here, so there is no audio file to manage. The pad and the engine hum run all the time; the others
  // play on a beat, a second or a scene change while the picture plays.
  var CHIME = [523.25, 659.25, 783.99, 880];
  var BEAT = 0.5;
  function noiseSource(a) {
    var src = a.ac.createBufferSource();
    src.buffer = a.noise; src.loop = true;
    return src;
  }
  function makeAudio(style) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ac = new AC(), master = ac.createGain();
    master.gain.value = 0; master.connect(ac.destination);
    var a = { ac: ac, master: master, style: style, beat: -1, sec: -1, eng: null, noise: null };
    a.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    var nd = a.noise.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    if (style === 'pad') {
      var lp = ac.createBiquadFilter(), lfo = ac.createOscillator(), lfoGain = ac.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.4; lp.connect(master);
      lfo.frequency.value = 0.18; lfoGain.gain.value = 0.05; lfo.connect(lfoGain); lfo.start();
      [110, 165, 220, 277].forEach(function (f, n) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = n % 2 ? 'sawtooth' : 'triangle'; o.frequency.value = f; o.detune.value = (n - 1.5) * 6;
        g.gain.value = 0.12; o.connect(g); g.connect(lp); lfoGain.connect(g.gain); o.start();
      });
    }
    if (style === 'engine') {
      a.eng = ac.createOscillator();
      var elp = ac.createBiquadFilter(), eg = ac.createGain();
      a.eng.type = 'sawtooth'; a.eng.frequency.value = 55;
      elp.type = 'lowpass'; elp.frequency.value = 380; elp.Q.value = 2;
      eg.gain.value = 0.16; a.eng.connect(elp); elp.connect(eg); eg.connect(master); a.eng.start();
    }
    if (style === 'whoosh') {
      var rl = ac.createBiquadFilter(), rg = ac.createGain(), rumble = noiseSource(a);
      rl.type = 'lowpass'; rl.frequency.value = 300; rg.gain.value = 0.05;
      rumble.connect(rl); rl.connect(rg); rg.connect(master); rumble.start();
    }
    return a;
  }
  function click(a, when, freq, len, vol) {
    var src = a.ac.createBufferSource(), bp = a.ac.createBiquadFilter(), g = a.ac.createGain();
    src.buffer = a.noise; bp.type = 'bandpass'; bp.frequency.value = freq;
    g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.001, when + len);
    src.connect(bp); bp.connect(g); g.connect(a.master); src.start(when, 0, len + 0.01);
  }
  function tone(a, when, freq, len, vol) {
    var o = a.ac.createOscillator(), g = a.ac.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vol, when + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, when + len);
    o.connect(g); g.connect(a.master); o.start(when); o.stop(when + len + 0.05);
  }
  function kick(a, when) {
    var o = a.ac.createOscillator(), g = a.ac.createGain();
    o.frequency.setValueAtTime(120, when); o.frequency.exponentialRampToValueAtTime(45, when + 0.2);
    g.gain.setValueAtTime(0.6, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
    o.connect(g); g.connect(a.master); o.start(when); o.stop(when + 0.35);
  }
  function rush(a, when) {
    var src = noiseSource(a), bp = a.ac.createBiquadFilter(), g = a.ac.createGain();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(300, when); bp.frequency.exponentialRampToValueAtTime(3000, when + 0.9);
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.25, when + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, when + 1.0);
    src.connect(bp); bp.connect(g); g.connect(a.master); src.start(when, 0, 1.1);
  }
  // Called each frame with the picture's time. sceneChanged is true on the frame a new scene starts.
  // The sound fades out over the second before the end card, so the closing words come in on silence.
  var FADE_BEFORE_END = 1;
  function soundFadeAt(t) {
    var end = SCENES[SCENES.length - 1].t0, from = end - FADE_BEFORE_END;
    if (t <= from) return 1;
    if (t >= end) return 0;
    return 1 - (t - from) / FADE_BEFORE_END;
  }
  function playSound(a, t, scene, sceneChanged, playing) {
    var now = a.ac.currentTime + 0.02;
    if (a.eng) a.eng.frequency.setTargetAtTime(48 + 26 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.6)), now, 0.08);
    if (!playing) return;
    if (sceneChanged) {
      if (a.style === 'pad' || a.style === 'engine') click(a, now, 2400, 0.04, 0.35);
      if (a.style === 'chime') tone(a, now, CHIME[scene % CHIME.length], 1.6, 0.14);
      if (a.style === 'whoosh') rush(a, now);
    }
    if (a.style === 'pulse') {
      var beat = Math.floor(t / BEAT);
      if (beat !== a.beat) { a.beat = beat; kick(a, now); }
    }
    if (a.style === 'stopwatch') {
      var sec = Math.floor(t);
      if (sec !== a.sec) { a.sec = sec; click(a, now, 1800, 0.03, 0.25); }
    }
  }

  var css = '.lxe{position:relative;background:var(--lxe-bg, ' + NAVY + ');overflow:hidden;line-height:0}' +
    '.lxe canvas{display:block;width:100%;height:auto}' +
    '.lxe-bar{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:10px 12px;background:var(--lxe-bg, ' + NAVY + ');line-height:1}' +
    '.lxe-btn{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:transparent;color:#fff;display:grid;place-items:center;cursor:pointer;padding:0}' +
    '.lxe-btn:hover,.lxe-btn:focus-visible{background:var(--lxe-bg2, ' + NAVY2 + ');border-color:#fff}' +
    '.lxe-btn svg,.lxe-sound svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.lxe-sound{height:44px;border-radius:22px;border:1px solid rgba(255,255,255,.45);background:transparent;color:#fff;padding:0 14px;display:inline-flex;align-items:center;gap:8px;font:600 14px ' + FONT + ';cursor:pointer}' +
    '.lxe-sound:hover,.lxe-sound:focus-visible{background:var(--lxe-bg2, ' + NAVY2 + ');border-color:#fff}';
  var styled = false;
  function addStyle() {
    if (styled || !document.head) return;
    styled = true;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }
  var ICON_PAUSE = '<path d="M8 5v14M16 5v14"/>', ICON_PLAY = '<path d="M8 5l11 7-11 7z"/>';
  var ICON_SOUND_ON = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>';
  var ICON_SOUND_OFF = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>';

  function mount(el, settings, opts) {
    opts = opts || {};
    addStyle();
    var S = merge(settings);
    el.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'lxe';
    wrap.setAttribute('data-map', S.map);
    wrap.setAttribute('data-units', S.units);
    wrap.setAttribute('data-sound', S.soundStyle);
    wrap.setAttribute('data-pace', S.pace);
    wrap.setAttribute('data-loop', S.loop ? 'loop' : 'once');
    var canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Animated introduction to Laps. The words for each scene are shown on the picture.');
    var bar = document.createElement('div');
    bar.className = 'lxe-bar';
    var playBtn = document.createElement('button');
    playBtn.type = 'button'; playBtn.className = 'lxe-btn';
    var soundBtn = document.createElement('button');
    soundBtn.type = 'button'; soundBtn.className = 'lxe-sound';
    bar.appendChild(playBtn);
    if (S.sound) bar.appendChild(soundBtn);
    wrap.appendChild(canvas); wrap.appendChild(bar); el.appendChild(wrap);
    var ctx = canvas.getContext('2d');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var autoplay = opts.autoplay !== false && !reduce;
    var st = { t: reduce ? 1.2 : 0, playing: autoplay, last: 0, audio: null, custom: null, gestured: false, soundOn: false, started: false, duck: 1, scene: -1, raf: 0, scale: 1, zoom: parseFloat(el.getAttribute('data-zoom')) > 0 ? parseFloat(el.getAttribute('data-zoom')) : 1, shift: parseFloat(el.getAttribute('data-shift')) || 0 };
    function started() { st.started = true; }

    function sizeCanvas() {
      var w = wrap.clientWidth || W, dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr * H / W);
      st.scale = canvas.width / W;
    }
    function paint() {
      // A zoom (data-zoom on the wrapper) enlarges the scene about its middle; the controls are not in the canvas.
      var z = st.zoom;
      ctx.setTransform(st.scale * z, 0, 0, st.scale * z, st.scale * (W * (1 - z) / 2 + shiftAt(st.t, st.shift)), st.scale * H * (1 - z) / 2);
      drawFrame(ctx, st.t, S);
    }
    function showControls() {
      playBtn.setAttribute('aria-label', st.playing ? 'Pause video' : 'Play video');
      playBtn.setAttribute('aria-pressed', st.playing ? 'false' : 'true');
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (st.playing ? ICON_PAUSE : ICON_PLAY) + '</svg>';
      if (S.sound) {
        soundBtn.setAttribute('aria-pressed', st.soundOn ? 'true' : 'false');
        soundBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (st.soundOn ? ICON_SOUND_ON : ICON_SOUND_OFF) + '</svg>' + (st.soundOn ? 'Sound on' : 'Sound off');
      }
    }
    // The sound engine for the chosen sound: an uploaded file plays through an audio element, the others are made here.
    function ensureSound() {
      if (S.soundStyle === 'custom' && S.audio) {
        if (!st.custom) { st.custom = new Audio(S.audio.url); st.custom.preload = 'auto'; }
      } else if (!st.audio) {
        st.audio = makeAudio(S.soundStyle);
      }
    }
    function fadeMaster() {
      if (!st.audio) return;
      var target = st.playing && st.soundOn ? (S.volume / 100) * 0.5 * st.duck : 0;
      st.audio.master.gain.setTargetAtTime(target, st.audio.ac.currentTime, 0.05);
    }
    // Starts, pauses and sets the level of whichever sound is in use. Nothing plays before the first press on the page.
    function syncSound() {
      fadeMaster();
      if (!st.custom) return;
      st.custom.volume = (S.volume / 100) * st.duck;
      st.custom.loop = S.audioLoop !== undefined ? S.audioLoop : S.loop;
      var want = st.playing && st.soundOn && st.gestured;
      if (want && st.custom.paused) { var p = st.custom.play(); if (p && p.catch) p.catch(function () {}); }
      else if (!want && !st.custom.paused) st.custom.pause();
    }
    function frame(now) {
      st.raf = requestAnimationFrame(frame);
      var dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 0;
      st.last = now;
      if (st.playing) {
        var nt = st.t + dt * PACES[S.pace].rate;
        if (!S.loop && nt >= TOTAL) { st.t = TOTAL - 0.001; st.playing = false; showControls(); syncSound(); }
        else st.t = nt % TOTAL;
      }
      var k = sceneIndex(st.t), changed = k !== st.scene && st.scene !== -1;
      st.scene = k;
      // Fade the sound out before the end card, and bring it back when the animation loops.
      var duck = soundFadeAt(st.t);
      if (duck !== st.duck) { st.duck = duck; if (st.custom) st.custom.volume = (S.volume / 100) * duck; fadeMaster(); }
      if (st.audio && st.soundOn) playSound(st.audio, st.t, k, changed, st.playing);
      paint();
    }

    playBtn.addEventListener('click', function () {
      started();
      if (!st.playing && st.t >= TOTAL - 0.01) st.t = 0;
      st.playing = !st.playing;
      if (st.playing) { st.gestured = true; if (S.sound) startSoundLater(); }
      else { clearTimeout(st.soundTimer); st.soundTimer = 0; }
      if (st.playing && st.audio && st.audio.ac.state === 'suspended') st.audio.ac.resume();
      syncSound(); showControls();
    });
    soundBtn.addEventListener('click', function () {
      st.gestured = true;
      ensureSound();
      if (st.audio && st.audio.ac.state === 'suspended') st.audio.ac.resume();
      st.soundOn = !st.soundOn;
      syncSound(); showControls();
    });
    // The sound starts after the delay the admin set (0 is at once). A pause cancels a start that is still waiting.
    function startSoundLater() {
      clearTimeout(st.soundTimer); st.soundTimer = 0;
      var d = S.soundDelay || 0;
      if (d <= 0) { st.soundOn = true; return; }
      st.soundOn = false;
      st.soundTimer = setTimeout(function () { st.soundTimer = 0; if (st.playing) { st.soundOn = true; syncSound(); showControls(); } }, d * 1000);
    }

    // On the Laps front page the whole picture is a link to sign in while the end card is showing (the 'Sign in to start' line says so).
    function onEnd() { return sceneIndex(st.t) === SCENES.length - 1; }
    if (opts.link) {
      canvas.addEventListener('mousemove', function () { canvas.style.cursor = onEnd() ? 'pointer' : ''; });
      canvas.addEventListener('click', function () { if (onEnd()) window.location.href = signInTarget(); });
    }
    sizeCanvas(); showControls(); paint();
    var resize = function () { sizeCanvas(); paint(); };
    if (window.ResizeObserver) { st.ro = new ResizeObserver(resize); st.ro.observe(wrap); }
    else window.addEventListener('resize', resize);
    st.raf = requestAnimationFrame(frame);

    return {
      set: function (next) {
        var before = S.soundStyle + '|' + (S.audio ? S.audio.url : '');
        S = merge(next);
        wrap.setAttribute('data-map', S.map); wrap.setAttribute('data-units', S.units); wrap.setAttribute('data-sound', S.soundStyle); wrap.setAttribute('data-pace', S.pace); wrap.setAttribute('data-loop', S.loop ? 'loop' : 'once');
        if (S.soundStyle + '|' + (S.audio ? S.audio.url : '') !== before) {
          if (st.audio) { st.audio.ac.close(); st.audio = null; }
          if (st.custom) { st.custom.pause(); st.custom = null; }
          if (st.soundOn && st.gestured) { ensureSound(); syncSound(); }
        }
        if (!S.sound && soundBtn.parentNode) soundBtn.parentNode.removeChild(soundBtn);
        if (S.sound && !soundBtn.parentNode) bar.appendChild(soundBtn);
        fadeMaster(); showControls(); paint();
      },
      seek: function (secs) {
        st.t = ((secs % TOTAL) + TOTAL) % TOTAL; st.playing = false; showControls(); paint();
      },
      destroy: function () {
        cancelAnimationFrame(st.raf);
        if (st.ro) st.ro.disconnect();
        if (st.audio) st.audio.ac.close();
        if (st.custom) st.custom.pause();
        el.innerHTML = '';
      }
    };
  }

  // The Laps front page: the settings the admin saved (or the built-in words) from the worker.
  function init() {
    var el = document.querySelector('[data-laps-explainer]');
    if (!el) return;
    fetch(API + '/laps/explainer', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { window.MT3UKExplainerHome = mount(el, d.settings || {}, { autoplay: false, link: true }); })
      .catch(function () { window.MT3UKExplainerHome = mount(el, {}, { autoplay: false, link: true }); });
  }
  window.MT3UKExplainer = { mount: mount, merge: merge, soundFadeAt: soundFadeAt, MAPS: MAPS, SCENES: SCENES.map(function (s) { return s.id; }), TEXT: TEXT, DEFAULTS: DEFAULTS, SOUNDS: SOUNDS, PACES: PACES };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
