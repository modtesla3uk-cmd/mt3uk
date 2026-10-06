"""Event pages: every event is an entry in data/event-pages.json, shown at
event.html?e=<slug> (js/event-page.js) and made on events-admin.html.

An entry is a draft or has a publish date (UK time). Until it is published the
page shows only a Coming soon card (js/event-gate.js), and only the admin can
open it early, with Preview. Published events are featured on the homepage.
On localhost the gate is off unless the page has ?gate=on."""
import base64
import copy
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


def no_meets(page):
    """An empty older meets list, so only event pages show on the homepage."""
    page.route(re.compile(r".*/events-data/events-manifest\.json.*"), lambda route: route.fulfill(
        status=200, body=json.dumps({"events": []}), headers={"Content-Type": "application/json"}))


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
    assert '<script src="js/event-page.js?v=' in source


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
    assert "Getting a code subscribes you to MT3UK" in gate.inner_text(), "Clear that asking for a code subscribes them"
    assert page.locator("#ev-gate button[type=submit]").inner_text().lower() == "send code and subscribe"
    assert overflow_width(page) <= 0

    # The admin's one-time link opens it, and is removed from the address.
    page.goto("/event.html?e=test-meet&gate=on&preview=" + "e" * 32)
    page.wait_for_function("document.querySelector('.evg-pill') !== null", timeout=5000)
    assert page.locator("#ev-gate").count() == 0
    assert "preview=" not in page.url and "e=test-meet" in page.url
    pill = page.locator(".evg-pill").inner_text()
    assert "admin preview" in pill.lower() and "only you can see this" in pill.lower()
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
def test_homepage_shows_only_live_event_pages_as_cards_with_image_and_tagline(device_page):
    page = device_page
    no_meets(page)
    serve(page, [
        full_event(slug="live-one", title="Live Event Title"),
        event(slug="draft-one", title="Draft Title"),
        event(slug="scheduled-one", title="Scheduled Title", publish="2099-01-01"),
        event(slug="over-one", title="Finished Title", publish="2020-01-01", startDate="2020-02-01"),
    ])
    page.goto("/index.html#events")
    cards = page.locator("#event-features .ev-feature")
    cards.first.wait_for(state="visible", timeout=5000)
    assert cards.count() == 1, "Drafts and scheduled pages are not shown"
    text = cards.first.inner_text()
    assert "Live Event Title" in text and "A tagline that sells it." in text and "Example Venue" in text
    assert cards.first.get_attribute("href") == "event.html?e=live-one"
    assert cards.first.locator("img").get_attribute("src") == "images/events/frunk-or-treat-uk/card.jpg"
    assert "Join event" in text
    past = page.locator("#past-events-list .ev-feature")
    assert past.count() == 1 and "Finished Title" in past.first.inner_text() and "View event" in past.first.inner_text()
    assert overflow_width(page) <= 0


@all_devices
def test_homepage_has_no_event_cards_when_there_are_no_events(device_page):
    page = device_page
    no_meets(page)
    serve(page, [event()])
    page.goto("/index.html#events")
    page.wait_for_timeout(600)
    assert page.locator("#event-features .ev-feature").count() == 0
    assert page.locator("#event-features").is_hidden()


