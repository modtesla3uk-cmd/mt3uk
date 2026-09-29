"""Until an Owner Interview is published, its page asks for a one-time code
(js/interview-gate.js). Codes only go to approved emails, managed on the
admin page, and a code opens the interview for 4 hours. On localhost the gate
is off unless the page has ?gate=on."""
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
    message = page.locator(".ivg-notice")
    message.wait_for(state="visible", timeout=5000)
    assert "Preview open until" in message.inner_text()
    assert "now a member" in message.inner_text()
    assert overflow_width(page) <= 0
    message.locator(".ivg-notice-close").click()
    assert page.locator(".ivg-notice").count() == 0

    # Still open after a reload, while the access lasts, with the message
    # again but without the welcome.
    page.reload()
    page.locator("article.interview").wait_for(state="visible", timeout=5000)
    assert page.locator("#iv-gate").count() == 0
    page.locator(".ivg-notice").wait_for(state="visible", timeout=5000)
    assert "now a member" not in page.locator(".ivg-notice").inner_text()
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
def test_admin_can_add_and_remove_preview_emails(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#preview-wrap > summary").click()
    rows = page.locator("#pv-list tbody tr")
    rows.first.wait_for(state="visible", timeout=5000)
    assert "sharad@example.com" in rows.first.inner_text()
    assert "Sharad" in page.locator("#pv-list").inner_text(), "Shows the interview's name, not just its slug"

    page.fill("#pv-email", "new@example.com")
    page.select_option("#pv-slug", "*")
    page.click("#pv-form button[type=submit]")
    page.wait_for_function("document.querySelectorAll('#pv-list tbody tr').length === 2", timeout=5000)
    assert "All interviews" in page.locator("#pv-list").inner_text()

    page.locator("#pv-list .pv-remove").first.click()
    page.wait_for_function("document.querySelectorAll('#pv-list tbody tr').length === 1", timeout=5000)
    assert page.errors == [], diagnostics(page)
