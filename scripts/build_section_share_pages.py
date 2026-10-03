#!/usr/bin/env python3
"""
Writes a small share page for every public page, and for every section of
it that has a round share button (js/share.js), to share/section/:

  share/section/<page>.html          the page itself
  share/section/<page>--<id>.html    a section, e.g. index--build-of-the-day

Like the photo share pages (scripts/build_share_pages.py), link previews in
WhatsApp, Facebook and X read these pages' Open Graph tags: the section's
heading as the title, its intro text as the description, and a photo. A
person opening the link is sent straight on to the page at that section,
keeping any UTM parameters.

The photo for a section is, in order:
  - data-share-image="images/..." on the section or heading, if set
  - for the live sections, a current photo: the Build of the Week, the
    newest build in the reel, the latest owner interview or a track day
  - the first photo in the section
  - the page's own og:image, or for pages with only the logo, the current
    Build of the Week (track day pages use a track day photo)

Sections are <section id="..."> with an <h2>, plus headings marked
data-share-anchor="<id>", matching js/share.js. Pages come from the PAGES
map in scripts/build_layout.py.

Reads images/gallery/manifest.json and data/featured.json, so run it after
build_share_pages.py. It runs in the "Sync gallery and track days manifests"
workflow.

    python scripts/build_section_share_pages.py          # write the pages
    python scripts/build_section_share_pages.py --check  # only list missing ones
"""
import html
import json
import os
import re
import sys
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from build_layout import PAGES  # noqa: E402

OUT_DIR = ROOT / "share" / "section"
SITE_URL = "https://mt3uk.com"
R2_BASE_URL = "https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev"
DEFAULT_IMAGE = SITE_URL + "/images/MT3UK_RED_BLK_BG.png"
DEFAULT_DESCRIPTION = "MT3UK, the UK's modified Tesla community."
WORKER_URL = "https://late-darkness-ebc8.modtesla3uk.workers.dev"


# Pages whose link picture the admin sets on admin.html (the Link preview picture panels), by the worker's slot.
SHARE_SLOTS = {"track": "track", "index": "home"}


def share_live(slot):
    """The link picture the admin has set for a slot (see the Link preview picture panels on admin.html), with the
    ISO week stamped into its address so chat apps fetch a fresh preview each week, and its caption. Only when
    MT3UK_SHARE_LIVE=1 (the sync workflow sets it): tests and local runs stay offline and use the page's own
    picture."""
    if os.environ.get("MT3UK_SHARE_LIVE") != "1":
        return None
    try:
        # Cloudflare refuses urllib's default User-Agent with a 403, so say who is asking.
        request = urllib.request.Request(WORKER_URL + "/share/" + slot, headers={"User-Agent": "mt3uk-build"})
        with urllib.request.urlopen(request, timeout=15) as r:
            d = json.load(r)
    except Exception as e:  # noqa: BLE001 - a missing picture must never stop the build
        print("Share picture for " + slot + " not read (" + str(e) + "), using the page's own.")
        return None
    pick = d.get("pick") if isinstance(d, dict) else None
    if not pick or not pick.get("url"):
        return None
    year, week, _ = date.today().isocalendar()
    return {"image": pick["url"] + "?w=%d-W%02d" % (year, week), "caption": (pick.get("caption") or "").strip()}
# Sections filled in by the browser, so the page has no photo to find.
LIVE_SECTIONS = {
    "build-of-the-day": "featured",
    "build-feed": "newest",
    "vote-frame": "newest",
    "gallery": "newest",
    "owner-interviews": "interview",
    "track-days": "track",
}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []

    def walk(self):
        for child in self.children:
            yield child
            if isinstance(child, Node):
                yield from child.walk()

    def text(self):
        parts = []
        for child in self.walk():
            if isinstance(child, str):
                parts.append(child)
        return re.sub(r"\s+", " ", "".join(parts)).strip()

    def has_class(self, name):
        return name in (self.attrs.get("class") or "").split()

    def inside(self, attr):
        node = self
        while node is not None:
            if attr in node.attrs:
                return True
            node = node.parent
        return False


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root", [], None)
        self.current = self.root
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
            return
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in VOID:
            self.current = node

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
            return
        node = self.current
        while node is not None and node.tag != tag:
            node = node.parent
        if node is not None and node.parent is not None:
            self.current = node.parent

    def handle_data(self, data):
        if not self.skip:
            self.current.children.append(data)


