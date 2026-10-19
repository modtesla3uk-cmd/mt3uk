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


def test_my_analysis_shows_the_findings_chart_setups_and_every_session(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, tyres="Michelin Pilot Sport 4S", pads="Pagid RSL29", brake_g=1.1, temp=14,
        mode={"soc": [70.0, 62.0], "power": 230, "brakeTemp": 61, "batteryTemp": 49})
    add(fake, "a2", "2026-05-08", 60.5, tyres="Michelin Pilot Sport 4S", pads="Pagid RSL29", brake_g=1.2, temp=16,
        mode={"soc": [66.0, 57.0], "power": 260, "brakeTemp": 84, "batteryTemp": 52})
    add(fake, "a3", "2026-05-15", 60.9, tyres="Toyo R888R", pads="", brake_g=1.0, temp=12,
        mode={"soc": [61.0, 52.0], "power": 240, "brakeTemp": 70, "batteryTemp": 50})
    open_page(page, fake, "/my-analysis.html")
    # No summary tiles: the findings, the graph and the rest are what the page leads with.
    expect(page.locator(".ma-tiles")).to_have_count(0)
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
    expect(page.locator(".tm-chart svg")).to_have_attribute("aria-label", "Hottest brakes for each session, by date")
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


def test_the_track_picked_is_remembered_when_the_page_is_opened_again(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0)
    add(fake, "a2", "2026-05-08", 60.5)
    r = dict(day_session("t1", "10:00", 80.0, 4, date="2026-05-22", venue="Thruxton", venue_id="thruxton"), layoutId="thruxton", layout="Thruxton", carId="car1")
    fake.sessions["t1"] = dict(r)
    fake.index.append(dict(summary(r), carId="car1", tyres="", pads="", drive="", temp=None, brakeG=None, mode={"brakeTemp": 70, "power": 240}))
    open_page(page, fake, "/my-analysis.html")
    page.locator("#ma-track").select_option(label="Thruxton · Track day")
    expect(page.locator("#ma-track")).to_have_value("Thruxton|Thruxton")
    # Opened again, the same track is picked (and the All figures grid is on it).
    page.reload()
    expect(page.locator("#ma-track")).to_have_value("Thruxton|Thruxton")
    expect(page.locator("#ma-grid .ma-fig-card").first).to_be_visible()
    # The grid has no track chips of its own: the drop-down above it is the one choice.
    expect(page.locator("button[data-grid-track]")).to_have_count(0)


def test_the_track_choice_stays_in_view_under_the_header_when_the_page_scrolls(page):
    page.set_viewport_size({"width": 390, "height": 844})
    fake = FakeWorker(earlier=False)
    for i, d in enumerate(["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22", "2026-05-29", "2026-06-05"]):
        add(fake, "s%d" % i, d, 60.0 + i * 0.3, brake_g=1.1, temp=12, mode={"brakeTemp": 60 + i * 4, "power": 240, "batteryTemp": 50})
    r = dict(day_session("t1", "10:00", 80.0, 4, date="2026-05-22", venue="Thruxton", venue_id="thruxton"), layoutId="thruxton", layout="Thruxton", carId="car1")
    fake.sessions["t1"] = dict(r)
    fake.index.append(dict(summary(r), carId="car1", tyres="", pads="", drive="", temp=None, brakeG=None, mode={"brakeTemp": 70, "power": 240}))
    open_page(page, fake, "/my-analysis.html")
    page.locator("#ma-track").select_option(label="Thruxton · Track day")
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(300)
    assert page.evaluate("window.scrollY") > 300
    header_bottom = page.evaluate("document.querySelector('header').getBoundingClientRect().bottom")
    track_top = page.locator("#ma-track").bounding_box()["y"]
    # Still on screen, just under the header, with the track drop-down's own choice showing.
    assert header_bottom - 2 <= track_top <= header_bottom + 80, (header_bottom, track_top)
    expect(page.locator("#ma-track")).to_have_value("Thruxton|Thruxton")


