/*
  Shared member finder for the admin pages (admin.html and track-admin.html). A panel that lists members mounts one of
  these in a host element: a search box (nickname, name or email), a Show members button and a list that folds away
  with Close list, so the panel stays short until a list is wanted. window.MT3UKMemberFinder.mount(host, options):
    load()      returns a promise of the members: [{ email, name, nickname, access }]
    action      { label, run(member) } is the button on each row
    note(m)     optional text shown after the email (for example "Tester")
    placeholder optional search placeholder
  The members are loaded the first time the list is shown, and kept until mount is called again (refresh() reloads).
*/
(function () {
  var seq = 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function mount(host, options) {
    var id = 'mf' + (++seq);
    var members = null, loading = null;
    host.innerHTML =
      '<div class="iv-toolbar mf-bar">' +
        '<input type="search" class="mf-find" id="' + id + '-find" placeholder="' + esc(options.placeholder || 'Find by nickname, name or email') + '" aria-label="' + esc(options.placeholder || 'Find a member by nickname, name or email') + '" autocomplete="off">' +
        '<button type="button" class="secondary mf-show" aria-expanded="false" aria-controls="' + id + '-list">Show members</button>' +
      '</div>' +
      '<div class="mf-list" id="' + id + '-list" hidden>' +
        '<div class="mf-head"><span class="mf-count iv-note"></span> <button type="button" class="secondary mf-close">Close list</button></div>' +
        '<div class="mf-rows"></div>' +
      '</div>';
    var find = host.querySelector('.mf-find'), show = host.querySelector('.mf-show'), list = host.querySelector('.mf-list');
    var count = host.querySelector('.mf-count'), rows = host.querySelector('.mf-rows');

    function open() { return list.hidden === false; }
    function setOpen(on) {
      list.hidden = !on;
      show.setAttribute('aria-expanded', String(on));
      show.textContent = on ? 'Hide members' : 'Show members';
    }
    function ensure() {
      if (members) return Promise.resolve(members);
      if (!loading) {
        loading = Promise.resolve(options.load()).then(function (m) { members = m || []; return members; }, function () { loading = null; members = null; return null; });
      }
      return loading;
    }
    function draw() {
      if (!members) { count.textContent = ''; rows.innerHTML = ''; return; }
      var q = find.value.trim().toLowerCase();
      var hits = members.filter(function (m) {
        return !q || m.email.indexOf(q) !== -1 || (m.name || '').toLowerCase().indexOf(q) !== -1 || (m.nickname || '').toLowerCase().indexOf(q) !== -1;
      });
      var shown = hits.slice(0, 50);
      count.textContent = !hits.length ? 'No member matches.' : (hits.length > shown.length ? 'Showing ' + shown.length + ' of ' + hits.length + '. Type more to narrow it down.' : hits.length + ' member' + (hits.length === 1 ? '' : 's') + '.');
      rows.innerHTML = shown.length ? '<table class="iv-table"><tbody>' + shown.map(function (m, i) {
        var name = (m.nickname ? '<b>' + esc(m.nickname) + '</b> ' : '') + esc(m.name || '');
        return '<tr><td>' + (name ? name + ' ' : '') + '<span class="iv-sub">' + esc(m.email) + '</span>' + (options.note ? ' ' + esc(options.note(m)) : '') + '</td>' +
          '<td>' + (options.action ? '<button type="button" class="iv-act mf-go" data-i="' + i + '">' + esc(options.action.label) + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
      rows._shown = shown;
    }
    function refresh() {
      members = null; loading = null;
      return ensure().then(draw);
    }

    show.addEventListener('click', function () {
      if (open()) { setOpen(false); return; }
      setOpen(true);
      ensure().then(draw);
    });
    host.querySelector('.mf-close').addEventListener('click', function () { setOpen(false); show.focus(); });
    find.addEventListener('input', function () {
      if (!open() && find.value.trim()) { setOpen(true); ensure().then(draw); return; }
      if (open()) draw();
    });
    rows.addEventListener('click', function (e) {
      var b = e.target.closest('.mf-go');
      if (!b || !options.action) return;
      var m = rows._shown[parseInt(b.getAttribute('data-i'), 10)];
      if (!m) return;
      // The action may return a promise: the list is drawn again once it has been done (so the row shows its new state).
      var done = options.action.run(m);
      if (done && done.then) done.then(refresh);
    });
    setOpen(false);
    return { refresh: refresh, open: function () { setOpen(true); return ensure().then(draw); } };
  }

  window.MT3UKMemberFinder = { mount: mount };
})();
