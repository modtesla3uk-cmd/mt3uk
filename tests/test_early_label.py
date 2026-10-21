"""The early preview labels come off once Laps is open to all members (js/laps-early-label.js reads /laps/signin:
preview false) and stay while it is a preview. The Laps logo's words, the Sessions card badge on the homepage and the
Laps front page note are the labels."""
import json

from playwright.sync_api import expect


def answer_preview(page, preview):
    """Answer the public Laps sign-in check with the given preview flag."""
    page.route("**/laps/signin*", lambda route: route.fulfill(
        status=200, body=json.dumps({"success": True, "preview": preview}),
        headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}))


def test_open_to_all_members_takes_the_early_preview_labels_off_laps(page, base_url):
    answer_preview(page, False)
    page.goto("/laps.html")
    expect(page.locator(".laps-logo-early")).to_have_count(0)
    expect(page.locator("header .laps-logo")).to_have_attribute("aria-label", "Laps by MT3UK")
    expect(page.locator("#lh-note")).to_have_count(0)


def test_open_to_all_members_takes_the_homepage_sessions_badge_off(page, base_url):
    answer_preview(page, False)
    page.goto("/index.html")
    expect(page.locator(".early-badge")).to_have_count(0)


def test_while_it_is_a_preview_the_labels_stay(page, base_url):
    answer_preview(page, True)
    page.goto("/laps.html")
    expect(page.locator(".laps-logo-early")).to_have_text("Early preview")
    expect(page.locator("#lh-note")).to_contain_text("early preview")


def test_a_tab_that_saw_the_preview_before_does_not_keep_the_labels(page, base_url):
    # A stored answer from before Laps was opened to all must not keep the labels or the strip's preview tag.
    page.add_init_script("try { sessionStorage.setItem('mt3ukLapsPreview', 'yes'); } catch (e) {}")
    answer_preview(page, False)
    page.goto("/index.html")
    expect(page.locator(".early-badge")).to_have_count(0)


def test_once_laps_is_open_the_labels_are_hidden_before_the_page_paints(page, base_url):
    """A browser that has seen Laps open hides the labels before the sign-in check answers, so they do not flash
    on every refresh. The check is still made, and it clears the flag if the preview comes back."""
    page.add_init_script("try { localStorage.setItem('mt3ukLapsOpen', '1'); } catch (e) {}")
    # The sign-in answer is held back, so the labels can only be hidden by the head snippet, not by the answer arriving.
    held = []
    page.route("**/laps/signin*", lambda route: held.append(route))
    page.goto("/index.html", wait_until="domcontentloaded")
    # Every badge (the navigation, the Sessions card, the menu link) is hidden at this point, before the answer comes
    assert page.evaluate("(() => { const b = [...document.querySelectorAll('.early-badge')]; return b.length > 0 && b.every(e => getComputedStyle(e).display === 'none'); })()")
    held[0].fulfill(status=200, body=json.dumps({"success": True, "preview": False}),
                    headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"})


def test_a_returning_preview_clears_the_open_flag(page, base_url):
    page.add_init_script("try { localStorage.setItem('mt3ukLapsOpen', '1'); } catch (e) {}")
    answer_preview(page, True)
    page.goto("/laps.html")
    expect(page.locator(".laps-logo-early")).to_have_text("Early preview")
    assert page.evaluate("localStorage.getItem('mt3ukLapsOpen')") is None
