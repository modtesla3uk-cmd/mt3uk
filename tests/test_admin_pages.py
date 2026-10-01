"""The admin pages (admin.html, events-admin.html, device-checklist.html): a
light look, one navigation shared by all three, and the panels in logical
groups."""
import json
import re

import pytest
from playwright.sync_api import expect

from test_devices import overflow_width

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
PAGES = ["admin.html", "events-admin.html", "device-checklist.html"]
GROUPS = [
    ("grp-gallery", "Gallery and builds", ["pending-wrap", "decided-wrap", "unclaimed-wrap", "votes-wrap"]),
    ("grp-reports", "Reports", ["comments-wrap", "rphotos-wrap", "local-wrap"]),
    ("grp-members", "Members", ["subscribers-wrap", "members-msg-wrap"]),
    ("grp-interviews", "Owner interviews", ["interviews-wrap", "preview-wrap"]),
    ("grp-tracks", "Track sessions", ["tracks-wrap", "tyres-wrap"]),
]


def open_admin(page, name):
    page.route("**/%s/**" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}), headers={"Access-Control-Allow-Origin": "*"}))
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/" + name)
    expect(page.locator(".admin-nav")).to_be_visible()


def luminance(rgb):
    r, g, b = [int(x) for x in re.findall(r"\d+", rgb)[:3]]
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


@pytest.mark.parametrize("name", PAGES)
def test_the_admin_pages_are_light_and_share_one_navigation(page, name):
    open_admin(page, name)
    assert luminance(page.evaluate("getComputedStyle(document.body).backgroundColor")) > 0.85
    assert luminance(page.evaluate("getComputedStyle(document.body).color")) < 0.3
    links = page.locator(".admin-nav a")
    assert links.all_inner_texts() == ["Gallery and builds", "Reports", "Members", "Owner interviews", "Track sessions", "Events", "Device checks"]
    hrefs = [links.nth(i).get_attribute("href") for i in range(links.count())]
    assert hrefs == ["admin.html#grp-gallery", "admin.html#grp-reports", "admin.html#grp-members", "admin.html#grp-interviews", "admin.html#grp-tracks", "events-admin.html", "device-checklist.html"]
    current = page.locator('.admin-nav a[aria-current="page"]')
    if name == "admin.html":
        expect(current).to_have_count(0)
    else:
        expect(current).to_have_text("Events" if name == "events-admin.html" else "Device checks")


def test_admin_panels_sit_in_logical_groups(page):
    open_admin(page, "admin.html")
    heads = page.locator(".admin-group > .group-head h2").all_inner_texts()
    assert heads == [g[1] for g in GROUPS]
    for gid, title, ids in GROUPS:
        inside = page.locator("#%s details.collapsible" % gid).evaluate_all("els => els.map(e => e.id)")
        assert inside == ids, (gid, inside)
        expect(page.locator("#%s .group-head p" % gid)).not_to_be_empty()
    # Every panel is in exactly one group, and each is a white card.
    assert page.locator("details.collapsible").count() == sum(len(g[2]) for g in GROUPS)
    assert page.locator("details.collapsible:not(.admin-group details)").count() == 0
    assert luminance(page.evaluate("getComputedStyle(document.querySelector('#tyres-wrap')).backgroundColor")) > 0.95
    # The nav jumps to a group.
    page.locator('.admin-nav a[href="admin.html#grp-tracks"]').click()
    expect(page.locator("#grp-tracks .group-head h2")).to_be_in_viewport()


def test_event_and_device_pages_are_grouped(page):
    open_admin(page, "events-admin.html")
    assert page.locator(".admin-group > .group-head h2").all_inner_texts() == ["Event pages", "Meets list"]
    assert page.locator("#grp-pages #ep-wrap").count() == 1 and page.locator("#grp-pages #pv-wrap").count() == 1
    assert page.locator("#grp-meets #upcoming-list").count() == 1 and page.locator("#grp-meets #past-wrap").count() == 1
    page2 = page.context.new_page()
    open_admin(page2, "device-checklist.html")
    expect(page2.locator("h1")).to_have_text("Device Checks")
    assert luminance(page2.evaluate("getComputedStyle(document.querySelector('.card')).backgroundColor")) > 0.95


@pytest.mark.parametrize("name", PAGES)
def test_admin_pages_fit_a_phone(page, name):
    page.set_viewport_size({"width": 390, "height": 844})
    open_admin(page, name)
    assert overflow_width(page) <= 0
    # The navigation scrolls along its own row rather than widening the page.
    nav = page.locator(".admin-nav").bounding_box()
    assert nav["width"] <= 390
    for link in page.locator(".admin-nav a").all():
        assert link.bounding_box()["height"] >= 43
