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
import os
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
# MT3UK_PAGES=shop,gallery limits the page checks to those pages (used by the
# on-demand runs from the Device Checks page). Unset checks every page.
_only_pages = [p.strip() for p in os.environ.get("MT3UK_PAGES", "").split(",") if p.strip()]
if _only_pages:
    PAGES = [p for p in PAGES if p in _only_pages] or PAGES

# name: (browser engine, Playwright device, or None for a desktop window)
DEVICES = {
    "iphone": ("webkit", "iPhone 13"),
    "ipad": ("webkit", "iPad (gen 7)"),
    "android": ("chromium", "Pixel 7"),
    "desktop-chrome": ("chromium", None),
    "desktop-firefox": ("firefox", None),
}
MOBILE = {"iphone", "android"}

# GitHub runs one job per device: MT3UK_DEVICES=iphone (or a comma list)
# limits the run to those devices. Unset runs them all.
_only = [d.strip() for d in os.environ.get("MT3UK_DEVICES", "").split(",") if d.strip()]
if _only:
    DEVICES = {name: spec for name, spec in DEVICES.items() if name in _only}

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
# Pages call the worker with fetch(). WebKit lets cross-site POSTs skip
# Playwright's request mocking and go to the real worker, so every page
# gets a fetch() that sends worker calls to this same-site path instead,
# where the mock answers them. Nothing reaches the live worker.
MOCK_API_PATH = "/__mock-api"
FETCH_REDIRECT = """
(function () {
  var live = 'https://%s';
  var local = location.origin + '%s';
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.indexOf(live) === 0) {
      input = local + input.slice(live.length);
    } else if (input && input.url && input.url.indexOf(live) === 0) {
      input = new Request(local + input.url.slice(live.length), input);
    }
    return realFetch.call(this, input, init);
  };
})();
""" % (API_HOST, MOCK_API_PATH)
R2_HOST = "r2.dev"

# A 1x1 grey JPEG for gallery photos, so layouts have a real image to size.
TINY_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9"
)


# One car with one photo, showing in the gallery and reel, for My Garage.
GARAGE_CAR = {
    "id": "car-1",
    "name": "Test Model 3",
    "mods": ["Wheels"],
    "photos": [
        {"file": "test-build.jpg", "caption": "Test Model 3", "gallery": True, "reel": True, "votable": True, "inVote": True, "added": "2026-09-14"},
        {"file": "test-build-2.jpg", "caption": "Test Model 3 Rear", "gallery": True, "reel": True, "votable": True},
    ],
}
# The member's entry in this week's vote, with 3 votes so far.
GARAGE_VOTE_ENTRY = {"file": "test-build.jpg", "caption": "TEST MODEL 3", "votes": 3}
# This week's vote: someone else's build, and the signed-in member's own.
VOTE_CANDIDATES = [
    {"file": "other-build.jpg", "caption": "OTHER BUILD", "votes": 2, "mods": []},
    {"file": "test-build.jpg", "caption": "TEST MODEL 3", "votes": 3, "mods": [], "mine": True},
] + [{"file": "more-%d.jpg" % n, "caption": "MORE BUILD %d" % n, "votes": 0, "mods": []} for n in range(10)]
# The Admin page's list of this week's entries, and one taken out of voting.
ADMIN_VOTE_ENTRIES = {
    "success": True,
    "week": "2026-09-28",
    "entries": [{"file": "brake-discs.jpg", "caption": "BRAKE DISCS", "name": "TEST MEMBER", "email": "member@example.com", "added": "2026-09-28", "votes": 2}],
    "removed": [{"file": "old-entry.jpg", "caption": "OLD ENTRY", "name": "OTHER MEMBER", "email": "other@example.com", "added": "2026-09-21"}],
}


def api_path(url):
    """The worker path of a call, whether it went to the worker or the mock."""
    marker = API_HOST if API_HOST in url else MOCK_API_PATH
    return url.split(marker, 1)[1].split("?", 1)[0]


