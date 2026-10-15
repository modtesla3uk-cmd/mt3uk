/* The free-tier usage ring beside the page title (the Sessions pages and the Leaderboard). draw(d) takes the member's
   /track/tiers/access answer: nothing shows unless the free tier applies, and a ring shows days left out of the cap in
   the same colours as the usage bar: green while less than half are used, amber from half used, red when 1 or none is
   left. The ring is kept in the page title; it is hidden when there is no answer. */
(function () {
  function draw(d) {
    var h1 = document.querySelector('.page-hero .lh-title');
    var ring = document.getElementById('tp-quota-ring');
    if (!h1 || !d || !d.success || !d.applies || d.full) { if (ring) ring.hidden = true; return; }
    css();
    var cap = (d.allowance && d.allowance.cap) || 6, used = Math.max(0, cap - d.balance);
    var colour = d.balance <= 1 ? '#d9534f' : used >= cap / 2 ? '#e0a100' : '#1f8a70';
    if (!ring) {
      ring = document.createElement('span');
      ring.id = 'tp-quota-ring';
      ring.className = 'tp-quota-ring';
    }
    placeRing(h1, ring);
    ring.hidden = false;
    var deg = 100 * used / cap, c = 2 * Math.PI * 9;
    ring.setAttribute('role', 'img');
    ring.setAttribute('aria-label', used + ' of ' + cap + ' free days used');
    ring.title = used + ' of ' + cap + ' free days used';
    ring.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" style="transform:rotate(-90deg);flex:none"><circle cx="11" cy="11" r="9" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3"/><circle cx="11" cy="11" r="9" fill="none" stroke="' + colour + '" stroke-width="3" stroke-dasharray="' + (c * deg / 100).toFixed(2) + ' ' + c.toFixed(2) + '"/></svg><span>' + used + '/' + cap + '</span>';
  }
  // The ring's own size and look, so it is the same small ring on every page that shows it.
  function css() {
    if (document.getElementById('mt3uk-quota-ring-css')) return;
    var st = document.createElement('style');
    st.id = 'mt3uk-quota-ring-css';
    st.textContent = '.tp-quota-ring { display: inline-flex; align-items: center; gap: 5px; margin-left: 10px; padding: 3px 9px 3px 5px; border: 1px solid rgba(255,255,255,.45); border-radius: 999px; color: #fff; font: 600 13px/1 var(--font-body, system-ui); white-space: nowrap; vertical-align: middle; }' +
      '.tp-quota-ring[hidden] { display: none; }';
    document.head.appendChild(st);
  }
  // The ring sits straight after the tip's light bulb in the title (or before the share icon while there is no bulb).
  // The bulb can be added after the ring, so the title is watched and the ring moved back after the bulb if needed.
  function placeRing(h1, ring) {
    var bulb = h1.querySelector('.laps-tip-titlebulb');
    if (bulb) {
      if (ring.previousElementSibling !== bulb) bulb.parentNode.insertBefore(ring, bulb.nextSibling);
    } else {
      var dot = h1.querySelector('.mt3uk-share-dot');
      if (ring.parentNode !== h1 || (dot && ring.nextElementSibling !== dot)) h1.insertBefore(ring, dot || null);
    }
    if (!h1._ringWatch) {
      h1._ringWatch = new MutationObserver(function () { var r = document.getElementById('tp-quota-ring'); if (r && !r.hidden) placeRing(h1, r); });
      h1._ringWatch.observe(h1, { childList: true });
    }
  }
  window.MT3UKQuotaRing = { draw: draw };
})();
