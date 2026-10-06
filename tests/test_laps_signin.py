"""Signing in and joining on laps.mt3uk.com: the Laps sign-in page (laps-signin.html, js/signin-page.js), its
emails and links back to laps.mt3uk.com, Laps-only accounts, and the Sign-in and sign-up panel of track-admin.html.
The worker side runs in node (tests/laps_signin_check.mjs)."""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from playwright.sync_api import expect

from conftest import PORT

ROOT = Path(__file__).resolve().parent.parent
API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
MAIN = "http://localhost:%d" % PORT
LAPS = "http://127.0.0.1:%d" % PORT
SITES = "window.MT3UK_SITES = { main: ['localhost'], mainOrigin: '%s', laps: ['127.0.0.1'] };" % MAIN


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_sign_in_and_join_from_both_addresses_in_the_worker():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "laps_signin_check.mjs")],
            env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
            capture_output=True, text=True, timeout=120,
        )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 30


def mock(page, separate=True):
    state = {"posts": [], "separate": separate}

    def handler(route):
        req = route.request
        headers = {"Access-Control-Allow-Origin": "*"}
        url = req.url
        data = {"success": True}
        if "/laps/signin" in url:
            data = {"success": True, "separate": state["separate"]}
        elif req.method == "POST" and ("/my-builds/request-link" in url or "/my-builds/join" in url):
            state["posts"].append({"path": url.split(API_HOST)[1].split("?")[0], "body": json.loads(req.post_data)})
            data = {"success": True, "message": "Check your email."}
        elif "/my-builds/session" in url:
            data = {"success": True, "session": "sess-1", "email": "member@example.com", "joined": ""}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data), headers=headers)
    page.route("**/%s/**" % API_HOST, handler)
    return state


def test_the_laps_sign_in_page_says_laps_and_tells_the_worker(page):
    state = mock(page)
    page.goto(LAPS + "/laps-signin.html?next=/track.html%3Fadd%3D1")
    expect(page.locator("h1")).to_have_text("Sign in to Laps")
    expect(page.locator("header")).to_contain_text("Laps")
    page.fill("#si-signin-email", "member@example.com")
    page.click("#si-signin-btn")
    expect(page.locator("#si-code-form")).to_be_visible()
    assert state["posts"][-1] == {"path": "/my-builds/request-link", "body": {"email": "member@example.com", "site": "laps", "next": "/track.html?add=1"}}
    page.fill("#si-join-first", "Nia")
    page.fill("#si-join-last", "Jones")
    page.fill("#si-join-email", "new@example.com")
    page.click("#si-join-btn")
    expect(page.locator("#si-join-status")).to_contain_text("Check your email")
    body = state["posts"][-1]["body"]
    assert state["posts"][-1]["path"] == "/my-builds/join" and body["site"] == "laps" and body["next"] == "/track.html?add=1" and body["firstName"] == "Nia"


def test_the_emailed_link_signs_in_on_laps_and_goes_back_to_the_page(page):
    mock(page)
    page.goto(LAPS + "/laps-signin.html?token=abc&next=/leaderboards.html")
    page.wait_for_url(re.compile(r":\d+/leaderboards\.html$"), timeout=5000)
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "sess-1"


def test_without_a_page_to_go_back_to_the_signed_in_card_offers_laps(page):
    mock(page)
    page.goto(LAPS + "/laps-signin.html?token=abc")
    expect(page.locator("#si-welcome")).to_have_text("You’re signed in.")
    card = page.locator("#si-signed-in")
    expect(card).to_be_visible()
    expect(card.get_by_role("link", name="Your sessions")).to_have_attribute("href", "track.html")
    expect(page.locator("#si-signed-in-text")).to_contain_text("track sessions")


def test_the_mt3uk_sign_in_page_is_unchanged(page):
    state = mock(page)
    page.goto(MAIN + "/signin.html")
    expect(page.locator("h1")).to_have_text("Join MT3UK free")
    page.fill("#si-signin-email", "member@example.com")
    page.click("#si-signin-btn")
    expect(page.locator("#si-code-form")).to_be_visible()
    assert state["posts"][-1]["body"] == {"email": "member@example.com"}


def test_switched_off_the_laps_page_passes_visitors_to_the_shared_one(page):
    mock(page, separate=False)
    page.goto(LAPS + "/laps-signin.html?next=/track.html")
    page.wait_for_url(re.compile(r"/signin\.html\?next="), timeout=5000)
    expect(page.locator("h1")).to_have_text("Join MT3UK free")


def test_sign_in_links_on_laps_go_to_the_laps_page(page):
    mock(page)
    page.add_init_script(SITES)
    page.goto(LAPS + "/laps.html")
    page.locator("#lh-start").click()
    page.wait_for_url(re.compile(r"/laps-signin\.html\?next=/track\.html$"), timeout=5000)
    assert page.evaluate("window.mt3ukSignInUrl('/track.html')") == "laps-signin.html?next=%2Ftrack.html"
    # On mt3uk.com the MT3UK page is used.
    page.goto(MAIN + "/laps.html")
    assert page.evaluate("window.mt3ukSignInUrl('/track.html')") == "signin.html?next=%2Ftrack.html"


def test_the_admin_panel_saves_the_settings(page):
    cors = {"Access-Control-Allow-Origin": "*"}
    posts = []
    stored = {"settings": {"separate": True, "mt3ukToo": True, "signinIntro": "", "joinIntro": ""}, "lapsAccounts": 2}

    def handler(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            posts.append(body)
            stored["settings"] = body
        route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps(dict(success=True, **stored)))
    page.route("**/%s/**" % API_HOST, lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}), headers=cors))
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/track-admin.html")
    page.route("**/laps/signin/admin**", handler)
    page.locator("#signin-wrap > summary").click()
    expect(page.locator("#ls-count")).to_have_text("2 Laps-only accounts so far.")
    expect(page.locator("#ls-separate")).to_have_attribute("aria-checked", "true")
    expect(page.locator("#ls-signin-intro")).to_have_attribute("placeholder", re.compile(r"^Click the link below to sign in to Laps"))
    page.locator("#ls-mt3uk-too").click()
    page.fill("#ls-join-intro", "Welcome aboard.")
    page.click("#ls-save")
    expect(page.locator("#ls-note")).to_contain_text("Saved")
    assert posts[-1] == {"separate": True, "mt3ukToo": False, "signinIntro": "", "joinIntro": "Welcome aboard."}
    # The emails' words only show while Laps has its own sign-in.
    page.locator("#ls-separate").click()
    expect(page.locator("[data-ls-separate-only]")).to_be_hidden()
