"""racebox.html, Drag run mode: the 0 to 60 timer, the speed dial with its G meter, the satellites, and the saved runs.
The app is stood in for, and it sends RaceBox data messages built here, with the same layout the RaceBox sends."""
import base64
import json
import struct

import pytest
from playwright.sync_api import expect

from test_racebox_test_page import STUB


def _ubx(payload):
    """A UBX frame (class 0xFF, id 0x01) with its Fletcher checksum."""
    head = bytes([0xFF, 0x01]) + struct.pack("<H", len(payload))
    a = b = 0
    for byte in head + payload:
        a = (a + byte) & 0xFF
        b = (b + a) & 0xFF
    return bytes([0xB5, 0x62]) + head + payload + bytes([a, b])


def live(speed_ms=0.0, fix=True, sats=12, gx=0.0, gy=0.0, at_ms=0):
    """One RaceBox data reading as base64: speed in metres a second, the fix, the satellites and the G forces."""
    p = bytearray(80)
    struct.pack_into("<H", p, 4, 2026)
    p[6], p[7], p[8], p[9] = 11, 11, 19, 50
    # The time of the reading: whole seconds, then the milliseconds as nanoseconds (so a run's times come out right).
    p[10] = (at_ms // 1000) % 60
    struct.pack_into("<i", p, 16, (at_ms % 1000) * 1000000)
    p[11] = 0x03
    p[20] = 3 if fix else 0
    p[21] = 0x01 if fix else 0
    p[23] = sats
    struct.pack_into("<i", p, 24, int(-0.9955 * 1e7))
    struct.pack_into("<i", p, 28, int(52.124 * 1e7))
    struct.pack_into("<I", p, 40, 1200)
    struct.pack_into("<i", p, 48, int(speed_ms * 1000))
    struct.pack_into("<h", p, 68, int(gx * 1000))
    struct.pack_into("<h", p, 70, int(gy * 1000))
    return base64.b64encode(_ubx(bytes(p))).decode()


def _emit(page, b64):
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", b64)


def _runs_route(page, saved):
    def reply(r):
        if r.request.method == "POST":
            body = json.loads(r.request.post_data or "{}")
            if body.get("clear") is True:
                saved["runs"] = []
            elif "t" in body:
                saved["runs"].insert(0, {"t": body["t"], "t30": body.get("t30"), "at": "2026-11-11T17:00:00Z"})
        r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "runs": saved["runs"]}),
                  headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-session-token",
                           "Access-Control-Allow-Methods": "GET, POST, OPTIONS"})
    page.route("**/navigate/runs", reply)


@pytest.fixture(autouse=True)
def _approved(page):
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.add_init_script(STUB)
    page.route("**/laps/racebox/access", lambda r: r.fulfill(
        status=200, content_type="application/json", body='{"success":true,"access":true,"racebox":true}',
        headers={"Access-Control-Allow-Origin": "*"}))


def _open_drag(page, saved=None):
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    _emit(page, live(fix=False, sats=4))
    page.locator('#rbt-modes [data-mode="drag"]').click()
    expect(page.locator("#rbt-timing")).to_be_visible(timeout=10000)


def test_drag_run_mode_shows_the_timing_and_the_other_modes_hide_it(page):
    page.goto("/racebox.html")
    expect(page.locator("#rbt-timing")).to_be_hidden()
    page.locator('#rbt-modes [data-mode="drag"]').click()
    expect(page.locator("#rbt-timing")).to_be_visible()
    # Full screen covers the page: its own button brings the page back before another mode is chosen.
    page.locator("#rbt-tm-fs").click()
    page.locator('#rbt-modes [data-mode="road"]').click()
    expect(page.locator("#rbt-timing")).to_be_hidden()


def test_the_satellite_bar_is_empty_until_a_fix_then_shows_the_satellites(page):
    _open_drag(page)
    expect(page.locator("#rbt-tm-bars .is-on")).to_have_count(0)
    expect(page.locator("#rbt-tm-text")).to_have_text("Waiting for a GPS fix")
    _emit(page, live(fix=True, sats=9))
    expect(page.locator("#rbt-tm-bars .is-on")).to_have_count(9, timeout=5000)
    expect(page.locator("#rbt-tm-text")).to_have_text("9 satellites")


