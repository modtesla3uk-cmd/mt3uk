"""The homepage intro splash plays on the first visit on each phone or
computer only: a new tab, a link from an email or chat, or the browser
reopening doesn't bring it back (it is remembered in localStorage)."""
from test_devices import device_page, browsers, all_devices, diagnostics  # noqa: F401


def clear_seen(page):
    page.add_init_script("try { if (!sessionStorage.getItem('introTest')) { sessionStorage.setItem('introTest', '1'); sessionStorage.removeItem('mt3ukIntroSeen'); localStorage.removeItem('mt3ukIntroSeen'); } } catch (e) {}")


@all_devices
def test_intro_plays_on_the_first_visit_only(device_page):
    page = device_page
    clear_seen(page)
    page.goto("/index.html")
    intro = page.locator("#mt3uk-intro")
    intro.wait_for(state="visible", timeout=5000)
    intro.click()
    intro.wait_for(state="detached", timeout=5000)
    assert page.evaluate("localStorage.getItem('mt3ukIntroSeen')") == "1"

    # A new tab has an empty sessionStorage but the same localStorage.
    tab = page.context.new_page()
    tab.add_init_script("try { sessionStorage.removeItem('mt3ukIntroSeen'); } catch (e) {}")
    tab.goto("/index.html")
    assert tab.evaluate("sessionStorage.getItem('mt3ukIntroSeen')") is None
    tab.wait_for_timeout(800)
    assert tab.locator("#mt3uk-intro").count() == 0
    tab.close()

    page.goto("/gallery.html")
    page.goto("/index.html")
    page.wait_for_timeout(800)
    assert page.locator("#mt3uk-intro").count() == 0

    # ?intro=1 still shows it, to check how it looks.
    page.goto("/index.html?intro=1")
    page.locator("#mt3uk-intro").wait_for(state="visible", timeout=5000)
    assert page.errors == [], diagnostics(page)
