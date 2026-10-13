import re

from playwright.sync_api import expect

from test_track_page import FakeWorker, save_thruxton_with_a_member_board

PLACE = {"onBoard": True, "place": 2, "of": 7, "board": "Thruxton, Main", "tab": "Track days"}


def open_into_the_day(page):
    page.locator("#tp-exit").click()
    page.locator("#tp-sess-list .tp-trackrow", has_text="Thruxton").click()
    page.locator("#tp-sess-list [data-layout-toggle]").first.click()
    page.locator("#tp-sess-list .tp-day-tile").first.click()


def test_the_sessions_list_shows_each_sessions_place_on_its_leaderboard(page):
    """Each session on the Sessions list says where it ranks ("2nd of 7"), and a session under its title says it in words."""
    fake = FakeWorker()
    fake.ranks = {"new1": dict(PLACE)}
    save_thruxton_with_a_member_board(page, fake)
    sid = list(fake.sessions)[0]
    fake.ranks = {sid: dict(PLACE)}
    open_into_the_day(page)
    expect(page.locator('.tp-row[data-sid="%s"] .tp-rank' % sid)).to_have_text("2nd of 7")
    expect(page.locator('.tp-row[data-sid="%s"] .tp-rank' % sid)).to_have_attribute("title", "Where this session stands on Thruxton, Main")


def test_a_session_that_is_not_on_a_board_says_why_in_the_list_and_under_its_title(page):
    fake = FakeWorker()
    reason =  "It is not shared, so it is not on the leaderboard. Turn on Shared in Session settings to put it there."
    fake.ranks = {"new1": {"onBoard": False, "of": 0, "board": "Thruxton, Main", "tab": "Track days", "reason": reason}}
    save_thruxton_with_a_member_board(page, fake)
    sid = list(fake.sessions)[0]
    open_into_the_day(page)
    tag = page.locator('.tp-row[data-sid="%s"] .tp-rank' % sid)
    expect(tag).to_have_text("Not on a board")
    expect(tag).to_have_attribute("title", reason)
    page.locator('.tp-row[data-sid="%s"]' % sid).click()
    expect(page.locator(".tp-rank-line")).to_contain_text("Not on a leaderboard. It is not shared")
    expect(page.locator(".page-hero .tp-hero-row h1 .tp-title-trophy")).to_have_count(1)
    expect(page.locator(".tp-session-head h2 .tp-title-trophy")).to_have_count(0)


def test_starring_a_session_says_where_it_is_on_the_leaderboard(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    sid = list(fake.sessions)[0]
    fake.star_rank = dict(PLACE)
    star = page.locator("#tp-session-bar [data-fav-toggle]")
    star.click()
    expect(page.locator("#tp-fav-note")).to_have_text("Starred. 2nd of 7 on Thruxton, Main.")
    assert [f["id"] for f in fake.favs] == [sid]


def test_the_session_name_and_trophy_are_in_the_heading_and_the_owner_opens_their_profile(page):
    """A session's name goes in the navy heading with the small trophy, as the Leaderboard heading has, and the owner's
    name under it opens their public profile."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    expect(page.locator(".page-hero .tp-hero-row h1")).to_contain_text("Thruxton")
    expect(page.locator(".page-hero .tp-hero-row h1 .tp-title-trophy")).to_have_count(1)
    expect(page.locator("#tp-by a.tp-member")).to_have_attribute("href", re.compile(r"^member\.html\?car="))
    open_into_the_day(page)
    expect(page.locator(".page-hero .tp-hero-row h1")).to_contain_text("My Sessions")
