"""track.html in the browser against a stand-in for the worker's /track routes:
adding a session from the real Thruxton RaceBox file (tests/fixtures), the
session page and lap compare, over time with mods, leaderboards, a CSV whose
columns need picking, drag runs away from a strip (members can't save them,
admins can as private street runs), and the phone layout."""
import gzip
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

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
    keys = ["id", "carId", "type", "venueId", "venue", "layoutId", "layout", "date", "time", "privacy", "conditions", "tyres", "temp", "tempSource", "weather", "vmax", "soc", "quality", "logger", "pads", "padFrontMake", "padFrontCompound", "padRearMake", "padRearCompound", "street", "atVenue", "origin", "tyreMake", "tyreModel"]
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
        self.car_updates = []
        self.index = [dict(EARLIER)] if earlier else []
        self.admin = admin
        self.saved = []
        self.gzipped = False
        self.requests = []
        # When on, the same file saved again is refused, as the worker does.
        self.dupes = False
        # The admin's welcome words for the signed-out card, when set.
        self.copy = None
        # The Laps front page panels (/laps/panels) and, when set, what /track/counts answers.
        self.panels = None
        self.news = None
        self.counts = None
        # The link preview picture set's version, for the share links.
        self.shareVersion = 0
        self.public_car = {}
        self.courses = []
        self.courses_added = []
        self.course_error = ""
        self.sources = {}
        self.boards = {}
        self.access = "approved"
        self.access_requests = []
        self.tyre_extra = {}
        self.fail_source = False
        # Asking to edit a saved session's map: none, pending or granted, and the change a member has sent.
        self.lines_status = "none"
        self.lines_proposal = None
        self.line_requests = []
        self.line_proposals = []
        self.line_images = []
        # Asking to rename the track on a session at an unlisted track.
        self.rename_status = "none"
        self.rename_proposal = None
        self.rename_requests = []
        self.rename_proposals = []
        self.raw_gzip_source = False

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
            data = {"success": True, "cars": [CAR] + list(getattr(self, "extra_cars", []))}
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
            twin = next((s for s in self.sessions.values() if self.dupes and rec.get("fileName") and s.get("fileName") == rec.get("fileName") and s.get("date") == rec.get("date") and s.get("time") == rec.get("time")), None)
            if twin:
                status, data = 409, {"success": False, "duplicate": True, "session": summary(twin), "message": "You already have this session: %s, %s at %s. Open it from your list instead." % (twin.get("venue"), twin["date"], twin["time"])}
            else:
                rec.update({"id": "new%d" % (len(self.sessions) + 1), "carId": body["carId"], "privacy": "private" if body.get("street") else body.get("privacy", "private"),
                            "conditions": body.get("conditions"), "tyres": body.get("tyres"), "tyreMake": body.get("tyreMake"), "tyreModel": body.get("tyreModel"), "tyreWidth": body.get("tyreWidth"), "tyreProfile": body.get("tyreProfile"), "tyreRim": body.get("tyreRim"), "temp": body.get("temp"), "tempSource": body.get("tempSource"), "weather": body.get("weather"), "notes": body.get("notes"), "publicNote": body.get("publicNote"), "logger": body.get("logger"), "street": bool(body.get("street"))})
                self.sessions[rec["id"]] = rec
                self.saved.append(body)
                self.index.insert(0, summary(rec))
                data = {"success": True, "session": summary(rec)}
        elif path == "/track/admin/retime/source" and req.method == "GET":
            sid = q.get("id", [""])[0]
            if sid in self.sources and req.headers.get("x-admin-viewer") == "admintoken1234567890":
                data = dict(self.sources[sid], success=True)
            else:
                status, data = 404, {"success": False, "message": "No readings were kept for this session."}
        elif path == "/track/admin/retime" and req.method == "POST":
            if req.headers.get("x-admin-viewer") != "admintoken1234567890":
                status, data = 401, {"success": False}
            else:
                old = self.sessions[body["id"]]
                rec = dict(body["session"])
                for k in ("id", "carId", "privacy", "conditions", "tyres", "notes", "hasSource"):
                    rec[k] = old.get(k)
                if body.get("memberAsked") and rec.get("layoutId") != old.get("layoutId"):
                    rec["layoutPicked"] = True
                    rec["layoutByAdmin"] = {"at": "2026-10-07T10:00:00Z", "note": body["memberAsked"], "from": old.get("layout", "")}
                self.sessions[old["id"]] = rec
                self.admin_retimed = getattr(self, "admin_retimed", []) + [body]
                data = {"success": True, "session": summary(rec)}
        elif path == "/track/session" and req.method == "GET":
            sid = q.get("id", [""])[0]
            rec = self.sessions.get(sid)
            if rec and getattr(self, "admin_view", False):
                data = {"success": True, "session": dict(rec, mine=False, adminView=True, car=CAR["name"], ownerName=rec.get("ownerName", "John Chambers"))}
            elif rec:
                data = {"success": True, "session": dict(rec, mine=True, car=CAR["name"], ownerName=rec.get("ownerName", "Rich"))}
            else:
                status, data = 404, {"success": False}
        elif path == "/tyres" and req.method == "GET":
            data = {"success": True, "extra": self.tyre_extra}
        elif path == "/track/lines/status" and req.method == "GET":
            data = {"success": True, "state": self.lines_status, "proposal": self.lines_proposal}
        elif path == "/track/lines/request" and req.method == "POST":
            self.line_requests.append(body)
            self.lines_status = "pending"
            data = {"success": True, "state": "pending"}
        elif path == "/track/rename/status" and req.method == "GET":
            data = {"success": True, "state": self.rename_status, "proposal": self.rename_proposal}
        elif path == "/track/rename/request" and req.method == "POST":
            self.rename_requests.append(body)
            self.rename_status = "pending"
            data = {"success": True, "state": "pending"}
        elif path == "/track/rename/propose" and req.method == "POST":
            self.rename_proposals.append(body)
            self.rename_proposal = {"at": "2026-10-03T12:00:00Z", "from": "Aerodrome", "to": body["name"]}
            data = {"success": True, "state": "granted", "proposal": self.rename_proposal}
        elif path == "/track/lines/image" and req.method == "POST":
            self.line_images.append((q.get("which", [""])[0], raw))
            data = {"success": True}
        elif path == "/track/lines/propose" and req.method == "POST":
            self.line_proposals.append(body)
            self.lines_proposal = {"at": "2026-10-03T12:00:00Z", "from": {"startLine": None, "finishLine": None, "time": 99.8}, "to": {"startLine": body["startLine"], "finishLine": body.get("finishLine"), "time": body.get("time")}}
            data = {"success": True, "state": "granted", "proposal": self.lines_proposal}
        elif path == "/track/session/source" and req.method == "POST":
            sid = q.get("id", [""])[0]
            if self.fail_source:
                status, data = 413, {"success": False, "message": "Those readings are too big to keep."}
                self.sessions[sid]["readingsRefused"] = {"message": "Those readings are too big to keep.", "tries": 1}
            else:
                self.sources[sid] = body
                self.sessions[sid]["hasSource"] = True
        elif path == "/track/session/car" and req.method == "POST":
            sid = q.get("id", [""])[0]
            self.car_updates.append(body)
            self.sessions[sid]["carData"] = body["carData"]
            data = {"success": True}
        elif path == "/track/session/source" and req.method == "GET":
            sid = q.get("id", [""])[0]
            if sid in self.sources and self.raw_gzip_source:
                # Still zipped when it reaches the page, with no Content-Encoding to tell the browser.
                route.fulfill(status=200, content_type="application/octet-stream", body=gzip.compress(json.dumps(self.sources[sid]).encode()), headers={"Access-Control-Allow-Origin": "*"})
                return
            if sid in self.sources:
                data = dict(self.sources[sid], success=True)
            else:
                status, data = 404, {"success": False, "message": "No readings were kept for this session."}
        elif path == "/track/session" and req.method == "PUT" and body.get("session"):
            old = self.sessions[body["id"]]
            rec = dict(body["session"])
            for k in ("id", "carId", "privacy", "conditions", "tyres", "tyreMake", "tyreModel", "tyreWidth", "tyreProfile", "tyreRim", "temp", "tempSource", "weather", "notes", "publicNote", "logger", "hasSource"):
                rec[k] = old.get(k)
            self.sessions[old["id"]] = rec
            self.replaced = getattr(self, "replaced", []) + [body]
            self.index = [summary(rec) if s["id"] == rec["id"] else s for s in self.index]
            data = {"success": True, "session": summary(rec)}
        elif path == "/track/session" and req.method == "PUT":
            rec = self.sessions[body["id"]]
            for k in ("privacy", "conditions", "tyres", "tyreMake", "tyreModel", "tyreWidth", "tyreProfile", "tyreRim", "padFrontMake", "padFrontCompound", "padRearMake", "padRearCompound", "pads", "temp", "tempSource", "weather", "notes", "publicNote", "logger"):
                if k in body:
                    rec[k] = body[k]
            if "hill" in body:
                if body["hill"]:
                    rec["hill"] = True
                else:
                    rec.pop("hill", None)
            self.index = [summary(rec) if s["id"] == rec["id"] else s for s in self.index]
            data = {"success": True, "session": summary(rec)}
        elif path == "/track/session" and req.method == "DELETE":
            sid = q.get("id", [""])[0]
            self.sessions.pop(sid, None)
            self.index = [s for s in self.index if s["id"] != sid]
        elif path == "/laps/news":
            data = {"success": True, "news": self.news}
        elif path == "/laps/panels":
            data = {"success": True, "panels": self.panels or {}}
        elif path == "/track/counts" and self.counts is not None:
            data = self.counts
        elif path == "/track/counts":
            counts, cars = {}, {}
            for s in self.index:
                if s.get("privacy") in ("build", "board") and s.get("venueId") and s.get("layoutId"):
                    k = "track-board:%s:%s" % (s["venueId"], s["layoutId"])
                    # One for each car, its fastest: what the board shows.
                    cars.setdefault(k, set()).add(s.get("carId", "car1"))
                    counts[k] = len(cars[k])
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
            data = {"success": True, "car": dict({"id": "car1", "name": CAR["name"], "model": "Model 3", "owner": "Rich"}, **self.public_car), "mine": getattr(self, "public_mine", False), "sessions": [s for s in self.index if s.get("privacy") in ("build", "board")]}
        elif path == "/track/copy":
            data = {"success": True, "copy": self.copy or {}}
        elif path == "/share/versions":
            data = {"success": True, "versions": {"track": self.shareVersion, "home": 0}}
        elif path == "/track/requests":
            self.requests.append(body)
        elif path == "/track/courses":
            self.courses_added.append(body)
            if self.course_error:
                status, data = 400, {"success": False, "message": self.course_error}
            else:
                lib = json.loads((ROOT / "data" / "tracks.json").read_text(encoding="utf-8"))
                vid = re.sub(r"[^a-z0-9-]+", "-", body["name"].lower()).strip("-")
                layout = {"id": "course", "name": body.get("organizer") or body["name"], "length": body.get("lapLength") or 0, "startLine": body["startLine"]}
                if body["kind"] == "sprint":
                    layout["finishLine"] = body["finishLine"]
                existing = [v for v in lib["venues"] if v["id"] == body.get("venueId")]
                if existing and body.get("layoutName"):
                    # A layout added to a track that is already listed, named by the member.
                    lid = re.sub(r"[^a-z0-9-]+", "-", body["layoutName"].lower()).strip("-")
                    existing[0]["layouts"].append({"id": lid, "name": body["layoutName"], "length": body.get("lapLength") or 0, "startLine": body["startLine"]})
                    data = {"success": True, "venueId": existing[0]["id"], "layoutId": lid, "relinked": 0, "library": lib}
                else:
                    lib["venues"].append({"id": vid, "name": body["name"], "type": "sprint" if body["kind"] == "sprint" else "circuit", "lat": body["lat"], "lng": body["lng"], "radius": 2000, "review": True, "layouts": [layout]})
                    data = {"success": True, "venueId": vid, "layoutId": "course", "relinked": 0, "library": lib}
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
    expect(page.locator(".lb-hero h1")).to_have_text("Leaderboard")
    expect(page.locator(".tp-board-card").first).to_contain_text("Thruxton")


def _thruxton_with_a_second_layout(page):
    """The track list with a second Thruxton layout (same line, a different length), as Abingdon has two."""
    def handler(route):
        d = json.loads((ROOT / "data" / "tracks.json").read_text(encoding="utf-8"))
        v = [x for x in d["venues"] if x["id"] == "thruxton"][0]
        v["layouts"].append({"id": "short", "name": "Short Circuit", "length": 1800, "startLine": v["layouts"][0]["startLine"], "sectors": [], "corners": []})
        route.fulfill(status=200, content_type="application/json", body=json.dumps(d))
    page.route(re.compile(r".*/data/tracks\.json.*"), handler)


def test_the_member_can_pick_the_layout_and_sees_the_start_finish_line_before_saving(page):
    _thruxton_with_a_second_layout(page)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    chips = page.locator("#tp-layout-field [data-layout] .chip")
    expect(chips).to_have_text(["Thruxton", "Short Circuit", "A different layout"])
    # The layout found from the GPS is picked already.
    expect(page.locator("#tp-layout-field .chip.is-on")).to_have_text("Thruxton")
    # The start and finish line is on a map before saving, with the way to ask for a change.
    expect(page.locator("#tp-line-map")).to_be_attached()
    expect(page.locator("#tp-line-preview")).to_contain_text("Request Edit Map")
    page.wait_for_function("() => document.querySelectorAll('#tp-line-map .tv-line, #tp-line-map line').length > 0")
    # Picking the other listed layout times the session on it, whatever its listed length.
    chips.nth(1).click()
    expect(page.locator("#tp-layout-field .chip.is-on")).to_have_text("Short Circuit")
    expect(page.locator("#tp-result .tp-notice.is-ok").first).to_contain_text("Short Circuit")
    chips.nth(0).click()
    expect(page.locator("#tp-result .tp-notice.is-ok").first).not_to_contain_text("Short Circuit")


def test_a_member_can_add_a_different_layout_to_a_listed_circuit(page):
    _thruxton_with_a_second_layout(page)
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("#tp-layout-field [data-v='__new']").click()
    # Never the lines of a listed layout: this file has its own line, so that is used and can be moved.
    expect(page.locator("#tp-result .tp-notice.is-ok").first).not_to_contain_text("official")
    expect(page.locator(".tp-move-lines")).to_be_visible()
    expect(page.locator("#tp-addnow-box")).to_contain_text("This layout at Thruxton is not in the MT3UK track list yet")
    page.locator("#tp-addnow").click()
    # The new layout needs a name, which is asked for before saving.
    expect(page.locator("#tp-layout-name")).to_be_visible()
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-layout-name")).to_have_attribute("aria-invalid", "true")
    assert fake.courses_added == []
    page.fill("#tp-layout-name", "Wing Loop")
    page.get_by_role("button", name="Save session").click()
    page.wait_for_function("() => true")
    for _ in range(50):
        if fake.courses_added:
            break
        page.wait_for_timeout(100)
    assert fake.courses_added and fake.courses_added[0]["layoutName"] == "Wing Loop" and fake.courses_added[0]["venueId"] == "thruxton", fake.courses_added


def test_a_different_layout_in_a_file_with_no_line_offers_the_line_found_to_confirm(page):
    _thruxton_with_a_second_layout(page)
    text = FIXTURE.read_bytes().decode("latin1")
    import re as _re
    text = _re.sub(r"\[laptiming\]\r?\n[^\r\n]*\r?\n", "", text)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", files=[{"name": "RaceBox_Track_Session.vbo", "mimeType": "text/plain", "buffer": text.encode("latin1")}])
    expect(page.locator("#tp-layout-field")).to_be_visible()
    page.locator("#tp-layout-field [data-v='__new']").click()
    # The line found from the laps is on the map with its markers, and has to be confirmed before it is used.
    expect(page.locator("#tp-tap")).to_be_attached()
    expect(page.locator(".tp-confirm")).to_be_visible()
    expect(page.locator("#tp-layout-field")).to_contain_text("We found the line from your laps")
    page.locator(".tp-confirm").click()
    expect(page.locator("#tp-addnow-box")).to_contain_text("This layout at Thruxton is not in the MT3UK track list yet")


def test_adding_a_layout_does_not_carry_over_to_the_next_file(page):
    """The layout pick, its name and the add switch belong to the file they were set for."""
    _thruxton_with_a_second_layout(page)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("#tp-layout-field [data-v='__new']").click()
    page.locator("#tp-addnow").click()
    page.fill("#tp-layout-name", "Wing Loop")
    expect(page.locator("#tp-addnow")).to_have_attribute("aria-checked", "true")
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-layout-field .chip.is-on")).to_have_text("Thruxton")
    expect(page.locator("#tp-layout-name")).to_have_count(0)
    expect(page.locator("#tp-addnow")).to_have_count(0)


def test_a_new_layout_cannot_be_given_the_name_of_one_that_is_listed(page):
    _thruxton_with_a_second_layout(page)
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("#tp-layout-field [data-v='__new']").click()
    page.locator("#tp-addnow").click()
    page.fill("#tp-layout-name", "short circuit")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-layout-name")).to_have_attribute("aria-invalid", "true")
    expect(page.locator("#tp-status")).to_contain_text("already listed")
    assert fake.courses_added == []


def test_adding_a_layout_with_several_files_sends_no_second_request_and_times_each_on_it(page, tmp_path):
    """Several files re-time each one at save. With a layout just added, each is timed on it, and the admin is not sent a
    second 'layout not recognised' request (approving that added a layout named after the circuit)."""
    _thruxton_with_a_second_layout(page)
    fake = FakeWorker(earlier=False)
    open_page(page, fake)
    a, b = tmp_path / "RaceBox Track Session one.vbo", tmp_path / "RaceBox Track Session two.vbo"
    a.write_bytes(FIXTURE.read_bytes())
    b.write_bytes(FIXTURE.read_bytes())
    page.get_by_role("link", name="Add a session", exact=True).click()
    page.set_input_files("#tp-file", [str(a), str(b)])
    page.locator("#tp-layout-field [data-v='__new']").click()
    page.locator("#tp-addnow").click()
    page.fill("#tp-layout-name", "Wing Loop")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-saved")).to_contain_text("2 sessions saved")
    assert len(fake.courses_added) == 1 and fake.courses_added[0]["layoutName"] == "Wing Loop", fake.courses_added
    assert fake.requests == [], fake.requests
    assert all(x["session"].get("layoutId") == "wing-loop" for x in fake.saved), [x["session"].get("layoutId") for x in fake.saved]


def test_more_sessions_can_be_added_to_a_day_from_the_day_and_from_a_session(page):
    fake = FakeWorker(earlier=False)
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    # From the session itself.
    expect(page.locator("#settings [data-day-add]")).to_have_text("Add another session from this day")
    page.go_back()
    into_track(page, "Thruxton")
    # From the day at the track.
    page.locator(".tp-daygroup [data-day-add]").click()
    expect(page).to_have_url(re.compile(r"add=1&car=car1&day=2026-05-28&layout=main"))
    expect(page.locator("#tp-day-intro")).to_contain_text("Adding another session to")
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-day-hint")).to_contain_text("Adding a session to")
    expect(page.locator("#tp-day-hint")).not_to_have_class(re.compile("is-warn"))
    expect(page.locator("#tp-date")).to_have_value("2026-05-28")


def test_a_session_added_to_a_day_starts_on_that_days_layout(page):
    _thruxton_with_a_second_layout(page)
    open_page(page, FakeWorker(earlier=False), path="/track.html?add=1&car=car1&day=2026-05-28&layout=short")
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-layout-field .chip.is-on")).to_have_text("Short Circuit")
    expect(page.locator("#tp-result .tp-notice.is-ok").first).to_contain_text("Short Circuit")
    # The member can still pick another layout.
    page.locator("#tp-layout-field .chip").first.click()
    expect(page.locator("#tp-layout-field .chip.is-on")).to_have_text("Thruxton")


def test_a_file_from_another_day_keeps_its_own_date_and_says_so(page):
    open_page(page, FakeWorker(earlier=False), path="/track.html?add=1&car=car1&day=2026-05-01")
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-day-hint")).to_have_class(re.compile("is-warn"))
    expect(page.locator("#tp-day-hint")).to_contain_text("This file is from")
    expect(page.locator("#tp-date")).to_have_value("2026-05-28")


def test_add_a_session_from_the_racebox_file(page):
    fake = FakeWorker()
    open_page(page, fake)
    expect(page.locator("#tp-lb-pill")).to_have_attribute("href", "leaderboards.html")
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    notice = page.locator("#tp-result .tp-notice.is-ok")
    expect(notice).to_contain_text("Thruxton")
    expect(notice).to_contain_text(re.compile(r"2 timed laps, best 1:39\.79"))
    # Air temperature filled in from Open-Meteo, and said so.
    expect(page.locator("#tp-temp")).to_have_value("19")
    expect(page.locator("#tp-temp-src")).to_contain_text("Open-Meteo weather for Thruxton at 14:00: 19°C, no rain")
    expect(page.locator("#tp-temp-src a")).to_have_attribute("href", "https://open-meteo.com/")
    # Wind in the chosen unit, and switching units keeps the upload.
    expect(page.locator("#tp-temp-src")).to_contain_text("wind 7 mph")
    tyre_model(page, "tp-tyre", "Cup 2")
    page.locator(".tp-head [data-units]").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"2 timed laps, best 1:39\.79"))
    expect(page.locator("#tp-temp-src")).to_contain_text("wind 12 km/h")
    expect(page.locator("#tp-tyre-model")).to_have_value("Cup 2")
    expect(page.locator("#tp-temp")).to_have_value("19")
    page.locator(".tp-head [data-units]").click()
    expect(page.locator("#tp-temp-src")).to_contain_text("wind 7 mph")
    expect(page.locator("[data-cond] [data-v='Dry']")).to_have_class(re.compile("is-on"))
    tyre_model(page, "tp-tyre", "Pilot Sport 4S")
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
    expect(page.locator(".tp-tile.is-hero .v")).to_have_text(re.compile(r"1:39\.79"))
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
    # Speed key runs yellow (slow) through amber to red (fast), which shows on grass and tarmac.
    expect(page.locator(".tp-ramp i").first).to_have_css("background-image", re.compile(r"rgb\(255, 216, 61\).*rgb\(245, 138, 31\).*rgb\(215, 25, 28\)"))
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
    expect(page.locator(".tv-tip")).to_contain_text("L2")
    expect(page.locator("#tp-corners tbody tr").first).to_be_visible()
    # Over time, with the coilovers fitted between the two sessions.
    expect(page.locator("#tp-timeline circle").first).to_be_attached()
    expect(page.locator("#tp-timeline")).to_contain_text("Coilovers: KW V3")
    expect(page.locator('[data-tile="overtime-notes"] .tp-notes')).to_contain_text("after Coilovers: KW V3 was fitted")
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
    expect(row).to_contain_text(re.compile(r"1:39\.79"))
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


def test_a_public_note_is_shown_to_everyone_and_the_private_notes_only_to_the_owner(page, tmp_path):
    fake = FakeWorker()
    open_page(page, fake, "/track.html?add=1")
    f = tmp_path / "RaceBox Track Session.vbo"
    f.write_bytes(FIXTURE.read_bytes())
    page.set_input_files("#tp-file", str(f))
    page.locator("#tp-result").wait_for()
    # Two boxes on the Add page: the private notes and a public note.
    expect(page.locator("label[for=tp-notes]")).to_have_text("Private notes (only you see these)")
    expect(page.locator("#tp-public-note")).to_have_attribute("maxlength", "140")
    page.fill("#tp-notes", "pressures 38 cold")
    page.fill("#tp-public-note", "Red flag mid-session")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    assert fake.saved[-1]["publicNote"] == "Red flag mid-session" and fake.saved[-1]["notes"] == "pressures 38 cold"
    # The public note sits under the heading for the owner, and Session settings has both boxes.
    expect(page.locator("#tp-public-note-line")).to_have_text("Red flag mid-session")
    expect(page.locator("#tp-e-public-note")).to_have_value("Red flag mid-session")
    page.fill("#tp-e-public-note", "New tyres today")
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator("#tp-status")).to_contain_text("Saved")
    assert fake.sessions["new1"]["publicNote"] == "New tyres today"
    expect(page.locator("#tp-public-note-line")).to_have_text("New tyres today")
    # Cleared, it goes.
    page.fill("#tp-e-public-note", "")
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator("#tp-status")).to_contain_text("Saved")
    expect(page.locator("#tp-public-note-line")).to_have_count(0)
    # Another member sees the public note, and nothing of the private notes (the worker leaves them out).
    shown = {k: v for k, v in fake.sessions["new1"].items() if k != "notes"}
    page.route("**/track/session?id=new1", lambda route: route.fulfill(
        status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
        body=json.dumps({"success": True, "session": dict(shown, mine=False, car="Blue Y", ownerName="Ann", publicNote="First time here")})))
    page.goto("/track.html?s=new1")
    expect(page.locator("#tp-public-note-line")).to_have_text("First time here")
    expect(page.locator("#tp-e-notes, #tp-e-public-note")).to_have_count(0)
    expect(page.locator("#tp-app, main").first).not_to_contain_text("pressures 38 cold")


def tyre_model(page, pre, model):
    """The tyre Model is a drop-down of the make's models with Other model, type it in: pick the model, or choose Other and type it."""
    pick = page.locator("#%s-model-pick" % pre)
    if pick.is_visible():
        if model in pick.locator("option").evaluate_all("els => els.map(e => e.value)"):
            pick.select_option(model)
            return
        pick.select_option("__other")
    page.fill("#%s-model" % pre, model)


def day_session(sid, time, best, laps, date="2026-07-14", venue="Castle Combe", venue_id="castle-combe"):
    return {"id": sid, "carId": "car1", "type": "track", "venueId": venue_id, "venue": venue, "layoutId": "main", "layout": venue, "date": date, "time": time,
            "privacy": "private", "conditions": "Dry", "bestTime": best, "laps": [{"n": i + 1, "time": best} for i in range(laps)], "vmax": 150}


def into_track(page, name):
    """To a track's own page. The main list no longer links to it (a track's row only steps down to its layouts), so go by the address."""
    key = page.locator("#tp-sess-list .tp-trackrow", has_text=name).get_attribute("data-track-toggle")
    page.goto("/track.html?mycar=car1&at=" + quote(key, safe=""))
    expect(page.locator(".tp-head h2")).to_have_text(name)


def test_sessions_at_the_same_track_on_the_same_day_are_grouped_by_time(page):
    fake = FakeWorker(earlier=False)
    day = [day_session("d21", "14:46", 87.71, 4), day_session("d12", "11:29", 81.17, 5), day_session("d07", "09:25", 89.17, 3)]
    other = [day_session("e01", "10:00", 99.0, 4, date="2026-06-01", venue="Thruxton", venue_id="thruxton")]
    for s in day + other:
        fake.sessions[s["id"]] = dict(s)
        fake.index.append(summary(s))
    open_page(page, fake)
    into_track(page, "Castle Combe")
    card = page.locator(".tp-daygroup", has_text="Castle Combe")
    expect(card).to_have_count(1)
    expect(card.locator("h3")).to_have_text("14 Jul 2026 on Castle Combe")
    expect(card.locator(".tp-daygroup-count .tp-small")).to_have_text("3 sessions")
    # Collapsed: only the fastest session of the day shows, with its place in the day.
    expect(card).to_have_attribute("data-open", "false")
    expect(card.locator(".tp-daygroup-label")).to_contain_text("Fastest session of the day")
    best = card.locator(".tp-daygroup-best .tp-row")
    expect(best).to_have_count(1)
    expect(best).to_contain_text("#2")
    expect(best).to_contain_text("11:29")
    expect(best).to_contain_text("1:21.17")
    expect(card.locator(".tp-daygroup-all")).to_be_hidden()
    # The result and the Shared pill sit on the time's line, not under it; the count is not a button at the top.
    tb, rb = best.locator(".tp-row-main b").first.bounding_box(), best.locator(".tp-row-res").bounding_box()
    assert abs((tb["y"] + tb["height"] / 2) - (rb["y"] + rb["height"] / 2)) < 8, (tb, rb)
    expect(card.locator("button.tp-daygroup-count")).to_have_count(0)
    # The chevron on the fastest row opens the day: every session in time of day order, numbered, the fastest marked.
    best.locator(".tp-day-expand").click()
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
    # Opening one says where it falls in the day.
    card.locator(".tp-daygroup-title").click()
    rows.nth(1).click()
    expect(page.locator("#tp-day-place")).to_have_text("Session 2 of 3 that day")
    # Phone: no sideways scroll.
    page.set_viewport_size({"width": 390, "height": 844})
    page.go_back()
    expect(page.locator(".tp-daygroup").first).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_a_session_on_its_own_gets_the_same_card_as_a_day(page):
    fake = FakeWorker(earlier=False)
    s = day_session("solo2", "10:00", 99.0, 4, date="2026-06-01", venue="Thruxton", venue_id="thruxton")
    fake.sessions[s["id"]] = dict(s)
    fake.index.append(summary(s))
    open_page(page, fake)
    into_track(page, "Thruxton")
    solo = page.locator(".tp-daygroup")
    expect(solo).to_have_count(1)
    expect(solo.locator("h3")).to_have_text("1 Jun 2026 on Thruxton")
    expect(solo.locator(".tp-daygroup-count .tp-small")).to_have_text("1 session")
    expect(solo).to_have_attribute("data-open", "true")
    expect(solo.locator(".tp-daygroup-best")).to_be_hidden()
    expect(solo.locator(".tp-daygroup-all .tp-row")).to_have_count(1)
    expect(solo.locator(".tp-fastest")).to_have_count(0)
    expect(solo.get_by_role("button", name="Delete this session")).to_be_visible()


