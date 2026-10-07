"""Vehicle makes, models and types (a car or a bike): the starting list in
data/vehicles.json, the Vehicles panel of track-admin.html, the worker's /vehicles
routes, and a car's make, model and type saved with it. Cars saved before
these existed have neither and must look and work as they did. The worker
parts run in node (tests/vehicle_worker_check.mjs)."""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parent.parent
API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"


def test_the_starting_list_is_valid():
    data = json.loads((ROOT / "data" / "vehicles.json").read_text(encoding="utf-8"))
    seen = set()
    for make in data["makes"]:
        assert make["type"] in ("car", "bike"), make
        key = (make["type"], make["name"].lower())
        assert make["name"].strip() and key not in seen, make
        seen.add(key)
        assert make["models"] and len(set(m.lower() for m in make["models"])) == len(make["models"]), make
        assert all(m.strip() for m in make["models"]), make
    cars = {m["name"]: m["models"] for m in data["makes"] if m["type"] == "car"}
    # Every model the garage has always offered is still on the list, under its make.
    assert {"Model 3", "Model Y", "Model S", "Model X"} <= set(cars["Tesla"])
    # The Ioniq 5 N and 6 N are variants of the Ioniq 5 and 6, not models of their own.
    assert {"Ioniq 5", "Ioniq 6"} <= set(cars["Hyundai"]) and "Ioniq 5 N" not in cars["Hyundai"] and "Ioniq 6 N" not in cars["Hyundai"] and "Taycan" in cars["Porsche"]
    assert any(m["type"] == "bike" for m in data["makes"])
    # The variants My Garage has always offered are in the file too, under their make and model.
    versions = {m["name"]: m.get("versions", {}) for m in data["makes"] if m["type"] == "car"}
    assert "Performance" in versions["Tesla"]["Model 3"] and "Plaid" in versions["Tesla"]["Model S"]
    assert "N 84 kWh AWD" in versions["Hyundai"]["Ioniq 5"] and "N 84 kWh AWD" in versions["Hyundai"]["Ioniq 6"] and "4S Cross Turismo" in versions["Porsche"]["Taycan"]
    for make in data["makes"]:
        for model, variants in make.get("versions", {}).items():
            assert model in make["models"] and variants and len(set(variants)) == len(variants), (make["name"], model)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_the_worker_routes_and_a_cars_make_model_and_type():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        source += "\nexport { putSidecar, saveCarRecord, cleanCarModel, driveFor, carDrive, driveModelKey, ownerKey };\n"
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "vehicle_worker_check.mjs")],
            env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
            capture_output=True, text=True, timeout=120,
        )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 29


def open_panel(page, saved):
    """The Vehicles panel on track-admin.html, with a mocked worker that keeps what is saved."""
    state = {"extra": {}, "puts": []}

    def handler(route):
        req = route.request
        headers = {"Access-Control-Allow-Origin": "*"}
        if "/vehicles/admin" in req.url:
            if req.method == "PUT":
                body = json.loads(req.post_data)["library"]
                state["puts"].append(body)
                state["extra"] = body
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": state["extra"]}), headers=headers)
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}), headers=headers)

    state["extra"] = saved
    page.route("**/%s/**" % API_HOST, handler)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/track-admin.html")
    page.locator("#vehicles-wrap summary").click()
    expect(page.locator("#vh-list table")).to_be_visible()
    return state


def test_the_vehicles_panel_lists_the_file_and_adds_a_make(page):
    state = open_panel(page, {})
    rows = page.locator("#vh-list tbody tr")
    first_col = rows.locator("td:first-child b").all_inner_texts()
    assert "Tesla" in first_col and "Zero" in first_col
    # The file lists electric vehicles only.
    assert "Toyota" not in first_col and "Ducati" not in first_col
    assert "makes)" in page.locator("#vehicles-count").inner_text()
    page.locator("#vh-list [data-new]").click()
    page.fill("#vh-name", "Zeekr")
    page.click("#vh-add-model")
    page.locator("#vh-mblocks .vh-mname").last.fill("001 FR")
    page.click("#vh-add-model")
    page.locator("#vh-mblocks .vh-mname").last.fill("7X")
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    assert state["puts"][-1]["makes"] == [{"name": "Zeekr", "type": "car", "models": ["001 FR", "7X"], "versions": {}}]
    expect(page.locator("#vh-list tbody tr", has_text="Zeekr")).to_contain_text("changed here")


