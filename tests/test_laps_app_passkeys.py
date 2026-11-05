"""Inside the Laps Android app (Capacitor): passkey sign-in opens the sign-in page in a Chrome Custom Tab, where passkeys
work, and verified Laps links are loaded in the app. A simulated Capacitor bridge stands in for the app here."""
from playwright.sync_api import expect

BRIDGE = """
window.__calls = [];
window.Capacitor = {
  isNativePlatform: function () { return true; },
  Plugins: {
    Browser: { open: function (o) { window.__calls.push(['browser', o.url]); return Promise.resolve(); }, close: function () { fetch('/__passkey_window_closed').catch(function () {}); return Promise.resolve(); } },
    App: { addListener: function (ev, fn) { window.__calls.push(['listen', ev]); window.__appUrl = fn; } }
  }
};
"""


def test_the_passkey_button_opens_the_custom_tab_inside_the_app(page):
    page.add_init_script(BRIDGE)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("/laps-signin.html")
    expect(page.locator("#si-passkey")).to_be_visible()
    page.locator("#si-passkey-btn").click()
    calls = page.evaluate("window.__calls")
    assert ["browser", "https://laps.mt3uk.com/laps-signin.html?app=1"] in calls, calls
    assert ["listen", "appUrlOpen"] in calls, calls
    assert errors == [], errors


def test_the_custom_tab_sign_in_page_loads_without_errors(page):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("/laps-signin.html?app=1")
    page.wait_for_timeout(500)
    assert errors == [], errors


def test_the_passkey_button_says_what_it_is_doing_on_screen(page):
    page.add_init_script(BRIDGE)
    page.goto("/laps-signin.html")
    expect(page.locator("#si-passkey")).to_be_visible()
    page.locator("#si-passkey-btn").click()
    expect(page.locator("#si-passkey-status")).to_contain_text("Finish signing in in the window that opens")


def test_an_older_app_without_the_browser_plugin_is_told_to_update(page):
    page.add_init_script(
        "window.Capacitor = { isNativePlatform: function () { return true; }, Plugins: {} };")
    page.goto("/laps-signin.html")
    expect(page.locator("#si-passkey")).to_be_visible()
    page.locator("#si-passkey-btn").click()
    expect(page.locator("#si-passkey-status")).to_contain_text("needs an updated Laps app")


def test_a_returning_link_closes_the_passkey_window_and_opens_the_app_page(page):
    page.add_init_script(BRIDGE)
    closed = []
    page.route("**/__passkey_window_closed", lambda route: (closed.append(1), route.fulfill(status=200, body="")))
    page.goto("/laps-signin.html")
    page.evaluate("window.__appUrl({ url: 'https://laps.mt3uk.com/laps.html#mt3uk-handover=abc' })")
    page.wait_for_timeout(800)
    assert closed, "the passkey window was not closed"


def test_a_member_already_signed_in_from_the_app_gets_the_return_step(page):
    page.add_init_script(BRIDGE)
    page.add_init_script("try { localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); } catch (e) {}")
    page.goto("/laps-signin.html?app=1")
    expect(page.locator("#si-app-return")).to_be_visible()


def test_a_return_with_its_code_in_the_path_is_put_in_the_page_hash_and_closes_the_window(page):
    page.add_init_script(BRIDGE)
    closed = []
    page.route("**/__passkey_window_closed", lambda route: (closed.append(1), route.fulfill(status=200, body="")))
    code = "a" * 64
    page.goto("/laps-signin.html")
    page.evaluate("window.__appUrl({ url: 'https://laps.mt3uk.com/laps.html?mt3uk-handover=" + code + "' })")
    page.wait_for_timeout(800)
    assert closed, "the passkey window was not closed"
    assert ("#mt3uk-handover=" + code) in page.url, page.url