def test_a_lone_session_has_no_day_number(page):
    fake = FakeWorker(earlier=False)
    s = day_session("solo1", "10:00", 90.0, 4)
    fake.sessions[s["id"]] = dict(s)
    fake.index.append(summary(s))
    open_page(page, fake)
    into_track(page, "Castle Combe")
    expect(page.locator(".tp-daygroup")).to_have_count(1)
    expect(page.locator(".tp-daygroup .tp-daygroup-count .tp-small")).to_have_text("1 session")
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


def test_the_welcome_card_takes_the_admins_words_when_set(page):
    fake = FakeWorker()
    fake.copy = {"heading": "Lap times for every MT3UK car", "bullets": ["One", "Two <b>x</b>"]}
    open_page(page, fake, signed_in=False)
    card = page.locator(".tp-intro")
    expect(card.locator("h2")).to_have_text("Lap times for every MT3UK car")
    # The paragraph was not set, so the built-in one stays; the list is the admin's, shown as text.
    expect(card.locator("p").first).to_contain_text("Upload the file from your lap timer")
    expect(card.locator(".tp-ticks li")).to_have_text(["One", "Two <b>x</b>"])


def test_the_upload_tip_shows_on_the_leaderboard_and_sessions_and_folds(page):
    """On the Leaderboard and the member's Sessions page the tip is a light bulb in the navy heading, by Add a
    session, that opens the tip under it.
    The admin's words show when set, and the switch hides it."""
    fake = FakeWorker()
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    tip = page.locator(".lb-hero #laps-tip")
    bulb = tip.locator(".laps-tip-bulbbtn")
    expect(bulb).to_be_visible()
    expect(bulb).to_have_attribute("aria-label", "Tip: the more you upload, the more the board tells you")
    expect(page.locator("#lb-app #laps-tip")).to_have_count(0)
    # It starts shut, just the bulb, beside Add a session.
    expect(tip.locator(".laps-tip-body")).to_be_hidden()
    a, k = page.locator("#lb-add-session").bounding_box(), bulb.bounding_box()
    # On desktop it sits beside Add a session, at the right, on the What is the Leaderboard? row.
    assert k["x"] >= a["x"] + a["width"] and abs((k["y"] + k["height"] / 2) - (a["y"] + a["height"] / 2)) < 6
    bulb.click()
    expect(bulb).to_have_attribute("aria-expanded", "true")
    expect(tip.locator(".laps-tip-body b")).to_have_text("Tip: the more you upload, the more the board tells you")
    expect(tip.locator(".laps-tip-body")).to_be_visible()
    assert tip.locator(".laps-tip-body").bounding_box()["y"] > k["y"] + k["height"] - 2
    # Add a session is right beside it, so the tip has no button of its own.
    expect(tip.locator(".laps-tip-body .btn")).to_have_count(0)
    bulb.click()
    expect(tip.locator(".laps-tip-body")).to_be_hidden()
    # Sessions has the same bulb, beside its Add a session in the heading.
    open_page(page, fake, "/track.html", signed_in=True)
    tip = page.locator(".page-hero #laps-tip")
    expect(tip.locator(".laps-tip-bulbbtn")).to_be_visible()
    expect(page.locator("#tp-app #laps-tip")).to_have_count(0)
    expect(tip.locator(".laps-tip-body")).to_be_hidden()
    tip.locator(".laps-tip-bulbbtn").click()
    expect(tip.locator(".laps-tip-body")).to_be_visible()
    expect(tip.locator(".laps-tip-body .btn")).to_have_count(0)
    # The admin's words, and the switch that hides it.
    fake.copy = {"tipHeading": "Keep uploading", "tipText": "More <b>data</b>, better boards."}
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    page.locator("#laps-tip .laps-tip-bulbbtn").click()
    expect(page.locator("#laps-tip .laps-tip-body b")).to_have_text("Keep uploading")
    expect(page.locator("#laps-tip .laps-tip-body p")).to_have_text("More <b>data</b>, better boards.")
    fake.copy = {"tipOff": True}
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    page.locator(".lb-venue").first.wait_for()
    expect(page.locator("#laps-tip")).to_have_count(0)


def test_the_track_share_link_carries_the_week_and_the_picture_sets_version(page):
    """A Track sessions share link ends with the ISO week and, when the admin has changed the preview pictures,
    the set's version, so chat apps treat it as a new address and fetch a fresh card."""
    fake = FakeWorker()
    fake.shareVersion = 7
    page.add_init_script("window.__shared = []; navigator.share = function (d) { window.__shared.push(d); return Promise.resolve(); };")
    open_page(page, fake, signed_in=False)
    page.wait_for_timeout(400)
    page.locator("h1 .mt3uk-share-dot").click()
    page.wait_for_timeout(300)
    url = page.evaluate("() => window.__shared.length ? window.__shared.pop().url : (document.querySelector('.mt3uk-share-pop [data-channel=facebook]') ? new URL(document.querySelector('.mt3uk-share-pop [data-channel=facebook]').href).searchParams.get('u') : null)")
    assert url and url.startswith("https://laps.mt3uk.com/share/section/track.html?") and "utm_campaign=page_track" in url, url
    assert re.search(r"&w=\d{4}-W\d{2}\.7$", url), url


def test_uploading_the_same_file_again_is_refused_and_says_which_session_it_is(page):
    fake = FakeWorker()
    fake.dupes = True
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-saved")).to_be_visible()
    page.goto("/track.html")
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    status = page.locator("#tp-status")
    expect(status).to_contain_text("You already have this session: Thruxton, 2026-05-28 at 14:34")
    expect(status).to_have_class(re.compile("is-error"))
    # Nothing was saved twice, and the button is live again for the member to go back.
    assert len(fake.saved) == 1
    expect(page.get_by_role("button", name="Save session")).to_be_enabled()


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
    # The list is open to them: the track, its layout and the day dropped down, both sessions in view.
    expect(page.locator("#tp-sess-list .tp-daygroup")).to_have_count(1)
    expect(page.locator("#tp-sess-list .tp-daygroup")).to_have_attribute("data-open", "true")
    expect(page.locator("#tp-sess-list .tp-daygroup-all .tp-row")).to_have_count(2)
    expect(page.locator("#tp-sess-list .tp-daygroup-all .tp-row").first).to_be_visible()
    assert len(fake.saved) == 2
    assert sorted(x["session"]["fileName"] for x in fake.saved) == ["RaceBox Track Session one.vbo", "RaceBox Track Session two.vbo"]
    assert all(not x["session"].get("runs") or isinstance(x["session"]["runs"], list) for x in fake.saved)
    # Each is its own session, grouped on the day at that track's page.
    into_track(page, "Thruxton")
    expect(page.locator(".tp-daygroup")).to_have_count(1)
    expect(page.locator(".tp-daygroup-count .tp-small")).to_have_text("2 sessions")


def test_edit_every_session_on_a_day_at_once(page):
    """A day's card has Edit all N sessions: a form for the conditions, the air temperature, the tyres, the brake pads and
    the logger that applies to every session of that day, for when they were left off or set wrong on each file. Anything
    left blank stays as it is."""
    fake = FakeWorker(earlier=False)
    for sid, t, best in (("g1", "09:25", 89.1), ("g2", "11:29", 81.1), ("g3", "14:46", 87.7)):
        rec = day_session(sid, t, best, 3)
        rec["tyres"] = "Old tyres"
        rec["origin"] = [51.492, -2.215]
        fake.sessions[sid] = dict(rec)
        fake.index.append(summary(rec))
    open_page(page, fake)
    into_track(page, "Castle Combe")
    page.locator("[data-day-edit]").click()
    form = page.locator("#tp-dayedit")
    expect(form).to_be_visible()
    expect(form.locator("h3")).to_contain_text("Edit all 3 sessions")
    # Nothing set: it says so and changes nothing.
    form.locator("[data-day-edit-apply]").click()
    expect(page.locator("#tp-de-status")).to_contain_text("Set at least one thing")
    assert all(v["conditions"] == "Dry" for v in fake.sessions.values())
    # Fill in from weather: the temperature and the conditions from Open-Meteo for the track that day.
    form.get_by_role("button", name="Fill in from weather").click()
    expect(page.locator("#tp-de-temp")).to_have_value("19")
    expect(page.locator("#tp-de-src")).to_contain_text("Open-Meteo")
    expect(form.locator("[data-cond] button.is-on")).to_have_attribute("data-v", "Dry")
    # Then Wet, 12 degrees and the logger by hand, tyres left alone.
    form.locator("[data-cond] button[data-v='Wet']").click()
    page.fill("#tp-de-temp", "12")
    page.select_option("#tp-de-logger", "RaceBox")
    form.locator("[data-day-edit-apply]").click()
    expect(page.locator("#tp-saved")).to_contain_text("All 3 sessions at 14 Jul 2026 at Castle Combe are updated")
    assert all(v["conditions"] == "Wet" and v["temp"] == 12 and v["logger"] == "RaceBox" and v["tyres"] == "Old tyres" for v in fake.sessions.values()), fake.sessions
    expect(page.locator("#tp-dayedit")).to_have_count(0)
    # The tyres only change when the switch is on.
    page.locator("[data-day-edit]").click()
    page.locator("#tp-de-tyres-on").click()
    expect(page.locator("#tp-de-tyres")).to_be_visible()
    page.select_option("#tp-de-tyre-make", "Michelin")
    tyre_model(page, "tp-de-tyre", "Pilot Sport 4S")
    page.locator("#tp-saved-x").click()
    page.locator("[data-day-edit-apply]").click()
    expect(page.locator("#tp-saved")).to_contain_text("are updated")
    expect(page.locator("#tp-dayedit")).to_have_count(0)
    assert all(v.get("tyreMake") == "Michelin" and v.get("tyreModel") == "Pilot Sport 4S" and v["conditions"] == "Wet" for v in fake.sessions.values()), fake.sessions


def test_the_sessions_list_can_be_filtered_by_logger_tyres_and_pads(page):
    """Drop-downs beside Sort by filter the member's sessions by the logger, the tyres and the pads they carry, each
    value with its count. While a filter is on every track, layout and day is open, so the matching sessions are in
    view, a line says how many match, and Clear puts the whole list back."""
    fake = FakeWorker(earlier=False)
    specs = [("f1", "Thruxton", "thruxton", "2026-05-01", "RaceBox", "Michelin Pilot Sport 4S", "Pagid RSL29"),
             ("f2", "Thruxton", "thruxton", "2026-05-01", "VBOX", "Michelin Pilot Sport 4S", "Original equipment pads"),
             ("f3", "Castle Combe", "castle-combe", "2026-06-02", "RaceBox", "Nankang CR-S", "Pagid RSL29")]
    for sid, venue, vid, date, logger, tyres, pads in specs:
        r = dict(day_session(sid, "10:00", 95.0, 3, date=date, venue=venue, venue_id=vid), logger=logger, tyres=tyres, pads=pads)
        fake.sessions[sid] = dict(r)
        fake.index.append(summary(r))
    open_page(page, fake)
    logger = page.locator("#tp-filter-logger")
    # Always shown, even with one value or none, and sessions without one are a choice of their own.
    expect(logger.locator("option")).to_have_text(["All loggers", "RaceBox (2)", "VBOX (1)"])
    expect(page.locator("#tp-filter-tyres option")).to_have_text(["All tyres", "Michelin Pilot Sport 4S (2)", "Nankang CR-S (1)"])
    expect(page.locator("#tp-filter-pads option")).to_have_text(["All pads", "Original equipment pads (1)", "Pagid RSL29 (2)"])
    expect(page.locator("#tp-sess-list .tp-trackwrap")).to_have_count(2)
    expect(page.locator("#tp-sess-list .tp-layouts").first).to_be_hidden()
    # By logger: the two RaceBox sessions, both tracks open down to the rows.
    logger.select_option("VBOX")
    expect(page.locator("#tp-filter-note")).to_contain_text("Showing 1 of 3 sessions")
    expect(page.locator("#tp-sess-list .tp-trackwrap")).to_have_count(1)
    expect(page.locator("#tp-sess-list .tp-row[data-sid]")).to_have_count(1)
    expect(page.locator("#tp-sess-list .tp-daygroup").first).to_be_visible()
    expect(page.locator("#tp-sess-list .tp-day-sub").first).to_contain_text("1 session")
    expect(page.locator('#tp-sess-list .tp-row[data-sid="f2"]')).to_have_count(1)
    # The tracks and layouts are open down to the days; a day with several matching sessions stays closed.
    expect(page.locator("#tp-sess-list .tp-daygroup").first).to_be_visible()
    # Several matching sessions on one day: the day card stays closed (the day and its fastest), not fully expanded.
    page.locator("#tp-filter-logger").select_option("")
    page.locator("#tp-filter-tyres").select_option("Michelin Pilot Sport 4S")
    expect(page.locator("#tp-sess-list .tp-daygroup")).to_have_count(1)
    expect(page.locator("#tp-sess-list .tp-daygroup")).to_have_attribute("data-open", "false")
    expect(page.locator("#tp-sess-list .tp-daygroup-all")).to_be_hidden()
    expect(page.locator("#tp-sess-list .tp-day-sub")).to_contain_text("fastest")
    page.locator("#tp-filter-tyres").select_option("")
    page.locator("#tp-filter-logger").select_option("VBOX")
    # Two filters together.
    page.locator("#tp-filter-logger").select_option("RaceBox")
    page.locator("#tp-filter-pads").select_option("Pagid RSL29")
    expect(page.locator("#tp-filter-note")).to_contain_text("Showing 2 of 3 sessions")
    expect(page.locator("#tp-sess-list .tp-row[data-sid]")).to_have_count(2)
    page.locator("#tp-filter-tyres").select_option("Nankang CR-S")
    expect(page.locator("#tp-filter-note")).to_contain_text("Showing 1 of 3 sessions")
    # Sessions with no logger are found under Not set.
    page.locator("#tp-filter-clear").click()
    fake.sessions["f3"].pop("logger"); fake.index = [dict(x, logger=None) if x["id"] == "f3" else x for x in fake.index]
    page.reload()
    expect(page.locator("#tp-filter-logger option")).to_have_text(["All loggers", "RaceBox (1)", "VBOX (1)", "Not set (1)"])
    page.locator("#tp-filter-logger").select_option("__none")
    expect(page.locator("#tp-filter-note")).to_contain_text("Showing 1 of 3 sessions")
    expect(page.locator('#tp-sess-list .tp-row[data-sid="f3"]')).to_have_count(1)
    page.locator("#tp-filter-clear").click()
    page.locator("#tp-filter-logger").select_option("RaceBox")
    # Clear puts everything back, folded.
    page.locator("#tp-filter-clear").click()
    expect(page.locator("#tp-filter-note")).to_have_count(0)
    expect(page.locator("#tp-sess-list .tp-trackwrap")).to_have_count(2)
    expect(page.locator("#tp-sess-list .tp-layouts").first).to_be_hidden()


def test_share_every_session_on_a_day_from_its_group(page):
    fake = FakeWorker(earlier=False)
    for sid, t, best in (("g1", "09:25", 89.1), ("g2", "11:29", 81.1), ("g3", "14:46", 87.7)):
        rec = day_session(sid, t, best, 3)
        fake.sessions[sid] = dict(rec)
        fake.index.append(summary(rec))
    open_page(page, fake)
    into_track(page, "Castle Combe")
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
    into_track(page, "Thruxton")
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
    into_track(page, "Castle Combe")
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
    into_track(page, "Castle Combe")
    expect(page.locator(".tp-daygroup")).to_have_count(1)
    expect(page.locator(".tp-daygroup-charge")).to_have_count(0)


def test_a_drive_with_no_day_group_is_listed_on_its_own(page):
    fake = FakeWorker(earlier=False)
    drive = {"id": "dr9", "carId": "car1", "type": "other", "venue": "Drive", "date": "2026-07-14", "time": "10:00", "privacy": "private", "vmax": 100, "soc": [86.9, 85.2], "quality": "good"}
    fake.sessions["dr9"] = dict(drive)
    fake.index.append(summary(drive))
    open_page(page, fake)
    expect(page.locator(".tp-daygroup")).to_have_count(0)
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(1)
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_contain_text("Drive")


def test_a_lap_in_a_file_with_no_time_stamps_is_timed(page):
    fake = FakeWorker(earlier=False)
    open_page(page, fake)
    page.get_by_role("link", name="Add a session", exact=True).click()
    lap = (ROOT / "tests" / "fixtures" / "tesla-track-mode-no-timestamps-lap.csv").read_bytes()
    page.set_input_files("#tp-file", files=[{"name": "telemetry-v1-2024-02-23-15_10_30.csv", "mimeType": "text/csv", "buffer": lap}])
    expect(page.locator(".tp-file-list")).to_contain_text("No time stamps in this file")
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"1 timed lap, best 1:4[5-7]\.\d"))
    page.fill("#tp-venue-name", "Test track")
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
    into_track(page, "Castle Combe")
    day = page.locator(".tp-daygroup", has_text="Castle Combe")
    day.locator(".tp-daygroup-title").click()
    # It asks first, naming how many and which day; Cancel deletes nothing.
    messages = []
    page.once("dialog", lambda d: (messages.append(d.message), d.dismiss()))
    day.locator("[data-day-delete]").click()
    assert messages and "Confirm delete?" in messages[0] and "all 4 sessions for this day (Castle Combe - 14 Jul 2026)" in messages[0]
    assert len(fake.sessions) == 5
    # Accepting deletes the day and its drives, and nothing from another day.
    page.once("dialog", lambda d: d.accept())
    day.locator("[data-day-delete]").click()
    expect(page.locator("#tp-saved")).to_contain_text("Deleted all 4 sessions for this day (Castle Combe - 14 Jul 2026)")
    assert sorted(fake.sessions) == ["keep1"]
    # Nothing is left at Castle Combe, so it is back on the list, which has the Thruxton session.
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(1)
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_contain_text("Thruxton")


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
    assert any("14:00" in t and "1:31.20" in t for t in texts) and any("09:00" in t and "1:30.00" in t for t in texts), texts


def test_a_lap_from_a_session_with_its_own_start_line_is_turned_to_start_on_this_one(page):
    """Two sessions at a track with no official line each found their own. Compared,
    the other session's lap is turned to start where this session's line is, so the
    two laps line up round the circuit."""
    fake = FakeWorker(earlier=False)
    # A square 400 m a side, driven from (0, 0): speeds 100, 120, 140, 160 km/h at its corners.
    loop = [[0, 0, 0, 0, 100, 0, 0], [400, 10, 400, 0, 120, 0, 0], [800, 20, 400, 400, 140, 0, 0], [1200, 30, 0, 400, 160, 0, 0], [1600, 40, 0, 0, 100, 0, 0]]
    for sid, tm, line in (("v1", "11:00", [[51.00361859960196, -0.994290277653375], [51.00361859960196, -0.9943]]), ("v2", "14:00", [[51.0, -1.0], [51.0, -1.0001]])):
        rec = day_session(sid, tm, 40.0, 1, venue="Unknown track")
        rec.pop("venueId", None)
        rec.pop("layoutId", None)
        rec["origin"] = [51.0, -1.0]
        rec["startLine"] = line
        rec["autoLine"] = True
        rec["trace"] = {"hz": 5, "laps": {"1": [list(r) for r in loop]}}
        rec["best"] = 1
        fake.sessions[sid] = dict(rec)
        fake.index.append(dict(summary(rec), origin=rec["origin"]))
    # v1's line is at the far corner (400, 400); v2's is at (0, 0), where both traces begin.
    open_page(page, fake, path="/track.html?s=v1")
    page.locator("#tp-cmp-b").select_option("x:v2")
    expect(page.locator("#tp-speed path")).to_have_count(2)
    page.locator("#tp-speed").scroll_into_view_if_needed()
    box = page.locator("#tp-speed").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.12, box["y"] + box["height"] / 2)
    tip = page.locator(".tv-tip")
    # Early in the lap: A has left (0, 0) at 100 km/h (62 mph) and is building to 120; B, turned to start at v1's
    # line, has left the far corner at 140 km/h (87 mph) and is building to 160, not sitting at its own line.
    expect(tip).to_contain_text(re.compile(r"(6[2-9]|7[0-4]) mph"))
    expect(tip).to_contain_text(re.compile(r"(8[7-9]|9[0-9]) mph"))


def lap_row(d, t, v, la, lo):
    return [d, t, d * 0.1, 0, v, la, lo]


def car_lap_session(with_car=True):
    def car(a, b, pw):
        return {"soc": {"start": a, "end": b}, "power": {"max": pw}, "brakePressure": {"max": 30.0 + pw / 100}}
    laps = [
        {"n": 1, "start": 0, "time": 90.0, "dist": 2400, "vmax": 150.0, "kind": "timed", "sectors": [30.0, 30.0, 30.0]},
        {"n": 2, "start": 95, "time": 91.5, "dist": 2410, "vmax": 140.0, "kind": "timed", "sectors": [30.5, 30.5, 30.5]},
    ]
    if with_car:
        laps[0]["carData"] = car(80, 78, 300)
        laps[1]["carData"] = car(78, 75, 340)
    trace = {"1": [lap_row(0, 0, 100, 0.2, 0.1), lap_row(500, 20, 150, 0.8, -0.9), lap_row(2400, 90, 110, 0.3, 0.2)],
             "2": [lap_row(0, 0, 100, 0.2, 0.1), lap_row(500, 20, 140, 1.1, -1.2), lap_row(2410, 91.5, 105, 0.3, 0.2)]}
    rec = {"id": "lp1", "carId": "car1", "type": "track", "venueId": "thruxton", "venue": "Thruxton", "layoutId": "main", "layout": "Thruxton", "date": "2026-05-28", "time": "14:34",
           "privacy": "private", "conditions": "Dry", "bestTime": 90.0, "best": 1, "possible": 89.5, "vmax": 150.0, "latMax": 1.1, "brakeMax": 1.2, "distance": 4810, "duration": 190,
           "hz": 25, "quality": "good", "laps": laps, "trace": {"hz": 5, "laps": trace}, "origin": [51.0, -1.0], "bestSectors": [30.0, 30.0, 30.0], "corners": []}
    if with_car:
        rec["carData"] = {"found": ["State of charge", "Power", "Brake pressure"], "empty": [], "soc": {"start": 80, "end": 75}, "power": {"max": 340}, "brakePressure": {"max": 33.4}}
    return rec


def test_choosing_a_lap_updates_the_tiles_and_the_track_mode_figures(page):
    fake = FakeWorker(earlier=False)
    rec = car_lap_session()
    fake.sessions["lp1"] = rec
    fake.index.append(summary(rec))
    open_page(page, fake, path="/track.html?s=lp1")
    tiles = page.locator("#tp-headline .tp-tile")
    # Whole session to begin with: the best lap, and the day's charge.
    expect(tiles.first).to_contain_text("Best lap")
    expect(tiles.first).to_contain_text("1:30.00")
    expect(page.locator("#car-data .tp-tile", has_text="Charge used")).to_contain_text("5%")
    # Lap 2: its own time, how far off the best, its own top speed and grip, and its own charge.
    page.locator("#tp-lap-pick").select_option("2")
    expect(tiles.first).to_contain_text("Lap time")
    expect(tiles.first).to_contain_text("1:31.50")
    expect(tiles.first).to_contain_text("+1.50 s on your best lap")
    expect(page.locator("#headline-top, #tp-headline .tp-tile", has_text="Most grip used")).to_contain_text("1.10 g")
    expect(page.locator("#tp-headline .tp-tile", has_text="Top speed")).to_contain_text(re.compile(r"87|140"))
    expect(page.locator("#car-data .tp-tile", has_text="Charge used")).to_contain_text("3%")
    expect(page.locator("#car-data .tp-tile", has_text="Peak power")).to_contain_text("340 kW")
    expect(page.locator("#tp-car-from")).to_contain_text("Lap 2")
    # Back to the whole session.
    page.locator("#tp-lap-pick").select_option("")
    expect(tiles.first).to_contain_text("Best lap")
    expect(page.locator("#car-data .tp-tile", has_text="Charge used")).to_contain_text("5%")


def test_a_lap_without_its_own_car_figures_says_so_and_shows_the_whole_session(page):
    fake = FakeWorker(earlier=False)
    rec = car_lap_session(with_car=True)
    for l in rec["laps"]:
        l.pop("carData")
    fake.sessions["lp1"] = rec
    fake.index.append(summary(rec))
    open_page(page, fake, path="/track.html?s=lp1")
    page.locator("#tp-lap-pick").select_option("1")
    expect(page.locator("#tp-car-from")).to_contain_text("this lap's own figures were not kept")
    expect(page.locator("#car-data .tp-tile", has_text="Charge used")).to_contain_text("5%")


def test_a_session_with_one_lap_still_offers_its_figures_against_the_whole_session(page):
    """One complete lap (an out lap and an in lap either side): the whole session's
    figures and the lap's own differ, so the picker is still shown."""
    fake = FakeWorker(earlier=False)
    rec = car_lap_session()
    rec["laps"] = rec["laps"][:1]
    rec["trace"]["laps"] = {"1": rec["trace"]["laps"]["1"]}
    fake.sessions["lp1"] = rec
    fake.index.append(summary(rec))
    open_page(page, fake, path="/track.html?s=lp1")
    pick = page.locator("#tp-lap-pick")
    expect(pick).to_be_visible()
    expect(pick.locator("option")).to_have_count(2)
    pick.select_option("1")
    expect(page.locator("#tp-headline .tp-tile").first).to_contain_text("Lap time")
    expect(page.locator("#car-data .tp-tile", has_text="Charge used")).to_contain_text("2%")


def test_the_figures_picker_lists_your_other_sessions_that_day_and_opens_one(page):
    """Under the laps, the other sessions at the same track that day, numbered by
    time of day as the list is. Choosing one opens it."""
    fake = FakeWorker(earlier=False)
    rec = car_lap_session()
    later = dict(rec, id="lp2", time="15:46", bestTime=86.063, laps=[dict(l) for l in rec["laps"]])
    earlier = dict(rec, id="lp0", time="10:51", bestTime=99.626, laps=[dict(l) for l in rec["laps"]])
    other_day = dict(rec, id="lp9", date="2026-05-29", time="11:00")
    for r in (rec, later, earlier, other_day):
        fake.sessions[r["id"]] = r
        fake.index.append(summary(r))
    open_page(page, fake, path="/track.html?s=lp1")
    group = page.locator("#tp-lap-pick optgroup")
    expect(group).to_have_attribute("label", "Your other sessions that day")
    opts = group.locator("option")
    expect(opts).to_have_count(2)
    expect(opts.nth(0)).to_have_text("Session 1, 10:51, 1:39.63")
    expect(opts.nth(1)).to_have_text("Session 3, 15:46, 1:26.06")
    page.locator("#tp-lap-pick").select_option("x:lp2")
    expect(page).to_have_url(re.compile(r"track\.html\?s=lp2"))
    expect(page.locator("#tp-day-place")).to_have_text("Session 3 of 3 that day")


