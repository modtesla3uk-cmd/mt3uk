"""The admin pages (admin.html, events-admin.html, device-checklist.html): a
light look, one navigation shared by all three, and the panels in logical
groups."""
import gzip
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import parse_qs, urlparse

import pytest
from playwright.sync_api import expect

from test_devices import overflow_width

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
PAGES = ["admin.html", "events-admin.html", "device-checklist.html"]
ALL_PAGES = PAGES + ["track-admin.html"]
GROUPS = [
    ("grp-gallery", "Gallery and builds", ["pending-wrap", "decided-wrap", "unclaimed-wrap", "votes-wrap", "garage-asks-wrap"]),
    ("grp-reports", "Reports", ["comments-wrap", "rphotos-wrap", "local-wrap"]),
    ("grp-members", "Members", ["subscribers-wrap", "members-msg-wrap", "passkey-nudge-wrap"]),
    ("grp-interviews", "Owner interviews", ["interviews-wrap", "preview-wrap"]),
    ("grp-sharing", "Sharing links", ["home-share-wrap"]),
]
# The Track sessions tools have a page of their own, in five categories.
TRACK_GROUPS = [
    ("grp-access", "Access", ["access-wrap", "signin-wrap", "usage-wrap"]),
    ("grp-sessions", "Members' sessions", ["new-sessions-wrap", "lines-wrap", "member-sessions-wrap"]),
    ("grp-tracks", "Tracks", ["tracks-wrap"]),
    ("grp-boards", "Leaderboards", ["board-checks-wrap", "boards-wrap", "drive-wrap"]),
    ("grp-content", "Content", ["copy-wrap", "news-wrap", "panels-wrap", "tyres-wrap", "pads-wrap", "vehicles-wrap", "cars-wrap", "share-wrap"]),
]


def open_admin(page, name):
    page.route("**/%s/**" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}), headers={"Access-Control-Allow-Origin": "*"}))
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/" + name)
    expect(page.locator(".admin-nav")).to_be_visible()


def luminance(rgb):
    r, g, b = [int(x) for x in re.findall(r"\d+", rgb)[:3]]
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


@pytest.mark.parametrize("name", PAGES)
def test_the_admin_pages_are_light_and_share_one_navigation(page, name):
    open_admin(page, name)
    assert luminance(page.evaluate("getComputedStyle(document.body).backgroundColor")) > 0.85
    assert luminance(page.evaluate("getComputedStyle(document.body).color")) < 0.3
    links = page.locator(".admin-nav a")
    assert links.all_inner_texts() == ["Gallery and builds", "Reports", "Members", "Owner interviews", "Track sessions", "Sharing links", "Events", "Device checks"]
    hrefs = [links.nth(i).get_attribute("href") for i in range(links.count())]
    assert hrefs == ["admin.html#grp-gallery", "admin.html#grp-reports", "admin.html#grp-members", "admin.html#grp-interviews", "track-admin.html", "admin.html#grp-sharing", "events-admin.html", "device-checklist.html"]
    current = page.locator('.admin-nav a[aria-current="page"]')
    if name == "admin.html":
        expect(current).to_have_count(0)
    else:
        expect(current).to_have_text("Events" if name == "events-admin.html" else "Device checks")


def test_admin_panels_sit_in_logical_groups(page):
    open_admin(page, "admin.html")
    heads = page.locator(".admin-group > .group-head h2").all_inner_texts()
    assert heads == [g[1] for g in GROUPS]
    for gid, title, ids in GROUPS:
        inside = page.locator("#%s details.collapsible" % gid).evaluate_all("els => els.map(e => e.id)")
        assert inside == ids, (gid, inside)
        expect(page.locator("#%s .group-head p" % gid)).not_to_be_empty()
    # Every panel is in exactly one group, and each is a white card.
    assert page.locator("details.collapsible").count() == sum(len(g[2]) for g in GROUPS)
    assert page.locator("details.collapsible:not(.admin-group details)").count() == 0
    assert luminance(page.evaluate("getComputedStyle(document.querySelector('#home-share-wrap')).backgroundColor")) > 0.95
    # The nav jumps to a group.
    page.locator('.admin-nav a[href="admin.html#grp-sharing"]').click()
    expect(page.locator("#grp-sharing .group-head h2")).to_be_in_viewport()


def test_the_track_admin_page_has_its_own_categories(page):
    open_admin(page, "track-admin.html")
    expect(page.locator("h1")).to_have_text("MT3UK Track admin")
    assert luminance(page.evaluate("getComputedStyle(document.body).backgroundColor")) > 0.85
    links = page.locator(".admin-nav a")
    assert links.all_inner_texts() == ["Access", "Members' sessions", "Tracks", "Leaderboards", "Content", "Admin home", "Events", "Device checks"]
    heads = page.locator(".admin-group > .group-head h2").all_inner_texts()
    assert heads == [g[1] for g in TRACK_GROUPS]
    for gid, title, ids in TRACK_GROUPS:
        inside = page.locator("#%s details.collapsible" % gid).evaluate_all("els => els.map(e => e.id)")
        assert inside == ids, (gid, inside)
        expect(page.locator("#%s .group-head p" % gid)).not_to_be_empty()
    assert page.locator("details.collapsible").count() == sum(len(g[2]) for g in TRACK_GROUPS)
    assert page.locator("details.collapsible:not(.admin-group details)").count() == 0
    # The admin page no longer carries any of these panels, and its menu leads here.
    page2 = page.context.new_page()
    open_admin(page2, "admin.html")
    for gid, title, ids in TRACK_GROUPS:
        for pid in ids:
            assert page2.locator("#" + pid).count() == 0, pid
    assert page2.locator('.admin-nav a[href="track-admin.html"]').count() == 1


def test_event_and_device_pages_are_grouped(page):
    open_admin(page, "events-admin.html")
    assert page.locator(".admin-group > .group-head h2").all_inner_texts() == ["Event pages", "Meets list"]
    assert page.locator("#grp-pages #ep-wrap").count() == 1 and page.locator("#grp-pages #pv-wrap").count() == 1
    assert page.locator("#grp-meets #upcoming-list").count() == 1 and page.locator("#grp-meets #past-wrap").count() == 1
    page2 = page.context.new_page()
    open_admin(page2, "device-checklist.html")
    expect(page2.locator("h1")).to_have_text("Device Checks")
    assert luminance(page2.evaluate("getComputedStyle(document.querySelector('.card')).backgroundColor")) > 0.95


@pytest.mark.parametrize("name", ALL_PAGES)
def test_admin_pages_fit_a_phone(page, name):
    page.set_viewport_size({"width": 390, "height": 844})
    open_admin(page, name)
    assert overflow_width(page) <= 0
    # The navigation scrolls along its own row rather than widening the page.
    nav = page.locator(".admin-nav").bounding_box()
    assert nav["width"] <= 390
    for link in page.locator(".admin-nav a").all():
        assert link.bounding_box()["height"] >= 43


def test_admin_sub_menu_lists_the_sections_of_the_current_category(page):
    open_admin(page, "admin.html")
    sub = page.locator("#admin-subnav")
    # The first category is current at the top: its four panels are listed.
    expect(sub).to_be_visible()
    assert sub.locator("a").all_inner_texts() == ["Pending claims", "Decided claims", "Unclaimed photos", "Build of the Week entries", "Other makes"]
    expect(page.locator('.admin-nav a[data-here="true"]')).to_have_text("Gallery and builds")
    # Choosing a category swaps the sub menu to that category's sections.
    page.locator('.admin-nav a[href="admin.html#grp-sharing"]').click()
    expect(page.locator('.admin-nav a[data-here="true"]')).to_have_text("Sharing links")
    # Choosing a section opens its panel and scrolls to it.
    page.locator('.admin-nav a[href="admin.html#grp-reports"]').click()
    sub.locator("a", has_text="Reported comments").click()
    expect(page.locator("#comments-wrap")).to_have_attribute("open", "")
    expect(page.locator("#comments-wrap summary")).to_be_in_viewport()
    # The sub menu sits under the main menu, not over it.
    a = page.locator(".admin-nav").bounding_box()
    b = sub.bounding_box()
    assert b["y"] >= a["y"] + a["height"] - 1


def test_the_track_admin_sub_menu_lists_the_sections_of_each_category(page):
    open_admin(page, "track-admin.html")
    sub = page.locator("#admin-subnav")
    # Access has one panel, so no sub menu; the second category lists its two.
    page.locator('.admin-nav a[href="track-admin.html#grp-sessions"]').click()
    expect(sub.locator("a")).to_have_text(["New sessions", "Line editing", "Member sessions"])
    expect(page.locator('.admin-nav a[data-here="true"]')).to_have_text("Members' sessions")
    page.locator('.admin-nav a[href="track-admin.html#grp-content"]').click()
    expect(sub.locator("a")).to_have_text(["Welcome text", "Announcement", "Laps panels", "Tyres", "Brake pads", "Vehicles", "Members' cars", "Track sessions sharing"])
    sub.locator("a", has_text="Tyres").click()
    expect(page.locator("#tyres-wrap")).to_have_attribute("open", "")
    expect(page.locator("#tyres-wrap summary")).to_be_in_viewport()
    a = page.locator(".admin-nav").bounding_box()
    b = sub.bounding_box()
    assert b["y"] >= a["y"] + a["height"] - 1


def test_the_old_admin_addresses_for_the_track_panels_lead_to_the_new_page(page):
    open_admin(page, "admin.html")
    page.goto("/admin.html#lines-wrap")
    expect(page).to_have_url(re.compile(r"/track-admin\.html#lines-wrap$"))
    expect(page.locator("#lines-wrap")).to_have_attribute("open", "")
    page.goto("/admin.html#grp-tracks")
    expect(page).to_have_url(re.compile(r"/track-admin\.html#grp-tracks$"))


def test_admin_can_rebuild_the_leaderboards_in_steps(page):
    calls = []

    def rebuild(route):
        url = route.request.url
        calls.append(url)
        data = {"success": True, "cars": 2, "done": False, "cursor": "2"} if "cursor=" not in url else {"success": True, "cars": 1, "done": True, "cursor": ""}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data), headers={"Access-Control-Allow-Origin": "*"})
    open_admin(page, "track-admin.html")
    page.route("**/track/boards/rebuild**", rebuild)
    page.locator("#boards-wrap > summary").click()
    page.once("dialog", lambda d: d.accept())
    page.locator("#tk-rebuild").click()
    expect(page.locator("#tk-rebuild-note")).to_have_text("Done: 3 cars brought up to date.")
    assert len(calls) == 2 and "key=test-key" in calls[0] and "cursor=2" in calls[1]
    expect(page.locator("#tk-rebuild")).to_be_enabled()


def _retime_source():
    """The readings of the Thruxton test file, as the worker keeps them for a session."""
    script = (
        "const fs=require('fs');const T=require('./js/track-parse.js');"
        "const rd=T.read(fs.readFileSync('tests/fixtures/thruxton-trimmed.vbo','latin1'),'f.vbo');"
        "const meta={};Object.keys(rd).forEach(k=>{if(k!=='points')meta[k]=rd[k]});"
        "const r=(v,n)=>v==null||!isFinite(v)?null:Math.round(v*n)/n;"
        "console.log(JSON.stringify({v:1,rd:meta,p:rd.points.map(q=>[r(q.t,1000),r(q.lat,1e7),r(q.lng,1e7),r(q.v,100),r(q.la,1000),r(q.lo,1000),r(q.sats,1),r(q.temp,10),q.run||0])}));"
    )
    return subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True, cwd=".").stdout


def _retime_mocks(page, saved, old_best=99.9, extra_rows=()):
    cors = {"Access-Control-Allow-Origin": "*"}
    source = _retime_source()
    rows = [
        {"id": "aaaaaaaa01", "type": "track", "venue": "Thruxton", "date": "2026-07-01", "best": 99.9, "version": 1, "hasSource": True, "owner": "Chris R"},
        {"id": "aaaaaaaa02", "type": "track", "venue": "Castle Combe", "date": "2026-07-02", "best": 80.1, "version": 1, "hasSource": False},
        {"id": "aaaaaaaa03", "type": "track", "venue": "Croft", "date": "2026-07-03", "best": 70.0, "version": 99, "hasSource": True},
    ]
    rows += list(extra_rows)
    old = {"id": "aaaaaaaa01", "type": "track", "venue": "Thruxton", "date": "2026-07-01", "time": "10:00", "bestTime": old_best}

    def retime(route):
        req = route.request
        if req.method == "POST":
            saved.append(json.loads(req.post_data))
            body = {"success": True, "session": {"id": "aaaaaaaa01"}}
        elif "id=" in req.url:
            body = {"success": True, "session": old}
        else:
            body = {"success": True, "sessions": rows, "done": True, "cursor": ""}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=cors)

    # The readings arrive still gzipped, as they did on the live site, so the page has to unzip them itself.
    page.route("**/track/admin/retime/source**", lambda route: route.fulfill(status=200, content_type="application/json", body=gzip.compress(source.encode()), headers=cors))
    page.route("**/track/admin/retime?**", retime)
    page.route("**/track/admin/retime", retime)
    page.route("**/track/boards/rebuild**", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "cars": 4, "done": True, "cursor": ""}), headers=cors))
    page.route("**/track/admin/tracks**", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {}}), headers=cors))


def test_admin_check_sessions_counts_old_ones_and_saves_nothing(page):
    saved = []
    open_admin(page, "track-admin.html")
    _retime_mocks(page, saved)
    page.locator("#boards-wrap > summary").click()
    page.locator("#tk-retime-check").click()
    note = page.locator("#tk-retime-note")
    expect(note).to_contain_text("3 sessions looked at")
    expect(note).to_contain_text("2 were timed with older code")
    expect(note).to_contain_text("1 have no readings kept")
    # What would change is listed under the member and the course, each with a switch, and links to the session.
    expect(page.locator("#tk-retime-picks .rt-member")).to_contain_text("Chris R")
    expect(page.locator("#tk-retime-picks .rt-course")).to_contain_text("Thruxton")
    expect(page.locator("#tk-retime-picks .rt-row a")).to_have_attribute("href", "track.html?s=aaaaaaaa01")
    expect(page.locator("#tk-retime-picks .rt-row a")).to_contain_text("2026-07-01")
    assert saved == []


def test_admin_check_sessions_lets_you_switch_sessions_off_and_re_times_only_the_rest(page):
    saved = []
    open_admin(page, "track-admin.html")
    extra = [{"id": "aaaaaaaa04", "type": "track", "venue": "Thruxton", "date": "2026-07-04", "best": 99.9, "version": 1, "hasSource": True, "owner": "Dana K"}]
    _retime_mocks(page, saved, extra_rows=extra)
    page.on("dialog", lambda d: d.accept())
    page.locator("#boards-wrap > summary").click()
    page.locator("#tk-retime-check").click()
    expect(page.locator("#tk-retime-picks .rt-member")).to_have_count(2)
    # Anything else that would change besides the time is spelt out, such as the course.
    expect(page.locator("#tk-retime-picks .rt-row").first).to_contain_text("Course:")
    go = page.locator("#tk-retime-selected")
    expect(go).to_have_text("Re-time selected (2)")
    # Switching a member off leaves them out.
    page.locator('#tk-retime-picks [data-pick-group="member"][data-who="Dana K"]').click()
    expect(go).to_have_text("Re-time selected (1)")
    go.click()
    expect(page.locator("#tk-retime-note")).to_contain_text("Leaderboards rebuilt (4 cars)")
    assert [x["id"] for x in saved] == ["aaaaaaaa01"], saved


