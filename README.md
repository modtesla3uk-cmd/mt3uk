# MT3UK

The website for the MT3UK modified Tesla community: photo galleries, owner builds, events, track days and the Laps section.

Live at [mt3uk.com](https://mt3uk.com).

## What it does

- **Galleries and builds:** owner photos, with captions and mod lists generated from the filenames and sidecar files.
- **Community features:** votes, likes, comments, "My Garage" and moderation tools, handled by a Cloudflare Worker (`workers/vote-worker.js`).
- **Laps:** a separate section with its own test deployment, so changes can be tried before they go live.
- **Automation:** around 17 GitHub Actions workflows handle deployment, sitemap and manifest generation, event syncing, moderation and daily summaries.

## Stack

- Static HTML, CSS and JavaScript, hosted on GitHub Pages and served through Cloudflare
- Cloudflare Worker (JavaScript) for the dynamic features
- Python build scripts for generating the sitemap, gallery manifests and share pages
- Playwright tests, run with pytest

## Built with

Built and maintained with Claude Code, from first commit through to deployment.

## Running the tests

```
python -m pytest -q
```

The full suite takes about 12 minutes.

## Notes for contributors

Day-to-day editing instructions for the site, including how to add photos and change the hero image, are in [BUILD.md](BUILD.md).