@ADMIN_ONLY
def test_admin_can_preview_publish_draft_and_delete(device_page):
    page = device_page
    # The live file changes as events are published, so this starts from a
    # copy with Frunk or Treat and Cadwell Park still drafts.
    events = copy.deepcopy(json.loads((ROOT / "data" / "event-pages.json").read_text(encoding="utf-8")))
    for ev in events["events"]:
        if ev["slug"] in ("frunk-or-treat-uk", "cadwell-park-track-day-2026"):
            ev["draft"] = True
            ev.pop("publish", None)
    page.mock_state["event_pages_file"] = events
    open_events_admin(page)
    frunk = page.locator('#ep-list .event-card[data-slug="frunk-or-treat-uk"]')
    frunk.wait_for(state="visible", timeout=5000)
    assert "Draft" in frunk.inner_text() and "Frunk or Treat UK 2026" in frunk.inner_text()
    cadwell = page.locator('#ep-list .event-card[data-slug="cadwell-park-track-day-2026"]')
    assert cadwell.locator('[data-ep="share"]').count() == 0, "A draft has no Share button, only Copy link"
    total = len(events["events"])
    assert page.locator("#ep-list .event-card").count() == total, "Every event in the file has a card, drafts included"

    with page.expect_popup() as popup_info:
        page.click('#ep-list [data-ep="preview"]')
    popup_info.value.wait_for_url(re.compile(r"event\.html\?e=frunk-or-treat-uk&gate=on&preview=e{32}"), timeout=5000)
    assert page.mock_state["event_preview_minted"] == "frunk-or-treat-uk"

    page.once("dialog", lambda d: d.accept())
    frunk.locator('[data-ep="publish-now"]').click()
    page.wait_for_function("document.querySelector('#ep-list .event-card[data-slug=\"frunk-or-treat-uk\"] .event-id').textContent === 'Live'", timeout=5000)
    assert frunk.locator('[data-ep="delete"]').count() == 0, "A live event cannot be deleted"
    assert frunk.locator('[data-ep="copy"]').count() == 1, "A live event can still have its link copied"
    assert frunk.locator('[data-ep="share"]').count() == 1, "A live event has a Share button"
    page.evaluate("window.__shared = null; navigator.share = function (d) { window.__shared = d; return Promise.resolve(); };")
    frunk.locator('[data-ep="share"]').click()
    shared = page.evaluate("window.__shared")
    assert shared["url"] == "https://mt3uk.com/share/event/frunk-or-treat-uk.html", "Shares the share page, which has the event's own picture"

    page.once("dialog", lambda d: d.accept())
    frunk.locator('[data-ep="draft"]').click()
    page.wait_for_function("document.querySelector('#ep-list .event-card[data-slug=\"frunk-or-treat-uk\"] .event-id').textContent === 'Draft'", timeout=5000)
    page.once("dialog", lambda d: d.accept())
    frunk.locator('[data-ep="delete"]').click()
    page.wait_for_function("document.querySelectorAll('#ep-list .event-card').length === %d" % (total - 1), timeout=5000)
    assert page.locator('#ep-list .event-card[data-slug="frunk-or-treat-uk"]').count() == 0
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
    entry = next(e for e in json.loads((ROOT / "data" / "event-pages.json").read_text(encoding="utf-8"))["events"] if e["slug"] == "frunk-or-treat-uk")
    paragraphs = entry["description"]
    assert page.input_value("#ep-description").count("\n\n") == len(paragraphs) - 1
    assert page.locator("#slot-image img.img-thumb").count() == 1
    page.fill("#ep-tagline", "A new tagline")
    page.click("#ep-save")
    page.wait_for_function("document.getElementById('status').textContent.indexOf('Saved') === 0", timeout=5000)
    saved = page.mock_state["event_saved"]
    assert saved["tagline"] == "A new tagline" and saved["startDate"] == "2026-10-31" and saved["what3words"] == "starter.minivans.doted"
    assert len(saved["description"]) == len(paragraphs) and [s["title"] for s in saved["steps"]][0] == entry["steps"][0]["title"]
    assert saved["image"] == entry["image"]


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


