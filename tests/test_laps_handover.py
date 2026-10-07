"""Sign-in handover between mt3uk.com and laps.mt3uk.com (js/account-bar.js and the worker's /session/handover
routes). A sign-in is kept per address, so a signed-in member following a link to the other address carries a
one-time code in the link's #, which the page there swaps for its own sign-in. Here the two addresses are
localhost (mt3uk.com) and 127.0.0.1 (laps.mt3uk.com), set through window.MT3UK_SITES."""
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
CODE = "c" * 64


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_the_handover_routes_in_the_worker():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "laps_handover_check.mjs")],
            env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
            capture_output=True, text=True, timeout=120,
        )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 10


def setup(page):
    state = {"made": 0, "redeemed": []}

    def handler(route):
        req = route.request
        headers = {"Access-Control-Allow-Origin": "*"}
        if req.url.endswith("/session/handover") and req.method == "POST":
            state["made"] += 1
            assert req.headers.get("x-session-token") in ("tok-main", "tok-laps") or req.headers.get("x-admin-viewer") == "viewer-tok"
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "code": CODE}), headers=headers)
        if req.url.endswith("/session/handover/redeem"):
            state["redeemed"].append(json.loads(req.post_data)["code"])
            return route.fulfill(status=200, content_type="application/json", headers=headers,
                                 body=json.dumps({"success": True, "session": "tok-new", "email": "rich@example.com", "firstName": "Rich"}))
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers={**headers, "Access-Control-Allow-Headers": "Content-Type, X-Session-Token, X-Admin-Viewer", "Access-Control-Allow-Methods": "GET, POST"})
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}), headers=headers)

    page.route("**/%s/**" % API_HOST, handler)
    page.add_init_script("window.MT3UK_SITES = { main: ['localhost'], mainOrigin: '%s', laps: ['127.0.0.1'] };" % MAIN)
    return state


def sign_in(page, origin, token):
    page.goto(origin + "/offline.html")
    page.evaluate("t => { localStorage.setItem('mt3ukMyBuildsSession', t); localStorage.setItem('mt3ukMyBuildsEmail', 'rich@example.com'); }", token)


def add_link(page, href):
    page.evaluate("h => { const a = document.createElement('a'); a.id = 'go'; a.href = h; a.textContent = 'Go'; a.style.cssText = 'position:fixed;top:200px;left:20px;z-index:99999;padding:20px;background:#fff'; document.body.appendChild(a); }", href)


def session_at(page):
    return page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')")


def test_from_laps_to_another_page_of_the_site_arrives_signed_in(page):
    state = setup(page)
    sign_in(page, LAPS, "tok-laps")
    page.goto(LAPS + "/leaderboards.html")
    add_link(page, "gallery.html#top")
    page.locator("#go").click()
    page.wait_for_url(MAIN + "/gallery.html#top", timeout=10000)
    page.wait_for_function("localStorage.getItem('mt3ukMyBuildsSession') === 'tok-new'", timeout=10000)
    assert state["made"] == 1 and state["redeemed"] == [CODE]
    assert "mt3uk-handover" not in page.url
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsFirstName')") == "Rich"


def test_from_mt3uk_to_laps_arrives_signed_in(page):
    state = setup(page)
    sign_in(page, MAIN, "tok-main")
    page.goto(MAIN + "/gallery.html")
    add_link(page, LAPS + "/track.html")
    page.locator("#go").click()
    page.wait_for_url(LAPS + "/track.html", timeout=10000)
    page.wait_for_function("localStorage.getItem('mt3ukMyBuildsSession') === 'tok-new'", timeout=10000)
    assert state["redeemed"] == [CODE]
    # Signed in now, so the account bar shows on the Laps page.
    expect(page.locator("#mt3uk-account-bar")).to_contain_text("Rich")


