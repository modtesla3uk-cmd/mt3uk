/*
  The motor sound that follows the car on a session's playback (track-page.js, the Sound on switch). The main sound is a
  recorded motor (audio/motor-session.mp3), whose pitch rises with the car's speed and whose level goes up with it, so the
  sound speeds up and slows down with the chip. Until it has loaded, or if it cannot be loaded, a small set of tones built
  with Web Audio plays instead. Its settings are the Session playback sound section of the Sound panel on
  track-admin.html, read from the worker (GET /sound/session, KV session-sound). Until they arrive, or if they cannot be
  read, the built-in values below are used. Browsers only start audio after a tap, so start() is called from the Sound on
  switch or from Play.
*/
(function () {
  var API = window.MT3UK_TRACK_API || 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  // The built-in values, and the range each setting accepts (the worker, cleanSessionSound, uses the same ranges)
  // The defaults are a V8 with an electric whine on top: a low, rich note with grit (drive, a light distortion) and a firing
  // pulse (pulse, how far the volume wobbles, at pulseRatio times the note).
  var DEFAULTS = { f0: 52, fPeak: 420, harm: [0.85, 0.65, 0.3, 0.1], sub: 0.7, whine: 0.1, cut: 1600, volume: 60, drive: 7, pulse: 0.6, pulseRatio: 0.5, rateLow: 0.6, rateHigh: 1.3, recLevel: 2.5, recLow: 900, recTop: 2000, recHigh: 80, grainLen: 0.6, grainEvery: 0.04, compThreshold: -32, compRatio: 4 };
  var LIMITS = { f0: [40, 400], fPeak: [60, 1200], harm: [0, 1], sub: [0, 1], whine: [0, 0.3], cut: [400, 4000], volume: [0, 100], drive: [0, 10], pulse: [0, 0.9], pulseRatio: [0.25, 1], rateLow: [0.2, 1.5], rateHigh: [0.3, 2.5], recLevel: [0, 6], recLow: [200, 3000], recTop: [500, 6000], recHigh: [20, 400], grainLen: [0.1, 2], grainEvery: [0.01, 0.3], compThreshold: [-60, 0], compRatio: [1, 20] };
  var CUT_IDLE = 900, CUT_TOP = 2000, MASTER = 0.5;
  // The recording has a broad hump of energy between about 0.9 and 1.3 kHz (measured on motor-session.mp3), which a phone speaker
  // turns into a warbling whistle as the pitch rises with the speed. It is cut in the recording's path, wide, and follows the playback pitch.
  var WHISTLE_HZ = 1050, WHISTLE_CUT_DB = -10;
  // The recorded motor (audio/motor-session.mp3, a 12 second loop of the loud part of the recording), played at a pitch that
  // follows the speed. Until it has loaded, and if it cannot be loaded, the tones below are used.
  var SAMPLE_URL = new URL('../audio/motor-session.mp3', document.currentScript ? document.currentScript.src : location.href).href;
  // The recording is played as short overlapping grains taken from random places in it, so it does not repeat in a fixed
  // cycle. Its pitch, level, filters, grains and compression are the rateLow to compRatio settings. Grains are queued
  // GRAIN_AHEAD seconds ahead of the clock.
  var GRAIN_AHEAD = 0.15;
  // The fade of one grain. Scaled so the overlapping grains add up to a steady level: a grain's window averages 0.5, so the
  // scale is 2 over the number of grains sounding at once (grainLen over grainEvery).
  function grainCurve(len, every) {
    var n = 64, c = new Float32Array(n);
    for (var i = 0; i < n; i++) c[i] = (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))) * (2 * every / len);
    return c;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // The distortion curve: a tanh bend, scaled so the full-scale input stays at full scale.
  function driveCurve(k) {
    var n = 2048, c = new Float32Array(n), norm = k > 0 ? Math.tanh(k) : 1;
    for (var i = 0; i < n; i++) { var x = (i / (n - 1)) * 2 - 1; c[i] = k > 0 ? Math.tanh(k * x) / norm : x; }
    return c;
  }
  function merge(s) {
    s = s || {};
    var out = {};
    Object.keys(LIMITS).forEach(function (k) {
      if (k === 'harm') return;
      var n = Number(s[k]);
      out[k] = isFinite(n) && s[k] !== '' && s[k] !== null ? clamp(n, LIMITS[k][0], LIMITS[k][1]) : DEFAULTS[k];
    });
    out.harm = DEFAULTS.harm.map(function (d, i) {
      var n = Number(s.harm && s.harm[i]);
      return isFinite(n) && s.harm[i] !== '' && s.harm[i] !== null ? clamp(n, LIMITS.harm[0], LIMITS.harm[1]) : d;
    });
    return out;
  }

  // With settings given (a preview on the admin page) the engine uses them and does not read the worker.
  function Engine(settings) {
    this.ctx = null;
    this.on = false;
    this.oscs = [];
    this.master = null;
    this.filter = null;
    this.lfo = null;
    this.s = merge(settings);
    this.timer = 0;
    this.grain = null;
    this.nextGrain = 0;
    this.rate = this.s.rateLow;
    this.buffer = null;
    this.bytes = fetch(SAMPLE_URL).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; });
    if (settings) { this.ready = Promise.resolve(this.s); return; }
    // Loaded once per page. Resolves whether or not the worker answered, so a start never waits on it.
    var self = this;
    this.ready = fetch(API + '/sound/session', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { self.s = merge(d && d.settings); return self.s; })
      .catch(function () { return self.s; });
  }
  Engine.prototype.build = function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    var ctx = this.ctx = new AC();
    var out = ctx.createGain(), filter = ctx.createBiquadFilter(), pulse = ctx.createGain();
    out.gain.value = 0;
    filter.type = 'lowpass';
    filter.frequency.value = this.s.cut;
    filter.Q.value = 0.7;
    // Grit: the distortion bends the peaks, so the tones pick up rasp. Then the firing pulse: the volume wobbles at a fraction
    // of the note, as an engine's firings do.
    var shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(this.s.drive);
    shaper.oversample = '4x';
    var depth = clamp(this.s.pulse, 0, 0.9), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    pulse.gain.value = 1 - depth / 2;
    lfo.type = 'sine';
    lfo.frequency.value = this.s.f0 * this.s.pulseRatio;
    lfoGain.gain.value = depth / 2;
    lfo.connect(lfoGain).connect(pulse.gain);
    lfo.start();
    // The tones and the recording each have their own gain, so the recording can take over from the tones once it has loaded.
    var synthGain = ctx.createGain(), sampleGain = ctx.createGain();
    synthGain.gain.value = 1;
    sampleGain.gain.value = this.s.recLevel;
    filter.connect(shaper).connect(pulse).connect(synthGain).connect(out);
    var sampleHigh = ctx.createBiquadFilter(), sampleLow = ctx.createBiquadFilter();
    sampleHigh.type = 'highpass';
    sampleHigh.frequency.value = this.s.recHigh;
    sampleLow.type = 'lowpass';
    sampleLow.frequency.value = this.s.recLow;
    sampleLow.Q.value = 0.7;
    // A gentle compressor evens out the bursts in the recording, so the sound is steadier from moment to moment.
    var sampleComp = ctx.createDynamicsCompressor();
    sampleComp.threshold.value = this.s.compThreshold;
    sampleComp.knee.value = 12;
    sampleComp.ratio.value = this.s.compRatio;
    sampleComp.attack.value = 0.02;
    sampleComp.release.value = 0.25;
    var sampleNotch = ctx.createBiquadFilter();
    sampleNotch.type = 'peaking';
    sampleNotch.frequency.value = WHISTLE_HZ;
    sampleNotch.Q.value = 0.8;
    sampleNotch.gain.value = WHISTLE_CUT_DB;
    sampleHigh.connect(sampleNotch).connect(sampleLow).connect(sampleComp).connect(sampleGain);
    this.sampleNotch = sampleNotch;
    this.sampleInput = sampleHigh;
    this.grainCurve = grainCurve(this.s.grainLen, this.s.grainEvery);
    this.sampleLow = sampleLow;
    sampleGain.connect(out);
    out.connect(ctx.destination);
    this.synthGain = synthGain;
    this.sampleGain = sampleGain;
    this.master = out;
    this.filter = filter;
    this.lfo = lfo;
    var self = this, scale = MASTER;
    // Body: each harmonic is a sine at a multiple of the note, at its own level
    this.s.harm.forEach(function (level, i) { self.oscs.push(self.tone(i + 1, level * scale)); });
    self.oscs.push(self.tone(0.5, this.s.sub * scale));
    self.oscs.push(self.tone(1.5, this.s.whine * scale));
    this.loadSample();
    return true;
  };
  // Decodes the recording once the context exists (it is made on a tap), then plays it in place of the tones.
  Engine.prototype.loadSample = function () {
    var self = this;
    if (!this.bytes) return;
    var bytes = this.bytes;
    this.bytes = null;
    bytes.then(function (data) {
      if (!data || !self.ctx) return null;
      return self.ctx.decodeAudioData(data);
    }).then(function (buf) {
      if (!buf) return;
      self.buffer = buf;
      self.attachSample();
    }).catch(function () {});
  };
  Engine.prototype.attachSample = function () {
    if (this.grain || !this.buffer || !this.ctx) return;
    this.nextGrain = this.ctx.currentTime;
    this.synthGain.gain.value = 0;
    this.scheduleGrains();
    this.grain = setInterval(this.scheduleGrains.bind(this), this.s.grainEvery * 1000);
  };
  // Queues the grains that start before the next scheduling pass. Each takes its pitch from the current rate, so the
  // sound follows the speed as the playback moves.
  Engine.prototype.scheduleGrains = function () {
    var ctx = this.ctx, buf = this.buffer;
    if (!ctx || ctx.state === 'closed') { if (this.grain) clearInterval(this.grain); this.grain = null; return; }
    if (!buf) return;
    var limit = ctx.currentTime + GRAIN_AHEAD;
    if (this.nextGrain < ctx.currentTime) this.nextGrain = ctx.currentTime;
    while (this.nextGrain < limit) {
      var at = this.nextGrain, rate = this.rate, span = this.s.grainLen * rate;
      var src = ctx.createBufferSource(), env = ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(env).connect(this.sampleInput);
      env.gain.setValueCurveAtTime(this.grainCurve, at, this.s.grainLen);
      src.start(at, Math.random() * Math.max(0, buf.duration - span), span);
      this.nextGrain += this.s.grainEvery;
    }
  };
  Engine.prototype.tone = function (ratio, level) {
    var ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = this.s.f0 * ratio;
    g.gain.value = level;
    osc.connect(g).connect(this.filter);
    osc.start();
    return { osc: osc, ratio: ratio };
  };
  Engine.prototype.start = function () {
    if (!this.ctx) { if (!this.build()) return false; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.on = true;
    return true;
  };
  // speed in km/h, top the fastest speed of the lap being played (the note reaches its top pitch there)
  Engine.prototype.setSpeed = function (speed, top) {
    if (!this.ctx || !this.on) return;
    var s = this.s, frac = top > 0 ? clamp(speed / top, 0, 1) : 0, now = this.ctx.currentTime, tc = 0.05;
    var f = s.f0 + (s.fPeak - s.f0) * frac;
    this.oscs.forEach(function (o) { o.osc.frequency.setTargetAtTime(f * o.ratio, now, tc); });
    this.filter.frequency.setTargetAtTime(CUT_IDLE + (CUT_TOP - CUT_IDLE) * frac, now, tc);
    if (this.lfo) this.lfo.frequency.setTargetAtTime(f * s.pulseRatio, now, tc);
    this.rate = s.rateLow + (s.rateHigh - s.rateLow) * frac;
    if (this.sampleNotch) this.sampleNotch.frequency.setTargetAtTime(WHISTLE_HZ * this.rate, now, tc);
    // The recording's level follows the speed closely (squared), so it swells as the car gets quicker and falls away as it slows.
    if (this.sampleGain) this.sampleGain.gain.setTargetAtTime(s.recLevel * (0.1 + 0.9 * frac * frac), now, tc);
    if (this.sampleLow) this.sampleLow.frequency.setTargetAtTime(s.recLow + (s.recTop - s.recLow) * frac, now, tc);
    // Quiet at a standstill, fuller as the car gets quicker
    this.master.gain.setTargetAtTime((0.04 + 0.2 * frac) * (s.volume / DEFAULTS.volume), now, tc);
  };
  // Fade out and stop: used on pause, at the end of the lap, when scrubbing and when the switch goes off.
  Engine.prototype.quiet = function () {
    if (!this.ctx || !this.on) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  };

  // A short demonstration with the given settings (the admin's sliders): the speed rises from a standstill to the top and
  // back over the seconds given, then the sound fades and its audio is closed. Stop ends it early.
  Engine.prototype.preview = function (settings, seconds) {
    this.stopPreview();
    var e = new Engine(settings), len = seconds || 4, began = Date.now();
    this.current = e;
    if (!e.start()) { this.current = null; return false; }
    e.setSpeed(0, 100);
    this.timer = setInterval(function () {
      var t = (Date.now() - began) / 1000, frac = 1 - Math.abs(2 * Math.min(1, t / len) - 1);
      e.setSpeed(frac * 100, 100);
      if (t >= len) {
        clearInterval(this.timer); this.timer = 0;
        e.quiet();
        setTimeout(function () { if (e.ctx) e.ctx.close(); }, 500);
        this.current = null;
      }
    }.bind(this), 50);
    return true;
  };
  Engine.prototype.stopPreview = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    if (this.current) {
      var e = this.current;
      this.current = null;
      e.quiet();
      setTimeout(function () { if (e.ctx) e.ctx.close(); }, 500);
    }
  };

  window.MT3UKMotorSound = new Engine();
})();