def test_admin_retime_shows_the_outcome_first_and_saves_only_when_selected_is_pressed(page):
    saved = []
    open_admin(page, "track-admin.html")
    _retime_mocks(page, saved)
    page.on("dialog", lambda d: d.accept())
    page.locator("#boards-wrap > summary").click()
    # The Re-time button only works things out: nothing is saved, and the outcome is spelt out.
    page.locator("#tk-retime").click()
    expect(page.locator("#tk-retime-outcome")).to_contain_text("If you press Re-time selected")
    expect(page.locator("#tk-retime-outcome")).to_contain_text("will move to another course or track")
    expect(page.locator("#tk-retime-outcome")).to_contain_text("every leaderboard is rebuilt")
    assert saved == []
    page.locator("#tk-retime-selected").click()
    expect(page.locator("#tk-retime-note")).to_contain_text("Leaderboards rebuilt (4 cars)")
    assert len(saved) == 1 and saved[0]["id"] == "aaaaaaaa01"
    s = saved[0]["session"]
    assert s["analysisVersion"] >= 2 and s["date"] == "2026-07-01" and s["laps"]


def test_admin_retime_holds_back_a_best_time_that_moves_over_ten_percent(page):
    saved = []
    open_admin(page, "track-admin.html")
    _retime_mocks(page, saved, old_best=60.0)
    page.on("dialog", lambda d: d.accept())
    page.locator("#boards-wrap > summary").click()
    page.locator("#tk-retime-check").click()
    expect(page.locator("#tk-retime-picks .rt-row")).to_contain_text("off unless you allow big changes")
    expect(page.locator("#tk-retime-picks .rt-row [data-pick]")).to_have_attribute("aria-checked", "false")
    expect(page.locator("#tk-retime-note")).to_contain_text("1 held back for moving over 10%")
    expect(page.locator("#tk-retime-outcome")).to_contain_text("Nothing is switched on")
    assert saved == []


def test_admin_retime_saves_a_big_change_when_the_switch_is_on(page):
    saved = []
    open_admin(page, "track-admin.html")
    _retime_mocks(page, saved, old_best=60.0)
    page.on("dialog", lambda d: d.accept())
    page.locator("#boards-wrap > summary").click()
    page.locator("#tk-retime-big").click()
    expect(page.locator("#tk-retime-big")).to_have_attribute("aria-checked", "true")
    page.locator("#tk-retime").click()
    page.locator("#tk-retime-selected").click()
    expect(page.locator("#tk-retime-note")).to_contain_text("Leaderboards rebuilt")
    assert len(saved) == 1 and saved[0]["id"] == "aaaaaaaa01"


def test_admin_track_type_has_sprint_and_hill_climb_as_separate_choices(page):
    open_admin(page, "track-admin.html")
    page.locator("#tracks-wrap > summary").click()
    page.locator("#tk-list [data-edit='shelsley-walsh']").click()
    select = page.locator("#tk-type")
    expect(select.locator("option")).to_have_text(["Circuit", "Drag strip", "Sprint", "Hill climb"])
    expect(select).to_have_value("hill")
    page.locator("#tk-cancel").click()
    page.locator("#tk-list [data-edit='curborough']").click()
    expect(page.locator("#tk-type")).to_have_value("sprint")


def test_admin_early_access_panel_approves_declines_revokes_and_opens(page):
    state = {"open": False, "allowed": [{"email": "old@example.com", "name": "Old", "at": "2026-09-01T10:00:00Z"}],
             "pending": [{"email": "ann@example.com", "name": "Ann B", "use": "RaceBox", "note": "Brands Hatch days", "at": "2026-10-01T09:00:00Z"},
                         {"email": "bob@example.com", "name": "", "use": "Tesla Track Mode", "note": "", "at": "2026-10-01T10:00:00Z"}]}
    calls = []

    def access(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data)
            calls.append(body)
            e = body.get("email")
            if body["action"] == "open":
                state["open"] = body["open"]
            elif body["action"] in ("approve", "add"):
                state["pending"] = [p for p in state["pending"] if p["email"] != e]
                state["allowed"].append({"email": e, "name": "", "at": "2026-10-02T09:00:00Z"})
            elif body["action"] == "deny":
                state["pending"] = [p for p in state["pending"] if p["email"] != e]
            elif body["action"] == "revoke":
                state["allowed"] = [a for a in state["allowed"] if a["email"] != e]
        route.fulfill(status=200, content_type="application/json", body=json.dumps(dict(state, success=True)), headers={"Access-Control-Allow-Origin": "*"})
    open_admin(page, "track-admin.html")
    page.route("**/track/access/admin**", access)
    page.reload()
    # The count shows without opening the panel.
    expect(page.locator("#access-count")).to_have_text("2 waiting")
    page.locator("#access-wrap summary").click()
    rows = page.locator("#ac-pending tbody tr")
    expect(rows).to_have_count(2)
    expect(rows.first).to_contain_text("Ann B")
    expect(rows.first).to_contain_text("RaceBox")
    expect(rows.first).to_contain_text("Brands Hatch days")
    rows.first.get_by_role("button", name="Approve").click()
    expect(page.locator("#ac-note")).to_contain_text("Approved")
    expect(rows).to_have_count(1)
    expect(page.locator("#ac-allowed")).to_contain_text("ann@example.com")
    rows.first.get_by_role("button", name="Decline").click()
    expect(page.locator("#ac-pending")).to_contain_text("Nobody is waiting")
    expect(page.locator("#access-count")).to_have_text("2 approved")
    # Revoke needs a yes; add by email; open to all.
    page.once("dialog", lambda d: d.accept())
    page.locator("#ac-allowed [data-revoke='old@example.com']").click()
    expect(page.locator("#ac-allowed")).not_to_contain_text("old@example.com")
    page.fill("#ac-add-email", "new@example.com")
    page.get_by_role("button", name="Approve by email").click()
    expect(page.locator("#ac-allowed")).to_contain_text("new@example.com")
    page.once("dialog", lambda d: d.accept())
    page.locator("#ac-open").click()
    expect(page.locator("#ac-open")).to_have_attribute("aria-checked", "true")
    expect(page.locator("#access-count")).to_have_text("open to all")
    assert [c["action"] for c in calls] == ["approve", "deny", "revoke", "add", "open"]


def test_admin_can_add_the_current_testers_to_the_early_access_list(page):
    state = {"open": False, "imported": "", "pending": [], "allowed": []}

    def access(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data)
            if body["action"] == "import":
                state["imported"] = "2026-10-02T09:00:00Z"
                state["allowed"] = [{"email": "john@example.com", "name": "John C", "at": "2026-10-02T09:00:00Z", "existing": True}]
                route.fulfill(status=200, content_type="application/json", body=json.dumps(dict(state, success=True, found=1, added=[{"email": "john@example.com", "name": "John C"}])), headers={"Access-Control-Allow-Origin": "*"})
                return
        route.fulfill(status=200, content_type="application/json", body=json.dumps(dict(state, success=True)), headers={"Access-Control-Allow-Origin": "*"})
    open_admin(page, "track-admin.html")
    page.route("**/track/access/admin**", access)
    page.reload()
    page.locator("#access-wrap summary").click()
    expect(page.locator("#ac-import-note")).to_contain_text("cannot be revoked")
    page.once("dialog", lambda d: d.accept())
    page.locator("#ac-import").click()
    expect(page.locator("#ac-note")).to_contain_text("Added 1: John C")
    expect(page.locator("#ac-allowed")).to_contain_text("john@example.com, current tester")
    expect(page.locator("#ac-import")).to_be_disabled()
    expect(page.locator("#ac-import-note")).to_contain_text("Revoke works for everyone")


