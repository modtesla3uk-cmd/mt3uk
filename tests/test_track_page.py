"""track.html in the browser against a stand-in for the worker's /track routes:
adding a session from the real Thruxton RaceBox file (tests/fixtures), the
session page and lap compare, over time with mods, leaderboards, a CSV whose
columns need picking, drag runs away from a strip (members can't save them,
admins can as private street runs), and the phone layout."""
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from playwright.sync_api import expect

from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "thruxton-trimmed.vbo"
API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"

CAR = {
    "id": "car1", "name": "Arctic Three", "virtual": False, "model": "Model 3",
    "view": [{"id": "suspension", "label": "Suspension", "status": "up", "parts": [{"kind": "Coilovers", "what": "KW V3", "meta": "Fitted Apr 2026"}]}],
    "photos": [{"file": "a1.jpg"}],
}
EARLIER = {
    "id": "earlier1", "carId": "car1", "type": "track", "venueId": "thruxton", "venue": "Thruxton", "layoutId": "main", "layout": "Thruxton",
    "date": "2026-03-28", "time": "10:00", "privacy": "private", "conditions": "Dry", "tyres": "Pilot Sport 4S", "temp": 11, "vmax": 190, "quality": "good",
    "bestTime": 102.47, "laps": 5,
}


def summary(rec):
    keys = ["id", "carId", "type", "venueId", "venue", "layoutId", "layout", "date", "time", "privacy", "conditions", "tyres", "temp", "tempSource", "weather", "vmax", "quality", "street", "atVenue"]
    out = {k: rec.get(k) for k in keys if k in rec}
    if rec.get("type") == "drag":
        runs = rec.get("runs") or []
        q = sorted([r for r in runs if r.get("quarter")], key=lambda r: r["quarter"])
        out["runs"] = len(runs)
        if q:
            out["quarter"], out["quarterSpeed"] = q[0]["quarter"], q[0]["quarterSpeed"]
    else:
        out["bestTime"] = rec.get("bestTime")
        out["laps"] = len(rec.get("laps") or [])
    return out


class FakeWorker:
    def __init__(self, admin=False, earlier=True):
        self.sessions = {}
        self.index = [dict(EARLIER)] if earlier else []
        self.admin = admin
        self.saved = []
        self.requests = []

    def reply(self, route):
        req = route.request
        url = urlparse(req.url)
        path, q = url.path, parse_qs(url.query)
        body = None
        if req.post_data:
            try:
                body = json.loads(req.post_data)
            except ValueError:
                body = None
        status, data = 200, {"success": True}
        if path == "/my-builds":
            data = {"success": True, "cars": [CAR]}
        elif path == "/track/sessions" and req.method == "GET":
            data = {"success": True, "sessions": self.index}
        elif path == "/track/sessions" and req.method == "POST":
            rec = dict(body["session"])
            if rec.get("type") == "drag" and not rec.get("atVenue") and not (body.get("street") and self.admin):
                status, data = 400, {"success": False, "message": "Drag runs can only be saved from a drag strip we know."}
            else:
                rec.update({"id": "new%d" % (len(self.sessions) + 1), "carId": body["carId"], "privacy": "private" if body.get("street") else body.get("privacy", "private"),
                            "conditions": body.get("conditions"), "tyres": body.get("tyres"), "temp": body.get("temp"), "tempSource": body.get("tempSource"), "weather": body.get("weather"), "notes": body.get("notes"), "street": bool(body.get("street"))})
                self.sessions[rec["id"]] = rec
                self.saved.append(body)
                self.index.insert(0, summary(rec))
                data = {"success": True, "session": summary(rec)}
        elif path == "/track/session" and req.method == "GET":
            sid = q.get("id", [""])[0]
            rec = self.sessions.get(sid)
            if rec:
                data = {"success": True, "session": dict(rec, mine=True, car=CAR["name"])}
            else:
                status, data = 404, {"success": False}
        elif path == "/track/session" and req.method == "PUT":
            rec = self.sessions[body["id"]]
            for k in ("privacy", "conditions", "tyres", "temp", "tempSource", "weather", "notes"):
                if k in body:
                    rec[k] = body[k]
            self.index = [summary(rec) if s["id"] == rec["id"] else s for s in self.index]
            data = {"success": True, "session": summary(rec)}
        elif path == "/track/session" and req.method == "DELETE":
            sid = q.get("id", [""])[0]
            self.sessions.pop(sid, None)
            self.index = [s for s in self.index if s["id"] != sid]
        elif path == "/track/counts":
            counts = {}
            for s in self.index:
                if s.get("privacy") in ("build", "board") and s.get("venueId") and s.get("layoutId"):
                    k = "track-board:%s:%s" % (s["venueId"], s["layoutId"])
                    counts[k] = counts.get(k, 0) + 1
            data = {"success": True, "counts": counts}
        elif path == "/track/tracks":
            data = {"success": True, "extra": {"venues": []}}
        elif path in ("/track/board", "/sprint/board"):
            # Each car's fastest, with how many sessions it has there.
            kind = "sprint" if path == "/sprint/board" else "track"
            mine = [s for s in self.index if s.get("privacy") in ("build", "board") and s.get("venueId") == q.get("venue", [""])[0] and s.get("type", "track") == kind and s.get("bestTime")]
            entries = []
            if mine:
                best = min(mine, key=lambda s: s["bestTime"])
                entries = [{"carId": "car1", "sessionId": best["id"], "car": CAR["name"], "model": "Model 3", "owner": "Rich", "time": best["bestTime"], "date": best["date"], "conditions": best.get("conditions"), "mods": ["KW V3 coilovers"], "sessions": len(mine)}]
            data = {"success": True, "entries": entries}
        elif path == "/track/public":
            data = {"success": True, "car": {"id": "car1", "name": CAR["name"], "model": "Model 3", "owner": "Rich"}, "mine": False, "sessions": [s for s in self.index if s.get("privacy") in ("build", "board")]}
        elif path == "/track/requests":
            self.requests.append(body)
        elif path == "/admin/viewer-check":
            data = {"success": self.admin}
            status = 200 if self.admin else 401
        else:
            data = {"success": True}
        route.fulfill(status=status, content_type="application/json", body=json.dumps(data), headers={"Access-Control-Allow-Origin": "*"})


