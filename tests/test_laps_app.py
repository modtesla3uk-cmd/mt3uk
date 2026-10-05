"""The Laps pages (track.html, leaderboards.html) install and save to a home
screen as "Laps by MT3UK", from their own app manifest, so someone who only
uses Laps never sees "Modified Tesla Owners". The rest of the site keeps the
MT3UK app (manifest.json)."""
import json
from pathlib import Path

import pytest

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


def test_the_rest_of_the_site_keeps_the_mt3uk_app():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert '<link rel="manifest" href="manifest.json">' in html
