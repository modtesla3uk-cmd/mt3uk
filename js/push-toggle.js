/*
  Phone notifications (Web Push).

  window.mt3ukPushCard(card, { api, session, setStatus }) wires up the
  on/off control in Profile (under Visibility): .push-intro, .push-toggle,
  .push-test and .push-status. Each device is turned on separately. iPhones
  only allow notifications once MT3UK is added to the Home Screen and opened
  from there.

  window.mt3ukPushAuto({ api, session }) runs in the installed app (from
  js/account-bar.js): notifications switch on by themselves when the phone
  already allows them, otherwise the member is asked once with a Turn on
  button (browsers need a tap before asking). Turning them off in Profile
  stops this.
*/
(function () {
  var OFF_KEY = 'mt3ukPushOff';
  var ASKED_KEY = 'mt3ukPushAsked';
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }

  function keyBytes(b64url) {
    var s = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function swRegistration() {
    return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; });
  }

  function currentSubscription() {
    return swRegistration().then(function (reg) { return reg.pushManager.getSubscription(); });
  }

  // Asks for permission if needed (call from a tap), subscribes this device
  // and tells the worker.
  function subscribe(opts) {
    return Notification.requestPermission().then(function (permission) {
      if (permission !== 'granted') throw new Error('Notifications were not allowed.');
      return Promise.all([
        swRegistration(),
        fetch(opts.api + '/push/key').then(function (res) { return res.json(); })
      ]);
    }).then(function (results) {
      return results[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(results[1].publicKey) });
    }).then(function (sub) {
      return fetch(opts.api + '/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': opts.session() },
        body: JSON.stringify({ subscription: sub.toJSON() })
      }).then(function (res) { return res.json(); });
    }).then(function (data) {
      if (!data || !data.success) throw new Error((data && data.message) || 'Could not turn notifications on.');
      write(OFF_KEY, '');
    });
  }

  function unsubscribe(opts) {
    return currentSubscription().then(function (sub) {
      write(OFF_KEY, '1');
      if (!sub) return null;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return fetch(opts.api + '/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': opts.session() },
          body: JSON.stringify({ endpoint: endpoint })
        });
      });
    });
  }

  window.mt3ukPushCard = function (card, opts) {
    var intro = card.querySelector('.push-intro');
    var toggle = card.querySelector('.push-toggle');
    var test = card.querySelector('.push-test');
    var statusEl = card.querySelector('.push-status');
    function status(msg, kind) { opts.setStatus(statusEl, msg, kind); }

    function showState(subscribed) {
      toggle.hidden = false;
      toggle.textContent = subscribed ? 'Turn off notifications' : 'Turn on notifications';
      toggle.dataset.on = subscribed ? '1' : '';
      test.hidden = !subscribed;
    }

    var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    var inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|WhatsApp/i.test(navigator.userAgent);
    if (!supported()) {
      if (isIos && inAppBrowser) {
        intro.textContent = 'You are viewing MT3UK inside another app. Open mt3uk.com in Safari, tap the Share button, then Add to Home Screen. Open MT3UK from your Home Screen and sign in with the 6-digit code from your sign-in email: notifications then switch on.';
      } else if (isIos && !installed) {
        intro.textContent = 'On iPhone, notifications only work in the MT3UK app on your Home Screen. Install it with The MT3UK app card, open MT3UK from your Home Screen and sign in with the 6-digit code from your sign-in email: notifications then switch on.';
      } else if (isIos) {
        intro.textContent = 'Notifications need iOS 16.4 or later. Update your iPhone in Settings, General, Software Update, then come back here.';
      } else {
        intro.textContent = 'This browser does not support notifications. Try Chrome on Android, or add MT3UK to your Home Screen on iPhone.';
      }
      return;
    }
    if (Notification.permission === 'denied') {
      intro.textContent = 'Notifications are blocked for MT3UK on this device. Allow them in your phone or browser settings, then reload this page.';
      return;
    }
    currentSubscription()
      .then(function (sub) { showState(!!sub); })
      .catch(function () { showState(false); });

    toggle.addEventListener('click', function () {
      toggle.disabled = true;
      var on = !!toggle.dataset.on;
      status(on ? 'Turning off…' : 'Turning on…');
      (on ? unsubscribe(opts) : subscribe(opts))
        .then(function () {
          showState(!on);
          if (on) status('Notifications are off for this device. The app won’t turn them back on unless you do.');
          else status('Notifications are on for this device. Comment emails are now off.', 'ok');
        })
        .catch(function (err) { status(err.message || 'Something went wrong, please try again.', 'err'); })
        .then(function () { toggle.disabled = false; });
    });

    test.addEventListener('click', function () {
      test.disabled = true;
      status('Sending…');
      fetch(opts.api + '/push/test', { method: 'POST', headers: { 'X-Session-Token': opts.session() } })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.success && data.sent) status('Test sent, it should arrive in a few seconds.', 'ok');
          else status('Could not reach this device. Try turning notifications off and on again.', 'err');
        })
        .catch(function () { status('Could not send a test, please try again.', 'err'); })
        .then(function () { test.disabled = false; });
    });
  };

  // The one-off "Turn on notifications?" message in the app.
  function ask(opts) {
    if (document.getElementById('mt3uk-push-ask')) return;
    var style = document.createElement('style');
    style.textContent =
      '#mt3uk-push-ask{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:390;max-width:460px;margin:0 auto;background:#16233d;color:#fff;border-left:4px solid #1c8a4b;padding:16px 18px;box-shadow:0 12px 32px rgba(0,0,0,.35);font-family:"IBM Plex Sans",sans-serif}' +
      '#mt3uk-push-ask p{margin:0 0 12px;font-size:.92rem;line-height:1.45}' +
      '#mt3uk-push-ask .mt3uk-push-title{font-weight:700;font-size:1rem;margin-bottom:4px}' +
      '#mt3uk-push-ask .mt3uk-push-row{display:flex;gap:10px;flex-wrap:wrap}' +
      '#mt3uk-push-ask button{min-height:44px;padding:10px 16px;border:1px solid #fff;background:transparent;color:#fff;font:inherit;font-weight:600;cursor:pointer}' +
      '#mt3uk-push-ask .mt3uk-push-on{background:#1c8a4b;border-color:#1c8a4b}' +
      '#mt3uk-push-ask .mt3uk-push-msg{margin:10px 0 0;font-size:.86rem}' +
      '#mt3uk-push-ask .mt3uk-push-msg:empty{display:none}';
    document.head.appendChild(style);
    var box = document.createElement('div');
    box.id = 'mt3uk-push-ask';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-labelledby', 'mt3uk-push-title');
    box.innerHTML =
      '<p class="mt3uk-push-title" id="mt3uk-push-title">Turn on notifications?</p>' +
      '<p>Get an alert when someone likes or comments on your build, or messages you. You can turn them off any time in Profile, under Visibility.</p>' +
      '<div class="mt3uk-push-row"><button type="button" class="mt3uk-push-on">Turn on</button><button type="button" class="mt3uk-push-later">Not now</button></div>' +
      '<p class="mt3uk-push-msg" role="status"></p>';
    document.body.appendChild(box);
    var msg = box.querySelector('.mt3uk-push-msg');
    box.querySelector('.mt3uk-push-later').addEventListener('click', function () {
      write(ASKED_KEY, '1');
      box.remove();
    });
    box.querySelector('.mt3uk-push-on').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      write(ASKED_KEY, '1');
      subscribe(opts).then(function () {
        msg.textContent = 'Notifications are on.';
        setTimeout(function () { box.remove(); }, 1500);
      }).catch(function (err) {
        btn.disabled = false;
        msg.textContent = (err && err.message) || 'Could not turn notifications on.';
      });
    });
  }

  window.mt3ukPushAuto = function (opts) {
    if (!supported() || read(OFF_KEY) === '1' || Notification.permission === 'denied') return;
    currentSubscription().then(function (sub) {
      if (sub) return;
      if (Notification.permission === 'granted') return subscribe(opts);
      if (read(ASKED_KEY) !== '1') ask(opts);
    }).catch(function () {});
  };
})();