@all_devices
def test_someone_the_link_was_shared_with_can_ask_for_an_emailed_code(device_page):
    page = device_page
    serve(page, [event()])
    page.mock_state["event_preview_copy"] = event(title="Saved copy title")
    page.goto("/event.html?e=test-meet&gate=on")
    gate = page.locator("#ev-gate")
    gate.wait_for(state="visible", timeout=5000)
    page.fill("#evg-email", "not an email")
    page.click("#ev-gate button[type=submit]")
    assert "valid email" in page.locator("#ev-gate .evg-msg").inner_text()
    page.fill("#evg-email", "friend@example.com")
    page.click("#ev-gate button[type=submit]")
    page.locator("#evg-code").wait_for(state="visible", timeout=5000)
    assert "friend@example.com" in gate.inner_text() and page.mock_state["event_code_requested"] == "friend@example.com"

    # A wrong code is refused, the right one opens the page.
    page.fill("#evg-code", "000000")
    page.click("#ev-gate button[type=submit]")
    page.wait_for_function("document.querySelector('#ev-gate .evg-msg').textContent.indexOf('not right') !== -1", timeout=5000)
    assert page.locator("#event").is_hidden()
    page.fill("#evg-code", "123456")
    page.click("#ev-gate button[type=submit]")
    page.wait_for_function("document.querySelector('.evg-pill') !== null", timeout=5000)
    assert page.locator("#ev-gate").count() == 0
    pill = page.locator(".evg-pill").inner_text()
    assert "Preview" in pill and "share" in pill and "Admin" not in pill, "A shared viewer is asked not to share it"
    assert not re.search(r"\d+\s*[hm]\b|left|until", pill), "There is no countdown"
    # Using the code signs them in, joins them and welcomes them once.
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.event"
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsEmail')") == "friend@example.com"
    page.locator("#mt3uk-nick-prompt").wait_for(state="visible", timeout=5000)
    page.click(".mt3uk-nick-later")
    assert "Welcome to MT3UK" in page.locator(".evg-notice").inner_text()
    page.wait_for_function("document.querySelector('h1') && document.querySelector('h1').textContent.indexOf('Saved copy title') !== -1", timeout=5000)
    page.goto("/event.html?e=test-meet&gate=on")
    page.wait_for_function("document.querySelector('.evg-pill') !== null", timeout=5000)
    assert page.locator(".evg-notice").count() == 0, "The welcome shows once"
    assert page.evaluate("JSON.parse(localStorage.getItem('mt3ukEventPreview:test-meet')).joined") is None


@ADMIN_ONLY
def test_admin_can_copy_a_share_link_and_see_and_revoke_who_opened_a_preview(device_page):
    page = device_page
    open_events_admin(page)
    page.locator("#ep-list .event-card").first.wait_for(state="visible", timeout=5000)
    page.evaluate("navigator.clipboard.writeText = function (t) { window.__copied = t; return Promise.resolve(); }")
    page.click('#ep-list [data-ep="copy"]')
    assert page.evaluate("window.__copied") == "https://mt3uk.com/share/event/frunk-or-treat-uk.html", "The link is the share page, which has the event's own preview image"
    assert "Link copied" in page.locator("#status").inner_text()

    page.click("#pv-wrap > summary")
    card = page.locator("#pv-list .event-card")
    card.first.wait_for(state="visible", timeout=5000)
    text = card.first.inner_text()
    assert "friend@example.com" in text and "Frunk or Treat UK 2026" in text and "opened 3 times" in text and "Joined MT3UK" in text
    page.click('#pv-list [data-pv="revoke"]')
    page.locator('#pv-list [data-pv="restore"]').wait_for(state="visible", timeout=5000)
    assert "Revoked" in page.locator("#pv-list").inner_text()
    page.click('#pv-list [data-pv="restore"]')
    page.locator('#pv-list [data-pv="revoke"]').wait_for(state="visible", timeout=5000)
    # Revoke ahead of time by email.
    page.fill("#pv-email", "Other@Example.com")
    page.select_option("#pv-slug", "frunk-or-treat-uk")
    page.click("#pv-form button")
    page.wait_for_function("document.getElementById('pv-list').textContent.indexOf('other@example.com') !== -1", timeout=5000)
    assert "Not opened" in page.locator("#pv-list").inner_text()
    page.fill("#pv-email", "bad")
    page.click("#pv-form button")
    assert "valid email" in page.locator("#pv-note").inner_text()


