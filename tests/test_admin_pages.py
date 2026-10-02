"""The admin pages (admin.html, events-admin.html, device-checklist.html): a
light look, one navigation shared by all three, and the panels in logical
groups."""
import json
import re
import subprocess

import pytest
from playwright.sync_api import expect

from test_devices import overflow_width

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
PAGES = ["admin.html", "events-admin.html", "device-checklist.html"]
GROUPS = [
    ("grp-gallery", "Gallery and builds", ["pending-wrap", "decided-wrap", "unclaimed-wrap", "votes-wrap"]),
    ("grp-reports", "Reports", ["comments-wrap", "rphotos-wrap", "local-wrap"]),
    ("grp-members", "Members", ["subscribers-wrap", "members-msg-wrap"]),
    ("grp-interviews", "Owner interviews", ["interviews-wrap", "preview-wrap"]),
    ("grp-tracks", "Track sessions", ["access-wrap", "member-sessions-wrap", "tracks-wrap", "tyres-wrap"]),
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
    assert links.all_inner_texts() == ["Gallery and builds", "Reports", "Members", "Owner interviews", "Track sessions", "Events", "Device checks"]
    hrefs = [links.nth(i).get_attribute("href") for i in range(links.count())]
    assert hrefs == ["admin.html#grp-gallery", "admin.html#grp-reports", "admin.html#grp-members", "admin.html#grp-interviews", "admin.html#grp-tracks", "events-admin.html", "device-checklist.html"]
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
    assert luminance(page.evaluate("getComputedStyle(document.querySelector('#tyres-wrap')).backgroundColor")) > 0.95
    # The nav jumps to a group.
    page.locator('.admin-nav a[href="admin.html#grp-tracks"]').click()
    expect(page.locator("#grp-tracks .group-head h2")).to_be_in_viewport()


def test_event_and_device_pages_are_grouped(page):
    open_admin(page, "events-admin.html")
    assert page.locator(".admin-group > .group-head h2").all_inner_texts() == ["Event pages", "Meets list"]
    assert page.locator("#grp-pages #ep-wrap").count() == 1 and page.locator("#grp-pages #pv-wrap").count() == 1
    assert page.locator("#grp-meets #upcoming-list").count() == 1 and page.locator("#grp-meets #past-wrap").count() == 1
    page2 = page.context.new_page()
    open_admin(page2, "device-checklist.html")
    expect(page2.locator("h1")).to_have_text("Device Checks")
    assert luminance(page2.evaluate("getComputedStyle(document.querySelector('.card')).backgroundColor")) > 0.95


@pytest.mark.parametrize("name", PAGES)
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
    assert sub.locator("a").all_inner_texts() == ["Pending claims", "Decided claims", "Unclaimed photos", "Build of the Week entries"]
    expect(page.locator('.admin-nav a[data-here="true"]')).to_have_text("Gallery and builds")
    # Choosing a category swaps the sub menu to that category's sections.
    page.locator('.admin-nav a[href="admin.html#grp-tracks"]').click()
    expect(sub.locator("a")).to_have_text(["Early access", "Member sessions", "Tracks", "Tyres"])
    expect(page.locator('.admin-nav a[data-here="true"]')).to_have_text("Track sessions")
    # Choosing a section opens its panel and scrolls to it.
    sub.locator("a", has_text="Tyres").click()
    expect(page.locator("#tyres-wrap")).to_have_attribute("open", "")
    expect(page.locator("#tyres-wrap summary")).to_be_in_viewport()
    # The sub menu sits under the main menu, not over it.
    a = page.locator(".admin-nav").bounding_box()
    b = sub.bounding_box()
    assert b["y"] >= a["y"] + a["height"] - 1


def test_admin_can_rebuild_the_leaderboards_in_steps(page):
    calls = []

    def rebuild(route):
        url = route.request.url
        calls.append(url)
        data = {"success": True, "cars": 2, "done": False, "cursor": "2"} if "cursor=" not in url else {"success": True, "cars": 1, "done": True, "cursor": ""}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data), headers={"Access-Control-Allow-Origin": "*"})
    open_admin(page, "admin.html")
    page.route("**/track/boards/rebuild**", rebuild)
    page.locator("#tracks-wrap summary").click()
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


