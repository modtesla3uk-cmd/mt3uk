/*
  Admin: the Sound panel on track-admin.html. Shape an electric motor sound with sliders, hear it, save it, or download it
  as a WAV. Uses js/ev-sound.js for the sound. Saved in the worker (KV ev-sound, /sound/ev/admin).
*/
(function () {
  var root = document.getElementById('sound-wrap');
  if (!root || !window.MT3UKEvSound) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var S = window.MT3UKEvSound;
  var controls = document.getElementById('snd-controls');
  var note = document.getElementById('snd-note');
  var playBtn = document.getElementById('snd-play'), stopBtn = document.getElementById('snd-stop');
  var saveBtn = document.getElementById('snd-save'), resetBtn = document.getElementById('snd-reset');
  var wavBtn = document.getElementById('snd-wav');
  var loaded = false, inputs = {};

  // Each slider: the key, its label, the step, and a note of what it does.
  var ROWS = [
    { key: 'f0', label: 'Starting pitch (Hz)', step: 5, hint: 'Where the note starts, at a standstill' },
    { key: 'fPeak', label: 'Top pitch (Hz)', step: 5, hint: 'The highest note reached' },
    { key: 'fEnd', label: 'Pitch after the lift (Hz)', step: 5, hint: 'Where it settles after the lift' },
    { key: 'rise', label: 'Time to pull to the top (seconds)', step: 0.1, hint: 'How long the pull takes' },
    { key: 'hold', label: 'Time held at the top (seconds)', step: 0.1, hint: 'How long it stays at the top' },
    { key: 'length', label: 'Length (seconds)', step: 0.1, hint: 'The whole sound' },
    { key: 'harm.0', label: 'Body: 2nd harmonic', step: 0.01, hint: 'Adds warmth' },
    { key: 'harm.1', label: 'Body: 3rd harmonic', step: 0.01, hint: 'Adds edge' },
    { key: 'harm.2', label: 'Body: 4th harmonic', step: 0.01, hint: 'Adds bite' },
    { key: 'harm.3', label: 'Body: 5th harmonic', step: 0.01, hint: 'Adds sharpness' },
    { key: 'sub', label: 'Sub rumble', step: 0.01, hint: 'A low tone under the note' },
    { key: 'whine', label: 'Whine', step: 0.005, hint: 'The high inverter whine' },
    { key: 'texture', label: 'Road and air texture', step: 0.005, hint: 'A soft hiss that follows the speed' },
    { key: 'cut', label: 'Top cut (Hz)', step: 50, hint: 'Lower is warmer and less shrill' },
    { key: 'volume', label: 'Preview volume (0 to 100)', step: 5, hint: 'How loud the preview plays' }
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

  function getVal(settings, k) {
    var parts = k.split('.');
    return parts.length === 2 ? settings[parts[0]][Number(parts[1])] : settings[k];
  }

  // Build the sliders once. Each one shows its value beside it and changes the preview as it moves.
  ROWS.forEach(function (row) {
    var lab = document.createElement('label');
    lab.className = 'snd-row';
    var title = document.createElement('span');
    title.textContent = row.label;
    var input = document.createElement('input');
    input.type = 'range';
    input.step = String(row.step);
    var out = document.createElement('output');
    var hint = document.createElement('small');
    hint.textContent = row.hint;
    lab.appendChild(title);
    lab.appendChild(input);
    lab.appendChild(out);
    lab.appendChild(hint);
    controls.appendChild(lab);
    inputs[row.key] = { input: input, out: out, row: row };
    input.addEventListener('input', function () { show(row.key); say(''); });
  });

  function show(k) {
    var it = inputs[k];
    it.out.textContent = String(Number(it.input.value));
  }
  // Ranges depend on the limits in js/ev-sound.js, so the sliders always match what the sound accepts.
  function setRanges() {
    ROWS.forEach(function (row) {
      var base = row.key.split('.')[0];
      var lim = S.LIMITS[base];
      var it = inputs[row.key];
      it.input.min = String(lim[0]);
      it.input.max = String(lim[1]);
    });
  }
  setRanges();

  // The settings as the sliders show them now.
  function read() {
    var s = { harm: [] };
    ROWS.forEach(function (row) {
      var v = Number(inputs[row.key].input.value);
      var parts = row.key.split('.');
      if (parts.length === 2) s.harm[Number(parts[1])] = v;
      else s[row.key] = v;
    });
    return S.merge(s);
  }
  function fill(settings) {
    var s = S.merge(settings);
    ROWS.forEach(function (row) {
      var it = inputs[row.key];
      it.input.value = String(getVal(s, row.key));
      show(row.key);
    });
  }

  playBtn.addEventListener('click', function () {
    var ok = S.play(read(), Number(inputs.volume.input.value));
    say(ok ? 'Playing the sound.' : 'This browser cannot play sound here.', !ok);
  });
  stopBtn.addEventListener('click', function () { S.stop(); });
  wavBtn.addEventListener('click', function () {
    var blob = S.wav(S.render(read()));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mt3uk-ev-sound.wav';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    say('Downloaded as a WAV. Any converter can make it an MP3.');
  });

  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    call('GET', '/sound/ev/admin').then(function (d) {
      if (!d.success) { say(d.message || 'Could not load it.', true); return; }
      loaded = true;
      fill(d.settings);
      say('Play it, move the sliders, then Save to put it on the site.');
    }).catch(function () { say('Could not reach the server.', true); });
  }
  root.addEventListener('toggle', function () { if (root.open && !loaded) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (root.open) load(); });
  fill({});

  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    call('POST', '/sound/ev/admin', read()).then(function (d) {
      saveBtn.disabled = false;
      if (!d.success) { say(d.message || 'Could not save it.', true); return; }
      fill(d.settings);
      say('Saved.');
    }).catch(function () { saveBtn.disabled = false; say('Could not reach the server.', true); });
  });
  resetBtn.addEventListener('click', function () {
    if (!window.confirm('Use the built-in sound again?')) return;
    call('POST', '/sound/ev/admin', { reset: true }).then(function (d) {
      if (!d.success) { say(d.message || 'Could not reset it.', true); return; }
      fill({});
      say('Reset to the built-in sound.');
    }).catch(function () { say('Could not reach the server.', true); });
  });
})();