LEGACY = {"id": "002", "name": "Lancing Motor Show", "description": "Join us for a collective meet at Lancing Beach!",
          "startTime": "2099-09-27T09:00:00+0000", "endTime": "2099-09-27T18:00:00+0000", "location": {"name": "Lancing Beach Green"},
          "facebookUrl": "https://www.facebook.com/share/1BjtEUPS42/", "attendingCount": 10, "interestedCount": 20}


@ADMIN_ONLY
def test_an_older_event_can_become_a_full_event_page(device_page):
    page = device_page
    page.mock_state["legacy_events"] = [LEGACY]
    open_events_admin(page)
    card = page.locator("#upcoming-list .event-card", has_text="Lancing Motor Show")
    card.wait_for(state="visible", timeout=5000)
    assert card.locator('button[data-page="002"]').inner_text() == "Edit", "Edit opens the full editor"
    assert card.locator('button[data-action="edit"]').inner_text() == "Quick edit", "The small form is still there"
    assert "Event page:" not in card.inner_text()

    # The full editor opens, filled in from the older event.
    card.locator('button[data-page="002"]').click()
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    assert page.input_value("#ep-name") == "Lancing Motor Show" and page.input_value("#ep-title") == "Lancing Motor Show"
    assert page.input_value("#ep-slug") == "lancing-motor-show-2099"
    assert page.input_value("#ep-start-date") == "2099-09-27" and page.input_value("#ep-start-time") == "09:00"
    assert page.input_value("#ep-end-date") == "" and page.input_value("#ep-end-time") == "18:00"
    assert page.input_value("#ep-venue") == "Lancing Beach Green"
    assert page.input_value("#ep-tagline") == "Join us for a collective meet at Lancing Beach!"
    assert page.input_value("#ep-description") == "Join us for a collective meet at Lancing Beach!"
    assert page.input_value("#ep-cta-url") == LEGACY["facebookUrl"] and page.input_value("#ep-cta-label") == "Facebook event"
    assert page.locator("#ep-tiers").count() == 1 and page.locator("#ep-add-tier").is_visible(), "Ticket options are there too"
    assert page.locator("#slot-image .img-thumb").count() == 1, "There are image slots to fill"
    page.click("#ep-save")
    page.wait_for_function("document.getElementById('status').textContent.indexOf('Saved') === 0", timeout=5000)
    assert page.mock_state["event_saved"]["manifestId"] == "002"

    # The older event now shows its page, and the button reopens it.
    page.wait_for_function("document.querySelector('#upcoming-list').textContent.indexOf('Event page: draft') !== -1", timeout=5000)
    card = page.locator("#upcoming-list .event-card", has_text="Lancing Motor Show")
    assert card.locator('button[data-page="002"]').inner_text() == "Edit"
    page.click("#ep-cancel")
    card.locator('button[data-page="002"]').click()
    page.wait_for_function("document.getElementById('ep-form-title').textContent === 'Edit Lancing Motor Show'", timeout=5000)
    assert page.eval_on_selector("#ep-slug", "e => e.readOnly")
    # The older event's own Edit, Copy and Delete are untouched.
    assert card.locator('button[data-action="edit"]').count() == 1 and card.locator('button[data-action="delete"]').count() == 1