def test_the_track_mode_card_stays_open_from_one_session_to_the_next(page):
    """Opened once, the Track Mode and Laps cards stay open on the next session
    picked, and after a reload, instead of folding away each time."""
    fake = FakeWorker(earlier=False)
    rec = car_lap_session()
    later = dict(rec, id="lp2", time="15:46", bestTime=86.063, laps=[dict(l) for l in rec["laps"]])
    for r in (rec, later):
        fake.sessions[r["id"]] = r
        fake.index.append(summary(r))
    open_page(page, fake, path="/track.html?s=lp1")
    car, laps = page.locator("#car-data"), page.locator("#tp-laps")
    expect(car).not_to_have_attribute("open", re.compile(".*"))
    car.locator("summary").click()
    laps.locator("summary").click()
    expect(car).to_have_attribute("open", "")
    page.locator("#tp-lap-pick").select_option("x:lp2")
    expect(page).to_have_url(re.compile(r"track\.html\?s=lp2"))
    expect(page.locator("#car-data")).to_have_attribute("open", "")
    expect(page.locator("#tp-laps")).to_have_attribute("open", "")
    page.reload()
    expect(page.locator("#car-data")).to_have_attribute("open", "")
    # Closed again, it stays closed.
    page.locator("#car-data summary").click()
    page.locator("#tp-lap-pick").select_option("x:lp1")
    expect(page).to_have_url(re.compile(r"track\.html\?s=lp1"))
    expect(page.locator("#car-data")).not_to_have_attribute("open", re.compile(".*"))


def test_the_leaderboard_hero_matches_the_sessions_page(page):
    """The Leaderboard heading carries the trophy, the intro folds behind What is the Leaderboard? as on the Sessions
    page, and the list and each board have the same Refresh button as My Sessions."""
    fake = FakeWorker()
    fake.boards = {"/track/board:thruxton:main": [board_row("car1", "a1", 100)]}
    open_page(page, fake, path="/leaderboards.html")
    expect(page.locator(".lb-hero h1")).to_have_text("Leaderboard")
    expect(page.locator(".lb-hero h1 svg.lb-trophy")).to_have_count(1)
    fold = page.locator("#lb-what")
    expect(fold).not_to_have_attribute("open", re.compile(".*"))
    expect(fold.locator("summary")).to_have_text("What is the Leaderboard?")
    expect(fold.locator("p")).not_to_be_visible()
    fold.locator("summary").click()
    expect(fold.locator("p")).to_be_visible()
    expect(fold.locator("p")).to_contain_text("Real times from EVs on tracks, drag strips and hill climbs")
    # Refresh on the list: fetches the page's own script again and reloads on the same view.
    expect(page.locator(".tp-board-card").first).to_be_visible()
    seen = []
    page.on("request", lambda r: seen.append(r.url))
    with page.expect_navigation():
        page.get_by_role("button", name="Refresh this page from the latest version").click()
    expect(page.locator(".tp-board-card").first).to_be_visible()
    assert any(u.split("?")[0].endswith("/js/leaderboard-page.js") for u in seen), seen[:10]
    # And on a board, where the trophy heading stays above.
    page.locator(".tp-board-card", has_text="Thruxton").locator(".lb-layout").first.click()
    expect(page.locator(".lb-row").first).to_be_visible()
    expect(page.locator(".lb-hero h1 svg.lb-trophy")).to_be_visible()
    expect(page.get_by_role("button", name="Refresh this page from the latest version")).to_be_visible()
    url = page.url
    with page.expect_navigation():
        page.get_by_role("button", name="Refresh this page from the latest version").click()
    expect(page.locator(".lb-row").first).to_be_visible()
    assert page.url == url
    page.set_viewport_size({"width": 390, "height": 844})
    expect(page.get_by_role("button", name="Refresh this page from the latest version")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_the_leaderboard_has_my_sessions_at_the_top_and_add_a_session_under_it(page):
    fake = FakeWorker()
    open_page(page, fake, path="/leaderboards.html")
    mine, add = page.locator("#lb-my-sessions"), page.locator("#lb-add-session")
    expect(mine).to_have_text("My Sessions")
    expect(mine).to_have_attribute("href", "track.html")
    expect(add).to_have_text("Add a session")
    m, a = mine.bounding_box(), add.bounding_box()
    # On desktop Add a session sits under My Sessions at the right, on the What is the Leaderboard? row, and the banner stays short.
    assert m["height"] >= 50 and a["height"] >= 40, (m, a)
    assert a["y"] >= m["y"] + m["height"] - 2 and a["x"] + a["width"] > m["x"] + m["width"] / 2 and a["x"] + a["width"] <= m["x"] + m["width"] + 2
    assert page.locator(".page-hero").bounding_box()["height"] < 190
    back = page.locator("#lb-page-back").bounding_box()
    # My Sessions, Back and the title share the top row.
    assert abs(m["y"] + m["height"] / 2 - (back["y"] + back["height"] / 2)) < 4
    expect(page.locator(".lb-hero h1 .mt3uk-share-dot")).to_be_visible()
    add.click()
    expect(page).to_have_url(re.compile(r"/track\.html\?add=1$"))
    # On a phone the title comes first, at the left, with its trophy straight after the word and the share button at the
    # far right. Under it Back, My Sessions (with its words) and Add a session (with its words) share a row, and the bulb
    # sits at the right of the What is the Leaderboard? line.
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/leaderboards.html")
    mine, add, back = page.locator("#lb-my-sessions"), page.locator("#lb-add-session"), page.locator("#lb-page-back")
    expect(mine).to_be_visible()
    b, k, h, a = mine.bounding_box(), back.bounding_box(), page.locator(".lb-hero h1").bounding_box(), add.bounding_box()
    assert k["width"] <= 46 and abs(k["width"] - k["height"]) < 1, k
    assert b["width"] > 90 and a["width"] > 90, (b, a)
    expect(mine).to_have_attribute("aria-label", "My Sessions")
    centre = lambda r: r["y"] + r["height"] / 2
    assert abs(centre(b) - centre(k)) < 4 and abs(centre(a) - centre(k)) < 4
    assert k["x"] + k["width"] < b["x"] < a["x"] and a["x"] + a["width"] <= 375
    assert h["y"] + h["height"] <= k["y"] + 2, "The title is above the buttons"
    assert h["x"] < 24, h
    trophy, d = page.locator(".lb-hero h1 svg.lb-trophy").bounding_box(), page.locator(".lb-hero h1 .mt3uk-share-dot").bounding_box()
    word = page.evaluate("(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('.lb-hero h1')); const s = [...document.querySelector('.lb-hero h1').childNodes].find(n => n.nodeType === 3); const q = document.createRange(); q.selectNodeContents(s); return q.getBoundingClientRect().right; })()")
    assert trophy["x"] >= word - 1 and trophy["x"] - word < 20, (trophy, word)
    assert d["x"] + d["width"] >= 390 - 24 and abs(centre(d) - centre(h)) < 12, d
    bulb = page.locator(".lb-hero .laps-tip-bulbbtn").bounding_box()
    what = page.locator(".lb-hero .tp-what summary").bounding_box()
    assert bulb["x"] + bulb["width"] >= 390 - 24 and bulb["y"] >= a["y"] + a["height"] - 2 and abs(centre(bulb) - centre(what)) < 8, (bulb, what)
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_what_are_sessions_starts_open_for_a_member_with_no_sessions(page):
    """What are Sessions? lists what Laps does (tyres and pads among it); it starts open until the member has a session."""
    open_page(page, FakeWorker(earlier=False), "/track.html", signed_in=True)
    what = page.locator(".page-hero .tp-what")
    expect(what).to_have_attribute("open", "")
    expect(what.locator(".tp-what-list li")).to_have_count(5)
    expect(what).to_contain_text("Tyres and brake pads")
    open_page(page, FakeWorker(), "/track.html", signed_in=True)
    page.locator("#tp-hero-add").wait_for()
    expect(page.locator(".page-hero .tp-what")).not_to_have_attribute("open", "")


LAPS_COUNTS = {"success": True, "counts": {"track-board:thruxton:main": 4, "drag-board:santa-pod": 2},
               "leaders": {"track-board:thruxton:main": [{"car": "Arctic Three", "owner": "Rich", "model": "Model 3", "time": 81.42}],
                           "drag-board:santa-pod": [{"car": "Venom", "owner": "Kit", "model": "Model S", "quarter": 10.84}]}}


def test_the_sessions_bulb_shows_fastest_right_now_and_lights_up_when_a_leader_changes(page):
    """The light bulb on Sessions opens Fastest right now above the tip, and is lit while a leader has changed since
    the member last opened it; a new leader is marked New."""
    fake = FakeWorker()
    fake.counts = LAPS_COUNTS
    open_page(page, fake, "/track.html", signed_in=True)
    bulb = page.locator(".page-hero .laps-tip-bulbbtn")
    expect(bulb).to_have_class(re.compile("is-lit"))
    bulb.click()
    pop = page.locator(".page-hero .laps-tip-pop")
    expect(pop.locator(".lh-fast-pop a").first).to_contain_text("Thruxton")
    expect(pop.locator(".lh-fast-pop a").first).to_contain_text("1:21.42")
    expect(pop.locator(".laps-tip-words")).to_contain_text("Tip: the more you upload")
    expect(bulb).not_to_have_class(re.compile("is-lit"))
    # Seen: next time it is not lit, until a leader changes, which is marked New.
    open_page(page, fake, "/track.html", signed_in=True)
    page.locator(".page-hero .lh-fast-pop").wait_for(state="attached")
    expect(page.locator(".page-hero .laps-tip-bulbbtn")).not_to_have_class(re.compile("is-lit"))
    fake.counts = json.loads(json.dumps(LAPS_COUNTS))
    fake.counts["leaders"]["track-board:thruxton:main"] = [{"car": "Venom", "owner": "Kit", "model": "Model S", "time": 79.9}]
    open_page(page, fake, "/track.html", signed_in=True)
    bulb = page.locator(".page-hero .laps-tip-bulbbtn")
    expect(bulb).to_have_class(re.compile("is-lit"))
    bulb.click()
    expect(page.locator(".page-hero .lh-fast-pop a").first.locator(".lh-new")).to_have_text("New")
    expect(page.locator(".page-hero .lh-fast-pop a").nth(1).locator(".lh-new")).to_have_count(0)
    # A list remembered by the old format (board, time and the leader's name) still counts as seen.
    page.evaluate("localStorage.setItem('mt3ukLapsFastSeen', JSON.stringify(['track-board:thruxton:main|1:19.90|Kit', 'drag-board:santa-pod|10.84 s|Kit']))")
    open_page(page, fake, "/track.html", signed_in=True)
    page.locator(".page-hero .lh-fast-pop").wait_for(state="attached")
    expect(page.locator(".page-hero .laps-tip-bulbbtn")).not_to_have_class(re.compile("is-lit"))
    expect(page.locator(".page-hero .lh-fast-pop .lh-new")).to_have_count(0)
    # A leader's nickname or car name changing is not a new leader: nothing is lit or marked New.
    fake.counts = json.loads(json.dumps(fake.counts))
    fake.counts["leaders"]["track-board:thruxton:main"] = [{"car": "Venom II", "owner": "Kit Chambers", "model": "Model S", "time": 79.9}]
    open_page(page, fake, "/track.html", signed_in=True)
    page.locator(".page-hero .lh-fast-pop").wait_for(state="attached")
    expect(page.locator(".page-hero .laps-tip-bulbbtn")).not_to_have_class(re.compile("is-lit"))
    expect(page.locator(".page-hero .lh-fast-pop .lh-new")).to_have_count(0)


def test_front_page_panels_chosen_for_sessions_and_the_leaderboard_show_for_members(page):
    """A front page section the admin chose for Sessions (or the Leaderboard) is drawn under the list for a signed-in
    member, with the admin's words, and never on a session's own page."""
    fake = FakeWorker()
    fake.counts = LAPS_COUNTS
    fake.panels = {"what": {"heading": "What Laps does for you", "show": {"sessions": True}}, "fastest": {"show": {"leaderboard": True}}}
    open_page(page, fake, "/track.html", signed_in=True)
    slot = page.locator("[data-laps-panels='sessions']")
    expect(slot).to_be_visible()
    expect(slot.locator("h2")).to_have_text(["What Laps does for you"])
    expect(slot.locator(".lh-card")).to_have_count(4)
    expect(slot.locator(".mt3uk-share-dot")).to_have_count(0)
    page.locator("#tp-hero-add").click()
    expect(slot).to_be_hidden()
    open_page(page, fake, "/leaderboards.html", signed_in=True)
    lb = page.locator("[data-laps-panels='leaderboard']")
    expect(lb).to_be_visible()
    expect(lb.locator("h2")).to_have_text(["Fastest right now"])
    expect(lb.locator(".lh-fast a").first).to_contain_text("Thruxton")
    # Inside a board it is not shown.
    page.locator(".lb-cardwrap a, .lb-strip, .lb-venue a").first.click()
    expect(lb).to_be_hidden()


def test_front_page_panels_are_not_shown_to_visitors_who_are_signed_out(page):
    fake = FakeWorker()
    fake.counts = LAPS_COUNTS
    fake.panels = {"fastest": {"show": {"leaderboard": True}}}
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    page.locator(".lb-venue").first.wait_for()
    page.wait_for_timeout(300)
    expect(page.locator("[data-laps-panels='leaderboard']")).to_be_hidden()


def test_since_you_were_last_here_shows_what_changed_on_the_members_boards(page):
    """The first visit only takes a look at the member's boards; the next shows what changed (a car moved down or up,
    new cars on a board), each linking to its board, until it is closed."""
    fake = FakeWorker()
    fake.index[0]["privacy"] = "board"
    mine = {"carId": "car1", "sessionId": "earlier1", "car": "Arctic Three", "model": "Model 3", "owner": "Rich", "time": 102.47, "date": "2026-03-28"}
    fake.boards["/track/board:thruxton:main"] = [dict(_board_entry(0), time=100.0), mine]
    open_page(page, fake, "/track.html", signed_in=True)
    page.locator("#tp-hero-add").wait_for()
    page.wait_for_function("localStorage.getItem('mt3ukLapsSince') !== null")
    expect(page.locator("#tp-since")).to_be_hidden()
    # Two quicker cars join: Arctic Three drops from 2nd to 4th.
    fake.boards["/track/board:thruxton:main"] = [dict(_board_entry(0), time=100.0), dict(_board_entry(1), time=101.0), dict(_board_entry(2), time=102.0), mine]
    open_page(page, fake, "/track.html", signed_in=True)
    since = page.locator("#tp-since")
    expect(since).to_be_visible()
    expect(since).to_contain_text("Since you were last here")
    expect(since.locator("li")).to_have_text(["Arctic Three dropped to 4th at Thruxton"])
    assert since.locator("li a").get_attribute("href") == "leaderboards.html?board=thruxton%3Amain"
    # Still there next time until it is closed; closed, it is gone until something else changes.
    open_page(page, fake, "/track.html", signed_in=True)
    expect(page.locator("#tp-since")).to_be_visible()
    page.locator("[data-since-close]").click()
    expect(page.locator("#tp-since")).to_be_hidden()
    open_page(page, fake, "/track.html", signed_in=True)
    page.locator("#tp-hero-add").wait_for()
    page.wait_for_timeout(400)
    expect(page.locator("#tp-since")).to_be_hidden()
    # A new car behind it: no move, but a new car on the board.
    fake.boards["/track/board:thruxton:main"].append(dict(_board_entry(5), time=110.0))
    open_page(page, fake, "/track.html", signed_in=True)
    expect(page.locator("#tp-since li")).to_have_text(["1 new car on the board at Thruxton"])


def test_the_announcement_shows_on_sessions_until_it_is_closed(page):
    fake = FakeWorker()
    fake.news = {"id": "1", "text": "New: Compare tyres and pads on every board", "link": "leaderboards.html", "linkText": "Have a look"}
    open_page(page, fake, "/track.html", signed_in=True)
    news = page.locator("#tp-news")
    expect(news).to_contain_text("New: Compare tyres and pads on every board")
    expect(news.get_by_role("link", name="Have a look")).to_have_attribute("href", "leaderboards.html")
    page.locator("[data-news-close]").click()
    expect(news).to_be_hidden()
    open_page(page, fake, "/track.html", signed_in=True)
    page.locator("#tp-hero-add").wait_for()
    page.wait_for_timeout(300)
    expect(page.locator("#tp-news")).to_be_hidden()
    # A new announcement shows again.
    fake.news = {"id": "2", "text": "New: Since you were last here", "link": "", "linkText": ""}
    open_page(page, fake, "/track.html", signed_in=True)
    expect(page.locator("#tp-news")).to_have_text("New: Since you were last here")


def test_sessions_has_add_a_session_under_leaderboards(page):
    """On the member's list of sessions Add a session is in the heading, under Leaderboards and the same size; it opens
    the Add page for the vehicle picked, and is not shown on a session's own page."""
    fake = FakeWorker()
    open_page(page, fake, "/track.html", signed_in=True)
    add, lb = page.locator("#tp-hero-add"), page.locator("#tp-lb-pill")
    expect(add).to_be_visible()
    a, l = add.bounding_box(), lb.bounding_box()
    # On desktop it sits at the right on the What are Sessions? row, under Leaderboards, and the banner stays short.
    assert a["y"] >= l["y"] + l["height"] - 2 and a["x"] + a["width"] <= l["x"] + l["width"] + 2, (a, l)
    assert page.locator(".page-hero").bounding_box()["height"] < 190
    expect(page.locator("#tp-app").get_by_role("link", name="Add a session", exact=True)).to_have_count(0)
    add.click()
    expect(page).to_have_url(re.compile(r"/track\.html\?add=1&car="))
    expect(page.locator("#tp-hero-actions")).to_be_hidden()
    # On the owner's own session it is there too, for that car; on a phone it is a round plus.
    own = day_session("own1", "10:00", 95.0, 4)
    fake.sessions["own1"] = dict(own, carId="car1")
    page.goto("/track.html?s=own1")
    expect(page.locator("#tp-hero-add")).to_be_visible()
    assert "car=" in page.locator("#tp-hero-add").get_attribute("href")
    page.set_viewport_size({"width": 390, "height": 800})
    b = page.locator("#tp-hero-add").bounding_box()
    assert abs(b["height"] - 44) < 2 and b["width"] > 90, b
    expect(page.locator("#tp-hero-add span")).to_be_visible()
    # On the narrowest phones it is a round plus again.
    page.set_viewport_size({"width": 320, "height": 800})
    b = page.locator("#tp-hero-add").bounding_box()
    assert abs(b["width"] - 44) < 2 and abs(b["height"] - 44) < 2, b
    expect(page.locator("#tp-hero-add span")).to_be_hidden()


def test_the_battery_start_and_end_are_rounded_once(page):
    fake = FakeWorker(earlier=False)
    rec = car_lap_session()
    rec["carData"]["soc"] = {"start": 62.72, "end": 60.48}
    for l in rec["laps"]:
        l.pop("carData")
    fake.sessions["lp1"] = rec
    fake.index.append(summary(rec))
    open_page(page, fake, path="/track.html?s=lp1")
    # Under 10% the figures keep a decimal (a lap uses 1 to 2%, so 1.3% must not read as 1%); the ends match.
    tile = page.locator("#car-data .tp-tile", has_text="Charge used")
    expect(tile).to_contain_text("2.2%")
    expect(tile).to_contain_text("62.7% to 60.5%")
    # A whole day is shown in whole percentages, as the car does.
    rec["carData"]["soc"] = {"start": 89.01, "end": 74.97}
    page.reload()
    tile = page.locator("#car-data .tp-tile", has_text="Charge used")
    expect(tile).to_contain_text("14%")
    expect(tile).to_contain_text("89% to 75%")


def test_a_lap_timer_file_and_a_track_mode_file_from_one_session_are_joined(page):
    fake = FakeWorker(earlier=False)
    open_page(page, fake)
    page.get_by_role("link", name="Add a session", exact=True).click()
    rb = (ROOT / "tests" / "fixtures" / "racebox-drive-2026-10-02.gpx").read_bytes()
    car = (ROOT / "tests" / "fixtures" / "tesla-track-mode-drive-2026-10-02.csv").read_bytes()
    page.set_input_files("#tp-file", files=[
        {"name": "RaceBox_Drag_Session_on_02-10-2026_23-03.gpx", "mimeType": "application/gpx+xml", "buffer": rb},
        {"name": "telemetry-v1-2026-10-02-23_01_21.csv", "mimeType": "text/csv", "buffer": car}])
    # One session: the timed file says it has the car data, the car file says where it went.
    files = page.locator(".tp-file-list")
    expect(files).to_contain_text("With the car data from telemetry-v1-2026-10-02-23_01_21.csv")
    expect(files).to_contain_text("Car data added to the session from RaceBox_Drag_Session_on_02-10-2026_23-03.gpx")
    expect(files).to_contain_text("lined up, match 1.00")
    expect(page.locator(".tp-skipped, .tp-file-skip")).to_have_count(0)
    # It can be switched to separate files, and back.
    toggle = page.locator("#tp-merge-toggle")
    expect(toggle).to_have_text("Save the files separately instead")
    toggle.click()
    expect(page.locator(".tp-file-list")).to_contain_text("Joining is switched off")
    expect(page.locator("#tp-merge-toggle")).to_have_text("Join the lap timer and car files")
    page.locator("#tp-merge-toggle").click()
    expect(page.locator(".tp-file-list")).to_contain_text("lined up, match")
    # A drive, not a circuit: choose Other, then saving keeps one session with both file names and the car's figures.
    page.locator("[data-type] [data-v='other']").click()
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    assert len(fake.saved) == 1
    saved = fake.saved[0]["session"]
    assert saved["carSource"]["name"] == "telemetry-v1-2026-10-02-23_01_21.csv" and saved["carSource"]["match"] > 0.99 and saved["carSource"]["g"]
    assert "RaceBox_Drag_Session" in saved["fileName"] and "telemetry-v1-2026-10-02" in saved["fileName"]
    assert saved["carData"]["soc"]["start"] > saved["carData"]["soc"]["end"]
    # The session page says where the car's figures came from.
    expect(page.locator("#tp-car-from")).to_contain_text("lined up with the lap timer file")


def test_a_track_mode_file_that_does_not_line_up_is_saved_on_its_own_and_says_why(page):
    import csv, io
    fake = FakeWorker(earlier=False)
    open_page(page, fake)
    page.get_by_role("link", name="Add a session", exact=True).click()
    rb = (ROOT / "tests" / "fixtures" / "racebox-drive-2026-10-02.gpx").read_bytes()
    rows = list(csv.reader(io.StringIO((ROOT / "tests" / "fixtures" / "tesla-track-mode-drive-2026-10-02.csv").read_text())))
    head, body = rows[0], rows[1:]
    k = head.index("Speed (MPH)")
    speeds = [r[k] for r in body][::-1]   # the same drive's speeds in the wrong order: they cannot match
    for r, v in zip(body, speeds):
        r[k] = v
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerows([head] + body)
    page.set_input_files("#tp-file", files=[
        {"name": "RaceBox_Drag_Session_on_02-10-2026_23-03.gpx", "mimeType": "application/gpx+xml", "buffer": rb},
        {"name": "telemetry-v1-2026-10-02-23_01_21.csv", "mimeType": "text/csv", "buffer": out.getvalue().encode()}])
    expect(page.locator(".tp-file-list")).to_contain_text("Saved on its own")
    expect(page.locator(".tp-file-list")).not_to_contain_text("Car data added")
    expect(page.locator("#tp-merge-toggle")).to_be_visible()



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
            page.select_option("#tp-logger", "Dragy")
            page.get_by_role("button", name="Save session").click()
            expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
            assert fake.requests[0]["kind"] == "drag" and fake.requests[0]["name"] == "Local strip"
            assert fake.saved[0]["session"]["type"] == "drag" and not fake.saved[0].get("street")
        else:
            page.locator("#tp-street").click()
            expect(page.locator("#tp-street")).to_have_attribute("aria-checked", "true")
            expect(page.locator("[data-privacy] [data-v='board']")).to_have_count(0)
            page.select_option("#tp-logger", "Dragy")
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
    expect(page.locator(".tp-tile.is-hero .v")).to_have_text(re.compile(r"1:39\.79"))
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
    page.goto("/track-admin.html")
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


def test_leaderboard_track_list_can_be_sorted(page):
    fake = FakeWorker()
    fake.index = [dict(EARLIER, id="sh1", privacy="board", bestTime=101.2)]
    fake.sessions = {}
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    page.get_by_role("button", name=re.compile("Show all")).click()
    names = page.locator(".tp-board-card .tp-board-name b")
    sel = page.locator("#lb-sort")
    expect(sel.locator("option")).to_have_text(["Most sessions", "A to Z", "Newest", "Oldest"])
    sel.select_option("az")
    texts = names.all_inner_texts()
    assert len(texts) > 2 and texts == sorted(texts, key=str.casefold)
    # Tracks with a time come before the empty ones, newest or oldest.
    for mode in ("newest", "oldest"):
        sel.select_option(mode)
        expect(names.first).to_have_text("Thruxton")


def _two_busy_tracks(fake):
    fake.index = [dict(EARLIER, id="sh1", privacy="board", bestTime=101.2), dict(day_session("sh2", "10:00", 90.0, 3), privacy="board")]
    fake.sessions = {}


def _venues(page):
    return page.eval_on_selector_all(".lb-venues .lb-cardwrap[data-venue]", "els => els.map(e => e.dataset.venue)")


def test_leaderboard_tracks_can_be_moved_hidden_and_the_layout_reset(page):
    fake = FakeWorker()
    _two_busy_tracks(fake)
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    start = _venues(page)
    assert sorted(start) == ["castle-combe", "thruxton"], start
    # Hold a track and drag it above the other: the order is kept, as "My layout".
    first = page.locator(".lb-cardwrap").nth(0).bounding_box()
    second = page.locator(".lb-cardwrap").nth(1).bounding_box()
    page.mouse.move(second["x"] + 40, second["y"] + 40)
    page.mouse.down()
    page.mouse.move(second["x"] + 40, second["y"] + 20, steps=3)
    for step in range(1, 9):
        page.mouse.move(first["x"] + 40, second["y"] + 20 + (first["y"] + 10 - second["y"] - 20) * step / 8)
        page.wait_for_timeout(20)
    page.mouse.up()
    page.wait_for_timeout(150)
    moved = _venues(page)
    assert moved == list(reversed(start)), (start, moved)
    expect(page).to_have_url(re.compile(r"/leaderboards\.html$"))
    expect(page.locator("#lb-sort")).to_have_value("mine")
    expect(page.locator("#lb-sort option").first).to_have_text("My layout")
    # It is remembered.
    page.reload()
    assert _venues(page) == moved
    # Hide one: it leaves the list, and can be shown again.
    gone = moved[0]
    page.locator('.lb-cardwrap[data-venue="%s"] [data-hide]' % gone).click()
    assert _venues(page) == moved[1:]
    expect(page.locator("[data-showhidden]")).to_have_text("Show 1 hidden track")
    page.locator("[data-showhidden]").click()
    expect(page.locator('.lb-cardwrap.is-hid[data-venue="%s"]' % gone)).to_be_visible()
    page.locator('.lb-cardwrap.is-hid [data-hide]').click()
    assert _venues(page)[0] == gone
    # Reset puts the list back as it was.
    page.locator('.lb-cardwrap[data-venue="%s"] [data-hide]' % gone).click()
    page.locator("[data-resetlayout]").click()
    assert _venues(page) == start
    expect(page.locator("#lb-sort")).to_have_value("busy")
    expect(page.locator("[data-resetlayout]")).to_have_count(0)


def _board_entry(i):
    return {"carId": "c%d" % i, "sessionId": "s%d" % i, "car": "Car %d" % i, "model": "Model 3", "owner": "Driver %d" % i, "time": 90.0 + i, "date": "2026-07-14", "conditions": "Dry", "tyres": "AD08R", "sessions": 1}


def test_a_long_board_folds_everything_below_tenth_place_behind_an_arrow(page):
    fake = FakeWorker()
    fake.boards["/track/board:thruxton:main"] = [_board_entry(i) for i in range(12)]
    open_page(page, fake, "/leaderboards.html?board=thruxton:main", signed_in=False)
    expect(page.locator(".lb-row")).to_have_count(12)
    visible = page.locator(".lb-row:visible")
    expect(visible).to_have_count(10)
    fold = page.locator("[data-fold]")
    expect(fold).to_have_text("Show positions 11 to 12")
    expect(fold).to_have_attribute("aria-expanded", "false")
    fold.click()
    expect(visible).to_have_count(12)
    expect(fold).to_have_text("Hide positions 11 to 12")
    fold.click()
    expect(visible).to_have_count(10)


def test_a_board_of_ten_or_fewer_has_no_arrow(page):
    fake = FakeWorker()
    fake.boards["/track/board:thruxton:main"] = [_board_entry(i) for i in range(10)]
    open_page(page, fake, "/leaderboards.html?board=thruxton:main", signed_in=False)
    expect(page.locator(".lb-row:visible")).to_have_count(10)
    expect(page.locator("[data-fold]")).to_have_count(0)


def test_leaderboard_list_fits_a_phone_with_the_hide_buttons(page):
    page.set_viewport_size({"width": 360, "height": 740})
    fake = FakeWorker()
    _two_busy_tracks(fake)
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    expect(page.locator(".lb-cardwrap").first).to_be_visible()
    assert overflow_width(page) <= 0
    box = page.locator(".lb-cardwrap").first.bounding_box()
    hide = page.locator(".lb-hide").first.bounding_box()
    assert hide["width"] >= 44 and hide["height"] >= 44 and hide["x"] + hide["width"] <= box["x"] + box["width"] + 1, (box, hide)
    # The count is not covered by the hide button.
    count = page.locator(".lb-cardwrap .tp-board-name .tp-small").first.bounding_box()
    assert count["x"] + count["width"] <= hide["x"] + 1, (count, hide)


def test_leaderboards_list_busy_tracks_first_with_counts(page):
    fake = FakeWorker()
    shared = dict(EARLIER, id="sh1", privacy="build")
    fake.index = [shared, dict(EARLIER, id="sh2", privacy="board", bestTime=101.2), dict(EARLIER, id="pv1", privacy="private")]
    fake.sessions = {}
    open_page(page, fake, "/leaderboards.html", signed_in=False)
    first = page.locator(".tp-board-card").first
    expect(first).to_contain_text("Thruxton")
    # One session for each car (its fastest), not every session the car has shared.
    expect(first).to_contain_text("1 session")
    expect(first).not_to_contain_text("2 sessions")
    expect(first).to_have_class(re.compile("is-busy"))
    # The top three show on the card, with position, name and time, without opening the track.
    expect(first.locator(".lb-podium li").first).to_contain_text("Rich")
    expect(first.locator(".lb-podium li").first.locator(".lb-pos")).to_have_text("1")
    expect(first.locator(".lb-podium li").first).to_contain_text("1:41.20")
    expect(first.locator(".lb-podium li").first.locator(".lb-date")).to_contain_text("2026")
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
    expect(rows.first).to_contain_text("1:41.20")
    # Cars with nothing on this board are greyed.
    expect(page.locator("#lb-models .chip.is-empty")).to_have_count(6)
    expect(page.locator('#lb-models .chip[data-m="Model 3"]')).not_to_have_class(re.compile("is-empty"))
    expect(page.locator('#lb-models .chip[data-m="All"]')).not_to_have_class(re.compile("is-empty"))
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
    expect(page.locator(".tp-back")).to_have_text("Back")
    expect(page.locator(".tp-back")).to_have_attribute("aria-label", "Back to all hill climbs")
    page.locator(".tp-back").click()
    expect(page.locator(".lb-types a.is-on")).to_have_text("Hill climb")
    page.locator(".lb-types a", has_text="Sprint").click()
    page.locator(".tp-board-card", has_text="Curborough").locator(".lb-layout").first.click()
    expect(page.locator(".tp-back")).to_have_text("Back")
    expect(page.locator(".tp-back")).to_have_attribute("aria-label", "Back to all sprints")


def test_a_session_has_a_my_sessions_button_beside_back(page):
    """On a session (or any other view) a My Sessions button sits beside Back in the heading (#tp-home,
    moveViewBack in js/track-page.js), so the list is one tap away. On the list itself there is none."""
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    expect(page.locator(".page-hero #tp-home")).to_be_visible()
    # Opened straight from a link too.
    page.goto("/track.html?s=new1")
    expect(page.locator(".page-hero #tp-home")).to_be_visible()
    # And from the list.
    page.goto("/track.html")
    page.locator("#tp-sess-list .tp-trackrow").first.click()
    page.locator("#tp-sess-list [data-layout-toggle]").first.click()
    page.locator("#tp-sess-list .tp-daygroup-title, #tp-sess-list a.tp-row[data-sid]").first.click()
    page.locator("#tp-sess-list a.tp-row[data-sid]").first.click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    home = page.locator(".page-hero #tp-home")
    expect(home).to_be_visible()
    expect(home).to_have_attribute("aria-label", "My Sessions")
    expect(page.locator(".page-hero .tp-back")).to_be_visible()
    home.click()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    expect(page.locator("#tp-sess-list .tp-trackrow").first).to_be_visible()
    expect(page.locator(".page-hero #tp-home")).to_have_count(0)


def test_cars_are_separate_from_sessions(page):
    open_page(page, FakeWorker())
    cars = page.locator("#tp-cars .tp-vcurrent")
    expect(cars).to_have_count(1)
    expect(cars.first).to_contain_text("Arctic Three")
    expect(cars.first).to_contain_text("1 session")
    # Add a vehicle is at the bottom of the vehicle list, not on the page.
    expect(page.locator("#tp-car-add-open")).to_have_count(0)
    page.locator("#tp-vtoggle").click()
    expect(page.locator("#tp-car-add-open")).to_be_visible()
    page.locator("#tp-vtoggle").click()
    expect(page.locator("#tp-car-add-open")).to_have_count(0)
    expect(page.locator(".tp-refresh")).to_have_text("")
    expect(page.locator(".tp-list-head h2")).to_have_text("Sessions")
    expect(page.locator(".tp-list-head .tp-for")).to_have_count(0)
    expect(page.locator("#tp-vtoggle")).to_contain_text("Arctic Three")
    expect(page.locator(".tp-list .tp-trackrow")).to_have_count(1)
    expect(page.locator("#tp-lb-pill")).to_have_attribute("href", "leaderboards.html")
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    types = page.locator("[data-type] button")
    expect(types).to_have_text(["Track day", "Drag run", "Sprint", "Hill climb", "Other"])
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
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"4 timed laps, best 1:39\.79"))
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
    expect(page.locator("#tp-key")).to_contain_text("You, best, 28/05 (B)")
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
    tyre_model(page, "tp-tyre", "AD08R")
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
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text(re.compile(r"2 timed laps, best 1:39\.79"))
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator("#settings [data-retype] .chip.is-on")).to_have_text("Track day")
    assert fake.sessions["new1"]["type"] == "track" and len(fake.sessions["new1"]["laps"]) == 2


