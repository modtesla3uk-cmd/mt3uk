"""My Profile (profile.html): name and nickname, a link to My Garage,
messages from MT3UK and between friends (with Report), friends, email
choices and leaving MT3UK. Also the admin page's Messages to subscribers
panel, and the Profile links in the menu and the bell."""
from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401


def signed_in(page):
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); localStorage.setItem('mt3ukMyBuildsEmail', 'member@example.com')")


def calls(page, path):
    return [c for c in page.mock_state.get("profile_calls", []) if c[1] == path]


@all_devices
def test_signed_out_visitors_are_asked_to_sign_in(device_page):
    page = device_page
    page.goto("/profile.html")
    page.locator("#pf-signed-out").wait_for(state="visible", timeout=5000)
    assert page.locator("#pf-app").is_hidden()
    assert "signin.html?next=/profile.html" in page.locator("#pf-signed-out a").get_attribute("href")
    assert page.errors == []


@all_devices
def test_profile_details_and_nickname(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    assert page.locator("#pf-name").inner_text() == "Test Member"
    assert page.locator("#pf-email").inner_text() == "member@example.com"
    assert "my-builds.html" in page.locator(".pf-garage a.si-btn").get_attribute("href")
    assert overflow_width(page) <= 0

    page.click("#pf-edit")
    page.fill("#pf-nickname", "GreenKnight")
    page.click("#pf-form button[type=submit]")
    page.wait_for_function("document.getElementById('pf-nick').textContent === 'GreenKnight'", timeout=5000)
    assert page.locator("#pf-form").is_hidden()
    assert "Saved" in page.locator("#pf-details-status").inner_text()
    assert page.locator("#pf-friends-need-nick").is_hidden(), "No nickname prompt once one is set"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_messages_from_mt3uk_and_friends(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html#messages")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    page.locator("#pf-broadcasts .pf-bc").first.wait_for(timeout=5000)
    assert "Track day at Thruxton" in page.locator("#pf-broadcasts").inner_text()
    # Opening the page at #messages marks the MT3UK messages read.
    page.wait_for_timeout(500)
    assert calls(page, "/profile/messages/read"), diagnostics(page)

    page.locator(".pf-subtab[data-pane=pf-pane-friends]").click()
    page.locator("#pf-threads .pf-thread-row").first.click()
    page.locator("#pf-thread").wait_for(state="visible", timeout=5000)
    assert "Sharad" in page.locator("#pf-thread-name").inner_text()
    assert "Hi, love the wheels" in page.locator("#pf-bubbles").inner_text()

    page.fill("#pf-compose-text", "See you at Thruxton")
    page.click("#pf-compose button[type=submit]")
    page.locator("#pf-bubbles .pf-bubble.mine").wait_for(timeout=5000)
    assert "See you at Thruxton" in page.locator("#pf-bubbles .pf-bubble.mine").last.inner_text()

    # Their messages can be reported.
    page.once("dialog", lambda d: d.accept("rude"))
    page.locator("#pf-bubbles .pf-report").first.click()
    page.wait_for_function("document.querySelector('#pf-bubbles .pf-report').textContent === 'Reported'", timeout=5000)
    assert page.mock_state.get("reported")
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_friends_requests_search_and_message(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html#friends")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    requests = page.locator("#pf-requests")
    requests.locator("text=RyanK").wait_for(timeout=5000)
    requests.locator("button", has_text="Accept").click()
    page.wait_for_function("document.getElementById('pf-friends').textContent.indexOf('RyanK') !== -1", timeout=5000)
    assert "Sharad" in page.locator("#pf-friends").inner_text()
    assert "gallery.html?only=" in page.locator("#pf-friends a.si-btn").first.get_attribute("href")

    page.fill("#pf-search-q", "sha")
    page.click("#pf-search button[type=submit]")
    page.locator("#pf-results li").first.wait_for(timeout=5000)
    assert "Shaz" in page.locator("#pf-results").inner_text()

    # Message opens the conversation in Messages.
    page.locator("#pf-friends .pf-msg").first.click()
    page.locator("#pf-thread").wait_for(state="visible", timeout=5000)
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_stop_emails_and_leave(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html#unsubscribe")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    assert page.locator("#pf-emails").is_checked()
    page.locator("#pf-emails").uncheck()
    page.wait_for_function("document.getElementById('pf-emails-status').textContent.indexOf('off') !== -1", timeout=5000)

    page.click("#pf-leave-open")
    page.fill("#pf-leave-confirm", "nope")
    page.click("#pf-leave-form button[type=submit]")
    assert "Type LEAVE" in page.locator("#pf-leave-status").inner_text()
    assert not page.mock_state.get("left")
    page.fill("#pf-leave-confirm", "leave")
    page.click("#pf-leave-form button[type=submit]")
    page.locator("#pf-left").wait_for(state="visible", timeout=5000)
    assert page.mock_state.get("left")
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") is None
    assert page.errors == [], diagnostics(page)


@all_devices
def test_menu_account_bar_and_bell_link_to_profile(device_page):
    page = device_page
    signed_in(page)
    page.mock_state["messages_unread"] = 2
    page.goto("/gallery.html")
    assert page.locator('header a[href="profile.html"]').count() == 1, "My Profile is in the menu"
    page.locator('#mt3uk-account-bar a[href="profile.html"]').wait_for(state="attached", timeout=5000)

    page.goto("/index.html")
    page.locator("#nav-bell-count").wait_for(state="visible", timeout=5000)
    page.click("#nav-bell-btn")
    link = page.locator("#nav-bell-panel .nav-bell-messages")
    link.wait_for(timeout=5000)
    assert "2 unread messages" in link.inner_text()
    assert link.get_attribute("href") == "profile.html#messages"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_admin_sends_messages_and_handles_reports(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#members-msg-wrap > summary").click()
    page.locator("#bc-list tbody tr").first.wait_for(timeout=5000)
    assert "Track day at Thruxton" in page.locator("#bc-list").inner_text()
    assert "Rude message" in page.locator("#dm-list").inner_text()

    page.fill("#bc-title", "Meet at Donington")
    page.fill("#bc-text", "Sunday from 10am.")
    page.check("#bc-email")
    page.on("dialog", lambda d: d.accept())
    page.click("#bc-form button[type=submit]")
    page.wait_for_function("document.querySelectorAll('#bc-list tbody tr').length === 2", timeout=5000)
    page.wait_for_function("document.getElementById('bc-note').textContent.indexOf('Emailed 3') !== -1", timeout=5000)

    page.locator("#dm-list button", has_text="Remove and block").click()
    page.wait_for_function("document.getElementById('dm-list').textContent.indexOf('No reported messages') !== -1", timeout=5000)
    assert page.errors == [], diagnostics(page)
