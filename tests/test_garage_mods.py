from playwright.sync_api import expect
"""My Garage's model picker and mods list (js/mods-builder.js with the rows
from js/mods-view.js): the model on Add a car and on an existing car, the
"build your mods list" card, the drop-down rows with Edit, and "What others
see". Dates and costs are the owner's only: the lists the worker makes are
checked in tests/test_garage_mods_worker.py."""
import json
import re

from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401


def signed_in(page):
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); localStorage.setItem('mt3ukMyBuildsEmail', 'member@example.com')")


def open_car(page):
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)


def last_put(page):
    puts = page.mock_state.get("car_puts", [])
    return puts[-1] if puts else {}


@all_devices
def test_add_a_car_asks_for_the_model_and_opens_the_new_car(device_page):
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    assert form.locator(".mb-mods-next").is_visible()
    assert page.locator("#mb-addcar-mods").count() == 0
    # Make first, then the make's models; the driven wheels are worked out from the pick.
    expect(form.locator("[data-model-field]")).to_be_hidden()
    form.locator("[data-make-pick] .chip", has_text="Tesla").click()
    expect(form.locator("[data-model-field]")).to_be_visible()
    assert form.locator("[data-model-field] .chip:visible").all_inner_texts() == ["Model 3", "Model Y", "Model S", "Model X"]
    form.locator(".mb-model-pick .chip", has_text="Model Y").click()
    assert form.locator("input[name=model]:checked").get_attribute("value") == "Model Y"
    assert page.locator("#mb-addcar-drive").input_value() == ""
    page.fill("#mb-addcar-carname", "Blue Why")
    page.select_option("#mb-addcar-color", "Grey")
    page.fill("#mb-addcar-caption", "Grey Model Y")
    years = page.locator("#mb-addcar-year option").all_inner_texts()
    assert years[1] == str(__import__("datetime").date.today().year) and years[-1] == "2012"
    # Versions follow the model picked. The model chips are the vehicle list's (data/vehicles.json, edited on the
    # Vehicles panel), with the N cars as variants of the Ioniq 5 and 6 and no Cybertruck or Roadster.
    assert form.locator("[data-make-pick] input").evaluate_all("els => els.map(e => e.value)") == ["Tesla", "Hyundai", "Porsche", "__other__"]
    values = form.locator("[data-model-field] input[name=model]").evaluate_all("els => els.map(e => e.value)")
    assert values[:4] == ["Model 3", "Model Y", "Model S", "Model X"] and "Cybertruck" not in values and "Roadster" not in values
    assert values[4:6] == ["Ioniq 5", "Ioniq 6"] and "Ioniq 5 N" not in values and "Taycan" in values
    versions = page.locator("#mb-addcar-version option").all_inner_texts()
    assert "Juniper Performance" in versions and "Long Range AWD" in versions and "P100D" not in versions
    page.select_option("#mb-addcar-version", "Long Range AWD")
    expect(page.locator("#mb-addcar-drive")).to_have_value("AWD")
    page.select_option("#mb-addcar-year", "2023")
    page.set_input_files("#mb-addcar-photo", files=[{"name": "car.jpg", "mimeType": "image/jpeg", "buffer": b"\xff\xd8\xff\xd9"}])
    assert overflow_width(page) <= 0
    page.click("#mb-addcar-submit-btn")
    # The new car opens, ready for its mods list.
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    submits = page.mock_state.get("submits", [])
    if submits and submits[-1]:
        assert 'name="model"' in submits[-1] and "Model Y" in submits[-1] and "Long Range AWD" in submits[-1]
        assert 'name="drive"' in submits[-1] and "AWD" in submits[-1] and 'name="makePick"' not in submits[-1]
    assert page.errors == [], diagnostics(page)