def test_a_make_can_be_hidden_and_shown_and_keeps_its_models(page):
    """The Shown switch on a make hides it from members without losing its models or variants; Tesla's is fixed on."""
    state = open_panel(page, {})
    kia = page.locator("#vh-list tr.vh-make", has_text="Kia").first
    expect(kia.locator(".vh-show")).to_have_attribute("aria-checked", "true")
    expect(kia.locator(".vh-badge")).to_have_count(0)
    kia.locator(".vh-show").click()
    expect(page.locator("#vh-note")).to_contain_text("Kia is hidden from members")
    assert state["puts"][-1]["hiddenMakes"] == [{"name": "Kia", "type": "car"}]
    kia = page.locator("#vh-list tr.vh-make", has_text="Kia").first
    expect(kia.locator(".vh-badge")).to_have_text("Hidden from members")
    expect(kia.locator(".vh-show")).to_have_attribute("aria-checked", "false")
    expect(kia).to_contain_text("3 models")
    assert "hidden)" in page.locator("#vehicles-count").inner_text()
    # Shown again.
    kia.locator(".vh-show").click()
    expect(page.locator("#vh-note")).to_contain_text("Kia is shown to members again")
    assert state["puts"][-1]["hiddenMakes"] == []
    # Tesla is always offered in My Garage, so its switch is on and cannot be switched off.
    tesla = page.locator("#vh-list tr.vh-make", has_text="Tesla").first
    expect(tesla.locator(".vh-show")).to_be_disabled()
    # Renaming a hidden make keeps it hidden, under the new name.
    page.locator("#vh-list tr.vh-make", has_text="Kia").first.locator(".vh-show").click()
    expect(page.locator("#vh-note")).to_contain_text("hidden")
    page.locator('#vh-list [data-edit="Kia"][data-type="car"]').click()
    page.fill("#vh-name", "Kia Motors")
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    assert state["puts"][-1]["hiddenMakes"] == [{"name": "Kia Motors", "type": "car"}]


def test_a_removed_make_is_listed_and_can_be_restored(page):
    """Remove takes a make off the list; it is listed under Removed makes, and Restore brings back the built-in
    entry with its models and variants. A make added here is deleted for good, with a warning that says so."""
    state = open_panel(page, {"makes": [{"name": "Zeekr", "type": "car", "models": ["001"], "versions": {}}]})
    expect(page.locator("#vh-list .vh-removed-row")).to_have_count(0)
    expect(page.locator("#vh-list")).to_contain_text("No makes have been removed")
    messages = []
    page.on("dialog", lambda d: (messages.append(d.message), d.accept()))
    page.locator('#vh-list [data-remove="Hyundai"][data-type="car"]').click()
    expect(page.locator("#vh-note")).to_contain_text("Hyundai is removed")
    assert "Removed makes" in messages[-1] and "hide it instead" in messages[-1]
    assert {"name": "Hyundai", "type": "car", "removed": True} in state["puts"][-1]["makes"]
    expect(page.locator('#vh-list tr.vh-make', has_text="Hyundai")).to_have_count(0)
    row = page.locator("#vh-list .vh-removed-row")
    expect(row).to_have_count(1)
    expect(row).to_contain_text("Hyundai")
    expect(row).to_contain_text("5 models")
    row.locator("[data-restore]").click()
    expect(page.locator("#vh-note")).to_contain_text("Hyundai is back")
    assert not any(m.get("removed") and m["name"] == "Hyundai" for m in state["puts"][-1]["makes"])
    hyundai = page.locator("#vh-list tr.vh-make", has_text="Hyundai").first
    expect(hyundai).to_contain_text("5 models")
    expect(page.locator("#vh-list .vh-removed-row")).to_have_count(0)
    # A make added here is deleted for good, and the warning says so; it is not listed as removed.
    page.locator('#vh-list [data-remove="Zeekr"][data-type="car"]').click()
    expect(page.locator("#vh-note")).to_contain_text("Zeekr is removed")
    assert "deletes it for good" in messages[-1]
    expect(page.locator("#vh-list .vh-removed-row")).to_have_count(0)
    # Removing a hidden make clears its hidden mark.
    page.locator("#vh-list tr.vh-make", has_text="Kia").first.locator(".vh-show").click()
    expect(page.locator("#vh-note")).to_contain_text("hidden")
    page.locator('#vh-list [data-remove="Kia"][data-type="car"]').click()
    expect(page.locator("#vh-note")).to_contain_text("Kia is removed")
    assert state["puts"][-1]["hiddenMakes"] == []


