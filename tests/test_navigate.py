"""navigate.html: the phone's own location on a map, for approved members. The RaceBox is not needed."""
import re
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
    expect(page.locator("#nav-speed")).to_have_text("50")


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
  setTimeout(function () { ok({ coords: { latitude: 52.12, longitude: -0.99, accuracy: 6, speed: 0.4 } }); }, 50);
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
