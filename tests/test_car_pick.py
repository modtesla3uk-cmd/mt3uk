"""The car pick (js/car-pick.js, css/car-pick.css, scripts/build_car_list.py and data/car-list/): a make, then a model,
then a variant, each in A to Z order with no grouping, every variant showing its fuel type (petrol, diesel, electric or
a hybrid), each make's models loading when it is chosen, a preset pick opening on that car, the choice reported to the
page, the credit line for the open data it is built from, and a phone width with no sideways scroll.
The page under test is tests/fixtures/car-pick.html."""
import json
import re
from pathlib import Path

from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parent.parent
LIST = ROOT / "data" / "car-list"
INDEX = json.loads((LIST / "index.json").read_text(encoding="utf-8"))
FUELS = {"Petrol", "Diesel", "Electric", "Hybrid", "Plug-in hybrid", "Mild hybrid", "Mild hybrid diesel", "Hybrid diesel"}
SLUG = {m["name"]: m["slug"] for m in INDEX["makes"]}


def make_data(name):
    return json.loads((LIST / (SLUG[name] + ".json")).read_text(encoding="utf-8"))


def sorted_names(page, items):
    # Sorted the way the component sorts (A to Z, numbers in order), using the browser's collation
    return page.evaluate(
        """(list) => list.slice().sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }))""",
        list(items),
    )


def open_pick(page, pick=""):
    page.goto("/tests/fixtures/car-pick.html" + (f"?pick={pick}" if pick else ""))
    page.wait_for_function("document.querySelectorAll('select[aria-label=Make] option').length > 0")


def options(page, label):
    return page.locator(f"select[aria-label={label}] option").all_text_contents()


def choose_make(page, name, models):
    page.locator("select[aria-label=Make]").select_option(label=name)
    expect(page.locator("select[aria-label=Model] option")).to_have_count(models)


def test_the_makes_are_listed_a_to_z_with_no_grouping(page):
    open_pick(page)
    names = options(page, "Make")
    assert len(names) == len(INDEX["makes"]) > 100
    assert names == sorted_names(page, names)
    assert page.locator(".car-pick optgroup").count() == 0
    assert "Tesla" in names and names.index("Alpine") < names.index("Tesla")


def test_choosing_a_make_lists_its_models_a_to_z(page):
    open_pick(page)
    expected = sorted_names(page, [m["name"] for m in make_data("BMW")["models"]])
    choose_make(page, "BMW", len(expected))
    assert options(page, "Model") == expected


def test_choosing_a_model_lists_its_variants_with_the_fuel_type_shown(page):
    open_pick(page)
    model = next(m for m in make_data("Tesla")["models"] if m["name"] == "Model 3")
    choose_make(page, "Tesla", len(make_data("Tesla")["models"]))
    page.locator("select[aria-label=Model]").select_option("Model 3")
    variants = options(page, "Variant")
    expected = sorted_names(page, [f"{v['name']} ({v['fuel']})" for v in model["variants"]])
    assert variants == expected and len(variants) > 0
    assert all(re.search(r"\(([A-Za-z -]+)\)$", v) for v in variants)


def test_every_variant_has_a_petrol_diesel_electric_or_hybrid_fuel(page):
    fuels = set()
    for make in INDEX["makes"]:
        data = make_data(make["name"])
        assert data["models"], make["name"]
        for model in data["models"]:
            assert model["variants"], (make["name"], model["name"])
            fuels |= {v["fuel"] for v in model["variants"]}
    assert fuels <= FUELS and {"Petrol", "Diesel", "Electric", "Hybrid"} <= fuels


def test_the_choice_is_reported_to_the_page(page):
    open_pick(page)
    taycan = next(m for m in make_data("Porsche")["models"] if m["name"] == "Taycan")
    choose_make(page, "Porsche", len(make_data("Porsche")["models"]))
    page.locator("select[aria-label=Model]").select_option("Taycan")
    page.locator("select[aria-label=Variant]").select_option(index=0)
    choice = page.evaluate("window.lastChoice")
    first = next(v for v in taycan["variants"] if v["name"] == sorted_names(page, [v["name"] for v in taycan["variants"]])[0])
    assert choice == {"make": "Porsche", "model": "Taycan", "variant": first["name"], "fuel": first["fuel"]}


def test_a_preset_pick_opens_on_that_car(page):
    model = next(m for m in make_data("Hyundai")["models"] if m["name"] == "Ioniq 5")
    variant = next(v for v in model["variants"] if v["fuel"] == "Electric")
    open_pick(page, pick=f"Hyundai|Ioniq 5|{variant['name']}")
    expect(page.locator("select[aria-label=Variant] option").first).to_have_count(len(model["variants"]))
    assert page.locator("select[aria-label=Make]").input_value() == SLUG["Hyundai"]
    assert page.locator("select[aria-label=Model]").input_value() == "Ioniq 5"
    chosen = page.locator("select[aria-label=Variant] option:checked").text_content()
    assert chosen == f"{variant['name']} ({variant['fuel']})"


def test_the_credit_line_names_the_source_licence_and_link(page):
    open_pick(page)
    credit = page.locator(".car-pick-credit")
    expect(credit).to_contain_text("vehicle-makes-models")
    expect(credit).to_contain_text("ODbL")
    expect(credit).to_contain_text("autoevolution.com")
    assert credit.locator("a").get_attribute("href") == "https://github.com/gor3a/vehicle-makes-models"


def test_the_pick_fits_a_phone_with_no_sideways_scroll_and_44px_targets(page):
    page.set_viewport_size({"width": 390, "height": 844})
    open_pick(page)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    for label in ("Make", "Model", "Variant"):
        box = page.locator(f"select[aria-label={label}]").bounding_box()
        assert box["height"] >= 44, (label, box)


def test_a_make_is_downloaded_only_when_it_is_chosen(page):
    # On open the list reads the index and the first make, so the model drop-down is never empty
    requested = []
    page.on("request", lambda r: requested.append(r.url) if "/data/car-list/" in r.url else None)
    open_pick(page)
    first = INDEX["makes"][0]["slug"]
    assert sorted(u.rsplit("/", 1)[-1] for u in requested) == sorted(["index.json", first + ".json"]), requested
    requested.clear()
    choose_make(page, "Audi", len(make_data("Audi")["models"]))
    assert [u.rsplit("/", 1)[-1] for u in requested] == [SLUG["Audi"] + ".json"]
