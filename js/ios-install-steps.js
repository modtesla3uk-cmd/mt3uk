/*
  Steps for installing MT3UK as a web app on iPhone or iPad, shown in the
  Install the app drop-down on the homepage and in Profile. Safari gets its
  own wording; Chrome, Edge, Firefox and Opera on iPhone (which say CriOS,
  EdgiOS, FxiOS or OPiOS) get theirs, with Safari as the fallback.
*/
(function () {
  window.mt3ukIosInstallSteps = function () {
    var ua = navigator.userAgent;
    var device = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : 'iPhone';
    var browser = /CriOS/.test(ua) ? 'Chrome' : /EdgiOS/.test(ua) ? 'Edge' : /FxiOS/.test(ua) ? 'Firefox' : /OPiOS/.test(ua) ? 'Opera' : 'Safari';
    var safari = browser === 'Safari';
    return '<strong>Install MT3UK on your ' + device + (safari ? '' : ' (in ' + browser + ')') + ':</strong><ol>' +
      '<li>Tap the <strong>Share</strong> button (the square with an upward arrow)' +
        (safari ? ' in Safari’s toolbar. On some layouts, tap ⋯ or the address bar first.' : ' in ' + browser + '’s address bar. If you can’t see it, tap ⋯ or the address bar first.') + '</li>' +
      '<li>Scroll down the list and tap <strong>Add to Home Screen</strong>. If it isn’t there, scroll to the bottom, tap <strong>Edit Actions</strong> and add it.' +
        (safari ? '' : ' If ' + browser + ' doesn’t offer it, open mt3uk.com in Safari and follow these steps there.') + '</li>' +
      '<li>Type a name, or leave it as <strong>MT3UK</strong>.</li>' +
      '<li>Make sure <strong>Open as Web App</strong> is turned on (green), if you see it. This hides the ' + browser + ' toolbar so MT3UK runs like a real app.</li>' +
      '<li>Tap <strong>Add</strong> in the top right corner.</li>' +
      '<li>Open MT3UK from your Home Screen and sign in with the 6-digit code from your sign-in email (the app keeps its own sign-in). Notifications then switch on.</li>' +
      '</ol>';
  };
})();
