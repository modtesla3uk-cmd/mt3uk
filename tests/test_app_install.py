"""Get the MT3UK app: a row under the Explore MT3UK tiles. It installs
straight away where the browser offers it, shows the steps for the
browser otherwise, and once MT3UK is installed asks them to open the app
from its icon (hidden in the app itself, or after Hide)."""
from test_devices import device_page, browsers, all_devices, overflow_width  # noqa: F401

FAKE_PROMPT = """
window.addEventListener('load', function () {
  setTimeout(function () {
    var e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = function () { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  }, 50);
});
"""


@all_devices
def test_install_row_sits_under_the_tiles(device_page):
    page = device_page
    page.goto("/index.html")
    box = page.locator(".categories-section #get-the-app")
    box.wait_for(state="visible", timeout=5000)
    after_grid = page.evaluate("document.querySelector('.categories-grid.hp-cats').compareDocumentPosition(document.getElementById('get-the-app')) & Node.DOCUMENT_POSITION_FOLLOWING")
    assert after_grid, "Below the tiles"
    assert overflow_width(page) <= 1
    assert page.errors == []


@all_devices
def test_install_shows_steps_and_can_be_hidden(device_page):
    page = device_page
    page.goto("/index.html")
    page.locator("#app-install-btn").click()
    steps = page.locator("#app-install-steps")
    steps.wait_for(state="visible", timeout=5000)
    assert steps.locator("ol li").count() >= 1
    steps.locator(".hp-app-done").click()
    # Installed: now it says to open the app from its icon.
    assert "You have the MT3UK app" in page.locator("#get-the-app").inner_text()
    assert page.locator("#app-install-btn").is_hidden()
    page.reload()
    page.locator("#get-the-app").wait_for(state="visible", timeout=5000)
    assert "Open MT3UK" in page.locator("#app-install-text").inner_text()
    page.click("#app-open-hide")
    assert page.locator("#get-the-app").is_hidden()
    page.reload()
    page.wait_for_timeout(500)
    assert page.locator("#get-the-app").is_hidden(), "Hide is remembered"
    assert page.errors == []


@all_devices
def test_install_uses_the_browser_prompt_and_then_hides(device_page):
    page = device_page
    page.add_init_script(FAKE_PROMPT)
    page.goto("/index.html")
    page.wait_for_timeout(400)
    page.locator("#app-install-btn").click()
    page.wait_for_function("window.__prompted === true", timeout=5000)
    page.wait_for_function("document.getElementById('get-the-app').textContent.indexOf('You have the MT3UK app') !== -1", timeout=5000)
    assert page.evaluate("localStorage.getItem('mt3ukAppInstalled')") == "1"
    assert page.errors == []


@all_devices
def test_facebook_browser_is_told_to_open_in_a_real_browser(device_page):
    page = device_page
    page.add_init_script("Object.defineProperty(navigator, 'userAgent', { get: function () { return 'Mozilla/5.0 (iPhone) Mobile [FBAN/FBIOS;FBAV/450.0]'; } });")
    page.goto("/index.html")
    page.locator("#app-install-btn").click()
    steps = page.locator("#app-install-steps")
    steps.wait_for(state="visible", timeout=5000)
    assert "Open in browser" in steps.inner_text()
    assert page.errors == []