@all_devices
def test_other_cars_can_be_added_with_their_versions(device_page):
    """A Hyundai or a Porsche is another make: its models are the vehicle list's, each with its own versions, and
    the N cars are versions of the Ioniq 5 and 6."""
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    # Porsche's models are offered; a base Taycan is RWD, a 4S is AWD.
    form.locator("[data-make-pick] .chip", has_text="Porsche").click()
    assert form.locator("[data-model-field] .chip:visible").all_inner_texts()[0] == "Taycan"
    form.locator(".mb-model-pick .chip:visible", has_text="Taycan").click()
    assert form.locator("input[name=model]:checked").get_attribute("value") == "Taycan"
    expect(page.locator("#mb-addcar-drive")).to_have_value("RWD")
    versions = page.locator("#mb-addcar-version option").all_inner_texts()
    assert "Turbo S" in versions and "4S Cross Turismo" in versions and "Juniper Performance" not in versions
    page.select_option("#mb-addcar-version", "4S")
    expect(page.locator("#mb-addcar-drive")).to_have_value("AWD")
    # The member can change it, and the choice stays until the model changes.
    page.select_option("#mb-addcar-drive", "RWD")
    page.select_option("#mb-addcar-version", "Turbo S")
    expect(page.locator("#mb-addcar-drive")).to_have_value("RWD")
    form.locator("[data-make-pick] .chip", has_text="Hyundai").click()
    assert form.locator("input[name=model]:checked").count() == 0
    chips = form.locator("[data-model-field] .chip:visible").all_inner_texts()
    assert chips[:2] == ["Ioniq 5", "Ioniq 6"] and "Ioniq 9" in chips and "Ioniq 5 N" not in chips and "Taycan" not in chips
    form.locator(".mb-model-pick .chip:visible", has_text="Ioniq 5").first.click()
    assert form.locator("input[name=model]:checked").get_attribute("value") == "Ioniq 5"
    versions = page.locator("#mb-addcar-version option").all_inner_texts()
    assert "84 kWh AWD" in versions and "N 84 kWh AWD" in versions and "Turbo S" not in versions
    # A base Ioniq 5 is RWD, its N variant AWD.
    expect(page.locator("#mb-addcar-drive")).to_have_value("RWD")
    page.select_option("#mb-addcar-version", "N 84 kWh AWD")
    expect(page.locator("#mb-addcar-drive")).to_have_value("AWD")
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_model_changed_on_the_vehicles_panel_shows_in_the_garage(device_page):
    """The model chips and the open car's Model drop-down are the vehicle list's: a Hyundai model added there shows
    in both, a Porsche model taken off does not, and a variant is offered under its model."""
    page = device_page
    extra = {"makes": [
        {"name": "Hyundai", "type": "car", "models": ["Ioniq 5", "Ioniq 7"], "versions": {"Ioniq 7": ["Long Range AWD", "Prestige RWD"]}},
        {"name": "Porsche", "type": "car", "models": ["Taycan"]}]}
    page.route(re.compile(r".*/vehicles(\?.*)?$"), lambda route: route.fulfill(
        status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"success": True, "extra": extra})))
    signed_in(page)
    page.goto("/my-builds.html")
    page.wait_for_function("window.MT3UKVehicles && window.MT3UKVehicles.loaded", timeout=10000)
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    form.locator("[data-make-pick] .chip", has_text="Hyundai").click()
    assert form.locator("[data-model-field] .chip:visible").all_inner_texts() == ["Ioniq 5", "Ioniq 7"]
    form.locator(".mb-model-pick .chip:visible", has_text="Ioniq 7").click()
    versions = page.locator("#mb-addcar-version option").all_inner_texts()
    assert "Long Range AWD" in versions and "Prestige RWD" in versions
    # Porsche has the one model now, so it is picked for the member.
    form.locator("[data-make-pick] .chip", has_text="Porsche").click()
    assert form.locator("[data-model-field] .chip:visible").all_inner_texts() == ["Taycan"]
    assert form.locator("input[name=model]:checked").get_attribute("value") == "Taycan"
    # The open car's Model drop-down offers the same.
    page.goto("/my-builds.html")
    page.wait_for_function("window.MT3UKVehicles && window.MT3UKVehicles.loaded", timeout=10000)
    page.locator(".mb-car-tile").first.click(timeout=10000)
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    page.locator("#mb-car-name-edit").click()
    page.select_option("#mb-car-make-select", "Hyundai")
    options = page.locator("#mb-car-model-select optgroup[label=Hyundai] option").evaluate_all("els => els.map(e => e.value)")
    assert options == ["Ioniq 5", "Ioniq 7"]
    page.select_option("#mb-car-model-select", "Ioniq 7")
    assert "Prestige RWD" in page.locator("#mb-car-version-select option").all_inner_texts()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_hidden_or_removed_make_is_not_offered_in_the_garage(device_page):
    """Hiding Hyundai and removing Porsche on the Vehicles panel takes their Make chips and models away in My
    Garage; Tesla is always offered, even if it is hidden or removed, and a car that already has a hidden make keeps it."""
    page = device_page
    extra = {"makes": [{"name": "Porsche", "type": "car", "removed": True}, {"name": "Tesla", "type": "car", "removed": True}],
             "hiddenMakes": [{"name": "Hyundai", "type": "car"}, {"name": "Tesla", "type": "car"}]}
    page.route(re.compile(r".*/vehicles(\?.*)?$"), lambda route: route.fulfill(
        status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"success": True, "extra": extra})))
    signed_in(page)
    page.goto("/my-builds.html")
    page.wait_for_function("window.MT3UKVehicles && window.MT3UKVehicles.loaded", timeout=10000)
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    expect(form.locator('[data-make-pick] .chip', has_text="Hyundai")).to_be_hidden()
    expect(form.locator('[data-make-pick] .chip', has_text="Porsche")).to_be_hidden()
    expect(form.locator('[data-make-pick] .chip', has_text="Tesla")).to_be_visible()
    expect(form.locator('[data-make-pick] .chip', has_text="Another make")).to_be_visible()
    form.locator("[data-make-pick] .chip", has_text="Tesla").click()
    assert form.locator("[data-model-field] .chip:visible").all_inner_texts() == ["Model 3", "Model Y", "Model S", "Model X"]
    # The open car's Make drop-down does not offer them either.
    page.goto("/my-builds.html")
    page.wait_for_function("window.MT3UKVehicles && window.MT3UKVehicles.loaded", timeout=10000)
    page.locator(".mb-car-tile").first.click(timeout=10000)
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    hidden = page.locator("#mb-car-make-select option").evaluate_all("els => els.filter(e => e.hidden).map(e => e.value)")
    assert hidden == ["Hyundai", "Porsche"]
    assert page.errors == [], diagnostics(page)


