"""Event pages: every event is an entry in data/event-pages.json, shown at
event.html?e=<slug> (js/event-page.js) and made on events-admin.html.

An entry is a draft or has a publish date (UK time). Until it is published the
page shows only a Coming soon card (js/event-gate.js), and only the admin can
open it early, with Preview. Published events are featured on the homepage.
On localhost the gate is off unless the page has ?gate=on."""
import base64
import json
import re
from pathlib import Path

import pytest

from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
EVENTS = json.loads((ROOT / "data" / "event-pages.json").read_text(encoding="utf-8"))["events"]
ADMIN_ONLY = pytest.mark.parametrize("device_page", ["desktop-chrome"], indirect=True)
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def serve(page, events):
    page.route(re.compile(r".*/data/event-pages\.json.*"), lambda route: route.fulfill(
        status=200, body=json.dumps({"events": events}), headers={"Content-Type": "application/json"}))


def event(**changes):
    entry = {"slug": "test-meet", "name": "Test Meet", "title": "Test Meet Title", "tagline": "A tagline that sells it.",
             "startDate": "2099-06-27", "startTime": "14:00", "endTime": "17:00", "venue": "Example Venue", "town": "Exampleton",
             "address": "1 Example Road, Exampleton", "location": "Example Venue, Exampleton", "created": "2026-09-30", "draft": True}
    entry.update(changes)
    if "publish" in changes:
        entry.pop("draft", None)
    return entry


def full_event(**changes):
    return event(
        publish="2020-01-01", image="images/events/frunk-or-treat-uk/card.jpg", poster="images/events/frunk-or-treat-uk/poster.jpg",
        description=["The lead paragraph.", "Second paragraph."], highlights=["Family friendly"], steps=[{"title": "Bring your EV"}, {"title": "Have fun", "text": "Meet people"}],
        what3words="///starter.minivans.doted",
        tickets={"intro": "Tickets by email.", "tiers": [{"name": "Display", "price": "£15", "per": "per car", "includes": ["A space"], "url": "https://example.com/t", "featured": True},
                                                       {"name": "Early", "price": "£10", "soldOut": True}], "notes": [{"label": "Refunds", "value": "7 days before"}]},
        schedule=[{"time": "2pm", "title": "Gates open", "text": "Roll in"}], faq=[{"q": "Modified?", "a": "No."}],
        gallery=[{"src": "images/events/frunk-or-treat-uk/card.jpg", "caption": "Last year"}], ctaUrl="https://example.com/fb", ctaLabel="Facebook event",
        **changes)


def open_events_admin(page):
    """Events admin with the key saved, so the page loads straight in."""
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/events-admin.html")
    page.locator("#admin-body").wait_for(state="visible", timeout=5000)


def test_every_event_entry_is_valid():
    assert EVENTS, "data/event-pages.json lists at least one event"
    seen = set()
    for ev in EVENTS:
        assert re.fullmatch(r"[a-z0-9][a-z0-9-]{0,59}", ev["slug"]), ev["slug"]
        assert ev["slug"] not in seen, "duplicate slug " + ev["slug"]
        seen.add(ev["slug"])
        for field in ("name", "title", "created"):
            assert ev.get(field), f"{ev['slug']} needs a {field}"
        assert ev.get("draft") or ev.get("publish"), f"{ev['slug']} needs a publish date or draft: true"
        assert not (ev.get("draft") and ev.get("publish")), f"{ev['slug']} cannot be a draft and have a publish date"
        for field in ("image", "heroImage", "poster"):
            if ev.get(field, "").startswith("images/"):
                assert (ROOT / ev[field]).exists(), f"{ev['slug']} {field} is missing: {ev[field]}"
        for photo in ev.get("gallery", []):
            if photo["src"].startswith("images/"):
                assert (ROOT / photo["src"]).exists(), photo["src"]


def test_event_page_loads_the_gate_and_renderer():
    source = (ROOT / "event.html").read_text(encoding="utf-8")
    assert '<script src="js/event-gate.js"></script>' in source.split("</head>")[0]
    assert '<script src="js/event-page.js" defer></script>' in source


