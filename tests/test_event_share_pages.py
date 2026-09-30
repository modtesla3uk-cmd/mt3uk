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


def test_the_workflows_write_and_commit_the_event_share_pages():
    """mt3uk.com is served from the files in the repo, so the pages must be
    committed, not only generated in the GitHub Pages build."""
    sync = (ROOT / ".github" / "workflows" / "sync-manifests.yml").read_text(encoding="utf-8")
    assert "python3 scripts/build_event_share_pages.py" in sync
    assert '"data/event-pages.json"' in sync and '"images/events/**"' in sync, "Runs when an event is saved"
    assert "git add" in sync and " share" in sync.split("git add", 1)[1].split("\n", 1)[0], "The share folder is committed"
    assert "python3 scripts/build_event_share_pages.py" in (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert "share/event" not in ignored, "The share pages are committed, not ignored"


def test_the_preview_picture_is_1200_by_630_and_small_enough_for_whatsapp():
    pytest = __import__("pytest")
    pytest.importorskip("PIL")
    from io import BytesIO
    from PIL import Image
    big_wide = Image.effect_noise((2400, 1000), 90).convert("RGB")  # noisy, so it compresses badly
    buffer = BytesIO()
    big_wide.save(buffer, "JPEG", quality=95)
    assert len(buffer.getvalue()) > 400 * 1024, "The starting picture is large"
    preview = builder.make_preview(buffer.getvalue())
    assert len(preview) <= builder.PREVIEW_MAX_BYTES
    assert Image.open(BytesIO(preview)).size == (1200, 630)
    # A tall poster sits whole on navy instead of being cropped.
    tall = Image.new("RGB", (1024, 1536), (250, 20, 140))
    buffer = BytesIO()
    tall.save(buffer, "JPEG")
    poster = Image.open(BytesIO(builder.make_preview(buffer.getvalue())))
    assert poster.size == (1200, 630)
    assert poster.getpixel((5, 300)) == builder.NAVY or sum(abs(a - b) for a, b in zip(poster.getpixel((5, 300)), builder.NAVY)) < 30, "Navy either side"


def test_a_share_page_uses_the_right_sized_preview_when_there_is_one():
    ev = {"slug": "x-event", "title": "X", "image": "https://img.example/huge.jpg"}
    with_preview = builder.render(ev, "https://mt3uk.com/share/event/x-event.jpg")
    assert meta(with_preview, "og:image") == "https://mt3uk.com/share/event/x-event.jpg"
    assert meta(with_preview, "og:image:width") == "1200" and meta(with_preview, "og:image:height") == "630"
    without = builder.render(ev)
    assert meta(without, "og:image") == "https://img.example/huge.jpg" and "og:image:width" not in without


def test_the_workflows_can_make_the_previews():
    for name in ("pages.yml", "sync-manifests.yml"):
        workflow = (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
        assert "Pillow" in workflow, name
