import pytest


NAV_PAGES = [
    "index", "gallery", "my-builds", "track", "leaderboards", "signin", "profile", "privacy", "shop", "reviews", "contact", "event",
    "track-day-on-the-day", "track-day-prep", "track-day-venues",
    "blog", "blog-aaron", "blog-john", "blog-kam", "blog-yusuf", "blog-romil", "blog-unicorn", "blog-john-track-day", "blog-ryan", "blog-sharad", "blog-mark", "blog-myk-track-day", "blog-myk",
    "blog-richard", "blog-richie",
]


@pytest.mark.parametrize("page_name", NAV_PAGES)
def test_my_garage_nav_link_has_no_new_badge(page, page_name):
    page.goto(f"/{page_name}.html")
    my_garage_link = page.locator("a.nav-link-mybuilds")
    assert my_garage_link.count() == 1
    badge_content = my_garage_link.evaluate(
        "el => getComputedStyle(el, '::after').content"
    )
    assert "NEW" not in badge_content


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