def test_over_time_puts_the_fastest_lap_at_the_top_of_the_axis(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0)
    add(fake, "a2", "2026-05-08", 60.5)
    add(fake, "a3", "2026-05-15", 60.9)
    open_page(page, fake, "/my-analysis.html")
    chart = page.locator(".tm-chart svg")
    # The quickest lap (60.50, a2) is the highest dot, and the label at the top of the axis is that time.
    tops = {sid: float(page.locator('.tm-chart .ma-dot[data-session="%s"]' % sid).get_attribute("cy")) for sid in ("a1", "a2", "a3")}
    assert tops["a2"] < tops["a3"] < tops["a1"], tops
    expect(chart.locator("text").filter(has_text="1:00.50")).to_have_count(1)
    top_label = chart.locator("text").filter(has_text="1:00.50").get_attribute("y")
    assert float(top_label) <= 40, top_label


def test_picking_a_figure_in_over_time_says_what_it_is_and_how_it_relates_to_performance(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, mode={"slip": 0.6, "brakeTemp": 61})
    add(fake, "a2", "2026-05-08", 60.5, mode={"slip": 0.9, "brakeTemp": 84})
    open_page(page, fake, "/my-analysis.html")
    note = page.locator("#ma-metric-note")
    expect(note).to_contain_text("Your quickest timed lap in the session")
    page.locator('button[data-metric="slip"]').click()
    expect(note).to_contain_text("Slip.")
    expect(note).to_contain_text("estimate from the car of how much the tyres spun or slid")
    expect(page.locator('button[data-metric="slip"]')).to_have_attribute("aria-pressed", "true")


def test_the_section_links_jump_to_each_section_and_the_track_choice_stays_in_view(page):
    page.set_viewport_size({"width": 390, "height": 844})
    fake = FakeWorker(earlier=False)
    for i, d in enumerate(["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22", "2026-05-29", "2026-06-05"]):
        add(fake, "s%d" % i, d, 60.0 + i * 0.3, tyres="Michelin" if i % 2 else "Toyo", brake_g=1.1, temp=12, mode={"brakeTemp": 60 + i * 4, "power": 240, "batteryTemp": 50})
    open_page(page, fake, "/my-analysis.html")
    links = page.locator(".ma-jump a")
    expect(links).to_have_count(4)
    for name, sec in [("Setups", "ma-sec-setup"), ("Sessions", "ma-sec-sessions"), ("Over time", "ma-sec-time"), ("All figures", "ma-sec-grid")]:
        page.locator(".ma-jump a", has_text=name).click()
        page.wait_for_timeout(400)
        top = page.evaluate("document.getElementById('%s').getBoundingClientRect().top" % sec)
        stick = page.evaluate("document.querySelector('.ma-controls').getBoundingClientRect().bottom")
        # The section starts just under the sticky block, not behind it.
        assert stick - 4 <= top <= stick + 80, (name, top, stick)
        # The sticky choices stay on screen under the header.
        assert page.evaluate("document.querySelector('.ma-controls').getBoundingClientRect().top") <= page.evaluate("document.querySelector('header').getBoundingClientRect().bottom") + 2


def test_my_analysis_asks_you_to_sign_in_when_signed_out(page):
    open_page(page, FakeWorker(earlier=False), "/my-analysis.html", signed_in=False)
    expect(page.locator("#ma-app")).to_contain_text("Sign in to see your own analysis")


def test_my_analysis_says_when_there_are_no_sessions_yet(page):
    open_page(page, FakeWorker(earlier=False), "/my-analysis.html")
    expect(page.locator("#ma-app")).to_contain_text("No sessions here yet")


def test_tapping_a_dot_opens_its_day_with_each_session_and_a_button_to_open_it(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, tyres="Michelin", brake_g=1.1, mode={"brakeTemp": 61, "power": 230})
    add(fake, "a2", "2026-05-08", 60.5, tyres="Toyo", brake_g=1.2, mode={"brakeTemp": 84, "power": 260})
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator("#ma-pick")).to_contain_text("Press a dot")
    # A dot opens the day it was driven on, under the graph: each session that day, with its setup, figures and a button to open it.
    page.locator('.ma-dot[data-session="a2"]').click()
    day = page.locator("#ma-day")
    expect(day).to_contain_text("Toyo")
    expect(day).to_contain_text("84%")
    expect(day.locator(".ma-sess")).to_have_count(1)
    expect(day.locator(".ma-sess.is-picked .ma-open")).to_have_attribute("href", "track.html?s=a2")
    expect(page.locator('.ma-row[data-session="a2"]')).to_have_class(re.compile("is-picked"))
    # A row in the table picks its session as before, and Open still goes to the session.
    page.locator('.ma-row[data-session="a1"]').click()
    expect(page.locator("#ma-day")).to_have_count(0)
    expect(page.locator("#ma-pick")).to_contain_text("Michelin")
    page.locator('.ma-row[data-session="a1"] a').click()
    page.wait_for_url("**/track.html?s=a1")


