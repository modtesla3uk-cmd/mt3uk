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

from test_track_page import API_HOST, FIXTURE, FakeWorker, board_row, meteo_reply, open_page


class Link:
    """The stand-in for the worker, with a switch for the connection: down means a request never arrives."""

    def __init__(self, fake):
        self.fake = fake
        self.down = False
        # A weak signal: the request is sent and never answered.
        self.hang = False

    def handler(self, route):
        if self.hang:
            return
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


def open_signed_in(page, fake, admin=False):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    open_page(page, fake, admin=admin)
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


def test_a_session_saved_offline_opens_on_the_device_with_its_map_laps_and_playback(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    go_offline(page, link)
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    pending = page.locator("#lo-pending")
    expect(pending).to_contain_text("1 session waiting to be sent")
    pending.get_by_role("link", name="Open").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=local-\d+$"))
    note = page.locator("#tp-local-note")
    expect(note).to_contain_text("On this device, not sent yet")
    expect(page.locator(".tp-session-head h2")).to_contain_text("Thruxton")
    # The session is drawn from the copy on the device: the headline, the map with its playback, the laps.
    expect(page.locator("#tp-headline")).to_be_visible()
    expect(page.locator("#tp-mapcard")).to_be_visible()
    expect(page.locator("#tp-laps")).to_be_visible()
    # Nothing that needs the worker: no settings and no privacy pill (the owner's controls).
    expect(page.locator("#settings")).to_have_count(0)
    expect(page.locator(".tp-session-head .tp-pill")).to_have_count(0)
    assert fake.saved == [], "nothing was sent while offline"
    # Exit goes back to the list, where the waiting session is still listed.
    page.locator("#tp-exit").click()
    expect(page.locator("#lo-pending")).to_contain_text("1 session waiting to be sent")


def test_the_same_session_sent_normally_does_have_settings_and_sharing(page):
    """The control for the test above: with a connection the saved session is the owner's, with settings and sharing."""
    fake = FakeWorker()
    open_signed_in(page, fake)
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s="))
    expect(page.locator("#settings")).to_have_count(1)
    expect(page.locator(".tp-pill").first).to_contain_text("Only me")


def test_a_local_session_is_gone_once_it_has_been_sent(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    go_offline(page, link)
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    page.locator("#lo-pending").get_by_role("link", name="Open").click()
    url = page.url
    expect(page.locator("#tp-local-note")).to_be_visible()
    go_online(page, link)
    page.evaluate("MT3UKOffline.sync(true)")
    expect(page.locator("#lo-bar")).to_contain_text("1 session sent", timeout=15000)
    page.goto(url)
    expect(page.locator(".tp-empty")).to_contain_text("not on this device any more")


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


def test_a_weak_signal_that_never_answers_counts_as_offline_when_the_device_has_a_copy(page):
    """A request that hangs (a weak signal) is given up on after the read timeout, and the copy kept on the device is
    shown, with the offline bar. Nothing is cut short when there is no copy to fall back on."""
    fake = FakeWorker()
    page.add_init_script("window.MT3UK_READ_TIMEOUT_MS = 700; window.MT3UK_OFFLINE_PING_MS = 500;")
    link = open_signed_in(page, fake)
    expect(page.locator("#lo-bar")).to_be_hidden()
    link.hang = True
    page.evaluate("document.dispatchEvent(new CustomEvent('mt3uk-offline-end'))")
    expect(page.locator("#tp-old-note")).to_contain_text("You are offline", timeout=8000)
    expect(page.locator("#lo-bar")).to_contain_text("You're in offline mode.")
    expect(page.locator("#tp-lb-pill")).to_be_visible()
    # Back to a working signal: the poll finds the worker answering and the real list returns.
    link.hang = False
    expect(page.locator("#tp-old-note")).to_have_count(0, timeout=30000)
    expect(page.locator("#lo-bar")).to_be_hidden()


def test_a_slow_read_with_no_copy_is_not_cut_short(page):
    """With nothing kept on the device a slow answer is waited for, as it always was (the garage can be slow)."""
    fake = FakeWorker()
    page.add_init_script("window.MT3UK_READ_TIMEOUT_MS = 300;")
    reply = fake.reply

    def slow(route):
        try:
            page.wait_for_timeout(1200)
            reply(route)
        except Exception:
            pass  # the page was closed while this answer was still on its way

    fake.reply = slow
    open_page(page, fake)
    expect(page.locator("#tp-lb-pill")).to_be_visible(timeout=20000)
    page.wait_for_timeout(600)
    expect(page.locator("#lo-bar")).to_be_hidden()
    expect(page.locator("#tp-old-note")).to_have_count(0)
    page.unroute_all(behavior="ignoreErrors")


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


def test_offline_mode_is_held_back_from_members_the_admin_has_not_approved(page):
    """While Offline mode is tried out the icon, the footer link and the one-time offer only show for the admin and for
    approved members (Offline mode panel of track-admin.html)."""
    fake = FakeWorker()
    fake.offline_access = False
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 300;")
    open_page(page, fake)
    page.wait_for_selector("#tp-lb-pill")
    page.wait_for_timeout(900)
    expect(page.locator("#nav-offline")).to_have_count(0)
    expect(page.locator("#tp-offline")).to_be_hidden()
    expect(page.locator("#lo-offer")).to_have_count(0)


def test_an_approved_member_gets_the_icon_the_footer_link_and_the_offer(page):
    fake = FakeWorker()
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 300;")
    open_page(page, fake)
    expect(page.locator("#nav-offline")).to_be_visible()
    expect(page.locator("#tp-offline")).to_be_visible()
    expect(page.locator("#lo-offer")).to_be_visible()
    assert page.evaluate("localStorage.getItem('mt3ukLapsOfflineAccess')") == "a@example.com|1"


def test_taking_access_away_switches_offline_mode_off_for_a_member_who_had_it_on(page):
    """The admin takes access away: the icon, the footer link, the Profile switch and the kept copy and circuits all go."""
    fake = FakeWorker()
    fake.offline_access = False
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1'); localStorage.setItem('mt3ukLapsOfflineCircuits', JSON.stringify([{id:'thruxton',name:'Thruxton'}]));")
    open_signed_in(page, fake)
    page.wait_for_function("localStorage.getItem('mt3ukLapsOffline') === null")
    expect(page.locator("#nav-offline")).to_be_hidden()
    expect(page.locator("#tp-offline")).to_be_hidden()
    assert page.evaluate("localStorage.getItem('mt3ukLapsOfflineCircuits')") is None
    assert page.evaluate("MT3UKOffline.enabled && MT3UKOffline.enabled()") in (False, None, 0)


def test_a_member_whose_access_is_still_unknown_keeps_offline_mode_until_the_answer_comes(page):
    """With no answer cached yet (for example no signal), a device that already has Offline mode on is left alone."""
    fake = FakeWorker()
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    link = open_signed_in(page, fake)
    expect(page.locator("#nav-offline")).to_be_visible()
    page.evaluate("localStorage.removeItem('mt3ukLapsOfflineAccess')")
    go_offline(page, link)
    page.reload()
    expect(page.locator("#nav-offline")).to_be_visible()


def test_the_last_answer_about_access_still_holds_with_no_signal(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    expect(page.locator("#nav-offline")).to_be_visible()
    go_offline(page, link)
    page.reload()
    expect(page.locator("#nav-offline")).to_be_visible()


def test_the_admin_signed_in_follows_the_list_like_anyone_so_adding_and_taking_away_can_be_tested(page):
    fake = FakeWorker()
    fake.offline_access = False
    open_signed_in(page, fake, admin=True)
    expect(page.locator("#nav-offline")).to_have_count(0)
    expect(page.locator("#tp-offline")).to_be_hidden()


def test_the_admin_with_nobody_signed_in_still_has_it_with_the_viewer_token(page):
    page.add_init_script("localStorage.setItem('mt3ukAdminViewer', JSON.stringify({token:'admintoken1234567890', expires: Date.now() + 864e5}));")
    page.route("**/%s/**" % API_HOST, FakeWorker().reply)
    page.goto("/track.html")
    expect(page.locator("#nav-offline")).to_be_visible()


STUB_CACHES = """
if (window.caches) {
  caches.keys = () => Promise.resolve(['mt3uk-shell-v11', 'mt3uk-laps-offline-v1', 'mt3uk-laps-tiles-v1']);
  caches.delete = (k) => { const d = JSON.parse(sessionStorage.getItem('cacheDeleted') || '[]'); d.push(k); sessionStorage.setItem('cacheDeleted', JSON.stringify(d)); return Promise.resolve(true); };
}
"""


def test_refresh_with_no_signal_does_not_reload_or_clear_the_copy_and_shows_what_was_saved_here(page):
    """Refresh with no signal read the list again from the copy on the device. It used to clear every cache and reload,
    which left a page that could not open."""
    page.add_init_script(STUB_CACHES)
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    go_offline(page, link)
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#lo-pending")).to_contain_text("1 session waiting to be sent")
    page.evaluate("window.__marker = 1")
    page.locator(".tp-refresh").first.click()
    expect(page.locator("#lo-bar")).to_contain_text("Showing the copy kept on this device")
    expect(page.locator("#lo-pending")).to_contain_text("1 session waiting to be sent")
    assert page.evaluate("window.__marker") == 1, "the page was not reloaded"
    assert page.evaluate("JSON.parse(sessionStorage.getItem('cacheDeleted') || '[]')") == [], "nothing kept on the device was cleared"


def test_refresh_with_offline_mode_on_keeps_the_offline_copy_and_does_not_reload(page):
    page.add_init_script(STUB_CACHES)
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    open_signed_in(page, FakeWorker())
    page.evaluate("window.__marker = 1")
    page.locator(".tp-refresh").first.click()
    page.wait_for_timeout(800)
    assert page.evaluate("window.__marker") == 1, "the page was not reloaded"
    assert page.evaluate("JSON.parse(sessionStorage.getItem('cacheDeleted') || '[]')") == [], "the offline copy and its maps were not cleared"


def test_refresh_without_offline_mode_still_reloads_but_leaves_the_laps_caches_alone(page):
    page.add_init_script(STUB_CACHES)
    open_signed_in(page, FakeWorker())
    page.evaluate("window.__marker = 1")
    with page.expect_navigation():
        page.locator(".tp-refresh").first.click()
    deleted = page.evaluate("JSON.parse(sessionStorage.getItem('cacheDeleted') || '[]')")
    assert deleted == ["mt3uk-shell-v11"], deleted


def board_page(page, fake, query):
    """The Leaderboard page, signed in, with Offline mode on and the connection switch in place."""
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    open_page(page, fake, path="/leaderboards.html")
    link = with_link(page, fake)
    page.goto("/leaderboards.html?" + query)
    return link


def test_the_chosen_circuits_leaderboards_are_kept_and_open_with_no_signal(page):
    fake = FakeWorker()
    fake.boards = {"/track/board:thruxton:main": [board_row("car1", "a1", 100)]}
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1'); localStorage.setItem('mt3ukLapsOfflineCircuit', 'thruxton'); localStorage.setItem('mt3ukLapsOfflineCircuitName', 'Thruxton');")
    link = board_page(page, fake, "board=thruxton:main")
    expect(page.locator(".tp-head h2")).to_contain_text("Thruxton")
    expect(page.locator("#lb-old")).to_have_count(0)
    # No signal: the kept board opens, with a note that it is the copy on the device.
    go_offline(page, link)
    page.reload()
    expect(page.locator(".tp-head h2")).to_contain_text("Thruxton")
    expect(page.locator("#lb-old")).to_contain_text("copy kept on this device")
    # A board of another circuit was not kept.
    page.goto("/leaderboards.html?board=silverstone:national")
    expect(page.locator(".tp-empty")).to_contain_text("not on this device")
    expect(page.locator(".tp-empty")).to_contain_text("one circuit")


def test_the_track_list_opens_with_no_signal_from_the_kept_copy(page):
    fake = FakeWorker()
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    link = board_page(page, fake, "")
    expect(page.locator(".tp-board-card").first).to_be_visible()
    go_offline(page, link)
    page.reload()
    expect(page.locator(".tp-board-card").first).to_be_visible()
    expect(page.locator("#lb-old")).to_be_visible()


def test_boards_of_a_circuit_that_was_not_chosen_are_not_kept(page):
    fake = FakeWorker()
    fake.boards = {"/track/board:thruxton:main": [board_row("car1", "a1", 100)]}
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    link = board_page(page, fake, "board=thruxton:main")
    expect(page.locator(".tp-head h2")).to_contain_text("Thruxton")
    go_offline(page, link)
    page.reload()
    expect(page.locator(".tp-empty")).to_contain_text("not on this device")


def test_adding_a_circuit_keeps_every_one_of_its_boards_and_taking_it_off_drops_them(page):
    fake = FakeWorker()
    fake.boards = {"/track/board:thruxton:main": [board_row("car1", "a1", 100)]}
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    board_page(page, fake, "")
    page.wait_for_function("window.MT3UKOffline && MT3UKOffline.addCircuit")
    r = page.evaluate("MT3UKOffline.addCircuit('thruxton', 'Thruxton')")
    assert r["ok"] and r["boards"] == 1, "Thruxton has one layout"
    assert page.evaluate("MT3UKOffline.recall('/track/board?venue=thruxton&layout=main').then(d => !!(d && d.entries))") is True
    assert page.evaluate("MT3UKOffline.circuits().map(c => c.id)") == ["thruxton"]
    page.evaluate("MT3UKOffline.removeCircuit('thruxton')")
    assert page.evaluate("MT3UKOffline.recall('/track/board?venue=thruxton&layout=main')") is None
    assert page.evaluate("MT3UKOffline.circuits().length") == 0


def test_up_to_three_circuits_can_be_kept(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    board_page(page, FakeWorker(), "")
    page.wait_for_function("window.MT3UKOffline && MT3UKOffline.addCircuit")
    for vid in ("thruxton", "silverstone", "brands-hatch"):
        assert page.evaluate("MT3UKOffline.addCircuit('%s', '%s')" % (vid, vid))["ok"]
    full = page.evaluate("MT3UKOffline.addCircuit('donington-park', 'Donington Park')")
    assert full["ok"] is False and full["full"] is True
    assert page.evaluate("MT3UKOffline.circuits().length") == 3


def test_the_confirm_card_offers_one_circuits_leaderboards_and_remembers_the_choice(page):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    open_page(page, FakeWorker())
    page.locator("#tp-offline").click()
    pick = page.locator("#lo-circuit")
    expect(pick).to_be_visible()
    expect(pick.locator("option[value='thruxton']")).to_have_count(1)
    expect(pick.locator("option[value='santa-pod']")).to_have_count(1)
    pick.select_option("thruxton")
    page.locator("#lo-confirm").get_by_role("button", name="Turn on offline mode").click()
    assert page.evaluate("JSON.parse(localStorage.getItem('mt3ukLapsOfflineCircuits'))") == [{"id": "thruxton", "name": "Thruxton"}]


def test_profile_lists_the_kept_circuits_with_a_way_to_add_and_remove_them(page):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 999999;")
    page.add_init_script("navigator.serviceWorker && (navigator.serviceWorker.register = () => new Promise(() => {}))")
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession','tok');localStorage.setItem('mt3ukMyBuildsEmail','a@example.com');")
    page.add_init_script("window.MT3UK_SITES = { main: ['example.test'], mainOrigin: 'http://example.test', laps: ['localhost'] };")
    page.route("**/%s/**" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "access": True}), headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/profile.html")
    pick = page.locator("#offline-mode [data-offline-circuit]")
    expect(pick).to_be_visible()
    expect(pick.locator("option[value='thruxton']")).to_have_count(1)
    expect(page.locator("#offline-mode [data-offline-circuits] li")).to_have_count(0)
    # Offline mode is off, so adding a circuit asks to turn it on (the confirm card); the choice is kept either way.
    pick.select_option("thruxton")
    page.wait_for_function("JSON.parse(localStorage.getItem('mt3ukLapsOfflineCircuits') || '[]').length === 1")
    expect(page.locator("#lo-confirm")).to_be_visible()
    page.locator("#lo-confirm").get_by_role("button", name="Cancel").click()
    expect(page.locator("#offline-mode [data-offline-circuits] li")).to_have_count(1)
    expect(page.locator("#offline-mode [data-offline-circuits]")).to_contain_text("Thruxton")
    expect(page.locator("#offline-mode [data-offline-circuit-count]")).to_have_text("1 of 3 kept")
    page.locator("#offline-mode [data-circuit-remove]").click()
    page.wait_for_function("localStorage.getItem('mt3ukLapsOfflineCircuits') === null")
    expect(page.locator("#offline-mode [data-offline-circuits] li")).to_have_count(0)


def hold(page, locator, ms=750):
    box = locator.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(ms)
    page.mouse.up()


def test_holding_a_track_in_sessions_keeps_it_offline_without_opening_it(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1'); window.MT3UK_TILE_WAIT_MS = 300;")
    fake = FakeWorker()
    open_signed_in(page, fake)
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s="))
    page.goto("/track.html")
    row = page.locator(".tp-trackrow[data-keep-hold]").first
    expect(row).to_be_visible()
    expect(page.locator("[data-keep-hint]").first).to_be_visible()
    hold(page, row)
    expect(page.locator("#lo-bar")).to_contain_text("is kept on this device", timeout=15000)
    cloud = page.locator(".tp-trackwrap[data-keep-venue] [data-keep-toggle]").first
    expect(cloud).to_have_attribute("aria-pressed", "true")
    expect(row).to_have_attribute("aria-expanded", "false")
    assert page.evaluate("MT3UKOffline.circuits().map(c => c.id)") == ["thruxton"]
    # Hold again: asks, then takes it off.
    page.once("dialog", lambda d: d.accept())
    hold(page, row)
    expect(cloud).to_have_attribute("aria-pressed", "false")
    assert page.evaluate("MT3UKOffline.circuits().length") == 0


def test_a_circuit_on_sessions_is_kept_from_the_keyboard_with_its_cloud_button(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1'); window.MT3UK_TILE_WAIT_MS = 300;")
    fake = FakeWorker()
    open_signed_in(page, fake)
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s="))
    page.goto("/track.html")
    cloud = page.locator(".tp-trackwrap[data-keep-venue] [data-keep-toggle]").first
    expect(cloud).to_be_visible()
    expect(cloud).to_have_attribute("aria-pressed", "false")
    expect(cloud).to_have_attribute("aria-label", re.compile(r"^Keep .* for offline use$"))
    # Reachable with Tab after the row, and pressed with Enter.
    page.locator(".tp-trackrow[data-keep-hold]").first.focus()
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.hasAttribute('data-keep-toggle')") is True
    page.keyboard.press("Enter")
    expect(cloud).to_have_attribute("aria-pressed", "true", timeout=15000)
    assert page.evaluate("MT3UKOffline.circuits().map(c => c.id)") == ["thruxton"]
    # The row did not open, and Enter again asks, then takes it off.
    expect(page.locator(".tp-trackrow[data-keep-hold]").first).to_have_attribute("aria-expanded", "false")
    page.once("dialog", lambda d: d.accept())
    page.keyboard.press("Enter")
    expect(cloud).to_have_attribute("aria-pressed", "false")
    assert page.evaluate("MT3UKOffline.circuits().length") == 0


def test_the_one_time_offer_has_the_circuit_choice_and_keeps_it(page):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 300;")
    open_page(page, FakeWorker())
    offer = page.locator("#lo-offer")
    expect(offer).to_be_visible()
    pick = offer.locator("#lo-offer-circuit")
    expect(pick.locator("option[value='thruxton']")).to_have_count(1)
    pick.select_option("thruxton")
    offer.get_by_role("button", name="Turn on offline mode").click()
    assert page.evaluate("JSON.parse(localStorage.getItem('mt3ukLapsOfflineCircuits'))") == [{"id": "thruxton", "name": "Thruxton"}]


def test_the_one_time_offer_with_no_circuit_picked_keeps_none(page):
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 300;")
    open_page(page, FakeWorker())
    page.locator("#lo-offer").get_by_role("button", name="Turn on offline mode").click()
    assert page.evaluate("localStorage.getItem('mt3ukLapsOfflineCircuits')") is None


def test_a_circuit_on_the_leaderboard_is_kept_by_its_cloud_or_by_holding_and_letting_go(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    link = board_page(page, FakeWorker(), "type=track")
    card = page.locator(".lb-cardwrap[data-venue='thruxton']")
    cloud = card.locator("[data-keep-toggle]")
    expect(cloud).to_be_visible()
    expect(cloud).to_have_attribute("aria-pressed", "false")
    cloud.click()
    expect(cloud).to_have_attribute("aria-pressed", "true", timeout=15000)
    assert page.evaluate("MT3UKOffline.circuits().map(c => c.id)") == ["thruxton"]
    # A different card: held and let go without moving.
    other = page.locator(".lb-cardwrap[data-venue='silverstone']")
    hold(page, other.locator(".tp-board-name"), ms=500)
    expect(other.locator("[data-keep-toggle]")).to_have_attribute("aria-pressed", "true", timeout=15000)
    assert page.evaluate("MT3UKOffline.circuits().map(c => c.id).sort()") == ["silverstone", "thruxton"]
    # And it did not count as moving the card: the list has no saved order.
    assert page.evaluate("Object.keys(localStorage).filter(k => /order/i.test(k) && localStorage.getItem(k) && localStorage.getItem(k) !== 'null').length") == 0


def other_members_session(page, fake):
    """Saves one session through the page, then makes a copy of it that belongs to someone else (not in this member's list)
    and puts it on Thruxton's board."""
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    expect(page).to_have_url(re.compile(r"track\.html\?s="))
    rec = dict(next(iter(fake.sessions.values())))
    rec.update(id="other1", ownerName="Sam", carId="carB")
    fake.sessions["other1"] = rec
    fake.boards = {"/track/board:thruxton:main": [board_row("carB", "other1", 100.0)]}


def test_a_session_opened_from_a_kept_circuits_leaderboard_still_opens_with_no_signal(page):
    """Opening a row on a leaderboard opens another member's session. Keeping the circuit keeps those sessions too."""
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1'); window.MT3UK_TILE_WAIT_MS = 300;")
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    other_members_session(page, fake)
    page.goto("/leaderboards.html?type=track")
    page.wait_for_function("window.MT3UKOffline && MT3UKOffline.addCircuit")
    r = page.evaluate("MT3UKOffline.addCircuit('thruxton', 'Thruxton')")
    assert r["ok"] and r["boards"] == 1 and r["sessions"] >= 2, r
    go_offline(page, link)
    page.goto("/leaderboards.html?board=thruxton:main")
    page.locator(".lb-row a.lb-name").first.click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=other1$"))
    expect(page.locator("#tp-headline")).to_be_visible()
    expect(page.get_by_text("not on this device")).to_have_count(0)


def test_a_circuit_not_kept_leaves_the_leaderboard_sessions_off_the_device(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1'); window.MT3UK_TILE_WAIT_MS = 300;")
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    other_members_session(page, fake)
    assert page.evaluate("MT3UKOffline.recall('/track/session?id=other1')") is None


def test_the_sessions_of_a_kept_circuit_are_not_trimmed_away_and_are_released_with_it(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1'); window.MT3UK_TILE_WAIT_MS = 300;")
    fake = FakeWorker()
    open_signed_in(page, fake)
    other_members_session(page, fake)
    page.goto("/leaderboards.html?type=track")
    page.wait_for_function("window.MT3UKOffline && MT3UKOffline.addCircuit")
    page.evaluate("MT3UKOffline.addCircuit('thruxton', 'Thruxton')")
    assert page.evaluate("MT3UKOffline.recall('/track/session?id=other1').then(d => !!(d && d.session))") is True
    # Far more sessions than the device keeps, opened afterwards: the kept circuit's sessions stay.
    page.evaluate("(async () => { for (let i = 0; i < 80; i++) { await MT3UKOffline.remember('/track/session?id=zz' + i, { success: true, session: { id: 'zz' + i } }); await new Promise(r => setTimeout(r, 3)); } })()")
    page.wait_for_timeout(1500)
    assert page.evaluate("MT3UKOffline.recall('/track/session?id=other1').then(d => !!(d && d.session))") is True
    assert page.evaluate("MT3UKOffline.recall('/track/session?id=zz0')") is None, "the ordinary pool is still trimmed"
    # Taking the circuit off releases them to the ordinary pool.
    page.evaluate("MT3UKOffline.removeCircuit('thruxton')")
    page.evaluate("for (let i = 80; i < 160; i++) MT3UKOffline.remember('/track/session?id=zz' + i, { success: true, session: { id: 'zz' + i } })")
    page.wait_for_timeout(1500)
    assert page.evaluate("MT3UKOffline.recall('/track/session?id=other1')") is None


def test_a_fourth_circuit_is_refused_with_a_message(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    board_page(page, FakeWorker(), "type=track")
    page.wait_for_function("window.MT3UKOffline && MT3UKOffline.addCircuit")
    for vid in ("thruxton", "silverstone", "brands-hatch"):
        page.evaluate("MT3UKOffline.addCircuit('%s', '%s')" % (vid, vid))
    page.evaluate("MT3UKOffline.holdKeep('donington-park', 'Donington Park')")
    expect(page.locator("#lo-bar")).to_contain_text("3 circuits are already kept")
    assert page.evaluate("MT3UKOffline.circuits().length") == 3


def test_the_header_icon_is_a_button_that_turns_offline_mode_on_and_off(page):
    """A switch beside the bell: off to start with, a press asks first (Cancel leaves it off), and when it is on a press
    turns it off at once."""
    fake = FakeWorker()
    open_signed_in(page, fake, admin=True)
    icon = page.locator("#nav-offline")
    expect(icon).to_be_visible()
    expect(icon).to_have_attribute("role", "switch")
    expect(icon).to_have_attribute("aria-checked", "false")
    expect(icon).to_have_attribute("aria-label", "Offline mode: off")
    # It sits beside the other header icons.
    assert page.evaluate("document.getElementById('nav-offline').nextElementSibling.id") == "nav-bell"
    icon.click()
    expect(page.locator("#lo-confirm")).to_contain_text("Keep Laps on this device?")
    page.locator("#lo-confirm").get_by_role("button", name="Cancel").click()
    expect(icon).to_have_attribute("aria-checked", "false")
    assert page.evaluate("localStorage.getItem('mt3ukLapsOffline')") is None


def test_with_offline_mode_on_a_press_of_the_icon_turns_it_off(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline','1');localStorage.setItem('mt3ukLapsOfflineKept','42');localStorage.setItem('mt3ukLapsOfflineAt', String(Date.now()));")
    fake = FakeWorker()
    open_signed_in(page, fake, admin=True)
    icon = page.locator("#nav-offline")
    expect(icon).to_have_attribute("aria-checked", "true")
    expect(icon).to_have_attribute("aria-label", "Offline mode: on")
    expect(page.locator("#tp-offline")).to_have_text("Offline mode: on")
    icon.click()
    expect(icon).to_have_attribute("aria-checked", "false")
    assert page.evaluate("localStorage.getItem('mt3ukLapsOffline')") is None
    expect(page.locator("#tp-offline")).to_have_text("Offline mode: off")
    expect(page.locator("#lo-bar")).to_contain_text("Offline mode is off.")


def test_offline_with_no_signal_the_icon_turns_orange_and_a_press_shows_details(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake, admin=True)
    icon = page.locator("#nav-offline")
    go_offline(page, link)
    expect(icon).to_have_class(re.compile(r"is-offline"))
    expect(icon).to_have_attribute("aria-label", "Offline mode: off. You have no signal")
    # A session added offline shows as a number on the icon.
    page.locator("#lo-bar [data-lo='close']").click()
    add_thruxton(page)
    page.get_by_role("button", name="Save session").click()
    expect(page.locator("#nav-offline-count")).to_have_text("1")
    # A press cannot switch it on with no signal: it brings back what works.
    expect(page.locator("#lo-bar")).to_be_hidden()
    icon.click()
    expect(page.locator("#lo-bar")).to_contain_text("You're in offline mode.")
    expect(icon).to_have_attribute("aria-checked", "false")
    go_online(page, link)
    expect(page.locator("#lo-bar")).to_contain_text("1 session sent", timeout=15000)
    expect(icon).not_to_have_class(re.compile(r"is-offline"))
    expect(page.locator("#nav-offline-count")).to_be_hidden()


def test_turning_offline_mode_off_with_no_signal_asks_first_because_the_copy_cannot_come_back(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline','1');localStorage.setItem('mt3ukLapsOfflineKept','42');")
    fake = FakeWorker()
    link = open_signed_in(page, fake, admin=True)
    go_offline(page, link)
    asked = []

    def refuse(d):
        asked.append(d.message)
        d.dismiss()

    page.once("dialog", refuse)
    page.locator("#tp-offline").click()
    page.wait_for_timeout(300)
    assert asked and "cannot open again until you are back online" in asked[0]
    expect(page.locator("#nav-offline")).to_have_attribute("aria-checked", "true")
    assert page.evaluate("localStorage.getItem('mt3ukLapsOffline')") == "1"


def test_the_header_icon_is_the_size_of_its_neighbours_on_a_phone(page):
    fake = FakeWorker()
    page.set_viewport_size({"width": 390, "height": 800})
    open_signed_in(page, fake, admin=True)
    box = page.locator("#nav-offline").bounding_box()
    chat = page.locator("#nav-chat").bounding_box()
    assert abs(box["height"] - chat["height"]) < 1 and box["width"] <= chat["width"] + 4, (box, chat)
    # Nothing in the header runs off the side of the phone.
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_the_offer_is_held_back_from_members_who_are_not_approved(page):
    """While Offline mode is tried out only the admin and approved members are offered it."""
    fake = FakeWorker()
    fake.offline_access = False
    page.add_init_script("window.MT3UK_OFFLINE_ASK_DELAY = 0;")
    open_page(page, fake)
    page.wait_for_timeout(800)
    expect(page.locator("#lo-offer")).to_have_count(0)


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
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession','tok');localStorage.setItem('mt3ukMyBuildsEmail','a@example.com');")
    page.route("**/%s/**" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "access": True}), headers={"Access-Control-Allow-Origin": "*"}))
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
    expect(confirm).to_contain_text("your latest 5 sessions")
    expect(confirm).to_contain_text("Pick the track you are going to")
    expect(confirm).to_contain_text("any session you open while you have a signal, with its map")
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


def test_a_kept_circuit_says_how_many_sessions_it_holds_and_can_be_refreshed(page):
    """Profile's list shows 'N sessions kept' for each circuit, and Refresh kept circuits keeps them all again."""
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1'); window.MT3UK_TILE_WAIT_MS = 300;")
    fake = FakeWorker()
    open_signed_in(page, fake)
    other_members_session(page, fake)
    page.goto("/leaderboards.html?type=track")
    page.wait_for_function("window.MT3UKOffline && MT3UKOffline.addCircuit")
    page.evaluate("""document.body.insertAdjacentHTML('beforeend',
      '<div id="x"><ul data-offline-circuits></ul><button type="button" data-circuit-refresh hidden>Refresh kept circuits</button><p data-offline-status></p></div>')""")
    page.evaluate("MT3UKOffline.addCircuit('thruxton', 'Thruxton')")
    row = page.locator("#x [data-offline-circuits] li")
    expect(row).to_contain_text("Thruxton")
    expect(row).to_contain_text("sessions kept", timeout=15000)
    refresh = page.locator("#x [data-circuit-refresh]")
    expect(refresh).to_be_visible()
    refresh.click()
    expect(page.locator("#x [data-offline-status]")).to_contain_text("Refreshed", timeout=15000)
    expect(row).to_contain_text("sessions kept")


def test_map_pictures_are_asked_for_in_small_chunks_closer_zoom_first_within_a_budget(page):
    """A car's browser (Tesla) closed on 1,500 pictures at once: they go in chunks of 60, zoom 16 first, up to a budget."""
    page.add_init_script("""
      window.__msgs = [];
      const fake = { register: () => Promise.resolve(), ready: Promise.resolve({ active: { postMessage: (m, ports) => { window.__msgs.push(m); ports[0].postMessage({ ok: true, kept: (m.urls || []).length }); } } }), controller: null, addEventListener() {} };
      Object.defineProperty(navigator, 'serviceWorker', { value: fake, configurable: true });
      window.MT3UK_TILE_BUDGET = 150;
    """)
    fake = FakeWorker()
    open_signed_in(page, fake)
    base = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/"
    r = page.evaluate("""async (base) => {
      const urls = [];
      for (let i = 0; i < 300; i++) urls.push(base + '17/' + i + '/1');
      for (let i = 0; i < 100; i++) urls.push(base + '16/' + i + '/1');
      navigator.serviceWorker.register = () => Promise.resolve();
      const out = {};
      await MT3UKOffline.keepTiles(urls, out, () => {});
      return { sizes: window.__msgs.filter(m => m.type === 'laps-offline-tiles').map(m => m.urls.length), first: window.__msgs[0].urls[0], tiles: out.tiles };
    }""", base)
    assert r["sizes"] == [60, 60, 30], r
    assert "/tile/16/" in r["first"], r
    assert r["tiles"] == 150, r


def test_a_car_browser_keeps_fewer_sessions_per_circuit_and_fewer_map_pictures(page):
    """The Tesla screen closed while Offline mode fetched the latest 25 sessions and their maps: the latest sessions are
    a fallback of 5 on every device, a car browser keeps fewer per circuit and at most 120 pictures a run, and the
    confirm card leads with the track to keep."""
    page.add_init_script("""
      window.MT3UK_CAR_BROWSER = true;
      window.__msgs = [];
      const fake = { register: () => Promise.resolve(), ready: Promise.resolve({ active: { postMessage: (m, ports) => { window.__msgs.push(m); ports[0].postMessage({ ok: true, kept: (m.urls || []).length }); } } }), controller: null, addEventListener() {} };
      Object.defineProperty(navigator, 'serviceWorker', { value: fake, configurable: true });
    """)
    fake = FakeWorker()
    open_signed_in(page, fake)
    base = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/"
    r = page.evaluate("""async (base) => {
      navigator.serviceWorker.register = () => Promise.resolve();
      const urls = []; for (let i = 0; i < 300; i++) urls.push(base + '16/' + i + '/1');
      const out = {}; await MT3UKOffline.keepTiles(urls, out, () => {});
      return { sizes: window.__msgs.filter(m => m.type === 'laps-offline-tiles').map(m => m.urls.length), tiles: out.tiles || 0, car: MT3UKOffline.carBrowser(), prep: MT3UKOffline.prepareSessions() };
    }""", base)
    assert r == {"sizes": [60, 60], "tiles": 120, "car": True, "prep": 5}, r
    page.locator("#tp-offline").click()
    expect(page.locator("#lo-confirm")).to_contain_text("Track to keep for offline use")
    expect(page.locator("#lo-confirm")).to_contain_text("latest 5 sessions")
    expect(page.locator("#lo-confirm")).to_contain_text("fewer pictures are fetched ahead")


def test_a_car_browser_is_told_to_keep_the_tab_open(page):
    """The Tesla screen blocks every page load with no connection, so on a car browser the confirm card and the offline
    bar say to keep the tab open and not refresh. A phone gets no such note."""
    page.add_init_script("window.MT3UK_CAR_BROWSER = true;")
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    page.locator("#tp-offline").click()
    expect(page.locator("#lo-confirm .lo-car-note")).to_contain_text("keep this tab open and do not refresh")
    page.locator("#lo-confirm").get_by_role("button", name="Cancel").click()
    go_offline(page, link)
    expect(page.locator("#lo-bar")).to_contain_text("keep this tab open")


def test_a_phone_is_not_told_to_keep_the_tab_open(page):
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    page.locator("#tp-offline").click()
    expect(page.locator("#lo-confirm")).to_be_visible()
    expect(page.locator("#lo-confirm .lo-car-note")).to_have_count(0)
    page.locator("#lo-confirm").get_by_role("button", name="Cancel").click()
    go_offline(page, link)
    expect(page.locator("#lo-bar")).to_be_visible()
    expect(page.locator("#lo-bar")).not_to_contain_text("keep this tab open")


def test_on_a_car_browser_offline_the_laps_pages_load_inside_the_open_tab(page):
    """Sessions to the Leaderboard, a board, a session from it and Back, all with no signal, without a page load the car
    could block: the window object survives throughout."""
    page.add_init_script("window.MT3UK_CAR_BROWSER = true; localStorage.setItem('mt3ukLapsOffline', '1'); window.MT3UK_TILE_WAIT_MS = 300;")
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    other_members_session(page, fake)
    page.goto("/leaderboards.html?type=track")
    page.wait_for_function("window.MT3UKOffline && MT3UKOffline.addCircuit")
    r = page.evaluate("MT3UKOffline.addCircuit('thruxton', 'Thruxton')")
    assert r["ok"] and r["boards"] == 1, r
    page.goto("/track.html")
    expect(page.locator("#tp-lb-pill")).to_be_visible()
    page.evaluate("window.__sameWindow = 'yes'")
    go_offline(page, link)
    page.locator("#tp-lb-pill").click()
    expect(page.locator(".tp-board-card").first).to_be_visible(timeout=15000)
    expect(page).to_have_url(re.compile(r"leaderboards\.html$"))
    assert page.evaluate("window.__sameWindow") == "yes"
    page.locator(".lb-layout[href*='thruxton']").first.click()
    expect(page.locator(".lb-row a.lb-name").first).to_be_visible(timeout=15000)
    page.locator(".lb-row a.lb-name").first.click()
    expect(page).to_have_url(re.compile(r"track\.html\?s=other1$"))
    expect(page.locator("#tp-headline")).to_be_visible(timeout=15000)
    assert page.evaluate("window.__sameWindow") == "yes"
    page.go_back()
    expect(page.locator(".lb-row a.lb-name").first).to_be_visible(timeout=15000)
    expect(page).to_have_url(re.compile(r"leaderboards\.html\?board="))
    assert page.evaluate("window.__sameWindow") == "yes"


def test_a_phone_offline_still_changes_page_the_normal_way(page):
    page.add_init_script("localStorage.setItem('mt3ukLapsOffline', '1');")
    fake = FakeWorker()
    link = open_signed_in(page, fake)
    page.evaluate("window.__sameWindow = 'yes'")
    go_offline(page, link)
    page.locator("#tp-lb-pill").click()
    expect(page).to_have_url(re.compile(r"leaderboards\.html$"))
    assert page.evaluate("window.__sameWindow") is None


def test_on_a_car_browser_with_offline_mode_on_pages_load_inside_the_tab_even_before_offline_is_noticed(page):
    """The car's own online state cannot be trusted, so with Offline mode on a move between Laps pages is made inside the
    open tab whether or not Laps has noticed the loss of signal."""
    page.add_init_script("window.MT3UK_CAR_BROWSER = true; localStorage.setItem('mt3ukLapsOffline', '1');")
    fake = FakeWorker()
    open_signed_in(page, fake)
    page.evaluate("window.__sameWindow = 'yes'")
    page.locator("#tp-lb-pill").click()
    expect(page).to_have_url(re.compile(r"leaderboards\.html$"))
    expect(page.locator(".tp-board-card").first).to_be_visible(timeout=15000)
    assert page.evaluate("window.__sameWindow") == "yes"
    page.locator("#lb-my-sessions").click()
    expect(page).to_have_url(re.compile(r"track\.html$"))
    assert page.evaluate("window.__sameWindow") == "yes"


def test_a_car_browser_with_offline_mode_off_changes_page_the_normal_way(page):
    page.add_init_script("window.MT3UK_CAR_BROWSER = true;")
    fake = FakeWorker()
    open_signed_in(page, fake)
    page.evaluate("window.__sameWindow = 'yes'")
    page.locator("#tp-lb-pill").click()
    expect(page).to_have_url(re.compile(r"leaderboards\.html$"))
    assert page.evaluate("window.__sameWindow") is None
