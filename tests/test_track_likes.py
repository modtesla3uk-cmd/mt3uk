"""Track sessions have no like button or count (taken off in October 2026). The worker's /track/likes routes stay, so likes
already given are kept, but a session page does not show them or offer a like."""
from playwright.sync_api import expect

from tests.test_track_page import FakeWorker, save_fixture_session


def test_a_shared_session_has_no_like_button_or_count(page):
    fake = FakeWorker()
    save_fixture_session(page, fake)
    fake.sessions["new1"]["privacy"] = "shared"
    page.goto("/track.html?s=new1")
    expect(page.locator("#tp-session-bar")).to_be_visible()
    expect(page.locator("#tp-exit")).to_be_visible()
    assert page.locator("#tp-like, [data-like-toggle], .tp-like-count, .tp-like-pop").count() == 0
