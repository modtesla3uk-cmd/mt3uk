"""Back on the Laps pages (js/track-page.js, js/leaderboard-page.js) steps back to the view the member came from: a
session opened from a leaderboard goes back to that board, one opened from a track's list goes back to the list, and a
board goes back to the list it was opened from. With nothing to go back to (a shared link, a bookmark) Back goes to the
view's parent instead, as before."""
import re

from playwright.sync_api import expect

from test_track_page import FakeWorker, board_row, into_track, open_page, shared_session


def laps_fake():
    fake = FakeWorker(earlier=False)
    fake.index = [shared_session("a1", "thruxton", "Thruxton", "main", 100, "2026-04-03"),
                  shared_session("a2", "thruxton", "Thruxton", "main", 101, "2026-04-02"),
                  shared_session("b1", "cadwell", "Cadwell Park", "full", 90, "2026-05-01")]
    for s in fake.index:
        fake.sessions[s["id"]] = dict(s, laps=[], trace={"laps": {}})
    fake.boards = {"/track/board:thruxton:main": [board_row("car1", "a1", 100), board_row("o1", "x", 101)]}
    return fake


def test_a_session_opened_from_a_leaderboard_goes_back_to_the_board(page):
    open_page(page, laps_fake(), "/leaderboards.html")
    page.locator(".tp-board-card", has_text="Thruxton").locator(".lb-layout").first.click()
    expect(page).to_have_url(re.compile(r"leaderboards\.html\?board=thruxton(:|%3A)main$"))
    page.locator(".lb-row a.lb-name").first.click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=a1$"))
    expect(page.locator(".tp-session-head h2")).to_have_text("Thruxton")
    back = page.locator(".tp-back")
    expect(back).to_have_text("Back")
    # It steps back, so its name does not promise the parent view.
    expect(back).to_have_attribute("aria-label", "Back")
    back.click()
    expect(page).to_have_url(re.compile(r"leaderboards\.html\?board=thruxton(:|%3A)main$"))
    expect(page.locator(".lb-row")).to_have_count(2)
    # And the board goes back to the list it was opened from.
    page.locator(".tp-back").click()
    expect(page).to_have_url(re.compile(r"leaderboards\.html$"))
    expect(page.locator(".tp-board-card", has_text="Thruxton")).to_be_visible()


def test_a_session_opened_from_a_tracks_list_goes_back_to_that_list(page):
    open_page(page, laps_fake())
    into_track(page, "Thruxton")
    expect(page).to_have_url(re.compile(r"track\.html\?mycar=.*&at="))
    page.locator('#tp-sess-list .tp-row[data-sid="a2"]').click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=a2$"))
    page.locator(".tp-back").click()
    # Back to Thruxton's list, not the whole list of sessions.
    expect(page.locator(".tp-head h2")).to_have_text("Thruxton")
    expect(page).to_have_url(re.compile(r"track\.html\?mycar=.*&at="))
    page.locator(".tp-back").click()
    # (into_track opens the track page by address, so the list it came from is the one the page was opened on.)
    expect(page).to_have_url(re.compile(r"track\.html(\?mycar=[^&]*)?$"))
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(2)


def test_a_session_opened_directly_goes_back_to_your_sessions(page):
    open_page(page, laps_fake(), "/track.html?s=a1")
    expect(page.locator(".tp-session-head h2")).to_have_text("Thruxton")
    back = page.locator(".tp-back")
    expect(back).to_have_attribute("aria-label", "Back to your sessions")
    back.click()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(2)


def test_a_board_opened_directly_goes_back_to_the_list(page):
    open_page(page, laps_fake(), "/leaderboards.html?board=thruxton:main", signed_in=False)
    expect(page.locator(".lb-row")).to_have_count(2)
    page.locator(".tp-back").click()
    expect(page).to_have_url(re.compile(r"leaderboards\.html\?type=track$"))
    expect(page.locator(".tp-board-card", has_text="Thruxton")).to_be_visible()


def test_a_saved_session_goes_back_past_the_add_page(page, tmp_path):
    from test_track_page import FIXTURE
    fake = laps_fake()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session", exact=True).click()
    expect(page).to_have_url(re.compile(r"track\.html\?add=1"))
    f = tmp_path / "RaceBox Track Session.vbo"
    f.write_bytes(FIXTURE.read_bytes())
    page.set_input_files("#tp-file", str(f))
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new\d$"))
    # Back skips the Add page and lands on the list of sessions, as the browser's back button does.
    page.locator(".tp-back").click()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(2)
    page.go_forward()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new\d$"))
