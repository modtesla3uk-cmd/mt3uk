"""The four Laps heading pages (Sessions, Leaderboard, My Analysis, Favourites) place their parts in the same
positions on desktop. The spec is css/laps-heading.css: a 1000 x 146 px heading box, the title at the top left,
Back under it, and three button slots at the top right and under them (see the file for the numbers).

Each page marks its parts with lh-* classes. These tests measure the rendered boxes against the spec, so a page
that drifts out of line fails here. Phone is left to each page's own rules and is not checked.
"""
import pytest
from playwright.sync_api import expect

import json as _json


@pytest.fixture(autouse=True)
def built_in_look(page):
    """These tests check the built-in heading, so the saved layout and look on the live worker are left out."""
    page.route("**/laps/heading-layout", lambda route: route.fulfill(
        status=200, content_type="application/json", body=_json.dumps({"success": True, "layout": {}})))
    page.route("**/site/look", lambda route: route.fulfill(
        status=200, content_type="application/json", body=_json.dumps({"success": True, "look": {}})))
    page.route("**/site/buttons", lambda route: route.fulfill(
        status=200, content_type="application/json", body=_json.dumps({"success": True, "buttons": {}})))


PAGES = {
    # page: the slot each button sits in (s1 top right, left; s2 top right, right; s3 under s2)
    "favourites.html": {"s1": "My Analysis", "s2": "Leaderboards", "s3": "My Sessions"},
    "leaderboards.html": {"s1": "My Analysis", "s2": "My Sessions", "s3": "Join preview"},
    "track.html": {"s1": "My Analysis", "s2": "Leaderboards", "s3": "Add a session"},
    "my-analysis.html": {"s1": "Leaderboards", "s2": "Add a session", "s3": "Sessions"},
}

# Positions in px from the top left of the heading box, from css/laps-heading.css.
SPEC = {
    "title": (0, 20),
    "back": (0, 100),
    "s1": (572, 24),
    "s2": (768, 24),
    "s3": (768, 84),
    "intro": (0, 170),
}
TOLERANCE = 2


def heading_boxes(page):
    """Each part's box, relative to the heading's box, read from the rendered page."""
    return page.evaluate(
        """() => {
            const hero = document.querySelector('.lh-hero');
            const box = hero.querySelector(':scope > .wrap').getBoundingClientRect();
            const at = (sel) => {
                const e = hero.querySelector(sel);
                if (!e) return null;
                const r = e.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return null;
                return [Math.round(r.x - box.x), Math.round(r.y - box.y), Math.round(r.width), Math.round(r.height)];
            };
            return {
                title: at('.lh-title'),
                back: at('.lh-back'),
                s1: at('.lh-s1'),
                s2: at('.lh-s2'),
                s3: at('.lh-s3'),
                intro: at('.lh-intro, .lh-fold'),
                size: [Math.round(box.width), Math.round(box.height)],
            };
        }"""
    )


@pytest.mark.parametrize("name", list(PAGES))
def test_the_heading_is_the_shared_box_on_desktop(page, name):
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(f"/{name}")
    expect(page.locator(".lh-title")).to_be_visible()
    if name == "track.html":
        # The Add a session button only shows for a member with a list; show it here to measure its slot.
        page.evaluate("() => { const a = document.getElementById('tp-hero-actions'); if (a) a.hidden = false; }")
    boxes = heading_boxes(page)
    assert boxes["size"] == [1000, 146], boxes

    for part in ("title", "back", "intro"):
        assert boxes[part] is not None, f"{name}: no {part}"
        x, y = SPEC[part]
        assert abs(boxes[part][0] - x) <= TOLERANCE and abs(boxes[part][1] - y) <= TOLERANCE, (name, part, boxes[part])

    for slot, label in PAGES[name].items():
        assert boxes[slot] is not None, f"{name}: no button in {slot} ({label})"
        x, y = SPEC[slot]
        assert abs(boxes[slot][0] - x) <= TOLERANCE and abs(boxes[slot][1] - y) <= TOLERANCE, (name, slot, label, boxes[slot])
        assert abs(boxes[slot][2] - 190) <= TOLERANCE, (name, slot, label, boxes[slot])


def test_a_saved_heading_layout_is_applied_on_desktop(page):
    """The layout the editor saves to the site is what every visitor sees on desktop, not only the editor."""
    import json
    layout = {"success": True, "layout": {"desk": {"H": 200, "items": {
        "title": {"x": 0, "y": 30, "w": 320, "h": 52, "fs": 36},
        "s1": {"x": 600, "y": 30, "w": 190, "h": 52, "fs": 16},
    }}}}
    page.route("**/laps/heading-layout", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(layout)))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/track.html")
    page.wait_for_selector("#laps-heading-layout", state="attached")
    boxes = heading_boxes(page)
    assert boxes["size"] == [1000, 200], boxes
    assert boxes["title"][1] == 30, boxes
    assert boxes["s1"][0] == 600 and boxes["s1"][1] == 30, boxes