@all_devices
def test_existing_car_gets_a_model_picker(device_page):
    page = device_page
    open_car(page)
    # Greyed out until Edit is pressed, then saved together with Save.
    assert page.locator("#mb-car-model-select").is_disabled()
    assert page.locator("#mb-car-make-select").is_disabled()
    assert page.locator("#mb-car-color-select").is_disabled()
    assert page.locator("#mb-car-year-select").is_disabled()
    page.locator("#mb-car-name-edit").click()
    # The make comes first, and offers its models.
    page.select_option("#mb-car-make-select", "Tesla")
    page.select_option("#mb-car-model-select", "Model 3")
    page.locator("#mb-car-name-save").click()
    page.wait_for_function("document.getElementById('mb-car-model-select').disabled === true", timeout=5000)
    assert any(line.startswith("PUT /my-builds/car") for line in page.api_log), page.api_log
    body = last_put(page)
    if body:
        assert body.get("model") == "Model 3" and "make" not in body, body
    # A Model 3 saved before makes existed shows Tesla.
    assert page.locator("#mb-car-make-select").input_value() == "Tesla"
    # The other makes are in the list too, each with its models; picking a make offers only its models.
    assert page.locator("#mb-car-model-select optgroup").evaluate_all("els => els.map(e => e.label)") == ["Tesla", "Hyundai", "Porsche"]
    page.locator("#mb-car-name-edit").click()
    page.select_option("#mb-car-make-select", "Hyundai")
    assert page.locator("#mb-car-model-select").input_value() == ""
    assert page.locator("#mb-car-model-select optgroup:not([hidden])").evaluate_all("els => els.map(e => e.label)") == ["Hyundai"]
    page.select_option("#mb-car-model-select", "Ioniq 6")
    assert "N 84 kWh AWD" in page.locator("#mb-car-version-select option").all_inner_texts()
    page.select_option("#mb-car-version-select", "N 84 kWh AWD")
    # The driven wheels follow the pick (an Ioniq 6 N is AWD) until the owner picks them.
    assert page.locator("#mb-car-drive-select").input_value() == "AWD"
    # Cancel puts it back and greys it out again.
    page.locator("#mb-car-name-cancel").click()
    assert page.locator("#mb-car-make-select").input_value() == "Tesla"
    assert page.locator("#mb-car-model-select").input_value() == "Model 3"
    assert page.locator("#mb-car-model-select").is_disabled()
    assert page.errors == [], diagnostics(page)


