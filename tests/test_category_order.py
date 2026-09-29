"""Members can hold a homepage category tile and drag it to rearrange the
grid. The order is kept in the browser and can be reset."""
from test_devices import device_page, browsers, all_devices, overflow_width  # noqa: F401


def order(page):
    return page.eval_on_selector_all(".categories-grid.hp-cats .hp-cat[data-cat]", "els => els.map(e => e.dataset.cat)")


@all_devices
def test_hold_and_drag_rearranges_categories(device_page):
    page = device_page
    page.goto("/index.html")
    grid = page.locator(".categories-grid.hp-cats")
    grid.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    start = order(page)
    assert start[0] == "garage" and start[-1] == "interviews"

    # Hold the first tile, then drag it over the last one.
    first = page.locator('.hp-cat[data-cat="garage"]').bounding_box()
    last = page.locator('.hp-cat[data-cat="interviews"]').bounding_box()
    page.mouse.move(first["x"] + 20, first["y"] + 20)
    page.mouse.down()
    page.wait_for_timeout(500)
    for step in range(1, 11):
        page.mouse.move(first["x"] + 20 + (last["x"] + last["width"] - 30 - first["x"] - 20) * step / 10,
                        first["y"] + 20 + (last["y"] + last["height"] / 2 - first["y"] - 20) * step / 10)
        page.wait_for_timeout(30)
    page.mouse.up()
    page.wait_for_timeout(300)

    moved = order(page)
    assert moved[-1] == "garage", moved
    assert page.url.endswith("/index.html"), "Dropping a tile should not open it"
    assert page.locator("#hp-cat-reset").is_visible()
    assert overflow_width(page) <= 1

    # The order is remembered, and Reset puts it back.
    page.reload()
    page.locator(".categories-grid.hp-cats").wait_for()
    assert order(page) == moved
    page.click("#hp-cat-reset")
    assert order(page) == start
    assert page.errors == []


@all_devices
def test_a_quick_tap_still_opens_the_tile(device_page):
    page = device_page
    page.goto("/index.html")
    tile = page.locator('.hp-cat[data-cat="shop"]')
    tile.scroll_into_view_if_needed()
    tile.click()
    page.wait_for_url("**/shop.html", timeout=5000)


@all_devices
def test_any_order_fits_the_screen(device_page):
    """Every tile fits wherever it's moved, including the wide ones."""
    page = device_page
    page.goto("/index.html")
    page.locator(".categories-grid.hp-cats").wait_for()
    for first in ("interviews", "garage", "events", "track", "shop"):
        page.evaluate("""k => { try { localStorage.setItem('mt3ukCategoryOrder', JSON.stringify([k])); } catch (e) {} }""", first)
        page.reload()
        page.locator(".categories-grid.hp-cats").wait_for()
        assert order(page)[0] == first
        assert overflow_width(page) <= 1, "Page wider than the screen with %s first" % first
        grid = page.locator(".categories-grid.hp-cats").bounding_box()
        for box in page.eval_on_selector_all(".hp-cat[data-cat]", "els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; })"):
            assert box[1] <= grid["x"] + grid["width"] + 1, (first, box)


@all_devices
def test_scroll_cue_jumps_to_section_01(device_page):
    page = device_page
    page.emulate_media(reduced_motion="reduce")
    page.goto("/index.html")
    cue = page.locator("#hp-scroll-cue")
    cue.wait_for(timeout=5000)
    hero = page.locator("#hp-hero").bounding_box()
    box = cue.bounding_box()
    assert hero["y"] < box["y"] and box["y"] + box["height"] <= hero["y"] + hero["height"] + 1, "Chevron should sit at the bottom of the hero"
    cue.click()
    page.wait_for_timeout(1200)
    header_bottom = page.evaluate("document.querySelector('header').getBoundingClientRect().bottom")
    section_top = page.evaluate("document.querySelector('.categories-section').getBoundingClientRect().top")
    assert abs(section_top - header_bottom) <= 3, (section_top, header_bottom)
    assert page.errors == []
