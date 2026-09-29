"""Until an Owner Interview is published, its page asks for a one-time code
(js/interview-gate.js). Anyone can have a code emailed, and a code opens the
interview for 4 hours. The admin page lists who has opened one and can revoke
access. On localhost the gate is off unless the page has ?gate=on."""
import json
import re
from pathlib import Path

from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
INTERVIEWS = json.loads((ROOT / "data" / "interviews.json").read_text(encoding="utf-8"))["interviews"]
PAGE = "/blog-sharad.html"


def schedule(page, publish):
    """Serve data/interviews.json with Sharad's interview on the given date."""
    data = json.loads(json.dumps({"interviews": INTERVIEWS}))
    for iv in data["interviews"]:
        if iv["url"] == "blog-sharad.html":
            iv["publish"] = publish
    page.route(re.compile(r".*/data/interviews\.json.*"), lambda route: route.fulfill(
        status=200, body=json.dumps(data), headers={"Content-Type": "application/json"}))


def test_every_interview_page_loads_the_gate_in_its_head():
    for iv in INTERVIEWS:
        source = (ROOT / iv["url"]).read_text(encoding="utf-8")
        head = source.split("</head>")[0]
        assert '<script src="js/interview-gate.js"></script>' in head, f"{iv['url']} is missing js/interview-gate.js in its <head>"


@all_devices
def test_unpublished_interview_asks_for_a_code_then_opens_for_an_hour(device_page):
    page = device_page
    schedule(page, "2099-01-01")
    page.goto(PAGE + "?gate=on")
    gate = page.locator("#iv-gate")
    gate.wait_for(state="visible", timeout=5000)
    assert page.locator("article.interview").is_hidden()
    assert page.locator("body > header").is_visible(), "The site header stays so people can go elsewhere"
    assert "2099" in gate.inner_text()
    assert "Getting a code subscribes you to MT3UK" in gate.inner_text(), "Clear that asking for a code subscribes them"
    assert page.locator("#iv-gate button[type=submit]").inner_text().lower() == "send code and subscribe"
    assert overflow_width(page) <= 0

    page.fill("#ivg-email", "sharad@example.com")
    page.click("#iv-gate button[type=submit]")
    page.locator("#ivg-code").wait_for(state="visible", timeout=5000)
    assert "sharad@example.com" in gate.inner_text()

    # A wrong code is refused, the right one opens the interview.
    page.fill("#ivg-code", "000000")
    page.click("#iv-gate button[type=submit]")
    page.wait_for_function("document.querySelector('#iv-gate .ivg-msg').textContent.indexOf('not right') !== -1", timeout=5000)
    assert page.locator("article.interview").is_hidden()
    page.fill("#ivg-code", "123456")
    page.click("#iv-gate button[type=submit]")
    page.locator("article.interview").wait_for(state="visible", timeout=5000)
    assert page.locator("#iv-gate").count() == 0
    assert re.search(r"\d+m left", page.locator(".ivg-timer").inner_text())
    assert page.evaluate("JSON.parse(localStorage.getItem('mt3ukInterviewPreview:sharad')).token")
    # Using the code signs them in (and joins them if new), and a message
    # says how long the preview is open.
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.preview"
    # New members are asked for a nickname first.
    page.locator("#mt3uk-nick-prompt").wait_for(state="visible", timeout=5000)
    page.click(".mt3uk-nick-later")
    message = page.locator(".ivg-notice")
    message.wait_for(state="visible", timeout=5000)
    assert "Preview open until" in message.inner_text()
    assert "now subscribed" in message.inner_text()
    assert overflow_width(page) <= 0
    message.locator(".ivg-notice-close").click()
    assert page.locator(".ivg-notice").count() == 0

    # Still open after a reload, while the access lasts, with the message
    # again but without the welcome.
    page.reload()
    page.locator("article.interview").wait_for(state="visible", timeout=5000)
    assert page.locator("#iv-gate").count() == 0
    page.locator(".ivg-notice").wait_for(state="visible", timeout=5000)
    assert "now subscribed" not in page.locator(".ivg-notice").inner_text()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_access_that_has_run_out_shows_the_gate_again(device_page):
    page = device_page
    schedule(page, "2099-01-01")
    page.add_init_script("localStorage.setItem('mt3ukInterviewPreview:sharad', JSON.stringify({token: 'x'.repeat(64), expires: Date.now() - 1000}))")
    page.goto(PAGE + "?gate=on")
    page.locator("#iv-gate").wait_for(state="visible", timeout=5000)
    assert page.locator("article.interview").is_hidden()
    assert page.evaluate("localStorage.getItem('mt3ukInterviewPreview:sharad')") is None
    assert page.errors == []


