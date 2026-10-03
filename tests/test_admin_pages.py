"""The admin pages (admin.html, events-admin.html, device-checklist.html): a
light look, one navigation shared by all three, and the panels in logical
groups."""
import gzip
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
    ("grp-tracks", "Track sessions", ["access-wrap", "member-sessions-wrap", "tracks-wrap", "copy-wrap", "tyres-wrap"]),
    ("grp-sharing", "Sharing links", ["home-share-wrap", "share-wrap"]),
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
    assert hrefs == ["admin.html#grp-gallery", "admin.html#grp-reports", "admin.html#grp-members", "admin.html#grp-interviews", "admin.html#grp-tracks", "admin.html#grp-sharing", "events-admin.html", "device-checklist.html"]
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
    expect(sub.locator("a")).to_have_text(["Early access", "Member sessions", "Tracks", "Welcome text", "Tyres"])
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


def _retime_mocks(page, saved, old_best=99.9):
    cors = {"Access-Control-Allow-Origin": "*"}
    source = _retime_source()
    rows = [
        {"id": "aaaaaaaa01", "type": "track", "venue": "Thruxton", "date": "2026-07-01", "best": 99.9, "version": 1, "hasSource": True},
        {"id": "aaaaaaaa02", "type": "track", "venue": "Castle Combe", "date": "2026-07-02", "best": 80.1, "version": 1, "hasSource": False},
        {"id": "aaaaaaaa03", "type": "track", "venue": "Croft", "date": "2026-07-03", "best": 70.0, "version": 99, "hasSource": True},
    ]
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
    open_admin(page, "admin.html")
    _retime_mocks(page, saved)
    page.locator("#tracks-wrap summary").click()
    page.locator("#tk-retime-check").click()
    note = page.locator("#tk-retime-note")
    expect(note).to_contain_text("3 sessions looked at")
    expect(note).to_contain_text("2 were timed with older code")
    expect(note).to_contain_text("1 have no readings kept")
    expect(page.locator("#tk-retime-list li")).to_have_count(1)
    # Each result links to the session, so the admin can open it and see whose it is.
    expect(page.locator("#tk-retime-list li a")).to_have_attribute("href", "track.html?s=aaaaaaaa01")
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


def test_admin_retime_holds_back_a_best_time_that_moves_over_ten_percent(page):
    saved = []
    open_admin(page, "admin.html")
    _retime_mocks(page, saved, old_best=60.0)
    page.on("dialog", lambda d: d.accept())
    page.locator("#tracks-wrap summary").click()
    page.locator("#tk-retime-check").click()
    expect(page.locator("#tk-retime-list li")).to_contain_text("held back unless you allow big changes")
    expect(page.locator("#tk-retime-note")).to_contain_text("1 held back for moving over 10%")
    page.locator("#tk-retime").click()
    expect(page.locator("#tk-retime-note")).to_contain_text("Leaderboards rebuilt")
    expect(page.locator("#tk-retime-list li")).to_contain_text("not saved")
    assert saved == []


def test_admin_retime_saves_a_big_change_when_the_switch_is_on(page):
    saved = []
    open_admin(page, "admin.html")
    _retime_mocks(page, saved, old_best=60.0)
    page.on("dialog", lambda d: d.accept())
    page.locator("#tracks-wrap summary").click()
    page.locator("#tk-retime-big").click()
    expect(page.locator("#tk-retime-big")).to_have_attribute("aria-checked", "true")
    page.locator("#tk-retime").click()
    expect(page.locator("#tk-retime-note")).to_contain_text("Leaderboards rebuilt")
    assert len(saved) == 1 and saved[0]["id"] == "aaaaaaaa01"


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

    open_admin(page, "admin.html")
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
    expect(options.nth(1)).to_have_text("Thruxton, 2026-05-28, 0:40.000, RichyRich (private)")
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
    # The homepage has a panel of its own on the same code, reading its own slot.
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

    open_admin(page, "admin.html")
    page.route("**/track/copy/admin**", copy_admin)
    page.locator("#copy-wrap summary").click()
    expect(page.locator("#tc-heading")).to_have_value("Lap times for every MT3UK car")
    expect(page.locator("#tc-intro")).to_have_value("")
    expect(page.locator("#tc-intro")).to_have_attribute("placeholder", re.compile(r"^Upload the file from your lap timer"))
    page.locator("#tc-intro").fill("Bring your RaceBox file and see every lap.")
    page.locator("#tc-bullets").fill("One\n\nTwo  \nThree")
    page.locator("#tc-save").click()
    expect(page.locator("#tc-note")).to_contain_text("Saved")
    assert posted[-1] == {"heading": "Lap times for every MT3UK car", "intro": "Bring your RaceBox file and see every lap.", "bullets": ["One", "Two", "Three"]}
    page.on("dialog", lambda d: d.accept())
    page.locator("#tc-reset").click()
    expect(page.locator("#tc-note")).to_contain_text("built-in")
    assert posted[-1] == {"reset": True}
    expect(page.locator("#tc-heading")).to_have_value("")