def parse(path):
    builder = TreeBuilder()
    builder.feed(path.read_text(encoding="utf-8"))
    return builder.root


def heading_text(node):
    """The heading's words, without its badges and buttons."""
    parts = []

    def collect(n):
        for child in n.children:
            if isinstance(child, str):
                parts.append(child)
            elif child.tag not in ("button",) and not child.has_class("nav-sublink-new"):
                collect(child)

    collect(node)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def intro_after(scope, heading):
    """The first paragraph after the heading with some substance, skipping
    countdowns (matches the rule in js/share.js)."""
    seen = False
    for node in scope.walk():
        if node is heading:
            seen = True
            continue
        if seen and isinstance(node, Node) and node.tag == "p" and not node.has_class("hp-countdown"):
            text = node.text()
            if len(text) >= 30:
                return shorten(text)
    return ""


def shorten(text, limit=200):
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "..."


def local_image(node):
    """First photo in the node, as a full URL."""
    for child in node.walk():
        if isinstance(child, Node) and child.tag == "img":
            src = child.attrs.get("src") or ""
            if src.startswith("images/") and not re.search(r"wordmark|logo|\.svg$", src, re.I):
                return SITE_URL + "/" + src.replace(" ", "%20")
    return None


def meta(root, prop):
    for node in root.walk():
        if isinstance(node, Node) and node.tag == "meta" and (node.attrs.get("property") == prop or node.attrs.get("name") == prop):
            return node.attrs.get("content") or ""
    return ""


def gallery_image(file):
    if (ROOT / "share" / "preview" / (file + ".jpg")).exists():
        return SITE_URL + "/share/preview/" + file + ".jpg", True
    return R2_BASE_URL + "/gallery/" + file, False


def live_images():
    """The current photo for each kind of live section, as (url, square)."""
    photos = live_photos()
    images = {}
    for kind in ("featured", "newest"):
        if photos[kind]:
            images[kind] = gallery_image(photos[kind]["file"])
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        today = datetime.now(ZoneInfo("Europe/London")).date().isoformat()
        interviews = json.loads((ROOT / "data" / "interviews.json").read_text()).get("interviews") or []
        published = sorted((i for i in interviews if i.get("image") and i.get("publish") and not i.get("draft") and i["publish"] <= today), key=lambda i: i["publish"])
        chosen = published[-1] if published else next((i for i in interviews if i.get("image")), None)
        if chosen:
            images["interview"] = (SITE_URL + "/" + chosen["image"], False)
    except (OSError, ValueError, ImportError):
        pass
    try:
        tracks = json.loads((ROOT / "images" / "track-days" / "manifest.json").read_text())
        if tracks:
            images["track"] = (R2_BASE_URL + "/track-days/" + tracks[0]["file"], False)
    except (OSError, ValueError, KeyError):
        pass
    return images


def live_photos():
    photos = []
    try:
        photos = json.loads((ROOT / "images" / "gallery" / "manifest.json").read_text())
    except (OSError, ValueError):
        pass
    reel = [p for p in photos if p.get("reel") is not False]
    featured = None
    try:
        featured_file = json.loads((ROOT / "data" / "featured.json").read_text()).get("file")
        featured = next((p for p in photos if p.get("file") == featured_file), None)
    except (OSError, ValueError):
        pass
    newest = reel[0] if reel else None
    return {"featured": featured or newest, "newest": newest}


def page_url(page):
    return "/" if page == "index" else "/" + page + ".html"


def share_html(title, description, image, square, target, anchor):
    e = lambda v: html.escape(v, quote=True)
    size = (
        '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="1200">\n'
        if square
        else ""
    )
    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{e(title)} | MT3UK</title>
<meta name="description" content="{e(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MT3UK">
<meta property="og:title" content="{e(title)} | MT3UK">
<meta property="og:description" content="{e(description)}">
<meta property="og:image" content="{e(image)}">
{size}<meta property="og:image:alt" content="{e(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)} | MT3UK">
<meta name="twitter:description" content="{e(description)}">
<meta name="twitter:image" content="{e(image)}">
<script>
  // Send people on to the page at this section, keeping any UTM parameters.
  location.replace({json.dumps(target)} + location.search + {json.dumps("#" + anchor if anchor else "")});
