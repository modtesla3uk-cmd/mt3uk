/*
  Admin: the Laps video panel on track-admin.html. Chooses the circuit, mph or km/h, the words in each scene, and the
  Sound button, and shows a live preview (js/laps-explainer.js). Saved in the worker (KV laps-explainer, /laps/explainer/admin).
*/
(function () {
  var root = document.getElementById('explainer-wrap');
  if (!root || !window.MT3UKExplainer) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var E = window.MT3UKExplainer;
  var NAMES = { upload: 'Scene 1: upload', map: 'Scene 2: every lap mapped', delta: 'Scene 3: gained and lost', compare: 'Scene 4: compare two laps', car: 'Scene 5: car data', end: 'Scene 6: end card' };
  var mapSel = document.getElementById('lxa-map'), scenesBox = document.getElementById('lxa-scenes');
  var unitBtns = document.querySelectorAll('#lxa-units [data-units]'), sound = document.getElementById('lxa-sound');
  var soundStyle = document.getElementById('lxa-sound-style'), pace = document.getElementById('lxa-pace');
  var loop = document.getElementById('lxa-loop'), previewLabel = document.getElementById('lxa-preview-label');
  var audioNow = document.getElementById('lxa-audio-now'), audioFile = document.getElementById('lxa-audio-file');
  var audioUpload = document.getElementById('lxa-audio-upload'), audioRemove = document.getElementById('lxa-audio-remove');
  var MAX_AUDIO = 5 * 1024 * 1024;
  var volume = document.getElementById('lxa-volume'), note = document.getElementById('lxa-note');
  var saveBtn = document.getElementById('lxa-save'), resetBtn = document.getElementById('lxa-reset');
  var previewBox = document.getElementById('lxa-preview');
  var fields = {}, preview = null, loaded = false, units = 'mph';

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
  // The upload and remove messages sit under their buttons, where the reader is looking.
  var audioNote = document.getElementById('lxa-audio-note');
  function sayAudio(t, bad) { if (audioNote) { audioNote.textContent = t || ''; audioNote.classList.toggle('is-bad', !!bad); } say(t, bad); }

  // Options and the scene boxes (one title and one caption per scene, with the built-in words as the placeholder).
  Object.keys(E.MAPS).forEach(function (id) {
    var o = document.createElement('option');
    o.value = id; o.textContent = E.MAPS[id].name;
    mapSel.appendChild(o);
  });
  Object.keys(E.PACES).forEach(function (id) {
    var o = document.createElement('option');
    o.value = id; o.textContent = E.PACES[id].name;
    pace.appendChild(o);
  });
  Object.keys(E.SOUNDS).forEach(function (id) {
    var o = document.createElement('option');
    o.value = id; o.textContent = E.SOUNDS[id];
    soundStyle.appendChild(o);
  });
  E.SCENES.forEach(function (id) {
    var box = document.createElement('div');
    box.className = 'lxa-scene';
    var h = document.createElement('h4');
    h.textContent = NAMES[id];
    var title = document.createElement('input'); title.type = 'text'; title.maxLength = 60; title.placeholder = E.TEXT[id].title;
    var cap = document.createElement('input'); cap.type = 'text'; cap.maxLength = 140; cap.placeholder = E.TEXT[id].caption;
    var l1 = document.createElement('label'); l1.textContent = 'Title'; l1.appendChild(title);
    var l2 = document.createElement('label'); l2.textContent = 'Caption'; l2.appendChild(cap);
    box.appendChild(h); box.appendChild(l1); box.appendChild(l2);
    scenesBox.appendChild(box);
    fields[id] = { title: title, caption: cap };
  });

  // The settings as typed. Words equal to the built-in ones are not sent, so a later change to the built-in words still shows.
  function read() {
    var texts = {};
    E.SCENES.forEach(function (id) {
      var t = fields[id].title.value.trim(), c = fields[id].caption.value.trim(), mine = {};
      if (t && t !== E.TEXT[id].title) mine.title = t;
      if (c && c !== E.TEXT[id].caption) mine.caption = c;
      if (mine.title || mine.caption) texts[id] = mine;
    });
    var style = soundStyle.value;
    return { map: mapSel.value, units: units, pace: pace.value, audio: currentAudio, loop: loop.getAttribute('aria-checked') === 'true', previewLabel: previewLabel.getAttribute('aria-checked') === 'true', soundStyle: style, sound: sound.getAttribute('aria-checked') === 'true' && style !== 'silent', volume: parseInt(volume.value, 10), texts: texts };
  }
  // Shows the uploaded file, and offers it in the Sound menu only while there is one.
  var currentAudio = null;
  function showAudio(audio) {
    currentAudio = audio || null;
    var old = soundStyle.querySelector('option[value="custom"]');
    if (old) old.parentNode.removeChild(old);
    if (audio && audio.url) {
      var o = document.createElement('option');
      o.value = 'custom'; o.textContent = 'Your own file' + (audio.name ? ': ' + audio.name : '');
      soundStyle.appendChild(o);
      audioNow.textContent = 'Your file: ' + (audio.name || 'sound') + (audio.size ? ' (' + Math.round(audio.size / 1024) + ' KB)' : '') + '. Choose Your own file in the Sound menu to use it.';
    } else {
      audioNow.textContent = 'No file yet. Upload an MP3 or OGG to use your own sound.';
    }
    audioRemove.disabled = !(audio && audio.url);
  }
  function fill(s) {
    s = E.merge(s || {});
    showAudio(s.audio);
    mapSel.value = s.map;
    setUnits(s.units);
    soundStyle.value = s.soundStyle;
    pace.value = s.pace;
    loop.setAttribute('aria-checked', String(s.loop !== false));
    previewLabel.setAttribute('aria-checked', String(s.previewLabel !== false));
    sound.setAttribute('aria-checked', String(!!s.sound));
    volume.value = String(s.volume);
    E.SCENES.forEach(function (id) {
      var saved = (s.texts && s.texts[id]) || {};
      var t = saved.title, c = saved.caption;
      fields[id].title.value = t && t !== E.TEXT[id].title ? t : '';
      fields[id].caption.value = c && c !== E.TEXT[id].caption ? c : '';
    });
  }
  function setUnits(u) {
    units = u === 'kph' ? 'kph' : 'mph';
    Array.prototype.forEach.call(unitBtns, function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-units') === units)); });
  }
  function refreshPreview() {
    if (!preview) return;
    preview.set(read());
  }

  Array.prototype.forEach.call(unitBtns, function (b) {
    b.addEventListener('click', function () { setUnits(b.getAttribute('data-units')); refreshPreview(); });
  });
  mapSel.addEventListener('change', refreshPreview);
  soundStyle.addEventListener('change', refreshPreview);
  pace.addEventListener('change', refreshPreview);
  [loop, previewLabel].forEach(function (b) {
    b.addEventListener('click', function () { b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')); refreshPreview(); });
  });
  sound.addEventListener('click', function () { sound.setAttribute('aria-checked', String(sound.getAttribute('aria-checked') !== 'true')); refreshPreview(); });
  volume.addEventListener('input', refreshPreview);
  E.SCENES.forEach(function (id) {
    fields[id].title.addEventListener('input', refreshPreview);
    fields[id].caption.addEventListener('input', refreshPreview);
  });

  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    call('GET', '/laps/explainer/admin').then(function (d) {
      if (!d.success) { say(d.message || 'Could not load it.', true); return; }
      loaded = true;
      fill(d.settings);
      if (!preview) preview = E.mount(previewBox, read(), { autoplay: true });
      else preview.set(read());
      say('Changes show in the preview at once. Save to put them on laps.mt3uk.com.');
    }).catch(function () { say('Could not reach the server.', true); });
  }
  if (!preview) preview = E.mount(previewBox, read(), { autoplay: true });
  root.addEventListener('toggle', function () { if (root.open && !loaded) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (root.open) load(); });

  // Upload: the file goes to the worker, then the settings are saved so the sound is used on laps.mt3uk.com.
  audioUpload.addEventListener('click', function () {
    var file = audioFile.files && audioFile.files[0];
    if (!file) { sayAudio('Choose an MP3 or OGG file first.', true); return; }
    if (file.size > MAX_AUDIO) { sayAudio('That file is over 5 MB. Please choose a shorter or smaller one.', true); return; }
    if (!key()) { sayAudio('Enter the admin key at the top of the page first.', true); return; }
    audioUpload.disabled = true;
    sayAudio('Uploading ' + file.name + '…');
    fetch(API + '/laps/explainer/admin/audio?name=' + encodeURIComponent(file.name) + '&key=' + encodeURIComponent(key()), {
      method: 'POST', headers: { 'Content-Type': file.type || 'audio/mpeg' }, cache: 'no-store', body: file
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
      if (!d.success) { audioUpload.disabled = false; sayAudio(d.message || 'Could not upload the file.', true); return; }
      fill(d.settings);
      soundStyle.value = 'custom';
      return call('POST', '/laps/explainer/admin', read()).then(function (saved) {
        audioUpload.disabled = false;
        audioFile.value = '';
        if (saved.success) { fill(saved.settings); soundStyle.value = 'custom'; refreshPreview(); sayAudio('Uploaded and saved. laps.mt3uk.com uses it within two minutes.'); }
        else sayAudio(saved.message || 'Uploaded, but it could not be saved.', true);
      });
    }).catch(function () { audioUpload.disabled = false; sayAudio('Could not reach the server.', true); });
  });
  audioRemove.addEventListener('click', function () {
    if (!window.confirm('Remove your sound file? The Sound menu goes back to Soft pad.')) return;
    audioRemove.disabled = true;
    fetch(API + '/laps/explainer/admin/audio?key=' + encodeURIComponent(key()), { method: 'DELETE', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
        audioRemove.disabled = false;
        if (!d.success) { sayAudio(d.message || 'Could not remove the file.', true); return; }
        fill(d.settings);
        if (soundStyle.value === 'custom') soundStyle.value = 'pad';
        refreshPreview();
        sayAudio('Removed. The Sound menu is back to the built-in sounds.');
      }).catch(function () { audioRemove.disabled = false; sayAudio('Could not reach the server.', true); });
  });

  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    call('POST', '/laps/explainer/admin', read()).then(function (d) {
      saveBtn.disabled = false;
      if (!d.success) { say(d.message || 'Could not save it.', true); return; }
      fill(d.settings);
      say('Saved. laps.mt3uk.com picks it up within two minutes.');
    }).catch(function () { saveBtn.disabled = false; say('Could not reach the server.', true); });
  });
  resetBtn.addEventListener('click', function () {
    if (!window.confirm('Use the built-in words and settings for the Laps video?')) return;
    call('POST', '/laps/explainer/admin', { reset: true }).then(function (d) {
      if (!d.success) { say(d.message || 'Could not reset it.', true); return; }
      fill({});
      refreshPreview();
      say('Reset to the built-in words and settings.');
    }).catch(function () { say('Could not reach the server.', true); });
  });
})();