def test_the_bell_lists_early_access_requests_and_new_track_requests(page):
    access = {"open": False, "allowed": [], "pending": [{"email": "ann@example.com", "name": "Ann B", "use": "RaceBox", "note": "", "at": "2026-10-01T09:00:00Z"}]}
    req = {"id": "r1", "kind": "sprint", "name": "Newfield Sprint", "from": "j***@example.com", "lat": 51.2, "lng": -0.9, "startLine": [[51.2, -0.9], [51.2002, -0.9002]], "finishLine": [[51.21, -0.91], [51.2102, -0.9102]], "outline": [], "at": "2026-10-02T09:00:00Z"}
    open_admin(page, "track-admin.html")
    ok = {"Access-Control-Allow-Origin": "*"}
    page.route("**/track/access/admin**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(dict(access, success=True)), headers=ok))
    page.route("**/track/admin/requests**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": [req]}), headers=ok))
    page.route("**/track/admin/tracks**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {"venues": []}, "library": {"venues": []}}), headers=ok))
    page.reload()
    expect(page.locator("#bell-badge")).to_be_visible()
    page.locator("#bell-btn").click()
    panel = page.locator("#bell-panel")
    expect(panel).to_contain_text("Early access requests (1)")
    expect(panel).to_contain_text("Ann B")
    expect(panel).to_contain_text("New track requests (1)")
    expect(panel).to_contain_text("Newfield Sprint")
    # Choosing one opens its panel.
    panel.get_by_text("Newfield Sprint").click()
    expect(page.locator("#tracks-wrap")).to_have_attribute("open", "")


def test_new_sessions_are_listed_counted_on_the_bell_cleared_and_have_their_own_switch(page):
    """A member's newly saved session waits on the New sessions panel of track-admin.html (the worker also emailed
    it), is counted on the bell and opens the panel; Clear takes it off; the New sessions switch is its own."""
    ok = {"Access-Control-Allow-Origin": "*"}
    state = {"sessions": [
        {"id": "abc123abc123", "at": "2026-10-04T10:15:00Z", "email": "ann@example.com", "name": "Ann B", "car": "Blue Y", "carId": "carb1",
         "type": "track", "kind": "Track day", "venue": "Thruxton, Full circuit", "date": "2026-10-03", "time": "10:02", "privacy": "board", "result": "9 laps, best 1:31.20", "unlisted": False},
        {"id": "def456def456", "at": "2026-10-04T09:00:00Z", "email": "kit@example.com", "name": "", "car": "Red 3", "carId": "car3",
         "type": "sprint", "kind": "Hill climb", "venue": "Shelsley Walsh", "date": "2026-10-02", "time": "", "privacy": "private", "result": "3 runs, best 0:33.05", "unlisted": True},
    ], "cleared": [], "alerts": {"bell": True, "email": True, "sessions": True}, "alert_posts": []}

    def new_sessions(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            state["cleared"].append(body["clear"])
            state["sessions"] = [] if body["clear"] == "all" else [s for s in state["sessions"] if s["id"] != body["clear"]]
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "sessions": state["sessions"]}), headers=ok)

    def alerts(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            state["alert_posts"].append(body)
            state["alerts"].update(body)
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "alerts": state["alerts"], "stamp": "1", "pushDevices": []}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/track/admin/new-sessions**", new_sessions)
    page.route("**/admin/alerts**", alerts)
    page.reload()
    rows = page.locator("#ns-list tr[data-session]")
    expect(rows).to_have_count(2)
    expect(page.locator("#new-sessions-count")).to_have_text("(2)")
    first = rows.first
    expect(first).to_contain_text("Ann B")
    expect(first).to_contain_text("ann@example.com")
    expect(first).to_contain_text("Thruxton, Full circuit, 2026-10-03 at 10:02")
    expect(first).to_contain_text("Track day, Blue Y")
    expect(first).to_contain_text("9 laps, best 1:31.20")
    expect(first).to_contain_text("board")
    expect(first.locator("a")).to_have_attribute("href", "track.html?s=abc123abc123")
    expect(rows.nth(1)).to_contain_text("kit@example.com")
    expect(rows.nth(1)).to_contain_text("track not listed")
    # Counted on the bell, and an item opens the panel.
    expect(page.locator("#bell-badge")).to_have_text("2")
    page.locator("#bell-btn").click()
    panel = page.locator("#bell-panel")
    expect(panel).to_contain_text("New sessions (2)")
    expect(panel).to_contain_text("Ann B: Thruxton, Full circuit")
    expect(panel).to_contain_text("Track day, Blue Y, 2026-10-03. 9 laps, best 1:31.20")
    panel.locator(".bell-item", has_text="Ann B").click()
    expect(page.locator("#new-sessions-wrap")).to_have_attribute("open", "")
    # Clear takes one off the list and the bell.
    first.locator(".ns-clear").click()
    expect(rows).to_have_count(1)
    assert state["cleared"] == ["abc123abc123"]
    expect(page.locator("#new-sessions-count")).to_have_text("(1)")
    page.on("dialog", lambda d: d.accept())
    page.locator("#ns-clear-all").click()
    expect(rows).to_have_count(0)
    expect(page.locator("#ns-list")).to_contain_text("No new sessions")
    assert state["cleared"] == ["abc123abc123", "all"]
    expect(page.locator("#ns-clear-all")).to_be_hidden()
    # The New sessions switch is its own, beside Bell and Email, and is kept by the worker.
    sw = page.locator("#alerts-sessions")
    expect(sw).to_have_attribute("aria-checked", "true")
    sw.click()
    expect(sw).to_have_attribute("aria-checked", "false")
    expect(page.locator("#alerts-note")).to_contain_text("New sessions off")
    assert state["alert_posts"] == [{"sessions": False}]
    expect(page.locator("#alerts-bell")).to_have_attribute("aria-checked", "true")
    expect(page.locator("#alerts-email")).to_have_attribute("aria-checked", "true")
    page.reload()
    expect(page.locator("#alerts-sessions")).to_have_attribute("aria-checked", "false")
    # admin.html has no such switch, but its bell counts the new sessions too (a session not seen on either page,
    # as the two pages share what the bell has shown) and sends the admin here.
    page2 = page.context.new_page()
    open_admin(page2, "admin.html")
    page2.route("**/track/admin/new-sessions**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "sessions": [{"id": "fed987fed987", "name": "Ann B", "venue": "Thruxton", "kind": "Track day", "car": "Blue Y", "date": "2026-10-03", "result": "9 laps, best 1:31.20"}]}), headers=ok))
    page2.reload()
    assert page2.locator("#alerts-sessions").count() == 0
    expect(page2.locator("#bell-badge")).to_have_text("1")
    page2.locator("#bell-btn").click()
    expect(page2.locator("#bell-panel")).to_contain_text("New sessions (1)")
    page2.locator("#bell-panel .bell-item", has_text="Ann B").click()
    page2.wait_for_url("**/track-admin.html#new-sessions-wrap")
    expect(page2.locator("#new-sessions-wrap")).to_have_attribute("open", "")


def test_a_track_a_member_added_is_marked_for_review_and_marked_reviewed(page):
    req = {"id": "r2", "kind": "circuit", "name": "Blyton Park", "from": "j***@example.com", "lat": 51.3, "lng": -0.7, "added": True, "venueId": "blyton-park", "layoutId": "course",
           "startLine": [[51.3, -0.7], [51.3002, -0.7002]], "outline": [[51.3, -0.7], [51.305, -0.705]], "at": "2026-10-03T09:00:00Z"}
    venue = {"id": "blyton-park", "name": "Blyton Park", "type": "circuit", "lat": 51.3, "lng": -0.7, "radius": 2000, "review": True, "layouts": [{"id": "course", "name": "Blyton Park", "length": 2400, "startLine": req["startLine"]}]}
    posted = []
    ok = {"Access-Control-Allow-Origin": "*"}

    def requests(route):
        if route.request.method == "POST":
            posted.append(json.loads(route.request.post_data))
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}), headers=ok)
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": [req]}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/track/access/admin**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "open": False, "allowed": [], "pending": []}), headers=ok))
    page.route("**/track/admin/requests**", requests)
    page.route("**/track/admin/tracks**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {"venues": [venue]}, "library": {"venues": [venue]}}), headers=ok))
    page.reload()
    page.locator("#tracks-wrap > summary").click()
    card = page.locator("#tk-requests .tk-req")
    expect(card).to_have_class(re.compile(r"is-added"))
    expect(card).to_contain_text("Added by the member and live now")
    expect(card.get_by_role("button", name="Approve and add track")).to_have_count(0)
    expect(card.get_by_role("button", name="Dismiss")).to_have_count(0)
    expect(page.locator("#tk-list")).to_contain_text("Added by a member, to review")
    expect(page.locator("#tracks-count")).to_have_text("(1 new)")
    card.get_by_role("button", name="Mark reviewed").click()
    expect(page.locator("#tk-note")).to_contain_text("Marked as reviewed")
    assert posted == [{"id": "r2", "action": "approve"}]
    expect(page.locator("#tk-requests")).to_contain_text("No new requests")
    expect(page.locator("#tk-list")).not_to_contain_text("to review")


def test_admin_can_open_a_map_of_a_requested_course_and_the_load_refreshes_everything(page):
    req = {"id": "r1", "kind": "sprint", "name": "Newfield Sprint", "organizer": "B19", "from": "j***@example.com", "lat": 51.2, "lng": -0.9,
           "startLine": [[51.2, -0.9], [51.2002, -0.9002]], "finishLine": [[51.21, -0.91], [51.2102, -0.9102]],
           "outline": [[51.2, -0.9], [51.205, -0.905], [51.21, -0.91]], "at": "2026-10-02T09:00:00Z"}
    hits = {"access": 0}
    ok = {"Access-Control-Allow-Origin": "*"}

    def access(route):
        hits["access"] += 1
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "open": False, "allowed": [], "pending": []}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/track/access/admin**", access)
    page.route("**/track/admin/requests**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": [req]}), headers=ok))
    page.route("**/track/admin/tracks**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {"venues": []}, "library": {"venues": []}}), headers=ok))
    page.reload()
    page.locator("#tracks-wrap > summary").click()
    page.get_by_role("button", name="Open map").click()
    modal = page.locator("#tk-map-modal")
    expect(modal).to_be_visible()
    expect(modal.locator("text", has_text="Start")).to_have_count(1)
    expect(modal.locator("text", has_text="Finish")).to_have_count(1)
    modal.get_by_role("button", name="Close").click()
    expect(modal).to_have_count(0)
    # Refresh asks for everything again, including the early access list.
    before = hits["access"]
    page.get_by_role("button", name="Refresh").click()
    page.wait_for_timeout(500)
    assert hits["access"] > before


def _share_session():
    """A saved session with everything the preview card draws: a square lap trace, corners, a start line and figures."""
    loop = [[0, 0, 0, 0, 100, 0, 0], [400, 10, 400, 0, 120, 0.4, 0], [800, 20, 400, 400, 140, -0.6, 0], [1200, 30, 0, 400, 160, 0.5, 0], [1600, 40, 0, 0, 100, 0, 0]]
    slower = [[r[0], r[1] * 1.05, r[2], r[3], r[4] - 5, r[5] * 0.8, r[6]] for r in loop]
    return {"id": "aaaaaaaa01", "type": "track", "venue": "Thruxton", "layout": "Thruxton", "date": "2026-05-28", "time": "14:34", "best": 1, "bestTime": 40.0,
            "laps": [{"n": 1, "time": 40.0, "kind": "timed"}, {"n": 2, "time": 42.0, "kind": "timed"}], "vmax": 160.0, "latMax": 0.6, "brakeMax": 0.9,
            "origin": [51.0, -1.0], "startLine": [[51.0, -1.0], [51.0, -1.0001]], "corners": [{"n": 1, "x": 400, "y": 0}, {"n": 2, "x": 400, "y": 400}],
            "trace": {"hz": 5, "laps": {"1": loop, "2": slower}}}


def test_admin_link_preview_pictures_rotate_and_are_drawn_from_sessions(page):
    cors = {"Access-Control-Allow-Origin": "*"}
    posted, uploads = [], []
    state = {"success": True, "rotate": True, "current": "", "week": "2026-W40", "version": 3,
             "items": [{"id": "p1", "kind": "session", "caption": "Thruxton in the dry", "label": "Thruxton, 2026-05-28", "sessionId": "aaaaaaaa01", "url": "https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev/share/track/p1.jpg"},
                       {"id": "p2", "kind": "photo", "caption": "", "label": "Paddock", "sessionId": "", "url": "https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev/share/track/p2.jpg"}]}
    state["pick"] = state["items"][1]

    def share_admin(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data)
            posted.append(body)
            if body["action"] == "rotate":
                state["rotate"] = body["on"]
            if body["action"] == "caption":
                next(i for i in state["items"] if i["id"] == body["id"])["caption"] = body["caption"]
            if body["action"] == "use":
                state["rotate"], state["current"], state["pick"] = False, body["id"], next(i for i in state["items"] if i["id"] == body["id"])
        route.fulfill(status=200, content_type="application/json", body=json.dumps(state), headers=cors)

    def share_image(route):
        uploads.append(route.request.post_data_buffer)
        state["items"].append({"id": "p3", "kind": "session", "caption": "New one", "label": "Thruxton, 2026-05-28", "sessionId": "aaaaaaaa01", "url": "https://pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev/share/track/p3.jpg"})
        route.fulfill(status=200, content_type="application/json", body=json.dumps(dict(state, id="p3")), headers=cors)

    def retime(route):
        if "id=" in route.request.url:
            body = {"success": True, "session": _share_session()}
        else:
            body = {"success": True, "sessions": [{"id": "aaaaaaaa01", "type": "track", "venue": "Thruxton", "date": "2026-05-28", "best": 40.0, "version": 5, "hasSource": True, "owner": "RichyRich", "privacy": "private"},
                                                   {"id": "aaaaaaaa02", "type": "other", "venue": "", "date": "2026-05-29", "best": None, "version": 5, "hasSource": True, "owner": "Ann", "privacy": "board"}], "done": True, "cursor": ""}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=cors)

    open_admin(page, "track-admin.html")
    # The later route wins, so the upload route goes on after the general one.
    page.route("**/share/track/admin**", share_admin)
    page.route("**/share/track/admin/image**", share_image)
    page.route("**/track/admin/retime**", retime)
    page.route("**/pub-818c4c87bd6e40b7afe697d8b72fe4e3.r2.dev/**", lambda route: route.abort())
    page.locator("#share-wrap summary").click()
    items = page.locator("#share-wrap .ts-list .ts-item")
    expect(items).to_have_count(2)
    expect(page.locator("#share-wrap .ts-rotate")).to_have_attribute("aria-checked", "true")
    expect(items.nth(1)).to_have_class(re.compile("is-now"))
    expect(items.nth(1).locator(".ts-now")).to_have_text("This week")
    expect(items.nth(0).locator("input[data-caption]")).to_have_value("Thruxton in the dry")
    expect(items.nth(0).locator("a.ts-open")).to_have_attribute("href", "track.html?s=aaaaaaaa01")
    # Share, on the picture showing: the page's link with the week and the set's version, and the caption as the message.
    page.evaluate("window.__shared = []; navigator.share = function (d) { window.__shared.push(d); return Promise.resolve(); };")
    expect(items.nth(0).get_by_role("button", name="Share")).to_have_count(0)
    items.nth(1).get_by_role("button", name="Share").click()
    shared = page.evaluate("window.__shared.pop()")
    assert re.fullmatch(r"https://mt3uk\.com/share/section/track\.html\?utm_source=share_sheet&utm_medium=share&utm_campaign=page_track&w=\d{4}-W\d{2}\.3", shared["url"]), shared
    assert shared["text"].startswith("Track sessions on MT3UK: ") and "lap timer file" in shared["text"], shared
    # A caption is saved as it is typed.
    items.nth(1).locator("input[data-caption]").fill("Our paddock")
    items.nth(1).locator("input[data-caption]").press("Tab")
    expect(page.locator("#share-wrap .ts-note")).to_have_text("Caption saved.")
    assert posted[-1] == {"action": "caption", "id": "p2", "caption": "Our paddock"}
    # Use this now: rotation goes off and that picture is the one.
    items.nth(0).get_by_role("button", name="Use this now").click()
    expect(page.locator("#share-wrap .ts-rotate")).to_have_attribute("aria-checked", "false")
    expect(items.nth(0).locator(".ts-now")).to_have_text("In use")
    assert posted[-1] == {"action": "use", "id": "p1"}
    page.locator("#share-wrap .ts-rotate").click()
    assert posted[-1] == {"action": "rotate", "on": True}
    # Only sessions with laps are offered; choosing one draws the card, with its own figures on it.
    options = page.locator("#share-wrap .ts-session option")
    expect(options).to_have_count(2)
    expect(options.nth(1)).to_have_text("Thruxton, 2026-05-28, 0:40.00, RichyRich (private)")
    page.locator("#share-wrap .ts-session").select_option("aaaaaaaa01")
    expect(page.locator("#share-wrap .ts-make")).to_be_enabled()
    expect(page.locator("#share-wrap .ts-preview")).to_be_visible()
    drawn = page.evaluate("""() => { const c = document.querySelector('#share-wrap .ts-preview'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return { w: c.width, h: c.height, colours: seen.size }; }""")
    assert drawn["w"] == 1200 and drawn["h"] == 630 and drawn["colours"] > 40, drawn
    page.locator("#share-wrap .ts-caption").fill("New one")
    page.locator("#share-wrap .ts-make").click()
    expect(items).to_have_count(3)
    assert len(uploads) == 1 and b"image/jpeg" in uploads[0] and b'name="kind"' in uploads[0] and b"session" in uploads[0] and b"New one" in uploads[0] and b"aaaaaaaa01" in uploads[0]
    # The label names the track and day; whose session it was is not in anything saved or shared.
    assert b"Thruxton, 2026-05-28" in uploads[0] and b"RichyRich" not in uploads[0]
    expect(page.locator("#share-wrap .ts-note")).to_contain_text("Saved.")


def test_the_homepage_link_picture_panel_reads_its_own_slot(page):
    """The homepage has a panel of its own on the main admin page, on the same code as the Track sessions one."""
    cors = {"Access-Control-Allow-Origin": "*"}
    open_admin(page, "admin.html")
    seen = []
    page.route("**/share/home/admin**", lambda route: (seen.append(route.request.url), route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "slot": "home", "rotate": False, "current": "", "version": 0, "week": "2026-W40", "items": [], "pick": None}), headers=cors)))
    page.locator("#home-share-wrap summary").click()
    expect(page.locator("#home-share-wrap .ts-list")).to_contain_text("No pictures yet")
    assert seen and "/share/home/admin" in seen[0]
    # Its picker lists the build gallery's photos; choosing one fetches it through the worker and previews the crop.
    import struct, zlib
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 2, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(b"\x00" + b"\x80\x40\x20" * 4 for _ in range(2)))) + chunk(b"IEND", b"")
    fetched = []
    page.route("**/share/home/admin/photo**", lambda route: (fetched.append(route.request.url), route.fulfill(status=200, content_type="image/png", body=png, headers=cors)))
    options = page.locator("#home-share-wrap .ts-gallery option")
    expect(options.nth(1)).to_be_attached()
    assert options.count() > 1 and not page.locator("#share-wrap .ts-gallery").count()
    page.locator("#home-share-wrap .ts-gallery").select_option(index=1)
    expect(page.locator("#home-share-wrap .ts-preview")).to_be_visible()
    expect(page.locator("#home-share-wrap .ts-make")).to_be_enabled()
    assert "/share/home/admin/photo?file=" in fetched[0]


def test_admin_renames_a_session_at_a_track_we_do_not_list(page):
    cors = {"Access-Control-Allow-Origin": "*"}
    renamed = []
    sessions = [
        {"id": "aaaa1111", "type": "track", "venue": "abingdon", "venueId": "", "layout": "", "date": "2026-09-20", "privacy": "private"},
        {"id": "bbbb2222", "type": "track", "venue": "Thruxton", "venueId": "thruxton", "layout": "Main", "date": "2026-09-21", "privacy": "board"},
    ]

    def admin_sessions(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "sessions": sessions, "views": []}), headers=cors)

    def rename(route):
        body = json.loads(route.request.post_data)
        renamed.append((parse_qs(urlparse(route.request.url).query)["key"][0], body))
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "session": {"id": body["id"], "venue": body["venue"].title(), "layout": ""}}), headers=cors)

    open_admin(page, "track-admin.html")
    page.route("**/track/admin/sessions**", admin_sessions)
    page.route("**/track/admin/session?**", rename)
    page.locator("#member-sessions-wrap summary").click()
    page.fill("#ms-email", "sam@example.com")
    page.locator("#ms-find").click()
    rows = page.locator("#ms-list tbody tr")
    expect(rows).to_have_count(2)
    # The unlisted one has a name box; the listed one shows where its name comes from.
    box = rows.nth(0).locator(".ms-name")
    expect(box).to_have_value("abingdon")
    expect(rows.nth(1).locator(".ms-name")).to_have_count(0)
    expect(rows.nth(1)).to_contain_text("Listed track")
    box.fill("abingdon airfield")
    box.press("Enter")
    expect(page.locator("#ms-note")).to_contain_text("Renamed to Abingdon Airfield")
    assert renamed == [("test-key", {"id": "aaaa1111", "venue": "abingdon airfield"})]
    expect(rows.nth(0).locator("a")).to_have_text("Abingdon Airfield")
    expect(box).to_have_value("Abingdon Airfield")
    # A blank name is not sent.
    box.fill("  ")
    rows.nth(0).locator(".ms-save").click()
    expect(page.locator("#ms-note")).to_contain_text("Enter the track name.")
    assert len(renamed) == 1


def test_admin_welcome_text_is_edited_and_reset(page):
    cors = {"Access-Control-Allow-Origin": "*"}
    posted = []
    stored = {"heading": "Lap times for every MT3UK car"}

    def copy_admin(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            posted.append(body)
            stored.clear()
            if not body.get("reset"):
                stored.update({k: v for k, v in body.items() if v})
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "copy": dict(stored)}), headers=cors)

    open_admin(page, "track-admin.html")
    page.route("**/track/copy/admin**", copy_admin)
    page.locator("#copy-wrap summary").click()
    expect(page.locator("#tc-heading")).to_have_value("Lap times for every MT3UK car")
    expect(page.locator("#tc-intro")).to_have_value("")
    expect(page.locator("#tc-intro")).to_have_attribute("placeholder", re.compile(r"^Upload the file from your lap timer"))
    page.locator("#tc-intro").fill("Bring your RaceBox file and see every lap.")
    page.locator("#tc-bullets").fill("One\n\nTwo  \nThree")
    page.locator("#tc-save").click()
    expect(page.locator("#tc-note")).to_contain_text("Saved")
    assert posted[-1] == {"heading": "Lap times for every MT3UK car", "intro": "Bring your RaceBox file and see every lap.", "bullets": ["One", "Two", "Three"], "tipHeading": "", "tipText": "", "tipOff": False,
                          "previewOut": "", "previewNone": "", "previewPending": ""}
    # The early preview note: three boxes, the built-in words as placeholders.
    expect(page.locator("#tc-preview-out")).to_have_attribute("placeholder", re.compile(r"^Anyone can browse the leaderboards"))
    expect(page.locator("#tc-preview-pending")).to_have_attribute("placeholder", re.compile(r"as soon as your place is ready"))
    page.locator("#tc-preview-out").fill("Testers only for now. Join the list.")
    page.locator("#tc-save").click()
    expect(page.locator("#tc-note")).to_contain_text("Saved")
    assert posted[-1]["previewOut"] == "Testers only for now. Join the list."
    # The tip on Sessions and the Leaderboard: its own words, and a switch to hide it.
    expect(page.locator("#tc-tip-heading")).to_have_attribute("placeholder", re.compile(r"^Tip: the more you upload"))
    page.locator("#tc-tip-heading").fill("Keep uploading")
    page.locator("#tc-tip-on").click()
    page.locator("#tc-save").click()
    expect(page.locator("#tc-note")).to_contain_text("Saved")
    assert posted[-1]["tipHeading"] == "Keep uploading" and posted[-1]["tipOff"] is True
    expect(page.locator("#tc-tip-on")).to_have_attribute("aria-checked", "false")
    page.on("dialog", lambda d: d.accept())
    page.locator("#tc-reset").click()
    expect(page.locator("#tc-note")).to_contain_text("built-in")
    assert posted[-1] == {"reset": True}
    expect(page.locator("#tc-heading")).to_have_value("")


