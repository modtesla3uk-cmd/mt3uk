"""racebox.html: shows the live readings a RaceBox sends to the Laps app. The Capacitor plugin is stood in for
here, and it sends the example packet from the RaceBox BLE protocol documentation (rev 9)."""
import base64
import pytest
from playwright.sync_api import expect
ADMIN = "localStorage.setItem('mt3ukAdminViewer', JSON.stringify({ token: 'test-token', expires: Date.now() + 86400000 }));"


# The 88-byte example packet from the documentation: header, 80-byte data message, checksum.
EXAMPLE_HEX = (
    "B5 62 FF 01 50 00 A0 E7 0C 07 E6 07 01 0A 08 33 08 37 19 00 00 00 2A AD 4D 0E 03 01 EA 0B C6 93 "
    "E1 0D 3B 37 6F 19 61 8C 09 00 0F 01 09 00 9C 03 00 00 2C 07 00 00 23 00 00 00 00 00 00 00 D0 00 "
    "00 00 88 A9 DD 00 2C 01 00 59 FD FF 71 00 CE 03 2F FF 56 00 FC FF 06 DB"
)
EXAMPLE_B64 = base64.b64encode(bytes(int(h, 16) for h in EXAMPLE_HEX.split())).decode()

STUB = """
window.__rb = { listeners: {} };
window.Capacitor = {
  isNativePlatform: function () { return true; },
  Plugins: {
    RaceBox: {
      addListener: function (name, fn) { (window.__rb.listeners[name] = window.__rb.listeners[name] || []).push(fn); },
      connect: function () { return Promise.resolve({ scanning: true }); },
      status: function () { return Promise.resolve({ connected: false, name: '', permitted: true }); },
      disconnect: function () { return Promise.resolve(); }
    },
    App: { addListener: function () {} }
  }
};
window.__rbEmit = function (name, data) { (window.__rb.listeners[name] || []).forEach(function (fn) { fn(data); }); };
"""


@pytest.fixture(autouse=True)
def _approved_member(page):
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":true}', headers={"Access-Control-Allow-Origin": "*"}))


def test_the_racebox_page_shows_the_live_readings_from_the_app(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    expect(page.locator("#rbt-connect")).to_be_enabled()
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    expect(page.locator("#rbt-status")).to_contain_text("Connected to RaceBox Mini S 2242505877")
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    expect(page.locator("#rbt-speed")).to_have_text("0")
    expect(page.locator("#rbt-speed-unit")).to_have_text("km/h")
    page.locator("#rbt-unit").click()
    expect(page.locator("#rbt-speed-unit")).to_have_text("mph")
    expect(page.locator("#rbt-unit")).to_have_attribute("aria-checked", "true")
    page.locator("#rbt-unit").click()
    expect(page.locator("#rbt-speed-unit")).to_have_text("km/h")
    expect(page.locator("#rbt-heading")).to_have_text("0.0")
    expect(page.locator("#rbt-pos")).to_have_text("42.671903, 23.288724")
    expect(page.locator("#rbt-fix")).to_have_text("Good")
    expect(page.locator("#rbt-sats")).to_have_text("11")
    expect(page.locator("#rbt-g")).to_contain_text("0.11 / 0.97 g")
    expect(page.locator("#rbt-batt")).to_have_text("89%")
    expect(page.locator("#rbt-time")).to_have_text("2022-01-10 08:51:08")


def test_on_a_computer_an_approved_member_sees_the_page_and_is_told_to_use_the_phone(page):
    page.goto("/racebox.html")
    expect(page.locator("#rbt-body")).to_be_visible(timeout=10000)
    expect(page.locator("#rbt-phone-note")).to_contain_text("open this page on your phone in the Laps app")
    expect(page.locator("#rbt-connect")).to_be_disabled()


def test_on_a_computer_a_member_who_is_not_approved_sees_only_the_note(page):
    page.unroute("**/laps/racebox/access")
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":false}', headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/racebox.html")
    page.wait_for_timeout(800)
    expect(page.locator("#rbt-gate")).to_contain_text("approved members, in the Laps app")
    expect(page.locator("#rbt-body")).to_be_hidden()


def _switch(page, on):
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":%s}' % ("true" if on else "false"), headers={"Access-Control-Allow-Origin": "*"}))