def test_a_run_from_a_standstill_is_timed_and_saved_with_its_0_30(page):
    saved = {"runs": []}
    _runs_route(page, saved)
    _open_drag(page, saved)
    _emit(page, live(speed_ms=0.0))
    expect(page.locator("#rbt-tm-go")).to_have_text("Time a run", timeout=5000)
    page.locator("#rbt-tm-go").click()
    expect(page.locator("#rbt-tm-go")).to_have_text("Go")
    expect(page.locator("#rbt-tm-go")).to_have_class(__import__("re").compile("is-go"))
    # Stopped, then a launch to 60 mph in about 3.5 seconds, 25 readings a second.
    for i in range(25 * 6):
        t = i / 25
        speed = 0.0 if t < 0.5 else min(30.0, 7.5 * (t - 0.5))
        _emit(page, live(speed_ms=speed, at_ms=i * 40))
    expect(page.locator("#rbt-tm-go")).to_contain_text("Run 1: 0–30", timeout=5000)
    expect(page.locator("#rbt-tm-go")).to_contain_text("0–60 3.")
    expect(page.locator("#rbt-tm-list .rbt-tm-half").first).to_have_text(__import__("re").compile(r"0–30 \d\.\d\d s"))
    assert saved["runs"] and saved["runs"][0]["t30"] is not None


def test_a_car_already_moving_when_tapped_is_not_armed(page):
    saved = {"runs": []}
    _runs_route(page, saved)
    _open_drag(page, saved)
    _emit(page, live(speed_ms=10.0))
    expect(page.locator("#rbt-tm-go")).to_have_text("Time a run", timeout=5000)
    page.locator("#rbt-tm-go").click()
    expect(page.locator("#rbt-tm-go")).to_have_text("Stop first, then tap Time a run")
    expect(page.locator("#rbt-tm-go")).not_to_have_class(__import__("re").compile("is-go"))


def test_the_saved_runs_can_be_cleared(page):
    saved = {"runs": [{"t": 38.6, "t30": 10.2, "at": "2026-11-11T17:00:00Z"}]}
    _runs_route(page, saved)
    page.on("dialog", lambda d: d.accept())
    _open_drag(page, saved)
    expect(page.locator("#rbt-tm-best")).to_have_text("Best 38.60 s", timeout=5000)
    page.locator("#rbt-tm-clear").click()
    expect(page.locator("#rbt-tm-none")).to_be_visible(timeout=5000)
    assert saved["runs"] == []


def test_the_dial_has_its_speed_numbers_and_the_g_meter_labels(page):
    _open_drag(page)
    expect(page.locator("#rbt-tm-dial text").filter(has_text="140")).to_have_count(1)
    expect(page.locator("#rbt-tm-dial text").filter(has_text="1.0g")).to_have_count(1)
    expect(page.locator("#rbt-tm-dial text").filter(has_text="G Forces")).to_have_count(1)


def test_drag_run_goes_full_screen_and_the_full_screen_button_brings_the_page_back(page):
    page.goto("/racebox.html")
    page.locator('#rbt-modes [data-mode="drag"]').click()
    expect(page.locator("#rbt-timing")).to_have_class("rbt-timing rbt-tm-full", timeout=5000)
    expect(page.locator("#rbt-tm-fs")).to_have_attribute("aria-pressed", "true")
    page.locator("#rbt-tm-fs").click()
    expect(page.locator("#rbt-timing")).not_to_have_class("rbt-timing rbt-tm-full")
    expect(page.locator("#rbt-tm-fs")).to_have_attribute("aria-pressed", "false")


def test_the_readings_fold_away_in_drag_run_and_details_opens_them(page):
    page.goto("/racebox.html")
    expect(page.locator("#rbt-band-wrap")).to_be_visible()
    page.locator('#rbt-modes [data-mode="drag"]').click()
    expect(page.locator("#rbt-details-toggle")).to_have_attribute("aria-expanded", "false")
    expect(page.locator("#rbt-band-wrap")).to_be_hidden()
    page.locator("#rbt-tm-fs").click()
    page.locator("#rbt-details-toggle").click()
    expect(page.locator("#rbt-band-wrap")).to_be_visible()
    expect(page.locator("#rbt-details-toggle")).to_have_attribute("aria-expanded", "true")


def test_the_timer_asks_for_the_racebox_until_it_is_connected(page):
    # Not connected yet: the button asks for the RaceBox (not the GPS fix), and the satellites say so.
    page.goto("/racebox.html")
    page.locator('#rbt-modes [data-mode="drag"]').click()
    expect(page.locator("#rbt-tm-go")).to_have_text("Connect the RaceBox", timeout=5000)
    expect(page.locator("#rbt-tm-text")).to_have_text("Not connected")
    # Connected, with no fix yet: now it says it is acquiring the GPS fix.
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    _emit(page, live(fix=False, sats=4))
    expect(page.locator("#rbt-tm-go")).to_have_text("Acquiring GPS fix", timeout=5000)
    expect(page.locator("#rbt-tm-text")).to_have_text("Waiting for a GPS fix")
    # Dropped again: back to asking for the RaceBox.
    page.evaluate("(b) => window.__rbEmit('status', { state: 'disconnected' })", None)
    expect(page.locator("#rbt-tm-go")).to_have_text("Connect the RaceBox", timeout=5000)