def test_admin_announcement_for_sessions(page):
    cors = {"Access-Control-Allow-Origin": "*"}
    stored, posted = {}, []

    def news_admin(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            posted.append(body)
            stored.clear()
            if not body.get("clear"):
                stored.update({"id": "9", "text": body["text"], "link": "", "linkText": "", "on": body["on"]})
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "news": dict(stored)}), headers=cors)

    open_admin(page, "track-admin.html")
    page.route("**/laps/news/admin**", news_admin)
    page.locator("#news-wrap summary").click()
    expect(page.locator("#an-note")).to_contain_text("No announcement")
    page.locator("#an-text").fill("New: Compare pads")
    page.locator("#an-link").fill("javascript:alert(1)")
    page.locator("#an-on").click()
    page.locator("#an-save").click()
    assert posted[-1] == {"text": "New: Compare pads", "link": "javascript:alert(1)", "linkText": "", "on": True}
    # The worker dropped the link, and the panel says so.
    expect(page.locator("#an-note")).to_contain_text("the link was left off")
    expect(page.locator("#an-on")).to_have_attribute("aria-checked", "true")
    page.on("dialog", lambda d: d.accept())
    page.locator("#an-clear").click()
    expect(page.locator("#an-note")).to_contain_text("Removed")
    assert posted[-1] == {"clear": True}


def test_admin_laps_panels_edit_the_front_page_sections_and_where_they_show(page):
    cors = {"Access-Control-Allow-Origin": "*"}
    stored, posted = {"fastest": {"show": {"sessions": True}}}, []

    def panels_admin(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            posted.append(body)
            stored.clear()
            if not body.get("reset"):
                stored.update(body["panels"])
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "panels": dict(stored)}), headers=cors)

    open_admin(page, "track-admin.html")
    page.route("**/laps/panels/admin**", panels_admin)
    page.locator("#panels-wrap summary").click()
    panels = page.locator("#lpn-list .lpn-panel")
    expect(panels).to_have_count(5)
    expect(panels.first.locator("legend")).to_have_text("Fastest right now")
    fast = panels.first
    expect(fast.locator("[data-place='sessions']")).to_have_attribute("aria-checked", "true")
    expect(fast.locator("[data-place='front']")).to_have_attribute("aria-checked", "true")
    what = page.locator("#lpn-list .lpn-panel[data-id='what']")
    expect(what.locator("[data-f='heading']")).to_have_attribute("placeholder", "What Laps does")
    expect(what.locator("[data-card]")).to_have_count(8)
    what.locator("[data-f='heading']").fill("What Laps does for you")
    what.locator("[data-place='leaderboard']").click()
    page.locator("#lpn-list .lpn-panel[data-id='timers'] [data-f='items']").fill("RaceBox\n\nVBOX")
    page.locator("#lpn-save").click()
    expect(page.locator("#lpn-note")).to_contain_text("Saved")
    sent = posted[-1]["panels"]
    assert sent["what"]["heading"] == "What Laps does for you" and sent["what"]["show"] == {"front": True, "sessions": False, "leaderboard": True}
    assert sent["timers"]["items"] == ["RaceBox", "VBOX"] and sent["fastest"]["show"]["sessions"] is True
    page.on("dialog", lambda d: d.accept())
    page.locator("#lpn-reset").click()
    expect(page.locator("#lpn-note")).to_contain_text("own words")
    assert posted[-1] == {"reset": True}


def test_admin_sharing_panel_loads_once_the_admin_key_is_entered(page):
    cors = {"Access-Control-Allow-Origin": "*"}
    state = {"success": True, "slot": "track", "rotate": False, "current": "", "version": 0, "week": "2026-W40", "items": [], "pick": None}
    page.route("**/%s/**" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(state if "/share/track/admin" in route.request.url else {"success": True, "sessions": [{"id": "aaaaaaaa01", "type": "track", "venue": "Thruxton", "date": "2026-05-28", "best": 40.0, "owner": "Ann", "privacy": "board"}], "done": True, "cursor": ""}), headers=cors))
    page.goto("/track-admin.html")
    page.locator("#share-wrap summary").click()
    expect(page.locator("#share-wrap .ts-note")).to_have_text("Enter the admin key at the top of the page first.")
    # The key goes in and the page refreshes its panels: this one fills in without being closed and opened again.
    page.evaluate("sessionStorage.setItem('mt3ukAdminKey', 'test-key'); document.dispatchEvent(new CustomEvent('mt3uk-admin-refresh'))")
    expect(page.locator("#share-wrap .ts-list")).to_contain_text("No pictures yet")
    expect(page.locator("#share-wrap .ts-session option")).to_have_count(2)


LINES_API = "**/track/lines/admin**"


def test_admin_line_editing_panel_handles_a_track_rename_the_same_way(page):
    """A rename request sits on the same panel: the admin allows it, sees the name from and to, and accepts it."""
    state = {"requests": [
        {"kind": "rename", "id": "r1", "name": "Dee", "email": "d***@example.com", "note": "Spelt wrong", "at": "2026-10-01T09:00:00Z", "status": "pending", "grantedAt": "", "proposal": None, "what": "Aerodrome, 2026-09-30", "type": "track", "current": "Aerodrome"},
        {"kind": "rename", "id": "r2", "name": "Eve", "email": "e***@example.com", "note": "", "at": "2026-10-01T10:00:00Z", "status": "granted", "grantedAt": "2026-10-01T11:00:00Z", "what": "Aerodrome, 2026-09-29", "type": "track", "current": "Aerodrome",
         "proposal": {"at": "2026-10-02T09:30:00Z", "from": "Aerodrome", "to": "Newtown Aerodrome"}},
    ]}
    calls = []

    def lines(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data)
            calls.append((body.get("kind"), body["action"], body["id"]))
            row = next(r for r in state["requests"] if r["id"] == body["id"])
            if body["action"] == "grant":
                row["status"], row["grantedAt"] = "granted", "2026-10-03T08:00:00Z"
            elif body["action"] == "accepted":
                row["proposal"] = None
        route.fulfill(status=200, content_type="application/json", body=json.dumps(dict(state, success=True)), headers={"Access-Control-Allow-Origin": "*"})
    open_admin(page, "track-admin.html")
    page.route(LINES_API, lines)
    page.reload()
    expect(page.locator("#lines-count")).to_have_text("1 to review")
    page.locator("#lines-wrap summary").click()
    rows = page.locator("#ln-list > table > tbody > tr")
    expect(rows).to_have_count(2)
    expect(rows.nth(0)).to_contain_text("Rename the track")
    expect(rows.nth(0)).to_contain_text("Spelt wrong")
    expect(rows.nth(1)).to_contain_text("Track name")
    expect(rows.nth(1)).to_contain_text("Aerodrome")
    expect(rows.nth(1)).to_contain_text("Newtown Aerodrome")
    rows.nth(0).get_by_role("button", name="Allow").click()
    expect(rows.nth(0)).to_contain_text("Waiting for them to rename the track")
    page.once("dialog", lambda d: d.accept())
    rows.nth(1).get_by_role("button", name="Accept").click()
    expect(page.locator("#ln-note")).to_contain_text("The track name is changed")
    assert calls == [("rename", "grant", "r1"), ("rename", "accepted", "r2")]


