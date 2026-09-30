"""Link previews (WhatsApp, Facebook, X, iMessage) read a page's own HTML and
do not run scripts. event.html?e=<slug> is drawn by script, so each event gets
a share page, share/event/<slug>.html, with its own title, when and where, and
image (scripts/build_event_share_pages.py). Copy link on the events admin page
copies that address."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_event_share_pages as builder  # noqa: E402

EVENTS = json.loads((ROOT / "data" / "event-pages.json").read_text(encoding="utf-8"))["events"]


def meta(html, prop):
    return re.search(r'<meta (?:property|name)="%s" content="([^"]*)"' % re.escape(prop), html).group(1)


def test_every_event_has_a_share_page_with_its_own_image_and_text():
    pages = builder.pages_to_write()
    for ev in EVENTS:
        assert ev["slug"] + ".html" in pages, ev["slug"]
    frunk = pages["frunk-or-treat-uk.html"]
    assert meta(frunk, "og:image") == "https://mt3uk.com/images/events/frunk-or-treat-uk/card.jpg"
    assert meta(frunk, "twitter:image") == meta(frunk, "og:image")
    assert "hero.jpg" not in frunk, "Not the main events image"
    assert meta(frunk, "og:title") == "Frunk or Treat UK – MT3UK Events"
    assert "Saturday 31 October 2026, 2pm to 5pm" in meta(frunk, "og:description")
    assert "Caffeine &amp; Machine The Hill" in meta(frunk, "og:description")
    assert meta(frunk, "og:url") == "https://mt3uk.com/share/event/frunk-or-treat-uk.html"
    assert 'location.replace("/event.html?e=frunk-or-treat-uk" + (location.search ? "&" + location.search.slice(1) : ""))' in frunk


def test_the_image_is_the_hero_then_the_card_then_the_poster_then_the_logo():
    base = {"slug": "x", "title": "X"}
    real = "images/events/frunk-or-treat-uk/card.jpg"
    poster = "images/events/frunk-or-treat-uk/poster.jpg"
    assert builder.event_image(dict(base, heroImage="https://img.example/hero.jpg", image=real, poster=poster)) == "https://img.example/hero.jpg"
    assert builder.event_image(dict(base, image=real, poster=poster)).endswith("/card.jpg")
    assert builder.event_image(dict(base, poster=poster)).endswith("/poster.jpg")
    assert builder.event_image(dict(base)) == builder.DEFAULT_IMAGE
    assert builder.event_image(dict(base, image="images/events/not-there.jpg")) == builder.DEFAULT_IMAGE, "A missing file is not used"
    assert builder.event_image(dict(base, image="javascript:alert(1)")) == builder.DEFAULT_IMAGE


def test_text_is_escaped_and_odd_web_addresses_are_skipped():
    ev = {"slug": "safe-one", "title": 'A "quoted" <b>show</b>', "tagline": "Tom & Jerry", "startDate": "2027-01-02"}
    html = builder.render(ev)
    assert "<b>" not in html and "&lt;b&gt;" in html and "&quot;quoted&quot;" in html
    assert meta(html, "og:description") == "Tom &amp; Jerry Saturday 2 January 2027."
    assert builder.SLUG.fullmatch("safe-one") and not builder.SLUG.fullmatch("../evil")
    assert builder.description({"slug": "y"}).startswith("MT3UK events"), "A bare event still gets a sensible line"


def test_the_plain_event_page_no_longer_shows_the_main_events_photo():
    html = (ROOT / "event.html").read_text(encoding="utf-8")
    assert 'property="og:image" content="https://mt3uk.com/images/hero.jpg"' not in html
    assert (ROOT / "images" / "MT3UK_RED_BLK_BG.png").exists()


def test_the_deploy_build_writes_the_event_share_pages():
    workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    assert "python3 scripts/build_event_share_pages.py" in workflow
