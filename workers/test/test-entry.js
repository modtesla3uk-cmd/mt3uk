// Entry point for the test copy (mt3uk-test, served at test.laps.mt3uk.com).
// Pages, scripts, styles and images (anything with a file extension, and the root path) come from the copy of the
// site. Everything else is an API call and goes to the same code as the live worker (../vote-worker.js), but on the
// test KV namespace and test R2 bucket, so test data never touches live members or boards.
import worker from '../vote-worker.js';

function isSiteFile(path) {
  return path === '/' || /\.[a-z0-9]+$/i.test(path);
}

// A banner on every page of the test copy. Added here, on the way out, so the site files stay the same as live and
// the live worker never gets it.
var TEST_BANNER = '<div id="mt3uk-test-banner" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#e8572a;color:#fff;font:700 13px/1.4 system-ui,sans-serif;text-align:center;padding:6px 10px;box-shadow:0 -2px 8px rgba(0,0,0,.2)">This is the Test Site for Laps</div>';

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && isSiteFile(url.pathname)) {
      var res = await env.ASSETS.fetch(request);
      if ((res.headers.get('content-type') || '').indexOf('text/html') === 0) {
        return new HTMLRewriter().on('body', {
          element(el) { el.append(TEST_BANNER, { html: true }); },
        }).transform(res);
      }
      return res;
    }
    return worker.fetch(request, env, ctx);
  },
};
