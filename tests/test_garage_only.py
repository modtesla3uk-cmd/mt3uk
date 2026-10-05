"""A car or bike of another make, kept in the member's garage (My Garage's Add a
car, Another make): its photos stay out of the Gallery, the Reel and Build of the
Week, cannot be switched on, and only MT3UK can show it (the Other makes panel on
admin.html). The worker parts run in node (tests/garage_only_check.mjs)."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from playwright.sync_api import expect

from test_devices import all_devices, device_page, browsers, diagnostics, overflow_width  # noqa: F401
from test_garage_mods import open_car, signed_in

ROOT = Path(__file__).resolve().parent.parent
API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_a_car_of_another_make_is_kept_in_the_garage_in_the_worker():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        source += "\nexport { putSidecar, saveCarRecord };\n"
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "garage_only_check.mjs")],
            env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
            capture_output=True, text=True, timeout=120,
        )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 40


@all_devices
def test_add_a_car_of_another_make(device_page):
    """Another make shows Car or bike, Make and Model (suggested from data/vehicles.json, anything can be
    typed) in place of Version, and says the car is kept in the garage. The worker is told it is another make."""
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    expect(page.locator("#mb-addcar-other")).to_be_hidden()
    form.locator(".mb-model-pick .chip", has_text="Another make").click()
    expect(page.locator("#mb-addcar-other")).to_be_visible()
    expect(page.locator("#mb-addcar-other .mb-other-note")).to_contain_text("Kept in your garage")
    expect(page.locator("#mb-addcar-version")).to_be_hidden()
    # The makes on the list are suggested, Tesla is not (it has its own chips), and a bike's makes are its own.
    page.wait_for_function("document.querySelectorAll('#mb-addcar-makes option').length > 5", timeout=5000)
    makes = page.locator("#mb-addcar-makes option").evaluate_all("els => els.map(e => e.value)")
    assert "Kia" in makes and "Tesla" not in makes and "Ducati" not in makes
    page.fill("#mb-addcar-make", "Kia")
    page.wait_for_function("[...document.querySelectorAll('#mb-addcar-othermodels option')].some(o => o.value === 'EV6 GT')", timeout=5000)
    page.fill("#mb-addcar-othermodel", "EV6 GT")
    page.fill("#mb-addcar-carname", "Kit")
    page.select_option("#mb-addcar-color", "Grey")
    page.set_input_files("#mb-addcar-photo", files=[{"name": "car.jpg", "mimeType": "image/jpeg", "buffer": b"\xff\xd8\xff\xd9"}])
    assert overflow_width(page) <= 0
    page.click("#mb-addcar-submit-btn")
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    submits = page.mock_state.get("submits", [])
    if submits and submits[-1]:
        body = submits[-1]
        assert 'name="otherMake"' in body and 'name="make"' in body and "Kia" in body and "EV6 GT" in body and 'name="vehicleType"' in body, body[:2000]
        assert "__other__" not in body and 'name="version"' not in body
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_bike_lists_bike_makes(device_page):
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    form.locator(".mb-model-pick .chip", has_text="Another make").click()
    page.locator("#mb-addcar-other .chip", has_text="Bike").click()
    page.wait_for_function("[...document.querySelectorAll('#mb-addcar-makes option')].some(o => o.value === 'Ducati')", timeout=5000)
    makes = page.locator("#mb-addcar-makes option").evaluate_all("els => els.map(e => e.value)")
    assert "Kia" not in makes and "Honda" in makes
    # The Tesla path is unchanged: picking a Tesla again hides the extra fields and needs no make.
    form.locator(".mb-model-pick .chip", has_text="Model 3").click()
    expect(page.locator("#mb-addcar-other")).to_be_hidden()
    expect(page.locator("#mb-addcar-version")).to_be_visible()
    assert page.locator("#mb-addcar-make").evaluate("el => el.required") is False
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_car_kept_in_the_garage_has_no_gallery_switches_and_can_ask_to_be_shown(device_page):
    page = device_page
    page.mock_state["car_details"] = {"make": "Kia", "model": "EV6 GT", "vehicleType": "car", "garageOnly": True, "galleryAsked": False,
                                      "photos": [{"file": "kia.jpg", "caption": "Kit", "gallery": False, "reel": False, "votable": False}]}
    signed_in(page)
    page.goto("/my-builds.html")
    tile = page.locator(".mb-car-tile").first
    expect(tile.locator(".mb-car-private")).to_have_text("Garage only")
    tile.click(timeout=10000)
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    # No Gallery, Reel or Voting switches, no Gallery, Reel or Voting links, and the add-photo form says why.
    expect(page.locator(".mb-photo-thumb-wrap")).to_have_count(1)
    expect(page.locator(".mb-photo-toggles")).to_have_count(0)
    for link in ("reel", "vote", "gallery"):
        expect(page.locator('#mb-car-site-links [data-link="%s"]' % link)).to_be_hidden()
    page.locator("#mb-addphoto-toggle-btn").click()
    expect(page.locator("#mb-upload-garage-note")).to_be_visible()
    expect(page.locator("#mb-addphoto-card .mb-toggles")).to_be_hidden()
    hint = page.locator("#mb-vote-hint")
    expect(hint).to_contain_text("Kept in your garage")
    before = len(page.api_log)
    hint.get_by_role("button", name="Ask to show it in the Gallery").click()
    expect(hint).to_contain_text("You've asked us to show it in the Gallery")
    assert any(line.startswith("POST /my-builds/car/gallery-request") for line in page.api_log[before:]), page.api_log[before:]
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


def test_the_other_makes_panel_approves_and_declines(page):
    state = {"pending": [
        {"carId": "c1", "email": "kit@example.com", "name": "Kit", "car": "Kit's EV6", "title": "Kia EV6 GT", "type": "car", "photos": ["kia.jpg"], "note": "Track build", "at": "2026-10-04T10:00:00Z"},
        {"carId": "c2", "email": "dan@example.com", "name": "Dan", "car": "Red", "title": "Ducati Panigale V4", "type": "bike", "photos": [], "at": "2026-10-05T10:00:00Z"}],
        "posts": []}

    def handler(route):
        req = route.request
        headers = {"Access-Control-Allow-Origin": "*"}
        if "/my-builds/admin/garage-gallery" in req.url:
            if req.method == "POST":
                body = json.loads(req.post_data)
                state["posts"].append(body)
                state["pending"] = [p for p in state["pending"] if p["carId"] != body["carId"]]
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "pending": state["pending"]}), headers=headers)
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}), headers=headers)

    page.route("**/%s/**" % API_HOST, handler)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#garage-asks-wrap summary").click()
    rows = page.locator("#ga-list .ga-row")
    expect(rows).to_have_count(2)
    expect(rows.first).to_contain_text("Kia EV6 GT")
    expect(rows.first).to_contain_text("Note: Track build")
    expect(rows.nth(1)).to_contain_text("a bike")
    expect(page.locator("#garage-asks-count")).to_have_text("(2 waiting)")
    page.once("dialog", lambda d: d.accept())
    rows.first.get_by_role("button", name="Make public").click()
    expect(rows).to_have_count(1)
    assert state["posts"][-1] == {"carId": "c1", "action": "approve"}
    page.once("dialog", lambda d: d.accept())
    rows.first.get_by_role("button", name="Keep private").click()
    expect(page.locator("#ga-list")).to_contain_text("Nobody is waiting")
    assert state["posts"][-1] == {"carId": "c2", "action": "decline"}


@all_devices
def test_an_ioniq_or_taycan_is_kept_in_the_garage(device_page):
    """Their chips stay (with their versions), but the car is sent as another make with its make filled in."""
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    form.locator(".mb-model-pick .chip", has_text="Ioniq 5 N").click()
    expect(page.locator("#mb-addcar-other .mb-other-note")).to_be_visible()
    expect(page.locator("#mb-addcar-other-fields")).to_be_hidden()
    expect(page.locator("#mb-addcar-version")).to_be_visible()
    page.select_option("#mb-addcar-version", "Ioniq 5 N")
    page.fill("#mb-addcar-carname", "Blue N")
    page.select_option("#mb-addcar-color", "Other")
    page.set_input_files("#mb-addcar-photo", files=[{"name": "car.jpg", "mimeType": "image/jpeg", "buffer": b"\xff\xd8\xff\xd9"}])
    page.click("#mb-addcar-submit-btn")
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    submits = page.mock_state.get("submits", [])
    if submits and submits[-1]:
        body = submits[-1]
        assert 'name="otherMake"' in body and "Hyundai" in body and "Hyundai Ioniq 5 N" in body and 'name="version"' in body, body[:2000]
    # A Tesla is still not another make.
    page.goto("/my-builds.html")
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form.locator(".mb-model-pick .chip", has_text="Model Y").click()
    expect(page.locator("#mb-addcar-other")).to_be_hidden()
    assert page.errors == [], diagnostics(page)


def test_the_admin_can_keep_an_older_other_make_in_the_garage(page):
    posts = []
    cars = [{"carId": "old5n", "car": "Blue N", "title": "Hyundai Ioniq 5 N", "photos": ["ioniq.jpg"], "owner": "Sam", "email": "sam@example.com"}]

    def handler(route):
        req = route.request
        headers = {"Access-Control-Allow-Origin": "*"}
        if "/my-builds/admin/other-makes" in req.url:
            if req.method == "POST":
                posts.append(json.loads(req.post_data))
                return route.fulfill(status=200, content_type="application/json", body='{"success": true}', headers=headers)
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "cars": cars}), headers=headers)
        if "/my-builds/admin/garage-gallery" in req.url:
            return route.fulfill(status=200, content_type="application/json", body='{"success": true, "pending": []}', headers=headers)
        return route.fulfill(status=200, content_type="application/json", body='{"success": true}', headers=headers)

    page.route("**/%s/**" % API_HOST, handler)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#garage-asks-wrap summary").click()
    page.locator("#ga-find").click()
    row = page.locator("#ga-old .ga-row")
    expect(row).to_have_count(1)
    expect(row).to_contain_text("Hyundai Ioniq 5 N")
    expect(row).to_contain_text("sam@example.com")
    page.once("dialog", lambda d: d.accept())
    expect(row).to_contain_text("on public view")
    row.get_by_role("button", name="Remove from public view").click()
    expect(page.locator("#ga-note")).to_contain_text("Removed from public view")
    expect(page.locator("#ga-old")).to_contain_text("No cars of another make are on public view")
    assert posts == [{"carId": "old5n", "action": "garage", "email": True}]
    # Email the owner can be switched off.
    page.locator("#ga-email").click()
    expect(page.locator("#ga-email")).to_have_attribute("aria-checked", "false")
    page.locator("#ga-find").click()
    page.once("dialog", lambda d: d.accept())
    page.locator("#ga-old .ga-row").get_by_role("button", name="Remove from public view").click()
    expect(page.locator("#ga-note")).to_contain_text("not emailed")
    assert posts[-1] == {"carId": "old5n", "action": "garage", "email": False}


@all_devices
def test_the_owner_can_make_a_public_car_of_another_make_private_again(device_page):
    page = device_page
    page.mock_state["car_details"] = {"make": "Kia", "model": "EV6 GT", "vehicleType": "car", "garageOnly": False, "otherMake": True}
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    hint = page.locator("#mb-vote-hint")
    expect(hint).to_contain_text("This car is on public view")
    before = len(page.api_log)
    page.once("dialog", lambda d: d.accept())
    hint.get_by_role("button", name="Make it private again").click()
    for _ in range(20):
        if any(line.startswith("POST /my-builds/car/make-private") for line in page.api_log[before:]):
            break
        page.wait_for_timeout(100)
    assert any(line.startswith("POST /my-builds/car/make-private") for line in page.api_log[before:]), page.api_log[before:]
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_tesla_has_no_make_private_button(device_page):
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    expect(page.locator("#mb-vote-hint")).to_contain_text("Build of the Week")
    expect(page.locator("#mb-make-private")).to_have_count(0)


def test_find_them_marks_a_car_that_was_made_public(page):
    cars = [{"carId": "k1", "car": "Kit", "title": "Kia EV6 GT", "photos": [], "owner": "Kit", "email": "kit@example.com", "approvedAt": "2026-10-05T10:00:00Z"}]

    def handler(route):
        u = route.request.url
        body = {"success": True, "cars": cars} if "other-makes" in u else ({"success": True, "pending": []} if "garage-gallery" in u else {"success": True})
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"Access-Control-Allow-Origin": "*"})

    page.route("**/%s/**" % API_HOST, handler)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#garage-asks-wrap summary").click()
    page.locator("#ga-find").click()
    row = page.locator("#ga-old .ga-row")
    expect(row).to_contain_text("made public on 5 Oct 2026")
    expect(row.get_by_role("button", name="Remove from public view")).to_be_visible()
