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
