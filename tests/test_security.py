"""Sign-ins last 30 days from last use (js/account-bar.js renews them once
a day), and Profile > Security can sign a member out of all devices."""
from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401


def signed_in(page):
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); localStorage.setItem('mt3ukMyBuildsEmail', 'member@example.com')")


@all_devices
def test_sign_in_is_renewed_once_a_day(device_page):
    page = device_page
    signed_in(page)
    page.mock_state["renewed_session"] = "s2.renewed"
    page.goto("/gallery.html")
    page.wait_for_function("localStorage.getItem('mt3ukMyBuildsSession') === 's2.renewed'", timeout=5000)
    assert page.mock_state["session_refreshes"] == 1
    page.goto("/index.html")
    page.wait_for_timeout(800)
    assert page.mock_state["session_refreshes"] == 1, "Only once a day"
    assert page.errors == []


@all_devices
def test_run_out_sign_in_is_forgotten(device_page):
    page = device_page
    page.add_init_script("if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('mt3ukMyBuildsSession', 's2.old'); }")
    page.mock_state["session_expired"] = True
    page.goto("/gallery.html")
    page.wait_for_function("localStorage.getItem('mt3ukMyBuildsSession') === null", timeout=5000)


@all_devices
def test_sign_out_of_all_devices(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html#security")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    card = page.locator("#security")
    assert "Passkeys" in card.inner_text() and "30 days" in card.inner_text()
    assert overflow_width(page) <= 0
    dialogs = []
    page.once("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    page.click("#pf-signout-all")
    page.locator("#pf-signed-out").wait_for(state="visible", timeout=5000)
    assert "including here" in dialogs[0]
    assert page.mock_state.get("signed_out_all")
    assert "signed out on all your devices" in page.locator("#pf-signed-out-text").inner_text()
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") is None
    assert page.errors == [], diagnostics(page)


@all_devices
def test_cancel_keeps_you_signed_in(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html#security")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    page.once("dialog", lambda d: d.dismiss())
    page.click("#pf-signout-all")
    page.wait_for_timeout(300)
    assert not page.mock_state.get("signed_out_all")
    assert page.locator("#pf-app").is_visible()
