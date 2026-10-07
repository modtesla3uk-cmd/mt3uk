/*
  Admin: the welcome card a visitor who is not signed in sees on track.html (heading, intro and the tick list).
  Saved in the worker (KV track-copy); cleared, the page shows its built-in words.
*/
(function () {
  var wrap = document.getElementById('copy-wrap');
  if (!wrap) return;
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var heading = document.getElementById('tc-heading'), intro = document.getElementById('tc-intro'), bullets = document.getElementById('tc-bullets');
  var tipHeading = document.getElementById('tc-tip-heading'), tipText = document.getElementById('tc-tip-text'), tipOn = document.getElementById('tc-tip-on');
  var PREVIEW = ['out', 'none', 'pending'], preview = {};
  PREVIEW.forEach(function (k) { preview[k] = document.getElementById('tc-preview-' + k); });
  function previewKey(k) { return 'preview' + k.charAt(0).toUpperCase() + k.slice(1); }
  var note = document.getElementById('tc-note'), saveBtn = document.getElementById('tc-save'), resetBtn = document.getElementById('tc-reset'), loaded = false;
  var BUILT_IN = {
    heading: 'Your track days, mapped',
    intro: 'Upload the file from your lap timer (RaceBox, VBOX, Harry\'s LapTimer, TrackAddict, AiM and most phone apps) and see every lap drawn on the track, where you gained and lost time, and how your times changed as you modified the car.',
    bullets: ['Laps, sectors and corners found for you', 'Compare any two laps, corner by corner', 'See what each mod in My Garage did to your times', 'Drag runs from the strip: 60 ft, 0 to 60, quarter mile', 'Private unless you choose to share'],
    // The tip on Sessions and the Leaderboard (the same words as js/laps-tip.js).
    tipHeading: 'Tip: the more you upload, the more the board tells you',
    tipText: 'Every session you add is kept as your car\'s best for that mix of tyres and conditions, so the filters can compare like with like, and the board shows how you are coming on from day to day. Upload each track day, even the slow ones.',
    // The early preview note (the same words as js/laps-strip.js).
    previewOut: 'Anyone can browse the leaderboards. Adding your own laps is open to early testers while we finish Laps. Join the list for a place.',
    previewNone: 'Anyone can browse the leaderboards. Adding your own laps is open to early testers while we finish Laps. Ask for a place and we\u2019ll let you know.',
    previewPending: 'We\u2019ll email you as soon as your place is ready. Until then, have a look round the leaderboards.'
  };
  function tipShown() { return !tipOn || tipOn.getAttribute('aria-checked') === 'true'; }
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
  function fill(c) {
    c = c || {};
    heading.value = c.heading || ''; intro.value = c.intro || ''; bullets.value = (c.bullets || []).join('\n');
    heading.placeholder = BUILT_IN.heading; intro.placeholder = BUILT_IN.intro; bullets.placeholder = BUILT_IN.bullets.join('\n');
    if (tipHeading) { tipHeading.value = c.tipHeading || ''; tipHeading.placeholder = BUILT_IN.tipHeading; }
    if (tipText) { tipText.value = c.tipText || ''; tipText.placeholder = BUILT_IN.tipText; }
    if (tipOn) tipOn.setAttribute('aria-checked', String(!c.tipOff));
    PREVIEW.forEach(function (k) { if (preview[k]) { preview[k].value = c[previewKey(k)] || ''; preview[k].placeholder = BUILT_IN[previewKey(k)]; } });
    say(Object.keys(c).length ? 'Your own words are showing on the page.' : 'The built-in words are showing. Type to replace them; anything left blank keeps the built-in text.');
  }
  function load() {
    if (!key()) { say('Enter the admin key at the top of the page first.'); return; }
    call('GET', '/track/copy/admin').then(function (d) {
      if (!d.success) { say(d.message || 'Could not load the text.', true); return; }
      loaded = true; fill(d.copy);
    }).catch(function () { say('Could not reach the server.', true); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open && !loaded) load(); });
  if (saveBtn) saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    call('POST', '/track/copy/admin', { heading: heading.value.trim(), intro: intro.value.trim(), bullets: bullets.value.split(/\r?\n/).map(function (b) { return b.trim(); }).filter(Boolean),
      tipHeading: tipHeading ? tipHeading.value.trim() : '', tipText: tipText ? tipText.value.trim() : '', tipOff: !tipShown(),
      previewOut: preview.out ? preview.out.value.trim() : '', previewNone: preview.none ? preview.none.value.trim() : '', previewPending: preview.pending ? preview.pending.value.trim() : '' }).then(function (d) {
      saveBtn.disabled = false;
      if (!d.success) { say(d.message || 'Could not save it.', true); return; }
      fill(d.copy); say('Saved. The page shows it on its next load.');
    }).catch(function () { saveBtn.disabled = false; say('Could not reach the server.', true); });
  });
  if (tipOn) tipOn.addEventListener('click', function () { tipOn.setAttribute('aria-checked', String(!tipShown())); });
  if (resetBtn) resetBtn.addEventListener('click', function () {
    if (!window.confirm('Go back to the built-in words?')) return;
    call('POST', '/track/copy/admin', { reset: true }).then(function (d) {
      if (!d.success) { say(d.message || 'Could not reset it.', true); return; }
      fill({}); say('Back to the built-in words.');
    }).catch(function () { say('Could not reach the server.', true); });
  });
})();