def test_use_the_built_in_list_drops_a_makes_changes(page):
    """A make changed on the panel can go back to the file's list: the override is dropped, so the file's models
    and variants show again. A make straight from the file has no such button."""
    state = open_panel(page, {"makes": [{"name": "Hyundai", "type": "car", "models": ["Ioniq 5", "Kona N"], "versions": {"Ioniq 5": ["5N"]}}]})
    hyundai = page.locator("#vh-list tr.vh-make", has_text="Hyundai").first
    expect(hyundai).to_contain_text("changed here")
    expect(hyundai).to_contain_text("2 models")
    page.locator('#vh-list [data-edit="Hyundai"][data-type="car"]').click()
    page.once("dialog", lambda d: d.accept())
    page.click("#vh-reset")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    assert state["puts"][-1]["makes"] == []
    hyundai = page.locator("#vh-list tr.vh-make", has_text="Hyundai").first
    expect(hyundai).not_to_contain_text("changed here")
    expect(hyundai).to_contain_text("5 models")
    expect(hyundai.locator('.vh-model[data-model="Ioniq 9"]')).to_contain_text("4 variants")
    page.locator('#vh-list [data-edit="Tesla"][data-type="car"]').click()
    expect(page.locator("#vh-reset")).to_have_count(0)
    # The kerb weight boxes show the file's figures (data/vehicles.json) until the admin changes them.
    m3 = page.locator('#vh-form [data-model-block]', has=page.locator('.vh-mname[value="Model 3"]'))
    assert m3.locator(".vh-mweight").input_value() == "1765"
    assert m3.locator(".vh-vrow", has=page.locator('input[value="Performance"]')).locator(".vh-vweight").input_value() == "1845"


def test_a_make_can_be_taken_off_and_bike_makes_are_kept_apart(page):
    state = open_panel(page, {"makes": [{"name": "Honda", "type": "bike", "models": ["CBR600RR", "NC750"]}]})
    # A bike make added here is listed beside the file's makes.
    expect(page.locator("#vh-list tbody tr", has_text="NC750")).to_have_count(1)
    page.once("dialog", lambda d: d.accept())
    page.locator('#vh-list [data-remove="Tesla"][data-type="car"]').click()
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    makes = state["puts"][-1]["makes"]
    assert {"name": "Tesla", "type": "car", "removed": True} in makes
    assert any(m["name"] == "Honda" and m["type"] == "bike" for m in makes)
    expect(page.locator('#vh-list [data-remove="Tesla"]')).to_have_count(0)


def test_edit_renames_a_make_and_sets_each_models_variants(page):
    state = open_panel(page, {})
    kia = page.locator("#vh-list tr.vh-make", has_text="Kia").first
    expect(kia.locator(".vh-variants")).to_have_count(0)
    expect(kia.locator(".vh-vlist")).to_have_count(0)
    # Tesla's variants from the file are listed under each model, folded, with the wheels each drives.
    tesla = page.locator("#vh-list tr.vh-make", has_text="Tesla").first
    expect(tesla.locator(".vh-model", has_text="Model 3").locator(".vh-vlist summary")).to_have_text("11 variants")
    tesla.locator(".vh-model", has_text="Model 3").locator(".vh-vlist summary").click()
    expect(tesla.locator(".vh-model", has_text="Model 3").locator(".vh-vlist li", has_text="Performance").first).to_contain_text("AWD")
    kia.locator("[data-edit]").click()
    form = page.locator("#vh-form")
    assert form.locator(".vh-mname").evaluate_all("els => els.map(e => e.value)") == ["EV6 GT", "EV6", "EV9"]
    assert form.locator(".vh-vname").count() == 0
    page.fill("#vh-name", "Kia Motors")
    ev6 = form.locator("[data-model-block]").nth(1)
    ev6.locator(".vh-vadd").click()
    ev6.locator(".vh-vname").last.fill("GT-Line")
    ev6.locator(".vh-vadd").click()
    ev6.locator(".vh-vname").last.fill("GT-Line S")
    ev9 = form.locator("[data-model-block]").nth(2)
    ev9.locator(".vh-vadd").click()
    ev9.locator(".vh-vname").last.fill("Air")
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    makes = state["puts"][-1]["makes"]
    assert {"name": "Kia", "type": "car", "removed": True} in makes
    assert {"name": "Kia Motors", "type": "car", "models": ["EV6 GT", "EV6", "EV9"], "versions": {"EV6": ["GT-Line", "GT-Line S"], "EV9": ["Air"]}} in makes
    rows = page.locator("#vh-list tr.vh-make")
    expect(rows.filter(has_text="Kia Motors")).to_have_count(1)
    assert rows.filter(has_text="Kia Motors").locator('.vh-model[data-model="EV6"] .vh-vlist summary').inner_text() == "2 variants"
    # A make with the new name already listed cannot be renamed onto it.
    rows.filter(has_text="Kia Motors").locator("[data-edit]").click()
    page.fill("#vh-name", "Tesla")
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("already on the car list")


