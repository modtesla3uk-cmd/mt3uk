# MT3UK site

## Add a photo to the gallery
Drop an image file into `images/gallery/` (GitHub → that folder → **Add file → Upload files**) and commit.
That's it — the site rebuilds automatically and the photo appears.

- Optional: prefix the filename with a number to control its order, e.g. `10-my-new-build.jpg`. Lower numbers show first.
- The caption on the site is generated from the filename — hyphens become spaces, e.g. `10-viper-green-model-y.jpg` → "VIPER GREEN MODEL Y".

## Change the main (hero) photo
Upload a new photo named exactly `hero.jpg` into the `images/` folder — it will overwrite the old one. Same idea: commit, wait ~30 seconds, refresh.

## Change the logo
Replace `images/site/mt3uk-wordmark-dark.png` with a new file of the same name.

## How it works
A GitHub Actions workflow (`.github/workflows/pages.yml`) runs on every push. It scans `images/gallery/`, regenerates `images/gallery/manifest.json` (the list of photos + captions the page reads), and deploys the whole site to GitHub Pages. Nothing needs to be edited by hand for photo updates.

## robots.txt and llms.txt on a fresh clone
`main` and `dev` intentionally keep different versions of `robots.txt` and `llms.txt` (crawler permissions differ per branch), and merges between the two branches should never overwrite one branch's copy with the other's. This is enforced by `.gitattributes` (`merge=ours` on both files), but the merge driver itself has to be registered locally since Git won't run merge drivers from `.gitattributes` alone. After cloning this repo, run once:

```
git config merge.ours.driver true
```

## Running tests
End-to-end tests use Playwright (Python) against a local copy of the site. Install once:

```
pip install -r requirements-test.txt
python -m playwright install --with-deps chromium
```

Then run the suite (this starts and stops a local static server automatically):

```
pytest -v
```

A GitHub Actions workflow (`.github/workflows/tests.yml`) runs the same suite on every push and pull request.
