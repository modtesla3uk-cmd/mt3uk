/* The free tier on the Laps pages: the usage ring beside a page's title (the Sessions pages and the Leaderboard), and the
   features a free member does not have, greyed out with an Unlock hint. draw(d) takes the member's /track/tiers/access
   answer. Nothing changes unless the free tier applies to the member (not on Full access, and only while the switch is on
   for them).
   The ring: days used out of the cap, in the usage bar's colours (green while less than half are used, amber from half
   used, red when 1 or none is left). It sits straight after the tip's light bulb in the title.
   Locked for a free member: My Analysis (the heading button), Corner by corner, How much grip you used and Speed on a
   session, and Compare tyres and Compare pads on a Leaderboard board. Each locked thing shows an Unlock hint, and its
   Unlock button is a placeholder for the subscription: it says nothing is charged yet. */
(function () {
  var free = false, observer = null, scheduled = false;
  var NOTE = 'Subscriptions are coming soon. Nothing is charged yet.';

  function css() {
    if (document.getElementById('mt3uk-quota-ring-css')) return;
    var st = document.createElement('style');
    st.id = 'mt3uk-quota-ring-css';
    st.textContent =
      '.tp-quota-ring { display: inline-flex; align-items: center; gap: 5px; margin-left: 10px; padding: 3px 9px 3px 5px; border: 1px solid rgba(255,255,255,.45); border-radius: 999px; color: #fff; font: 600 13px/1 var(--font-body, system-ui); white-space: nowrap; vertical-align: middle; }' +
      '.tp-quota-ring[hidden] { display: none; }' +
      '.tier-lock-tag { display: inline-flex; align-items: center; margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: #e2e5ec; color: #16233d; font: 600 11px/1.2 var(--font-body, system-ui); vertical-align: middle; white-space: nowrap; }' +
      '.is-tier-locked { opacity: .55; filter: grayscale(1); cursor: pointer !important; }' +
      '.tier-lock-host { position: relative !important; }' +
      '.tier-lock-cover { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; align-content: center; gap: 8px; padding: 14px; text-align: center; background: rgba(243,241,234,.88); border-radius: inherit; font: 500 13px/1.4 var(--font-body, system-ui); color: #16233d; }' +
      '.tier-lock-cover b { font-size: 14px; }' +
      '.tier-lock-cover button { border: 1px solid rgba(22,35,61,.28); background: #fff; color: #16233d; border-radius: 999px; padding: 6px 14px; font: 600 13px/1 var(--font-body, system-ui); cursor: pointer; }' +
      '.tier-lock-toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 2000; max-width: min(420px, calc(100vw - 32px)); padding: 10px 14px; border-radius: 10px; background: #16233d; color: #fff; font: 500 13px/1.4 var(--font-body, system-ui); box-shadow: 0 8px 22px rgba(0,0,0,.25); }';
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

  function drawRing(d) {
    var h1 = document.querySelector('.page-hero .lh-title');
    var ring = document.getElementById('tp-quota-ring');
    if (!h1 || !free) { if (ring) ring.hidden = true; return; }
    var cap = d.total || (d.allowance && d.allowance.cap) || 6, used = Math.max(0, cap - d.balance);
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

  function tag(el) {
    if (el.querySelector(':scope > .tier-lock-tag')) return;
    var t = document.createElement('span');
    t.className = 'tier-lock-tag';
    t.textContent = 'Unlock';
    el.appendChild(t);
  }
  function lockControl(el) {
    el.classList.add('is-tier-locked');
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('title', 'Unlock for more insights');
    tag(el);
  }
  function lockTile(tile, name) {
    tile.classList.add('tier-lock-host');
    if (tile.querySelector(':scope > .tier-lock-cover')) return;
    var cover = document.createElement('div');
    cover.className = 'tier-lock-cover';
    cover.setAttribute('data-tier-cover', name);
    cover.innerHTML = '<div><b>' + name + '</b><br>Unlock for more insights.</div><button type="button" data-tier-unlock>Unlock</button>';
    tile.appendChild(cover);
  }

  // A short note at the foot of the screen (the placeholder for the subscription).
  function toast(text) {
    var t = document.getElementById('tier-lock-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tier-lock-toast'; t.className = 'tier-lock-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function apply() {
    scheduled = false;
    if (!free) return;
    css();
    // My Analysis, in the heading of the Laps pages (the button, not the page it leads to).
    document.querySelectorAll('.page-hero [data-btn="my-analysis"]').forEach(lockControl);
    // A session: the full analysis is Corner by corner, How much grip you used and Speed.
    document.querySelectorAll('[data-tile="corners"],[data-tile="grip"],[data-tile="speed"]').forEach(function (tile) {
      var key = tile.getAttribute('data-tile');
      lockTile(tile, key === 'corners' ? 'Corner by corner' : key === 'grip' ? 'How much grip you used' : 'Speed');
    });
    // The Leaderboard: the compare tabs.
    document.querySelectorAll('#lb-views [data-view="tyres"],#lb-views [data-view="pads"]').forEach(lockControl);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 0);
  }

  // A press on anything locked shows the note and goes nowhere.
  document.addEventListener('click', function (e) {
    if (!free || !e.target.closest) return;
    var locked = e.target.closest('.is-tier-locked, .tier-lock-cover');
    if (!locked) return;
    e.preventDefault();
    e.stopPropagation();
    toast(NOTE);
  }, true);

  function draw(d) {
    free = !!(d && d.success && d.applies && !d.full);
    if (!free) {
      var old = document.getElementById('tp-quota-ring');
      if (old) old.hidden = true;
      return;
    }
    css();
    drawRing(d);
    apply();
    // Pages draw their tiles and tabs after the answer arrives, so the page is watched for them.
    if (!observer) {
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  window.MT3UKQuotaRing = { draw: draw };
})();