def api_reply(url, method, post_data, state):
    """Stand-in answers for the worker, enough for every page to render."""
    path = api_path(url)
    if method == "OPTIONS":
        return {}
    if path == "/likes" and method == "GET":
        return {"success": True, "likes": {}, "liked": []}
    if path == "/likes":
        return {"success": True, "liked": True, "count": 1}
    if path == "/admin/vote-entries" and method == "GET":
        return ADMIN_VOTE_ENTRIES
    if path == "/votes":
        return {"success": True, "voted": None, "candidates": VOTE_CANDIDATES}
    if path == "/comment-counts":
        return {"success": True, "counts": {}}
    if path == "/comments" and method == "GET":
        return {"success": True, "comments": []}
    if path == "/my-builds/request-link":
        return {"success": True, "message": "If that email has submitted a build, we've sent a sign-in link."}
    if path == "/my-builds/verify-code":
        try:
            body = json.loads(post_data or "{}")
        except ValueError:
            body = {}
        # WebKit doesn't always pass the request body to the mock, so without
        # it the first try is treated as wrong and the next as right.
        state["code_tries"] = state.get("code_tries", 0) + 1
        code = body.get("code") or ("000000" if state["code_tries"] == 1 else "123456")
        if code == "123456":
            state["signed_in"] = True
            return {"success": True, "session": "s1.test", "email": body.get("email", "member@example.com")}
        return {"success": False, "message": "That code is not right or has expired."}
    if path == "/my-builds" and method == "GET":
        return {"success": True, "email": "member@example.com", "firstName": "Test", "lastName": "Member", "cars": [GARAGE_CAR], "voteEntry": GARAGE_VOTE_ENTRY}
    return {"success": True}


# The same cross-site headers the real worker sends (workers/vote-worker.js).
API_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Voter-Id, X-Session-Token",
}


def attach_mocks(context):
    state = {"log": []}

    def handle(route):
        request = route.request
        url = request.url
        is_mock_api = url.startswith(BASE_URL + MOCK_API_PATH)
        if url.startswith(BASE_URL) and not is_mock_api:
            return route.continue_()
        if is_mock_api or API_HOST in url:
            # My Garage answers "signed out" until the test signs in with a
            # code. This goes by the test's own record rather than the
            # request header, which WebKit doesn't always show to the mock.
            is_garage = url.split("?")[0].endswith("/my-builds") and request.method == "GET"
            status = 401 if is_garage and not state.get("signed_in") else 200
            try:
                post_data = request.post_data
            except Exception:
                post_data = None
            body = api_reply(url, request.method, post_data, state)
            if status == 401:
                body = {"success": False, "message": "Please sign in again"}
            path = api_path(url)
            state["log"].append(f"{request.method} {path} -> {status}")
            return route.fulfill(status=status, body=json.dumps(body), headers=API_HEADERS)
        if R2_HOST in url and request.resource_type == "image":
            return route.fulfill(status=200, body=TINY_JPEG, headers={"Content-Type": "image/jpeg"})
        return route.abort()

    context.route(re.compile(r".*"), handle)
    return state


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
    # The site's service worker would fetch the mock worker path itself,
    # out of reach of the mocks, so it is switched off for these checks.
    context = browser.new_context(base_url=BASE_URL, service_workers="block", **options)
    # Skip the homepage intro animation, which waits for a tap.
    context.add_init_script("try { sessionStorage.setItem('mt3ukIntroSeen', '1'); } catch (e) {}")
    context.add_init_script(FETCH_REDIRECT)
    mock_state = attach_mocks(context)
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda err: page.errors.append(str(err)))
    page.console_log = []
    page.on("console", lambda msg: page.console_log.append(f"{msg.type}: {msg.text}"[:200]))
    page.api_log = mock_state["log"]
    page.mock_state = mock_state
    page.device_name = name
    yield page
    context.close()


def all_devices(fn):
    return pytest.mark.parametrize("device_page", list(DEVICES), indirect=True)(fn)


