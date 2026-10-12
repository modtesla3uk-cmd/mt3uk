/*
  Admin: the Session playback sound section of the Sound panel on track-admin.html. Sets the motor sound that plays with a
  session's laps (js/motor-sound.js). Saved in the worker (KV session-sound, /sound/session/admin), kept apart from the
  Sound panel's shaping settings. Hearing it: the Play button on the Sound panel, or the Sound on switch on a session.
*/
(function () {
  var root = document.getElementById('session-sound-wrap');
  if (!root) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var controls = document.getElementById('ss-controls');
  var note = document.getElementById('ss-note');
  var saveBtn = document.getElementById('ss-save'), resetBtn = document.getElementById('ss-reset');
  var playBtn = document.getElementById('ss-play'), stopBtn = document.getElementById('ss-stop');
  var loaded = false, inputs = {};

  // The built-in values and ranges, as in js/motor-sound.js
  var DEFAULTS = { f0: 95, fPeak: 430, harm: [0.62, 0.36, 0.18, 0.07], sub: 0.35, whine: 0.06, cut: 1600, volume: 60 };
  var ROWS = [
    { key: 'f0', label: 'Lowest note (Hz)', min: 40, max: 400, step: 5, hint: 'The note when the car is standing still' },
    { key: 'fPeak', label: 'Highest note (Hz)', min: 60, max: 1200, step: 5, hint: 'The note at the car\'s top speed on the lap' },
    { key: 'harm.0', label: 'Body: 2nd harmonic', min: 0, max: 1, step: 0.01, hint: 'Adds warmth' },
    { key: 'harm.1', label: 'Body: 3rd harmonic', min: 0, max: 1, step: 0.01, hint: 'Adds edge' },
    { key: 'harm.2', label: 'Body: 4th harmonic', min: 0, max: 1, step: 0.01, hint: 'Adds bite' },
    { key: 'harm.3', label: 'Body: 5th harmonic', min: 0, max: 1, step: 0.01, hint: 'Adds sharpness' },
    { key: 'sub', label: 'Sub rumble', min: 0, max: 1, step: 0.01, hint: 'A low tone under the note' },
    { key: 'whine', label: 'Whine', min: 0, max: 0.3, step: 0.005, hint: 'The high inverter whine' },
    { key: 'cut', label: 'Top cut (Hz)', min: 400, max: 4000, step: 50, hint: 'Lower is warmer and less shrill' },
    { key: 'volume', label: 'Level (0 to 100)', min: 0, max: 100, step: 5, hint: 'How loud the sound is on a session' }
  ];

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function call(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path + '?key=' + encodeURIComponent(key()), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function say(t, bad) { if (note) { note.textContent = t || ''; note.classList.toggle('is-bad', !!bad); } }

  // Fill in any setting missing or out of range with the built-in value
  function merged(s) {
    s = s || {};
    var out = { harm: [] }, k;
    ['f0', 'fPeak', 'sub', 'whine', 'cut', 'volume'].forEach(function (name) {
      var n = Number(s[name]);
      out[name] = s[name] !== undefined && s[name] !== null && s[name] !== '' && isFinite(n) ? n : DEFAULTS[name];
    });
    out.harm = DEFAULTS.harm.map(function (d, i) {
      var n = Number(s.harm && s.harm[i]);
      return s.harm && s.harm[i] !== undefined && s.harm[i] !== null && s.harm[i] !== '' && isFinite(n) ? n : d;
    });
    return out;
  }
  function valueOf(s, k) {
    var parts = k.split('.');
    return parts.length === 2 ? s.harm[Number(parts[1])] : s[k];
  }

  ROWS.forEach(function (row) {
    var lab = document.createElement('label');
    lab.className = 'snd-row';
    var title = document.createElement('span');
    title.textContent = row.label;
    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step);
    var out = document.createElement('output');
    var hint = document.createElement('small');
    hint.textContent = row.hint;
    lab.appendChild(title);
    lab.appendChild(input);
    lab.appendChild(out);
    lab.appendChild(hint);
    controls.appendChild(lab);
    inputs[row.key] = { input: input, out: out };
    input.addEventListener('input', function () { out.textContent = String(Number(input.value)); say(''); });
  });

  function read() {
    var s = { harm: [] };
    ROWS.forEach(function (row) {
      var v = Number(inputs[row.key].input.value), parts = row.key.split('.');
      if (parts.length === 2) s.harm[Number(parts[1])] = v;
      else s[row.key] = v;
    });
    return s;
  }
  function fill(settings) {
    var s = merged(settings);
    ROWS.forEach(function (row) {
      var it = inputs[row.key];
      it.input.value = String(valueOf(s, row.key));
      it.out.textContent = String(Number(it.input.value));
    });
  }

  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    call('GET', '/sound/session/admin').then(function (d) {
      if (!d.success) { say(d.message || 'Could not load it.', true); return; }
      loaded = true;
      fill(d.settings);
      say('Save puts these on the site. Hear them on any session with Sound on.');
    }).catch(function () { say('Could not reach the server.', true); });
  }
  // Play the sound with the sliders as they are now, so a change can be heard before it is saved.
  playBtn.addEventListener('click', function () {
    var ok = false;
    try { ok = !!(window.MT3UKMotorSound && window.MT3UKMotorSound.preview(read(), 4)); } catch (e) { ok = false; }
    say(ok ? 'Playing the session sound for four seconds.' : 'This browser could not play the sound. Try again, or save and hear it on a session.', !ok);
  });
  stopBtn.addEventListener('click', function () { if (window.MT3UKMotorSound) window.MT3UKMotorSound.stopPreview(); });
  root.addEventListener('toggle', function () { if (root.open && !loaded) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (root.open) load(); });
  fill({});

  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    call('POST', '/sound/session/admin', read()).then(function (d) {
      saveBtn.disabled = false;
      if (!d.success) { say(d.message || 'Could not save it.', true); return; }
      fill(d.settings);
      say('Saved. Sessions pick it up the next time they are opened.');
    }).catch(function () { saveBtn.disabled = false; say('Could not reach the server.', true); });
  });
  resetBtn.addEventListener('click', function () {
    if (!window.confirm('Use the built-in session sound again?')) return;
    call('POST', '/sound/session/admin', { reset: true }).then(function (d) {
      if (!d.success) { say(d.message || 'Could not reset it.', true); return; }
      fill({});
      say('Reset to the built-in sound.');
    }).catch(function () { say('Could not reach the server.', true); });
  });
})();
