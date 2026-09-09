def test_shop_nav_link_has_new_badge(page):
    page.goto("/index.html")
    shop_link = page.locator(".nav-link-shop")
    assert shop_link.count() == 1
    badge_content = shop_link.evaluate(
        "el => getComputedStyle(el, '::after').content"
    )
    assert "NEW" in badge_content


def test_shop_section_comes_after_gallery_and_about(page):
    page.goto("/index.html")
    order = page.evaluate(
        """
        () => {
            const ids = ['about', 'gallery', 'shop'];
            const positions = ids.map(id => {
                const el = document.getElementById(id);
                return el ? el.getBoundingClientRect().top + window.scrollY : null;
            });
            return positions;
        }
        """
    )
    about_top, gallery_top, shop_top = order
    assert about_top is not None and gallery_top is not None and shop_top is not None
    assert about_top < gallery_top < shop_top
