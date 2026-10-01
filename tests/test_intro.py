"""The homepage intro (the logo, then what MT3UK has and Join free) plays on
the first visit on each phone or computer only: a new tab, a link from an email or chat, or the browser
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
    intro.locator(".ix-look").click()
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


@all_devices
def test_intro_says_what_is_here_and_can_be_played_again(device_page):
    page = device_page
    clear_seen(page)
    page.goto("/index.html")
    intro = page.locator("#mt3uk-intro")
    intro.wait_for(state="visible", timeout=5000)
    tiles = intro.locator(".ix-finds a")
    assert tiles.count() == 8
    assert [tiles.nth(i).locator("b").inner_text() for i in range(8)] == [
        "Member builds", "Build of the Week", "My Garage", "Owner Interviews",
        "Meets and events", "Track day guides", "Track leaderboards", "Shop"]
    assert tiles.nth(6).get_attribute("href") == "leaderboards.html"
    # Says plainly that the site is separate from the Facebook group.
    assert "separate from the MT3UK Facebook group" in intro.locator(".ix-fb").inner_text()
    assert intro.locator(".ix-join").get_attribute("href") == "signin.html?next=%2F"
    page.wait_for_timeout(3800)
    assert page.evaluate("document.getElementById('mt3uk-intro').scrollWidth <= window.innerWidth")
    # Escape closes it.
    page.keyboard.press("Escape")
    intro.wait_for(state="detached", timeout=5000)

    # "Play intro" on the first screen brings it back without leaving the
    # page.
    page.evaluate("window.scrollTo(0, 0)")
    link = page.locator("#hp-hero #play-intro")
    assert link.count() == 1
    box = link.bounding_box()
    assert box and box["y"] + box["height"] <= page.viewport_size["height"], "On the first screen"
    link.click()
    intro.wait_for(state="visible", timeout=5000)
    assert page.url.endswith("/index.html")
    intro.locator(".ix-skip").click()
    intro.wait_for(state="detached", timeout=5000)
    assert page.errors == [], diagnostics(page)


def test_intro_is_silent():
    from pathlib import Path
    html = (Path(__file__).resolve().parent.parent / "index.html").read_text(encoding="utf-8")
    intro = html.split("<!-- MT3UK intro:", 1)[1].split("</script>", 1)[0]
    assert "AudioContext" not in intro and "whoosh" not in intro
