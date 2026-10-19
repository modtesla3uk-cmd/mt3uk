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
