"""Likes on a shared Track session: a round heart with its count. Signed-in members can like someone else's shared
session (the heart), and the count opens a pop-out list of who likes it. Signed-out visitors see the count only.
The worker's /track/likes is mocked here; tests/track_worker_check.mjs covers the worker's own rules."""
import json
import re

from playwright.sync_api import expect

from tests.test_track_page import FakeWorker, open_page, save_fixture_session


def likes_route(page, state):
    """Answer GET and POST /track/likes from a small state dict: likers (name, email, at) and the viewer's email."""
    def handler(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            state["posts"].append(body)
            me = state["viewer"]
            state["likers"] = [l for l in state["likers"] if l["email"] != me]
            if body["on"]:
                state["likers"].insert(0, {"email": me, "name": "Sam Carter", "at": "2026-10-13T10:00:00Z"})
            route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                          body=json.dumps({"success": True, "liked": bool(body["on"]), "count": len(state["likers"])}))
            return
        me = state["viewer"]
        liked = any(l["email"] == me for l in state["likers"]) if me else False
        data = {"success": True, "count": len(state["likers"]), "mine": state["mine"], "liked": liked,
                "canLike": bool(me) and not state["mine"]}
        if me:
            data["likers"] = [{"name": l["name"], "at": l["at"], "mine": l["email"] == me} for l in state["likers"]]
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(data))
    page.route(re.compile(r".*/track/likes.*"), handler)


def test_a_signed_in_member_likes_a_shared_session_and_sees_who_likes(page):
    fake = FakeWorker()
    save_fixture_session(page, fake)
    fake.sessions["new1"]["privacy"] = "shared"
    state = {"viewer": "b@example.com", "mine": False, "posts": [],
             "likers": [{"email": "c@example.com", "name": "Jo Hughes", "at": "2026-10-11T10:00:00Z"}]}
    likes_route(page, state)
    page.goto("/track.html?s=new1")
    heart = page.locator("#tp-like [data-like-toggle]")
    expect(page.locator("#tp-like")).to_be_visible()
    expect(page.locator("#tp-like-n")).to_have_text("1")
    expect(heart).to_be_enabled()
    expect(heart).to_have_attribute("aria-pressed", "false")
    heart.click()
    expect(page.locator("#tp-like-n")).to_have_text("2")
    expect(heart).to_have_class(re.compile(r"is-on"))
    assert state["posts"] == [{"id": "new1", "on": True}]
    # The count opens who likes, newest first, with the viewer marked.
    page.locator("#tp-like [data-like-who]").click()
    pop = page.locator("#tp-like-pop")
    expect(pop).to_be_visible()
    expect(pop).to_contain_text("Liked by 2")
    expect(pop.locator(".tp-like-who").first).to_contain_text("Sam Carter")
    expect(pop.locator(".tp-like-who").nth(1)).to_contain_text("Jo Hughes")
    page.keyboard.press("Escape")
    expect(pop).to_be_hidden()


def test_a_signed_out_visitor_sees_the_count_but_cannot_like(page):
    fake = FakeWorker()
    save_fixture_session(page, fake)
    fake.sessions["new1"]["privacy"] = "shared"
    state = {"viewer": "", "mine": False, "posts": [],
             "likers": [{"email": "c@example.com", "name": "Jo Hughes", "at": "2026-10-11T10:00:00Z"}]}
    open_page(page, fake, path="/track.html?s=new1", signed_in=False)
    # Registered after the fake worker's catch-all, so this answer is the one the page gets.
    likes_route(page, state)
    page.reload()
    expect(page.locator("#tp-like-n")).to_have_text("1")
    expect(page.locator("#tp-like [data-like-toggle]")).to_be_disabled()
    page.locator("#tp-like [data-like-who]").click()
    expect(page.locator("#tp-like-pop")).to_contain_text("Sign in to see who likes this session.")
    assert state["posts"] == []


def test_the_owner_sees_the_count_and_the_heart_is_off_for_their_own_session(page):
    fake = FakeWorker()
    save_fixture_session(page, fake)
    fake.sessions["new1"]["privacy"] = "shared"
    state = {"viewer": "a@example.com", "mine": True, "posts": [],
             "likers": [{"email": "c@example.com", "name": "Jo Hughes", "at": "2026-10-11T10:00:00Z"}]}
    likes_route(page, state)
    page.goto("/track.html?s=new1")
    expect(page.locator("#tp-like-n")).to_have_text("1")
    expect(page.locator("#tp-like [data-like-toggle]")).to_be_disabled()
    expect(page.locator("#tp-like [data-like-toggle]")).to_have_attribute("title", "Your own session")
