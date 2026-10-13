"""My Analysis (my-analysis.html): the signed-in member's own Track sessions, analysed for the car and track picked."""
import re

from playwright.sync_api import expect

from test_track_page import FakeWorker, day_session, open_page, summary


def add(fake, sid, date, best, car="car1", tyres="", pads="", mode=None, brake_g=None, temp=None, drive=""):
    r = dict(day_session(sid, "10:00", best, 4, date=date, venue="Indy", venue_id="indy"), layoutId="indy", layout="Indy", carId=car)
    fake.sessions[sid] = dict(r)
    entry = dict(summary(r), carId=car, tyres=tyres, pads=pads, drive=drive, temp=temp, brakeG=brake_g)
    if mode:
        entry["mode"] = mode
    fake.index.append(entry)


def test_my_analysis_shows_the_tiles_findings_chart_setups_and_every_session(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, tyres="Michelin Pilot Sport 4S", pads="Pagid RSL29", brake_g=1.1, temp=14,
        mode={"soc": [70.0, 62.0], "power": 230, "brakeTemp": 61, "batteryTemp": 49})
    add(fake, "a2", "2026-05-08", 60.5, tyres="Michelin Pilot Sport 4S", pads="Pagid RSL29", brake_g=1.2, temp=16,
        mode={"soc": [66.0, 57.0], "power": 260, "brakeTemp": 84, "batteryTemp": 52})
    add(fake, "a3", "2026-05-15", 60.9, tyres="Toyo R888R", pads="", brake_g=1.0, temp=12,
        mode={"soc": [61.0, 52.0], "power": 240, "brakeTemp": 70, "batteryTemp": 50})
    open_page(page, fake, "/my-analysis.html")
    tiles = page.locator(".ma-tiles .tm-tile")
    expect(tiles).to_have_count(7)
    expect(tiles.nth(0)).to_contain_text("3")
    expect(tiles.nth(1)).to_contain_text("1:00.50")
    expect(page.locator("#ma-app")).to_contain_text("Your best lap is 1:00.50")
    expect(page.locator("#ma-app")).to_contain_text("Your latest lap is 0.10 s quicker than your first")
    # The chart plots every session: a dot each, opening its session.
    expect(page.locator("#ma-app .tm-chart .ma-dot")).to_have_count(3)
    # Every session is listed with its figures.
    rows = page.locator(".ma-table tbody tr")
    expect(rows).to_have_count(3)
    expect(rows.first).to_contain_text("Toyo R888R")
    expect(rows.first).to_contain_text("9.0%")
    # The setups compare tyres (two groups), and the Brake pads chip is shown because a pad is set on two sessions.
    expect(page.locator(".ma-setup .tm-row:not(.tm-head)")).to_have_count(2)
    expect(page.locator(".ma-setup .tm-row:not(.tm-head)").first).to_contain_text("Michelin Pilot Sport 4S")


def test_the_figure_and_setup_chips_change_the_graph_and_the_comparison(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, tyres="Michelin", pads="Pagid", mode={"brakeTemp": 61, "power": 230})
    add(fake, "a2", "2026-05-08", 60.5, tyres="Toyo", pads="Ferodo", mode={"brakeTemp": 84, "power": 260})
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator(".tm-chart h2")).to_have_text("Over time")
    page.locator('[data-metric="brakes"]').click()
    expect(page.locator('[data-metric="brakes"]')).to_have_attribute("aria-pressed", "true")
    expect(page.locator(".tm-chart svg")).to_have_attribute("aria-label", "Hottest brakes for each session, in date order")
    page.locator('[data-setup="pads"]').click()
    expect(page.locator(".ma-setup .tm-row:not(.tm-head)").first).to_contain_text("Ferodo")


def test_my_analysis_picks_a_car_and_a_track(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, car="car1")
    add(fake, "a2", "2026-05-08", 60.5, car="car2")
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator(".ma-table tbody tr")).to_have_count(2)
    page.locator("#ma-car").select_option("car2")
    expect(page.locator(".ma-table tbody tr")).to_have_count(1)


def test_my_analysis_asks_you_to_sign_in_when_signed_out(page):
    open_page(page, FakeWorker(earlier=False), "/my-analysis.html", signed_in=False)
    expect(page.locator("#ma-app")).to_contain_text("Sign in to see your own analysis")


def test_my_analysis_says_when_there_are_no_sessions_yet(page):
    open_page(page, FakeWorker(earlier=False), "/my-analysis.html")
    expect(page.locator("#ma-app")).to_contain_text("No sessions here yet")


def test_the_my_analysis_pill_on_my_sessions_goes_to_the_page(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0)
    open_page(page, fake)
    expect(page.locator("#tp-an-pill")).to_have_attribute("href", "my-analysis.html")
    page.locator("#tp-an-pill").click()
    page.wait_for_url("**/my-analysis.html")
    expect(page.locator("#ma-app")).to_be_visible()


def test_tapping_a_dot_shows_that_session_here_with_a_button_to_open_it(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, tyres="Michelin", brake_g=1.1, mode={"brakeTemp": 61, "power": 230})
    add(fake, "a2", "2026-05-08", 60.5, tyres="Toyo", brake_g=1.2, mode={"brakeTemp": 84, "power": 260})
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator("#ma-pick")).to_contain_text("Press a dot")
    # The dot is the link's own dot, so tapping it stays on the page and shows the session.
    page.locator('.ma-dot[data-session="a2"]').click()
    panel = page.locator("#ma-pick")
    expect(panel).to_contain_text("Toyo")
    expect(panel).to_contain_text("84%")
    expect(panel.locator(".ma-open")).to_have_attribute("href", "track.html?s=a2")
    expect(page.locator('.ma-row[data-session="a2"]')).to_have_class(re.compile("is-picked"))
    # A row in the table selects it the same way, and Open still goes to the session.
    page.locator('.ma-row[data-session="a1"]').click()
    expect(page.locator("#ma-pick")).to_contain_text("Michelin")
    page.locator('.ma-row[data-session="a1"] a').click()
    page.wait_for_url("**/track.html?s=a1")
