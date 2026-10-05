/*
  track-admin.html: the page chrome for the Track sessions admin tools. The panels have their own scripts
  (track-access-admin.js, track-lines-admin.js, track-member-admin.js, track-admin.js, track-copy-admin.js,
  tyre-admin.js, track-share-admin.js); this one holds what they share with admin.html:

    - the admin key (kept in this browser tab, the same key admin.html uses) and the Load and Refresh buttons,
      which tell every panel to load through the "mt3uk-admin-refresh" event;
    - the "admin viewer" token that lets the admin open private sessions and unpublished pages;
    - which panels are open (remembered in this browser, the same list admin.html keeps);
    - opening the panel a link points at (track-admin.html#lines-wrap, #tracks-wrap and the like);
    - the notification bell, for what waits on this page: early access requests, new track requests, and map
      edit requests and changes to approve. The bell on admin.html counts these too and links here.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var keyInput = document.getElementById('admin-key');
  var loadBtn = document.getElementById('load-btn');
  var statusEl = document.getElementById('status');
  if (!keyInput) return;

  var savedKey = sessionStorage.getItem('mt3ukAdminKey') || sessionStorage.getItem('mt3ukClaimsAdminKey') || sessionStorage.getItem('mt3ukCommentAdminKey');
  if (savedKey) keyInput.value = savedKey;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // ---------- Panels open and closed (remembered, shared with admin.html) ----------
  var OPEN_KEY = 'mt3ukAdminOpen';
  function readOpen() { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'); } catch (e) { return []; } }
  function panels() { return [].slice.call(document.querySelectorAll('details.collapsible')); }
  panels().forEach(function (d) {
    if (readOpen().indexOf(d.id) !== -1) d.open = true;
    d.addEventListener('toggle', function () {
      var ids = readOpen().filter(function (id) { return id !== d.id; });
      if (d.open) ids.push(d.id);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch (e) {}
    });
  });
  window.addEventListener('pagehide', function () {
    var ids = readOpen().filter(function (id) { return !document.getElementById(id) || !document.getElementById(id).classList.contains('collapsible'); })
      .concat(panels().filter(function (d) { return d.open; }).map(function (d) { return d.id; }));
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch (e) {}
  });

  // A link to a panel (an email, the bell on admin.html, the old admin.html addresses) opens it.
  function openFromHash() {
    var id = decodeURIComponent((location.hash || '').slice(1));
    var d = id && document.getElementById(id);
    if (d && d.classList && d.classList.contains('collapsible')) {
      d.open = true;
      d.scrollIntoView({ block: 'start' });
    } else if (/^lines-[a-f0-9]{8,40}$/.test(id)) {
      var w = document.getElementById('lines-wrap');
      if (w) w.open = true;
    }
  }
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  // ---------- The key, and the admin viewer token ----------
  // 'none' until a key is tried, then 'ok' or 'bad'.
  var adminKeyState = 'none';

  function ensureAdminViewer(adminKey) {
    var have = null;
    try { have = JSON.parse(localStorage.getItem('mt3ukAdminViewer') || 'null'); } catch (e) { have = null; }
    var stillGood = have && have.token && have.expires > Date.now()
      ? fetch(API + '/admin/viewer-check?token=' + encodeURIComponent(have.token), { cache: 'no-store' }).then(function (r) { return r.ok; }).catch(function () { return true; })
      : Promise.resolve(false);
    return stillGood.then(function (ok) {
      if (ok) return;
      return fetch(API + '/admin/viewer-token?key=' + encodeURIComponent(adminKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.success) { try { localStorage.setItem('mt3ukAdminViewer', JSON.stringify({ token: d.token, expires: d.expires })); } catch (e) {} } });
    }).catch(function () {});
  }

  function loadAll() {
    var key = keyInput.value.trim();
    if (!key) {
      statusEl.textContent = 'Enter the admin key first.';
      return Promise.resolve();
    }
    sessionStorage.setItem('mt3ukAdminKey', key);
    statusEl.textContent = 'Loading…';
    // Every panel fetches its own list.
    document.dispatchEvent(new CustomEvent('mt3uk-admin-refresh'));
    // A cheap call that says whether the key is right.
    return fetch(API + '/track/access/admin?key=' + encodeURIComponent(key), { cache: 'no-store' })
      .then(function (r) {
        adminKeyState = r.ok ? 'ok' : 'bad';
        statusEl.textContent = r.ok ? '' : 'The admin key is not right.';
        if (r.ok) return ensureAdminViewer(key);
      })
      .catch(function () { statusEl.textContent = 'Network error loading data.'; });
  }

  loadBtn.addEventListener('click', function () { loadAll(); });
  document.getElementById('refresh-btn').addEventListener('click', function () { loadAll(); });
  keyInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') loadAll(); });

  // ---------- Notification bell ----------
  // Built from what the panels have loaded. Items not opened before are counted on the bell and tagged New; opening
  // the bell marks them as seen (in this browser).
  var bellBtn = document.getElementById('bell-btn');
  var bellBadge = document.getElementById('bell-badge');
  var bellPanel = document.getElementById('bell-panel');
  var BELL_SEEN_KEY = 'mt3ukAdminSeen';
  var bellItems = [];

  function bellSeen() {
    try { return JSON.parse(localStorage.getItem(BELL_SEEN_KEY) || '[]'); } catch (e) { return []; }
  }

  function collectBellItems() {
    var items = [];
    // Early access requests and new-track requests wait in their own panels.
    document.querySelectorAll('#ac-pending [data-approve]').forEach(function (btn) {
      var row = btn.closest('tr'), email = btn.getAttribute('data-approve');
      var cells = row ? row.querySelectorAll('td') : [];
      items.push({
        id: 'access:' + email, group: 'Early access requests', section: 'access', el: row, img: '',
        title: (cells[0] ? cells[0].textContent.trim() : email) || email,
        sub: 'Wants early access to Track sessions' + (cells[1] && cells[1].textContent.trim() ? ' (' + cells[1].textContent.trim() + ')' : '')
      });
    });
    document.querySelectorAll('#tk-requests .tk-req').forEach(function (card) {
      var name = card.querySelector('b'), kind = card.querySelector('.iv-sub');
      items.push({
        id: 'track:' + card.getAttribute('data-id'), group: 'New track requests', section: 'tracks', el: card, img: '',
        title: name ? name.textContent.trim() : 'New track',
        sub: kind ? kind.textContent.trim() : 'Needs approving'
      });
    });
    // Requests to edit a map, and changes sent back to approve, wait on the Line editing panel.
    document.querySelectorAll('#ln-list > table > tbody > tr[data-state]').forEach(function (row) {
      var state = row.getAttribute('data-state');
      if (state === 'allowed') return;
      var cells = row.querySelectorAll('td');
      var who = cells[0] ? cells[0].textContent.trim() : 'A member', what = cells[1] ? cells[1].textContent.trim() : 'a session';
      var rn = row.getAttribute('data-kind') === 'rename';
      items.push({
        id: 'lines:' + row.getAttribute('data-key'), group: rn ? (state === 'changed' ? 'Track renames to approve' : 'Track rename requests') : state === 'changed' ? 'Map changes to approve' : 'Map edit requests', section: 'lines', el: row, img: '',
        title: who,
        sub: rn ? (state === 'changed' ? 'Sent a new track name for ' : 'Wants to rename the track on ') + what.replace(/Rename the track$/, '').trim() : state === 'changed' ? 'Moved the lines on ' + what + '. Waiting for you to accept or undo' : 'Wants to edit the map on ' + what
      });
    });
    return items;
  }

  function renderBell() {
    bellItems = collectBellItems();
    var seen = bellSeen();
    var unseen = bellItems.filter(function (it) { return seen.indexOf(it.id) === -1; }).length;
    bellBadge.hidden = unseen === 0;
    bellBadge.textContent = unseen > 99 ? '99+' : String(unseen);
    bellBtn.setAttribute('aria-label', unseen ? 'Notifications, ' + unseen + ' new' : 'Notifications');
    document.title = (unseen ? '(' + unseen + ') ' : '') + 'Track admin | MT3UK';
    if (!bellPanel.hidden && adminKeyState === 'ok' && !document.getElementById('bell-key-form')) drawBellPanel(seen);
  }

  // No key yet, or it didn't work: ask for it in the bell's panel.
  function drawBellKeyPrompt(message) {
    bellPanel.innerHTML =
      '<form class="bell-key" id="bell-key-form">' +
        '<label class="bell-key-label" for="bell-key-input">' + escapeHtml(message) + '</label>' +
        '<div class="bell-key-row">' +
          '<input type="password" id="bell-key-input" placeholder="Admin key" autocomplete="off" required>' +
          '<button type="submit">Check</button>' +
        '</div>' +
      '</form>';
    var input = document.getElementById('bell-key-input');
    input.value = keyInput.value;
    setTimeout(function () { input.focus(); }, 0);
    document.getElementById('bell-key-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var key = input.value.trim();
      if (!key) return;
      keyInput.value = key;
      bellPanel.innerHTML = '<p class="bell-empty">Checking&hellip;</p>';
      loadAll().then(function () {
        if (bellPanel.hidden) return;
        if (adminKeyState !== 'ok') { drawBellKeyPrompt('That key didn\'t work. Try again:'); return; }
        openBellList();
      });
    });
  }

  function openBellList() {
    renderBell();
    var seen = bellSeen();
    drawBellPanel(seen);
    // Everything listed now counts as seen; NEW tags stay until it closes.
    try { localStorage.setItem(BELL_SEEN_KEY, JSON.stringify(bellItems.map(function (it) { return it.id; }))); } catch (err) {}
    bellBadge.hidden = true;
    document.title = 'Track admin | MT3UK';
  }

  function drawBellPanel(seen) {
    if (!bellItems.length) {
      bellPanel.innerHTML = '<p class="bell-empty">Nothing needs your attention right now.</p>';
      return;
    }
    var html = '';
    var lastGroup = '';
    bellItems.forEach(function (it, i) {
      if (it.group !== lastGroup) {
        var count = bellItems.filter(function (x) { return x.group === it.group; }).length;
        html += '<div class="bell-group">' + escapeHtml(it.group) + ' (' + count + ')</div>';
        lastGroup = it.group;
      }
      html += '<button type="button" class="bell-item" data-index="' + i + '">' +
        '<span class="bell-thumb bell-thumb-blank"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></span>' +
        '<span class="bell-text"><span class="bell-title">' + escapeHtml(it.title) + '</span><span class="bell-sub">' + escapeHtml(it.sub) + '</span></span>' +
        (seen.indexOf(it.id) === -1 ? '<span class="bell-new">New</span>' : '') +
      '</button>';
    });
    bellPanel.innerHTML = html;
  }

  function closeBell() {
    bellPanel.hidden = true;
    bellBtn.setAttribute('aria-expanded', 'false');
  }

  bellBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!bellPanel.hidden) { closeBell(); return; }
    bellPanel.hidden = false;
    bellBtn.setAttribute('aria-expanded', 'true');
    if (adminKeyState === 'ok') openBellList();
    else drawBellKeyPrompt(adminKeyState === 'bad' ? 'That key didn\'t work. Enter the admin key:' : 'Enter the admin key to see notifications:');
  });

  bellPanel.addEventListener('click', function (e) {
    e.stopPropagation();
    var row = e.target.closest('.bell-item');
    if (!row) return;
    var it = bellItems[parseInt(row.dataset.index, 10)];
    closeBell();
    if (!it || !it.el || !document.body.contains(it.el)) return;
    var wrap = document.getElementById(it.section + '-wrap');
    if (wrap) wrap.open = true;
    it.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    it.el.classList.add('bell-flash');
    setTimeout(function () { it.el.classList.remove('bell-flash'); }, 2200);
  });

  document.addEventListener('click', function (e) {
    if (!bellPanel.hidden && !e.target.closest('.bell-wrap')) closeBell();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !bellPanel.hidden) { closeBell(); bellBtn.focus(); }
  });

  var bellTimer = null;
  ['ac-pending', 'tk-requests', 'ln-list'].map(function (id) { return document.getElementById(id); }).filter(Boolean).forEach(function (el) {
    new MutationObserver(function () {
      clearTimeout(bellTimer);
      bellTimer = setTimeout(renderBell, 100);
    }).observe(el, { childList: true, subtree: true });
  });

  // Check for new items every few minutes while the page is open.
  setInterval(function () {
    if (!keyInput.value.trim() || document.hidden) return;
    document.dispatchEvent(new CustomEvent('mt3uk-admin-refresh'));
  }, 3 * 60 * 1000);
  // And at once when js/admin-alerts.js sees that something new is waiting.
  document.addEventListener('mt3uk-admin-changed', function () {
    if (keyInput.value.trim()) document.dispatchEvent(new CustomEvent('mt3uk-admin-refresh'));
  });

  if (savedKey) loadAll();
})();
