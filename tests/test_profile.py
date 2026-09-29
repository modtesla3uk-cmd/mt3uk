"""My Profile (profile.html): name and nickname, a link to My Garage,
messages from MT3UK and between friends (with Report), friends, email
choices and leaving MT3UK. Also the admin page's Messages to subscribers
panel, and the Profile links in the menu and the bell."""
import re

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
    for _ in range(50):
        if calls(page, "/profile/messages/read"):
            break
        page.wait_for_timeout(100)
    assert calls(page, "/profile/messages/read"), diagnostics(page)

    # Arriving at #messages opens the sections with something new, each
    # marked "1 new".
    assert page.locator("#pf-fold-mt3uk").get_attribute("open") is not None
    page.wait_for_function("document.getElementById('pf-fold-friends').open", timeout=5000)
    assert page.locator("#pf-badge-direct").inner_text() == "1 new"
    page.locator("#pf-threads .pf-thread-row").first.click()
    page.locator("#pf-thread").wait_for(state="visible", timeout=5000)
    page.wait_for_function("document.getElementById('pf-thread-name').textContent.indexOf('Sharad') !== -1", timeout=5000)
    # The name shows straight away; the messages follow once loaded.
    page.wait_for_function("document.getElementById('pf-bubbles').textContent.indexOf('Hi, love the wheels') !== -1", timeout=5000)

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
    items = page.locator("#bc-list .bc-item")
    items.first.wait_for(timeout=5000)
    assert "Track day at Thruxton" in page.locator("#bc-list").inner_text()
    assert "emailed to 1" in items.first.inner_text()
    assert items.first.locator(".bc-body").is_hidden(), "Messages are collapsed"
    assert "Rude message" in page.locator("#dm-list").inner_text()

    page.fill("#bc-title", "Meet at Donington")
    page.fill("#bc-text", "Sunday from 10am.")
    page.check("#bc-email")
    page.on("dialog", lambda d: d.accept())
    page.click("#bc-form button[type=submit]")
    page.wait_for_function("document.querySelectorAll('#bc-list .bc-item').length === 2", timeout=5000)
    page.wait_for_function("document.getElementById('bc-note').textContent.indexOf('Emailed 3') !== -1", timeout=5000)

    # Open an older message and email it to one member; sending it to
    # someone who already has it asks first.
    old = page.locator("#bc-list .bc-item", has_text="Track day at Thruxton")
    old.locator("summary").first.click()
    one = old.locator(".bc-one")
    one.locator("input").fill("sam@example.com")
    one.locator("button").click()
    page.wait_for_function("document.querySelector('#bc-list .bc-item:last-child .bc-one-note').textContent.indexOf('Emailed to sam') !== -1", timeout=5000)
    assert "emailed to 2" in old.inner_text(), "The count updates and the message stays open"
    one.locator("input").fill("dave@example.com")
    one.locator("button").click()
    page.wait_for_function("(window._s = document.querySelector('#bc-list .bc-item:last-child .bc-one-note').textContent).indexOf('Emailed to dave') !== -1", timeout=5000)
    assert page.mock_state["emailed_one"][-1] == ("b1", "dave@example.com", True), "Re-sent only after confirming"
    assert overflow_width(page) <= 0

    page.locator("#dm-list button", has_text="Remove and block").click()
    page.wait_for_function("document.getElementById('dm-list').textContent.indexOf('No reported messages') !== -1", timeout=5000)
    assert page.errors == [], diagnostics(page)


@all_devices
def test_person_icon_next_to_bell_goes_to_profile(device_page):
    page = device_page
    page.goto("/index.html")
    icon = page.locator("#nav-profile")
    icon.wait_for(state="visible", timeout=5000)
    assert "signin.html?next=" in icon.get_attribute("href"), "Signed out: sign in first"
    # It sits next to the bell, before search.
    order = page.evaluate("[...document.querySelector('#nav-search').parentNode.children].map(e => e.id).filter(Boolean)")
    assert order.index("nav-bell") < order.index("nav-profile") < order.index("nav-search"), order
    assert overflow_width(page) <= 0

    signed_in(page)
    page.goto("/index.html")
    page.locator("#nav-profile").wait_for(state="visible", timeout=5000)
    assert page.locator("#nav-profile").get_attribute("href") == "profile.html"
    assert page.errors == []


