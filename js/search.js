(function () {
  var SHOP_ENDPOINT = 'https://late-darkness-ebc8.modtesla3uk.workers.dev/shop-products';
  var MAX_RESULTS = 8;
  // Already indexed via data/search-index.json as the Parts-section card (shop.html#brace).
  var EXCLUDE_FROM_MERCH = ['model-3-brake-master-cylinder-bracket-for-rhd-models-only'];

  var root = document.getElementById('nav-search');
  var toggle = document.getElementById('nav-search-toggle');
  var panel = document.getElementById('nav-search-panel');
  var input = document.getElementById('nav-search-input');
  var results = document.getElementById('nav-search-results');
  if (!root || !toggle || !panel || !input || !results) return;

  var index = [];

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function openPanel() {
    root.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    input.focus();
  }

  function closePanel() {
    root.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    if (root.classList.contains('open')) {
      closePanel();
    } else {
      openPanel();
    }
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#nav-search')) closePanel();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) {
      closePanel();
      toggle.focus();
    }
  });

  results.addEventListener('click', function (e) {
    if (e.target.closest('a')) closePanel();
  });

  function fold(w) {
    return w.length > 3 && w.charAt(w.length - 1) === 's' ? w.slice(0, -1) : w;
  }

  function wordMatch(haystackWord, token) {
    var tokFolded = fold(token);
    return haystackWord.indexOf(token) !== -1 || fold(haystackWord).indexOf(tokFolded) !== -1;
  }

  function score(entry, rawQuery) {
    var title = entry.title.toLowerCase();
    var haystack = (title + ' ' + (entry.description || '') + ' ' + (entry.keywords || []).join(' ')).toLowerCase();

    if (title === rawQuery) return 100;
    if (title.indexOf(rawQuery) === 0) return 50;
    if (title.indexOf(rawQuery) !== -1) return 30;

    var tokens = rawQuery.split(/\s+/).filter(Boolean);
    var haystackWords = haystack.split(/\s+/).filter(Boolean);
    var total = 0;

    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var matched = false;
      for (var j = 0; j < haystackWords.length; j++) {
        if (wordMatch(haystackWords[j], tok)) { matched = true; break; }
      }
      if (!matched) return 0;
      total += wordMatch(title, tok) ? 5 : 1;
    }
    return total;
  }

  function render(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '';
      return;
    }
    var matches = index
      .map(function (entry) { return { entry: entry, score: score(entry, q) }; })
      .filter(function (m) { return m.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, MAX_RESULTS);

    if (!matches.length) {
      results.innerHTML = '<p class="nav-search-empty">No results for &lsquo;' + escHtml(query) + '&rsquo;</p>';
      return;
    }

    results.innerHTML = matches.map(function (m) {
      var e = m.entry;
      return '<a class="nav-search-result" href="' + escHtml(e.url) + '">' +
        '<span class="nav-search-result-cat">' + escHtml(e.category) + '</span>' +
        '<span class="nav-search-result-title">' + escHtml(e.title) + '</span>' +
        (e.description ? '<span class="nav-search-result-desc">' + escHtml(e.description) + '</span>' : '') +
        '</a>';
    }).join('');
  }

  input.addEventListener('input', function () { render(input.value); });

  fetch('data/search-index.json', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (data) {
      if (Array.isArray(data)) index = index.concat(data);
    })
    .catch(function () {});

  // Owner Interviews join the search on their publish date (UK time), from
  // the same data/interviews.json that drives the homepage and blog.html.
  // ?date=YYYY-MM-DD previews a future date, as on those pages.
  function ukToday() {
    var m = /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(location.search);
    if (m) return m[1];
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  }

  // data/interview-search.json adds the words from each interview's mods
  // answers (scripts/build_interview_search.py), so a search for a mod
  // such as "Robot Hacker" finds the interview.
  function getJSON(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  Promise.all([getJSON('data/interviews.json'), getJSON('data/interview-search.json')])
    .then(function (results) {
      var data = results[0];
      var modWords = results[1] || {};
      var today = ukToday();
      ((data && data.interviews) || []).forEach(function (iv) {
        if (!iv || !iv.url || !iv.title || !iv.publish || iv.publish > today) return;
        var nickname = String(iv.title).split(':')[0];
        index.push({
          title: iv.title,
          url: iv.url,
          category: iv.type === 'track' ? 'Track Day Interview' : 'Owner Interview',
          description: [iv.name, iv.car, iv.year].filter(Boolean).join(' \u00b7 '),
          keywords: [iv.name, iv.car, iv.year, nickname, iv.excerpt, 'owner interview', 'interview', 'blog']
            .concat(iv.keywords || [], modWords[iv.url] ? [modWords[iv.url]] : []).filter(Boolean).map(String)
        });
      });
    })
    .catch(function () {});

  fetch(SHOP_ENDPOINT, { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (data && data.success && Array.isArray(data.products)) {
        data.products.forEach(function (p) {
          if (EXCLUDE_FROM_MERCH.indexOf(p.handle) !== -1) return;
          var price = p.minPrice != null ? '£' + Number(p.minPrice).toFixed(2) : '';
          index.push({
            title: p.title,
            url: 'shop.html#shop-item-' + p.handle,
            category: 'Shop',
            description: price ? ('From ' + price) : ''
          });
        });
      }
    })
    .catch(function () {});
})();
