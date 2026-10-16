"""Give feedback in the menu: a short form with a nickname, a message, an optional screenshot and an optional email.
It posts to the worker's /feedback route, which emails MT3UK and lists it on admin.html."""
import json

from playwright.sync_api import expect

from test_track_page import FakeWorker, open_page


def test_give_feedback_from_the_menu_sends_the_nickname_message_and_email(page):
    sent = []

    def answer(route):
        sent.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, body=json.dumps({"success": True, "message": "Thanks. We have your feedback."}),
                      headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"})

    open_page(page, FakeWorker(), "/track.html", signed_in=True)
    page.route("**/feedback", answer)
    link = page.get_by_role("link", name="Give feedback").first
    if not link.is_visible():
        page.locator("#hamburger").click()
    link.click()
    dialog = page.locator("#fb-dialog")
    expect(dialog).to_be_visible()
    expect(page.locator("#fb-title")).to_have_text("Give feedback")
    page.fill("#fb-nick", "Richard HC")
    page.fill("#fb-msg", "The Sessions box will not close on my phone.")
    page.fill("#fb-email", "member@example.com")
    page.click("#fb-send")
    expect(page.locator("#fb-note")).to_contain_text("Thanks")
    assert sent and sent[0]["nickname"] == "Richard HC"
    assert sent[0]["message"].startswith("The Sessions box")
    assert sent[0]["email"] == "member@example.com"
    assert sent[0]["page"].endswith("/track.html")
    assert sent[0]["shot"] == ""


def test_the_feedback_form_needs_a_nickname_and_a_message_and_takes_no_email(page):
    sent = []
    open_page(page, FakeWorker(), "/leaderboards.html", signed_in=False)
    page.route("**/feedback", lambda route: (sent.append(route.request.post_data), route.fulfill(
        status=200, body=json.dumps({"success": True, "message": "Thanks."}), headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"})))
    if not page.get_by_role("link", name="Give feedback").first.is_visible():
        page.locator("#hamburger").click()
    page.get_by_role("link", name="Give feedback").first.click()
    page.click("#fb-send")
    assert page.locator("#fb-nick").evaluate("e => !e.checkValidity()")
    assert not sent
    page.fill("#fb-nick", "Sam")
    page.fill("#fb-msg", "Hi")
    page.click("#fb-send")
    expect(page.locator("#fb-note")).to_contain_text("few words")
    assert not sent
