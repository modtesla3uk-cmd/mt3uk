/*
  The motor sound that follows the car on a session's playback (track-page.js, the Sound on switch). Built with Web Audio and no
  recording: a bass note (a stack of harmonics, driven, rising with the speed), a growl a fifth above it (a driven stack that
  wobbles at the firing rate) and a rasp of band-passed noise that comes in at the top of the speed. Its settings are the
  Session playback sound section of the Sound panel on track-admin.html, read from the worker (GET /sound/session, KV
  session-sound). Until they arrive, or if they cannot be read, the built-in values below are used. Browsers only start audio
  after a tap, so start() is called from the Sound on switch or from Play.
*/
(function () {
  var API = window.MT3UK_TRACK_API || 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  // The built-in values, and the range each setting accepts (the worker, cleanSessionSound, uses the same ranges).
  // pitch scales every frequency (0.5 is an octave down). bassDrive and growlDrive are how hard each stack is driven
  // (distortion). growl is the growl's level, rasp the noise on top, wobble how far the growl pulses at the firing rate.
  var DEFAULTS = { pitch: 1, bassDrive: 6, growl: 1.4, growlDrive: 9, rasp: 0.12, wobble: 0.6, volume: 90 };
  var LIMITS = { pitch: [0.25, 1.5], bassDrive: [0, 10], growl: [0, 2.5], growlDrive: [0, 12], rasp: [0, 0.3], wobble: [0, 1], volume: [0, 100] };
  // Before pitch: the bass note rises from BASS_LOW to BASS_TOP Hz over the speed, and each filter opens from its low to its top
  var BASS_LOW = 52, BASS_TOP = 222, BASS_CUT_LOW = 260, BASS_CUT_TOP = 1360;
  var GROWL_CUT_LOW = 350, GROWL_CUT_TOP = 1250, RASP_LOW = 900, RASP_TOP = 2000;
  var BASS_HARM = 22, GROWL_HARM = 18, BASS_ROLL = 1.3, GROWL_ROLL = 1.1;
  // The growl sits a fifth above the bass. The wobble runs at the firing rate.
  var GROWL_RATIO = 1.5, WOBBLE_HZ = 18;
  // The output at full volume (volume over 100, times this), before the limiter on the way out
  var MASTER = 0.8;

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
      var n = Number(s[k]);
      out[k] = isFinite(n) && s[k] !== '' && s[k] !== null ? clamp(n, LIMITS[k][0], LIMITS[k][1]) : DEFAULTS[k];
    });
    return out;
  }
  // The member's own level on this device (0 to 100, all of it by default), kept in the browser.
  function savedLevel() { try { var v = parseFloat(localStorage.getItem('mt3ukTrackSoundLevel')); return isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 1; } catch (e) { return 1; } }

  // With settings given (a preview on the admin page) the engine uses them and does not read the worker.
  function Engine(settings) {
    this.ctx = null;
    this.on = false;
    this.oscs = [];
    this.master = null;
    this.s = merge(settings);
    this.level = 1;
    this.loaded = !!settings;
    if (settings) { this.ready = Promise.resolve(this.s); return; }
    // Loaded once per page. Resolves whether or not the worker answered, so a start never waits on it for long (see start).
    var self = this;
    this.ready = fetch(API + '/sound/session', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { self.s = merge(d && d.settings); self.loaded = true; return self.s; })
      .catch(function () { self.loaded = true; return self.s; });
  }
  Engine.prototype.build = function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // The context may already exist: start() makes it on the tap, before the saved settings have arrived.
    var ctx = this.ctx = this.ctx || new AC(), s = this.s, p = s.pitch, i;
    var out = ctx.createGain(), limiter = ctx.createDynamicsCompressor(), mix = ctx.createGain();
    out.gain.value = 0;
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.1;
    mix.connect(out).connect(limiter).connect(ctx.destination);

    // Bass: the harmonics are summed, driven, then filtered. Its level follows the speed in setSpeed.
    var bassBus = ctx.createGain(), bassShaper = ctx.createWaveShaper(), bassCut = ctx.createBiquadFilter(), bassGain = ctx.createGain();
    bassShaper.curve = driveCurve(s.bassDrive);
    bassShaper.oversample = '4x';
    bassCut.type = 'lowpass';
    bassCut.Q.value = 0.7;
    bassCut.frequency.value = BASS_CUT_LOW * p;
    bassGain.gain.value = 0.4;
    bassBus.connect(bassShaper).connect(bassCut).connect(bassGain).connect(mix);

    // Growl: a fifth above the bass, driven harder, with a wobble at the firing rate
    var growlBus = ctx.createGain(), growlShaper = ctx.createWaveShaper(), growlCut = ctx.createBiquadFilter();
    var growlWobble = ctx.createGain(), growlLfo = ctx.createOscillator(), growlLfoGain = ctx.createGain(), growlGain = ctx.createGain();
    growlShaper.curve = driveCurve(s.growlDrive);
    growlShaper.oversample = '4x';
    growlCut.type = 'lowpass';
    growlCut.Q.value = 0.7;
    growlCut.frequency.value = GROWL_CUT_LOW * p;
    var depth = clamp(s.wobble, 0, 1);
    growlWobble.gain.value = 1 - depth / 2;
    growlLfo.type = 'sine';
    growlLfo.frequency.value = WOBBLE_HZ * p;
    growlLfoGain.gain.value = depth / 2;
    growlLfo.connect(growlLfoGain).connect(growlWobble.gain);
    growlLfo.start();
    growlGain.gain.value = 0;
    growlBus.connect(growlShaper).connect(growlCut).connect(growlWobble).connect(growlGain).connect(mix);

    // Rasp: white noise, band-passed, that comes in at the top of the speed
    var noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = noiseBuf.getChannelData(0);
    for (i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    var noise = ctx.createBufferSource(), rasp = ctx.createBiquadFilter(), raspGain = ctx.createGain();
    noise.buffer = noiseBuf;
    noise.loop = true;
    rasp.type = 'bandpass';
    rasp.Q.value = 1.4;
    rasp.frequency.value = RASP_LOW * p;
    raspGain.gain.value = 0;
    noise.connect(rasp).connect(raspGain).connect(mix);
    noise.start();

    // Each harmonic is a sine at a multiple of the note, at the level a saw of that harmonic would have
    var oscs = [];
    function partial(bus, ratio, level) {
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = p * BASS_LOW * ratio;
      g.gain.value = level;
      osc.connect(g).connect(bus);
      osc.start();
      oscs.push({ osc: osc, ratio: ratio });
    }
    for (i = 1; i <= BASS_HARM; i++) partial(bassBus, i, 1 / Math.pow(i, BASS_ROLL));
    for (i = 1; i <= GROWL_HARM; i++) partial(growlBus, GROWL_RATIO * i, 1 / Math.pow(i, GROWL_ROLL));

    this.oscs = oscs;
    this.filter = bassCut;
    this.growlCut = growlCut;
    this.rasp = rasp;
    this.bassGain = bassGain;
    this.growlGain = growlGain;
    this.raspGain = raspGain;
    this.master = out;
    return true;
  };
  // The graph is built with the saved settings, so a start made before they have arrived waits for them (at most LOAD_WAIT_MS,
  // then the built-in values are used). The context is made and resumed at once, while the tap still allows it.
  var LOAD_WAIT_MS = 4000;
  Engine.prototype.start = function () {
    if (!this.master && !this.loaded) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.on = true;
      var self = this;
      Promise.race([this.ready, new Promise(function (done) { setTimeout(done, LOAD_WAIT_MS); })]).then(function () {
        if (self.on && !self.master) self.begin();
      });
      return true;
    }
    return this.begin();
  };
  Engine.prototype.begin = function () {
    if (!this.master && !this.build()) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.on = true;
    return true;
  };
  // speed in km/h, top the fastest speed of the lap being played (the note reaches its top pitch there)
  Engine.prototype.setSpeed = function (speed, top) {
    if (!this.master || !this.on) return;
    var s = this.s, p = s.pitch, frac = top > 0 ? clamp(speed / top, 0, 1) : 0, now = this.ctx.currentTime, tc = 0.05;
    // The whole sound lifts from a standstill: quiet and low at rest, fuller and higher at the top of the speed
    var lift = 0.4 + 0.6 * frac, fb = p * (BASS_LOW + (BASS_TOP - BASS_LOW) * frac);
    this.oscs.forEach(function (o) { o.osc.frequency.setTargetAtTime(fb * o.ratio, now, tc); });
    this.filter.frequency.setTargetAtTime(p * (BASS_CUT_LOW + (BASS_CUT_TOP - BASS_CUT_LOW) * frac), now, tc);
    this.growlCut.frequency.setTargetAtTime(p * (GROWL_CUT_LOW + (GROWL_CUT_TOP - GROWL_CUT_LOW) * frac), now, tc);
    this.rasp.frequency.setTargetAtTime(p * (RASP_LOW + (RASP_TOP - RASP_LOW) * frac), now, tc);
    this.bassGain.gain.setTargetAtTime(lift, now, tc);
    this.growlGain.gain.setTargetAtTime(s.growl * (0.12 + 0.22 * frac * frac) * lift, now, tc);
    this.raspGain.gain.setTargetAtTime(s.rasp * frac * lift, now, tc);
    this.master.gain.setTargetAtTime((s.volume / 100) * MASTER * this.level, now, tc);
  };
  // The member's own level on this device (0 to 1), scaling the session's level. The slider on the track page sets it.
  Engine.prototype.setLevel = function (v) { this.level = Math.max(0, Math.min(1, v)); };
  // Fade out and stop: used on pause, at the end of the lap, when scrubbing and when the switch goes off.
  Engine.prototype.quiet = function () {
    if (!this.on) return;
    this.on = false;
    if (this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
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
  window.MT3UKMotorSound.setLevel(savedLevel());
})();
