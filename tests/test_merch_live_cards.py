import json

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


def test_live_products_render_with_discount_pricing(page):
    page.goto("/shop.html")
    cards = page.locator("#shop-live-products .shop-live-card")
    assert cards.count() == 2

    tee_card = cards.first
    assert "SAVE 10%" in tee_card.locator(".tee-offer-save").inner_text()
    assert "22.99" in tee_card.locator(".tee-offer-was").inner_text()
    assert "20.69" in tee_card.locator(".tee-offer-now").inner_text()


def test_available_and_sold_out_tags_reflect_product_state(page):
    page.goto("/shop.html")
    cards = page.locator("#shop-live-products .shop-live-card")

    assert cards.nth(0).locator(".tag").inner_text() == "AVAILABLE NOW"
    assert cards.nth(1).locator(".tag").inner_text() == "SOLD OUT"


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