def test_first_event_matches_its_poster():
    ev = next(e for e in EVENTS if e["slug"] == "frunk-or-treat-uk")
    assert ev["startDate"] == "2026-10-31" and ev["startTime"] == "14:00" and ev["endTime"] == "17:00"
    assert ev["venue"] == "Caffeine & Machine The Hill"
    assert "CV37 7NS" in ev["address"] and ev["what3words"] == "///starter.minivans.doted"
    assert [s["title"] for s in ev["steps"]][0] == "Bring your EV"


# ---------- The page ----------

@all_devices
def test_event_page_draws_everything_the_entry_has(device_page):
    page = device_page
    serve(page, [full_event()])
    page.goto("/event.html?e=test-meet")
    page.locator("h1").wait_for(state="visible", timeout=5000)
    assert page.locator("h1").inner_text().strip() == "Test Meet Title"
    assert "A tagline that sells it." in page.locator(".tagline").inner_text()
    facts = page.locator(".ev-facts-grid").inner_text()
    assert "Saturday 27 June 2099" in facts and "2pm to 5pm" in facts and "Example Venue" in facts and "starter.minivans.doted" in facts
    assert page.locator(".ev-facts-grid .ev-fact").count() == 4
    assert page.locator(".chips li").count() == 1 and page.locator(".steps li").count() == 2
    assert page.locator(".tier").count() == 2 and page.locator(".tier.soldout").count() == 1
    assert page.locator(".schedule li").count() == 1 and page.locator(".faq details").count() == 1
    assert page.locator(".poster img").count() == 1 and page.locator(".ev-gallery figure").count() == 1
    assert "maps" in page.locator("a", has_text="Get directions").get_attribute("href")
    assert page.locator("a", has_text="Facebook event").count() >= 1
    assert page.locator(".ph").count() == 0, "No placeholders once the images are there"
    assert page.title() == "Test Meet Title – MT3UK Events"
    assert page.locator('script[type="application/ld+json"]').count() == 1
    assert page.errors == []
    assert overflow_width(page) <= 0


@all_devices
def test_sections_without_content_are_left_out(device_page):
    page = device_page
    serve(page, [event(publish="2020-01-01", description=["Only a description."])])
    page.goto("/event.html?e=test-meet")
    page.locator("h1").wait_for(state="visible", timeout=5000)
    for selector in (".tiers", ".schedule", ".faq", ".poster", ".ev-gallery", ".chips", ".steps", "#tickets"):
        assert page.locator(selector).count() == 0, selector + " should not show"
    assert page.locator(".ph").count() == 0, "A live event with no image shows no placeholder"
    assert page.locator("a", has_text="Get tickets").count() == 0
    assert overflow_width(page) <= 0


@all_devices
def test_a_draft_shows_striped_image_placeholders(device_page):
    page = device_page
    serve(page, [event()])
    page.goto("/event.html?e=test-meet")
    page.locator(".ph").first.wait_for(state="visible", timeout=5000)
    assert "Hero image" in page.locator(".ph").first.inner_text()
    assert page.locator('meta[name="robots"][content*="noindex"]').count() == 1


@all_devices
def test_unknown_event_and_bare_page_have_a_way_back(device_page):
    page = device_page
    serve(page, [event()])
    page.goto("/event.html?e=nope")
    page.locator(".ev-missing").wait_for(state="visible", timeout=5000)
    assert "can’t find" in page.locator(".ev-missing").inner_text()
    page.goto("/event.html")
    page.locator(".ev-missing").wait_for(state="visible", timeout=5000)
    assert page.locator(".ev-missing a").get_attribute("href") == "index.html#events"


@ADMIN_ONLY
def test_tickets_show_a_phone_bar_and_the_calendar_downloads_the_right_time(device_page):
    page = device_page
    page.set_viewport_size({"width": 390, "height": 844})
    serve(page, [full_event(startDate="2026-10-31", endDate=None)])
    page.goto("/event.html?e=test-meet")
    page.locator("#add-to-calendar").wait_for(state="visible", timeout=5000)
    assert page.locator("#ev-ticket-bar").is_visible() and "£10" not in page.locator("#ev-ticket-bar").inner_text()
    assert "£15" in page.locator("#ev-ticket-bar").inner_text()
    with page.expect_download() as download:
        page.click("#add-to-calendar")
    text = Path(download.value.path()).read_text(encoding="utf-8")
    # 2pm to 5pm on 31 October 2026 is UK time after the clocks go back (UTC).
    assert "DTSTART:20261031T140000Z" in text and "DTEND:20261031T170000Z" in text


