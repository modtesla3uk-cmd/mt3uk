"""Each site has its own colour theme (Current or Jade and mist): mt3uk.com and laps.mt3uk.com are set separately in the
Site theme panel of admin.html, and a public page takes the theme of the site it is on (js/site-theme.js)."""
import json

from playwright.sync_api import expect

from test_admin_pages import open_admin

CORS = {"Access-Control-Allow-Origin": "*"}


def test_admin_sets_the_theme_of_each_site_on_its_own(page):
    saved = []
    open_admin(page, "admin.html")

    def theme_api(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            saved.append(body)
            themes = {"main": "current", "laps": "current"}
            themes[body["site"]] = body["theme"]
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "themes": themes}), headers=CORS)
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "themes": {"main": "current", "laps": "current"}}), headers=CORS)

    page.route("**/site/theme/admin**", theme_api)
    page.locator("#theme-wrap").evaluate("e => e.open = true")
    page.locator('[data-theme-site="laps"][data-theme-pick="jade"]').click()
    expect(page.locator("#theme-status")).to_contain_text("laps.mt3uk.com is now Jade and mist")
    page.locator('[data-theme-site="main"][data-theme-pick="jade"]').click()
    expect(page.locator("#theme-status")).to_contain_text("mt3uk.com is now Jade and mist")
    assert saved == [{"site": "laps", "theme": "jade"}, {"site": "main", "theme": "jade"}]


def test_a_page_takes_the_theme_of_the_site_it_is_on(page):
    themes = {"main": "current", "laps": "jade"}
    page.add_init_script("window.MT3UK_THEME_SITE = 'laps'; try { localStorage.setItem('mt3ukTheme', JSON.stringify(%s)); } catch (e) {}" % json.dumps(themes))
    page.route("**/site/theme", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "themes": themes}), headers=CORS))
    page.goto("/laps.html")
    expect(page.locator("html")).to_have_attribute("data-theme", "jade")
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--orange').trim()") == "#6fd1b0"


def test_the_other_site_keeps_its_current_colours(page):
    themes = {"main": "current", "laps": "jade"}
    page.add_init_script("window.MT3UK_THEME_SITE = 'main'; try { localStorage.setItem('mt3ukTheme', JSON.stringify(%s)); } catch (e) {}" % json.dumps(themes))
    page.route("**/site/theme", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "themes": themes}), headers=CORS))
    page.goto("/index.html")
    expect(page.locator("html")).not_to_have_attribute("data-theme", "jade")
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--orange').trim()") == "#e8542a"


def test_admin_sets_the_laps_default_mode_and_dark_for_everyone(page):
    saved = []
    state = {"laps": "light", "darkAll": False, "darkAllAt": 0}
    open_admin(page, "admin.html")

    def theme_api(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            saved.append(body)
            if "mode" in body:
                state["laps"] = body["mode"]
            if "darkAll" in body:
                state["darkAll"] = body["darkAll"]
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "themes": {"main": "gold", "laps": "gold"}, "mode": state}), headers=CORS)

    page.route("**/site/theme/admin**", theme_api)
    page.evaluate("document.dispatchEvent(new Event('mt3uk-admin-refresh'))")
    page.locator("#theme-wrap").evaluate("e => e.open = true")
    expect(page.locator('[data-mode-pick="light"]')).to_have_attribute("aria-pressed", "true")
    page.locator('[data-mode-pick="system"]').click()
    expect(page.locator("#mode-status")).to_contain_text("following each visitor's device")
    expect(page.locator('[data-mode-pick="system"]')).to_have_attribute("aria-pressed", "true")
    page.locator("#mode-dark-all").click()
    expect(page.locator("#mode-status")).to_contain_text("Dark for everyone is on")
    expect(page.locator("#mode-dark-all")).to_have_attribute("aria-checked", "true")
    page.locator("#mode-dark-all").click()
    expect(page.locator("#mode-dark-all")).to_have_attribute("aria-checked", "false")
    assert saved == [{"mode": "system"}, {"darkAll": True}, {"darkAll": False}]


def _laps_page(page, mode, own=None, own_at=None, device="light"):
    page.emulate_media(color_scheme=device)
    # The visitor's own choice is put in once, as if made on an earlier visit (a reload must not put it back).
    script = "try { localStorage.setItem('mt3ukTheme', JSON.stringify({main:'gold',laps:'gold'})); if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1');"
    if own:
        script += "localStorage.setItem('mt3ukColourMode', '%s');" % own
    if own_at is not None:
        script += "localStorage.setItem('mt3ukColourModeAt', '%d');" % own_at
    script += "} } catch (e) {}"
    page.add_init_script(script)
    page.route("**/site/theme", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "themes": {"main": "gold", "laps": "gold"}, "mode": mode}), headers=CORS))
    page.goto("/leaderboards.html")


def test_the_laps_default_mode_applies_to_a_visitor_who_has_not_picked(page):
    _laps_page(page, {"laps": "dark", "darkAll": False, "darkAllAt": 0})
    expect(page.locator("html")).to_have_attribute("data-mode", "dark")
    # Next visit: it is already known, so the page opens dark before the worker answers.
    page.reload()
    assert page.evaluate("document.documentElement.getAttribute('data-mode')") == "dark"


def test_follow_the_device_uses_the_device_setting(page):
    _laps_page(page, {"laps": "system", "darkAll": False, "darkAllAt": 0}, device="dark")
    expect(page.locator("html")).to_have_attribute("data-mode", "dark")
    page.emulate_media(color_scheme="light")
    expect(page.locator("html")).to_have_attribute("data-mode", "light")


def test_a_visitors_own_choice_beats_the_default(page):
    _laps_page(page, {"laps": "dark", "darkAll": False, "darkAllAt": 0}, own="light", own_at=1000)
    page.wait_for_timeout(500)
    expect(page.locator("html")).to_have_attribute("data-mode", "light")


def test_dark_for_everyone_overrides_an_earlier_light_choice_until_the_visitor_picks_light_again(page):
    _laps_page(page, {"laps": "light", "darkAll": True, "darkAllAt": 2000}, own="light", own_at=1000)
    expect(page.locator("html")).to_have_attribute("data-mode", "dark")
    # Picking light after Dark for everyone was switched on keeps light.
    btn = page.locator("footer #lf-mode")
    btn.scroll_into_view_if_needed()
    btn.click()
    expect(page.locator("html")).to_have_attribute("data-mode", "light")
    page.reload()
    page.wait_for_timeout(500)
    expect(page.locator("html")).to_have_attribute("data-mode", "light")


def test_the_light_or_dark_settings_in_the_worker():
    import shutil, subprocess, tempfile
    from pathlib import Path
    import pytest
    if shutil.which("node") is None:
        pytest.skip("node is not installed here")
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (root / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(["node", str(root / "tests" / "site_mode_check.mjs")],
                                env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
                                capture_output=True, text=True, timeout=120)
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 10
