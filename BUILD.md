# MT3UK — Build & Revision History

This document describes how the site is put together and the history of major
changes made to it. It's a companion to `README.md` (which covers day-to-day
content edits like adding photos or events) — this file is for understanding
the system as a whole and how it got here.

## What this is

MT3UK is a static site for a Tesla owners' community: a photo gallery/build
feed, daily build voting, a shop, customer reviews, events listing, and a
track day prep guide. There's no server-rendered backend for the pages
themselves — it's plain HTML/CSS/JS served from GitHub Pages, backed by a
small Cloudflare Worker API for anything that needs to persist or be shared
across visitors (votes, likes, saved builds, reviews, shop product data).

## Architecture

**Frontend** — static HTML pages, no build step or framework:
- `index.html` — homepage: hero, Build Feed carousel, gallery, voting, FAQ
- `shop.html` — merch and upgrade parts
- `reviews.html` — customer reviews
- `contact.html`, `track-day-prep.html`, `offline.html`
- Each page is a single file with inline `<style>` and `<script>` blocks —
  there is intentionally no bundler/build pipeline.
- `sw.js` + `manifest.json` — service worker and PWA manifest for offline
  support and "Add to Home Screen".

**Backend** — `workers/vote-worker.js`, a Cloudflare Worker (deployed as
`late-darkness-ebc8`) backed by a KV namespace. Handles:
- Build-of-the-day voting and vote tallies
- Build Feed likes and per-voter bookmarks
- Customer review submissions
- Shop product proxy/cache (pulls from Shopify, cached to cut API calls)
- Abuse-mitigation admin endpoints (list/delete voter records, set vote counts)

Visitors are identified by a `mt3ukVoterId` stored in `localStorage` and sent
as an `X-Voter-Id` header — no accounts or logins.

**Data files** (`data/`, `events-data/`) — small JSON files hand-edited or
written by workflows: `featured.json` (pinned Build of the Day),
`community.json` (member count), `reviews.json`, `merch-sales.json`, and one
JSON file per event.

**Automation** — GitHub Actions (`.github/workflows/`):
- `pages.yml` — deploys the static site to GitHub Pages on every push
- `sync-manifests.yml` — regenerates `images/gallery/manifest.json` and
  `sitemap.xml` periodically and on image changes
- `deploy-worker.yml` — deploys `workers/vote-worker.js` on push to main
- `add-event.yml` / `delete-event.yml` / `list-events.yml` — manually
  triggered workflows so events can be added/updated/removed without editing
  JSON by hand
- `vote-tally.yml` / `vote-voters.yml` / `delete-vote.yml` — manual admin
  workflows for the voting system
- `sync-facebook-events.yml` — pulls events from the group's Facebook page
- `tests.yml` — runs the Playwright suite on push/PR

**Branches** — `main` is production (GitHub Pages), `dev` is a staging
branch. Changes are typically committed to `main` first, then
cherry-picked to `dev`. `robots.txt` and `llms.txt` intentionally differ
between the two branches (see README for the `merge=ours` setup).

**Testing** — `tests/` holds a Playwright (Python) suite exercising the shop,
reviews, and other interactive features; runs locally via `pytest` and in CI
via `tests.yml`.

## Revision history

### 2026-09-04 — Initial build
- Site scaffolded: hero image, gallery grid, wordmark, GitHub Pages workflow
- Added click-to-enlarge lightbox with prev/next navigation for gallery photos
- Added mobile hamburger menu

### 2026-09-06 — Gallery, track days, submissions
- Added Track Days section and a public photo submission form (with Facebook
  group membership confirmation)
- Paginated the gallery, ordered by most recently added, fixed grid layout
  artifacts
- Added first track day photos (Thruxton, later replaced with Snetterton);
  isolated the track day image's lightbox from the member gallery's

### 2026-09-07 — Shop launch, nav rebuild
- Added sticker pack and MT3UK Tee product cards with modal galleries and
  interactive zoom
- Rebuilt the nav as a hamburger dropdown, unified the "Join the group" link
- Added `robots.txt` / `llms.txt`, with a `merge=ours` git driver so the two
  branches can keep divergent copies
- Highlighted the Shop section (moved it after About, added a NEW nav badge)
- Removed em dashes from site copy (house style)

### 2026-09-08 — Shop polish, testing, automation
- Wired the "Notify me" form to Buttondown (later removed again once the shop
  went live)
- Fixed tee modal on mobile, added touch pan-to-zoom with a hold-and-pan hint
- Added the Playwright (Python) test suite for shop/merch features
- Added Cloudflare Workers `wrangler` config
- Auto-prefix gallery photos with sequential numbers on submission; auto-
  compress oversized gallery/track day photos and convert PNGs to JPEG
- Added Umami analytics; moved member count into `data/community.json`

### 2026-09-09 — Homepage rework, Track Day Prep
- Added Build of the Day, a Track Days checklist, and an FAQ section
- Replaced the static hero image with a live "builds reel", moved original
  hero treatment into Events
- Added a full Track Day Prep page (OE limitations, model guidance, upgrade
  path, maintenance days) — briefly reverted for review, then re-added with
  its own nav dropdown
- Reworked mobile nav: tap-to-expand submenus, Gallery dropdown chevron,
  "Join the group" styled as a CTA