def test_the_layout_of_a_saved_session_can_be_changed(page):
    """On the session page the member can pick another layout of the circuit; the saved readings are timed on it again."""
    _thruxton_with_a_second_layout(page)
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    chips = page.locator("#tp-relayout [data-relayout] .chip")
    expect(chips).to_have_text(["Thruxton", "Short Circuit"])
    expect(page.locator("#tp-relayout .chip.is-on")).to_have_text("Thruxton")
    chips.nth(1).click()
    expect(page.get_by_role("heading", name="Change the layout")).to_be_visible()
    expect(page.locator("#tp-layout-field .chip.is-on")).to_have_text("Short Circuit")
    # Adding a different layout is for the Add page, not here.
    expect(page.locator("#tp-layout-field [data-v='__new']")).to_have_count(0)
    page.get_by_role("button", name="Save changes").click()
    expect(page.get_by_role("heading", name="Session settings")).to_be_visible()
    assert fake.replaced[-1]["session"]["layoutId"] == "short", fake.replaced
    expect(page.locator("#tp-relayout .chip.is-on")).to_have_text("Short Circuit")


def test_the_admin_can_change_a_members_layout_only_by_saying_who_asked(page):
    """On the admin view of a member's track day, a Layout (admin) box times the readings on the layout picked, needs a
    note of who asked, shows the result first, and saves through the admin route with that note."""
    _thruxton_with_a_second_layout(page)
    fake = FakeWorker()
    open_page(page, fake, admin=True)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    # Now as the admin looking at someone else's session.
    fake.admin_view = True
    page.reload()
    expect(page.locator("#tp-admin-banner")).to_be_visible()
    expect(page.locator("#settings")).to_have_count(0)
    box = page.locator("#tp-admin-layout")
    expect(box).to_contain_text("Only change this when the member has asked")
    chips = box.locator("[data-admin-relayout] .chip")
    expect(chips).to_have_text(["Thruxton", "Short Circuit"])
    go = page.locator("#tp-admin-layout-go")
    expect(go).to_be_disabled()
    # A different layout alone is not enough: who asked is required.
    chips.nth(1).click()
    expect(go).to_be_disabled()
    page.fill("#tp-admin-layout-note", "John Chambers, by email on 7 Oct")
    expect(go).to_be_enabled()
    # The result is shown before anything is saved, and a no saves nothing.
    seen = []
    page.once("dialog", lambda d: (seen.append(d.message), d.dismiss()))
    go.click()
    expect(page.locator("#tp-admin-layout-note-out")).to_have_text("Nothing changed.")
    assert "Short Circuit" in seen[0] and "Best lap" in seen[0] and "emailed" in seen[0], seen
    assert not getattr(fake, "admin_retimed", [])
    page.once("dialog", lambda d: d.accept())
    go.click()
    expect(page.locator("#tp-admin-layout")).to_contain_text("MT3UK set the layout to Short Circuit")
    sent = fake.admin_retimed[-1]
    assert sent["memberAsked"] == "John Chambers, by email on 7 Oct" and sent["session"]["layoutId"] == "short" and sent["session"]["layoutPicked"] is True
    expect(page.locator("#tp-admin-layout [data-admin-relayout] .chip.is-on")).to_have_text("Short Circuit")


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


def test_the_main_list_is_one_line_for_each_track_and_opens_that_tracks_page(page):
    fake = FakeWorker(earlier=False)
    fake.index = [shared_session("a1", "thruxton", "Thruxton", "main", 100, "2026-04-03"),
                  shared_session("a2", "thruxton", "Thruxton", "main", 101, "2026-04-02"),
                  dict(shared_session("b1", "brands", "Brands Hatch", "indy", 60, "2026-05-01", privacy="private"), layout="Indy"),
                  dict(shared_session("b2", "brands", "Brands Hatch", "gp", 120, "2026-05-02"), layout="Grand Prix")]
    open_page(page, fake)
    rows = page.locator("#tp-sess-list .tp-trackrow")
    # One line for each track, whatever the layout, with the count and the last day; nothing else to work out.
    expect(rows).to_have_count(2)
    expect(rows.nth(0)).to_contain_text("Brands Hatch")
    expect(rows.nth(0)).to_contain_text("2 sessions, last 2 May 2026")
    expect(rows.nth(1)).to_contain_text("Thruxton")
    expect(rows.nth(1)).to_contain_text("2 sessions, last 3 Apr 2026")
    expect(page.locator("#tp-type-filter, #tp-track-filter, #tp-group-by")).to_have_count(0)
    # Sort: recently driven, A to Z, most sessions.
    page.locator("#tp-sort").select_option("az")
    expect(rows.locator("b")).to_have_text(["Brands Hatch", "Thruxton"])
    page.locator("#tp-sort").select_option("most")
    expect(rows).to_have_count(2)
    # A line only steps down to its layouts; the track's own page (every session there, a day at a time) is reached by address.
    rows.filter(has_text="Brands Hatch").click()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    into_track(page, "Brands Hatch")
    expect(page.locator(".tp-head h2")).to_have_text("Brands Hatch")
    expect(page.locator(".tp-head .tp-for")).to_contain_text("2 sessions")
    expect(page.locator(".tp-daygroup")).to_have_count(2)
    expect(page.locator(".tp-daygroup h3")).to_have_text(["2 May 2026 on Brands Hatch, Grand Prix", "1 May 2026 on Brands Hatch, Indy"])
    # Back goes to the list.
    page.locator(".tp-back").click()
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(2)
    # Phone: no sideways scroll.
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_a_tracks_chevron_drops_down_its_layouts_and_one_opens_only_those_sessions(page):
    fake = FakeWorker(earlier=False)
    # Full records, so a session can be opened from the list and come back to it.
    for sid, lid, lay, date, best, extra in (("a1", "main", "Thruxton", "2026-04-03", 100.0, {}),
                                             ("b1", "indy", "Indy", "2026-05-01", 60.0, {"privacy": "private"}),
                                             ("b2", "gp", "Grand Prix", "2026-05-02", 120.0, {}),
                                             ("b3", "indy", "Indy", "2026-03-09", 61.0, {}),
                                             ("b4", "", "", "2026-02-01", 0, {"type": "drag", "runs": []})):
        venue, vid = ("Thruxton", "thruxton") if sid == "a1" else ("Brands Hatch", "brands")
        r = dict(day_session(sid, "10:00", best, 4, date=date, venue=venue, venue_id=vid), layoutId=lid, layout=lay, **extra)
        fake.sessions[sid] = dict(r)
        fake.index.append(summary(r))
    open_page(page, fake)
    brands = page.locator("#tp-sess-list .tp-trackwrap", has_text="Brands Hatch")
    layouts = brands.locator(".tp-layouts button.tp-layoutrow")
    # Folded until the chevron is pressed.
    expect(brands.locator(".tp-layouts")).to_be_hidden()
    toggle = brands.locator("[data-track-toggle]")
    expect(toggle).to_have_attribute("aria-expanded", "false")
    toggle.click()
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(brands.locator(".tp-layouts")).to_be_visible()
    # Each layout, and the drag runs, once, newest first, with its count and last day.
    expect(layouts.locator("b")).to_have_text(["Grand Prix", "Indy", "Drag runs"])
    expect(layouts.nth(1)).to_contain_text("2 sessions, last 1 May 2026")
    # Stays open through a sort.
    page.locator("#tp-sort").select_option("az")
    expect(brands.locator(".tp-layouts")).to_be_visible()
    # Thruxton's stays folded.
    expect(page.locator("#tp-sess-list .tp-trackwrap", has_text="Thruxton").locator(".tp-layouts")).to_be_hidden()
    # A layout drops down its own sessions, the same day groups as the track's page, without leaving the list.
    indy = brands.locator(".tp-layoutwrap", has_text="Indy")
    expect(indy.locator(".tp-layout-sessions")).to_be_hidden()
    layouts.filter(has_text="Indy").click()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    expect(indy.locator(".tp-layout-sessions")).to_be_visible()
    expect(indy.locator(".tp-layout-sessions a.tp-row[data-sid]")).to_have_count(2)
    expect(indy.locator(".tp-layout-sessions .tp-daygroup")).to_have_count(2)
    # A session opens from there, and Back (the button, or the browser's own) finds the list as it was left: Brands
    # Hatch and Indy still open. Only a full refresh of the page folds it.
    # Each date is a compact tile; its own arrow opens it.
    indy.locator(".tp-daygroup", has_text="1 May 2026").locator(".tp-daygroup-title").click()
    indy.locator('a.tp-row[data-sid="b1"]').click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=b1$"))
    page.locator(".tp-back").click()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    brands = page.locator("#tp-sess-list .tp-trackwrap", has_text="Brands Hatch")
    expect(brands.locator(".tp-layouts")).to_be_visible()
    expect(brands.locator(".tp-layoutwrap", has_text="Indy").locator(".tp-layout-sessions")).to_be_visible()
    expect(brands.locator(".tp-layoutwrap", has_text="Grand Prix").locator(".tp-layout-sessions")).to_be_hidden()
    brands.locator(".tp-layoutwrap", has_text="Indy").locator('a.tp-row[data-sid="b1"]').click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=b1$"))
    page.go_back()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    brands = page.locator("#tp-sess-list .tp-trackwrap", has_text="Brands Hatch")
    expect(brands.locator(".tp-layoutwrap", has_text="Indy").locator(".tp-layout-sessions")).to_be_visible()
    page.reload()
    expect(page.locator("#tp-sess-list .tp-trackwrap", has_text="Brands Hatch").locator(".tp-layouts")).to_be_hidden()
    # The track line only steps down; it never opens a page of its own.
    expect(page).to_have_url(re.compile(r"track\.html$"))
    into_track(page, "Brands Hatch")
    expect(page.locator(".tp-head h2")).to_have_text("Brands Hatch")
    expect(page.locator(".tp-head .tp-for")).to_contain_text("4 sessions")
    # Phone: no sideways scroll with a drop-down open.
    page.locator(".tp-back").click()
    page.set_viewport_size({"width": 390, "height": 844})
    page.locator("#tp-sess-list .tp-trackwrap", has_text="Brands Hatch").locator("[data-track-toggle]").click()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def find_fixture(fake):
    rows = [
        day_session("f1", "16:21", 137.6, 4, date="2026-07-21", venue="Snetterton", venue_id="snetterton"),
        day_session("f2", "09:33", 145.5, 2, date="2026-07-21", venue="Snetterton", venue_id="snetterton"),
        dict(day_session("f3", "14:46", 87.7, 4, date="2026-07-14"), conditions="Wet"),
        day_session("f4", "10:00", 99.0, 4, date="2026-06-01", venue="Thruxton", venue_id="thruxton"),
        day_session("f5", "11:00", 100.0, 3, date="2025-09-12", venue="Thruxton", venue_id="thruxton"),
    ]
    for r in rows:
        fake.sessions[r["id"]] = dict(r)
        fake.index.append(summary(r))


def test_find_a_track_session_or_date_from_the_main_list(page):
    fake = FakeWorker(earlier=False)
    find_fixture(fake)
    open_page(page, fake)
    box = page.locator("#tp-find")
    results = page.locator("#tp-find-results a.tp-row[data-sid]")
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(3)
    expect(page.locator("#tp-find-panel")).to_be_hidden()
    page.locator("#tp-find-toggle").click()
    expect(page.locator("#tp-find-panel")).to_be_visible()
    # A track name: the matching sessions themselves, newest first, and the sort goes away.
    box.fill("snett")
    expect(results).to_have_count(2)
    expect(page.locator(".tp-find-count")).to_have_text("2 sessions found")
    expect(results.first).to_contain_text("Snetterton")
    expect(page.locator("#tp-sort")).to_be_hidden()
    # A date, typed any way.
    for text, ids in (("21 jul", ["f1", "f2"]), ("21/07/2026", ["f1", "f2"]), ("2026-06-01", ["f4"]), ("14/7", ["f3"]), ("september 2025", ["f5"]), ("july", ["f1", "f2", "f3"])):
        box.fill(text)
        expect(results).to_have_count(len(ids))
        assert [r for r in page.locator("#tp-find-results a.tp-row[data-sid]").evaluate_all("els => els.map(e => e.dataset.sid)")] == ids, text
    # Words together, and conditions.
    box.fill("castle wet")
    expect(results).to_have_count(1)
    box.fill("thruxton 2025")
    expect(results).to_have_count(1)
    # Nothing found says what to try.
    box.fill("zzz")
    expect(page.locator("#tp-find-results")).to_contain_text("No sessions match")
    # Clear brings the track lines back.
    page.get_by_role("button", name="Clear").click()
    expect(box).to_have_value("")
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(3)
    expect(page.locator("#tp-sort")).to_be_visible()


def test_vehicles_are_a_list_that_folds_and_the_search_covers_every_vehicle(page):
    fake = FakeWorker(earlier=False)
    fake.extra_cars = [dict(CAR, id="car2", name="Track Bike", model="Panigale V4"), dict(CAR, id="car3", name="Spare", model="Model 3")]
    rows = [dict(day_session("m1", "10:00", 91.0, 4, date="2026-07-21", venue="Snetterton", venue_id="snetterton"), carId="car1"),
            dict(day_session("m2", "11:00", 92.0, 4, date="2026-07-20", venue="Snetterton", venue_id="snetterton"), carId="car2"),
            dict(day_session("m3", "12:00", 99.0, 4, date="2026-06-01", venue="Thruxton", venue_id="thruxton"), carId="car2")]
    for r in rows:
        fake.sessions[r["id"]] = dict(r)
        fake.index.append(summary(r))
    open_page(page, fake)
    # Folded: the vehicle picked, with Change; the search and dates come first on the page.
    cur = page.locator("#tp-cars .tp-vcurrent")
    expect(cur).to_contain_text("Arctic Three")
    expect(cur).to_contain_text("1 session")
    expect(page.locator("#tp-cars .tp-car[data-car]")).to_have_count(0)
    expect(page.locator("h1")).to_have_text("My Sessions")
    head = page.locator("#tp-cars .tp-vhead")
    expect(head.locator("h2")).to_be_visible()
    expect(head.locator(".tp-vcurrent")).to_be_visible()
    # Change opens the list, one row for each vehicle, and picking one folds it again.
    page.locator("#tp-vtoggle").click()
    rows_ = page.locator("#tp-cars .tp-vrow[data-car]")
    expect(rows_).to_have_count(3)
    expect(rows_.nth(0)).to_have_attribute("aria-checked", "true")
    expect(page.locator("#tp-car-add-open")).to_be_visible()
    rows_.filter(has_text="Track Bike").click()
    expect(page.locator("#tp-cars .tp-vcurrent")).to_contain_text("Track Bike")
    expect(page.locator("#tp-cars .tp-vcurrent")).to_contain_text("2 sessions")
    expect(page.locator("#tp-vtoggle")).to_be_visible()
    # The search looks through every vehicle and names the vehicle on each result.
    page.locator("#tp-find-toggle").click()
    expect(page.locator(".tp-find-hint")).to_have_text("Searches all your vehicles")
    page.fill("#tp-find", "snetterton")
    results = page.locator("#tp-find-results a.tp-row[data-sid]")
    expect(results).to_have_count(2)
    expect(results.nth(0).locator(".tp-row-car")).to_have_text("Arctic Three")
    expect(results.nth(1).locator(".tp-row-car")).to_have_text("Track Bike")
    expect(page.locator("#tp-tracks")).to_be_hidden()
    # A vehicle's name is searchable too.
    page.fill("#tp-find", "bike")
    expect(results).to_have_count(2)
    page.get_by_role("button", name="Clear").click()
    expect(page.locator("#tp-tracks")).to_be_visible()
    # Phone: no sideways scroll.
    page.set_viewport_size({"width": 390, "height": 844})
    page.locator("#tp-vtoggle").click()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_find_sessions_between_two_dates(page):
    fake = FakeWorker(earlier=False)
    find_fixture(fake)
    open_page(page, fake)
    page.locator("#tp-find-toggle").click()
    expect(page.locator("#tp-find-range")).to_be_hidden()
    page.get_by_role("button", name="Between dates").click()
    expect(page.locator("#tp-find-range")).to_be_visible()
    results = page.locator("#tp-find-results a.tp-row[data-sid]")
    page.fill("#tp-find-from", "2026-06-01")
    page.fill("#tp-find-to", "2026-07-14")
    expect(results).to_have_count(2)
    expect(page.locator(".tp-find-count")).to_have_text("2 sessions found")
    # Only a start date: from then on.
    page.fill("#tp-find-to", "")
    expect(results).to_have_count(4)
    # Dates the wrong way round are read the right way round.
    page.fill("#tp-find-from", "2026-07-21")
    page.fill("#tp-find-to", "2026-06-01")
    expect(results).to_have_count(4)
    # With words too.
    page.fill("#tp-find", "thruxton")
    expect(results).to_have_count(1)
    page.get_by_role("button", name="Clear").click()
    expect(page.locator("#tp-find-range")).to_be_hidden()
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(3)
    # Phone: no sideways scroll.
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Between dates").click()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_the_main_list_has_no_sort_when_there_is_only_one_track(page):
    fake = FakeWorker(earlier=False)
    fake.index = [shared_session("a1", "thruxton", "Thruxton", "main", 100)]
    open_page(page, fake)
    expect(page.locator("#tp-sess-list .tp-trackrow")).to_have_count(1)
    expect(page.locator("#tp-sort")).to_have_count(0)


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
    # The trophies show on each track's own page.
    into_track(page, "Thruxton")
    expect(badge("a1")).to_have_text("Platinum 1st")
    expect(badge("a1")).to_have_class(re.compile(r"tp-rank-1"))
    # Only the session holding the place; none on a private one.
    expect(badge("a2")).to_have_count(0)
    page.locator(".tp-back").click()
    into_track(page, "Cadwell Park")
    expect(badge("c1")).to_have_text("Gold 2nd")
    page.locator(".tp-back").click()
    into_track(page, "Donington Park")
    expect(badge("d1")).to_have_text("Silver 3rd")
    page.locator(".tp-back").click()
    into_track(page, "Oulton Park")
    expect(badge("e1")).to_have_text("11th")
    expect(badge("e1")).to_have_class(re.compile(r"tp-rank-n"))
    expect(badge("e1")).to_have_attribute("title", "11th of 11 on the Oulton Park leaderboard")
    page.locator(".tp-back").click()
    into_track(page, "Brands Hatch")
    expect(badge("b1")).to_have_count(0)
    # And on the session page.
    fake.sessions["a1"] = dict(fake.index[0], laps=[], trace={"laps": {}}, mine=True)
    page.locator(".tp-back").click()
    into_track(page, "Thruxton")
    page.locator('#tp-sess-list .tp-row[data-sid="a1"]').click()
    expect(page.locator("#tp-rank-slot .tp-rank")).to_have_text("Platinum 1st")


def test_a_car_not_on_the_board_gets_no_trophy(page):
    fake = FakeWorker(earlier=False)
    fake.index = [shared_session("a1", "thruxton", "Thruxton", "main", 100)]
    fake.boards = {"/track/board:thruxton:main": [board_row("o1", "x", 90)]}
    open_page(page, fake)
    into_track(page, "Thruxton")
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
    expect(page.locator("#tp-key")).to_contain_text("Ann, best, 28/05 (B)")
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
    expect(page.locator("#tp-speeds .chip")).to_have_text(["x0.25", "x0.5", "x1", "x2", "x5"])
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
    expect(group.locator("option")).to_have_text(["Ann, Blue Y, 1:49.80"])
    page.locator("#tp-cmp-b").select_option("x:m1")
    expect(page.locator("#tp-key")).to_contain_text("Ann, best, 28/05 (B)")
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
    page.locator("#tp-map2").scroll_into_view_if_needed()
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


def test_a_build_page_shows_its_kerb_weight_and_pads(page):
    """A car's page says its kerb weight (the owner's figure, else the vehicle list's for the model) and the pads
    fitted, and each shared session names the pads it was run on."""
    fake = FakeWorker()
    fake.index.append(dict(fake.index[0], id="padded", privacy="board", pads="Pagid RSL29", date="2026-06-02"))
    fake.public_car = {"version": "Performance", "pads": "Front: Pagid RSL29, rear: Pagid RS29"}
    open_page(page, fake, path="/track.html?car=car1")
    kit = page.locator("#tp-car-kit")
    expect(kit).to_contain_text("Kerb weight 1,845 kg (maker's figure)")
    expect(kit).to_contain_text("Pads: Front: Pagid RSL29, rear: Pagid RS29")
    expect(page.locator(".tp-row[data-sid='padded']")).to_contain_text("Pagid RSL29")
    fake.public_car = {"version": "Performance", "weight": 1790}
    page.reload()
    expect(page.locator("#tp-car-kit")).to_have_text("Kerb weight 1,790 kg (owner's figure)")
    # No version: the model's own figure from the vehicle list, and no pads line.
    fake.public_car = {}
    page.reload()
    expect(page.locator("#tp-car-kit")).to_have_text("Kerb weight 1,765 kg (maker's figure)")


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


SHELSLEY_FIXTURE = ROOT / "tests" / "fixtures" / "shelsley-climb-and-descent.vbo"


def test_the_line_figures_are_shown_in_full_and_the_map_keeps_its_zoom_when_a_marker_is_placed(page):
    """Both ends of each line are shown as full latitude and longitude figures, with a Copy button, before the member
    saves. Placing a marker while zoomed in does not send the map back to the whole view."""
    def handler(route):
        d = json.loads((ROOT / "data" / "tracks.json").read_text(encoding="utf-8"))
        d["venues"] = [v for v in d["venues"] if v["id"] != "shelsley-walsh"]
        route.fulfill(status=200, content_type="application/json", body=json.dumps(d))
    page.route(re.compile(r".*/data/tracks\.json.*"), handler)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(SHELSLEY_FIXTURE))
    page.locator("[data-type] button[data-v='sprint']").click()
    page.locator("#tp-venue-name").fill("Shelsley test")
    page.locator("#tp-tap").wait_for(state="attached", timeout=15000)
    # Zoom in on the map, then place the first marker.
    svg = page.locator("#tp-tap")
    before = svg.get_attribute("viewBox")
    page.locator("#tp-tapmap .tv-zoom-btns button").first.click()
    page.locator("#tp-tapmap .tv-zoom-btns button").first.click()
    zoomed = svg.get_attribute("viewBox")
    assert zoomed != before
    box = svg.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    expect(page.locator("#tp-tap .tp-tapmark")).to_have_count(1)
    after = page.locator("#tp-tap").get_attribute("viewBox")
    w = lambda v: float(v.split()[2])
    assert w(after) < w(before) * 0.9, (before, zoomed, after)
    # The second marker too, then the full figures of both lines.
    box = svg.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2 + 40, box["y"] + box["height"] / 2 + 10)
    expect(page.locator("#tp-tap .tp-tapmark")).to_have_count(2)
    figs = page.locator("#tp-figs")
    expect(figs).to_contain_text("Start line")
    expect(figs).to_contain_text("Finish line")
    nums = [n.replace("\n", ", ") for n in figs.locator(".tp-fignum").all_inner_texts()]
    assert len(nums) == 2 and all(re.fullmatch(r"-?\d+\.\d{7}(, -?\d+\.\d{7}){3}", n) for n in nums), nums
    expect(figs.get_by_role("button", name=re.compile("Copy the"))).to_have_count(2)


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


