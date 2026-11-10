"""navigate.html: the phone's own location on a map, for approved members. The RaceBox is not needed."""
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
from playwright.sync_api import expect
from test_racebox_test_page import ADMIN
from test_racebox_stage import GEO_OK, GEO_DENIED


def _photon(*places):
    """A Photon reply (GeoJSON, coordinates lng, lat) for the places given as (name, city, lat, lng)."""
    return json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": n, "city": c, "country": "United Kingdom", "countrycode": "GB"},
         "geometry": {"type": "Point", "coordinates": [lng, lat]}} for n, c, lat, lng in places]})


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
    expect(page.locator("#nav-route-len")).to_contain_text("0.8 mi")
    expect(page.locator("#nav-steps li")).to_have_count(2)
    expect(page.locator("#nav-steps")).to_contain_text("Turn left onto Church Road")


def test_a_place_name_with_several_matches_lets_the_member_pick(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.route("**/photon.komoot.io/**", lambda r: r.fulfill(status=200, content_type="application/json", body=_photon(("Church Road", "Towcester", 52.13, -0.98), ("Church Road", "Wallington", 51.35, -0.14)), headers={"Access-Control-Allow-Origin": "*"}))
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
        route.fulfill(status=200, content_type="application/json", body=_photon(("Church Road", "Wallington", 51.35, -0.14), ("Church Road", "Towcester", 52.13, -0.98)), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/photon.komoot.io/**", reply)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("Church Road")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-results button")).to_have_count(2)
    assert "lat=52.1" in seen[0] and "lon=-0.9" in seen[0] and "location_bias_scale=" in seen[0], seen[0]
    assert all("countrycode=gb" in u for u in seen), seen
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
    # A new route opens folded, showing only the handle and the Drive heading.
    expect(page.locator("#nav-route")).to_have_class(re.compile(r"is-collapsed"))
    expect(page.locator("#nav-steps")).to_be_hidden()
    expect(page.locator(".nav-route-head")).to_be_visible()
    page.locator("#nav-route-handle").click()
    expect(page.locator("#nav-route")).not_to_have_class(re.compile(r"is-collapsed"))
    expect(page.locator("#nav-steps")).to_be_visible()
    page.locator("#nav-route-handle").click()
    expect(page.locator("#nav-route")).to_have_class(re.compile(r"is-collapsed"))
    expect(page.locator("#nav-steps")).to_be_hidden()


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
        route.fulfill(status=200, content_type="application/json", body=_photon(("Towcester", "Northamptonshire", 52.13, -0.98)), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/photon.komoot.io/**", reply)
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


def test_a_part_typed_last_word_still_suggests_the_place(page):
    _approve(page, True)
    page.add_init_script(GEO_TOWCESTER)
    asked = []
    def reply(route):
        q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
        asked.append(q)
        # Photon finds Leicester for the last word on its own, and nothing for "Tesla Leic" as a whole.
        places = [("Leicester", "City of Leicester", 52.6369, -1.1398)] if q.lower() == "leic" else []
        route.fulfill(status=200, content_type="application/json", body=_photon(*places), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/photon.komoot.io/**", reply)
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("Tesla Leic")
    expect(page.locator("#nav-results.is-suggest button")).to_have_count(1, timeout=5000)
    expect(page.locator("#nav-results.is-suggest button")).to_contain_text("Leicester")
    assert "Tesla Leic" in asked and "Leic" in asked, asked


def test_distances_follow_the_speed_unit_miles_with_mph_and_km_with_km_h(page):
    _approve(page, True)
    page.add_init_script(GEO_TOWCESTER)
    page.route("**/photon.komoot.io/**", lambda r: r.fulfill(status=200, content_type="application/json", body=_photon(("Church Road", "Towcester", 52.13, -0.98)), headers={"Access-Control-Allow-Origin": "*"}))
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("Church Road")
    expect(page.locator("#nav-results.is-suggest button")).to_have_count(1, timeout=5000)
    # Starts in mph, so the search result and the route are in miles.
    expect(page.locator("#nav-results small")).to_contain_text("mi away")
    expect(page.locator("#nav-results small")).not_to_contain_text("km")
    page.locator("#nav-results.is-suggest button").click()
    expect(page.locator("#nav-route")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-route-len")).to_contain_text("mi")
    expect(page.locator("#nav-steps")).to_contain_text("mi)")
    # Switching to km/h changes them all at once, without a new search.
    page.locator("#nav-unit").click()
    expect(page.locator("#nav-route-len")).to_contain_text("1.2 km")
    expect(page.locator("#nav-steps")).to_contain_text("km)")


def test_the_distance_to_go_follows_the_road_not_the_straight_line(page):
    _approve(page, True)
    page.add_init_script(GEO_TOWCESTER)
    # The road goes north first and comes back, so the road is far longer than the straight line (0.8 mi).
    detour = ('{"success":true,"distanceM":7600,"durationS":900,'
              '"line":[[52.124,-0.9955],[52.16,-0.9955],[52.13,-0.98]],'
              '"steps":[{"text":"Head north","distanceM":4400},{"text":"Turn right","distanceM":3200}]}')
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=detour, headers={"Access-Control-Allow-Origin": "*"}))
    page.route("**/photon.komoot.io/**", lambda r: r.fulfill(status=200, content_type="application/json", body=_photon(("Church Road", "Towcester", 52.13, -0.98)), headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("Church Road")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-route")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-togo")).to_have_text("4.7 mi")
    expect(page.locator("#nav-route")).to_contain_text("To go on the route")


def test_the_route_panel_opens_and_folds_with_a_swipe_on_its_handle(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("52.13, -0.98")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-route")).to_have_class(re.compile(r"is-collapsed"), timeout=10000)
    page.wait_for_timeout(600)  # let the panel finish flying up before pressing it
    # Press on the handle and drag up: the directions open.
    box = page.locator("#nav-route-handle").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y - 90, steps=10)
    page.mouse.up()
    expect(page.locator("#nav-route")).not_to_have_class(re.compile(r"is-collapsed"))
    expect(page.locator("#nav-steps")).to_be_visible()
    page.wait_for_timeout(400)  # let the panel settle open before pressing it again
    # Press on the handle again and drag down: the panel folds.
    box = page.locator("#nav-route-handle").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y + 90, steps=10)
    page.mouse.up()
    expect(page.locator("#nav-route")).to_have_class(re.compile(r"is-collapsed"))
    expect(page.locator("#nav-steps")).to_be_hidden()


def test_the_route_panel_follows_the_finger_and_springs_back_on_a_short_drag(page):
    _approve(page, True)
    page.add_init_script(GEO_OK)
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.locator("#nav-to-q").fill("52.13, -0.98")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-route")).to_have_class(re.compile(r"is-collapsed"), timeout=10000)
    page.wait_for_timeout(600)
    top = page.locator("#nav-route").bounding_box()["y"]
    box = page.locator("#nav-route-handle").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y - 25, steps=5)
    # Still held down: the card has moved up with the finger.
    moved = page.locator("#nav-route").bounding_box()["y"]
    assert top - moved > 15, (top, moved)
    page.mouse.up()
    # A short drag springs back to folded.
    page.wait_for_timeout(400)
    expect(page.locator("#nav-route")).to_have_class(re.compile(r"is-collapsed"))


GEO_LEAVES_ROUTE = """
(function () {
  var t0 = Date.now();
  navigator.geolocation.watchPosition = function (ok) {
    var t = setInterval(function () {
      // On the route at first, then well off it (about 8 km north) once the route is drawn.
      var away = Date.now() - t0 > 1500;
      ok({ coords: { latitude: away ? 52.2 : 52.124, longitude: -0.9955, accuracy: 3, speed: 8.3 }, timestamp: Date.now() });
    }, 200);
    return 7;
  };
  navigator.geolocation.clearWatch = function () {};
})();
"""


def test_leaving_the_route_works_out_a_new_one_from_where_the_phone_is(page):
    _approve(page, True)
    # Shorter waits for the test, so a reroute happens within seconds.
    page.add_init_script("window.MT3UK_REROUTE_AFTER_MS = 300; window.MT3UK_REROUTE_GAP_MS = 300;")
    page.add_init_script(GEO_LEAVES_ROUTE)
    asked = []
    def reply(route):
        asked.append(route.request.post_data)
        route.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/navigate/route", reply)
    page.route("**/photon.komoot.io/**", lambda r: r.fulfill(status=200, content_type="application/json", body=_photon(("Church Road", "Towcester", 52.13, -0.98)), headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    page.wait_for_timeout(600)
    page.locator("#nav-to-q").fill("Church Road")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-route")).to_be_visible(timeout=10000)
    # The first route, then at least one new route from the phone's position well off the line.
    waited = 0
    while len(asked) < 2 and waited < 10000:
        page.wait_for_timeout(200)
        waited += 200
    assert len(asked) >= 2, asked
    assert json.loads(asked[-1])["from"][0] > 52.19, asked[-1]
    expect(page.locator("#nav-route")).to_be_visible()


GEO_HEADING_EAST = """
navigator.geolocation.watchPosition = function (ok) {
  var t = setInterval(function () {
    // Moving at about 30 km/h, heading due east (90 degrees).
    ok({ coords: { latitude: 52.124, longitude: -0.9955, accuracy: 3, speed: 8.3, heading: 90 }, timestamp: Date.now() });
  }, 200);
  return 7;
};
navigator.geolocation.clearWatch = function () {};
"""


def test_start_route_fills_the_screen_and_turns_the_map_to_the_direction_of_travel(page):
    _approve(page, True)
    page.add_init_script(GEO_HEADING_EAST)
    page.route("**/navigate/route", lambda r: r.fulfill(status=200, content_type="application/json", body=ROUTE_REPLY, headers={"Access-Control-Allow-Origin": "*"}))
    page.goto("/navigate.html")
    expect(page.locator("#nav-body")).to_be_visible(timeout=10000)
    expect(page.locator("#nav-acc")).to_contain_text("within", timeout=10000)
    page.locator("#nav-to-q").fill("52.13, -0.98")
    page.locator("#nav-go").click()
    expect(page.locator("#nav-route")).to_be_visible(timeout=10000)
    # Open the directions, then start the route.
    page.locator("#nav-route-handle").click()
    expect(page.locator("#nav-steps")).to_be_visible()
    page.wait_for_timeout(400)  # let the panel finish opening before pressing Start
    page.locator("#nav-start").click()
    expect(page.locator(".nav-map-wrap")).to_have_class(re.compile(r"is-driving"))
    expect(page.locator("#nav-turn-text")).to_have_text("Head north on Maple Close")
    expect(page.locator("#nav-eta")).to_contain_text("min")
    # Zoomed in closer for driving.
    assert page.evaluate("() => window.MT3UKNavigate.map().getZoom()") == 18
    # The map turns so that due east (90 degrees) points up.
    # Tilted like a 3D view, and turned so the heading is up.
    page.wait_for_function("() => /rotateX\\(\\d+deg\\) rotate\\(-90deg\\)/.test(document.getElementById('nav-map').style.transform)", timeout=5000)
    page.locator("#nav-exit").click()
    expect(page.locator(".nav-map-wrap")).not_to_have_class(re.compile(r"is-driving"))