def diagnostics(page):
    """What happened on the page, shown when a flow check fails."""
    try:
        stored = page.evaluate("Object.keys(localStorage).join(', ')")
    except Exception as err:
        stored = f"could not read ({err})"
    return (
        f"\nworker calls: {page.api_log}\nsaved keys: {stored}"
        f"\nconsole: {page.console_log[-10:]}\nerrors: {page.errors}"
    )


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
    # Browsers can't capture more than 32767 screen pixels in one image, so
    # long pages are cut at the first 12000px. WebKit checks the whole page
    # height before cutting, so a page over the limit (the homepage on a
    # phone) only gets its first screen. JPEG keeps the download small.
    full_height = page.evaluate("document.documentElement.scrollHeight")
    width = page.evaluate("document.documentElement.clientWidth")
    # The limit counts screen pixels, and phones have 2x or 3x screens.
    ratio = page.evaluate("window.devicePixelRatio") or 1
    max_css = int(30000 / ratio)
    shot = {"path": str(out_dir / f"{page_name}.jpg"), "type": "jpeg", "quality": 70}
    if full_height < max_css:
        shot.update(full_page=True, clip={"x": 0, "y": 0, "width": width, "height": min(full_height, 12000, max_css)})
    page.screenshot(**shot)

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
def test_reel_like_asks_to_sign_in_then_works(device_page):
    page = device_page
    page.goto("/index.html#build-feed")
    slide = page.locator(".bf-slide").first
    slide.wait_for(timeout=10000)
    slide.scroll_into_view_if_needed()
    like = slide.locator(".bf-like-btn")
    assert like.is_visible()

    # Signed out: likes are for members, so the sign-in dialog shows.
    like.click()
    page.locator(".mt3uk-signin-box").wait_for(state="visible", timeout=5000)
    assert "bf-liked" not in (like.get_attribute("class") or "")
    assert overflow_width(page) <= 1
    page.click(".mt3uk-signin-close")

    # Signed in: the like goes through.
    page.evaluate("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.reload()
    slide = page.locator(".bf-slide").first
    slide.wait_for(timeout=10000)
    slide.scroll_into_view_if_needed()
    like = slide.locator(".bf-like-btn")
    like.click()
    page.wait_for_timeout(500)
    assert "bf-liked" in (like.get_attribute("class") or ""), "Signed-in like did not register" + diagnostics(page)
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
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.test", "Code sign-in not saved" + diagnostics(page)
    assert page.locator("#mb-signin-view").is_hidden(), "My Garage did not open after sign-in" + diagnostics(page)
    assert overflow_width(page) <= 1
    assert page.errors == []


# Stands in for the phone's share menu, so the test can see what was shared.
SHARE_STUB = "window.__shared = []; navigator.share = function (d) { window.__shared.push(d); return Promise.resolve(); };"


def shared_url(page):
    """The link a share button offered: from the phone share menu, or the
    Facebook option in the desktop pop-out (which is then closed)."""
    page.wait_for_timeout(300)
    return page.evaluate("""() => {
      if (window.__shared.length) return window.__shared.pop().url;
      var pop = document.querySelector('.mt3uk-share-pop');
      if (!pop || pop.hidden) return null;
      var url = new URL(pop.querySelector('[data-channel=facebook]').href).searchParams.get('u');
      pop.querySelector('.mt3uk-share-close').click();
      return url;
    }""")


@all_devices
def test_share_buttons(device_page):
    page = device_page
    page.add_init_script(SHARE_STUB)

    page.goto("/index.html#build-of-the-day")

    # Build of the Week: the photo opens the full image viewer, which has
    # its own share button.
    photo = page.locator("#botm-frame img")
    photo.wait_for(timeout=10000)
    photo.scroll_into_view_if_needed()
    photo.click()
    button = page.locator(".bf-viewer-share")
    button.wait_for(state="visible", timeout=5000)
    button.click()
    url = shared_url(page)
    assert url and "/share/" in url and "utm_campaign=botw_share" in url, "Build of the Week share: " + str(url) + diagnostics(page)
    page.click(".bf-viewer-close")

    # Round share button on a section heading links to that section.
    dot = page.locator("#build-of-the-day h2 .mt3uk-share-dot").first
    dot.scroll_into_view_if_needed()
    dot.click()
    url = shared_url(page)
    assert url and url.startswith("https://mt3uk.com/share/section/index--build-of-the-day.html?") and "utm_campaign=section_build-of-the-day" in url, "Section share: " + str(url)
    assert overflow_width(page) <= 1

    # Round share button by a page's main heading.
    page.goto("/shop.html")
    page.locator("h1 .mt3uk-share-dot").click()
    url = shared_url(page)
    assert url and url.startswith("https://mt3uk.com/share/section/shop.html?") and "utm_campaign=page_shop" in url, "Page share: " + str(url)

    # My Garage photo viewer.
    page.mock_state["signed_in"] = True
    page.evaluate("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    page.locator(".mb-photo-thumb img").first.click(timeout=5000)
    button = page.locator("#mb-lightbox-share")
    button.wait_for(state="visible", timeout=5000)
    button.click()
    url = shared_url(page)
    assert url == "https://mt3uk.com/share/test-build.jpg.html?utm_source=" + url.split("utm_source=")[1].split("&")[0] + "&utm_medium=share&utm_campaign=garage_share", "My Garage share: " + str(url)
    assert page.errors == []


@all_devices
def test_vote_one_entry_and_not_your_own(device_page):
    page = device_page
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")

    # Your own build shows its votes but has no vote button.
    page.goto("/index.html#vote-frame")
    own = page.locator('.vote-card[data-file="test-build.jpg"]')
    own.wait_for(timeout=10000)
    assert own.locator(".vote-btn").count() == 0, "Own build still has a vote button"
    assert "3 votes" in own.inner_text() and "Your build" in own.inner_text()
    other = page.locator('.vote-card[data-file="other-build.jpg"]')
    assert other.locator(".vote-btn").count() == 1
    assert "You can only vote for other members' builds." in page.inner_text("#build-of-the-day")
    page.goto("/index.html#vote-how")
    assert page.locator("#vote-how").get_attribute("open") is not None, "How voting works did not open"
    page.goto("/index.html#vote-frame")
    page.locator(".vote-card").first.wait_for(timeout=10000)

    # Every entry is in the list, a few rows at a time.
    visible = page.locator(".vote-card:not([hidden])").count()
    assert visible in (8, 9), "Unexpected first page of vote cards: %d" % visible
    more = page.locator("#vote-more-btn")
    more.scroll_into_view_if_needed()
    more.click()
    assert page.locator(".vote-card:not([hidden])").count() == 12
    assert page.locator("#vote-more-wrap").is_hidden()

    # My Garage: switching entry warns that its votes will be lost.
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    first = page.locator('.mb-photo-thumb-wrap[data-file="test-build.jpg"] input[data-flag="votable"]')
    second = page.locator('.mb-photo-thumb-wrap[data-file="test-build-2.jpg"] input[data-flag="votable"]')
    first.wait_for(timeout=5000)
    assert first.is_checked() and not second.is_checked()
    assert "your entry this week is Test Model 3 (3 votes)" in page.inner_text("#mb-vote-hint")
    assert page.locator(".mb-photo-added").first.inner_text().startswith("Added ")
    messages = []

    def answer(dialog):
        messages.append(dialog.message)
        dialog.accept()

    page.on("dialog", answer)
    second.click()
    page.wait_for_timeout(800)
    assert messages and "Test Model 3" in messages[0] and "3 votes" in messages[0], "No switch warning: " + str(messages)
    assert second.is_checked() and not first.is_checked(), "Entry did not switch" + diagnostics(page)
    assert page.errors == []


@all_devices
def test_admin_can_take_a_photo_out_of_voting(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    card = page.locator("#vote-entries .card")
    card.first.wait_for(timeout=10000)
    text = card.first.inner_text()
    assert "BRAKE DISCS" in text and "TEST MEMBER" in text and "member@example.com" in text and "2 votes" in text
    assert card.first.locator("img").get_attribute("src").endswith("/gallery/brake-discs.jpg")
    assert "OLD ENTRY" in page.inner_text("#vote-removed")

    page.on("dialog", lambda d: d.accept())
    before = len(page.api_log)
    page.click("#vote-entries .vote-remove-btn")
    page.wait_for_timeout(600)
    assert any(line.startswith("POST /admin/vote-entries") for line in page.api_log[before:]), page.api_log[before:]

    # Send subscribers email now.
    before = len(page.api_log)
    page.click("#send-digest-btn")
    page.wait_for_timeout(600)
    assert any(line.startswith("POST /admin/send-digest") for line in page.api_log[before:]), page.api_log[before:]
    assert "Sent." in page.inner_text("#send-digest-status")
    assert page.errors == []