def test_the_editor_saves_the_layout_to_the_site_by_role(page):
    """Save to site posts the desktop positions keyed by role, so every page can place its own items the same way."""
    import json
    sent = {}

    def capture(route):
        sent["url"] = route.request.url
        sent["body"] = json.loads(route.request.post_data or "{}")
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": sent["body"]}))

    page.route("**/laps/heading-layout/admin**", capture)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/track.html?layout=edit")
    expect(page.locator("#layout-edit-bar")).to_be_attached()
    page.locator('[data-le="site"]').click()
    page.wait_for_function("() => document.querySelector('[data-le=\"site-msg\"]').textContent.startsWith('Saved')")
    assert "key=test-key" in sent["url"], sent
    items = sent["body"]["items"]
    assert sent["body"]["frame"] == "desk", sent
    assert "title" in items and "s1" in items, items
    assert set(items) <= {"title", "back", "s1", "s2", "s3", "intro"}, items
    assert sent["body"]["H"] > 0, sent


def test_a_saved_phone_heading_layout_is_applied_on_a_phone(page):
    """The phone layout the editor saves is applied at phone width, and the desktop one is left alone."""
    import json
    layout = {"success": True, "layout": {"phone": {"H": 260, "items": {
        "title": {"x": 10, "y": 40, "w": 300, "h": 40, "fs": 26},
    }}}}
    page.route("**/laps/heading-layout", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(layout)))
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/track.html")
    page.wait_for_selector("#laps-heading-layout", state="attached")
    boxes = page.evaluate("""() => {
      const hero = document.querySelector('.lh-hero');
      const wrap = hero.querySelector(':scope > .wrap').getBoundingClientRect();
      const t = hero.querySelector('.lh-title').getBoundingClientRect();
      return { h: Math.round(wrap.height), x: Math.round(t.left - wrap.left), y: Math.round(t.top - wrap.top) };
    }""")
    assert boxes["h"] == 260 and boxes["x"] == 10 and boxes["y"] == 40, boxes


def test_the_editor_saves_a_phone_layout_for_the_phone_frame(page):
    import json
    sent = {}

    def capture(route):
        sent["body"] = json.loads(route.request.post_data or "{}")
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}))

    page.route("**/laps/heading-layout/admin**", capture)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/track.html?layout=edit")
    expect(page.locator("#layout-edit-bar")).to_be_attached()
    page.locator('[data-le="site"]').click()
    page.wait_for_function("() => document.querySelector('[data-le=\"site-msg\"]').textContent.startsWith('Saved')")
    assert sent["body"]["frame"] == "phone", sent


def test_the_editor_takes_the_leaderboards_action_button_as_an_item(page):
    """The Add a session button is hidden for a moment while the page settles; the editor waits for it, so it can be moved."""
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/leaderboards.html?layout=edit")
    page.wait_for_selector("[data-layout-name*='early preview'], [data-layout-name*='Add a session']", timeout=8000)
    names = page.evaluate("() => [...document.querySelectorAll('[data-layout-name]')].map(e => e.dataset.layoutName)")
    assert any("early preview" in n or "Add a session" in n for n in names), names


def test_the_editor_starts_from_the_site_layout_and_keeps_back(page):
    """The editor shows the layout visitors see (its height), and the Back button stays in it on the Sessions page."""
    import json
    layout = {"success": True, "layout": {"desk": {"H": 200, "items": {}}}}
    page.route("**/laps/heading-layout", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(layout)))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/track.html?layout=edit")
    page.wait_for_function("() => document.querySelector('.page-hero > .wrap').style.height === '200px'", timeout=8000)
    page.wait_for_function("() => [...document.querySelectorAll('[data-layout-name]')].some(e => e.dataset.layoutName.includes('Back'))", timeout=8000)


@pytest.mark.parametrize("name", ["track.html", "leaderboards.html", "my-analysis.html", "favourites.html"])
def test_what_is_the_page_opens_from_the_question_mark_on_desktop_without_pushing_the_page(page, name):
    """On all four heading pages the ? button by the title opens the "What is ...?" text as a panel over the page."""
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(f"/{name}")
    question = page.locator(".lh-title .tp-what-q").first
    expect(question).to_be_visible()
    fold = page.locator(".lh-hero .lh-fold").first
    assert not fold.evaluate("e => e.open")
    # Shut, the heading shows only the ? button, not the summary line.
    assert fold.locator("> summary").evaluate("e => getComputedStyle(e).display") == "none"
    height = "() => Math.round(document.querySelector('.lh-hero').getBoundingClientRect().height)"
    page.wait_for_timeout(1500)  # the page settles (its buttons and sizes) before the first measure
    before = page.evaluate(height)
    question.click()
    expect(fold).to_have_js_property("open", True)
    page.wait_for_timeout(300)
    assert page.evaluate(height) == before, f"{name}: the open panel pushed the page down"


def test_the_editor_leaves_out_the_what_is_panel_which_opens_from_the_question_mark(page):
    """The What is ...? panel has no place of its own in the editor (it opens from the ? button), so it is not an item."""
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/track.html?layout=edit")
    page.wait_for_selector("[data-layout-name*='Back']", timeout=8000)
    names = page.evaluate("() => [...document.querySelectorAll('[data-layout-name]')].map(e => e.dataset.layoutName)")
    assert not any("What are Sessions" in n for n in names), names
