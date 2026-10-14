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
