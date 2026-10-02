"""track.html in the browser against a stand-in for the worker's /track routes:
adding a session from the real Thruxton RaceBox file (tests/fixtures), the
session page and lap compare, over time with mods, leaderboards, a CSV whose
columns need picking, drag runs away from a strip (members can't save them,
admins can as private street runs), and the phone layout."""
import gzip
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
    keys = ["id", "carId", "type", "venueId", "venue", "layoutId", "layout", "date", "time", "privacy", "conditions", "tyres", "temp", "tempSource", "weather", "vmax", "soc", "quality", "street", "atVenue"]
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
        self.gzipped = False
        self.requests = []
        self.courses = []
        self.sources = {}
        self.boards = {}
        self.access = "approved"
        self.access_requests = []
        self.tyre_extra = {}
        self.fail_source = False

    def reply(self, route):
        req = route.request
        url = urlparse(req.url)
        path, q = url.path, parse_qs(url.query)
        body = None
        raw = req.post_data_buffer
        if raw:
            # Saved sessions come gzipped, as the real worker takes them.
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
                self.gzipped = True
            try:
                body = json.loads(raw)
            except ValueError:
                body = None
        status, data = 200, {"success": True}
        if path == "/my-builds":
            data = {"success": True, "cars": [CAR]}
        elif path == "/track/sessions" and req.method == "GET" and self.access != "approved":
            status, data = 403, {"success": False, "needsAccess": True}
        elif path == "/track/access" and req.method == "GET":
            data = {"success": True, "access": self.access}
        elif path == "/track/access/request" and req.method == "POST":
            self.access_requests.append(body)
            self.access = "pending"
            data = {"success": True, "access": "pending"}
        elif path == "/track/sessions" and req.method == "GET":
            data = {"success": True, "sessions": self.index}
        elif path == "/track/sessions" and req.method == "POST":
            rec = dict(body["session"])
            if False:
                pass
            else:
                rec.update({"id": "new%d" % (len(self.sessions) + 1), "carId": body["carId"], "privacy": "private" if body.get("street") else body.get("privacy", "private"),
                            "conditions": body.get("conditions"), "tyres": body.get("tyres"), "tyreMake": body.get("tyreMake"), "tyreModel": body.get("tyreModel"), "tyreWidth": body.get("tyreWidth"), "tyreProfile": body.get("tyreProfile"), "tyreRim": body.get("tyreRim"), "temp": body.get("temp"), "tempSource": body.get("tempSource"), "weather": body.get("weather"), "notes": body.get("notes"), "street": bool(body.get("street"))})
                self.sessions[rec["id"]] = rec
                self.saved.append(body)
                self.index.insert(0, summary(rec))
                data = {"success": True, "session": summary(rec)}
        elif path == "/track/session" and req.method == "GET":
            sid = q.get("id", [""])[0]
            rec = self.sessions.get(sid)
            if rec:
                data = {"success": True, "session": dict(rec, mine=True, car=CAR["name"], ownerName=rec.get("ownerName", "Rich"))}
            else:
                status, data = 404, {"success": False}
        elif path == "/tyres" and req.method == "GET":
            data = {"success": True, "extra": self.tyre_extra}
        elif path == "/track/session/source" and req.method == "POST":
            sid = q.get("id", [""])[0]
            if self.fail_source:
                status, data = 413, {"success": False, "message": "Those readings are too big to keep."}
            else:
                self.sources[sid] = body
                self.sessions[sid]["hasSource"] = True
        elif path == "/track/session/source" and req.method == "GET":
            sid = q.get("id", [""])[0]
            if sid in self.sources:
                data = dict(self.sources[sid], success=True)
            else:
                status, data = 404, {"success": False, "message": "No readings were kept for this session."}
        elif path == "/track/session" and req.method == "PUT" and body.get("session"):
            old = self.sessions[body["id"]]
            rec = dict(body["session"])
            for k in ("id", "carId", "privacy", "conditions", "tyres", "tyreMake", "tyreModel", "tyreWidth", "tyreProfile", "tyreRim", "temp", "tempSource", "weather", "notes", "hasSource"):
                rec[k] = old.get(k)
            self.sessions[old["id"]] = rec
            self.replaced = getattr(self, "replaced", []) + [body]
            self.index = [summary(rec) if s["id"] == rec["id"] else s for s in self.index]
            data = {"success": True, "session": summary(rec)}
        elif path == "/track/session" and req.method == "PUT":
            rec = self.sessions[body["id"]]
            for k in ("privacy", "conditions", "tyres", "tyreMake", "tyreModel", "tyreWidth", "tyreProfile", "tyreRim", "temp", "tempSource", "weather", "notes"):
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
            leaders = {}
            for k in counts:
                v, l = k.split(":")[1:3]
                here = [x for x in self.index if x.get("privacy") in ("build", "board") and x.get("venueId") == v and x.get("layoutId") == l and x.get("bestTime")]
                if here:
                    best = min(here, key=lambda x: x["bestTime"])
                    leaders[k] = [{"car": CAR["name"], "model": "Model 3", "owner": "Rich", "date": best["date"], "time": best["bestTime"]}]
            data = {"success": True, "counts": counts, "leaders": leaders}
        elif path == "/track/tracks":
            data = {"success": True, "extra": {"venues": []}}
        elif path in ("/track/board", "/sprint/board"):
            # Each car's fastest, with how many sessions it has there.
            kind = "sprint" if path == "/sprint/board" else "track"
            custom = self.boards.get("%s:%s:%s" % (path, q.get("venue", [""])[0], q.get("layout", [""])[0]))
            mine = [s for s in self.index if s.get("privacy") in ("build", "board") and s.get("venueId") == q.get("venue", [""])[0] and s.get("type", "track") == kind and s.get("bestTime")]
            entries = []
            if mine:
                best = min(mine, key=lambda s: s["bestTime"])
                entries = [{"carId": "car1", "sessionId": best["id"], "car": CAR["name"], "model": "Model 3", "owner": "Rich", "time": best["bestTime"], "date": best["date"], "conditions": best.get("conditions"), "mods": ["KW V3 coilovers"], "sessions": len(mine)}]
            data = {"success": True, "entries": custom if custom is not None else entries}
        elif path == "/track/public":
            data = {"success": True, "car": {"id": "car1", "name": CAR["name"], "model": "Model 3", "owner": "Rich"}, "mine": False, "sessions": [s for s in self.index if s.get("privacy") in ("build", "board")]}
        elif path == "/track/requests":
            self.requests.append(body)
        elif path == "/track/admin/course" and req.method == "POST" and not req.headers.get("x-admin-viewer"):
            status, data = 401, {"success": False, "message": "Unauthorised"}
        elif path == "/track/admin/course" and req.method == "POST":
            self.courses.append(body)
            lib = json.loads((ROOT / "data" / "tracks.json").read_text(encoding="utf-8"))
            lib["venues"].append({"id": "made-sprint", "name": body.get("name") or "Made Sprint", "type": "sprint", "lat": body["lat"], "lng": body["lng"], "radius": 2500,
                                  "layouts": [{"id": "course", "name": "Course", "length": body.get("lapLength") or 0, "startLine": body["startLine"], "finishLine": body["finishLine"]}]})
            data = {"success": True, "relinked": 0, "library": lib}
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
    # The service worker's own fetches skip these mocks, so it isn't let register.
    page.add_init_script("navigator.serviceWorker && (navigator.serviceWorker.register = () => new Promise(() => {}))")
    if not getattr(page, "overpass_set", False):
        page.route("**/overpass-api.de/**", lambda route: route.fulfill(status=200, content_type="application/json", body='{"elements": []}', headers={"Access-Control-Allow-Origin": "*"}))
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
    expect(page.locator(".lb-hero h1")).to_have_text("Ranking")
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
    # Wind in the chosen unit, and switching units keeps the upload.
    expect(page.locator("#tp-temp-src")).to_contain_text("wind 7 mph")
    page.fill("#tp-tyre-model", "Cup 2")
    page.locator(".tp-head [data-units]").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"2 timed laps, best 1:39\.78[56]"))
    expect(page.locator("#tp-temp-src")).to_contain_text("wind 12 km/h")
    expect(page.locator("#tp-tyre-model")).to_have_value("Cup 2")
    expect(page.locator("#tp-temp")).to_have_value("19")
    page.locator(".tp-head [data-units]").click()
    expect(page.locator("#tp-temp-src")).to_contain_text("wind 7 mph")
    expect(page.locator("[data-cond] [data-v='Dry']")).to_have_class(re.compile("is-on"))
    page.fill("#tp-tyre-model", "Pilot Sport 4S")
    page.locator("[data-privacy] [data-v='board']").click()
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    saved = fake.saved[0]
    assert fake.gzipped, "the session is sent gzipped"
    assert saved["carId"] == "car1" and saved["privacy"] == "board" and saved["conditions"] == "Dry" and saved["temp"] == 19
    assert saved["tempSource"] == "weather" and saved["weather"]["temp"] == 19 and saved["weather"]["hour"] == "14:00"
    assert saved["session"]["venueId"] == "thruxton" and abs(saved["session"]["bestTime"] - 99.786) < 0.01
    assert len(json.dumps(saved["session"])) < 200000

    # The session page
    expect(page.locator(".tp-session-head h2")).to_have_text("Thruxton")
    expect(page.locator(".tp-session-head .tp-sub")).to_contain_text("19°C (Open-Meteo)")
    expect(page.locator(".tp-tile.is-hero .v")).to_have_text(re.compile(r"1:39\.78[56]"))
    # Which lap, without an "of" count that leaves out the out-lap.
    expect(page.locator(".tp-tile.is-hero .s")).to_have_text(re.compile(r"^Lap \d+$"))
    # Comparing laps: zoomed in, the map follows the car as the speed chart
    # is scrubbed, and the grip chart can be zoomed too.
    m2 = page.locator("#tp-map2")
    m2.scroll_into_view_if_needed()
    # One map: lap A coloured by speed, lap B dashed in its dot's colour, with the speed key.
    expect(m2.locator("g.tv-segs line.tv-speed").first).to_be_attached()
    expect(m2.locator("polyline.tv-line")).to_have_count(1)
    assert m2.locator("polyline.tv-line").get_attribute("stroke-dasharray") == "6 5"
    expect(page.locator("#tp-speedkey")).to_be_visible()
    expect(page.locator("#tp-ramp-lo")).to_have_text(re.compile(r"mph$"))
    # Colour by speed off: both laps' lines, each in its dot's colour (A blue, B orange).
    page.locator("#tp-speedcol").click()
    expect(page.locator("#tp-speedcol")).to_have_attribute("aria-checked", "false")
    expect(m2.locator("polyline.tv-line")).to_have_count(2)
    assert [m2.locator("polyline.tv-line").nth(i).get_attribute("stroke") for i in range(2)] == ["#eb6834", "#2a78d6"]
    expect(page.locator("#tp-speedkey")).to_be_hidden()
    page.locator("#tp-speedcol").click()
    expect(page.locator("#tp-speedkey")).to_be_visible()
    zin = m2.locator("xpath=..").locator(".tv-zoom-in")
    for _ in range(3):
        zin.click()
    vb = lambda: page.evaluate("(() => { const b = document.getElementById('tp-map2').viewBox.baseVal; return [b.x, b.y, b.width, b.height]; })()")
    before = vb()
    sp = page.locator("#tp-speed")
    sp.scroll_into_view_if_needed()
    box = sp.bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.7, box["y"] + box["height"] / 2)
    page.wait_for_timeout(100)
    after = vb()
    assert after[:2] != before[:2], "the zoomed map moved to follow the car"
    dot = page.evaluate("""(() => { const g = [...document.querySelectorAll('#tp-map2 g[visibility="visible"]')][0]; const m = g.getAttribute('transform').match(/translate\\(([-\\d.]+) ([-\\d.]+)\\)/); return [+m[1], +m[2]]; })()""")
    assert after[0] <= dot[0] <= after[0] + after[2] and after[1] <= dot[1] <= after[1] + after[3], (dot, after)
    expect(page.locator("#tp-gg").locator("xpath=..").locator(".tv-zoom-in")).to_be_visible()
    # Zoomed in, the maps stay inside their cards.
    assert page.evaluate("getComputedStyle(document.getElementById('tp-map2')).overflow") == "hidden"
    assert page.evaluate("getComputedStyle(document.getElementById('tp-gg')).overflow") == "hidden"
    expect(page.locator(".tp-gg").locator("xpath=../..").locator("h3")).to_contain_text("How much grip you used")
    # Speed key runs red (slow) through amber to blue (fast), which shows on grass and tarmac.
    expect(page.locator(".tp-ramp i").first).to_have_css("background-image", re.compile(r"rgb\(90, 24, 154\).*rgb\(214, 51, 108\).*rgb\(198, 244, 50\)"))
    expect(page.locator("#tp-laps .tp-table tbody tr")).to_have_count(2)
    # Distances in miles with mph (the default), kilometres with km/h.
    expect(page.locator(".tp-tile").nth(4).locator(".v")).to_have_text(re.compile(r"^\d+\.\d mi$"))
    expect(page.locator("#tp-speed")).to_contain_text(" mi")
    page.locator("[data-units]").first.click()
    expect(page.locator(".tp-tile").nth(4).locator(".v")).to_have_text(re.compile(r"^\d+\.\d km$"))
    page.locator("[data-units]").first.click()
    expect(page.locator(".tp-notes").first).to_contain_text("corner 2")
    assert page.locator("#tp-map2 g.tv-segs line").count() > 200
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
    expect(page.locator("#tp-cmp-b optgroup")).to_have_attribute("label", "Your other sessions at this track")


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
    row = page.locator(".lb-row")
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


