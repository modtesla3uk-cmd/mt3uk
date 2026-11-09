"""navigate.html: the phone's own location on a map, for approved members. The RaceBox is not needed."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
from playwright.sync_api import expect
from test_racebox_test_page import ADMIN
from test_racebox_stage import GEO_OK, GEO_DENIED


def _approve(page, access):
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 'test-session');")
    page.add_init_script(ADMIN)
    page.route("**/laps/racebox/access", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":true,"access":%s}' % ("true" if access else "false"), headers={"Access-Control-Allow-Origin": "*"}))


def test_an_approved_member_sees_the_phones_position_and_speed(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-pos")).to_have_text("51.208500, -1.605500")
    expect(page.locator("#nav-acc")).to_have_text("within 4 m")
    expect(page.locator("#nav-status")).to_have_text("Your phone has a fix.")
    expect(page.locator("#nav-speed")).to_have_text("31")


def test_the_navigate_page_does_not_need_the_racebox(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    assert page.evaluate("typeof window.MT3UKRaceBoxApp") == "undefined"


def test_a_member_who_is_not_approved_sees_only_the_note(page):
    _approve(page, False)
    page.add_init_script(GEO_OK)
    page.goto("/navigate.html")
    expect(page.locator("#nav-gate")).to_contain_text("approved members")
    expect(page.locator("#nav-body")).to_be_hidden()


def test_a_refused_permission_says_how_to_allow_it(page):
    _approve(page, True)
    page.add_init_script(GEO_DENIED)
    page.goto("/navigate.html")
    expect(page.locator("#nav-status")).to_contain_text("Location is not allowed for Laps")
    expect(page.locator("#nav-status")).to_have_class(re.compile(r"is-bad"))


GEO_STILL = """
navigator.geolocation.watchPosition = function (ok) {
  setTimeout(function () { ok({ coords: { latitude: 52.12, longitude: -0.99, accuracy: 6, speed: 0.2 } }); }, 50);
  return 7;
};
navigator.geolocation.clearWatch = function () {};
"""


def test_a_stationary_phone_reads_zero_not_a_wandering_speed(page):
    _approve(page, True)
    page.add_init_script(GEO_STILL)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-speed")).to_have_text("0")


GEO_WANDER = """
(function () {
  var i = 0;
  navigator.geolocation.watchPosition = function (ok) {
    var t = setInterval(function () {
      // a still phone: fixes wander by a metre or two either way
      var jitter = (i % 2 ? 0.000012 : -0.000010);
      i++;
      ok({ coords: { latitude: 52.12 + jitter, longitude: -0.99 - jitter, accuracy: 3, speed: 0.4 }, timestamp: Date.now() });
      if (i >= 30) clearInterval(t);
    }, 20);
    return 7;
  };
  navigator.geolocation.clearWatch = function () {};
})();
"""


def test_a_still_phone_does_not_draw_a_wandering_trail(page):
    _approve(page, True)
    page.add_init_script(GEO_WANDER)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.wait_for_timeout(1500)
    assert page.evaluate("window.MT3UKNavigate.trailPoints()") <= 2


GEO_MOVING = """
(function () {
  var i = 0;
  navigator.geolocation.watchPosition = function (ok) {
    var t = setInterval(function () {
      // driving at about 30 km/h, a fix every 20 ms in the test, 0.0005 degrees (about 50 m) apart
      ok({ coords: { latitude: 52.12 + i * 0.0005, longitude: -0.99, accuracy: 3, speed: 8.3 }, timestamp: Date.now() });
      i++;
      if (i >= 6) clearInterval(t);
    }, 20);
    return 7;
  };
  navigator.geolocation.clearWatch = function () {};
})();
"""


def test_a_moving_phone_still_draws_its_route(page):
    _approve(page, True)
    page.add_init_script(GEO_MOVING)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.wait_for_timeout(1000)
    assert page.evaluate("window.MT3UKNavigate.trailPoints()") >= 4


GEO_WALK = """
navigator.geolocation.watchPosition = function (ok) {
  setTimeout(function () { ok({ coords: { latitude: 52.12, longitude: -0.99, accuracy: 4, speed: 1.4 } }); }, 50);
  return 7;
};
navigator.geolocation.clearWatch = function () {};
"""


def test_walking_pace_shows_on_navigate(page):
    _approve(page, True)
    page.add_init_script(GEO_WALK)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-speed")).to_have_text("3")


def test_the_navigate_route_on_the_worker_refuses_people_who_are_not_signed_in(tmp_path):
    import subprocess
    module = tmp_path / "worker.mjs"
    source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
    module.write_text(source, encoding="utf-8")
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "navigate_route_check.mjs")],
        env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "FAIL" not in result.stdout, result.stdout


ROUTE_REPLY = ('{"success":true,"distanceM":1240,"durationS":240,'
               '"line":[[52.124,-0.9955],[52.126,-0.9950],[52.13,-0.98]],'
               '"steps":[{"text":"Head north on Maple Close","distanceM":180},{"text":"Turn left onto Church Road","distanceM":1060}]}')


def test_a_typed_position_gets_a_route_drawn_with_its_distance_and_steps(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("52.13, -0.98")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-route")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-route-len")).to_contain_text("1.2 km")
    expect(page.locator("#nav-steps li")).to_have_count(2)
    expect(page.locator("#nav-steps")).to_contain_text("Turn left onto Church Road")


def test_a_place_name_with_several_matches_lets_the_member_pick(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.route("**/nominatim.openstreetmap.org/**", lambda r: r.fulfill(status=200, content_type="application/json", body='[{"display_name":"Church Road, Towcester, UK","lat":"52.13","lon":"-0.98"},{"display_name":"Church Road, Wallington, UK","lat":"51.35","lon":"-0.14"}]', headers={"Access-Control-Allow-Origin": "*"}))
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("Church Road")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-results button")).to_have_count(2)
    page.locator("#nav-results button", has_text="Towcester").click()
    expect(page.locator("#nav-route")).to_be_visible(timeout=10000)


GEO_TOWCESTER = """
navigator.geolocation.watchPosition = function (ok) {
  setTimeout(function () { ok({ coords: { latitude: 52.124, longitude: -0.9955, accuracy: 3, speed: 0 }, timestamp: Date.now() }); }, 50);
  return 7;
};
navigator.geolocation.clearWatch = function () {};
"""


def test_place_search_is_biased_to_where_the_phone_is_and_nearest_comes_first(page):
    _approve(page, True)
    page.add_init_script(GEO_TOWCESTER)
    seen = []
    def reply(route):
        seen.append(route.request.url)
        route.fulfill(status=200, content_type="application/json", body='[{"display_name":"Church Road, Wallington, UK","lat":"51.35","lon":"-0.14"},{"display_name":"Church Road, Towcester, UK","lat":"52.13","lon":"-0.98"}]', headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/nominatim.openstreetmap.org/**", reply)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("Church Road")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-results button")).to_have_count(2)
    assert "viewbox=" in seen[0] and "bounded=0" in seen[0], seen[0]
    assert "countrycodes=gb" in seen[0], seen[0]
    expect(page.locator("#nav-results button").first).to_contain_text("Towcester")


def test_the_recentre_button_brings_the_map_back_to_the_phone(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-recentre")).to_be_visible(timeout=10000)
    page.evaluate("() => window.MT3UKNavigate.map().panTo([52.5, -0.5], { animate: false })")
    page.locator("#nav-recentre").click()
    page.wait_for_timeout(900)
    centre = page.evaluate("() => { var c = window.MT3UKNavigate.map().getCenter(); return [c.lat, c.lng]; }")
    assert abs(centre[0] - 51.2085) < 0.01 and abs(centre[1] + 1.6055) < 0.01, centre


def test_the_route_panel_flies_up_over_the_map_and_its_handle_collapses_it(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("52.13, -0.98")
    page.locator("#nav-go").click()
    expect(page.locator(".nav-map-wrap > #nav-route")).to_be_visible(timeout=10000)
    page.locator("#nav-route-handle").click()
    expect(page.locator("#nav-route")).to_have_class(re.compile(r"is-collapsed"))
    expect(page.locator("#nav-steps")).to_be_hidden()
    page.locator("#nav-route-handle").click()
    expect(page.locator("#nav-steps")).to_be_visible()


def test_navigate_starts_in_mph_and_can_be_switched_to_km_h(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-speed-unit")).to_have_text("mph")
    page.locator("#nav-unit").click()
    expect(page.locator("#nav-speed-unit")).to_have_text("km/h")


def test_suggestions_appear_in_light_grey_while_typing_and_one_can_be_chosen(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    calls = []
    def reply(route):
        calls.append(route.request.url)
        route.fulfill(status=200, content_type="application/json", body='[{"display_name":"Towcester, Northamptonshire, England, UK","lat":"52.13","lon":"-0.98"}]', headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/nominatim.openstreetmap.org/**", reply)
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("To")
    page.wait_for_timeout(800)
    assert not calls, "two letters should not ask the place service"
    page.locator("#nav-to-q").fill("Towc")
    expect(page.locator("#nav-results.is-suggest button")).to_have_count(1, timeout=5000)
    expect(page.locator("#nav-results.is-suggest button")).to_contain_text("Towcester")
    page.locator("#nav-results.is-suggest button").click()
    expect(page.locator("#nav-route")).to_be_visible(timeout=10000)
