"""On a phone, a page that opens on a view (a session, a board) hides its page Back before anything paints, so the
Back does not flash and then vanish once the view is drawn. The Sessions list still shows it."""
from playwright.sync_api import expect


def open_on_phone(page, base_url, path):
    page.route("**/*", lambda route: route.abort() if "workers.dev" in route.request.url else route.continue_())
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(path, wait_until="domcontentloaded")
    return page.evaluate("getComputedStyle(document.querySelector('.page-hero .back-link:not(.tp-back)')).display")


def test_a_session_opens_with_its_page_back_already_hidden_on_a_phone(page, base_url):
    assert open_on_phone(page, base_url, "/track.html?s=x1") == "none"


def test_a_board_opens_with_its_page_back_already_hidden_on_a_phone(page, base_url):
    assert open_on_phone(page, base_url, "/leaderboards.html?board=thruxton:main") == "none"


def test_the_sessions_list_still_shows_its_back_on_a_phone(page, base_url):
    page.route("**/*", lambda route: route.abort() if "workers.dev" in route.request.url else route.continue_())
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/track.html", wait_until="domcontentloaded")
    expect(page.locator(".page-hero .back-link:not(.tp-back)").first).to_be_visible()
