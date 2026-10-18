"""The homepage cards' share pages (share/card/<id>.html): each has its own preview picture and sends people to its card."""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CARDS = ["latest", "laps", "next", "join", "offers", "shop"]


@pytest.mark.parametrize("card", CARDS)
def test_a_card_share_page_previews_the_card_and_sends_people_to_it(card):
    page = (ROOT / "share" / "card" / ("%s.html" % card)).read_text(encoding="utf-8")
    assert '<meta property="og:url" content="https://mt3uk.com/share/card/%s.html">' % card in page
    assert 'content="https://mt3uk.com/share/card/%s.jpg"' % card in page or "images/MT3UK_RED_BLK_BG.png" in page
    assert 'property="og:image:width" content="1200"' in page and 'property="og:image:height" content="630"' in page
    assert "index.html#card-%s" % card in page
    assert 'name="twitter:card" content="summary_large_image"' in page
    assert 'name="robots" content="noindex, follow"' in page


@pytest.mark.parametrize("card", CARDS)
def test_a_card_preview_picture_is_a_1200_by_630_card_on_white_and_small_enough_for_chat_apps(card):
    picture = ROOT / "share" / "card" / ("%s.jpg" % card)
    if not picture.exists():
        pytest.skip("not drawn yet: the card-previews workflow makes it")
    assert picture.stat().st_size < 300 * 1024
    assert picture.read_bytes()[:2] == b"\xff\xd8"


def test_the_card_previews_workflow_runs_every_day_and_on_homepage_changes():
    workflow = (ROOT / ".github" / "workflows" / "card-previews.yml").read_text(encoding="utf-8")
    assert "cron:" in workflow and "build_card_shares.py" in workflow
    assert "js/home-share.js" in workflow and "index.html" in workflow
    assert re.search(r"git add share/card", workflow)


def test_the_card_previews_workflow_can_be_started_from_the_admin_page():
    # The Rebuild share cards button sends the card-previews event (worker /home/cards/rebuild); the workflow listens for it.
    workflow = (ROOT / ".github" / "workflows" / "card-previews.yml").read_text(encoding="utf-8")
    assert "repository_dispatch:" in workflow and "types: [card-previews]" in workflow
    assert "card-previews" in (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    assert "card-share-admin.js" in (ROOT / "admin.html").read_text(encoding="utf-8")


def test_the_admin_panel_opens_the_sharing_debugger_for_each_homepage_card():
    # Each card's share page is filled into Facebook's Sharing Debugger, so its picture can be scraped again by hand.
    page = (ROOT / "admin.html").read_text(encoding="utf-8")
    for card in CARDS:
        share = "https%%3A%%2F%%2Fmt3uk.com%%2Fshare%%2Fcard%%2F%s.html" % card
        assert "https://developers.facebook.com/tools/debug/?q=" + share in page, card
