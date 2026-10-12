"""Add your photo: one clear path in for new and existing members."""
import re

from test_devices import all_devices, device_page, browsers, diagnostics, overflow_width  # noqa: F401


def test_the_menu_and_the_homepage_all_lead_to_add_your_photo(page):
    page.goto("/index.html")
    first = page.locator("#navlinks > a").first
    assert first.get_attribute("class") == "nav-link-addphoto"
    assert first.get_attribute("href") == "my-builds.html#add-photo"
    assert page.locator('#hp-join-actions a.hp-join-primary[href="my-builds.html#add-photo"]').count() == 1
    assert page.locator('.hp-cats a[data-cat="addphoto"][href="my-builds.html#add-photo"]').count() == 1
    # The homepage tile is the first in the grid.
    assert page.locator(".hp-cats .hp-cat").first.get_attribute("data-cat") == "addphoto"


def test_signed_out_add_your_photo_opens_the_short_form_and_hides_sign_in(page):
    page.goto("/my-builds.html#add-photo")
    assert page.locator("#mb-submit-card").is_visible()
    assert not page.locator("#mb-signin-card").is_visible()
    assert page.locator("#mb-submit-card h2").inner_text() == "Add your photo"
    # Version, year, colour and caption are tucked away.
    assert not page.locator("#mb-submit-year").is_visible()
    page.locator("#mb-submit-more summary").click()
    assert page.locator("#mb-submit-year").is_visible()
    assert not page.locator("#mb-submit-color").evaluate("el => el.required")
    # An existing member switches to sign in with one tap, and can come back.
    page.locator("#mb-member-signin-btn").click()
    assert page.locator("#mb-signin-card").is_visible()
    assert not page.locator("#mb-submit-card").is_visible()
    page.locator("#mb-new-toggle-btn").click()
    assert page.locator("#mb-submit-card").is_visible()


def test_new_here_comes_before_the_member_sign_in(page):
    page.goto("/my-builds.html")
    new_y = page.locator("#mb-new-toggle-btn").bounding_box()["y"]
    member_y = page.locator(".mb-member-head").bounding_box()["y"]
    assert new_y < member_y
    assert page.locator(".mb-member-head").inner_text() == "Already a member? Sign in"


@all_devices
def test_a_signed_in_member_with_one_car_lands_on_adding_photos_to_it(device_page):
    page = device_page
    from test_garage_mods import signed_in
    signed_in(page)
    page.goto("/my-builds.html#add-photo")
    page.locator("#mb-addphoto-card").wait_for(state="visible", timeout=10000)
    assert page.locator("#mb-addcar-card").evaluate("el => getComputedStyle(el).display") == "none"


def test_plain_my_garage_still_opens_on_sign_in_and_the_car_name_follows_the_model(page):
    page.goto("/my-builds.html")
    assert page.locator("#mb-signin-card").is_visible()
    assert not page.locator("#mb-submit-card").is_visible()
    page.locator("#mb-new-toggle-btn").click()
    page.locator('#mb-submit-form input[name="makePick"][value="Tesla"]').locator("xpath=..").click()
    page.locator('#mb-submit-form [data-model-field] label.chip').first.click()
    name = page.locator("#mb-submit-carname").input_value()
    assert re.search(r"\w", name), "the car name is filled in from the model"
    page.locator("#mb-submit-carname").fill("My own name")
    page.locator('#mb-submit-form [data-model-field] label.chip').nth(1).click()
    assert page.locator("#mb-submit-carname").input_value() == "My own name"


def test_the_signed_in_homepage_hero_has_an_add_photos_shortcut(page):
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); localStorage.setItem('mt3ukMyBuildsEmail', 'member@example.com')")
    page.goto("/index.html")
    link = page.locator('#hp-join-actions a.hp-join-primary')
    assert link.inner_text() == "Add photos"
    assert link.get_attribute("href") == "my-builds.html#add-photo"