# ---------- The gate ----------

@all_devices
def test_draft_event_shows_coming_soon_and_admin_preview_link_opens_it(device_page):
    page = device_page
    serve(page, [event(image="images/events/frunk-or-treat-uk/card.jpg")])
    page.mock_state["event_preview_copy"] = event(title="Saved copy title")
    page.goto("/event.html?e=test-meet&gate=on")
    gate = page.locator("#ev-gate")
    gate.wait_for(state="visible", timeout=5000)
    assert page.locator("#event").is_hidden(), "The event itself stays hidden"
    assert page.locator("body > header").is_visible(), "The site header stays so people can go elsewhere"
    assert "Test Meet Title" in gate.inner_text()
    assert gate.locator("input, form").count() == 0, "There is no public code or sign-up for events"
    assert overflow_width(page) <= 0

    # The admin's one-time link opens it, and is removed from the address.
    page.goto("/event.html?e=test-meet&gate=on&preview=" + "e" * 32)
    page.wait_for_function("document.querySelector('.evg-pill') !== null", timeout=5000)
    assert page.locator("#ev-gate").count() == 0
    assert "preview=" not in page.url and "e=test-meet" in page.url
    pill = page.locator(".evg-pill").inner_text()
    assert "draft" in pill.lower()
    assert not re.search(r"\d+\s*[hm]\b|left|until", pill), "There is no countdown"
    # The preview shows the newest saved text from the worker.
    page.wait_for_function("document.querySelector('h1') && document.querySelector('h1').textContent.indexOf('Saved copy title') !== -1", timeout=5000)

    # It stays open on reload and does not time out; the same link works once.
    page.goto("/event.html?e=test-meet&gate=on")
    page.wait_for_function("document.querySelector('.evg-pill') !== null", timeout=5000)
    page.click(".evg-end")
    page.locator("#ev-gate").wait_for(state="visible", timeout=5000)
    page.goto("/event.html?e=test-meet&gate=on&preview=" + "e" * 32)
    page.locator("#ev-gate").wait_for(state="visible", timeout=5000)
    assert "expired" in page.locator("#ev-gate .evg-msg").inner_text()
    assert page.locator("#event").is_hidden()


@all_devices
def test_scheduled_event_is_hidden_until_its_date_then_opens_for_everyone(device_page):
    page = device_page
    serve(page, [event(publish="2099-01-01")])
    page.goto("/event.html?e=test-meet&gate=on")
    page.locator("#ev-gate").wait_for(state="visible", timeout=5000)
    assert "2099" in page.locator("#ev-gate").inner_text()
    assert page.locator("#event").is_hidden()

    serve(page, [event(publish="2020-01-01")])
    page.goto("/event.html?e=test-meet&gate=on")
    page.locator("h1").wait_for(state="visible", timeout=5000)
    assert page.locator("#ev-gate").count() == 0 and page.locator(".evg-pill").count() == 0
    assert overflow_width(page) <= 0


@all_devices
def test_event_that_is_not_listed_stays_hidden(device_page):
    page = device_page
    serve(page, [])
    page.goto("/event.html?e=test-meet&gate=on")
    page.locator("#ev-gate").wait_for(state="visible", timeout=5000)
    assert page.locator("#event").is_hidden()


# ---------- The homepage ----------

@all_devices
def test_homepage_features_only_live_upcoming_events_with_image_and_tagline(device_page):
    page = device_page
    serve(page, [
        full_event(slug="live-one", title="Live Event Title"),
        event(slug="draft-one", title="Draft Title"),
        event(slug="scheduled-one", title="Scheduled Title", publish="2099-01-01"),
        event(slug="over-one", title="Finished Title", publish="2020-01-01", startDate="2020-02-01"),
    ])
    page.goto("/index.html#events")
    cards = page.locator("#event-features .ev-feature")
    cards.first.wait_for(state="visible", timeout=5000)
    assert cards.count() == 1
    text = cards.first.inner_text()
    assert "Live Event Title" in text and "A tagline that sells it." in text and "Example Venue" in text
    assert cards.first.get_attribute("href") == "event.html?e=live-one"
    assert cards.first.locator("img").get_attribute("src") == "images/events/frunk-or-treat-uk/card.jpg"
    assert overflow_width(page) <= 0


