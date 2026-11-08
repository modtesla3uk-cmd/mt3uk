"""A recorded RaceBox drive written as a VBO file and read back by the Laps track reader (tests/racebox_stage_check.mjs)."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_a_drive_written_for_laps_reads_back_with_the_same_positions_speed_and_times():
    result = subprocess.run(["node", str(ROOT / "tests" / "racebox_stage_check.mjs")], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "FAIL" not in result.stdout, result.stdout


import base64
import re
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


def test_a_sent_drive_shows_sent_with_undo_and_a_way_to_add_a_session(page):
    _record_and_send(page)
    expect(page.locator(".rbt-send").first).to_have_text("Sent")
    expect(page.locator(".rbt-send").first).to_be_disabled()
    expect(page.locator(".rbt-undo").first).to_be_visible()
    expect(page.locator(".rbt-go-add")).to_have_attribute("href", "track.html?add=1")
    page.locator(".rbt-undo").first.click()
    expect(page.locator(".rbt-send").first).to_have_text("Send to Laps")
    expect(page.locator(".rbt-send").first).to_be_enabled()
    assert page.evaluate("() => window.MT3UKStage.list().then(function (l) { return l.length; })") == 0


def test_the_menu_button_opens_the_menu_on_the_racebox_page(page):
    _record_and_send(page)
    page.locator("#hamburger").click()
    expect(page.locator("#navlinks")).to_have_class(re.compile(r"\bactive\b"))


def test_a_staged_drive_has_add_and_view_and_view_opens_that_drive(page):
    _record_and_send(page)
    open_page(page, FakeWorker(earlier=False), path="/track.html?add=1&car=car1")
    expect(page.locator("[data-staged-open]").first).to_have_text("Add")
    view = page.locator("#tp-staged a", has_text="View").first
    href = view.get_attribute("href")
    assert href.startswith("racebox.html#view=s"), href
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":true}', headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/" + href)
    expect(page.locator("#rbt-view")).to_be_visible(timeout=15000)
    expect(page.locator("#rbt-view-stats")).to_contain_text("Distance")


def _start_drive(page, mode_label):
    page.add_init_script("localStorage.clear();")
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.add_init_script(ADMIN)
    page.add_init_script(STUB)
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":true}', headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/racebox.html")
    page.evaluate("(b) => window.__rbEmit('status', { state: 'connected', detail: 'RaceBox Mini S 2242505877' })", None)
    page.evaluate("(b) => window.__rbEmit('data', { base64: b })", EXAMPLE_B64)
    page.locator("#rbt-modes [data-mode]", has_text=mode_label).click()


def test_a_drive_recorded_as_a_drag_run_is_staged_as_one(page):
    _start_drive(page, "Drag run")
    page.locator("#rbt-picker-results button", has_text="Without a strip").click()
    page.locator("#rbt-record").click()
    page.evaluate("(b) => { for (var i = 0; i < 50; i++) window.__rbEmit('data', { base64: b }); }", EXAMPLE_B64)
    page.locator("#rbt-record").click()
    expect(page.locator("#rbt-drives-list li").first).to_contain_text("drag run")
    page.locator(".rbt-send").first.click()
    expect(page.locator("#rbt-stage-msg")).to_contain_text("Sent.")
    text = page.evaluate("() => window.MT3UKStage.list().then(function (l) { return window.MT3UKStage.get(l[0].id); })")
    assert "Mode : Drag" in text


def test_a_drive_recorded_on_a_circuit_is_staged_with_the_circuit_name(page):
    _start_drive(page, "Circuit")
    expect(page.locator("#rbt-picker")).to_be_visible()
    page.locator("#rbt-picker-q").fill("Thruxton")
    page.locator("#rbt-picker-results button", has_text="Thruxton").first.click()
    expect(page.locator("#rbt-mode-line")).to_contain_text("Thruxton")
    page.locator("#rbt-record").click()
    page.evaluate("(b) => { for (var i = 0; i < 50; i++) window.__rbEmit('data', { base64: b }); }", EXAMPLE_B64)
    page.locator("#rbt-record").click()
    page.locator(".rbt-send").first.click()
    expect(page.locator("#rbt-stage-msg")).to_contain_text("Sent.")
    text = page.evaluate("() => window.MT3UKStage.list().then(function (l) { return window.MT3UKStage.get(l[0].id); })")
    assert "Mode : Track" in text and "Venue : Thruxton" in text


def test_choosing_a_drag_run_or_circuit_shows_the_map_and_a_start_stop_button(page):
    _start_drive(page, "Drag run")
    expect(page.locator("#rbt-map")).to_be_visible()
    expect(page.locator("#rbt-startstop")).to_be_visible()
    page.locator("#rbt-picker-results button", has_text="Without a strip").click()
    expect(page.locator("#rbt-startstop")).to_be_enabled()
    page.locator("#rbt-startstop").click()
    expect(page.locator("#rbt-startstop")).to_have_text("Stop recording")
    page.locator("#rbt-startstop").click()
    expect(page.locator("#rbt-startstop")).to_have_text("Start recording")
    expect(page.locator("#rbt-drives-list li").first).to_contain_text("drag run")


def test_a_circuit_needs_a_track_before_recording_can_start(page):
    _start_drive(page, "Circuit")
    expect(page.locator("#rbt-startstop")).to_be_disabled()
    page.locator("#rbt-picker-q").fill("Thruxton")
    page.locator("#rbt-picker-results button", has_text="Thruxton").first.click()
    expect(page.locator("#rbt-startstop")).to_be_enabled()


def test_a_chosen_circuit_shows_its_layout_on_the_live_map(page):
    page.route("**/overpass-api.de/**", lambda r: r.abort())
    _start_drive(page, "Circuit")
    page.locator("#rbt-picker-q").fill("Thruxton")
    page.locator("#rbt-picker-results button", has_text="Thruxton").first.click()
    page.wait_for_function("() => window.MT3UKRaceBoxLayout().source !== 'none'", timeout=15000)
    info = page.evaluate("() => window.MT3UKRaceBoxLayout()")
    assert info["venue"] == "Thruxton" and info["source"] == "line", info
    page.locator("#rbt-modes [data-mode='road']").click()
    assert page.evaluate("() => window.MT3UKRaceBoxLayout().source") == "none"