def test_admin_accepts_a_layout_rename_which_updates_the_saved_sessions_a_page_at_a_time(page):
    """A member asked to rename a layout. The confirm says it changes for everyone; accepting renames it in the track list
    and then the saved sessions follow in pages until the worker says it is done."""
    state = {"requests": [
        {"kind": "rename", "target": "layout", "id": "l1", "name": "Sam", "email": "s***@example.com", "note": "", "at": "2026-10-01T10:00:00Z", "status": "granted", "grantedAt": "2026-10-01T11:00:00Z", "what": "Brands Hatch, New Layout, 2026-09-29", "type": "track", "current": "New Layout",
         "proposal": {"at": "2026-10-02T09:30:00Z", "from": "New Layout", "to": "Indy Circuit", "target": "layout"}},
    ]}
    calls, dialogs = [], []

    def lines(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data)
            calls.append((body.get("action"), body.get("cursor")))
            if body["action"] == "accepted":
                out = {"success": True, "more": True, "cursor": ""}
            else:
                n = sum(1 for c in calls if c[0] == "apply")
                out = {"success": True, "done": n >= 3, "cursor": "c%d" % n, "changed": 4}
                if n >= 3:
                    state["requests"][0]["proposal"] = None
            route.fulfill(status=200, content_type="application/json", body=json.dumps(out), headers={"Access-Control-Allow-Origin": "*"})
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps(dict(state, success=True)), headers={"Access-Control-Allow-Origin": "*"})
    open_admin(page, "track-admin.html")
    page.route(LINES_API, lines)
    page.reload()
    page.locator("#lines-wrap summary").click()
    row = page.locator("#ln-list > table > tbody > tr").first
    expect(row).to_contain_text("Rename the layout, for everyone")
    expect(row).to_contain_text("Layout name")
    expect(row).to_contain_text("Indy Circuit")
    page.once("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    row.get_by_role("button", name="Accept").click()
    expect(page.locator("#ln-note")).to_contain_text("on 12 saved sessions")
    assert "for everyone" in dialogs[0] and "Nothing is re-timed" in dialogs[0], dialogs
    assert calls == [("accepted", None), ("apply", ""), ("apply", "c1"), ("apply", "c2")], calls


def test_admin_line_editing_panel_allows_shows_the_change_and_undoes_or_revokes(page):
    """Members ask to edit a map; the admin allows it, sees who has access to which map and what they changed
    (from and to), and can undo the change or revoke the access."""
    line = lambda a, b: [[a, b], [round(a + 0.0002, 4), round(b + 0.0002, 4)]]
    state = {"requests": [
        {"id": "s1", "name": "Ann B", "email": "a***@example.com", "note": "The finish is early", "at": "2026-10-01T09:00:00Z", "status": "pending", "grantedAt": "", "proposal": None, "what": "Abingdon Airfield, AMC LCS, 2022-04-10", "type": "sprint", "best": 118.089},
        {"id": "s2", "name": "Bob", "email": "b***@example.com", "note": "", "at": "2026-10-01T10:00:00Z", "status": "granted", "grantedAt": "2026-10-01T11:00:00Z", "proposal": None, "what": "Thruxton, 2026-05-28", "type": "track", "best": 99.786},
        {"id": "s3", "name": "Cat", "email": "c***@example.com", "note": "", "at": "2026-10-01T12:00:00Z", "status": "granted", "grantedAt": "2026-10-01T13:00:00Z", "what": "Brands Hatch, 2026-06-01", "type": "track", "best": 99.8,
         "proposal": {"at": "2026-10-02T09:30:00Z", "from": {"startLine": line(51.1, -1.1), "finishLine": None, "time": 99.8}, "to": {"startLine": line(51.1005, -1.1005), "finishLine": None, "time": 99.2}, "images": {"before": True, "after": True}, "emailFailed": True}},
    ]}
    calls = []

    def lines(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data)
            calls.append((body["action"], body["id"]))
            row = next(r for r in state["requests"] if r["id"] == body["id"])
            if body["action"] == "grant":
                row["status"], row["grantedAt"] = "granted", "2026-10-03T08:00:00Z"
            elif body["action"] == "undo":
                row["proposal"] = None
            elif body["action"] == "revoke":
                state["requests"].remove(row)
        route.fulfill(status=200, content_type="application/json", body=json.dumps(dict(state, success=True)), headers={"Access-Control-Allow-Origin": "*"})
    open_admin(page, "track-admin.html")
    page.route(LINES_API, lines)
    page.reload()
    # The count shows without opening the panel: a change to review comes first.
    expect(page.locator("#lines-count")).to_have_text("1 to review")
    page.locator("#lines-wrap summary").click()
    rows = page.locator("#ln-list > table > tbody > tr")
    expect(rows).to_have_count(3)
    expect(rows.nth(0)).to_contain_text("Ann B")
    expect(rows.nth(0)).to_contain_text("Abingdon Airfield, AMC LCS")
    expect(rows.nth(0)).to_contain_text("The finish is early")
    expect(rows.nth(1)).to_contain_text("Waiting for them to change the map")
    # The change, from and to, and nothing has been saved yet.
    expect(rows.nth(2)).to_contain_text("The session has not changed yet")
    expect(rows.nth(2)).to_contain_text("Start line")
    expect(rows.nth(2)).to_contain_text("51.1, -1.1, 51.1002, -1.0998")
    expect(rows.nth(2)).to_contain_text("51.1005, -1.1005, 51.1007, -1.1003")
    expect(rows.nth(2)).to_contain_text("1:39.80")
    expect(rows.nth(2)).to_contain_text("1:39.20")
    expect(rows.nth(2).get_by_role("button", name="Accept")).to_be_visible()
    expect(rows.nth(1).get_by_role("button", name="Accept")).to_have_count(0)
    # The pictures of the old and the new lines, from the admin's picture route, and a warning when the email failed.
    pics = rows.nth(2).locator(".ln-pic img")
    expect(pics).to_have_count(2)
    expect(pics.nth(0)).to_have_attribute("src", re.compile(r"/track/lines/image\?id=s3&which=before&key=test-key"))
    expect(pics.nth(1)).to_have_attribute("src", re.compile(r"which=after"))
    expect(rows.nth(2)).to_contain_text("The email about this change could not be sent")
    expect(rows.nth(1).locator(".ln-pic")).to_have_count(0)
    rows.nth(0).get_by_role("button", name="Allow").click()
    expect(page.locator("#ln-note")).to_contain_text("Allowed")
    expect(rows.nth(0)).to_contain_text("Waiting for them to change the map")
    page.once("dialog", lambda d: d.accept())
    rows.nth(2).get_by_role("button", name="Undo").click()
    expect(page.locator("#ln-note")).to_contain_text("Undone. The session was not changed")
    expect(page.locator("#lines-count")).to_have_text("3 allowed")
    expect(rows.nth(2).get_by_role("button", name="Accept")).to_have_count(0)
    page.once("dialog", lambda d: d.accept())
    rows.nth(1).get_by_role("button", name="Revoke").click()
    expect(rows).to_have_count(2)
    assert calls == [("grant", "s1"), ("undo", "s3"), ("revoke", "s2")]


def _accept_setup(page, on_course):
    """A member's change waiting on a Thruxton session, with the readings and the routes Accept uses."""
    ok = {"Access-Control-Allow-Origin": "*"}
    base = Path(__file__).resolve().parent
    fixture = (base / "fixtures" / "thruxton-trimmed.vbo").read_text(encoding="latin1")
    thruxton = next(v for v in json.loads((base.parent / "data" / "tracks.json").read_text(encoding="utf-8"))["venues"] if v["id"] == "thruxton")
    open_admin(page, "track-admin.html")
    page.wait_for_function("!!(window.MT3UKTrack && window.MT3UKTrack.analyse)")
    prep = page.evaluate("""(text) => {
      const T = window.MT3UKTrack, rd = T.read(text, 'f.vbo');
      const meta = {}; Object.keys(rd).forEach(k => { if (k !== 'points') meta[k] = rd[k]; });
      const p = rd.points.map(q => [q.t, q.lat, q.lng, q.v, isFinite(q.la) ? q.la : null, isFinite(q.lo) ? q.lo : null, isFinite(q.sats) ? q.sats : null, isFinite(q.temp) ? q.temp : null, q.run || 0]);
      return { src: { v: 1, rd: meta, p: p }, line: rd.startLine };
    }""", fixture)
    line = prep["line"]
    assert line and len(line) == 2
    old = {"id": "s9", "type": "track", "venue": "Thruxton", "date": "2026-05-28", "time": "14:34", "bestTime": 102.0, "fileName": "f.vbo", "hasSource": True}
    if on_course:
        old.update({"venueId": "thruxton", "layoutId": "main"})
    state = {"requests": [{"id": "s9", "name": "Dee", "email": "d***@example.com", "note": "", "at": "2026-10-02T08:00:00Z", "status": "granted", "grantedAt": "2026-10-02T08:30:00Z", "what": "Thruxton, 2026-05-28", "type": "track", "best": 102.0,
                           "proposal": {"at": "2026-10-02T09:30:00Z", "from": {"startLine": [[51.2, -1.6], [51.2002, -1.6002]], "finishLine": None, "time": 102.0}, "to": {"startLine": line, "finishLine": None, "time": 50.0}}}]}
    # The library once the course has the member's line.
    moved = json.loads(json.dumps(thruxton))
    moved["layouts"][0]["startLine"] = line
    log = {"calls": [], "course": None, "retimes": [], "actions": [], "rebuilds": 0}
    fulfil = lambda route, body: route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=ok)

    def lines(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            log["actions"].append(body["action"]); log["calls"].append("accepted")
            if body["action"] == "accepted":
                state["requests"][0]["proposal"] = None
        fulfil(route, dict(state, success=True))

    def retime(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data)
            log["retimes"].append(body); log["calls"].append("retime " + body["id"])
            fulfil(route, {"success": True})
        elif "id=" in req.url:
            sid = req.url.split("id=")[1].split("&")[0]
            fulfil(route, {"success": True, "session": dict(old, id=sid)})
        else:
            rows = [{"id": "s9", "type": "track", "venue": "Thruxton", "venueId": "thruxton", "layoutId": "main", "date": "2026-05-28", "best": 102.0, "version": 7, "hasSource": True, "owner": "Dee"},
                    {"id": "s8", "type": "track", "venue": "Thruxton", "venueId": "thruxton", "layoutId": "main", "date": "2026-05-29", "best": 101.0, "version": 7, "hasSource": True, "owner": "Eve"}]
            fulfil(route, {"success": True, "sessions": rows, "done": True, "cursor": ""})

    def course(route):
        log["course"] = json.loads(route.request.post_data); log["calls"].append("course")
        fulfil(route, {"success": True, "library": {"venues": [moved]}, "relinked": 0})

    def rebuild(route):
        log["rebuilds"] += 1; log["calls"].append("rebuild")
        fulfil(route, {"success": True, "cars": 3, "done": True})
    page.route(LINES_API, lines)
    page.route("**/track/admin/retime/source**", lambda route: fulfil(route, prep["src"]))
    page.route(re.compile(r".*/track/admin/retime(\?.*)?$"), retime)
    page.route("**/track/admin/course**", course)
    page.route("**/track/boards/rebuild**", rebuild)
    page.route("**/track/admin/tracks**", lambda route: fulfil(route, {"success": True, "extra": {"venues": [moved] if log["course"] else []}, "library": {"venues": [moved if log["course"] else thruxton]}}))
    page.route("**/track/access/admin**", lambda route: fulfil(route, {"success": True, "open": False, "allowed": [], "pending": []}))
    page.route("**/track/admin/requests**", lambda route: fulfil(route, {"success": True, "requests": []}))
    page.reload()
    page.locator("#lines-wrap summary").click()
    return line, log


def test_admin_accepting_a_change_updates_the_course_and_re_times_every_session_at_the_track(page):
    """Accept on a session at a listed course: the time is worked out again from the saved readings (never the
    member's figure) and shown with what else will change; a no leaves it waiting and changes nothing. A yes makes
    the member's lines the course's official lines, re-times their session, then every other session at the track,
    and rebuilds the leaderboards."""
    line, log = _accept_setup(page, True)
    row = page.locator("#ln-list > table > tbody > tr").first
    expect(row).to_contain_text("The session has not changed yet")
    seen = []
    page.once("dialog", lambda d: (seen.append(d.message), d.dismiss()))
    row.get_by_role("button", name="Accept").click()
    expect(page.locator("#ln-note")).to_contain_text("Not accepted. It is still waiting")
    assert log["calls"] == [] and log["course"] is None
    assert "1:42.00 to 1:39.79" in seen[0] and "They saw 0:50.00" in seen[0], seen[0]
    assert "official start line for Thruxton" in seen[0] and "re-times every other session at Thruxton" in seen[0] and "leaderboards" in seen[0], seen[0]
    page.once("dialog", lambda d: d.accept())
    row.get_by_role("button", name="Accept").click()
    expect(page.locator("#ln-note")).to_contain_text("Leaderboards rebuilt (3 cars)", timeout=15000)
    expect(page.locator("#ln-note")).to_contain_text("Accepted.")
    # The course takes the member's line, in place.
    c = log["course"]
    assert c["replace"] is True and c["venueId"] == "thruxton" and c["layoutId"] == "main" and c["kind"] == "circuit" and c["finishLine"] is None
    assert [round(v, 7) for pt in c["startLine"] for v in pt] == [round(v, 7) for pt in line for v in pt]
    # Order: the course, then the member's own session (on the course's lines now), then the rest of the track.
    assert log["calls"][:3] == ["course", "retime s9", "accepted"], log["calls"]
    assert "retime s8" in log["calls"] and log["calls"][-1] == "rebuild" and log["rebuilds"] == 1
    mine = log["retimes"][0]["session"]
    assert abs(mine["bestTime"] - 99.786) < 0.02 and mine["date"] == "2026-05-28" and mine["fileName"] == "f.vbo" and not mine.get("linesAccepted")
    assert all(abs(r["session"]["bestTime"] - 99.786) < 0.02 for r in log["retimes"])


def test_admin_accepting_a_change_on_a_session_with_no_listed_course_changes_only_that_session(page):
    line, log = _accept_setup(page, False)
    row = page.locator("#ln-list > table > tbody > tr").first
    seen = []
    page.once("dialog", lambda d: (seen.append(d.message), d.accept()))
    row.get_by_role("button", name="Accept").click()
    expect(page.locator("#ln-note")).to_contain_text("Accepted. The session is now 1:39.79")
    assert "not on a listed course, so only it changes" in seen[0], seen[0]
    assert log["course"] is None and log["rebuilds"] == 0
    assert [r["id"] for r in log["retimes"]] == ["s9"]
    saved = log["retimes"][0]["session"]
    assert abs(saved["bestTime"] - 99.786) < 0.02 and saved["linesAccepted"] is True
    assert abs(saved["startLine"][0][0] - line[0][0]) < 1e-9
    assert log["actions"] == ["accepted"]


def test_admin_sets_a_course_line_by_clicking_on_the_map_instead_of_typing_coordinates(page):
    """Set the finish line on the satellite map: click each side of the road, drag an end, and the four numbers
    go into the box (west longitudes negative) for Save track. The start line is shown for reference."""
    ok = {"Access-Control-Allow-Origin": "*"}
    venue = {"id": "abingdon-airfield", "name": "Abingdon Airfield", "type": "sprint", "lat": 51.6885, "lng": -1.3165, "radius": 1500,
             "layouts": [{"id": "course", "name": "AMC LCS", "organizer": "AMC LCS", "length": 2250, "startLine": [[51.6926409, -1.3170275], [51.6926050, -1.3174584]], "finishLine": [[51.6897602, -1.3163671], [51.6897898, -1.3159349]]}]}
    saved = []

    def tracks(route):
        if route.request.method == "PUT":
            saved.append(json.loads(route.request.post_data))
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "library": {"venues": [venue]}}), headers=ok)
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {"venues": [venue]}, "library": {"venues": [venue]}}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/server.arcgisonline.com/**", lambda r: r.fulfill(status=200, content_type="image/png", body=b""))
    page.route("**/track/access/admin**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "open": False, "allowed": [], "pending": []}), headers=ok))
    page.route("**/track/admin/requests**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": []}), headers=ok))
    page.route("**/track/admin/tracks**", tracks)
    page.reload()
    page.locator("#tracks-wrap > summary").click()
    page.get_by_role("button", name="Edit").first.click()
    finish = page.locator('[data-l="finishLine"]')
    start_before = page.locator('[data-l="startLine"]').input_value()
    page.get_by_role("button", name="Set the finish line on the map").click()
    modal = page.locator("#tk-map-modal")
    expect(modal).to_be_visible()
    expect(modal).to_contain_text("The line is")  # it opens on the line it already has
    expect(modal.locator(".tk-pick-end")).to_have_count(2)
    # The map zooms right out (well past 2.5 times), so the whole area around the track can be seen.
    vb_w = lambda: float(page.locator("#tk-map-svg").get_attribute("viewBox").split()[2])
    start_w = vb_w()
    for _ in range(14):
        modal.locator(".tv-zoom-out").click()
    assert vb_w() / start_w > 50, (start_w, vb_w())
    modal.locator(".tv-zoom-reset").click()
    assert abs(vb_w() - start_w) < 1
    # Zoomed in, the map can be dragged well past the first view, to reach a spot beside the track.
    modal.locator(".tv-zoom-in").click()
    vb_x = lambda: float(page.locator("#tk-map-svg").get_attribute("viewBox").split()[0])
    sv = page.locator("#tk-map-svg").bounding_box()
    for _ in range(16):
        page.mouse.move(sv["x"] + sv["width"] * 0.2, sv["y"] + sv["height"] * 0.5)
        page.mouse.down()
        page.mouse.move(sv["x"] + sv["width"] * 0.9, sv["y"] + sv["height"] * 0.5, steps=4)
        page.mouse.up()
    assert vb_x() < -5.5 * start_w, (vb_x(), start_w)  # well past what the old limit (5 widths) allowed
    expect(modal.locator(".tv-zoom-reset")).to_be_visible()
    modal.locator(".tv-zoom-reset").click()
    assert abs(vb_w() - start_w) < 1 and abs(vb_x()) < 1
    # Clear it and place a new one by clicking either side of a road.
    modal.get_by_role("button", name="Clear").click()
    expect(modal.locator(".tk-pick-end")).to_have_count(0)
    expect(modal.locator("#tk-pick-step")).to_contain_text("click one side")
    expect(modal.locator("#tk-pick-use")).to_be_disabled()
    box = page.locator("#tk-map-svg").bounding_box()
    page.mouse.click(box["x"] + box["width"] * 0.45, box["y"] + box["height"] * 0.5)
    expect(modal.locator("#tk-pick-step")).to_contain_text("Now click the other side")
    page.mouse.click(box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.5)
    expect(modal.locator(".tk-pick-end")).to_have_count(2)
    expect(modal.locator("#tk-pick-step")).to_contain_text("m long")
    # Drag an end.
    end = modal.locator(".tk-pick-end").first.bounding_box()
    page.mouse.move(end["x"] + end["width"] / 2, end["y"] + end["height"] / 2)
    page.mouse.down()
    page.mouse.move(end["x"] + end["width"] / 2 - 20, end["y"] + end["height"] / 2 + 10, steps=4)
    page.mouse.up()
    expect(modal.locator("#tk-pick-use")).to_be_enabled()
    page.once("dialog", lambda d: d.accept())  # in case the line is outside 8 to 100 m
    modal.get_by_role("button", name="Use this line").click()
    expect(modal).to_have_count(0)
    nums = [float(x) for x in finish.input_value().split(",")]
    assert len(nums) == 4
    assert all(51.68 < nums[i] < 51.70 for i in (0, 2)) and all(-1.32 < nums[i] < -1.31 for i in (1, 3)), nums
    assert nums != [51.6897602, -1.3163671, 51.6897898, -1.3159349]
    assert page.locator('[data-l="startLine"]').input_value() == start_before
    page.get_by_role("button", name="Save track").click()
    expect(page.locator("#tk-note")).to_contain_text("Saved")
    line = saved[0]["venue"]["layouts"][0]["finishLine"]
    assert [round(line[0][0], 7), round(line[0][1], 7), round(line[1][0], 7), round(line[1][1], 7)] == [round(n, 7) for n in nums]


def test_admin_checks_then_re_times_every_session_at_one_track_from_its_saved_readings(page):
    """After a track's lines are corrected, Check sessions here shows what would change for the sessions at that
    one track (whatever their analysis version), and Re-time sessions here saves them and rebuilds the boards.
    Sessions at other tracks are left alone, and one with no readings kept is reported."""
    ok = {"Access-Control-Allow-Origin": "*"}
    fixture = (Path(__file__).resolve().parent / "fixtures" / "thruxton-trimmed.vbo").read_text(encoding="latin1")
    open_admin(page, "track-admin.html")
    page.wait_for_function("!!(window.MT3UKTrack && window.MT3UKTrack.analyse)")
    src = page.evaluate("""(text) => {
      const T = window.MT3UKTrack, rd = T.read(text, 'f.vbo');
      const meta = {}; Object.keys(rd).forEach(k => { if (k !== 'points') meta[k] = rd[k]; });
      return { v: 1, rd: meta, p: rd.points.map(q => [q.t, q.lat, q.lng, q.v, isFinite(q.la) ? q.la : null, isFinite(q.lo) ? q.lo : null, isFinite(q.sats) ? q.sats : null, isFinite(q.temp) ? q.temp : null, q.run || 0]) };
    }""", fixture)
    thruxton = {"id": "thruxton", "name": "Thruxton", "type": "circuit", "lat": 51.2077, "lng": -1.6088, "radius": 2000, "layouts": [{"id": "main", "name": "Thruxton", "length": 3800, "startLine": [[51.2077017, -1.6088667], [51.2076237, -1.6091363]]}]}
    other = {"id": "castle-combe", "name": "Castle Combe", "type": "circuit", "lat": 51.49, "lng": -2.21, "radius": 2000, "layouts": [{"id": "gp", "name": "GP", "length": 2200, "startLine": [[51.49, -2.21], [51.4902, -2.2102]]}]}
    rows = [{"id": "r1", "type": "track", "venue": "Thruxton", "venueId": "thruxton", "layoutId": "main", "date": "2026-05-28", "best": 102.0, "version": 7, "hasSource": True, "owner": "Ann"},
            {"id": "r2", "type": "track", "venue": "Thruxton", "venueId": "thruxton", "layoutId": "", "date": "2026-05-29", "best": 101.0, "version": 7, "hasSource": False, "owner": "Bob"},
            {"id": "r3", "type": "track", "venue": "Castle Combe", "venueId": "castle-combe", "layoutId": "gp", "date": "2026-05-30", "best": 80.0, "version": 7, "hasSource": True, "owner": "Cat"}]
    old = {"id": "r1", "type": "track", "venue": "Thruxton", "venueId": "thruxton", "date": "2026-05-28", "time": "14:34", "bestTime": 102.0, "fileName": "f.vbo", "layoutId": "main"}
    seen = {"gets": [], "posts": [], "rebuilds": 0}
    fulfil = lambda route, body: route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=ok)

    def retime(route):
        req = route.request
        if req.method == "POST":
            seen["posts"].append(json.loads(req.post_data))
            fulfil(route, {"success": True})
        elif "id=" in req.url:
            seen["gets"].append(req.url.split("id=")[1].split("&")[0])
            fulfil(route, {"success": True, "session": old})
        else:
            fulfil(route, {"success": True, "sessions": rows, "done": True, "cursor": ""})

    def rebuild(route):
        seen["rebuilds"] += 1
        fulfil(route, {"success": True, "cars": 2, "done": True})
    page.route("**/track/access/admin**", lambda r: fulfil(r, {"success": True, "open": False, "allowed": [], "pending": []}))
    page.route("**/track/admin/requests**", lambda r: fulfil(r, {"success": True, "requests": []}))
    page.route("**/track/admin/tracks**", lambda r: fulfil(r, {"success": True, "extra": {"venues": []}, "library": {"venues": [thruxton, other]}}))
    page.route("**/track/admin/retime**", retime)
    page.route("**/track/admin/retime/source**", lambda r: fulfil(r, src))
    page.route("**/track/boards/rebuild**", rebuild)
    page.reload()
    page.locator("#tracks-wrap > summary").click()
    row = page.locator("#tk-list tbody tr", has_text="Thruxton")
    expect(row.get_by_role("button", name="Check sessions here")).to_be_visible()
    expect(page.locator("#tk-list tbody tr", has_text="Castle Combe").get_by_role("button", name="Re-time sessions here")).to_be_visible()
    # Check: shows what moves, saves nothing, and looks only at this track's sessions.
    row.get_by_role("button", name="Check sessions here").click()
    expect(page.locator("#tk-retime-note")).to_contain_text("2 sessions at Thruxton")
    expect(page.locator("#tk-retime-note")).to_contain_text("1 have no readings kept")
    expect(page.locator("#tk-retime-picks")).to_contain_text("2026-05-28 (track): 1:42.00 to 1:39.79")
    assert seen["posts"] == [] and seen["gets"] == ["r1"], seen
    # Re-time here only shows what each session would become: nothing is saved until Re-time selected, after a yes.
    row.get_by_role("button", name="Re-time sessions here").click()
    expect(page.locator("#tk-retime-outcome")).to_contain_text("If you press Re-time selected")
    assert seen["posts"] == []
    page.once("dialog", lambda d: d.dismiss())
    page.locator("#tk-retime-selected").click()
    page.wait_for_timeout(300)
    assert seen["posts"] == []
    # A yes saves the one that can be re-timed, then rebuilds the leaderboards.
    page.once("dialog", lambda d: d.accept())
    page.locator("#tk-retime-selected").click()
    expect(page.locator("#tk-retime-note")).to_contain_text("Leaderboards rebuilt (2 cars)")
    assert [p["id"] for p in seen["posts"]] == ["r1"] and abs(seen["posts"][0]["session"]["bestTime"] - 99.786) < 0.02
    assert seen["posts"][0]["session"]["date"] == "2026-05-28" and "r3" not in seen["gets"] and seen["rebuilds"] == 1


