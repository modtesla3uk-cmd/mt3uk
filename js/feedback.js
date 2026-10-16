/*
  Give feedback: the form opened from the menu (partials/header.html and laps-header.html, data-feedback-open). A short
  message, a nickname (filled in for a signed-in member), an optional email address and an optional screenshot. It is
  sent to POST /feedback, which emails MT3UK and lists it on the Reports group of admin.html. A screenshot larger than
  the worker takes is shrunk here first.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var MAX_SHOT = 1400000, SHRINK_TO = 1600;
  var dialog = null, shot = '';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function token() { try { return localStorage.getItem('mt3ukMyBuildsSession') || ''; } catch (e) { return ''; } }

  function css() {
    if (document.getElementById('fb-style')) return;
    var st = document.createElement('style');
    st.id = 'fb-style';
    st.textContent = '#fb-dialog{position:fixed;inset:0;z-index:600;background:rgba(12,20,38,.6);display:grid;place-items:center;padding:16px}' +
      '#fb-dialog[hidden]{display:none}' +
      '#fb-dialog .fb-card{position:relative;background:#fff;color:#16233d;border-radius:12px;padding:22px 20px;max-width:520px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 18px 40px rgba(0,0,0,.3);font-family:inherit}' +
      '#fb-dialog h2{margin:0 0 6px;font-size:1.3rem}' +
      '#fb-dialog label{display:block;font-weight:600;margin:12px 0 4px}' +
      '#fb-dialog input[type=text],#fb-dialog input[type=email],#fb-dialog textarea{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #c9cfdb;border-radius:8px;background:#fff;color:#16233d}' +
      '#fb-dialog textarea{min-height:110px;resize:vertical}' +
      '#fb-dialog .fb-hint{font-size:.88rem;color:#4a5366;margin:4px 0 0}' +
      '#fb-dialog .fb-note{margin:10px 0 0;font-size:.95rem;min-height:1.2em}' +
      '#fb-dialog .fb-note.is-error{color:#b42318}' +
      '#fb-dialog .fb-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}' +
      '#fb-dialog button{font:inherit;font-weight:600;border-radius:8px;padding:11px 18px;min-height:44px;cursor:pointer;border:1px solid #16233d;background:#16233d;color:#fff}' +
      '#fb-dialog button.fb-secondary{background:#fff;color:#16233d}' +
      '#fb-dialog button:disabled{opacity:.6;cursor:default}' +
      '#fb-dialog .fb-x{position:absolute;top:8px;right:8px;width:44px;height:44px;border:0;background:transparent;color:#16233d;font-size:1.6rem;line-height:1;padding:0;min-height:0}';
    document.head.appendChild(st);
  }

  function build() {
    css();
    dialog = document.createElement('div');
    dialog.id = 'fb-dialog';
    dialog.hidden = true;
    dialog.innerHTML = '<form class="fb-card" id="fb-form" role="dialog" aria-modal="true" aria-labelledby="fb-title">' +
      '<button type="button" class="fb-x" id="fb-x" aria-label="Close">&times;</button>' +
      '<h2 id="fb-title">Provide Feedback</h2>' +
      '<p class="fb-hint">Helps improve the platform</p>' +
      '<label for="fb-nick">Nickname</label><input type="text" id="fb-nick" maxlength="40" required autocomplete="nickname">' +
      '<p class="fb-hint" id="fb-nick-hint">Your nickname from your profile. To change it, edit it in Profile.</p>' +
      '<label for="fb-msg">What happened?</label><textarea id="fb-msg" maxlength="1000" required></textarea>' +
      '<label for="fb-shot">Screenshot (optional)</label><input type="file" id="fb-shot" accept="image/png,image/jpeg,image/webp">' +
      '<label for="fb-email">Email (optional)</label><input type="email" id="fb-email" autocomplete="email">' +
      '<p class="fb-hint">Only add an email if you would like a reply.</p>' +
      '<p class="fb-note" id="fb-note" role="status"></p>' +
      '<div class="fb-actions"><button type="button" class="fb-secondary" id="fb-cancel">Cancel</button><button type="submit" id="fb-send">Send feedback</button></div>' +
      '</form>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', function (e) { if (e.target === dialog) close(); });
    document.getElementById('fb-x').addEventListener('click', close);
    document.getElementById('fb-cancel').addEventListener('click', close);
    document.getElementById('fb-shot').addEventListener('change', onShot);
    document.getElementById('fb-form').addEventListener('submit', send);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog && !dialog.hidden) close(); });
  }

  function note(t, bad) { var n = document.getElementById('fb-note'); n.textContent = t || ''; n.className = 'fb-note' + (bad ? ' is-error' : ''); }

  // A picture over the limit is drawn smaller in the browser, as a JPEG, until it fits.
  function onShot(e) {
    shot = '';
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { note('Please choose a PNG, JPEG or WebP picture.', true); e.target.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function () {
      if (f.size <= MAX_SHOT) { shot = reader.result; note(''); return; }
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, SHRINK_TO / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        shot = c.toDataURL('image/jpeg', 0.85);
        note(shot.length * 0.75 > MAX_SHOT ? 'That picture is too big even when smaller. Try a screenshot of a smaller part of the screen.' : '', shot.length * 0.75 > MAX_SHOT);
        if (shot.length * 0.75 > MAX_SHOT) shot = '';
      };
      img.onerror = function () { note('That picture could not be read.', true); };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  }

  function prefill() {
    var nick = document.getElementById('fb-nick');
    nick.value = '';
    nick.readOnly = false;
    document.getElementById('fb-nick-hint').hidden = true;
    if (!token()) return;
    fetch(API + '/profile', { headers: { 'X-Session-Token': token() }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.success || nick.value) return;
        nick.value = d.nickname || [d.firstName, d.lastName].filter(Boolean).join(' ').slice(0, 40);
        // A signed-in member's nickname is their own, so it is not edited here (change it in Profile).
        if (nick.value) { nick.readOnly = true; document.getElementById('fb-nick-hint').hidden = false; }
      }).catch(function () { /* the member types it */ });
  }

  function open() {
    if (!dialog) build();
    shot = '';
    document.getElementById('fb-form').reset();
    note('');
    dialog.hidden = false;
    prefill();
    setTimeout(function () { document.getElementById('fb-msg').focus(); }, 30);
  }
  function close() { if (dialog) dialog.hidden = true; }

  function send(e) {
    e.preventDefault();
    var nick = document.getElementById('fb-nick').value.trim(), msg = document.getElementById('fb-msg').value.trim();
    var email = document.getElementById('fb-email').value.trim();
    if (!nick) { note('Add a nickname so we know who to thank.', true); return; }
    if (msg.length < 5) { note('Tell us what happened (a few words at least).', true); return; }
    var btn = document.getElementById('fb-send');
    btn.disabled = true; note('Sending...');
    fetch(API + '/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ nickname: nick, message: msg, email: email, page: location.href, shot: shot })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.d.success) { note(res.d.message || 'Could not send that. Please try again.', true); return; }
        note(res.d.message || 'Thanks. We have your feedback.');
        setTimeout(close, 1800);
      }).catch(function () { btn.disabled = false; note('Could not reach the server. Please try again.', true); });
  }

  window.MT3UKFeedback = { open: open };
})();
