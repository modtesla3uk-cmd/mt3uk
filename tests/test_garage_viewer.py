"""My Garage's car view: the mods list under Build of the Week, and the
full-size photo viewer's Reel and Gallery buttons, this week's votes and
Delete. Also the gallery opening a linked photo (?photo=)."""
import json
from pathlib import Path

from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401


def open_car(page):
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    page.locator("#mb-mods-builder .mbm-welcome").wait_for(state="visible", timeout=5000)


@all_devices
def test_mods_list_sits_under_build_of_the_week(device_page):
    page = device_page
    open_car(page)
    order = page.evaluate("[...document.querySelectorAll('#mb-vote-hint, #mb-mods-builder')].map(e => e.id)")
    assert order == ["mb-vote-hint", "mb-mods-builder"], order
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_photo_viewer_has_reel_gallery_votes_and_delete(device_page):
    page = device_page
    open_car(page)
    page.locator('.mb-photo-thumb-wrap[data-file="test-build.jpg"] .mb-photo-thumb img').click(timeout=5000)
    reel = page.locator("#mb-lightbox-reel")
    reel.wait_for(state="visible", timeout=5000)
    assert reel.get_attribute("href") == "index.html?photo=test-build.jpg#build-feed"
    assert page.locator("#mb-lightbox-gallery").get_attribute("href") == "gallery.html?photo=test-build.jpg"
    assert page.locator("#mb-lightbox-votes").inner_text() == "3 votes this week"

    # Not this week's entry: no votes shown.
    page.locator("#mb-lightbox-next-btn").click()
    page.wait_for_function("document.getElementById('mb-lightbox-votes').hidden", timeout=5000)

    # Delete asks to confirm first.
    delete = page.locator("#mb-lightbox-delete")
    delete.click()
    assert delete.inner_text() == "Confirm delete?"
    delete.click()
    page.wait_for_function("!document.getElementById('mb-img-lightbox').classList.contains('open')", timeout=5000)
    assert [c for c in page.api_log if c.startswith("DELETE /my-builds")], page.api_log
    assert page.errors == [], diagnostics(page)


@all_devices
def test_gallery_opens_a_linked_photo(device_page):
    page = device_page
    shown = [p for p in json.loads((Path(__file__).resolve().parent.parent / "images" / "gallery" / "manifest.json").read_text(encoding="utf-8")) if p.get("gallery") is not False]
    photo = shown[5]["file"]
    page.goto("/gallery.html?photo=" + photo)
    page.locator(".lightbox.open").wait_for(timeout=10000)
    assert page.locator(".lightbox-img").get_attribute("src").endswith("/gallery/" + photo)
    assert page.errors == [], diagnostics(page)
