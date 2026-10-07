"""The Laps pages (track.html, leaderboards.html) install and save to a home
screen as "Laps by MT3UK", from their own app manifest, so someone who only
uses Laps never sees "Modified Tesla Owners". The rest of the site keeps the
MT3UK app (manifest.json)."""
import json
import re
from pathlib import Path

import pytest
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parent.parent
LAPS_PAGES = ["track.html", "leaderboards.html"]


def test_the_laps_manifest_names_laps_not_the_tesla_community():
    laps = json.loads((ROOT / "laps-manifest.json").read_text(encoding="utf-8"))
    site = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert laps["name"] == "Laps by MT3UK" and laps["short_name"] == "Laps"
    assert "Tesla" not in json.dumps(laps)
    assert laps["start_url"] == "/track.html"
    # A separate app from the MT3UK one, so both can be installed.
    assert laps["id"] != site["id"]
    for icon in laps["icons"]:
        assert (ROOT / icon["src"]).exists(), icon["src"]
    assert [s["url"] for s in laps["shortcuts"]] == ["/track.html?add=1", "/leaderboards.html"]


@pytest.mark.parametrize("page", LAPS_PAGES)
def test_the_laps_pages_use_it(page):
    html = (ROOT / page).read_text(encoding="utf-8")
    assert '<link rel="manifest" href="laps-manifest.json">' in html
    assert '<meta name="apple-mobile-web-app-title" content="Laps">' in html
    assert "Laps by MT3UK</title>" in html
    assert "Install MT3UK" not in html and "Add MT3UK to your Home Screen" not in html


@pytest.mark.parametrize("page", ["laps.html", "track.html", "leaderboards.html", "laps-signin.html"])
def test_the_laps_pages_carry_the_lap_timer_icons_and_logo_mark(page):
    """The Laps logo is a lap timer (a ring one lap from the line): the favicon and app icons are its own files, not
    the MT3UK ones, and the header and footer carry the mark before the name."""
    html = (ROOT / page).read_text(encoding="utf-8")
    assert 'href="images/laps/favicon.ico"' in html and 'href="images/laps/apple-touch-icon.png"' in html
    assert "images/site/favicon" not in html and "images/site/apple-touch-icon" not in html
    assert html.count('class="laps-logo-mark"') >= 2
    for f in ("favicon.svg", "favicon-16.png", "favicon-32.png", "favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "laps-mark.svg"):
        assert (ROOT / "images" / "laps" / f).exists(), f


def test_the_chosen_logo_reaches_the_header_the_footer_and_the_favicon(page):
    """The worker says which of the four marks is chosen: the Laps pages swap the header and footer mark, the favicon
    and the touch icon to it (the lap timer is what the files carry, so it changes nothing)."""
    cors = {"Access-Control-Allow-Origin": "*"}
    page.route("**/laps/logo", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "logo": "chevron", "choices": ["timer", "loop", "ramp", "chevron"]}), headers=cors))
    page.goto("/leaderboards.html")
    marks = page.locator(".laps-logo-mark")
    expect(marks.first).to_have_attribute("data-logo", "chevron")
    assert marks.count() >= 2 and page.locator(".laps-logo-mark[data-logo='chevron']").count() == marks.count()
    expect(page.locator(".laps-logo-mark").first.locator("path")).to_have_count(2)
    href = page.locator('link[rel="icon"]').first.get_attribute("href")
    assert href.startswith("data:image/svg+xml,") and "M10%2012" in href, href[:80]
    assert page.locator('link[rel="icon"]').count() == 1
    assert page.locator('link[rel="apple-touch-icon"]').get_attribute("href") == "images/laps/chevron/apple-touch-icon.png"
    # Back to the lap timer: the page files' own mark and icons.
    page.route("**/laps/logo", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "logo": "timer", "choices": []}), headers=cors))
    page.evaluate("localStorage.removeItem('mt3ukLapsLogo')")
    page.goto("/leaderboards.html")
    expect(page.locator(".laps-logo-mark").first).not_to_have_attribute("data-logo", re.compile(".+"))
    assert page.locator('link[rel="icon"]').count() >= 3


def test_the_rest_of_the_site_keeps_the_mt3uk_app():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert '<link rel="manifest" href="manifest.json">' in html