def test_older_session_without_readings_asks_for_the_file_again(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    # A new session carries the current version, so it has no note.
    page.goto("/track.html?s=new1")
    expect(page.locator(".tp-session-head")).to_be_visible()
    assert fake.sessions["new1"]["analysisVersion"] >= 2
    expect(page.locator("#tp-old-version")).to_have_count(0)
    # Timed with older code and no readings kept: only uploading again updates it.
    fake.sessions["new1"].pop("analysisVersion")
    fake.sessions["new1"]["hasSource"] = False
    page.goto("/track.html?s=new1")
    expect(page.locator("#tp-old-version")).to_contain_text("Upload the file again to update the times")
    # With readings kept the admin's Re-time sessions can fix it, so no note.
    fake.sessions["new1"]["hasSource"] = True
    page.goto("/track.html?s=new1")
    expect(page.locator(".tp-session-head")).to_be_visible()
    expect(page.locator("#tp-old-version")).to_have_count(0)


def test_close_and_discard_on_a_saved_session(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    page.goto("/track.html?s=new1")
    expect(page.locator("#tp-e-close")).to_have_text("Close")
    expect(page.locator("#tp-e-discard")).to_have_text("Discard")
    expect(page.locator("#tp-e-saveclose")).to_have_count(0)
    # Close with nothing changed just closes, with no question and nothing saved.
    page.locator("#tp-e-close").click()
    expect(page).to_have_url(re.compile(r"/track\.html$"))
    # Close after a change asks first; Cancel keeps the page and the unsaved change.
    page.goto("/track.html?s=new1")
    page.fill("#tp-e-notes", "scribble")
    dialogs = []
    page.once("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    page.locator("#tp-e-close").click()
    assert dialogs and "Close without saving" in dialogs[0]
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    expect(page.locator("#tp-e-notes")).to_have_value("scribble")
    # Accepting it closes without saving.
    page.once("dialog", lambda d: d.accept())
    page.locator("#tp-e-close").click()
    expect(page).to_have_url(re.compile(r"/track\.html$"))
    assert fake.sessions["new1"].get("notes") != "scribble"
    # Discard puts the settings back as last saved and stays on the page.
    page.goto("/track.html?s=new1")
    page.fill("#tp-e-notes", "scribble")
    page.locator("#tp-e-discard").click()
    expect(page.locator("#tp-e-notes")).to_have_value("")
    expect(page.locator("#tp-status")).to_contain_text("Changes discarded")
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert fake.sessions["new1"].get("notes") != "scribble"
    # Save changes keeps the change.
    page.fill("#tp-e-notes", "keep this")
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator("#tp-status")).to_contain_text("Saved")
    assert fake.sessions["new1"]["notes"] == "keep this"


def day_session(sid, time, best, laps, date="2026-07-14", venue="Castle Combe", venue_id="castle-combe"):
    return {"id": sid, "carId": "car1", "type": "track", "venueId": venue_id, "venue": venue, "layoutId": "main", "layout": venue, "date": date, "time": time,
            "privacy": "private", "conditions": "Dry", "bestTime": best, "laps": [{"n": i + 1, "time": best} for i in range(laps)], "vmax": 150}


def test_sessions_at_the_same_track_on_the_same_day_are_grouped_by_time(page):
    fake = FakeWorker(earlier=False)
    day = [day_session("d21", "14:46", 87.71, 4), day_session("d12", "11:29", 81.17, 5), day_session("d07", "09:25", 89.17, 3)]
    other = [day_session("e01", "10:00", 99.0, 4, date="2026-06-01", venue="Thruxton", venue_id="thruxton")]
    for s in day + other:
        fake.sessions[s["id"]] = dict(s)
        fake.index.append(summary(s))
    open_page(page, fake)
    card = page.locator(".tp-daygroup")
    expect(card).to_have_count(1)
    expect(card.locator("h3")).to_have_text("14 Jul 2026 on Castle Combe")
    expect(card.locator(".tp-daygroup-count .tp-small")).to_have_text("3 sessions")
    # Collapsed: only the fastest session of the day shows, with its place in the day.
    expect(card).to_have_attribute("data-open", "false")
    expect(card.locator(".tp-daygroup-label")).to_have_text("Fastest session of the day")
    best = card.locator(".tp-daygroup-best .tp-row")
    expect(best).to_have_count(1)
    expect(best).to_contain_text("#2")
    expect(best).to_contain_text("11:29")
    expect(best).to_contain_text("1:21.170")
    expect(card.locator(".tp-daygroup-all")).to_be_hidden()
    # Opening it lists every session in time of day order, numbered by it, with the fastest marked.
    card.locator(".tp-daygroup-title").click()
    expect(card).to_have_attribute("data-open", "true")
    expect(card.locator(".tp-daygroup-best")).to_be_hidden()
    rows = card.locator(".tp-daygroup-all .tp-row")
    expect(rows).to_have_count(3)
    expect(rows.nth(0)).to_contain_text("#1")
    expect(rows.nth(0)).to_contain_text("09:25")
    expect(rows.nth(0)).to_contain_text("3 laps")
    expect(rows.nth(1)).to_contain_text("#2")
    expect(rows.nth(1)).to_contain_text("11:29")
    expect(rows.nth(1).locator(".tp-fastest")).to_have_text("Fastest")
    expect(rows.nth(2)).to_contain_text("#3")
    expect(rows.nth(2)).to_contain_text("14:46")
    expect(card.locator(".tp-fastest")).to_have_count(1)
    # It stays open when the list is drawn again (changing the track filter), and closes again from the heading.
    card.locator(".tp-daygroup-title").click()
    expect(card).to_have_attribute("data-open", "false")
    # A session on its own stays a plain row.
    expect(page.locator("#tp-sess-list > a.tp-row")).to_have_count(1)
    expect(page.locator("#tp-sess-list > a.tp-row")).to_contain_text("Thruxton")
    # Opening one says where it falls in the day.
    card.locator(".tp-daygroup-title").click()
    rows.nth(1).click()
    expect(page.locator("#tp-day-place")).to_have_text("Session 2 of 3 that day")
    # Phone: no sideways scroll.
    page.set_viewport_size({"width": 390, "height": 844})
    page.go_back()
    expect(page.locator(".tp-daygroup")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_a_lone_session_has_no_day_number(page):
    fake = FakeWorker(earlier=False)
    s = day_session("solo1", "10:00", 90.0, 4)
    fake.sessions[s["id"]] = dict(s)
    fake.index.append(summary(s))
    open_page(page, fake)
    expect(page.locator(".tp-daygroup")).to_have_count(0)
    page.locator("#tp-sess-list a.tp-row").first.click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    expect(page.locator("#tp-day-place")).to_have_count(0)


def test_a_session_says_whose_it_is(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    # Your own: your name, marked as you, and the lap labels start with "You".
    page.goto("/track.html?s=new1")
    expect(page.locator("#tp-by")).to_have_text("Session by Rich (you)")
    # Someone else's, opened from a leaderboard: their name, not marked as you.
    fake.sessions["new1"]["ownerName"] = "Ann"
    page.route("**/track/session?id=new1", lambda route: route.fulfill(
        status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
        body=json.dumps({"success": True, "session": dict(fake.sessions["new1"], mine=False, car="Blue Y", ownerName="Ann")})))
    page.goto("/track.html?s=new1")
    expect(page.locator("#tp-by")).to_have_text("Session by Ann")
    expect(page.locator("#tp-by")).not_to_contain_text("(you)")


def test_saving_a_session_shows_a_saved_message_with_a_way_back(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    # The session opens with a Saved message at the top, above everything else.
    saved = page.locator("#tp-saved")
    expect(saved).to_be_visible()
    expect(saved).to_contain_text("Saved")
    expect(saved).to_contain_text("Your session is saved")
    box = saved.bounding_box()
    assert box["y"] < page.locator(".tp-session-head").bounding_box()["y"]
    # It can be dismissed.
    page.locator("#tp-saved-x").click()
    expect(saved).to_have_count(0)
    # Opening a session later shows no message.
    page.goto("/track.html?s=new1")
    expect(page.locator(".tp-session-head")).to_be_visible()
    expect(page.locator("#tp-saved")).to_have_count(0)
    # Saving again and following the link goes back to the Track sessions list.
    page.goto("/track.html")
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-saved")).to_be_visible()
    page.get_by_role("link", name="Go back to Track sessions").click()
    expect(page).to_have_url(re.compile(r"/track\.html$"))
    expect(page.locator("#tp-saved")).to_have_count(0)
    expect(page.locator("#tp-sess-list")).to_be_visible()


def test_several_files_are_saved_as_a_session_each_grouped_by_day(page, tmp_path):
    fake = FakeWorker(earlier=False)
    open_page(page, fake)
    a, b = tmp_path / "RaceBox Track Session one.vbo", tmp_path / "RaceBox Track Session two.vbo"
    a.write_bytes(FIXTURE.read_bytes())
    b.write_bytes(FIXTURE.read_bytes())
    page.get_by_role("link", name="Add a session", exact=True).click()
    page.set_input_files("#tp-file", [str(a), str(b)])
    expect(page.locator(".tp-file")).to_contain_text("each is saved as its own session")
    page.get_by_role("button", name="Save session").click()
    # Back on the list, with a message that says how many were saved.
    saved = page.locator("#tp-saved")
    expect(saved).to_contain_text("2 sessions saved, one for each file")
    assert len(fake.saved) == 2
    assert sorted(x["session"]["fileName"] for x in fake.saved) == ["RaceBox Track Session one.vbo", "RaceBox Track Session two.vbo"]
    assert all(not x["session"].get("runs") or isinstance(x["session"]["runs"], list) for x in fake.saved)
    # Each is its own session, grouped on the day.
    expect(page.locator(".tp-daygroup")).to_have_count(1)
    expect(page.locator(".tp-daygroup-count .tp-small")).to_have_text("2 sessions")


def test_share_every_session_on_a_day_from_its_group(page):
    fake = FakeWorker(earlier=False)
    for sid, t, best in (("g1", "09:25", 89.1), ("g2", "11:29", 81.1), ("g3", "14:46", 87.7)):
        rec = day_session(sid, t, best, 3)
        fake.sessions[sid] = dict(rec)
        fake.index.append(summary(rec))
    open_page(page, fake)
    sw = page.locator("[data-day-share]")
    expect(sw).to_have_attribute("aria-checked", "false")
    # Turning it on asks first; Cancel changes nothing.
    page.once("dialog", lambda d: d.dismiss())
    sw.click()
    assert all(v["privacy"] == "private" for v in fake.sessions.values())
    # Accepting shares all three, and says so.
    page.once("dialog", lambda d: d.accept())
    sw.click()
    expect(page.locator("#tp-saved")).to_contain_text("All 3 sessions at 14 Jul 2026 at Castle Combe are now Shared")
    assert all(v["privacy"] == "board" for v in fake.sessions.values())
    expect(page.locator("[data-day-share]")).to_have_attribute("aria-checked", "true")
    # Turning it off makes them all Only me, with no question.
    page.locator("[data-day-share]").click()
    expect(page.locator("#tp-saved")).to_contain_text("are now Only me")
    assert all(v["privacy"] == "private" for v in fake.sessions.values())


def merged_session(files=None):
    """A session saved the old way: files merged into one, with its readings kept. files = [(name, text)]; the Thruxton test file twice by default."""
    import subprocess
    if files is None:
        text = FIXTURE.read_text(encoding="latin-1")
        files = [("thruxton-1.vbo", text), ("thruxton-2.vbo", text)]
    script = (
        "const fs=require('fs');const T=require('./js/track-parse.js');"
        "const lib=JSON.parse(fs.readFileSync('data/tracks.json','utf8'));"
        "const files=JSON.parse(fs.readFileSync(0,'utf8'));"
        "const c=T.combine(files.map(f=>T.read(f[1],f[0])));const s=T.analyse(c,lib);"
        "const meta={};Object.keys(c).forEach(k=>{if(k!=='points')meta[k]=c[k]});"
        "const r=(v,n)=>v==null||!isFinite(v)?null:Math.round(v*n)/n;"
        "const src={v:1,rd:meta,p:c.points.map(q=>[r(q.t,1000),r(q.lat,1e7),r(q.lng,1e7),r(q.v,100),r(q.la,1000),r(q.lo,1000),r(q.sats,1),r(q.temp,10),q.run||0])};"
        "console.log(JSON.stringify({session:s,source:src}));"
    )
    out = subprocess.run(["node", "-e", script], input=json.dumps(files), capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def seed_merged(fake, files=None, sid="m1"):
    data = merged_session(files)
    rec = dict(data["session"], id=sid, carId="car1", privacy="private", conditions="Dry", hasSource=True)
    fake.sessions[sid] = rec
    fake.sources[sid] = data["source"]
    fake.index.append(summary(rec))
    return rec


def test_a_merged_session_can_be_split_into_one_per_file(page):
    data = merged_session()
    fake = FakeWorker(earlier=False)
    rec = dict(data["session"], id="m1", carId="car1", privacy="private", conditions="Dry", tyres="Test tyre", notes="keep me", hasSource=True,
               fileName="RaceBox Track Session on 28-05-2026 16-00.vbo, RaceBox Track Session on 28-05-2026 14-34.vbo")
    assert rec["runs"] == 2
    fake.sessions["m1"] = rec
    fake.sources["m1"] = data["source"]
    fake.index.append(summary(rec))
    open_page(page, fake, path="/track.html?s=m1")
    split = page.locator("#tp-e-split")
    expect(split).to_have_text("Split into 2 sessions")
    page.once("dialog", lambda d: d.accept())
    split.click()
    expect(page.locator("#tp-saved")).to_contain_text("Split into 2 sessions")
    # The merged one is gone and there is one session per file, with the settings carried over and each file's own time.
    assert "m1" not in fake.sessions and len(fake.sessions) == 2
    made = sorted(fake.sessions.values(), key=lambda x: x["time"])
    assert [x["time"] for x in made] == ["14:34", "16:00"]
    assert all(x["date"] == "2026-05-28" and x["notes"] == "keep me" and x["tyres"] == "Test tyre" and x["privacy"] == "private" for x in made)
    assert all(not isinstance(x.get("runs"), int) for x in made)
    expect(page.locator(".tp-daygroup")).to_have_count(1)
    expect(page.locator(".tp-daygroup-count .tp-small")).to_have_text("2 sessions")


def test_a_file_with_no_time_stamps_and_no_lap_is_kept_as_a_drive_beside_the_timed_files(page):
    fake = FakeWorker(earlier=False)
    open_page(page, fake)
    page.get_by_role("link", name="Add a session", exact=True).click()
    drive = (ROOT / "tests" / "fixtures" / "tesla-track-mode-no-timestamps.csv").read_bytes()
    page.set_input_files("#tp-file", files=[
        {"name": "telemetry-v1-2026-05-28-10_00_00.csv", "mimeType": "text/csv", "buffer": tesla_full_csv().encode()},
        {"name": "telemetry-v1-2026-05-28-15_10_30.csv", "mimeType": "text/csv", "buffer": drive}])
    # The drive is not skipped: it says what it is.
    expect(page.locator(".tp-file > div > b")).to_have_text("2 files")
    expect(page.locator(".tp-file-list")).to_contain_text("No time stamps in this file")
    expect(page.locator(".tp-file-skip")).to_have_count(0)
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-saved")).to_contain_text("2 sessions saved")
    assert len(fake.saved) == 2
    types = sorted(x["session"]["type"] for x in fake.saved)
    assert types == ["other", "track"]
    other = [x for x in fake.saved if x["session"]["type"] == "other"][0]
    assert other["privacy"] == "private" and other["session"].get("carData")


def test_a_day_group_adds_up_the_charge_used_on_track_and_between_runs(page):
    fake = FakeWorker(earlier=False)
    day = [("c1", "09:00", 80, 70), ("c2", "11:00", 70, 60), ("c3", "14:00", 60, 55)]
    for sid, t, a, b in day:
        rec = day_session(sid, t, 85.0, 3)
        rec["soc"] = [a, b]
        fake.sessions[sid] = dict(rec)
        fake.index.append(summary(rec))
    # A drive between the runs the same day, with its own charge.
    drive = {"id": "dr1", "carId": "car1", "type": "other", "venue": "Drive", "date": "2026-07-14", "time": "10:00", "privacy": "private", "vmax": 100, "soc": [86.9, 85.2], "quality": "good"}
    fake.sessions["dr1"] = dict(drive)
    fake.index.append(summary(drive))
    # The same drive saved twice counts once.
    dup = dict(drive, id="dr2")
    fake.sessions["dr2"] = dict(dup)
    fake.index.append(summary(dup))
    open_page(page, fake)
    expect(page.locator(".tp-daygroup-charge")).to_have_text("Charge used 25% on track, 2% between runs")
    # The drives are not listed on their own: they sit inside the day's group, opened from its heading.
    expect(page.locator("#tp-sess-list > a.tp-row")).to_have_count(0)
    expect(page.locator(".tp-drives-label")).to_be_hidden()
    page.locator(".tp-daygroup-title").click()
    expect(page.locator(".tp-drives-label")).to_have_text("Drives between runs (2)")
    expect(page.locator(".tp-daygroup-all a.tp-row")).to_have_count(5)
    # A session without battery figures is said so, not hidden.
    rec = fake.sessions["c3"]
    del rec["soc"]
    fake.index = [summary(rec) if x["id"] == "c3" else x for x in fake.index]
    page.reload()
    expect(page.locator(".tp-daygroup-charge")).to_have_text("Charge used 20% on track, 2% between runs (from 2 of 3 sessions)")


def test_a_day_group_without_battery_figures_shows_no_charge_line(page):
    fake = FakeWorker(earlier=False)
    for sid, t in (("n1", "09:00"), ("n2", "11:00")):
        rec = day_session(sid, t, 85.0, 3)
        fake.sessions[sid] = dict(rec)
        fake.index.append(summary(rec))
    open_page(page, fake)
    expect(page.locator(".tp-daygroup")).to_have_count(1)
    expect(page.locator(".tp-daygroup-charge")).to_have_count(0)


def test_a_drive_with_no_day_group_is_listed_on_its_own(page):
    fake = FakeWorker(earlier=False)
    drive = {"id": "dr9", "carId": "car1", "type": "other", "venue": "Drive", "date": "2026-07-14", "time": "10:00", "privacy": "private", "vmax": 100, "soc": [86.9, 85.2], "quality": "good"}
    fake.sessions["dr9"] = dict(drive)
    fake.index.append(summary(drive))
    open_page(page, fake)
    expect(page.locator(".tp-daygroup")).to_have_count(0)
    expect(page.locator("#tp-sess-list > a.tp-row")).to_have_count(1)


def test_a_lap_in_a_file_with_no_time_stamps_is_timed(page):
    fake = FakeWorker(earlier=False)
    open_page(page, fake)
    page.get_by_role("link", name="Add a session", exact=True).click()
    lap = (ROOT / "tests" / "fixtures" / "tesla-track-mode-no-timestamps-lap.csv").read_bytes()
    page.set_input_files("#tp-file", files=[{"name": "telemetry-v1-2024-02-23-15_10_30.csv", "mimeType": "text/csv", "buffer": lap}])
    expect(page.locator(".tp-file-list")).to_contain_text("No time stamps in this file")
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"1 timed lap, best 1:4[5-7]\.\d"))
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    saved = fake.saved[0]["session"]
    assert saved["type"] == "track" and len(saved["laps"]) == 1 and 104 < saved["laps"][0]["time"] < 109


def test_delete_a_whole_day_from_its_group(page):
    fake = FakeWorker(earlier=False)
    for sid, t in (("x1", "09:00"), ("x2", "11:00"), ("x3", "14:00")):
        rec = day_session(sid, t, 85.0, 3)
        fake.sessions[sid] = dict(rec)
        fake.index.append(summary(rec))
    drive = {"id": "xd", "carId": "car1", "type": "other", "venue": "Drive", "date": "2026-07-14", "time": "10:00", "privacy": "private", "vmax": 100, "soc": [86.9, 85.2], "quality": "good"}
    fake.sessions["xd"] = dict(drive)
    fake.index.append(summary(drive))
    other = day_session("keep1", "10:00", 99.0, 4, date="2026-06-01", venue="Thruxton", venue_id="thruxton")
    fake.sessions["keep1"] = dict(other)
    fake.index.append(summary(other))
    open_page(page, fake)
    page.locator(".tp-daygroup-title").click()
    # It asks first, naming how many and which day; Cancel deletes nothing.
    messages = []
    page.once("dialog", lambda d: (messages.append(d.message), d.dismiss()))
    page.locator("[data-day-delete]").click()
    assert messages and "Confirm delete?" in messages[0] and "all 4 sessions for this day (Castle Combe - 14 Jul 2026)" in messages[0]
    assert len(fake.sessions) == 5
    # Accepting deletes the day and its drives, and nothing from another day.
    page.once("dialog", lambda d: d.accept())
    page.locator("[data-day-delete]").click()
    expect(page.locator("#tp-saved")).to_contain_text("Deleted all 4 sessions for this day (Castle Combe - 14 Jul 2026)")
    assert sorted(fake.sessions) == ["keep1"]
    expect(page.locator(".tp-daygroup")).to_have_count(0)
    expect(page.locator("#tp-sess-list > a.tp-row")).to_have_count(1)


def test_sessions_of_one_track_day_can_be_compared_with_each_other_even_at_an_unlisted_track(page):
    fake = FakeWorker(earlier=False)
    # Three sessions the same day at a track that is not in the list: no venue or layout, only a place.
    for sid, t, best in (("u1", "09:00", 90.0), ("u2", "11:00", 88.5), ("u3", "14:00", 91.2)):
        rec = day_session(sid, t, best, 3, venue="Unknown track")
        rec.pop("venueId", None)
        rec.pop("layoutId", None)
        rec["origin"] = [51.4910, -2.2150]
        rec["trace"] = {"hz": 5, "laps": {"1": [[0, 0, 0, 0, 100, 0, 0], [500, 40, 100, 5, 120, 0, 0]], "2": [[0, 0, 0, 0, 100, 0, 0], [500, 40, 100, 5, 120, 0, 0]], "3": [[0, 0, 0, 0, 100, 0, 0], [500, 40, 100, 5, 120, 0, 0]]}}
        rec["best"] = 1
        fake.sessions[sid] = dict(rec)
        fake.index.append(dict(summary(rec), origin=rec["origin"]))
    open_page(page, fake, path="/track.html?s=u2")
    expect(page.locator(".tp-session-head")).to_be_visible()
    group = page.locator("#tp-cmp-b optgroup")
    expect(group).to_have_attribute("label", "Your other sessions at this track")
    # Both other sessions that day are offered, told apart by time.
    options = group.locator("option")
    expect(options).to_have_count(2)
    texts = options.all_inner_texts()
    assert any("14:00" in t and "1:31.200" in t for t in texts) and any("09:00" in t and "1:30.000" in t for t in texts), texts


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
            # It can still be saved: private, off the leaderboards, and MT3UK is told about the strip.
            expect(page.locator("[data-privacy] [data-v='board']")).to_have_count(0)
            page.fill("#tp-req-name", "Local strip")
            page.get_by_role("button", name="Save session").click()
            expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
            assert fake.requests[0]["kind"] == "drag" and fake.requests[0]["name"] == "Local strip"
            assert fake.saved[0]["session"]["type"] == "drag" and not fake.saved[0].get("street")
        else:
            page.locator("#tp-street").click()
            expect(page.locator("#tp-street")).to_have_attribute("aria-checked", "true")
            expect(page.locator("[data-privacy] [data-v='board']")).to_have_count(0)
            page.get_by_role("button", name="Save session").click()
            expect(page.locator(".tp-notice.is-admin")).to_contain_text("Street run")
            assert fake.saved[0]["street"] is True and fake.saved[0]["adminViewer"] == "admintoken1234567890"
            expect(page.locator(".tp-tile.is-hero .v")).to_have_text(re.compile(r"^\d+\.\d\d s$"))
            # A street run shows where the drive went, for testing.
            expect(page.locator("#tp-map")).to_be_visible()
            assert page.locator("#tp-map .tv-speed").count() > 20
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
        // Scrolling tables, and map contents the map cuts off at its edge.
        if (e.closest('.tp-scroll') || e.closest('svg.tv-map')) return false;
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
    req.get_by_role("button", name="Set up by hand").click()
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
    # The top three show on the card, with position, name and time, without opening the track.
    expect(first.locator(".lb-podium li").first).to_contain_text("Rich")
    expect(first.locator(".lb-podium li").first.locator(".lb-pos")).to_have_text("1")
    expect(first.locator(".lb-podium li").first).to_contain_text("1:41.200")
    # Tracks with nothing yet are tucked away until asked for.
    expect(page.locator(".tp-board-card")).to_have_count(1)
    page.get_by_role("button", name=re.compile("Show all")).click()
    assert page.locator(".tp-board-card").count() > 1
    expect(page.locator(".tp-board-card").nth(1).locator(".lb-podium")).to_have_count(0)
    expect(page.get_by_role("button", name=re.compile("Only show"))).to_be_visible()
    page.get_by_role("button", name=re.compile("Only show")).click()
    first.locator(".lb-layout").first.click()
    # Public view: each car's fastest, so one row for the one car.
    rows = page.locator(".lb-row")
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("1:41.200")
    expect(page.locator(".tp-head .tp-sub")).to_contain_text("Each car's fastest lap.")
    # Drag and sprint have their own tabs.
    page.locator(".tp-back").click()
    page.locator(".lb-types a", has_text="Drag").click()
    expect(page.locator(".tp-board-card").first).to_contain_text("Santa Pod")
    # Sprints and hill climbs are separate tabs.
    page.locator(".lb-types a", has_text="Sprint").click()
    expect(page.locator(".tp-board-card").first).to_contain_text("Curborough")
    expect(page.locator(".tp-board-card", has_text="Shelsley Walsh")).to_have_count(0)
    page.locator(".lb-types a", has_text="Hill climb").click()
    expect(page.locator(".tp-board-card").first).to_contain_text("Shelsley Walsh")
    expect(page.locator(".tp-board-card", has_text="Curborough")).to_have_count(0)
    # A hill climb's board goes back to the hill climbs, a sprint's to the sprints.
    page.locator(".tp-board-card", has_text="Shelsley Walsh").locator(".lb-layout").first.click()
    expect(page.locator(".tp-back")).to_have_text("All hill climbs")
    page.locator(".tp-back").click()
    expect(page.locator(".lb-types a.is-on")).to_have_text("Hill climb")
    page.locator(".lb-types a", has_text="Sprint").click()
    page.locator(".tp-board-card", has_text="Curborough").locator(".lb-layout").first.click()
    expect(page.locator(".tp-back")).to_have_text("All sprints")


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


def _without_start_line(route):
    d = json.loads((ROOT / "data" / "tracks.json").read_text(encoding="utf-8"))
    for v in d["venues"]:
        if v["id"] == "thruxton":
            for layout in v.get("layouts", []):
                layout.pop("startLine", None)
    route.fulfill(status=200, content_type="application/json", body=json.dumps(d))


def test_tap_the_start_line_on_a_zoomable_map(page, tmp_path):
    """A track with no start line yet (like Bedford): the member zooms the
    map and taps the line. Taps still land in the right place when zoomed."""
    no_line = tmp_path / "noline.vbo"
    no_line.write_bytes(b"".join(l for l in FIXTURE.read_bytes().splitlines(True) if not l.startswith(b"Start ")))
    page.route(re.compile(r".*/data/tracks\.json.*"), _without_start_line)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(no_line))
    # A track day finds its own lap line; a sprint needs the start and the finish tapped.
    page.locator("[data-type] [data-v='sprint']").click()
    tap = page.locator("#tp-tap")
    tap.wait_for(timeout=10000)
    tap.scroll_into_view_if_needed()
    expect(page.locator("#tp-result")).to_contain_text("Zoom in")
    width = lambda: page.evaluate("document.getElementById('tp-tap').viewBox.baseVal.width")
    full = width()
    reset = page.locator(".tv-zoom-reset")
    expect(reset).to_be_hidden()
    page.locator(".tv-zoom-in").click()
    page.locator(".tv-zoom-in").click()
    assert width() < full * 0.5, "zoomed in"
    expect(reset).to_be_visible()
    reset.click()
    assert abs(width() - full) < 0.5, "reset shows the whole track"
    # Zooming out goes past the whole track, so there is room round it, and reset brings it back.
    for _ in range(6):
        page.locator(".tv-zoom-out").click()
    assert width() > full * 2, "zooms out past the whole track"
    expect(reset).to_be_visible()
    reset.click()
    assert abs(width() - full) < 0.5, "reset shows the whole track again"
    # Scroll-zoom over a point on the trace: it stays under the pointer, and
    # a tap there through the zoomed viewBox still finds the laps.
    pt = page.evaluate("""() => {
      const svg = document.getElementById('tp-tap'), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
      const pts = svg.querySelector('polyline').getAttribute('points').split(' ').map(s => s.split(',').map(Number));
      const p = pts[Math.floor(pts.length / 2)];
      return [r.left + p[0] * r.width / vb.width, r.top + p[1] * r.height / vb.height];
    }""")
    page.mouse.move(pt[0], pt[1])
    for _ in range(3):
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(50)
    assert width() < full * 0.6, "scroll zooms in"
    page.mouse.click(pt[0], pt[1])
    expect(page.locator("#tp-tap .tp-tapmark")).to_have_count(1)


def test_tesla_track_mode_file_finds_its_own_laps(page):
    """Tesla Track Mode telemetry: times in milliseconds and a Lap column.
    At a track with no start line yet, the laps come from the file, with no
    tap needed."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _without_start_line)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(ROOT / "tests" / "fixtures" / "tesla-track-mode-thruxton.csv"))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"2 timed laps, best 1:39\.\d+"))
    expect(page.locator("#tp-tap")).to_have_count(0)
    expect(page.locator("body")).to_contain_text(re.compile(r"readings, 1[0-4] a second"))


def test_tesla_file_gets_its_date_and_weather_from_the_file_name(page):
    """Tesla files have no date inside: it comes from the file name, then the
    temperature is looked up for that day and hour."""
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    data = (ROOT / "tests" / "fixtures" / "tesla-track-mode-thruxton.csv").read_bytes()
    page.set_input_files("#tp-file", files=[{"name": "telemetry-v1-2024-03-29-15_39_08.csv", "mimeType": "text/csv", "buffer": data}])
    expect(page.locator("#tp-date")).to_have_value("2024-03-29")
    expect(page.locator("#tp-time")).to_have_value("15:39")
    expect(page.locator("#tp-date-src")).to_contain_text("from the file name")
    expect(page.locator(".tp-file-when")).to_have_text("29 Mar 2024, 15:39 (from the file name)")
    expect(page.locator("#tp-temp")).to_have_value("19")
    expect(page.locator("#tp-temp-src")).to_contain_text("Open-Meteo")
    # Changing the date looks the weather up again for the new day.
    page.fill("#tp-date", "2024-03-30")
    page.locator("#tp-date").dispatch_event("change")
    expect(page.locator("#tp-date-src")).to_have_count(0)
    expect(page.locator("#tp-temp-src")).to_contain_text("Open-Meteo")


def test_file_with_no_date_uses_when_it_was_saved(page):
    """No date in the file or its name: the date and start time come from
    when the file was saved on the device, less the session's length."""
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    expect(page.locator("#tp-file")).to_be_attached()
    text = (ROOT / "tests" / "fixtures" / "tesla-track-mode-thruxton.csv").read_text()
    page.evaluate("""([text]) => {
        const input = document.getElementById('tp-file');
        // Saved at 16:00 UK time (15:00 UTC) on 3 June 2026.
        const f = new File([text], 'thruxton.csv', { type: 'text/csv', lastModified: Date.UTC(2026, 5, 3, 15, 0, 0) });
        const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }""", [text])
    expect(page.locator("#tp-date")).to_have_value("2026-06-03")
    expect(page.locator("#tp-time")).to_have_value(re.compile(r"^15:[45]\d$"))
    expect(page.locator("#tp-date-src")).to_contain_text("saved on your device")
    expect(page.locator(".tp-file-when")).to_contain_text(re.compile(r"3 Jun 2026, 15:[45]\d \(from when the file was saved\)"))


SAT_TILE = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#3d5a2a"/></svg>'


def sat_reply(route):
    """Stand-in for the Esri satellite tiles."""
    route.fulfill(status=200, content_type="image/svg+xml", body=SAT_TILE, headers={"Access-Control-Allow-Origin": "*"})


def test_an_older_session_from_several_files_keeps_its_runs(page):
    """A session saved before files were split: laps in runs, no lap across
    the gap between files, and a Session column on the session page."""
    page.route("**/World_Imagery/**", sat_reply)
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    data = FIXTURE.read_bytes()
    page.set_input_files("#tp-file", files=[
        {"name": "session-1.vbo", "mimeType": "text/plain", "buffer": data},
        {"name": "session-2.vbo", "mimeType": "text/plain", "buffer": data},
    ])
    expect(page.locator(".tp-file > div > b")).to_have_text("2 files")
    expect(page.locator(".tp-file-list li b")).to_have_text(["session-1.vbo", "session-2.vbo"])
    expect(page.locator(".tp-file-when").first).to_contain_text("recorded in the file")
    expect(page.locator(".tp-file > div > span")).to_contain_text("2 sessions")
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"4 timed laps, best 1:39\.78[56]"))
    # An older session saved from several files keeps its runs: laps never span the gap between files.
    rec = seed_merged(fake)
    assert rec["runs"] == 2 and sorted({l["run"] for l in rec["laps"]}) == [1, 2]
    page.goto("/track.html?s=m1")
    # A track day's files are sessions; sprints and drag are runs.
    expect(page.locator("#tp-laps .tp-table thead th").first).to_have_text("Session")
    expect(page.locator("#tp-cmp-a option").first).to_contain_text(re.compile(r"^Session 1, lap \d+"))
    # Satellite imagery under the map, with its credit, and it can be turned off.
    m = page.locator("#tp-map2")
    expect(m.locator(".tv-sat image").first).to_be_attached()
    credit = m.locator("xpath=..").locator(".tv-sat-credit")
    expect(credit).to_contain_text("Esri")
    m.locator("xpath=..").locator(".tv-zoom-sat").click()
    expect(m.locator(".tv-sat image")).to_have_count(0)
    expect(credit).to_be_hidden()
    m.locator("xpath=..").locator(".tv-zoom-sat").click()
    expect(m.locator(".tv-sat image").first).to_be_attached()
    # Over the satellite picture the grey band is hidden (the photo shows
    # the track); with it off, the band is back.
    expect(m.locator(".tv-band").first).to_be_hidden()
    m.locator("xpath=..").locator(".tv-zoom-sat").click()
    expect(m.locator(".tv-band").first).to_be_visible()
    # Overlapping laps don't darken the band: one see-through group.
    assert m.locator(".tv-bands").get_attribute("opacity") == "0.12"
    # Zoomed in, the track band widens to a real track's width.
    # On screen: the band's width times the zoom.
    band = lambda: float(m.locator(".tv-band").first.get_attribute("stroke-width")) * page.evaluate("(() => { const s = document.getElementById('tp-map2'); return s.getBoundingClientRect().width / s.viewBox.baseVal.width; })()")
    before = band()
    for _ in range(6):
        m.locator("xpath=..").locator(".tv-zoom-in").click()
    assert band() > before * 1.5, (before, band())


def test_files_from_different_days_are_turned_away(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    tesla = (ROOT / "tests" / "fixtures" / "tesla-track-mode-thruxton.csv").read_bytes()
    page.set_input_files("#tp-file", files=[
        {"name": "session.vbo", "mimeType": "text/plain", "buffer": FIXTURE.read_bytes()},
        {"name": "telemetry-v1-2024-03-29-15_39_08.csv", "mimeType": "text/csv", "buffer": tesla},
    ])
    expect(page.locator("#tp-status")).to_contain_text("different days")


def test_another_day_on_the_map(page):
    """Your best lap from another session at the same track goes on the map as
    lap B, dashed, with the day in its label."""
    page.route("**/World_Imagery/**", sat_reply)
    fake = FakeWorker()
    open_page(page, fake)
    for _ in range(2):
        page.goto("/track.html?add=1")
        page.set_input_files("#tp-file", str(FIXTURE))
        expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
        page.get_by_role("button", name="Save session").click()
        expect(page).to_have_url(re.compile(r"track\.html\?s=new\d"))
    sel = page.locator("#tp-cmp-b")
    expect(sel.locator("option[value='x:new1']")).to_have_count(1)
    sel.select_option("x:new1")
    expect(page.locator("#tp-key")).to_contain_text("Your best lap, 28 May (B)")
    expect(page.locator("#tp-map2 polyline.tv-line[stroke-dasharray]")).to_have_count(1)
    # There is only one map now.
    expect(page.locator("#tp-map")).to_have_count(0)


def short_vbo(rows=5):
    """The real file's header with only a few readings: too short to use."""
    lines = FIXTURE.read_text(encoding="latin-1").splitlines()
    cut = lines.index("[data]") + 1
    return "\n".join(lines[:cut + rows]).encode("latin-1")


def later_vbo(hours=1):
    """The real file as if recorded some hours later the same day."""
    out = []
    data = False
    for ln in FIXTURE.read_text(encoding="latin-1").splitlines():
        if data and ln.strip():
            ln = "%02d%s" % (int(ln[:2]) + hours, ln[2:])
        if ln.strip() == "[data]":
            data = True
        out.append(ln)
    return "\n".join(out).encode("latin-1")


def test_a_file_that_is_too_short_is_skipped_and_the_rest_carry_on(page):
    """One recording stopped straight away: it is skipped with a reason, the
    other files still make the session, and no figures from an earlier choice
    are left showing."""
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[
        {"name": "good.vbo", "mimeType": "text/plain", "buffer": FIXTURE.read_bytes()},
        {"name": "pitlane.vbo", "mimeType": "text/plain", "buffer": short_vbo()},
    ])
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"2 timed laps"))
    expect(page.locator(".tp-file > div > b").first).to_have_text("2 files (1 skipped)")
    expect(page.locator(".tp-file-list li.is-skipped")).to_have_count(1)
    expect(page.locator(".tp-file-list li.is-skipped")).to_contain_text("pitlane.vbo")
    expect(page.locator(".tp-file-skip")).to_have_text("Skipped: too short to use")
    # The readings line counts only the file that worked: no "2 sessions".
    expect(page.locator(".tp-file > div > span").last).not_to_contain_text("2 sessions")
    expect(page.locator(".tp-file > div > span").last).to_contain_text("readings")
    # Only short files: the error shows and nothing from before is left.
    page.set_input_files("#tp-file", files=[{"name": "pitlane.vbo", "mimeType": "text/plain", "buffer": short_vbo()}])
    expect(page.locator("#tp-status")).to_contain_text("too short")
    expect(page.locator("#tp-result")).to_be_empty()
    expect(page.locator(".tp-file.is-bad")).to_have_count(1)
    expect(page.locator(".tp-file > div > span")).to_have_count(0)


