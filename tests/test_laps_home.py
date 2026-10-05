"""The Laps front page (laps.html, what laps.mt3uk.com/ opens): the hero's buttons for signed-out and signed-in
visitors, and Fastest right now from /track/counts."""
import json

from playwright.sync_api import expect

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
COUNTS = {"success": True, "counts": {"track-board:thruxton:main": 14, "drag-board:santa-pod": 9, "track-board:gone:main": 99},
          "leaders": {"track-board:thruxton:main": [{"car": "Arctic Three", "owner": "Rich", "model": "Model 3", "make": "Tesla", "time": 81.42}],
                      "drag-board:santa-pod": [{"car": "Venom", "owner": "Kit", "model": "Panigale V4", "make": "Ducati", "quarter": 10.84}],
                      "track-board:gone:main": [{"car": "Old", "owner": "Nobody", "time": 70}]}}


def open_home(page, signed_in=False):
    page.route("**/%s/**" % API_HOST, lambda r: r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                                         body=json.dumps(COUNTS if "/track/counts" in r.request.url else {"success": True})))
    if signed_in:
        page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'tok'); localStorage.setItem('mt3ukMyBuildsEmail', 'a@example.com')")
    page.goto("/laps.html")


def test_signed_out_visitors_are_asked_to_sign_in(page):
    open_home(page)
    expect(page.locator("#lh-start")).to_have_text("Sign in to start")
    assert page.locator("#lh-start").get_attribute("href") == "signin.html?next=/track.html"
    rows = page.locator("#lh-fast a")
    # Busiest first; a board for a track no longer listed is left out.
    expect(rows).to_have_count(2)
    expect(rows.first).to_contain_text("Thruxton")
    expect(rows.first).to_contain_text("1:21.42")
    assert rows.first.get_attribute("href") == "leaderboards.html?board=thruxton%3Amain"
    expect(rows.nth(1)).to_contain_text("Santa Pod")
    expect(rows.nth(1)).to_contain_text("10.84 s")
    assert rows.nth(1).get_attribute("href") == "leaderboards.html?drag=santa-pod"
    # Seen once: laps.mt3uk.com/ opens Sessions in this browser from now on.
    assert page.evaluate("localStorage.getItem('mt3ukLapsIntroSeen')") == "1"
    # The Laps logo leads to Sessions, where Play intro brings this page back.
    assert page.locator("header .laps-logo").get_attribute("href") == "track.html"


def test_signed_in_members_go_straight_to_adding_a_session(page):
    open_home(page, signed_in=True)
    expect(page.locator("#lh-start")).to_have_text("Add a session")
    assert page.locator("#lh-start").get_attribute("href") == "track.html?add=1"
    expect(page.locator("#lh-actions")).to_contain_text("Your sessions")


def test_the_homepage_sends_laps_visitors_to_the_laps_front_page():
    from pathlib import Path
    html = (Path(__file__).resolve().parent.parent / "index.html").read_text(encoding="utf-8")
    head = html[:html.index("</head>")]
    assert "location.hostname === 'laps.mt3uk.com'" in head and "/laps.html" in head
    # Signed in, or seen it before: straight to Sessions.
    assert "localStorage.getItem('mt3ukMyBuildsSession') || localStorage.getItem('mt3ukLapsIntroSeen')" in head and "'/track.html'" in head


def test_play_intro_on_sessions_opens_the_front_page(page):
    from test_track_page import FakeWorker, open_page
    open_page(page, FakeWorker())
    link = page.locator("#tp-play-intro")
    expect(link).to_have_text("Play intro")
    assert link.get_attribute("href") == "laps.html"
