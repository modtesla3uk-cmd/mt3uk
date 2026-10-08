"""Offline mode on the Laps pages: the bar that says so, sessions added with no connection kept on the device and
sent when it is back, the old list shown from what the device kept, the one-time offer and the switch, and (with
a real service worker) Laps opening with no network once Offline mode is on."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parent.parent

from test_track_page import API_HOST, FIXTURE, FakeWorker, meteo_reply, open_page


class Link:
    """The stand-in for the worker, with a switch for the connection: down means a request never arrives."""

    def __init__(self, fake):
        self.fake = fake
        self.down = False

    def handler(self, route):
        if self.down:
            route.abort("connectionfailed")
        else:
            self.fake.reply(route)


def with_link(page, fake):
    link = Link(fake)
    page.route("**/%s/**" % API_HOST, link.handler)
    return link


def go_offline(page, link):
    link.down = True
    page.evaluate("window.dispatchEvent(new Event('offline'))")


def go_online(page, link):
    link.down = False
    page.evaluate("window.dispatchEvent(new Event('online'))")


def open_signed_in(page, fake):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    open_page(page, fake)
    link = with_link(page, fake)
    expect(page.locator("#tp-lb-pill")).to_be_visible()
    return link


def add_thruxton(page):
    page.get_by_role("link", name="Add a session").click()
    page.set_input_files("#tp-file", str(FIXTURE))
    expect(page.locator("#tp-result .tp-notice.is-ok")).to_contain_text("Thruxton")


def test_going_offline_says_so_and_lists_what_still_works(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    expect(page.locator("#lo-bar")).to_be_hidden()
    go_offline(page, link)
    bar = page.locator("#lo-bar")
    expect(bar).to_contain_text("You're in offline mode.")
    expect(bar).to_contain_text("add a session from a file already on your device")
    expect(bar).to_contain_text("Leaderboards, sharing, sign-in")
    # Close puts it away until the connection changes.
    bar.locator("[data-lo='close']").click()
    expect(bar).to_be_hidden()


def test_a_session_added_offline_is_kept_on_the_device_and_sent_when_the_connection_is_back(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    go_offline(page, link)
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    # Back on the list, with the saved message and the card of what is waiting.
    expect(page).to_have_url(re.compile(r"track\.html$"))
    expect(page.locator("#tp-saved")).to_contain_text("Saved on this device")
    pending = page.locator("#lo-pending")
    expect(pending).to_contain_text("1 session waiting to be sent")
    expect(pending).to_contain_text("Thruxton")
    assert fake.saved == [], "nothing reaches the worker while it is offline"
    # Still waiting after the page is drawn again (the list is read from the device).
    page.reload()
    page.wait_for_selector("#tp-lb-pill")
    expect(page.locator("#lo-pending")).to_contain_text("1 session waiting to be sent")

    go_online(page, link)
    expect(page.locator("#lo-bar")).to_contain_text("1 session sent", timeout=15000)
    assert len(fake.saved) == 1
    saved = fake.saved[0]
    assert saved["carId"] == "car1" and saved["session"]["venueId"] == "thruxton"
    assert fake.gzipped, "the queued session is sent gzipped like any other"
    assert fake.sources, "its readings are sent too"
    expect(page.locator("#lo-pending")).to_be_hidden()


def test_a_session_the_worker_refuses_stays_listed_with_the_reason_and_can_be_removed(page):
    fake = FakeWorker()
    fake.dupes = True
    link = open_signed_in(page, fake)
    # Saved once with a connection, so the same file is refused when it is sent later.
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s="))
    page.goto("/track.html")
    page.wait_for_selector("#tp-lb-pill")
    go_offline(page, link)
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#lo-pending")).to_contain_text("1 session waiting to be sent")
    go_online(page, link)
    expect(page.locator("#lo-pending li.is-bad .lo-err")).to_be_visible(timeout=15000)
    expect(page.locator("#lo-bar")).to_contain_text("could not be sent")
    page.once("dialog", lambda d: d.accept())
    page.locator("[data-lo-remove]").click()
    expect(page.locator("#lo-pending")).to_be_hidden()


def test_the_list_offline_comes_from_what_the_device_kept_and_says_so(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    expect(page.locator(".tp-sub, .tp-trackrow, .tp-card").first).to_be_attached()
    go_offline(page, link)
    # The page asks for its list again (as it does when the connection returns).
    page.evaluate("document.dispatchEvent(new CustomEvent('mt3uk-offline-end'))")
    expect(page.locator("#tp-old-note")).to_contain_text("You are offline, so this is what was on this device on")
    expect(page.locator("#tp-lb-pill")).to_be_visible()
    # The real list is fetched again once the connection is back, and the note goes.
    go_online(page, link)
    expect(page.locator("#tp-old-note")).to_have_count(0, timeout=15000)


def test_a_session_not_opened_before_says_it_is_not_on_the_device(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    go_offline(page, link)
    page.evaluate("history.pushState({}, '', 'track.html?s=never'); window.dispatchEvent(new PopStateEvent('popstate'))")
    expect(page.locator(".tp-empty")).to_contain_text("This session is not on this device")


def test_the_one_time_offer_is_made_once_and_not_now_is_remembered(page):
    fake = FakeWorker()
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 0;")
    open_page(page, fake, admin=True)
    offer = page.locator("#lo-offer")
    expect(offer).to_contain_text("Use Laps without a signal?")
    expect(offer).to_contain_text("Turn on offline mode")
    offer.get_by_role("button", name="Not now").click()
    expect(offer).to_have_count(0)
    page.reload()
    page.wait_for_selector("#tp-lb-pill")
    page.wait_for_timeout(600)
    expect(page.locator("#lo-offer")).to_have_count(0)


def test_the_offer_is_held_back_from_members_who_are_not_the_admin(page):
    """While Offline mode is tried out only a browser with the admin viewer token is offered it."""
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 0;")
    open_page(page, FakeWorker())
    page.wait_for_timeout(800)
    expect(page.locator("#lo-offer")).to_have_count(0)
    expect(page.locator("#tp-offline")).to_have_text("Offline mode: off")


def test_no_offer_for_someone_signed_out(page):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 0;")
    open_page(page, FakeWorker(), signed_in=False)
    page.wait_for_timeout(600)
    expect(page.locator("#lo-offer")).to_have_count(0)


def test_the_laps_footer_has_the_offline_switch(page):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    open_page(page, FakeWorker())
    footer = page.locator("#tp-offline")
    expect(footer).to_have_text("Offline mode: off")
    page.add_init_script("")
    for name in ["leaderboards.html", "laps.html"]:
        page.goto("/" + name)
        expect(page.locator("#tp-offline")).to_have_text("Offline mode: off")


def test_profile_has_an_offline_mode_switch_on_laps_only(page):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    page.add_init_script("navigator.serviceWorker && (navigator.serviceWorker.register = () => new Promise(() => {}))")
    page.route("**/%s/**" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": False}), headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/profile.html")
    page.wait_for_timeout(500)
    assert page.evaluate("document.getElementById('offline-mode').hidden") is True
    page.add_init_script("window.MT3UK_SITES = { main: ['example.test'], mainOrigin: 'http://example.test', laps: ['localhost'] };")
    page.goto("/profile.html")
    page.wait_for_function("document.getElementById('offline-mode').hidden === false")
    expect(page.locator("#offline-mode [data-offline-toggle]")).to_have_attribute("aria-checked", "false")
    expect(page.locator("#offline-mode [data-offline-status]")).to_contain_text("Off.")


def test_turning_offline_mode_on_asks_first_and_cancel_leaves_it_off(page):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    open_page(page, FakeWorker())
    page.locator("#tp-offline").click()
    confirm = page.locator("#lo-confirm")
    expect(confirm).to_contain_text("Keep Laps on this device?")
    expect(confirm).to_contain_text("your latest 25 sessions")
    expect(confirm).to_contain_text("the maps under those sessions")
    expect(confirm).to_contain_text("Sessions waiting to be sent go first")
    expect(confirm).to_contain_text("depends on your logger")
    confirm.get_by_role("button", name="Cancel").click()
    expect(confirm).to_have_count(0)
    expect(page.locator("#tp-offline")).to_have_text("Offline mode: off")
    assert page.evaluate("localStorage.getItem('mt3ukLapsOffline')") is None


def test_offline_mode_cannot_be_turned_on_without_a_connection(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    go_offline(page, link)
    page.locator("#lo-bar [data-lo='close']").click()
    page.locator("#tp-offline").click()
    expect(page.locator("#lo-bar")).to_contain_text("You need a connection to turn offline mode on")
    expect(page.locator("#tp-offline")).to_have_text("Offline mode: off")


def test_the_service_worker_keeps_map_tiles_only_while_offline_mode_is_on():
    """sw.js loaded into a stand-in service worker (node): tiles are fetched as asked with Offline mode off, kept and
    served with no connection with it on, fetched ahead on request, and removed when it goes off."""
    if shutil.which("node") is None:
        pytest.skip("node is not installed here")
    out = subprocess.run(["node", str(ROOT / "tests" / "sw_tiles_check.mjs")], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0 and "FAIL" not in out.stdout, out.stdout + out.stderr


PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")


def test_laps_opens_with_no_network_once_offline_mode_is_on(browser):
    """The real service worker: add a session, switch Offline mode on (it asks first, then keeps the pages, the
    member's sessions and the maps' pictures), cut the network, and the pages, the session and its map still open."""
    context = browser.new_context(base_url="http://localhost:8123")
    page = context.new_page()
    fake = FakeWorker()
    link = Link(fake)
    context.route("**/%s/**" % API_HOST, link.handler)
    context.route("**/*open-meteo.com/**", meteo_reply)
    context.route(re.compile(r"https://server\.arcgisonline\.com/.*"), lambda route: route.fulfill(status=200, content_type="image/png", body=PNG, headers={"Access-Control-Allow-Origin": "*"}))
    context.route("**/overpass-api.de/**", lambda route: route.fulfill(status=200, content_type="application/json", body='{"elements": []}', headers={"Access-Control-Allow-Origin": "*"}))
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession','tok');localStorage.setItem('mt3ukMyBuildsEmail','a@example.com');localStorage.setItem('mt3ukVisitCount','0');window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    try:
        page.goto("/track.html")
        expect(page.locator("#tp-lb-pill")).to_be_visible()
        add_thruxton(page)
        page.get_by_role("button", name="Save session").click()
        expect(page).to_have_url(re.compile(r"track\.html\?s=new1"))
        page.goto("/track.html")
        expect(page.locator("#tp-lb-pill")).to_be_visible()
        page.locator("#tp-offline").click()
        page.locator("#lo-confirm").get_by_role("button", name="Turn on offline mode").click()
        expect(page.locator("#lo-bar")).to_contain_text("Offline mode is on.", timeout=60000)
        expect(page.locator("#lo-bar")).to_contain_text("with 1 session")
        assert int(page.evaluate("localStorage.getItem('mt3ukLapsOfflineKept')")) > 10
        expect(page.locator("#tp-offline")).to_have_text("Offline mode: on")
        # Wait for the worker to be in charge of the page, then cut everything.
        page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
        context.set_offline(True)
        link.down = True
        page.goto("/track.html?add=1")
        expect(page.locator("#lo-bar")).to_contain_text("You're in offline mode.")
        expect(page.locator("#tp-app")).not_to_be_empty()
        # A session kept on the device opens with its map, and its tile pictures come from the device too.
        page.goto("/track.html?s=new1")
        expect(page.locator(".tp-session-head h2")).to_have_text("Thruxton")
        expect(page.locator("#tp-old-note")).to_contain_text("You are offline")
        expect(page.locator("#tp-map2")).to_be_visible()
        page.goto("/leaderboards.html")
        expect(page.locator("#lo-bar")).to_contain_text("You're in offline mode.")
        # Switching it off removes the copy and the maps.
        context.set_offline(False)
        link.down = False
        page.goto("/track.html")
        page.locator("#tp-offline").click()
        page.wait_for_function("!localStorage.getItem('mt3ukLapsOffline')", timeout=15000)
        expect(page.locator("#tp-offline")).to_have_text("Offline mode: off")
        assert page.evaluate("caches.keys().then(k => k.some(n => n.indexOf('laps-offline') !== -1 || n.indexOf('laps-tiles') !== -1))") is False
    finally:
        context.close()