def test_the_laps_admin_page_opens_the_racebox_panel_to_all_and_approves_members(page):
    state = {"open": False, "allowed": [], "posts": []}

    def admin(route):
        if route.request.method == "POST":
            body = route.request.post_data or ""
            state["posts"].append(body)
            if '"action":"open"' in body:
                state["open"] = '"open":true' in body
        body = '{"success":true,"open":%s,"allowed":%s}' % ("true" if state["open"] else "false", "[]")
        route.fulfill(status=200, content_type="application/json", body=body, headers={"Access-Control-Allow-Origin": "*"})

    page.route("**/laps/racebox/admin*", admin)
    page.goto("/track-admin.html")
    page.locator("#racebox-wrap summary").click()
    switch = page.locator("#racebox-open")
    expect(switch).to_have_attribute("aria-checked", "false")
    switch.click()
    expect(switch).to_have_attribute("aria-checked", "true")
    assert any('"action":"open"' in p for p in state["posts"]), state["posts"]
    expect(page.locator("#racebox-note")).to_contain_text("Open to all members")


def test_a_connection_from_before_the_page_was_opened_is_shown_as_connected(page):
    stub = STUB.replace("status: function () { return Promise.resolve({ connected: false, name: '', permitted: true }); },",
                        "status: function () { return Promise.resolve({ connected: true, name: 'RaceBox Mini S 2242505877', permitted: true }); },")
    page.add_init_script(ADMIN)
    page.add_init_script(stub)
    page.goto("/racebox.html")
    expect(page.locator("#rbt-status")).to_contain_text("Connected to RaceBox Mini S 2242505877")
    expect(page.locator("#rbt-connect")).to_have_text("Connected")
    expect(page.locator("#rbt-connect")).to_have_attribute("aria-checked", "true")


def test_the_racebox_page_opens_for_an_approved_member_in_the_app(page):
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    expect(page.locator("#rbt-body")).to_be_visible(timeout=10000)
    expect(page.locator("#rbt-gate")).to_be_hidden()


def test_the_racebox_page_stays_shut_for_a_member_who_is_not_approved(page):
    page.add_init_script(STUB)
    page.unroute("**/laps/racebox/access")
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":false}', headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/racebox.html")
    page.wait_for_timeout(800)
    expect(page.locator("#rbt-gate")).to_be_visible()
    expect(page.locator("#rbt-body")).to_be_hidden()


def test_the_racebox_panel_is_no_longer_on_profile(page):
    page.goto("/profile.html")
    expect(page.locator("#lh-racebox")).to_have_count(0)


