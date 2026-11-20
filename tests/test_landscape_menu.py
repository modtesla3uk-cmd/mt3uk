import sys
sys.path.insert(0, "tests")
from test_racebox_test_page import STUB, ADMIN
def test_the_header_menu_scrolls_inside_a_short_landscape_screen(browser, base_url):
    ctx = browser.new_context(base_url=base_url, viewport={"width": 740, "height": 340}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.add_init_script(ADMIN); page.add_init_script(STUB)
    page.goto("/racebox.html")
    page.locator("#nav-toggle, .nav-toggle, .hamburger, button[aria-label*=enu]").first.tap()
    page.wait_for_timeout(400)
    r = page.evaluate("() => { const n = document.getElementById('navlinks'); n.scrollTop = 9999; const b = n.getBoundingClientRect(); return [n.scrollHeight, n.clientHeight, b.bottom, innerHeight]; }")
    assert r[2] <= r[3] and r[0] > r[1]
    ctx.close()