def meteo_reply(route):
    """Stand-in for Open-Meteo: 19.4°C and no rain all day at the track."""
    q = parse_qs(urlparse(route.request.url).query)
    day = q.get("start_date", ["2026-05-28"])[0]
    hours = ["%sT%02d:00" % (day, h) for h in range(24)]
    data = {"hourly": {"time": hours, "temperature_2m": [19.4] * 24, "precipitation": [0] * 24, "wind_speed_10m": [12] * 24}}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(data), headers={"Access-Control-Allow-Origin": "*"})


def open_page(page, fake, path="/track.html", signed_in=True, admin=False):
    page.route("**/%s/**" % API_HOST, fake.reply)
    page.route("**/*open-meteo.com/**", meteo_reply)
    script = ""
    if signed_in:
        script += "localStorage.setItem('mt3ukMyBuildsSession','tok');localStorage.setItem('mt3ukMyBuildsEmail','a@example.com');"
    if admin:
        script += "localStorage.setItem('mt3ukAdminViewer', JSON.stringify({token:'admintoken1234567890', expires: Date.now() + 864e5}));"
    script += "localStorage.setItem('mt3ukVisitCount','0');"
    page.add_init_script(script)
    page.goto(path)


def test_signed_out_explains_and_lists_leaderboards(page):
    open_page(page, FakeWorker(), signed_in=False)
    expect(page.locator(".tp-intro h2")).to_have_text("Your track days, mapped")
    expect(page.locator(".tp-intro a.btn").first).to_have_attribute("href", "signin.html?next=/track.html")
    # Visitors can open the leaderboards too, on their own page.
    page.locator("#tp-boards-btn").click()
    expect(page).to_have_url(re.compile(r"leaderboards\.html$"))
    expect(page.locator(".lb-hero h1")).to_have_text("Who’s quickest?")
    expect(page.locator(".tp-board-card").first).to_contain_text("Thruxton")