def expand(page):
    """The Mods list starts folded away: open it."""
    toggle = page.locator("#mb-mods-builder [data-list-toggle]")
    toggle.wait_for(timeout=5000)
    if toggle.get_attribute("aria-expanded") == "false":
        toggle.click()


def rows(page):
    expand(page)
    return page.locator("#mb-mods-builder .mv-rows").first


def start(page):
    page.locator("#mb-mods-builder [data-start]").first.click()
    rows(page).wait_for(timeout=5000)


def open_row(page, area):
    if area != "track":
        expand(page)
    row = page.locator(f'#mb-mods-builder [data-mv-area="{area}"]')
    if "is-open" not in (row.get_attribute("class") or ""):
        row.locator("[data-mv-open]").click()
    return page.locator(f'#mb-mods-builder [data-mv-area="{area}"]')


def edit(page, area):
    open_row(page, area).locator("[data-mv-edit]").click()
    form = page.locator(f'#mb-mods-builder .mbm-area[data-area="{area}"]')
    form.wait_for(timeout=5000)
    return form


def save(page, form):
    form.locator("[data-save]").click()
    form.wait_for(state="detached", timeout=5000)


@all_devices
def test_build_the_mods_list(device_page):
    page = device_page
    open_car(page)
    card = page.locator("#mb-mods-builder .mbm-welcome")
    assert "Test Model 3" in card.inner_text()
    start(page)
    body = last_put(page)
    if body:
        # The mods listed before are sorted into their areas and saved.
        assert body["specs"]["wheels"] == {"status": "up", "items": ["Wheels"]}
        assert "put your existing mods into areas" in page.locator(".mbm-note").inner_text()
        wheels = open_row(page, "wheels")
        assert "Wheels" in wheels.locator(".mv-part").first.inner_text()

    form = edit(page, "wheels")
    form.locator('[data-status="up"]').click()
    form.get_by_label("Make", exact=True).fill("Vossen")
    form.get_by_label("Offset (ET)").fill("ET35")
    form.locator('[data-spacers="1"]').click()
    form.get_by_label("Front spacers").fill("15mm")
    form.get_by_label("Year fitted").first.select_option("2025")
    form.get_by_label("Cost").first.fill("2400")
    assert overflow_width(page) <= 0
    save(page, form)
    body = last_put(page)
    if body:
        spec = body["specs"]["wheels"]
        assert spec["fields"]["make"] == "Vossen" and spec["fields"]["offset"] == "ET35"
        assert spec["spacers"]["on"] is True and spec["spacers"]["front"] == "15mm"
        assert spec["fitted"] == {"year": 2025, "cost": "2400"}
        # Back to the rows, with the saved part and its private line.
        wheels = open_row(page, "wheels")
        assert "Vossen" in wheels.inner_text()
        assert "Fitted 2025" in wheels.locator(".mv-meta").first.inner_text()

    # Stock takes one tap, then Save.
    form = edit(page, "brakes")
    form.locator('[data-status="stock"]').click()
    save(page, form)
    if last_put(page):
        assert last_put(page)["specs"]["brakes"] == {"status": "stock"}
        assert page.locator('#mb-mods-builder [data-mv-area="brakes"] .mv-pill').inner_text() == "Stock"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_cancel_leaves_the_area_as_it_was(device_page):
    page = device_page
    page.mock_state["car_details"] = {"specs": {"tyres": {"status": "up", "fields": {"make": "Michelin"}}}, "mods": ["Tyres: Michelin"]}
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    rows(page).wait_for(timeout=5000)
    puts = len(page.mock_state.get("car_puts", []))
    form = edit(page, "tyres")
    form.get_by_label("Make", exact=True).fill("Pirelli")
    form.locator("[data-cancel]").click()
    form.wait_for(state="detached", timeout=5000)
    assert len(page.mock_state.get("car_puts", [])) == puts
    assert "Michelin" in open_row(page, "tyres").inner_text()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_skip_for_now_shows_the_rows(device_page):
    page = device_page
    open_car(page)
    page.locator("#mb-mods-builder [data-skip]").click()
    rows(page).wait_for(timeout=5000)
    # Not built yet: the listed mods, and a button to build the list.
    assert "Wheels" in open_row(page, "mods").inner_text()
    assert page.locator('#mb-mods-builder [data-start]').is_visible()
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_saved_list_shows_rows_plans_and_what_others_see(device_page):
    page = device_page
    page.mock_state["car_details"] = {
        "model": "Model 3", "version": "Performance", "year": 2021,
        "specs": {"wheels": {"status": "up", "fields": {"make": "Vossen"}, "fitted": {"month": 3, "year": 2025}}, "brakes": {"status": "stock"}},
        "plans": [{"area": "Brakes", "what": "Big brake kit", "when": "Spring 2027"}],
        "mods": ["Wheels: Vossen"],
    }
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    rows(page).wait_for(timeout=5000)
    assert page.locator("#mb-car-model-select").input_value() == "Model 3"
    assert "2 of 9 areas done" in page.locator("#mb-mods-builder .mbm-list-head").inner_text()
    pills = page.locator("#mb-mods-builder [data-mv-area] .mv-pill").all_inner_texts()
    assert pills[:4] == ["Upgraded", "To do", "To do", "Stock"]
    wheels = open_row(page, "wheels")
    assert "Vossen" in wheels.inner_text() and "Fitted 2025" in wheels.inner_text()
    form = edit(page, "wheels")
    assert form.get_by_label("Month fitted").first.input_value() == "3"
    form.locator("[data-cancel]").click()

    # Version and year sit next to Model, at the top.
    assert page.locator("#mb-car-version-select").input_value() == "Performance"
    assert page.locator("#mb-car-year-select").input_value() == "2021"
    assert page.locator('#mb-mods-builder [data-mv-area="about"]').count() == 0
    plans = open_row(page, "plans")
    assert plans.locator(".mbm-plan").first.get_by_label("What").input_value() == "Big brake kit"
    public = open_row(page, "public")
    assert "Vossen" in public.inner_text()
    assert "Fitted" not in public.inner_text(), "No dates in what others see"
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


