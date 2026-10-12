/*
  The motor sound that follows the car on a session's playback (track-page.js, the Sound on switch). The engine is a small
  set of tones built with Web Audio: the note rises with the car's speed and the level goes up with it, so the sound
  speeds up and slows down with the chip. The same ranges as js/ev-sound.js, which renders the saved sound. Nothing is
  stored here. Browsers only start audio after a tap, so start() is called from the Sound on switch or from Play.
*/
(function () {
  var F_IDLE = 95, F_TOP = 430, CUT_IDLE = 900, CUT_TOP = 2000;
  // Harmonics of the note and their levels, as in js/ev-sound.js (the fundamental first)
  var HARM = [1, 0.62, 0.36, 0.18, 0.07];
  var SUB = 0.35, WHINE = 0.06, MASTER = 0.5;

  function Engine() {
    this.ctx = null;
    this.on = false;
    this.oscs = [];
    this.master = null;
    this.filter = null;
  }
  Engine.prototype.build = function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    var ctx = this.ctx = new AC();
    var out = ctx.createGain(), filter = ctx.createBiquadFilter();
    out.gain.value = 0;
    filter.type = 'lowpass';
    filter.frequency.value = CUT_IDLE;
    filter.Q.value = 0.7;
    filter.connect(out).connect(ctx.destination);
    this.master = out;
    this.filter = filter;
    var self = this;
    // Body: each harmonic is a sine at a multiple of the note, at its own level
    HARM.forEach(function (level, i) { self.oscs.push(self.tone(i + 1, level * MASTER)); });
    self.oscs.push(self.tone(0.5, SUB * MASTER));
    self.oscs.push(self.tone(1.5, WHINE * MASTER));
    return true;
  };
  Engine.prototype.tone = function (ratio, level) {
    var ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = F_IDLE * ratio;
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
    var frac = top > 0 ? Math.max(0, Math.min(1, speed / top)) : 0, now = this.ctx.currentTime, tc = 0.05;
    var f = F_IDLE + (F_TOP - F_IDLE) * frac;
    this.oscs.forEach(function (o) { o.osc.frequency.setTargetAtTime(f * o.ratio, now, tc); });
    this.filter.frequency.setTargetAtTime(CUT_IDLE + (CUT_TOP - CUT_IDLE) * frac, now, tc);
    // Quiet at a standstill, fuller as the car gets quicker
    this.master.gain.setTargetAtTime(0.04 + 0.2 * frac, now, tc);
  };
  // Fade out and stop: used on pause, at the end of the lap, when scrubbing and when the switch goes off.
  Engine.prototype.quiet = function () {
    if (!this.ctx || !this.on) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  };

  window.MT3UKMotorSound = new Engine();
})();
