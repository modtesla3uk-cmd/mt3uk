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