@all_devices
def test_every_event_card_has_its_image_and_join_event_opens_its_page(device_page):
    page = device_page
    with_page = dict(LEGACY, id="002")
    draft_page = dict(LEGACY, id="003", name="Draft Page Meet", startTime="2099-10-10T09:00:00+0000", endTime="2099-10-10T18:00:00+0000", facebookUrl="https://www.facebook.com/share/draft/")
    no_page = dict(LEGACY, id="004", name="No Page Meet", startTime="2099-11-11T09:00:00+0000", endTime="2099-11-11T18:00:00+0000", facebookUrl="https://www.facebook.com/share/nopage/")
    past = dict(LEGACY, id="001", name="Old Show", startTime="2020-09-25T09:00:00+0000", endTime="2020-09-25T18:00:00+0000")
    page.route(re.compile(r".*/events-data/events-manifest\.json.*"), lambda route: route.fulfill(
        status=200, body=json.dumps({"events": [with_page, draft_page, no_page, past]}), headers={"Content-Type": "application/json"}))
    serve(page, [
        event(slug="lancing-show", title="Lancing Motor Show", manifestId="002", startDate="2099-09-27", publish="2020-01-01", image="images/events/frunk-or-treat-uk/card.jpg"),
        event(slug="draft-page", title="Draft Page", manifestId="003", image="images/events/frunk-or-treat-uk/poster.jpg"),
        full_event(slug="old-show-page", title="Old Show", manifestId="001", startDate="2020-09-25"),
        full_event(slug="page-only", title="Page Only Event", startDate="2099-12-12"),
    ])
    page.goto("/index.html#events")
    cards = page.locator("#event-features .ev-feature")
    cards.first.wait_for(state="visible", timeout=5000)
    page.wait_for_function("document.querySelectorAll('#event-features .ev-feature').length === 4", timeout=5000)
    assert cards.count() == 4, "One card per event: no repeats"
    assert page.locator("#event-features .ev-feature-img img").count() == 4, "Every card has a picture"

    # Live page: its image, and Join event opens the page with the full details.
    lancing = page.locator("#event-features .ev-feature", has_text="Lancing Motor Show")
    assert lancing.get_attribute("href") == "event.html?e=lancing-show" and lancing.get_attribute("target") is None
    assert lancing.locator("img").get_attribute("src") == "images/events/frunk-or-treat-uk/card.jpg"
    assert "Join event" in lancing.inner_text()
    # A page that is not live yet: its image, but the link stays the external one.
    draft = page.locator("#event-features .ev-feature", has_text="Draft Page Meet")
    assert draft.get_attribute("href") == "https://www.facebook.com/share/draft/" and draft.get_attribute("target") == "_blank"
    assert draft.locator("img").get_attribute("src") == "images/events/frunk-or-treat-uk/poster.jpg"
    # No page at all: a neutral MT3UK picture, and the external link.
    plain = page.locator("#event-features .ev-feature", has_text="No Page Meet")
    assert plain.locator("img.ev-noimg").count() == 1 and plain.get_attribute("href") == "https://www.facebook.com/share/nopage/"
    # A page with no older event behind it is listed too.
    assert page.locator("#event-features .ev-feature", has_text="Page Only Event").get_attribute("href") == "event.html?e=page-only"
    # Soonest first.
    order = [c.inner_text().split("\n")[1] for c in cards.all()]
    assert order[0] == "Lancing Motor Show" and order[-1] == "Page Only Event"
    # Previous events are cards too, linking to their page.
    old = page.locator("#past-events-list .ev-feature")
    assert old.count() == 1 and old.get_attribute("href") == "event.html?e=old-show-page" and "Past event" in old.inner_text()
    assert overflow_width(page) <= 0


