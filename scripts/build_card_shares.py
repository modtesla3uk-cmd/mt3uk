#!/usr/bin/env python3
"""Share pages and link-preview pictures for the homepage cards.

Each card on the homepage has a share page, share/card/<id>.html, with its own title, description and picture. Link
previews (WhatsApp, Facebook, X, iMessage) read the page's HTML and never run its scripts, so the picture has to exist
as a file. This script opens the live homepage in a browser, takes a picture of each card as it looks now, puts it on a
1200 x 630 card and saves it as share/card/<id>.jpg. The share page sends people on to the card on the homepage
(index.html#card-<id>). A card that is not on the homepage today keeps its last picture, or uses the site picture.

The sync workflow (.github/workflows/card-previews.yml) runs it every day and commits the result.

  python scripts/build_card_shares.py            # the live site
  MT3UK_SITE=http://127.0.0.1:8765 python scripts/build_card_shares.py   # a local copy
"""
import base64
import html
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "share" / "card"
SITE = os.environ.get("MT3UK_SITE", "https://mt3uk.com").rstrip("/")  # where the pictures are drawn from
PUBLIC = "https://mt3uk.com"  # the address in the share pages, always the public site
SITE_PICTURE = "images/MT3UK_RED_BLK_BG.png"
PREVIEW_W, PREVIEW_H = 1200, 630

CARDS = [
    {"id": "latest", "sel": "#hp-hero .hp-hero-card", "title_sel": "#hp-hero-title", "desc_sel": "#hp-hero-excerpt",
     "title": "Latest interview on MT3UK", "desc": "Read the latest owner interview on MT3UK."},
    {"id": "laps", "sel": "#hp-hero .hp-laps-promo", "title": "Laps by MT3UK",
     "desc": "Upload your lap timer file to compare with the boards."},
    {"id": "next", "sel": "#hp-hero-next", "title_sel": ".hp-next-title", "desc_sel": ".hp-next-sub",
     "title": "Next interview on MT3UK", "desc": "The next owner interview on MT3UK."},
    {"id": "join", "sel": "#hp-join", "title": "Add a photo of your car to join MT3UK",
     "desc": "It is free, and you can like, comment and get alerts too."},
    {"id": "offers", "sel": "#hp-shop-cards .hp-offer-card", "title_sel": ".hp-card-title", "desc_sel": ".hp-card-text",
     "title": "An offer in the MT3UK Shop", "desc": "The current offer in the MT3UK Shop."},
    {"id": "shop", "sel": "#hp-shop-cards .hp-shop-card", "title": "In the MT3UK Shop", "desc_sel": ".hp-card-list",
     "desc": "Tees, hoodies, vinyl stickers and more."},
]


def words(text, limit=200):
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "..."


def card_text(page, card):
    """The card's own heading and line as they read now, or the fixed words when the card has none."""
    title = desc = ""
    if card.get("title_sel") and page.locator(card["title_sel"]).count():
        title = page.locator(card["title_sel"]).first.text_content()
    if card.get("desc_sel") and page.locator(card["desc_sel"]).count():
        # A list reads as its items, separated by commas, not run together.
        desc = page.locator(card["desc_sel"]).first.evaluate(
            "el => el.matches('ul') ? [...el.querySelectorAll('li')].map(li => li.textContent.trim()).join(', ') : el.textContent")
    return words(title) or card["title"], words(desc) or card["desc"]


def picture_for(page, card):
    """The card as a PNG, or None when it is not on the homepage now."""
    loc = page.locator(card["sel"]).first
    if loc.count() == 0 or not loc.is_visible():
        return None
    loc.scroll_into_view_if_needed()
    return loc.screenshot(type="png")


def preview_jpeg(context, png):
    """The card on a 1200 x 630 navy picture, as a JPEG small enough for chat apps."""
    data = base64.b64encode(png).decode("ascii")
    page = context.new_page()
    page.set_viewport_size({"width": PREVIEW_W, "height": PREVIEW_H})
    page.set_content(
        "<!doctype html><html><body style=\"margin:0;width:%dpx;height:%dpx;background:#16233d;display:flex;"
        "align-items:center;justify-content:center\">"
        "<img alt=\"\" src=\"data:image/png;base64,%s\" style=\"max-width:1040px;max-height:500px;border-radius:14px;"
        "box-shadow:0 14px 40px rgba(0,0,0,.45)\"></body></html>" % (PREVIEW_W, PREVIEW_H, data)
    )
    out = page.screenshot(type="jpeg", quality=88, clip={"x": 0, "y": 0, "width": PREVIEW_W, "height": PREVIEW_H})
    page.close()
    return out


def share_page(card, title, desc, image):
    cid = card["id"]
    url = "%s/share/card/%s.html" % (PUBLIC, cid)
    t, d = html.escape(title, quote=True), html.escape(desc, quote=True)
    img = "%s/%s" % (PUBLIC, image)
    return """<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%(t)s | MT3UK</title>
<meta name="description" content="%(d)s">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="%(url)s">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MT3UK">
<meta property="og:title" content="%(t)s">
<meta property="og:description" content="%(d)s">
<meta property="og:url" content="%(url)s">
<meta property="og:image" content="%(img)s">
<meta property="og:image:width" content="%(w)d">
<meta property="og:image:height" content="%(h)d">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="%(t)s">
<meta name="twitter:description" content="%(d)s">
<meta name="twitter:image" content="%(img)s">
<meta http-equiv="refresh" content="0; url=../../index.html#card-%(cid)s">
<script>location.replace('../../index.html#card-%(cid)s');</script>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#16233d;color:#fff;font-family:system-ui,sans-serif}a{color:#f2a48c}</style>
</head>
<body>
<p>Opening MT3UK... <a href="../../index.html#card-%(cid)s">%(t)s</a></p>
</body>
</html>
""" % {"t": t, "d": d, "url": url, "img": img, "w": PREVIEW_W, "h": PREVIEW_H, "cid": cid}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    chrome = os.environ.get("CHROME") or None
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
        context.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
        page = context.new_page()
        page.goto(SITE + "/index.html", wait_until="load")
        page.wait_for_selector("#hp-hero .hp-hero-card", timeout=30000)
        page.wait_for_timeout(2500)
        # The share buttons are for visitors, not for the picture.
        page.add_style_tag(content=".hp-card-share{display:none !important}")
        for card in CARDS:
            title, desc = card_text(page, card)
            png = picture_for(page, card)
            image = "share/card/%s.jpg" % card["id"]
            if png is not None:
                (ROOT / image).write_bytes(preview_jpeg(context, png))
                print("picture", image)
            elif not (ROOT / image).exists():
                image = SITE_PICTURE
                print("no picture yet, using the site picture for", card["id"])
            else:
                print("not on the homepage today, keeping", image)
            (OUT / ("%s.html" % card["id"])).write_text(share_page(card, title, desc, image), encoding="utf-8")
        browser.close()


if __name__ == "__main__":
    main()