def test_the_admin_viewer_token_goes_across_with_or_without_a_sign_in(page):
    """The admin viewer token (the key entered on an admin page, kept per address) is carried by the same code, so a
    private session opens on the other address without the key being entered there."""
    state = setup(page)
    expires = 4102444800000
    page.route("**/session/handover/redeem", lambda route: route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                                                         body=json.dumps({"success": True, "adminViewer": {"token": "viewer-tok", "expires": expires}})))
    page.goto(MAIN + "/offline.html")
    page.evaluate("e => localStorage.setItem('mt3ukAdminViewer', JSON.stringify({ token: 'viewer-tok', expires: e }))", expires)
    page.goto(MAIN + "/gallery.html")
    add_link(page, LAPS + "/track.html?s=abc")
    page.locator("#go").click()
    page.wait_for_url(LAPS + "/track.html?s=abc", timeout=10000)
    page.wait_for_function("JSON.parse(localStorage.getItem('mt3ukAdminViewer') || '{}').token === 'viewer-tok'", timeout=10000)
    assert state["made"] == 1
    assert session_at(page) is None


def test_links_between_laps_pages_and_signed_out_links_need_no_code(page):
    state = setup(page)
    page.goto(LAPS + "/leaderboards.html")
    add_link(page, "gallery.html")
    page.locator("#go").click()
    page.wait_for_url(MAIN + "/gallery.html", timeout=10000)
    assert state["made"] == 0 and session_at(page) is None
    sign_in(page, LAPS, "tok-laps")
    page.goto(LAPS + "/leaderboards.html")
    add_link(page, "track.html")
    page.locator("#go").click()
    page.wait_for_url(LAPS + "/track.html", timeout=10000)
    assert state["made"] == 0


def test_links_to_the_laps_pages_go_to_laps_on_the_live_site(page):
    """On mt3uk.com the menu's Track Sessions and Leaderboards, My Garage's buttons and the homepage tile open
    laps.mt3uk.com (data-laps); on localhost, and on Laps itself, they stay as written."""
    page.route("**/%s/**" % API_HOST, lambda r: r.fulfill(status=200, content_type="application/json", body='{"success": true}', headers={"Access-Control-Allow-Origin": "*"}))
    # localhost is neither site, so the links stay as written.
    page.goto(MAIN + "/my-builds.html")
    assert page.locator("#mb-track-btn").get_attribute("href") == "track.html"
    page.goto(MAIN + "/index.html")
    assert page.locator('header a[href$="leaderboards.html"]').first.get_attribute("href") == "leaderboards.html"
    # With localhost standing in for mt3uk.com, the same links are rewritten to the Laps address.
    page.add_init_script("window.MT3UK_SITES = { main: ['localhost'], mainOrigin: '%s', laps: ['laps.mt3uk.com'] };" % MAIN)
    page.goto(MAIN + "/index.html")
    links = page.locator("a[data-laps]")
    assert links.count() >= 3
    for i in range(links.count()):
        href = links.nth(i).get_attribute("href")
        assert href.startswith("https://laps.mt3uk.com/"), href
    assert page.evaluate("window.mt3ukLapsUrl('track.html?mycar=c1')") == "https://laps.mt3uk.com/track.html?mycar=c1"
    page.goto(MAIN + "/my-builds.html")
    assert page.locator("#mb-boards-btn").get_attribute("href") == "https://laps.mt3uk.com/leaderboards.html"


def test_back_on_laps_goes_to_the_page_before_not_the_homepage(page):
    """The page Back on the Leaderboard (and Sessions) links to a page on mt3uk.com. It must still step back to the
    page you came from on Laps, rather than the handover taking the click to the MT3UK homepage every time."""
    setup(page)
    page.goto(LAPS + "/track.html")
    page.locator("#tp-lb-pill").click()
    expect(page).to_have_url(LAPS + "/leaderboards.html")
    page.wait_for_load_state("load")
    page.locator("#lb-page-back").click()
    expect(page).to_have_url(LAPS + "/track.html")
    # Opened directly, it goes to its parent on mt3uk.com as before.
    page.goto(LAPS + "/leaderboards.html")
    page.wait_for_load_state("load")
    page.locator("#lb-page-back").click()
    expect(page).to_have_url(re.compile(r"^" + re.escape(MAIN) + r"/index\.html"))


