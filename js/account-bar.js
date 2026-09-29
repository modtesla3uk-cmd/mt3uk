/*
  Account links shared by every public page.

  - The orange "Sign Up / Sign In" menu button is for visitors only, so it's
    hidden for signed-in members (My Garage is already in the menu).
  - Signed-in members get a slim "Signed in as <first name> · ri•••@example.com"
    bar under the header, with My Garage and Sign out. The homepage shows this
    in its hero box instead, and My Garage and Sign Up / Sign In have their
    own, so none of them get the bar.
  - window.mt3ukSignOut() signs out on this device and reloads the page.

  Uses only what's saved on the device (no worker call): the session, the
  email, and the first name My Garage and the homepage remember after loading
  the member's builds.
*/
(function () {
  var SESSION_KEY = 'mt3ukMyBuildsSession';
  var EMAIL_KEY = 'mt3ukMyBuildsEmail';
  var FIRST_NAME_KEY = 'mt3ukMyBuildsFirstName';

  function read(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function maskEmail(email) {
    var at = email.indexOf('@');
    if (at < 1) return '';
    return email.slice(0, Math.min(2, at)) + '•••' + email.slice(at);
  }

  window.mt3ukMaskEmail = maskEmail;

  window.mt3ukSignOut = function () {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(FIRST_NAME_KEY);
    } catch (e) {}
    window.location.reload();
  };

  var signedIn = !!read(SESSION_KEY);

  function run() {
    if (signedIn) {
      // The button's own CSS uses !important, so it's removed rather than hidden.
      document.querySelectorAll('.nav-link-mobile').forEach(function (link) { link.remove(); });
    }

    var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (!signedIn || page === '' || page === 'index.html' || page === 'my-builds.html' || page === 'signin.html') return;
    var header = document.querySelector('header');
    if (!header || document.getElementById('mt3uk-account-bar')) return;

    var style = document.createElement('style');
    style.textContent =
      '.mt3uk-account-bar{background:#16233d;color:#d3d8e2;font-family:"IBM Plex Sans",sans-serif;font-size:.84rem;line-height:1.4}' +
      '.mt3uk-account-bar-inner{max-width:var(--content-max,1000px);margin:0 auto;padding:7px 16px;display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap}' +
      '.mt3uk-account-bar p{margin:0;flex:1;min-width:0}' +
      '.mt3uk-account-bar strong{color:#fff;font-weight:600}' +
      '.mt3uk-account-bar .mt3uk-account-email{color:#b9c0cf;white-space:nowrap}' +
      '.mt3uk-account-bar a,.mt3uk-account-bar button{color:#fff;background:none;border:0;padding:4px 0;font:inherit;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px}' +
      '.mt3uk-account-bar .mt3uk-account-actions{display:flex;gap:14px}';
    document.head.appendChild(style);

    var first = read(FIRST_NAME_KEY);
    var masked = maskEmail(read(EMAIL_KEY));
    var bar = document.createElement('div');
    bar.className = 'mt3uk-account-bar';
    bar.id = 'mt3uk-account-bar';
    bar.innerHTML =
      '<div class="mt3uk-account-bar-inner">' +
        '<p>Signed in as ' + (first
          ? '<strong>' + esc(first) + '</strong>' + (masked ? ' <span class="mt3uk-account-email">&middot; ' + esc(masked) + '</span>' : '')
          : '<strong>' + esc(masked || 'a member') + '</strong>') + '</p>' +
        '<span class="mt3uk-account-actions">' + (page === 'profile.html' ? '' : '<a href="profile.html">Profile</a>') + '<a href="my-builds.html">My Garage</a>' +
        '<button type="button" class="mt3uk-account-signout">Sign out</button></span>' +
      '</div>';
    bar.querySelector('.mt3uk-account-signout').addEventListener('click', window.mt3ukSignOut);
    header.parentNode.insertBefore(bar, header.nextSibling);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