def test_files_are_listed_in_time_order(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[
        {"name": "b-later.vbo", "mimeType": "text/plain", "buffer": later_vbo()},
        {"name": "a-earlier.vbo", "mimeType": "text/plain", "buffer": FIXTURE.read_bytes()},
    ])
    expect(page.locator(".tp-file-list li b")).to_have_text(["a-earlier.vbo", "b-later.vbo"])


def test_the_tick_lines_up_with_the_top_of_the_file_box(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[
        {"name": "one.vbo", "mimeType": "text/plain", "buffer": FIXTURE.read_bytes()},
        {"name": "two.vbo", "mimeType": "text/plain", "buffer": later_vbo()},
        {"name": "three.vbo", "mimeType": "text/plain", "buffer": later_vbo(2)},
    ])
    tick = page.locator(".tp-file > .icon").bounding_box()
    first = page.locator(".tp-file > div > b").first.bounding_box()
    assert abs(tick["y"] - first["y"]) < 6, (tick, first)


def test_changing_the_type_after_loading_relabels_the_files(page):
    """A track day's files are sessions; switch to a sprint and they are runs."""
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[
        {"name": "one.vbo", "mimeType": "text/plain", "buffer": FIXTURE.read_bytes()},
        {"name": "two.vbo", "mimeType": "text/plain", "buffer": later_vbo()},
    ])
    expect(page.locator(".tp-file > div > span").last).to_contain_text("2 sessions")
    page.locator("[data-type] button[data-v='sprint']").click()
    expect(page.locator(".tp-file > div > span").last).to_contain_text("2 runs")
    page.locator("[data-type] button[data-v='track']").click()
    expect(page.locator(".tp-file > div > span").last).to_contain_text("2 sessions")


def test_saving_keeps_the_readings_and_the_type_can_be_changed_after(page):
    """Saved sessions keep their readings, so the type can be changed on the
    session page: Track day to Other, checked, saved, with the member's own
    details (tyres, notes) kept. Sessions saved without readings say why they
    can't be changed."""
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Use previous tyres").click()
    page.fill("#tp-tyre-model", "AD08R")
    page.fill("#tp-notes", "keep me")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    # The readings went up (gzipped) just after saving.
    assert fake.sources["new1"]["v"] == 1 and len(fake.sources["new1"]["p"]) > 1000
    expect(page.locator("#settings [data-retype] .chip.is-on")).to_have_text("Track day")
    page.locator("#settings [data-retype] button[data-v='other']").click()
    expect(page.get_by_role("heading", name="Change the type")).to_be_visible()
    expect(page.locator("[data-type] .chip.is-on")).to_have_text("Other")
    expect(page.locator("#tp-result")).to_contain_text("Mapped with your top speed and grip")
    # Their details aren't asked for again.
    expect(page.locator("#tp-tyre-model")).to_have_count(0)
    # Thruxton is a known venue, so there is no name to ask for.
    expect(page.locator("#tp-venue-name")).to_have_count(0)
    page.get_by_role("button", name="Save changes").click()
    expect(page.get_by_role("heading", name="Session settings")).to_be_visible()
    rec = fake.sessions["new1"]
    assert rec["type"] == "other" and rec["tyres"] == "Michelin AD08R" and rec["notes"] == "keep me"
    assert fake.replaced[0]["session"]["type"] == "other"
    expect(page.locator("#settings [data-retype] .chip.is-on")).to_have_text("Other")
    # Back to a track day: the laps come back from the saved readings.
    page.locator("#settings [data-retype] button[data-v='track']").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"2 timed laps, best 1:39\.78[56]"))
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator("#settings [data-retype] .chip.is-on")).to_have_text("Track day")
    assert fake.sessions["new1"]["type"] == "track" and len(fake.sessions["new1"]["laps"]) == 2


def test_a_session_saved_without_readings_cannot_change_type(page):
    fake = FakeWorker()
    fake.fail_source = True
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    # The session still saved; the settings say why the type is fixed.
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    expect(page.locator("#settings [data-retype]")).to_have_count(0)
    expect(page.locator("#settings")).to_contain_text("saved before we kept the readings")


def test_changing_to_a_sprint_asks_for_the_start_and_finish(page):
    """A track day saved at a circuit becomes a sprint: the course isn't known,
    so the member taps the start, then the finish, before saving."""
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#settings [data-retype]")).to_be_visible()
    page.locator("#settings [data-retype] button[data-v='sprint']").click()
    expect(page.locator("#tp-tap-step")).to_have_text("Tap the start line, then the finish line.")
    expect(page.get_by_role("button", name="Save changes")).to_have_count(0)
    # Leaving without saving changes nothing.
    page.get_by_role("link", name="Back to the session").click()
    expect(page.locator("#settings [data-retype] .chip.is-on")).to_have_text("Track day")
    assert fake.sessions["new1"]["type"] == "track"


