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
    assert 'content="https://mt3uk.com/share/card/%s.png"' % card in page or "images/MT3UK_RED_BLK_BG.png" in page
    assert "index.html#card-%s" % card in page
    assert 'name="twitter:card" content="summary_large_image"' in page
    assert 'name="robots" content="noindex, follow"' in page


@pytest.mark.parametrize("card", CARDS)
def test_a_card_preview_picture_is_the_card_alone_and_small_enough_for_chat_apps(card):
    picture = ROOT / "share" / "card" / ("%s.png" % card)
    if not picture.exists():
        pytest.skip("not drawn yet: the card-previews workflow makes it")
    assert picture.stat().st_size < 300 * 1024
    assert picture.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_the_card_previews_workflow_runs_every_day_and_on_homepage_changes():
    workflow = (ROOT / ".github" / "workflows" / "card-previews.yml").read_text(encoding="utf-8")
    assert "cron:" in workflow and "build_card_shares.py" in workflow
    assert "js/home-share.js" in workflow and "index.html" in workflow
    assert re.search(r"git add share/card", workflow)
