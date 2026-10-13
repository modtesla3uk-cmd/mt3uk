"""Track Mode, analysed (track-mode.html): the shared sessions with the car's own Track Mode figures, with their analysis."""
import json

from playwright.sync_api import expect

from test_track_page import API_HOST


def run(sid, car, owner, date, venue, layout, best, mode, conditions="Dry"):
    return {"id": sid, "carId": "car-" + sid, "car": car, "owner": owner, "date": date, "time": "10:00", "venue": venue, "layout": layout,
            "type": "track", "bestTime": best, "conditions": conditions, "tyres": "", "logger": "Tesla Track Mode", "mode": mode}


RUNS = [
    run("r1", "PROJECT 3", "RichardHC", "2026-07-14", "Castle Combe", "Full circuit", 80.2, {"soc": [62.0, 55.5], "power": 244, "regen": 79, "brakeTemp": 84, "batteryTemp": 52}),
    run("r2", "Model S", "MDebbage", "2026-05-01", "Thruxton", "Main", 96.4, {"soc": [70.0, 60.0], "power": 310, "brakeTemp": 61, "batteryTemp": 49}),
    run("r3", "Model Y", "Ben", "2026-06-02", "Castle Combe", "Full circuit", 82.9, {"soc": [58.0, 49.0], "power": 220, "brakeTemp": 72, "batteryTemp": 55, "slip": 12}),
    run("r4", "Model 3", "Ann", "2026-06-20", "Thruxton", "Main", 97.1, {"soc": [66.0, 57.0], "power": 260, "brakeTemp": 90}),
]


def open_mode_page(page, runs):
    def reply(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"runs": runs}), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/%s/track/mode-runs" % API_HOST, reply)
    page.add_init_script("navigator.serviceWorker && (navigator.serviceWorker.register = () => new Promise(() => {}))")
    page.add_init_script("localStorage.setItem('mt3ukVisitCount','0');")
    page.goto("/track-mode.html")


def test_track_mode_page_lists_the_shared_sessions_with_their_figures(page):
    open_mode_page(page, RUNS)
    rows = page.locator(".tm-row:not(.tm-head)")
    expect(rows).to_have_count(4)
    # The newest session first, with its charge used and the hottest brakes.
    expect(rows.first).to_contain_text("14 Jul 2026")
    expect(rows.first).to_contain_text("PROJECT 3")
    expect(rows.first).to_contain_text("6.5 pts")
    expect(rows.first).to_contain_text("244 kW")
    expect(rows.first).to_contain_text("84%")
    expect(page.locator(".tm-tile").nth(0)).to_contain_text("4")
    expect(page.locator(".tm-tile").nth(1)).to_contain_text("4")


def test_the_analysis_says_what_the_runs_show(page):
    open_mode_page(page, RUNS)
    findings = page.locator(".tm-card").first.locator("li")
    expect(findings.nth(0)).to_contain_text("most charge used")
    expect(findings.nth(0)).to_contain_text("Thruxton")
    expect(findings.nth(1)).to_contain_text("90%")
    expect(findings.nth(2)).to_contain_text("310 kW")
    expect(findings.nth(3)).to_contain_text("quicker half")
    # The chart has a dot for each run with a lap time and charge used.
    expect(page.locator(".tm-chart circle")).to_have_count(4)


def test_a_track_filter_and_sort_change_the_list(page):
    open_mode_page(page, RUNS)
    rows = page.locator(".tm-row:not(.tm-head)")
    page.locator("#tm-track").select_option(label="Thruxton · Main")
    expect(rows).to_have_count(2)
    page.locator("#tm-track").select_option("all")
    page.locator("#tm-sort").select_option("best")
    expect(rows.first).to_contain_text("1:20.20")
    page.locator("#tm-sort").select_option("power")
    expect(rows.first).to_contain_text("310 kW")


def test_with_no_shared_track_mode_sessions_it_says_so(page):
    open_mode_page(page, [])
    expect(page.locator("#tm-app")).to_contain_text("No Track Mode sessions yet")
    expect(page.locator(".tm-row")).to_have_count(0)


def test_the_laps_front_page_links_to_the_track_mode_page(page):
    page.goto("/laps.html#trackmode")
    expect(page.locator("#trackmode a[href='track-mode.html']")).to_have_count(1)