def test_the_day_panel_lists_each_session_of_that_day_with_its_figures_and_colours(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-08", 61.0, tyres="Michelin", brake_g=1.1, temp=14, mode={"brakeTemp": 61, "power": 230})
    add(fake, "a2", "2026-05-08", 60.5, tyres="Toyo", brake_g=1.2, temp=16, mode={"brakeTemp": 84, "power": 260})
    add(fake, "a3", "2026-05-15", 60.9, tyres="Toyo", brake_g=1.0, temp=12, mode={"brakeTemp": 70, "power": 240})
    open_page(page, fake, "/my-analysis.html")
    page.locator('.ma-dot[data-session="a1"]').click()
    day = page.locator("#ma-day")
    expect(day.locator(".ma-day-head h2")).to_contain_text("8 May 2026")
    expect(day.locator(".ma-day-head .tm-note")).to_contain_text("2 sessions on this day")
    expect(day.locator(".ma-sess")).to_have_count(2)
    expect(day.locator(".ma-sess.is-picked")).to_have_count(1)
    # Every figure a session records is listed with a coloured dot; a figure it does not record is left out.
    first = day.locator(".ma-sess").nth(0)
    expect(first).to_contain_text("Peak braking")
    expect(first).to_contain_text("Air temperature")
    expect(first).to_contain_text("Hottest brakes")
    expect(first).not_to_contain_text("Battery used")
    expect(first.locator(".ma-fig i").first).to_have_attribute("style", re.compile("background"))


def test_the_day_panel_sits_under_the_graph_at_every_width_and_closes_back_to_the_placeholder(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, mode={"brakeTemp": 61})
    add(fake, "a2", "2026-05-08", 60.5, mode={"brakeTemp": 84})
    open_page(page, fake, "/my-analysis.html")
    page.locator('.ma-dot[data-session="a2"]').click()
    expect(page.locator("#ma-day")).to_be_visible()
    assert "tm-chart" in page.evaluate("document.getElementById('ma-day').previousElementSibling.className")
    page.set_viewport_size({"width": 390, "height": 844})
    expect(page.locator("#ma-day")).to_be_visible()
    assert "tm-chart" in page.evaluate("document.getElementById('ma-day').previousElementSibling.className")
    assert page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") == 0
    page.locator("#ma-day .ma-day-close").click()
    expect(page.locator("#ma-day")).to_have_count(0)
    expect(page.locator("#ma-pick")).to_contain_text("Press a dot")


def test_a_dot_can_be_opened_from_the_keyboard(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, mode={"brakeTemp": 61})
    add(fake, "a2", "2026-05-08", 60.5, mode={"brakeTemp": 84})
    open_page(page, fake, "/my-analysis.html")
    page.locator('.ma-dot[data-session="a2"]').focus()
    page.keyboard.press("Enter")
    expect(page.locator("#ma-day")).to_be_visible()
    expect(page.locator("#ma-day .ma-sess")).to_have_count(1)


def test_on_a_phone_a_dot_brings_its_graph_and_the_day_under_it_into_view(page):
    page.set_viewport_size({"width": 390, "height": 844})
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, mode={"brakeTemp": 61})
    add(fake, "a2", "2026-05-08", 60.5, mode={"brakeTemp": 84})
    open_page(page, fake, "/my-analysis.html")
    page.locator('.ma-dot[data-session="a2"]').click()
    expect(page.locator("#ma-day")).to_be_visible()
    page.wait_for_timeout(900)
    # The graph sits just below the site header, and the top of its day is on the same screen beneath it.
    graph = page.locator("#ma-app .tm-chart svg").bounding_box()
    day = page.locator("#ma-day").bounding_box()
    assert 80 <= graph["y"] <= 160, graph["y"]
    assert day["y"] < 844, day["y"]