def test_back_on_my_garage_goes_to_laps_when_you_came_from_there(page):
    """My Garage reached from Laps (through the handover, which reloads the page) goes Back to Laps: the other address
    counts as this site, even though only its origin comes through as the referrer."""
    setup(page)
    sign_in(page, LAPS, "tok-laps")
    page.goto(LAPS + "/track.html")
    add_link(page, MAIN + "/my-builds.html")
    page.locator("#go").click()
    expect(page).to_have_url(MAIN + "/my-builds.html")
    page.wait_for_function("localStorage.getItem('mt3ukMyBuildsSession') === 'tok-new'", timeout=10000)
    page.wait_for_load_state("load")
    page.locator("a.back-link").first.click()
    expect(page).to_have_url(LAPS + "/track.html")


def test_profile_and_my_garage_stay_on_laps_with_the_laps_header(page):
    """Profile and My Garage are shared pages: opened from laps.mt3uk.com they stay there (no handover) and show the
    Laps header, footer and name (js/laps-shared.js); on mt3uk.com they keep the MT3UK ones."""
    state = setup(page)
    sign_in(page, LAPS, "tok-laps")
    page.goto(LAPS + "/track.html")
    page.locator("#mt3uk-account-bar a", has_text="My Garage").click()
    page.wait_for_url(LAPS + "/my-builds.html", timeout=10000)
    assert state["made"] == 0 and session_at(page) == "tok-laps"
    expect(page.locator("header .laps-logo")).to_have_count(1)
    expect(page.locator("header .nav-link-mybuilds")).to_have_class(re.compile(r"\bactive\b"))
    expect(page.locator("footer .laps-logo")).to_have_count(1)
    assert page.locator("#laps-header-tpl").count() == 1 and page.locator("header").count() == 1
    assert page.title() == "My Garage - Laps by MT3UK"
    assert page.locator('link[rel="manifest"]').get_attribute("href") == "laps-manifest.json"
    page.locator("#mt3uk-account-bar a", has_text="Profile").click()
    page.wait_for_url(LAPS + "/profile.html", timeout=10000)
    assert state["made"] == 0
    expect(page.locator("header .laps-logo")).to_have_count(1)
    assert page.title() == "My Profile - Laps by MT3UK"
    # Set up a passkey sits beside Your details on Laps too, and the app card offers the Laps app (this
    # member has no nickname yet, so the cards wait behind the nickname gate: checked by their markup).
    assert page.locator("#passkey-setup").count() == 1
    assert page.evaluate("getComputedStyle(document.querySelector('.pf-side')).display") != "none"
    assert page.locator("#app h2").text_content() == "The Laps app"
    # The Gallery is not shared: it still goes to mt3uk.com, signed in.
    add_link(page, "gallery.html")
    page.locator("#go").click()
    page.wait_for_url(MAIN + "/gallery.html", timeout=10000)
    assert state["made"] == 1
    # The code is swapped for a sign-in and the page reloads itself: wait for that before moving on, or the reload
    # can land after the next goto and put the Gallery back.
    page.wait_for_function("localStorage.getItem('mt3ukMyBuildsSession') === 'tok-new' && document.referrer.indexOf('gallery.html') !== -1", timeout=10000)
    # On mt3uk.com the same pages keep the MT3UK header.
    page.goto(MAIN + "/profile.html")
    expect(page.locator("header .laps-logo")).to_have_count(0)
    assert page.title() == "My Profile - MT3UK"
    assert page.locator(".pf-side").evaluate("el => getComputedStyle(el).display") != "none"
