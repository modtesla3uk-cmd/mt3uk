"""My Profile (profile.html): name and nickname, a link to My Garage, email
choices and leaving MT3UK. Messages from MT3UK and between friends (with
Report) and friends, in the chat window (js/messenger.js). Also the admin page's Messages to subscribers
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
    # Old links to Messages (emails, notifications) open the chat window.
    page.goto("/profile.html#messages")
    chat = page.locator("#mt3uk-chat")
    chat.wait_for(state="visible", timeout=5000)
    page.locator("#mc-threads .mc-thread-row").first.wait_for(timeout=5000)
    assert page.locator("#mc-badge-chats").inner_text() == "1"
    assert page.locator("#mc-badge-mt3uk").inner_text() == "1"

    # MT3UK tab: messages to members, marked read when opened.
    page.click('.mc-tab[data-view="mt3uk"]')
    assert "Track day at Thruxton" in page.locator("#mc-broadcasts").inner_text()
    for _ in range(50):
        if calls(page, "/profile/messages/read"):
            break
        page.wait_for_timeout(100)
    assert calls(page, "/profile/messages/read"), diagnostics(page)
    assert page.locator("#mc-badge-mt3uk").is_hidden()

    page.click('.mc-tab[data-view="chats"]')
    page.locator("#mc-threads .mc-thread-row").first.click()
    page.locator("#mc-view-thread").wait_for(state="visible", timeout=5000)
    page.wait_for_function("document.getElementById('mc-title').textContent.indexOf('Sharad') !== -1", timeout=5000)
    page.wait_for_function("document.getElementById('mc-bubbles').textContent.indexOf('Hi, love the wheels') !== -1", timeout=5000)

    page.fill("#mc-compose-text", "See you at Thruxton")
    page.click("#mc-compose button[type=submit]")
    page.locator("#mc-bubbles .mc-msg.mine").wait_for(timeout=5000)
    assert "See you at Thruxton" in page.locator("#mc-bubbles .mc-msg.mine").last.inner_text()

    # Their messages can be reported.
    page.once("dialog", lambda d: d.accept("rude"))
    page.locator("#mc-bubbles .mc-report").first.click()
    page.wait_for_function("document.querySelector('#mc-bubbles .mc-report').textContent === 'Reported'", timeout=5000)
    assert page.mock_state.get("reported")
    assert overflow_width(page) <= 0

    # Back to the list, and closed with the X.
    page.click("#mc-back")
    page.locator("#mc-view-chats").wait_for(state="visible", timeout=5000)
    page.click("#mc-close")
    assert chat.is_hidden()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_friends_requests_search_and_message(device_page):
    page = device_page
    signed_in(page)
    page.goto("/gallery.html#friends")
    page.locator("#nav-chat").wait_for(state="visible", timeout=5000)
    page.evaluate("window.mt3ukChat.open('friends')")
    requests = page.locator("#mc-requests")
    requests.locator("text=RyanK").wait_for(timeout=5000)
    assert page.locator("#mc-badge-friends").inner_text() == "1"
    requests.locator("button", has_text="Accept").click()
    page.wait_for_function("document.getElementById('mc-friends').textContent.indexOf('RyanK') !== -1", timeout=5000)
    assert "Sharad" in page.locator("#mc-friends").inner_text()
    assert "gallery.html?only=" in page.locator("#mc-friends a.mc-btn").first.get_attribute("href")

    page.fill("#mc-search-q", "sha")
    page.click("#mc-search button[type=submit]")
    page.locator("#mc-results li").first.wait_for(timeout=5000)
    assert "Shaz" in page.locator("#mc-results").inner_text()

    # Message opens the conversation.
    page.locator("#mc-friends .mc-msg-btn").first.click()
    page.locator("#mc-view-thread").wait_for(state="visible", timeout=5000)
    assert not page.locator("#mc-compose").is_hidden()
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
    assert page.locator("header a.nav-link-profile").get_attribute("href") == "profile.html", "My Profile has its own menu item"
    page.locator('#mt3uk-account-bar a[href="profile.html"]').wait_for(state="attached", timeout=5000)

    page.goto("/index.html")
    page.locator("#nav-bell-count").wait_for(state="visible", timeout=5000)
    page.click("#nav-bell-btn")
    link = page.locator("#nav-bell-panel .nav-bell-messages")
    link.wait_for(timeout=5000)
    assert "2 unread messages" in link.inner_text()
    assert link.get_attribute("href") == "profile.html#messages"
    # It opens the chat window rather than leaving the page.
    link.click()
    page.locator("#mt3uk-chat").wait_for(state="visible", timeout=5000)
    assert "index.html" in page.url
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
def test_chat_icon_opens_messages_on_any_page(device_page):
    page = device_page
    signed_in(page)
    page.mock_state["messages_unread"] = 2
    page.goto("/shop.html")
    icon = page.locator("#nav-chat")
    icon.wait_for(state="visible", timeout=5000)
    # The chat icon sits between the bell and the profile icon.
    order = page.evaluate("[...document.querySelector('#nav-search').parentNode.children].map(e => e.id).filter(Boolean)")
    assert order.index("nav-bell") < order.index("nav-chat") < order.index("nav-profile"), order
    page.wait_for_function("document.getElementById('nav-chat-count').textContent === '2'", timeout=5000)
    icon.click()
    page.locator("#mt3uk-chat").wait_for(state="visible", timeout=5000)
    page.locator("#mc-threads .mc-thread-row").first.wait_for(timeout=5000)
    assert "shop.html" in page.url, "Stays on the same page"
    assert overflow_width(page) <= 0
    page.keyboard.press("Escape")
    assert page.locator("#mt3uk-chat").is_hidden()

    # Menu: My Profile > Messages opens the window too.
    page.evaluate("document.querySelector('header a.nav-sublink[href=\"profile.html#friends\"]').click()")
    page.locator("#mc-view-friends").wait_for(state="visible", timeout=5000)
    assert "shop.html" in page.url
    assert page.errors == [], diagnostics(page)


@all_devices
def test_chat_icon_asks_visitors_to_sign_in(device_page):
    page = device_page
    page.goto("/index.html")
    page.locator("#nav-chat").click()
    page.locator("#mc-signin").wait_for(state="visible", timeout=5000)
    assert "signin.html?next=" in page.locator("#mc-signin-link").get_attribute("href")
    assert page.errors == []


@all_devices
def test_profile_page_is_settings_only(device_page):
    page = device_page
    signed_in(page)
    page.goto("/profile.html")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    for gone in ("#messages", "#friends", "#pf-threads", "#pf-search"):
        assert page.locator(gone).count() == 0, gone + " moved to the chat window"
    assert page.locator("#mt3uk-chat").is_hidden()
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
    page.locator("#mc-view-friends").wait_for(state="visible", timeout=5000)
    assert page.locator("#mc-search-q").get_attribute("placeholder") == "Find members by nickname or name"
    page.fill("#mc-search-q", "d")
    page.click("#mc-search button[type=submit]")
    assert "nickname or name" in page.locator("#mc-results").inner_text()


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
    page.add_init_script("localStorage.setItem('mt3ukAppInstalled', '1'); if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps = () => Promise.resolve([{ platform: 'webapp' }])")
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
  window.Notification = { permission: perm, requestPermission: () => {
    window.__permAsked = (window.__permAsked || 0) + 1;
    const r = localStorage.getItem('testPermResult') || 'granted';
    window.Notification.permission = r; return Promise.resolve(r); } };
  // Android shows the phone's own prompt on first launch; most tests start
  // after that (testFirstLaunch starts before it).
  if (!localStorage.getItem('testFirstLaunch')) localStorage.setItem('mt3ukPushSystemAsked', '1');
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



@all_devices
def test_admin_can_send_a_test_email_to_one_address(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#members-msg-wrap > summary").click()
    page.locator("#bc-list .bc-item").first.wait_for(timeout=5000)
    before = page.locator("#bc-list .bc-item").count()
    page.click("#bc-test-btn")
    assert "title and message" in page.locator("#bc-test-note").inner_text()
    page.fill("#bc-title", "Owner Interviews start Thursday")
    page.fill("#bc-text", "The first one is Richard's Model 3.")
    page.fill("#bc-test-email", "me@example.com")
    page.mock_state["test_fallback"] = {"title": "Owner Interviews start Thursday", "text": "x", "email": "me@example.com"}
    # Enter in the test box sends the test, not the message to everyone.
    page.press("#bc-test-email", "Enter")
    page.wait_for_function("document.getElementById('bc-test-note').textContent.indexOf('Test sent to me@example.com') !== -1", timeout=5000)
    sent = page.mock_state["test_emails"][-1]
    assert sent["email"] == "me@example.com" and sent["title"] == "Owner Interviews start Thursday"
    # Send as: the plain version, like a sign-in email.
    page.mock_state["test_fallback"] = {"title": "Owner Interviews start Thursday", "text": "x", "email": "me@example.com", "variant": "plain"}
    page.select_option("#bc-test-variant", "plain")
    page.click("#bc-test-btn")
    page.wait_for_function("document.getElementById('bc-test-note').textContent.indexOf('plain, like a sign-in email') !== -1", timeout=5000)
    assert page.mock_state["test_emails"][-1].get("variant") == "plain"
    assert page.locator("#bc-list .bc-item").count() == before, "Nothing saved as a message"
    assert not [c for c in page.mock_state.get("profile_calls", []) if c[1] == "/admin/broadcasts" and c[0] == "POST"]
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_app_asks_about_notifications_straight_after_signing_in(device_page):
    """Signed out when the app opened: the question comes as soon as they
    sign in, not on a later page."""
    from test_passkeys import FAKE_AUTHENTICATOR
    page = device_page
    page.add_init_script("localStorage.setItem('testApp', '1');")
    page.add_init_script(FAKE_PUSH)
    page.add_init_script(FAKE_AUTHENTICATOR)
    page.goto("/signin.html")
    page.locator("#si-passkey-btn").click()
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    page.locator("#mt3uk-push-ask").wait_for(state="visible", timeout=8000)
    assert page.errors == [], diagnostics(page)


@all_devices
def test_not_now_asks_once_more_after_two_weeks(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script("localStorage.setItem('testApp', '1');")
    page.add_init_script(FAKE_PUSH)
    # Not now, 15 days ago: asked once more.
    page.add_init_script("if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('mt3ukPushAsked', JSON.stringify({ n: 1, at: Date.now() - 15 * 864e5 })); }")
    page.goto("/gallery.html")
    ask = page.locator("#mt3uk-push-ask")
    ask.wait_for(state="visible", timeout=8000)
    ask.locator(".mt3uk-push-later").click()
    page.reload()
    page.wait_for_timeout(2500)
    assert page.locator("#mt3uk-push-ask").count() == 0, "A second Not now is final"
    assert page.errors == [], diagnostics(page)



ANDROID_UA = "Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' });"
IPHONE_UA = "Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });"


@all_devices
def test_android_app_shows_the_phone_prompt_on_first_launch(device_page):
    """Like a normal app: the phone's own Allow prompt when the app is first
    opened, before signing in; notifications switch on once signed in."""
    from test_passkeys import FAKE_AUTHENTICATOR
    page = device_page
    page.add_init_script(ANDROID_UA + " localStorage.setItem('testApp', '1'); localStorage.setItem('testFirstLaunch', '1');")
    page.add_init_script(FAKE_PUSH)
    page.add_init_script(FAKE_AUTHENTICATOR)
    page.goto("/signin.html")
    page.wait_for_function("window.__permAsked === 1", timeout=8000)
    assert page.locator("#mt3uk-push-ask").count() == 0, "The phone asks, not our message"
    assert "/push/subscribe" not in page.mock_state.get("push_calls", []), "Not signed in yet"
    page.click("#si-passkey-btn")
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    for _ in range(80):
        if "/push/subscribe" in page.mock_state.get("push_calls", []):
            break
        page.wait_for_timeout(100)
    assert "/push/subscribe" in page.mock_state.get("push_calls", []), "Switched on after signing in"
    page.reload()
    page.wait_for_timeout(2500)
    assert page.evaluate("window.__permAsked || 0") == 0, "Only asked once"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_android_dismissed_prompt_falls_back_to_turn_on_message(device_page):
    page = device_page
    page.add_init_script(ANDROID_UA + " localStorage.setItem('testApp', '1'); localStorage.setItem('testFirstLaunch', '1'); localStorage.setItem('testPermResult', 'default');")
    page.add_init_script(FAKE_PUSH)
    page.goto("/gallery.html")
    page.locator("#mt3uk-push-ask").wait_for(state="visible", timeout=8000)


@all_devices
def test_iphone_app_asks_on_first_launch_before_signing_in(device_page):
    """iPhones need a tap first, so the app's Turn on message comes up on
    launch; Turn on brings up Apple's prompt, and alerts start on sign-in."""
    from test_passkeys import FAKE_AUTHENTICATOR
    page = device_page
    page.add_init_script(IPHONE_UA + " localStorage.setItem('testApp', '1'); localStorage.setItem('testFirstLaunch', '1');")
    page.add_init_script(FAKE_PUSH)
    page.add_init_script(FAKE_AUTHENTICATOR)
    page.goto("/signin.html")
    ask = page.locator("#mt3uk-push-ask")
    ask.wait_for(state="visible", timeout=8000)
    assert page.evaluate("window.__permAsked || 0") == 0, "No prompt without a tap"
    ask.locator(".mt3uk-push-on").click()
    page.wait_for_function("document.querySelector('#mt3uk-push-ask .mt3uk-push-msg') && document.querySelector('#mt3uk-push-ask .mt3uk-push-msg').textContent.indexOf('Sign in') !== -1", timeout=5000)
    assert page.evaluate("window.__permAsked") == 1
    ask.wait_for(state="detached", timeout=5000)
    page.click("#si-passkey-btn")
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    for _ in range(80):
        if "/push/subscribe" in page.mock_state.get("push_calls", []):
            break
        page.wait_for_timeout(100)
    assert "/push/subscribe" in page.mock_state.get("push_calls", [])
    assert page.errors == [], diagnostics(page)