def test_the_link_in_the_request_email_opens_the_line_editing_panel_at_that_request(page):
    """admin.html#lines-<session id> opens the Line editing panel and marks that request; a request that is gone says so."""
    ok = {"Access-Control-Allow-Origin": "*"}
    rows = [{"id": "aaaaaaaa01", "name": "Ann", "email": "a***@example.com", "note": "", "at": "2026-10-01T09:00:00Z", "status": "pending", "grantedAt": "", "proposal": None, "what": "Thruxton, 2026-05-28", "type": "track", "best": 99.7},
            {"id": "bbbbbbbb02", "name": "Bob", "email": "b***@example.com", "note": "", "at": "2026-10-01T10:00:00Z", "status": "pending", "grantedAt": "", "proposal": None, "what": "Brands Hatch, 2026-06-01", "type": "track", "best": 80.0}]
    open_admin(page, "track-admin.html")
    page.route(LINES_API, lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": rows}), headers=ok))
    page.goto("/track-admin.html#lines-bbbbbbbb02")
    expect(page.locator("#lines-wrap")).to_have_attribute("open", "")
    expect(page.locator("#ln-list tr.is-target")).to_have_count(1)
    expect(page.locator("#ln-list tr.is-target")).to_contain_text("Brands Hatch")
    expect(page.locator("#ln-list tr.is-target")).to_be_in_viewport()
    # A fresh load of the address, as from the email, does the same.
    page.reload()
    expect(page.locator("#lines-wrap")).to_have_attribute("open", "")
    expect(page.locator("#ln-list tr.is-target")).to_contain_text("Brands Hatch")
    page.goto("/track-admin.html#lines-cccccccc03")
    expect(page.locator("#lines-wrap")).to_have_attribute("open", "")
    expect(page.locator("#ln-note")).to_contain_text("not waiting any more")
    expect(page.locator("#ln-list tr.is-target")).to_have_count(0)


def test_the_bell_lists_map_edit_requests_and_changes_waiting_for_approval(page):
    """Requests to edit a map and changes sent back to approve show in the notification bell (counted, tagged New),
    a request already allowed does not, and choosing one opens the Line editing panel at that request."""
    ok = {"Access-Control-Allow-Origin": "*"}
    line = [[51.1, -1.1], [51.1002, -1.0998]]
    rows = [{"id": "aaaaaaaa01", "name": "Ann", "email": "a***@example.com", "note": "", "at": "2026-10-01T09:00:00Z", "status": "pending", "grantedAt": "", "proposal": None, "what": "Thruxton, 2026-05-28", "type": "track", "best": 99.7},
            {"id": "bbbbbbbb02", "name": "Bob", "email": "b***@example.com", "note": "", "at": "2026-10-01T10:00:00Z", "status": "granted", "grantedAt": "2026-10-01T11:00:00Z", "proposal": None, "what": "Brands Hatch, 2026-06-01", "type": "track", "best": 80.0},
            {"id": "cccccccc03", "name": "Cat", "email": "c***@example.com", "note": "", "at": "2026-10-01T12:00:00Z", "status": "granted", "grantedAt": "2026-10-01T13:00:00Z", "what": "Abingdon Airfield, AMC LCS, 2022-04-10", "type": "sprint", "best": 118.0,
             "proposal": {"at": "2026-10-02T09:30:00Z", "from": {"startLine": line, "finishLine": line, "time": 118.0}, "to": {"startLine": line, "finishLine": line, "time": 120.1}}}]
    open_admin(page, "track-admin.html")
    page.route(LINES_API, lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": rows}), headers=ok))
    page.reload()
    expect(page.locator("#bell-badge")).to_be_visible()
    expect(page.locator("#bell-badge")).to_have_text("2")
    page.locator("#bell-btn").click()
    panel = page.locator("#bell-panel")
    expect(panel).to_contain_text("Map edit requests (1)")
    expect(panel).to_contain_text("Wants to edit the map on Thruxton, 2026-05-28")
    expect(panel).to_contain_text("Map changes to approve (1)")
    expect(panel).to_contain_text("Waiting for you to accept or undo")
    expect(panel).not_to_contain_text("Brands Hatch")
    panel.get_by_text("Waiting for you to accept or undo").click()
    expect(page.locator("#lines-wrap")).to_have_attribute("open", "")
    expect(page.locator("#ln-list tr[data-id='cccccccc03']")).to_be_in_viewport()
    # Seen items stop counting until something new arrives.
    page.reload()
    expect(page.locator("#bell-badge")).to_be_hidden()


def test_the_tracks_list_can_be_narrowed_by_track_name_and_by_type(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    venues = [
        {"id": "thruxton", "name": "Thruxton", "type": "circuit", "lat": 51.2, "lng": -1.6, "radius": 2000, "layouts": [{"id": "gp", "name": "Full", "length": 3800}]},
        {"id": "abingdon", "name": "Abingdon Airfield", "type": "sprint", "lat": 51.68, "lng": -1.31, "radius": 1500, "layouts": [{"id": "c", "name": "AMC", "length": 2250}]},
        {"id": "abingdon-td", "name": "Abingdon Airfield", "type": "circuit", "lat": 51.68, "lng": -1.31, "radius": 1500, "layouts": [{"id": "t", "name": "Track day", "length": 1200}]},
        {"id": "shelsley", "name": "Shelsley Walsh", "type": "sprint", "hill": True, "lat": 52.27, "lng": -2.36, "radius": 800, "layouts": [{"id": "h", "name": "Hill", "length": 1000}]},
        {"id": "santa-pod", "name": "Santa Pod", "type": "drag", "lat": 52.2, "lng": -0.6, "radius": 1000, "layouts": []},
    ]
    open_admin(page, "track-admin.html")
    page.route("**/track/access/admin**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "open": False, "allowed": [], "pending": []}), headers=ok))
    page.route("**/track/admin/requests**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": []}), headers=ok))
    page.route("**/track/admin/tracks**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {"venues": venues}, "library": {"venues": venues}}), headers=ok))
    page.reload()
    page.locator("#tracks-wrap > summary").click()
    rows = page.locator("#tk-list tbody tr")
    # The sprint and the track day at Abingdon are one place with two entries.
    expect(rows).to_have_count(4)
    expect(page.locator("#tk-list .tk-count")).to_have_text("4 tracks")
    order = page.locator("#tk-list tbody tr td:first-child b").all_text_contents()
    assert order == ["Abingdon Airfield", "Santa Pod", "Shelsley Walsh", "Thruxton"], order
    expect(rows.first.locator(".tk-kind")).to_have_count(2)
    expect(rows.first.locator(".tk-kindname")).to_have_text(["Circuit (track day)", "Sprint"])
    page.locator('[data-tk-filter="type"]').select_option("hill")
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Shelsley Walsh")
    expect(page.locator("#tk-list .tk-count")).to_have_text("Showing 1 of 4")
    page.locator('[data-tk-filter="type"]').select_option("")
    page.locator('[data-tk-filter="name"]').select_option("Abingdon Airfield")
    expect(rows).to_have_count(1)  # the sprint and the track day share a place
    expect(rows.first.locator(".tk-kind")).to_have_count(2)
    page.locator('[data-tk-filter="type"]').select_option("circuit")
    expect(rows).to_have_count(1)
    expect(rows.first.locator(".tk-kind")).to_have_count(1)
    expect(rows.first).to_contain_text("Track day")
    page.locator('[data-tk-filter="type"]').select_option("drag")
    expect(page.locator("#tk-list tbody")).to_contain_text("No tracks match.")
    # The names in the drop-down are listed once each, in order.
    names = page.locator('[data-tk-filter="name"] option').all_text_contents()
    assert names == ["All tracks", "Abingdon Airfield", "Santa Pod", "Shelsley Walsh", "Thruxton"], names


def test_the_tracks_list_can_be_collapsed_and_expanded(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    venues = [{"id": "thruxton", "name": "Thruxton", "type": "circuit", "lat": 51.2, "lng": -1.6, "radius": 2000, "layouts": []},
              {"id": "santa-pod", "name": "Santa Pod", "type": "drag", "lat": 52.2, "lng": -0.6, "radius": 1000, "layouts": []}]
    open_admin(page, "track-admin.html")
    page.route("**/track/access/admin**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "open": False, "allowed": [], "pending": []}), headers=ok))
    page.route("**/track/admin/requests**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": []}), headers=ok))
    page.route("**/track/admin/tracks**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {"venues": venues}, "library": {"venues": venues}}), headers=ok))
    page.reload()
    page.locator("#tracks-wrap > summary").click()
    expect(page.locator("#tk-list-wrap > summary")).to_contain_text("(2)")
    expect(page.locator("#tk-list tbody tr")).to_have_count(2)
    page.locator("#tk-list-wrap > summary").click()
    expect(page.locator("#tk-list")).to_be_hidden()
    page.locator("#tk-list-wrap > summary").click()
    expect(page.locator("#tk-list tbody tr")).to_have_count(2)
    page.locator('[data-tk-filter="type"]').select_option("drag")
    expect(page.locator("#tk-list-wrap > summary")).to_contain_text("(1 of 2)")


def test_admin_can_ask_why_a_session_is_not_on_a_leaderboard(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    asked = []

    def check(route):
        asked.append(route.request.url)
        body = {"success": True, "session": {"id": "abc123abc123", "type": "track", "hill": False, "venue": "Abingdon Airfield Circuit", "venueId": "abingdon-airfield-circuit", "layout": "Full", "layoutId": "full", "privacy": "private", "date": "2020-10-16", "bestTime": 74.562, "car": "c1"},
                "board": "track-board:abingdon-airfield-circuit:full", "tab": "Track days", "onBoard": False, "entries": 0,
                "reasons": ["Its sharing is \"Only me\", so it is not on any board. The member turns Shared on in Session settings."]}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/track/admin/boardcheck**", check)
    page.reload()
    page.locator("#board-checks-wrap > summary").click()
    page.locator("#ms-id").fill("https://mt3uk.com/track.html?s=abc123abc123")
    page.locator("#ms-check").click()
    out = page.locator("#ms-check-out")
    expect(out).to_contain_text("Abingdon Airfield Circuit, Full")
    expect(out).to_contain_text("Not shown as a row on the Track days leaderboard")
    expect(out).to_contain_text("Only me")
    assert asked and "id=https%3A%2F%2Fmt3uk.com%2Ftrack.html%3Fs%3Dabc123abc123" in asked[0]
    page.locator("#ms-id").fill("")
    page.locator("#ms-check").click()
    expect(out).to_contain_text("Paste a session link or id first.")


def test_admin_can_see_every_leaderboard_problem_and_repair_a_hidden_board(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    state = {"hidden": ["track-board:abingdon-airfield-circuit:full"], "repaired": []}

    def problems(route):
        body = {"success": True, "members": 7, "more": False, "sessions": 40, "privateOrStreet": 12, "other": 2, "onBoard": 22,
                "problems": [{"id": "aaa111aaa111", "carId": "c1", "board": "", "car": "Arctic Three", "type": "track", "venue": "Somewhere new", "layout": "", "date": "2026-10-01", "bestTime": 90.1, "tab": "Track days",
                              "reasons": ["No track was matched (it says \"Somewhere new\"). Its track is not listed, so a request is waiting on the Tracks panel: Approve and add track links it."]},
                             {"id": "bbb222bbb222", "carId": "c2", "board": "track-board:thruxton:main", "car": "Red Tesla", "type": "track", "venue": "Thruxton", "layout": "Thruxton", "date": "2026-09-30", "bestTime": 101.2, "tab": "Track days",
                              "reasons": ["Everything looks right, but the board has no entry for this car yet. Rebuild all leaderboards on the Tracks panel (or save the session again) to refresh it."]}],
                "hiddenBoards": list(state["hidden"])}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=ok)

    def repair(route):
        state["repaired"].append(json.loads(route.request.post_data))
        state["hidden"] = []
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "refreshed": 1, "count": 1}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/track/admin/boardproblems**", problems)
    page.route("**/track/admin/boardrepair**", repair)
    page.reload()
    page.locator("#board-checks-wrap > summary").click()
    page.locator("#ms-problems").click()
    out = page.locator("#ms-prob-out")
    expect(out).to_contain_text("40 sessions from 7 members")
    expect(out).to_contain_text("2 with a problem")
    expect(out).to_contain_text("1 hidden board")
    expect(out).to_contain_text("Somewhere new")
    expect(out).to_contain_text("No track was matched")
    assert out.locator("button[data-session]").count() == 1  # only where rebuilding the session is the fix
    out.locator("button[data-repair='track-board:abingdon-airfield-circuit:full']:not([data-session])").click()
    expect(out).not_to_contain_text("hidden board")
    assert state["repaired"] == [{"board": "track-board:abingdon-airfield-circuit:full"}], state["repaired"]
    # A row with its session id repairs from the session.
    out.locator("button[data-session]").click()
    for _ in range(40):
        if len(state["repaired"]) > 1:
            break
        page.wait_for_timeout(50)
    assert state["repaired"][1] == {"board": "track-board:thruxton:main", "carId": "c2", "sessionId": "bbb222bbb222"}, state["repaired"]


def test_the_bell_on_the_admin_home_page_counts_the_track_tasks_and_links_to_their_page(page):
    ok = {"Access-Control-Allow-Origin": "*"}

    def reply(body):
        return lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=ok)
    open_admin(page, "admin.html")
    page.route("**/track/access/admin**", reply({"success": True, "open": False, "allowed": [], "pending": [{"email": "sam@example.com", "name": "Sam", "at": "2026-10-01T10:00:00Z"}]}))
    page.route("**/track/admin/requests**", reply({"success": True, "requests": [{"id": "r1", "name": "Old airfield", "kind": "circuit", "at": "2026-10-01T10:00:00Z"}, {"id": "r2", "name": "Done one", "done": "approved"}]}))
    page.route("**/track/lines/admin**", reply({"success": True, "requests": [{"id": "bbbbbbbb02", "name": "Chris", "email": "c***@example.com", "status": "pending", "at": "2026-10-02T09:00:00Z", "what": "Abingdon, 2026-09-30"},
                                                                          {"id": "cccccccc03", "name": "Dee", "status": "granted", "at": "2026-10-02T09:00:00Z", "proposal": {"at": "2026-10-03T09:00:00Z"}, "what": "Goodwood, 2026-09-29"}]}))
    page.reload()
    page.locator("#bell-btn").click()
    panel = page.locator("#bell-panel")
    expect(panel).to_contain_text("Early access requests (1)")
    expect(panel).to_contain_text("New track requests (1)")
    expect(panel).to_contain_text("Map edit requests (1)")
    expect(panel).to_contain_text("Map changes to approve (1)")
    expect(panel).to_contain_text("Old airfield")
    expect(panel).not_to_contain_text("Done one")
    # An item leads to its panel on the Track admin page, which opens it.
    panel.locator(".bell-item", has_text="Chris").click()
    expect(page).to_have_url(re.compile(r"/track-admin\.html#lines-bbbbbbbb02$"))


def test_the_single_session_check_offers_a_repair_that_rebuilds_from_the_session(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    state = {"fixed": False, "posted": []}

    def check(route):
        body = {"success": True, "session": {"id": "e929bd773e1742e69b1f", "type": "track", "venue": "Abingdon Airfield Circuit", "layout": "Abingdon Airfield Circuit", "privacy": "board", "date": "2020-10-16", "bestTime": 74.562},
                "board": "track-board:abingdon-airfield-circuit:full", "tab": "Track days", "onBoard": state["fixed"], "entries": 1 if state["fixed"] else 0,
                "reasons": [] if state["fixed"] else ["The car's shared list does not have this session, so a board cannot include it. Repair rebuilds the lists from the session."], "repairable": not state["fixed"]}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=ok)

    def repair(route):
        state["posted"].append(json.loads(route.request.post_data))
        state["fixed"] = True
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "refreshed": 1, "count": 1}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/track/admin/boardcheck**", check)
    page.route("**/track/admin/boardrepair**", repair)
    page.reload()
    page.locator("#board-checks-wrap > summary").click()
    page.locator("#ms-id").fill("https://mt3uk.com/track.html?s=e929bd773e1742e69b1f&utm_source=share_sheet")
    page.locator("#ms-check").click()
    out = page.locator("#ms-check-out")
    expect(out).to_contain_text("shared list does not have this session")
    out.get_by_role("button", name="Repair").click()
    expect(out).to_contain_text("On the Track days leaderboard")
    assert state["posted"] == [{"sessionId": "e929bd773e1742e69b1f"}], state["posted"]


