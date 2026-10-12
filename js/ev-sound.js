/*
  An electric motor sound made in the browser: a pitch sweep (pull, hold, ease off), a body of harmonics, a sub tone, a soft
  whine and some texture, with the top cut off so it stays warm rather than shrill. Used by the Sound panel of
  track-admin.html (js/ev-sound-admin.js) to preview and export it, and by any page that plays the saved sound.
  Nothing is stored here: the settings come from the worker (KV ev-sound) and the defaults below are the starting point.
*/
(function () {
  var SR = 44100;
  // Each setting's range. The worker (cleanEvSound in workers/vote-worker.js) uses the same ranges.
  var LIMITS = {
    f0: [40, 400], fPeak: [60, 1200], fEnd: [40, 800], rise: [0.5, 4], hold: [0, 3], length: [2, 6],
    harm: [0, 1], sub: [0, 1], whine: [0, 0.3], texture: [0, 0.2], cut: [400, 4000], volume: [0, 100]
  };
  var DEFAULTS = {
    f0: 95, fPeak: 430, fEnd: 150, rise: 2, hold: 0.5, length: 3.6,
    harm: [0.62, 0.36, 0.18, 0.07], sub: 0.35, whine: 0.06, texture: 0.04, cut: 1600, volume: 60
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function num(v, lim, dflt) {
    var n = Number(v);
    return isFinite(n) ? clamp(n, lim[0], lim[1]) : dflt;
  }
  function smooth(x) { return x * x * (3 - 2 * x); }

  // Fill in every setting: anything missing or out of range takes its default, and the timing is kept inside the length.
  function merge(s) {
    s = s || {};
    var out = {}, k;
    for (k in LIMITS) {
      if (k === 'harm') continue;
      out[k] = num(s[k], LIMITS[k], DEFAULTS[k]);
    }
    out.harm = DEFAULTS.harm.map(function (d, i) {
      return num(s.harm && s.harm[i], LIMITS.harm, d);
    });
    if (out.rise > out.length - 0.8) out.rise = Math.max(LIMITS.rise[0], out.length - 0.8);
    if (out.rise + out.hold > out.length - 0.4) out.hold = Math.max(0, out.length - 0.4 - out.rise);
    return out;
  }

  // The sound as samples (-1 to 1), peak-normalised to -3 dBFS so exports and previews are the same level.
  function render(settings) {
    var s = merge(settings);
    var n = Math.round(SR * s.length), t = new Float64Array(n), i;
    for (i = 0; i < n; i++) t[i] = i / SR;

    var f = new Float64Array(n), phase = 0;
    for (i = 0; i < n; i++) {
      var time = t[i];
      if (time < s.rise) f[i] = s.f0 + (s.fPeak - s.f0) * smooth(time / s.rise);
      else if (time < s.rise + s.hold) f[i] = s.fPeak;
      else {
        var x = clamp((time - s.rise - s.hold) / (s.length - s.rise - s.hold), 0, 1);
        f[i] = s.fPeak - (s.fPeak - s.fEnd) * smooth(x);
      }
    }

    // Noise for the texture, low passed, then scaled to its peak
    var seed = 7;
    function rand() {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    }
    var lp = new Float64Array(n), acc = 0, peak = 0;
    for (i = 0; i < n; i++) {
      acc += 0.015 * ((rand() * 2 - 1) - acc);
      lp[i] = acc;
      if (Math.abs(acc) > peak) peak = Math.abs(acc);
    }
    peak = peak || 1;

    var sig = new Float64Array(n), ph = 0;
    for (i = 0; i < n; i++) {
      ph += 2 * Math.PI * f[i] / SR;
      var v = Math.sin(ph);
      for (var h = 0; h < s.harm.length; h++) v += s.harm[h] * Math.sin((h + 2) * ph + 0.4 * h);
      v += s.sub * Math.sin(0.5 * ph);
      v += (s.whine + 0.04 * (f[i] / s.fPeak)) * Math.sin(1.5 * ph + 0.2);
      v += s.texture * (lp[i] / peak) * (f[i] / s.fPeak);
      sig[i] = v;
    }

    // Throttle envelope: builds through the pull, eases off on the lift
    var attack = Math.round(0.06 * SR), release = Math.round(0.45 * SR);
    var holdEnd = s.rise + s.hold;
    for (i = 0; i < n; i++) {
      var e;
      if (t[i] < s.rise) e = 0.4 + 0.6 * smooth(t[i] / s.rise);
      else if (t[i] < holdEnd) e = 1;
      else e = 1 - 0.7 * Math.pow(clamp((t[i] - holdEnd) / (s.length - holdEnd), 0, 1), 1.2);
      sig[i] *= e;
    }
    for (i = 0; i < attack && i < n; i++) sig[i] *= i / attack;
    for (i = 0; i < release && i < n; i++) sig[n - 1 - i] *= i / release;

    // Warm top: two one-pole low passes at the cut frequency
    var alpha = 1 - Math.exp(-2 * Math.PI * s.cut / SR);
    for (var pass = 0; pass < 2; pass++) {
      var y = 0;
      for (i = 0; i < n; i++) { y += alpha * (sig[i] - y); sig[i] = y; }
    }

    var top = 0;
    for (i = 0; i < n; i++) if (Math.abs(sig[i]) > top) top = Math.abs(sig[i]);
    var g = top ? Math.pow(10, -3 / 20) / top : 0;
    for (i = 0; i < n; i++) sig[i] *= g;
    return sig;
  }

  // A 16-bit mono WAV file, for download (MP3 and other formats can be made from it with any converter).
  function wav(samples) {
    var n = samples.length, buf = new ArrayBuffer(44 + n * 2), view = new DataView(buf), i;
    function str(off, text) { for (var j = 0; j < text.length; j++) view.setUint8(off + j, text.charCodeAt(j)); }
    str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, SR, true); view.setUint32(28, SR * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round(clamp(samples[i], -1, 1) * 32767), true);
    return new Blob([buf], { type: 'audio/wav' });
  }

  // Plays the sound once through the browser's audio. Needs a tap or click first (browsers block sound before one).
  var ctx = null, current = null;
  function play(settings, volume) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    stop();
    var sig = render(settings);
    var buffer = ctx.createBuffer(1, sig.length, SR);
    buffer.copyToChannel(sig, 0);
    var src = ctx.createBufferSource(), gain = ctx.createGain();
    var v = merge(settings).volume;
    if (volume !== undefined) v = clamp(Number(volume), 0, 100);
    gain.gain.value = v / 100;
    src.buffer = buffer;
    src.connect(gain).connect(ctx.destination);
    src.start();
    current = src;
    src.onended = function () { if (current === src) current = null; };
    return true;
  }
  function stop() {
    if (current) { try { current.stop(); } catch (e) {} current = null; }
  }

  window.MT3UKEvSound = {
    SR: SR, LIMITS: LIMITS, DEFAULTS: DEFAULTS, merge: merge, render: render, wav: wav, play: play, stop: stop
  };
})();
