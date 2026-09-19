def test_my_garage_nav_link_has_new_badge(page):
    page.goto("/index.html")
    my_garage_link = page.locator("a.nav-link-mybuilds")
    assert my_garage_link.count() == 1
    badge_content = my_garage_link.evaluate(
        "el => getComputedStyle(el, '::after').content"
    )
    assert "NEW" in badge_content


def test_shop_page_merch_comes_before_parts(page):
    page.goto("/shop.html")
    order = page.evaluate(
        """
        () => {
            const ids = ['merch', 'parts'];
            const positions = ids.map(id => {
                const el = document.getElementById(id);
                return el ? el.getBoundingClientRect().top + window.scrollY : null;
            });
            return positions;
        }
        """
    )
    merch_top, parts_top = order
    assert merch_top is not None and parts_top is not None
    assert merch_top < parts_top
