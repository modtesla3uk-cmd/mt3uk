"""Making MT3UK welcoming to people who come from the Facebook group: the welcome strip on the homepage (only for a
visitor who arrived from Facebook), the Facebook posts panel on admin.html (ready-to-paste posts), and no Facebook
group tick box on the photo form."""
import json
from urllib.parse import urlparse

import pytest
from playwright.sync_api import expect

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"


@pytest.fixture
def browser_context_args(browser_context_args):
    # The site's service worker would answer the data files before the test's mocks see them.
    return {**browser_context_args, "service_workers": "block"}


def seen_intro(page):
    page.add_init_script("localStorage.setItem('mt3ukIntroSeen', '1')")


def test_the_welcome_strip_shows_only_to_visitors_from_facebook(page):
    seen_intro(page)
    page.goto("/index.html")
    expect(page.locator("#hp-fb")).to_be_hidden()
    page.goto("/index.html?utm_source=facebook&utm_medium=group&utm_campaign=event_x")
    strip = page.locator("#hp-fb")
    expect(strip).to_be_visible()
    expect(strip).to_contain_text("Welcome from the MT3UK Facebook group")
    assert strip.locator("a.hp-fb-primary").get_attribute("href") == "my-builds.html#add-photo"
    assert strip.locator('a[href="#vote-frame"]').count() == 1 and strip.locator('a[href="gallery.html"]').count() == 1
    # Facebook adds fbclid to every link it opens, so that counts too.
    page.goto("/index.html?fbclid=abc123")
    expect(page.locator("#hp-fb")).to_be_visible()
    # Closing it keeps it shut for the rest of the visit.
    page.locator("#hp-fb-close").click()
    expect(page.locator("#hp-fb")).to_be_hidden()
    page.goto("/index.html?utm_source=facebook")
    expect(page.locator("#hp-fb")).to_be_hidden()


def test_the_welcome_strip_fits_a_phone_and_leaves_the_hero_sized_below_it(page):
    seen_intro(page)
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/index.html?utm_source=facebook")
    expect(page.locator("#hp-fb")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 0
    for button in page.locator("#hp-fb .hp-fb-btn").all():
        assert button.bounding_box()["height"] >= 44
    # The hero is measured from the top of the page, strip included, so it does not run past the screen.
    page.wait_for_timeout(300)
    hero_top = page.evaluate("Math.round(document.getElementById('hp-hero').getBoundingClientRect().top + window.pageYOffset)")
    assert page.evaluate("parseInt(getComputedStyle(document.getElementById('hp-hero')).getPropertyValue('--hp-hero-top'))") == hero_top


def test_the_photo_form_no_longer_asks_for_facebook_group_membership(page):
    page.goto("/my-builds.html#add-photo")
    assert page.locator("#mb-submit-member-confirm").count() == 0
    text = page.locator("#mb-submit-card").inner_text()
    assert "I confirm I'm a member" not in text and "I confirm I’m a member" not in text
    # An optional invitation to the group stays.
    expect(page.locator("#mb-submit-card .mb-fb-join-link")).to_contain_text("optional")


FEATURED = {"file": "red-model-3.jpg", "votes": 4, "date": "2026-10-12"}
MANIFEST = [{"file": "red-model-3.jpg", "caption": "RED MODEL 3", "name": "Sam Ng"}]
EVENTS = {"events": [
    {"slug": "past-meet", "name": "Past Meet", "startDate": "2026-10-02", "publish": "2026-09-01"},
    {"slug": "autumn-meet", "name": "Autumn Meet", "tagline": "All EVs welcome", "startDate": "2026-10-18", "startTime": "10:00", "endTime": "14:00", "venue": "The Pub", "town": "Banbury", "entry": "Free", "publish": "2026-09-01"},
    {"slug": "draft-meet", "name": "Draft Meet", "draft": True, "startDate": "2026-11-01"},
]}
INTERVIEWS = {"interviews": [
    {"name": "Kam", "car": "Model Y", "year": "2022", "title": "Kam's Model Y", "excerpt": "A daily driver.", "url": "blog-kam.html", "publish": "2026-10-10"},
    {"name": "Later", "title": "Not yet", "url": "blog-later.html", "publish": "2026-12-01"},
]}
TRACKS = {"venues": [{"id": "thruxton", "name": "Thruxton", "layouts": [{"id": "full", "name": "Full"}]}]}
COUNTS = {"success": True, "counts": {"track:thruxton:full": 5}, "leaders": {"track:thruxton:full": [{"owner": "Rich", "time": 81.42}]}}


def test_the_facebook_posts_panel_writes_posts_to_copy(page):
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    page.clock.set_fixed_time("2026-10-16T09:00:00")
    files = {"/images/gallery/manifest.json": MANIFEST, "/data/featured.json": FEATURED, "/data/event-pages.json": EVENTS, "/data/interviews.json": INTERVIEWS, "/data/tracks.json": TRACKS}

    def serve(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(files[urlparse(route.request.url).path]))
    for path in files:
        page.route("**" + path, serve)
    page.route("**/%s/**" % API_HOST, lambda r: r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(COUNTS if "/track/counts" in r.request.url else {"success": True})))
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#fbposts-wrap > summary").click()
    cards = page.locator(".fbp-card")
    expect(cards).to_have_count(4)
    texts = page.locator(".fbp-text").evaluate_all("els => els.map(e => e.value)")
    botw = [t for t in texts if t.startswith("Build of the Week")][0]
    assert "RED MODEL 3 by Sam Ng" in botw and "https://mt3uk.com/share/red-model-3.jpg.html?utm_source=facebook&utm_medium=group&utm_campaign=build_of_the_week" in botw
    event = [t for t in texts if t.startswith("Autumn Meet")][0]
    assert "Sunday 18 October, 10:00 to 14:00" in event and "The Pub, Banbury" in event and "Entry: Free" in event
    assert "share/event/autumn-meet.html?utm_source=facebook" in event
    assert not any("Past Meet" in t or "Draft Meet" in t or "Not yet" in t for t in texts), "past, draft and unpublished things are left out"
    interview = [t for t in texts if t.startswith("Owner interview")][0]
    assert "Kam (Model Y, 2022)" in interview and "https://mt3uk.com/blog-kam.html?utm_source=facebook" in interview
    laps = [t for t in texts if "on Laps by MT3UK" in t][0]
    assert "Fastest lap at Thruxton" in laps and "1:21.42, Rich" in laps and "laps.mt3uk.com/leaderboards.html?board=thruxton%3Afull&utm_source=facebook" in laps
    assert not any("—" in t for t in texts), "no em dashes"
    # The words can be changed, and Copy post copies what is in the box.
    box = page.locator(".fbp-text").first
    box.fill("My own words https://mt3uk.com")
    page.locator(".fbp-copy").first.click()
    expect(page.locator(".fbp-done").first).to_contain_text("Copied")
    assert page.evaluate("navigator.clipboard.readText()") == "My own words https://mt3uk.com"
