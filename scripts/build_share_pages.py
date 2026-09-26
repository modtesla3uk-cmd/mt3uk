#!/usr/bin/env python3
"""
Writes one small page per gallery photo to share/<file>.html, so a photo
shared from the homepage reel shows that photo (not the homepage image) in
WhatsApp, Facebook, X and other link previews.

Link preview crawlers read the Open Graph tags without running JavaScript,
while a person opening the link is sent straight on to the reel at that
photo, keeping any UTM parameters. Pages for photos that have left the
gallery are removed.

Reads images/gallery/manifest.json, so run it after build_gallery_manifest.py.
It runs automatically in the "Sync gallery and track days manifests"
workflow.
"""
import html
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "images" / "gallery" / "manifest.json"
SHARE_DIR = REPO_ROOT / "share"
SITE_URL = "https://mt3uk.com"
# Same public bucket URL as scripts/r2_client.py, repeated here so this
# script doesn't need boto3.
R2_BASE_URL = "https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev"
DEFAULT_DESCRIPTION = "A member build on MT3UK, the UK's modified Tesla community."


def title_case(value: str) -> str:
    return re.sub(r"(^|[\s-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), (value or "").lower())


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
    image = R2_BASE_URL + "/gallery/" + file
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
<meta property="og:image:alt" content="{e(title)}">
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
<p><img src="{e(image)}" alt="{e(title)}"></p>
<p>{e(title)}</p>
<p><a href="{e(reel_url)}">See this build on MT3UK</a></p>
</body>
</html>
"""


def main():
    photos = json.loads(MANIFEST_PATH.read_text())
    SHARE_DIR.mkdir(exist_ok=True)
    wanted = set()
    for photo in photos:
        if photo.get("reel") is False:
            continue
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