@all_devices
def test_homepage_has_no_feature_block_when_nothing_is_live(device_page):
    page = device_page
    serve(page, [event()])
    page.goto("/index.html#events")
    page.wait_for_timeout(500)
    assert page.locator("#event-features .ev-feature").count() == 0
    assert page.locator("#event-features").is_hidden()


# ---------- The Events admin page ----------

@ADMIN_ONLY
def test_admin_can_preview_publish_draft_and_delete(device_page):
    page = device_page
    open_events_admin(page)
    card = page.locator("#ep-list .event-card")
    card.first.wait_for(state="visible", timeout=5000)
    assert "Draft" in card.first.inner_text() and "Frunk or Treat UK 2026" in card.first.inner_text()

    with page.expect_popup() as popup_info:
        page.click('#ep-list [data-ep="preview"]')
    popup_info.value.wait_for_url(re.compile(r"event\.html\?e=frunk-or-treat-uk&gate=on&preview=e{32}"), timeout=5000)
    assert page.mock_state["event_preview_minted"] == "frunk-or-treat-uk"

    page.once("dialog", lambda d: d.accept())
    page.click('#ep-list [data-ep="publish-now"]')
    page.wait_for_function("document.querySelector('#ep-list .event-id').textContent === 'Live'", timeout=5000)
    assert page.locator('#ep-list [data-ep="delete"]').count() == 0, "A live event cannot be deleted"
    page.once("dialog", lambda d: d.accept())
    page.click('#ep-list [data-ep="draft"]')
    page.wait_for_function("document.querySelector('#ep-list .event-id').textContent === 'Draft'", timeout=5000)
    page.once("dialog", lambda d: d.accept())
    page.click('#ep-list [data-ep="delete"]')
    page.locator("#ep-list .empty").wait_for(state="visible", timeout=5000)
    assert page.mock_state["event_actions"] == ["publish-now", "draft", "delete"]


@ADMIN_ONLY
def test_admin_edit_form_is_filled_from_the_event_and_saves_it_back(device_page):
    page = device_page
    open_events_admin(page)
    page.click('#ep-list [data-ep="edit"]')
    form = page.locator("#ep-form")
    form.wait_for(state="visible", timeout=5000)
    assert page.input_value("#ep-title") == "Frunk or Treat UK"
    assert page.input_value("#ep-start-time") == "14:00" and page.input_value("#ep-w3w") == "starter.minivans.doted"
    assert page.input_value("#ep-slug") == "frunk-or-treat-uk" and page.eval_on_selector("#ep-slug", "e => e.readOnly")
    assert page.input_value("#ep-description").count("\n\n") == 2
    assert page.locator("#slot-image img.img-thumb").count() == 1
    page.fill("#ep-tagline", "A new tagline")
    page.click("#ep-save")
    page.wait_for_function("document.getElementById('status').textContent.indexOf('Saved') === 0", timeout=5000)
    saved = page.mock_state["event_saved"]
    assert saved["tagline"] == "A new tagline" and saved["startDate"] == "2026-10-31" and saved["what3words"] == "starter.minivans.doted"
    assert len(saved["description"]) == 3 and [s["title"] for s in saved["steps"]][0] == "Bring your EV"
    assert saved["image"] == "images/events/frunk-or-treat-uk/card.jpg"


