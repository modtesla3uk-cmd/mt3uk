import re

from playwright.sync_api import expect

from test_track_page import FakeWorker, board_row, open_page


def member_of(fake):
    fake.member = {
        "member": {"name": "Ann"},
        "cars": [{"id": "a", "name": "Ann's 3", "make": "Tesla", "model": "Model 3", "year": "2019"}],
        "sessions": [{"id": "a-dry", "carId": "a", "type": "track", "venue": "Thruxton", "layout": "Main", "date": "2026-04-01",
                      "time": "10:00", "bestTime": 90.0, "laps": 3, "conditions": "Dry", "tyres": ""}],
    }


def test_a_board_name_opens_the_members_profile_and_its_session_opens_from_it(page):
    """Pressing a member's name on a board opens their public profile: their name, their cars and their shared sessions."""
    fake = FakeWorker()
    a = board_row("a", "a-dry", 90.0)
    a.update(owner="Ann", car="Ann's 3")
    fake.boards = {"/track/board:thruxton:main": [a]}
    member_of(fake)
    open_page(page, fake, "/leaderboards.html?board=thruxton:main", signed_in=False)
    page.locator(".lb-row").first.locator("a.lb-name").click()
    expect(page).to_have_url(re.compile(r"member\.html\?car=a$"))
    expect(page.locator("#mp-name")).to_have_text("Ann")
    expect(page.locator("#mp-app .mp-car")).to_contain_text("Ann's 3")
    expect(page.locator("#mp-app .mp-row")).to_have_count(1)
    expect(page.locator("#mp-app .mp-row").first).to_contain_text("Thruxton, Main")
    page.locator("#mp-app .mp-row").first.click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=a-dry"))


def test_a_member_page_with_no_shared_sessions_says_so_and_needs_no_sign_in(page):
    fake = FakeWorker()
    member_of(fake)
    fake.member["sessions"] = []
    open_page(page, fake, "/member.html?car=a", signed_in=False)
    expect(page.locator("#mp-app")).to_contain_text("No shared sessions yet")
    expect(page.locator("#mp-app .mp-car")).to_have_count(1)


def test_an_unknown_car_says_the_member_page_could_not_be_found(page):
    fake = FakeWorker()
    open_page(page, fake, "/member.html?car=nobody", signed_in=False)
    expect(page.locator("#mp-app")).to_contain_text("could not be found")
