/*
  The motor sound that follows the car on a session's playback (track-page.js, the Sound on switch). The engine is a small
  set of tones built with Web Audio: the note rises with the car's speed and the level goes up with it, so the sound
  speeds up and slows down with the chip. Its settings are the Session playback sound section of the Sound panel on
  track-admin.html, read from the worker (GET /sound/session, KV session-sound). Until they arrive, or if they cannot be
  read, the built-in values below are used. Browsers only start audio after a tap, so start() is called from the Sound on
  switch or from Play.
*/
(function () {
  var API = window.MT3UK_TRACK_API || 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  // The built-in values, and the range each setting accepts (the worker, cleanSessionSound, uses the same ranges)
  var DEFAULTS = { f0: 95, fPeak: 430, harm: [0.62, 0.36, 0.18, 0.07], sub: 0.35, whine: 0.06, cut: 1600, volume: 60 };
  var LIMITS = { f0: [40, 400], fPeak: [60, 1200], harm: [0, 1], sub: [0, 1], whine: [0, 0.3], cut: [400, 4000], volume: [0, 100] };
  var CUT_IDLE = 900, CUT_TOP = 2000, MASTER = 0.5;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
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

  function Engine() {
    this.ctx = null;
    this.on = false;
    this.oscs = [];
    this.master = null;
    this.filter = null;
    this.s = merge({});
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
    var out = ctx.createGain(), filter = ctx.createBiquadFilter();
    out.gain.value = 0;
    filter.type = 'lowpass';
    filter.frequency.value = this.s.cut;
    filter.Q.value = 0.7;
    filter.connect(out).connect(ctx.destination);
    this.master = out;
    this.filter = filter;
    var self = this, scale = MASTER;
    // Body: each harmonic is a sine at a multiple of the note, at its own level
    this.s.harm.forEach(function (level, i) { self.oscs.push(self.tone(i + 1, level * scale)); });
    self.oscs.push(self.tone(0.5, this.s.sub * scale));
    self.oscs.push(self.tone(1.5, this.s.whine * scale));
    return true;
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
    // Quiet at a standstill, fuller as the car gets quicker
    this.master.gain.setTargetAtTime((0.04 + 0.2 * frac) * (s.volume / DEFAULTS.volume), now, tc);
  };
  // Fade out and stop: used on pause, at the end of the lap, when scrubbing and when the switch goes off.
  Engine.prototype.quiet = function () {
    if (!this.ctx || !this.on) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  };

  window.MT3UKMotorSound = new Engine();
})();
