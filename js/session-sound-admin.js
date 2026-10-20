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
  var DEFAULTS = { pitch: 1, bassDrive: 6, growl: 1.4, growlDrive: 9, rasp: 0.12, wobble: 0.6, volume: 90 };
  var ROWS = [
    { key: 'pitch', label: 'Pitch (x)', min: 0.25, max: 1.5, step: 0.05, hint: 'Lowers or raises the whole sound. 0.5 is an octave down' },
    { key: 'bassDrive', label: 'Bass grit', min: 0, max: 10, step: 0.5, hint: 'How hard the bass note is driven. More is rougher' },
    { key: 'growl', label: 'Growl level', min: 0, max: 2.5, step: 0.05, hint: 'How loud the growl sits above the bass' },
    { key: 'growlDrive', label: 'Growl grit', min: 0, max: 12, step: 0.5, hint: 'How hard the growl is driven. More is more aggressive' },
    { key: 'rasp', label: 'Rasp', min: 0, max: 0.3, step: 0.01, hint: 'The noise on top, which comes in at speed' },
    { key: 'wobble', label: 'Firing wobble', min: 0, max: 1, step: 0.05, hint: 'How far the growl pulses at the firing rate' },
    { key: 'volume', label: 'Level (0 to 100)', min: 0, max: 100, step: 5, hint: 'How loud the sound is on a session' }
  ];
  // Presets fill the sliders above. Save puts the filled-in settings on the site.
  var PRESETS = [
    { label: 'As built (F2)', values: { pitch: 1, bassDrive: 6, growl: 1.4, growlDrive: 9, rasp: 0.12, wobble: 0.6, volume: 90 } },
    { label: 'A step softer (F1)', values: { pitch: 1, bassDrive: 3, growl: 1.2, growlDrive: 6, rasp: 0.07, wobble: 0.35, volume: 90 } },
    { label: 'Octave down', values: { pitch: 0.5, bassDrive: 6, growl: 1.4, growlDrive: 9, rasp: 0.12, wobble: 0.6, volume: 90 } },
    { label: 'Heavier', values: { pitch: 1, bassDrive: 8, growl: 1.6, growlDrive: 11, rasp: 0.15, wobble: 0.7, volume: 95 } }
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
    var out = {};
    Object.keys(DEFAULTS).forEach(function (name) {
      var n = Number(s[name]);
      out[name] = s[name] !== undefined && s[name] !== null && s[name] !== '' && isFinite(n) ? n : DEFAULTS[name];
    });
    return out;
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
    var s = {};
    ROWS.forEach(function (row) { s[row.key] = Number(inputs[row.key].input.value); });
    return s;
  }
  function fill(settings) {
    var s = merged(settings);
    ROWS.forEach(function (row) {
      var it = inputs[row.key];
      it.input.value = String(s[row.key]);
      it.out.textContent = String(Number(it.input.value));
    });
  }

  // The preset buttons sit above the sliders. A press fills the sliders in; nothing is saved until Save.
  var presets = document.createElement('div');
  presets.className = 'ss-presets';
  presets.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px';
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', 'Presets');
  PRESETS.forEach(function (preset) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary btn-sm';
    b.textContent = preset.label;
    b.addEventListener('click', function () {
      fill(preset.values);
      say('Filled in the ' + preset.label.toLowerCase() + ' preset. Hear it, then Save to put it on the site.');
    });
    presets.appendChild(b);
  });
  controls.parentNode.insertBefore(presets, controls);

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