def test_the_track_mode_badge_shows_only_when_the_sessions_have_track_mode_figures(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0)
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator("#ma-tm")).to_be_hidden()
    fake2 = FakeWorker(earlier=False)
    add(fake2, "a1", "2026-05-01", 61.0, mode={"brakeTemp": 61, "power": 230})
    open_page(page, fake2, "/my-analysis.html")
    expect(page.locator("#ma-tm")).to_be_visible()
    # With no track picked the badge counts the sessions recorded with Track Mode.
    expect(page.locator("#ma-tm")).to_contain_text("1 session with Track Mode")


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
    expect(page.locator("#ma-track")).to_be_visible()
    options = page.locator("#ma-track option").all_text_contents()
    assert any("Indy" in o for o in options) and any("Thruxton" in o for o in options), options
    assert not any("Indy Drive" in o for o in options), options
    expect(page.locator(".ma-table tbody tr")).to_have_count(2)
    expect(page.locator(".ma-table")).not_to_contain_text("Indy Drive")


def test_the_track_mode_badge_has_a_red_recording_dot_that_comes_in_when_it_shows(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, mode={"brakeTemp": 61, "power": 230})
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator("#ma-tm")).to_be_visible()
    assert page.locator("#ma-tm .ma-tm-tick circle.ma-rec-dot").count() == 1
    assert "ma-rec-pulse" in page.locator("#ma-tm .ma-rec-dot").evaluate("e => getComputedStyle(e).animationName")
    page.wait_for_timeout(2200)
    assert page.locator("#ma-tm .ma-rec-dot").evaluate("e => getComputedStyle(e).opacity") == "1"


def test_my_analysis_is_a_paid_tool_for_free_members_while_the_switch_is_on(page):
    fake = FakeWorker(earlier=False)
    fake.tiers = {"success": True, "applies": True, "full": False, "balance": 4, "nextTopUp": "2026-11-01T00:00:00.000Z"}
    add(fake, "a1", "2026-05-01", 61.0)
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator("#ma-app")).to_contain_text("Data analysis is a Laps Pro feature")


def test_full_access_and_the_switch_off_see_my_analysis(page):
    fake = FakeWorker(earlier=False)
    fake.tiers = {"success": True, "applies": True, "full": True, "balance": 4, "nextTopUp": "2026-11-01T00:00:00.000Z"}
    add(fake, "a1", "2026-05-01", 61.0)
    open_page(page, fake, "/my-analysis.html")
    expect(page.locator("#ma-grid")).to_be_visible()


def test_the_chart_key_sits_under_the_graph_and_the_dots_use_the_three_colours(page):
    fake = FakeWorker(earlier=False)
    for sid, date, best in [("a1", "2026-02-23", 79.4), ("a2", "2026-03-09", 78.1), ("a3", "2026-04-06", 76.9), ("a4", "2026-05-01", 75.8)]:
        add(fake, sid, date, best)
    open_page(page, fake, "/my-analysis.html")
    chart = page.locator("#ma-app .tm-chart")
    key = chart.locator(".ma-key")
    expect(key.locator("span").first).to_contain_text("Fast: within 1% of your best here")
    expect(key.locator("span").nth(2)).to_contain_text("Slow: 3% or more off your best")
    # The key comes under the graph it explains, after its axis labels.
    assert key.bounding_box()["y"] > chart.locator("svg").bounding_box()["y"] + chart.locator("svg").bounding_box()["height"] - 2
    # The measure's name is over the vertical axis.
    expect(chart.locator("svg text").filter(has_text="Best lap")).to_have_count(1)
    # The same colours as the figures, in date order: slow, slow, middle, then fast for the quickest lap.
    fills = chart.locator(".ma-dot").evaluate_all("els => els.map(e => e.getAttribute('fill'))")
    assert fills == ["#e8542a", "#e8542a", "#16233d", "#1f8a70"], fills


