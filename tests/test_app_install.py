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
    # "I've installed it" is for browsers that can't check for themselves
    # (Safari, Samsung Internet, Firefox).
    page.add_init_script(NO_CHECK)
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
    assert page.evaluate("localStorage.getItem('mt3ukAppInstalled')"), "Remembered (with the time)"
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
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }])")
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
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }])")
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
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }])")
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
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }]); sessionStorage.removeItem('mt3ukIntroSeen')")
    page.goto("/index.html")
    intro = page.locator("#mt3uk-intro")
    intro.wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(600)
    assert page.locator("#mt3uk-open-app").count() == 0, "Not hidden under the intro"
    intro.locator(".ix-look").click()
    page.locator("#mt3uk-open-app").wait_for(state="visible", timeout=8000)


@all_devices
def test_hiding_the_row_keeps_the_open_app_popup(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }]); localStorage.setItem('mt3ukAppOpenHintHidden', '1')")
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
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }])")
    page.goto("/index.html")
    popup = page.locator("#mt3uk-open-app")
    popup.wait_for(state="visible", timeout=5000)
    is_android = page.evaluate("/Android/i.test(navigator.userAgent)")
    assert (popup.locator(".hp-open-app-go").count() == 1) == is_android
    assert page.errors == []


NO_CHECK = "delete Navigator.prototype.getInstalledRelatedApps; delete navigator.getInstalledRelatedApps;"


def now_iso(days_ago=0):
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


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
    page.wait_for_function("!!localStorage.getItem('mt3ukAppReported')", timeout=5000)
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
    # A browser that can't check installed apps itself, like Safari.
    page.add_init_script(NO_CHECK)
    page.goto("/privacy.html")
    page.mock_state["apps"] = {page.evaluate(PLATFORM): now_iso()}
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
    page.add_init_script(NO_CHECK)
    page.goto("/index.html")
    page.locator("#app-install-btn").wait_for(state="visible", timeout=5000)
    assert "Get the MT3UK app" in page.locator("#get-the-app").inner_text()
    assert page.mock_state.get("apps_checks") == 1


@all_devices
def test_edge_is_not_told_to_use_chrome(device_page):
    page = device_page
    page.add_init_script("""
      Object.defineProperty(navigator, 'userAgent', { get: function () { return 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0'; } });
      localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }]);
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
      localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }]);
    """)
    page.goto("/index.html")
    page.locator("#get-the-app").wait_for(state="visible", timeout=5000)
    assert "in Chrome" in page.locator("#get-the-app").inner_text()



ANDROID_UA = "Object.defineProperty(navigator, 'userAgent', { get: function () { return 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0'; } });"


@all_devices
def test_android_no_answer_keeps_a_known_app(device_page):
    """Android browsers can confirm the app is installed, but their "no"
    misses home screen shortcuts and apps added from another browser, so a
    "no" alone doesn't bring back Install the app when the app is known."""
    page = device_page
    sign_in(page)
    page.add_init_script(ANDROID_UA + """
      localStorage.setItem('mt3ukAppInstalled', String(Date.now()));
      navigator.getInstalledRelatedApps = () => Promise.resolve([]);
    """)
    page.goto("/index.html")
    page.wait_for_function("document.getElementById('get-the-app').textContent.indexOf('You have the MT3UK app') !== -1", timeout=5000)
    assert page.locator("#app-install-btn").is_hidden()
    assert page.evaluate("localStorage.getItem('mt3ukAppInstalled')") is not None
    removed = [c for c in page.mock_state.get("profile_calls", []) if c[2].get("appRemoved")]
    assert not removed
    assert page.errors == []


@all_devices
def test_android_notices_the_app_was_deleted(device_page):
    """A deleted app shows up as the browser offering to install it again:
    the row offers Install and the worker is told."""
    page = device_page
    sign_in(page)
    page.add_init_script(ANDROID_UA + """
      localStorage.setItem('mt3ukAppInstalled', '1');
      navigator.getInstalledRelatedApps = () => Promise.resolve([]);
    """)
    page.add_init_script(FAKE_PROMPT)
    page.goto("/index.html")
    page.wait_for_function("document.getElementById('get-the-app').textContent.indexOf('Get the MT3UK app') !== -1 && !document.getElementById('app-install-btn').hidden", timeout=5000)
    assert page.evaluate("localStorage.getItem('mt3ukAppInstalled')") is None
    for _ in range(30):
        removed = [c for c in page.mock_state.get("profile_calls", []) if c[2].get("appRemoved")]
        if removed:
            break
        page.wait_for_timeout(100)
    assert removed and removed[0][2]["appRemoved"] == "android"
    assert page.errors == []


@all_devices
def test_install_offer_returns_when_the_browser_offers_to_install(device_page):
    """Browsers only offer to install when the app isn't installed."""
    page = device_page
    page.add_init_script(NO_CHECK + " localStorage.setItem('mt3ukAppInstalled', String(Date.now()));")
    page.add_init_script(FAKE_PROMPT)
    page.goto("/index.html")
    page.wait_for_function("document.getElementById('get-the-app').textContent.indexOf('Get the MT3UK app') !== -1 && !document.getElementById('app-install-btn').hidden", timeout=5000)
    assert page.evaluate("localStorage.getItem('mt3ukAppInstalled')") is None