@all_devices
def test_the_events_section_has_no_hero_photo_and_its_text_is_not_faded(device_page):
    page = device_page
    with_page = dict(LEGACY, id="002")
    past = dict(LEGACY, id="001", name="Old Show", startTime="2020-09-25T09:00:00+0000", endTime="2020-09-25T18:00:00+0000")
    page.route(re.compile(r".*/events-data/events-manifest\.json.*"), lambda route: route.fulfill(
        status=200, body=json.dumps({"events": [with_page, past]}), headers={"Content-Type": "application/json"}))
    serve(page, [full_event(slug="lancing-show", manifestId="002", startDate="2099-09-27")])
    page.goto("/index.html#events")
    page.locator("#past-events-list .ev-feature").first.wait_for(state="visible", timeout=5000)
    assert page.locator('#events img[src="images/hero.jpg"]').count() == 0 and page.locator("#events .diagram").count() == 0
    assert "FIG. 01" not in page.locator("#events").inner_text()
    steel = "rgb(124, 135, 152)"
    for selector in ("#event-features .ev-feature-tagline", "#event-features .ev-feature-where", "#past-events-list .ev-feature-tagline", "#past-events-list .ev-feature-where", "#events .event-info p"):
        for el in page.locator(selector).all():
            assert el.evaluate("e => getComputedStyle(e).color") != steel, selector + " is not grey"
    assert page.evaluate("getComputedStyle(document.querySelector('#past-events-list .ev-feature')).opacity") == "1", "Previous events are not faded"
    assert page.evaluate("Number(getComputedStyle(document.querySelector('#past-events-list .ev-feature-body h3')).opacity)") == 1


@ADMIN_ONLY
def test_the_editor_opens_under_the_event_being_edited_with_an_arrow(device_page):
    page = device_page
    page.mock_state["legacy_events"] = [LEGACY]
    open_events_admin(page)
    page.locator("#ep-list .event-card").first.wait_for(state="visible", timeout=5000)
    under = "document.getElementById('%s').previousElementSibling === document.querySelector('%s .event-card.is-editing')"

    # An event page: the editor sits right under its card, which gets an arrow by its title.
    page.click('#ep-list [data-ep="edit"]')
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    card = page.locator("#ep-list .event-card.is-editing")
    assert card.count() == 1 and "Frunk or Treat UK 2026" in card.inner_text()
    assert page.evaluate(under % ("ep-form", "#ep-list"))
    arrow = page.evaluate("getComputedStyle(document.querySelector('.event-card.is-editing .event-name'), '::after').content")
    assert arrow not in ("none", "normal", ""), "A small arrow marks the event being edited"

    # A save redraws the list, and the editor stays under its event.
    page.click("#ep-save")
    page.wait_for_function("document.getElementById('status').textContent.indexOf('Saved') === 0", timeout=5000)
    assert page.evaluate(under % ("ep-form", "#ep-list"))

    # Closing puts the editor away and takes the arrow off.
    page.click("#ep-cancel")
    assert page.locator(".event-card.is-editing").count() == 0 and page.locator("#ep-form").is_hidden()

    # An older event: its own Edit opens its editor under it, and cancelling puts it back.
    page.click('#upcoming-list [data-action="edit"]')
    page.wait_for_function("document.querySelector('#upcoming-list .event-card.is-editing') !== null", timeout=5000)
    assert page.evaluate(under % ("event-form", "#upcoming-list"))
    page.click("#cancel-btn")
    assert page.locator(".event-card.is-editing").count() == 0
    assert not page.evaluate("document.getElementById('event-form').previousElementSibling.classList.contains('event-card')")

    # Make event page from an older event opens the page editor under that event.
    page.click('#upcoming-list [data-page="002"]')
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    assert page.evaluate("document.getElementById('ep-form').previousElementSibling.dataset.id") == "002"
    page.click("#ep-cancel")

    # A brand new page opens under the Add button, with no event marked.
    page.click("#ep-new")
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    assert page.locator(".event-card.is-editing").count() == 0
    assert page.evaluate("document.getElementById('ep-form').previousElementSibling.previousElementSibling.classList.contains('ep-bar')")