def test_add_a_session_from_the_racebox_file(page):
    fake = FakeWorker()
    open_page(page, fake)
    expect(page.locator(".tp-boards-link")).to_have_attribute("href", "leaderboards.html")
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    notice = page.locator("#tp-result .tp-notice.is-ok")
    expect(notice).to_contain_text("Thruxton")
    expect(notice).to_contain_text(re.compile(r"2 timed laps, best 1:39\.78[56]"))
    # Air temperature filled in from Open-Meteo, and said so.
    expect(page.locator("#tp-temp")).to_have_value("19")
    expect(page.locator("#tp-temp-src")).to_contain_text("Open-Meteo weather for Thruxton at 14:00: 19°C, no rain")
    expect(page.locator("#tp-temp-src a")).to_have_attribute("href", "https://open-meteo.com/")
    expect(page.locator("[data-cond] [data-v='Dry']")).to_have_class(re.compile("is-on"))
    page.fill("#tp-tyres", "Pilot Sport 4S")
    page.locator("[data-privacy] [data-v='board']").click()
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    saved = fake.saved[0]
    assert saved["carId"] == "car1" and saved["privacy"] == "board" and saved["conditions"] == "Dry" and saved["temp"] == 19
    assert saved["tempSource"] == "weather" and saved["weather"]["temp"] == 19 and saved["weather"]["hour"] == "14:00"
    assert saved["session"]["venueId"] == "thruxton" and abs(saved["session"]["bestTime"] - 99.786) < 0.01
    assert len(json.dumps(saved["session"])) < 200000

    # The session page
    expect(page.locator(".tp-session-head h2")).to_have_text("Thruxton")
    expect(page.locator(".tp-session-head .tp-sub")).to_contain_text("19°C (Open-Meteo)")
    expect(page.locator(".tp-tile.is-hero .v")).to_have_text(re.compile(r"1:39\.78[56]"))
    expect(page.locator(".tp-table").first.locator("tbody tr")).to_have_count(2)
    # Distances in miles with mph (the default), kilometres with km/h.
    expect(page.locator(".tp-tile").nth(4).locator(".v")).to_have_text(re.compile(r"^\d+\.\d mi$"))
    expect(page.locator("#tp-speed")).to_contain_text(" mi")
    page.locator("[data-units]").first.click()
    expect(page.locator(".tp-tile").nth(4).locator(".v")).to_have_text(re.compile(r"^\d+\.\d km$"))
    page.locator("[data-units]").first.click()
    expect(page.locator(".tp-notes").first).to_contain_text("corner 2")
    assert page.locator("#tp-map line").count() > 200
    # Compare: both laps drawn, hovering shows both speeds.
    expect(page.locator("#tp-speed path")).to_have_count(2)
    page.locator("#tp-speed").scroll_into_view_if_needed()
    box = page.locator("#tp-speed").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.5)
    expect(page.locator(".tv-tip")).to_contain_text("Lap 2")
    expect(page.locator("#tp-corners tbody tr").first).to_be_visible()
    # Over time, with the coilovers fitted between the two sessions.
    expect(page.locator("#tp-timeline circle").first).to_be_attached()
    expect(page.locator("#tp-timeline")).to_contain_text("Coilovers: KW V3")
    expect(page.locator("#over-time .tp-notes")).to_contain_text("after Coilovers: KW V3 was fitted")
    # Compare with the earlier day is offered.
    expect(page.locator("#tp-cmp-b optgroup")).to_have_attribute("label", "Your best on other days")


def test_session_settings_and_leaderboard(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-privacy] [data-v='board']").click()
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head .tp-pill")).to_contain_text("Shared")
    page.goto("/track.html?board=thruxton:main")
    expect(page).to_have_url(re.compile(r"leaderboards\.html\?board=thruxton"))
    row = page.locator(".tp-board tbody tr")
    expect(row).to_have_count(1)
    expect(row).to_contain_text("Arctic Three")
    expect(row).to_contain_text(re.compile(r"1:39\.78[56]"))
    page.locator("#lb-models [data-m='Model Y']").click()
    expect(page.locator(".tp-empty")).to_contain_text("Nobody on this board yet for the Model Y")
    # Make it private from the session page.
    page.goto("/track.html?s=new1")
    page.locator("#settings [data-privacy] [data-v='private']").click()
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator(".tp-session-head .tp-pill")).to_contain_text("Only me")
    assert fake.sessions["new1"]["privacy"] == "private"
    # A session saved with the wrong temperature: fill it in from the weather.
    page.fill("#tp-e-temp", "0")
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator(".tp-session-head .tp-sub")).to_contain_text("0°C")
    page.get_by_role("button", name="Fill in from weather").click()
    expect(page.locator("#tp-e-temp")).to_have_value("19")
    expect(page.locator("#tp-e-src")).to_contain_text("Open-Meteo")
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator(".tp-session-head .tp-sub")).to_contain_text("19°C (Open-Meteo)")
    assert fake.sessions["new1"]["tempSource"] == "weather"


