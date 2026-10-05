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
})();