@all_devices
def test_published_interview_has_no_gate(device_page):
    page = device_page
    schedule(page, "2020-01-01")
    page.goto(PAGE + "?gate=on")
    page.locator("article.interview").wait_for(state="visible", timeout=5000)
    assert page.locator("#iv-gate").count() == 0
    assert page.errors == []


@all_devices
def test_gate_is_off_on_localhost_without_gate_on(device_page):
    page = device_page
    schedule(page, "2099-01-01")
    page.goto(PAGE)
    page.locator("article.interview").wait_for(state="visible", timeout=5000)
    assert page.locator("#iv-gate").count() == 0


@all_devices
def test_admin_sees_who_opened_a_preview_and_can_revoke(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#preview-wrap > summary").click()
    rows = page.locator("#pv-list tbody tr")
    rows.first.wait_for(state="visible", timeout=5000)
    text = rows.first.inner_text()
    assert "sharad@example.com" in text and "Sharad" in text, "Shows the email and the interview's name"
    assert "Joined MT3UK" in text and "2 times" in text

    rows.first.locator("button", has_text="Revoke").click()
    page.wait_for_function("document.querySelector('#pv-list tbody tr').textContent.indexOf('Revoked') !== -1", timeout=5000)
    rows.first.locator("button", has_text="Restore").click()
    page.wait_for_function("document.querySelector('#pv-list tbody tr button').textContent === 'Revoke'", timeout=5000)
    assert page.errors == [], diagnostics(page)


@all_devices
def test_link_in_the_code_email_opens_the_interview(device_page):
    page = device_page
    schedule(page, "2099-01-01")
    page.goto(PAGE + "?gate=on&preview=" + "g" * 32)
    page.locator("article.interview").wait_for(state="visible", timeout=5000)
    assert page.locator("#iv-gate").count() == 0
    assert "preview=" not in page.url, "The one-time token is taken out of the address"
    assert "gate=on" in page.url, "Other parts of the address stay"
    assert page.mock_state.get("link_used"), "Opened by the link, not because the gate was off"
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.preview"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_used_email_link_asks_for_a_new_code(device_page):
    page = device_page
    schedule(page, "2099-01-01")
    page.mock_state["link_used"] = True
    page.goto(PAGE + "?gate=on&preview=" + "g" * 32)
    page.locator("#iv-gate").wait_for(state="visible", timeout=5000)
    assert "already been used" in page.locator("#iv-gate .ivg-msg").inner_text()
    assert page.locator("#ivg-email").is_visible()
    assert page.errors == []


@all_devices
def test_admin_link_goes_to_the_admin_inbox(device_page):
    page = device_page
    schedule(page, "2099-01-01")
    page.goto(PAGE + "?gate=on")
    page.locator("#iv-gate .ivg-admin").click()
    page.wait_for_function("document.querySelector('#iv-gate .ivg-msg').textContent.indexOf('admin inbox') !== -1", timeout=5000)
    assert page.mock_state.get("admin_link")
    assert page.errors == []


@all_devices
def test_draft_interview_stays_behind_the_gate(device_page):
    page = device_page
    data = json.loads(json.dumps({"interviews": INTERVIEWS}))
    for iv in data["interviews"]:
        if iv["url"] == "blog-sharad.html":
            iv.pop("publish", None)
            iv["draft"] = True
    page.route(re.compile(r".*/data/interviews\.json.*"), lambda route: route.fulfill(
        status=200, body=json.dumps(data), headers={"Content-Type": "application/json"}))
    page.goto(PAGE + "?gate=on")
    gate = page.locator("#iv-gate")
    gate.wait_for(state="visible", timeout=5000)
    assert "coming soon" in gate.inner_text().lower()
    assert page.locator("article.interview").is_hidden()
    assert page.errors == []