def test_edit_changes_and_removes_models_and_variants_and_sets_a_variants_wheels(page):
    """Every model and variant is a row that can be renamed or removed, and a variant has its own driven wheels:
    left on Worked out it takes what its name says, otherwise FWD, RWD or AWD is saved for it (drives, make|model|version)."""
    state = open_panel(page, {})
    page.locator('#vh-list [data-edit="Hyundai"][data-type="car"]').click()
    form = page.locator("#vh-form")
    models = form.locator(".vh-mname").evaluate_all("els => els.map(e => e.value)")
    # The N cars are variants of the Ioniq 5 and 6, not models of their own.
    assert models[:2] == ["Ioniq 5", "Ioniq 6"] and "Ioniq 5 N" not in models
    ioniq5 = form.locator("[data-model-block]").first
    names = ioniq5.locator(".vh-vname").evaluate_all("els => els.map(e => e.value)")
    assert names[:2] == ["58 kWh RWD", "63 kWh RWD"] and names[-1] == "N 84 kWh AWD" and len(names) == 12
    # Each variant says what it works out as.
    n_row = ioniq5.locator(".vh-vrow").last
    assert n_row.locator(".vh-vdrive option").first.inner_text() == "Worked out: AWD"
    assert ioniq5.locator(".vh-vrow").first.locator(".vh-vdrive option").first.inner_text() == "Worked out: RWD"
    # Set one variant's wheels, rename another, remove a third, and remove a whole model.
    ioniq5.locator(".vh-vrow", has=page.locator('input[value="N Line RWD"]')).locator(".vh-vdrive").select_option("AWD")
    ioniq5.locator(".vh-vrow").first.locator(".vh-vname").fill("58 kWh Standard RWD")
    ioniq5.locator(".vh-vrow").nth(1).locator(".vh-vremove").click()
    assert ioniq5.locator(".vh-vrow").count() == 11
    form.locator("[data-model-block]", has=page.locator('input[value="Inster"]')).locator(".vh-mremove").click()
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    saved = state["puts"][-1]
    hyundai = [m for m in saved["makes"] if m["name"] == "Hyundai"][0]
    assert "Inster" not in hyundai["models"] and "Inster" not in hyundai["versions"]
    assert hyundai["versions"]["Ioniq 5"][0] == "58 kWh Standard RWD" and "63 kWh RWD" not in hyundai["versions"]["Ioniq 5"]
    assert saved["drives"] == {"hyundai|ioniq 5|n line rwd": "AWD"}
    expect(page.locator('#vh-list .vh-model[data-model="Ioniq 5"] .vh-vlist li', has_text="63 kWh RWD")).to_have_count(0)
    page.locator('#vh-list .vh-model[data-model="Ioniq 5"] .vh-vlist summary').click()
    expect(page.locator('#vh-list .vh-model[data-model="Ioniq 5"] .vh-vlist li', has_text="N Line RWD")).to_contain_text("AWD (set here)")
    # Reopened, the set wheels show, and clearing them to Worked out drops the key.
    page.locator('#vh-list [data-edit="Hyundai"][data-type="car"]').click()
    row = page.locator("#vh-form [data-model-block]").first.locator(".vh-vrow", has=page.locator('input[value="N Line RWD"]'))
    assert row.locator(".vh-vdrive").input_value() == "AWD"
    row.locator(".vh-vdrive").select_option("")
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    assert state["puts"][-1]["drives"] == {}


