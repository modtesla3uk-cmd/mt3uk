"""The Laps front page (laps.html, what laps.mt3uk.com/ opens): the hero's buttons for signed-out and signed-in
visitors, and Fastest right now from /track/counts."""
import json

from playwright.sync_api import expect

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
COUNTS = {"success": True, "counts": {"track-board:thruxton:main": 14, "drag-board:santa-pod": 9, "track-board:gone:main": 99},
          "leaders": {"track-board:thruxton:main": [{"car": "Arctic Three", "owner": "Rich", "model": "Model 3", "make": "Tesla", "time": 81.42}],
                      "drag-board:santa-pod": [{"car": "Venom", "owner": "Kit", "model": "Panigale V4", "make": "Ducati", "quarter": 10.84}],
                      "track-board:gone:main": [{"car": "Old", "owner": "Nobody", "time": 70}]}}


def open_home(page, signed_in=False, panels=None):
    def answer(r):
        url = r.request.url
        body = COUNTS if "/track/counts" in url else {"success": True, "panels": panels or {}} if "/laps/panels" in url else {"success": True}
        r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    page.route("**/%s/**" % API_HOST, answer)
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


def test_the_redirect_from_the_laps_address_goes_on_to_sessions_once_seen(page):
    # laps.mt3uk.com/ is redirected to laps.html?start. The first time, the front page shows, without ?start.
    page.route("**/%s/**" % API_HOST, lambda r: r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                                         body=json.dumps(COUNTS if "/track/counts" in r.request.url else {"success": True})))
    page.goto("/laps.html?start&utm_source=x#what")
    expect(page.locator("#lh-start")).to_have_text("Sign in to start")
    assert page.evaluate("location.search + location.hash") == "?utm_source=x#what"
    # Seen before: on to Sessions, keeping the rest of the address.
    page.goto("/laps.html?start")
    page.wait_for_url("**/track.html")
    # Opened any other way (Play intro, a shared section), it stays.
    page.goto("/laps.html")
    expect(page.locator("#lh-start")).to_be_visible()
    assert page.url.endswith("/laps.html")


def test_play_intro_on_sessions_opens_the_front_page(page):
    from test_track_page import FakeWorker, open_page
    open_page(page, FakeWorker())
    link = page.locator("#tp-play-intro")
    expect(link).to_have_text("Play intro")
    assert link.get_attribute("href") == "laps.html"


def test_the_hero_picture_comes_from_the_sharing_panel(page):
    """The front page's picture is the current pick of the Track sessions sharing set, so the admin controls it;
    with none set, the built-in picture stays."""
    pick = {"success": True, "pick": {"url": "http://localhost:8123/images/track-preview/session-overview.jpg", "caption": "Thruxton, lap 3"}}
    def handler(route):
        body = pick if "/share/track" in route.request.url else {"success": True, "counts": {}, "leaders": {}}
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    page.route("**/%s/**" % API_HOST, handler)
    page.goto("/laps.html")
    expect(page.locator("#lh-shot-img")).to_have_attribute("src", pick["pick"]["url"])
    expect(page.locator("#lh-shot-img")).to_have_attribute("alt", "Thruxton, lap 3")
    pick = {"success": True, "pick": None}
    page.goto("/laps.html")
    page.wait_for_timeout(400)
    assert page.locator("#lh-shot-img").get_attribute("src").endswith("images/track-preview/share.jpg")


def test_a_slow_sessions_page_shows_a_spinner_then_a_note_and_refresh(page):
    """Sessions shows a spinner while it loads; when the worker is slow a note appears, then a Refresh button."""
    from test_track_page import FakeWorker, open_page
    fake = FakeWorker()
    page.add_init_script("window.MT3UK_SLOW_MS = 300;")
    open_page(page, fake)
    # The garage never answers (this route is added after the fake worker's, so it is asked first).
    page.route("**/%s/my-builds" % API_HOST, lambda route: None)
    page.reload()
    expect(page.locator("#tp-loading .tp-spinner")).to_be_visible()
    expect(page.locator("#tp-loading-slow")).to_contain_text("taking a little longer", timeout=3000)
    expect(page.locator("#tp-loading [data-refresh]")).to_be_visible(timeout=3000)


def test_fastest_right_now_comes_first_and_the_sections_have_no_share_buttons(page):
    open_home(page)
    ids = page.evaluate("[...document.querySelectorAll('main > section')].map(s => s.id)")
    assert ids[0] == "fastest", ids
    page.locator("#lh-fast a").first.wait_for()
    expect(page.locator("main .mt3uk-share-dot")).to_have_count(0)


def test_the_admins_words_and_places_are_used_on_the_front_page(page):
    open_home(page, panels={"what": {"heading": "What Laps does for you", "lead": "All from your file.", "cards": [{"title": "Laps, found", "text": ""}]},
                            "timers": {"items": ["RaceBox", "VBOX"]}, "days": {"show": {"front": False}}})
    expect(page.locator("#what h2")).to_have_text("What Laps does for you")
    expect(page.locator("#what .lh-lead")).to_have_text("All from your file.")
    expect(page.locator("#what .lh-card h3").first).to_have_text("Laps, found")
    # A blank card text keeps the page's own words.
    expect(page.locator("#what .lh-card p").first).to_contain_text("Your laps, sectors and corners")
    expect(page.locator("#timers .lh-timers span")).to_have_text(["RaceBox", "VBOX"])
    expect(page.locator("#days")).to_be_hidden()