@ADMIN_ONLY
def test_saving_the_full_editor_also_updates_the_older_event(device_page):
    page = device_page
    page.mock_state["legacy_events"] = [dict(LEGACY)]
    open_events_admin(page)
    page.locator('#upcoming-list [data-page="002"]').click()
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    page.fill("#ep-title", "Lancing Motor Show 2099")
    page.fill("#ep-tagline", "A new line for the list")
    page.fill("#ep-venue", "The Green")
    page.fill("#ep-town", "Lancing")
    page.fill("#ep-start-time", "10:30")
    page.fill("#ep-cta-url", "https://example.com/new-link")
    page.click("#ep-save")
    page.wait_for_function("document.querySelector('#upcoming-list').textContent.indexOf('Lancing Motor Show 2099') !== -1", timeout=5000)
    sent = page.mock_state["legacy_saved"]
    assert sent["id"] == "002" and sent["name"] == "Lancing Motor Show 2099" and sent["description"] == "A new line for the list"
    assert sent["startDate"] == "2099-09-27" and sent["startTime"] == "10:30" and sent["endTime"] == "18:00"
    assert sent["location"] == "The Green, Lancing" and sent["facebookUrl"] == "https://example.com/new-link"
    assert sent["attendingCount"] == 10 and sent["interestedCount"] == 20, "The attendee counts are kept"
    assert "saved" in page.locator("#status").inner_text().lower() and "could not" not in page.locator("#status").inner_text()
    assert "The Green, Lancing" in page.locator("#upcoming-list").inner_text(), "The meets list shows the change"


def test_the_upcoming_events_already_have_pages_ready():
    by_id = {e.get("manifestId"): e for e in EVENTS}
    manifest = json.loads((ROOT / "events-data" / "events-manifest.json").read_text(encoding="utf-8"))["events"]
    for legacy in manifest:
        if legacy["id"] in ("006", "007", "008"):
            page_entry = by_id[legacy["id"]]
            assert page_entry.get("draft") or page_entry.get("publish"), "Each one is a draft or has a publish date"
            assert page_entry["title"] == legacy["name"] and page_entry["startDate"] == legacy["startTime"][:10]
            assert page_entry["startTime"] == legacy["startTime"][11:16]
            assert page_entry["ctaUrl"] == legacy["facebookUrl"]


@ADMIN_ONLY
def test_an_add_on_ticket_is_labelled_and_not_counted_in_the_from_price(device_page):
    page = device_page
    page.set_viewport_size({"width": 390, "height": 844})
    tiers = [{"name": "Driver Ticket", "price": "\u00a3150", "url": "https://example.com/t", "featured": True},
             {"name": "Afternoon Only", "price": "\u00a399", "url": "https://example.com/t"},
             {"name": "Extra Driver", "price": "\u00a330", "url": "https://example.com/t", "addOn": True}]
    serve(page, [event(publish="2020-01-01", tickets={"tiers": tiers})])
    page.goto("/event.html?e=test-meet")
    page.locator(".tier").first.wait_for(state="visible", timeout=5000)
    assert "\u00a399" in page.locator("#ev-ticket-bar").inner_text(), "The cheapest real ticket, not the add-on"
    extra = page.locator(".tier", has_text="Extra Driver")
    assert "Add-on" in extra.inner_text()
    assert "Add-on" not in page.locator(".tier", has_text="Afternoon Only").inner_text()


@ADMIN_ONLY
def test_the_admin_form_can_mark_a_ticket_as_an_add_on(device_page):
    page = device_page
    open_events_admin(page)
    page.click('#ep-list [data-ep="edit"]')
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    page.click("#ep-add-tier")
    page.fill(".tier-row .t-name", "Extra Driver")
    page.check(".tier-row .t-addon")
    page.click("#ep-save")
    page.wait_for_function("document.getElementById('status').textContent.indexOf('Saved') === 0", timeout=5000)
    assert page.mock_state["event_saved"]["tickets"]["tiers"][0]["addOn"] is True