RICHARDS_MODS = [
    "KW v3 Coilovers", "MPP Front Upper and Rear Control arms", "MPP Rear Traction and Trailing arms",
    "Highland Performance style seats", "Robot Crypton Front bumper", "Carbon Factory Rear Diffuser",
    "CMST Carbon rear spoiler", "Tevo T4 Forged 20x9 wheels", "AP Racing Radical CP9660 Front Calipers",
    "AP Racing 372x32 Front Slotted discs", "AP Racing rear 355x24 Rear discs", "Teslogic v2 transmitter",
    "Carbon steering wheel", "LED interior dash", "Avery Gloss Hidden Forest Vinyl wrap",
]
SORTED = {
    "suspension": RICHARDS_MODS[0:3],
    "interior": ["Highland Performance style seats", "Carbon steering wheel", "LED interior dash"],
    "bodywork": ["Robot Crypton Front bumper", "Carbon Factory Rear Diffuser", "CMST Carbon rear spoiler", "Avery Gloss Hidden Forest Vinyl wrap"],
    "wheels": ["Tevo T4 Forged 20x9 wheels"],
    "brakes": RICHARDS_MODS[8:11],
    "audio": ["Teslogic v2 transmitter"],
}


@all_devices
def test_existing_mods_are_sorted_into_areas(device_page):
    page = device_page
    page.mock_state["car_details"] = {"mods": RICHARDS_MODS}
    open_car(page)
    assert "sorted into areas for you" in page.locator(".mbm-welcome").inner_text()
    start(page)
    body = last_put(page)
    if body:
        assert {k: v["items"] for k, v in body["specs"].items()} == SORTED
        assert "Teslogic v2 transmitter" in open_row(page, "audio").inner_text()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_sort_into_areas_on_a_saved_list(device_page):
    page = device_page
    page.mock_state["car_details"] = {"specs": {"other": {"status": "up", "items": RICHARDS_MODS + ["Something odd"]}}, "mods": RICHARDS_MODS}
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    rows(page).wait_for(timeout=5000)
    form = edit(page, "other")
    form.locator("[data-sort]").click()
    page.locator(".mbm-note").wait_for(timeout=5000)
    body = last_put(page)
    if body:
        items = {k: v.get("items") for k, v in body["specs"].items()}
        assert items.pop("other") == ["Something odd"]
        assert items == SORTED
    assert page.errors == [], diagnostics(page)


