#!/usr/bin/env python3
"""
Writes one small page per gallery photo to share/<file>.html, so a photo
shared from the homepage reel shows that photo (not the homepage image) in
WhatsApp, Facebook, X and other link previews.

Link preview crawlers read the Open Graph tags without running JavaScript,
while a person opening the link is sent straight on to the reel at that
photo, keeping any UTM parameters. Pages for photos that have left the
gallery are removed.

Each page's preview image is a 1200x1200 JPEG in share/preview/, served
from mt3uk.com with its size in the page. Square suits the mostly portrait
car photos better than a wide card. Facebook needs the size to show the
image on the first share of a link, and the photos' own r2.dev address is
rate limited and not meant for link previews. The whole photo is fitted over
a blurred copy of itself, so portrait shots are not cropped. Previews are
made once per photo, from R2, when R2_ACCESS_KEY_ID and
R2_SECRET_ACCESS_KEY are set; without them, pages fall back to the r2.dev
photo.

Reads images/gallery/manifest.json, so run it after build_gallery_manifest.py.
It runs automatically in the "Sync gallery and track days manifests"
workflow.
"""
import html
import io
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "images" / "gallery" / "manifest.json"
SHARE_DIR = REPO_ROOT / "share"
PREVIEW_DIR = SHARE_DIR / "preview"
PREVIEW_SIZE = (1200, 1200)
# Wide 1200x630 previews used before the switch to square live on in
# share/img/. They are never removed, because Facebook posts made before the
# switch keep loading their preview from that address, and desktop Facebook
# shows a blank card if it has gone.
SITE_URL = "https://mt3uk.com"
# Same public bucket URL as scripts/r2_client.py, repeated here so this
# script doesn't need boto3.
R2_BASE_URL = "https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev"
DEFAULT_DESCRIPTION = "A member build on MT3UK, the UK's modified Tesla community."


def title_case(value: str) -> str:
    return re.sub(r"(^|[\s-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), (value or "").lower())


def make_preview(data: bytes) -> bytes:
    """Fits the whole photo into PREVIEW_SIZE over a blurred, darkened copy
    of itself that fills the frame."""
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps

    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    width, height = PREVIEW_SIZE
    background = ImageOps.fit(img, PREVIEW_SIZE, Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
    background = ImageEnhance.Brightness(background).enhance(0.45)
    photo = ImageOps.contain(img, PREVIEW_SIZE, Image.LANCZOS)
    background.paste(photo, ((width - photo.width) // 2, (height - photo.height) // 2))
    out = io.BytesIO()
    background.save(out, "JPEG", quality=80, optimize=True, progressive=True)
    return out.getvalue()


def build_previews(files: list) -> None:
    """Makes a preview for every photo that doesn't have one yet, and removes
    previews for photos that have gone."""
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    wanted = {f + ".jpg" for f in files}
    for old in PREVIEW_DIR.glob("*.jpg"):
        if old.name not in wanted:
            old.unlink()
    missing = [f for f in files if not (PREVIEW_DIR / (f + ".jpg")).exists()]
    if not missing:
        return
    if not (os.environ.get("R2_ACCESS_KEY_ID") and os.environ.get("R2_SECRET_ACCESS_KEY")):
        print(f"R2 credentials not set, skipping {len(missing)} preview image(s)")
        return
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from r2_client import BUCKET, get_client

    client = get_client()
    for file in missing:
        try:
            data = client.get_object(Bucket=BUCKET, Key="gallery/" + file)["Body"].read()
            (PREVIEW_DIR / (file + ".jpg")).write_bytes(make_preview(data))
            print(f"Made preview for {file}")
        except Exception as err:
            print(f"Could not make a preview for {file}: {err}")


def page_html(photo: dict) -> str:
    file = photo["file"]
    caption = title_case(photo.get("caption", ""))
    name = title_case(photo.get("name", ""))
    if caption:
        title = caption + (" by " + name if name else "")
    else:
        title = name + "'s build" if name else "Member build"
    mods = [str(m) for m in photo.get("mods") or []]
    description = ("Mods: " + ", ".join(mods[:8]) + ("..." if len(mods) > 8 else "")) if mods else DEFAULT_DESCRIPTION
    has_preview = (PREVIEW_DIR / (file + ".jpg")).exists()
    image = SITE_URL + "/share/preview/" + file + ".jpg" if has_preview else R2_BASE_URL + "/gallery/" + file
    image_size = (
        f"""<meta property="og:image:width" content="{PREVIEW_SIZE[0]}">
<meta property="og:image:height" content="{PREVIEW_SIZE[1]}">
<meta property="og:image:type" content="image/jpeg">
"""
        if has_preview
        else ""
    )
    page_url = SITE_URL + "/share/" + file + ".html"
    reel_url = "/?photo=" + file + "#build-feed"
    e = lambda v: html.escape(v, quote=True)
    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{e(title)} | MT3UK</title>
<meta name="description" content="{e(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="MT3UK">
<meta property="og:title" content="{e(title)} | MT3UK">
<meta property="og:description" content="{e(description)}">
<meta property="og:image" content="{e(image)}">
{image_size}<meta property="og:image:alt" content="{e(title)}">
<meta property="og:url" content="{e(page_url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)} | MT3UK">
<meta name="twitter:description" content="{e(description)}">
<meta name="twitter:image" content="{e(image)}">
<script>
  // Send people on to the reel at this photo, keeping any UTM parameters.
  location.replace('/?photo=' + encodeURIComponent({json.dumps(file)}) + (location.search ? '&' + location.search.slice(1) : '') + '#build-feed');
</script>
<style>
  body {{ margin: 0; background: #16233d; color: #f3f1ea; font-family: 'IBM Plex Mono', monospace; text-align: center; padding: 24px 16px; }}
  img {{ max-width: 100%; max-height: 70vh; object-fit: contain; }}
  a {{ color: #e8542a; }}
</style>
</head>
<body>
<p><img src="{e(R2_BASE_URL + "/gallery/" + file)}" alt="{e(title)}"></p>
<p>{e(title)}</p>
<p><a href="{e(reel_url)}">See this build on MT3UK</a></p>
</body>
</html>
"""


def main():
    photos = [p for p in json.loads(MANIFEST_PATH.read_text()) if p.get("reel") is not False]
    SHARE_DIR.mkdir(exist_ok=True)
    build_previews([p["file"] for p in photos])
    wanted = set()
    for photo in photos:
        path = SHARE_DIR / (photo["file"] + ".html")
        wanted.add(path.name)
        content = page_html(photo)
        if not path.exists() or path.read_text() != content:
            path.write_text(content)
    for old in SHARE_DIR.glob("*.html"):
        if old.name not in wanted:
            old.unlink()
    print(f"Wrote {len(wanted)} share page(s) to {SHARE_DIR}")


if __name__ == "__main__":
    main()
