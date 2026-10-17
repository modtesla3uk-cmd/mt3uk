"""The Shop list, the Offers card and the Shop card: the admin panel on admin.html and the homepage cards."""
import json
import re

from playwright.sync_api import expect

from test_admin_pages import open_admin

CORS = {"Access-Control-Allow-Origin": "*"}


def no_saved_layout(route):
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS)
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
    page.route("**/home/layout", no_saved_layout)
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
    page.route("**/home/layout", no_saved_layout)
    page.goto("/index.html")
    expect(page.locator(".hp-offer-card")).to_contain_text("More offers soon")
    expect(page.locator(".hp-shop-card")).to_be_visible()


def test_the_homepage_cards_fit_a_phone_without_sideways_scroll(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.set_viewport_size({"width": 390, "height": 844})
    page.route("**/home/layout", no_saved_layout)
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
    assert set(posts[-1]["layout"]["desk"]["items"]) == {"latest", "laps", "next", "join", "offer", "shop", "note", "stats"}


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


def test_a_returning_visitor_sees_the_saved_layout_and_hero_picture_before_the_worker_answers(page):
    """The layout and the hero picture are kept in this browser, so a refresh draws them at once, not the default first."""
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');"
                         "localStorage.setItem('mt3ukHomeFirst', JSON.stringify({layout: %s, hero: {value: 'url(\"images/kept.jpg\")', pos: 'center top'}}));}catch(e){}"
                         % json.dumps(SAVED_LAYOUT["desk"]))
    # The worker does not answer: the saved copy alone must place the cards and the picture.
    page.route("**/home/layout", lambda r: r.abort())
    page.route("**/shop/home", lambda r: r.abort())
    # With the interview data also out of reach, nothing replaces the kept picture, so it is what the page is drawn with.
    page.route("**/data/interviews.json*", lambda r: r.abort())
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    assert page.evaluate("getComputedStyle(document.querySelector('#hp-hero .hp-hero-card')).position") == "absolute"
    assert page.evaluate("getComputedStyle(document.querySelector('#hp-hero .hp-hero-card')).left") == "0px"
    # The picture is set by the early style sheet; the page's own hero code replaces it once the interview data arrives.
    assert "kept.jpg" in page.evaluate("document.getElementById('hp-first').textContent")


def test_a_card_saved_above_the_frame_is_not_drawn_under_the_header(page):
    """A card may rise at most 60px above the frame, so no card hides under the sticky header and the top of the page stays reachable."""
    high = json.loads(json.dumps(SAVED_LAYOUT["desk"]))
    high["items"]["latest"]["y"] = -150
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');"
                         "localStorage.setItem('mt3ukHomeFirst', JSON.stringify({layout: %s}));}catch(e){}" % json.dumps(high))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json",
                                                    body=json.dumps({"success": True, "layout": {"desk": high}})))
    page.route("**/shop/home", lambda r: r.abort())
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    top = page.evaluate("""() => {
      const card = document.querySelector('#hp-hero .hp-hero-card').getBoundingClientRect();
      const cols = document.querySelector('.hp-cols').getBoundingClientRect();
      return card.top - cols.top;
    }""")
    assert top >= -60


def test_the_homepage_editor_has_a_grid_and_moves_a_card_by_keyboard(page):
    """The editor draws a grid like Laps, and a card that takes the keyboard moves 1px per arrow (10px with Shift)."""
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html?layout=edit")
    expect(page.locator("#hl-bar")).to_be_visible()
    assert "linear-gradient" in page.evaluate("document.querySelector('.hp-cols').style.backgroundImage")
    page.locator("#hl-bar [data-a=gridsize]").select_option("16")
    assert page.evaluate("document.querySelector('.hp-cols').style.backgroundSize") == "16px 16px"
    page.locator("#hl-bar [data-a=grid]").click()
    assert page.evaluate("document.querySelector('.hp-cols').style.backgroundImage") == ""
    card = page.locator("#hp-hero .hp-hero-card")
    card.focus()
    before = page.evaluate("[parseFloat(document.querySelector('#hp-hero .hp-hero-card').style.left), parseFloat(document.querySelector('#hp-hero .hp-hero-card').style.top)]")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowUp")
    page.keyboard.press("Shift+ArrowDown")
    after = page.evaluate("[parseFloat(document.querySelector('#hp-hero .hp-hero-card').style.left), parseFloat(document.querySelector('#hp-hero .hp-hero-card').style.top)]")
    assert after == [before[0] + 1, before[1] - 1 + 10]


