#!/usr/bin/env python3
"""
Writes a small share page for every event in data/event-pages.json to
share/event/<slug>.html.

Link previews in WhatsApp, Facebook, X and iMessage read a page's own HTML and
do not run scripts, and event.html?e=<slug> is drawn by script, so on its own
it can only offer one fixed preview. These pages give each event its own: the
event's title, a line about when and where, and its own image (the hero image,
else the card image, else the poster). A person who opens one is sent straight
on to the event page, keeping any other parameters. "Copy link" on the events
admin page copies this address.

Runs in the "Build and deploy MT3UK site" workflow, so the pages are always
made from the current data/event-pages.json and are not committed.

    python scripts/build_event_share_pages.py          # write the pages
    python scripts/build_event_share_pages.py --check  # only list what would be written
"""
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "event-pages.json"
OUT_DIR = ROOT / "share" / "event"
SITE_URL = "https://mt3uk.com"
DEFAULT_IMAGE = SITE_URL + "/images/MT3UK_RED_BLK_BG.png"
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,59}")


def absolute(url):
    """A full address for an image, or '' if it is not one we can use."""
    url = (url or "").strip()
    if url.startswith("https://"):
        return url
    if re.fullmatch(r"images/[A-Za-z0-9_\-./]+", url) and (ROOT / url).exists():
        return SITE_URL + "/" + url
    return ""


def event_image(ev):
    for field in ("heroImage", "image", "poster"):
        found = absolute(ev.get(field))
        if found:
            return found
    return DEFAULT_IMAGE


def clock(hhmm):
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", hhmm or "")
    if not m:
        return ""
    h = int(m.group(1))
    h12 = h % 12 or 12
    return f"{h12}{'pm' if h >= 12 else 'am'}" if m.group(2) == "00" else f"{h12}:{m.group(2)}{'pm' if h >= 12 else 'am'}"


def when_where(ev):
    parts = []
    try:
        d = date.fromisoformat(ev.get("startDate", ""))
        text = f"{d.strftime('%A')} {d.day} {d.strftime('%B %Y')}"
        if ev.get("startTime"):
            text += ", " + clock(ev["startTime"]) + (" to " + clock(ev["endTime"]) if ev.get("endTime") else "")
        parts.append(text)
    except ValueError:
        pass
    place = ev.get("venue") or ev.get("location") or ""
    if place:
        parts.append(("at " if parts else "") + place + (", " + ev["town"] if ev.get("town") and ev["town"] not in place else ""))
    return " ".join(parts)


def description(ev):
    tagline = (ev.get("tagline") or "").strip()
    when = when_where(ev)
    if tagline and when:
        return f"{tagline} {when}."
    return tagline or (when + "." if when else "MT3UK events: meets, shows and track days for modified Tesla owners.")


def render(ev):
    slug = ev["slug"]
    title = (ev.get("title") or ev.get("name") or "Event") + " – MT3UK Events"
    desc = description(ev)
    image = event_image(ev)
    url = f"{SITE_URL}/share/event/{slug}.html"
    e = html.escape
    target = f"/event.html?e={slug}"
    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MT3UK">
<meta property="og:url" content="{e(url)}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{e(image)}">
<meta property="og:image:alt" content="{e(ev.get('title') or ev.get('name') or 'Event')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{e(image)}">
<script>
  // Send people on to the event page, keeping any other parameters.
  location.replace({json.dumps(target)} + (location.search ? "&" + location.search.slice(1) : ""));
</script>
<style>
  body {{ margin: 0; background: #16233d; color: #f3f1ea; font-family: 'IBM Plex Sans', system-ui, sans-serif; text-align: center; padding: 24px 16px; }}
  img {{ max-width: 100%; max-height: 60vh; object-fit: contain; border-radius: 10px; }}
  a {{ color: #e8542a; }}
</style>
</head>
<body>
<p><img src="{e(image)}" alt="{e(ev.get('title') or ev.get('name') or 'Event')}"></p>
<p>{e(ev.get('title') or ev.get('name') or 'Event')}</p>
<p>{e(desc)}</p>
<p><a href="{e(target)}">See it on MT3UK</a></p>
</body>
</html>
"""


def pages_to_write():
    """{file name: html} for every event with a valid web address."""
    events = json.loads(DATA.read_text(encoding="utf-8")).get("events", [])
    return {f"{ev['slug']}.html": render(ev) for ev in events if SLUG.fullmatch(ev.get("slug", ""))}


def main():
    pages = pages_to_write()
    if "--check" in sys.argv[1:]:
        for name in sorted(pages):
            print(name)
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.html"):
        if old.name not in pages:
            old.unlink()
    for name, text in pages.items():
        (OUT_DIR / name).write_text(text, encoding="utf-8")
    print(f"Wrote {len(pages)} event share page(s) to {OUT_DIR}")


if __name__ == "__main__":
    main()