def _retime_mocks(page, saved):
    cors = {"Access-Control-Allow-Origin": "*"}
    source = _retime_source()
    rows = [
        {"id": "aaaaaaaa01", "type": "track", "venue": "Thruxton", "date": "2026-07-01", "best": 99.9, "version": 1, "hasSource": True},
        {"id": "aaaaaaaa02", "type": "track", "venue": "Castle Combe", "date": "2026-07-02", "best": 80.1, "version": 1, "hasSource": False},
        {"id": "aaaaaaaa03", "type": "track", "venue": "Croft", "date": "2026-07-03", "best": 70.0, "version": 99, "hasSource": True},
    ]
    old = {"id": "aaaaaaaa01", "type": "track", "venue": "Thruxton", "date": "2026-07-01", "time": "10:00", "bestTime": 99.9}

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

    page.route("**/track/admin/retime/source**", lambda route: route.fulfill(status=200, content_type="application/json", body=source, headers=cors))
    page.route("**/track/admin/retime?**", retime)
    page.route("**/track/admin/retime", retime)
    page.route("**/track/boards/rebuild**", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "cars": 4, "done": True, "cursor": ""}), headers=cors))
    page.route("**/track/admin/tracks**", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {}}), headers=cors))


def test_admin_check_sessions_counts_old_ones_and_saves_nothing(page):
    saved = []
    open_admin(page, "admin.html")
    _retime_mocks(page, saved)
    page.locator("#tracks-wrap summary").click()
    page.locator("#tk-retime-check").click()
    note = page.locator("#tk-retime-note")
    expect(note).to_contain_text("3 sessions looked at")
    expect(note).to_contain_text("2 were timed with older code")
    expect(note).to_contain_text("1 have no readings kept")
    expect(page.locator("#tk-retime-list li")).to_have_count(1)
    assert saved == []


def test_admin_retime_saves_the_new_timing_then_rebuilds_the_boards(page):
    saved = []
    open_admin(page, "admin.html")
    _retime_mocks(page, saved)
    page.on("dialog", lambda d: d.accept())
    page.locator("#tracks-wrap summary").click()
    page.locator("#tk-retime").click()
    expect(page.locator("#tk-retime-note")).to_contain_text("Leaderboards rebuilt (4 cars)")
    assert len(saved) == 1 and saved[0]["id"] == "aaaaaaaa01"
    s = saved[0]["session"]
    assert s["analysisVersion"] >= 2 and s["date"] == "2026-07-01" and s["laps"]


def test_admin_track_type_has_sprint_and_hill_climb_as_separate_choices(page):
    open_admin(page, "admin.html")
    page.locator("#tracks-wrap summary").click()
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
    open_admin(page, "admin.html")
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
    open_admin(page, "admin.html")
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
    open_admin(page, "admin.html")
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


def test_admin_can_open_a_map_of_a_requested_course_and_the_load_refreshes_everything(page):
    req = {"id": "r1", "kind": "sprint", "name": "Newfield Sprint", "organizer": "B19", "from": "j***@example.com", "lat": 51.2, "lng": -0.9,
           "startLine": [[51.2, -0.9], [51.2002, -0.9002]], "finishLine": [[51.21, -0.91], [51.2102, -0.9102]],
           "outline": [[51.2, -0.9], [51.205, -0.905], [51.21, -0.91]], "at": "2026-10-02T09:00:00Z"}
    hits = {"access": 0}
    ok = {"Access-Control-Allow-Origin": "*"}

    def access(route):
        hits["access"] += 1
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "open": False, "allowed": [], "pending": []}), headers=ok)
    open_admin(page, "admin.html")
    page.route("**/track/access/admin**", access)
    page.route("**/track/admin/requests**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "requests": [req]}), headers=ok))
    page.route("**/track/admin/tracks**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "extra": {"venues": []}, "library": {"venues": []}}), headers=ok))
    page.reload()
    page.locator("#tracks-wrap summary").click()
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
