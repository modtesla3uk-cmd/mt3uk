/*
  A car's mods as drop-down rows, one per area (My Garage and the Gallery's
  Full mods list). The worker makes the list (specsToView in
  workers/vote-worker.js): [{ id, label, status, parts: [{ kind, what,
  settings, meta, empty }] }]. meta (when it was fitted, by whom, cost) is
  only there for the owner.

  MT3UKModsView.rows(view, opts) returns the rows' HTML. opts:
    open      { areaId: true } for the rows shown open
    owner     true: status pills, the private lines and Edit buttons
    editing   the area being edited, and editHtml(areaId) for its form
    ask       true: an "Ask about this" button on each part (data-mv-ask)
  MT3UKModsView.publicList(view) returns "What others see", grouped chips.
  Rows open and close with a button carrying data-mv-open="<areaId>"; the
  page listens for clicks.
*/
(function () {
  var ICON = {
    chev: '<path d="m6 9 6 6 6-6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    flag: '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>'
  };
  function icon(name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var CSS = [
    '.mv-rows{display:grid;gap:8px}',
    '@media (min-width:781px){.mv-rows.mv-two{grid-template-columns:1fr 1fr;align-items:start}.mv-rows.mv-two .mv-area.is-open{grid-column:1/-1}}',
    '.mv-area{background:#fff;border:1px solid var(--hairline,rgba(22,35,61,.12));border-radius:var(--radius,10px);overflow:hidden}',
    '.mv-area.is-open{border-color:var(--hairline-strong,rgba(22,35,61,.24));box-shadow:0 4px 16px rgba(22,35,61,.06)}',
    '.mv-row{width:100%;display:flex;align-items:center;gap:10px;min-height:56px;padding:0 14px;border:0;background:none;cursor:pointer;text-align:left;color:var(--ink,#16233d);font-family:var(--font-body,"IBM Plex Sans",sans-serif);font-size:1rem}',
    '.mv-row .mv-name{flex:1;min-width:0;font-weight:700}',
    '.mv-row .mv-count{font-size:.8rem;color:var(--steel,#6b7385);white-space:nowrap}',
    '.mv-row .mv-chev{width:18px;height:18px;color:var(--steel,#6b7385);transition:transform .2s}',
    '.mv-area.is-open .mv-chev{transform:rotate(180deg)}',
    '.mv-body{border-top:1px solid var(--hairline,rgba(22,35,61,.12));padding:4px 14px 14px;display:grid;gap:2px}',
    '.mv-part{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:start;padding:10px 0;border-bottom:1px solid var(--hairline,rgba(22,35,61,.12))}',
    '.mv-part:last-child{border-bottom:0}',
    '.mv-what{font-weight:500;min-width:0;overflow-wrap:anywhere}',
    '.mv-kind{display:block;font-size:.74rem;font-weight:700;color:var(--steel,#6b7385)}',
    '.mv-part.is-empty .mv-what{color:var(--steel,#6b7385);font-style:italic}',
    '.mv-meta{grid-column:1;display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--steel,#6b7385)}',
    '.mv-meta .icon{width:13px;height:13px}',
    '.mv-ask{grid-column:2;grid-row:1/span 2;align-self:center}',
    '.mv-settings{grid-column:1/-1;margin-top:6px;border:1px solid var(--hairline,rgba(22,35,61,.12));border-radius:8px;overflow-x:auto}',
    '.mv-settings table{width:100%;border-collapse:collapse;font-size:.8rem;font-variant-numeric:tabular-nums}',
    '.mv-settings th,.mv-settings td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--hairline,rgba(22,35,61,.12));white-space:nowrap}',
    '.mv-settings tr:last-child td{border-bottom:0}',
    '.mv-settings th{font-weight:600;color:var(--steel,#6b7385);background:var(--paper,#f3f1ea)}',
    '.mv-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center;padding-top:8px}',
    '.mv-actions small{display:inline-flex;align-items:center;gap:5px;color:var(--steel,#6b7385);font-size:.78rem}',
    '.mv-actions small .icon{width:13px;height:13px}',
    '.mv-pill{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;font-size:.76rem;font-weight:600;white-space:nowrap}',
    '.mv-pill-up{background:#fdf3ef;color:#b8421f}',
    '.mv-pill-stock{background:var(--paper-2,#e9e5d8);color:var(--ink,#16233d)}',
    '.mv-pill-todo{border:1px dashed var(--hairline-strong,rgba(22,35,61,.24));color:var(--steel,#6b7385)}',
    '.mv-public .mv-group{display:grid;gap:4px}',
    '.mv-public .mv-group b{font-size:.76rem;color:var(--steel,#6b7385)}',
    '.mv-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.mv-chip{display:inline-block;padding:4px 11px;border-radius:999px;background:var(--paper,#f3f1ea);border:1px solid var(--hairline,rgba(22,35,61,.12));font-size:.82rem;overflow-wrap:anywhere}',
    '.mv-row .mv-eye{color:var(--orange,#e8542a)}',
    '.mv-new{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:var(--orange,#e8542a);color:#fff;font-size:.68rem;font-weight:700;vertical-align:2px}',
    '@media (prefers-reduced-motion:reduce){.mv-row .mv-chev{transition:none}}'
  ].join('');
  function addStyles() {
    if (document.getElementById('mv-styles')) return;
    var st = document.createElement('style');
    st.id = 'mv-styles';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function pill(status) {
    if (status === 'up') return '<span class="mv-pill mv-pill-up">Upgraded</span>';
    if (status === 'stock') return '<span class="mv-pill mv-pill-stock">Stock</span>';
    return '<span class="mv-pill mv-pill-todo">To do</span>';
  }

  function settingsHtml(st) {
    var cols = [['reboundFront', 'Rebound front'], ['reboundRear', 'Rebound rear'], ['compressionFront', 'Compression front'], ['compressionRear', 'Compression rear']];
    var rows = [['road', 'Road'], ['track', 'Track']].filter(function (u) { return st[u[0]]; });
    return '<div class="mv-settings"><table><thead><tr><th>Coilovers</th>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (u) {
        return '<tr><td>' + u[1] + '</td>' + cols.map(function (c) { return '<td>' + esc(st[u[0]][c[0]] || '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function partLabel(p) { return (p.kind ? p.kind + ': ' : '') + (p.what || ''); }

  function rows(view, opts) {
    addStyles();
    opts = opts || {};
    var open = opts.open || {};
    return (view || []).map(function (a) {
      if (!opts.owner && a.status === 'todo') return '';
      var isOpen = !!open[a.id] || opts.editing === a.id;
      var parts = a.parts || [];
      var count = a.status === 'up' && parts.length ? parts.length + (parts.length === 1 ? ' part' : ' parts') : '';
      var h = '<div class="mv-area' + (isOpen ? ' is-open' : '') + '" data-mv-area="' + esc(a.id) + '">' +
        '<button type="button" class="mv-row" data-mv-open="' + esc(a.id) + '" aria-expanded="' + isOpen + '">' +
        '<span class="mv-name">' + esc(a.label) + '</span><span class="mv-count">' + count + '</span>' +
        (opts.owner ? pill(a.status) : '') + icon('chev', 'mv-chev') + '</button>';
      if (!isOpen) return h + '</div>';
      h += '<div class="mv-body">';
      if (opts.editing === a.id && opts.editHtml) return h + opts.editHtml(a.id) + '</div></div>';
      if (a.status === 'stock') h += '<div class="mv-part"><div class="mv-what">Stock</div></div>';
      else if (a.status !== 'up') h += '<div class="mv-part is-empty"><div class="mv-what">Nothing here yet.</div></div>';
      else {
        h += parts.map(function (p, i) {
          var s = '<div class="mv-part' + (p.empty ? ' is-empty' : '') + '"><div class="mv-what">' + (p.kind ? '<span class="mv-kind">' + esc(p.kind) + '</span>' : '') +
            esc(p.empty ? 'Nothing added yet. Tap Edit to add details.' : p.what) + '</div>';
          if (opts.owner && p.meta) s += '<div class="mv-meta">' + icon('lock') + esc(p.meta) + '</div>';
          if (opts.ask && !p.empty) s += '<button type="button" class="btn btn-secondary btn-sm mv-ask" data-mv-ask="' + esc(a.id) + ':' + i + '" data-mod="' + esc(partLabel(p)) + '">' + icon('chat') + 'Ask about this</button>';
          if (p.settings) s += settingsHtml(p.settings);
          return s + '</div>';
        }).join('');
      }
      if (opts.owner) {
        var anyMeta = parts.some(function (p) { return p.meta; });
        var label = a.status === 'todo' ? 'Add details' : a.status === 'stock' ? 'Change' : 'Edit';
        h += '<div class="mv-actions"><small>' + (anyMeta ? icon('lock') + 'Dates and costs are only for you' : '') + '</small>' +
          (a.id === 'mods' ? '' : '<button type="button" class="btn btn-secondary btn-sm" data-mv-edit="' + esc(a.id) + '">' + icon('edit') + label + '</button>') + '</div>';
      }
      return h + '</div></div>';
    }).join('');
  }

  // Everything others can see, grouped by area.
  function publicList(view) {
    addStyles();
    return (view || []).filter(function (a) { return a.status === 'up'; }).map(function (a) {
      var chips = (a.parts || []).filter(function (p) { return !p.empty && p.what; }).map(function (p) {
        return '<span class="mv-chip">' + esc(partLabel(p)) + '</span>';
      });
      return chips.length ? '<div class="mv-group"><b>' + esc(a.label) + '</b><div class="mv-chips">' + chips.join('') + '</div></div>' : '';
    }).join('');
  }

  function publicCount(view) {
    return (view || []).reduce(function (n, a) {
      return n + (a.status === 'up' ? (a.parts || []).filter(function (p) { return !p.empty && p.what; }).length : 0);
    }, 0);
  }

  window.MT3UKModsView = { rows: rows, publicList: publicList, publicCount: publicCount, icon: icon, esc: esc };
})();