def started(page):
    page.mock_state["car_details"] = {"mods": ["Wheels"]}
    open_car(page)
    start(page)


@all_devices
def test_coilover_settings_brakes_front_and_rear_and_more(device_page):
    page = device_page
    started(page)
    susp = edit(page, "suspension")
    susp.locator('[data-status="up"]').click()
    coil = susp.locator(".mbm-up > [data-coil]")
    assert coil.is_hidden()
    susp.locator('select[data-f="fields.type"]').select_option("Coilovers")
    assert coil.is_visible()
    assert "Shown on your build" in coil.inner_text()
    coil.get_by_label("Rebound front").first.fill("8 clicks")
    susp.locator('[data-f="fields.make"]').fill("KW")
    # "+ More" adds another suspension part, which keeps what was typed.
    susp.locator("[data-more-add]").click()
    susp = page.locator('#mb-mods-builder .mbm-area[data-area="suspension"]')
    more = susp.locator('[data-more="0"]')
    more.locator('select[data-f="more.0.type"]').select_option("Control arms")
    more.locator('[data-f="more.0.make"]').fill("MPP")
    assert susp.locator('[data-f="fields.make"]').input_value() == "KW"
    assert more.locator("[data-coil]").is_hidden()
    assert overflow_width(page) <= 0
    save(page, susp)
    body = last_put(page)
    if body:
        s = body["specs"]["suspension"]
        assert s["fields"]["type"] == "Coilovers" and s["fields"]["roadReboundFront"] == "8 clicks"
        assert s["more"] == [{"type": "Control arms", "make": "MPP"}]

    brakes = edit(page, "brakes")
    brakes.locator('[data-status="up"]').click()
    groups = brakes.locator(".mbm-up > .mbm-grid .mbm-group").all_inner_texts()
    assert groups == ["Front", "Rear", "Front and rear"]
    brakes.locator('[data-f="fields.frontCalipers"]').fill("AP Racing CP9660")
    brakes.locator('[data-f="fields.rearDiscs"]').fill("355x24")
    save(page, brakes)
    body = last_put(page)
    if body:
        assert body["specs"]["brakes"]["fields"] == {"frontCalipers": "AP Racing CP9660", "rearDiscs": "355x24"}
    assert page.errors == [], diagnostics(page)


