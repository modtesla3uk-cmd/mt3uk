"""A new upload shows in the reel and the Full Gallery straight away: the
pages add photos from the worker's live list (/gallery/live) that the
published manifest doesn't have yet (js/gallery-live.js)."""
import json

from test_devices import device_page, browsers, all_devices, diagnostics  # noqa: F401

NEW = {"file": "just-uploaded.jpg", "caption": "JUST UPLOADED", "name": "RichyRich", "added": "2026-09-30", "group": "just-uploaded.jpg"}


def live(page, photos):
    page.route("**/__mock-api/gallery/live*", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps({"success": True, "photos": photos}),
        headers={"Access-Control-Allow-Origin": "*"}))


@all_devices
def test_new_upload_shows_first_in_the_reel(device_page):
    page = device_page
    live(page, [NEW])
    page.goto("/index.html#build-feed")
    first = page.locator(".bf-slide").first
    first.wait_for(timeout=10000)
    assert first.locator('.bf-cell[data-file="just-uploaded.jpg"]').count() == 1, "The new upload is the first post"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_new_upload_shows_first_in_the_gallery(device_page):
    page = device_page
    live(page, [NEW])
    page.goto("/gallery.html")
    tile = page.locator("#gallery-grid .gallery-slot.filled").first
    tile.wait_for(timeout=10000)
    assert tile.get_attribute("data-file") == "just-uploaded.jpg"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_worker_down_uses_the_manifest(device_page):
    page = device_page
    page.route("**/__mock-api/gallery/live*", lambda route: route.abort())
    page.goto("/gallery.html")
    page.locator("#gallery-grid .gallery-slot.filled").first.wait_for(timeout=10000)
    assert page.locator('#gallery-grid [data-file="just-uploaded.jpg"]').count() == 0
    assert page.errors == [], diagnostics(page)
