"""Inside the Laps Android app (Capacitor): passkey sign-in opens the sign-in page in a Chrome Custom Tab, where passkeys
work, and verified Laps links are loaded in the app. A simulated Capacitor bridge stands in for the app here."""
from playwright.sync_api import expect

BRIDGE = """
window.__calls = [];
window.Capacitor = {
  isNativePlatform: function () { return true; },
  Plugins: {
    Browser: { open: function (o) { window.__calls.push(['browser', o.url]); return Promise.resolve(); } },
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