def test_a_sprint_says_which_signal_started_its_clock(page):
    """A standing start's session page says whether the accelerometer or the speed started the clock on the best run."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _course(HILL_FINISH, 1500))
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    page.locator("[data-type] button[data-v='sprint']").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("2 timed runs")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    # Rolling laps in this file: no standing start, so nothing is said.
    expect(page.locator("#tp-launch")).to_have_count(0)
    fake.sessions["new1"]["launch"] = {"from": "g", "lead": 0.27}
    page.reload()
    expect(page.locator("#tp-launch")).to_have_text(re.compile(r"Clock started from the accelerometer, 0\.27 s before the speed rose"))
    fake.sessions["new1"]["launch"] = {"from": "speed", "lead": 0}
    page.reload()
    expect(page.locator("#tp-launch")).to_contain_text("Clock started from the speed")


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


def test_speed_is_written_above_the_cursor_not_drawn_as_a_chart(page):
    """There is no Speed chart: the speed of each lap shows above the cursor on the top chart, and follows it."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    expect(page.locator("#tp-gtoggles .chip", has_text="Speed")).to_have_count(0)
    expect(page.locator("#tp-gforce svg[data-g='spd']")).to_have_count(0)
    speed = page.locator("#tp-gforce .tp-gspeed")
    expect(speed).to_be_hidden()
    svg = page.locator("#tp-gforce svg").first
    svg.scroll_into_view_if_needed()
    box = svg.bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.4, box["y"] + box["height"] / 2)
    expect(speed).to_be_visible()
    first = speed.text_content()
    assert re.fullmatch(r"\d+ mph(\s+\d+ mph)?", first.strip()), first
    page.mouse.move(box["x"] + box["width"] * 0.8, box["y"] + box["height"] / 2)
    assert speed.text_content() != first
    # It is the speed the map and the figures under it show for the same moment, in the same unit.
    page.locator("#tp-scrub").evaluate("el => { el.value = 30; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    a_v = page.locator('#tp-metrics [data-m="a-v"]').inner_text()
    assert a_v in speed.text_content(), (a_v, speed.text_content())
    # It sits above the plot, clear of the chart's own title row.
    sb, tb = speed.bounding_box(), page.locator("#tp-gforce svg").first.bounding_box()
    assert tb["y"] <= sb["y"] and sb["y"] + sb["height"] <= tb["y"] + 32, (sb, tb)


def test_braking_g_has_its_own_chart_from_zero_up_with_its_max_line(page):
    """Braking G is the lengthways g below zero drawn upwards: its scale never goes below 0 g, it has a dashed line and a
    dot at the hardest stop, and the same figure is listed under the charts."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-gtoggles .chip", has_text="Braking G").click()
    chart = page.locator("#tp-gforce svg[data-g='brk']")
    expect(chart).to_have_count(1)
    labels = [x.strip() for x in chart.locator("text[text-anchor='end']").all_text_contents()]
    assert labels and labels[0] == "0 g" and all(not l.startswith("-") for l in labels), labels
    expect(chart.locator("line.tp-gmaxline")).not_to_have_count(0)
    expect(chart.locator("circle.tp-gpeak")).not_to_have_count(0)
    line = page.locator("#tp-gpeaks").inner_text()
    assert re.search(r"Braking G: Max braking (A \d\.\d\d g, B \d\.\d\d g|\d\.\d\d g)", line), line
    # The figure is the hardest braking in the note, as on the Acceleration chart.
    big = max(float(m) for m in re.findall(r"(\d\.\d\d) g", line))
    assert any(abs(big - float(m)) < 0.011 for m in re.findall(r"([\d.]+) g braking", page.locator("body").inner_text())), (big, line)


def test_holding_on_the_cornering_chart_can_reach_the_max_figure(page):
    """Sweeping a finger or mouse across the Cornering G chart reads recorded rows, so it reaches the figure in the Max
    label instead of stopping short between two rows."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    label = page.locator("#tp-gpeaks .tp-gmax").first.text_content()
    top = float(re.search(r"A (\d\.\d\d) g", label).group(1))
    svg = page.locator("#tp-gforce svg").first
    svg.scroll_into_view_if_needed()
    box = svg.bounding_box()
    seen = []
    for i in range(0, 241):
        page.mouse.move(box["x"] + 46 + (box["width"] - 58) * i / 240, box["y"] + box["height"] / 2)
        tip = page.locator(".tv-tip")
        if tip.count() and tip.first.is_visible():
            m = re.search(r"Corner, A\s*([+-]?\d\.\d\d) g", tip.first.inner_text())
            if m:
                seen.append(abs(float(m.group(1))))
    assert seen and max(seen) >= top - 0.005, (max(seen) if seen else None, top, label)
    # Every reading is a recorded one (a row of the stored lap data), never a blend of two rows.
    saved = fake.saved[0]["session"]
    recorded = {round(abs(r[5]), 2) for r in saved["trace"]["laps"][str(saved["best"])]}
    odd = [v for v in seen if not any(abs(v - r) < 0.0051 for r in recorded)]
    assert not odd, odd[:5]


def test_g_force_lines_can_be_switched_on_and_off(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    toggles = page.locator("#tp-gtoggles .chip")
    expect(toggles).to_have_text(["Acceleration G", "Braking G", "Cornering G"])
    # A session opens showing one measure, cornering: one chart, lap A blue and lap B orange, two dots, no dashes.
    expect(page.locator("#tp-gtoggles .chip.is-on")).to_have_text(["Cornering G"])
    charts, lines = page.locator("#tp-gforce svg"), page.locator("#tp-gforce path[stroke-width]")
    expect(charts).to_have_count(1)
    expect(page.locator("#tp-gforce .tp-gtitle")).to_have_count(0)  # one chart needs no name beside the chip
    expect(lines).to_have_count(2)
    expect(page.locator("#tp-gforce path[stroke='#2a78d6']")).to_have_count(1)
    expect(page.locator("#tp-gforce path[stroke='#eb6834']")).to_have_count(1)
    expect(page.locator("#tp-gforce path[stroke-dasharray]")).to_have_count(0)
    expect(page.locator("#tp-gforce circle:not(.tp-gpeak)")).to_have_count(2)
    expect(page.locator("#tp-gnote")).to_contain_text("Blue:")
    expect(page.locator("#tp-gnote")).to_contain_text("Orange:")
    # Cornering keeps its sign: the g scale runs below zero as far as above it, as RaceBox draws it.
    labels = [x.strip() for x in page.locator("#tp-gforce text[text-anchor='end']").all_text_contents()]
    assert labels and labels[0].startswith("-") and labels[0][1:] == labels[-1], labels
    expect(page.locator("#tp-gforce text[text-anchor='start']")).to_have_count(0)
    # The biggest cornering g of the lap is drawn as a dashed line and named, the same figure as the note below.
    maxes = [t.strip() for t in page.locator("#tp-gpeaks .tp-gmax").all_text_contents()]
    # One maximum for cornering (whichever way it was), the same figure as the note below.
    assert 1 <= len(maxes) <= 2 and all(re.fullmatch(r"Max ((A \d\.\d\d g)?(, )?(B \d\.\d\d g)?|\d\.\d\d g)", t) for t in maxes), maxes
    expect(page.locator("#tp-gforce line.tp-gmaxline")).not_to_have_count(0)
    big = max(float(re.search(r"(\d\.\d\d) g", t).group(1)) for t in maxes)
    assert any(abs(big - float(m)) < 0.011 for m in re.findall(r"([\d.]+) g cornering", page.locator("body").inner_text())), (big, maxes)
    # More measures each get a chart of their own, stacked, the two cars in their colours on each; the time labels
    # sit under the last one only.
    toggles.nth(0).click()
    expect(toggles.nth(0)).to_have_attribute("aria-pressed", "true")
    expect(charts).to_have_count(2)
    expect(lines).to_have_count(4)
    expect(page.locator("#tp-gforce svg[data-g='acc'] path[stroke='#2a78d6']")).to_have_count(1)
    toggles.nth(1).click()
    expect(charts).to_have_count(3)
    expect(lines).to_have_count(6)
    # Stacked charts are each named in their corner, in the order they are drawn.
    expect(page.locator("#tp-gforce .tp-gtitle")).to_have_text(["Acceleration G", "Braking G", "Cornering G"])
    expect(page.locator("#tp-gforce path[stroke-dasharray]")).to_have_count(0)
    assert [c.bounding_box()["y"] for c in charts.all()] == sorted(c.bounding_box()["y"] for c in charts.all())
    expect(page.locator("#tp-gforce svg[data-g='acc'] text[text-anchor='middle']:not(.tp-gspeed)")).to_have_count(0)
    assert page.locator("#tp-gforce svg[data-g='cor'] text[text-anchor='middle']:not(.tp-gspeed)").count() > 2
    toggles.nth(0).click()
    toggles.nth(1).click()
    expect(charts).to_have_count(1)
    expect(lines).to_have_count(2)
    # Nothing on says so.
    toggles.nth(2).click()
    expect(page.locator("#tp-gnote")).to_have_text("Turn a line on to see it.")
    expect(lines).to_have_count(0)
    # Each session opens with cornering alone again.
    page.reload()
    expect(page.locator("#tp-gtoggles .chip.is-on")).to_have_text(["Cornering G"])
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
    # Before any play the figures show where both laps start, not dashes.
    expect(page.locator('#tp-metrics [data-m="a-v"]')).to_have_text(re.compile(r"^\d+ mph$|^\d+\.\d mph$"))
    page.locator("#tp-scrub").evaluate("el => { el.value = 30; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    expect(page.locator('#tp-metrics [data-m="a-v"]')).to_have_text(re.compile(r"^\d+ mph$|^\d+\.\d mph$"))
    expect(page.locator('#tp-metrics [data-m="a-acc"]')).to_have_text(re.compile(r"^[+-]\d\.\d\d g$"))
    expect(page.locator('#tp-metrics [data-m="a-cor"]')).to_have_text(re.compile(r"^[+-]\d\.\d\d g$"))
    expect(page.locator('#tp-metrics [data-m="gap"]')).to_have_text(re.compile(r"^A is \d+\.\d\d s (ahead|behind)$"))
    first = page.locator('#tp-metrics [data-m="a-v"]').inner_text()
    page.locator("#tp-scrub").evaluate("el => { el.value = 60; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    assert page.locator('#tp-metrics [data-m="a-v"]').inner_text() != first


def test_the_map_can_go_full_screen_with_the_numbers_along_the_bottom(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-scrub").evaluate("el => { el.value = 30; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    # Full screen is switched on from the map's own button; the heading only has the way out.
    full, mapFull = page.locator("#tp-full"), page.locator("#tp-mapwrap .tv-zoom-full")
    expect(full).to_be_hidden()
    expect(mapFull).to_have_attribute("aria-label", "Full screen map")
    mapFull.click()
    card = page.locator("#tp-mapcard")
    expect(card).to_have_class(re.compile(r"is-full"))
    expect(full).to_have_text("Exit full screen")
    expect(page.locator("#tp-mapwrap .tv-zoom-full")).to_have_attribute("aria-label", "Exit full screen")
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
    expect(full).to_be_hidden()
    assert not page.evaluate("document.body.classList.contains('tp-noscroll')")
    assert float(page.locator("#tp-scrub").input_value()) > 30


def test_full_screen_map_on_a_phone(page):
    page.set_viewport_size({"width": 390, "height": 844})
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    expect(page.locator("#tp-rotate-hint")).to_be_hidden()
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    assert overflow_width(page) <= 0
    mb = page.locator("#tp-map2").bounding_box()
    assert mb["height"] > 200 and mb["width"] <= 390, mb
    for sel in ("#tp-play-toggle", "#tp-metrics", "#tp-gforce"):
        box = page.locator(sel).bounding_box()
        assert box and box["y"] + box["height"] <= 845, (sel, box)
    # Upright, a hint to turn the phone; the chart gets a decent share of the screen.
    expect(page.locator("#tp-rotate-hint")).to_be_visible()
    assert page.locator("#tp-gforce").bounding_box()["height"] >= 160
    # All three charts on: the stack is held back so the map keeps its room, and everything still fits the screen.
    toggles = page.locator("#tp-gtoggles .chip")
    toggles.nth(0).click()
    toggles.nth(1).click()
    expect(page.locator("#tp-gforce svg")).to_have_count(3)
    mb = page.locator("#tp-map2").bounding_box()
    assert mb["height"] >= 170, mb
    gb = page.locator("#tp-gforce").bounding_box()
    assert gb["height"] <= 250 and gb["y"] + gb["height"] <= 845, gb
    toggles.nth(0).click()
    toggles.nth(1).click()
    # A phone on its side: the map takes the whole screen, with the controls and numbers laid over it.
    page.set_viewport_size({"width": 844, "height": 390})
    page.wait_for_timeout(300)
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    expect(page.locator("#tp-rotate-hint")).to_be_hidden()
    assert overflow_width(page) <= 0
    mb = page.locator("#tp-map2").bounding_box()
    assert mb["height"] >= 380 and mb["width"] >= 480, mb
    for sel in ("#tp-play-toggle", "#tp-mapwrap .tv-zoom-full", "#tp-mopts-btn"):
        box = page.locator(sel).bounding_box()
        assert box and box["y"] >= 0 and box["y"] + box["height"] <= 390 and box["x"] + box["width"] <= 844, (sel, box)
    expect(page.locator("#tp-play-toggle")).to_be_visible()
    # The G-force pills sit with the playback controls on the left (as in portrait); the speed and G figures float over
    # the map under a row of column names, so the charts panel is left to the charts.
    # The speed shows beside each car's dot on the map; the block of figures is left out.
    expect(page.locator("#tp-metrics")).to_be_hidden()
    page.locator("#tp-scrub").evaluate("el => { el.value = 30; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    labels = page.locator("#tp-map2 .tv-dotlabel text")
    expect(labels).to_have_count(2)
    expect(labels.first).to_be_visible()
    expect(labels.first).to_have_text(re.compile(r"^\d+ mph$|^\d+\.\d mph$"))
    expect(page.locator("#tp-gbox #tp-gtoggles")).to_have_count(1)
    # Map options: a small button on the left of the map, closed to begin with, opens a card with the colour switch and
    # the speed-on-cars switch (the labels beside the dots). The charts switch is named for what it shows, and the
    # map's own full screen button is left out, so only Exit (in the charts panel) leaves full screen.
    expect(page.locator("#tp-mopts-btn")).to_be_visible()
    expect(page.locator("#tp-mopts-card")).to_be_hidden()
    page.locator("#tp-mopts-btn").click()
    expect(page.locator("#tp-mopts-card")).to_be_visible()
    expect(page.locator("#tp-mopts-card #tp-speedcol")).to_be_visible()
    expect(page.locator("#tp-mopts-card #tp-carspeed")).to_be_visible()
    expect(labels.first).to_be_visible()
    page.locator("#tp-carspeed").click()
    expect(labels.first).to_be_hidden()
    page.locator("#tp-carspeed").click()
    expect(labels.first).to_be_visible()
    page.locator("#tp-mopts-x").click()
    expect(page.locator("#tp-mopts-card")).to_be_hidden()
    expect(page.locator("#tp-mopts-btn")).to_be_visible()
    expect(page.locator("#tp-gshow")).to_contain_text("Show G-Forces")
    # Who is who, with the date and the time of day at the playhead, at the foot of the controls.
    expect(page.locator("#tp-play #tp-when")).to_be_visible()
    expect(page.locator("#tp-when .tp-wrow")).to_have_count(2)
    expect(page.locator('#tp-when [data-w="a"]')).to_have_text(re.compile(r"^28/05/\d\d \d\d:\d\d:\d\d$"))
    expect(page.locator("#tp-when .tp-wrow b").first).to_have_text("You, L2")
    t0 = page.locator('#tp-when [data-w="a"]').inner_text()
    page.locator("#tp-scrub").evaluate("el => { el.value = 60; el.dispatchEvent(new Event('input', {bubbles: true})); }")
    expect(page.locator('#tp-when [data-w="a"]')).not_to_have_text(t0)
    expect(page.locator("#tp-full")).to_be_hidden()
    expect(page.locator("#tp-mapwrap .tv-zoom-full")).to_have_attribute("aria-label", "Exit full screen")
    # The charts have a panel on the right, with the chips and the slider, beside a map that keeps most of the width.
    expect(page.locator("#tp-gforce svg")).to_have_count(1)
    expect(page.locator("#tp-gforce svg").first).to_be_visible()
    expect(page.locator("#tp-scrub")).to_be_visible()
    gb, mb = page.locator("#tp-gbox").bounding_box(), page.locator("#tp-map2").bounding_box()
    assert gb["x"] >= mb["x"] + mb["width"] - 1 and gb["x"] + gb["width"] <= 844 and gb["y"] + gb["height"] <= 390, (gb, mb)
    assert 480 <= mb["width"] <= 530, mb
    # The charts panel has the Show G-Forces switch; leaving full screen is the map's own button, top right.
    sh = page.locator("#tp-gshow").bounding_box()
    assert sh["x"] >= gb["x"] and sh["x"] + sh["width"] <= 844, (sh, gb)
    toggles = page.locator("#tp-gtoggles .chip")
    toggles.nth(0).click()
    toggles.nth(1).click()
    expect(page.locator("#tp-gforce svg")).to_have_count(3)
    for svg in page.locator("#tp-gforce svg").all():
        b = svg.bounding_box()
        assert b["height"] >= 40 and b["y"] + b["height"] <= 390, b
    # The Show G-Forces switch swaps between the map alone and the map with the charts.
    page.locator("#tp-gshow").click()
    expect(page.locator("#tp-gforce")).to_be_hidden()
    assert page.locator("#tp-map2").bounding_box()["width"] >= 830
    page.locator("#tp-gshow").click()
    expect(page.locator("#tp-gforce svg")).to_have_count(3)
    assert 480 <= page.locator("#tp-map2").bounding_box()["width"] <= 530
    # The divider between map and charts drags: the map takes three quarters of the screen, and it is remembered.
    split = page.locator("#tp-split")
    expect(split).to_be_visible()
    sb = split.bounding_box()
    page.mouse.move(sb["x"] + sb["width"] / 2, 200)
    page.mouse.down()
    page.mouse.move(700, 200, steps=5)
    page.mouse.move(633, 200, steps=5)
    page.mouse.up()
    page.wait_for_timeout(300)
    assert 615 <= page.locator("#tp-map2").bounding_box()["width"] <= 650, page.locator("#tp-map2").bounding_box()
    assert page.locator("#tp-gbox").bounding_box()["x"] >= 620
    page.reload()
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    assert 615 <= page.locator("#tp-map2").bounding_box()["width"] <= 650
    page.evaluate("localStorage.removeItem('mt3ukTrackSplit')")
    page.reload()
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    # Charts off: the map has the whole screen, and the switch stays reachable to bring them back.
    page.locator("#tp-gshow").click()
    expect(page.locator("#tp-gforce")).to_be_hidden()
    expect(page.locator("#tp-scrub")).to_be_hidden()
    assert page.locator("#tp-map2").bounding_box()["width"] >= 830
    expect(page.locator("#tp-gshow")).to_be_visible()
    sh, pl = page.locator("#tp-gshow").bounding_box(), page.locator("#tp-play").bounding_box()
    assert sh["y"] + sh["height"] <= pl["y"], (sh, pl)
    page.locator("#tp-gshow").click()
    assert 480 <= page.locator("#tp-map2").bounding_box()["width"] <= 530
    toggles.nth(0).click()
    toggles.nth(1).click()
    page.locator("#tp-mapwrap .tv-zoom-full").click()
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
    # MT3UK is told about the new track, without the member tapping a start line: a track day finds its own.
    assert len(fake.requests) == 1
    req = fake.requests[0]
    assert req["kind"] == "circuit" and req["name"] == "Thruxton Circuit" and req["note"] == "New track"
    assert req["startLine"] and req["lapLength"] and len(req["outline"]) > 10


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


def test_the_track_name_is_required_at_a_track_we_do_not_list(page):
    """No name from the map and none typed: Save stops, points at the box and
    nothing is sent. The member's own name then saves."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _unknown_track)
    _overpass(page, [])
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    name = page.locator("#tp-venue-name")
    expect(name).to_have_value("")
    expect(name).to_have_attribute("required", "")
    expect(page.locator("label[for='tp-venue-name']")).to_contain_text("(required)")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-name-err")).to_contain_text("Enter the name of the track")
    expect(name).to_have_attribute("aria-invalid", "true")
    expect(page.locator("#tp-status")).to_contain_text("Enter the track name first.")
    assert fake.saved == [] and fake.requests == []
    assert page.evaluate("document.activeElement.id") == "tp-venue-name"
    name.fill("Abingdon Airfield")
    expect(page.locator("#tp-name-err")).to_have_count(0)
    expect(name).not_to_have_attribute("aria-invalid", "true")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert fake.saved[0]["venueName"] == "Abingdon Airfield"


def test_a_member_can_add_a_new_track_now_instead_of_waiting_for_the_admin(page):
    """Off by default the track is requested as before. Switched on, saving adds the
    track with the member's start line, re-times the session on it and saves it on the
    new course, so it reaches the leaderboard at once with no request."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _unknown_track)
    _overpass(page, [{"type": "way", "tags": {"name": "Thruxton Circuit"}, "center": {"lat": 51.2100, "lon": -1.6050}}])
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-venue-name")).to_have_value("Thruxton Circuit")
    box = page.locator("#tp-addnow-box")
    expect(box).to_contain_text("Thruxton Circuit is not in the MT3UK track list yet")
    sw = page.locator("#tp-addnow")
    expect(sw).to_have_attribute("aria-checked", "false")
    expect(sw).to_contain_text("MT3UK reviews the track afterwards")
    sw.click()
    expect(sw).to_have_attribute("aria-checked", "true")
    expect(sw).to_contain_text("MT3UK will still review the track")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert len(fake.courses_added) == 1
    added = fake.courses_added[0]
    assert added["kind"] == "circuit" and added["name"] == "Thruxton Circuit" and added["startLine"] and added["lapLength"] > 1000 and len(added["outline"]) > 10
    saved = fake.saved[0]["session"]
    assert saved["venueId"] == "thruxton-circuit" and saved["layoutId"] == "course" and saved["venue"] == "Thruxton Circuit"
    assert len(saved["laps"]) >= 2
    # No request: the admin reviews the added track from the bell instead.
    assert fake.requests == []
    expect(page.locator(".tp-session-head h2")).to_contain_text("Thruxton Circuit")


def test_a_track_that_cannot_be_added_stops_the_save_with_the_reason(page):
    page.route(re.compile(r".*/data/tracks\.json.*"), _unknown_track)
    _overpass(page, [{"type": "way", "tags": {"name": "Thruxton Circuit"}, "center": {"lat": 51.2100, "lon": -1.6050}}])
    fake = FakeWorker()
    fake.course_error = 'A track called "Thruxton" is already listed. Pick that track in the request or rename this one.'
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-venue-name")).to_have_value("Thruxton Circuit")
    page.locator("#tp-addnow").click()
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-status")).to_contain_text("already listed")
    assert fake.saved == [] and len(fake.courses_added) == 1
    expect(page.get_by_role("button", name="Save session")).to_be_enabled()


def test_saving_without_times_also_needs_the_track_name(page, tmp_path):
    no_line = tmp_path / "noline.vbo"
    no_line.write_bytes(b"".join(l for l in FIXTURE.read_bytes().splitlines(True) if not l.startswith(b"Start ")))
    page.route(re.compile(r".*/data/tracks\.json.*"), _without_start_line)
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(no_line))
    page.locator("[data-type] [data-v='sprint']").click()
    page.get_by_role("button", name="Save without times, tell MT3UK").click()
    expect(page.locator("#tp-name-err")).to_be_visible()
    assert fake.saved == [] and fake.requests == []
    page.fill("#tp-venue-name", "Abingdon")
    page.get_by_role("button", name="Save without times, tell MT3UK").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert fake.saved[0]["session"]["pendingCourse"] == "Abingdon"


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
    models = page.locator("#tp-e-tyre-model-pick option").evaluate_all("els => els.map(e => e.value)")
    assert models[0] == "" and models[-1] == "__other" and page.locator("#tp-e-tyre-model-pick").is_visible()
    assert "Pilot Sport 4S" in models and "P Zero" not in models
    page.select_option("#tp-e-tyre-make", "Pirelli")
    assert "P Zero Trofeo R" in page.locator("#tp-e-tyre-model-pick option").evaluate_all("els => els.map(e => e.value)")
    # Any make or model can still be typed.
    page.select_option("#tp-e-tyre-make", "__other")
    expect(page.locator("#tp-e-tyre-other-wrap")).to_be_visible()
    page.fill("#tp-e-tyre-make-other", "Hoosier")
    tyre_model(page, "tp-e-tyre", "R7")
    expect(page.locator("#tp-e-tyre-preview")).to_have_text("Saved as: Hoosier R7")
    page.select_option("#tp-e-tyre-make", "Michelin")
    expect(page.locator("#tp-e-tyre-other-wrap")).to_be_hidden()
    tyre_model(page, "tp-e-tyre", "Pilot Sport 4S")
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
    tyre_model(page, "tp-tyre", "Advan Neova AD09")
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
    assert page.locator("#tp-e-tyre-model-pick option").evaluate_all("els => els.map(e => e.value)") == ["", "Rocket 2", "__other"]
    page.select_option("#tp-e-tyre-make", "Bolt")
    assert page.locator("#tp-e-tyre-model-pick option").evaluate_all("els => els.map(e => e.value)") == ["", "B1", "B2", "__other"]


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
    page.goto("/track-admin.html")
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
    expect(rows.nth(1)).to_contain_text("+1.50 s")
    # The tyres are on the row, without opening anything; the car's other mods are kept for its session page, not shown here.
    expect(rows.first).to_contain_text("Michelin Pilot Sport 4S, 245/35 R19")
    expect(rows.first.locator(".tp-modchip")).to_have_count(0)
    expect(rows.first).not_to_contain_text("Coilovers")
    expect(rows.nth(1)).to_contain_text("Kumho Ecsta PS71")
    # The whole row opens the session through its name.
    expect(rows.first.locator("a.lb-name")).to_have_attribute("href", "track.html?s=a-dry")
    # Conditions: Ann's best wet is her Kumho run; the others have no wet result.
    page.locator("#lb-cond").select_option("Wet")
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Ann's 3")
    expect(rows.first).to_contain_text("1:39.00")
    expect(page.locator("#lb-cond")).to_be_focused()
    page.locator("#lb-cond").select_option("All")
    # Tyre make: each car's best on that make (Ann's only Kumho run was wet).
    page.locator("#lb-make").select_option("Kumho")
    expect(rows).to_have_count(2)
    expect(rows.first).to_contain_text("Ben's Y")
    expect(rows.nth(1)).to_contain_text("Ann's 3")
    expect(rows.nth(1)).to_contain_text("1:39.00")
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
    # Left open, it is open again after the reload.
    expect(page.locator("#car-data")).to_have_attribute("open", "")
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


def _library_admin(page, path):
    store = {"extra": {}}
    puts = []

    def api(route):
        req = route.request
        p = urlparse(req.url).path
        if p == path and req.method == "GET":
            body = {"success": True, "extra": store["extra"]}
        elif p == path and req.method == "PUT":
            lib = json.loads(req.post_data)["library"]
            puts.append(lib)
            store["extra"] = lib
            body = {"success": True, "extra": lib}
        else:
            body = {"success": True}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/%s/**" % API_HOST, api)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/track-admin.html")
    return puts


def test_admin_tyres_maker_data(page):
    puts = _library_admin(page, "/tyres/admin")
    page.locator("#tyres-wrap > summary").click()
    expect(page.locator("#ty-list")).to_contain_text("Michelin")
    page.locator('[data-info="Michelin"]').click()
    row = page.locator('.ty-info-row[data-model="Pilot Sport 4S"]')
    row.locator('[data-f="category"]').select_option("Performance road")
    row.locator('[data-f="wetGrip"]').select_option("A")
    row.locator('[data-f="noise"]').fill("71")
    row.locator('[data-f="ev"]').select_option("Yes")
    page.get_by_role("button", name="Save maker data").click()
    expect(page.locator("#ty-note")).to_have_text("Saved. Track sessions use it straight away.")
    # The make's models are posted with the file's figures and the change on top.
    ps4s = puts[-1]["info"]["Michelin|Pilot Sport 4S"]
    assert {k: ps4s[k] for k in ("category", "wetGrip", "noise", "ev")} == {"category": "Performance road", "wetGrip": "A", "noise": 71, "ev": True}
    assert "Michelin|Pilot Sport 4" in puts[-1]["info"] and not any(k.startswith("Pirelli|") for k in puts[-1]["info"])
    # Opening it again shows what was saved.
    page.locator('[data-info="Michelin"]').click()
    expect(page.locator('.ty-info-row[data-model="Pilot Sport 4S"] [data-f="wetGrip"]')).to_have_value("A")


def test_admin_brake_pads_panel(page):
    puts = _library_admin(page, "/pads/admin")
    page.locator("#pads-wrap > summary").click()
    expect(page.locator("#pd-list")).to_contain_text("Pagid")
    expect(page.locator("#pd-list tbody tr").first).to_contain_text("Original equipment")
    # The maker's figures from data/pads.json.
    expect(page.locator("#pd-list tr", has_text="Ferodo")).to_contain_text("DS2500 Track day, \u03bc 0.41, 0 to 500\u00b0C")
    # Fill in a compound's maker data.
    page.locator('[data-edit="Pagid"]').click()
    assert page.locator("#pd-name").get_attribute("readonly") is not None
    row = page.locator("#pd-rows [data-row]").filter(has=page.locator('[data-f="name"][value="RSL29"]'))
    row.locator('[data-f="use"]').select_option("Track day")
    row.locator('[data-f="mu"]').fill("0.50")
    row.locator('[data-f="tempMin"]').fill("100")
    row.locator('[data-f="tempMax"]').fill("650")
    page.get_by_role("button", name="Save make").click()
    expect(page.locator("#pd-note")).to_have_text("Saved. Track sessions use it straight away.")
    pagid = next(m for m in puts[-1]["makes"] if m["name"] == "Pagid")
    rsl = next(c for c in pagid["compounds"] if c["name"] == "RSL29")
    assert {k: rsl.get(k) for k in ("use", "mu", "tempMin", "tempMax")} == {"use": "Track day", "mu": "0.50", "tempMin": 100, "tempMax": 650}
    expect(page.locator("#pd-list tr", has_text="Pagid")).to_contain_text("Track day, \u03bc 0.50, 100 to 650\u00b0C")
    # Add a make, then take one off.
    page.get_by_role("button", name="Add a make").click()
    page.fill("#pd-name", "Acme Pads")
    page.locator('#pd-rows [data-f="name"]').fill("Race 1")
    page.get_by_role("button", name="Save make").click()
    expect(page.locator("#pd-list")).to_contain_text("Acme Pads")
    assert {"name": "Acme Pads", "compounds": [{"name": "Race 1"}]} in puts[-1]["makes"]
    page.once("dialog", lambda d: d.accept())
    page.locator('[data-remove="EBC"]').click()
    expect(page.locator("#pd-list")).not_to_contain_text("Greenstuff")
    assert {"name": "EBC", "removed": True} in puts[-1]["makes"]


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
    tyre_model(page, "tp-tyre", "Cup 2")
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
    expect(row).to_contain_text("1:42.47")
    expect(row).to_contain_text(re.compile(r"1:39\.79"))
    expect(row.locator("td").nth(3)).to_have_class(re.compile("is-fast"))
    expect(row.locator("td").nth(3)).to_contain_text(re.compile(r"-2\.69 s"))
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
    const eb = [...svg.querySelectorAll('g.tv-edge')].find(x => x.querySelector('text').textContent.startsWith('B'));
    out[name].edgeBPillY = eb ? Number(eb.querySelector('rect').getAttribute('y')) : null;
    out[name].viewW = svg.viewBox.baseVal.width;
  }
  return out;
}"""


def test_map_labels_cannot_be_selected_when_the_map_is_dragged(page):
    """Dragging a session map used to select the corner numbers, which showed as blue boxes."""
    open_page(page, FakeWorker())
    r = page.evaluate("""() => {
      const V = window.MT3UKTrackView;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const host = document.createElement('div');
      host.style.cssText = 'width:400px;height:420px;position:fixed;left:0;top:0;background:#fff;z-index:99999';
      svg.setAttribute('class', 'tv-chart');
      host.appendChild(svg); document.body.appendChild(host);
      const trace = [];
      for (let i = 0; i <= 300; i++) { const d = i * 5; trace.push([d, d / 40, d, 60 * Math.sin(d / 300), 40, 0, 0]); }
      V.map(svg, trace, { mono: true, lines: [{ trace, color: '#2a78d6' }], corners: [{ n: 5, x: 300, y: 40, name: '' }, { n: 7, x: 900, y: 30, name: '' }] });
      const texts = [...svg.querySelectorAll('text')].map(t => getComputedStyle(t).userSelect);
      window.getSelection().selectAllChildren(host);
      return { texts, svg: getComputedStyle(svg).userSelect, selected: window.getSelection().toString() };
    }""")
    assert r["texts"] and all(u == "none" for u in r["texts"]), r
    assert r["svg"] == "none" and r["selected"] == "", r


def test_a_cars_speed_label_flips_away_from_the_map_edge_and_the_gap_tag_is_small(page):
    """In full screen on a phone each car's speed sits beside its dot. At the right edge lap A's label (normally to the
    right) flips to the left, and at the left edge lap B's (normally to the left) flips to the right, so neither is cut
    off. The gap tag by the car behind is a small faded soft-cornered tag on the side away from the speed label."""
    open_page(page, FakeWorker())
    r = page.evaluate("""() => {
      const V = window.MT3UKTrackView;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const host = document.createElement('div');
      host.style.cssText = 'width:600px;height:300px;position:fixed;left:0;top:0;background:#fff;z-index:99999';
      svg.setAttribute('class', 'tv-chart');
      host.appendChild(svg); document.body.appendChild(host);
      const trace = [];
      for (let i = 0; i <= 200; i++) { const d = i * 5; trace.push([d, d / 40, d, 20 * Math.sin(d / 300), 40, 0, 0]); }
      const mo = V.map(svg, trace, { mono: true, lines: [{ trace, color: '#2a78d6' }, { trace, color: '#e8622a' }] });
      mo.setLabel('a', '74 mph'); mo.setLabel('b', '71 mph');
      const lab = l => { const g = [...svg.querySelectorAll('g.tv-dotlabel')][l]; const r = g.querySelector('rect'); return { x: +r.getAttribute('x'), y: +r.getAttribute('y') }; };
      const edge = letter => { const g = [...svg.querySelectorAll('g.tv-edge')].find(x => x.querySelector('text').textContent.startsWith(letter)); const r = g.querySelector('rect'); return { vis: g.getAttribute('visibility'), y: +r.getAttribute('y'), h: +r.getAttribute('height'), rx: +r.getAttribute('rx'), op: +r.getAttribute('fill-opacity'), text: g.querySelector('text').textContent }; };
      const out = {};
      mo.setGap(2.0);
      mo.placeA(trace[100]); mo.placeB(trace[90]);
      out.mid = { a: lab(1), b: lab(0), edgeB: edge('B') };
      mo.placeA(trace[200]); mo.placeB(trace[0]);
      out.ends = { a: lab(1), b: lab(0) };
      return out;
    }""")
    # Mid-map: A's label to the right and below its dot, B's to the left and above; B (behind) carries a small tag below.
    assert r["mid"]["a"]["x"] > 0 and r["mid"]["a"]["y"] > 0, r["mid"]
    assert r["mid"]["b"]["x"] < 0 and r["mid"]["b"]["y"] < 0, r["mid"]
    e = r["mid"]["edgeB"]
    assert e["vis"] == "visible" and e["text"] == "B +2.0 s" and e["y"] > 8 and e["h"] <= 18 and e["rx"] <= 6 and e["op"] < 1, e
    # At the ends: A at the right edge flips to the left, B at the left edge flips to the right.
    assert r["ends"]["a"]["x"] < 0, r["ends"]
    assert r["ends"]["b"]["x"] > 0, r["ends"]


def test_follow_glides_between_both_cars_and_the_leader(page):
    open_page(page, FakeWorker())
    r = page.evaluate(FOLLOW_HARNESS, [[
        ["both", 200, 185, 600, 1.9],
        ["apart", 200, 150, 700, 4.4],
        ["near the limit", 200, 172, 600, 3.0],
        ["close again", 200, 190, 700, 1.2],
    ]])
    w = r["both"]["viewW"]
    # Close together: centred between the two, both in view. The car behind still carries its gap beside its dot;
    # the leader has nothing.
    assert r["both"]["after"]["toMid"] < 0.5, r["both"]
    assert r["both"]["edgeA"] is None and r["both"]["edgeB"] == "B +1.9 s", r["both"]
    # The gap pill sits below lap B's dot, clear of its speed bubble (up and to the left of the dot in full screen on a
    # phone on its side), which it used to cover.
    assert r["both"]["edgeBPillY"] > 8, r["both"]
    # The slower car drops back: the view glides to the leader, not one jump.
    assert r["apart"]["now"]["toLeader"] > 0.25 * w, r["apart"]
    assert r["apart"]["after"]["toLeader"] < 0.5, r["apart"]
    assert r["apart"]["after"]["maxStep"] < 0.2 * w, r["apart"]
    # The car off screen gets an arrow at the edge with the gap.
    assert r["apart"]["edgeB"] == "B, 4.4 s behind", r["apart"]
    assert r["apart"]["edgeA"] is None
    # A gap just under the limit doesn't flick straight back to both.
    assert r["near the limit"]["after"]["toLeader"] < 0.5, r["near the limit"]
    # Close again: back between the two, gliding, and the arrow goes (the gap stays beside the car behind).
    assert r["close again"]["after"]["toMid"] < 0.5, r["close again"]
    assert r["close again"]["after"]["maxStep"] < 0.2 * w
    assert r["close again"]["edgeB"] == "B +1.2 s", r["close again"]


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
    # The five speed chips fit on one row; Follow cars may sit on the row below them.
    ys = {round(c.bounding_box()["y"]) for c in page.locator("#tp-speeds .chip").all()}
    assert len(ys) == 1, ys
    assert overflow_width(page) <= 0


def test_g_force_and_speed_chart_has_thin_lines_and_can_be_hidden(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    lines = page.locator("#tp-gforce path[stroke-width]")
    expect(lines).to_have_count(2)
    assert set(lines.evaluate_all("els => els.map(e => e.getAttribute('stroke-width'))")) == {"1.5"}
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
    expect(key).to_contain_text(re.compile(r"L\d, 28/05 \(A\)"))
    expect(key).to_contain_text(re.compile(r"L\d, 28/05 \(B\)"))
    expect(page.locator("#tp-metrics")).to_contain_text(re.compile(r"L\d, 28/05 \(A\)"))
    # Your best on another day says so, with that day.
    earlier = member_session(fake.sessions["new1"])
    earlier["date"] = "2026-03-28"
    fake.sessions["earlier1"] = earlier
    page.locator("#tp-cmp-b").select_option("x:earlier1")
    expect(key).to_contain_text("You, best, 28/03 (B)")


def test_the_off_screen_label_is_white_on_the_cars_colour(page):
    open_page(page, FakeWorker())
    r = page.evaluate(FOLLOW_HARNESS, [[["both", 200, 185, 300, 1.9], ["apart", 200, 150, 600, 3.8]]])
    assert r["apart"]["edgeB"] == "B, 3.8 s behind"
    fill = page.evaluate("""() => { const t = [...document.querySelectorAll('g.tv-edge')].find(g => g.getAttribute('visibility') === 'visible').querySelector('text'); return getComputedStyle(t).fill; }""")
    assert fill == "rgb(255, 255, 255)", fill


def test_the_chart_is_on_time_and_moving_over_it_moves_playback(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    gs = page.locator("#tp-gforce svg").first
    gs.scroll_into_view_if_needed()
    # The time axis is the ruler: minutes and seconds along the bottom.
    labels = gs.locator("text[text-anchor='middle']:not(.tp-gspeed)").evaluate_all("els => els.map(e => e.textContent)")
    assert labels[0] == "0:00" and all(re.match(r"^\d+:\d\d$", t) for t in labels), labels
    expect(page.locator("#tp-ruler")).to_be_hidden()
    # The slider sits under the chart, with its ends at the chart's axis.
    sb, gb = page.locator("#tp-scrub").bounding_box(), gs.bounding_box()
    assert sb["y"] > gb["y"] + gb["height"] - 4
    # Inside the chart's margins: the g scale on the left, and a narrow edge on the right (no second scale there now).
    assert sb["x"] > gb["x"] + 30 and sb["x"] + sb["width"] < gb["x"] + gb["width"] - 8, (sb, gb)
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
    expect(laps.locator("summary")).to_contain_text(re.compile(r"Laps\s*\d+ laps, best 1:39\.79"))
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
    # On the Laps pages it is small writing above the Laps logo, not a badge in the heading.
    expect(page.locator("header .laps-logo .laps-logo-early")).to_have_text("Early preview")
    expect(page.locator(".page-hero .early-badge")).to_have_count(0)
    early, name = page.locator(".laps-logo-early").bounding_box(), page.locator("header .laps-logo-name").bounding_box()
    mark = page.locator("header .laps-logo-mark").bounding_box()
    # It sits above the whole logo: level with the mark's left edge, which now starts the logo.
    assert early["y"] + early["height"] <= name["y"] + 1 and abs(early["x"] - mark["x"]) < 2
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
    tyre_model(page, "tp-tyre", "Something typed")
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


SHELSLEY_START = [[52.264945, -2.4098672], [52.2651634, -2.4098402]]
SHELSLEY_FINISH = [[52.2598990, -2.4135109], [52.2598692, -2.4138598]]


def _shelsley_with_an_organiser(page):
    """The track list with Shelsley Walsh's course run by MAC, with its start and finish lines set."""
    def handler(route):
        d = json.loads((ROOT / "data" / "tracks.json").read_text(encoding="utf-8"))
        v = [x for x in d["venues"] if x["id"] == "shelsley-walsh"][0]
        v["layouts"] = [{"id": "hill", "name": "Shelsley Walsh", "organizer": "MAC", "startLine": SHELSLEY_START, "finishLine": SHELSLEY_FINISH}]
        route.fulfill(status=200, content_type="application/json", body=json.dumps(d))
    page.route(re.compile(r".*/data/tracks\.json.*"), handler)


def test_a_known_venue_lists_its_organisers_and_a_new_one_can_use_an_existing_courses_lines(page):
    """At a listed sprint venue the Organiser box is a drop-down of the organisers it already has. Add a new organiser
    opens a name box and a choice of start and finish lines: the same as an existing course (the run is timed at once
    on them) or Set them on the map. Typing a new name no longer sends the member straight to the map."""
    _shelsley_with_an_organiser(page)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(SHELSLEY_FIXTURE))
    page.locator("[data-type] button[data-v='sprint']").click()
    org = page.locator("select#tp-organiser")
    expect(org).to_be_visible()
    assert org.locator("option").all_text_contents() == ["Choose an organiser", "MAC", "Add a new organiser"]
    expect(page.locator("#tp-organiser-new")).to_have_count(0)
    # The listed organiser: timed on the course's own lines.
    org.select_option("MAC")
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("33.0")
    # A new organiser: a name box and the lines choice, starting on the existing course's lines.
    org.select_option("__new")
    expect(page.locator("#tp-organiser-new")).to_be_visible()
    lines = page.locator("select#tp-org-lines")
    expect(lines).to_have_value("hill")
    assert lines.locator("option").all_text_contents() == ["Same as MAC", "Set them on the map"]
    page.locator("#tp-organiser-new").fill("B19")
    page.locator("#tp-organiser-new").press("Tab")
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("33.0")
    expect(page.locator("#tp-tap")).to_have_count(0)
    expect(page.locator("select#tp-organiser")).to_have_value("__new")
    expect(page.locator("#tp-organiser-new")).to_have_value("B19")
    # Set them on the map: the map picker asks for the lines, and the name is kept.
    lines.select_option("")
    expect(page.locator("#tp-tap-step")).to_have_text("Tap the start line, then the finish line.")
    expect(page.locator("#tp-organiser-new")).to_have_value("B19")
    # Back to the course's lines, saved with the new organiser.
    page.locator("select#tp-org-lines").select_option("hill")
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("33.0")
    page.locator("#tp-logger").select_option("Dragy")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head h2")).to_have_text("Shelsley Walsh, B19")
    expect(page.locator("#tp-kind")).to_have_text("Hill climb")


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
        page.select_option("#tp-logger", "Dragy")
        page.get_by_role("button", name="Save session").click()
        expect(page.locator(".tp-tile .k", has_text="0 to 30 mph")).to_be_visible()
        expect(page.locator(".tp-table th", has_text="0-30")).to_be_visible()
        expect(page.locator(".tp-small", has_text="first movement").first).to_be_visible()
    finally:
        path.unlink()


def test_a_launch_that_stops_short_of_60_mph_is_listed_as_a_run(page):
    """A launch that reaches 30 mph but not 60 mph is a run, with a dash for the figures it did not reach. RaceBox lists
    it; the site used to drop it."""
    import math
    rows, x = ["time,latitude,longitude,speed (mph)"], 0.0
    def v_at(t):
        if t < 4: return 0
        if t < 14: return 45 * (t - 4) / 10
        if t < 24: return 45 * (24 - t) / 10
        if t < 28: return 0
        if t < 48: return 100 * (1 - math.exp(-(t - 28) / 6))
        if t < 58: return 100 * (1 - math.exp(-20 / 6)) * (58 - t) / 10
        return 0
    for i in range(0, 620):
        t = i / 10; v = max(0.0, v_at(t)); x += v * 0.44704 * 0.1
        rows.append("%.1f,%.7f,%.7f,%.2f" % (t, 51.5 + x / 110540, -0.12, v))
    path = ROOT / "tests" / "fixtures" / "_tmp_two_launches.csv"
    path.write_text("\n".join(rows), encoding="utf-8")
    try:
        fake = FakeWorker(admin=True)
        open_page(page, fake, "/track.html?add=1&car=car1", admin=True)
        page.set_input_files("#tp-file", str(path))
        page.locator("[data-type] [data-v='drag']").click()
        page.locator("#tp-street").click()
        page.select_option("#tp-logger", "Dragy")
        page.get_by_role("button", name="Save session").click()
        expect(page.locator(".tp-tile .k", has_text="Runs")).to_be_visible()
        rows_ = page.locator(".tp-table tbody tr")
        expect(rows_).to_have_count(2)
        cells = rows_.nth(0).locator("td").all_inner_texts()
        assert cells[3] == "-" and cells[2] != "-", cells  # 0-30 reached, 0-60 not
        assert rows_.nth(1).locator("td").all_inner_texts()[3] != "-"
        assert len(fake.saved[0]["session"]["runs"]) == 2
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
        page.select_option("#tp-logger", "Dragy")
        page.get_by_role("button", name="Save session").click()
        expect(page.locator(".tp-small", has_text="1 ft rollout").first).to_be_visible()
        assert fake.saved[0]["session"].get("rollout") is True
    finally:
        path.unlink()


def save_fixture_session(page, fake):
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))


def test_a_session_warns_when_a_faster_pass_crosses_the_lines_the_other_way_round(page):
    """If the drive back down was timed instead of the climb, the session says the start and finish may be the wrong
    way round. A session with no such note has no warning."""
    fake = FakeWorker()
    save_fixture_session(page, fake)
    expect(page.locator("#tp-reverse")).to_have_count(0)
    rec = fake.sessions["new1"]
    rec["type"] = "sprint"
    rec["reverseRun"] = {"peak": 154.3, "time": 56.1, "fwdPeak": 53.4}
    page.reload()
    box = page.locator("#tp-reverse")
    expect(box).to_contain_text("The start and finish may be the wrong way round")
    expect(box).to_contain_text("a faster pass")
    expect(box).to_contain_text("0:56.10")


def test_the_refresh_button_loads_the_page_again_from_the_latest_version(page):
    """Refresh is on the list of sessions and on a session. It fetches the page's own files again and reloads, so the
    member sees what is live now, and the member stays on the same view."""
    fake = FakeWorker()
    save_fixture_session(page, fake)
    expect(page.get_by_role("button", name="Refresh this page from the latest version")).to_be_visible()
    seen = []
    page.on("request", lambda r: seen.append(r.url))
    page.get_by_role("button", name="Refresh this page from the latest version").click()
    expect(page.locator("#tp-sid-text")).to_have_text("new1")
    assert any(u.split("?")[0].endswith("/js/track-page.js") for u in seen), seen[:10]
    assert any("/data/tracks.json" in u for u in seen)
    assert "s=new1" in page.url
    page.locator(".tp-back").click()
    expect(page.get_by_role("button", name="Refresh this page from the latest version")).to_be_visible()


def test_the_session_id_is_shown_with_a_copy_button(page):
    """The owner sees the session id on their session, with a button that copies it."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    fake = FakeWorker()
    save_fixture_session(page, fake)
    expect(page.locator("#tp-sid-text")).to_have_text("new1")
    page.get_by_role("button", name="Copy the session ID").click()
    expect(page.locator("#tp-sid-copy")).to_contain_text("Copied")
    assert page.evaluate("navigator.clipboard.readText()") == "new1"
    page.set_viewport_size({"width": 390, "height": 800})
    expect(page.locator("#tp-sid")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_a_member_requests_to_rename_an_unlisted_track_and_sends_the_name_for_approval(page):
    """A session at a track we do not list has the name its member typed. They ask to rename it (MT3UK is told); once
    allowed they send the new name, which waits for approval. A session at a listed track gets a Layout name box
    instead (see the next test)."""
    fake = FakeWorker()
    save_fixture_session(page, fake)
    expect(page.locator("#rename h2")).to_have_text("Layout name")
    rec = fake.sessions["new1"]
    rec.pop("venueId", None)
    rec["venue"] = "Aerodrome"
    page.reload()
    box = page.locator("#tp-rename")
    expect(box).to_contain_text("it has the name you typed: Aerodrome")
    page.fill("#tp-rename-why", "Spelt wrong")
    page.get_by_role("button", name="Request rename").click()
    expect(box).to_contain_text("Requested. MT3UK has been told")
    assert fake.rename_requests == [{"id": "new1", "note": "Spelt wrong"}]
    fake.rename_status = "granted"
    page.reload()
    expect(box).to_contain_text("MT3UK has said you can rename this track")
    page.fill("#tp-rename-name", "Newtown Aerodrome")
    page.get_by_role("button", name="Send for approval").click()
    expect(box).to_contain_text("waiting for MT3UK to approve it")
    expect(box).to_contain_text("Newtown Aerodrome")
    assert fake.rename_proposals == [{"id": "new1", "name": "Newtown Aerodrome"}]
    expect(page.get_by_role("heading", name=re.compile("Aerodrome"))).to_have_count(1)


def test_a_member_requests_to_rename_the_layout_of_a_listed_track(page):
    """At a listed track what can be wrong is the layout name ("Brands Hatch, New Layout"). It is shared by every session
    on that layout, so the box says so; the steps are the same: ask, allowed, send, approved by MT3UK."""
    fake = FakeWorker()
    save_fixture_session(page, fake)
    rec = fake.sessions["new1"]
    rec["layout"] = "New Layout"
    page.reload()
    box = page.locator("#tp-rename")
    expect(page.locator("#rename h2")).to_have_text("Layout name")
    expect(box).to_contain_text("on the layout New Layout")
    expect(box).to_contain_text("Every session on that layout shares its name")
    page.fill("#tp-rename-why", "It is the Indy circuit")
    page.get_by_role("button", name="Request rename").click()
    expect(box).to_contain_text("will email you when you can rename this layout")
    assert fake.rename_requests == [{"id": "new1", "note": "It is the Indy circuit"}]
    fake.rename_status = "granted"
    page.reload()
    expect(box).to_contain_text("MT3UK has said you can rename this layout")
    expect(box).to_contain_text("changes for everyone with a session on this layout")
    expect(page.locator("#tp-rename-name")).to_have_value("New Layout")
    page.fill("#tp-rename-name", "Indy Circuit")
    page.get_by_role("button", name="Send for approval").click()
    expect(box).to_contain_text("The layout keeps its name until then")
    expect(box).to_contain_text("Indy Circuit")
    assert fake.rename_proposals == [{"id": "new1", "name": "Indy Circuit"}]


def test_a_member_requests_to_edit_the_map_and_sends_a_change_for_approval(page):
    """A saved session's lines are fixed. The member presses Request Edit Map (MT3UK is told); once MT3UK has
    allowed it they edit the map and send the change, which waits for approval: the session itself is not saved."""
    fake = FakeWorker()
    save_fixture_session(page, fake)
    box = page.locator("#tp-lineedit")
    expect(box).to_contain_text("The lines are fixed once a session is saved")
    page.fill("#tp-line-why", "The start is a bit early")
    page.get_by_role("button", name="Request Edit Map").click()
    expect(box).to_contain_text("Requested. MT3UK has been told")
    assert fake.line_requests == [{"id": "new1", "note": "The start is a bit early"}]
    # Allowed: the page offers the map.
    fake.lines_status = "granted"
    page.reload()
    expect(box).to_contain_text("MT3UK has said you can edit this map")
    page.get_by_role("button", name="Edit the map").click()
    expect(page.get_by_role("heading", name="Edit the map")).to_be_visible()
    expect(page.locator("[data-type]")).to_have_count(0)
    page.locator("#tp-tap polyline").first.wait_for(state="attached")
    page.get_by_role("button", name="Clear markers").click()
    page.locator("#tp-tap").scroll_into_view_if_needed()
    pt = page.evaluate("""() => {
      const svg = document.getElementById('tp-tap'), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
      const pts = svg.querySelector('polyline').getAttribute('points').split(' ').map(s => s.split(',').map(Number));
      const p = pts[Math.floor(pts.length * 0.02)];
      return [r.left + p[0] * r.width / vb.width, r.top + p[1] * r.height / vb.height];
    }""")
    page.mouse.click(pt[0], pt[1])
    page.get_by_role("switch", name="Correct lines?").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed lap")
    # The full figures of the old and the new line are on the screen before anything is sent.
    figs = page.locator("#tp-figs")
    expect(figs).to_contain_text("Before")
    expect(figs).to_contain_text("After")
    nums = [n.replace("\n", ", ") for n in figs.locator(".tp-fignum").all_inner_texts()]
    assert len(nums) == 2 and nums[0] != nums[1] and all(re.fullmatch(r"-?\d+\.\d{7}(, -?\d+\.\d{7}){3}", n) for n in nums), nums
    # Undo changes puts the old lines back: Before and After are the same, and there is nothing left to undo.
    page.get_by_role("button", name="Undo changes").click()
    nums = [n.replace("\n", ", ") for n in figs.locator(".tp-fignum").all_inner_texts()]
    assert nums[0] == nums[1], nums
    expect(page.get_by_role("button", name="Undo changes")).to_be_disabled()
    # Move the line again, then send it.
    page.get_by_role("button", name="Move the start line").click()
    page.get_by_role("button", name="Clear markers").click()
    page.wait_for_timeout(300)
    page.locator("#tp-tap polyline").first.wait_for(state="attached")
    page.locator("#tp-tap").scroll_into_view_if_needed()
    pt = page.evaluate("""() => {
      const svg = document.getElementById('tp-tap'), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
      const pts = svg.querySelector('polyline').getAttribute('points').split(' ').map(s => s.split(',').map(Number));
      const p = pts[Math.floor(pts.length * 0.02)];
      return [r.left + p[0] * r.width / vb.width, r.top + p[1] * r.height / vb.height];
    }""")
    page.mouse.click(pt[0], pt[1])
    page.get_by_role("switch", name="Correct lines?").click()
    expect(page.get_by_role("button", name="Undo changes")).to_be_enabled()
    page.get_by_role("button", name="Send for approval").click()
    # Recorded: the screen says so and offers Close, which goes back to the session. The session page then says it is waiting.
    sent = page.locator("#tp-sent")
    expect(sent).to_contain_text("Sent for approval", timeout=15000)
    expect(page.get_by_role("button", name="Send for approval")).to_have_count(0)
    page.get_by_role("button", name="Close").click()
    expect(box).to_contain_text("Your change is waiting for MT3UK to approve it", timeout=15000)
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    # What was sent: the new start line (two points) and the time on it. The saved session is untouched.
    assert len(fake.line_proposals) == 1
    sent = fake.line_proposals[0]
    assert sent["id"] == "new1" and len(sent["startLine"]) == 2 and len(sent["startLine"][0]) == 2 and sent["finishLine"] is None and sent["time"] > 60
    assert not getattr(fake, "replaced", []), "the session itself is not changed"
    # The old and the new lines were drawn as pictures and sent first, for MT3UK's email.
    assert sorted(w for w, _ in fake.line_images) == ["after", "before"]
    assert all(b[:3] == b"\xff\xd8\xff" and len(b) > 2000 for _, b in fake.line_images), [len(b) for _, b in fake.line_images]
    expect(box).to_contain_text("Your change is waiting for MT3UK to approve it")
    expect(box.get_by_role("button", name="Change it again")).to_be_visible()


def test_a_session_whose_readings_were_not_kept_says_so_and_why(page):
    """Readings the worker refuses (a long file can be too big) are not silently lost: the saved banner and the lines
    box say so, and there is no Request Edit Map button to press."""
    fake = FakeWorker()
    fake.fail_source = True
    save_fixture_session(page, fake)
    expect(page.locator("#tp-saved")).to_contain_text("Your readings were not kept (Those readings are too big to keep)")
    box = page.locator("#lineedit")
    expect(box).to_contain_text("readings were not kept")
    expect(box).to_contain_text("add the file again as a new session")
    expect(box.get_by_role("button", name="Add the readings again")).to_be_visible()
    expect(page.get_by_role("button", name="Request Edit Map")).to_have_count(0)


def test_readings_that_finish_uploading_after_the_page_moved_on_bring_the_edit_map_box_up(page):
    """A slow upload (a phone on 5G) is not waited for beyond 20 seconds. The page shows the session as having no
    readings at first, then brings it up to date when they arrive, so the member does not have to refresh."""
    fake = FakeWorker()
    held = []
    page.clock.install()
    open_page(page, fake)
    # Hold the readings upload until the test lets it go.
    def hold(route):
        if route.request.method == "POST":
            held.append(route)
        else:
            route.fallback()
    page.route("**/track/session/source**", hold)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    # Wait until the upload has started (the session is saved first), then let 21 seconds pass.
    for _ in range(100):
        if held:
            break
        page.wait_for_timeout(50)
    assert held, "the readings upload should have started"
    page.clock.run_for(21000)
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    # While it is still going the page says to wait, rather than that they were lost.
    expect(page.locator("#lineedit")).to_contain_text("Your readings are still being sent. Keep this page open")
    expect(page.locator("#tp-saved")).to_contain_text("still being sent")
    # The upload finishes: the page notices and shows the real box.
    fake.reply(held[0])
    expect(page.get_by_role("button", name="Request Edit Map")).to_be_visible(timeout=10000)


def test_the_readings_load_when_they_arrive_still_zipped(page):
    """A large saved session's readings can reach the page still gzipped (the browser did not unzip them). Editing
    the map, changing the type and the like must still work."""
    fake = FakeWorker()
    save_fixture_session(page, fake)
    fake.raw_gzip_source = True
    fake.lines_status = "granted"
    page.reload()
    page.get_by_role("button", name="Edit the map").click()
    expect(page.get_by_role("heading", name="Edit the map")).to_be_visible()
    expect(page.locator("#tp-result")).to_contain_text("timed laps")
    page.goto("/track.html?s=new1")
    page.locator("#settings [data-retype] button[data-v='other']").click()
    expect(page.get_by_role("heading", name="Change the type")).to_be_visible()


def test_a_readings_failure_says_what_the_server_said(page):
    fake = FakeWorker()
    save_fixture_session(page, fake)
    fake.lines_status = "granted"
    fake.sources.pop("new1")
    page.reload()
    page.get_by_role("button", name="Edit the map").click()
    expect(page.locator("#tp-line-note")).to_contain_text("No readings were kept for this session.")


def test_the_line_picture_is_a_jpeg_of_the_lines_even_with_no_satellite_imagery(page):
    """MT3UKLineImage draws the old or new lines for the email. With the tile server unreachable it still gives a
    1000 x 600 JPEG (the drive's trace and the lines on a plain background)."""
    page.route("**/server.arcgisonline.com/**", lambda route: route.abort())
    open_page(page, FakeWorker())
    out = page.evaluate("""async () => {
      const blob = await window.MT3UKLineImage.make({ title: 'Old lines', subtitle: 'Time 1:58.089',
        lines: [{ line: [[51.6926409, -1.3170275], [51.6926050, -1.3174584]], kind: 'start', label: 'Start' }, { line: [[51.6897602, -1.3163671], [51.6897898, -1.3159349]], kind: 'finish', label: 'Finish' }],
        frame: [[51.6926409, -1.3170275], [51.6897898, -1.3159349]], outline: [[51.6926, -1.3172], [51.6912, -1.3168], [51.6898, -1.3162]] });
      const bmp = await createImageBitmap(blob);
      return { type: blob.type, size: blob.size, w: bmp.width, h: bmp.height };
    }""")
    assert out["type"] == "image/jpeg" and out["w"] == 1000 and out["h"] == 600 and out["size"] > 3000, out


def test_add_the_readings_again_repairs_a_session_saved_without_them(page):
    """A session whose readings were not kept gets them from the same file, with no duplicate session, and then the
    Request Edit Map box and the type change work."""
    fake = FakeWorker()
    fake.fail_source = True
    save_fixture_session(page, fake)
    fake.fail_source = False
    before = len(fake.sessions)
    page.locator("#lineedit [data-readings-file]").set_input_files(str(FIXTURE))
    expect(page.get_by_role("button", name="Request Edit Map")).to_be_visible()
    assert "new1" in fake.sources and len(fake.sessions) == before
    expect(page.locator("#settings [data-retype]")).to_have_count(1)


def test_add_the_readings_again_refuses_a_different_file(page):
    fake = FakeWorker()
    fake.fail_source = True
    save_fixture_session(page, fake)
    fake.fail_source = False
    bad = ROOT / "tests" / "fixtures" / "abingdon-glitches.csv"
    page.locator("#lineedit [data-readings-file]").set_input_files(str(bad))
    expect(page.locator("#lineedit [data-readings-note]")).to_contain_text(re.compile(r"does not look like the file|could be read|do not recognise"))
    assert "new1" not in fake.sources


def test_a_refusal_is_still_explained_after_a_refresh(page):
    """The worker keeps a note of why readings were refused, so the reason is not lost when the page is reloaded."""
    fake = FakeWorker()
    fake.fail_source = True
    save_fixture_session(page, fake)
    page.reload()
    expect(page.locator("#lineedit")).to_contain_text("Those readings are too big to keep")
    expect(page.locator("#settings")).to_contain_text("Reason: Those readings are too big to keep.")


def test_the_session_map_zooms_in_far_enough_to_place_a_line(page):
    """The zoom-in limit was 16 times the first view, too little to pinpoint a spot on a long lap; it is 40 now,
    and the satellite tiles stay at their sharpest level and are enlarged beyond it."""
    page.route("**/World_Imagery/**", sat_reply)
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    svg = page.locator("#tp-map2")
    svg.scroll_into_view_if_needed()
    zoom_in = svg.locator("xpath=..").locator(".tv-zoom-in")
    width = lambda: float(svg.get_attribute("viewBox").split()[2])
    start = width()
    for _ in range(14):
        zoom_in.click()
    assert 25 < start / width() <= 40.5, (start, width())


def test_playback_has_a_quarter_speed_that_runs_slower(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.locator("#tp-speeds [data-speed='0.25']").click()
    expect(page.locator("#tp-speeds .chip.is-on")).to_have_text("x0.25")
    clock = page.locator("#tp-clock")
    page.locator("#tp-play-toggle").click()
    page.wait_for_timeout(1000)
    page.locator("#tp-play-toggle").click()
    m, s = clock.inner_text().split(" / ")[0].split(":")
    played = int(m) * 60 + float(s)
    assert 0.05 < played < 0.6, played  # a second at x0.25 is about a quarter of a second of the lap


def test_a_touch_that_lands_on_a_tile_still_pans_the_zoomed_map(page, base_url):
    # A finger lands on a satellite tile or a line, which a touch captures at once; handing the capture to the map
    # used to end the drag after a few pixels, so the map hardly moved. Needs a real touch context.
    ctx = page.context.browser.new_context(base_url=base_url, has_touch=True, is_mobile=True, viewport={"width": 390, "height": 844})
    touch = ctx.new_page()
    try:
        save_thruxton_with_a_member_board(touch, FakeWorker())
        cdp = ctx.new_cdp_session(touch)
        touch.locator("#tp-mapwrap").scroll_into_view_if_needed()
        zoom = touch.locator("#tp-mapwrap button[aria-label='Zoom in']")
        zoom.click()
        zoom.click()
        if touch.locator("#tp-follow").get_attribute("aria-pressed") == "true":
            touch.locator("#tp-follow").click()
        touch.evaluate("""() => { const svg = document.getElementById('tp-map2'), vb = svg.viewBox.baseVal, r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          r.setAttribute('x', vb.x - 500); r.setAttribute('y', vb.y - 500); r.setAttribute('width', 2000); r.setAttribute('height', 2000); r.setAttribute('fill', '#223'); svg.insertBefore(r, svg.firstChild); }""")
        corner = """() => { const t = [...document.querySelectorAll('#tp-map2 text')].find(e => e.textContent === '2'), r = t.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }"""
        box = touch.locator("#tp-map2").bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        p0 = touch.evaluate(corner)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for i in range(1, 13):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + 70 * i / 12, "y": y + 30 * i / 12}]})
            touch.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        touch.wait_for_timeout(200)
        p1 = touch.evaluate(corner)
        assert abs((p1[0] - p0[0]) - 70) < 4 and abs((p1[1] - p0[1]) - 30) < 4, (p0, p1)
    finally:
        ctx.close()


def test_another_members_lap_is_labelled_with_first_initial_and_last_name(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    # A name shown as first and last name becomes "A. Smith"; a nickname (one word) is shown as it is.
    fake.boards["/track/board:thruxton:main"][0].update(owner="Andy Smith")
    page.reload()
    page.locator("#tp-cmp-b").wait_for()
    page.locator("#tp-cmp-b").select_option("x:m1")
    expect(page.locator("#tp-key")).to_contain_text("A. Smith, best, 28/05 (B)")


def test_landscape_full_screen_controls_float_move_resize_and_reset(page):
    page.set_viewport_size({"width": 390, "height": 844})
    save_thruxton_with_a_member_board(page, FakeWorker())
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    page.set_viewport_size({"width": 844, "height": 390})
    page.wait_for_timeout(300)
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    panel = page.locator("#tp-play")
    start = panel.bounding_box()
    assert start["x"] < 20 and start["y"] + start["height"] > 360  # resting at the bottom
    assert start["width"] > 844 - 24  # spanning the full width of the screen until it is moved
    # Narrow it from the corner so there is room to move it sideways.
    s0 = page.locator("#tp-pn-size").bounding_box()
    page.mouse.move(s0["x"] + s0["width"] / 2, s0["y"] + s0["height"] / 2)
    page.mouse.down()
    page.mouse.move(s0["x"] + s0["width"] / 2 - 400, s0["y"] + s0["height"] / 2, steps=6)
    page.mouse.up()
    narrow = panel.bounding_box()
    assert narrow["width"] < start["width"] - 300
    # The grip along the top moves the controls.
    g = page.locator("#tp-pn-grip").bounding_box()
    gx, gy = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    page.mouse.move(gx, gy)
    page.mouse.down()
    page.mouse.move(gx + 150, gy - 120, steps=8)
    page.mouse.up()
    moved = panel.bounding_box()
    assert abs(moved["x"] - narrow["x"] - 150) < 6 and abs(moved["y"] - narrow["y"] + 120) < 6, (narrow, moved)
    # The corner handle resizes the width.
    s = page.locator("#tp-pn-size").bounding_box()
    sx, sy = s["x"] + s["width"] / 2, s["y"] + s["height"] / 2
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx - 100, sy, steps=6)
    page.mouse.up()
    resized = panel.bounding_box()
    assert abs(resized["width"] - (moved["width"] - 100)) < 6, (moved, resized)
    # Kept in this browser, and still on the screen after a reload.
    page.reload()
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    again = panel.bounding_box()
    assert abs(again["x"] - resized["x"]) < 6 and abs(again["width"] - resized["width"]) < 6, (resized, again)
    # Map options puts them back at the bottom left.
    page.locator("#tp-mopts-btn").click()
    page.locator("#tp-pn-reset").click()
    back = panel.bounding_box()
    assert back["x"] < 20 and abs(back["width"] - start["width"]) < 6, (start, back)


def test_landscape_controls_move_by_holding_anywhere_and_show_who_in_the_buttons_row(page):
    page.set_viewport_size({"width": 390, "height": 844})
    save_thruxton_with_a_member_board(page, FakeWorker())
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    page.set_viewport_size({"width": 844, "height": 390})
    page.wait_for_timeout(300)
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    expect(page.locator("#tp-mapcard")).to_have_class(re.compile(r"is-full"))
    # The drivers and their date and time are in the same row as the main buttons.
    play, who = page.locator("#tp-play-toggle").bounding_box(), page.locator("#tp-when").bounding_box()
    assert who["x"] > play["x"] + play["width"] and abs((who["y"] + who["height"] / 2) - (play["y"] + play["height"] / 2)) < play["height"], (play, who)
    # Holding the panel anywhere that is not a button moves it, not just the grip. (It starts full width, so narrow it first.)
    panel = page.locator("#tp-play")
    s0 = page.locator("#tp-pn-size").bounding_box()
    page.mouse.move(s0["x"] + s0["width"] / 2, s0["y"] + s0["height"] / 2)
    page.mouse.down()
    page.mouse.move(s0["x"] + s0["width"] / 2 - 300, s0["y"] + s0["height"] / 2, steps=6)
    page.mouse.up()
    who = page.locator("#tp-when").bounding_box()
    before = panel.bounding_box()
    x, y = who["x"] + who["width"] / 2, who["y"] + who["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 90, y - 100, steps=8)
    page.mouse.up()
    after = panel.bounding_box()
    assert abs(after["x"] - before["x"] - 90) < 6 and abs(after["y"] - before["y"] + 100) < 6, (before, after)
    # A button still works as a button: a press on Play starts the playback and does not move the panel.
    page.locator("#tp-play-toggle").click()
    assert abs(panel.bounding_box()["x"] - after["x"]) < 2


def test_the_rotate_button_turns_the_screen_sideways_or_says_to_turn_the_phone(page):
    page.set_viewport_size({"width": 390, "height": 844})
    # A phone that can lock its screen: full screen is asked for, then landscape.
    page.add_init_script("""
      window.__lock = []; window.__unlock = 0;
      Element.prototype.requestFullscreen = function () { window.__fs = true; return Promise.resolve(); };
      Object.defineProperty(screen, 'orientation', { configurable: true, value: { lock: function (o) { window.__lock.push(o); return Promise.resolve(); }, unlock: function () { window.__unlock++; } } });
    """)
    save_thruxton_with_a_member_board(page, FakeWorker())
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    rotate = page.locator("#tp-rotate-hint")
    expect(rotate).to_be_visible()
    expect(rotate).to_have_attribute("aria-label", "Turn the screen sideways for a bigger map")
    rotate.click()
    page.wait_for_function("window.__lock.length > 0")
    assert page.evaluate("window.__lock") == ["landscape"] and page.evaluate("window.__fs") is True
    # Leaving full screen lets the screen turn freely again.
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    assert page.evaluate("window.__unlock") >= 1


def test_the_rotate_button_says_so_when_the_phone_cannot_lock_the_screen(page):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script("Object.defineProperty(screen, 'orientation', { configurable: true, value: { lock: function () { return Promise.reject(new Error('no')); }, unlock: function () {} } });")
    save_thruxton_with_a_member_board(page, FakeWorker())
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    page.locator("#tp-rotate-hint").click()
    expect(page.locator("#tp-rotate-toast")).to_have_text("Turn your phone sideways to use the bigger map.")


def test_full_screen_has_lap_pickers(page):
    """Lap A and Lap B can be switched from full screen, upright and on its side."""
    page.set_viewport_size({"width": 390, "height": 844})
    save_thruxton_with_a_member_board(page, FakeWorker())
    page.locator("#tp-mapwrap .tv-zoom-full").click()
    expect(page.locator("#tp-fs-laps #tp-cmp-b")).to_be_visible()
    before = page.locator(".tp-mapcard").inner_text()
    page.locator("#tp-cmp-b").select_option(index=1)
    page.wait_for_timeout(400)
    assert page.locator("#tp-cmp-b").input_value()
    page.set_viewport_size({"width": 800, "height": 360})
    page.wait_for_timeout(400)
    page.locator("#tp-mopts-btn").click()
    expect(page.locator("#tp-mopts-body #tp-cmp-a")).to_be_visible()


def test_a_place_named_for_a_hill_climb_is_listed_under_hill_climbs_even_without_the_flag(page):
    """A sprint-type place that was added from a member's request starts without the hill flag; its name says hill
    climb, so the leaderboard lists it under Hill climb, not Sprint."""
    lib = {"venues": [
        {"id": "curborough", "name": "Curborough", "type": "sprint", "lat": 52.7, "lng": -1.8, "radius": 1500, "layouts": [{"id": "c", "name": "Course", "length": 800}]},
        {"id": "gurston", "name": "Gurston Down Hillclimb", "type": "sprint", "lat": 51.0, "lng": -1.9, "radius": 1500, "layouts": [{"id": "h", "name": "Hill", "length": 900}]},
    ]}
    page.route(re.compile(r".*/data/tracks\.json.*"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(lib)))
    open_page(page, FakeWorker(), "/leaderboards.html?type=sprint", signed_in=False)
    expect(page.locator(".tp-board-card", has_text="Curborough")).to_have_count(1)
    expect(page.locator(".tp-board-card", has_text="Gurston")).to_have_count(0)
    page.locator(".lb-types a", has_text="Hill climb").click()
    expect(page.locator(".tp-board-card", has_text="Gurston")).to_have_count(1)
    expect(page.locator(".tp-board-card", has_text="Curborough")).to_have_count(0)


def test_a_hill_climb_is_told_apart_from_a_sprint(page):
    """Sprint and Hill climb are separate choices (the same timing underneath): the Add page and Session settings
    show both, a session saved as a hill climb says so, and switching between them is one tap with nothing read
    again."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _course(HILL_FINISH, 1500))
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    expect(page.locator("[data-type] button")).to_have_text(["Track day", "Drag run", "Sprint", "Hill climb", "Other"])
    page.locator("[data-type] button[data-v='hill']").click()
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Test Sprint")
    expect(page.locator("[data-type] .chip.is-on")).to_have_text(["Hill climb"])
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    assert fake.sessions["new1"]["type"] == "sprint" and fake.sessions["new1"].get("hill") is True, fake.sessions["new1"].get("hill")
    expect(page.locator("#tp-kind")).to_have_text("Hill climb")
    expect(page.locator("#settings [data-retype] .chip.is-on")).to_have_text(["Hill climb"])
    # One tap to call it a sprint, and back.
    page.locator("#settings [data-retype] button[data-v='sprint']").click()
    expect(page.locator("#settings [data-retype] .chip.is-on")).to_have_text(["Sprint"])
    assert not fake.sessions["new1"].get("hill")
    expect(page.locator("#tp-kind")).to_have_text("Sprint")
    page.locator("#settings [data-retype] button[data-v='hill']").click()
    expect(page.locator("#settings [data-retype] .chip.is-on")).to_have_text(["Hill climb"])
    assert fake.sessions["new1"].get("hill") is True


def test_a_long_stop_between_passes_offers_sprint_or_hill_climb_as_separate_choices(page, tmp_path):
    """A pit stop in the middle of a track day file is not a lap. The notice offers Switch to Sprint and Switch to
    Hill climb (they are separate choices now), and the Hill climb one picks that type."""
    import datetime as dt
    text = (ROOT / "tests" / "fixtures" / "racebox-castle-combe-gpx.gpx").read_text()
    pts = re.findall(r"<trkpt [^>]*>.*?</trkpt>", text)
    first, last = text.index(pts[0]), text.index(pts[-1]) + len(pts[-1])

    def shift(p, sec):
        m = re.search(r"<time>(.*?)Z</time>", p)
        t = dt.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S.%f") + dt.timedelta(seconds=sec)
        return p.replace(m.group(0), "<time>" + t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03d" % (t.microsecond // 1000) + "Z</time>")
    cut, out = len(pts) // 2, []
    for i, p in enumerate(pts):
        if i == cut:
            # Parked on the spot for several minutes, then off again.
            out.extend(shift(pts[cut - 1], k) for k in range(1, 401))
        out.append(shift(p, 400 if i >= cut else 0))
    path = tmp_path / "pitstop.gpx"
    path.write_text(text[:first] + "\n".join(out) + text[last:])
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(path))
    notice = page.locator("#tp-result .tp-notice.is-warn", has_text="stopped for a long time")
    expect(notice).to_be_visible()
    expect(notice.get_by_role("button")).to_have_text(["Switch to Sprint", "Switch to Hill climb"])
    notice.get_by_role("button", name="Switch to Hill climb").click()
    expect(page.locator("[data-type] .chip.is-on")).to_have_text(["Hill climb"])


def test_a_logger_left_running_between_sessions_is_explained_without_offering_sprint(page, tmp_path):
    """A day of laps with the car parked (the logger still recording) for a long gap in the middle: the gap is left out,
    the notice says so, and it does not suggest a sprint or hill climb."""
    import datetime as dt
    text = (ROOT / "tests" / "fixtures" / "racebox-castle-combe-gpx.gpx").read_text()
    pts = re.findall(r"<trkpt [^>]*>.*?</trkpt>", text)
    first, last = text.index(pts[0]), text.index(pts[-1]) + len(pts[-1])

    def shift(p, sec):
        m = re.search(r"<time>(.*?)Z</time>", p)
        t = dt.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S.%f") + dt.timedelta(seconds=sec)
        return p.replace(m.group(0), "<time>" + t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03d" % (t.microsecond // 1000) + "Z</time>")
    t0 = dt.datetime.strptime(re.search(r"<time>(.*?)Z</time>", pts[0]).group(1), "%Y-%m-%dT%H:%M:%S.%f")
    t1 = dt.datetime.strptime(re.search(r"<time>(.*?)Z</time>", pts[-1]).group(1), "%Y-%m-%dT%H:%M:%S.%f")
    gap = (t1 - t0).total_seconds() + 1800
    out = list(pts) + [shift(p, gap) for p in pts]
    path = tmp_path / "two-sessions.gpx"
    path.write_text(text[:first] + "\n".join(out) + text[last:])
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(path))
    notice = page.locator("#tp-result .tp-notice", has_text="was parked between sessions")
    expect(notice).to_be_visible()
    expect(notice).to_contain_text("timed laps are not affected")
    expect(notice.get_by_role("button")).to_have_count(0)
    expect(page.locator("#tp-result .tp-notice", has_text="Switch to Sprint")).to_have_count(0)


def test_the_track_mode_figures_can_be_refreshed_from_the_same_files(page):
    """A session saved with old figures gets new ones from the same car file: only the figures are sent, no new session."""
    fake = FakeWorker()
    open_page(page, fake)
    page.get_by_role("link", name="Add a session").click()
    csv = {"name": "telemetry-v1-2026-05-28-10_00_00.csv", "mimeType": "text/csv", "buffer": tesla_full_csv().encode()}
    page.set_input_files("#tp-file", files=[csv])
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    fake.sessions["new1"]["carData"]["brakePressure"] = {"max": 1.0}
    page.reload()
    card = page.locator("#car-data")
    expect(card).to_contain_text("1.0 bar")
    before = len(fake.sessions)
    page.locator("#car-data").evaluate("el => el.open = true")
    card.locator("[data-car-file]").set_input_files(files=[csv])
    expect(page.locator("#car-data")).to_contain_text("35.5 bar")
    assert len(fake.car_updates) == 1 and len(fake.sessions) == before
    assert fake.car_updates[0]["carData"]["power"]["max"] == 250


def test_the_line_picker_shows_only_the_fastest_lap_and_a_marker_sits_on_it(page):
    """With laps, the picker draws the fastest lap as one clean line (not the whole drive, which could include the way to
    the circuit) and a marker attaches to that line, not to a waypoint of some other lap."""
    page.route(re.compile(r".*/data/tracks\.json.*"), _without_start_line)
    open_page(page, FakeWorker())
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    page.locator('[data-tap="edit"]').click()
    expect(page.locator("#tp-tap")).to_be_visible()
    assert page.evaluate("document.querySelectorAll('#tp-tap polyline.tv-line').length") == 1, "one clean lap line"
    # Only that lap is drawn: its readings, filled in to about a metre apart, and nothing else.
    segs = page.evaluate("document.querySelectorAll('#tp-tap .tv-segs line').length")
    best = page.evaluate("document.querySelector('#tp-tap polyline.tv-line').getAttribute('points').split(' ').length")
    assert abs(segs - (best - 1)) <= 1 and best > 600, (segs, best)
    page.get_by_role("button", name="Clear markers").click()
    pt = _trace_point(page, 0.3)
    # The clicked point in the map's own coordinates (the page may scroll when a marker is placed).
    want = page.evaluate("""(pt) => {
      const svg = document.getElementById('tp-tap'), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
      return [vb.x + (pt[0] - r.left) * vb.width / r.width, vb.y + (pt[1] - r.top) * vb.height / r.height, vb.width / r.width];
    }""", pt)
    page.mouse.click(pt[0], pt[1])
    expect(page.locator("#tp-tap .tp-tapmark")).to_have_count(1)
    got = page.evaluate("""() => {
      const m = document.querySelector('#tp-tap .tp-tapmark').getAttribute('transform').match(/translate\\(([-\\d.e]+)[ ,]([-\\d.e]+)\\)/);
      return [Number(m[1]), Number(m[2])];
    }""")
    off = ((got[0] - want[0]) ** 2 + (got[1] - want[1]) ** 2) ** 0.5 / want[2]
    assert off < 4, "the marker sits on the clicked point of the line (%.1f px off)" % off


def test_pads_start_from_my_garage_and_are_saved_with_the_session(page):
    """Brake pads on the Add page: filled in from the car's brakes in My Garage (Pagid RSL29), front and rear the same
    until Same pads on the rear is switched off, the maker's figures shown, and saved with the session."""
    fake = FakeWorker()
    car = dict(CAR, specs={"brakes": {"status": "up", "fields": {"frontPads": "Pagid RSL29", "rearPads": "Pagid RSL29"}}})
    open_page(page, fake)
    page.route("**/%s/pads" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
               body=json.dumps({"success": True, "extra": {"makes": [{"name": "Pagid", "compounds": [{"name": "RS29"}, {"name": "RSL29", "use": "Track day", "mu": "0.50", "tempMin": 100, "tempMax": 650}]}]}})))
    page.route("**/%s/my-builds" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "cars": [car]}), headers={"Access-Control-Allow-Origin": "*"}))
    page.reload()
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("timed laps")
    expect(page.locator("#tp-pad-front-make")).to_have_value("Pagid")
    expect(page.locator("#tp-pad-front-comp")).to_have_value("RSL29")
    expect(page.locator(".tp-pads")).to_contain_text("Filled in from")
    expect(page.locator("#tp-pad-front-maker")).to_have_text("Maker's figures: Track day, μ 0.50, 100 to 650°C")
    expect(page.locator('[data-pad-side="rear"]')).to_be_hidden()
    # Different pads on the rear.
    page.locator("#tp-pad-same").click()
    expect(page.locator('[data-pad-side="rear"]')).to_be_visible()
    page.select_option("#tp-pad-rear-comp", "RS29")
    # Kept through a redraw (the units switch).
    page.locator(".tp-head [data-units]").click()
    expect(page.locator("#tp-pad-rear-comp")).to_have_value("RS29")
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
    saved = fake.saved[0]
    assert (saved["padFrontMake"], saved["padFrontCompound"], saved["padRearMake"], saved["padRearCompound"]) == ("Pagid", "RSL29", "Pagid", "RS29"), saved


