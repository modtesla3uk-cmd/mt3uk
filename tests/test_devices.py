"""
Cross-device checks: every public page on an iPhone and iPad (Safari's
WebKit engine), an Android phone (Chrome), and desktop Chrome and Firefox.

For each page and device it checks the page loads without script errors,
nothing spills off the side of the screen, and the menu opens. It also runs
the main flows (reel likes, gallery photo viewer, My Garage sign-in with a
code) and saves a screenshot of every page on every device to
test-results/devices/, which the "Run Playwright tests" workflow keeps as a
download.

The worker API and outside sites are mocked, so the tests never touch live
data. A device whose browser isn't installed is skipped, so this still runs
locally with Chromium only; CI installs all three engines.
"""
import json
import re
from pathlib import Path

import pytest

from conftest import BASE_URL, REPO_ROOT

SCREENSHOT_DIR = REPO_ROOT / "test-results" / "devices"

# Public pages with the shared header and menu. Admin pages are left out.
PAGES = sorted(
    p.stem
    for p in REPO_ROOT.glob("*.html")
    if 'id="hamburger"' in p.read_text(encoding="utf-8", errors="ignore")
)

# name: (browser engine, Playwright device, or None for a desktop window)
DEVICES = {
    "iphone": ("webkit", "iPhone 13"),
    "ipad": ("webkit", "iPad (gen 7)"),
    "android": ("chromium", "Pixel 7"),
    "desktop-chrome": ("chromium", None),
    "desktop-firefox": ("firefox", None),
}
MOBILE = {"iphone", "android"}

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
R2_HOST = "r2.dev"

# A 1x1 grey JPEG for gallery photos, so layouts have a real image to size.
TINY_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9"
)


def api_reply(url, method, post_data):
    """Stand-in answers for the worker, enough for every page to render."""
    path = url.split(API_HOST, 1)[1].split("?", 1)[0]
    if method == "OPTIONS":
        return {}
    if path == "/likes" and method == "GET":
        return {"success": True, "likes": {}, "liked": []}
    if path == "/likes":
        return {"success": True, "liked": True, "count": 1}
    if path == "/comment-counts":
        return {"success": True, "counts": {}}
    if path == "/comments" and method == "GET":
        return {"success": True, "comments": []}
    if path == "/my-builds/request-link":
        return {"success": True, "message": "If that email has submitted a build, we've sent a sign-in link."}
    if path == "/my-builds/verify-code":
        body = json.loads(post_data or "{}")
        if body.get("code") == "123456":
            return {"success": True, "session": "s1.test", "email": body.get("email", "")}
        return {"success": False, "message": "That code is not right or has expired."}
    if path == "/my-builds" and method == "GET":
        return {"success": True, "email": "member@example.com", "firstName": "Test", "lastName": "Member", "cars": []}
    return {"success": True}


def attach_mocks(context):
    def handle(route):
        request = route.request
        url = request.url
        if url.startswith(BASE_URL):
            return route.continue_()
        if API_HOST in url:
            status = 401 if url.split("?")[0].endswith("/my-builds") and not request.headers.get("x-session-token") else 200
            body = api_reply(url, request.method, request.post_data)
            if status == 401:
                body = {"success": False, "message": "Please sign in again"}
            return route.fulfill(
                status=status,
                body=json.dumps(body),
                headers={
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
            )
        if R2_HOST in url and request.resource_type == "image":
            return route.fulfill(status=200, body=TINY_JPEG, headers={"Content-Type": "image/jpeg"})
        return route.abort()

    context.route(re.compile(r".*"), handle)


@pytest.fixture(scope="module")
def browsers(playwright):
    launched = {}
    for engine in {"webkit", "chromium", "firefox"}:
        try:
            launched[engine] = getattr(playwright, engine).launch()
        except Exception:
            launched[engine] = None
    yield launched
    for b in launched.values():
        if b:
            b.close()


@pytest.fixture
def device_page(request, playwright, browsers):
    name = request.param
    engine, device = DEVICES[name]
    browser = browsers.get(engine)
    if browser is None:
        pytest.skip(f"{engine} is not installed here")
    options = dict(playwright.devices[device]) if device else {"viewport": {"width": 1280, "height": 900}}
    options.pop("default_browser_type", None)
    if engine == "firefox":
        options.pop("is_mobile", None)
    context = browser.new_context(base_url=BASE_URL, **options)
    # Skip the homepage intro animation, which waits for a tap.
    context.add_init_script("try { sessionStorage.setItem('mt3ukIntroSeen', '1'); } catch (e) {}")
    attach_mocks(context)
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda err: page.errors.append(str(err)))
    page.device_name = name
    yield page
    context.close()


def all_devices(fn):
    return pytest.mark.parametrize("device_page", list(DEVICES), indirect=True)(fn)


def overflow_width(page):
    return page.evaluate("document.documentElement.scrollWidth - window.innerWidth")


@all_devices
@pytest.mark.parametrize("page_name", PAGES)
def test_page_loads_fits_and_menu_opens(device_page, page_name):
    page = device_page
    page.goto(f"/{page_name}.html", wait_until="load")
    page.wait_for_timeout(800)

    out_dir = SCREENSHOT_DIR / page.device_name
    out_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out_dir / f"{page_name}.png"), full_page=True)

    assert page.errors == [], f"Script errors on {page_name}: {page.errors}"
    assert overflow_width(page) <= 1, f"{page_name} is wider than the screen by {overflow_width(page)}px"
    assert page.locator("header .logo img").is_visible()

    hamburger = page.locator("#hamburger")
    if page.device_name in MOBILE:
        assert hamburger.is_visible(), "Menu button missing on a phone"
    if hamburger.is_visible():
        hamburger.click()
        page.wait_for_timeout(400)
        assert hamburger.get_attribute("aria-expanded") == "true"
    assert page.locator("#navlinks .nav-link").first.is_visible(), "Menu links are not showing"


@all_devices
def test_reel_shows_posts_and_like_works(device_page):
    page = device_page
    page.goto("/index.html#build-feed")
    slide = page.locator(".bf-slide").first
    slide.wait_for(timeout=10000)
    slide.scroll_into_view_if_needed()
    like = slide.locator(".bf-like-btn")
    assert like.is_visible()
    like.click()
    page.wait_for_timeout(500)
    assert "bf-liked" in (like.get_attribute("class") or "")
    assert page.errors == []


@all_devices
def test_gallery_photo_opens_in_viewer(device_page):
    page = device_page
    page.goto("/gallery.html")
    first = page.locator("#gallery-grid img").first
    first.wait_for(timeout=10000)
    first.scroll_into_view_if_needed()
    first.click()
    page.wait_for_timeout(600)
    assert page.locator(".lightbox.open").count() == 1, "Photo viewer did not open"
    assert page.errors == []


@all_devices
def test_my_garage_sign_in_with_code(device_page):
    page = device_page
    page.goto("/my-builds.html")
    page.fill("#mb-email", "member@example.com")
    page.click("#mb-signin-btn")
    page.locator("#mb-code-form").wait_for(state="visible", timeout=5000)
    page.fill("#mb-code", "000000")
    page.click("#mb-code-btn")
    page.wait_for_timeout(500)
    assert "not right" in page.inner_text("#mb-code-status")
    page.fill("#mb-code", "123456")
    page.click("#mb-code-btn")
    page.wait_for_timeout(1500)
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.test"
    assert page.locator("#mb-signin-view").is_hidden()
    assert overflow_width(page) <= 1
    assert page.errors == []
