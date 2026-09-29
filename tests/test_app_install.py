"""Get the MT3UK app: a row under the Explore MT3UK tiles. It installs
straight away where the browser offers it, shows the steps for the
browser otherwise, and stays hidden once MT3UK is installed."""
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
    assert page.locator("#get-the-app").is_hidden()
    page.reload()
    page.wait_for_timeout(500)
    assert page.locator("#get-the-app").is_hidden(), "Stays hidden once installed"
    assert page.errors == []


@all_devices
def test_install_uses_the_browser_prompt_and_then_hides(device_page):
    page = device_page
    page.add_init_script(FAKE_PROMPT)
    page.goto("/index.html")
    page.wait_for_timeout(400)
    page.locator("#app-install-btn").click()
    page.wait_for_function("window.__prompted === true", timeout=5000)
    page.locator("#get-the-app").wait_for(state="hidden", timeout=5000)
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
def test_install_row_hidden_when_already_installed(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1')")
    page.goto("/index.html")
    page.wait_for_timeout(500)
    assert page.locator("#get-the-app").is_hidden()
