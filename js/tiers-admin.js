/*
  track-admin.html, Free tier and Full access panel. The switch (off, testers only, everyone), the allowance (start,
  monthly top-up, cap), the testers, the members with Full access and Laps Pro. One KV key (track-tiers) kept by
  the worker (/track/tiers/admin). Nothing shows to members while the switch is off. Each list of members is found
  with the shared finder (js/member-finder.js): by nickname, name or email, with Show members and Close list.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var wrap = document.getElementById('tiers-wrap');
  if (!wrap) return;
  var noteEl = document.getElementById('tiers-note'), countEl = document.getElementById('tiers-count');
  var testersEl = document.getElementById('tiers-testers'), fullEl = document.getElementById('tiers-full');
  var reqEl = document.getElementById('tiers-requests'), paidEl = document.getElementById('tiers-paid');
  var trialsEl = document.getElementById('tiers-trials'), trialsCountEl = document.getElementById('tiers-trials-count');
  var state = null;
  // The Laps Pro subscriptions switch: On or Off, saved at once.
  Array.prototype.forEach.call(document.querySelectorAll('#tiers-subs-wrap [data-subs]'), function (b) {
    b.addEventListener('click', function () {
      var mode = b.getAttribute('data-subs');
      call('POST', { action: 'subscriptions', mode: mode }).then(function (d) {
        if (!d.ok || !d.success) { note(d.message || 'Could not change subscriptions.', 'error'); return; }
        state.subscriptions = d.subscriptions;
        draw();
        note(mode === 'all' ? 'Subscriptions are on for everyone.' : mode === 'testers' ? 'Subscriptions are on for testers only.' : 'Subscriptions are off.');
      });
    });
  });
  // The trial offer switch: On or Off, saved at once.
  Array.prototype.forEach.call(document.querySelectorAll('#tiers-trial-wrap [data-trial]'), function (b) {
    b.addEventListener('click', function () {
      var on = b.getAttribute('data-trial') === 'on';
      call('POST', { action: 'trial', on: on }).then(function (d) {
        if (!d.ok || !d.success) { note(d.message || 'Could not change the trial offer.', 'error'); return; }
        state.trialOpen = !!d.trialOpen;
        draw();
        note(on ? 'The trial offer is on: free members can start it.' : 'The trial offer is off.');
      });
    });
  });
  var MODE_WORDS = { off: 'Off', testers: 'Testers only', all: 'Everyone' };

  function key() {
    var input = document.getElementById('admin-key');
    return (input && input.value.trim()) || sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(t, kind) { noteEl.textContent = t || ''; noteEl.className = 'iv-note' + (kind ? ' ' + kind : ''); }
  function call(method, body, extra) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + '/track/tiers/admin?key=' + encodeURIComponent(key()) + (extra || ''), opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.ok = r.ok; return d; }); });
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function has(list, email) { return (list || []).some(function (x) { return x.email === email; }); }
  function draw() {
    countEl.textContent = MODE_WORDS[state.mode] || '';
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-mode]'), function (b) {
      var on = b.getAttribute('data-mode') === state.mode;
      b.setAttribute('aria-pressed', String(on));
      b.className = on ? 'iv-act' : 'secondary';
    });
    ['start', 'monthly', 'cap'].forEach(function (k) {
      var el = document.getElementById('tiers-' + k);
      if (document.activeElement !== el) el.value = state.allowance[k];
    });
    testersEl.innerHTML = state.testers.length ? '<table class="iv-table"><tbody>' + state.testers.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="testers" data-email="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">No testers yet.</p>';
    fullEl.innerHTML = state.full.length ? '<table class="iv-table"><tbody>' + state.full.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="full" data-email="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody has Full access yet.</p>';
    paidEl.innerHTML = (state.paid || []).length ? '<table class="iv-table"><tbody>' + state.paid.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="danger iv-act" data-revoke="paid" data-email="' + esc(a.email) + '">Take away</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody is on Laps Pro yet.</p>';
    Array.prototype.forEach.call(document.querySelectorAll('#tiers-trial-wrap [data-trial]'), function (b) {
      var on = (b.getAttribute('data-trial') === 'on') === !!state.trialOpen;
      b.setAttribute('aria-pressed', String(on));
      b.className = on ? 'iv-act' : 'secondary';
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tiers-subs-wrap [data-subs]'), function (b) {
      var on = b.getAttribute('data-subs') === state.subscriptions;
      b.setAttribute('aria-pressed', String(on));
      b.className = on ? 'iv-act' : 'secondary';
    });
    var trials = state.trials || { summary: { running: 0, ended: 0, stayedFree: 0, awaiting: 0 }, rows: [] };
    var sm = trials.summary;
    trialsCountEl.textContent = sm.running + ' running now. ' + sm.ended + ' ' + (sm.ended === 1 ? 'trial has' : 'trials have') + ' ended: ' +
      sm.stayedFree + ' chose the free tier and ' + sm.awaiting + ' ' + (sm.awaiting === 1 ? 'has' : 'have') + ' not chosen yet.';
    trialsEl.innerHTML = trials.rows.length ? '<table class="iv-table"><tbody>' + trials.rows.map(function (t) {
      var status = !t.ended ? 'Running, ends ' + when(t.end) : t.choice === 'free' ? 'Ended, chose the free tier' : 'Ended, not chosen yet';
      return '<tr><td><span class="iv-sub">' + esc(t.email) + '</span></td><td>' + esc(when(t.start)) + '</td><td>' + esc(status) + '</td>' +
        '<td>' + (t.ended ? '' : '<button type="button" class="secondary iv-act" data-trial-end="' + esc(t.email) + '">End now</button> ') +
        '<button type="button" class="danger iv-act" data-trial-remove="' + esc(t.email) + '">Remove</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">Nobody has started a Laps Pro trial yet.</p>';
    var asks = state.requests || [];
    reqEl.innerHTML = asks.length ? '<table class="iv-table"><tbody>' + asks.map(function (a) {
      return '<tr><td>' + esc(a.name ? a.name + ' ' : '') + '<span class="iv-sub">' + esc(a.email) + '</span></td><td>' + esc(when(a.at)) + '</td>' +
        '<td><button type="button" class="iv-act" data-topup="' + esc(a.email) + '" data-req="' + esc(a.id) + '">Add 1 day</button> <button type="button" class="secondary iv-act" data-done="' + esc(a.id) + '">Done</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">No requests waiting.</p>';
  }
  function load() {
    if (!key()) { note('Enter the admin key above and press Load.', ''); return; }
    call('GET').then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'Could not load the panel. Check the admin key.', 'error'); return; }
      state = d; note(''); draw();
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  // The member list for the finder: the worker reads it on request (members=1).
  function loadMembers() {
    return call('GET', undefined, '&members=1').then(function (d) {
      if (!d.ok || !d.success) throw new Error(d.message || 'Could not load the members.');
      return d.members || [];
    });
  }
  function act(body, done) {
    return call('POST', body).then(function (d) {
      if (!d.ok || !d.success) { note(d.message || 'That did not work.', 'error'); return; }
      state = Object.assign({}, state, d); draw(); note(done || '');
      if (body.action === 'topup' || body.action === 'requestdone') {
        // The reply does not list the requests, so the list is read again (the note stays).
        call('GET').then(function (g) { if (g.ok && g.success) { state.requests = g.requests || []; draw(); } });
      }
    }).catch(function () { note('Could not reach the server.', 'error'); });
  }
  wrap.addEventListener('toggle', function () { if (wrap.open) load(); });
  // The page's Refresh (and each section's refresh) reloads what this panel shows.
  document.addEventListener('mt3uk-admin-refresh', function () { if (wrap.open) load(); });
  // Adds a tester: starts their 7-day Laps Pro trial now. Members are found by nickname, name or email (the shared finder).
  if (window.MT3UKMemberFinder) {
    window.MT3UKMemberFinder.mount(document.getElementById('tiers-trial-add-host'), {
      load: loadMembers,
      action: {
        label: 'Add tester',
        run: function (m) {
          return call('POST', { action: 'trial-add', email: m.email }).then(function (d) {
            if (!d.ok || !d.success) { note(d.message || 'Could not add the tester.', 'error'); return; }
            note(d.message);
            load();
          });
        }
      }
    });
  }
  // Ends a running trial now, so the member sees the trial-ended card (for testing the subscribe step).
  trialsEl.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-trial-end]');
    if (!b) return;
    var email = b.getAttribute('data-trial-end');
    if (!window.confirm('End the Laps Pro trial for ' + email + ' now?')) return;
    b.disabled = true;
    call('POST', { action: 'trial-end', email: email }).then(function (d) {
      if (!d.ok || !d.success) { b.disabled = false; note(d.message || 'Could not end the trial.', 'error'); return; }
      note(d.message);
      load();
    });
  });
  // Removes a member's Laps Pro trial, so they can start it again while the offer is on.
  trialsEl.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-trial-remove]');
    if (!b) return;
    var email = b.getAttribute('data-trial-remove');
    if (!window.confirm('Remove the Laps Pro trial for ' + email + '? They can start it again while the offer is on.')) return;
    b.disabled = true;
    call('POST', { action: 'trial-remove', email: email }).then(function (d) {
      if (!d.ok || !d.success) { b.disabled = false; note(d.message || 'Could not remove the trial.', 'error'); return; }
      note(d.message);
      load();
    });
  });
  wrap.addEventListener('click', function (e) {
    var m = e.target.closest('[data-mode]');
    if (m) {
      var mode = m.getAttribute('data-mode');
      if (mode === state.mode) return;
      if (mode === 'all' && !window.confirm('Turn the free tier on for everyone? Every signed-in member will be held to the allowance.')) return;
      act({ action: 'mode', mode: mode }, 'Switch set to ' + MODE_WORDS[mode] + '.');
      return;
    }
    var tu = e.target.closest('[data-topup]');
    if (tu) { act({ action: 'topup', email: tu.getAttribute('data-topup'), days: 1 }, 'Added 1 day. The request is marked done.'); return; }
    var dn = e.target.closest('[data-done]');
    if (dn) { act({ action: 'requestdone', id: dn.getAttribute('data-done') }, 'Marked done.'); return; }
    var r = e.target.closest('[data-revoke]');
    if (r && window.confirm('Take this member off the ' + ({ full: 'Full access', paid: 'Laps Pro' }[r.getAttribute('data-revoke')] || 'testers') + ' list?')) {
      act({ action: 'revoke', list: r.getAttribute('data-revoke'), email: r.getAttribute('data-email') }, 'Removed.');
    }
  });
  document.getElementById('tiers-allowance-form').addEventListener('submit', function (e) {
    e.preventDefault();
    act({ action: 'allowance', start: parseInt(document.getElementById('tiers-start').value, 10), monthly: parseInt(document.getElementById('tiers-monthly').value, 10), cap: parseInt(document.getElementById('tiers-cap').value, 10) }, 'Allowance saved.');
  });

  // The three member lists: each finds a member by nickname, name or email and gives the access with its button.
  function giveButton(list, label, done) {
    return { label: label, run: function (m) { return act({ action: 'add', list: list, email: m.email }, done); } };
  }
  if (window.MT3UKMemberFinder) {
    window.MT3UKMemberFinder.mount(document.getElementById('tiers-find-host'), {
      load: loadMembers,
      action: giveButton('testers', 'Add as tester', 'Added as a tester.'),
      note: function (m) { return state && has(state.testers, m.email) ? '(already a tester)' : ''; }
    });
    window.MT3UKMemberFinder.mount(document.getElementById('tiers-full-host'), {
      load: loadMembers,
      action: giveButton('full', 'Give Full access', 'Full access given. No email is sent.'),
      note: function (m) { return state && has(state.full, m.email) ? '(has Full access)' : ''; }
    });
    window.MT3UKMemberFinder.mount(document.getElementById('tiers-paid-host'), {
      load: loadMembers,
      action: giveButton('paid', 'Add to Laps Pro', 'Added to Laps Pro.'),
      note: function (m) { return state && has(state.paid, m.email) ? '(on Laps Pro)' : ''; }
    });
  }
  document.addEventListener('mt3uk-admin-refresh', function () { if (key()) load(); });
  if (key()) load();
})();