def test_saving_a_make_keeps_the_variant_wheels_of_other_makes(page):
    state = open_panel(page, {"drives": {"porsche|taycan|4s": "RWD", "hyundai|ioniq 6|n line rwd": "AWD"}})
    page.locator('#vh-list [data-edit="Hyundai"][data-type="car"]').click()
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    # The Hyundai variant's wheels come back from the form as they were shown, and the Porsche one is untouched.
    assert state["puts"][-1]["drives"] == {"porsche|taycan|4s": "RWD", "hyundai|ioniq 6|n line rwd": "AWD"}
    # A variant's own wheels show in the list, marked as set here.
    page.locator('#vh-list [data-edit="Porsche"][data-type="car"]').click()
    page.click("#vh-cancel")
    page.locator('#vh-list .vh-model[data-model="Taycan"] .vh-vlist summary').click()
    expect(page.locator('#vh-list .vh-model[data-model="Taycan"] .vh-vlist li', has_text="4S").first).to_contain_text("RWD (set here)")


def test_edit_sets_a_models_version_rule(page):
    """Under each model's variants box, Required and Free text set the rule for My Garage's Version box; only
    the ones switched on are saved, and switching both off drops the rule."""
    state = open_panel(page, {})
    page.locator('#vh-list [data-edit="Tesla"][data-type="car"]').click()
    box = page.locator('#vh-form [data-model-block]', has=page.locator('input[value="Model Y"]'))
    expect(box.locator('[data-rule="required"]')).to_have_attribute("aria-checked", "false")
    box.locator('[data-rule="required"]').click()
    box.locator('[data-rule="free"]').click()
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    tesla = [m for m in state["puts"][-1]["makes"] if m["name"] == "Tesla"][0]
    assert tesla["versionRules"] == {"Model Y": {"required": True, "free": True}}
    expect(page.locator('#vh-list .vh-model[data-model="Model Y"]')).to_contain_text("version required, free text")
    expect(page.locator('#vh-list .vh-model[data-model="Model 3"]')).not_to_contain_text("required")
    # Reopening shows them on; switching both off drops the rule from the save.
    page.locator('#vh-list [data-edit="Tesla"][data-type="car"]').click()
    box = page.locator('#vh-form [data-model-block]', has=page.locator('input[value="Model Y"]'))
    expect(box.locator('[data-rule="required"]')).to_have_attribute("aria-checked", "true")
    box.locator('[data-rule="required"]').click()
    box.locator('[data-rule="free"]').click()
    page.click("#vh-save")
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    tesla = [m for m in state["puts"][-1]["makes"] if m["name"] == "Tesla"][0]
    assert "versionRules" not in tesla
    # The same switches sit on each model's row of the list and save at once.
    row = page.locator('#vh-list .vh-model[data-model="Model S"]')
    row.locator('.vh-rule-row[data-rule="free"]').click()
    expect(page.locator("#vh-note")).to_contain_text("Saved")
    tesla = [m for m in state["puts"][-1]["makes"] if m["name"] == "Tesla"][0]
    assert tesla["versionRules"] == {"Model S": {"free": True}} and "Plaid" in tesla["versions"]["Model S"]
    expect(page.locator('#vh-list .vh-model[data-model="Model S"] .vh-rule-row[data-rule="free"]')).to_have_attribute("aria-checked", "true")


