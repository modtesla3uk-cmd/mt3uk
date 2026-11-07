"""racebox-test.html: shows the live readings a RaceBox sends to the Laps app. The Capacitor plugin is stood in for
here, and it sends the example packet from the RaceBox BLE protocol documentation (rev 9)."""
import base64
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


def test_the_racebox_page_shows_the_live_readings_from_the_app(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox-test.html")
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


def test_outside_the_app_the_racebox_page_says_so_and_cannot_connect(page):
    page.goto("/racebox-test.html")
    expect(page.locator("#rbt-status")).to_contain_text("Open this page in the Laps app")
    expect(page.locator("#rbt-connect")).to_be_disabled()


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
    page.goto("/racebox-test.html")
    expect(page.locator("#rbt-status")).to_contain_text("Connected to RaceBox Mini S 2242505877")
    expect(page.locator("#rbt-connect")).to_have_text("Connected")
    expect(page.locator("#rbt-connect")).to_have_attribute("aria-checked", "true")


def test_the_racebox_panel_is_on_profile_inside_the_app_for_approved_members(page):
    page.add_init_script(STUB)
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.route("**/late-darkness-ebc8.modtesla3uk.workers.dev/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true}', headers={"Access-Control-Allow-Origin": "*"}))
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":true}', headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/profile.html")
    expect(page.locator("#lh-racebox")).to_be_visible(timeout=10000)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    expect(page.locator("#rbt-speed")).to_have_text("0")


def test_the_racebox_panel_stays_hidden_on_profile_without_access(page):
    page.add_init_script(STUB)
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.route("**/late-darkness-ebc8.modtesla3uk.workers.dev/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true}', headers={"Access-Control-Allow-Origin": "*"}))
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":false}', headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/profile.html")
    page.wait_for_timeout(800)
    expect(page.locator("#lh-racebox")).to_be_hidden()


def test_the_racebox_panel_stays_hidden_on_the_website(page):
    page.goto("/profile.html")
    page.wait_for_timeout(800)
    expect(page.locator("#lh-racebox")).to_be_hidden()
    assert page.evaluate("typeof window.MT3UKRaceBoxApp") == "undefined"


def test_the_racebox_map_goes_full_screen_with_the_readings_over_it(page):
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.goto("/racebox-test.html")
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
    page.goto("/racebox-test.html")
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