def shared_session(sid, venue_id, venue, layout_id, best, date="2026-04-01", privacy="board"):
    return dict(EARLIER, id=sid, venueId=venue_id, venue=venue, layoutId=layout_id, layout=venue, bestTime=best, date=date, privacy=privacy)


def board_row(car_id, session_id, time):
    return {"carId": car_id, "sessionId": session_id, "car": "Car " + car_id, "model": "Model 3", "owner": "X", "time": time, "date": "2026-04-01", "conditions": "Dry", "mods": []}


def test_sessions_can_be_filtered_by_track_name(page):
    fake = FakeWorker(earlier=False)
    fake.index = [shared_session("a1", "thruxton", "Thruxton", "main", 100, "2026-04-03"),
                  shared_session("a2", "thruxton", "Thruxton", "main", 101, "2026-04-02"),
                  shared_session("b1", "brands", "Brands Hatch", "indy", 60, "2026-04-01", privacy="private")]
    open_page(page, fake)
    rows = page.locator("#tp-sess-list .tp-row")
    expect(rows).to_have_count(3)
    sel = page.locator("#tp-track-filter")
    expect(sel.locator("option")).to_have_text(["All tracks (3)", "Brands Hatch (1)", "Thruxton (2)"])
    sel.select_option("Brands Hatch")
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Brands Hatch")
    sel.select_option("Thruxton")
    expect(rows).to_have_count(2)
    sel.select_option("")
    expect(rows).to_have_count(3)


def test_no_filter_when_there_is_only_one_track(page):
    fake = FakeWorker(earlier=False)
    fake.index = [shared_session("a1", "thruxton", "Thruxton", "main", 100)]
    open_page(page, fake)
    expect(page.locator("#tp-sess-list .tp-row")).to_have_count(1)
    expect(page.locator("#tp-track-filter")).to_have_count(0)


def test_trophies_show_where_the_car_ranks_on_each_leaderboard(page):
    """1st Platinum, 2nd Gold, 3rd Silver, then 4th, 5th and so on, on the
    session that holds the car's place. A private session has none."""
    fake = FakeWorker(earlier=False)
    fake.index = [shared_session("a1", "thruxton", "Thruxton", "main", 100),
                  shared_session("a2", "thruxton", "Thruxton", "main", 105, "2026-03-01"),
                  shared_session("b1", "brands", "Brands Hatch", "indy", 60, privacy="private"),
                  shared_session("c1", "cadwell", "Cadwell Park", "full", 90),
                  shared_session("d1", "donington", "Donington Park", "gp", 95),
                  shared_session("e1", "oulton", "Oulton Park", "intl", 99)]
    fake.boards = {
        "/track/board:thruxton:main": [board_row("car1", "a1", 100), board_row("o1", "x", 101)],
        "/track/board:cadwell:full": [board_row("o1", "x", 80), board_row("car1", "c1", 90), board_row("o2", "y", 91)],
        "/track/board:donington:gp": [board_row("o1", "x", 80), board_row("o2", "y", 81), board_row("car1", "d1", 95)],
        "/track/board:oulton:intl": [board_row("o%d" % n, "x", 80 + n) for n in range(10)] + [board_row("car1", "e1", 99)],
    }
    open_page(page, fake)
    badge = lambda sid: page.locator('#tp-sess-list .tp-row[data-sid="%s"] .tp-rank' % sid)
    expect(badge("a1")).to_have_text("Platinum 1st")
    expect(badge("a1")).to_have_class(re.compile(r"tp-rank-1"))
    expect(badge("c1")).to_have_text("Gold 2nd")
    expect(badge("d1")).to_have_text("Silver 3rd")
    expect(badge("e1")).to_have_text("11th")
    expect(badge("e1")).to_have_class(re.compile(r"tp-rank-n"))
    expect(badge("e1")).to_have_attribute("title", "11th of 11 on the Oulton Park leaderboard")
    # Only the session holding the place; none on a private one.
    expect(badge("a2")).to_have_count(0)
    expect(badge("b1")).to_have_count(0)
    # Still there after filtering and clearing the filter.
    page.locator("#tp-track-filter").select_option("Cadwell Park")
    expect(badge("c1")).to_have_text("Gold 2nd")
    # And on the session page.
    fake.sessions["a1"] = dict(fake.index[0], laps=[], trace={"laps": {}}, mine=True)
    page.locator("#tp-track-filter").select_option("")
    page.locator('#tp-sess-list .tp-row[data-sid="a1"]').click()
    expect(page.locator("#tp-rank-slot .tp-rank")).to_have_text("Platinum 1st")


def test_a_car_not_on_the_board_gets_no_trophy(page):
    fake = FakeWorker(earlier=False)
    fake.index = [shared_session("a1", "thruxton", "Thruxton", "main", 100)]
    fake.boards = {"/track/board:thruxton:main": [board_row("o1", "x", 90)]}
    open_page(page, fake)
    expect(page.locator("#tp-sess-list .tp-row")).to_have_count(1)
    page.wait_for_timeout(500)
    expect(page.locator(".tp-rank")).to_have_count(0)


def test_compare_dots_show_each_lap_at_the_same_moment(page):
    """Hovering a compare chart puts each dot where its lap was at the same
    moment, so against a slower lap the slower dot trails. There is no longer a
    "same point" switch."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-cmp-b").select_option("x:m1")
    expect(page.locator("#tp-key")).to_contain_text("Ann, Blue Y, best lap, 28 May (B)")
    expect(page.locator("#tp-sync")).to_have_count(0)
    expect(page.locator(".tp-sync-note")).to_contain_text("slower one trails")
    page.locator("#tp-speed").scroll_into_view_if_needed()
    box = page.locator("#tp-speed").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.1, box["y"] + box["height"] * 0.5)
    page.mouse.move(box["x"] + box["width"] * 0.9, box["y"] + box["height"] * 0.5)
    sep = page.evaluate("""() => {
      const g = [...document.querySelectorAll('#tp-map2 g[visibility="visible"]')].filter(x => x.querySelector('circle[r="7"]'));
      const xy = g.map(x => (x.getAttribute('transform').match(/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/) || []).slice(1).map(Number));
      return xy.length === 2 ? Math.hypot(xy[0][0] - xy[1][0], xy[0][1] - xy[1][1]) : -1;
    }""")
    assert sep > 20, sep


def test_play_and_rewind_the_compare_laps_at_different_speeds(page):
    """Play moves both laps along the track in real time (x1), Rewind goes back
    the same way, and x0.5, x2 and x5 change the pace. The slider moves the
    laps by hand, and hovering a chart takes over."""
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-speed path")).to_have_count(2)
    toggle, back, clock = page.locator("#tp-play-toggle"), page.locator("#tp-play-back"), page.locator("#tp-clock")
    expect(toggle).to_have_text("Play")
    expect(back).to_have_text("Rewind")
    expect(page.locator("#tp-speeds .chip.is-on")).to_have_text("x1")
    expect(page.locator("#tp-speeds .chip")).to_have_text(["x0.5", "x1", "x2", "x5"])
    expect(clock).to_have_text(re.compile(r"^0:00\.0 / \d+:\d\d\.\d$"))

    def secs():
        txt = clock.inner_text().split(" / ")[0]
        m, s = txt.split(":")
        return int(m) * 60 + float(s)

    def dots():
        return page.locator('#tp-map2 g[visibility="visible"]').filter(has=page.locator('circle[r="7"]')).count()

    # Play: the clock runs, the dots appear, and Pause stops it.
    toggle.click()
    expect(toggle).to_have_text("Pause")
    page.wait_for_timeout(1200)
    t1 = secs()
    assert 0.5 < t1 < 3, t1
    assert dots() == 2
    toggle.click()
    expect(toggle).to_have_text("Play")
    held = secs()
    page.wait_for_timeout(400)
    assert secs() == held
    # Rewind goes back from there.
    back.click()
    expect(back).to_have_text("Pause")
    page.wait_for_timeout(500)
    assert secs() < held
    back.click()
    expect(back).to_have_text("Rewind")
    # A faster speed covers more of the lap in the same time.
    page.locator("#tp-scrub").evaluate("el => { el.value = 0; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    assert secs() == 0
    page.locator("#tp-speeds [data-speed='5']").click()
    expect(page.locator("#tp-speeds .chip.is-on")).to_have_text("x5")
    toggle.click()
    page.wait_for_timeout(1000)
    fast = secs()
    toggle.click()
    assert fast > 2.5, fast
    # The slider moves the laps by hand and stops playback.
    page.locator("#tp-scrub").evaluate("el => { el.value = 30; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    assert abs(secs() - 30) < 0.2
    expect(toggle).to_have_text("Play")
    # Hovering a chart takes over from playback.
    toggle.click()
    page.locator("#tp-speed").scroll_into_view_if_needed()
    box = page.locator("#tp-speed").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.5)
    expect(toggle).to_have_text("Play")


def test_playback_stops_at_the_end_and_starts_again_from_the_top(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-speed path")).to_have_count(2)
    toggle, clock = page.locator("#tp-play-toggle"), page.locator("#tp-clock")
    end = float(page.locator("#tp-scrub").get_attribute("max"))
    page.locator("#tp-speeds [data-speed='5']").click()
    page.locator("#tp-scrub").evaluate("(el, v) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); }", end - 2)
    toggle.click()
    expect(toggle).to_have_text("Play")
    expect(clock).to_have_text(re.compile(r"^%d:%04.1f / " % (int(end // 60), end % 60)))
    # Play again from the end starts at the beginning.
    toggle.click()
    page.wait_for_timeout(300)
    assert float(page.locator("#tp-scrub").input_value()) < 3
    toggle.click()
    # Rewind from the start jumps to the end and runs back.
    page.locator("#tp-scrub").evaluate("el => { el.value = 0; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.locator("#tp-play-back").click()
    page.wait_for_timeout(300)
    assert float(page.locator("#tp-scrub").input_value()) > end - 5
    page.locator("#tp-play-back").click()


def member_session(rec, slower=1.1):
    """Another member's shared session at the same track: the same laps, slower."""
    import copy
    m = copy.deepcopy(rec)
    m["id"] = "m1"
    m["bestTime"] = round(rec["bestTime"] * slower, 3)
    for lap in m["laps"]:
        lap["time"] = round(lap["time"] * slower, 3)
    for tr in m["trace"]["laps"].values():
        for p in tr:
            p[1] = p[1] * slower
    m["privacy"] = "board"
    return m


def save_thruxton_with_a_member_board(page, fake):
    fake.boards = {"/track/board:thruxton:main": [board_row("carM", "m1", 109.8)]}
    fake.boards["/track/board:thruxton:main"][0].update(owner="Ann", car="Blue Y")
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-speed path")).to_have_count(2)
    fake.sessions["m1"] = member_session(fake.sessions["new1"])


def test_other_members_laps_can_be_compared_and_put_on_the_map(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    group = page.locator("#tp-cmp-b optgroup[label=\"Other members' best laps\"]")
    expect(group.locator("option")).to_have_text(["Ann, Blue Y, 1:49.800"])
    page.locator("#tp-cmp-b").select_option("x:m1")
    expect(page.locator("#tp-key")).to_contain_text("Ann, Blue Y, best lap, 28 May (B)")
    expect(page.locator("#tp-gap-cap")).to_contain_text("A finishes")
    expect(page.locator("#tp-gap-cap")).to_contain_text("ahead")
    # Their lap is on the map as lap B.
    expect(page.locator("#tp-map2 polyline.tv-line[stroke-dasharray]")).to_have_count(1)


def test_no_member_laps_when_only_your_own_car_is_on_the_board(page):
    fake = FakeWorker()
    fake.boards = {"/track/board:thruxton:main": [board_row("car1", "new1", 99.8)]}
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-speed path")).to_have_count(2)
    expect(page.locator("#tp-cmp-b optgroup[label=\"Other members' best laps\"]")).to_have_count(0)


def test_zoomed_in_playback_follows_the_cars_until_you_turn_following_off(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-speeds [data-speed='5']").click()
    page.locator("#tp-map2").scroll_into_view_if_needed()
    zoom_in = page.locator("#tp-map2").locator("xpath=..").locator(".tv-zoom-in")
    for _ in range(4):
        zoom_in.click()
    expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "true")

    def in_view():
        return page.evaluate("""() => {
          const svg = document.getElementById('tp-map2'), vb = svg.viewBox.baseVal;
          const xy = [...svg.querySelectorAll('g[visibility="visible"]')].filter(g => g.querySelector('circle[r="7"]'))
            .map(g => (g.getAttribute('transform').match(/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/) || []).slice(1).map(Number));
          return xy.length === 2 && xy.every(p => p[0] > vb.x && p[0] < vb.x + vb.width && p[1] > vb.y && p[1] < vb.y + vb.height);
        }""")

    page.locator("#tp-play-toggle").click()
    for _ in range(4):
        page.wait_for_timeout(400)
        assert in_view()
    page.locator("#tp-play-toggle").click()
    # Same moment with a gap: the leader stays in view even if the other dot
    # is off screen.
    page.locator("#tp-scrub").evaluate("el => { el.value = 40; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.locator("#tp-play-toggle").click()
    page.wait_for_timeout(500)
    page.locator("#tp-play-toggle").click()
    assert page.evaluate("""() => {
      const svg = document.getElementById('tp-map2'), vb = svg.viewBox.baseVal;
      return [...svg.querySelectorAll('g[visibility="visible"]')].filter(g => g.querySelector('circle[r="7"]'))
        .map(g => (g.getAttribute('transform').match(/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/) || []).slice(1).map(Number))
        .some(p => p[0] > vb.x && p[0] < vb.x + vb.width && p[1] > vb.y && p[1] < vb.y + vb.height);
    }""")
    # Dragging the map by hand turns following off, so it can be explored.
    box = page.locator("#tp-map2").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.7, box["y"] + box["height"] * 0.6, steps=6)
    page.mouse.up()
    expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "false")
    vb = lambda: page.evaluate("(() => { const b = document.getElementById('tp-map2').viewBox.baseVal; return [b.x, b.y]; })()")
    # Pressing Play follows the cars again; the chip can switch it off mid-play.
    page.locator("#tp-play-toggle").click()
    expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "true")
    page.locator("#tp-follow").click()
    expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "false")
    before = vb()
    page.wait_for_timeout(500)
    assert vb() == before
    page.locator("#tp-play-toggle").click()
    page.locator("#tp-follow").click()
    expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#tp-follow")).to_have_class(re.compile(r"is-on"))


def test_playback_follows_the_cars_after_pinch_zooming_and_after_a_drag(page):
    """Pinching to zoom is not a pan, so following stays on. After dragging the
    map by hand (following off), pressing Play follows the cars again."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-speeds [data-speed='5']").click()
    page.locator("#tp-map2").scroll_into_view_if_needed()
    box = page.locator("#tp-map2").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    # A two-finger pinch outwards, as touch pointer events.
    page.evaluate("""([cx, cy]) => {
      const svg = document.getElementById('tp-map2');
      const ev = (type, id, x, y) => svg.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch' }));
      ev('pointerdown', 1, cx - 20, cy); ev('pointerdown', 2, cx + 20, cy);
      for (let i = 1; i <= 8; i++) { ev('pointermove', 1, cx - 20 - i * 12, cy); ev('pointermove', 2, cx + 20 + i * 12, cy); }
      ev('pointerup', 1, cx - 116, cy); ev('pointerup', 2, cx + 116, cy);
    }""", [cx, cy])
    expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "true")
    # A drag turns it off; Play turns it back on and the view follows.
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx + 60, cy + 40, steps=6)
    page.mouse.up()
    expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "false")
    page.locator("#tp-play-toggle").click()
    expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "true")
    seen = set()
    for _ in range(4):
        page.wait_for_timeout(300)
        seen.add(tuple(round(v) for v in page.evaluate("(() => { const b = document.getElementById('tp-map2').viewBox.baseVal; return [b.x, b.y]; })()")))
    page.locator("#tp-play-toggle").click()
    assert len(seen) > 1, seen


def test_share_buttons_on_track_sessions_and_leaderboards(page):
    """The round share button by the page heading, as on the other pages."""
    open_page(page, FakeWorker())
    expect(page.locator(".page-hero h1 .mt3uk-share-dot")).to_be_visible()
    page.goto("/leaderboards.html")
    expect(page.locator(".page-hero h1 .mt3uk-share-dot")).to_be_visible()
    page.locator(".page-hero h1 .mt3uk-share-dot").click()
    expect(page.locator(".mt3uk-share-pop")).to_be_visible()
    expect(page.locator(".mt3uk-share-pop [data-channel='copy_link']")).to_be_visible()
    expect(page.locator(".mt3uk-share-pop [data-channel='whatsapp']")).to_have_attribute("href", re.compile(r"share%2Fsection%2Fleaderboards\.html"))


def test_a_shared_session_and_a_build_page_have_their_own_share_button(page):
    """Top right of a shared session, and of a build's shared sessions, a share
    button for that exact page. The page-wide one steps aside, and a private
    session has none."""
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    # Private by default: no share button.
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    expect(page.locator("[data-tp-share]")).to_have_count(0)
    expect(page.locator(".page-hero .mt3uk-share-dot")).to_be_hidden()
    # Shared: the button is there, top right, beside the units chip.
    page.locator("#settings [data-privacy] [data-v='board']").click()
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator(".tp-session-head [data-tp-share]")).to_be_visible()
    expect(page.locator(".page-hero .mt3uk-share-dot")).to_be_hidden()
    page.locator(".tp-session-head [data-tp-share]").click()
    pop = page.locator(".mt3uk-share-pop")
    expect(pop).to_be_visible()
    expect(pop.locator(".mt3uk-share-title")).to_have_text("Share this session")
    href = pop.locator("[data-channel='whatsapp']").get_attribute("href")
    assert "track.html%3Fs%3Dnew1" in href and "Thruxton" in href, href
    page.keyboard.press("Escape")
    # A build's shared sessions.
    page.goto("/track.html?car=car1")
    expect(page.locator(".tp-head [data-tp-share]")).to_be_visible()
    expect(page.locator(".page-hero .mt3uk-share-dot")).to_be_hidden()
    page.locator(".tp-head [data-tp-share]").click()
    expect(page.locator(".mt3uk-share-pop .mt3uk-share-title")).to_have_text("Share this build")
    assert "track.html%3Fcar%3Dcar1" in page.locator(".mt3uk-share-pop [data-channel='whatsapp']").get_attribute("href")


@all_devices
def test_share_buttons_fit_on_a_phone(device_page):
    page = device_page
    fake = FakeWorker()
    open_page(page, fake, path="/leaderboards.html")
    btn = page.locator(".page-hero h1 .mt3uk-share-dot")
    expect(btn).to_be_visible()
    box, h1 = btn.bounding_box(), page.locator(".page-hero h1").bounding_box()
    assert box["x"] + box["width"] <= page.viewport_size["width"], box
    assert overflow_width(page) <= 0


LOOP_FINISH = [[51.207161766976405, -1.6006471781562528], [51.20741738988989, -1.6007916855992967]]
HILL_FINISH = [[51.21336186446567, -1.5952994261752478], [51.21310801069265, -1.5951472854432356]]


def _course(finish, length):
    def handler(route):
        d = json.loads((ROOT / "data" / "tracks.json").read_text(encoding="utf-8"))
        d["venues"].append({
            "id": "test-sprint", "name": "Test Sprint", "type": "sprint", "lat": 51.2085, "lng": -1.6055, "radius": 2500,
            "layouts": [{"id": "short", "name": "Short course", "length": length,
                         "startLine": [[51.2077017, -1.6088667], [51.2076237, -1.6091363]], "finishLine": finish}],
        })
        route.fulfill(status=200, content_type="application/json", body=json.dumps(d))
    return handler


def test_sprints_can_ignore_the_first_finish_line_crossing(page):
    """On a sprint that loops back past the finish, the first finish crossing in
    a file is ignored by default, with a switch to turn that off. Circuits don't
    get the switch."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _course(LOOP_FINISH, 3000))
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    expect(page.locator("#tp-ignore-finish")).to_have_count(0)
    page.locator("[data-type] button[data-v='sprint']").click()
    result = page.locator("#tp-result .tp-notice.is-ok")
    expect(result).to_contain_text("Test Sprint")
    switch = page.locator("#tp-ignore-finish")
    expect(switch).to_have_attribute("aria-checked", "true")
    expect(switch).to_contain_text("Only a run that crosses the finish line more than once")
    expect(result).to_contain_text("2 timed runs")
    switch.click()
    expect(page.locator("#tp-ignore-finish")).to_have_attribute("aria-checked", "false")
    expect(result).to_contain_text("2 timed runs")
    # A circuit has no such switch.
    page.locator("[data-type] button[data-v='track']").click()
    expect(page.locator("#tp-ignore-finish")).to_have_count(0)