def test_csv_with_unknown_columns_asks_which_is_which(page):
    # The same laps as a CSV with columns we don't recognise.
    lines = FIXTURE.read_text(encoding="latin-1").splitlines()
    data = lines[lines.index("[data]") + 1:]
    rows = ["a,b,c,d"]
    t0 = None
    for r in data:
        f = r.split()
        t = int(f[0][:2]) * 3600 + int(f[0][2:4]) * 60 + float(f[0][4:])
        t0 = t if t0 is None else t0
        rows.append("%.2f,%.7f,%.7f,%s" % (t - t0, float(f[1]) / 60, -float(f[2]) / 60, f[3]))
    csv = ROOT / "tests" / "fixtures" / "_tmp_unknown.csv"
    csv.write_text("\n".join(rows), encoding="utf-8")
    try:
        open_page(page, FakeWorker())
        page.goto("/track.html?add=1&car=car1")
        page.set_input_files("#tp-file", str(csv))
        expect(page.locator(".tp-mapping")).to_contain_text("Which column is which?")
        page.select_option("#tp-map-time", "0")
        page.select_option("#tp-map-lat", "1")
        page.select_option("#tp-map-lng", "2")
        page.select_option("#tp-map-speed", "3")
        page.select_option("#tp-map-unit", "km/h")
        page.get_by_role("button", name="Read the file").click()
        expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Thruxton")
    finally:
        csv.unlink()


def drag_csv(lat, lng):
    rows, x = ["time,latitude,longitude,speed (mph)"], 0.0
    import math
    for i in range(201):
        t = i / 10
        v = 0 if t < 2 else 150 * (1 - math.exp(-(t - 2) / 6.65))
        x += v * 0.44704 * 0.1
        rows.append("%.1f,%.7f,%.7f,%.2f" % (t, lat + x / 110540, lng, v))
    for i in range(1, 61):
        rows.append("%.1f,%.7f,%.7f,%.2f" % (20 + i / 10, lat + (x + i) / 110540, lng, max(0, 140 - i * 3)))
    return "\n".join(rows)


@pytest.mark.parametrize("admin", [False, True])
def test_drag_run_away_from_a_strip(page, admin):
    path = ROOT / "tests" / "fixtures" / "_tmp_street.csv"
    path.write_text(drag_csv(51.5, -0.12), encoding="utf-8")
    try:
        fake = FakeWorker(admin=admin)
        open_page(page, fake, "/track.html?add=1&car=car1", admin=admin)
        page.set_input_files("#tp-file", str(path))
        page.locator("[data-type] [data-v='drag']").click()
        expect(page.locator("#tp-result")).to_contain_text("We couldn't find a drag strip here")
        if not admin:
            expect(page.locator("#tp-street")).to_have_count(0)
            expect(page.get_by_role("button", name="Save session")).to_have_count(0)
            page.fill("#tp-req-name", "Local strip")
            page.get_by_role("button", name="Ask for it to be added").click()
            expect(page.locator("#tp-status")).to_contain_text("Thanks")
            assert fake.requests[0]["kind"] == "drag" and fake.requests[0]["name"] == "Local strip"
        else:
            page.locator("#tp-street").click()
            expect(page.locator("#tp-street")).to_have_attribute("aria-checked", "true")
            expect(page.locator("[data-privacy] [data-v='board']")).to_have_count(0)
            page.get_by_role("button", name="Save session").click()
            expect(page.locator(".tp-notice.is-admin")).to_contain_text("Street run")
            assert fake.saved[0]["street"] is True and fake.saved[0]["adminViewer"] == "admintoken1234567890"
            expect(page.locator(".tp-tile.is-hero .v")).to_have_text(re.compile(r"^\d+\.\d\d s$"))
    finally:
        path.unlink()


def test_phone_layout_has_no_sideways_scroll(page):
    page.set_viewport_size({"width": 390, "height": 844})
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-tile.is-hero .v")).to_have_text(re.compile(r"1:39\.78[56]"))
    wide = page.evaluate("document.documentElement.scrollWidth")
    assert wide <= 390, wide
    over = page.evaluate("""() => [...document.querySelectorAll('#tp-app *')].filter(e => {
        if (e.closest('.tp-scroll')) return false;
        const r = e.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1;
    }).map(e => e.className.baseVal !== undefined ? e.tagName : e.className).slice(0, 5)""")
    assert over == [], over


