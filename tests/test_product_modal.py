MODAL = "#brace-modal"


def _assert_open(page):
    modal = page.locator(MODAL)
    assert "open" in (modal.get_attribute("class") or "")
    assert modal.get_attribute("aria-hidden") == "false"


def _assert_closed(page):
    modal = page.locator(MODAL)
    assert "open" not in (modal.get_attribute("class") or "")
    assert modal.get_attribute("aria-hidden") == "true"


def test_main_image_opens_modal(page):
    page.goto("/shop.html")
    page.locator("#brace-trigger").click()
    _assert_open(page)
    assert "£95" in page.locator(f"{MODAL} .tee-offer-now").inner_text()


def test_secondary_thumbnail_opens_modal(page):
    page.goto("/shop.html")
    page.locator("#brace-trigger-2").click()
    _assert_open(page)


def test_more_detail_button_expands_accordion(page):
    page.goto("/shop.html")
    toggle = page.locator("#brace .detail-toggle")
    content = page.locator("#brace-detail-content")
    assert toggle.get_attribute("aria-expanded") == "false"
    toggle.click()
    assert toggle.get_attribute("aria-expanded") == "true"
    assert content.is_visible()


def test_available_now_and_more_detail_are_visually_symmetrical(page):
    page.goto("/shop.html")
    tag = page.locator("#brace .tag")
    detail_btn = page.locator("#brace .detail-toggle")

    tag_box = tag.evaluate(
        "el => { const s = getComputedStyle(el); return { padding: s.padding, fontSize: s.fontSize, borderWidth: s.borderWidth }; }"
    )
    detail_box = detail_btn.evaluate(
        "el => { const s = getComputedStyle(el); return { padding: s.padding, fontSize: s.fontSize, borderWidth: s.borderWidth }; }"
    )

    assert tag_box == detail_box


def test_close_button_closes_modal(page):
    page.goto("/shop.html")
    page.locator("#brace-trigger").click()
    _assert_open(page)

    page.locator(f"{MODAL} .tee-modal-close").click()
    _assert_closed(page)


def test_close_button_closes_modal_on_mobile_viewport(page):
    # Regression guard: on mobile the modal panel's reduced padding used to
    # let .tee-modal-media overlap and eat the close button's tap target.
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/shop.html")
    page.locator("#brace-trigger").click()
    _assert_open(page)

    close_btn = page.locator(f"{MODAL} .tee-modal-close")
    box = close_btn.bounding_box()
    center_x = box["x"] + box["width"] / 2
    center_y = box["y"] + box["height"] / 2
    element_at_point = page.evaluate(
        "([x, y]) => { const el = document.elementFromPoint(x, y); return el && el.className; }",
        [center_x, center_y],
    )
    assert element_at_point == "tee-modal-close"

    close_btn.click()
    _assert_closed(page)


def test_escape_key_closes_modal(page):
    page.goto("/shop.html")
    page.locator("#brace-trigger").click()
    _assert_open(page)

    page.keyboard.press("Escape")
    _assert_closed(page)


def test_clicking_backdrop_closes_modal(page):
    page.goto("/shop.html")
    page.locator("#brace-trigger").click()
    _assert_open(page)

    page.locator(MODAL).click(position={"x": 5, "y": 5})
    _assert_closed(page)


def test_hovering_brace_image_applies_zoom(page):
    page.goto("/shop.html")
    trigger = page.locator("#brace-trigger")
    trigger.hover()
    img = trigger.locator("img")
    assert "zoom-pan" in (img.get_attribute("class") or "")
    transform = img.evaluate(
        """el => new Promise(resolve => {
            const done = () => resolve(getComputedStyle(el).transform);
            if (getComputedStyle(el).transform === 'matrix(4, 0, 0, 4, 0, 0)') { done(); return; }
            el.addEventListener('transitionend', done, { once: true });
            setTimeout(done, 2000);
        })"""
    )
    assert transform == "matrix(4, 0, 0, 4, 0, 0)"
