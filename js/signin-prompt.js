/*
  Sign-in prompt for member-only buttons (photo likes, comment likes and
  comment reports). Call window.mt3ukRequireSignIn('like photos') before the
  action: it returns true when a My Garage session is saved on this device,
  otherwise it shows a small dialog offering Join free / Sign in and
  returns false. After signing in, My Garage sends the member back to the
  page they were on (see the ?next= handling in my-builds.html).

  window.mt3ukShowSignIn('like photos') shows the dialog on its own, for
  when the worker answers that the sign-in has expired.
*/
(function () {
  if (window.mt3ukRequireSignIn) return;

  var SESSION_KEY = 'mt3ukMyBuildsSession';
  var styled = false;

  function addStyles() {
    if (styled) return;
    styled = true;
    var css = [
      '.mt3uk-signin-backdrop{position:fixed;inset:0;z-index:2147482000;background:rgba(14,22,40,.55);',
      '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.mt3uk-signin-box{background:#f3f1ea;color:#16233d;max-width:380px;width:100%;padding:22px 20px 18px;',
      'border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.35);font-family:inherit}',
      '.mt3uk-signin-box h2{margin:0 0 8px;font-size:1.15rem;line-height:1.3}',
      '.mt3uk-signin-box p{margin:0 0 16px;font-size:.92rem;line-height:1.5;color:#3d4a61}',
      '.mt3uk-signin-actions{display:flex;flex-direction:column;gap:8px}',
      '.mt3uk-signin-actions a,.mt3uk-signin-actions button{display:flex;align-items:center;justify-content:center;min-height:44px;',
      'padding:10px 16px;font-family:"IBM Plex Sans",sans-serif;font-size:.93rem;font-weight:600;',
      'text-decoration:none;cursor:pointer;border:1px solid rgba(22,35,61,.28);border-radius:10px;background:#fff;color:#16233d}',
      '.mt3uk-signin-actions a.mt3uk-signin-primary{background:#e8542a;border-color:#e8542a;color:#fff}',
      '.mt3uk-signin-actions button{border-color:transparent;background:transparent;color:#6b7689}'
    ].join('');
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function hasSession() {
    try { return !!localStorage.getItem(SESSION_KEY); } catch (e) { return false; }
  }

  function close(backdrop, lastFocus) {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    document.removeEventListener('keydown', backdrop._onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function show(action) {
    addStyles();
    var existing = document.querySelector('.mt3uk-signin-backdrop');
    if (existing) existing.parentNode.removeChild(existing);

    var next = encodeURIComponent(location.pathname + location.search + location.hash);
    var lastFocus = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'mt3uk-signin-backdrop';
    backdrop.innerHTML =
      '<div class="mt3uk-signin-box" role="dialog" aria-modal="true" aria-labelledby="mt3uk-signin-title">' +
        '<h2 id="mt3uk-signin-title">Join free or sign in to ' + String(action || 'do that').replace(/[<>&"]/g, '') + '</h2>' +
        '<p>' + (/report/.test(action || '')
          ? 'Reporting is for MT3UK members, so reports come from real people.'
          : /vote/.test(action || '')
          ? 'Voting is for MT3UK members, one vote each a week, so every vote is a real person.'
          : /comment|message/.test(action || '')
          ? 'Comments are for MT3UK members, so everyone knows who they&rsquo;re talking to.'
          : 'Likes are for MT3UK members, so owners can see who liked their build.') +
          ' Joining is free and just needs your name and email. Adding your car is optional.</p>' +
        '<div class="mt3uk-signin-actions">' +
          '<a class="mt3uk-signin-primary" href="/signin.html?next=' + next + '">Sign Up / Sign In</a>' +
          '<button type="button" class="mt3uk-signin-close">Not now</button>' +
        '</div>' +
      '</div>';
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop || e.target.closest('.mt3uk-signin-close')) close(backdrop, lastFocus);
    });
    backdrop._onKey = function (e) { if (e.key === 'Escape') close(backdrop, lastFocus); };
    document.addEventListener('keydown', backdrop._onKey);
    document.body.appendChild(backdrop);
    backdrop.querySelector('.mt3uk-signin-primary').focus();
  }

  window.mt3ukShowSignIn = show;
  window.mt3ukRequireSignIn = function (action) {
    if (hasSession()) return true;
    show(action);
    return false;
  };
})();