def test_a_session_at_a_track_that_has_gone_gets_a_repair_button_that_relinks_it(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    posted = []
    reason = "Its track (shelsley-walsh-hill-climb) is no longer in the track list. It looks like Shelsley Walsh, Hill climb: Repair links the session to it."

    def problems(route):
        body = {"success": True, "members": 3, "more": False, "sessions": 62, "privateOrStreet": 4, "other": 0, "onBoard": 57,
                "problems": [{"id": "aaa111aaa111", "carId": "c1", "board": "sprint-board:shelsley-walsh-hill-climb:hill", "car": "Zaphod", "type": "hill climb", "venue": "Shelsley Walsh Hill Climb", "layout": "", "date": "2021-07-25", "bestTime": 33.712, "tab": "Hill climb", "reasons": [reason]}],
                "hiddenBoards": []}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=ok)

    def repair(route):
        posted.append(json.loads(route.request.post_data))
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "refreshed": 1, "relinked": "Shelsley Walsh, Hill climb", "alsoRelinked": 1}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/track/admin/boardproblems**", problems)
    page.route("**/track/admin/boardrepair**", repair)
    page.reload()
    page.locator("#board-checks-wrap > summary").click()
    page.locator("#ms-problems").click()
    out = page.locator("#ms-prob-out")
    expect(out).to_contain_text("Repair links the session to it")
    out.get_by_role("button", name="Repair").click()
    for _ in range(40):
        if posted:
            break
        page.wait_for_timeout(50)
    assert posted == [{"board": "sprint-board:shelsley-walsh-hill-climb:hill", "carId": "c1", "sessionId": "aaa111aaa111"}], posted


def test_the_bell_lists_gallery_requests_for_cars_of_another_make(page):
    """A member's request to show a car of another make in the Gallery shows in the bell, and the item opens the
    Other makes panel on this page."""
    ok = {"Access-Control-Allow-Origin": "*"}
    asks = {"success": True, "pending": [{"carId": "car-kia", "email": "k***@example.com", "name": "Kit", "car": "Kit's EV6", "title": "Kia EV6 GT",
                                           "type": "car", "photos": ["kia.jpg"], "at": "2026-10-04T10:00:00Z"}]}
    open_admin(page, "admin.html")
    page.route("**/my-builds/admin/garage-gallery**", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(asks), headers=ok))
    page.reload()
    expect(page.locator("#bell-badge")).to_be_visible()
    page.locator("#bell-btn").click()
    panel = page.locator("#bell-panel")
    expect(panel).to_contain_text("Gallery requests (other makes) (1)")
    expect(panel).to_contain_text("Kit's EV6, Kia EV6 GT")
    expect(panel).to_contain_text("Kit wants it in the Gallery")
    panel.locator(".bell-item", has_text="Kit").click()
    expect(page.locator("#garage-asks-wrap")).to_have_attribute("open", "")
    expect(page.locator("#ga-list")).to_contain_text("Kia EV6 GT")


@pytest.mark.parametrize("name", ["admin.html", "track-admin.html"])
def test_the_notifications_switches_hide_the_bell_and_turn_emails_off(page, name):
    ok = {"Access-Control-Allow-Origin": "*"}
    state = {"alerts": {"bell": True, "email": True}, "posts": []}

    def alerts(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            state["posts"].append(body)
            state["alerts"].update(body)
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "alerts": state["alerts"]}), headers=ok)
    open_admin(page, name)
    page.route("**/admin/alerts**", alerts)
    page.reload()
    bell_sw, email_sw = page.locator("#alerts-bell"), page.locator("#alerts-email")
    expect(bell_sw).to_have_attribute("aria-checked", "true")
    expect(email_sw).to_have_attribute("aria-checked", "true")
    expect(page.locator(".bell-wrap")).to_be_visible()
    bell_sw.click()
    expect(page.locator(".bell-wrap")).to_be_hidden()
    expect(bell_sw).to_have_attribute("aria-checked", "false")
    email_sw.click()
    expect(email_sw).to_have_attribute("aria-checked", "false")
    expect(page.locator("#alerts-note")).to_contain_text("Emails off")
    assert state["posts"] == [{"bell": False}, {"email": False}], state["posts"]
    # Kept by the worker, so a fresh load keeps the bell hidden.
    page.reload()
    expect(page.locator(".bell-wrap")).to_be_hidden()
    expect(email_sw).to_have_attribute("aria-checked", "false")
    bell_sw.click()
    expect(page.locator(".bell-wrap")).to_be_visible()


def test_the_bell_updates_as_soon_as_something_new_waits(page):
    """js/admin-alerts.js checks the worker's stamp; when it changes the bell reloads at once, not in 3 minutes."""
    ok = {"Access-Control-Allow-Origin": "*"}
    state = {"stamp": "1", "asks": []}

    def reply(fn):
        return lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(fn()), headers=ok)
    open_admin(page, "admin.html")
    page.route("**/admin/alerts**", reply(lambda: {"success": True, "alerts": {"bell": True, "email": True}, "stamp": state["stamp"]}))
    page.route("**/my-builds/admin/garage-gallery**", reply(lambda: {"success": True, "pending": state["asks"]}))
    page.reload()
    page.wait_for_timeout(500)
    expect(page.locator("#bell-badge")).to_be_hidden()
    state["asks"] = [{"carId": "car-kia", "name": "Kit", "car": "Kit's EV6", "title": "Kia EV6 GT", "photos": [], "at": "2026-10-05T10:00:00Z"}]
    state["stamp"] = "2"
    # Coming back to the page checks at once (otherwise within 15 seconds).
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    expect(page.locator("#bell-badge")).to_have_text("1", timeout=5000)


@pytest.mark.parametrize("name,manifest,title", [("admin.html", "admin-manifest.json", "Install Admin"), ("track-admin.html", "track-admin-manifest.json", "Install Track Admin")])
def test_each_admin_page_can_be_installed_as_its_own_app_with_push(page, name, manifest, title):
    data = json.loads((Path(__file__).resolve().parent.parent / manifest).read_text(encoding="utf-8"))
    assert data["start_url"] == "/" + name and data["id"] != "/" and data["display"] == "standalone"
    # Its own page only: with the whole site as its scope, Chrome offers to open the installed MT3UK app instead.
    assert data["scope"] == "/" + name
    assert any(i["sizes"] == "512x512" for i in data["icons"]) and any(i["sizes"] == "192x192" for i in data["icons"])
    open_admin(page, name)
    page.route("**/admin/alerts**", lambda route: route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                                               body=json.dumps({"success": True, "alerts": {"bell": True, "email": True}, "stamp": "1", "pushDevices": []})))
    page.reload()
    assert page.locator('link[rel="manifest"]').get_attribute("href") == manifest
    install = page.locator("#alerts-install")
    expect(install).to_have_text(title)
    expect(install).to_be_visible()
    # Without the browser's own install prompt it says how.
    install.click()
    expect(page.locator("#alerts-note")).to_contain_text("Add to Home")
    # Push on this device shows where the browser can do it, off until switched on here.
    push = page.locator("#alerts-push")
    page.evaluate("document.dispatchEvent(new CustomEvent('mt3uk-admin-refresh'))")
    expect(push).to_be_visible(timeout=10000)
    expect(push).to_have_attribute("aria-checked", "false")


def admin_site_setup(page):
    """localhost plays mt3uk.com and 127.0.0.1 plays admin.mt3uk.com."""
    from conftest import PORT
    main, admin = "http://localhost:%d" % PORT, "http://127.0.0.1:%d" % PORT
    page.add_init_script("window.MT3UK_ADMIN_SITE = { origin: '%s', main: ['localhost'], mainOrigin: '%s', laps: 'http://laps.localhost:%d' };" % (admin, main, PORT))
    page.route("**/admin/alerts**", lambda route: route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                                                               body=json.dumps({"success": True, "alerts": {"bell": True, "email": True}, "stamp": "1", "pushDevices": []})))
    return main, admin


def test_install_from_mt3uk_goes_to_the_admin_address_and_links_there_come_back(page):
    open_admin(page, "track-admin.html")
    main, admin = admin_site_setup(page)
    page.reload()
    page.locator("#alerts-install").click()
    page.wait_for_url(admin + "/track-admin.html#install", timeout=10000)
    expect(page.locator("#alerts-note")).to_contain_text("Press Install Track Admin")
    # On the admin address, a link to another page of the site goes to mt3uk.com; the admin pages stay.
    page.evaluate("""() => { for (const [id, h] of [['to-site', 'gallery.html?photo=a.jpg'], ['to-admin', 'admin.html']]) {
        const a = document.createElement('a'); a.id = id; a.href = h; a.textContent = id;
        a.style.cssText = 'position:fixed;left:10px;z-index:99999;background:#fff;padding:12px;top:' + (id === 'to-site' ? 200 : 260) + 'px';
        document.body.appendChild(a); } }""")
    page.locator("#to-site").click()
    page.wait_for_url(main + "/gallery.html?photo=a.jpg", timeout=10000)


def test_a_session_opened_from_an_admin_page_goes_to_laps(page):
    """A link to a Laps page (a member's session, the Leaderboard) from the admin pages goes to laps.mt3uk.com, from
    admin.mt3uk.com and from mt3uk.com alike, so the pages after it are Laps pages. Other links behave as before."""
    from conftest import PORT
    open_admin(page, "track-admin.html")
    main, admin = admin_site_setup(page)
    page.reload()
    laps = "http://laps.localhost:%d" % PORT
    page.route(laps + "/**", lambda route: route.fulfill(status=200, content_type="text/html", body="<title>laps</title>"))
    add = """() => { for (const [id, h] of [['to-session', 'track.html?s=abc'], ['to-board', 'leaderboards.html?board=thruxton:main'], ['to-gallery', 'gallery.html']]) {
        const a = document.createElement('a'); a.id = id; a.href = h; a.textContent = id;
        a.style.cssText = 'position:fixed;left:10px;z-index:99999;background:#fff;padding:12px;top:' + (id === 'to-session' ? 200 : id === 'to-board' ? 260 : 320) + 'px';
        document.body.appendChild(a); } }"""
    # From mt3uk.com: a session goes to Laps, the Gallery stays on mt3uk.com.
    page.evaluate(add)
    page.locator("#to-session").click()
    page.wait_for_url(laps + "/track.html?s=abc", timeout=10000)
    # With the admin key entered here, the admin viewer token goes along as a one-time code in the link's #, so the
    # private session opens there without the key.
    code = "c" * 64
    cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Session-Token, X-Admin-Viewer", "Access-Control-Allow-Methods": "GET, POST"}

    def answer(body):
        return lambda route: route.fulfill(status=204, headers=cors) if route.request.method == "OPTIONS" else route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps(body))
    page.route("**/session/handover", answer({"success": True, "code": code}))
    page.route("**/admin/viewer-token**", answer({"success": True, "token": "viewer-tok", "expires": 4102444800000}))
    page.goto(main + "/track-admin.html")
    page.wait_for_function("JSON.parse(localStorage.getItem('mt3ukAdminViewer') || '{}').token === 'viewer-tok'", timeout=10000)
    page.evaluate(add)
    page.locator("#to-session").click()
    page.wait_for_url(laps + "/track.html?s=abc#mt3uk-handover=" + code, timeout=10000)
    # And an admin page arriving with a code takes it out of the address and redeems it.
    page.route("**/session/handover/redeem", answer({"success": True, "adminViewer": {"token": "viewer-two", "expires": 4102444800000}}))
    page.goto(admin + "/track-admin.html#mt3uk-handover=" + code + ":install")
    page.wait_for_url(admin + "/track-admin.html#install", timeout=10000)
    page.wait_for_function("JSON.parse(localStorage.getItem('mt3ukAdminViewer') || '{}').token === 'viewer-two'", timeout=10000)
    page.goto(main + "/track-admin.html")
    page.evaluate(add)
    page.locator("#to-gallery").click()
    page.wait_for_url(main + "/gallery.html", timeout=10000)
    # From admin.mt3uk.com too.
    page.goto(admin + "/track-admin.html")
    page.evaluate(add)
    page.locator("#to-board").click()
    page.wait_for_url(laps + "/leaderboards.html?board=thruxton:main#mt3uk-handover=" + code, timeout=10000)


def test_the_key_can_be_remembered_on_this_device(page):
    open_admin(page, "admin.html")
    admin_site_setup(page)
    page.reload()
    keep = page.locator("#alerts-keep")
    expect(keep).to_have_attribute("aria-checked", "false")
    keep.click()
    expect(keep).to_have_attribute("aria-checked", "true")
    assert page.evaluate("localStorage.getItem('mt3ukAdminKeyKept')") == "test-key"
    # A new visit (the installed app opening again) starts with no key in the tab, and gets the remembered one.
    fresh = page.context.new_page()
    fresh.route("**/%s/**" % API_HOST, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}), headers={"Access-Control-Allow-Origin": "*"}))
    fresh.goto(page.url)
    expect(fresh.locator("#admin-key")).to_have_value("test-key")
    fresh.close()
    keep.click()
    expect(keep).to_have_attribute("aria-checked", "false")
    assert page.evaluate("localStorage.getItem('mt3ukAdminKeyKept')") is None


