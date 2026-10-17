/*
  The admin key, asked for in a box that hides what is typed (the browser's own prompt shows it in plain text).
  MT3UKWithAdminKey(message, go) calls go(key) with the key saved in this browser session, or asks for it first and
  saves it when one is given. go('') when the box is cancelled, so the caller can say nothing was saved.
  Used by the layout and look editors on the public pages (layout-edit.js, site-look.js and home-layout.js).
*/
(function () {
  function askKey(message) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', 'Admin key');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(10,16,30,.45);padding:16px';
      wrap.innerHTML = '<form style="background:#fff;color:#16233d;border-radius:10px;padding:16px;width:min(360px,100%);font:15px/1.45 system-ui,sans-serif">' +
        '<p style="margin:0 0 10px"></p>' +
        '<input type="password" autocomplete="off" aria-label="Admin key" style="width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:1px solid #9aa1b2;border-radius:8px">' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
        '<button type="button" data-cancel style="padding:9px 14px;border-radius:999px;border:1px solid #9aa1b2;background:#fff;color:#16233d;font:600 14px system-ui,sans-serif">Cancel</button>' +
        '<button type="submit" style="padding:9px 14px;border-radius:999px;border:0;background:#16233d;color:#fff;font:600 14px system-ui,sans-serif">Save</button>' +
        '</div></form>';
      wrap.querySelector('p').textContent = message;
      document.body.appendChild(wrap);
      var input = wrap.querySelector('input');
      function done(value) { wrap.remove(); resolve(value); }
      wrap.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); done(input.value.trim()); });
      wrap.querySelector('[data-cancel]').addEventListener('click', function () { done(''); });
      input.focus();
    });
  }
  window.MT3UKWithAdminKey = function (message, go) {
    var saved = (sessionStorage.getItem('mt3ukAdminKey') || '').trim();
    if (saved) { go(saved); return; }
    askKey(message).then(function (key) {
      if (key) sessionStorage.setItem('mt3ukAdminKey', key);
      go(key);
    });
  };
})();
