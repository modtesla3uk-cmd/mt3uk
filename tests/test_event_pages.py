"""Event pages (event-<slug>.html) are drafts or scheduled in
data/event-pages.json, like Owner Interviews. Until published, a page shows
only a Coming soon card (js/event-gate.js), and only the admin can open it
early, with Preview on the admin page. Published pages are featured on the
homepage Events section. On localhost the gate is off unless ?gate=on."""
import json
import re
from pathlib import Path

import pytest

from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
FILE = json.loads((ROOT / "data" / "event-pages.json").read_text(encoding="utf-8"))
EVENTS = FILE["events"]
PAGE = "/event-template.html"


def serve(page, events):
    page.route(re.compile(r".*/data/event-pages\.json.*"), lambda route: route.fulfill(
        status=200, body=json.dumps({"events": events}), headers={"Content-Type": "application/json"}))


def open_events_admin(page):
    """Events admin with the key saved, so the page loads straight in."""
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/events-admin.html")
    page.locator("#admin-body").wait_for(state="visible", timeout=5000)


def template(**changes):
    entry = {"name": "Example event", "title": "Example Event Title", "tagline": "A tagline that sells it.",
             "url": "event-template.html", "startDate": "2099-06-27", "endDate": "2099-06-27",
             "location": "Example Venue", "created": "2026-09-30"}
    entry.update(changes)
    return entry


def test_every_event_page_is_listed_correctly_and_loads_the_gate_in_its_head():
    assert EVENTS, "data/event-pages.json lists at least the template"
    for ev in EVENTS:
        assert re.fullmatch(r"event-[a-z0-9-]+\.html", ev["url"]), ev["url"]
        for field in ("name", "title", "tagline", "created"):
            assert ev.get(field), f"{ev['url']} needs a {field}"
        assert ev.get("draft") or ev.get("publish"), f"{ev['url']} needs a publish date or draft: true"
        assert not (ev.get("draft") and ev.get("publish")), f"{ev['url']} cannot be a draft and have a publish date"
        source = (ROOT / ev["url"]).read_text(encoding="utf-8")
        head = source.split("</head>")[0]
        assert '<script src="js/event-gate.js"></script>' in head, f"{ev['url']} is missing js/event-gate.js in its <head>"


@all_devices
def test_draft_event_shows_coming_soon_and_admin_preview_link_opens_it(device_page):
    page = device_page
    serve(page, [template(draft=True)])
    page.goto(PAGE + "?gate=on")
    gate = page.locator("#ev-gate")
    gate.wait_for(state="visible", timeout=5000)
    assert page.locator("#event").is_hidden(), "The event itself stays hidden"
    assert page.locator("body > header").is_visible(), "The site header stays so people can go elsewhere"
    assert "Example Event Title" in gate.inner_text()
    assert gate.locator("input, form").count() == 0, "There is no public code or sign-up for events"
    assert overflow_width(page) <= 0

    # The admin's one-time link opens it, and the link is removed from the address.
    page.goto(PAGE + "?gate=on&preview=" + "e" * 32)
    page.locator("#event").wait_for(state="attached", timeout=5000)
    page.wait_for_function("document.querySelector('#event').offsetParent !== null", timeout=5000)
    assert page.locator("#ev-gate").count() == 0
    assert "preview=" not in page.url
    assert re.search(r"\d+m left", page.locator(".evg-timer").inner_text())
    assert "draft" in page.locator(".evg-notice").inner_text().lower()
    assert page.evaluate("JSON.parse(localStorage.getItem('mt3ukEventPreview:template')).token")

    # It stays open on reload, but the same link does not work twice.
    page.goto(PAGE + "?gate=on")
    page.wait_for_function("document.querySelector('.evg-timer') !== null", timeout=5000)
    page.evaluate("localStorage.removeItem('mt3ukEventPreview:template')")
    page.goto(PAGE + "?gate=on&preview=" + "e" * 32)
    page.locator("#ev-gate").wait_for(state="visible", timeout=5000)
    assert "expired" in page.locator("#ev-gate .evg-msg").inner_text()
    assert page.locator("#event").is_hidden()


