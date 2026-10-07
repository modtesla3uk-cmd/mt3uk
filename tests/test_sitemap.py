"""The sitemap lists pages only: no sign-in page, no site images as pages, the Track Days guides,
and Owner Interviews and event pages only once their publish date has come. Event pages and the
sign-in pages carry what Google needs (one canonical per event, noindex on sign-in)."""
import importlib.util
import json
import sys
import types
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent


def load_sitemap(monkeypatch):
    sys.modules.setdefault("boto3", types.ModuleType("boto3"))
    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location("generate_sitemap", ROOT / "generate_sitemap.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_sitemap_pages_leave_out_sign_in_and_list_the_track_days_guides(monkeypatch):
    mod = load_sitemap(monkeypatch)
    assert "signin.html" not in mod.PAGES
    for page in ("track-day-venues.html", "track-day-prep.html", "track-day-on-the-day.html"):
        assert page in mod.PAGES
    assert not any(p.startswith("blog-") for p in mod.PAGES), "Interviews come from data/interviews.json by date"


def test_only_published_interviews_and_events_are_listed(monkeypatch, tmp_path):
    mod = load_sitemap(monkeypatch)
    (tmp_path / "data").mkdir()
    (tmp_path / "blog-old.html").write_text("x")
    (tmp_path / "blog-new.html").write_text("x")
    (tmp_path / "data" / "interviews.json").write_text(json.dumps({"interviews": [
        {"url": "blog-old.html", "publish": "2020-01-01"},
        {"url": "blog-new.html", "publish": "2099-01-01"},
        {"url": "blog-gone.html", "publish": "2020-01-01"},
    ]}))
    (tmp_path / "data" / "event-pages.json").write_text(json.dumps({"events": [
        {"slug": "live-meet", "publish": "2020-01-01"},
        {"slug": "later-meet", "publish": "2099-01-01"},
        {"slug": "draft-meet", "draft": True},
    ]}))
    monkeypatch.chdir(tmp_path)
    assert mod.published_pages() == ["blog-old.html", "event.html?e=live-meet"]


def test_the_committed_sitemap_has_no_locked_interviews_or_site_images():
    text = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    today = datetime.now(ZoneInfo("Europe/London")).strftime("%Y-%m-%d")
    interviews = json.loads((ROOT / "data" / "interviews.json").read_text(encoding="utf-8"))["interviews"]
    for e in interviews:
        if e["publish"] > today:
            assert f"/{e['url']}</loc>" not in text, e["url"] + " is still locked"
    assert "/images/site/" not in text
    assert "/signin.html</loc>" not in text


def test_event_page_has_no_fixed_canonical_and_sign_in_pages_are_noindex():
    assert 'rel="canonical"' not in (ROOT / "event.html").read_text(encoding="utf-8")
    for page in ("signin.html", "laps-signin.html"):
        assert '<meta name="robots" content="noindex">' in (ROOT / page).read_text(encoding="utf-8"), page
