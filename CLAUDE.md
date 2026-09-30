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
- **Modern styling.** All new work uses the shared look in `css/site-header.css` (the "Shared look" block), not the old typewriter style:
  - Soft corners from `--radius` (10px), `--radius-sm` (8px) and `--radius-pill`. Light borders from `--hairline` and `--hairline-strong` rather than heavy ink lines.
  - IBM Plex Sans (`--font-body`) in normal capitals for buttons, labels, dates, badges and captions. Headings stay Archivo Expanded (`--font-head`). **Never use IBM Plex Mono (the typewriter font) or all-caps labels** in new or refreshed work.
  - Buttons: `.btn` plus `.btn-primary` (navy), `.btn-accent` (orange), `.btn-secondary`, `.btn-ghost` or `.btn-danger` (red, for Delete), with `.btn-sm` and `.btn-block`. Touch targets are at least 44px. Fields use `.field`, filters and tags use `.chip` (`.is-on` when selected), and boxes use `.card`.
  - Icons are inline line SVGs: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">…</svg>`. Never use text characters as icons (`&times;`, `&larr;`, `&lsaquo;`, `&rsaquo;`, `&#9662;`, `▼`). On/off settings are switches, not checkboxes.
  - Pages move onto it a batch at a time. The refreshed ones are listed in `REFRESHED` in `tests/test_style.py`, which fails if they bring back the typewriter font or text-character icons. When you refresh a page, or make a new one, add it to that list. When editing a page that hasn't been refreshed yet, use the modern style for anything new and ask whether to refresh the rest of the page.
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

- One page, `event.html?e=<slug>`, shows every event. `js/event-page.js` draws it from that event's entry in `data/event-pages.json` (title, tagline, dates and times, venue, images, description, tickets, running order, FAQ). A section with nothing in it is left out, and a draft shows striped image placeholders. There is no per-event HTML file to copy.
- **Make and edit events on `events-admin.html`** (Event pages): a form for every field, image uploads (shrunk in the browser, stored in the R2 bucket under `events/<slug>/`), Save, Preview, Publish now, Schedule, Draft and Delete (not while live). Do not hand-edit the JSON unless you have to. Entries in `images/events/` are fine too.
- Each entry is a draft (`"draft": true`, no publish date) or has a `publish` date (UK time). `js/event-gate.js` shows only a Coming soon card until then. It can be opened early these ways. **Admin:** entering the admin key on `admin.html` or `events-admin.html` leaves a month-long "admin viewer" token in that browser (tied to the current admin key, so changing the key ends them all), and unpublished events and Owner Interviews then open there straight away with a small "Admin preview" note. Preview on `events-admin.html` still makes a one-time link that keeps one event open until **End preview**. **People you share it with:** **Copy link** on the event, and anyone with the link can have a one-time code emailed on the gate card, like Sign In and the Owner Interviews. A code opens it in that browser for 7 days, signs them in and makes that email a member if it is not one already (the card and the email say so). Members can instead press **Use a passkey** (if they have set one up in Profile) or **Continue as ...** (if already signed in): a sign-in proves the email just as a code does. The Owner Interview gate has the same options. **Event previews** on `events-admin.html` lists who has opened each event and can revoke or restore an email. There is no countdown. An event not in the file, or a failed read of the file, stays hidden. The gate is off on localhost; add `?gate=on` to try it.
- Save writes `data/event-pages.json` (one commit, so the live site updates in about a minute) and a copy in KV, which Preview reads so a change shows straight away. Publish state changes only through the actions.
- On `events-admin.html` an editor (the event page form or the older event form) opens directly under the event being edited, whose card gets an outline and a small arrow beside its title. It moves back when closed and stays put when a list redraws after a save.
- The older Facebook-style events (`events-data/events-manifest.json`, the Upcoming and Past lists on `events-admin.html`) each have an event page too, linked by `manifestId`. **Edit** on one opens the full event page editor (all the fields, images and ticket options), filled in from the event, or from its page if it already has one; saving also updates the older entry (name, dates, place, link and description) so the meets list and the page agree. **Quick edit** opens the small form under the event (mainly for the attendee counts). There is no separate way to add an older-style event any more: add events with **Add an event page**, and the homepage shows a page-only event like any other. The upcoming events start as drafts in `data/event-pages.json`. Once a page is live, the homepage shows the featured card instead of the older row (and a past one links to the page).
- Live events are featured on the homepage Events section (card image and tagline) until `endDate` (or `startDate`) has passed.
- Worker routes are under `/events/pages/`. Tests: `tests/test_event_pages.py` (browser, mocked worker) and `tests/test_event_worker.py` (runs the real handlers in node).
- Link previews (WhatsApp, Facebook, X, iMessage) read a page's own HTML and do not run scripts, so `event.html?e=<slug>` can only show one fixed preview (the MT3UK logo). Each event therefore has a share page, `share/event/<slug>.html`, with its own title, when and where, and image (hero, else card, else poster), which sends people on to the event page. `scripts/build_event_share_pages.py` writes them from `data/event-pages.json`. They **must be committed** (`share/event/`): mt3uk.com is served from the files in the repo (see `wrangler.jsonc` and `.assetsignore`), not from the GitHub Pages build, so anything only generated in `pages.yml` never reaches the live site. The "Sync gallery and track days manifests" workflow runs the script whenever `data/event-pages.json` or `images/events/` changes and commits the result, as it does for the other share pages (`pages.yml` also runs it, harmlessly). It also makes a 1200 x 630 preview picture under 300 KB for each event (`share/event/<slug>.jpg`), because WhatsApp drops preview images much over that and event photos are usually bigger. The event page has a **Share** button that copies or shares the share address. **Copy link** on `events-admin.html` copies that address, so always share that one, not `event.html?e=...`. Chat apps cache previews, so a link already shared may keep its old picture for a while.

## Shop

- The Tee card and modal are the template for new products. Zoomable product images use the hold-to-pan zoom in shop.html (`panTargets`, `.zoom-pan`), which zooms back out on release. Never use a plain CSS hover zoom or a link.
- Order buttons always get UTM parameters: `?utm_source=mt3uk_shop&utm_medium=internal&utm_campaign=<product>_order`. Ask whether the product needs a sold counter (`data/merch-sales.json`) and never invent the numbers.
- The promo banner is currently commented out on each page and kept for the next offer. Re-enable it rather than rebuilding it.