- Added shop CTA bands, a launch discount banner, SEO/social meta tags and
  favicon

### 2026-09-10 — Facebook events sync
- Added direct shop/order buttons
- Built `fb-events-sync.js` and a scheduled workflow to pull events from the
  group's Facebook Page (moved off hardcoded credentials onto a Page Access
  Token)
- Added Cloudflare cache purge after each deploy

### 2026-09-11 — Events workflows, shop restructure
- Added a no-code way to manage events: `Add/Update Event`, `Delete Event`,
  and `List Events` GitHub Actions workflows, with UK-date-format input
  parsing and auto-generated event IDs
- Reworked the Shop section into its own page (`shop.html`) with Merch and
  Upgrade/Parts sub-sections and a Shop nav submenu
- Added brake pad and Master Cylinder Brace product cards with affiliate/ref
  tracking links

### 2026-09-12 — Build Feed introduced
- Reworked the hero: Featured Build promoted, and a new **Build Feed**
  section added (a scrollable carousel of recent builds) — moved above
  Featured Build shortly after, with an auto-scroll "zoom pulse" effect
  (tuned for speed/depth over a couple of follow-up commits)
- Added a Contact page and redesigned header CTAs/mobile nav
- Reduced spacing between sections site-wide

### 2026-09-13 to 2026-09-14 — SEO fixes, voting system
- Fixed a broken image URL causing a Google crawler redirect error; added
  missing meta description/title to Track Day Prep
- **Build of the Day** switched from a manual pin to automatically featuring
  the latest upload, swapping at UK midnight (with same-day-upload
  protection)
- Added **voting for tomorrow's featured build**: in-lightbox voting, vote
  counts shown on the featured build, a leading-vote highlight, and a
  local-midnight countdown shown under the hero CTAs
- Added an "Add to Home Screen" prompt

### 2026-09-15 — Offline support, vote hardening, reviews
- Added a service worker for offline support and PWA icons (later tuned to
  bypass caching for `/data/` JSON so live data doesn't go stale)
- Vote system hardening: removed a duplicate `/votes/all` route, added
  admin workflows to view vote tallies and voter IPs and to correct/delete
  vote counts for abuse cleanup, deduped IPv6 voters by `/64` prefix, and
  broke ties by whoever reached the count first
- Improved shop conversion: sold counters and UTM tracking on order links,
  dropped a hoodie placeholder
- Added a **Customer Reviews** page: star ratings, photo uploads with
  lightbox viewing, per-product grouping

### 2026-09-16 — Promo banner, build mods, live shop sync
- Added a scrolling promo banner and refreshed the Tee product/Merch hero CTA
- Added an optional **mods list** to gallery build submissions — shown as a
  badge on gallery/vote cards, and toggle-able inside the Build Feed carousel
  and lightbox
- Added manual refresh buttons to Gallery and Vote sections
- Switched stickers to a live Shopify sync

### 2026-09-17 — Build Feed persistence, autoscroll tuning
- Added a mods badge to hero/Featured Today cards; fixed the Upgrades anchor
  scroll
- **Persisted Build Feed likes and bookmarks** server-side via the vote
  worker (previously cosmetic-only), and added a **Saved Builds** view of
  bookmarked builds
- Added a "new build available" toast that polls for fresh uploads and lets
  visitors jump straight to them; merged Saved Builds into the same section
  as the Build Feed; replaced the hero's "Featured Build" CTA with a
  "Build Feed (NEW)" link and updated copy
- Reduced the Build Feed autoscroll's resume-after-interaction delay from 6s
  to 2s so it doesn't feel sluggish after a user touches the carousel
- Added `BUILD.md` (this file) to track architecture and revision history
  going forward
- Fixed the Playwright suite, which had been failing on every push since the
  live-Shopify shop rework: replaced the stale tee/sticker modal and card
  tests (which targeted markup that no longer exists) with tests for the
  current live-rendered merch cards (network-mocked, no live Shopify
  dependency) and the remaining brace product modal. Also discovered and
  fixed a real bug found in the process: the product modal's overlay/
  positioning CSS had been lost from `shop.html` in an earlier refactor, so
  clicking the brace "hold and pan to zoom" image opened an invisible modal
- SEO: fixed `generate_sitemap.py` omitting `reviews.html` from `sitemap.xml`
  (it was never in the pages list), and added a missing canonical tag to
  `track-day-prep.html`. Also found and fixed a bigger indexing problem:
  `mt3uk.com` is actually served live by a Cloudflare Workers-static-assets
  project (git-connected to this repo, deploying on every push to `main`),
  not by the GitHub Pages workflow, and its default `html_handling` mode was
  auto-redirecting every `*.html` request to an extensionless URL (307) while
  the sitemap/canonical tags still pointed at `.html` — a redirect/canonical
  conflict likely causing many pages to be dropped from indexing. Set
  `"html_handling": "none"` in `wrangler.jsonc` to stop the redirect and keep
  `.html` as the canonical, served URL
  cause of pages not getting indexed

---

*Routine/automated commits (daily "Build of the Day" feature swaps, gallery
image submissions, manifest/sitemap regeneration, and event
add/update/delete via workflow) are omitted above for readability — see
`git log` for the complete, unabridged history.*
