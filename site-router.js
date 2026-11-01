// Entry point for the mt3uk Worker, which serves the site's files from the repo
// on mt3uk.com and laps.mt3uk.com. Most paths are static files and go straight to
// the assets. A few paths are answered by the vote worker (late-darkness-ebc8),
// bound as VOTE in wrangler.jsonc. Those paths must also be listed under
// assets.run_worker_first so this script runs for them.
const VOTE_PATHS = new Set(['/share/add']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (VOTE_PATHS.has(url.pathname)) return env.VOTE.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