def _compare_board():
    """Four cars at Thruxton: one on two tyres (and two sets of pads), with temperatures and braking."""
    def best(sid, t, tyre_make, tyre_model, pads, pad_make, pad_comp, temp, brake_g, brake_temp=None, date="2026-04-01", cond="Dry"):
        b = {"sessionId": sid, "date": date, "conditions": cond, "tyres": tyre_make + " " + tyre_model, "tyreMake": tyre_make, "tyreModel": tyre_model,
             "drive": "AWD", "time": t, "temp": temp, "pads": pads, "padMake": pad_make, "padCompound": pad_comp, "brakeG": brake_g}
        if brake_temp:
            b["brakeTemp"] = brake_temp
        return b
    def entry(cid, owner, bests):
        return dict(board_row(cid, bests[0]["sessionId"], min(b["time"] for b in bests)), owner=owner, make="Tesla", drive="AWD", bests=bests)
    return [
        entry("c1", "Ann", [best("s1", 95.9, "Michelin", "Pilot Sport Cup 2 R", "Pagid RSL29", "Pagid", "RSL29", 18, 1.21, 690, "2026-07-01"),
                            best("s2", 98.0, "Michelin", "Pilot Sport 4S", "Original equipment pads", "Original equipment", "Standard pads", 16, 1.05, None, "2026-05-01")]),
        entry("c2", "Bob", [best("s3", 96.6, "Michelin", "Pilot Sport Cup 2 R", "Pagid RSL29", "Pagid", "RSL29", 22, 1.18)]),
        entry("c3", "Cat", [best("s4", 98.4, "Michelin", "Pilot Sport 4S", "Original equipment pads", "Original equipment", "Standard pads", 8, 1.02)]),
        entry("c4", "Dan", [best("s5", 99.7, "Goodyear", "Eagle F1 SuperSport", "Original equipment pads", "Original equipment", "Standard pads", 12, 1.0, None, "2026-06-01", "Wet")]),
    ]