@all_devices
def test_each_part_has_its_own_when_and_where(device_page):
    page = device_page
    started(page)
    body_area = edit(page, "bodywork")
    body_area.locator('[data-status="up"]').click()
    # No single date for all of Bodywork: each job has its own.
    assert body_area.locator('.mbm-up > .mbm-private').count() == 0
    for kind in ("wrap", "dechrome"):
        body_area.locator(f'[data-kind="{kind}"]').click()
    wrap = body_area.locator('[data-kind-body="wrap"]')
    wrap.locator('[data-f="kinds.wrap.make"]').fill("Avery")
    wrap.locator('[data-f="kinds.wrap.fitted.month"]').select_option("5")
    wrap.locator('[data-f="kinds.wrap.fitted.year"]').select_option("2023")
    body_area.locator('[data-kind-body="dechrome"] [data-f="kinds.dechrome.fitted.year"]').select_option("2024")
    body_area.locator("[data-more-add]").click()
    body_area = page.locator('#mb-mods-builder .mbm-area[data-area="bodywork"]')
    body_area.locator('[data-f="more.0.part"]').fill("Front bumper")
    body_area.locator('[data-f="more.0.fitted.cost"]').fill("900")
    assert body_area.locator('[data-f="kinds.wrap.make"]').input_value() == "Avery", "Kept after + More"
    assert overflow_width(page) <= 0
    save(page, body_area)
    body = last_put(page)
    if body:
        b = body["specs"]["bodywork"]
        assert b["kinds"]["wrap"] == {"make": "Avery", "fitted": {"month": 5, "year": 2023}}
        assert b["kinds"]["dechrome"] == {"fitted": {"year": 2024}}
        assert b["more"] == [{"part": "Front bumper", "fitted": {"cost": "900"}}]
        assert "fitted" not in b
        # The job with nothing but a date shows as "Nothing added yet" to the owner.
        assert "Nothing added yet" in open_row(page, "bodywork").inner_text()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_models_version_rule_makes_it_required_or_lets_it_be_typed(device_page):
    """A model's Version rule (Vehicles panel of track-admin.html): Required marks the box and its label, and Free
    text adds Type it in, which opens a text box whose words become the version; a model with no rule is as before."""
    page = device_page
    extra = {"makes": [{"name": "Tesla", "type": "car", "models": ["Model 3", "Model Y", "Model S", "Model X"], "versionRules": {"Model Y": {"required": True, "free": True}}}]}
    page.route(re.compile(r".*/vehicles(\?.*)?$"), lambda route: route.fulfill(
        status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"success": True, "extra": extra})))
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    form.locator("[data-make-pick] .chip", has_text="Tesla").click()
    form.locator(".mb-model-pick .chip", has_text="Model Y").click()
    version = page.locator("#mb-addcar-version")
    expect(page.locator("label[for=mb-addcar-version]")).to_have_text("Version")
    assert version.evaluate("el => el.required")
    assert "Type it in" in version.locator("option").all_inner_texts()
    version.select_option(label="Type it in")
    typed = form.locator(".mb-version-typed")
    expect(typed).to_be_visible()
    typed.fill("Juniper Launch Series")
    assert version.input_value() == "Juniper Launch Series"
    # Picking a listed version closes the box; a model with no rule is optional, with nothing to type.
    version.select_option("Long Range AWD")
    expect(form.locator(".mb-version-typed")).to_have_count(0)
    form.locator(".mb-model-pick .chip", has_text="Model 3").click()
    expect(page.locator("label[for=mb-addcar-version]")).to_have_text("Version (optional)")
    assert not version.evaluate("el => el.required")
    assert "Type it in" not in version.locator("option").all_inner_texts()


@all_devices
def test_version_and_year_next_to_the_model(device_page):
    page = device_page
    open_car(page)
    version = page.locator("#mb-car-version-select")
    assert version.is_disabled(), "Press Edit first"
    page.locator("#mb-car-name-edit").click()
    assert version.is_disabled(), "Pick the model first"
    page.select_option("#mb-car-model-select", "Model S")
    page.wait_for_function("!document.getElementById('mb-car-version-select').disabled", timeout=5000)
    options = version.locator("option").all_inner_texts()
    assert "P85D" in options and "Plaid" in options and "Juniper Standard" not in options
    version.select_option("P85D")
    page.wait_for_function("!document.getElementById('mb-car-version-select').disabled", timeout=5000)
    page.select_option("#mb-car-year-select", "2015")
    years = page.locator("#mb-car-year-select option").all_inner_texts()
    assert years[-1] == "2012"
    page.locator("#mb-car-name-save").click()
    page.wait_for_function("document.getElementById('mb-car-year-select').disabled === true", timeout=5000)
    body = last_put(page)
    if body:
        assert body.get("model") == "Model S" and body.get("version") == "P85D" and body.get("year") == "2015", body
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_track_sessions_link_sits_with_gallery_on_the_car(device_page):
    page = device_page
    page.mock_state["car_details"] = {"specs": {"brakes": {"status": "stock"}}, "mods": []}
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    link = page.locator('#mb-car-site-links [data-link="track"]')
    expect(link).to_be_visible()
    assert link.get_attribute("href") == "track.html?mycar=car-1"
    expect(link.locator(".early-badge")).to_have_text("Early preview")
    boards = page.locator('#mb-car-site-links [data-link="boards"]')
    expect(boards).to_contain_text("Track Leaderboards")
    expect(boards.locator(".mb-new")).to_have_text("NEW")
    assert boards.get_attribute("href") == "leaderboards.html"
    # No longer a row in the Mods list.
    assert page.locator('#mb-mods-builder [data-mv-area="track"]').count() == 0
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_mods_list_starts_folded_away(device_page):
    page = device_page
    page.mock_state["car_details"] = {"specs": {"brakes": {"status": "stock"}}, "mods": []}
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    toggle = page.locator("#mb-mods-builder [data-list-toggle]")
    toggle.wait_for(timeout=5000)
    assert toggle.get_attribute("aria-expanded") == "false"
    assert page.locator('#mb-mods-builder [data-mv-area="brakes"]').count() == 0
    toggle.click()
    expect(page.locator('#mb-mods-builder [data-mv-area="brakes"]')).to_be_visible()


