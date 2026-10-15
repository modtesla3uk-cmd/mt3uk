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
