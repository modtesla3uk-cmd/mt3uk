import json

from playwright.sync_api import expect

import pytest

SHOP_ENDPOINT_PATTERN = "**/shop-products"

FAKE_PRODUCTS = {
    "success": True,
    "products": [
        {
            "handle": "black-mt3uk-tee-red-underline-super-soft",
            "title": "MT3UK Tee",
            "url": "https://example-shop.myshopify.com/products/mt3uk-tee",
            "images": ["https://example.com/tee.jpg"],
            "available": True,
            "minPrice": 22.99,
            "maxPrice": 22.99,
        },
        {
            "handle": "mt3uk-official-stickers-white-red-line-3-pack",
            "title": "MT3UK Official Stickers",
            "url": "https://example-shop.myshopify.com/products/mt3uk-stickers",
            "images": ["https://example.com/stickers.jpg"],
            "available": False,
            "minPrice": 5.99,
            "maxPrice": 5.99,
        },
    ],
}


@pytest.fixture(autouse=True)
def mock_shop_endpoint(page):
    page.route(
        SHOP_ENDPOINT_PATTERN,
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(FAKE_PRODUCTS),
        ),
    )
    page.route(
        "**/shop/home",
        lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True})),
    )


TEE = "black-mt3uk-tee-red-underline-super-soft"


def route_offer(page, offer):
    page.route(
        "**/shop/home",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"success": True, "offer": offer}),
        ),
    )


def live_offer(percent, **extra):
    offer = {"on": True, "heading": "Spring offer", "percent": percent, "code": "", "start": "", "end": "",
             "items": [{"id": TEE, "name": "MT3UK Tee"}]}
    offer.update(extra)
    return offer


def test_a_product_in_a_live_offer_shows_the_offers_percentage_off_its_list_price(page):
    route_offer(page, live_offer(15))
    page.goto("/shop.html")
    cards = page.locator("#shop-live-products .shop-live-card")
    expect(cards).to_have_count(2)

    tee_card = cards.first
    assert "Save 15%" in tee_card.locator(".tee-offer-save").inner_text()
    assert "22.99" in tee_card.locator(".tee-offer-was").inner_text()
    # 22.99 less 15% is 19.54 (rounded to the penny, as the homepage does).
    assert "19.54" in tee_card.locator(".tee-offer-now").inner_text()


def test_a_product_outside_the_offer_shows_its_price_with_no_discount_pill(page):
    route_offer(page, live_offer(15, items=[{"id": "some-other-product", "name": "Other"}]))
    page.goto("/shop.html")
    cards = page.locator("#shop-live-products .shop-live-card")
    expect(cards).to_have_count(2)

    tee_card = cards.first
    assert tee_card.locator(".tee-offer-save").count() == 0
    assert "22.99" in tee_card.locator(".tee-price-now").inner_text()


def test_the_discount_pill_follows_a_change_to_the_offer(page):
    route_offer(page, live_offer(15))
    page.goto("/shop.html")
    expect(page.locator("#shop-live-products .shop-live-card").first.locator(".tee-offer-save")).to_have_text("Save 15%")

    # The admin changes the offer to 25%: the next visit shows the new percentage and price.
    route_offer(page, live_offer(25))
    page.goto("/shop.html")
    tee_card = page.locator("#shop-live-products .shop-live-card").first
    expect(tee_card.locator(".tee-offer-save")).to_have_text("Save 25%")
    assert "17.24" in tee_card.locator(".tee-offer-now").inner_text()


def test_an_offer_outside_its_dates_gives_no_discount(page):
    import datetime

    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    route_offer(page, live_offer(15, end=yesterday))
    page.goto("/shop.html")
    tee_card = page.locator("#shop-live-products .shop-live-card").first
    expect(tee_card).to_be_visible()
    assert tee_card.locator(".tee-offer-save").count() == 0
    assert "22.99" in tee_card.locator(".tee-price-now").inner_text()