def test_hill_climbs_keep_both_runs_with_the_ignore_switch_on(page):
    """A hill climb crosses the finish once per run, so there is nothing to
    skip: both runs are timed, and the switch is there if it is needed."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _course(HILL_FINISH, 1500))
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.locator("[data-type] button[data-v='sprint']").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Test Sprint")
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("2 timed runs")
    expect(page.locator("#tp-ignore-finish")).to_be_visible()


def test_go_back_to_the_start_during_playback(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-speed path")).to_have_count(2)
    start, toggle, clock = page.locator("#tp-play-start"), page.locator("#tp-play-toggle"), page.locator("#tp-clock")
    expect(start).to_have_text("Start")
    expect(start).to_have_attribute("aria-label", "Go back to the start")
    page.locator("#tp-speeds [data-speed='5']").click()
    toggle.click()
    page.wait_for_timeout(1000)
    assert float(page.locator("#tp-scrub").input_value()) > 2
    # While playing: stops and goes to 0:00.0, with both cars on the line.
    start.click()
    expect(toggle).to_have_text("Play")
    expect(clock).to_have_text(re.compile(r"^0:00\.0 / "))
    assert float(page.locator("#tp-scrub").input_value()) == 0
    assert page.locator('#tp-map2 g[visibility="visible"]').filter(has=page.locator('circle[r="7"]')).count() == 2
    # Play then goes from the beginning; after pausing mid-lap, Start goes back too.
    toggle.click()
    page.wait_for_timeout(600)
    toggle.click()
    assert float(page.locator("#tp-scrub").input_value()) > 0
    start.click()
    assert float(page.locator("#tp-scrub").input_value()) == 0


def test_satellite_tiles_keep_up_while_playing_zoomed_in(page):
    """The picture under the map used to wait for the view to stop moving, so
    during playback it never drew. Now tiles load as the view follows the cars,
    and a tile covers the middle of the view the whole time."""
    requests = []

    def tile(route):
        requests.append(route.request.url)
        sat_reply(route)
    page.route("**/World_Imagery/**", tile)
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-map2").scroll_into_view_if_needed()
    zoom_in = page.locator("#tp-map2").locator("xpath=..").locator(".tv-zoom-in")
    for _ in range(5):
        zoom_in.click()
    page.locator("#tp-speeds [data-speed='5']").click()
    page.locator("#tp-play-toggle").click()
    covered = []
    for _ in range(6):
        page.wait_for_timeout(450)
        covered.append(page.evaluate("""() => {
          const svg = document.getElementById('tp-map2'), vb = svg.viewBox.baseVal;
          const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
          return [...svg.querySelectorAll('.tv-sat image')].some(im => {
            const x = +im.getAttribute('x'), y = +im.getAttribute('y'), w = +im.getAttribute('width'), h = +im.getAttribute('height');
            return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
          });
        }"""))
    page.locator("#tp-play-toggle").click()
    assert all(covered), covered
    # It looked ahead along the lap, not just at the first view.
    assert len(set(requests)) > 8, len(set(requests))


def test_g_force_lines_can_be_switched_on_and_off(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    toggles = page.locator("#tp-gtoggles .chip")
    expect(toggles).to_have_text(["Acceleration G", "Cornering G", "Speed"])
    expect(page.locator("#tp-gtoggles .chip.is-on")).to_have_count(3)
    lines = page.locator("#tp-gforce > path[stroke-width]")
    # Three lines (acceleration, cornering, speed), each for lap A (solid) and lap B (dashed).
    expect(lines).to_have_count(6)
    expect(page.locator("#tp-gforce > path[stroke-dasharray='5 4']")).to_have_count(3)
    expect(page.locator("#tp-gnote")).to_contain_text("Solid line")
    # Speed has its own scale on the right.
    expect(page.locator("#tp-gforce text[text-anchor='start']")).to_have_count(4)
    toggles.nth(0).click()
    expect(toggles.nth(0)).to_have_attribute("aria-pressed", "false")
    expect(lines).to_have_count(4)
    toggles.nth(2).click()
    expect(lines).to_have_count(2)
    expect(page.locator("#tp-gforce text[text-anchor='start']")).to_have_count(0)
    toggles.nth(1).click()
    expect(page.locator("#tp-gnote")).to_have_text("Turn a line on to see it.")
    expect(lines).to_have_count(0)
    toggles.nth(1).click()
    expect(lines).to_have_count(2)
    # Hovering shows both laps' values.
    page.locator("#tp-gforce").scroll_into_view_if_needed()
    box = page.locator("#tp-gforce").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.5)
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    expect(page.locator(".tv-tip")).to_contain_text("Corner, A")
    expect(page.locator(".tv-tip")).not_to_contain_text("Accel, A")


def test_numbers_under_the_map_follow_the_dots(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    expect(page.locator("#tp-metrics .tp-mrow")).to_have_count(2)
    expect(page.locator('#tp-metrics [data-m="a-v"]')).to_have_text("-")
    page.locator("#tp-scrub").evaluate("el => { el.value = 30; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    expect(page.locator('#tp-metrics [data-m="a-v"]')).to_have_text(re.compile(r"^\d+ mph$|^\d+\.\d mph$"))
    expect(page.locator('#tp-metrics [data-m="a-acc"]')).to_have_text(re.compile(r"^[+-]\d\.\d\d g$"))
    expect(page.locator('#tp-metrics [data-m="a-cor"]')).to_have_text(re.compile(r"^\d\.\d\d g$"))
    expect(page.locator('#tp-metrics [data-m="gap"]')).to_have_text(re.compile(r"^A is \d+\.\d\d s (ahead|behind)$"))
    first = page.locator('#tp-metrics [data-m="a-v"]').inner_text()
    page.locator("#tp-scrub").evaluate("el => { el.value = 60; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    assert page.locator('#tp-metrics [data-m="a-v"]').inner_text() != first


def test_the_map_can_go_full_screen_with_the_numbers_along_the_bottom(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-scrub").evaluate("el => { el.value = 30; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    full = page.locator("#tp-full")
    expect(full).to_have_text("Full screen")
    full.click()
    card = page.locator("#tp-mapcard")
    expect(card).to_have_class(re.compile(r"is-full"))
    expect(full).to_have_text("Exit full screen")
    vp = page.viewport_size
    cb = card.bounding_box()
    assert cb["width"] >= vp["width"] - 1 and cb["height"] >= vp["height"] - 1, (cb, vp)
    # The map fills the middle and the controls, numbers and lines sit under it.
    mb, tb, mt, gb = (page.locator(s).bounding_box() for s in ("#tp-map2", "#tp-play-toggle", "#tp-metrics", "#tp-gforce"))
    assert mb["height"] > vp["height"] * 0.3, mb
    assert tb["y"] > mb["y"] + mb["height"] - 2 and mt["y"] > tb["y"] and gb["y"] > mt["y"], (mb, tb, mt, gb)
    assert gb["y"] + gb["height"] <= vp["height"] + 1
    # Same place in the lap, dots and numbers still showing.
    assert abs(float(page.locator("#tp-scrub").input_value()) - 30) < 0.2
    assert page.evaluate("document.body.classList.contains('tp-noscroll')")
    expect(page.locator('#tp-metrics [data-m="a-v"]')).not_to_have_text("-")
    # Playback works in full screen, and Escape comes back.
    page.locator("#tp-play-toggle").click()
    page.wait_for_timeout(500)
    assert float(page.locator("#tp-scrub").input_value()) > 30.2
    page.locator("#tp-play-toggle").click()
    page.keyboard.press("Escape")
    expect(card).not_to_have_class(re.compile(r"is-full"))
    expect(full).to_have_text("Full screen")
    assert not page.evaluate("document.body.classList.contains('tp-noscroll')")
    assert float(page.locator("#tp-scrub").input_value()) > 30


def test_full_screen_map_on_a_phone(page):
    page.set_viewport_size({"width": 390, "height": 844})
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    assert overflow_width(page) <= 0
    mb = page.locator("#tp-map2").bounding_box()
    assert mb["height"] > 200 and mb["width"] <= 390, mb
    for sel in ("#tp-play-toggle", "#tp-metrics", "#tp-gforce"):
        box = page.locator(sel).bounding_box()
        assert box and box["y"] + box["height"] <= 845, (sel, box)
    # A phone on its side: the map keeps most of the screen, nothing spills.
    page.set_viewport_size({"width": 844, "height": 390})
    page.wait_for_timeout(300)
    page.locator("#tp-full").click()
    page.locator("#tp-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    assert overflow_width(page) <= 0
    mb = page.locator("#tp-map2").bounding_box()
    assert mb["height"] > 120, mb
    expect(page.locator("#tp-play-toggle")).to_be_visible()
    page.locator("#tp-full").click()
    expect(page.locator("#tp-mapcard")).not_to_have_class(re.compile(r"is-full"))


def _unknown_track(route):
    """The track list without Thruxton, so the file's track isn't known."""
    d = json.loads((ROOT / "data" / "tracks.json").read_text(encoding="utf-8"))
    d["venues"] = [v for v in d["venues"] if v["id"] != "thruxton"]
    route.fulfill(status=200, content_type="application/json", body=json.dumps(d))


def _overpass(page, elements):
    """Stand-in for the Overpass lookup; returns the requests it was sent."""
    seen = []

    def reply(route):
        seen.append(route.request.url)
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"elements": elements}), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/overpass-api.de/**", reply)
    page.overpass_set = True
    return seen


def test_an_unknown_track_is_named_from_its_position(page):
    """A track we don't have: its name is looked up from the coordinates and
    filled in for the member to check. A kart track nearby isn't picked over
    the circuit, and only rounded coordinates are sent."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _unknown_track)
    seen = _overpass(page, [
        {"type": "way", "tags": {"name": "Thruxton Kart Track", "sport": "karting"}, "center": {"lat": 51.2090, "lon": -1.6060}},
        {"type": "way", "tags": {"name": "Thruxton Circuit", "highway": "raceway"}, "center": {"lat": 51.2100, "lon": -1.6050}},
    ])
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    name = page.locator("#tp-venue-name")
    expect(name).to_have_value("Thruxton Circuit")
    expect(page.locator("#tp-name-src")).to_contain_text("found from the map")
    # The track name and the date come first, above the file's contents and the map.
    name_y = name.bounding_box()["y"]
    assert name_y < page.locator("#tp-date").bounding_box()["y"] < page.locator("#tp-chans").bounding_box()["y"]
    assert len(seen) == 1
    q = parse_qs(urlparse(seen[0]).query)["data"][0]
    coords = re.search(r"around:900,(-?[\d.]+),(-?[\d.]+)", q)
    assert coords and all(len(c.split(".")[1]) <= 3 for c in coords.groups()), q
    # Saved with the looked-up name.
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert fake.saved[0]["venueName"] == "Thruxton Circuit"


def test_a_name_the_member_types_is_what_is_saved(page):
    page.route(re.compile(r".*/data/tracks\.json.*"), _unknown_track)
    _overpass(page, [{"type": "way", "tags": {"name": "Thruxton Circuit"}, "center": {"lat": 51.2100, "lon": -1.6050}}])
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-venue-name")).to_have_value("Thruxton Circuit")
    page.fill("#tp-venue-name", "My own name")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert fake.saved[0]["venueName"] == "My own name"


def test_no_lookup_for_a_known_track(page):
    seen = _overpass(page, [{"type": "way", "tags": {"name": "Somewhere Else"}, "center": {"lat": 51.2, "lon": -1.6}}])
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Thruxton")
    page.wait_for_timeout(600)
    assert seen == []
    expect(page.locator("#tp-venue-name")).to_have_count(0)


def test_nothing_is_filled_in_when_the_lookup_finds_nothing(page):
    page.route(re.compile(r".*/data/tracks\.json.*"), _unknown_track)
    seen = _overpass(page, [])
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-venue-name")).to_have_value("")
    page.wait_for_timeout(600)
    assert len(seen) == 1
    expect(page.locator("#tp-name-src")).to_have_count(0)
    expect(page.locator("#tp-venue-name")).to_have_value("")


def open_saved_session(page, fake):
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.get_by_role("heading", name="Session settings")).to_be_visible()


def test_tyres_make_model_and_size_in_session_settings(page):
    """Make from the known makes, the model suggested from that make, and the
    size as separate width, profile and diameter drop-downs."""
    fake = FakeWorker()
    open_saved_session(page, fake)
    makes = page.locator("#tp-e-tyre-make option").all_inner_texts()
    assert makes[0] == "Not set" and makes[-1] == "Other make"
    assert len(makes) > 30 and {"Michelin", "Pirelli", "Continental", "Goodyear", "Bridgestone", "Yokohama", "Hankook", "Toyo", "Nitto"} <= set(makes)
    assert page.locator("#tp-e-tyre-w option").all_inner_texts()[:3] == ["Width", "175", "185"]
    assert "245" in page.locator("#tp-e-tyre-w option").all_inner_texts()
    assert "35" in page.locator("#tp-e-tyre-p option").all_inner_texts()
    assert page.locator("#tp-e-tyre-d option").all_inner_texts()[0] == "Diameter" and "19" in page.locator("#tp-e-tyre-d option").all_inner_texts()
    # The model suggestions follow the make.
    page.select_option("#tp-e-tyre-make", "Michelin")
    models = page.locator("#tp-e-tyre-models option").evaluate_all("els => els.map(e => e.value)")
    assert "Pilot Sport 4S" in models and "P Zero" not in models
    page.select_option("#tp-e-tyre-make", "Pirelli")
    assert "P Zero Trofeo R" in page.locator("#tp-e-tyre-models option").evaluate_all("els => els.map(e => e.value)")
    # Any make or model can still be typed.
    page.select_option("#tp-e-tyre-make", "__other")
    expect(page.locator("#tp-e-tyre-other-wrap")).to_be_visible()
    page.fill("#tp-e-tyre-make-other", "Hoosier")
    page.fill("#tp-e-tyre-model", "R7")
    expect(page.locator("#tp-e-tyre-preview")).to_have_text("Saved as: Hoosier R7")
    page.select_option("#tp-e-tyre-make", "Michelin")
    expect(page.locator("#tp-e-tyre-other-wrap")).to_be_hidden()
    page.fill("#tp-e-tyre-model", "Pilot Sport 4S")
    page.select_option("#tp-e-tyre-w", "245")
    expect(page.locator("#tp-e-tyre-preview")).to_contain_text("Pick the width, profile and diameter")
    page.select_option("#tp-e-tyre-p", "35")
    page.select_option("#tp-e-tyre-d", "19")
    expect(page.locator("#tp-e-tyre-preview")).to_have_text("Saved as: Michelin Pilot Sport 4S, 245/35 R19")
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator("#tp-status")).to_have_text("Saved.")
    rec = fake.sessions["new1"]
    assert (rec["tyres"], rec["tyreMake"], rec["tyreModel"], rec["tyreWidth"], rec["tyreProfile"], rec["tyreRim"]) == ("Michelin Pilot Sport 4S, 245/35 R19", "Michelin", "Pilot Sport 4S", 245, 35, 19)
    expect(page.locator(".tp-session-head .tp-sub")).to_contain_text("Michelin Pilot Sport 4S, 245/35 R19")
    # It comes back filled in.
    expect(page.locator("#tp-e-tyre-make")).to_have_value("Michelin")
    expect(page.locator("#tp-e-tyre-w")).to_have_value("245")
    expect(page.locator("#tp-e-tyre-p")).to_have_value("35")
    expect(page.locator("#tp-e-tyre-d")).to_have_value("19")


def test_older_free_text_tyres_fill_the_new_fields(page):
    fake = FakeWorker()
    open_saved_session(page, fake)
    fake.sessions["new1"]["tyres"] = "Pilot Sport 4S 245/35R19"
    for k in ("tyreMake", "tyreModel", "tyreWidth", "tyreProfile", "tyreRim"):
        fake.sessions["new1"].pop(k, None)
    page.reload()
    expect(page.locator("#tp-e-tyre-make")).to_have_value("Michelin")
    expect(page.locator("#tp-e-tyre-model")).to_have_value("Pilot Sport 4S")
    expect(page.locator("#tp-e-tyre-w")).to_have_value("245")
    expect(page.locator("#tp-e-tyre-p")).to_have_value("35")
    expect(page.locator("#tp-e-tyre-d")).to_have_value("19")
    # A make we don't list stays as typed.
    fake.sessions["new1"]["tyres"] = "Hoosier R7, 255/40 ZR18"
    page.reload()
    expect(page.locator("#tp-e-tyre-model")).to_have_value("Hoosier R7")
    expect(page.locator("#tp-e-tyre-w")).to_have_value("255")
    expect(page.locator("#tp-e-tyre-d")).to_have_value("18")