@all_devices
def test_track_sessions_button_on_the_garage(device_page):
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    menu = page.locator("#mb-track-menu > summary")
    menu.wait_for(state="visible", timeout=10000)
    assert "Track your car?" in menu.inner_text()
    assert menu.bounding_box()["height"] >= 44
    menu.click()
    btn = page.locator("#mb-track-btn")
    btn.wait_for(state="visible", timeout=5000)
    assert "My Track Sessions" in btn.inner_text()
    assert btn.get_attribute("href") == "track.html"
    assert page.locator("#mb-boards-btn").get_attribute("href") == "leaderboards.html"
    # No track data in this mock: Track Sessions is faded, Leaderboards never is.
    assert "is-quiet" in btn.get_attribute("class")
    assert "is-quiet" not in page.locator("#mb-boards-btn").get_attribute("class")
    page.mouse.click(5, 5)
    btn.wait_for(state="hidden", timeout=5000)
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_car_can_be_added_without_a_caption(device_page):
    """The caption is optional on every upload form, so Add a car goes through
    with it left blank."""
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    for field in ("mb-submit-caption", "mb-addcar-caption", "mb-upload-caption"):
        assert page.locator("#" + field).get_attribute("required") is None, field
        assert page.locator("label[for=%s]" % field).inner_text() == "Caption (optional)", field
    page.locator("#mb-addcar-toggle-btn").click(timeout=10000)
    form = page.locator("#mb-addcar-form")
    form.locator("[data-make-pick] .chip", has_text="Tesla").click()
    form.locator(".mb-model-pick .chip", has_text="Model Y").click()
    page.fill("#mb-addcar-carname", "No Caption Y")
    page.select_option("#mb-addcar-color", "Grey")
    page.set_input_files("#mb-addcar-photo", files=[{"name": "car.jpg", "mimeType": "image/jpeg", "buffer": b"\xff\xd8\xff\xd9"}])
    page.click("#mb-addcar-submit-btn")
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    submits = page.mock_state.get("submits", [])
    if submits and submits[-1]:
        assert 'name="caption"' in submits[-1] and "No Caption Y" in submits[-1]
    assert page.errors == [], diagnostics(page)


@all_devices
def test_garage_tile_shows_mods_progress_and_back_is_a_button(device_page):
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    tile = page.locator(".mb-car-tile").first
    tile.wait_for(timeout=10000)
    meter = tile.locator(".mb-car-tile-mods")
    # The orange bar shows on phones and desktop; desktop also has bigger pictures.
    expect(meter).to_be_visible()
    expect(meter).to_contain_text("areas done")
    if page.viewport_size["width"] > 780:
        assert tile.locator(".mb-car-tile-thumb").bounding_box()["width"] >= 280
    tile.click()
    back = page.locator("#mb-car-back-btn")
    expect(back).to_be_visible()
    assert back.evaluate("e => getComputedStyle(e).borderTopWidth") == "1px"
    assert back.bounding_box()["height"] >= 44
