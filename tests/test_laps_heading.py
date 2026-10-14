"""The four Laps heading pages (Sessions, Leaderboard, My Analysis, Favourites) place their parts in the same
positions on desktop. The spec is css/laps-heading.css: a 1000 x 280 px heading box, the title at the top left,
Back under it, and three button slots at the top right and under them (see the file for the numbers).

Each page marks its parts with lh-* classes. These tests measure the rendered boxes against the spec, so a page
that drifts out of line fails here. Phone is left to each page's own rules and is not checked.
"""
import pytest
from playwright.sync_api import expect

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
    assert boxes["size"] == [1000, 280], boxes

    for part in ("title", "back", "intro"):
        assert boxes[part] is not None, f"{name}: no {part}"
        x, y = SPEC[part]
        assert abs(boxes[part][0] - x) <= TOLERANCE and abs(boxes[part][1] - y) <= TOLERANCE, (name, part, boxes[part])

    for slot, label in PAGES[name].items():
        assert boxes[slot] is not None, f"{name}: no button in {slot} ({label})"
        x, y = SPEC[slot]
        assert abs(boxes[slot][0] - x) <= TOLERANCE and abs(boxes[slot][1] - y) <= TOLERANCE, (name, slot, label, boxes[slot])
        assert abs(boxes[slot][2] - 190) <= TOLERANCE, (name, slot, label, boxes[slot])
