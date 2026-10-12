// Entry point for the test copy (mt3uk-test, served at test.laps.mt3uk.com).
// Pages, scripts, styles and images (anything with a file extension, and the root path) come from the copy of the
// site. Everything else is an API call and goes to the same code as the live worker (../vote-worker.js), but on the
// test KV namespace and test R2 bucket, so test data never touches live members or boards.
import worker from '../vote-worker.js';

function isSiteFile(path) {
  return path === '/' || /\.[a-z0-9]+$/i.test(path);
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && isSiteFile(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
    return worker.fetch(request, env, ctx);
  },
};
