def test_subscribe_shows_inline_message_without_navigation(page):
    page.route(
        "https://buttondown.com/api/emails/embed-subscribe/mt3uk",
        lambda route: route.fulfill(status=200, body=""),
    )

    page.goto("/index.html")
    start_url = page.url

    page.locator("#notify-form input[name='email']").fill("test@example.com")
    page.locator("#notify-form button[type='submit']").click()

    success = page.locator("#notify-success")
    success.wait_for(state="visible")
    assert "Subscribed" in success.inner_text()
    assert page.locator("#notify-form").is_hidden()
    assert page.url == start_url