def test_tyres_when_adding_a_session(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.select_option("#tp-tyre-make", "Yokohama")
    page.fill("#tp-tyre-model", "Advan Neova AD09")
    page.select_option("#tp-tyre-w", "265")
    page.select_option("#tp-tyre-p", "35")
    page.select_option("#tp-tyre-d", "19")
    # Switching units redraws the form without losing the tyres.
    page.locator(".tp-head [data-units]").click()
    expect(page.locator("#tp-tyre-make")).to_have_value("Yokohama")
    expect(page.locator("#tp-tyre-d")).to_have_value("19")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    saved = fake.saved[0]
    assert (saved["tyres"], saved["tyreMake"], saved["tyreWidth"], saved["tyreProfile"], saved["tyreRim"]) == ("Yokohama Advan Neova AD09, 265/35 R19", "Yokohama", 265, 35, 19)


def test_tyre_choices_come_from_the_manifest_with_the_admin_changes_on_top(page):
    """data/tyres.json is the starting list; the worker's changes replace or
    take off makes and replace the size lists."""
    manifest = {"makes": [{"name": "Acme", "models": ["Rocket"]}, {"name": "Zed", "models": ["Z1"]}, {"name": "Mid", "models": []}],
                "widths": [205, 215], "profiles": [40, 45], "rims": [18, 19]}
    page.route(re.compile(r".*/data/tyres\.json.*"), lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(manifest)))
    fake = FakeWorker()
    fake.tyre_extra = {"makes": [{"name": "Zed", "removed": True}, {"name": "Bolt", "models": ["B1", "B2"]}, {"name": "Acme", "models": ["Rocket 2"]}], "rims": [17]}
    open_saved_session(page, fake)
    assert page.locator("#tp-e-tyre-make option").all_inner_texts() == ["Not set", "Acme", "Bolt", "Mid", "Other make"]
    assert page.locator("#tp-e-tyre-w option").all_inner_texts() == ["Width", "205", "215"]
    assert page.locator("#tp-e-tyre-p option").all_inner_texts() == ["Profile", "40", "45"]
    assert page.locator("#tp-e-tyre-d option").all_inner_texts() == ["Diameter", "17"]
    page.select_option("#tp-e-tyre-make", "Acme")
    assert page.locator("#tp-e-tyre-models option").evaluate_all("els => els.map(e => e.value)") == ["Rocket 2"]
    page.select_option("#tp-e-tyre-make", "Bolt")
    assert page.locator("#tp-e-tyre-models option").evaluate_all("els => els.map(e => e.value)") == ["B1", "B2"]


def test_the_shipped_manifest_lists_the_makes(page):
    """The real data/tyres.json: makes, models and sizes, including Kumho."""
    d = json.loads((ROOT / "data" / "tyres.json").read_text(encoding="utf-8"))
    names = [m["name"] for m in d["makes"]]
    assert names == sorted(names, key=str.lower) and len(names) == len(set(names)) and len(names) > 30
    kumho = next(m for m in d["makes"] if m["name"] == "Kumho")["models"]
    assert "Ecsta Sport S PS72" in kumho and "Ecsta PS71" in kumho and len(kumho) > 20
    assert 245 in d["widths"] and 35 in d["profiles"] and 19 in d["rims"]
    assert all(len(set(m["models"])) == len(m["models"]) for m in d["makes"])


def test_admin_tyres_panel_edits_makes_models_and_sizes(page):
    store = {"extra": {}}
    puts = []

    def api(route):
        req = route.request
        path = urlparse(req.url).path
        if path == "/tyres/admin" and req.method == "GET":
            body = {"success": True, "extra": store["extra"]}
        elif path == "/tyres/admin" and req.method == "PUT":
            lib = json.loads(req.post_data)["library"]
            puts.append(lib)
            store["extra"] = lib
            body = {"success": True, "extra": lib}
        else:
            body = {"success": True}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/%s/**" % API_HOST, api)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#tyres-wrap > summary").click()
    expect(page.locator("#ty-list")).to_contain_text("Michelin")
    expect(page.locator("#tyres-count")).to_have_text(re.compile(r"^\(\d+ makes\)$"))
    rows = page.locator("#ty-list tbody tr")
    start = rows.count()
    assert start > 30
    # Add a make with models.
    page.get_by_role("button", name="Add a make").click()
    page.fill("#ty-name", "Acme Tyres")
    page.fill("#ty-models", "Rocket\nBolt\n\nRocket 2")
    page.get_by_role("button", name="Save make").click()
    expect(page.locator("#ty-note")).to_have_text("Saved. Track sessions use it straight away.")
    assert puts[-1]["makes"] == [{"name": "Acme Tyres", "models": ["Rocket", "Bolt", "Rocket 2"]}]
    expect(rows).to_have_count(start + 1)
    expect(page.locator("#ty-list tr", has_text="Acme Tyres")).to_contain_text("changed here")
    # Edit a make from the file: its models are replaced, the name is fixed.
    page.locator('[data-edit="Kumho"]').click()
    assert page.locator("#ty-name").get_attribute("readonly") is not None
    models = page.locator("#ty-models").input_value().split("\n")
    assert "Ecsta Sport S PS72" in models and len(models) > 20
    page.fill("#ty-models", "Ecsta PS71\nEcsta PS91")
    page.get_by_role("button", name="Save make").click()
    expect(page.locator("#ty-note")).to_have_text("Saved. Track sessions use it straight away.")
    assert {"name": "Kumho", "models": ["Ecsta PS71", "Ecsta PS91"]} in puts[-1]["makes"]
    # Taking a make off the list keeps a note of it; taking off one added here just drops it.
    page.once("dialog", lambda d: d.accept())
    page.locator('[data-remove="Toyo"]').click()
    expect(page.locator("#ty-list")).not_to_contain_text("Toyo")
    assert {"name": "Toyo", "removed": True} in puts[-1]["makes"]
    page.once("dialog", lambda d: d.accept())
    page.locator('[data-remove="Acme Tyres"]').click()
    expect(page.locator("#ty-list")).not_to_contain_text("Acme Tyres")
    assert all(m["name"] != "Acme Tyres" for m in puts[-1]["makes"])
    # A make that is already there can't be added twice.
    page.get_by_role("button", name="Add a make").click()
    page.fill("#ty-name", "Michelin")
    page.get_by_role("button", name="Save make").click()
    expect(page.locator("#ty-note")).to_contain_text("already on the list")
    page.get_by_role("button", name="Cancel").click()
    # Sizes.
    expect(page.locator("#ty-widths")).to_have_value(re.compile(r"175, 185, .*355"))
    page.fill("#ty-widths", "205, 215, 225")
    page.fill("#ty-rims", "17 18 19")
    page.get_by_role("button", name="Save sizes").click()
    expect(page.locator("#ty-note")).to_have_text("Saved. Track sessions use it straight away.")
    assert puts[-1]["widths"] == [205, 215, 225] and puts[-1]["rims"] == [17, 18, 19] and "profiles" not in puts[-1]
    page.get_by_role("button", name="Use the file's sizes").click()
    expect(page.locator("#ty-widths")).to_have_value(re.compile(r"175, 185"))
    assert "widths" not in puts[-1] and "rims" not in puts[-1]
    assert overflow_width(page) <= 0


def test_leaderboard_filters_rank_each_car_by_its_best_that_matches(page):
    fake = FakeWorker(earlier=False)

    def best(sid, t, cond, make, model):
        return {"sessionId": sid, "date": "2026-04-02", "conditions": cond, "tyres": make + " " + model + ", 245/35 R19", "tyreMake": make, "tyreModel": model, "time": t}
    a = board_row("a", "a-dry", 90.0)
    a.update(owner="Ann", car="Ann's 3", mods=["Coilovers: KW V3", "Wheels: 19in forged"], tyres="Michelin Pilot Sport 4S, 245/35 R19", tyreMake="Michelin", tyreModel="Pilot Sport 4S", sessions=3,
             bests=[best("a-dry", 90.0, "Dry", "Michelin", "Pilot Sport 4S"), best("a-wet", 99.0, "Wet", "Kumho", "Ecsta PS71")])
    b = board_row("b", "b-dry", 91.5)
    b.update(owner="Ben", car="Ben's Y", model="Model Y", mods=[], tyres="Kumho Ecsta PS71, 245/35 R19", tyreMake="Kumho", tyreModel="Ecsta PS71", sessions=1,
             bests=[best("b-dry", 91.5, "Dry", "Kumho", "Ecsta PS71")])
    # An older entry: only its fastest, with the tyres as free text.
    c = board_row("c", "c-old", 95.0)
    c.update(owner="Cat", car="Cat's S", model="Model S", tyres="Michelin Pilot Sport 4S 245/35R19", sessions=2)
    fake.boards = {"/track/board:thruxton:main": [a, b, c]}
    open_page(page, fake, "/leaderboards.html?board=thruxton:main", signed_in=False)
    rows = page.locator(".lb-row")
    expect(rows).to_have_count(3)
    expect(rows.first).to_contain_text("Ann's 3")
    expect(rows.first).to_contain_text("Fastest")
    expect(rows.nth(1)).to_contain_text("+1.500 s")
    # Tyres and the track parts are on the row, without opening anything.
    expect(rows.first).to_contain_text("Michelin Pilot Sport 4S, 245/35 R19")
    expect(rows.first.locator(".tp-modchip").first).to_have_text("Coilovers: KW V3")
    expect(rows.nth(1)).to_contain_text("Kumho Ecsta PS71")
    # The whole row opens the session through its name.
    expect(rows.first.locator("a.lb-name")).to_have_attribute("href", "track.html?s=a-dry")
    # Conditions: Ann's best wet is her Kumho run; the others have no wet result.
    page.locator("#lb-cond").select_option("Wet")
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Ann's 3")
    expect(rows.first).to_contain_text("1:39.000")
    expect(page.locator("#lb-cond")).to_be_focused()
    page.locator("#lb-cond").select_option("All")
    # Tyre make: each car's best on that make (Ann's only Kumho run was wet).
    page.locator("#lb-make").select_option("Kumho")
    expect(rows).to_have_count(2)
    expect(rows.first).to_contain_text("Ben's Y")
    expect(rows.nth(1)).to_contain_text("Ann's 3")
    expect(rows.nth(1)).to_contain_text("1:39.000")
    # Older entries are matched from their tyre text.
    page.locator("#lb-make").select_option("Michelin")
    expect(rows).to_have_count(2)
    expect(rows.first).to_contain_text("Ann's 3")
    expect(rows.nth(1)).to_contain_text("Cat's S")
    page.locator("#lb-tyre").select_option("Pilot Sport 4S")
    expect(rows).to_have_count(2)
    # Together with the model chips, and Clear puts everything back.
    page.locator("#lb-models [data-m='Model Y']").click()
    expect(page.locator(".tp-empty")).to_contain_text("Nobody matches these filters")
    page.get_by_role("button", name="Clear filters").click()
    page.locator("#lb-models [data-m='All']").click()
    expect(rows).to_have_count(3)
    assert overflow_width(page) <= 0


@all_devices
def test_leaderboard_fits_a_phone(device_page):
    page = device_page
    row = board_row("a", "a1", 90.0)
    row.update(owner="Ann", car="A very long car name for a phone screen", mods=["Coilovers: KW V3 with a long description", "Wheels: 19in forged", "Brakes: Brembo GT", "Tyres: Michelin PS4S", "Front splitter"],
               tyres="Michelin Pilot Sport 4S, 245/35 R19", sessions=4)

    # Device pages send worker calls to /__mock-api, so answer the board here.
    def reply(route):
        data = {"success": True, "entries": [row]} if "/track/board" in route.request.url else {"success": True}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/__mock-api/**", reply)
    page.goto("/leaderboards.html?board=thruxton:main")
    expect(page.locator(".lb-row")).to_have_count(1)
    assert overflow_width(page) <= 0
    box = page.locator(".lb-time").bounding_box()
    assert box["x"] + box["width"] <= page.viewport_size["width"], box
    # The filters and the model chips stay inside the screen too.
    for sel in ("#lb-models", ".lb-filters"):
        b = page.locator(sel).bounding_box()
        assert b["x"] + b["width"] <= page.viewport_size["width"] + 1, (sel, b)


def test_follow_still_works_after_the_map_is_dragged_and_let_go_off_the_map(page):
    """Letting go of the mouse outside the map used to leave it 'held down', so
    the zoomed map stopped following the cars and the Follow chip seemed dead."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-map2").scroll_into_view_if_needed()
    zoom_in = page.locator("#tp-map2").locator("xpath=..").locator(".tv-zoom-in")
    for _ in range(4):
        zoom_in.click()
    vb = lambda: page.evaluate("(() => { const b = document.getElementById('tp-map2').viewBox.baseVal; return [b.x, b.y]; })()")
    scrub = lambda v: page.locator("#tp-scrub").evaluate("(el, v) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); }", v)
    box = page.locator("#tp-map2").bounding_box()
    for lap in range(3):
        # Drag the map by hand and let go well outside it.
        page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.7, box["y"] + box["height"] * 0.6, steps=4)
        page.mouse.move(box["x"] + box["width"] + 80, box["y"] - 40, steps=4)
        page.mouse.up()
        expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "false")
        # Without a button down, moving over the map must not drag it.
        before = vb()
        page.mouse.move(box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.3, steps=4)
        page.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.5, steps=4)
        assert vb() == before, "the map moved with no button held"
        # Turn Follow on and scrub: the view goes to the cars.
        page.locator("#tp-follow").click()
        expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "true")
        scrub(30 + lap * 25)
        page.wait_for_timeout(150)
        moved = vb()
        scrub(80 - lap * 20)
        page.wait_for_timeout(150)
        assert vb() != moved, "round %d: the zoomed map did not follow the cars" % lap
        page.locator("#tp-follow").click()
        expect(page.locator("#tp-follow")).to_have_attribute("aria-pressed", "false")


def tesla_full_csv(hot=False):
    """The Thruxton fixture with some of the extra columns a full Tesla Track Mode export has.
    hot: the battery and brakes run up into the orange and yellow zones, and power drops late on."""
    lines = (ROOT / "tests" / "fixtures" / "tesla-track-mode-thruxton.csv").read_text(encoding="utf-8").strip().split("\n")
    out = [lines[0] + ",Throttle Position (%),Brake Pressure (bar),Power Level (KW),State of Charge (%),Tire Pressure Front Left (bar),Battery Temp (%),Brake Temperature Front Left (% est.)"]
    n = len(lines) - 1
    for i, line in enumerate(lines[1:]):
        f, accel = i / n, i % 40 < 20
        power = (190 if hot and f > 0.6 else 250) if accel else -120
        bat, brk = (0.6 + 0.29 * f, 0.3 + 0.48 * f) if hot else (0.5 + 0.12 * f, 0.02 + 0.3 * f)
        out.append(line + ",%d,%s,%d,%.2f,0,%.3f,%.3f" % (100 if accel else 0, 0 if accel else 35.5, power, 80 - 5 * f, bat, brk))
    return "\n".join(out)


def test_where_do_i_get_my_file_has_a_source_picker(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    expect(page.locator(".tp-help")).to_have_attribute("open", "")
    steps = page.locator("#tp-src-steps")
    expect(page.locator("#tp-src-chips .is-on")).to_have_text("Tesla Track Mode")
    expect(steps).to_contain_text("telemetry-v1")
    page.locator("#tp-src-chips [data-src]", has_text="VBOX").click()
    expect(steps).to_contain_text("SD card")
    expect(page.locator("#tp-src-chips .is-on")).to_have_text("VBOX")
    page.locator("#tp-src-chips [data-src]", has_text="Something else").click()
    expect(steps).to_contain_text("CSV or GPX")


def test_the_cars_own_data_is_picked_up_and_shown_on_the_session(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[{"name": "telemetry-v1-2026-05-28-10_00_00.csv", "mimeType": "text/csv", "buffer": tesla_full_csv().encode()}])
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    # Says what was found, and what was in the file but empty.
    chans = page.locator("#tp-chans")
    expect(chans).to_contain_text("Speed")
    expect(chans).to_contain_text("Lap numbers")
    expect(chans).to_contain_text("Battery temperature")
    expect(chans).to_contain_text("Throttle")
    expect(chans).to_contain_text("In the file but empty: tyre pressure")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert fake.saved[0]["session"]["carData"]["power"] == {"max": 250, "regen": 120, "early": 250, "late": 250}
    card = page.locator("#car-data")
    expect(card.locator("h2")).to_have_text("Track Mode")
    expect(card).to_contain_text("250 kW")
    expect(card).to_contain_text("Regeneration up to 120 kW")
    expect(card).to_contain_text("35.5 bar")
    expect(card).to_contain_text("Battery temperature")
    expect(card).to_contain_text("not in degrees")
    expect(card).to_contain_text("In the file but empty: tyre pressure")
    # Charge used as a percentage of the battery.
    expect(card.locator(".tp-tile", has_text="Charge used")).to_contain_text("5%")
    # Pressures in bar or psi, remembered.
    card.locator("summary").click()
    card.locator("[data-press='psi']").click()
    expect(page.locator("#car-data")).to_contain_text("515 psi")
    expect(page.locator("#car-data [data-press='psi']")).to_have_class(re.compile("is-on"))
    # Still open after the redraw.
    expect(page.locator("#car-data")).to_have_attribute("open", "")
    page.reload()
    expect(page.locator("#car-data")).to_contain_text("515 psi")
    page.locator("#car-data summary").click()
    page.locator("#car-data [data-press='bar']").click()
    expect(page.locator("#car-data")).to_contain_text("35.5 bar")


def test_a_file_without_the_cars_channels_has_no_car_data_card(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    expect(page.locator("#tp-chans")).to_contain_text("GPS position")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-speed path")).to_have_count(2)
    expect(page.locator("#car-data")).to_have_count(0)


def test_tyres_start_empty_and_the_last_ones_can_be_loaded(page):
    fake = FakeWorker()
    fake.index = [dict(EARLIER, tyres="Michelin Pilot Sport 4S, 245/35 R19")]
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    # The tyres start empty, with an offer to load the car's last ones.
    expect(page.locator("#tp-tyre-make")).to_have_value("")
    expect(page.locator("#tp-tyre-model")).to_have_value("")
    expect(page.locator("#tp-tyre-offer")).to_contain_text("Michelin Pilot Sport 4S")
    page.get_by_role("button", name="Use previous tyres").click()
    expect(page.locator("#tp-tyre-make")).to_have_value("Michelin")
    expect(page.locator("#tp-tyre-model")).to_have_value("Pilot Sport 4S")
    expect(page.locator(".tp-tyre-note")).to_contain_text("Filled in from your last session")
    # Changing them is allowed, and the note goes once they are different.
    page.fill("#tp-tyre-model", "Cup 2")
    page.locator(".tp-head [data-units]").click()
    expect(page.locator("#tp-tyre-model")).to_have_value("Cup 2")
    expect(page.locator(".tp-tyre-note")).to_have_count(0)
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert fake.saved[0]["tyreMake"] == "Michelin" and fake.saved[0]["tyreModel"] == "Cup 2"


def test_what_each_mod_did_compares_before_and_after(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Use previous tyres").click()
    page.get_by_role("button", name="Save session").click()
    card = page.locator("#tp-impact")
    expect(card.locator("h3")).to_have_text("What each mod did")
    # The coilovers were fitted in April 2026, between the March and May sessions.
    row = card.locator("tbody tr")
    expect(row).to_have_count(1)
    expect(row).to_contain_text("Coilovers: KW V3")
    expect(row).to_contain_text("1:42.470")
    expect(row).to_contain_text(re.compile(r"1:39\.78[56]"))
    expect(row.locator("td").nth(3)).to_have_class(re.compile("is-fast"))
    expect(row.locator("td").nth(3)).to_contain_text(re.compile(r"-2\.68[0-9] s"))
    # The tyres are written two ways but are the same tyre, so there's no tyre warning.
    expect(row).not_to_contain_text("different tyres")
    expect(card).to_contain_text("treat it as a guide")


def test_what_each_mod_did_explains_when_there_is_nothing_to_compare(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.route("**/%s/my-builds" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "cars": [dict(CAR, view=[])]}), headers={"Access-Control-Allow-Origin": "*"}))
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-impact")).to_contain_text("Add when you fitted your wheels, tyres, suspension")


