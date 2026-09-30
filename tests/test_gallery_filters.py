"""The Full Gallery's filters: by colour and by member, and the note that
says whose builds are showing (from My Garage, a friend's Builds button in
the chat, or the Member filter)."""
import json
from pathlib import Path

from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401

MANIFEST = json.loads((Path(__file__).resolve().parent.parent / "images" / "gallery" / "manifest.json").read_text(encoding="utf-8"))
SHOWN = [p for p in MANIFEST if p.get("gallery") is not False]


def a_member():
    counts = {}
    for p in SHOWN:
        if p.get("name"):
            counts[p["name"]] = counts.get(p["name"], 0) + 1
    name = max(counts, key=counts.get)
    return name, counts[name]


@all_devices
def test_filter_the_gallery_by_member(device_page):
    page = device_page
    name, count = a_member()
    page.goto("/gallery.html")
    select = page.locator("#gallery-member")
    select.wait_for(timeout=10000)
    select.select_option(name)
    note = page.locator("#gallery-only-note")
    note.wait_for(state="visible", timeout=5000)
    assert note.inner_text().startswith("Builds by " + name + " (%d)" % count)
    assert "member=" in page.url
    names = page.eval_on_selector_all("#gallery-grid .gallery-slot .g-name", "els => els.map(e => e.textContent)")
    assert names and all(n == "By " + name for n in names), names
    assert overflow_width(page) <= 0

    # Reloading keeps the filter; All members clears it.
    page.reload()
    page.locator("#gallery-only-note").wait_for(state="visible", timeout=10000)
    assert page.locator("#gallery-member").input_value() == name
    page.locator("#gallery-member").select_option("")
    assert page.locator("#gallery-only-note").is_hidden()
    assert "member=" not in page.url
    assert page.errors == [], diagnostics(page)


@all_devices
def test_friends_builds_say_whose_they_are(device_page):
    page = device_page
    files = [p["file"] for p in SHOWN[:2]]
    page.goto("/gallery.html?only=" + ",".join(files) + "&who=Sharad")
    note = page.locator("#gallery-only-note")
    note.wait_for(state="visible", timeout=10000)
    assert note.inner_text().startswith("Builds by Sharad (2)")
    assert page.locator("#gallery-grid .gallery-slot").count() == 2
    page.click("#gallery-only-clear")
    page.locator("#gallery-member").wait_for(timeout=10000)
    assert page.locator("#gallery-only-note").is_hidden()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_chat_builds_button_minimises_the_chat(device_page):
    page = device_page
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); localStorage.setItem('mt3ukMyBuildsEmail', 'member@example.com')")
    # The stand-in friend's builds are real gallery photos.
    from test_devices import profile_reply
    profile_reply("/profile", "GET", None, page.mock_state)
    page.mock_state["profile"]["friends"][0]["builds"] = [p["file"] for p in SHOWN[:2]]
    page.goto("/shop.html")
    page.locator("#nav-chat").wait_for(state="visible", timeout=5000)
    page.evaluate("window.mt3ukChat.open('friends')")
    builds = page.locator("#mc-friends a.mc-builds").first
    builds.wait_for(timeout=5000)
    assert "who=Sharad" in builds.get_attribute("href")
    builds.click()
    page.wait_for_url("**/gallery.html**", timeout=10000)
    page.locator("#mt3uk-chat-min").wait_for(state="visible", timeout=5000)
    assert page.locator("#mt3uk-chat").is_hidden(), "The chat is minimised, not over the gallery"
    page.locator("#gallery-only-note").wait_for(state="visible", timeout=10000)
    assert "Builds by Sharad" in page.locator("#gallery-only-note").inner_text()
    assert page.errors == [], diagnostics(page)