@ADMIN_ONLY
def test_text_that_is_too_long_is_refused_not_quietly_cut_off(device_page):
    page = device_page
    open_events_admin(page)
    page.click('#ep-list [data-ep="edit"]')
    page.locator("#ep-form").wait_for(state="visible", timeout=5000)
    page.fill("#ep-steps", "A" * 215 + " | short text")
    page.click("#ep-save")
    message = page.locator("#status").inner_text()
    assert "step 1 title is 215 characters" in message.lower() and "limit is 200" in message and "Nothing has been saved" in message
    assert "event_saved" not in page.mock_state, "Nothing was sent to be saved"
    # Shortened, with the detail after a |, it saves.
    page.fill("#ep-steps", "Bring your car | " + "detail " * 20)
    page.click("#ep-save")
    page.wait_for_function("document.getElementById('status').textContent.indexOf('Saved') === 0", timeout=5000)
    assert page.mock_state["event_saved"]["steps"][0]["title"] == "Bring your car"


@ADMIN_ONLY
def test_the_share_button_uses_the_share_page_not_the_plain_address(device_page):
    page = device_page
    serve(page, [event(publish="2020-01-01", slug="test-meet")])
    page.goto("/event.html?e=test-meet")
    page.locator("#share-event").wait_for(state="visible", timeout=5000)
    assert "Share" in page.locator("#share-event").inner_text()
    # Where the phone or browser has a share sheet, it gets the share page.
    page.evaluate("window.__shared = null; navigator.share = function (d) { window.__shared = d; return Promise.resolve(); }")
    page.click("#share-event")
    shared = page.evaluate("window.__shared")
    assert shared["url"] == "https://mt3uk.com/share/event/test-meet.html" and shared["title"] == "Test Meet Title"
    # Otherwise the link is copied.
    page.evaluate("navigator.share = undefined; window.__copied = ''; navigator.clipboard.writeText = function (t) { window.__copied = t; return Promise.resolve(); }")
    page.click("#share-event")
    page.wait_for_function("document.getElementById('share-event').textContent.indexOf('Link copied') !== -1", timeout=5000)
    assert page.evaluate("window.__copied") == "https://mt3uk.com/share/event/test-meet.html"


@ADMIN_ONLY
def test_the_old_way_of_adding_an_event_is_gone_but_quick_edit_still_works(device_page):
    page = device_page
    page.mock_state["legacy_events"] = [dict(LEGACY)]
    open_events_admin(page)
    card = page.locator("#upcoming-list .event-card", has_text="Lancing Motor Show")
    card.wait_for(state="visible", timeout=5000)
    body = page.locator("#admin-body").inner_text()
    assert "Add an event\\n" not in body and "Add event" not in body, "No separate Add an event form"
    assert page.locator("#event-form").is_hidden(), "The small form is closed until Quick edit"
    assert page.locator("text=Copy as new").count() == 0 and page.locator('[data-action="copy"]').count() == 0
    assert "Add an event page" in body, "Adding is done with event pages"

    # Quick edit opens the small form under the event, for the attendee counts.
    card.locator('button[data-action="edit"]').click()
    page.locator("#event-form").wait_for(state="visible", timeout=5000)
    assert page.evaluate("document.getElementById('event-form').previousElementSibling.dataset.id") == "002"
    assert "Quick edit" in page.locator("#form-title").inner_text()
    page.fill("#f-attending", "42")
    page.click("#save-btn")
    page.wait_for_function("document.getElementById('status').textContent.indexOf('Saved event 002') === 0", timeout=5000)
    assert page.mock_state["legacy_saved"]["attendingCount"] == "42" and page.mock_state["legacy_saved"]["id"] == "002"
    assert page.locator("#event-form").is_hidden(), "It closes after saving"
    # Cancel closes it too.
    card = page.locator("#upcoming-list .event-card", has_text="Lancing Motor Show")
    card.locator('button[data-action="edit"]').click()
    page.locator("#event-form").wait_for(state="visible", timeout=5000)
    page.click("#cancel-btn")
    assert page.locator("#event-form").is_hidden() and page.locator(".event-card.is-editing").count() == 0
