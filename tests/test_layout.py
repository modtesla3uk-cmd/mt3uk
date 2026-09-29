"""Every public page must carry the shared header and footer.

The menu, search and footer live in partials/ and css/site-header.css, and
scripts/build_layout.py copies them into each page. If this fails, run:

    python scripts/build_layout.py
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_layout  # noqa: E402


@pytest.mark.parametrize("page", list(build_layout.PAGES))
def test_page_uses_shared_header_and_footer(page):
    original, expected = build_layout.build(page)
    assert original == expected, (
        f"{page}.html has drifted from partials/header.html, partials/footer.html "
        "or the css/site-header.css link. Run: python scripts/build_layout.py"
    )


@pytest.mark.parametrize("page", list(build_layout.PAGES))
def test_page_has_the_notification_bell_and_profile_icon(page):
    """js/notify-bell.js adds the bell and the profile icon beside search,
    js/messenger.js the chat icon and the Messages and Friends window, and
    js/signin-prompt.js asks visitors who aren't signed in to sign in."""
    html = (Path(__file__).resolve().parent.parent / f"{page}.html").read_text(encoding="utf-8")
    for script in ("js/notify-bell.js", "js/messenger.js", "js/signin-prompt.js"):
        assert f'<script src="{script}"' in html, f"{page}.html is missing {script}"


def test_every_share_button_has_a_share_page():
    """The round share buttons (js/share.js) link to share/section/ pages,
    so every page and section needs one. If this fails, run:

        python scripts/build_section_share_pages.py
    """
    import build_section_share_pages

    missing = [
        name for name in build_section_share_pages.pages_to_write()
        if not (build_section_share_pages.OUT_DIR / name).exists()
    ]
    assert not missing, "Missing share pages: " + ", ".join(missing) + ". Run: python scripts/build_section_share_pages.py"