@all_devices
def test_iphone_app_only_counts_if_used_in_the_last_month(device_page):
    page = device_page
    page.add_init_script(NO_CHECK + " localStorage.setItem('mt3ukAppInstalled', String(Date.now() - 40 * 864e5));")
    page.goto("/index.html")
    page.locator("#app-install-btn").wait_for(state="visible", timeout=5000)
    assert "Get the MT3UK app" in page.locator("#get-the-app").inner_text()


@all_devices
def test_deleted_the_app_link_offers_install_again(device_page):
    page = device_page
    sign_in(page)
    page.add_init_script(NO_CHECK + " localStorage.setItem('mt3ukAppInstalled', String(Date.now()));")
    page.goto("/index.html")
    box = page.locator("#get-the-app")
    page.wait_for_function("document.getElementById('get-the-app').textContent.indexOf('You have the MT3UK app') !== -1", timeout=5000)
    popup = page.locator("#mt3uk-open-app")
    popup.wait_for(state="visible", timeout=5000)
    popup.locator(".hp-open-app-gone").click()
    assert page.locator("#mt3uk-open-app").count() == 0
    page.locator("#app-install-btn").wait_for(state="visible", timeout=5000)
    assert "Get the MT3UK app" in box.inner_text()
    assert page.locator("#app-reinstall").is_hidden()
    assert page.evaluate("localStorage.getItem('mt3ukAppInstalled')") is None
    assert overflow_width(page) <= 1
    assert page.errors == []


@all_devices
def test_profile_app_card_has_deleted_link(device_page):
    page = device_page
    sign_in(page)
    page.add_init_script(NO_CHECK + " localStorage.setItem('mt3ukAppInstalled', String(Date.now()));")
    page.goto("/profile.html")
    card = page.locator("#app")
    card.wait_for(state="visible", timeout=5000)
    assert "You have the MT3UK app" in card.inner_text()
    card.locator(".app-gone").click()
    assert "Install the app" in page.locator("#pf-app-btn").inner_text()
    assert page.locator("#pf-app-btn").is_visible()
    assert card.locator(".app-gone").is_hidden()
    assert page.errors == []


IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1"


def as_browser(page, ua):
    page.add_init_script(NO_CHECK + " Object.defineProperty(navigator, 'userAgent', { get: function () { return %r; } });" % ua)


@all_devices
def test_iphone_safari_gets_a_drop_down_with_the_web_app_steps(device_page):
    page = device_page
    as_browser(page, IPHONE_SAFARI)
    page.goto("/index.html")
    btn = page.locator("#app-install-btn")
    btn.wait_for(state="visible", timeout=5000)
    assert btn.get_attribute("aria-expanded") == "false"
    btn.click()
    steps = page.locator("#app-install-steps")
    steps.wait_for(state="visible", timeout=5000)
    text = steps.inner_text()
    for words in ("Share", "Add to Home Screen", "Edit Actions", "leave it as MT3UK", "Open as Web App", "Safari toolbar", "Tap Add"):
        assert words in text, words
    assert "Chrome" not in text
    assert btn.get_attribute("aria-expanded") == "true"
    assert overflow_width(page) <= 1
    # Tapping again closes it.
    btn.click()
    assert steps.is_hidden()
    assert btn.get_attribute("aria-expanded") == "false"
    assert page.errors == []


@all_devices
def test_chrome_on_iphone_gets_its_own_steps(device_page):
    page = device_page
    as_browser(page, IPHONE_CHROME)
    page.goto("/index.html")
    page.locator("#app-install-btn").click()
    text = page.locator("#app-install-steps").inner_text()
    assert "(in Chrome)" in text and "Chrome’s address bar" in text
    assert "open mt3uk.com in Safari" in text, "Safari as the fallback"


@all_devices
def test_profile_app_card_has_the_iphone_drop_down(device_page):
    page = device_page
    sign_in(page)
    as_browser(page, IPHONE_SAFARI)
    page.goto("/profile.html")
    btn = page.locator("#pf-app-btn")
    btn.wait_for(state="visible", timeout=5000)
    btn.click()
    steps = page.locator("#app .app-steps")
    steps.wait_for(state="visible", timeout=5000)
    assert "Add to Home Screen" in steps.inner_text() and "Open as Web App" in steps.inner_text()
    btn.click()
    assert steps.is_hidden()
    assert page.errors == []


@all_devices
def test_add_to_home_screen_banner_stays_away_once_installed(device_page):
    """The Add to Home Screen banner (after a couple of visits) isn't shown
    once the app is known to be installed, on any page."""
    page = device_page
    page.add_init_script(NO_CHECK + " localStorage.setItem('mt3ukVisitCount', '5'); localStorage.setItem('mt3ukAppInstalled', String(Date.now()));")
    page.add_init_script(FAKE_PROMPT)
    for path in ("/signin.html", "/profile.html", "/contact.html", "/privacy.html"):
        page.goto(path)
        page.wait_for_timeout(600)
        assert page.locator(".a2hs-banner").count() == 0, path
    assert page.errors == []
