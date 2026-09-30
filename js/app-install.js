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
  var MONTH = 30 * 24 * 60 * 60 * 1000;
  var isIosUa = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Remembered with the time it was last known; on iPhone it only counts
  // for 30 days, as deleting an app can't be seen (same as the homepage).
  function remember(when) { try { localStorage.setItem(KEY, String(when || Date.now())); } catch (e) {} }
  function installedHere() {
    var v = read(KEY);
    if (!v) return false;
    if (v === '1') return !isIosUa;
    return Date.now() - Number(v) < MONTH;
  }

  var installPrompt = null;
  var onPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    if (onPrompt) onPrompt();
  });

  // opts.apps: which kinds of device the member has the app on, as the app
  // reported to the worker ({ ios, android, desktop }: when last opened).
  // opts.forget(platform): tell the worker it isn't installed any more.
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
    // iPhone: Install the app opens and closes the steps, like a drop-down.
    var iosDropDown = isIos && !inApp;
    var INSTALL_LABEL = iosDropDown ? 'Install the app <span aria-hidden="true">\u25BE</span>' : 'Install the app';
    btn.innerHTML = INSTALL_LABEL;
    if (iosDropDown) btn.setAttribute('aria-expanded', 'false');
    var original = text.textContent;
    var gone = document.createElement('button');
    gone.type = 'button';
    gone.className = 'app-gone';
    gone.textContent = 'Deleted the app? Install it again';
    gone.hidden = true;
    btn.insertAdjacentElement('afterend', gone);
    function notInstalled() {
      var was = !!read(KEY);
      try { localStorage.removeItem(KEY); } catch (e) {}
      if (was && opts && opts.forget) opts.forget(platform);
      mode = 'install';
      card.classList.remove('is-installed');
      text.textContent = original;
      btn.innerHTML = INSTALL_LABEL;
      steps.hidden = true;
      btn.hidden = false;
      btn.disabled = false;
      gone.hidden = true;
    }
    gone.addEventListener('click', notInstalled);
    function installed(when) {
      remember(when);
      mode = 'open';
      gone.hidden = false;
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
    var reported = Date.parse(apps[platform] || '') || 0;
    function known() {
      if (installedHere()) installed();
      else if (reported && Date.now() - reported < MONTH) installed(reported);
    }
    // Android browsers can confirm it's installed. A "no" isn't reliable (a
    // home screen shortcut isn't reported), so that falls back to what's known;
    // a deleted app shows up as the browser offering to install (onPrompt).
    if (isAndroid && navigator.getInstalledRelatedApps) {
      navigator.getInstalledRelatedApps()
        .then(function (list) { if (list && list.length) installed(); else known(); })
        .catch(known);
    } else {
      known();
      if (navigator.getInstalledRelatedApps) {
        navigator.getInstalledRelatedApps().then(function (list) { if (list && list.length) installed(); }).catch(function () {});
      }
    }
    // The browser only offers to install when the app isn't installed.
    onPrompt = function () { if (mode === 'open') notInstalled(); };
    if (installPrompt) onPrompt();
    window.addEventListener('appinstalled', function () { installed(); });

    function showSteps(html) {
      steps.innerHTML = html + '<button type="button" class="app-done">I’ve installed it</button>';
      steps.hidden = false;
      if (iosDropDown) { btn.innerHTML = INSTALL_LABEL.replace('\u25BE', '\u25B4'); btn.setAttribute('aria-expanded', 'true'); }
      steps.querySelector('.app-done').addEventListener('click', function () { installed(); });
    }

    btn.addEventListener('click', function () {
      if (mode === 'install' && iosDropDown && !steps.hidden) {
        steps.hidden = true;
        btn.innerHTML = INSTALL_LABEL;
        btn.setAttribute('aria-expanded', 'false');
        return;
      }
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
        showSteps(window.mt3ukIosInstallSteps());
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
