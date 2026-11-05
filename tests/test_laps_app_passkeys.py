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
    assert ["browser", "https://laps.mt3uk.com/laps-signin.html?app=1&fresh=1"] in calls, calls
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


def test_the_set_up_window_offers_to_add_a_passkey_before_going_back(page):
    page.add_init_script("try { localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); } catch (e) {}")
    page.goto("/laps-signin.html?app=1&setup=1")
    expect(page.locator("#si-app-setup")).to_be_visible()
    expect(page.locator("#si-app-return-wrap")).to_be_hidden()


def test_a_passkey_sign_in_from_the_app_starts_signed_out_so_the_passkey_is_asked_for(page):
    page.add_init_script(BRIDGE)
    page.add_init_script("try { localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); } catch (e) {}")
    page.goto("/laps-signin.html?app=1&fresh=1")
    page.wait_for_timeout(300)
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") is None
    expect(page.locator("#si-passkey-btn")).to_be_visible()


def test_a_passkey_sign_in_from_the_app_goes_straight_to_the_passkey_prompt(page):
    page.add_init_script("document.addEventListener('click', function (e) { if (e.target && e.target.id === 'si-passkey-btn') window.__passkeyClicked = true; }, true);")
    # A phone can run passkeys; a stub stands in so the page offers the button (the prompt itself is not run here).
    page.add_init_script("window.PublicKeyCredential = function () {}; Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: function () { return new Promise(function () {}); }, get: function () { return new Promise(function () {}); } } });")
    page.goto("/laps-signin.html?app=1&fresh=1")
    # The Laps sign-in page waits up to 3 seconds for its settings before it starts.
    page.wait_for_function("window.__passkeyClicked === true", timeout=6000)


PUSH_BRIDGE = """
window.__pn = {};
window.Capacitor = {
  isNativePlatform: function () { return true; },
  Plugins: {
    App: { addListener: function () {} },
    PushNotifications: {
      addListener: function (ev, fn) { window.__pn[ev] = fn; },
      requestPermissions: function () { return Promise.resolve({ receive: 'granted' }); },
      register: function () { return Promise.resolve(); }
    }
  }
};
"""


def test_the_app_sends_its_firebase_token_to_the_site_when_signed_in(page):
    page.add_init_script(PUSH_BRIDGE)
    page.add_init_script("try { localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); } catch (e) {}")
    sent = []
    page.route("**/push/fcm", lambda route: (sent.append(route.request.post_data), route.fulfill(status=200, body='{"success":true}', content_type="application/json")))
    page.goto("/laps-signin.html")
    page.wait_for_function("typeof window.__pn.registration === 'function'")
    page.evaluate("window.__pn.registration({ value: 'f' + 'a'.repeat(160) })")
    page.wait_for_timeout(500)
    assert sent and ("fa" + "a" * 10) in sent[0], sent


SHORTCUT_BRIDGE = """
window.__pinned = 0;
window.Capacitor = {
  isNativePlatform: function () { return true; },
  Plugins: {
    App: { addListener: function () {} },
    LapsShortcut: { pin: function () { window.__pinned++; return Promise.resolve({ asked: true }); } }
  }
};
"""


def test_inside_the_app_the_intro_page_offers_a_home_screen_icon(page):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SHORTCUT_BRIDGE)
    page.goto("/laps.html")
    expect(page.locator("#lh-home")).to_be_visible()
    page.locator("#lh-home-btn").click()
    expect(page.locator("#lh-home-status")).to_contain_text("Confirm on your phone")
    assert page.evaluate("window.__pinned") == 1


def test_in_a_browser_the_intro_page_has_no_home_screen_card(page):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/laps.html")
    expect(page.locator("#lh-start")).to_be_visible()
    assert page.locator("#lh-home").is_hidden()
