/*
  Admin: a confirmation at the bottom of the screen when a button's result is shown out of view. Each admin panel reports
  what happened in a status line (role="status") near its title, which can be far from the button just pressed. When a
  status line changes within a few seconds of a click and cannot be seen, its words are shown here too. Panels whose
  status line is already on screen are left alone, and loading messages that change without a press are not shown.
*/
(function () {
  var box = null, timer = 0, clickAt = 0, lastText = '';
  var STYLE = '#admin-toast{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:9000;' +
    'max-width:min(92vw,520px);padding:12px 16px;border-radius:10px;background:#14213d;color:#f4f1ea;font:600 15px/1.4 "IBM Plex Sans",system-ui,sans-serif;' +
    'box-shadow:0 6px 24px rgba(20,33,61,.25);cursor:pointer;opacity:0;transition:opacity .2s;pointer-events:none}' +
    '#admin-toast.is-on{opacity:1;pointer-events:auto}#admin-toast.is-bad{background:#9b2c1d}';

  function ensure() {
    if (box) return box;
    var st = document.createElement('style');
    st.textContent = STYLE;
    document.head.appendChild(st);
    box = document.createElement('div');
    box.id = 'admin-toast';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.addEventListener('click', hide);
    document.body.appendChild(box);
    return box;
  }
  function hide() { if (box) box.classList.remove('is-on'); clearTimeout(timer); }
  function show(text, bad) {
    var b = ensure();
    b.textContent = text;
    b.classList.toggle('is-bad', !!bad);
    b.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(hide, 6000);
  }
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight) && r.height > 0;
  }

  // A press on a button is the start of a result, so remember when the last one was.
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('button, [role="button"], [role="switch"], [role="radio"]')) clickAt = Date.now();
  }, true);

  // A status line that changes soon after a press, and is out of view, is shown at the bottom of the screen.
  new MutationObserver(function (list) {
    if (!clickAt || Date.now() - clickAt > 4000) return;
    list.forEach(function (m) {
      var node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      var note = node && node.closest ? node.closest('[role="status"]') : null;
      if (!note || note.id === 'admin-toast' || note.closest('#admin-toast')) return;
      var text = (note.textContent || '').trim();
      if (!text) return;
      if (inView(note)) return;
      if (text === lastText && box && box.classList.contains('is-on')) return;
      lastText = text;
      show(text, note.classList.contains('is-bad'));
    });
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
})();
