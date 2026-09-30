"""The Full Gallery's mods list: a "Mods (N)" button in the photo viewer
opens a frosted list over the photo, like the homepage reel, and the mods
badge on a photo opens it straight away."""
from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401


@all_devices
def test_mods_open_as_a_pop_up_list(device_page):
    page = device_page
    page.goto("/gallery.html")
    badge = page.locator("#gallery-grid .gallery-slot.filled .g-mods-badge").first
    badge.wait_for(timeout=10000)
    count = int(badge.inner_text().strip())
    badge.click()
    panel = page.locator(".lightbox-mods-panel")
    panel.wait_for(state="visible", timeout=5000)
    assert panel.locator("li").count() == count
    btn = page.locator(".lightbox-mods-btn")
    assert btn.inner_text().strip() == f"Mods ({count})"
    assert btn.get_attribute("aria-expanded") == "true"
    assert overflow_width(page) <= 0
    panel.locator(".lightbox-mods-close").click()
    assert panel.is_hidden()
    btn.click()
    assert panel.is_visible()
    # Escape closes the list first, then the viewer.
    page.keyboard.press("Escape")
    assert panel.is_hidden() and page.locator(".lightbox.open").count() == 1
    page.keyboard.press("Escape")
    assert page.locator(".lightbox.open").count() == 0
    assert page.errors == [], diagnostics(page)


def open_full_list(page):
    page.goto("/gallery.html")
    badge = page.locator("#gallery-grid .gallery-slot.filled .g-mods-badge").first
    badge.wait_for(timeout=10000)
    badge.click()
    page.locator(".lightbox-mods-full").click()
    sheet = page.locator(".lightbox-car")
    sheet.locator("[data-mv-area]").first.wait_for(timeout=5000)
    return sheet


@all_devices
def test_full_mods_list_is_read_only_and_asks_about_a_mod(device_page):
    page = device_page
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    sheet = open_full_list(page)
    assert "by Richard" in sheet.locator(".lightbox-car-sub").inner_text()
    # Read only: no Edit, no dates or costs, stock areas shown, no To do ones.
    assert sheet.locator("[data-mv-edit]").count() == 0
    assert "Fitted" not in sheet.inner_text()
    areas = sheet.locator("[data-mv-area] .mv-name").all_inner_texts()
    assert areas == ["Suspension", "Performance"]
    assert overflow_width(page) <= 0
    ask = sheet.locator("[data-mv-ask]").first
    assert ask.get_attribute("data-mod") == "KW V3"
    ask.click()
    box = sheet.locator(".lightbox-ask")
    assert box.is_visible() and "KW V3" in box.locator(".lightbox-ask-mod").inner_text()
    box.locator("textarea").fill("How do they ride?")
    box.locator(".lightbox-ask-send").click()
    box.get_by_text("Sent.").wait_for(timeout=5000)
    sent = page.mock_state.get("mod_questions", [])
    if sent:
        assert sent[-1] == {"about": {"file": "test-build.jpg", "mod": "KW V3"}, "text": "How do they ride?"}
    # Escape closes the list, then the viewer.
    page.keyboard.press("Escape")
    assert sheet.is_hidden() and page.locator(".lightbox.open").count() == 1
    assert page.errors == [], diagnostics(page)


@all_devices
def test_signed_out_visitors_are_asked_to_sign_in(device_page):
    page = device_page
    sheet = open_full_list(page)
    link = sheet.locator("a.mv-ask").first
    assert link.inner_text() == "Sign in to ask"
    assert link.get_attribute("href").startswith("signin.html?next=")
    assert page.errors == [], diagnostics(page)


@all_devices
def test_no_asking_about_your_own_car_or_when_turned_off(device_page):
    page = device_page
    page.mock_state["car_public"] = {"success": True, "file": "x.jpg", "name": "Mine", "ownerName": "Test", "canAsk": True, "mine": True,
                                     "view": [{"id": "tyres", "label": "Tyres", "status": "up", "parts": [{"what": "Michelin"}]}]}
    sheet = open_full_list(page)
    assert sheet.locator(".mv-ask").count() == 0
    page.mock_state["car_public"] = dict(page.mock_state["car_public"], mine=False, canAsk=False, ownerName="Dave")
    sheet.locator(".lightbox-car-close").click()
    page.locator(".lightbox-mods-full").click()
    sheet.locator("[data-mv-area]").first.wait_for(timeout=5000)
    assert sheet.locator(".mv-ask").count() == 0
    assert "Dave isn’t taking questions" in sheet.locator(".lightbox-car-note").first.inner_text()
    assert page.errors == [], diagnostics(page)
