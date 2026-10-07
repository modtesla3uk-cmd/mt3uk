/*
  The tip on Sessions (track.html) and the Leaderboard: more sessions make the boards worth more. Its words come
  from the admin's Welcome text panel (tipHeading and tipText in /track/copy, tipOff hides it); blank means the
  built-in words. It folds to its heading with the chevron, and the fold is remembered in this browser
  (localStorage mt3ukLapsTip). A page puts <div data-laps-tip></div> where it goes (data-laps-tip="plain" leaves out the Add a session
  button, for a page that has its own) and calls MT3UKLapsTip.place() after drawing. data-laps-tip="bulb" (the Leaderboard's
  blue heading) shows only a round light bulb button, and the tip opens under it when pressed; it always starts shut
  and does not touch the remembered fold.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var KEY = 'mt3ukLapsTip';
  var BUILT_IN = {
    heading: 'Tip: the more you upload, the more the board tells you',
    text: 'Every session you add is kept as your car\'s best for that mix of tyres and conditions, so the filters can compare like with like, and the board shows how you are coming on from day to day. Upload each track day, even the slow ones.'
  };
  var copy = null, loading = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function load() {
    if (loading) return loading;
    loading = fetch(API + '/track/copy', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { copy = (d && d.copy) || {}; return copy; }).catch(function () { copy = {}; return copy; });
    return loading;
  }
  function closed() { try { return localStorage.getItem(KEY) === 'closed'; } catch (e) { return false; } }
  // plain: without the Add a session button (Sessions has its own right above).
  var BULB = '<svg class="icon laps-tip-bulb" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/></svg>';
  function bulbHtml() {
    var heading = esc(copy.tipHeading || BUILT_IN.heading);
    return '<div class="laps-tip laps-tip-bulbmode is-closed" id="laps-tip" role="note">' +
      '<button type="button" class="laps-tip-bulbbtn" data-laps-tip-toggle aria-expanded="false" aria-controls="laps-tip-body" aria-label="' + heading + '" title="Tip">' + BULB + '</button>' +
      '<div class="laps-tip-body laps-tip-pop" id="laps-tip-body" hidden><b>' + heading + '</b><p>' + esc(copy.tipText || BUILT_IN.text) + '</p></div></div>';
  }
  function html(plain) {
    if (!copy || copy.tipOff) return '';
    if (plain === 'bulb') return bulbHtml();
    var isClosed = closed();
    return '<div class="card laps-tip' + (isClosed ? ' is-closed' : '') + '" id="laps-tip" role="note">' +
      '<button type="button" class="laps-tip-head" data-laps-tip-toggle aria-expanded="' + !isClosed + '" aria-controls="laps-tip-body">' +
      BULB +
      '<b>' + esc(copy.tipHeading || BUILT_IN.heading) + '</b>' +
      '<svg class="icon laps-tip-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>' +
      '<div class="laps-tip-body" id="laps-tip-body"' + (isClosed ? ' hidden' : '') + '><p>' + esc(copy.tipText || BUILT_IN.text) + '</p>' +
      (plain ? '' : '<a class="btn btn-accent btn-sm" href="track.html?add=1">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>Add a session</a>') + '</div></div>';
  }
  // Fills every placeholder on the page (after a page draws, so a redraw can call it again).
  function place() {
    var slots = document.querySelectorAll('[data-laps-tip]');
    if (!slots.length) return;
    load().then(function () { document.querySelectorAll('[data-laps-tip]').forEach(function (el) { var mode = el.getAttribute('data-laps-tip'); el.innerHTML = html(mode === 'bulb' ? 'bulb' : mode === 'plain'); }); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-laps-tip-toggle]');
    if (!b) return;
    var tip = b.closest('.laps-tip'), body = tip.querySelector('.laps-tip-body'), open = tip.classList.toggle('is-closed');
    body.hidden = open;
    b.setAttribute('aria-expanded', String(!open));
    if (tip.classList.contains('laps-tip-bulbmode')) return;
    try { if (open) localStorage.setItem(KEY, 'closed'); else localStorage.removeItem(KEY); } catch (e2) {}
  });
  window.MT3UKLapsTip = { place: place, BUILT_IN: BUILT_IN };
})();
