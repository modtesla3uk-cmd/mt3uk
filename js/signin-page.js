/*
  Sign Up / Sign In, on signin.html (MT3UK) and laps-signin.html (Laps by MT3UK, <body data-signin-site="laps">):
  join free with a name and email (no photos needed), or sign in to an existing account. Both send a link and a
  6-digit code. The emailed link comes back to the page it was asked from with ?token=, and pages that ask a
  visitor to sign in link here with ?next=<page> so they go back afterwards. A sign-in is kept per address, so
  the Laps page tells the worker it is Laps (site: 'laps', and the Laps page to go back to), and the link and the
  emails are Laps ones. When the admin has switched the separate Laps sign-in off (the Sign-in and sign-up panel of
  track-admin.html, /laps/signin), laps-signin.html sends visitors on to signin.html on the same address.
*/
(function () {
  var SITE = document.body.getAttribute('data-signin-site') === 'laps' ? 'laps' : 'main';
  // While Laps is an early preview (/laps/signin preview), joining on Laps puts the new member on the early access
  // list: the join card says so, and the welcome says they are on the list.
  var PREVIEW = false;
  if (SITE !== 'laps') { start(); return; }
  var started = false;
  function go() { if (!started) { started = true; start(); } }
  // Never hold the page up: with no answer in 3 seconds it carries on as the Laps sign-in.
  setTimeout(go, 3000);
  fetch('https://late-darkness-ebc8.modtesla3uk.workers.dev/laps/signin', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (started) return;
      if (d && d.success && d.separate === false) { started = true; location.replace('signin.html' + location.search + location.hash); return; }
      PREVIEW = !!(d && d.preview);
      go();
    }).catch(go);

  function start() {
    var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
    var SESSION_KEY = 'mt3ukMyBuildsSession';
    var EMAIL_KEY = 'mt3ukMyBuildsEmail';
    var FIRST_NAME_KEY = 'mt3ukMyBuildsFirstName';
    var LAST_EMAIL_KEY = 'mt3ukLastSignInEmail';
    var NEXT_KEY = 'mt3ukSignInNext';
    var JOIN_NAME_KEY = 'mt3ukJoinFirstName';

    function $(id) { return document.getElementById(id); }
    function read(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function setStatus(el, msg, kind) { el.textContent = msg; el.className = 'si-status' + (kind ? ' si-status-' + kind : ''); }

    var params = new URL(location.href).searchParams;
    var next = params.get('next');
    if (next && /^\/(?!\/)/.test(next)) write(NEXT_KEY, JSON.stringify({ url: next, at: Date.now() }));
    // The page to come back to, sent with a Laps request so the emailed link brings the member back to it.
    function pendingNext() {
      try { var p = JSON.parse(read(NEXT_KEY) || 'null'); return p && Date.now() - p.at < 3600000 ? p.url : ''; } catch (e) { return ''; }
    }
    function from() { return SITE === 'laps' ? { site: 'laps', next: pendingNext() } : {}; }
    function goToPendingNext() {
      try {
        var pending = JSON.parse(read(NEXT_KEY) || 'null');
        localStorage.removeItem(NEXT_KEY);
        if (pending && Date.now() - pending.at < 3600000 && /^\/(?!\/)/.test(pending.url)) {
          location.replace(pending.url);
          return true;
        }
      } catch (e) {}
      return false;
    }

    function signedIn(session, email, joined) {
      write(SESSION_KEY, session);
      write(EMAIL_KEY, email);
      var joinName = read(JOIN_NAME_KEY);
      // New members are not asked for a nickname: the worker gives them one from their name (first initial and last
      // name), which they can change in their Profile.
      if (joinName && !read(FIRST_NAME_KEY)) write(FIRST_NAME_KEY, joinName);
      try { localStorage.removeItem(JOIN_NAME_KEY); } catch (e) {}
      if (goToPendingNext()) return;
      showSignedIn();
      if (window.mt3ukAskNickname) window.mt3ukAskNickname();
      // In the app, ask about notifications now (js/account-bar.js).
      if (window.mt3ukAutoPush) window.mt3ukAutoPush();
    }

    // Offer a passkey after signing in with a code, on this device, once.
    var PK = window.mt3ukPasskeys;
    function offerPasskey() {
      var off = false;
      try { off = localStorage.getItem('mt3ukPasskeyOfferOff') === '1'; } catch (e) {}
      $('si-passkey-offer').hidden = !(PK && PK.supported() && !PK.hasOnThisDevice() && !off);
    }
    // Not used a passkey in this browser yet: show how to set one up, as
    // the button alone brings up the phone's "No passkeys" message.
    function explainPasskey() {
      $('si-passkey-how').open = true;
      $('si-passkey-note').textContent = 'Not set up a passkey yet? Sign in with an email code first, then you\u2019ll be offered one.';
    }
    if (PK && PK.supported()) {
      $('si-passkey').hidden = false;
      if (!PK.hasOnThisDevice()) explainPasskey();
    }
    // New here? comes first; Already a member? Sign in at the foot of it jumps to the sign-in card.
    $('si-to-signin').addEventListener('click', function (e) {
      e.preventDefault();
      $('si-signin').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('si-signin-email').focus({ preventScroll: true });
    });
    // Offer the passkey when the email box is tapped (keyboard bar or the
    // box's suggestions), for visitors who aren't signed in.
    if (PK && PK.supported() && !read(SESSION_KEY)) {
      PK.autofill(function (data) { signedIn(data.session, data.email); });
    }
    $('si-passkey-btn').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      setStatus($('si-passkey-status'), 'Waiting for your passkey…', '');
      PK.signIn().then(function (data) {
        btn.disabled = false;
        setStatus($('si-passkey-status'), '', '');
        signedIn(data.session, data.email);
      }).catch(function (err) {
        btn.disabled = false;
        if (!PK.hasOnThisDevice()) {
          explainPasskey();
          setStatus($('si-passkey-status'), 'No MT3UK passkey on this device yet. Sign in with an email code first, then tap Set up a passkey.', 'err');
        } else {
          setStatus($('si-passkey-status'), err.message + ' You can sign in with an email code instead.', 'err');
        }
      });
    });
    $('si-passkey-add').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      setStatus($('si-passkey-add-status'), 'Follow the prompt on your device…', '');
      PK.register(read(SESSION_KEY)).then(function () {
        btn.disabled = false;
        setStatus($('si-passkey-add-status'), 'Done. Next time tap Sign in with a passkey. You can manage passkeys in your Profile.', 'ok');
        btn.hidden = true;
        $('si-passkey-later').hidden = true;
      }).catch(function (err) {
        btn.disabled = false;
        setStatus($('si-passkey-add-status'), err.message, 'err');
      });
    });
    $('si-passkey-later').addEventListener('click', function () {
      try { localStorage.setItem('mt3ukPasskeyOfferOff', '1'); } catch (e) {}
      $('si-passkey-offer').hidden = true;
    });

    function welcomeText(access) {
      if (SITE !== 'laps') return 'Welcome to MT3UK! You’re in.';
      return access === 'pending' ? 'Welcome to Laps! You’re on the early access list, and we’ll email you as soon as you’re in.' : 'Welcome to Laps! You’re in.';
    }
    // The Laps join card while Laps is an early preview.
    if (SITE === 'laps' && PREVIEW && $('si-join')) {
      $('si-join').querySelector('h2').textContent = 'New to Laps? Join the early preview';
      $('si-join').querySelector('h2 + p').textContent = 'Laps is in early preview. Join with your name and email, and we’ll put you on the early access list straight away and email you as soon as you’re in.';
      $('si-join-btn').textContent = 'Join the early preview';
    }
    var JOIN_LABEL = $('si-join-btn').textContent;

    function showSignedIn() {
      offerPasskey();
      $('si-forms').hidden = true;
      $('si-code-form').hidden = true;
      $('si-signed-in').hidden = false;
      var first = read(FIRST_NAME_KEY);
      var email = read(EMAIL_KEY);
      var at = email.indexOf('@');
      var masked = at > 0 ? email.slice(0, Math.min(2, at)) + '\u2022\u2022\u2022' + email.slice(at) : '';
      $('si-signed-in-text').textContent = 'Signed in as ' + (first || masked || 'a member') + (first && masked ? ' (' + masked + ')' : '') +
        (SITE === 'laps' ? '. You can add your track sessions and see the leaderboards.' : '. You can now like and comment on builds and interviews.');
    }

    function showCode(email) {
      $('si-code-email').value = email || $('si-code-email').value;
      $('si-code-form').hidden = false;
      $('si-code').focus();
    }

    $('si-signout').addEventListener('click', function () {
      if (window.mt3ukSignOut) { window.mt3ukSignOut(); return; }
      [SESSION_KEY, EMAIL_KEY, FIRST_NAME_KEY].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      location.reload();
    });

    var lastEmail = read(LAST_EMAIL_KEY) || read(EMAIL_KEY);
    if (lastEmail) { $('si-signin-email').value = lastEmail; $('si-code-email').value = lastEmail; }

    function post(path, body) {
      return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); });
    }

    $('si-join-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var email = f.elements.email.value.trim();
      var btn = $('si-join-btn');
      btn.disabled = true; btn.textContent = 'Sending…';
      setStatus($('si-join-status'), '', '');
      write(LAST_EMAIL_KEY, email);
      write(JOIN_NAME_KEY, f.elements.firstName.value.trim());
      post('/my-builds/join', Object.assign({
        firstName: f.elements.firstName.value, lastName: f.elements.lastName.value, email: email, botcheck: f.elements.botcheck.checked
      }, from())).then(function (r) {
        btn.disabled = false; btn.textContent = JOIN_LABEL;
        if (!r.ok || !r.data.success) { setStatus($('si-join-status'), r.data.message || 'Something went wrong, please try again.', 'err'); return; }
        setStatus($('si-join-status'), r.data.message, 'ok');
        showCode(email);
      }).catch(function () {
        btn.disabled = false; btn.textContent = JOIN_LABEL;
        setStatus($('si-join-status'), 'Something went wrong, please try again.', 'err');
      });
    });

    $('si-signin-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = e.target.elements.email.value.trim();
      var btn = $('si-signin-btn');
      btn.disabled = true; btn.textContent = 'Sending…';
      setStatus($('si-signin-status'), '', '');
      write(LAST_EMAIL_KEY, email);
      post('/my-builds/request-link', Object.assign({ email: email }, from())).then(function (r) {
        btn.disabled = false; btn.textContent = 'Send me a sign-in link';
        if (!r.ok || !r.data.success) { setStatus($('si-signin-status'), r.data.message || 'Something went wrong, please try again.', 'err'); return; }
        setStatus($('si-signin-status'), r.data.message, 'ok');
        showCode(email);
      }).catch(function () {
        btn.disabled = false; btn.textContent = 'Send me a sign-in link';
        setStatus($('si-signin-status'), 'Something went wrong, please try again.', 'err');
      });
    });

    $('si-code-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('si-code-email').value.trim();
      var code = $('si-code').value.replace(/\D/g, '');
      if (code.length !== 6) { setStatus($('si-code-status'), 'The code is 6 digits.', 'err'); return; }
      var btn = $('si-code-btn');
      btn.disabled = true;
      setStatus($('si-code-status'), 'Signing you in…', '');
      post('/my-builds/verify-code', { email: email, code: code }).then(function (r) {
        btn.disabled = false;
        if (!r.data.success) { setStatus($('si-code-status'), r.data.message || 'That code did not work.', 'err'); return; }
        setStatus($('si-code-status'), '', '');
        if (r.data.joined) { $('si-welcome').hidden = false; $('si-welcome').textContent = welcomeText(r.data.access); }
        signedIn(r.data.session, r.data.email, !!r.data.joined);
      }).catch(function () {
        btn.disabled = false;
        setStatus($('si-code-status'), 'Something went wrong, please try again.', 'err');
      });
    });

    // The Home Screen app can't be signed in by the email link, so it always offers the code.
    if ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true) {
      $('si-code-form').hidden = false;
    }

    var token = params.get('token');
    if (token) {
      history.replaceState(null, '', location.pathname);
      $('si-welcome').hidden = false;
      $('si-welcome').textContent = 'Signing you in…';
      fetch(API + '/my-builds/session?token=' + encodeURIComponent(token))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.success) {
            // A new account says welcome; a member signing in with a link (from Laps) is just signed in.
            var joined = data.joined !== undefined ? !!data.joined : true;
            $('si-welcome').textContent = joined ? welcomeText(data.access) : 'You’re signed in.';
            signedIn(data.session, data.email, joined);
          } else {
            $('si-welcome').textContent = (data.message || 'That link is invalid or has expired.') + ' Sign in below to get a new one.';
            $('si-welcome').classList.add('si-welcome-err');
          }
        })
        .catch(function () {
          $('si-welcome').textContent = 'Something went wrong, please try again.';
          $('si-welcome').classList.add('si-welcome-err');
        });
    } else if (read(SESSION_KEY)) {
      showSignedIn();
    }
  }
})();
