def test_vote_nav_link_has_new_badge(page):
    page.goto("/index.html")
    vote_link = page.locator("a.nav-sublink-new[href='#vote-frame']")
    assert vote_link.count() == 1
    badge_content = vote_link.evaluate(
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