@all_devices
def test_admin_tracks_panel_sets_up_a_requested_track(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#tracks-wrap > summary").click()
    req = page.locator("#tk-requests .tk-req")
    req.wait_for(timeout=10000)
    assert "Old Airfield" in req.inner_text() and page.locator("#tracks-count").inner_text() == "(1 new)"
    assert "Thruxton" in page.locator("#tk-list").inner_text()
    req.get_by_role("button", name="Set up this track").click()
    form = page.locator("#tk-form")
    assert form.locator("#tk-name").input_value() == "Old Airfield"
    assert form.locator('[data-l="startLine"]').input_value() == "53.1, -1.1, 53.1001, -1.1001"
    form.locator('[data-l="corners"]').fill("Hangar, 53.105, -1.105")
    form.locator("#tk-check").click()
    assert form.locator("#tk-check").get_attribute("aria-checked") == "true"
    form.get_by_role("button", name="Save track").click()
    page.get_by_text("Saved. New uploads use it straight away.").wait_for(timeout=5000)
    put = page.mock_state["track_admin_puts"][-1]["venue"]
    assert put["name"] == "Old Airfield" and put["layouts"][0]["length"] == 2100 and put["check"] is True
    assert put["layouts"][0]["corners"] == [{"name": "Hangar", "lat": 53.105, "lng": -1.105}]
    assert page.mock_state["track_admin_requests"][0] == {"id": "r1", "action": "approve"}
    assert "Old Airfield" in page.locator("#tk-list").inner_text()
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


def test_leaderboards_list_busy_tracks_first_with_counts(page):
    fake = FakeWorker()
    shared = dict(EARLIER, id="sh1", privacy="build")
    fake.index = [shared, dict(EARLIER, id="sh2", privacy="board", bestTime=101.2), dict(EARLIER, id="pv1", privacy="private")]
    fake.sessions = {}
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    first = page.locator(".tp-board-card").first
    expect(first).to_contain_text("Thruxton")
    expect(first).to_contain_text("2 sessions")
    expect(first).to_have_class(re.compile("is-busy"))
    expect(first.locator(".chip .tp-count")).to_have_text("2")
    # Tracks with nothing yet have no number.
    expect(page.locator(".tp-board-card").nth(1).locator(".tp-count")).to_have_count(0)
    first.locator(".chip").first.click()
    # Public view: each car's fastest, so one row for the one car.
    rows = page.locator(".tp-board tbody tr")
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("1:41.200")
    expect(page.locator(".tp-head .tp-sub")).to_contain_text("Each car's fastest lap.")
    # Drag and sprint have their own tabs.
    page.locator(".tp-back").click()
    page.locator(".lb-types a", has_text="Drag").click()
    expect(page.locator(".tp-board-card").first).to_contain_text("Santa Pod")
    page.locator(".lb-types a", has_text="Sprint and hill climb").click()
    expect(page.locator(".tp-board-card").first).to_contain_text("Shelsley Walsh")


def test_cars_are_separate_from_sessions(page):
    open_page(page, FakeWorker())
    cars = page.locator("#tp-cars .tp-car")
    expect(cars).to_have_count(1)
    expect(cars.first).to_contain_text("Arctic Three")
    expect(cars.first).to_contain_text("1 session")
    expect(page.locator(".tp-for")).to_have_text("Arctic Three")
    expect(page.locator(".tp-list .tp-row")).to_have_count(1)
    expect(page.locator(".tp-boards-link")).to_have_attribute("href", "leaderboards.html")
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    types = page.locator("[data-type] button")
    expect(types).to_have_text(["Track day", "Drag run", "Sprint or hill climb", "Other"])
    # Other: mapped and saved, never on a leaderboard.
    page.locator("[data-type] [data-v='other']").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("aren't timed for a leaderboard")
    expect(page.locator("[data-privacy] [data-v='board'] span span")).to_contain_text("no leaderboard")
    # An unknown sprint course: tap the start, then the finish.
    page.locator("[data-type] [data-v='sprint']").click()
    expect(page.locator("#tp-tap-step")).to_have_text("Tap the start line, then the finish line.")