def test_available_and_sold_out_tags_reflect_product_state(page):
    page.goto("/shop.html")
    cards = page.locator("#shop-live-products .shop-live-card")

    assert cards.nth(0).locator(".tag").inner_text() == "Available now"
    assert cards.nth(1).locator(".tag").inner_text() == "Sold out"


def test_shop_now_link_carries_utm_params(page):
    page.goto("/shop.html")
    link = page.locator("#shop-live-products .shop-live-card").first.locator(".tee-shop-btn")
    href = link.get_attribute("href")
    assert href.startswith("https://example-shop.myshopify.com/products/mt3uk-tee?")
    assert "utm_source=mt3uk_shop" in href
    assert "utm_medium=internal" in href
    assert "utm_campaign=live_merch" in href


def test_hovering_live_product_image_applies_zoom(page):
    page.goto("/shop.html")
    trigger = page.locator("#shop-live-products .shop-preview-trigger").first
    trigger.hover()
    img = trigger.locator("img")
    assert "zoom-pan" in (img.get_attribute("class") or "")


def test_each_product_shows_its_own_units_sold_from_the_figures_typed_in(page):
    """The units sold come from the figures typed in on the admin's Shop panel (GET /shop/sales): each card shows its own
    count, and a product with none typed in shows the figure in data/merch-sales.json."""
    page.route(
        "**/shop/sales",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"success": True, "byHandle": {"black-mt3uk-tee-red-underline-super-soft": 4}}),
        ),
    )
    page.goto("/shop.html")
    cards = page.locator("#shop-live-products .shop-live-card")
    expect(cards).to_have_count(2)
    expect(cards.first.locator(".merch-sold-line")).to_have_text("🔥 4 sold since launch")
    # The stickers have no figure typed in, so they show the figure in data/merch-sales.json.
    expect(cards.nth(1).locator(".merch-sold-line")).to_have_text("🔥 5 sold since launch")


def test_with_no_figures_typed_in_the_cards_use_the_sales_file(page):
    """With no figures typed in, the page uses data/merch-sales.json, as it did before."""
    page.route(
        "**/shop/sales",
        lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "byHandle": {}})),
    )
    page.goto("/shop.html")
    cards = page.locator("#shop-live-products .shop-live-card")
    expect(cards).to_have_count(2)
    expect(cards.first.locator(".merch-sold-line")).to_have_text("🔥 3 sold since launch")


def route_discounts(page, byHandle):
    page.route(
        "**/shop/discounts",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"success": True, "byHandle": byHandle}),
        ),
    )


def test_a_discount_set_on_the_admin_shop_panel_shows_on_the_product_card(page):
    route_discounts(page, {TEE: 20})
    page.goto("/shop.html")
    tee_card = page.locator("#shop-live-products .shop-live-card").first
    expect(tee_card.locator(".tee-offer-save")).to_have_text("Save 20%")
    assert "22.99" in tee_card.locator(".tee-offer-was").inner_text()
    # 22.99 less 20% is 18.39.
    assert "18.39" in tee_card.locator(".tee-offer-now").inner_text()


def test_a_discount_set_on_the_admin_shop_panel_follows_a_change(page):
    route_discounts(page, {TEE: 20})
    page.goto("/shop.html")
    expect(page.locator("#shop-live-products .shop-live-card").first.locator(".tee-offer-save")).to_have_text("Save 20%")

    route_discounts(page, {TEE: 30})
    page.goto("/shop.html")
    tee_card = page.locator("#shop-live-products .shop-live-card").first
    expect(tee_card.locator(".tee-offer-save")).to_have_text("Save 30%")
    # 22.99 less 30% is 16.09.
    assert "16.09" in tee_card.locator(".tee-offer-now").inner_text()


def test_a_product_discount_wins_over_the_homepage_offer_percentage(page):
    route_discounts(page, {TEE: 20})
    route_offer(page, live_offer(15))
    page.goto("/shop.html")
    tee_card = page.locator("#shop-live-products .shop-live-card").first
    expect(tee_card.locator(".tee-offer-save")).to_have_text("Save 20%")