@ADMIN_ONLY
def test_admin_can_add_an_event_with_an_uploaded_image_tickets_and_save_and_preview(device_page):
    page = device_page
    open_events_admin(page)
    page.click("#ep-new")
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    page.fill("#ep-name", "Summer Meet 2027")
    assert page.input_value("#ep-slug") == "summer-meet-2027", "The web address follows the name"
    page.fill("#ep-title", "Summer Meet")
    page.fill("#ep-start-date", "2027-07-10")
    page.fill("#ep-start-time", "10:00")
    page.fill("#ep-description", "First paragraph.\nstill first.\n\nSecond paragraph.")
    page.fill("#ep-steps", "Bring your car | Any Tesla\nHave fun")
    page.fill("#ep-faq", "Modified? | No | not needed")
    page.fill("#ep-schedule-text", "10am | Gates open | Roll in")
    page.set_input_files("#slot-image input[type=file]", files=[{"name": "photo.png", "mimeType": "image/png", "buffer": PNG}])
    page.wait_for_selector("#slot-image img.img-thumb", timeout=5000)
    page.set_input_files("#ep-gallery-add", files=[{"name": "a.png", "mimeType": "image/png", "buffer": PNG}, {"name": "b.png", "mimeType": "image/png", "buffer": PNG}])
    page.wait_for_function("document.querySelectorAll('#ep-gallery .gallery-item').length === 2", timeout=5000)
    page.click("#ep-add-tier")
    page.fill(".tier-row .t-name", "Show your car")
    page.fill(".tier-row .t-price", "£15")
    page.fill(".tier-row .t-includes", "A space\nA sticker")
    page.check(".tier-row .t-featured")
    with page.expect_popup() as popup_info:
        page.click("#ep-save-preview")
    popup_info.value.wait_for_url(re.compile(r"event\.html\?e=summer-meet-2027&gate=on&preview="), timeout=5000)
    saved = page.mock_state["event_saved"]
    assert saved["slug"] == "summer-meet-2027" and saved["title"] == "Summer Meet"
    assert saved["description"] == ["First paragraph. still first.", "Second paragraph."]
    assert saved["steps"] == [{"title": "Bring your car", "text": "Any Tesla"}, {"title": "Have fun", "text": ""}]
    assert saved["faq"] == [{"q": "Modified?", "a": "No | not needed"}]
    assert saved["schedule"] == [{"time": "10am", "title": "Gates open", "text": "Roll in"}]
    assert saved["tickets"]["tiers"][0]["includes"] == ["A space", "A sticker"] and saved["tickets"]["tiers"][0]["featured"] is True
    assert saved["image"].startswith("images/") and len(saved["gallery"]) == 2
    assert page.mock_state["event_images"] == 3
    assert "Summer Meet 2027" in page.locator("#ep-list").inner_text()
    assert "Draft" in page.locator("#ep-list .event-card").nth(1).inner_text()


@ADMIN_ONLY
def test_admin_needs_a_name_and_title_and_the_key(device_page):
    page = device_page
    open_events_admin(page)
    page.click("#ep-new")
    page.click("#ep-save")
    assert "name" in page.locator("#status").inner_text().lower()
    page.fill("#admin-key", "")
    page.click('#ep-list [data-ep="preview"]')
    assert "admin key" in page.locator("#status").inner_text()


@all_devices
def test_event_pages_admin_fits_on_every_screen(device_page):
    page = device_page
    open_events_admin(page)
    page.click('#ep-list [data-ep="edit"]')
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    page.click("#ep-add-tier")
    assert overflow_width(page) <= 0


@pytest.mark.parametrize("device_page", ["android"], indirect=True)
def test_events_admin_is_readable_on_a_phone(device_page):
    """The event cards keep their title readable and their buttons on screen,
    and the form fields are 16px so phones don't zoom in on them."""
    page = device_page
    open_events_admin(page)
    page.locator("#ep-list .event-card").first.wait_for(state="visible", timeout=5000)
    width = page.evaluate("window.innerWidth")
    assert page.locator("#ep-list .event-name").first.bounding_box()["width"] > 180, "The title must not be squeezed"
    for button in page.locator("#ep-list .event-actions button").all():
        box = button.bounding_box()
        assert box["x"] >= 0 and box["x"] + box["width"] <= width, "A button runs off the screen"
        assert box["height"] >= 42, "Buttons need a big enough tap target"
    page.click('#ep-list [data-ep="edit"]')
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    page.click("#ep-add-tier")
    assert page.eval_on_selector("#ep-title", "e => parseFloat(getComputedStyle(e).fontSize)") >= 16
    assert page.eval_on_selector("#ep-description", "e => parseFloat(getComputedStyle(e).fontSize)") >= 16
    assert page.eval_on_selector(".tier-row .t-name", "e => parseFloat(getComputedStyle(e).fontSize)") >= 16
    assert overflow_width(page) <= 0