</script>
<style>
  body {{ margin: 0; background: #16233d; color: #f3f1ea; font-family: 'IBM Plex Mono', monospace; text-align: center; padding: 24px 16px; }}
  img {{ max-width: 100%; max-height: 60vh; object-fit: contain; }}
  a {{ color: #e8542a; }}
</style>
</head>
<body>
<p><img src="{e(image)}" alt="{e(title)}"></p>
<p>{e(title)}</p>
<p>{e(description)}</p>
<p><a href="{e(target + ('#' + anchor if anchor else ''))}">See it on MT3UK</a></p>
</body>
</html>
"""


def pages_to_write():
    """Every share page as (filename, html)."""
    images = live_images()
    out = {}
    for page in PAGES:
        root = parse(ROOT / (page + ".html"))
        page_image, page_square = meta(root, "og:image") or DEFAULT_IMAGE, False
        if page_image == DEFAULT_IMAGE:
            found = local_image(root)
            fallback = images.get("track" if page.startswith("track-day") else "featured")
            if page.startswith("track-day") and fallback:
                page_image, page_square = fallback
            elif found:
                page_image = found
            elif fallback:
                page_image, page_square = fallback
        target = page_url(page)
        live_caption = ""
        if page in SHARE_SLOTS:
            live = share_live(SHARE_SLOTS[page])
            if live:
                page_image, page_square, live_caption = live["image"], False, live["caption"]

        # The page itself, from its main heading.
        h1 = next((n for n in root.walk() if isinstance(n, Node) and n.tag == "h1" and not n.inside("data-no-share")), None)
        title = heading_text(h1) if h1 else (meta(root, "og:title") or "MT3UK")
        description = live_caption or (intro_after(root, h1) if h1 else "") or shorten(meta(root, "description")) or DEFAULT_DESCRIPTION
        out[page + ".html"] = share_html(title, description, page_image, page_square, target, "")

        # Each section with a share button.
        targets = []
        for node in root.walk():
            if not isinstance(node, Node):
                continue
            if node.tag == "section" and node.attrs.get("id") and not any(
                isinstance(n, Node) and n.tag == "h1" for n in node.walk()
            ):
                h2 = next((n for n in node.walk() if isinstance(n, Node) and n.tag == "h2"), None)
                if h2:
                    targets.append((node, h2, node.attrs["id"]))
            if node.attrs.get("data-share-anchor"):
                section = node.parent
                while section is not None and section.tag != "section":
                    section = section.parent
                targets.append((section or node, node, node.attrs["data-share-anchor"]))
        for scope, heading, anchor in targets:
            if heading.inside("data-no-share"):
                continue
            title = heading_text(heading)
            description = intro_after(scope, heading) or DEFAULT_DESCRIPTION
            image, square = None, False
            chosen = heading.attrs.get("data-share-image") or scope.attrs.get("data-share-image")
            if chosen:
                image = SITE_URL + "/" + chosen
            elif anchor in LIVE_SECTIONS and LIVE_SECTIONS[anchor] in images:
                image, square = images[LIVE_SECTIONS[anchor]]
            else:
                image = local_image(scope)
                if not image:
                    image, square = page_image, page_square
            out[page + "--" + anchor + ".html"] = share_html(title, description, image, square, target, anchor)
    return out


def main():
    pages = pages_to_write()
    if "--check" in sys.argv[1:]:
        missing = [name for name in pages if not (OUT_DIR / name).exists()]
        if missing:
            print("Missing section share pages: " + ", ".join(missing) + ". Run: python scripts/build_section_share_pages.py")
            sys.exit(1)
        print("All %d section share pages are there." % len(pages))
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.html"):
        if old.name not in pages:
            old.unlink()
    changed = 0
    for name, content in pages.items():
        path = OUT_DIR / name
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            path.write_text(content, encoding="utf-8")
            changed += 1
    print("Wrote %d of %d section share pages to %s" % (changed, len(pages), OUT_DIR))


if __name__ == "__main__":
    main()
