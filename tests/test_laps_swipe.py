"""The swipe between the Laps pages, with real touches (Chrome DevTools touch events in a phone context).

A right swipe once failed only with a real finger: pushing the page past the right edge widened the phone's layout
width, so the swipe was measured against a wider screen and never got past halfway. Synthetic touch events in a desktop
context did not show it, so these tests use a phone context (is_mobile, has_touch) and drive the touches through CDP.
"""

from playwright.sync_api import expect


SIZE = {"width": 390, "height": 844}


def phone(page, base_url):
    ctx = page.context.browser.new_context(base_url=base_url, has_touch=True, is_mobile=True, viewport=SIZE)
    # No worker in the tests: every call gets a plain "no" at once, and the pages still draw their headings and footers.
    ctx.route("**/*workers.dev/**", lambda route: route.fulfill(status=200, content_type="application/json", body='{"success": false}'))
    ctx.add_init_script("""() => { try {
      localStorage.setItem('mt3ukTheme', '{"main":"gold","laps":"gold"}');
      localStorage.setItem('mt3ukLapsIntroSeen', '1');
    } catch (e) {} }""")
    return ctx


def swipe(cdp, touch, dx, steps=20, pause=40, during=None):
    """A slow, steady finger from the middle of the screen, dx pixels sideways (positive is to the right). Slow on
    purpose: a quick flick opens the next page however short it is, so it would hide a swipe that is measured wrong."""
    # The finger starts on the page's title, which is plain words on every Laps page (a drop-down or a scrolling row
    # keeps its own gesture, so a swipe there is left alone on purpose).
    box = touch.locator(".page-hero h1, main h1").first.bounding_box()
    x0, y = SIZE["width"] / 2 - dx / 2, box["y"] + box["height"] / 2
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}]})
    seen = None
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + dx * i / steps, "y": y}]})
        touch.wait_for_timeout(pause)
        if during and i == steps:
            seen = touch.evaluate(during)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    return seen


DURING = """() => {
  const f = document.querySelector('footer'), peek = document.querySelector('.laps-peek');
  return {
    width: document.documentElement.clientWidth,
    footer: f ? f.style.transform : null,
    peek: peek && getComputedStyle(peek).display !== 'none' ? peek.textContent : '',
  };
}"""


def test_a_slow_right_swipe_on_a_phone_opens_the_page_before(page, base_url):
    ctx = phone(page, base_url)
    touch = ctx.new_page()
    try:
        touch.goto("/leaderboards.html")
        touch.wait_for_load_state("load")
        cdp = ctx.new_cdp_session(touch)
        seen = swipe(cdp, touch, 0.62 * SIZE["width"], during=DURING)
        # While the finger is down the screen keeps its width, the footer stays still and Sessions waits underneath.
        assert seen["width"] == SIZE["width"], seen
        assert seen["footer"] in ("", None), seen
        assert "Sessions" in seen["peek"], seen
        expect(touch).to_have_url(f"{base_url}/track.html", timeout=3000)
    finally:
        ctx.close()


def test_a_slow_left_swipe_on_a_phone_opens_the_page_after(page, base_url):
    ctx = phone(page, base_url)
    touch = ctx.new_page()
    try:
        touch.goto("/leaderboards.html")
        touch.wait_for_load_state("load")
        cdp = ctx.new_cdp_session(touch)
        seen = swipe(cdp, touch, -0.62 * SIZE["width"], during=DURING)
        assert seen["width"] == SIZE["width"], seen
        assert "Favourites" in seen["peek"], seen
        expect(touch).to_have_url(f"{base_url}/favourites.html", timeout=3000)
    finally:
        ctx.close()


def test_a_short_slow_right_swipe_springs_back_and_stays(page, base_url):
    ctx = phone(page, base_url)
    touch = ctx.new_page()
    try:
        touch.goto("/favourites.html")
        touch.wait_for_load_state("load")
        cdp = ctx.new_cdp_session(touch)
        swipe(cdp, touch, 0.3 * SIZE["width"])
        touch.wait_for_timeout(600)
        assert touch.url == f"{base_url}/favourites.html"
        # Everything is back where it was, and nothing is left wider than the screen.
        assert touch.evaluate("() => [...document.body.children].every(el => !el.style.transform)")
        assert touch.evaluate("() => document.documentElement.scrollWidth") <= SIZE["width"]
    finally:
        ctx.close()


def test_a_right_swipe_from_every_page_opens_the_one_before(page, base_url):
    pages = ["track.html", "leaderboards.html", "favourites.html", "my-analysis.html"]
    before = {"track.html": "laps.html", "leaderboards.html": "track.html", "favourites.html": "leaderboards.html", "my-analysis.html": "favourites.html"}
    ctx = phone(page, base_url)
    try:
        for name in pages:
            touch = ctx.new_page()
            touch.goto(f"/{name}")
            touch.wait_for_load_state("load")
            cdp = ctx.new_cdp_session(touch)
            swipe(cdp, touch, 0.62 * SIZE["width"])
            expect(touch).to_have_url(f"{base_url}/{before[name]}", timeout=3000)
            touch.close()
    finally:
        ctx.close()