def test_the_members_cars_panel_lists_every_car_and_changes_one(page):
    """The Members' cars panel lists every car in the garages with its settings, cars with no model first, and
    Save sends the row's settings; the worker's answer redraws the row."""
    state = {"posts": []}
    cars = [
        {"carId": "c1", "car": "DEVIANT MODEL S", "owner": "Myk", "email": "myk@example.com", "sessions": 3, "photos": 2, "garageOnly": False,
         "make": "", "model": "", "version": "", "year": "", "vehicleType": "car", "drive": "", "set": False},
        {"carId": "c2", "car": "Flash", "owner": "Aaron", "email": "aaron@example.com", "sessions": 1, "photos": 1, "garageOnly": True,
         "make": "Kia", "model": "EV6 GT", "version": "", "year": 2024, "vehicleType": "car", "drive": "AWD", "set": False, "weight": 2200, "pads": "Pagid RSL29"},
        {"carId": "c3", "car": "PROJECT 3 - OLD", "owner": "", "email": "", "sessions": 0, "photos": 2, "livePhotos": 0, "stale": True, "garageOnly": False,
         "make": "", "model": "", "version": "", "year": "", "vehicleType": "car", "drive": "", "set": False},
    ]

    def handler(route):
        req = route.request
        headers = {"Access-Control-Allow-Origin": "*"}
        if "/track/admin/cars" in req.url:
            if req.method == "POST":
                body = json.loads(req.post_data)
                state["posts"].append(body)
                if body.get("action") == "remove":
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "removed": body["carId"]}), headers=headers)
                car = dict(cars[0], make=body["make"], model=body["model"], version=body["version"], year=int(body["year"]), drive="AWD", set=body["drive"] == "AWD")
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "car": car, "stamped": 3, "boards": 1}), headers=headers)
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "cars": cars}), headers=headers)
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {}}), headers=headers)

    page.route("**/%s/**" % API_HOST, handler)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/track-admin.html")
    page.locator("#cars-wrap summary").click()
    rows = page.locator("#mc-list tr.mc-row")
    expect(rows).to_have_count(3)
    expect(page.locator("#cars-count")).to_have_text("(3)")
    # A stale record (no owner, no live photos, no sessions) has only Remove, and goes when confirmed.
    stale = page.locator("#mc-list tr.mc-row.is-stale")
    expect(stale).to_have_count(1)
    expect(stale).to_contain_text("Stale")
    expect(stale.locator(".mc-save")).to_have_count(0)
    page.once("dialog", lambda d: d.accept())
    stale.locator(".mc-remove").click()
    expect(page.locator("#mc-note")).to_contain_text("Removed this stale record")
    assert state["posts"][-1] == {"carId": "c3", "action": "remove"}
    expect(rows).to_have_count(2)
    expect(page.locator("#cars-count")).to_have_text("(2)")
    first = rows.first
    expect(first).to_have_class(re.compile("is-target"))
    expect(first).to_contain_text("Myk")
    expect(first).to_contain_text("no model")
    expect(rows.nth(1).locator(".mc-badge")).to_have_text("Garage only")
    assert rows.nth(1).locator(".mc-model").input_value() == "EV6 GT"
    # Kerb weight (the car's own, else the vehicle list's as the placeholder) and the pads fitted.
    assert rows.nth(1).locator(".mc-weight").input_value() == "2200"
    expect(rows.nth(1).locator('[data-label="Pads"]')).to_have_text("Pagid RSL29")
    expect(first.locator('[data-label="Pads"]')).to_contain_text("Not set")
    # The drop-downs offer the vehicle list's makes, then the make's models, then the model's versions.
    assert "Tesla" in first.locator(".mc-make option").evaluate_all("els => els.map(e => e.value)")
    first.locator(".mc-make").select_option("Tesla")
    assert "Model S" in first.locator(".mc-model option").evaluate_all("els => els.map(e => e.value)")
    first.locator(".mc-model").select_option("Model S")
    assert "Plaid" in first.locator(".mc-version option").evaluate_all("els => els.map(e => e.value)")
    # Type it in opens a text box, and the typed words are what is sent.
    first.locator(".mc-version").select_option(label="Type it in")
    first.locator(".mc-version-typed").fill("Plaid")
    first.locator(".mc-year").fill("2022")
    first.locator(".mc-drive").select_option("AWD")
    expect(first.locator(".mc-weight")).to_have_attribute("placeholder", "Not known")
    first.locator(".mc-weight").fill("2150")
    first.locator(".mc-save").click()
    expect(page.locator("#mc-note")).to_contain_text("3 sessions stamped and 1 leaderboard refreshed")
    assert state["posts"][-1] == {"carId": "c1", "vehicleType": "car", "make": "Tesla", "model": "Model S", "version": "Plaid", "year": "2022", "drive": "AWD", "weight": "2150"}
    row = page.locator('#mc-list tr.mc-row[data-car="c1"]')
    expect(row).not_to_have_class(re.compile("is-target"))
    assert row.locator(".mc-model").input_value() == "Model S"
    assert row.locator(".mc-version").input_value() == "Plaid"
    expect(row.locator(".mc-version-typed")).to_have_count(0)
    assert row.locator(".mc-drive").input_value() == "AWD"
    # The filter box narrows the list by owner or car.
    page.fill("#mc-filter", "aaron")
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Flash")


