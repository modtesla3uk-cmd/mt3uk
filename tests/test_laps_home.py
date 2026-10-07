import re
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


def test_what_laps_does_comes_first_then_the_lap_timers_then_track_mode_and_no_evs_band(page):
    """Under the hero (which ends with Sessions are private until you choose to share them) comes What Laps does, then
    Works with your lap timer, then Tesla Track Mode (Fastest right now stays in the file but is off the front page);
    the EVs band at the foot is gone, the hero already says Any EV,
    any make."""
    open_home(page)
    ids = page.evaluate("[...document.querySelectorAll('main > section')].map(s => s.id)")
    assert ids[:4] == ["what", "timers", "trackmode", "fastest"] and "any-make" not in ids, ids
    expect(page.locator(".lh-hero .lh-evs")).to_contain_text("Any EV, any make")
    page.locator("#lh-fast a").first.wait_for(state="attached")
    expect(page.locator("main .mt3uk-share-dot")).to_have_count(0)


def test_the_session_picture_does_not_open_full_screen_on_a_tap(page):
    open_home(page)
    page.locator("#lh-shot-img").click()
    expect(page.locator(".lh-light")).to_have_count(0)


def test_track_mode_has_its_own_section_and_fastest_right_now_is_off_the_front_page(page):
    open_home(page)
    expect(page.locator("#trackmode")).to_be_visible()
    expect(page.locator("#trackmode h2")).to_contain_text("Tesla Track Mode")
    expect(page.locator("#trackmode .lh-card")).to_have_count(6)
    expect(page.locator("#fastest")).to_be_hidden()
    expect(page.locator(".lh-hero .lh-evs")).to_contain_text("Tesla, Hyundai, Kia, Porsche, Polestar, BMW and more")
    expect(page.locator(".lh-makes")).to_have_count(0)


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


def test_the_track_day_venues_page_shows_each_tracks_laps_times_and_more_tracks(page):
    """js/laps-strip.js on track-day-venues.html: each venue's boards on Laps (fastest, who, how many cars) with
    See the leaderboard and Add your session, an invitation where nothing is shared yet, and the other tracks."""
    page.route("**/%s/**" % API_HOST, lambda r: r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                                         body=json.dumps(COUNTS if "/track/counts" in r.request.url else {"success": True})))
    page.goto("/track-day-venues.html")
    thruxton = page.locator("[data-laps-venue='thruxton']")
    expect(thruxton.locator(".ls-head b")).to_have_text("Thruxton on Laps")
    expect(thruxton.locator(".ls-rows a")).to_have_count(1)
    expect(thruxton.locator(".ls-rows a")).to_contain_text("1:21.42")
    expect(thruxton.locator(".ls-rows a")).to_contain_text("Rich, Arctic Three")
    assert thruxton.locator(".ls-rows a").get_attribute("href") == "leaderboards.html?board=thruxton%3Amain"
    # Laps is an early preview: the heading says so and, signed out, the invitation is to join it, with a note on
    # what the preview is, not Add your session.
    expect(thruxton.locator(".ls-head .early-badge")).to_have_text("Early preview")
    expect(thruxton.get_by_role("link", name="Join the early preview")).to_have_attribute("href", "laps-signin.html")
    expect(thruxton.locator("[data-laps-preview]")).to_contain_text("Anyone can browse the leaderboards")
    expect(thruxton.get_by_role("link", name="Add your session")).to_have_count(0)
    # Nothing shared at Snetterton yet: an invitation to be the first.
    expect(page.locator("[data-laps-venue='snetterton'] .ls-empty")).to_contain_text("be the first")
    # More tracks on Laps: the other boards, not the venues already on the page.
    more = page.locator("[data-laps-more] .ls-rows a")
    expect(more).to_have_count(1)
    expect(more.first).to_contain_text("Santa Pod")
    expect(more.first).to_contain_text("10.84 s")


def answer_with_access(page, access):
    def reply(r):
        url = r.request.url
        body = COUNTS if "/track/counts" in url else {"success": True, "access": access} if "/track/access" in url else {"success": True}
        r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    page.route("**/%s/**" % API_HOST, reply)
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'tok'); localStorage.setItem('mt3ukMyBuildsEmail', 'a@example.com')")


