/*
  Likes and comments in the Full Gallery, the same as the build reel on the
  homepage (the same worker endpoints, so a like or comment shows in both).

  window.mt3ukGallerySocial:
  - decorate(root)            adds the like and comment counts to each
                              .gallery-slot[data-file] tile
  - mount(lightbox, imgEl)    adds the Like / Comments bar, "Liked by" and the
                              comments panel to the photo viewer; returns
                              { show(file), reset() }

  Liking, liking a comment and reporting a comment need a sign-in
  (js/signin-prompt.js shows the sign-in dialog).
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var DOUBLE_TAP_MS = 350;
  var HEART = 'M12 21s-7.5-4.6-10.2-9.3C-0.2 8 1.4 3.9 5.3 3.2 7.7 2.8 10 3.9 12 6.4c2-2.5 4.3-3.6 6.7-3.2 3.9.7 5.5 4.8 3.5 8.5C19.5 16.4 12 21 12 21z';
  var BUBBLE = 'M4 4h16v12H7l-3 3z';

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function session() { return read('mt3ukMyBuildsSession'); }

  var voterId = read('mt3ukVoterId');
  if (!voterId) {
    voterId = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : ('v-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    write('mt3ukVoterId', voterId);
  }

  function headers(extra) {
    var h = extra || {};
    h['X-Voter-Id'] = voterId;
    var token = session();
    if (token) h['X-Session-Token'] = token;
    return h;
  }

  function signedIn(action) {
    if (session()) return true;
    if (window.mt3ukShowSignIn) window.mt3ukShowSignIn(action);
    else window.location.href = 'signin.html?next=' + encodeURIComponent('/gallery.html');
    return false;
  }
  function signInExpired(action) {
    try { localStorage.removeItem('mt3ukMyBuildsSession'); } catch (e) {}
    if (window.mt3ukShowSignIn) window.mt3ukShowSignIn(action);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function svg(cls, path) { return '<svg viewBox="0 0 24 24" class="' + cls + '" aria-hidden="true"><path d="' + path + '"/></svg>'; }
  function timeAgo(iso) {
    var secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
    if (secs < 86400 * 7) return Math.floor(secs / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }

  // Per-photo state, keyed by file name.
  var likeMap = {};
  var commentCounts = {};
  var likersCache = {};
  var reportedComments = [];
  try { reportedComments = JSON.parse(read('mt3ukReportedComments') || '[]'); } catch (e) {}

  var loaded = Promise.all([
    fetch(API + '/likes', { headers: headers({}), cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; }),
    fetch(API + '/comment-counts', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; })
  ]).then(function (r) {
    var likes = r[0] && r[0].success ? r[0] : null;
    if (likes) {
      Object.keys(likes.likes || {}).forEach(function (file) {
        likeMap[file] = { count: likes.likes[file] || 0, liked: (likes.liked || []).indexOf(file) !== -1 };
      });
      (likes.liked || []).forEach(function (file) {
        if (!likeMap[file]) likeMap[file] = { count: 1, liked: true };
      });
    }
    commentCounts = (r[1] && r[1].success && r[1].counts) || {};
  });

  function likeState(file) { return likeMap[file] || { count: 0, liked: false }; }

  // ---------- Tiles ----------
  function tileHtml(file) {
    var likes = likeState(file).count;
    var comments = commentCounts[file] || 0;
    if (!likes && !comments) return '';
    return (likes ? '<span class="gs-tile-stat">' + svg('gs-tile-heart', HEART) + likes + '</span>' : '') +
      (comments ? '<span class="gs-tile-stat">' + svg('gs-tile-bubble', BUBBLE) + comments + '</span>' : '');
  }
  function decorate(root) {
    (root || document).querySelectorAll('.gallery-slot.filled[data-file]').forEach(function (slot) {
      var html = tileHtml(slot.getAttribute('data-file'));
      var el = slot.querySelector('.gs-tile');
      if (!html) { if (el) el.remove(); return; }
      if (!el) {
        el = document.createElement('span');
        el.className = 'gs-tile';
        slot.appendChild(el);
      }
      el.innerHTML = html;
    });
  }
  loaded.then(function () { decorate(document); });

  // ---------- Styles ----------
  var style = document.createElement('style');
  style.textContent = [
    '.gs-tile{position:absolute;right:6px;bottom:6px;z-index:2;display:flex;gap:8px;padding:3px 8px;border-radius:999px;background:rgba(22,35,61,0.78);color:#fff;font:600 0.7rem/1.4 "IBM Plex Sans",sans-serif;pointer-events:none}',
    '.gallery-slot:has(.gs-tile) .g-caption{padding-right:92px}',
    '.gs-tile-stat{display:inline-flex;align-items:center;gap:3px}',
    '.gs-tile svg{width:12px;height:12px}',
    '.gs-tile-heart{fill:#e8542a}',
    '.gs-tile-bubble{fill:none;stroke:#fff;stroke-width:2.2;stroke-linejoin:round}',
    '.gs-panel{width:min(92vw,640px);margin-top:14px;background:#fff;color:var(--ink);border-radius:14px;padding:10px 14px 12px;font-family:"IBM Plex Sans",sans-serif;text-align:left;flex-shrink:0}',
    '.gs-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.gs-btn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:6px 10px;border:0;border-radius:8px;background:none;color:var(--ink);font:600 0.9rem "IBM Plex Sans",sans-serif;cursor:pointer}',
    '.gs-btn:hover{background:rgba(22,35,61,0.06)}',
    '.gs-btn svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}',
    '.gs-like[aria-pressed="true"]{color:#e8542a}',
    '.gs-like[aria-pressed="true"] svg{fill:currentColor;animation:gs-pulse 360ms ease}',
    '.gs-comments-btn.gs-has{color:#e8542a}',
    '@keyframes gs-pulse{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}',
    '.gs-liked-by{border:0;background:none;padding:4px 6px;margin-left:auto;color:var(--steel);font:0.84rem "IBM Plex Sans",sans-serif;cursor:pointer;text-align:right}',
    '.gs-liked-by strong{color:var(--ink);font-weight:600}',
    '.gs-liked-by[hidden],.gs-section[hidden]{display:none}',
    '.gs-section{border-top:1px solid rgba(22,35,61,0.12);margin-top:8px;padding-top:10px;display:flex;flex-direction:column;gap:10px}',
    '.gs-section-title{margin:0;font-weight:700;font-size:0.95rem}',
    '.gs-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}',
    '.gs-likers li{display:flex;align-items:center;gap:12px}',
    '.gs-note,.gs-empty{color:var(--steel);font-size:0.86rem}',
    '.gs-avatar{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:700}',
    '.gs-replies .gs-avatar{width:28px;height:28px;font-size:0.68rem}',
    '.gs-name{font-weight:600;font-size:0.88rem}',
    '.gs-when{font-weight:400;font-size:0.74rem;color:var(--steel);margin-left:4px;white-space:nowrap}',
    '.gs-comment{display:flex;align-items:flex-start;gap:10px}',
    '.gs-comment-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.gs-comment-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
    '.gs-comment-text{margin:0;font-size:0.92rem;line-height:1.45;word-break:break-word}',
    '.gs-comment-actions{display:flex;align-items:center;gap:14px;margin-top:2px}',
    '.gs-comment-actions button,.gs-report{background:none;border:0;padding:4px 0;color:var(--steel);font:500 0.78rem "IBM Plex Sans",sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:4px}',
    '.gs-comment-actions button:hover,.gs-report:hover{color:var(--ink)}',
    '.gs-comment-like svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.gs-comment-like[aria-pressed="true"]{color:#e8542a}',
    '.gs-comment-like[aria-pressed="true"] svg{fill:currentColor}',
    '.gs-delete.gs-confirm{color:#e8542a}',
    '.gs-report[disabled]{cursor:default}',
    '.gs-replies{list-style:none;margin:8px 0 0;padding:0 0 0 16px;border-left:1px solid rgba(22,35,61,0.15);display:flex;flex-direction:column;gap:10px}',
    '.gs-reply-slot:not([hidden]){margin-top:8px}',
    '.gs-form{display:flex;flex-direction:column;gap:6px;border-top:1px solid rgba(22,35,61,0.12);padding-top:8px}',
    '.gs-reply-slot .gs-form{border-top:0;padding-top:0}',
    '.gs-as{margin:0;font-size:0.78rem;color:var(--steel)}',
    '.gs-form textarea{min-height:44px;background:rgba(22,35,61,0.05);border:1px solid rgba(22,35,61,0.2);color:var(--ink);font-family:"IBM Plex Sans",sans-serif;font-size:16px;padding:8px 12px;border-radius:12px;resize:vertical}',
    '.gs-submit{align-self:flex-end;background:#e8542a;color:#fff;border:0;border-radius:8px;padding:8px 18px;font:600 0.85rem "IBM Plex Sans",sans-serif;cursor:pointer}',
    '.gs-submit[disabled]{opacity:0.5;cursor:default}',
    '.gs-error{margin:0;color:#c0392b;font-size:0.8rem}',
    '.gs-signin{margin:0;font-size:0.88rem;color:var(--steel);border-top:1px solid rgba(22,35,61,0.12);padding-top:8px}',
    '.gs-signin a{color:#e8542a;text-decoration:underline}',
    // The viewer scrolls if the bar doesn't fit, and with comments open the
    // photo gives up some room.
    '.lightbox{overflow-y:auto;justify-content:safe center}',
    '.lightbox .lightbox-img{max-height:min(78vh,calc(100dvh - 190px))}',
    '.lightbox.gs-open{justify-content:flex-start;overflow-y:auto;padding-top:64px}',
    '.lightbox.gs-open .lightbox-img{max-height:45vh;flex-shrink:0}',
    '.lightbox.gs-open .lightbox-nav{top:calc(64px + 22vh)}',
    // On phones the arrows would sit over the comments, so they're hidden
    // while the comments are open.
    '@media (max-width: 700px){.lightbox.gs-open .lightbox-nav{display:none}}',
    '.gs-burst{position:fixed;left:50%;top:40%;width:96px;height:96px;margin:-48px 0 0 -48px;fill:#fff;opacity:0;pointer-events:none;z-index:210}',
    '.gs-burst.gs-go{animation:gs-burst 700ms ease}',
    '@keyframes gs-burst{0%{opacity:0;transform:scale(0.6)}25%{opacity:0.95;transform:scale(1.1)}70%{opacity:0.9;transform:scale(1)}100%{opacity:0;transform:scale(1.2)}}',
    '@media (prefers-reduced-motion: reduce){.gs-like svg,.gs-burst{animation:none!important}}'
  ].join('');
  document.head.appendChild(style);

  // ---------- Viewer ----------
  function mount(lightbox, imgEl) {
    var panel = document.createElement('div');
    panel.className = 'gs-panel';
    panel.innerHTML =
      '<div class="gs-bar">' +
        '<button type="button" class="gs-btn gs-like" aria-pressed="false" aria-label="Like">' + svg('', HEART) + '<span class="gs-like-count">0</span></button>' +
        '<button type="button" class="gs-btn gs-comments-btn" aria-expanded="false" aria-label="Comments">' + svg('', BUBBLE) + '<span class="gs-comment-count">Comment</span></button>' +
        '<button type="button" class="gs-liked-by" hidden></button>' +
      '</div>' +
      '<div class="gs-section gs-likers-section" hidden>' +
        '<p class="gs-section-title">Liked by</p>' +
        '<ul class="gs-list gs-likers"></ul>' +
      '</div>' +
      '<div class="gs-section gs-comments-section" hidden>' +
        '<p class="gs-section-title">Comments</p>' +
        '<ul class="gs-list gs-comments"></ul>' +
        '<div class="gs-form-slot"></div>' +
      '</div>';
    var anchor = lightbox.querySelector('.lightbox-mods') || imgEl;
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    var burst = document.createElement('div');
    burst.innerHTML = svg('gs-burst', HEART);
    burst = burst.firstChild;
    lightbox.appendChild(burst);

    var likeBtn = panel.querySelector('.gs-like');
    var commentsBtn = panel.querySelector('.gs-comments-btn');
    var likedByBtn = panel.querySelector('.gs-liked-by');
    var likersSection = panel.querySelector('.gs-likers-section');
    var likersList = panel.querySelector('.gs-likers');
    var commentsSection = panel.querySelector('.gs-comments-section');
    var list = panel.querySelector('.gs-comments');
    var formSlot = panel.querySelector('.gs-form-slot');
    var file = null;
    var comments = [];
    var pending = false;

    function syncOpen() {
      lightbox.classList.toggle('gs-open', !commentsSection.hidden || !likersSection.hidden);
    }

    function syncBar() {
      var s = likeState(file);
      likeBtn.setAttribute('aria-pressed', s.liked ? 'true' : 'false');
      likeBtn.setAttribute('aria-label', s.liked ? 'Unlike' : 'Like');
      panel.querySelector('.gs-like-count').textContent = String(s.count);
      var n = commentCounts[file] || 0;
      commentsBtn.classList.toggle('gs-has', n > 0);
      panel.querySelector('.gs-comment-count').textContent = n ? String(n) : 'Comment';
      renderLikedBy();
    }

    function fetchLikers(f) {
      if (likersCache[f]) return Promise.resolve(likersCache[f]);
      return fetch(API + '/likes/who?file=' + encodeURIComponent(f), { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || !data.success) throw new Error('load');
          likersCache[f] = data;
          return data;
        });
    }

    function renderLikedBy() {
      var count = likeState(file).count;
      if (!count) { likedByBtn.hidden = true; return; }
      likedByBtn.hidden = false;
      var data = likersCache[file];
      var first = data && data.likers && data.likers[0];
      if (!first) {
        likedByBtn.textContent = count + ' like' + (count === 1 ? '' : 's');
        if (!data) {
          var f = file;
          fetchLikers(f).then(function () { if (file === f) renderLikedBy(); }).catch(function () {});
        }
        return;
      }
      var others = Math.max(count, data.count) - 1;
      likedByBtn.innerHTML = 'Liked by <strong>' + escapeHtml(first.name) + '</strong>' +
        (others > 0 ? ' and <strong>' + others + ' other' + (others === 1 ? '' : 's') + '</strong>' : '');
    }

    function openLikers() {
      commentsSection.hidden = true;
      commentsBtn.setAttribute('aria-expanded', 'false');
      if (!likersSection.hidden) { likersSection.hidden = true; syncOpen(); return; }
      likersSection.hidden = false;
      syncOpen();
      likersList.innerHTML = '<li class="gs-note">Loading&hellip;</li>';
      var f = file;
      fetchLikers(f).then(function (data) {
        if (file !== f) return;
        var rows = (data.likers || []).map(function (l) {
          return '<li><span class="gs-avatar" aria-hidden="true">' + escapeHtml(initials(l.name)) + '</span>' +
            '<span><span class="gs-name">' + escapeHtml(l.name) + '</span><br><span class="gs-when">' + timeAgo(l.at) + '</span></span></li>';
        });
        if (data.earlier) {
          rows.push('<li class="gs-note">' + (rows.length ? '+ ' : '') + data.earlier + ' earlier like' + (data.earlier === 1 ? '' : 's') + ' from before likes showed names</li>');
        }
        likersList.innerHTML = rows.length ? rows.join('') : '<li class="gs-note">No likes yet. Be the first!</li>';
      }).catch(function () {
        likersList.innerHTML = '<li class="gs-note">Could not load likes, please try again.</li>';
      });
    }

    function toggleLike(withBurst) {
      if (pending || !file) return;
      if (!signedIn('like photos')) return;
      var f = file;
      var state = likeMap[f] || (likeMap[f] = { count: 0, liked: false });
      var liked = !state.liked;
      state.liked = liked;
      state.count = liked ? state.count + 1 : Math.max(0, state.count - 1);
      syncBar();
      if (liked && withBurst) {
        burst.classList.remove('gs-go');
        void burst.getBoundingClientRect();
        burst.classList.add('gs-go');
      }
      pending = true;
      fetch(API + '/likes', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ file: f })
      }).then(function (res) {
        if (res.status === 401) {
          state.liked = !liked;
          state.count = liked ? Math.max(0, state.count - 1) : state.count + 1;
          if (file === f) syncBar();
          signInExpired('like photos');
          return null;
        }
        return res.ok ? res.json() : null;
      }).then(function (data) {
        if (data && data.success) {
          likeMap[f] = { count: data.count, liked: data.liked };
          delete likersCache[f];
          if (file === f) syncBar();
        }
        decorate(document);
      }).catch(function () {}).then(function () { pending = false; });
    }

    // ----- Comments -----
    function tree(items) {
      var byId = {};
      items.forEach(function (c) { byId[c.id] = Object.assign({}, c, { children: [] }); });
      var roots = [];
      items.forEach(function (c) {
        if (c.parentId && byId[c.parentId]) byId[c.parentId].children.push(byId[c.id]);
        else roots.push(byId[c.id]);
      });
      return roots;
    }

    function commentHtml(c) {
      var reported = reportedComments.indexOf(c.id) !== -1;
      return '<li class="gs-comment" data-id="' + escapeHtml(c.id) + '">' +
        '<span class="gs-avatar" aria-hidden="true">' + escapeHtml(initials(c.name)) + '</span>' +
        '<div class="gs-comment-body">' +
          '<div class="gs-comment-head">' +
            '<span class="gs-name">' + escapeHtml(c.name) + (c.createdAt ? ' <span class="gs-when">' + timeAgo(c.createdAt) + '</span>' : '') + '</span>' +
            (c.mine ? '' : '<button type="button" class="gs-report"' + (reported ? ' disabled' : '') + '>' + (reported ? 'Reported' : 'Report') + '</button>') +
          '</div>' +
          '<p class="gs-comment-text">' + escapeHtml(c.text) + '</p>' +
          '<div class="gs-comment-actions">' +
            '<button type="button" class="gs-comment-like" aria-pressed="' + (c.liked ? 'true' : 'false') + '" aria-label="Like this comment">' + svg('', HEART) + '<span class="gs-comment-like-count">' + (c.likes || 0) + '</span></button>' +
            '<button type="button" class="gs-reply">Reply</button>' +
            (c.mine ? '<button type="button" class="gs-delete">Delete</button>' : '') +
          '</div>' +
          '<div class="gs-reply-slot" hidden data-parent-id="' + escapeHtml(c.id) + '"></div>' +
          (c.children.length ? '<ul class="gs-replies">' + c.children.map(commentHtml).join('') + '</ul>' : '') +
        '</div>' +
      '</li>';
    }

    function formHtml(slot, parentId) {
      var email = window.mt3ukMyBuildsEmail || (session() ? read('mt3ukMyBuildsEmail') : '');
      if (!email) {
        slot.innerHTML = '<p class="gs-signin"><a href="signin.html?next=' + encodeURIComponent('/gallery.html') + '">Join free or sign in</a> to leave a comment.</p>';
        return;
      }
      var name = window.mt3ukMyBuildsName || read('mt3ukMyBuildsFirstName') || email.split('@')[0];
      slot.innerHTML =
        '<form class="gs-form" data-parent-id="' + escapeHtml(parentId || '') + '" data-email="' + escapeHtml(email) + '">' +
          '<p class="gs-as">Commenting as ' + escapeHtml(name) + '</p>' +
          '<textarea class="gs-text" aria-label="' + (parentId ? 'Your reply' : 'Your comment') + '" placeholder="' + (parentId ? 'Write a reply&hellip;' : 'Write a comment&hellip;') + '" required maxlength="500"></textarea>' +
          '<p class="gs-error" hidden></p>' +
          '<button type="submit" class="gs-submit">' + (parentId ? 'Post reply' : 'Post comment') + '</button>' +
        '</form>';
    }

    function loadComments() {
      var f = file;
      list.innerHTML = '<li class="gs-empty">Loading&hellip;</li>';
      fetch(API + '/comments?file=' + encodeURIComponent(f), { cache: 'no-store', headers: headers({}) })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (file !== f) return;
          comments = (data && data.success && data.comments) || [];
          commentCounts[f] = comments.length;
          list.innerHTML = comments.length ? tree(comments).map(commentHtml).join('') : '<li class="gs-empty">No comments yet, be the first.</li>';
          syncBar();
          decorate(document);
        })
        .catch(function () {
          if (file === f) list.innerHTML = '<li class="gs-empty">Could not load comments.</li>';
        });
    }

    function openComments() {
      likersSection.hidden = true;
      if (!commentsSection.hidden) {
        commentsSection.hidden = true;
        commentsBtn.setAttribute('aria-expanded', 'false');
        syncOpen();
        return;
      }
      commentsSection.hidden = false;
      commentsBtn.setAttribute('aria-expanded', 'true');
      syncOpen();
      formHtml(formSlot, null);
      loadComments();
    }

    likeBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleLike(false); });
    commentsBtn.addEventListener('click', function (e) { e.stopPropagation(); openComments(); });
    likedByBtn.addEventListener('click', function (e) { e.stopPropagation(); openLikers(); });

    // Double tap (or double click) the photo to like it, as in the reel.
    var lastTap = 0;
    imgEl.addEventListener('click', function () {
      var now = Date.now();
      if (now - lastTap < DOUBLE_TAP_MS) {
        lastTap = 0;
        if (!likeState(file).liked) toggleLike(true);
        else { burst.classList.remove('gs-go'); void burst.getBoundingClientRect(); burst.classList.add('gs-go'); }
      } else {
        lastTap = now;
      }
    });

    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      var btn;
      if ((btn = e.target.closest('.gs-report')) && !btn.disabled) {
        var rid = btn.closest('.gs-comment').dataset.id;
        if (!signedIn('report comments')) return;
        btn.disabled = true;
        btn.textContent = 'Reported';
        fetch(API + '/comments/report', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ file: file, id: rid })
        }).then(function (res) {
          if (res.status === 401) {
            btn.disabled = false;
            btn.textContent = 'Report';
            signInExpired('report comments');
          }
        }).catch(function () {});
        reportedComments.push(rid);
        write('mt3ukReportedComments', JSON.stringify(reportedComments));
        return;
      }
      if ((btn = e.target.closest('.gs-delete'))) {
        var did = btn.closest('.gs-comment').dataset.id;
        if (!btn.classList.contains('gs-confirm')) {
          btn.classList.add('gs-confirm');
          btn.textContent = 'Confirm delete?';
          setTimeout(function () { btn.classList.remove('gs-confirm'); btn.textContent = 'Delete'; }, 4000);
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        fetch(API + '/comments/mine?file=' + encodeURIComponent(file) + '&id=' + encodeURIComponent(did), {
          method: 'DELETE',
          headers: { 'X-Session-Token': session() || '' }
        }).then(function (res) { return res.json(); }).then(function (data) {
          if (data && data.success) { loadComments(); return; }
          throw new Error('delete');
        }).catch(function () {
          btn.disabled = false;
          btn.classList.remove('gs-confirm');
          btn.textContent = 'Delete';
        });
        return;
      }
      if ((btn = e.target.closest('.gs-comment-like'))) {
        var lid = btn.closest('.gs-comment').dataset.id;
        if (!signedIn('like comments')) return;
        var countEl = btn.querySelector('.gs-comment-like-count');
        var liked = btn.getAttribute('aria-pressed') !== 'true';
        var count = parseInt(countEl.textContent, 10) || 0;
        btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
        countEl.textContent = String(liked ? count + 1 : Math.max(0, count - 1));
        fetch(API + '/comments/like', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ file: file, id: lid })
        }).then(function (res) {
          if (res.status === 401) {
            btn.setAttribute('aria-pressed', liked ? 'false' : 'true');
            countEl.textContent = String(count);
            signInExpired('like comments');
            return null;
          }
          return res.ok ? res.json() : null;
        }).then(function (data) {
          if (data && data.success) {
            btn.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
            countEl.textContent = String(data.likes);
          }
        }).catch(function () {});
        return;
      }
      if ((btn = e.target.closest('.gs-reply'))) {
        var slot = btn.closest('.gs-comment').querySelector(':scope > .gs-comment-body > .gs-reply-slot');
        if (!slot.dataset.rendered) {
          slot.dataset.rendered = '1';
          formHtml(slot, slot.dataset.parentId);
        }
        slot.hidden = !slot.hidden;
        var ta = slot.querySelector('textarea');
        if (!slot.hidden && ta) ta.focus();
      }
    });

    // On a computer, Return posts and Shift+Return starts a new line.
    // Phones keep Return for new lines. Keys typed here never reach the
    // viewer's arrow-key and Escape shortcuts.
    panel.addEventListener('keydown', function (e) {
      if (!e.target.closest('textarea')) return;
      e.stopPropagation();
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      e.preventDefault();
      var form = e.target.closest('form');
      var submit = form.querySelector('.gs-submit');
      if (e.target.value.trim() && !submit.disabled) {
        if (form.requestSubmit) form.requestSubmit(); else submit.click();
      }
    });

    panel.addEventListener('submit', function (e) {
      var form = e.target.closest('form');
      if (!form) return;
      e.preventDefault();
      var errorEl = form.querySelector('.gs-error');
      var textEl = form.querySelector('.gs-text');
      var submit = form.querySelector('.gs-submit');
      var text = textEl.value.trim();
      if (!form.dataset.email || !text) return;
      errorEl.hidden = true;
      submit.disabled = true;
      fetch(API + '/comments', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ file: file, email: form.dataset.email, text: text, parentId: form.dataset.parentId || null })
      }).then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      }).then(function (r) {
        if (r.status === 401) {
          signInExpired('comment');
          errorEl.textContent = 'Please sign in again to comment.';
          errorEl.hidden = false;
        } else if (r.ok && r.data && r.data.success) {
          textEl.value = '';
          var replySlot = form.closest('.gs-reply-slot');
          if (replySlot) replySlot.hidden = true;
          loadComments();
        } else {
          errorEl.textContent = (r.data && r.data.message) || 'Could not post comment.';
          errorEl.hidden = false;
        }
      }).catch(function () {
        errorEl.textContent = 'Could not post comment.';
        errorEl.hidden = false;
      }).then(function () { submit.disabled = false; });
    });

    function reset() {
      commentsSection.hidden = true;
      likersSection.hidden = true;
      commentsBtn.setAttribute('aria-expanded', 'false');
      list.innerHTML = '';
      comments = [];
      syncOpen();
    }

    return {
      show: function (f) {
        file = f;
        reset();
        syncBar();
        loaded.then(function () { if (file === f) syncBar(); });
      },
      reset: reset
    };
  }

  window.mt3ukGallerySocial = { decorate: decorate, mount: mount };
})();
