"""The site's colours, saved from the look editor (?look=edit), are applied on every public page, and the editor saves them."""
import json
from playwright.sync_api import expect


def test_saved_colours_are_applied_on_a_page(page):
    look = {"success": True, "look": {"vars": {"--ink": "#123456", "--btn-accent": "#00aa55"}}}
    page.route("**/site/look", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(look)))
    page.goto("/track.html")
    page.wait_for_function("() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() === '#123456'")
    accent = page.evaluate("() => getComputedStyle(document.querySelector('.btn-accent') || document.body).getPropertyValue('--btn-accent').trim()")
    assert accent == "#00aa55", accent


def test_the_look_editor_saves_only_the_colours_changed(page):
    sent = {}

    def capture(route):
        sent["body"] = json.loads(route.request.post_data or "{}")
        sent["url"] = route.request.url
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "look": sent["body"]}))

    page.route("**/site/look/admin**", capture)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/track.html?look=edit")
    expect(page.locator("#site-look-bar")).to_be_attached()
    page.locator('[data-look="--orange"]').evaluate("el => { el.value = '#112233'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.locator('[data-look-act="site"]').click()
    page.wait_for_function("() => document.querySelector('[data-look-msg]').textContent.startsWith('Saved')")
    assert "key=test-key" in sent["url"], sent
    assert sent["body"]["vars"].get("--orange") == "#112233", sent


def test_a_saved_button_colour_is_applied_to_that_button_on_every_page(page):
    """A button is named by its destination, so the same name gets the same colours on each heading page."""
    buttons = {"success": True, "buttons": {"leaderboards": {"bg": "#00aa55", "text": "#000000"}}}
    page.route("**/site/buttons", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(buttons)))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/my-analysis.html")
    page.wait_for_function("() => document.querySelector('[data-btn=\"leaderboards\"]').style.background.includes('0, 170, 85')")
    color = page.evaluate("() => getComputedStyle(document.querySelector('[data-btn=\"leaderboards\"]')).backgroundColor")
    assert color == "rgb(0, 170, 85)", color


def test_the_look_editor_saves_one_button_by_its_name(page):
    sent = {}

    def capture(route):
        if "site/buttons/admin" in route.request.url:
            sent["body"] = json.loads(route.request.post_data or "{}")
            sent["url"] = route.request.url
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"success": True, "buttons": {sent["body"]["key"]: {"bg": sent["body"]["bg"], "text": sent["body"]["text"]}}}))
        else:
            route.continue_()

    page.route("**/site/buttons/admin**", capture)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/favourites.html?look=edit")
    expect(page.locator("#site-look-bar")).to_be_attached()
    page.locator("[data-look-btn-pick]").select_option("sessions")
    page.locator("[data-look-btn-bg]").evaluate("el => { el.value = '#123abc'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.locator("[data-look-btn-save]").click()
    page.wait_for_function("() => document.querySelector('[data-look-msg]').textContent.startsWith('Saved')")
    assert "key=test-key" in sent["url"], sent
    assert sent["body"]["key"] == "sessions" and sent["body"]["bg"] == "#123abc", sent