def test_the_racebox_map_goes_full_screen_with_the_readings_over_it(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    expect(page.locator("html")).not_to_have_class("rbt-full-on")
    expect(page.locator("#rbt-full")).to_have_text("Go full screen")
    page.locator("#rbt-full").click()
    expect(page.locator("html")).to_have_class("rbt-full-on")
    expect(page.locator("#rbt-full")).to_have_text("Exit full screen")
    page.locator("#rbt-full").click()
    expect(page.locator("html")).not_to_have_class("rbt-full-on")
    expect(page.locator("#rbt-full")).to_have_text("Go full screen")


def test_not_connected_is_said_at_start_and_when_the_racebox_drops(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    # Before the app reports a connection, the page says so and offers Connect.
    expect(page.locator("#rbt-status")).to_have_text("Not connected. Switch the RaceBox on, then tap Connect to RaceBox.")
    expect(page.locator("#rbt-connect")).to_have_attribute("aria-checked", "false")
    # Connected, with a good fix, then the RaceBox drops: the status and the prompt say not connected.
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    expect(page.locator("#rbt-prompt")).to_be_hidden()
    page.evaluate("(b) => window.__rbEmit('status', { state: 'disconnected' })", None)
    expect(page.locator("#rbt-status")).to_have_text("Disconnected.")
    expect(page.locator("#rbt-prompt")).to_have_text("Not connected. Tap Connect to RaceBox to start.")
    expect(page.locator("#rbt-prompt")).to_be_visible()
    expect(page.locator("#rbt-connect")).to_have_attribute("aria-checked", "false")


def test_the_g_meter_zeroes_itself_while_the_car_is_parked(page):
    import struct
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    # A parked RaceBox sitting 0.26 g across because it is mounted at a slight angle.
    payload = bytearray(base64.b64decode(EXAMPLE_B64)[6:86])
    struct.pack_into("<i", payload, 48, 0)
    struct.pack_into("<h", payload, 68, 260)
    struct.pack_into("<h", payload, 70, 0)
    body = bytes([0xFF, 0x01]) + struct.pack("<H", len(payload)) + bytes(payload)
    a = b = 0
    for x in body:
        a = (a + x) & 0xFF
        b = (b + a) & 0xFF
    parked = base64.b64encode(bytes([0xB5, 0x62]) + body + bytes([a, b])).decode()
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => { for (var i = 0; i < 30; i++) window.__rbEmit('data', { base64: b }); }", parked)
    expect(page.locator("#rbt-meter-dot")).to_have_attribute("cx", "50.0")
    expect(page.locator("#rbt-meter-x")).to_have_text("0.00")


def test_a_drive_is_saved_on_the_phone_and_still_listed_after_the_app_is_closed(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-record").click()
    expect(page.locator("#rbt-rec-line")).to_be_visible()
    page.evaluate("(b) => { for (var i = 0; i < 50; i++) window.__rbEmit('data', { base64: b }); }", EXAMPLE_B64)
    page.locator("#rbt-record").click()
    expect(page.locator("#rbt-rec-line")).to_be_hidden()
    expect(page.locator("#rbt-drives-list li")).to_have_count(1)
    expect(page.locator("#rbt-drives-list li")).to_contain_text("50 readings")
    # Closing and opening the app again: the drive is still there.
    page.reload()
    expect(page.locator("#rbt-drives-list li")).to_have_count(1)
    expect(page.locator("#rbt-drives-list li")).to_contain_text("50 readings")


def test_a_drive_works_out_its_distance_top_speed_and_stops(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    # 10 seconds at 36 km/h, 30 seconds stopped, then 10 seconds at 36 km/h, read at 25 readings a second.
    res = page.evaluate("""() => {
      var rows = [], t = 0;
      function add(kph, n) { for (var k = 0; k < n; k++) { rows.push([t, 51.0, -1.0, kph, 0, 0, 0, 1, 0, 0, 0, 1, 10, 1]); t += 40; } }
      add(36, 250); add(0, 750); add(36, 250);
      return window.MT3UKRaceBoxDrive.analyse(rows);
    }""")
    assert len(res["stops"]) == 1
    assert 29 <= res["stops"][0]["secs"] <= 31
    assert abs(res["distanceM"] - 199.6) < 1
    assert res["topKph"] == 36
    assert 19 <= res["movingS"] <= 21


def test_a_saved_drive_opens_with_its_figures_and_stops_and_closes(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-record").click()
    page.evaluate("(b) => { for (var i = 0; i < 50; i++) window.__rbEmit('data', { base64: b }); }", EXAMPLE_B64)
    page.locator("#rbt-record").click()
    expect(page.locator("#rbt-drives-list li")).to_have_count(1)
    page.locator(".rbt-view-open").click()
    expect(page.locator("#rbt-view")).to_be_visible()
    expect(page.locator("#rbt-view-stats")).to_contain_text("Distance")
    expect(page.locator("#rbt-view-stats")).to_contain_text("Top speed")
    expect(page.locator("#rbt-view-stops")).to_contain_text("No stops")
    page.locator("#rbt-view-close").click()
    expect(page.locator("#rbt-view")).to_be_hidden()


def test_record_a_drive_only_turns_on_once_the_gps_has_a_fix(page):
    import struct
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    # A packet with no GPS fix (fix status 0): Record a drive stays off, and the page says why.
    payload = bytearray(base64.b64decode(EXAMPLE_B64)[6:86])
    payload[20] = 0
    body = bytes([0xFF, 0x01]) + struct.pack("<H", len(payload)) + bytes(payload)
    a = b = 0
    for x in body:
        a = (a + x) & 0xFF
        b = (b + a) & 0xFF
    no_fix = base64.b64encode(bytes([0xB5, 0x62]) + body + bytes([a, b])).decode()
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", no_fix)
    expect(page.locator("#rbt-record")).to_be_disabled()
    expect(page.locator("#rbt-rec-note")).to_be_visible()
    # With a fix, it can be turned on, and the note goes.
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    expect(page.locator("#rbt-record")).to_be_enabled()
    expect(page.locator("#rbt-rec-note")).to_be_hidden()


def test_a_stop_is_named_by_its_street_and_number(page):
    page.route("https://nominatim.openstreetmap.org/**", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body='{"address":{"house_number":"12","road":"Church Road","town":"Towcester"}}'))
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    name = page.evaluate("() => window.MT3UKRaceBoxDrive.placeName(52.13, -0.99)")
    assert name == "12 Church Road, Towcester"


def test_the_speed_shows_large_on_the_map_in_full_screen(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-full").click()
    expect(page.locator("#rbt-speed-float")).to_be_visible()
    expect(page.locator("#rbt-speed-big")).to_have_text("0")
    expect(page.locator("#rbt-speed-big-unit")).to_have_text("km/h")


def test_the_racebox_test_link_shows_in_the_laps_app_only_for_approved_members(page):
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.add_init_script(STUB)
    page.route("**/laps/racebox/access", lambda r: r.fulfill(
        status=200, content_type="application/json", body='{"success":true,"access":true,"open":false}'))
    page.goto("/laps.html")
    expect(page.locator("a[data-racebox-link]").first).not_to_have_attribute("hidden", "")
    expect(page.locator("a[data-racebox-link]").first).to_have_attribute("href", "racebox.html")
    # Not approved: the link stays hidden.
    page.unroute("**/laps/racebox/access")
    page.route("**/laps/racebox/access", lambda r: r.fulfill(
        status=200, content_type="application/json", body='{"success":true,"access":false,"open":false}'))
    page.goto("/laps.html")
    expect(page.locator("a[data-racebox-link]").first).to_have_attribute("hidden", "")


def test_the_racebox_page_stays_in_the_laps_address_when_opened_from_the_laps_menu():
    # The sign-in handover sends any Laps address that is not on its Laps list to MT3UK, so the RaceBox page must be on it.
    from pathlib import Path
    script = (Path(__file__).resolve().parent.parent / "js" / "account-bar.js").read_text(encoding="utf-8")
    line = next(l for l in script.splitlines() if "var LAPS_PAGES" in l)
    assert "'/racebox.html'" in line


def test_the_big_record_button_on_the_full_screen_map_starts_and_stops_a_drive(page):
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-full").click()
    expect(page.locator("#rbt-rec-float")).to_be_visible()
    expect(page.locator("#rbt-rec-float")).to_be_enabled()
    page.locator("#rbt-rec-float").click()
    expect(page.locator("#rbt-rec-float")).to_have_text("Stop")
    expect(page.locator("#rbt-rec-float")).to_have_attribute("aria-pressed", "true")
    page.evaluate("(b) => { for (var i = 0; i < 30; i++) window.__rbEmit('data', { base64: b }); }", EXAMPLE_B64)
    page.locator("#rbt-rec-float").click()
    expect(page.locator("#rbt-rec-float")).to_have_text("Record")
    page.locator("#rbt-full").click()
    expect(page.locator("#rbt-drives-list li")).to_have_count(1)


def test_in_full_screen_the_heading_is_on_the_map_and_the_speed_is_not_in_the_band(page):
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-full").click()
    expect(page.locator(".rbt-map-wrap > .rbt-heading-tile")).to_be_visible()
    expect(page.locator("#rbt-speed-tile-check")).to_have_count(0)
    expect(page.locator(".rbt-speed-tile")).to_be_hidden()
    page.locator("#rbt-full").click()
    expect(page.locator(".rbt-band .rbt-heading-tile")).to_have_count(1)


def test_in_full_screen_the_heading_and_the_record_button_do_not_move_when_the_heading_changes(page):
    import struct
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-full").click()
    page.wait_for_timeout(300)
    before = page.evaluate("""() => { var h = document.querySelector('.rbt-heading-tile').getBoundingClientRect(), r = document.getElementById('rbt-rec-float').getBoundingClientRect();
      return { hw: h.width, rt: r.top, band: document.querySelector('.rbt-band').getBoundingClientRect().height }; }""")
    # The same packet with a heading of 309.4 degrees, and a longer compass point.
    payload = bytearray(base64.b64decode(EXAMPLE_B64)[6:86])
    struct.pack_into("<i", payload, 52, 30940000)
    body = bytes([0xFF, 0x01]) + struct.pack("<H", len(payload)) + bytes(payload)
    a = b = 0
    for x in body:
        a = (a + x) & 0xFF
        b = (b + a) & 0xFF
    heading = base64.b64encode(bytes([0xB5, 0x62]) + body + bytes([a, b])).decode()
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", heading)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", heading)
    page.wait_for_timeout(300)
    after = page.evaluate("""() => { var h = document.querySelector('.rbt-heading-tile').getBoundingClientRect(), r = document.getElementById('rbt-rec-float').getBoundingClientRect();
      return { hw: h.width, rt: r.top, band: document.querySelector('.rbt-band').getBoundingClientRect().height }; }""")
    assert abs(before["hw"] - after["hw"]) < 0.5
    assert abs(before["rt"] - after["rt"]) < 0.5
    assert abs(after["band"] - 240) < 1


def test_in_full_screen_the_heading_shows_only_the_direction_at_the_speeds_width(page):
    page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-full").click()
    expect(page.locator("#rbt-heading")).to_be_hidden()
    expect(page.locator(".rbt-deg")).to_be_hidden()
    width = page.evaluate("""() => [document.querySelector('.rbt-heading-tile').getBoundingClientRect().width,
                                   document.querySelector('.rbt-speed-float').getBoundingClientRect().width]""")
    assert abs(width[0] - width[1]) < 1, width