def test_compare_tyres_and_pads_on_a_board(page):
    """A board's Compare tyres view groups each car's best by tyre (best, typical, how far off the quickest, Few cars),
    with the same car on two tyres below; the conditions and temperature filters narrow it. Compare pads does the same
    for pads, with braking g, brake temperature and the maker's figures, warning when a pad ran hotter than its range."""
    fake = FakeWorker()
    fake.boards = {"/track/board:thruxton:main": _compare_board()}
    open_page(page, fake, path="/leaderboards.html")
    page.route("**/%s/pads" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
               body=json.dumps({"success": True, "extra": {"makes": [{"name": "Pagid", "compounds": [{"name": "RSL29", "use": "Track day", "tempMin": 100, "tempMax": 650}]}]}})))
    page.reload()
    page.locator(".tp-board-card", has_text="Thruxton").locator(".lb-layout").first.click()
    expect(page.locator(".lb-row").first).to_be_visible()
    page.locator('#lb-views [data-view="tyres"]').click()
    rows = page.locator("#lb-cmp .lb-cmp-row")
    expect(rows).to_have_count(3)
    expect(rows.nth(0)).to_contain_text("Michelin Pilot Sport Cup 2 R")
    expect(rows.nth(0)).to_contain_text("2 cars")
    expect(rows.nth(0)).to_contain_text("Few cars")
    expect(rows.nth(0)).to_contain_text("Quickest")
    expect(rows.nth(1)).to_contain_text("Michelin Pilot Sport 4S")
    expect(rows.nth(1)).to_contain_text("+2.10 s")
    same = page.locator("#lb-cmp-same .lb-pair")
    expect(same).to_have_count(1)
    expect(same.first).to_contain_text("Ann")
    expect(same.first).to_contain_text("2.10 s quicker")
    expect(same.first).to_contain_text("on Michelin Pilot Sport Cup 2 R")
    # Dry only: the Goodyear (wet) goes.
    page.select_option("#lb-cond", "Dry")
    expect(rows).to_have_count(2)
    # Under 10 C: only Cat's Pilot Sport 4S.
    page.select_option("#lb-temp", "cold")
    expect(rows).to_have_count(1)
    expect(rows.nth(0)).to_contain_text("Pilot Sport 4S")
    page.get_by_role("button", name="Clear filters").click()
    # Compare pads.
    page.locator('#lb-views [data-view="pads"]').click()
    expect(rows).to_have_count(2)
    expect(rows.nth(0)).to_contain_text("Pagid RSL29")
    expect(rows.nth(0)).to_contain_text("Maker's figures: Track day, 100 to 650°C")
    expect(rows.nth(0)).to_contain_text("1.21 g")
    expect(rows.nth(0)).to_contain_text("690°C")
    expect(rows.nth(0).locator(".lb-cmp-warn")).to_contain_text("Hotter than the pads' working range (650°C)")
    expect(page.locator("#lb-cmp-same .lb-pair").first).to_contain_text("on Pagid RSL29")
    # Back to the leaderboard.
    page.locator('#lb-views [data-view="board"]').click()
    expect(page.locator(".lb-row").first).to_be_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    page.locator('#lb-views [data-view="pads"]').click()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_every_session_says_which_logger_recorded_it(page, tmp_path):
    """The Add page asks which logger or app recorded the file (required): guessed from the file name, Other takes a
    typed name, and the session page shows it to everyone. Session settings can change it."""
    fake = FakeWorker()
    open_page(page, fake, "/track.html?add=1")
    f = tmp_path / "RaceBox Track Session.vbo"
    f.write_bytes(FIXTURE.read_bytes())
    page.set_input_files("#tp-file", str(f))
    page.locator("#tp-result").wait_for()
    # Guessed from the file name, and required.
    expect(page.locator("#tp-logger")).to_have_value("RaceBox")
    expect(page.locator("#tp-logger-other")).to_be_hidden()
    page.select_option("#tp-logger", "")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#tp-status")).to_contain_text("which logger")
    expect(page.locator("#tp-logger")).to_have_attribute("aria-invalid", "true")
    assert not fake.saved
    # Other: a typed name.
    page.select_option("#tp-logger", "__other")
    expect(page.locator("#tp-logger-other")).to_be_visible()
    page.fill("#tp-logger-other", "Rusty's phone app")
    page.get_by_role("button", name="Save session").click()
    expect(page.locator(".tp-session-head")).to_be_visible()
    assert fake.saved[-1]["logger"] == "Rusty's phone app"
    expect(page.locator("#tp-logger-line")).to_have_text("Logger: Rusty's phone app")
    # Settings show it as Other with the name, and can change it to a listed one.
    expect(page.locator("#tp-e-logger")).to_have_value("__other")
    expect(page.locator("#tp-e-logger-other")).to_have_value("Rusty's phone app")
    page.select_option("#tp-e-logger", "Garmin Catalyst")
    page.get_by_role("button", name="Save changes").click()
    expect(page.locator("#tp-status")).to_contain_text("Saved")
    assert fake.sessions["new1"]["logger"] == "Garmin Catalyst"
    expect(page.locator("#tp-logger-line")).to_have_text("Logger: Garmin Catalyst")
    # Another member sees it too.
    page.route("**/track/session?id=new1", lambda route: route.fulfill(
        status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
        body=json.dumps({"success": True, "session": dict(fake.sessions["new1"], mine=False, car="Blue Y", ownerName="Ann")})))
    page.goto("/track.html?s=new1")
    expect(page.locator("#tp-logger-line")).to_have_text("Logger: Garmin Catalyst")
    # The next Add starts from the member's last logger when the file gives nothing away.
    page.goto("/track.html?add=1&car=car1")
    g = tmp_path / "laps.vbo"
    g.write_bytes(FIXTURE.read_bytes())
    page.set_input_files("#tp-file", str(g))
    page.locator("#tp-result").wait_for()
    expect(page.locator("#tp-logger")).to_have_value("VBOX (Racelogic)")


