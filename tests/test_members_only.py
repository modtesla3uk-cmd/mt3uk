"""Voting, like liking and commenting, is for signed-in members: signed-out
visitors get the sign-in dialog (js/signin-prompt.js) and nothing is sent
to the worker, which also refuses votes and comments without a sign-in
(checked in tests/test_privacy.py)."""
from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401


@all_devices
def test_signed_out_vote_asks_to_sign_in(device_page):
    page = device_page
    page.goto("/index.html#vote-frame")
    card = page.locator('.vote-card[data-file="other-build.jpg"]')
    card.wait_for(timeout=10000)
    card.locator(".vote-btn").click()
    box = page.locator(".mt3uk-signin-box")
    box.wait_for(state="visible", timeout=5000)
    assert "to vote" in box.inner_text()
    assert "one vote each a week" in box.inner_text()
    assert not [c for c in page.api_log if c.startswith("POST /vote ")], page.api_log
    assert not card.locator(".vote-btn").is_disabled(), "The button is ready to use once signed in"
    assert overflow_width(page) <= 1
    assert page.errors == [], diagnostics(page)


@all_devices
def test_signed_in_vote_goes_through(device_page):
    page = device_page
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.goto("/index.html#vote-frame")
    card = page.locator('.vote-card[data-file="other-build.jpg"]')
    card.wait_for(timeout=10000)
    card.locator(".vote-btn").click()
    for _ in range(50):
        if [c for c in page.api_log if c.startswith("POST /vote ")]:
            break
        page.wait_for_timeout(100)
    assert [c for c in page.api_log if c.startswith("POST /vote ")], page.api_log
    assert page.locator(".mt3uk-signin-box").count() == 0
    assert page.errors == [], diagnostics(page)


def test_voting_rules_say_it_is_for_members():
    from pathlib import Path
    html = (Path(__file__).resolve().parent.parent / "index.html").read_text(encoding="utf-8")
    assert "Voting is for members" in html
