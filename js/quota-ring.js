/* The free-tier usage ring beside the page title (the Sessions pages and the Leaderboard). draw(d) takes the member's
   /track/tiers/access answer: nothing shows unless the free tier applies, and a ring shows days left out of the cap in
   the same colours as the usage bar: green while less than half are used, amber from half used, red when 1 or none is
   left. The ring is kept in the page title; it is hidden when there is no answer. */
(function () {
  function draw(d) {
    var h1 = document.querySelector('.page-hero .lh-title');
    var ring = document.getElementById('tp-quota-ring');
    if (!h1 || !d || !d.success || !d.applies || d.full) { if (ring) ring.hidden = true; return; }
    var cap = (d.allowance && d.allowance.cap) || 6, used = Math.max(0, cap - d.balance);
    var colour = d.balance <= 1 ? '#d9534f' : used >= cap / 2 ? '#e0a100' : '#1f8a70';
    if (!ring) {
      ring = document.createElement('span');
      ring.id = 'tp-quota-ring';
      ring.className = 'tp-quota-ring';
      var dot = h1.querySelector('.mt3uk-share-dot');
      h1.insertBefore(ring, dot || null);
    }
    ring.hidden = false;
    var deg = 100 * used / cap, c = 2 * Math.PI * 9;
    ring.setAttribute('role', 'img');
    ring.setAttribute('aria-label', d.balance + ' of ' + cap + ' free days available');
    ring.title = d.balance + ' of ' + cap + ' free days available';
    ring.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" style="transform:rotate(-90deg);flex:none"><circle cx="11" cy="11" r="9" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3"/><circle cx="11" cy="11" r="9" fill="none" stroke="' + colour + '" stroke-width="3" stroke-dasharray="' + (c * deg / 100).toFixed(2) + ' ' + c.toFixed(2) + '"/></svg><span>' + d.balance + '/' + cap + '</span>';
  }
  window.MT3UKQuotaRing = { draw: draw };
})();
