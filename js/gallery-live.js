/*
  New uploads straight away. The site's photo list
  (images/gallery/manifest.json) is rebuilt by a GitHub workflow a minute or
  two after an upload, so the pages also ask the worker's live list
  (/gallery/live, cached for 15 seconds) and put any photos it has that the
  manifest doesn't yet at the top. If the worker is slow or unreachable, the
  manifest is used as it is.

  window.mt3ukWithLivePhotos(manifestPromise) -> Promise of the photo list.
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var WAIT_MS = 2000;

  function live() {
    var request = fetch(API + '/gallery/live', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { return data && data.success && Array.isArray(data.photos) ? data.photos : null; })
      .catch(function () { return null; });
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, WAIT_MS); });
    return Promise.race([request, timeout]);
  }

  window.mt3ukWithLivePhotos = function (manifestPromise) {
    return Promise.all([manifestPromise, live()]).then(function (r) {
      var photos = Array.isArray(r[0]) ? r[0] : null;
      var fresh = r[1];
      if (!photos) return fresh || r[0];
      if (!fresh) return photos;
      var known = {};
      photos.forEach(function (p) { known[p.file] = true; });
      var added = fresh.filter(function (p) { return !known[p.file]; });
      return added.length ? added.concat(photos) : photos;
    });
  };
})();