def test_the_vehicles_panel_shows_each_models_driven_wheels_and_sets_a_default(page):
    posts = []

    def drive_handler(route):
        body = json.loads(route.request.post_data)
        posts.append(body)
        drive = body["drive"]
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                      body=json.dumps({"success": True, "key": "kia|ev9", "drive": drive, "vehicles": 2, "stamped": 5, "boards": 1}))
    open_panel(page, {"makes": [{"name": "Zeekr", "type": "car", "models": ["001 FR"]}], "drives": {"kia|ev6": "AWD"}})
    page.route("**/track/admin/drive**", drive_handler)
    # Every listed model is known, or told from the version; the Zeekr added here is not.
    expect(page.locator(".vh-drive-note")).to_contain_text("car models, driven wheels not known for 1")
    zeekr = page.locator("#vh-list tr.vh-make", has_text="Zeekr").first
    expect(zeekr.locator(".vh-model.is-target")).to_have_count(1)
    expect(zeekr.locator(".vh-how")).to_have_text("not known")
    tesla = page.locator("#vh-list tr.vh-make", has_text="Tesla").first
    model3 = tesla.locator(".vh-model", has_text="Model 3")
    # A model the rule tells from the version says so; one it knows shows the answer; neither is a target.
    expect(model3.locator(".vh-how")).to_have_text("")
    assert model3.locator(".vh-drive option").first.inner_text() == "From the version"
    assert model3.locator(".vh-drive").input_value() == ""
    assert tesla.locator(".vh-model", has_text="Model X").locator(".vh-drive option").first.inner_text() == "Worked out: AWD"
    expect(tesla.locator(".vh-model.is-target")).to_have_count(0)
    # A default already set shows as set here, with what the rule would have said.
    kia = page.locator("#vh-list tr.vh-make", has_text="Kia").first
    ev6 = kia.locator(".vh-model", has_text="EV6").filter(has_not_text="GT")
    assert ev6.locator(".vh-drive").input_value() == "AWD"
    expect(ev6.locator(".vh-how")).to_have_text("set here (worked out: RWD)")
    # A bike make lists its models with no drop-down.
    zero = page.locator("#vh-list tr.vh-make", has_text="Zero").first
    expect(zero.locator(".vh-model").first).to_be_visible()
    expect(zero.locator(".vh-drive")).to_have_count(0)
    # Setting a default posts the make and model and reports what it changed.
    kia.locator(".vh-model", has_text="EV9").locator(".vh-drive").select_option("AWD")
    expect(page.locator("#vh-note")).to_contain_text("AWD is now the default for Kia EV9: 2 vehicles with sessions, 5 sessions stamped and 1 leaderboard refreshed")
    assert posts == [{"make": "Kia", "model": "EV9", "drive": "AWD"}]
    expect(kia.locator(".vh-model", has_text="EV9").locator(".vh-how")).to_have_text("set here (worked out: RWD)")
    # The filter leaves only the models not known.
    page.click("#vh-unknown-only")
    expect(page.locator("#vh-list .vh-table")).to_have_class(re.compile("is-unknown-only"))
    expect(model3).to_be_hidden()
    expect(tesla).to_be_hidden()
    expect(zeekr.locator(".vh-model.is-target")).to_be_visible()


def test_the_leaderboard_shows_a_make_and_has_a_chip_for_a_model_it_does_not_list(page):
    """Cars saved before makes existed look exactly as they did; a car with a make shows it, and a model
    the board did not list before gets its own filter chip."""
    from test_track_page import FakeWorker, board_row, open_page

    fake = FakeWorker(earlier=False)
    old = board_row("a", "a1", 90.0)
    old.update(owner="Ann", car="Ann's 3", model="Model 3", year=2021, version="Performance")
    kia = board_row("k", "k1", 91.0)
    kia.update(owner="Kit", car="Kit's EV6", make="Kia", model="EV6 GT", year=2024, drive="AWD")
    new_tesla = board_row("t", "t1", 92.0)
    new_tesla.update(owner="Tom", car="Tom's Y", make="Tesla", model="Model Y", year=2023)
    # A car whose record has no make or model, named for one: its name says it is a Model S.
    named = board_row("s", "s1", 93.0)
    named.update(owner="Myk", car="DEVIANT MODEL S", model="")
    fake.boards = {"/track/board:thruxton:main": [old, kia, new_tesla, named]}
    open_page(page, fake, "/leaderboards.html?board=thruxton:main", signed_in=False)
    rows = page.locator(".lb-row")
    expect(rows).to_have_count(4)
    # The old-style car is unchanged; the Kia has its make in front.
    expect(rows.first).to_contain_text("2021 Model 3 Performance")
    expect(rows.nth(1)).to_contain_text("2024 Kia EV6 GT")
    # The driven wheels sit with the tyres; a row without them shows none.
    expect(rows.nth(1).locator(".lb-drive")).to_have_text("AWD")
    expect(rows.first.locator(".lb-drive")).to_have_count(0)
    # A Tesla saved with a make still matches the Model Y chip, and the Kia has a chip of its own.
    chips = page.locator("#lb-models .chip")
    assert chips.all_inner_texts()[-1] == "Kia EV6 GT"
    page.locator("#lb-models [data-m='Model Y']").click()
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Tom")
    page.locator("#lb-models [data-m='Kia EV6 GT']").click()
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Kit")
    # The Model S chip counts the car named for one, and lists it.
    expect(page.locator("#lb-models [data-m='Model S']")).not_to_have_class(re.compile("is-empty"))
    expect(page.locator("#lb-models [data-m='Model X']")).to_have_class(re.compile("is-empty"))
    page.locator("#lb-models [data-m='Model S']").click()
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Myk")
    page.locator("#lb-models [data-m='All']").click()
    expect(rows).to_have_count(4)


