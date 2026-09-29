"""Likes and comments in the Full Gallery (js/gallery-social.js), the same
as the build reel: counts on the tiles, and a Like / Comments bar with the
comment thread in the photo viewer."""
import json

from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401


def first_file(page):
    tile = page.locator("#gallery-grid .gallery-slot.filled").first
    tile.wait_for(timeout=10000)
    return tile.get_attribute("data-file")


def mock_social(page, file, state):
    """Answers for likes and comments on one photo."""
    def handle(route):
        req = route.request
        path = req.url.split("/__mock-api", 1)[1].split("?", 1)[0]
        body = {"success": True}
        if path == "/likes" and req.method == "GET":
            body = {"success": True, "likes": {file: state["likes"]}, "liked": [file] if state["liked"] else []}
        elif path == "/likes":
            state["liked"] = not state["liked"]
            state["likes"] += 1 if state["liked"] else -1
            body = {"success": True, "liked": state["liked"], "count": state["likes"]}
        elif path == "/likes/who":
            body = {"success": True, "count": state["likes"], "likers": [{"name": "Ryan B", "at": "2026-09-29T10:00:00Z"}] if state["likes"] else []}
        elif path == "/comment-counts":
            body = {"success": True, "counts": {file: len(state["comments"])}}
        elif path == "/comments" and req.method == "GET":
            body = {"success": True, "comments": state["comments"]}
        elif path == "/comments" and req.method == "POST":
            data = json.loads(req.post_data or "{}")
            state["posted"].append(data)
            state["comments"].append({"id": "c%d" % len(state["comments"]), "parentId": data.get("parentId"), "name": "Test Member",
                                      "text": data.get("text", ""), "createdAt": "2026-09-29T11:00:00Z", "likes": 0, "mine": True})
        elif path == "/comments/like":
            body = {"success": True, "liked": True, "likes": 1}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body),
                      headers={"Access-Control-Allow-Origin": "*"})
    for p in ("/likes", "/likes/who", "/comment-counts", "/comments", "/comments/like"):
        page.route("**/__mock-api" + p + "*", handle)


def new_state():
    return {"likes": 2, "liked": False, "comments": [
        {"id": "c0", "parentId": None, "name": "Ryan B", "text": "Great wheels", "createdAt": "2026-09-29T10:00:00Z", "likes": 1},
    ], "posted": []}


def open_first(page):
    tile = page.locator("#gallery-grid .gallery-slot.filled").first
    tile.scroll_into_view_if_needed()
    tile.click()
    page.locator(".lightbox.open .gs-panel").wait_for(timeout=5000)


@all_devices
def test_gallery_tiles_and_viewer_show_likes_and_comments(device_page):
    page = device_page
    page.goto("/gallery.html")
    file = first_file(page)
    state = new_state()
    mock_social(page, file, state)
    page.reload()
    tile = page.locator("#gallery-grid .gallery-slot.filled").first
    tile.locator(".gs-tile").wait_for(timeout=5000)
    assert tile.locator(".gs-tile").inner_text().split() == ["2", "1"]
    open_first(page)
    panel = page.locator(".lightbox.open .gs-panel")
    assert panel.locator(".gs-like-count").inner_text() == "2"
    assert panel.locator(".gs-comment-count").inner_text() == "1"
    page.wait_for_function("document.querySelector('.gs-liked-by').textContent.indexOf('Ryan B') !== -1", timeout=5000)
    panel.locator(".gs-comments-btn").click()
    panel.locator(".gs-comment").first.wait_for(timeout=5000)
    assert "Great wheels" in panel.inner_text()
    assert "Join free or sign in" in panel.inner_text(), "Signed out: asked to sign in to comment"
    assert overflow_width(page) <= 1
    assert page.errors == [], diagnostics(page)


@all_devices
def test_gallery_like_asks_to_sign_in_then_works(device_page):
    page = device_page
    page.goto("/gallery.html")
    file = first_file(page)
    state = new_state()
    mock_social(page, file, state)
    page.reload()
    first_file(page)
    open_first(page)
    like = page.locator(".gs-like")
    like.click()
    page.locator(".mt3uk-signin-box").wait_for(state="visible", timeout=5000)
    assert like.get_attribute("aria-pressed") == "false"
    page.click(".mt3uk-signin-close")

    page.evaluate("localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); localStorage.setItem('mt3ukMyBuildsEmail', 'member@example.com')")
    page.reload()
    first_file(page)
    open_first(page)
    like = page.locator(".gs-like")
    like.click()
    page.wait_for_function("document.querySelector('.gs-like').getAttribute('aria-pressed') === 'true'", timeout=5000)
    page.wait_for_function("document.querySelector('.gs-like-count').textContent === '3'", timeout=5000)
    assert page.errors == [], diagnostics(page)


@all_devices
def test_gallery_comment_and_reply(device_page):
    page = device_page
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); localStorage.setItem('mt3ukMyBuildsEmail', 'member@example.com')")
    page.goto("/gallery.html")
    file = first_file(page)
    state = new_state()
    mock_social(page, file, state)
    page.reload()
    first_file(page)
    open_first(page)
    panel = page.locator(".lightbox.open .gs-panel")
    panel.locator(".gs-comments-btn").click()
    panel.locator(".gs-comment").first.wait_for(timeout=5000)
    # Typing in the comment box never moves the viewer to another photo.
    src = page.locator(".lightbox-img").get_attribute("src")
    panel.locator(".gs-form-slot .gs-text").fill("Lovely build")
    panel.locator(".gs-form-slot .gs-text").press("ArrowRight")
    assert page.locator(".lightbox-img").get_attribute("src") == src
    panel.locator(".gs-form-slot .gs-submit").click()
    page.wait_for_function("document.querySelectorAll('.gs-comments > .gs-comment').length === 2", timeout=5000)
    assert state["posted"][0]["text"] == "Lovely build"
    assert state["posted"][0]["file"] == file
    assert panel.locator(".gs-comment-count").inner_text() == "2"

    panel.locator(".gs-comment").first.locator(".gs-reply").click()
    reply = panel.locator(".gs-comment").first.locator(".gs-reply-slot .gs-text")
    reply.fill("Thanks!")
    panel.locator(".gs-comment").first.locator(".gs-reply-slot .gs-submit").click()
    page.wait_for_function("document.querySelectorAll('.gs-replies .gs-comment').length === 1", timeout=5000)
    assert state["posted"][1]["parentId"] == "c0"
    assert overflow_width(page) <= 1
    assert page.errors == [], diagnostics(page)


@all_devices
def test_bell_and_profile_icon_on_every_page_type(device_page):
    page = device_page
    for path in ("/gallery.html", "/shop.html", "/blog.html", "/signin.html"):
        page.goto(path)
        page.locator("#nav-bell-btn").wait_for(state="attached", timeout=5000)
        assert page.locator("#nav-profile").count() == 1, path
    assert page.errors == [], diagnostics(page)
