/*
  admin.html and track-admin.html, loaded in the <head> before the pages' own scripts: when "Remember the key on
  this device" is on (js/admin-alerts.js), the kept key is put where the pages look for it, so the installed admin
  app opens ready without asking for the key each time.
*/
(function () {
  try {
    var kept = localStorage.getItem('mt3ukAdminKeyKept');
    if (kept && !sessionStorage.getItem('mt3ukAdminKey')) sessionStorage.setItem('mt3ukAdminKey', kept);
  } catch (e) { /* storage blocked: the key is asked for as usual */ }
  // Arriving from another address with a one-time handover code in the # (the sign-in and admin viewer token, see
  // js/admin-alerts.js): taken out of the address here, before the page reads its own # (a panel, #install), and
  // left for admin-alerts.js to redeem.
  var m = /^#mt3uk-handover=([a-f0-9]{64})(?::(.*))?$/.exec(location.hash);
  if (m) {
    window.MT3UK_HANDOVER_CODE = m[1];
    try { history.replaceState(history.state, '', location.pathname + location.search + (m[2] ? '#' + m[2] : '')); } catch (e) {}
  }
})();