@all_devices
def test_new_members_are_asked_for_a_nickname(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script("if (!sessionStorage.getItem('asked')) { localStorage.setItem('mt3ukAskNickname', '1'); sessionStorage.setItem('asked', '1'); }")
    page.goto("/gallery.html")
    prompt = page.locator("#mt3uk-nick-prompt")
    prompt.wait_for(state="visible", timeout=5000)
    page.fill("#mt3uk-nick-input", "x")
    page.click("#mt3uk-nick-prompt button[type=submit]")
    assert "3 to 20" in page.locator("#mt3uk-nick-prompt .mt3uk-nick-msg").inner_text()
    page.fill("#mt3uk-nick-input", "GreenKnight")
    page.click("#mt3uk-nick-prompt button[type=submit]")
    prompt.wait_for(state="detached", timeout=5000)
    assert page.mock_state["profile"]["nickname"] == "GreenKnight"
    assert page.evaluate("localStorage.getItem('mt3ukAskNickname')") is None
    page.reload()
    page.wait_for_timeout(500)
    assert page.locator("#mt3uk-nick-prompt").count() == 0, "Only asked once"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_nickname_prompt_can_wait_until_later(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script("if (!sessionStorage.getItem('asked')) { localStorage.setItem('mt3ukAskNickname', '1'); sessionStorage.setItem('asked', '1'); }")
    page.goto("/index.html")
    page.locator("#mt3uk-nick-prompt").wait_for(state="visible", timeout=5000)
    page.click(".mt3uk-nick-later")
    assert page.locator("#mt3uk-nick-prompt").count() == 0
    assert page.evaluate("localStorage.getItem('mt3ukAskNickname')") is None
    assert page.errors == []


@all_devices
def test_joining_with_a_code_asks_for_a_nickname(device_page):
    page = device_page
    page.goto("/signin.html")
    page.fill("#si-join-first", "Test")
    page.fill("#si-join-last", "Member")
    page.fill("#si-join-email", "member@example.com")
    page.click("#si-join-btn")
    page.locator("#si-code-form").wait_for(state="visible", timeout=5000)
    # The mock accepts the second code, whatever the browser sends.
    for code in ("000000", "123456"):
        page.fill("#si-code", code)
        page.click("#si-code-btn")
        page.wait_for_timeout(400)
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    page.locator("#mt3uk-nick-prompt").wait_for(state="visible", timeout=5000)
    assert page.errors == [], diagnostics(page)


@all_devices
def test_my_garage_shows_loading_not_the_sign_in_form(device_page):
    page = device_page
    signed_in(page)
    # First load fails (offline): still no email box, just Try again.
    page.mock_state["garage_offline"] = True
    page.goto("/my-builds.html")
    page.locator("#mb-loading-retry").wait_for(state="visible", timeout=5000)
    assert page.locator("#mb-loading-view").is_visible()
    assert page.locator("#mb-signin-view").is_hidden(), "Signed in: never the email box"
    page.mock_state["garage_offline"] = False
    page.click("#mb-loading-retry")
    page.locator("#mb-app-view").wait_for(state="visible", timeout=5000)
    assert page.locator("#mb-loading-view").is_hidden()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_my_garage_signed_out_goes_straight_to_sign_in(device_page):
    page = device_page
    page.goto("/my-builds.html")
    page.locator("#mb-signin-view").wait_for(state="visible", timeout=5000)
    assert page.locator("#mb-loading-view").is_hidden()


@all_devices
def test_profile_asks_for_a_nickname_first(device_page):
    """Friends find each other by nickname, so Profile needs one."""
    page = device_page
    signed_in(page)
    page.mock_state["start_nickname"] = ""
    page.goto("/profile.html")
    gate = page.locator("#pf-nick-gate")
    gate.wait_for(state="visible", timeout=5000)
    assert page.locator("#pf-app").is_hidden(), "The rest of Profile waits for a nickname"
    page.fill("#pf-gate-nick", "a")
    page.click("#pf-nick-gate button[type=submit]")
    assert "3 to 20" in page.locator("#pf-gate-status").inner_text()
    page.fill("#pf-gate-nick", "GreenKnight")
    page.click("#pf-nick-gate button[type=submit]")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    assert gate.is_hidden()
    assert page.locator("#pf-nick").inner_text() == "GreenKnight"
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_nickname_cannot_be_cleared(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    page.click("#pf-edit")
    page.fill("#pf-nickname", "")
    page.click("#pf-form button[type=submit]")
    assert "nickname" in page.locator("#pf-details-status").inner_text().lower()
    assert page.locator("#pf-form").is_visible()


@all_devices
def test_admin_can_draft_and_publish_interviews_now(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    table = page.locator("#iv-list")
    table.locator("tbody tr").first.wait_for(timeout=5000)
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    page.locator("#iv-list .iv-act[data-action=draft]").first.click()
    page.locator("#iv-drafts tbody tr").first.wait_for(timeout=5000)
    assert "freed up" in dialogs[-1]
    assert page.mock_state["interview_actions"][-1][0] == "draft"
    # The draft can be published now, with an are-you-sure.
    page.locator("#iv-drafts .iv-act[data-action=publish-now]").first.click()
    page.wait_for_function("!document.querySelector('#iv-drafts tbody tr')", timeout=5000)
    assert "Publish" in dialogs[-1] and "now" in dialogs[-1]
    assert page.mock_state["interview_actions"][-1][0] == "publish-now"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_admin_shows_how_long_each_interview_was_current(device_page):
    page = device_page
    import json as _json
    from pathlib import Path as _Path
    data = _json.loads((_Path(__file__).resolve().parent.parent / "data" / "interviews.json").read_text(encoding="utf-8"))
    data["interviews"][0]["publish"] = "2026-09-01"
    data["interviews"][1]["publish"] = "2026-09-15"
    page.route(re.compile(r".*/data/interviews\.json.*"), lambda route: route.fulfill(
        status=200, body=_json.dumps(data), headers={"Content-Type": "application/json"}))
    page.goto("/admin.html")
    page.locator("#iv-list .iv-current").first.wait_for(timeout=5000)
    text = page.locator("#iv-list").inner_text()
    assert "Was current for 14 days" in text
    assert "Current for 14 days" in text


@all_devices
def test_messages_and_friends_are_collapsed_with_new_badges(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    page.wait_for_function("!document.getElementById('pf-badge-direct').hidden", timeout=5000)
    for fold in ("#pf-fold-mt3uk", "#pf-fold-friends", "#pf-fold-friendlist"):
        assert page.locator(fold).get_attribute("open") is None, fold + " starts collapsed"
    assert page.locator("#pf-badge-mt3uk").inner_text() == "1 new"
    assert page.locator("#pf-badge-direct").inner_text() == "1 new"
    # The friend with an unread message is flagged, in the list and on it.
    assert page.locator("#pf-badge-friendmsgs").inner_text() == "1 new"
    page.locator("#pf-fold-friendlist > summary").click()
    assert "1 new" in page.locator("#pf-friends li", has_text="Sharad").inner_text()
    # Opening From MT3UK marks those messages read.
    assert not calls(page, "/profile/messages/read")
    page.locator("#pf-fold-mt3uk > summary").click()
    page.wait_for_function("document.getElementById('pf-badge-mt3uk').hidden", timeout=5000)
    assert calls(page, "/profile/messages/read")
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_nickname_boxes_say_if_a_nickname_is_free(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    page.click("#pf-edit")
    check = page.locator("#pf-nick-check")
    page.fill("#pf-nickname", "Sparky")
    page.wait_for_function("document.getElementById('pf-nick-check').textContent.indexOf('taken') !== -1", timeout=5000)
    assert check.get_attribute("data-available") == "no"
    page.fill("#pf-nickname", "Zed99")
    page.wait_for_function("document.getElementById('pf-nick-check').textContent.indexOf('available') !== -1", timeout=5000)
    assert check.get_attribute("data-available") == "yes"
    page.fill("#pf-nickname", "x")
    page.wait_for_function("document.getElementById('pf-nick-check').textContent.indexOf('3 to 20') !== -1", timeout=5000)
    assert overflow_width(page) <= 0

    # The welcome prompt on other pages checks too.
    page.add_init_script("if (!sessionStorage.getItem('asked')) { localStorage.setItem('mt3ukAskNickname', '1'); sessionStorage.setItem('asked', '1'); }")
    page.goto("/gallery.html")
    page.locator("#mt3uk-nick-prompt").wait_for(state="visible", timeout=5000)
    page.fill("#mt3uk-nick-input", "sparky")
    page.wait_for_function("document.querySelector('#mt3uk-nick-prompt .mt3uk-nick-msg').textContent.indexOf('taken') !== -1", timeout=5000)
    assert page.errors == [], diagnostics(page)


@all_devices
def test_visibility_choices_save(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html#visibility")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    assert page.locator("#pf-show-nick").is_checked()
    assert "(TestMember)" in page.locator("#visibility").inner_text()
    assert "(Test Member)" in page.locator("#visibility").inner_text()
    assert page.locator("#pf-findable").is_checked()

    page.mock_state["fallback_body"] = {"showName": "name"}
    page.locator("#pf-show-name").check()
    page.wait_for_function("document.getElementById('pf-vis-status').textContent.indexOf('full name') !== -1", timeout=5000)
    assert page.mock_state["profile"]["showName"] == "name"

    page.mock_state["fallback_body"] = {"hideRealName": True}
    page.locator("#pf-findable").uncheck()
    page.wait_for_function("document.getElementById('pf-vis-status').textContent === 'Saved.'", timeout=5000)
    assert page.mock_state["profile"]["hideRealName"] is True
    page.reload()
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    assert page.locator("#pf-show-name").is_checked()
    assert not page.locator("#pf-findable").is_checked()
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_friend_search_mentions_names(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html#friends")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    assert page.locator("#pf-search-q").get_attribute("placeholder") == "Find members by nickname or name"
    page.fill("#pf-search-q", "d")
    page.click("#pf-search button[type=submit]")
    assert "nickname or name" in page.locator("#pf-results").inner_text()


@all_devices
def test_profile_has_notifications_app_email_alerts_and_unsubscribe(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    # Phone notifications sit under Visibility.
    assert page.locator("#visibility #notifications h3").inner_text() == "Phone notifications"
    # Every test browser either offers the toggle or says why it can't.
    page.wait_for_function("!document.getElementById('pf-push-toggle').hidden || document.querySelector('#notifications .push-intro').textContent.indexOf('Alerts on this device') === -1", timeout=5000)
    app = page.locator("#app")
    app.wait_for(state="visible", timeout=5000)
    page.click("#pf-app-btn")
    page.locator("#app .app-steps").wait_for(state="visible", timeout=5000)
    assert "Profile" in page.locator("#app .app-steps").inner_text()

    alerts = page.locator("#email-alerts")
    assert "Email alerts" in alerts.locator("h2").inner_text()
    assert "always emailed" in alerts.inner_text()
    unsub = page.locator("#unsubscribe")
    assert unsub.locator("h2").inner_text() == "Unsubscribe"
    assert "Warning" in unsub.locator(".pf-warning").inner_text()
    assert unsub.locator("#pf-emails").count() == 0, "Email alerts are their own card"
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_app_card_says_installed_and_is_hidden_in_the_app(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1')")
    page.goto("/profile.html")
    page.locator("#app").wait_for(state="visible", timeout=5000)
    assert "You have the MT3UK app" in page.locator("#app .app-text").inner_text()
    android = "Android" in page.evaluate("navigator.userAgent")
    assert page.locator("#pf-app-btn").is_visible() == android, "Open the app only on Android"
    assert page.errors == []


@all_devices
def test_my_garage_points_to_profile_for_notifications(device_page):
    page = device_page
    signed_in(page)
    page.goto("/my-builds.html")
    page.locator("#mb-app-view").wait_for(state="visible", timeout=5000)
    link = page.locator("#mb-push-moved a")
    assert link.get_attribute("href") == "profile.html#notifications"
    assert page.locator("#mb-push-toggle").count() == 0
    assert page.errors == []


@all_devices
def test_admin_subscribers_show_nicknames(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    cards = page.locator("#subscribers-wrap .subscriber-card")
    cards.first.wait_for(timeout=5000)
    assert "@Sparky" in page.locator("#subscribers-wrap").inner_text()
    assert "No nickname" in page.locator("#subscribers-wrap").inner_text()
    page.fill("#sub-search-name", "spark")
    page.wait_for_function("document.querySelectorAll('#subscribers-wrap .subscriber-card').length === 1", timeout=5000)
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


# A stand-in service worker and notification permission, as the test
# browsers block real ones, and "running as the installed app".
FAKE_PUSH = """
(() => {
  const perm = localStorage.getItem('testPerm') || 'default';
  let sub = localStorage.getItem('testSubscribed') ? { endpoint: 'e', toJSON() { return { endpoint: 'e' }; }, unsubscribe() { localStorage.removeItem('testSubscribed'); return Promise.resolve(true); } } : null;
  const reg = { pushManager: {
    getSubscription: () => Promise.resolve(sub),
    subscribe: () => { localStorage.setItem('testSubscribed', '1'); sub = { endpoint: 'e', toJSON() { return { endpoint: 'e' }; }, unsubscribe() { localStorage.removeItem('testSubscribed'); return Promise.resolve(true); } }; return Promise.resolve(sub); }
  } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: () => Promise.resolve(reg), ready: Promise.resolve(reg) } });
  window.PushManager = window.PushManager || function () {};
  window.Notification = { permission: perm, requestPermission: () => { window.Notification.permission = 'granted'; return Promise.resolve('granted'); } };
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => /standalone/.test(q) && localStorage.getItem('testApp') ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : mm(q);
})();
"""


@all_devices
def test_app_turns_notifications_on_by_itself_when_allowed(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script("localStorage.setItem('testApp', '1'); localStorage.setItem('testPerm', 'granted');")
    page.add_init_script(FAKE_PUSH)
    page.goto("/gallery.html")
    page.wait_for_function("localStorage.getItem('testSubscribed') === '1'", timeout=8000)
    # The device subscribes first, then tells the worker.
    for _ in range(50):
        if "/push/subscribe" in page.mock_state.get("push_calls", []):
            break
        page.wait_for_timeout(100)
    assert "/push/subscribe" in page.mock_state.get("push_calls", []), diagnostics(page)
    assert page.locator("#mt3uk-push-ask").count() == 0, "Already allowed: no need to ask"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_app_asks_once_to_turn_notifications_on(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script("localStorage.setItem('testApp', '1');")
    page.add_init_script(FAKE_PUSH)
    page.goto("/gallery.html")
    ask = page.locator("#mt3uk-push-ask")
    ask.wait_for(state="visible", timeout=8000)
    assert "Visibility" in ask.inner_text()
    assert overflow_width(page) <= 0
    ask.locator(".mt3uk-push-on").click()
    page.wait_for_function("localStorage.getItem('testSubscribed') === '1'", timeout=5000)
    ask.wait_for(state="detached", timeout=5000)
    assert "/push/subscribe" in page.mock_state.get("push_calls", [])
    assert page.errors == [], diagnostics(page)


@all_devices
def test_not_now_and_turned_off_in_profile_are_remembered(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script("localStorage.setItem('testApp', '1');")
    page.add_init_script(FAKE_PUSH)
    page.goto("/gallery.html")
    page.locator("#mt3uk-push-ask .mt3uk-push-later").click(timeout=8000)
    page.reload()
    page.wait_for_timeout(2500)
    assert page.locator("#mt3uk-push-ask").count() == 0, "Not now: not asked again"

    # Turned off in Profile (under Visibility): the app leaves it off.
    page.evaluate("localStorage.removeItem('mt3ukPushAsked'); localStorage.setItem('testPerm', 'granted'); localStorage.setItem('testSubscribed', '1')")
    page.goto("/profile.html#visibility")
    toggle = page.locator("#pf-push-toggle")
    toggle.wait_for(state="visible", timeout=5000)
    assert toggle.inner_text() == "Turn off notifications"
    toggle.click()
    page.wait_for_function("document.getElementById('pf-push-toggle').textContent === 'Turn on notifications'", timeout=5000)
    assert "/push/unsubscribe" in page.mock_state.get("push_calls", [])
    assert page.evaluate("localStorage.getItem('mt3ukPushOff')") == "1"
    page.goto("/gallery.html")
    page.wait_for_timeout(2500)
    assert page.evaluate("localStorage.getItem('testSubscribed')") is None, "Stays off"
    assert page.locator("#mt3uk-push-ask").count() == 0
    assert page.errors == [], diagnostics(page)
