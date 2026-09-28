"""The site search (js/search.js) covers every public page and section.

Pages and sections come from data/search-index.json. Owner Interviews are
added by js/search.js from data/interviews.json on their publish date, so
they don't go in the index. If a check here fails after adding a page or
section, add an entry for it to data/search-index.json.
"""
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_layout  # noqa: E402

INDEX = json.loads((ROOT / "data" / "search-index.json").read_text(encoding="utf-8"))
URLS = {entry["url"] for entry in INDEX}
# Section ids that only exist once a script has run, or aren't worth a result.
SKIP_SECTIONS = {"hp-hero"}
# Shop products are drawn by script, so their anchors aren't in the page source.
SCRIPTED_PAGES = {"shop.html"}


def page_sections(page):
    html = (ROOT / (page + ".html")).read_text(encoding="utf-8")
    ids = re.findall(r'<section[^>]*\bid="([^"]+)"', html) + re.findall(r'data-share-anchor="([^"]+)"', html)
    return [i for i in ids if i not in SKIP_SECTIONS]


PUBLIC = [p for p in build_layout.PAGES if not p.startswith("blog-")]


@pytest.mark.parametrize("page", PUBLIC)
def test_page_and_sections_are_searchable(page):
    url = "index.html" if page == "index" else page + ".html"
    if page != "index":
        assert url in URLS, f"{url} is not in data/search-index.json"
    sections = page_sections(page)
    for n, section in enumerate(sections):
        anchored = f"{url}#{section}"
        # A page's first section is the page itself, so its entry covers it.
        covered = page != "index" and n == 0 and url in URLS
        assert anchored in URLS or covered, f"Section {anchored} is not in data/search-index.json"


def test_index_links_go_somewhere():
    for entry in INDEX:
        url = entry["url"]
        if url.startswith("http"):
            continue
        path, _, anchor = url.partition("#")
        page = ROOT / path
        assert page.exists(), f"Search result {entry['title']!r} links to a missing page: {url}"
        if anchor and path not in SCRIPTED_PAGES:
            html = page.read_text(encoding="utf-8")
            assert f'id="{anchor}"' in html, f"Search result {entry['title']!r} links to a missing section: {url}"


def test_every_interview_has_what_search_needs():
    interviews = json.loads((ROOT / "data" / "interviews.json").read_text(encoding="utf-8"))["interviews"]
    for iv in interviews:
        for field in ("title", "url", "publish", "name"):
            assert iv.get(field), f"{iv.get('url')} has no {field}, so it can't be searched"
        assert (ROOT / iv["url"]).exists(), iv["url"]