def test_one_place_lists_its_circuit_sprint_and_hill_climb_together_and_adds_the_missing_kind(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    venues = [
        {"id": "goodwood", "name": "Goodwood", "type": "circuit", "lat": 50.859, "lng": -0.759, "radius": 2000, "layouts": [{"id": "main", "name": "Goodwood", "length": 3830}]},
        {"id": "goodwood-motor-circuit", "name": "Goodwood Motor Circuit", "type": "sprint", "lat": 50.86, "lng": -0.76, "radius": 1500, "layouts": [{"id": "c", "name": "Course", "length": 2000}]},
        {"id": "goodwood-hill", "name": "Goodwood Hill Climb", "type": "sprint", "hill": True, "lat": 50.89, "lng": -0.74, "radius": 800, "layouts": [{"id": "h", "name": "Hill", "length": 1900}]},
        {"id": "goodwood-festival-of-speed", "name": "Goodwood Festival of Speed", "type": "sprint", "hill": True, "lat": 50.8688, "lng": -0.7367, "radius": 1200, "layouts": []},
        {"id": "goodwood-far", "name": "Goodwood", "type": "circuit", "lat": 53.0, "lng": -1.0, "radius": 1000, "layouts": []},
    ]
    saved = []
    def tracks(route):
        body = route.request.post_data_json if route.request.method == "PUT" else None
        if body:
            saved.append(body)
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {"venues": venues}, "library": {"venues": venues}}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/track/access/admin**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "open": False, "allowed": [], "pending": []}), headers=ok))
    page.route("**/track/admin/requests**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": []}), headers=ok))
    page.route("**/track/admin/tracks**", tracks)
    page.reload()
    page.locator("#tracks-wrap > summary").click()
    rows = page.locator("#tk-list tbody tr")
    # Goodwood, Goodwood Motor Circuit and Goodwood Hill Climb (all within 5 km) are one place; a Goodwood far away is not.
    expect(rows).to_have_count(2)
    near = rows.first
    expect(near.locator(".tk-kindname")).to_have_text(["Circuit (track day)", "Sprint", "Hill climb", "Hill climb"])
    expect(near).to_contain_text("listed as Goodwood Motor Circuit")
    # A longer name that starts with the place's name, close by, is part of the place too.
    expect(near).to_contain_text("listed as Goodwood Festival of Speed")
    # It has all three kinds, so there is nothing to add; the far one can have a sprint and a hill climb added.
    expect(near.locator("[data-add-kind]")).to_have_count(0)
    far = rows.nth(1)
    expect(far.locator("[data-add-kind]")).to_have_text(["Add sprint", "Add hill climb"])
    far.locator("[data-add-kind='sprint']").click()
    expect(page.locator("#tk-form, .tk-form").first).to_contain_text("Add a sprint to Goodwood")
    expect(page.locator("#tk-name")).to_have_value("Goodwood")
    expect(page.locator("#tk-type")).to_have_value("sprint")
    expect(page.locator("#tk-lat")).to_have_value("53")
    page.locator("#tk-save").click()
    page.wait_for_timeout(300)
    assert saved and saved[0]["venue"]["id"] == "" and saved[0]["venue"]["type"] == "sprint" and saved[0]["venue"]["name"] == "Goodwood", saved


def test_the_usage_panel_counts_members_sessions_and_storage(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    data = {"success": True, "at": "2026-10-05T22:00:00.000Z",
            "access": {"open": False, "approved": 12, "waiting": 3},
            "members": {"withSessions": 9, "active30": 4, "active90": 7, "new30": 2, "returning": 5, "oneSession": 3},
            "sessions": {"total": 40, "last30": 11, "last90": 25, "shared": 30, "withReadings": 36, "readingsBytes": 72000000, "readingsSized": 24, "byType": {"track": 31, "sprint": 6, "drag": 3}, "capped": False},
            "weeks": [{"week": "2026-07-20", "sessions": 0, "cars": 0}] * 10 + [{"week": "2026-09-28", "sessions": 6, "cars": 4}, {"week": "2026-10-05", "sessions": 3, "cars": 2}],
            "vehicles": {"cars": 10, "bikes": 1, "byMake": [{"make": "Tesla", "cars": 8}, {"make": "Hyundai", "cars": 1}, {"make": "Ducati", "cars": 1}]},
            "boards": 7}
    open_admin(page, "track-admin.html")
    page.route("**/track/admin/usage**", lambda route: route.fulfill(status=200, content_type="application/json", headers=ok, body=json.dumps(data)))
    page.locator("#usage-wrap > summary").click()
    members = page.locator("#us-members .us-tile")
    expect(members).to_have_count(6)
    expect(members.first).to_contain_text("9")
    expect(members.first).to_contain_text("with sessions")
    expect(members.nth(1)).to_contain_text("44% of them")
    expect(page.locator("#usage-wrap")).to_contain_text("Access: 12 approved, 3 waiting")
    sessions = page.locator("#us-sessions .us-tile")
    expect(sessions.nth(3)).to_contain_text("75% on a build or a leaderboard")
    expect(sessions.nth(5)).to_contain_text("72.0 MB")
    expect(sessions.nth(5)).to_contain_text("about 3.0 MB a session, from 24 sized")
    expect(page.locator("#usage-wrap")).to_contain_text("Drag runs: 3, Sprints and hill climbs: 6, Track days: 31. 7 leaderboards with entries.")
    weeks = page.locator("#us-weeks li")
    expect(weeks).to_have_count(12)
    expect(weeks.nth(10)).to_contain_text("28 Sep")
    expect(weeks.nth(10)).to_contain_text("6 from 4 vehicles")
    assert weeks.nth(10).locator(".us-bar i").evaluate("el => el.style.width") == "100%"
    assert weeks.nth(11).locator(".us-bar i").evaluate("el => el.style.width") == "50%"
    expect(page.locator("#us-vehicles")).to_have_text("10 with sessions, 1 of them bikes: Tesla 8, Hyundai 1, Ducati 1.")
    assert overflow_width(page) <= 0
    page.set_viewport_size({"width": 390, "height": 844})
    assert overflow_width(page) <= 0


def test_the_driven_wheels_panel_lists_vehicles_with_sessions_and_sets_one(page):
    ok = {"Access-Control-Allow-Origin": "*"}
    state = {"posts": []}
    rows = [{"carId": "c2", "car": "Mystery 3", "owner": "Bob", "email": "b@example.com", "make": "", "model": "Model 3", "version": "", "year": 2020, "vehicleType": "car", "drive": "", "set": False, "sessions": 4},
            {"carId": "c1", "car": "Arctic Three", "owner": "Ann", "email": "a@example.com", "make": "Tesla", "model": "Model 3", "version": "Performance", "year": 2021, "vehicleType": "car", "drive": "AWD", "set": False, "sessions": 2}]

    def handler(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            state["posts"].append(body)
            return route.fulfill(status=200, content_type="application/json", headers=ok, body=json.dumps({"success": True, "drive": body["drive"], "set": bool(body["drive"]), "stamped": 4, "boards": 1}))
        return route.fulfill(status=200, content_type="application/json", headers=ok, body=json.dumps({"success": True, "vehicles": rows}))
    open_admin(page, "track-admin.html")
    page.route("**/track/admin/drive**", handler)
    page.locator("#drive-wrap > summary").click()
    table = page.locator("#dw-list tbody tr")
    expect(table).to_have_count(2)
    # The one we cannot tell comes first, marked, with Not known chosen; the known one shows where it came from.
    expect(table.first).to_contain_text("Mystery 3")
    expect(table.first).to_have_class(re.compile("is-target"))
    assert table.first.locator(".dw-pick").input_value() == ""
    assert table.nth(1).locator(".dw-pick").input_value() == "AWD"
    expect(table.nth(1)).to_contain_text("From the model")
    table.first.locator(".dw-pick").select_option("RWD")
    expect(page.locator("#dw-note")).to_contain_text("RWD saved: 4 sessions stamped and 1 leaderboard refreshed")
    assert state["posts"] == [{"carId": "c2", "drive": "RWD"}]
    expect(table.first).to_contain_text("Set by hand")
    expect(table.first).not_to_have_class(re.compile("is-target"))


def test_new_laps_sign_ups_are_listed_counted_on_the_bell_when_not_waiting_and_cleared(page):
    """Everyone who joins on Laps is listed on the Sign-in and sign-up panel of track-admin.html. One already waiting
    for early access is counted there, not twice; any other is counted on the bell (on admin.html too) and opens
    the panel. Clear takes one off the list."""
    ok = {"Access-Control-Allow-Origin": "*"}
    state = {"signups": [
        {"email": "ola@example.com", "name": "Ola Open", "at": "2026-10-06T12:30:00Z", "account": "mt3uk", "waiting": False},
        {"email": "nia@example.com", "name": "Nia Jones", "at": "2026-10-06T11:00:00Z", "account": "laps", "waiting": True},
    ], "cleared": []}

    def signups(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data)
            state["cleared"].append(body["clear"])
            state["signups"] = [] if body["clear"] == "all" else [s for s in state["signups"] if s["email"] != body["clear"]]
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "signups": state["signups"]}), headers=ok)
    open_admin(page, "track-admin.html")
    page.route("**/laps/signups/admin**", signups)
    page.reload()
    rows = page.locator("#lsu-list tr[data-signup]")
    expect(rows).to_have_count(2)
    expect(page.locator("#signups-count")).to_have_text("(2 new)")
    expect(rows.first).to_contain_text("Ola Open")
    expect(rows.first).to_contain_text("ola@example.com")
    expect(rows.first).to_contain_text("MT3UK member too")
    expect(rows.first).to_contain_text("Already in")
    expect(rows.nth(1)).to_contain_text("Laps only")
    expect(rows.nth(1)).to_contain_text("Put on the early access list")
    expect(page.locator("#bell-badge")).to_have_text("1")
    page.locator("#bell-btn").click()
    panel = page.locator("#bell-panel")
    expect(panel).to_contain_text("New Laps sign-ups (1)")
    expect(panel).to_contain_text("Joined on Laps, MT3UK member too")
    expect(panel).not_to_contain_text("Nia Jones")
    panel.locator(".bell-item", has_text="Ola Open").click()
    expect(page.locator("#signin-wrap")).to_have_attribute("open", "")
    rows.first.locator(".lsu-clear").click()
    expect(rows).to_have_count(1)
    assert state["cleared"] == ["ola@example.com"]
    expect(page.locator("#signups-count")).to_have_text("(1 new)")
    page.on("dialog", lambda d: d.accept())
    page.locator("#lsu-clear-all").click()
    expect(page.locator("#lsu-list")).to_contain_text("No new Laps sign-ups")
    assert state["cleared"] == ["ola@example.com", "all"]
    # admin.html's bell counts it too and sends the admin to the panel.
    page2 = page.context.new_page()
    open_admin(page2, "admin.html")
    page2.route("**/laps/signups/admin**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "signups": [
        {"email": "sam@example.com", "name": "Sam Lee", "at": "2026-10-06T13:00:00Z", "account": "laps", "waiting": False},
        {"email": "nia@example.com", "name": "Nia Jones", "at": "2026-10-06T11:00:00Z", "account": "mt3uk", "waiting": True}]}), headers=ok))
    page2.reload()
    expect(page2.locator("#bell-badge")).to_have_text("1")
    page2.locator("#bell-btn").click()
    expect(page2.locator("#bell-panel")).to_contain_text("New Laps sign-ups (1)")
    expect(page2.locator("#bell-panel")).to_contain_text("Joined on Laps, Laps-only account")
    page2.locator("#bell-panel .bell-item", has_text="Sam Lee").click()
    page2.wait_for_url("**/track-admin.html#signin-wrap")
    expect(page2.locator("#signin-wrap")).to_have_attribute("open", "")


@pytest.mark.parametrize("name", ["admin.html", "track-admin.html"])
def test_every_admin_panel_has_a_help_popover(page, name):
    """A ? beside each panel title says what the panel and its options do. It never opens or closes the panel."""
    open_admin(page, name)
    panels = page.eval_on_selector_all("details.collapsible[id]", "els => els.map(e => e.id)")
    assert len(panels) >= 13, panels
    page.wait_for_selector(".help-btn")
    for pid in panels:
        assert page.locator('.help-btn[data-help-for="%s"]' % pid).count() == 1, "no help for " + pid
    pid = panels[0]
    panel = page.locator("#" + pid)
    was_open = panel.evaluate("e => e.open")
    btn = page.locator('.help-btn[data-help-for="%s"]' % pid)
    btn.click()
    pop = page.locator(".help-pop")
    expect(pop).to_be_visible()
    expect(pop.locator(".help-title")).not_to_be_empty()
    assert panel.evaluate("e => e.open") == was_open, "the ? must not open or close its panel"
    expect(btn).to_have_attribute("aria-expanded", "true")
    # Esc closes it, and the focus goes back to the button.
    page.keyboard.press("Escape")
    expect(pop).to_be_hidden()
    expect(btn).to_have_attribute("aria-expanded", "false")
    # Another ? replaces it; a click elsewhere closes it.
    page.locator('.help-btn[data-help-for="%s"]' % panels[1]).click()
    expect(pop).to_be_visible()
    page.locator("h1").first.click()
    expect(pop).to_be_hidden()


def test_the_track_admin_help_explains_the_rebuild_and_re_time_options(page):
    open_admin(page, "track-admin.html")
    page.wait_for_selector(".help-btn")
    page.locator('.help-btn[data-help-for="boards-wrap"]').click()
    pop = page.locator(".help-pop")
    for term in ["Rebuild all leaderboards", "Check sessions", "Re-time out of date sessions", "Also re-time big changes"]:
        expect(pop).to_contain_text(term)
    page.keyboard.press("Escape")
    # The controls that are not obvious have their own.
    for cid in ["tk-rebuild", "tk-retime-check", "tk-retime", "tk-retime-big", "alerts-email", "ac-open"]:
        assert page.locator('.help-btn[data-help-for="%s"]' % cid).count() == 1, cid
    # The ? beside a control is inside its panel, so open the panel first.
    page.locator("#boards-wrap > summary").click()
    page.locator('.help-btn[data-help-for="tk-retime-big"]').click()
    expect(pop).to_contain_text("more than 10%")


def test_the_help_popover_fits_a_phone(page):
    page.set_viewport_size({"width": 360, "height": 740})
    open_admin(page, "track-admin.html")
    page.wait_for_selector(".help-btn")
    page.locator('.help-btn[data-help-for="vehicles-wrap"]').scroll_into_view_if_needed()
    page.locator('.help-btn[data-help-for="vehicles-wrap"]').click()
    box = page.locator(".help-pop").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 360 and box["y"] >= 0 and box["y"] + box["height"] <= 740, box
    assert overflow_width(page) <= 0




def test_admin_gives_nicknames_to_members_without_one(page):
    """The Subscribers panel's one-off button asks the worker to give the automatic nickname to members without one
    and says how many it gave."""
    calls = []

    def api(route):
        req = route.request
        if urlparse(req.url).path == "/profile/admin/nicknames":
            calls.append(req.method)
            body = {"success": True, "given": 3, "had": 40, "noName": 2, "cleared": 1, "total": 46, "examples": ["RHughes", "ABrown", "CDavies"]}
        else:
            body = {"success": True}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"Access-Control-Allow-Origin": "*"})
    page.route("**/%s/**" % API_HOST, api)
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#subscribers-wrap > summary").click()
    page.once("dialog", lambda d: d.accept())
    page.locator("#nick-fill-btn").click()
    expect(page.locator("#nick-fill-status")).to_have_text("Done: 3 members given a nickname (RHughes, ABrown, CDavies), 40 already had one, 2 with no name to make one from, 1 cleared theirs, 46 in all.")
    assert calls == ["POST"]