def test_members_with_early_access_are_asked_to_add_their_session(page):
    answer_with_access(page, "approved")
    page.goto("/track-day-venues.html")
    thruxton = page.locator("[data-laps-venue='thruxton']")
    expect(thruxton.get_by_role("link", name="Add your session")).to_have_attribute("href", "track.html?add=1")
    expect(thruxton.locator("[data-laps-preview]")).to_be_hidden()
    page.goto("/track-day-on-the-day.html")
    expect(page.locator("#after-the-day").get_by_role("link", name="Add a session")).to_be_visible()
    page.goto("/leaderboards.html")
    expect(page.locator("#lb-add-session")).to_have_text("Add a session")
    expect(page.locator("#lb-preview")).to_be_hidden()
    # On a phone it is a round plus, as on Sessions.
    page.set_viewport_size({"width": 390, "height": 800})
    b = page.locator("#lb-add-session").bounding_box()
    assert abs(b["width"] - 44) < 2 and abs(b["height"] - 44) < 2, b
    expect(page.locator("#lb-add-session span")).to_be_hidden()


def test_members_waiting_for_early_access_are_told_they_are_on_the_list(page):
    answer_with_access(page, "pending")
    page.goto("/track-day-on-the-day.html")
    card = page.locator("#after-the-day")
    expect(card.get_by_role("link", name="You’re on the list")).to_have_attribute("href", "track.html")
    expect(card.locator("[data-laps-preview]")).to_contain_text("on the early preview list")
    expect(card.get_by_role("link", name="Add a session")).to_have_count(0)


def test_the_leaderboard_invites_members_without_early_access_to_join(page):
    """leaderboards.html is open to everyone; adding a session is for early testers, so a member who has not asked
    sees Join the early preview (to Sessions and its request form) and a note on what the preview is."""
    answer_with_access(page, "none")
    page.goto("/leaderboards.html")
    expect(page.locator("#lb-add-session")).to_have_text("Join the early preview")
    expect(page.locator("#lb-add-session")).to_have_attribute("href", "track.html")
    expect(page.locator("#lb-preview")).to_contain_text("Ask for a place")


def test_a_visitor_to_the_leaderboard_sees_join_the_early_preview_the_size_of_my_sessions(page):
    """Signed out: Join the early preview (to the Laps sign-up) is the same size as My Sessions on desktop, the
    note no longer asks them to join a list, and What is the Leaderboard? says what is there once the preview ends."""
    def reply(r):
        body = COUNTS if "/track/counts" in r.request.url else {"success": True}
        r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    page.route("**/%s/**" % API_HOST, reply)
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/leaderboards.html?type=track")
    join = page.locator("#lb-add-session")
    expect(join).to_have_text("Join the early preview")
    expect(join).to_have_attribute("href", "laps-signin.html")
    expect(page.locator("#lb-preview")).to_have_text("Early preview. Anyone can browse the leaderboards. Adding your own laps is open to early testers while we finish Laps.")
    mine, j = page.locator("#lb-my-sessions").bounding_box(), join.bounding_box()
    assert abs(mine["width"] - j["width"]) < 1 and abs(mine["height"] - j["height"]) < 1, (mine, j)
    assert not join.evaluate("e => e.scrollWidth > e.clientWidth")
    page.locator("#lb-what summary").click()
    expect(page.locator("#lb-what .tp-what-list li")).to_have_count(4)
    expect(page.locator("#lb-what")).to_contain_text("once the preview ends, every member can upload a session")


def test_the_admins_own_early_preview_note_is_used(page):
    def reply(r):
        url = r.request.url
        body = COUNTS if "/track/counts" in url else {"success": True, "copy": {"previewOut": "Testers only for now. Join the list."}} if "/track/copy" in url else {"success": True}
        r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    page.route("**/%s/**" % API_HOST, reply)
    page.goto("/track-day-venues.html")
    expect(page.locator("[data-laps-venue='thruxton'] [data-laps-preview]")).to_have_text("Early preview. Testers only for now. Join the list.")


def test_nothing_is_said_about_the_preview_once_laps_is_open_to_all(page):
    def reply(r):
        url = r.request.url
        body = COUNTS if "/track/counts" in url else {"success": True, "preview": False} if "/laps/signin" in url else {"success": True, "access": "none"}
        r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    page.route("**/%s/**" % API_HOST, reply)
    page.goto("/track-day-venues.html")
    thruxton = page.locator("[data-laps-venue='thruxton']")
    expect(thruxton.get_by_role("link", name="Add your session")).to_be_visible()
    expect(thruxton.locator("[data-laps-preview]")).to_be_hidden()
    expect(thruxton.locator(".early-badge")).to_have_count(0)


def test_the_homepage_sessions_tile_shows_the_fastest_time_on_laps(page):
    page.route("**/%s/**" % API_HOST, lambda r: r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                                         body=json.dumps(COUNTS if "/track/counts" in r.request.url else {"success": True})))
    page.goto("/index.html")
    expect(page.locator(".hp-cat[data-cat='sessions'] [data-laps-fast-line]")).to_have_text("Fastest at Thruxton: 1:21.42, Rich")