def test_the_session_board_packs_its_tiles_with_no_empty_blocks(page):
    """Every panel from Compare laps down is a tile on a 12-column board, each as wide as its built-in span and as tall
    as its own content, so Corner by corner starts straight under the speed charts rather than under the taller map
    beside them. Nothing is moved or resized by the member: no grip handles, corner handles or resize bars."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)

    def order():
        return page.evaluate("[...document.querySelectorAll('#tp-board > [data-tile]')].map(t => t.dataset.tile)")

    def span(key):
        return page.evaluate("k => getComputedStyle(document.querySelector('#tp-board > [data-tile=\"' + k + '\"]')).getPropertyValue('--span').trim()", key)
    first = order()
    assert first[:5] == ["speed", "map", "corners", "grip", "cmpnotes"]
    for k in ("laps", "spotted", "overtime", "overtime-notes", "overtime-table", "overtime-mods", "lineedit", "rename", "settings"):
        assert k in first, k
    assert span("speed") == "6" and span("map") == "6" and span("settings") == "12" and span("overtime") == "12"
    assert page.locator("[data-move], [data-size], [data-resize]").count() == 0
    # Packed: Corner by corner starts straight under the speed charts, not under the taller map beside them.
    sb = page.locator('[data-tile="speed"]').bounding_box()
    cb = page.locator('[data-tile="corners"]').bounding_box()
    mb = page.locator('[data-tile="map"]').bounding_box()
    assert mb["height"] > sb["height"] + 100, (mb, sb)
    assert abs(cb["y"] - (sb["y"] + sb["height"] + 14)) < 3, (sb, cb)
    # Every tile spans its own height, so no tile overlaps the one below it.
    # (A tile that has just grown, such as the map edit box once its status arrives, is packed again on the next frame, so
    # wait for the board to settle rather than reading it in the middle of that.)
    overlap_js = """() => {
      const boxes = [...document.querySelectorAll('#tp-board > [data-tile]')].map(t => { const r = t.getBoundingClientRect(); return [t.dataset.tile, r.left, r.top, r.bottom]; });
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [k, l, a, b] = boxes[i], [k2, l2, a2, b2] = boxes[j];
        if (Math.abs(l - l2) < 1 && !(a2 >= b - 1 || a >= b2 - 1)) return [k, k2];
      }
      return null;
    }"""
    page.wait_for_function("(" + overlap_js + ")() === null", timeout=8000)
    assert page.evaluate(overlap_js) is None
    # On a phone every tile is full width, one under another.
    page.set_viewport_size({"width": 390, "height": 800})
    page.wait_for_timeout(300)
    assert page.evaluate("[...document.querySelectorAll('#tp-board > [data-tile]')].every(t => Math.abs(t.getBoundingClientRect().width - document.getElementById('tp-board').getBoundingClientRect().width) < 2)")


def _day_of_three(fake):
    for sid, t, best in (("g1", "09:25", 89.1), ("g2", "11:29", 81.1), ("g3", "14:46", 87.7)):
        rec = day_session(sid, t, best, 3)
        fake.sessions[sid] = dict(rec)
        fake.index.append(summary(rec))


def test_a_session_has_a_skip_to_section_list_and_an_exit_button_and_the_map_is_called_map(page):
    """At the top of a session: Skip to section (only the sections that session has) and Exit session on the right,
    which goes back to the list. The compare map's heading is Map, not Where you are."""
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    expect(page.locator("#tp-session-bar")).to_be_visible()
    texts = [t.strip() for t in page.locator("#tp-skip option").all_text_contents()]
    assert texts[0] == "Skip to section" and "Map" in texts and "Session settings" in texts and "Laps" in texts and "G-force and speed" in texts, texts
    expect(page.locator("#tp-mapcard h3").first).to_have_text("Map")
    expect(page.locator("body")).not_to_contain_text("Where you are")
    page.select_option("#tp-skip", label="Session settings")
    expect(page.locator("#tp-skip")).to_have_value("")
    page.wait_for_function("document.querySelector('#settings').getBoundingClientRect().top < window.innerHeight")
    page.locator("#tp-exit").click()
    expect(page.locator("#tp-sess-list")).to_be_visible()


def test_the_grip_tile_is_wide_enough_to_close_the_gap_beside_it(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.set_viewport_size({"width": 1280, "height": 900})
    page.wait_for_timeout(400)
    grip, mapcard = page.locator("[data-tile='grip']").bounding_box(), page.locator("[data-tile='map']").bounding_box()
    assert abs(grip["y"] - mapcard["y"]) < 2000 and mapcard["x"] - (grip["x"] + grip["width"]) < 40, (grip, mapcard)


def test_the_sessions_list_under_the_trend_is_short_until_opened(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    base = fake.sessions["new1"]
    for i in range(6):
        rec = dict(base, id="x%d" % i, date="2026-0%d-1%d" % (i + 1, i), bestTime=99.0 - i)
        fake.sessions[rec["id"]] = rec
        fake.index.append(summary(rec))
    page.goto("/track.html?s=new1")
    tile = page.locator("[data-tile='overtime-table']")
    tile.wait_for()
    rows = page.locator("[data-tile='overtime-table'] tbody tr")
    total = rows.count()
    assert total > 4
    assert page.locator("[data-tile='overtime-table'] tbody tr:visible").count() == 4
    page.locator("#tp-sess-more").click()
    assert page.locator("[data-tile='overtime-table'] tbody tr:visible").count() == total
    expect(page.locator("#tp-sess-more")).to_have_text("Show fewer sessions")
    page.locator("#tp-sess-more").click()
    assert page.locator("[data-tile='overtime-table'] tbody tr:visible").count() == 4


def test_the_bulk_edit_can_use_the_previous_tyres_and_brake_pads(page):
    """Edit all N sessions offers the car's last tyres and brake pads from before that day: one tap fills the fields in and
    switches the change on, then Apply puts them on every session of the day."""
    fake = FakeWorker(earlier=False)
    earlier = dict(day_session("p1", "10:00", 95.0, 3, date="2026-06-01", venue="Thruxton", venue_id="thruxton"), tyres="Michelin Pilot Sport 4S, 245/35 R19",
                   tyreMake="Michelin", tyreModel="Pilot Sport 4S", pads="Pagid RSL29", padFrontMake="Pagid", padFrontCompound="RSL29")
    fake.sessions["p1"] = dict(earlier)
    fake.index.append(summary(earlier))
    _day_of_three(fake)
    open_page(page, fake)
    into_track(page, "Castle Combe")
    page.locator("[data-day-edit]").click()
    expect(page.locator("#tp-de-prev-tyres")).to_contain_text("Michelin Pilot Sport 4S, 245/35 R19")
    expect(page.locator("#tp-de-prev-pads")).to_contain_text("Pagid RSL29")
    page.locator("#tp-de-use-tyres").click()
    expect(page.locator("#tp-de-tyres")).to_be_visible()
    expect(page.locator("#tp-de-tyre-make")).to_have_value("Michelin")
    expect(page.locator("#tp-de-tyre-model-pick")).to_have_value("Pilot Sport 4S")
    expect(page.locator("#tp-de-tyre-w")).to_have_value("245")
    page.locator("#tp-de-use-pads").click()
    expect(page.locator("#tp-de-pads")).to_be_visible()
    expect(page.locator("#tp-de-pad-front-make")).to_have_value("Pagid")
    expect(page.locator("#tp-de-pad-front-comp")).to_have_value("RSL29")
    page.locator("[data-day-edit-apply]").click()
    expect(page.locator("#tp-saved")).to_contain_text("are updated")
    for sid in ("g1", "g2", "g3"):
        v = fake.sessions[sid]
        assert v.get("tyreMake") == "Michelin" and v.get("tyreModel") == "Pilot Sport 4S" and v.get("tyreWidth") == 245, v
        assert v.get("padFrontMake") == "Pagid" and v.get("padFrontCompound") == "RSL29", v


def _many_days(fake, extra_days=10):
    for n in range(extra_days):
        rec = day_session("a%d" % n, "10:00", 90.0 + n, 3, date="2026-05-%02d" % (n + 1))
        fake.sessions[rec["id"]] = dict(rec)
        fake.index.append(summary(rec))
    for sid, t, best in (("g1", "09:25", 89.1), ("g2", "11:29", 81.1), ("g3", "14:46", 87.7)):
        rec = day_session(sid, t, best, 3)
        fake.sessions[sid] = dict(rec)
        fake.index.append(summary(rec))


def test_the_sessions_tree_steps_down_one_arrow_at_a_time_with_compact_dates(page):
    """Track, then layout, then date, each opened by its own arrow. A closed date is one compact row (date, how many
    sessions and the fastest, a chevron), not a full card; the date's arrow opens the card."""
    fake = FakeWorker(earlier=False)
    _many_days(fake, 4)
    open_page(page, fake)
    wrap = page.locator("#tp-sess-list .tp-trackwrap", has_text="Castle Combe")
    wrap.locator("[data-track-toggle]").click()
    expect(wrap.locator(".tp-layouts")).to_be_visible()
    expect(wrap.locator(".tp-layout-sessions")).to_be_hidden()
    wrap.locator("[data-layout-toggle]").click()
    day = wrap.locator(".tp-daygroup", has_text="14 Jul 2026")
    expect(day.locator(".tp-day-sub")).to_have_text("3 sessions, fastest 1:21.10")
    expect(day.locator(".tp-daygroup-best")).to_be_hidden()
    expect(day.locator("[data-day-edit]")).to_be_hidden()
    # A folded private day carries a small lock.
    expect(day.locator(".tp-day-priv")).to_have_attribute("aria-label", "Only me")
    day.locator(".tp-daygroup-title[data-day-toggle]").click()
    # An open date lists every session at once: no fastest-only step.
    expect(day.locator("[data-day-edit]")).to_be_visible()
    expect(day.locator(".tp-daygroup-best")).to_have_count(0)
    expect(day.locator(".tp-daygroup-less")).to_have_count(0)
    expect(day.locator("[data-day-all], [data-day-fast]")).to_have_count(0)
    expect(day.locator(".tp-daygroup-all .tp-row")).to_have_count(3)
    expect(day).to_have_attribute("data-open", "true")
    expect(day.locator(".tp-day-priv")).to_be_hidden()



def test_a_folded_day_shows_an_eye_when_shared_a_lock_when_private_and_a_track_row_never_opens_a_page(page):
    """The track's row only steps down to its layouts; a folded date carries a small eye (shared) or lock (private)."""
    fake = FakeWorker(earlier=False)
    _many_days(fake, 2)
    for entry in fake.index:
        if entry["date"] == "2026-05-01":
            entry["privacy"] = "board"
        if entry["id"] == "g1":
            entry["privacy"] = "board"
    open_page(page, fake)
    wrap = page.locator("#tp-sess-list .tp-trackwrap", has_text="Castle Combe")
    wrap.locator(".tp-trackrow").click()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    expect(wrap.locator(".tp-layouts")).to_be_visible()
    wrap.locator("[data-layout-toggle]").click()
    shared = wrap.locator('.tp-daygroup[data-day$="2026-05-01"]')
    private = wrap.locator('.tp-daygroup[data-day$="2026-05-02"]')
    mixed = wrap.locator(".tp-daygroup", has_text="14 Jul 2026")
    expect(shared.locator(".tp-day-priv")).to_have_attribute("aria-label", "Shared")
    expect(shared.locator(".tp-day-priv .icon")).to_be_visible()
    expect(private.locator(".tp-day-priv")).to_have_attribute("aria-label", "Only me")
    expect(mixed.locator(".tp-day-priv")).to_have_attribute("aria-label", "Some sessions shared")
    # The icon sits just left of the arrow, on the same row.
    pb, ab = shared.locator(".tp-day-priv").bounding_box(), shared.locator(".tp-day-arrow").bounding_box()
    assert pb["x"] + pb["width"] <= ab["x"] + 2 and abs((pb["y"] + pb["height"] / 2) - (ab["y"] + ab["height"] / 2)) < 6, (pb, ab)


def _hold(page, locator, ms=750):
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(ms)
    page.mouse.up()


def test_holding_sessions_of_a_day_picks_them_and_the_bulk_edit_changes_only_those(page):
    """It rained for two sessions of the day but not the others: hold on a session to pick it (it stays highlighted), tap more
    to add or remove, and the Edit button then changes only the picked ones."""
    fake = FakeWorker(earlier=False)
    _many_days(fake, 1)
    open_page(page, fake)
    page.set_viewport_size({"width": 1100, "height": 900})
    wrap = page.locator("#tp-sess-list .tp-trackwrap", has_text="Castle Combe")
    wrap.locator(".tp-trackrow").click()
    wrap.locator("[data-layout-toggle]").click()
    day = wrap.locator(".tp-daygroup", has_text="14 Jul 2026")
    day.locator(".tp-daygroup-title[data-day-toggle]").click()
    edit = day.locator("[data-day-edit]")
    expect(edit).to_contain_text("Edit all 3 sessions")
    expect(day.locator(".tp-pick-hint")).to_be_visible()
    expect(day.locator("[data-pickbar]")).to_be_hidden()
    row = lambda sid: day.locator('a.tp-row[data-sid="%s"]' % sid)
    # Hold on one: picked, highlighted, and the session does not open.
    _hold(page, row("g1"))
    expect(page).to_have_url(re.compile(r"track\.html(\?mycar=[^&]*)?$"))
    expect(row("g1")).to_have_class(re.compile("is-picked"))
    expect(edit).to_contain_text("Edit the 1 selected session")
    expect(day.locator("[data-pick-count]")).to_have_text("1 selected")
    # With one picked a tap picks more (and unpicks) instead of opening the session.
    row("g3").click()
    row("g2").click()
    expect(edit).to_contain_text("Edit the 3 selected sessions")
    row("g2").click()
    expect(row("g2")).not_to_have_class(re.compile("is-picked"))
    expect(edit).to_contain_text("Edit the 2 selected sessions")
    expect(page).to_have_url(re.compile(r"track\.html(\?mycar=[^&]*)?$"))
    edit.click()
    form = page.locator("#tp-dayedit")
    expect(form.locator("h3")).to_contain_text("Edit the 2 selected sessions")
    form.locator("[data-cond] button[data-v='Wet']").click()
    form.locator("[data-day-edit-apply]").click()
    expect(page.locator("#tp-saved")).to_contain_text("The 2 selected sessions at 14 Jul 2026 at Castle Combe are updated")
    assert fake.sessions["g1"]["conditions"] == "Wet" and fake.sessions["g3"]["conditions"] == "Wet" and fake.sessions["g2"]["conditions"] == "Dry"
    # The picking is cleared once applied.
    expect(page.locator("a.tp-row.is-picked")).to_have_count(0)


def test_picked_sessions_can_be_cleared_and_ctrl_click_picks(page):
    fake = FakeWorker(earlier=False)
    _many_days(fake, 1)
    open_page(page, fake)
    page.set_viewport_size({"width": 390, "height": 800})
    wrap = page.locator("#tp-sess-list .tp-trackwrap", has_text="Castle Combe")
    wrap.locator(".tp-trackrow").click()
    wrap.locator("[data-layout-toggle]").click()
    day = wrap.locator(".tp-daygroup", has_text="14 Jul 2026")
    day.locator(".tp-daygroup-title[data-day-toggle]").click()
    day.locator('a.tp-row[data-sid="g2"]').click(modifiers=["Control"])
    expect(day.locator("a.tp-row.is-picked")).to_have_count(1)
    expect(day.locator("[data-pickbar]")).to_be_visible()
    day.locator("[data-pick-clear]").click()
    expect(day.locator("a.tp-row.is-picked")).to_have_count(0)
    expect(day.locator("[data-pickbar]")).to_be_hidden()
    expect(day.locator("[data-day-edit]")).to_contain_text("Edit all 3 sessions")
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_a_bulk_edit_stays_on_the_day_that_was_changed(page):
    """After Apply the list redraws, but the page stays on the day that was edited (open, in view) instead of jumping back
    to the top."""
    fake = FakeWorker(earlier=False)
    _many_days(fake, 12)
    open_page(page, fake)
    page.set_viewport_size({"width": 1100, "height": 700})
    wrap = page.locator("#tp-sess-list .tp-trackwrap", has_text="Castle Combe")
    wrap.locator("[data-track-toggle]").click()
    wrap.locator("[data-layout-toggle]").click()
    day = wrap.locator(".tp-daygroup", has_text="14 Jul 2026")
    day.scroll_into_view_if_needed()
    day.locator(".tp-daygroup-title[data-day-toggle]").click()
    day.locator("[data-day-edit]").click()
    page.locator("#tp-dayedit [data-cond] button[data-v='Wet']").click()
    page.locator("[data-day-edit-apply]").click()
    expect(page.locator("#tp-saved")).to_contain_text("are updated")
    page.wait_for_timeout(600)
    top = page.evaluate("(() => { const d = [...document.querySelectorAll('.tp-daygroup')].find(x => x.textContent.includes('14 Jul 2026')); const r = d.getBoundingClientRect(); return [r.top, r.bottom, innerHeight, scrollY]; })()")
    assert top[3] > 200 and top[0] < top[2] and top[1] > 0, top
    assert all(v["conditions"] == "Wet" for k, v in fake.sessions.items() if k.startswith("g"))


def test_skip_to_and_exit_session_share_one_row_on_a_phone(page):
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    page.set_viewport_size({"width": 390, "height": 800})
    page.wait_for_timeout(300)
    skip, exit_ = page.locator("#tp-skip").bounding_box(), page.locator("#tp-exit").bounding_box()
    assert abs((skip["y"] + skip["height"] / 2) - (exit_["y"] + exit_["height"] / 2)) < 6, (skip, exit_)
    assert skip["x"] + skip["width"] <= exit_["x"] + 1 and exit_["x"] + exit_["width"] <= 390, (skip, exit_)


def test_exiting_a_session_lands_on_the_list_at_the_row_it_came_from(page):
    """Exit session (and Back) return to the list at the session that was open, not at the top of the page."""
    fake = FakeWorker(earlier=False)
    _many_days(fake, 12)
    open_page(page, fake)
    page.set_viewport_size({"width": 1100, "height": 700})
    wrap = page.locator("#tp-sess-list .tp-trackwrap", has_text="Castle Combe")
    wrap.locator("[data-track-toggle]").click()
    wrap.locator("[data-layout-toggle]").click()
    day = wrap.locator('.tp-daygroup[data-day$="2026-05-01"]')
    day.scroll_into_view_if_needed()
    day.locator(".tp-daygroup-title").click()
    day.locator('a.tp-row[data-sid="a0"]').click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=a0$"))
    page.locator("#tp-exit").click()
    expect(page.locator("#tp-sess-list")).to_be_visible()
    page.wait_for_timeout(600)
    pos = page.evaluate("(() => { const r = document.querySelector('a.tp-row[data-sid=\"a0\"]').getBoundingClientRect(); return [r.top, r.bottom, innerHeight, scrollY]; })()")
    assert pos[3] > 200 and 0 <= pos[0] < pos[2] and pos[1] <= pos[2] + 2, pos


def test_the_heading_buttons_are_a_placeholder_while_the_list_loads(page):
    """A signed-in member sees Add a session as a soft placeholder at once (so the heading does not jump) while the
    list loads; a signed-out visitor is not held a place."""
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    held = []
    page.route(re.compile(r"workers\.dev"), lambda route: held.append(route))  # never answers, so the page stays loading
    page.goto("/track.html")
    expect(page.locator("#tp-hero-actions")).to_be_visible()
    expect(page.locator("#tp-hero-add")).to_have_class(re.compile("is-wait"))
    assert page.locator("#tp-hero-add").evaluate("e => getComputedStyle(e).pointerEvents") == "none"
    expect(page.locator("#tp-hero-actions .laps-tip-bulbbtn")).to_be_visible()
    page.evaluate("localStorage.clear()")
    page.add_init_script("localStorage.removeItem('mt3ukMyBuildsSession')")
    page.goto("/track.html")
    expect(page.locator("#tp-hero-actions")).to_be_hidden()


def test_what_others_see_is_a_simple_track_tree_with_a_way_back_for_the_owner(page):
    """The owner's What others see page lists the shared sessions as the same track tree as My Sessions, and the same
    eye icon (switched on, named What I see) takes them back to their own sessions. Visitors do not get the switch."""
    fake = FakeWorker()
    fake.index.append(dict(fake.index[0], id="shared1", privacy="board", date="2026-06-02"))
    fake.public_mine = True
    open_page(page, fake, path="/track.html?car=car1")
    expect(page.locator(".tp-publicbar")).to_contain_text("Public view")
    expect(page.locator(".tp-publicbar")).to_contain_text("nothing here can be edited")
    expect(page.locator(".tp-head [data-tp-share]")).to_have_count(0)
    row = page.locator("#tp-sess-list .tp-trackrow").first
    expect(row).to_be_visible()
    expect(row).to_have_attribute("aria-expanded", "false")
    row.click()
    expect(row).to_have_attribute("aria-expanded", "true")
    page.locator("#tp-sess-list .tp-layoutrow").first.click()
    page.locator("#tp-sess-list .tp-day-tile").first.click()
    # Read only: no Shared switch, no Edit all, nothing to change.
    expect(page.locator("#tp-sess-list [role=switch]")).to_have_count(0)
    expect(page.locator("#tp-sess-list [data-day-edit]")).to_have_count(0)
    mine = page.locator(".tp-head .tp-others")
    expect(mine).not_to_have_class(re.compile("is-on"))
    expect(mine).to_have_attribute("aria-label", "What I see")
    mine.click()
    expect(page).to_have_url(re.compile(r"/track\.html$"))
    expect(page.locator("#tp-vtoggle")).to_be_visible()
    # Someone else's view of the build has no switch and no owner's note.
    fake.public_mine = False
    page.goto("/track.html?car=car1")
    expect(page.locator("#tp-sess-list .tp-trackrow").first).to_be_visible()
    expect(page.locator(".tp-head .tp-others")).to_have_count(0)
    expect(page.locator(".tp-publicbar")).to_have_count(0)
    expect(page.locator(".tp-head [data-tp-share]")).to_have_count(1)
