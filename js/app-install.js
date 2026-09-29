/*
  "The MT3UK app" card in Profile: the same rules as the homepage row.

  window.mt3ukAppCard(card) wires up a card holding .app-text, .app-btn and
  .app-steps. Installs straight away where the browser offers it (Chrome and
  Edge), otherwise shows the steps for that browser. Once installed it says
  so, and on Android offers Open the app (an intent link to the installed
  app). Hidden inside the app itself.
*/
(function () {
  var KEY = 'mt3ukAppInstalled';
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function remember() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }

  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
  });

  // opts.apps: which kinds of device the member has the app on, as the app
  // reported to the worker ({ ios, android, desktop }).
  window.mt3ukAppCard = function (card, opts) {
    var text = card.querySelector('.app-text');
    var btn = card.querySelector('.app-btn');
    var steps = card.querySelector('.app-steps');
    var ua = navigator.userAgent;
    var isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/i.test(ua);
    var inApp = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Twitter|Snapchat|TikTok/i.test(ua);
    var isMac = /Macintosh/.test(ua) && !isIos;
    var isSamsung = /SamsungBrowser/.test(ua);
    var isFirefox = /Firefox\//.test(ua);
    var isChrome = /Chrome\//.test(ua) && !/EdgA?\/|SamsungBrowser|OPR\/|Firefox|FxiOS|CriOS/.test(ua);
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches) ||
      navigator.standalone === true || document.referrer.indexOf('android-app://') === 0;
    if (standalone) { remember(); card.hidden = true; return; }
    card.hidden = false;

    var mode = 'install';
    function installed() {
      remember();
      mode = 'open';
      card.classList.add('is-installed');
      steps.hidden = true;
      text.textContent = isIos
        ? 'You have the MT3UK app. Open it from its icon on your Home Screen: it opens full screen, keeps you signed in and can send you alerts.'
        : isAndroid
          ? 'You have the MT3UK app. Tap Open the app, or find it in your apps (swipe up for the app list if it isn\u2019t on your home screen).'
          : 'You have the MT3UK app. Open it from your apps' + (isChrome ? ', or in Chrome tap \u22EE then Open in app' : '') + '.';
      btn.textContent = 'Open the app';
      btn.hidden = !isAndroid;
      btn.disabled = false;
    }
    var platform = isIos ? 'ios' : isAndroid ? 'android' : 'desktop';
    var apps = (opts && opts.apps) || {};
    if (read(KEY) === '1' || apps[platform]) installed();
    else if (navigator.getInstalledRelatedApps) {
      navigator.getInstalledRelatedApps().then(function (apps) { if (apps && apps.length) installed(); }).catch(function () {});
    }
    window.addEventListener('appinstalled', installed);

    function showSteps(html) {
      steps.innerHTML = html + '<button type="button" class="app-done">I’ve installed it</button>';
      steps.hidden = false;
      steps.querySelector('.app-done').addEventListener('click', installed);
    }

    btn.addEventListener('click', function () {
      if (mode === 'open') {
        // Android opens this page in the app that handles mt3uk.com.
        location.href = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;action=android.intent.action.VIEW;' +
          'S.browser_fallback_url=' + encodeURIComponent(location.origin + location.pathname) + ';end';
        setTimeout(function () {
          if (document.hidden) return;
          btn.textContent = 'Find MT3UK in your apps';
          btn.disabled = true;
        }, 2000);
        return;
      }
      if (installPrompt) {
        var prompt = installPrompt;
        installPrompt = null;
        try {
          prompt.prompt();
          prompt.userChoice.then(function (choice) {
            if (choice && choice.outcome === 'accepted') installed();
          }).catch(function () {});
          return;
        } catch (e) {}
      }
      if (inApp) {
        showSteps('<strong>Open MT3UK in your browser first.</strong> Apps like Facebook and Instagram open links in their own browser, which can’t install apps.<ol>' +
          '<li>Tap the <strong>•••</strong> menu (top or bottom corner).</li>' +
          '<li>Choose <strong>Open in browser</strong> (or <strong>Open in Safari</strong> on iPhone).</li>' +
          '<li>Tap <strong>Install the app</strong> again there.</li></ol>');
        return;
      }
      if (isIos) {
        showSteps('<strong>On iPhone or iPad:</strong><ol>' +
          '<li>Tap the <strong>Share</strong> button (the square with an arrow), in Safari’s toolbar or Chrome’s address bar.</li>' +
          '<li>Scroll down and choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>' +
          '<li>Open MT3UK from your Home Screen and sign in with the 6-digit code from the sign-in email (the app keeps its own sign-in).</li>' +
          '<li>For alerts, turn on notifications here in Profile.</li></ol>');
        return;
      }
      if (isSamsung) {
        showSteps('<strong>In Samsung Internet:</strong><ol>' +
          '<li>Tap the menu (the three lines at the bottom).</li>' +
          '<li>Choose <strong>Add page to</strong>, then <strong>Home screen</strong>.</li>' +
          '<li>Open MT3UK from your home screen. For alerts, turn on notifications here in Profile.</li></ol>');
        return;
      }
      if (isMac && /Safari\//.test(ua) && !/Chrome|Edg\//.test(ua)) {
        showSteps('<strong>In Safari on a Mac:</strong><ol><li>Choose <strong>File</strong>, then <strong>Add to Dock</strong>.</li></ol>');
        return;
      }
      showSteps('<strong>To install:</strong><ol>' +
        '<li>Open your browser menu (the three dots' + (isFirefox ? ' at the top' : '') + ').</li>' +
        '<li>Choose <strong>Install app</strong>' + (isFirefox ? '' : ' or <strong>Add to Home screen</strong>') + '. On a computer, look for the install icon at the end of the address bar.</li>' +
        '<li>Open MT3UK from your apps. For alerts, turn on notifications here in Profile.</li></ol>');
    });
  };
})();
