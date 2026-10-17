/*
  track-admin.html, Laps Pro panel: the PayPal IDs (client ID, plan ID, webhook ID). The worker keeps them in KV
  (paypal-settings) and reads them on each subscription. The client secret is never shown or saved here: it is a
  Cloudflare secret, and this panel only says whether it is set.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var form = document.getElementById('paypal-form');
  if (!form) return;
  var noteEl = document.getElementById('paypal-note'), secretEl = document.getElementById('paypal-secret');
  var fields = { clientId: document.getElementById('paypal-client'), planId: document.getElementById('paypal-plan'), webhookId: document.getElementById('paypal-webhook') };
  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function show(msg, kind) { noteEl.textContent = msg; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function read(r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); }
  function load() {
    fetch(API + '/laps/pro/paypal/admin?key=' + encodeURIComponent(key()), { cache: 'no-store' }).then(read).then(function (d) {
      if (!d.ok || !d.success) { show(d.message || 'Could not read the PayPal settings.', 'error'); return; }
      fields.clientId.value = d.clientId; fields.planId.value = d.planId; fields.webhookId.value = d.webhookId;
      secretEl.textContent = d.secretSet ? 'Client secret: set in Cloudflare.' : 'Client secret: not set. Add PAYPAL_CLIENT_SECRET in Cloudflare.';
    }).catch(function () { show('Could not reach the server.', 'error'); });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = { clientId: fields.clientId.value.trim(), planId: fields.planId.value.trim(), webhookId: fields.webhookId.value.trim() };
    fetch(API + '/laps/pro/paypal/admin?key=' + encodeURIComponent(key()), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
      .then(read).then(function (d) {
        if (!d.ok || !d.success) { show(d.message || 'Could not save the PayPal settings.', 'error'); return; }
        show(d.message);
        load();
      }).catch(function () { show('Could not reach the server.', 'error'); });
  });
  var wrap = document.getElementById('tiers-wrap');
  if (wrap) wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap && wrap.open) load(); });
})();