from test_devices import all_devices, device_page, browsers, diagnostics  # noqa: E402,F401
from test_garage_mods import last_put, open_car  # noqa: E402


@all_devices
def test_my_garage_keeps_a_model_it_does_not_list(device_page):
    """A car with a make and a typed model shows it in the model drop-down, saving the form with nothing
    changed does not lose it, and choosing a listed model also clears the make."""
    page = device_page
    page.mock_state["car_details"] = {"make": "Kia", "model": "EV6 GT", "year": 2024, "vehicleType": "car", "drive": "AWD"}
    open_car(page)
    # Driven wheels show as the car's, and only a change is sent.
    assert page.locator("#mb-car-drive-select").input_value() == "AWD"
    select = page.locator("#mb-car-model-select")
    assert select.input_value() == "EV6 GT"
    assert select.locator("option:checked").inner_text() == "EV6 GT"
    assert page.locator("#mb-car-make-select").input_value() == "Kia"
    page.locator("#mb-car-name-edit").click()
    page.locator("#mb-car-name-save").click()
    page.wait_for_function("document.getElementById('mb-car-model-select').disabled === true", timeout=5000)
    assert not any("model" in put for put in page.mock_state.get("car_puts", [])), page.mock_state.get("car_puts")
    assert select.input_value() == "EV6 GT"
    page.locator("#mb-car-name-edit").click()
    page.select_option("#mb-car-make-select", "Tesla")
    page.select_option("#mb-car-model-select", "Model 3")
    page.locator("#mb-car-name-save").click()
    page.wait_for_function("document.getElementById('mb-car-model-select').disabled === true", timeout=5000)
    body = last_put(page)
    assert body.get("model") == "Model 3" and body.get("make") == "", body
    assert "drive" not in body
    page.locator("#mb-car-name-edit").click()
    page.select_option("#mb-car-drive-select", "RWD")
    page.locator("#mb-car-name-save").click()
    page.wait_for_function("document.getElementById('mb-car-model-select').disabled === true", timeout=5000)
    assert last_put(page).get("drive") == "RWD", last_put(page)
    assert select.input_value() == "Model 3"
    # The Kerb weight box offers the vehicle list's figure for the model and version picked, and only a typed
    # figure is sent.
    page.locator("#mb-car-name-edit").click()
    weight = page.locator("#mb-car-weight")
    assert weight.input_value() == ""
    page.select_option("#mb-car-make-select", "Tesla")
    page.select_option("#mb-car-model-select", "Model 3")
    page.select_option("#mb-car-version-select", "Performance")
    expect(weight).to_have_attribute("placeholder", re.compile(r"Kerb weight \d+ kg \(maker\)"))
    weight.fill("1790")
    page.locator("#mb-car-name-save").click()
    page.wait_for_function("document.getElementById('mb-car-model-select').disabled === true", timeout=5000)
    assert last_put(page).get("weight") == "1790", last_put(page)
    assert page.errors == [], diagnostics(page)


def test_the_add_page_asks_which_wheels_drive_the_car_and_keeps_the_choice(page):
    """The Add page's Driven wheels chips start as the car's; a choice goes with the session and back to the car."""
    from test_track_page import FakeWorker, open_page, FIXTURE
    fake = FakeWorker()
    open_page(page, fake, "/track.html?add=1")
    page.set_input_files("#tp-file", str(FIXTURE))
    chips = page.locator("[data-drive] button")
    expect(chips).to_have_text(["FWD", "RWD", "AWD"])
    expect(page.locator("[data-drive] .is-on")).to_have_count(0)
    page.locator("[data-drive] [data-v='AWD']").click()
    expect(page.locator("[data-drive] .is-on")).to_have_text("AWD")