def test_the_all_figures_grid_shows_each_figure_at_one_track_with_its_groups(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, brake_g=1.1, temp=14, mode={"brakeTemp": 61, "power": 230, "batteryTemp": 49})
    add(fake, "a2", "2026-05-08", 60.5, brake_g=1.2, temp=16, mode={"brakeTemp": 84, "power": 260, "batteryTemp": 52})
    add(fake, "a3", "2026-05-15", 60.9, brake_g=1.0, temp=12, mode={"brakeTemp": 70, "power": 240, "batteryTemp": 50})
    open_page(page, fake, "/my-analysis.html")
    grid = page.locator("#ma-grid")
    expect(grid).to_be_visible()
    # A card for each figure the sessions record, and none for a figure they do not.
    expect(grid.locator('.ma-fig-card[data-figure="lap"]')).to_be_visible()
    expect(grid.locator('.ma-fig-card[data-figure="brakes"]')).to_contain_text("84%")
    expect(grid.locator('.ma-fig-card[data-figure="brakep"]')).to_have_count(0)
    # A group shows only its figures.
    page.locator('button[data-grid-group="Brakes"]').click()
    expect(grid.locator('.ma-fig-card[data-figure="lap"]')).to_be_hidden()
    expect(grid.locator('.ma-fig-card[data-figure="brakes"]')).to_be_visible()
    page.locator('button[data-grid-group="All figures"]').click()
    expect(grid.locator('.ma-fig-card[data-figure="lap"]')).to_be_visible()
    # The All figures grid leads the page: the findings and the graph come after it.
    assert page.evaluate("!!(document.getElementById('ma-grid').compareDocumentPosition(document.querySelector('.tm-finds')) & Node.DOCUMENT_POSITION_FOLLOWING)")
    # There is no By day view: each figure is one dot per session.
    expect(page.locator('button[data-grid-view]')).to_have_count(0)
    expect(page.get_by_role("button", name="By day")).to_have_count(0)
    expect(grid.locator('.ma-fig-card[data-figure="brakes"] .ma-gdot')).to_have_count(3)


def test_on_a_phone_a_grid_dot_opens_its_day_directly_under_that_figure(page):
    page.set_viewport_size({"width": 390, "height": 844})
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, brake_g=1.1, mode={"brakeTemp": 61})
    add(fake, "a2", "2026-05-08", 60.5, brake_g=1.2, mode={"brakeTemp": 84})
    add(fake, "a3", "2026-05-08", 60.9, brake_g=1.0, mode={"brakeTemp": 70})
    open_page(page, fake, "/my-analysis.html")
    page.locator('#ma-grid .ma-fig-card[data-figure="brakes"] .ma-gdot[data-session="a2"]').click()
    expect(page.locator("#ma-day")).to_be_visible()
    # The day sits directly under the figure it was tapped on, and its two sessions are highlighted in that figure.
    assert page.evaluate("document.getElementById('ma-day').previousElementSibling.getAttribute('data-figure')") == "brakes"
    expect(page.locator('#ma-grid .ma-fig-card[data-figure="brakes"] .ma-gdot.is-open')).to_have_count(2)
    # The figure and the top of its day are on the same screen, below the site header.
    page.wait_for_timeout(900)
    top = page.evaluate("document.querySelector('#ma-grid .ma-fig-card[data-figure=\"brakes\"]').getBoundingClientRect().top")
    assert 80 <= top <= 160, top


def test_on_a_desktop_a_grid_dot_opens_its_day_at_the_bottom_of_the_grid(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, brake_g=1.1, mode={"brakeTemp": 61})
    add(fake, "a2", "2026-05-08", 60.5, brake_g=1.2, mode={"brakeTemp": 84})
    open_page(page, fake, "/my-analysis.html")
    page.locator('#ma-grid .ma-fig-card[data-figure="brakes"] .ma-gdot[data-session="a2"]').click()
    expect(page.locator("#ma-day")).to_be_visible()
    assert page.evaluate("document.getElementById('ma-grid').lastElementChild.id") == "ma-day"


def test_the_track_mode_badge_counts_the_sessions_until_a_track_is_picked(page):
    fake = FakeWorker(earlier=False)
    add(fake, "a1", "2026-05-01", 61.0, mode={"brakeTemp": 61, "power": 230})
    add(fake, "a2", "2026-05-08", 60.5, mode={"brakeTemp": 84, "power": 260})
    add(fake, "a3", "2026-05-15", 60.9)
    r = dict(day_session("t1", "10:00", 80.0, 4, date="2026-05-22", venue="Thruxton", venue_id="thruxton"), layoutId="thruxton", layout="Thruxton", carId="car1")
    fake.sessions["t1"] = dict(r)
    fake.index.append(dict(summary(r), carId="car1", tyres="", pads="", drive="", temp=None, brakeG=None, mode={"brakeTemp": 70, "power": 240}))
    open_page(page, fake, "/my-analysis.html")
    # Three of the four sessions carry Track Mode figures, and no track is picked yet.
    expect(page.locator("#ma-tm")).to_contain_text("3 sessions with Track Mode")
    page.locator("#ma-track").select_option(label="Thruxton · Track day")
    expect(page.locator("#ma-tm")).to_contain_text("Recorded with Track Mode")
    expect(page.locator("#ma-tm")).not_to_contain_text("sessions were")