def test_follow_recovers_when_the_map_thinks_a_finger_is_still_down(page):
    """A touch the browser never reported as lifted used to block following for
    good, leaving the cars out of view while Follow cars showed as on."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-map2").scroll_into_view_if_needed()
    zoom_in = page.locator("#tp-map2").locator("xpath=..").locator(".tv-zoom-in")
    for _ in range(4):
        zoom_in.click()
    # A finger goes down on the map and its lifting is never seen.
    page.evaluate("""() => {
      const svg = document.getElementById('tp-map2'), r = svg.getBoundingClientRect();
      svg.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true }));
    }""")
    page.locator("#tp-speeds [data-speed='5']").click()
    page.locator("#tp-play-toggle").click()
    page.wait_for_timeout(2200)
    in_view = page.evaluate("""() => {
      const svg = document.getElementById('tp-map2'), vb = svg.viewBox.baseVal;
      const xy = [...svg.querySelectorAll('g[visibility="visible"]')].filter(g => g.querySelector('circle[r="7"]'))
        .map(g => (g.getAttribute('transform').match(/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/) || []).slice(1).map(Number));
      return xy.length === 2 && xy.some(p => p[0] > vb.x && p[0] < vb.x + vb.width && p[1] > vb.y && p[1] < vb.y + vb.height);
    }""")
    assert in_view, "the cars were not kept in view after a touch that never ended"


FOLLOW_HARNESS = """async ([steps]) => {
  const V = window.MT3UKTrackView;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const host = document.createElement('div');
  host.style.cssText = 'width:400px;height:420px;position:fixed;left:0;top:0;background:#fff;z-index:99999';
  svg.setAttribute('class', 'tv-chart');
  host.appendChild(svg); document.body.appendChild(host);
  const trace = [];
  for (let i = 0; i <= 300; i++) { const d = i * 5; trace.push([d, d / 40, d, 60 * Math.sin(d / 300), 40, 0, 0]); }
  const mo = V.map(svg, trace, { mono: true, lines: [{ trace, color: '#2a78d6' }] });
  const zin = host.querySelector('.tv-zoom-in');
  for (let i = 0; i < 4; i++) zin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const centre = () => { const b = svg.viewBox.baseVal; return [b.x + b.width / 2, b.y + b.height / 2]; };
  const xy = i => mo.P(trace[i][2], trace[i][3]);
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const put = (a, b) => { mo.placeA(trace[a]); mo.placeB(trace[b]); };
  const edge = letter => { const g = [...svg.querySelectorAll('g.tv-edge')].find(x => x.querySelector('text').textContent.startsWith(letter)); return g && g.getAttribute('visibility') === 'visible' ? g.querySelector('text').textContent : null; };
  const out = {};
  for (const [name, a, b, wait, gap, idle] of steps) {
    if (gap !== undefined) mo.setGap(gap);
    put(a, b);
    const c = centre(), mid = [(xy(a)[0] + xy(b)[0]) / 2, (xy(a)[1] + xy(b)[1]) / 2];
    out[name] = { now: { toLeader: dist(c, xy(a)), toMid: dist(c, mid) } };
    if (wait && idle) {
      // Paused: nothing moves the cars, the glide finishes by itself.
      await sleep(wait);
      out[name].after = { toLeader: dist(centre(), xy(a)), toMid: dist(centre(), mid), maxStep: 0 };
    } else if (wait) {
      // Keep calling as playback does, frame by frame.
      const end = performance.now() + wait;
      let maxStep = 0, prev = centre();
      while (performance.now() < end) { await new Promise(r => requestAnimationFrame(r)); put(a, b); const cc = centre(); maxStep = Math.max(maxStep, dist(cc, prev)); prev = cc; }
      const c2 = centre();
      out[name].after = { toLeader: dist(c2, xy(a)), toMid: dist(c2, mid), maxStep };
    }
    out[name].edgeA = edge('A'); out[name].edgeB = edge('B');
    out[name].viewW = svg.viewBox.baseVal.width;
  }
  return out;
}"""


def test_follow_glides_between_both_cars_and_the_leader(page):
    open_page(page, FakeWorker())
    r = page.evaluate(FOLLOW_HARNESS, [[
        ["both", 200, 185, 600, 1.9],
        ["apart", 200, 150, 700, 4.4],
        ["near the limit", 200, 172, 600, 3.0],
        ["close again", 200, 190, 700, 1.2],
    ]])
    w = r["both"]["viewW"]
    # Close together: centred between the two, both in view, no arrows.
    assert r["both"]["after"]["toMid"] < 0.5, r["both"]
    assert r["both"]["edgeA"] is None and r["both"]["edgeB"] is None
    # The slower car drops back: the view glides to the leader, not one jump.
    assert r["apart"]["now"]["toLeader"] > 0.25 * w, r["apart"]
    assert r["apart"]["after"]["toLeader"] < 0.5, r["apart"]
    assert r["apart"]["after"]["maxStep"] < 0.2 * w, r["apart"]
    # The car off screen gets an arrow at the edge with the gap.
    assert r["apart"]["edgeB"] == "B, 4.4 s behind", r["apart"]
    assert r["apart"]["edgeA"] is None
    # A gap just under the limit doesn't flick straight back to both.
    assert r["near the limit"]["after"]["toLeader"] < 0.5, r["near the limit"]
    # Close again: back between the two, gliding, and the arrow goes.
    assert r["close again"]["after"]["toMid"] < 0.5, r["close again"]
    assert r["close again"]["after"]["maxStep"] < 0.2 * w
    assert r["close again"]["edgeB"] is None


def test_a_glide_finishes_while_playback_is_paused(page):
    open_page(page, FakeWorker())
    r = page.evaluate(FOLLOW_HARNESS, [[["both", 200, 185, 400, 1.9], ["scrubbed apart", 200, 150, 700, 4.4, True]]])
    w = r["both"]["viewW"]
    assert r["scrubbed apart"]["now"]["toLeader"] > 0.25 * w
    assert r["scrubbed apart"]["after"]["toLeader"] < 0.5, r["scrubbed apart"]


def test_playback_slider_has_a_time_ruler_and_a_line_marker(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    ruler = page.locator("#tp-ruler")
    # Minutes and seconds along the lap, starting at 0:00.
    expect(ruler.locator("span").first).to_have_text("0:00")
    labels = ruler.locator("span").all_inner_texts()
    assert len(labels) >= 3 and all(re.match(r"^\d+:\d\d$", t) for t in labels), labels
    assert ruler.locator("i.is-major").count() >= 3 and ruler.locator("i:not(.is-major)").count() >= 1
    # The marker is a thin upright line, and the orange fill follows it.
    scrub = page.locator("#tp-scrub")
    expect(scrub).to_have_css("appearance", "none")
    scrub.evaluate("el => { el.value = el.max / 2; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    assert abs(float(scrub.evaluate("el => el.style.getPropertyValue('--p')").rstrip('%')) - 50) < 0.5
    page.locator("#tp-play-toggle").click()
    page.wait_for_timeout(300)
    assert float(scrub.evaluate("el => el.style.getPropertyValue('--p')").rstrip('%')) > 50


def test_playback_buttons_are_compact_on_a_phone(page):
    page.set_viewport_size({"width": 390, "height": 844})
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    start, back, toggle = page.locator("#tp-play-start"), page.locator("#tp-play-back"), page.locator("#tp-play-toggle")
    # Start and Rewind are icon buttons on a phone, still named for screen readers and 44px or more to tap.
    for b, name in ((start, "Go back to the start"), (back, "Rewind")):
        box = b.bounding_box()
        assert 44 <= box["width"] <= 52 and box["height"] >= 44, (name, box)
        expect(b).to_have_attribute("aria-label", name)
    expect(toggle).to_contain_text("Play")
    assert toggle.bounding_box()["width"] > 150
    # The speed chips and Follow cars fit on one row.
    ys = {round(c.bounding_box()["y"]) for c in page.locator(".tp-play .chip").all()}
    assert len(ys) == 1, ys
    assert overflow_width(page) <= 0


def test_g_force_and_speed_chart_has_thin_lines_and_can_be_hidden(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    lines = page.locator("#tp-gforce > path[stroke-width]")
    expect(lines).to_have_count(6)
    assert set(lines.evaluate_all("els => els.map(e => e.getAttribute('stroke-width'))")) == {"1.25"}
    switch = page.locator("#tp-gshow")
    expect(switch).to_have_attribute("aria-checked", "true")
    switch.click()
    expect(switch).to_have_attribute("aria-checked", "false")
    expect(page.locator("#tp-gforce")).to_be_hidden()
    expect(page.locator("#tp-gtoggles")).to_be_hidden()
    # Remembered next time.
    page.reload()
    expect(page.locator("#tp-gshow")).to_have_attribute("aria-checked", "false")
    expect(page.locator("#tp-gforce")).to_be_hidden()
    page.locator("#tp-gshow").click()
    expect(page.locator("#tp-gforce")).to_be_visible()


def test_compared_laps_say_which_session_and_day_they_are_from(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    key = page.locator("#tp-key")
    # Laps from this session carry its date.
    expect(key).to_contain_text(re.compile(r"Lap \d, 28 May \(A\)"))
    expect(key).to_contain_text(re.compile(r"Lap \d, 28 May \(B\)"))
    expect(page.locator("#tp-metrics")).to_contain_text(re.compile(r"Lap \d, 28 May \(A\)"))
    # Your best on another day says so, with that day.
    earlier = member_session(fake.sessions["new1"])
    earlier["date"] = "2026-03-28"
    fake.sessions["earlier1"] = earlier
    page.locator("#tp-cmp-b").select_option("x:earlier1")
    expect(key).to_contain_text("Your best lap, 28 Mar (B)")


def test_the_off_screen_label_is_white_on_the_cars_colour(page):
    open_page(page, FakeWorker())
    r = page.evaluate(FOLLOW_HARNESS, [[["both", 200, 185, 300, 1.9], ["apart", 200, 150, 600, 3.8]]])
    assert r["apart"]["edgeB"] == "B, 3.8 s behind"
    fill = page.evaluate("""() => { const t = [...document.querySelectorAll('g.tv-edge')].find(g => g.getAttribute('visibility') === 'visible').querySelector('text'); return getComputedStyle(t).fill; }""")
    assert fill == "rgb(255, 255, 255)", fill


def test_the_chart_is_on_time_and_moving_over_it_moves_playback(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    gs = page.locator("#tp-gforce")
    gs.scroll_into_view_if_needed()
    # The time axis is the ruler: minutes and seconds along the bottom.
    labels = gs.locator("text[text-anchor='middle']").evaluate_all("els => els.map(e => e.textContent)")
    assert labels[0] == "0:00" and all(re.match(r"^\d+:\d\d$", t) for t in labels), labels
    expect(page.locator("#tp-ruler")).to_be_hidden()
    # The slider sits under the chart, with its ends at the chart's axis.
    sb, gb = page.locator("#tp-scrub").bounding_box(), gs.bounding_box()
    assert sb["y"] > gb["y"] + gb["height"] - 4
    assert sb["x"] > gb["x"] + 30 and sb["x"] + sb["width"] < gb["x"] + gb["width"] - 30, (sb, gb)
    # Moving over the chart moves playback there: slider, clock and the line on the chart.
    page.mouse.move(gb["x"] + gb["width"] * 0.5, gb["y"] + gb["height"] * 0.4)
    page.mouse.move(gb["x"] + gb["width"] * 0.6, gb["y"] + gb["height"] * 0.4)
    value = float(page.locator("#tp-scrub").input_value())
    mx = float(page.locator("#tp-scrub").get_attribute("max"))
    assert 0.45 < value / mx < 0.7, (value, mx)
    cross = gs.locator("line[visibility='visible']")
    expect(cross).to_have_count(1)
    expect(page.locator("#tp-metrics [data-m='a-v']")).not_to_have_text("-")
    # The slider's line and the chart's line are at the same place across.
    sx = sb["x"] + sb["width"] * value / mx
    cx = float(cross.get_attribute("x1")) * gb["width"] / float(gs.get_attribute("viewBox").split()[2]) + gb["x"]
    assert abs(sx - cx) < 6, (sx, cx)
    # Leaving the chart keeps the place.
    page.mouse.move(gb["x"] + gb["width"] * 0.6, gb["y"] - 60)
    assert float(page.locator("#tp-scrub").input_value()) == value
    # With the chart hidden, the slider gets its own ruler back.
    page.locator("#tp-gshow").click()
    expect(page.locator("#tp-ruler")).to_be_visible()
    expect(page.locator("#tp-ruler span").first).to_have_text("0:00")


def test_car_temperatures_are_coloured_by_zone_and_held_back_power_is_noted(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[{"name": "telemetry-v1-2026-05-28-10_00_00.csv", "mimeType": "text/csv", "buffer": tesla_full_csv(hot=True).encode()}])
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    card = page.locator("#car-data")
    battery = card.locator(".tp-tile", has_text="Battery temperature")
    expect(battery).to_have_class(re.compile("is-orange"))
    expect(battery).to_contain_text("Orange: near the limit, the car may hold back power")
    brakes = card.locator(".tp-tile", has_text="Hottest brakes")
    expect(brakes).to_have_class(re.compile("is-yellow"))
    expect(brakes).to_contain_text("Yellow: warm")
    expect(card.locator("#tp-held")).to_contain_text("fell from 250 kW early in the session to 190 kW late on")
    expect(card).to_contain_text("yellow from 70%, orange from 85%, red at 100%")


def test_no_held_back_note_when_power_holds_up(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[{"name": "telemetry-v1-2026-05-28-10_00_00.csv", "mimeType": "text/csv", "buffer": tesla_full_csv().encode()}])
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#car-data .tp-tile", has_text="Battery temperature")).to_have_class(re.compile("is-ok"))
    expect(page.locator("#tp-held")).to_have_count(0)


def test_car_figures_say_which_session_and_can_show_each_one(page):
    fake = FakeWorker()
    open_page(page, fake)
    lines = tesla_full_csv().split("\n")
    half = len(lines) // 2
    f1 = "\n".join(lines[:half])
    f2 = "\n".join([lines[0]] + lines[half:])
    seed_merged(fake, [("telemetry-v1-2026-05-28-10_00_00.csv", f1), ("telemetry-v1-2026-05-28-11_00_00.csv", f2)])
    page.goto("/track.html?s=m1")
    card = page.locator("#car-data")
    expect(card.locator("#tp-car-from")).to_contain_text("The whole day, all 2 sessions, 28 May 2026")
    chips = card.locator("[data-car-run]")
    expect(chips).to_have_text(["Whole day", "Session 1", "Session 2"])
    card.locator("summary").click()
    day_charge = card.locator(".tp-tile", has_text="Charge used").locator(".s").inner_text()
    page.locator("#car-data [data-car-run='2']").click()
    expect(page.locator("#tp-car-from")).to_contain_text("Session 2 of 2, 28 May 2026")
    expect(page.locator("#car-data [data-car-run='2']")).to_have_class(re.compile("is-on"))
    expect(page.locator("#car-data .tp-tile", has_text="Charge used").locator(".s")).not_to_have_text(day_charge)
    page.locator("#car-data [data-car-run='all']").click()
    expect(page.locator("#tp-car-from")).to_contain_text("The whole day")


def test_car_figures_from_one_file_say_so_and_brakes_are_estimated(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[{"name": "telemetry-v1-2026-05-28-10_00_00.csv", "mimeType": "text/csv", "buffer": tesla_full_csv().encode()}])
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    card = page.locator("#car-data")
    expect(card.locator("#tp-car-from")).to_contain_text("This session, 28 May 2026")
    expect(card.locator("[data-car-run]")).to_have_count(0)
    brakes = card.locator(".tp-tile", has_text="Hottest brakes")
    expect(brakes.locator(".k")).to_have_text("Hottest brakes (estimated)")
    expect(brakes).to_contain_text("The car's own estimate, not a reading.")


def test_track_mode_sits_under_the_best_lap_tiles_and_laps_are_folded(page):
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[{"name": "telemetry-v1-2026-05-28-10_00_00.csv", "mimeType": "text/csv", "buffer": tesla_full_csv().encode()}])
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    # Straight after the Best lap tiles, before the maps.
    expect(page.locator("#car-data")).to_be_visible()
    assert page.evaluate("document.getElementById('car-data').previousElementSibling.classList.contains('tp-tiles')")
    assert page.evaluate("!!(document.getElementById('car-data').compareDocumentPosition(document.getElementById('tp-map2')) & Node.DOCUMENT_POSITION_FOLLOWING)")
    # Track Mode is folded away too, with the headline figures and a highlighted arrow.
    car = page.locator("#car-data")
    expect(car).not_to_have_attribute("open", "")
    expect(car.locator("summary")).to_contain_text("Track Mode")
    expect(car.locator("summary")).to_contain_text("Charge used")
    expect(car.locator(".tp-tile").first).to_be_hidden()
    expect(car.locator(".tp-open")).to_be_visible()
    car.locator("summary").click()
    expect(car.locator(".tp-tile").first).to_be_visible()
    # The lap times are folded away, with a summary, and open on a tap.
    laps = page.locator("#tp-laps")
    expect(laps).not_to_have_attribute("open", "")
    expect(laps.locator("summary")).to_contain_text(re.compile(r"Laps\s*\d+ laps, best 1:39\.78[56]"))
    expect(laps.locator("table")).to_be_hidden()
    laps.locator("summary").click()
    expect(laps.locator("table")).to_be_visible()


def _trace_point(page, frac):
    """Where on screen a point part way along the tap map's trace is (scrolled into view)."""
    page.locator("#tp-tap polyline").first.wait_for(state="attached")
    page.locator("#tp-tap").scroll_into_view_if_needed()
    return page.evaluate("""(frac) => {
      const svg = document.getElementById('tp-tap'), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
      const pts = svg.querySelector('polyline').getAttribute('points').split(' ').map(s => s.split(',').map(Number));
      const p = pts[Math.floor(pts.length * frac)];
      return [r.left + (p[0] - vb.x) * r.width / vb.width, r.top + (p[1] - vb.y) * r.height / vb.height];
    }""", frac)


