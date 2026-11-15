"""A visitor who is not signed in is on the free tier too, so the Laps Pro tiles on a shared session are locked for them (Sign in
to unlock) when the admin's switch is on for everyone, and left open when it is not (GET /track/tiers/public)."""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from playwright.sync_api import expect

from test_track_page import FakeWorker, save_fixture_session


def visit_as_stranger(page, fake):
    """Save a session as its owner, then open it as someone who is not signed in (the worker answers as for another member)."""
    save_fixture_session(page, fake)
    shown = {k: v for k, v in fake.sessions["new1"].items() if k != "notes"}
    page.route("**/track/session?id=new1", lambda route: route.fulfill(
        status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
        body=json.dumps({"success": True, "session": dict(shown, mine=False, car="Blue Y", ownerName="Ann")})))
    # open_page signs in at the start of every page load; this later step signs the visitor out again.
    page.add_init_script("try { localStorage.removeItem('mt3ukMyBuildsSession'); localStorage.removeItem('mt3ukMyBuildsEmail'); } catch (e) {}")
    page.goto("/track.html?s=new1")
    expect(page.locator(".tp-session-head")).to_be_visible()


def test_a_visitor_who_is_not_signed_in_sees_the_laps_pro_tiles_locked_when_the_free_tier_applies_to_everyone(page):
    fake = FakeWorker()
    fake.tiers_public = True
    visit_as_stranger(page, fake)
    expect(page.locator('[data-tile="grip"] .tp-lock')).to_contain_text("A Laps Pro feature. Sign in")
    expect(page.locator("#tp-gbox .tp-lock")).to_contain_text("A Laps Pro feature. Sign in")
    cover = page.locator('[data-tile="speed"] .tier-lock-cover, [data-tile="corners"] .tier-lock-cover').first
    expect(cover).to_be_visible()
    expect(cover).to_contain_text("A Laps Pro feature.")
    expect(cover.locator("[data-tier-unlock]")).to_have_text("Sign in")
    # The usage ring is a member's, so a visitor has none; Sign in goes to the sign-in page.
    expect(page.locator("#tp-quota-ring")).to_have_count(0)
    cover.locator("[data-tier-unlock]").click()
    page.wait_for_url("**/signin.html**")


def test_a_visitor_sees_nothing_locked_when_the_free_tier_does_not_apply_to_everyone(page):
    fake = FakeWorker()
    fake.tiers_public = False
    visit_as_stranger(page, fake)
    page.wait_for_timeout(800)
    expect(page.locator(".tier-lock-cover")).to_have_count(0)
    expect(page.locator(".tp-lock")).to_have_count(0)


def _open_board_as_stranger(page, applies):
    from test_track_page import _compare_board, open_page
    fake = FakeWorker()
    fake.tiers_public = applies
    fake.boards = {"/track/board:thruxton:main": _compare_board()}
    open_page(page, fake, path="/leaderboards.html", signed_in=False)
    page.locator(".tp-board-card", has_text="Thruxton").locator(".lb-layout").first.click()
    page.locator(".lb-openboard").first.click()
    expect(page.locator(".lb-row").first).to_be_visible()
    page.wait_for_timeout(600)


def test_a_visitor_sees_compare_pads_locked_on_the_leaderboard_when_the_free_tier_applies_to_everyone(page):
    _open_board_as_stranger(page, True)
    expect(page.locator('#lb-views [data-view="pads"]')).to_have_class(re.compile("is-tier-locked"))
    expect(page.locator("#tp-quota-ring")).to_have_count(0)  # the usage ring is a member's


def test_a_visitor_sees_compare_pads_open_when_the_free_tier_does_not_apply_to_everyone(page):
    _open_board_as_stranger(page, False)
    expect(page.locator('#lb-views [data-view="pads"]')).not_to_have_class(re.compile("is-tier-locked"))


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_the_public_tiers_route_in_the_worker():
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (root / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(["node", str(root / "tests" / "tiers_public_check.mjs")],
                                env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
                                capture_output=True, text=True, timeout=120)
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 5
