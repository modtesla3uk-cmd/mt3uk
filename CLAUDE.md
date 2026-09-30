# MT3UK site: notes for Claude

Static site for the MT3UK modified Tesla community, live at https://mt3uk.com. It is hosted on GitHub Pages and served through Cloudflare. A Cloudflare Worker (`workers/vote-worker.js`) handles votes, likes, comments, My Garage and the admin tools.

## Working rules

- **Ask before any commit or push.** Wait for an explicit yes each time. An earlier yes does not cover later changes, and an ambiguous instruction ("leave for now") is not permission.
- **Commit to `main`**, as there is no `dev` branch. If a push is rejected because the bots have added commits, rebase onto `origin/main` and push again. Never force-push.
- **The site is live.** A push to `main` deploys straight away, so verify changes locally first.
- **Run the tests** with `python -m pytest -q` (pytest-playwright, tests in `tests/`, about 3 minutes). Afterwards, check the "Run Playwright tests" workflow with `gh run list`. If you change copy, prices or markup, search `tests/*.py` for the old text or selectors and update them in the same commit.
  - **Ask before running the full suite**, in case more changes are coming. One run covers everything waiting to be pushed.
  - **Bigger changes** (the worker, sign-in, likes, comments, uploads, anything members use to do things): run the full suite before pushing.
  - **Small changes** (wording, colours, fonts, layout tweaks): a browser check on phone and desktop is enough before pushing. The GitHub test run covers the rest.
- **Check mobile as well as desktop** for any layout change. The main mobile breakpoint is `max-width: 780px`.
- **Never use em dashes** in site copy, commit messages or anything else. Use commas, colons, brackets or full stops.
- **Proofread new copy** for spelling before adding it.

## Worker

- `workers/vote-worker.js` deploys automatically through GitHub Actions on push to `main`, so there is no manual `wrangler deploy`.
- **Never use KV `list()` on a path hit per visitor or per page load.** Store data under a single JSON key and use `get()` instead. `list()` is only acceptable on admin or rarely hit endpoints. Search for `.list(` before committing worker changes and say you have checked.

## Site structure

- **Shared header and footer.** The menu, search and footer live in `partials/header.html` and `partials/footer.html`, with their styles in `css/site-header.css`. Edit those, never the copies in each page, then run `python scripts/build_layout.py` to copy them into every page. It also marks each page's active menu link (the `PAGES` map in the script) and turns links to a page's own sections into `#` links. `tests/test_layout.py` fails if a page has drifted. A new public page needs adding to `PAGES` there and in `tests/test_shop_section.py`. It also needs `js/notify-bell.js`, `js/messenger.js` and `js/signin-prompt.js` loaded (the bell, chat and profile icons in the header).
- **Share buttons.** `js/share.js` adds a round share button to each page heading and section heading (`<section id>` with an `<h2>`, or `data-share-anchor`). Each links to a share page in `share/section/` with its own preview photo and intro text, written by `scripts/build_section_share_pages.py`. The sync workflow runs it, but after adding or renaming a section run it yourself, as `tests/test_layout.py` fails if a share page is missing. Use `data-share-image="images/..."` on a section to choose its preview photo.
- **Site search.** Pages and sections are listed in `data/search-index.json`; add an entry for any new page or section (`tests/test_search_index.py` fails otherwise). Owner Interviews are added to search automatically by `js/search.js` from `data/interviews.json` on their publish date. Their mods are searchable through `data/interview-search.json`: run `python scripts/build_interview_search.py` after adding or editing an interview.
- **Pages:** `index`, `gallery`, `my-builds`, `shop`, `reviews`, `contact`, the three `track-day-*` pages, `blog` and the `blog-*` interview pages. Each keeps its own `<style>` for everything below the header.
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
  - add the page to `PAGES` in `scripts/build_layout.py` (active link `blog.html`), then run the script to give it the shared header and footer
  - run `python scripts/build_interview_search.py` so its mods are searchable
  - add the comments block: `<div class="ic" id="comments" data-thread="<slug>">` with `js/interview-comments.js`
  - add `<script src="js/interview-gate.js"></script>` in the `<head>`, after the viewport meta. Until the publish date the page asks for a one-time code, which anyone can have emailed, like Sign In. A code opens it for 4 hours (and makes that email a member if it is not one already). The admin page (Interview previews) lists who has opened each one and can revoke access. The gate is off on localhost; add `?gate=on` to try it.
- Comments run in demo mode on localhost, stored in localStorage. Add `?comments=live` to use the real worker.

## Event pages

- `event-template.html` is the template. Copy it to `event-<slug>.html` and follow the how-to comment at the top. Images are striped `.ph` placeholders that say their size.
- `data/event-pages.json` lists every event page as a draft (`"draft": true`) or with a `publish` date (UK time). Add an entry for each new page (name, title, tagline, url, image, startDate, endDate, location, created).
- `js/event-gate.js` (in each page's `<head>`) shows only a Coming soon card until the publish date. Only the admin can open it early: **Event pages** on `events-admin.html` has Preview (a one-time link, 4 hours), Publish now, Schedule and Draft. There is no public code or sign-up. A page not listed in the file, or a failed read of the file, stays hidden. The gate is off on localhost; add `?gate=on` to try it.
- Published events are featured on the homepage Events section (image and tagline) until `endDate` has passed.
- Worker routes are under `/events/pages/`. Tests: `tests/test_event_pages.py`.

## Shop

- The Tee card and modal are the template for new products. Zoomable product images use the hold-to-pan zoom in shop.html (`panTargets`, `.zoom-pan`), which zooms back out on release. Never use a plain CSS hover zoom or a link.
- Order buttons always get UTM parameters: `?utm_source=mt3uk_shop&utm_medium=internal&utm_campaign=<product>_order`. Ask whether the product needs a sold counter (`data/merch-sales.json`) and never invent the numbers.
- The promo banner is currently commented out on each page and kept for the next offer. Re-enable it rather than rebuilding it.