@all_devices
def test_scheduled_event_is_hidden_until_its_date_then_opens_for_everyone(device_page):
    page = device_page
    serve(page, [template(publish="2099-01-01")])
    page.goto(PAGE + "?gate=on")
    page.locator("#ev-gate").wait_for(state="visible", timeout=5000)
    assert "2099" in page.locator("#ev-gate").inner_text()
    assert page.locator("#event").is_hidden()

    serve(page, [template(publish="2020-01-01")])
    page.goto(PAGE + "?gate=on")
    page.wait_for_function("document.querySelector('#event').offsetParent !== null", timeout=5000)
    assert page.locator("#ev-gate").count() == 0
    assert overflow_width(page) <= 0


@all_devices
def test_page_that_is_not_listed_stays_hidden(device_page):
    page = device_page
    serve(page, [])
    page.goto(PAGE + "?gate=on")
    page.locator("#ev-gate").wait_for(state="visible", timeout=5000)
    assert page.locator("#event").is_hidden()


@all_devices
def test_homepage_features_only_live_upcoming_events_with_image_and_tagline(device_page):
    page = device_page
    live = template(name="Live one", title="Live Event Title", url="event-live.html", publish="2020-01-01", image="images/hero.jpg")
    serve(page, [
        live,
        template(name="Draft", title="Draft Title", url="event-draft.html", draft=True),
        template(name="Scheduled", title="Scheduled Title", url="event-scheduled.html", publish="2099-01-01"),
        template(name="Over", title="Finished Title", url="event-over.html", publish="2020-01-01", startDate="2020-02-01", endDate="2020-02-01"),
    ])
    page.goto("/index.html#events")
    cards = page.locator("#event-features .ev-feature")
    cards.first.wait_for(state="visible", timeout=5000)
    assert cards.count() == 1
    text = cards.first.inner_text()
    assert "Live Event Title" in text and "A tagline that sells it." in text and "Example Venue" in text
    assert cards.first.get_attribute("href") == "event-live.html"
    assert cards.first.locator("img").get_attribute("src") == "images/hero.jpg"
    assert overflow_width(page) <= 0


@all_devices
def test_homepage_has_no_feature_block_when_nothing_is_live(device_page):
    page = device_page
    serve(page, [template(draft=True)])
    page.goto("/index.html#events")
    page.wait_for_timeout(500)
    assert page.locator("#event-features .ev-feature").count() == 0
    assert page.locator("#event-features").is_hidden()


@pytest.mark.parametrize("device_page", ["desktop-chrome"], indirect=True)
def test_admin_can_preview_publish_and_draft_an_event_page(device_page):
    page = device_page
    serve(page, [template(draft=True)])
    open_events_admin(page)
    card = page.locator("#ep-list .event-card")
    card.first.wait_for(state="visible", timeout=5000)
    assert "DRAFT" in card.first.inner_text()

    # Preview opens the page with a one-time link.
    with page.expect_popup() as popup_info:
        page.click('#ep-list [data-ep="preview"]')
    popup = popup_info.value
    popup.wait_for_url(re.compile(r"event-template\.html\?gate=on&preview=e{32}"), timeout=5000)

    # Publish now, then move it back to a draft.
    page.once("dialog", lambda d: d.accept())
    page.click('#ep-list [data-ep="publish-now"]')
    page.wait_for_function("document.querySelector('#ep-list .event-id').textContent === 'LIVE'", timeout=5000)
    page.once("dialog", lambda d: d.accept())
    page.click('#ep-list [data-ep="draft"]')
    page.wait_for_function("document.querySelector('#ep-list .event-id').textContent === 'DRAFT'", timeout=5000)
    assert page.mock_state["event_actions"] == ["publish-now", "draft"]


@pytest.mark.parametrize("device_page", ["desktop-chrome"], indirect=True)
def test_preview_needs_the_admin_key(device_page):
    page = device_page
    serve(page, [template(draft=True)])
    open_events_admin(page)
    page.locator("#ep-list [data-ep]").first.wait_for(state="visible", timeout=5000)
    page.fill("#admin-key", "")
    page.click('#ep-list [data-ep="preview"]')
    assert "admin key" in page.locator("#status").inner_text()


@all_devices
def test_event_pages_fit_on_the_events_admin_page(device_page):
    page = device_page
    serve(page, [template(draft=True), template(name="Second", url="event-second.html", publish="2099-01-01")])
    open_events_admin(page)
    page.locator("#ep-list .event-card").nth(1).wait_for(state="visible", timeout=5000)
    assert "SCHEDULED" in page.locator("#ep-list .event-card").nth(1).inner_text()
    assert overflow_width(page) <= 0
