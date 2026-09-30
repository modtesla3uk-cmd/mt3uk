/* Event page renderer. event.html?e=<slug> draws the event page from that
   event's entry in data/event-pages.json (edited on events-admin.html). Any
   section with nothing in it is left out, and an image that has not been
   uploaded yet shows a striped placeholder while the event is a draft.

   When the admin has a preview open (see js/event-gate.js), the newest saved
   text comes from the worker, so a change shows straight away instead of
   after the site next redeploys. */
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var main = document.getElementById('event');
  if (!main) return;

  var slug = ((new URLSearchParams(location.search).get('e')) || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) slug = '';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Only web addresses and the site's own images are used as links or pictures.
  function safeUrl(u) {
    u = String(u || '').trim();
    return /^https:\/\//i.test(u) || /^images\/[A-Za-z0-9_\-./]+$/.test(u) ? u : '';
  }
  var ARROW_R = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var SHARE_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14"/></svg>';
  var ARROW_L = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';
  function list(v) { return Array.isArray(v) ? v : []; }
  function text(v) { return typeof v === 'string' ? v.trim() : ''; }

  // ---------- Dates and times (UK time) ----------
  function londonOffsetMinutes(ms) {
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(ms));
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return (Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second) - Math.floor(ms / 1000) * 1000) / 60000;
  }
  // A UK clock time as the real moment it is.
  function ukInstant(date, time) {
    var d = date.split('-').map(Number);
    var t = (time || '00:00').split(':').map(Number);
    var guess = Date.UTC(d[0], d[1] - 1, d[2], t[0] || 0, t[1] || 0);
    var first = guess - londonOffsetMinutes(guess) * 60000;
    return new Date(guess - londonOffsetMinutes(first) * 60000);
  }
  function icsStamp(dt) { return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); }
  function longDate(iso) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/,/g, '');
  }
  function shortDate(iso) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function clock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return '';
    var h = +m[1];
    var suffix = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    return m[2] === '00' ? h12 + suffix : h12 + ':' + m[2] + suffix;
  }

  // ---------- Pieces ----------
  function imageBlock(src, cls, hint, isDraft, alt) {
    var url = safeUrl(src);
    if (url) return '<div class="ev-img ' + cls + '"><img src="' + esc(url) + '" alt="' + esc(alt || '') + '"></div>';
    if (!isDraft) return '';
    return '<div class="ev-img ' + cls + '"><div class="ph"><span><strong>' + esc(hint.label) + '</strong>' + esc(hint.size) + '<br>Upload it on the Events admin page</span></div></div>';
  }

  function facts(ev) {
    var out = [];
    if (ev.startDate) {
      var when = longDate(ev.startDate);
      var sub = '';
      if (ev.endDate && ev.endDate !== ev.startDate) { when = shortDate(ev.startDate) + ' to ' + longDate(ev.endDate); }
      out.push(['When', when, sub]);
    }
    if (text(ev.venue)) out.push(['Where', text(ev.venue), text(ev.town)]);
    if (ev.startTime) {
      var t = clock(ev.startTime) + (ev.endTime ? ' to ' + clock(ev.endTime) : '');
      out.push(['Time', t, text(ev.timeNote)]);
    }
    if (text(ev.entry)) out.push(['Entry', text(ev.entry), text(ev.entryNote)]);
    else if (text(ev.what3words)) out.push(['What3words', text(ev.what3words), '']);
    return out;
  }

  function factsHtml(ev) {
    var f = facts(ev);
    if (!f.length) return '';
    return '<div class="ev-facts-grid" style="--n:' + f.length + '">' + f.map(function (x) {
      return '<div class="ev-fact"><span class="mono">' + esc(x[0]) + '</span><strong>' + esc(x[1]) + '</strong>' + (x[2] ? '<small>' + esc(x[2]) + '</small>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function head(num, title, intro) {
    return '<div class="ev-head"><span class="section-num mono">' + esc(num) + '</span><h2>' + esc(title) + '</h2>' + (intro ? '<p>' + esc(intro) + '</p>' : '') + '</div>';
  }

  var sectionNo = 0;
  function nextNum(label) { sectionNo += 1; return (sectionNo < 10 ? '0' : '') + sectionNo + ' / ' + label; }

  function aboutHtml(ev) {
    var paras = list(ev.description).map(text).filter(Boolean);
    var chips = list(ev.highlights).map(text).filter(Boolean);
    var steps = list(ev.steps).filter(function (s) { return s && (text(s.title) || text(s.text)); });
    if (!paras.length && !chips.length && !steps.length) return '';
    var html = '<section class="ev-section"><div class="wrap ev-about">' + head(nextNum('About'), 'What to expect');
    if (paras.length) {
      html += '<div class="cols">' + paras.map(function (p, i) { return '<p' + (i === 0 ? ' class="lead"' : '') + '>' + esc(p) + '</p>'; }).join('') + '</div>';
    }
    if (chips.length) html += '<ul class="chips">' + chips.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>';
    if (steps.length) {
      html += '<ol class="steps">' + steps.map(function (s, i) {
        return '<li><span class="step-n">' + (i + 1) + '</span><div><strong>' + esc(text(s.title)) + '</strong>' + (text(s.text) ? '<p>' + esc(text(s.text)) + '</p>' : '') + '</div></li>';
      }).join('') + '</ol>';
    }
    return html + '</div></section>';
  }

  function ticketsHtml(ev) {
    var t = ev.tickets || {};
    var tiers = list(t.tiers).filter(function (x) { return x && text(x.name); });
    var notes = list(t.notes).filter(function (x) { return x && (text(x.label) || text(x.value)); });
    if (!tiers.length && !notes.length && !text(t.intro)) return '';
    var html = '<section class="ev-section alt"><div class="wrap"><div id="tickets" class="anchor"></div>' + head(nextNum('Tickets'), 'Tickets and entry', text(t.intro));
    if (tiers.length) {
      html += '<div class="tiers">' + tiers.map(function (x) {
        var cls = 'tier' + (x.featured ? ' featured' : '') + (x.soldOut ? ' soldout' : '');
        var tag = x.soldOut ? '<span class="tier-tag quiet">Sold out</span>' : (text(x.tag) ? '<span class="tier-tag' + (x.featured ? '' : ' quiet') + '">' + esc(text(x.tag)) + '</span>' : (x.addOn ? '<span class="tier-tag quiet">Add-on</span>' : ''));
        var inc = list(x.includes).map(text).filter(Boolean);
        var url = safeUrl(x.url);
        var label = text(x.buttonLabel) || 'Get tickets';
        var btn = x.soldOut ? '<span class="btn btn-secondary" aria-disabled="true">Sold out</span>'
          : url ? '<a class="btn ' + (x.featured ? 'btn-accent' : 'btn-secondary') + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + '</a>' : '';
        return '<div class="' + cls + '">' + tag + '<h3>' + esc(text(x.name)) + '</h3>' +
          (text(x.price) ? '<div class="price">' + esc(text(x.price)) + '</div>' : '') +
          (text(x.per) ? '<div class="per">' + esc(text(x.per)) + '</div>' : '') +
          (inc.length ? '<ul>' + inc.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : '<ul></ul>') + btn + '</div>';
      }).join('') + '</div>';
    }
    if (notes.length) {
      html += '<div class="ticket-notes">' + notes.map(function (n) { return '<div><span>' + esc(text(n.label)) + '</span><span>' + esc(text(n.value)) + '</span></div>'; }).join('') + '</div>';
    }
    return html + '</div></section>';
  }

  function scheduleHtml(ev) {
    var items = list(ev.schedule).filter(function (s) { return s && text(s.title); });
    if (!items.length) return '';
    return '<section class="ev-section"><div class="wrap">' + head(nextNum('The day'), 'Running order') +
      '<ol class="schedule">' + items.map(function (s) {
        return '<li><span class="t">' + esc(text(s.time)) + '</span><div><strong>' + esc(text(s.title)) + '</strong>' + (text(s.text) ? '<p>' + esc(text(s.text)) + '</p>' : '') + '</div></li>';
      }).join('') + '</ol></div></section>';
  }

  function posterHtml(ev) {
    var url = safeUrl(ev.poster);
    if (!url) return '';
    return '<section class="ev-section alt"><div class="wrap">' + head(nextNum('Poster'), 'The poster') +
      '<a class="poster" href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt="Poster for ' + esc(ev.title || ev.name) + '" loading="lazy"></a></div></section>';
  }

  function galleryHtml(ev, isDraft) {
    var items = list(ev.gallery).filter(function (g) { return g && safeUrl(g.src); });
    if (!items.length) return '';
    return '<section class="ev-section"><div class="wrap">' + head(nextNum('Photos'), text(ev.galleryTitle) || 'Photos') +
      '<div class="ev-gallery n' + Math.min(items.length, 5) + '">' + items.slice(0, 8).map(function (g) {
        return '<figure class="ev-img"><img src="' + esc(safeUrl(g.src)) + '" alt="' + esc(text(g.caption)) + '" loading="lazy">' +
          (text(g.caption) ? '<figcaption>' + esc(text(g.caption)) + '</figcaption>' : '') + '</figure>';
      }).join('') + '</div></div></section>';
  }

  function mapsQuery(ev) {
    return [text(ev.venue), text(ev.address)].filter(Boolean).join(', ');
  }

  function venueHtml(ev) {
    var rows = [];
    if (text(ev.venue)) rows.push(['Venue', text(ev.venue)]);
    if (text(ev.address)) rows.push(['Address', text(ev.address)]);
    if (text(ev.what3words)) rows.push(['What3words', text(ev.what3words)]);
    list(ev.venueNotes).forEach(function (n) { if (n && text(n.label) && text(n.value)) rows.push([text(n.label), text(n.value)]); });
    if (!rows.length && !text(ev.directions)) return '';
    var q = mapsQuery(ev);
    return '<section class="ev-section' + '"><div class="wrap"><div id="venue" class="anchor"></div>' + head(nextNum('Venue'), 'Getting there') +
      '<div class="venue-wrap"><div class="specs">' + rows.map(function (r) { return '<div class="spec-row"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>'; }).join('') + '</div>' +
      (text(ev.directions) ? '<p class="directions">' + esc(text(ev.directions)) + '</p>' : '') +
      (q ? '<a class="btn btn-secondary" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) + '" target="_blank" rel="noopener">Open in Maps ' + ARROW_R + '</a>' : '') +
      '</div></div></section>';
  }

  function faqHtml(ev) {
    var items = list(ev.faq).filter(function (f) { return f && text(f.q) && text(f.a); });
    if (!items.length) return '';
    return '<section class="ev-section alt"><div class="wrap">' + head(nextNum('FAQ'), 'Good to know') +
      '<div class="faq">' + items.map(function (f) { return '<details><summary>' + esc(text(f.q)) + '</summary><p>' + esc(text(f.a)) + '</p></details>'; }).join('') + '</div></div></section>';
  }

  function firstPrice(ev) {
    var best = null;
    list((ev.tickets || {}).tiers).forEach(function (t) {
      if (!t || t.soldOut || t.addOn) return;
      var n = parseFloat(String(t.price || '').replace(/[^0-9.]/g, ''));
      if (!isNaN(n) && (best === null || n < best.n)) best = { n: n, label: text(t.price) };
      else if (/free/i.test(String(t.price || '')) && best === null) best = { n: 0, label: 'Free' };
    });
    return best;
  }

  function hasTickets(ev) {
    var t = ev.tickets || {};
    return list(t.tiers).some(function (x) { return x && text(x.name); });
  }

  function heroHtml(ev, isDraft) {
    var d = ev.startDate ? new Date(ev.startDate + 'T12:00:00Z') : null;
    var dateBlock = d ? '<div class="ev-date" aria-label="' + esc(longDate(ev.startDate)) + '"><span class="m">' +
      esc(d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })) + '</span><span class="d">' + d.getUTCDate() + '</span><span class="y">' + d.getUTCFullYear() + '</span></div>' : '';
    var img = imageBlock(ev.heroImage || ev.image, 'ev-hero-img', { label: 'Hero image', size: '2100 x 900 (21:9). Crops to 4:3 on phones.' }, isDraft, ev.title || ev.name);
    return '<section class="ev-hero"><div class="wrap">' +
      '<a href="index.html#events" class="back-link">' + ARROW_L + ' Back to Events</a>' +
      '<div class="ev-hero-top">' + dateBlock + '<div class="ev-hero-text">' +
        '<span class="section-num mono">Events / ' + esc(text(ev.kind) || 'Meet') + '</span>' +
        '<h1>' + esc(ev.title || ev.name) + '</h1>' +
        (text(ev.tagline) ? '<p class="tagline">' + esc(text(ev.tagline)) + '</p>' : '') +
        (text(ev.organisers) ? '<p class="organisers">' + esc(text(ev.organisers)) + '</p>' : '') +
      '</div></div>' + img + '</div></section>';
  }

  function actionsHtml(ev) {
    var b = [];
    if (hasTickets(ev)) b.push('<a class="btn btn-accent" href="#tickets">Get tickets ' + ARROW_R + '</a>');
    var cta = safeUrl(ev.ctaUrl);
    if (cta) b.push('<a class="btn ' + (b.length ? 'btn-secondary' : 'btn-accent') + '" href="' + esc(cta) + '" target="_blank" rel="noopener">' + esc(text(ev.ctaLabel) || 'Event link') + ' ' + ARROW_R + '</a>');
    if (ev.startDate) b.push('<button class="btn btn-secondary" type="button" id="add-to-calendar">Add to calendar</button>');
    b.push('<button class="btn btn-secondary" type="button" id="share-event">' + SHARE_ICON + ' Share</button>');
    var q = mapsQuery(ev);
    if (q) b.push('<a class="btn btn-secondary" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) + '" target="_blank" rel="noopener">Get directions</a>');
    return b.length ? '<div class="ev-actions">' + b.join('') + '</div>' : '';
  }

  function closingHtml(ev) {
    var b = [];
    if (hasTickets(ev)) b.push('<a class="btn btn-accent" href="#tickets">Get tickets ' + ARROW_R + '</a>');
    var cta = safeUrl(ev.ctaUrl);
    if (cta) b.push('<a class="btn ' + (b.length ? 'btn-light' : 'btn-accent') + '" href="' + esc(cta) + '" target="_blank" rel="noopener">' + esc(text(ev.ctaLabel) || 'Event link') + ' ' + ARROW_R + '</a>');
    b.push('<a class="btn btn-light" href="https://www.facebook.com/groups/mt3uk" target="_blank" rel="noopener">Join the community</a>');
    return '<section class="ev-cta"><div class="wrap"><h2>See you there</h2><p>' + esc(text(ev.closing) || 'Tell a mate, and bring your Tesla or any EV.') + '</p><div class="row">' + b.join('') + '</div></div></section>';
  }

  // ---------- Page-level extras ----------
  function calendar(ev) {
    var btn = document.getElementById('add-to-calendar');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MT3UK//Events//EN', 'BEGIN:VEVENT',
        'UID:' + slug + '-' + ev.startDate + '@mt3uk.com', 'DTSTAMP:' + icsStamp(new Date())];
      if (ev.startTime) {
        lines.push('DTSTART:' + icsStamp(ukInstant(ev.startDate, ev.startTime)));
        lines.push('DTEND:' + icsStamp(ukInstant(ev.endDate || ev.startDate, ev.endTime || ev.startTime)));
      } else {
        lines.push('DTSTART;VALUE=DATE:' + ev.startDate.replace(/-/g, ''));
        var end = new Date((ev.endDate || ev.startDate) + 'T12:00:00Z');
        end.setUTCDate(end.getUTCDate() + 1);
        lines.push('DTEND;VALUE=DATE:' + end.toISOString().slice(0, 10).replace(/-/g, ''));
      }
      var esci = function (s) { return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); };
      lines.push('SUMMARY:' + esci(ev.title || ev.name), 'LOCATION:' + esci(mapsQuery(ev)), 'URL:https://mt3uk.com/event.html?e=' + slug, 'END:VEVENT', 'END:VCALENDAR');
      var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mt3uk-' + slug + '.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }

  // Share: always the event's share page (share/event/<slug>.html), which has
  // the event's own picture and text for chat and social link previews. The
  // plain event.html?e=... address can only show one fixed preview.
  function shareSetup(ev) {
    var btn = document.getElementById('share-event');
    if (!btn) return;
    var url = 'https://mt3uk.com/share/event/' + slug + '.html';
    var label = btn.innerHTML;
    btn.addEventListener('click', function () {
      if (navigator.share) {
        navigator.share({ title: ev.title || ev.name, text: text(ev.tagline), url: url }).catch(function () {});
        return;
      }
      var done = function () {
        btn.textContent = 'Link copied';
        setTimeout(function () { btn.innerHTML = label; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link', url); });
      else window.prompt('Copy this link', url);
    });
  }

  function setMeta(sel, attr, value) {
    var el = document.querySelector(sel);
    if (el) el.setAttribute(attr, value);
  }

  function pageMeta(ev, isDraft) {
    var title = (ev.title || ev.name) + ' – MT3UK Events';
    document.title = title;
    var desc = text(ev.tagline) || (list(ev.description)[0] || '');
    setMeta('meta[name="description"]', 'content', desc);
    setMeta('link[rel="canonical"]', 'href', 'https://mt3uk.com/event.html?e=' + slug);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', desc);
    var img = safeUrl(ev.heroImage || ev.image);
    if (img) setMeta('meta[property="og:image"]', 'content', /^https/.test(img) ? img : 'https://mt3uk.com/' + img);
    if (isDraft) {
      var robots = document.createElement('meta');
      robots.name = 'robots';
      robots.content = 'noindex, nofollow';
      document.head.appendChild(robots);
    } else if (ev.startDate) {
      var ld = {
        '@context': 'https://schema.org', '@type': 'Event', name: ev.title || ev.name,
        startDate: ev.startTime ? ukInstant(ev.startDate, ev.startTime).toISOString() : ev.startDate,
        endDate: ev.endDate ? (ev.endTime ? ukInstant(ev.endDate, ev.endTime).toISOString() : ev.endDate) : undefined,
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled',
        location: { '@type': 'Place', name: text(ev.venue), address: text(ev.address) },
        description: desc, image: img ? [/^https/.test(img) ? img : 'https://mt3uk.com/' + img] : undefined,
        organizer: { '@type': 'Organization', name: 'MT3UK', url: 'https://mt3uk.com' }
      };
      var s = document.createElement('script');
      s.type = 'application/ld+json';
      s.textContent = JSON.stringify(ld);
      document.head.appendChild(s);
    }
  }

  function ticketBar(ev) {
    var bar = document.getElementById('ev-ticket-bar');
    var price = firstPrice(ev);
    if (!bar || !hasTickets(ev) || !price) return;
    bar.innerHTML = '<div><span class="from">Tickets from</span><strong>' + esc(price.label) + '</strong></div><a class="btn btn-accent" href="#tickets">Get tickets</a>';
    bar.hidden = false;
  }

  function notFound(bare) {
    document.title = (bare ? 'Events' : 'Event not found') + ' – MT3UK Events';
    var robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    main.innerHTML = '<section class="ev-section"><div class="wrap ev-missing"><span class="section-num mono">Events</span>' +
      '<h1>' + (bare ? 'MT3UK events' : 'We can\u2019t find that event') + '</h1>' +
      '<p>' + (bare ? 'Meets, shows and track days for modified Tesla owners. See what is coming up.' : 'It may not be live yet, or the link may be wrong. See what is coming up.') + '</p>' +
      '<a class="btn btn-accent" href="index.html#events">See all events ' + ARROW_R + '</a></div></section>';
  }

  function render(ev) {
    var isDraft = !!ev.draft || !ev.publish;
    sectionNo = 0;
    main.innerHTML =
      heroHtml(ev, isDraft) +
      (function () { var f = factsHtml(ev), a = actionsHtml(ev); return f || a ? '<section class="ev-facts"><div class="wrap">' + f + a + '</div></section>' : ''; })() +
      aboutHtml(ev) + ticketsHtml(ev) + scheduleHtml(ev) + posterHtml(ev) + galleryHtml(ev, isDraft) + venueHtml(ev) + faqHtml(ev) + closingHtml(ev);
    pageMeta(ev, isDraft);
    calendar(ev);
    shareSetup(ev);
    ticketBar(ev);
    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  function findEntry(data) {
    var found = null;
    ((data && data.events) || []).forEach(function (e) { if (e.slug === slug) found = e; });
    return found;
  }

  function loadStatic() {
    return fetch('data/event-pages.json', { cache: 'no-store' }).then(function (res) { return res.json(); }).then(findEntry);
  }

  function load() {
    var access = null;
    try { access = JSON.parse(localStorage.getItem('mt3ukEventPreview:' + slug) || 'null'); } catch (e) {}
    if (access && access.token) {
      return fetch(API + '/events/pages/preview/content?slug=' + encodeURIComponent(slug) + '&token=' + encodeURIComponent(access.token), { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { return data && data.entry ? data.entry : loadStatic(); })
        .catch(loadStatic);
    }
    return loadStatic();
  }

  if (!slug) { notFound(true); return; }
  load().then(function (ev) { if (ev) render(ev); else notFound(false); }).catch(function () { notFound(false); });
})();
