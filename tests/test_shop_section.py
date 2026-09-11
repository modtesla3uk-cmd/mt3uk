def test_shop_nav_link_has_new_badge(page):
    page.goto("/index.html")
    shop_link = page.locator(".nav-link-shop")
    assert shop_link.count() == 1
    badge_content = shop_link.evaluate(
        "el => getComputedStyle(el, '::after').content"
    )
    assert "NEW" in badge_content


def test_shop_page_merch_comes_before_upgrades(page):
    page.goto("/shop.html")
    order = page.evaluate(
        """
        () => {
            const ids = ['merch', 'upgrades'];
            const positions = ids.map(id => {
                const el = document.getElementById(id);
                return el ? el.getBoundingClientRect().top + window.scrollY : null;
            });
            return positions;
        }
        """
    )
    merch_top, upgrades_top = order
    assert merch_top is not None and upgrades_top is not None
    assert merch_top < upgrades_top
