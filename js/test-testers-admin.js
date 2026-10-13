// Test copy only (test.laps.mt3uk.com/admin.html): the Test testers panel. The deploy adds this script to the test copy
// of admin.html; the live admin page never loads it. Approved testers are the only addresses that get mail on the test
// copy directly (everyone else's mail goes to the test owner). One KV key on the test worker, behind the admin key.
(function () {
  'use strict';
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';

  function key() {
    return sessionStorage.getItem('mt3ukAdminKey') || '';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var box = document.createElement('section');
  box.className = 'card';
  box.id = 'test-testers';
  box.style.cssText = 'margin:24px auto;max-width:720px;padding:18px;border:1px solid #d9d9d9;border-radius:10px;background:#fff;font:15px/1.5 system-ui,sans-serif';
  box.innerHTML =
    '<h2 style="margin:0 0 6px;font-size:1.25rem">Test testers</h2>' +
    '<p style="margin:0 0 12px;color:#555">Approved people get the emails the test site sends, directly, and can sign in on test. Everyone else\'s email comes to you, marked with who it was for.</p>' +
    '<form id="tt-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
    '<input id="tt-email" type="email" placeholder="name@example.com" required style="flex:1;min-width:220px;min-height:44px;padding:8px 10px;border:1px solid #bbb;border-radius:8px">' +
    '<button type="submit" style="min-height:44px;padding:0 16px;border:0;border-radius:8px;background:#1b2f5b;color:#fff;font-weight:600">Add tester</button>' +
    '</form>' +
    '<div id="tt-status" role="status" style="min-height:1.5em;margin-bottom:8px;color:#555"></div>' +
    '<ul id="tt-list" style="list-style:none;padding:0;margin:0"></ul>';

  function status(msg, bad) {
    var el = document.getElementById('tt-status');
    el.textContent = msg || '';
    el.style.color = bad ? '#b3261e' : '#555';
  }

  function draw(list) {
    var ul = document.getElementById('tt-list');
    if (!list.length) {
      ul.innerHTML = '<li style="color:#555">No testers yet.</li>';
      return;
    }
    ul.innerHTML = list.map(function (e) {
      return '<li style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid #eee">' +
        '<span>' + esc(e) + '</span>' +
        '<button type="button" data-remove="' + esc(e) + '" style="min-height:44px;padding:0 12px;border:1px solid #b3261e;border-radius:8px;background:#fff;color:#b3261e">Remove</button>' +
        '</li>';
    }).join('');
  }

  function send(body) {
    return fetch(API + '/test/testers?key=' + encodeURIComponent(key()), {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.success) throw new Error(j.message || 'Could not reach the test worker');
        return j;
      });
    });
  }

  function load() {
    send(null).then(function (j) { draw(j.testers); status(''); })
      .catch(function (err) { status(err.message, true); });
  }

  box.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = document.getElementById('tt-email');
    send({ add: input.value }).then(function (j) {
      draw(j.testers);
      input.value = '';
      status('Added. Their mail now comes to them directly.');
    }).catch(function (err) { status(err.message, true); });
  });

  box.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-remove]');
    if (!btn) return;
    var email = btn.getAttribute('data-remove');
    send({ remove: email }).then(function (j) {
      draw(j.testers);
      status('Removed ' + email + '.');
    }).catch(function (err) { status(err.message, true); });
  });

  function mount() {
    var host = document.querySelector('main') || document.body;
    host.appendChild(box);
    if (key()) load();
    else status('Enter the admin key on this page first, then reload.', true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