@all_devices
def test_already_installed_asks_them_to_open_the_app(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1')")
    page.goto("/index.html")
    box = page.locator("#get-the-app")
    box.wait_for(state="visible", timeout=5000)
    assert "You have the MT3UK app" in box.inner_text()
    assert page.locator("#app-install-btn").is_hidden()
    assert overflow_width(page) <= 1


@all_devices
def test_install_row_hidden_inside_the_app(device_page):
    page = device_page
    page.add_init_script("Object.defineProperty(navigator, 'standalone', { get: function () { return true; } });")
    page.goto("/index.html")
    page.wait_for_timeout(500)
    assert page.locator("#get-the-app").is_hidden()


@all_devices
def test_install_row_mentions_already_installed(device_page):
    page = device_page
    page.goto("/index.html")
    page.locator("#get-the-app").wait_for(state="visible", timeout=5000)
    assert "Already installed?" in page.locator("#app-install-already").inner_text()


@all_devices
def test_installed_members_get_an_open_the_app_popup(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1')")
    page.goto("/index.html")
    popup = page.locator("#mt3uk-open-app")
    popup.wait_for(state="visible", timeout=5000)
    assert "Open the MT3UK app" in popup.inner_text()
    assert overflow_width(page) <= 1
    popup.locator(".hp-open-app-ok").click()
    assert page.locator("#mt3uk-open-app").count() == 0
    # Once per browser session.
    page.reload()
    page.wait_for_timeout(500)
    assert page.locator("#mt3uk-open-app").count() == 0
    assert page.errors == []


@all_devices
def test_open_the_app_popup_can_be_turned_off(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1')")
    page.goto("/index.html")
    page.locator("#mt3uk-open-app .hp-open-app-off").click()
    page.reload()
    page.wait_for_timeout(500)
    assert page.locator("#mt3uk-open-app").count() == 0, "Don't show again is remembered"


@all_devices
def test_no_open_the_app_popup_when_not_installed(device_page):
    page = device_page
    page.goto("/index.html")
    page.locator("#get-the-app").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(300)
    assert page.locator("#mt3uk-open-app").count() == 0


@all_devices
def test_open_the_app_popup_waits_for_the_intro(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); sessionStorage.removeItem('mt3ukIntroSeen')")
    page.goto("/index.html")
    intro = page.locator("#mt3uk-intro")
    intro.wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(600)
    assert page.locator("#mt3uk-open-app").count() == 0, "Not hidden under the intro"
    intro.click()
    page.locator("#mt3uk-open-app").wait_for(state="visible", timeout=8000)


@all_devices
def test_hiding_the_row_keeps_the_open_app_popup(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); localStorage.setItem('mt3ukAppOpenHintHidden', '1')")
    page.goto("/index.html")
    page.locator("#mt3uk-open-app").wait_for(state="visible", timeout=5000)
    assert page.locator("#get-the-app").is_hidden()


@all_devices
def test_appcheck_shows_what_the_browser_reports(device_page):
    page = device_page
    page.goto("/index.html?appcheck=1")
    report = page.locator("#mt3uk-appcheck")
    report.wait_for(state="visible", timeout=5000)
    text = report.inner_text()
    assert "Running as the app: no" in text and "Marked installed here: no" in text
    assert page.errors == []


@all_devices
def test_android_popup_has_open_the_app_button(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1')")
    page.goto("/index.html")
    popup = page.locator("#mt3uk-open-app")
    popup.wait_for(state="visible", timeout=5000)
    is_android = page.evaluate("/Android/i.test(navigator.userAgent)")
    assert (popup.locator(".hp-open-app-go").count() == 1) == is_android
    assert page.errors == []


PLATFORM = "/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop'"


def sign_in(page):
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")


@all_devices
def test_app_reports_itself_so_the_browser_stops_offering_it(device_page):
    """Safari can't see apps on the phone, so the installed app tells the
    worker, and the website in the browser then says they have it."""
    page = device_page
    sign_in(page)
    page.add_init_script("Object.defineProperty(navigator, 'standalone', { get: function () { return true; } });")
    page.goto("/gallery.html")
    page.wait_for_function("localStorage.getItem('mt3ukAppReported') === '1'", timeout=5000)
    platform = page.evaluate(PLATFORM)
    assert platform in page.mock_state.get("apps", {})
    # Only once per device.
    page.reload()
    page.wait_for_timeout(800)
    assert len([c for c in page.mock_state.get("profile_calls", []) if c[1] == "/profile" and c[0] == "POST"]) <= 1
    assert page.errors == []


@all_devices
def test_browser_says_you_have_the_app_when_the_app_reported_it(device_page):
    page = device_page
    sign_in(page)
    page.goto("/privacy.html")
    page.mock_state["apps"] = {page.evaluate(PLATFORM): "2026-09-29T12:00:00Z"}
    page.goto("/index.html")
    box = page.locator("#get-the-app")
    page.wait_for_function("document.getElementById('get-the-app').textContent.indexOf('You have the MT3UK app') !== -1 && !document.getElementById('get-the-app').hidden", timeout=5000)
    assert page.locator("#app-install-btn").is_hidden(), "No install button"
    assert page.mock_state.get("apps_checks") == 1
    # Asked once per visit.
    page.reload()
    box.wait_for(state="visible", timeout=5000)
    assert page.mock_state.get("apps_checks") == 1
    assert page.errors == []


@all_devices
def test_browser_still_offers_install_when_not_reported(device_page):
    page = device_page
    sign_in(page)
    page.goto("/index.html")
    page.locator("#app-install-btn").wait_for(state="visible", timeout=5000)
    assert "Get the MT3UK app" in page.locator("#get-the-app").inner_text()
    assert page.mock_state.get("apps_checks") == 1


@all_devices
def test_edge_is_not_told_to_use_chrome(device_page):
    page = device_page
    page.add_init_script("""
      Object.defineProperty(navigator, 'userAgent', { get: function () { return 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0'; } });
      localStorage.setItem('mt3ukAppInstalled', '1');
    """)
    page.goto("/index.html")
    popup = page.locator("#mt3uk-open-app")
    popup.wait_for(state="visible", timeout=5000)
    assert "Chrome" not in popup.inner_text()
    assert "Chrome" not in page.locator("#get-the-app").inner_text()
    assert popup.locator(".hp-open-app-go").count() == 1


@all_devices
def test_chrome_on_android_gets_the_chrome_tip(device_page):
    page = device_page
    page.add_init_script("""
      Object.defineProperty(navigator, 'userAgent', { get: function () { return 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'; } });
      localStorage.setItem('mt3ukAppInstalled', '1');
    """)
    page.goto("/index.html")
    page.locator("#get-the-app").wait_for(state="visible", timeout=5000)
    assert "in Chrome" in page.locator("#get-the-app").inner_text()
