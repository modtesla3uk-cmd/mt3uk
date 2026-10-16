"""The Shop list, the Offers card and the Shop card: the admin panel on admin.html and the homepage cards."""
import json
import re

from playwright.sync_api import expect

from test_admin_pages import open_admin

CORS = {"Access-Control-Allow-Origin": "*"}
OFFER = {
    "success": True,
    "highlights": ["Tees, hoodies and stickers", "Tevo Solutions parts for Model 3 and Y"],
    "placeholder": "More offers soon",
    "offer": {"heading": "October offers", "percent": 20, "text": "20% off selected parts this month.", "end": "2026-10-31",
              "items": [{"id": "master-cylinder-brace", "name": "Tevo Master Cylinder Brace", "price": "£95", "url": "https://www.tevo.solutions/brace"}]},
}


def test_the_homepage_shows_the_live_offer_and_the_shop_card_with_its_highlights(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    expect(page.locator("#hp-shop-cards")).to_be_visible()
    expect(page.locator(".hp-offer-card")).to_contain_text("October offers")
    expect(page.locator(".hp-offer-card")).to_contain_text("20% off")
    link = page.locator(".hp-offer-card a").first
    expect(link).to_have_attribute("href", re.compile(r"utm_source=mt3uk_shop.*utm_campaign=master-cylinder-brace_order"))
    expect(page.locator(".hp-shop-card")).to_contain_text("Tees, hoodies and stickers")
    # Dates shown as text, and the offer's copy is shown as text, not markup.
    expect(page.locator(".hp-offer-card")).to_contain_text("Until 31 Oct 2026")


def test_with_no_live_offer_the_placeholder_shows_and_the_shop_card_stays(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    no_offer = dict(OFFER, offer=None)
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(no_offer), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    expect(page.locator(".hp-offer-card")).to_contain_text("More offers soon")
    expect(page.locator(".hp-shop-card")).to_be_visible()


def test_the_homepage_cards_fit_a_phone_without_sideways_scroll(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/index.html")
    expect(page.locator(".hp-offer-card")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390


def test_admin_shop_panel_lists_products_and_saves_the_offer_with_its_items(page):
    saved = []
    products = [{"id": "master-cylinder-brace", "name": "Tevo Master Cylinder Brace", "price": "£95", "url": "", "line": ""},
                {"id": "merch", "name": "MT3UK tees", "price": "", "url": "shop.html#merch", "line": ""}]

    def admin(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            saved.append(body)
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "products": body.get("products", products), "home": body.get("home", {})}), headers=CORS)
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "products": products, "home": {}, "today": "2026-10-16"}), headers=CORS)

    open_admin(page, "admin.html")
    page.route("**/shop/home/admin**", admin)
    page.locator("#shop-cards-wrap summary").click()
    expect(page.locator("#shop-products")).to_contain_text("Tevo Master Cylinder Brace")
    page.locator("#shop-offer-on").click()
    page.fill("#shop-o-heading", "October offers")
    page.fill("#shop-o-percent", "20")
    page.fill("#shop-o-end", "2026-10-31")
    page.fill("#shop-o-text", "20% off selected parts this month.")
    page.locator("#shop-o-items .shop-pick[value='master-cylinder-brace']").check()
    page.fill("#shop-highlights", "Tees, hoodies and stickers\nTevo parts for Model 3 and Y")
    page.locator("#shop-save").click()
    expect(page.locator("#shop-note")).to_contain_text("Saved")
    home = saved[-1]["home"]
    assert home["offer"]["on"] is True and home["offer"]["percent"] == 20
    assert home["offer"]["items"] == [{"id": "master-cylinder-brace", "name": "Tevo Master Cylinder Brace", "price": "£95", "url": ""}]
    assert home["highlights"] == ["Tees, hoodies and stickers", "Tevo parts for Model 3 and Y"]


def test_admin_adds_a_product_to_the_shop_list(page):
    saved = []
    products = [{"id": "merch", "name": "MT3UK tees", "price": "", "url": "shop.html#merch", "line": ""}]

    def admin(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            saved.append(body)
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "products": body["products"], "home": {}}), headers=CORS)
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "products": products, "home": {}}), headers=CORS)

    open_admin(page, "admin.html")
    page.route("**/shop/home/admin**", admin)
    page.locator("#shop-cards-wrap summary").click()
    expect(page.locator("#shop-products")).to_contain_text("MT3UK tees")
    page.fill("#shop-p-name", "Carbotech front pads")
    page.fill("#shop-p-price", "£120")
    page.locator("#shop-product-form button").click()
    expect(page.locator("#shop-note")).to_contain_text("Added to the Shop list")
    names = [p["name"] for p in saved[-1]["products"]]
    assert names == ["MT3UK tees", "Carbotech front pads"]
    assert saved[-1]["products"][1]["id"] == "carbotech-front-pads"


SAVED_LAYOUT = {"desk": {"H": 620, "items": {"latest": {"x": 0, "y": 0, "w": 430, "z": 1}, "laps": {"x": 0, "y": 330, "w": 430, "z": 1},
                                             "next": {"x": 470, "y": 0, "w": 520, "z": 1}, "join": {"x": 470, "y": 150, "w": 520, "z": 1},
                                             "offer": {"x": 470, "y": 290, "w": 520, "z": 1}, "shop": {"x": 470, "y": 470, "w": 520, "z": 1}}}}


def test_a_saved_homepage_layout_places_the_cards_on_desktop(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": SAVED_LAYOUT}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    expect(page.locator(".hp-cols")).to_have_class(re.compile("hl-on"))
    expect(page.locator("#hp-hero .hp-hero-card")).to_have_attribute("data-hl", "latest")
    assert page.evaluate("document.querySelector('#hp-hero .hp-hero-card').style.width") == "430px"


def test_the_homepage_editor_moves_a_card_and_saves_the_layout(page):
    posts = []
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');sessionStorage.setItem('mt3ukAdminKey','test-key');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout/admin**", lambda r: (posts.append(json.loads(r.request.post_data)), r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": posts[-1]["layout"]}), headers=CORS)))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html?layout=edit")
    expect(page.locator("#hl-bar")).to_be_visible()
    expect(page.locator(".hp-cols")).to_have_class(re.compile("hl-edit"))
    card = page.locator("#hp-hero .hp-hero-card")
    box = card.bounding_box()
    start = page.evaluate("document.querySelector('#hp-hero .hp-hero-card').style.left")
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    for i in range(1, 9):
        page.mouse.move(cx + i * 10, cy + i * 5)
    page.mouse.up()
    assert page.evaluate("document.querySelector('#hp-hero .hp-hero-card').style.left") != start
    page.locator("#hl-bar [data-a=save]").click()
    expect(page.locator("#hl-bar .hl-msg")).to_contain_text("Saved")
    assert posts and posts[-1]["layout"]["desk"]["items"]["latest"]["x"] > 0
    assert set(posts[-1]["layout"]["desk"]["items"]) == {"latest", "laps", "next", "join", "offer", "shop"}


def test_admin_page_editors_section_links_each_page_editor_on_each_address(page):
    open_admin(page, "admin.html")
    section = page.locator("#grp-editors")
    expect(section).to_be_visible()
    links = section.locator("a")
    assert links.count() == 8
    hrefs = links.evaluate_all("els => els.map(e => e.getAttribute('href'))")
    assert "https://mt3uk.com/track.html?layout=edit" in hrefs
    assert "https://laps.mt3uk.com/leaderboards.html?layout=edit" in hrefs
    assert "https://test.laps.mt3uk.com/index.html?layout=edit" in hrefs
