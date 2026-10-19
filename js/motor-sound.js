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
  var DEFAULTS = { f0: 52, fPeak: 420, harm: [0.85, 0.65, 0.3, 0.1], sub: 0.7, whine: 0.1, cut: 1600, volume: 60, drive: 7, pulse: 0.6, pulseRatio: 0.5 };
  var LIMITS = { f0: [40, 400], fPeak: [60, 1200], harm: [0, 1], sub: [0, 1], whine: [0, 0.3], cut: [400, 4000], volume: [0, 100], drive: [0, 10], pulse: [0, 0.9], pulseRatio: [0.25, 1] };
  var CUT_IDLE = 900, CUT_TOP = 2000, MASTER = 0.5;
  // The recorded motor (audio/motor-session.mp3, a 12 second loop of the loud part of the recording), played at a pitch that
  // follows the speed. Until it has loaded, and if it cannot be loaded, the tones below are used.
  var SAMPLE_URL = new URL('../audio/motor-session.mp3', document.currentScript ? document.currentScript.src : location.href).href;
  var SAMPLE_SPEED = [0.7, 1.1];
  // The recording is quieter than the tones at the same setting, so it gets its own gain.
  var SAMPLE_GAIN = 2.5;

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
    this.src = null;
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
    sampleGain.gain.value = SAMPLE_GAIN;
    filter.connect(shaper).connect(pulse).connect(synthGain).connect(out);
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
    if (this.src || !this.buffer || !this.ctx) return;
    var src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.playbackRate.value = SAMPLE_SPEED[0];
    src.connect(this.sampleGain);
    src.start();
    this.src = src;
    this.synthGain.gain.value = 0;
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
    if (this.src) this.src.playbackRate.setTargetAtTime(SAMPLE_SPEED[0] + (SAMPLE_SPEED[1] - SAMPLE_SPEED[0]) * frac, now, tc);
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