def test_start_and_finish_markers_can_be_undone_cleared_dragged_and_moved_later(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    step = page.locator("#tp-tap-step")
    expect(step).to_have_text("Tap the start line, then the finish line.")
    marks = page.locator("#tp-tap .tp-tapmark")
    undo, clear = page.get_by_role("button", name="Undo last marker"), page.get_by_role("button", name="Clear markers")
    expect(undo).to_be_disabled()
    # The right mouse button's menu is kept away from the map.
    assert page.evaluate("(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.getElementById('tp-tap').dispatchEvent(e); return e.defaultPrevented; })()")
    a = _trace_point(page, 0.2)
    page.mouse.click(a[0], a[1])
    expect(step).to_have_text("Start set. Now tap the finish line.")
    expect(marks).to_have_count(1)
    expect(undo).to_be_enabled()
    # Dragging (not a quick click) never places a marker.
    b = _trace_point(page, 0.6)
    page.mouse.move(b[0], b[1])
    page.mouse.down()
    page.mouse.move(b[0] + 40, b[1] + 30, steps=5)
    page.mouse.up()
    expect(marks).to_have_count(1)
    # Undo takes the start away again.
    undo.click()
    expect(marks).to_have_count(0)
    expect(step).to_have_text("Tap the start line, then the finish line.")
    # Start and finish: the runs are timed, and the lines can be moved later.
    a = _trace_point(page, 0.2)
    page.mouse.click(a[0], a[1])
    b = _trace_point(page, 0.6)
    page.mouse.click(b[0], b[1])
    page.get_by_role("switch", name="Correct lines?").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Timed between the start and finish you picked")
    page.get_by_role("button", name="Move start and finish").click()
    expect(marks).to_have_count(2)
    expect(page.get_by_role("button", name="Done")).to_be_visible()
    # Drag the finish marker further along the track.
    fin = page.locator("#tp-tap [data-mark='finish']")
    page.locator("#tp-tap").scroll_into_view_if_needed()
    before = fin.bounding_box()
    c = _trace_point(page, 0.7)
    page.mouse.move(before["x"] + before["width"] / 2, before["y"] + before["height"] / 2)
    page.mouse.down()
    page.mouse.move(c[0], c[1], steps=8)
    page.mouse.up()
    expect(page.locator("#tp-tap [data-mark='finish']")).to_have_count(1)
    after = page.locator("#tp-tap [data-mark='finish']").bounding_box()
    assert abs(after["x"] - before["x"]) + abs(after["y"] - before["y"]) > 10, (before, after)
    # A moved marker is checked again before it is taken.
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Confirm correct Start and Finish lines")
    page.get_by_role("switch", name="Correct lines?").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Timed between the start and finish you picked")
    # Clear takes both away.
    page.get_by_role("button", name="Move start and finish").click()
    page.get_by_role("button", name="Clear markers").click()
    expect(marks).to_have_count(0)
    expect(step).to_have_text("Tap the start line, then the finish line.")


def test_the_marker_map_has_a_full_screen_button_and_asks_for_both_lines(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    tap = page.locator("#tp-tap")
    expect(tap).to_be_visible()
    # Not full screen until the member asks, with the prompt in the box either way.
    expect(page.locator("#tp-tapbox")).not_to_have_class(re.compile("is-full"))
    expect(page.locator("#tp-tapbox #tp-tap-step")).to_have_text("Tap the start line, then the finish line.")
    box = tap.bounding_box()
    assert box["height"] >= box["width"] * 0.8, box
    page.get_by_role("button", name="Full screen").click()
    expect(page.locator("#tp-tapbox")).to_have_class(re.compile("is-full"))
    vp = page.viewport_size
    big = tap.bounding_box()
    assert big["width"] >= vp["width"] - 40 and big["height"] >= vp["height"] * 0.6, big
    # Markers still go where they're placed in full screen.
    a = _trace_point(page, 0.3)
    page.mouse.click(a[0], a[1])
    expect(page.locator("#tp-tap .tp-tapmark")).to_have_count(1)
    expect(page.locator("#tp-tapbox #tp-tap-step")).to_have_text("Start set. Now tap the finish line.")
    page.get_by_role("button", name="Exit full screen").click()
    expect(page.locator("#tp-tapbox")).not_to_have_class(re.compile("is-full"))
    expect(page.locator("#tp-tap .tp-tapmark")).to_have_count(1)


def test_after_setting_both_lines_the_member_is_asked_to_confirm_them(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    a = _trace_point(page, 0.2)
    page.mouse.click(a[0], a[1])
    b = _trace_point(page, 0.6)
    page.mouse.click(b[0], b[1])
    notice = page.locator("#tp-result .tp-notice.is-ok")
    expect(notice).to_contain_text("Confirm correct Start and Finish lines")
    expect(page.locator("#tp-tap .tp-tapmark")).to_have_count(2)
    # The ignore switch and the finish crossing are there while the lines are checked, not only after.
    expect(page.locator("#tp-ignore-finish")).to_be_visible()
    expect(page.locator("#tp-finish-cross")).to_be_visible()
    # The question starts white and unticked; ticking it turns it orange.
    confirm = page.get_by_role("switch", name="Correct lines?")
    expect(confirm).to_have_attribute("aria-checked", "false")
    assert page.evaluate("getComputedStyle(document.querySelector('.tp-confirm')).backgroundColor") == "rgb(255, 255, 255)"
    confirm.click()
    page.wait_for_timeout(250)
    ticked = page.evaluate("(() => { const b = document.querySelector('.tp-confirm'); return b ? [b.getAttribute('aria-checked'), getComputedStyle(b).backgroundColor] : null; })()")
    assert ticked is None or ticked == ["true", "rgb(232, 84, 42)"], ticked
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Timed between the start and finish you picked")
    expect(page.locator("#tp-tap")).to_have_count(0)


def test_a_track_day_needs_no_start_line_from_the_member(page, tmp_path):
    no_line = tmp_path / "noline.vbo"
    no_line.write_bytes(b"".join(l for l in FIXTURE.read_bytes().splitlines(True) if not l.startswith(b"Start ")))
    page.route(re.compile(r".*/data/tracks\.json.*"), _without_start_line)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(no_line))
    # No tapping: the laps are found from the trace.
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("found from your own trace")
    expect(page.locator("#tp-tap")).to_have_count(0)
    # Nothing to move on a track day: the lap line is found for them.
    expect(page.get_by_role("button", name="Move the start line")).to_have_count(0)
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed lap")
    # A sprint still asks for both lines.
    page.locator("[data-type] [data-v='sprint']").click()
    expect(page.locator("#tp-tap-step")).to_have_text("Tap the start line, then the finish line.")


def test_members_without_access_see_the_early_preview_page_and_can_ask(page):
    fake = FakeWorker()
    fake.access = "none"
    open_page(page, fake)
    gate = page.locator(".tp-gate")
    expect(gate.locator("h2")).to_have_text("Track Sessions is being tested")
    expect(gate.locator(".early-badge")).to_have_text("Early preview")
    # A short explainer and screenshots, with their descriptions.
    expect(gate.locator(".tp-ticks li")).to_have_count(4)
    shots = gate.locator(".tp-gate-thumbs [data-shot]")
    expect(shots).to_have_count(1)
    assert all(src.startswith("images/track-preview/") for src in gate.locator(".tp-thumb img").evaluate_all("els => els.map(e => e.getAttribute('src'))"))
    # The request form comes before the picture, beside the explanation.
    form_y = gate.locator("#tp-gate-form").bounding_box()["y"]
    assert form_y < gate.locator(".tp-gate-thumbs").bounding_box()["y"]
    # The one zoomed out picture opens in a viewer with Full screen and Close, and no Previous or Next.
    shots.first.click()
    lb = page.locator("#tp-lb")
    expect(lb).to_be_visible()
    assert len(lb.locator("#tp-lb-img").get_attribute("alt")) > 30
    expect(lb.get_by_role("button", name="Next picture")).to_be_hidden()
    expect(lb.get_by_role("button", name="Full screen")).to_be_visible()
    page.keyboard.press("Escape")
    expect(lb).to_have_count(0)
    # The tool itself is not shown.
    expect(page.get_by_role("link", name="Add a session")).to_have_count(0)
    # Asking for access.
    gate.locator("#tp-gate-use").select_option("RaceBox")
    gate.locator("#tp-gate-note").fill("Thruxton and Brands")
    gate.get_by_role("button", name="Request access").click()
    expect(page.locator("#tp-gate-done")).to_contain_text("Request received")
    assert fake.access_requests == [{"use": "RaceBox", "note": "Thruxton and Brands"}]
    expect(page.get_by_role("button", name="Request access")).to_have_count(0)


def test_a_member_already_waiting_sees_the_waiting_message(page):
    fake = FakeWorker()
    fake.access = "pending"
    open_page(page, fake)
    expect(page.locator("#tp-gate-done")).to_contain_text("We will email you when you are in")
    expect(page.locator("#tp-gate-form")).to_have_count(0)


def test_approved_members_get_the_tool_and_adding_a_session_is_gated_too(page):
    fake = FakeWorker()
    open_page(page, fake)
    expect(page.locator(".tp-gate")).to_have_count(0)
    expect(page.get_by_role("link", name="Add a session")).to_be_visible()
    # The add page for someone not approved shows the same page.
    fake2 = FakeWorker()
    fake2.access = "none"
    page.unroute_all()
    open_page(page, fake2, "/track.html?add=1")
    expect(page.locator(".tp-gate")).to_be_visible()


def test_the_early_preview_badge_is_on_the_menu_the_page_and_the_garage(page):
    page.goto("/track.html")
    expect(page.locator("nav .nav-link-track .early-badge").first).to_have_text("Early preview")
    expect(page.locator(".page-hero .early-badge")).to_have_text("Early preview")
    page.goto("/index.html")
    expect(page.locator(".hp-cat[data-cat='sessions'] .early-badge")).to_have_text("Early preview")
    page.goto("/my-builds.html")
    expect(page.locator("#mb-track-btn .early-badge")).to_have_text("Early preview")


def test_official_lines_cannot_be_moved_and_sprint_lines_are_labelled(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("#tp-result .tp-notice.is-ok").wait_for(timeout=10000)
    # Thruxton has official lines: they are used, and a member cannot move them.
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("official start line")
    expect(page.get_by_role("button", name="Move the start line")).to_have_count(0)
    # A map with a start and a finish line names each, in text that reads on the satellite picture.
    labels = page.evaluate("""() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      document.body.appendChild(svg);
      const trace = [0, 1, 2, 3].map(i => [i * 50, 0, i * 50, 0, 20, 0, 0]);
      window.MT3UKTrackView && window.MT3UKTrackView.map(svg, trace, { startLine: [[0, -10], [0, 10]], finishLine: [[150, -10], [150, 10]] });
      const t = [...svg.querySelectorAll('text')].map(x => [x.textContent, x.getAttribute('fill'), x.getAttribute('paint-order')]);
      svg.remove();
      return t;
    }""")
    texts = [l[0] for l in labels]
    assert "Start" in texts and "Finish" in texts, labels
    assert all(l[1] == "#ffffff" and l[2] == "stroke" for l in labels if l[0] in ("Start", "Finish")), labels
    # The page's own rule for chart text is grey: the labels must still come out white.
    fill = page.evaluate("""() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'tv-chart');
      document.body.appendChild(svg);
      const trace = [0, 1, 2, 3].map(i => [i * 50, 0, i * 50, 0, 20, 0, 0]);
      window.MT3UKTrackView.map(svg, trace, { startLine: [[0, -10], [0, 10]], finishLine: [[150, -10], [150, 10]] });
      const t = [...svg.querySelectorAll('text')].filter(x => x.textContent === 'Finish')[0];
      const c = getComputedStyle(t).fill;
      svg.remove();
      return c;
    }""")
    assert fill == "rgb(255, 255, 255)", fill


def test_changing_the_tyre_make_clears_the_model(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("#tp-tyre-make").wait_for(timeout=10000)
    makes = page.evaluate("[...document.querySelectorAll('#tp-tyre-make option')].map(o => o.value).filter(v => v && v !== '__other')")
    assert len(makes) >= 2
    page.select_option("#tp-tyre-make", makes[0])
    page.fill("#tp-tyre-model", "Something typed")
    page.select_option("#tp-tyre-make", makes[1])
    expect(page.locator("#tp-tyre-model")).to_have_value("")


def test_a_sprint_member_can_choose_which_finish_crossing_ends_the_run(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    a = _trace_point(page, 0.2)
    page.mouse.click(a[0], a[1])
    b = _trace_point(page, 0.6)
    page.mouse.click(b[0], b[1])
    page.get_by_role("switch", name="Correct lines?").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Timed between the start and finish you picked")
    sel = page.locator("#tp-finish-cross")
    expect(sel).to_be_visible()
    sel.select_option("1")
    expect(page.locator("#tp-finish-cross")).to_have_value("1")
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Timed between the start and finish you picked")
    page.locator("#tp-finish-cross").select_option("")
    expect(page.locator("#tp-finish-cross")).to_have_value("")


def test_a_sprint_asks_who_organised_it_and_keeps_the_answer(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-organiser")).to_have_count(0)
    page.locator("[data-type] [data-v='sprint']").click()
    org = page.locator("#tp-organiser")
    expect(org).to_be_visible()
    org.fill("B19")
    org.press("Tab")
    expect(page.locator("#tp-organiser")).to_have_value("B19")
    # It survives the map asking for the lines.
    expect(page.locator("#tp-tap-step")).to_have_text("Tap the start line, then the finish line.")
    expect(page.locator("#tp-organiser")).to_have_value("B19")


def test_the_session_page_shows_the_name_of_the_file_it_came_from(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-filename")).to_contain_text("File: " + FIXTURE.name)


def test_confirming_the_lines_scrolls_back_to_the_result(page):
    page.set_viewport_size({"width": 400, "height": 800})
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    a = _trace_point(page, 0.2)
    page.mouse.click(a[0], a[1])
    b = _trace_point(page, 0.6)
    page.mouse.click(b[0], b[1])
    page.get_by_role("switch", name="Correct lines?").scroll_into_view_if_needed()
    page.get_by_role("switch", name="Correct lines?").click()
    notice = page.locator("#tp-result .tp-notice.is-ok")
    expect(notice).to_contain_text("Timed between the start and finish you picked")
    page.wait_for_timeout(300)
    top = notice.bounding_box()["y"]
    assert 0 <= top < 300, top


def test_g_forces_are_only_marked_as_estimated_when_the_file_has_none(page):
    # A file with its own g readings: shown as they are.
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-tile .k", has_text="Most grip used")).to_have_text("Most grip used")
    expect(page.locator("#tp-gbox h3")).not_to_contain_text("estimated")
    expect(page.locator(".tp-note", has_text="Peak braking").first).not_to_contain_text("estimated")


def test_g_forces_worked_out_from_gps_are_marked_as_estimated(page, tmp_path):
    # A file with no g readings: worked out from GPS, so marked.
    text = FIXTURE.read_bytes().decode("latin1")
    no_g = tmp_path / "nog.vbo"
    no_g.write_bytes(re.sub(r"(?i)\blong ?acc\b|\blat ?acc\b|longacc|latacc", "unused", text).encode("latin1"))
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(no_g))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-tile .k", has_text="Most grip used")).to_have_text("Most grip used (estimated)")
    expect(page.locator("#tp-gbox h3")).to_contain_text("(estimated)")
    expect(page.locator(".tp-gg").locator("xpath=../..").locator("h3")).to_contain_text("(estimated)")
    expect(page.locator(".tp-note", has_text="Peak braking").first).to_contain_text("(estimated)")


def test_the_admin_can_make_the_lines_they_set_the_official_ones(page):
    open_page(page, FakeWorker(admin=True), admin=True)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    a = _trace_point(page, 0.2)
    page.mouse.click(a[0], a[1])
    b = _trace_point(page, 0.6)
    page.mouse.click(b[0], b[1])
    page.get_by_role("switch", name="Correct lines?").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Timed between the start and finish you picked")
    page.get_by_role("button", name="Make official").click()
    # The course is remembered: this file is now timed on its official lines, which cannot be moved.
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("official start and finish lines")
    expect(page.get_by_role("button", name="Move start and finish")).to_have_count(0)
    expect(page.locator("#tp-official-box")).to_have_count(0)


def test_members_who_are_not_the_admin_are_not_offered_to_make_lines_official(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    a = _trace_point(page, 0.2)
    page.mouse.click(a[0], a[1])
    b = _trace_point(page, 0.6)
    page.mouse.click(b[0], b[1])
    page.get_by_role("switch", name="Correct lines?").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Timed between the start and finish you picked")
    expect(page.locator("#tp-make-official")).to_have_count(0)


def test_the_admin_sees_which_courses_are_known_when_a_course_is_not_recognised(page):
    open_page(page, FakeWorker(admin=True), admin=True)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    expect(page.locator(".tp-debug")).to_contain_text("tracks are loaded")
    expect(page.locator(".tp-debug")).to_contain_text("Nearest sprint venues")


def test_members_do_not_see_the_course_diagnostics(page):
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] [data-v='sprint']").click()
    expect(page.locator("#tp-tap-step")).to_be_visible()
    expect(page.locator(".tp-debug")).to_have_count(0)


def test_a_sprint_with_no_runs_can_be_saved_without_times_and_the_admin_is_told(page, tmp_path):
    no_line = tmp_path / "noline.vbo"
    no_line.write_bytes(b"".join(l for l in FIXTURE.read_bytes().splitlines(True) if not l.startswith(b"Start ")))
    page.route(re.compile(r".*/data/tracks\.json.*"), _without_start_line)
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(no_line))
    page.locator("[data-type] [data-v='sprint']").click()
    page.fill("#tp-venue-name", "Abingdon")
    page.get_by_role("button", name="Save without times, tell MT3UK").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    # Saved as a mapped drive, with the course named, and a request for the admin.
    assert fake.saved[0]["session"]["type"] == "other" and fake.saved[0]["session"]["pendingCourse"] == "Abingdon"
    assert fake.requests[0]["kind"] == "sprint" and fake.requests[0]["name"] == "Abingdon" and fake.requests[0]["outline"]
    expect(page.locator("#tp-pending-course")).to_contain_text("Abingdon is not set up yet")


def test_drag_runs_show_0_to_30_and_have_a_1_ft_rollout_switch(page):
    path = ROOT / "tests" / "fixtures" / "_tmp_rollout.csv"
    path.write_text(drag_csv(51.5, -0.12), encoding="utf-8")
    try:
        fake = FakeWorker(admin=True)
        open_page(page, fake, "/track.html?add=1&car=car1", admin=True)
        page.set_input_files("#tp-file", str(path))
        page.locator("[data-type] [data-v='drag']").click()
        switch = page.locator("#tp-rollout")
        expect(switch).to_have_attribute("aria-checked", "false")
        page.locator("#tp-street").click()
        page.get_by_role("button", name="Save session").click()
        expect(page.locator(".tp-tile .k", has_text="0 to 30 mph")).to_be_visible()
        expect(page.locator(".tp-table th", has_text="0-30")).to_be_visible()
        expect(page.locator(".tp-small", has_text="first movement").first).to_be_visible()
    finally:
        path.unlink()


def test_the_1_ft_rollout_switch_shortens_the_times_and_is_kept_with_the_run(page):
    path = ROOT / "tests" / "fixtures" / "_tmp_rollout2.csv"
    path.write_text(drag_csv(51.5, -0.12), encoding="utf-8")
    try:
        fake = FakeWorker(admin=True)
        open_page(page, fake, "/track.html?add=1&car=car1", admin=True)
        page.set_input_files("#tp-file", str(path))
        page.locator("[data-type] [data-v='drag']").click()
        page.locator("#tp-street").click()
        page.locator("#tp-rollout").click()
        expect(page.locator("#tp-rollout")).to_have_attribute("aria-checked", "true")
        page.get_by_role("button", name="Save session").click()
        expect(page.locator(".tp-small", has_text="1 ft rollout").first).to_be_visible()
        assert fake.saved[0]["session"].get("rollout") is True
    finally:
        path.unlink()