def test_the_homepage_cards_use_one_body_text_size_on_desktop(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    sizes = page.evaluate("""() => [...new Set([
      '#hp-hero .hp-hero-excerpt', '#hp-hero-next .hp-next-sub', '#hp-join p', '#hp-hero .hp-laps-text',
      '#hp-shop-cards .hp-card-text', '#hp-shop-cards .hp-card-list li'
    ].map(s => getComputedStyle(document.querySelector(s)).fontSize))]""")
    assert sizes == ["14.4px"]


def test_each_homepage_card_has_a_share_button_at_its_top_right(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    expect(page.locator(".hp-card-share")).to_have_count(6)
    places = page.evaluate("""() => [...document.querySelectorAll('.hp-card-share')].map(b => {
      const card = b.parentElement.getBoundingClientRect(), r = b.getBoundingClientRect();
      return [r.top - card.top, card.right - r.right];
    })""")
    for top, right in places:
        assert 0 <= top <= 16 and 0 <= right <= 16


def test_the_share_button_shares_the_cards_link_when_there_is_a_share_sheet(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');"
                         "window.__shared=null;navigator.share=function(d){window.__shared=d;return Promise.resolve();};}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    page.locator("#hp-shop-cards .hp-shop-card > .hp-card-share").click()
    expect(page.locator("#hp-shop-cards .hp-shop-card")).to_have_id("card-shop")
    assert page.evaluate("window.__shared && window.__shared.url") == "https://mt3uk.com/share/card/shop.html"


def test_without_a_share_sheet_the_card_link_is_copied(page):
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');"
                         "Object.defineProperty(navigator,'share',{value:undefined,configurable:true});}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html")
    page.locator("#hp-hero .hp-hero-card > .hp-card-share").click()
    expect(page.locator("#hp-hero .hp-hero-card > .hp-card-share")).to_have_attribute("aria-label", "Link copied")
    assert page.evaluate("navigator.clipboard.readText()") == "https://mt3uk.com/share/card/latest.html"


def test_a_card_address_brings_the_visitor_to_that_card(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html#card-shop")
    expect(page.locator("#card-shop")).to_have_class(re.compile("hp-card-landed"))


def test_the_share_buttons_are_left_out_of_the_layout_editor(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html?layout=edit")
    expect(page.locator(".hp-cols")).to_have_class(re.compile("hl-edit"))
    expect(page.locator("#hp-shop-cards .hp-shop-card > .hp-card-share")).to_be_hidden()


def test_the_homepage_editor_numbers_each_card_with_its_place_on_a_phone(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html?layout=edit")
    expect(page.locator(".hp-cols")).to_have_class(re.compile("hl-edit"))
    numbers = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.hp-cols [data-hl]')].map(
      el => [el.getAttribute('data-hl'), el.querySelector('.hl-phone-no').textContent]))""")
    assert numbers == {"latest": "Phone 1", "next": "Phone 2", "join": "Phone 3", "offer": "Phone 4", "laps": "Phone 5", "shop": "Phone 6",
                       "note": "Phone 7", "stats": "Phone 8"}
    page.locator("#hl-bar [data-a=phone]").click()
    expect(page.locator(".hp-cols")).to_have_class(re.compile("hl-no-phone"))
    expect(page.locator("#hp-hero .hp-hero-card .hl-phone-no")).to_be_hidden()


def test_the_phone_order_is_the_order_the_editor_numbers(page):
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/index.html")
    page.wait_for_timeout(800)
    order = page.evaluate("""() => {
      const sels = {latest: '#hp-hero .hp-hero-card', laps: '#hp-hero .hp-laps-promo', next: '#hp-hero-next', join: '#hp-join',
        offer: '#hp-shop-cards .hp-offer-card', shop: '#hp-shop-cards .hp-shop-card'};
      return Object.entries(sels).map(([k, s]) => { const e = document.querySelector(s), r = e.getBoundingClientRect(); return [k, r.top, r.left]; })
        .sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(x => x[0]);
    }""")
    assert order == ["latest", "next", "join", "offer", "laps", "shop"]


def test_a_saved_layout_sets_the_phone_order_from_where_the_cards_sit_on_desktop(page):
    layout = {"H": 700, "items": {
        "latest": {"x": 0, "y": 0, "w": 430, "z": 1}, "laps": {"x": 0, "y": 300, "w": 430, "z": 1},
        "next": {"x": 600, "y": 0, "w": 400, "z": 1}, "join": {"x": 600, "y": 200, "w": 400, "z": 1},
        "offer": {"x": 600, "y": 320, "w": 400, "z": 1}, "shop": {"x": 600, "y": -40, "w": 400, "z": 1}}}
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": layout}}), headers=CORS))
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/index.html")
    page.wait_for_timeout(800)
    order = page.evaluate("""() => {
      const sels = {latest: '#hp-hero .hp-hero-card', laps: '#hp-hero .hp-laps-promo', next: '#hp-hero-next', join: '#hp-join',
        offer: '#hp-shop-cards .hp-offer-card', shop: '#hp-shop-cards .hp-shop-card'};
      return Object.entries(sels).map(([k, s]) => { const e = document.querySelector(s), r = e.getBoundingClientRect(); return [k, r.top, r.left]; })
        .sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(x => x[0]);
    }""")
    assert order == ["shop", "latest", "next", "join", "laps", "offer"]


def test_the_editor_sets_the_members_figure_and_the_other_figures_come_from_the_site(page):
    posts = []
    page.add_init_script("try{localStorage.setItem('mt3ukIntroSeen','1');localStorage.setItem('mt3uk-intro','seen');sessionStorage.setItem('mt3ukAdminKey','test-key');}catch(e){}")
    page.route("**/shop/home", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(OFFER), headers=CORS))
    page.route("**/home/layout", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "layout": {"desk": None}}), headers=CORS))
    page.route("**/home/members/admin**", lambda r: (posts.append(json.loads(r.request.post_data)), r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "members": posts[-1]["members"]}), headers=CORS)))
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto("/index.html?layout=edit")
    expect(page.locator("#hl-bar [data-hl-members]")).to_have_value("3.1K+")
    page.locator("#hl-bar [data-hl-members]").fill("3.2K+")
    page.locator("#hl-bar [data-a=members]").click()
    expect(page.locator("#hl-bar .hl-msg")).to_contain_text("Saved")
    assert posts == [{"members": "3.2K+"}]
    assert page.evaluate("document.querySelector('.hp-stats .member-count').textContent") == "3.2K+"
    # The builds and events figures are counted from the site, not typed in.
    assert page.evaluate("document.querySelector('#hp-stat-builds').textContent") != ""
