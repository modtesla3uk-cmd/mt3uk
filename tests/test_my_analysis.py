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


def test_the_track_mode_badge_shows_only_when_the_sessions_have_track_mode_figures(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0)
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator("#ma-tm")).to_be_hidden()
    fake2 = FakeWorker(earlier=False)
    add(fake2, "a1", "2026-05-01", 61.0, mode={"brakeTemp": 61, "power": 230})
    open_page(page, fake2, "/my-analysis.html")
    expect(page.locator("#ma-tm")).to_be_visible()
    expect(page.locator("#ma-tm")).to_contain_text("Recorded with Track Mode")


def test_the_track_mode_page_is_out_of_the_laps_menus(page):
    open_page(page, FakeWorker(earlier=False), "/track.html")
    expect(page.locator("#nav-trackmode")).to_have_count(0)
    expect(page.locator('a.nav-sublink-new[href="track-mode.html"]')).to_have_count(0)


def test_the_my_analysis_icon_sits_between_the_favourites_star_and_home(page):
    open_page(page, FakeWorker(earlier=False), "/track.html")
    icons = page.locator("#nav-favs, #nav-analysis, #nav-home")
    expect(icons).to_have_count(3)
    expect(page.locator("#nav-analysis")).to_have_attribute("href", "my-analysis.html")
    # The three icons follow each other in the header, in this order.
    order = page.evaluate("""() => {
        const ids = ['nav-favs', 'nav-analysis', 'nav-home'];
        const els = ids.map(id => document.getElementById(id));
        return els.every((el, i) => i === 0 || (els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) ;
    }""")
    assert order


def test_my_analysis_is_in_the_menu_with_its_icon_after_favourites(page):
    open_page(page, FakeWorker(earlier=False), "/track.html")
    link = page.locator('#navlinks a[href="my-analysis.html"]')
    expect(link).to_have_count(1)
    expect(link).to_contain_text("My Analysis")
    expect(link.locator("svg path")).to_have_count(3)


def test_the_track_drop_down_leaves_out_drives_which_have_no_time(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0)
    r = dict(day_session("a2", "10:00", 90.0, 4, date="2026-05-03", venue="Thruxton", venue_id="thruxton"), layoutId="thruxton", layout="Thruxton", carId="car1")
    fake.index.append(summary(r))
    drive = dict(summary(day_session("d1", "10:00", None, 0, date="2026-05-02", venue="Indy Drive", venue_id="indy-drive")), type="other", layoutId="", layout="", bestTime=None, carId="car1")
    fake.index.append(drive)
    open_page(page, fake, "/my-analysis.html")
    options = page.locator("#ma-track option").all_text_contents()
    assert any("Indy" in o for o in options) and any("Thruxton" in o for o in options), options
    assert not any("Indy Drive" in o for o in options), options
    expect(page.locator(".ma-table tbody tr")).to_have_count(2)
    expect(page.locator(".ma-table")).not_to_contain_text("Indy Drive")


def test_the_track_mode_tick_draws_itself_on_when_the_badge_shows(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, mode={"brakeTemp": 61, "power": 230})
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator("#ma-tm")).to_be_visible()
    assert page.locator("#ma-tm .ma-tm-tick path").evaluate("e => getComputedStyle(e).animationName") == "ma-tick-draw"
    page.wait_for_timeout(900)
    assert page.locator("#ma-tm .ma-tm-tick path").evaluate("e => getComputedStyle(e).strokeDashoffset") in ("0px", "0")
