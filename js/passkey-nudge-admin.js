/*
  admin.html, Passkey reminders panel (Members group): reminds every member
  who has no passkey yet to set one up, once each, through the worker's
  POST /admin/passkeys/nudge (admin key), a batch per call until the
  worker says there is no more (cursor). Count runs it with dry: true, so
  nothing is sent. The reminder is a bell notification linking to the Set
  up a passkey card in Profile, a push to their devices, and an email when
  Also send it by email is ticked.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('passkey-nudge-wrap');
  if (!wrap) return;
  var checkBtn = document.getElementById('pk-nudge-check'), sendBtn = document.getElementById('pk-nudge-send');
  var emailBox = document.getElementById('pk-nudge-email'), noteEl = document.getElementById('pk-nudge-note'), countEl = document.getElementById('pk-nudge-count');

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function call(body) {
    return fetch(API + '/admin/passkeys/nudge?key=' + encodeURIComponent(key()), { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  // One batch after another until the worker has been through every member.
  function run(dry, email, cursor, totals) {
    totals = totals || { sent: 0, already: 0, havePasskey: 0, emailed: 0 };
    note((dry ? 'Counting… ' : 'Sending… ') + plural(totals.sent, 'member') + ' so far');
    return call({ dry: dry, email: email, cursor: cursor || null }).then(function (data) {
      if (!data.success) { note(data.message === 'Unauthorized' ? 'The admin key is not right.' : (data.message || 'Stopped.'), 'error'); return; }
      totals.sent += data.sent || 0; totals.already += data.already || 0; totals.havePasskey += data.havePasskey || 0; totals.emailed += data.emailed || 0;
      if (data.cursor) return run(dry, email, data.cursor, totals);
      var rest = plural(totals.havePasskey, 'member') + ' already have a passkey' + (totals.already ? ', ' + totals.already + ' reminded before' : '') + '.';
      if (dry) {
        countEl.textContent = totals.sent ? '(' + totals.sent + ' without)' : '';
        note(totals.sent ? plural(totals.sent, 'member') + ' without a passkey would be reminded. ' + rest : 'Nobody to remind. ' + rest, 'ok');
      } else {
        countEl.textContent = '';
        note('Reminded ' + plural(totals.sent, 'member') + (email ? ', ' + totals.emailed + ' by email' : '') + '. ' + rest, 'ok');
      }
    }).catch(function () { note('Network error, please try again.', 'error'); });
  }
  function busy(on) { checkBtn.disabled = on; sendBtn.disabled = on; }

  checkBtn.addEventListener('click', function () {
    if (!key()) { note('Enter the admin key at the top of the page first.', 'error'); return; }
    busy(true);
    run(true, false).then(function () { busy(false); });
  });
  sendBtn.addEventListener('click', function () {
    if (!key()) { note('Enter the admin key at the top of the page first.', 'error'); return; }
    var email = emailBox.checked;
    if (!window.confirm('Remind every member without a passkey to set one up' + (email ? ', and email them' : '') + '?\n\nEach member is reminded once.')) return;
    busy(true);
    run(false, email).then(function () { busy(false); });
  });
})();
