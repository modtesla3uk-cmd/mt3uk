# MT3UK site: notes for Claude

Static site for the MT3UK modified Tesla community, live at https://mt3uk.com. It is hosted on GitHub Pages and served through Cloudflare. A Cloudflare Worker (`workers/vote-worker.js`) handles votes, likes, comments, My Garage and the admin tools.

## Working rules

- **Ask before any commit or push.** Wait for an explicit yes each time. An earlier yes does not cover later changes, and an ambiguous instruction ("leave for now") is not permission.
- **Commit to `main`**, as there is no `dev` branch. If a push is rejected because the bots have added commits, rebase onto `origin/main` and push again. Never force-push.
- **The site is live.** A push to `main` deploys straight away, so verify changes locally first.
- **Run the tests** with `python -m pytest -q` (pytest-playwright, tests in `tests/`) before pushing. Afterwards, check the "Run Playwright tests" workflow with `gh run list`. If you change copy, prices or markup, search `tests/*.py` for the old text or selectors and update them in the same commit.
- **Check mobile as well as desktop** for any layout change. The main mobile breakpoint is `max-width: 780px`.
- **Never use em dashes** in site copy, commit messages or anything else. Use commas, colons, brackets or full stops.
- **Proofread new copy** for spelling before adding it.

## Worker

- `workers/vote-worker.js` deploys automatically through GitHub Actions on push to `main`, so there is no manual `wrangler deploy`.
- **Never use KV `list()` on a path hit per visitor or per page load.** Store data under a single JSON key and use `get()` instead. `list()` is only acceptable on admin or rarely hit endpoints. Search for `.list(` before committing worker changes and say you have checked.

## Site structure

- **No shared includes.** The nav, header and footer are copied into every page, so a menu change must be made in all of them and kept identical. The pages are `index`, `gallery`, `my-builds`, `shop`, `reviews`, `contact`, the three `track-day-*` pages, `blog` and the `blog-*` interview pages.
- **Line endings:** most HTML files use CRLF. Keep the existing line endings when editing.
- **Width:** content width comes from `--content-max: 1000px` through `.wrap`. Don't add new fixed page widths or scale it for wide screens.
- **Desktop layout:** centre short blocks inside a desktop-only `min-width` media query. Long-form text uses 2 columns with a dividing line. Never leave narrow text flush left on desktop.
- **NEW badge:** tag newly added nav links or sections with the `nav-sublink-new` badge, and remove it from anything it supersedes.

## Owner Interviews (blog)

- `data/interviews.json` drives the homepage hero, the next interview card, the interview list, the announcement bar and `blog.html`. What shows depends on the UK date and each entry's `publish` date. Add `?date=YYYY-MM-DD` to preview a future date.
- Each interview is a root-level `blog-<slug>.html` page. Its images live in `images/blog/owner-interviews/<slug>/`.
- For a new interview:
  - add its entry to `interviews.json`
  - add the page to `PAGES` in `generate_sitemap.py`
  - add the comments block: `<div class="ic" id="comments" data-thread="<slug>">` with `js/interview-comments.js`
- Comments run in demo mode on localhost, stored in localStorage. Add `?comments=live` to use the real worker.

## Shop

- The Tee card and modal are the template for new products. Zoomable product images use the hold-to-pan zoom in shop.html (`panTargets`, `.zoom-pan`), which zooms back out on release. Never use a plain CSS hover zoom or a link.
- Order buttons always get UTM parameters: `?utm_source=mt3uk_shop&utm_medium=internal&utm_campaign=<product>_order`. Ask whether the product needs a sold counter (`data/merch-sales.json`) and never invent the numbers.
- The promo banner is currently commented out on each page and kept for the next offer. Re-enable it rather than rebuilding it.
