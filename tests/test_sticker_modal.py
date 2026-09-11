MODAL = "#sticker-modal"


def _assert_open(page):
    modal = page.locator(MODAL)
    assert "open" in (modal.get_attribute("class") or "")
    assert modal.get_attribute("aria-hidden") == "false"


def _assert_closed(page):
    modal = page.locator(MODAL)
    assert "open" not in (modal.get_attribute("class") or "")
    assert modal.get_attribute("aria-hidden") == "true"


def test_sticker_trigger_opens_modal(page):
    page.goto("/shop.html")
    page.locator("#sticker-trigger").click()
    _assert_open(page)


def test_close_button_closes_modal(page):
    page.goto("/shop.html")
    page.locator("#sticker-trigger").click()
    _assert_open(page)

    page.locator(f"{MODAL} .sticker-modal-close").click()
    _assert_closed(page)


def test_escape_key_closes_modal(page):
    page.goto("/shop.html")
    page.locator("#sticker-trigger").click()
    _assert_open(page)

    page.keyboard.press("Escape")
    _assert_closed(page)
