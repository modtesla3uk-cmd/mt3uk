"""A car added without a photo: "Add your car" on the Laps pages (track.html) and how My Garage shows it. The worker
parts run in node (tests/no_photo_car_check.mjs)."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parent.parent
API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_a_car_without_a_photo_in_the_worker():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "no_photo_car_check.mjs")],
            env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
            capture_output=True, text=True, timeout=120,
        )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 20


from test_track_page import FakeWorker, open_page  # noqa: E402


class NoCarWorker(FakeWorker):
    """The track page's fake worker, with a member who has no car until they add one."""

    def __init__(self):
        super().__init__(earlier=False)
        self.cars = []
        self.added = []

    def reply(self, route):
        req = route.request
        path = req.url.split(API_HOST, 1)[1].split("?")[0]
        headers = {"Access-Control-Allow-Origin": "*"}
        if path == "/my-builds" and req.method == "GET":
            return route.fulfill(status=200, content_type="application/json", headers=headers, body=json.dumps({"success": True, "cars": self.cars}))
        if path == "/my-builds/car/new":
            body = json.loads(req.post_data)
            self.added.append(body)
            car = {"id": "new1", "name": body.get("name") or body["make"] + " " + body["model"], "make": body["make"], "model": body["model"], "vehicleType": body["vehicleType"], "photos": [], "view": []}
            self.cars.append(car)
            return route.fulfill(status=200, content_type="application/json", headers=headers, body=json.dumps({"success": True, "car": car}))
        return super().reply(route)


def test_laps_adds_a_car_without_a_photo(page):
    fake = NoCarWorker()
    open_page(page, fake)
    form = page.locator("#tp-addcar")
    expect(form).to_contain_text("Add your car")
    # Cars only for now: the Car or bike choice is hidden.
    expect(page.locator('[data-addcar-type="bike"]')).to_be_hidden()
    expect(form).to_contain_text("No photo needed")
    # Make and model are needed, and are picked from the vehicle list: drop-downs, nothing typed.
    page.wait_for_function("document.querySelectorAll('#tp-addcar-make option').length > 5", timeout=5000)
    assert page.locator("#tp-addcar-make").evaluate("el => el.tagName") == "SELECT"
    expect(page.locator("#tp-addcar-model")).to_be_disabled()
    expect(form).to_contain_text("Make or model not on the list?")
    page.locator("#tp-addcar-save").click()
    expect(page.locator("#tp-addcar-msg")).to_have_text("Choose the make.")
    page.select_option("#tp-addcar-make", "Porsche")
    expect(page.locator("#tp-addcar-model")).to_be_enabled()
    assert page.locator('#tp-addcar-model option[value="Taycan"]').count() == 1
    page.locator("#tp-addcar-save").click()
    expect(page.locator("#tp-addcar-msg")).to_have_text("Choose the model.")
    page.select_option("#tp-addcar-model", "Taycan")
    page.fill("#tp-addcar-year", "2019")
    page.locator("#tp-addcar-save").click()
    # The new car is chosen, ready for its first session.
    expect(page.locator("#tp-cars .tp-car.is-on")).to_contain_text("Porsche Taycan")
    assert fake.added == [{"make": "Porsche", "model": "Taycan", "year": "2019", "vehicleType": "car", "name": ""}]
    expect(page.get_by_role("link", name="Add a session", exact=True)).to_be_visible()
    # Another car can be added from Your cars; no bike makes are offered.
    page.locator("#tp-vtoggle").click()
    page.locator("#tp-car-add-open").click()
    expect(page.locator("#tp-addcar-save")).to_have_text("Add car")
    page.wait_for_function("[...document.querySelectorAll('#tp-addcar-make option')].some(o => o.value === 'Kia')", timeout=5000)
    assert page.locator('#tp-addcar-make option[value="Zero"]').count() == 0
    page.select_option("#tp-addcar-make", "Kia")
    page.select_option("#tp-addcar-model", "EV6 GT")
    page.fill("#tp-addcar-name", "Track car")
    page.locator("#tp-addcar-save").click()
    # Two vehicles: the list is folded to the one picked, and Change opens it with a row for each.
    expect(page.locator("#tp-vtoggle")).to_be_visible()
    page.locator("#tp-vtoggle").click()
    page.wait_for_function("document.querySelectorAll('#tp-cars .tp-car[data-car]').length === 2", timeout=5000)
    assert fake.added[-1]["vehicleType"] == "car" and fake.added[-1]["name"] == "Track car"


from test_devices import all_devices, device_page, browsers, diagnostics  # noqa: E402,F401
from test_garage_mods import signed_in  # noqa: E402
from test_devices import overflow_width  # noqa: E402


@all_devices
def test_my_garage_shows_a_car_without_a_photo_and_can_remove_it(device_page):
    page = device_page
    page.mock_state["car_details"] = {"make": "Porsche", "model": "911 GT3", "vehicleType": "car", "garageOnly": True, "photos": []}
    signed_in(page)
    page.goto("/my-builds.html")
    tile = page.locator(".mb-car-tile").first
    expect(tile.locator(".mb-car-tile-nophoto")).to_contain_text("No photo yet")
    expect(tile).to_contain_text("0 photos")
    tile.click(timeout=10000)
    note = page.locator(".mb-nophoto")
    expect(note).to_contain_text("No photos yet")
    page.once("dialog", lambda d: d.accept())
    before = len(page.api_log)
    note.get_by_role("button", name="Remove this car").click()
    page.wait_for_function("location.pathname.endsWith('/my-builds.html') && !document.querySelector('.mb-nophoto')", timeout=10000)
    assert any(line.startswith("POST /my-builds/car/remove") for line in page.api_log[before:]), page.api_log[before:]
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_bikes_page_says_bike(device_page):
    page = device_page
    page.mock_state["car_details"] = {"make": "Ducati", "model": "Panigale V4", "vehicleType": "bike", "garageOnly": True,
                                      "photos": [{"file": "duc.jpg", "caption": "", "gallery": False, "reel": False, "votable": False}]}
    signed_in(page)
    page.goto("/my-builds.html")
    expect(page.locator("#mb-addcar-toggle-btn")).to_contain_text("Add Another Vehicle?")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    expect(page.locator("#mb-addphoto-toggle-btn")).to_have_text("+ Add photo to this bike")
    assert page.errors == [], diagnostics(page)


def test_a_bike_session_says_bike(page):
    from test_track_page import save_thruxton_with_a_member_board
    fake = FakeWorker()
    save_thruxton_with_a_member_board(page, fake)
    expect(page.locator("#tp-follow")).to_have_text("Follow cars")
    for rec in fake.sessions.values():
        rec["vehicleType"] = "bike"
    page.reload()
    expect(page.locator("#tp-follow")).to_have_text("Follow bikes")
    expect(page.locator("#tp-follow")).to_have_attribute("title", "When the map is zoomed in, keep the bikes in view")
