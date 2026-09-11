def test_tee_card_shows_discount_offer(page):
    page.goto("/shop.html")
    card = page.locator(".shop-card").first

    assert "20% off" in card.locator(".tee-offer-banner").inner_text()
    assert "SAVE 20%" in card.locator(".tee-offer-save").inner_text()
    assert "24.99" in card.locator(".tee-offer-was").inner_text()
    assert "19.99" in card.locator(".tee-offer-now").inner_text()


def test_available_now_and_more_detail_are_visually_symmetrical(page):
    page.goto("/shop.html")
    tag = page.locator("#merch .shop-card").first.locator(".tag")
    detail_btn = page.locator("#merch .shop-card").first.locator(".detail-toggle")

    tag_box = tag.evaluate(
        "el => { const s = getComputedStyle(el); return { padding: s.padding, fontSize: s.fontSize, borderWidth: s.borderWidth }; }"
    )
    detail_box = detail_btn.evaluate(
        "el => { const s = getComputedStyle(el); return { padding: s.padding, fontSize: s.fontSize, borderWidth: s.borderWidth }; }"
    )

    assert tag_box == detail_box
