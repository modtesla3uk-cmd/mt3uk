"""A recorded RaceBox drive written as a VBO file and read back by the Laps track reader (tests/racebox_stage_check.mjs)."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_a_drive_written_for_laps_reads_back_with_the_same_positions_speed_and_times():
    result = subprocess.run(["node", str(ROOT / "tests" / "racebox_stage_check.mjs")], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "FAIL" not in result.stdout, result.stdout


import base64
import pytest
from playwright.sync_api import expect
import sys
sys.path.insert(0, str(ROOT / "tests"))
from test_racebox_test_page import STUB, EXAMPLE_B64, ADMIN  # noqa: E402
from test_track_page import FakeWorker, open_page  # noqa: E402


def _record_and_send(page):
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":true}', headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-record").click()
    page.evaluate("(b) => { for (var i = 0; i < 50; i++) window.__rbEmit('data', { base64: b }); }", EXAMPLE_B64)
    page.locator("#rbt-record").click()
    expect(page.locator("#rbt-drives-list li")).to_have_count(1)
    page.locator(".rbt-send").click()
    expect(page.locator("#rbt-stage-msg")).to_contain_text("Sent.")


def test_a_recorded_drive_is_sent_to_laps_and_waits_there(page):
    _record_and_send(page)
    count = page.evaluate("() => window.MT3UKStage.list().then(function (l) { return l.length; })")
    assert count == 1


def test_a_staged_drive_is_on_the_add_page_and_opens_for_review_without_uploading(page):
    _record_and_send(page)
    open_page(page, FakeWorker(earlier=False), path="/track.html?add=1&car=car1")
    expect(page.locator("#tp-staged")).to_contain_text("Staged drives")
    expect(page.locator("#tp-staged")).to_contain_text("50 readings")
    page.locator("[data-staged-open]").first.click()
    # Opened for review: the file is read as if it had been chosen, and nothing has been saved yet.
    expect(page.locator(".tp-file, #tp-result").first).to_be_visible(timeout=10000)
    assert page.evaluate("() => window.MT3UKStage.list().then(function (l) { return l.length; })") == 1
