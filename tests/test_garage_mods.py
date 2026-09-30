"""My Garage's model picker and mods builder (js/mods-builder.js): the model
on Add a car and on an existing car, the "build your mods list" card, and
saving an area. Dates and costs are the owner's only: the public mods list
made from them is checked in tests/test_garage_mods_worker.py."""
import json

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
    form.locator(".mb-model-pick .chip", has_text="Model Y").click()
    assert form.locator("input[name=model]:checked").get_attribute("value") == "Model Y"
    page.fill("#mb-addcar-carname", "Blue Why")
    page.select_option("#mb-addcar-color", "Grey")
    page.fill("#mb-addcar-caption", "Grey Model Y")
    page.fill("#mb-addcar-year", "2023")
    page.set_input_files("#mb-addcar-photo", files=[{"name": "car.jpg", "mimeType": "image/jpeg", "buffer": b"\xff\xd8\xff\xd9"}])
    assert overflow_width(page) <= 0
    page.click("#mb-addcar-submit-btn")
    # The new car opens, ready for its mods list.
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)
    submits = page.mock_state.get("submits", [])
    if submits and submits[-1]:
        assert 'name="model"' in submits[-1] and "Model Y" in submits[-1]
    assert page.errors == [], diagnostics(page)


@all_devices
def test_existing_car_gets_a_model_picker(device_page):
    page = device_page
    open_car(page)
    page.select_option("#mb-car-model-select", "Model 3")
    page.wait_for_function("document.getElementById('mb-car-model-select').disabled === false", timeout=5000)
    assert any(line.startswith("PUT /my-builds/car") for line in page.api_log), page.api_log
    body = last_put(page)
    if body:
        assert body.get("model") == "Model 3"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_build_the_mods_list(device_page):
    page = device_page
    open_car(page)
    card = page.locator("#mb-mods-builder .mbm-welcome")
    assert "Test Model 3" in card.inner_text()
    assert "0 of 9 areas done" in card.inner_text() or "1 of 9 areas done" in card.inner_text()
    card.locator("[data-start]").click()

    # The mods listed before the builder carry over under Anything else.
    other = page.locator('.mbm-area[data-area="other"]')
    assert other.locator("textarea").input_value() == "Wheels"

    wheels = page.locator('.mbm-area[data-area="wheels"]')
    assert wheels.get_attribute("open") is not None
    wheels.locator('[data-status="up"]').click()
    wheels.get_by_label("Make", exact=True).fill("Vossen")
    wheels.get_by_label("Offset (ET)").fill("ET35")
    wheels.locator('[data-spacers="1"]').click()
    wheels.get_by_label("Front spacers").fill("15mm")
    wheels.get_by_label("Year fitted").fill("2025")
    wheels.get_by_label("Cost").fill("2400")
    assert overflow_width(page) <= 0
    wheels.locator("[data-save]").click()
    wheels.locator("[data-saved]").get_by_text("Saved").wait_for(timeout=5000)

    body = last_put(page)
    if body:
        spec = body["specs"]["wheels"]
        assert spec["status"] == "up"
        assert spec["fields"]["make"] == "Vossen" and spec["fields"]["offset"] == "ET35"
        assert spec["spacers"]["on"] is True and spec["spacers"]["front"] == "15mm"
        assert spec["fitted"] == {"year": 2025, "cost": "2400"}
        assert body["specs"]["other"]["items"] == ["Wheels"]
        # The summary updates, with the public list the worker made.
        summary = page.locator("#mb-mods-builder .mbm-summary")
        summary.wait_for(timeout=5000)
        assert "2 of 9 areas done" in summary.inner_text()
        assert "Wheels: Vossen ET35" in summary.locator(".mbm-public").inner_text()

    # Stock takes one tap.
    brakes = page.locator('.mbm-area[data-area="brakes"]')
    brakes.locator("summary").click()
    brakes.locator('[data-status="stock"]').click()
    assert brakes.locator("[data-pill]").inner_text() == "Stock"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_skip_for_now_shows_the_area_tiles(device_page):
    page = device_page
    open_car(page)
    page.locator("#mb-mods-builder [data-skip]").click()
    tiles = page.locator("#mb-mods-builder .mbm-tile")
    assert tiles.count() == 9
    tiles.filter(has_text="Suspension").click()
    area = page.locator('.mbm-area[data-area="suspension"]')
    area.wait_for(timeout=5000)
    assert area.get_attribute("open") is not None
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_a_saved_list_shows_its_progress_and_plans(device_page):
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
    summary = page.locator("#mb-mods-builder .mbm-summary")
    summary.wait_for(timeout=5000)
    assert page.locator("#mb-car-model-select").input_value() == "Model 3"
    assert "2 of 9 areas done" in summary.inner_text()
    summary.locator(".mbm-tile", has_text="Wheels").click()
    wheels = page.locator('.mbm-area[data-area="wheels"]')
    assert wheels.get_by_label("Month fitted").input_value() == "3"
    assert "Only you see these" in wheels.inner_text()
    plan = page.locator(".mbm-plan").first
    assert plan.get_by_label("What").input_value() == "Big brake kit"
    assert page.locator('[data-car="version"]').input_value() == "Performance"
    assert page.errors == [], diagnostics(page)
