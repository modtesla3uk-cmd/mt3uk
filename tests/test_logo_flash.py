"""A Laps page whose chosen logo mark is not the lap timer hides the default clock until js/laps-logo.js has drawn the
chosen one, so the clock does not flash on every refresh."""
import json

from playwright.sync_api import expect


def answer_logo(page, logo):
    page.route("**/laps/logo*", lambda route: route.fulfill(
        status=200, body=json.dumps({"success": True, "logo": logo}),
        headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}))


def test_the_default_clock_stays_hidden_until_the_chosen_mark_is_drawn(page, base_url):
    page.add_init_script("try { localStorage.setItem('mt3ukLapsLogo', 'loop'); } catch (e) {}")
    answer_logo(page, "loop")
    page.route("**/js/laps-logo.js*", lambda route: route.abort())
    page.goto("/laps.html")
    assert page.evaluate("document.documentElement.classList.contains('laps-logo-pending')") is True
    assert page.evaluate("getComputedStyle(document.querySelector('header .laps-logo-mark')).visibility") == "hidden"


def test_the_chosen_mark_shows_once_it_is_drawn(page, base_url):
    page.add_init_script("try { localStorage.setItem('mt3ukLapsLogo', 'loop'); } catch (e) {}")
    answer_logo(page, "loop")
    page.goto("/laps.html")
    expect(page.locator("header .laps-logo-mark")).to_have_attribute("data-logo", "loop")
    assert page.evaluate("document.documentElement.classList.contains('laps-logo-pending')") is False


def test_the_default_timer_is_never_hidden(page, base_url):
    answer_logo(page, "timer")
    page.goto("/laps.html")
    assert page.evaluate("document.documentElement.classList.contains('laps-logo-pending')") is False
