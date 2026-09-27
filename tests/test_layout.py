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
