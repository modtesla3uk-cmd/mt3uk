"""One Back button on every page (js/account-bar.js): it says just Back, goes back to the page you came from when that
was another page of the site, and to its parent page when you arrived from a shared link or a bookmark."""
import re

from playwright.sync_api import expect


def test_back_goes_to_the_parent_when_the_page_was_opened_directly(page):
    page.goto("/contact.html")
    back = page.locator("a.back-link").first
    expect(back).to_have_text("Back")
    expect(back).to_have_attribute("aria-label", "Back to MT3UK")
    back.click()
    expect(page).to_have_url(re.compile(r"/index\.html$|/$"))


def test_back_goes_to_the_page_you_came_from(page):
    page.goto("/blog.html")
    page.evaluate("location.href = '/shop.html'")
    expect(page).to_have_url(re.compile(r"/shop\.html$"))
    page.wait_for_load_state("load")
    page.locator("a.back-link").first.click()
    expect(page).to_have_url(re.compile(r"/blog\.html$"))


def test_interview_and_track_day_pages_just_say_back(page):
    for name, aria in (("blog-sue.html", "Back to all Owner Interviews"), ("track-day-prep.html", "Back to Track Days"), ("reviews.html", "Back to Shop")):
        page.goto("/" + name)
        back = page.locator("a.back-link").first
        expect(back).to_have_text("Back")
        expect(back).to_have_attribute("aria-label", aria)
