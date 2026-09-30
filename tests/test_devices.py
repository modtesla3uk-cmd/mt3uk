"""
Cross-device checks: every public page on an iPhone and iPad (Safari's
WebKit engine), an Android phone (Chrome), and desktop Chrome and Firefox.

For each page and device it checks the page loads without script errors,
nothing spills off the side of the screen, and the menu opens. It also runs
the main flows (reel likes, gallery photo viewer, My Garage sign-in with a
code) and saves a screenshot of every page on every device to
test-results/devices/, which the "Run Playwright tests" workflow keeps as a
download.

The worker API and outside sites are mocked, so the tests never touch live
data. A device whose browser isn't installed is skipped, so this still runs
locally with Chromium only; CI installs all three engines.
"""
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs

import pytest

from conftest import BASE_URL, REPO_ROOT

SCREENSHOT_DIR = REPO_ROOT / "test-results" / "devices"

# Public pages with the shared header and menu. Admin pages are left out.
PAGES = sorted(
    p.stem
    for p in REPO_ROOT.glob("*.html")
    if 'id="hamburger"' in p.read_text(encoding="utf-8", errors="ignore")
)
# MT3UK_PAGES=shop,gallery limits the page checks to those pages (used by the
# on-demand runs from the Device Checks page). Unset checks every page.
_only_pages = [p.strip() for p in os.environ.get("MT3UK_PAGES", "").split(",") if p.strip()]
if _only_pages:
    PAGES = [p for p in PAGES if p in _only_pages] or PAGES

# name: (browser engine, Playwright device, or None for a desktop window)
DEVICES = {
    "iphone": ("webkit", "iPhone 13"),
    "ipad": ("webkit", "iPad (gen 7)"),
    "android": ("chromium", "Pixel 7"),
    "desktop-chrome": ("chromium", None),
    "desktop-firefox": ("firefox", None),
}
MOBILE = {"iphone", "android"}

# GitHub runs one job per device: MT3UK_DEVICES=iphone (or a comma list)
# limits the run to those devices. Unset runs them all.
_only = [d.strip() for d in os.environ.get("MT3UK_DEVICES", "").split(",") if d.strip()]
if _only:
    DEVICES = {name: spec for name, spec in DEVICES.items() if name in _only}

API_HOST = "late-darkness-ebc8.modtesla3uk.workers.dev"
# Pages call the worker with fetch(). WebKit lets cross-site POSTs skip
# Playwright's request mocking and go to the real worker, so every page
# gets a fetch() that sends worker calls to this same-site path instead,
# where the mock answers them. Nothing reaches the live worker.
MOCK_API_PATH = "/__mock-api"
FETCH_REDIRECT = """
(function () {
  var live = 'https://%s';
  var local = location.origin + '%s';
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.indexOf(live) === 0) {
      input = local + input.slice(live.length);
    } else if (input && input.url && input.url.indexOf(live) === 0) {
      input = new Request(local + input.url.slice(live.length), input);
    }
    return realFetch.call(this, input, init);
  };
})();
""" % (API_HOST, MOCK_API_PATH)
R2_HOST = "r2.dev"

# A 1x1 grey JPEG for gallery photos, so layouts have a real image to size.
TINY_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9"
)


# One car with one photo, showing in the gallery and reel, for My Garage.
GARAGE_CAR = {
    "id": "car-1",
    "name": "Test Model 3",
    "mods": ["Wheels"],
    "photos": [
        {"file": "test-build.jpg", "caption": "Test Model 3", "gallery": True, "reel": True, "votable": True, "inVote": True, "added": "2026-09-14"},
        {"file": "test-build-2.jpg", "caption": "Test Model 3 Rear", "gallery": True, "reel": True, "votable": True},
    ],
}
# The member's entry in this week's vote, with 3 votes so far.
GARAGE_VOTE_ENTRY = {"file": "test-build.jpg", "caption": "TEST MODEL 3", "votes": 3}
# This week's vote: someone else's build, and the signed-in member's own.
VOTE_CANDIDATES = [
    {"file": "other-build.jpg", "caption": "OTHER BUILD", "votes": 2, "mods": []},
    {"file": "test-build.jpg", "caption": "TEST MODEL 3", "votes": 3, "mods": [], "mine": True},
] + [{"file": "more-%d.jpg" % n, "caption": "MORE BUILD %d" % n, "votes": 0, "mods": []} for n in range(10)]
# The Admin page's list of this week's entries, and one taken out of voting.
ADMIN_VOTE_ENTRIES = {
    "success": True,
    "week": "2026-09-28",
    "entries": [{"file": "brake-discs.jpg", "caption": "BRAKE DISCS", "name": "TEST MEMBER", "email": "member@example.com", "added": "2026-09-28", "votes": 2}],
    "removed": [{"file": "old-entry.jpg", "caption": "OLD ENTRY", "name": "OTHER MEMBER", "email": "other@example.com", "added": "2026-09-21"}],
}


def api_path(url):
    """The worker path of a call, whether it went to the worker or the mock."""
    marker = API_HOST if API_HOST in url else MOCK_API_PATH
    return url.split(marker, 1)[1].split("?", 1)[0]


def api_reply(url, method, post_data, state):
    """Stand-in answers for the worker, enough for every page to render."""
    path = api_path(url)
    if method == "OPTIONS":
        return {}
    if path == "/likes" and method == "GET":
        return {"success": True, "likes": {}, "liked": []}
    if path == "/likes":
        return {"success": True, "liked": True, "count": 1}
    # Admin page: one of each thing the notification bell lists.
    if path == "/gallery/admin/claims":
        return {"success": True, "claims": [{"file": "claim-car.jpg", "name": "CLAIM PERSON", "email": "claimer@example.com", "status": "pending", "requestedAt": "2026-09-28"}]}
    if path == "/comments/admin" and method == "GET":
        if "file=" in url:
            return {"success": True, "comments": [{"id": "c1", "name": "Rude Person", "text": "Not a nice comment", "reports": ["r1"], "createdAt": "2026-09-28"}]}
        return {"success": True, "reported": [{"file": "reported-car.jpg"}]}
    if path == "/gallery/admin/reports" and method == "GET":
        return {"success": True, "reported": [{"file": "reported-photo.jpg", "reports": 2}]}
    if path == "/my-builds/notifications" and method == "GET":
        read = state.get("notifs_read", False)
        cleared = state.setdefault("notifs_cleared", [])
        items = [
            {"id": "n1", "type": "like", "fromName": "Sharad", "text": "liked your build", "file": "test-build.jpg", "createdAt": "2026-09-29T10:00:00Z", "read": read},
            {"id": "n2", "type": "comment", "fromName": "Ryan", "text": "Love the wheels!", "file": "test-build.jpg", "commentId": "c9", "createdAt": "2026-09-29T09:00:00Z", "read": read},
        ]
        items = [n for n in items if "all" not in cleared and n["id"] not in cleared]
        return {"success": True, "unread": 0 if read else len(items), "notifications": items,
                "messagesUnread": state.get("messages_unread", 0)}
    if path == "/my-builds/notifications/clear":
        try:
            body = json.loads(post_data or "{}")
        except ValueError:
            body = {}
        state.setdefault("notifs_cleared", []).append("all" if body.get("all") else body.get("id", "?"))
        return {"success": True}
    if path == "/my-builds/notifications/read":
        state["notifs_read"] = True
        return {"success": True}
    if path == "/admin/vote-entries" and method == "GET":
        return ADMIN_VOTE_ENTRIES
    if path == "/votes":
        return {"success": True, "voted": None, "candidates": VOTE_CANDIDATES}
    if path == "/comment-counts":
        return {"success": True, "counts": {}}
    if path == "/comments" and method == "GET":
        return {"success": True, "comments": []}
    if path == "/my-builds/request-link":
        return {"success": True, "message": "If that email has submitted a build, we've sent a sign-in link."}
    if path == "/my-builds/verify-code":
        try:
            body = json.loads(post_data or "{}")
        except ValueError:
            body = {}
        # WebKit doesn't always pass the request body to the mock, so without
        # it the first try is treated as wrong and the next as right.
        state["code_tries"] = state.get("code_tries", 0) + 1
        code = body.get("code") or ("000000" if state["code_tries"] == 1 else "123456")
        if code == "123456":
            state["signed_in"] = True
            return {"success": True, "session": "s1.test", "email": body.get("email", "member@example.com")}
        return {"success": False, "message": "That code is not right or has expired."}
    # Interview preview gate (js/interview-gate.js) and its admin list.
    if path == "/interviews/preview/request":
        try:
            body = json.loads(post_data or "{}")
        except ValueError:
            body = {}
        if body.get("admin"):
            state["admin_link"] = True
            return {"success": True, "admin": True, "message": "We've emailed a one-time link and code to the MT3UK admin inbox. They last 15 minutes."}
        return {"success": True, "message": "We've sent a 6-digit code to sharad@example.com. It lasts 15 minutes."}
    if path == "/interviews/preview/verify":
        try:
            body = json.loads(post_data or "{}")
        except ValueError:
            body = {}
        state["preview_tries"] = state.get("preview_tries", 0) + 1
        code = body.get("code") or ("000000" if state["preview_tries"] == 1 else "123456")
        if code == "123456":
            state["preview_ok"] = True
            return {"success": True, "token": "p" * 64, "expires": state.get("preview_expires", 4102444800000),
                    "joined": True, "session": "s1.preview", "email": body.get("email", "sharad@example.com")}
        return {"success": False, "message": "That code is not right or has expired."}
    if path == "/interviews/admin/action":
        # Draft / Publish now / Schedule on the real schedule file.
        try:
            body = json.loads(post_data or "{}")
        except ValueError:
            body = {}
        file = state.setdefault("interviews_file", json.loads((REPO_ROOT / "data" / "interviews.json").read_text(encoding="utf-8")))
        action = body.get("action") or "draft"
        url = body.get("url") or next(i["url"] for i in file["interviews"] if i.get("publish", "") > "2026-10-01")
        iv = next(i for i in file["interviews"] if i["url"] == url)
        if action == "draft":
            iv.pop("publish", None)
            iv["draft"] = True
            line = iv["name"] + " set to draft"
        else:
            iv["publish"] = body.get("date") or "2026-09-29"
            iv.pop("draft", None)
            line = iv["name"] + " published now"
        state.setdefault("interview_actions", []).append((action, url))
        return {"success": True, "interviews": file["interviews"], "change": line}
    if path == "/interviews/preview/link":
        # The email link: works once, and only with the test's token.
        try:
            body = json.loads(post_data or "{}")
        except ValueError:
            body = {}
        token = body.get("token") or ("g" * 32 if not state.get("link_used") else "")
        if token == "g" * 32 and not state.get("link_used"):
            state["link_used"] = True
            state["preview_ok"] = True
            return {"success": True, "token": "p" * 64, "expires": 4102444800000, "joined": False,
                    "session": "s1.preview", "email": "sharad@example.com"}
        return {"success": False, "message": "That link has expired or has already been used. Enter your email for a new code."}
    if path == "/interviews/preview/check":
        if state.get("preview_ok"):
            return {"success": True, "expires": state.get("preview_expires", 4102444800000)}
        return {"success": False}
    if path == "/interviews/admin/preview":
        opened = [{"email": "sharad@example.com", "slug": "sharad", "firstOpened": "2026-09-29T10:00:00Z",
                   "lastOpened": "2026-09-29T12:00:00Z", "opens": 2, "joined": True}]
        revoked = state.setdefault("preview_revoked", [])
        if method == "POST":
            try:
                body = json.loads(post_data or "{}")
            except ValueError:
                body = {}
            # WebKit may not pass the body: revoke Sharad first, then restore.
            action = body.get("action") or ("restore" if revoked else "revoke")
            email = body.get("email") or "sharad@example.com"
            slug = body.get("slug") or "sharad"
            revoked[:] = [r for r in revoked if not (r["email"] == email and r["slug"] == slug)]
            if action == "revoke":
                revoked.append({"email": email, "slug": slug, "revoked": "2026-09-29T13:00:00Z"})
        return {"success": True, "opened": opened, "revoked": revoked}
    if path == "/session/refresh":
        state["session_refreshes"] = state.get("session_refreshes", 0) + 1
        if state.get("session_expired"):
            return {"success": False, "message": "Please sign in again"}
        return {"success": True, "session": state.get("renewed_session")}
    if path == "/session/sign-out-all":
        state["signed_out_all"] = True
        return {"success": True}
    if path.startswith("/passkey/"):
        return passkey_reply(path, post_data, state)
    if path.startswith("/push/"):
        state.setdefault("push_calls", []).append(path)
        if path == "/push/key":
            return {"success": True, "publicKey": "BAEC"}
        return {"success": True}
    if path == "/profile/nickname":
        # Live nickname check: "Sparky" is taken, the member's own is theirs.
        nick = parse_qs(url.split("?", 1)[1] if "?" in url else "").get("nick", [""])[0]
        state.setdefault("nick_checks", []).append(nick)
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$", nick):
            return {"success": True, "available": False, "message": "3 to 20 letters or numbers (you can use _ . -), starting with a letter or number."}
        if nick.lower() == "sparky":
            return {"success": True, "available": False, "message": nick + " is taken. Try another."}
        return {"success": True, "available": True, "message": nick + " is available."}
    if path == "/profile/apps":
        state.setdefault("apps_checks", 0)
        state["apps_checks"] += 1
        return {"success": True, "apps": state.get("apps", {})}
    if path.startswith("/profile") or path.startswith("/admin/broadcasts") or path == "/admin/dm-reports":
        return profile_reply(path, method, post_data, state)
    if path == "/gallery/admin/subscribers" and method == "GET":
        details = [
            {"email": "dave@example.com", "firstName": "Dave", "lastName": "Jones", "nickname": "Sparky", "added": "2026-09-01T10:00:00Z", "files": []},
            {"email": "new@example.com", "firstName": "", "lastName": "", "nickname": "", "added": "2026-09-20T10:00:00Z", "files": []},
        ]
        return {"success": True, "subscribers": [d["email"] for d in details], "details": details}
    if path == "/my-builds" and method == "GET":
        car = dict(GARAGE_CAR, name=state.get("car_name", GARAGE_CAR["name"]))
        return {"success": True, "email": "member@example.com", "firstName": "Test", "lastName": "Member", "shownAs": "TestMember", "cars": [car], "voteEntry": GARAGE_VOTE_ENTRY}
    if path == "/my-builds/car" and method == "PUT":
        try:
            name = json.loads(post_data or "{}").get("name")
        except ValueError:
            name = None
        # WebKit doesn't always pass the request body to the mock, so the
        # rename test's new name stands in when it's missing.
        state["car_name"] = name or "The Colonel"
        return {"success": True, "car": {"id": GARAGE_CAR["id"], "name": name or GARAGE_CAR["name"]}}
    return {"success": True}


def passkey_reply(path, post_data, state):
    """Stand-in answers for passkeys (js/passkeys.js). The test browsers use
    a stand-in authenticator, so these only check the pages' side."""
    try:
        body = json.loads(post_data or "{}")
    except ValueError:
        body = {}
    keys = state.setdefault("passkeys", [])
    state.setdefault("passkey_calls", []).append(path)
    challenge = "Y2hhbGxlbmdlLWNoYWxsZW5nZS0xMjM0NTY3OA"
    if path == "/passkey/login/options":
        return {"success": True, "publicKey": {"challenge": challenge, "rpId": "localhost", "userVerification": "preferred", "allowCredentials": [], "timeout": 60000}}
    if path == "/passkey/login/verify":
        if state.get("passkey_fail"):
            return {"success": False, "message": "That passkey didn\u2019t work."}
        state["signed_in"] = True
        return {"success": True, "session": "s1.passkey", "email": "member@example.com"}
    if path == "/passkey/register/options":
        return {"success": True, "publicKey": {
            "challenge": challenge, "rp": {"id": "localhost", "name": "MT3UK"},
            "user": {"id": "bWVtYmVy", "name": "member@example.com", "displayName": "TestMember"},
            "pubKeyCredParams": [{"type": "public-key", "alg": -7}], "authenticatorSelection": {"residentKey": "required", "userVerification": "preferred"},
            "excludeCredentials": [{"type": "public-key", "id": k["id"]} for k in keys], "attestation": "none", "timeout": 60000}}
    if path == "/passkey/register/verify":
        keys.append({"id": "cred%d" % (len(keys) + 1), "name": body.get("name") or "iPhone", "created": "2026-09-29T20:00:00Z", "lastUsed": ""})
        return {"success": True, "passkeys": keys}
    if path == "/passkey/list":
        return {"success": True, "passkeys": keys}
    if path == "/passkey/delete":
        state["passkeys"] = keys = [k for k in keys if k["id"] != (body.get("id") or (keys[0]["id"] if keys else ""))]
        return {"success": True, "passkeys": keys}
    return {"success": True}


def profile_reply(path, method, post_data, state):
    """Stand-in answers for My Profile (profile.html) and its admin panel."""
    try:
        body = json.loads(post_data or "{}")
    except ValueError:
        body = {}
    p = state.setdefault("profile", {
        "firstName": "Test", "lastName": "Member", "nickname": state.get("start_nickname", "TestMember"), "emailsOff": False,
        "showName": "nickname", "hideRealName": False,
        "friends": [{"id": "f1", "nickname": "Sharad", "name": "Sharad", "builds": ["test-build.jpg"]}],
        "incoming": [{"id": "r1", "nickname": "RyanK", "name": "RyanK"}],
        "outgoing": [],
        "thread": [{"id": "m1", "text": "Hi, love the wheels", "at": "2026-09-29T09:00:00Z", "mine": False}],
        "broadcasts": [{"id": "b1", "title": "Track day at Thruxton", "text": "Book now for Friday.", "at": "2026-09-29T08:00:00Z", "emailed": ["dave@example.com"]}],
        "reports": [{"id": "rep1", "messageId": "m9", "text": "Rude message", "at": "2026-09-29T08:00:00Z", "fromEmail": "rude@example.com",
                     "fromName": "Rude", "toEmail": "member@example.com", "toName": "Test Member", "reason": "rude", "reportedAt": "2026-09-29T09:00:00Z"}],
    })
    state.setdefault("profile_calls", []).append((method, path, body))
    if path == "/profile" and method == "GET":
        return {"success": True, "email": "member@example.com", "id": "me", "firstName": p["firstName"], "lastName": p["lastName"],
                "nickname": p["nickname"], "showName": p["showName"], "hideRealName": p["hideRealName"], "apps": state.get("apps", {}), "emailsOff": p["emailsOff"], "member": True, "since": "2026-01-10T10:00:00Z",
                "builds": ["test-build.jpg"], "friends": p["friends"], "incoming": p["incoming"], "outgoing": p["outgoing"],
                "unread": {"broadcasts": 1, "direct": 1, "requests": len(p["incoming"])}}
    if path == "/profile" and method == "POST":
        # WebKit may not pass the body: the tests' values stand in.
        if not body:
            body = state.pop("fallback_body", None) or (
                {"firstName": "Test", "lastName": "Member", "nickname": "GreenKnight"} if not state.get("saved_once") else {"emailsOff": True})
        if body.get("appInstalled"):
            state.setdefault("apps", {})[body["appInstalled"]] = "2026-09-29T12:00:00Z"
            return {"success": True}
        state["saved_once"] = True
        if body.get("nickname") == "taken":
            return {"success": False, "message": "That nickname is taken. Try another."}
        for k in ("firstName", "lastName", "nickname", "emailsOff", "showName", "hideRealName"):
            if k in body:
                p[k] = body[k]
        return {"success": True, "firstName": p["firstName"], "lastName": p["lastName"], "nickname": p["nickname"],
                "showName": p["showName"], "hideRealName": p["hideRealName"], "emailsOff": p["emailsOff"]}
    if path == "/profile/search":
        return {"success": True, "results": [{"id": "s2", "nickname": "Shaz", "name": "Shaz", "status": ""}]}
    if path == "/profile/friends":
        action = body.get("action") or ("accept" if p["incoming"] else "request")
        if action == "accept":
            p["friends"] += p["incoming"]
            p["incoming"] = []
        elif action == "request":
            p["outgoing"].append({"id": "s2", "nickname": "Shaz", "name": "Shaz"})
            return {"success": True, "status": "requested"}
        elif action == "remove":
            p["friends"] = [f for f in p["friends"] if f["id"] != body.get("id")]
        return {"success": True}
    if path == "/profile/messages":
        seen = state.get("broadcasts_seen")
        return {"success": True, "since": "2026-01-10T10:00:00Z", "dmBlocked": False,
                "broadcasts": [dict(b, unread=not seen) for b in p["broadcasts"]],
                "threads": [{"id": "f1", "nickname": "Sharad", "name": "Sharad", "lastText": p["thread"][-1]["text"],
                             "lastAt": p["thread"][-1]["at"], "lastFromMe": p["thread"][-1]["mine"],
                             "unread": 0 if state.get("thread_read") else 1, "friend": True}]}
    if path == "/profile/messages/read":
        state["broadcasts_seen"] = True
        return {"success": True}
    if path == "/profile/messages/thread":
        state["thread_read"] = True
        return {"success": True, "with": {"id": "f1", "nickname": "Sharad", "name": "Sharad"}, "friend": True, "messages": p["thread"]}
    if path == "/profile/messages/send":
        # A photo comes as form data (WebKit may not pass the body on, so
        # the test can say a photo is on its way).
        with_photo = 'name="photo"' in (post_data or "") or state.pop("sending_photo", False)
        text = body.get("text")
        if with_photo:
            m = re.search(r'name="text"\r?\n\r?\n([^\r\n]*)', post_data or "")
            text = m.group(1) if m else ""
        msg = {"id": "m%d" % (len(p["thread"]) + 1), "text": text if with_photo else (text or "See you at Thruxton"), "at": "2026-09-29T10:00:00Z", "mine": True}
        if with_photo:
            msg["photo"] = True
            state["photo_sent"] = True
        reply_to = body.get("replyTo") or state.pop("replying_to", None)
        if reply_to:
            q = next((m for m in p["thread"] if m["id"] == reply_to), None)
            if q:
                msg["replyTo"] = {"id": q["id"], "mine": q["mine"], "text": q["text"][:120], "photo": bool(q.get("photo"))}
                state["replied_to"] = reply_to
        p["thread"].append(msg)
        return {"success": True, "message": msg}
    if path == "/profile/messages/react":
        m = next((m for m in p["thread"] if m["id"] == (body.get("messageId") or "m1")), p["thread"][0])
        emoji = body.get("emoji") or state.pop("reacting_with", "")
        if not emoji or m.get("myReaction") == emoji:
            m.pop("myReaction", None)
        else:
            m["myReaction"] = emoji
        state["reaction"] = (m["id"], m.get("myReaction"))
        return {"success": True, "reaction": m.get("myReaction"), "message": m}
    if path == "/profile/messages/report":
        state["reported"] = True
        return {"success": True}
    if path == "/profile/leave":
        state["left"] = True
        return {"success": True}
    if path == "/admin/broadcasts" and method == "GET":
        return {"success": True, "broadcasts": p["broadcasts"], "reports": p["reports"]}
    if path == "/admin/broadcasts":
        if body.get("action") == "delete":
            p["broadcasts"] = [b for b in p["broadcasts"] if b["id"] != body.get("id")]
        else:
            p["broadcasts"].insert(0, {"id": "b%d" % (len(p["broadcasts"]) + 2), "title": body.get("title") or "New message",
                                       "text": body.get("text") or "Hello members", "at": "2026-09-29T11:00:00Z"})
        return {"success": True, "broadcasts": p["broadcasts"]}
    if path == "/admin/broadcasts/email":
        state["emailed"] = state.get("emailed", 0) + 1
        return {"success": True, "sent": 3, "skipped": 1, "already": 0, "cursor": None}
    if path == "/admin/broadcasts/test":
        if not body:
            body = state.get("test_fallback", {})
        state.setdefault("test_emails", []).append(body)
        return {"success": True, "email": body.get("email", "")}
    if path == "/admin/broadcasts/email-one":
        for bc in p["broadcasts"]:
            if bc["id"] == body.get("id"):
                emailed = bc.setdefault("emailed", [])
                email = (body.get("email") or "").lower()
                if email in emailed and not body.get("force"):
                    return {"success": False, "already": True, "message": email + " has already been emailed this. Send it again?"}
                if email not in emailed:
                    emailed.append(email)
                state.setdefault("emailed_one", []).append((bc["id"], email, bool(body.get("force"))))
                return {"success": True, "emailed": len(emailed)}
        return {"success": False, "message": "Message not found."}
    if path == "/admin/dm-reports":
        p["reports"] = [r for r in p["reports"] if r["id"] != (body.get("id") or "rep1")]
        return {"success": True, "reports": p["reports"]}
    return {"success": True}


# The same cross-site headers the real worker sends (workers/vote-worker.js).
API_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Voter-Id, X-Session-Token",
}


def attach_mocks(context):
    state = {"log": []}

    def handle(route):
        request = route.request
        url = request.url
        is_mock_api = url.startswith(BASE_URL + MOCK_API_PATH)
        if url.startswith(BASE_URL) and not is_mock_api:
            return route.continue_()
        if is_mock_api or API_HOST in url:
            # My Garage answers "signed out" until the test signs in with a
            # code. This goes by the test's own record rather than the
            # request header, which WebKit doesn't always show to the mock.
            is_garage = url.split("?")[0].endswith("/my-builds") and request.method == "GET"
            if is_garage and state.get("garage_offline"):
                return route.abort()
            is_profile = api_path(url).startswith("/profile")
            status = 401 if (is_garage or is_profile) and not state.get("signed_in") else 200
            if api_path(url) == "/session/refresh" and state.get("session_expired"):
                status = 401
            try:
                post_data = request.post_data
            except Exception:
                post_data = None
            body = api_reply(url, request.method, post_data, state)
            if status == 401:
                body = {"success": False, "message": "Please sign in again"}
            path = api_path(url)
            state["log"].append(f"{request.method} {path} -> {status}")
            # Photos in messages come back as an image.
            if path == "/profile/messages/photo" and status == 200:
                return route.fulfill(status=200, body=TINY_JPEG, headers=dict(API_HEADERS, **{"Content-Type": "image/jpeg"}))
            return route.fulfill(status=status, body=json.dumps(body), headers=API_HEADERS)
        if R2_HOST in url and request.resource_type == "image":
            return route.fulfill(status=200, body=TINY_JPEG, headers={"Content-Type": "image/jpeg"})
        return route.abort()

    context.route(re.compile(r".*"), handle)
    return state


@pytest.fixture(scope="module")
def browsers(playwright):
    launched = {}
    for engine in {"webkit", "chromium", "firefox"}:
        try:
            launched[engine] = getattr(playwright, engine).launch()
        except Exception:
            launched[engine] = None
    yield launched
    for b in launched.values():
        if b:
            b.close()


@pytest.fixture
def device_page(request, playwright, browsers):
    name = request.param
    engine, device = DEVICES[name]
    browser = browsers.get(engine)
    if browser is None:
        pytest.skip(f"{engine} is not installed here")
    options = dict(playwright.devices[device]) if device else {"viewport": {"width": 1280, "height": 900}}
    options.pop("default_browser_type", None)
    if engine == "firefox":
        options.pop("is_mobile", None)
    # The site's service worker would fetch the mock worker path itself,
    # out of reach of the mocks, so it is switched off for these checks.
    context = browser.new_context(base_url=BASE_URL, service_workers="block", **options)
    # Skip the homepage intro animation, which waits for a tap.
    context.add_init_script("try { sessionStorage.setItem('mt3ukIntroSeen', '1'); } catch (e) {}")
    context.add_init_script(FETCH_REDIRECT)
    mock_state = attach_mocks(context)
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda err: page.errors.append(str(err)))
    page.console_log = []
    page.on("console", lambda msg: page.console_log.append(f"{msg.type}: {msg.text}"[:200]))
    page.api_log = mock_state["log"]
    page.mock_state = mock_state
    page.device_name = name
    yield page
    context.close()


def all_devices(fn):
    return pytest.mark.parametrize("device_page", list(DEVICES), indirect=True)(fn)


def diagnostics(page):
    """What happened on the page, shown when a flow check fails."""
    try:
        stored = page.evaluate("Object.keys(localStorage).join(', ')")
    except Exception as err:
        stored = f"could not read ({err})"
    return (
        f"\nworker calls: {page.api_log}\nsaved keys: {stored}"
        f"\nconsole: {page.console_log[-10:]}\nerrors: {page.errors}"
    )


def overflow_width(page):
    return page.evaluate("document.documentElement.scrollWidth - window.innerWidth")


@all_devices
@pytest.mark.parametrize("page_name", PAGES)
def test_page_loads_fits_and_menu_opens(device_page, page_name):
    page = device_page
    page.goto(f"/{page_name}.html", wait_until="load")
    page.wait_for_timeout(800)

    out_dir = SCREENSHOT_DIR / page.device_name
    out_dir.mkdir(parents=True, exist_ok=True)
    # Browsers can't capture more than 32767 screen pixels in one image, so
    # long pages are cut at the first 12000px. WebKit checks the whole page
    # height before cutting, so a page over the limit (the homepage on a
    # phone) only gets its first screen. JPEG keeps the download small.
    full_height = page.evaluate("document.documentElement.scrollHeight")
    width = page.evaluate("document.documentElement.clientWidth")
    # The limit counts screen pixels, and phones have 2x or 3x screens.
    ratio = page.evaluate("window.devicePixelRatio") or 1
    max_css = int(30000 / ratio)
    shot = {"path": str(out_dir / f"{page_name}.jpg"), "type": "jpeg", "quality": 70}
    if full_height < max_css:
        shot.update(full_page=True, clip={"x": 0, "y": 0, "width": width, "height": min(full_height, 12000, max_css)})
    page.screenshot(**shot)

    assert page.errors == [], f"Script errors on {page_name}: {page.errors}"
    assert overflow_width(page) <= 1, f"{page_name} is wider than the screen by {overflow_width(page)}px"
    assert page.locator("header .logo img").is_visible()

    hamburger = page.locator("#hamburger")
    if page.device_name in MOBILE:
        assert hamburger.is_visible(), "Menu button missing on a phone"
    if hamburger.is_visible():
        hamburger.click()
        page.wait_for_timeout(400)
        assert hamburger.get_attribute("aria-expanded") == "true"
    assert page.locator("#navlinks .nav-link").first.is_visible(), "Menu links are not showing"


@all_devices
def test_reel_like_asks_to_sign_in_then_works(device_page):
    page = device_page
    page.goto("/index.html#build-feed")
    slide = page.locator(".bf-slide").first
    slide.wait_for(timeout=10000)
    slide.scroll_into_view_if_needed()
    like = slide.locator(".bf-like-btn")
    assert like.is_visible()

    # Signed out: likes are for members, so the sign-in dialog shows.
    like.click()
    page.locator(".mt3uk-signin-box").wait_for(state="visible", timeout=5000)
    assert "bf-liked" not in (like.get_attribute("class") or "")
    assert overflow_width(page) <= 1
    page.click(".mt3uk-signin-close")

    # Signed in: the like goes through.
    page.evaluate("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.reload()
    slide = page.locator(".bf-slide").first
    slide.wait_for(timeout=10000)
    slide.scroll_into_view_if_needed()
    like = slide.locator(".bf-like-btn")
    like.click()
    page.wait_for_timeout(500)
    assert "bf-liked" in (like.get_attribute("class") or ""), "Signed-in like did not register" + diagnostics(page)
    assert page.errors == []


@all_devices
def test_gallery_photo_opens_in_viewer(device_page):
    page = device_page
    page.goto("/gallery.html")
    # Tap the tile, as a visitor does: a long caption can cover the middle of
    # the photo on a phone-width tile, and the whole tile opens the viewer.
    first = page.locator("#gallery-grid .gallery-slot.filled").first
    first.wait_for(timeout=10000)
    first.scroll_into_view_if_needed()
    first.click()
    page.wait_for_timeout(600)
    assert page.locator(".lightbox.open").count() == 1, "Photo viewer did not open"
    assert page.errors == []


@all_devices
def test_my_garage_sign_in_with_code(device_page):
    page = device_page
    page.goto("/my-builds.html")
    page.fill("#mb-email", "member@example.com")
    page.click("#mb-signin-btn")
    page.locator("#mb-code-form").wait_for(state="visible", timeout=5000)
    page.fill("#mb-code", "000000")
    page.click("#mb-code-btn")
    page.wait_for_timeout(500)
    assert "not right" in page.inner_text("#mb-code-status")
    page.fill("#mb-code", "123456")
    page.click("#mb-code-btn")
    page.wait_for_timeout(1500)
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.test", "Code sign-in not saved" + diagnostics(page)
    assert page.locator("#mb-signin-view").is_hidden(), "My Garage did not open after sign-in" + diagnostics(page)
    assert overflow_width(page) <= 1
    assert page.errors == []


# Stands in for the phone's share menu, so the test can see what was shared.
SHARE_STUB = "window.__shared = []; navigator.share = function (d) { window.__shared.push(d); return Promise.resolve(); };"


def shared_url(page):
    """The link a share button offered: from the phone share menu, or the
    Facebook option in the desktop pop-out (which is then closed)."""
    page.wait_for_timeout(300)
    return page.evaluate("""() => {
      if (window.__shared.length) return window.__shared.pop().url;
      var pop = document.querySelector('.mt3uk-share-pop');
      if (!pop || pop.hidden) return null;
      var url = new URL(pop.querySelector('[data-channel=facebook]').href).searchParams.get('u');
      pop.querySelector('.mt3uk-share-close').click();
      return url;
    }""")


@all_devices
def test_share_buttons(device_page):
    page = device_page
    page.add_init_script(SHARE_STUB)

    page.goto("/index.html#build-of-the-day")

    # Build of the Week: the photo opens the full image viewer, which has
    # its own share button.
    photo = page.locator("#botm-frame img")
    photo.wait_for(timeout=10000)
    photo.scroll_into_view_if_needed()
    photo.click()
    button = page.locator(".bf-viewer-share")
    button.wait_for(state="visible", timeout=5000)
    button.click()
    url = shared_url(page)
    assert url and "/share/" in url and "utm_campaign=botw_share" in url, "Build of the Week share: " + str(url) + diagnostics(page)
    page.click(".bf-viewer-close")

    # Round share button on a section heading links to that section.
    dot = page.locator("#build-of-the-day h2 .mt3uk-share-dot").first
    dot.scroll_into_view_if_needed()
    dot.click()
    url = shared_url(page)
    assert url and url.startswith("https://mt3uk.com/share/section/index--build-of-the-day.html?") and "utm_campaign=section_build-of-the-day" in url, "Section share: " + str(url)
    assert overflow_width(page) <= 1

    # Round share button by a page's main heading.
    page.goto("/shop.html")
    page.locator("h1 .mt3uk-share-dot").click()
    url = shared_url(page)
    assert url and url.startswith("https://mt3uk.com/share/section/shop.html?") and "utm_campaign=page_shop" in url, "Page share: " + str(url)

    # My Garage photo viewer.
    page.mock_state["signed_in"] = True
    page.evaluate("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    page.locator(".mb-photo-thumb img").first.click(timeout=5000)
    button = page.locator("#mb-lightbox-share")
    button.wait_for(state="visible", timeout=5000)
    button.click()
    url = shared_url(page)
    assert url == "https://mt3uk.com/share/test-build.jpg.html?utm_source=" + url.split("utm_source=")[1].split("&")[0] + "&utm_medium=share&utm_campaign=garage_share", "My Garage share: " + str(url)
    assert page.errors == []


@all_devices
def test_vote_one_entry_and_not_your_own(device_page):
    page = device_page
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")

    # Your own build shows its votes but has no vote button.
    page.goto("/index.html#vote-frame")
    own = page.locator('.vote-card[data-file="test-build.jpg"]')
    own.wait_for(timeout=10000)
    assert own.locator(".vote-btn").count() == 0, "Own build still has a vote button"
    assert "3 votes" in own.inner_text() and "Your build" in own.inner_text()
    other = page.locator('.vote-card[data-file="other-build.jpg"]')
    assert other.locator(".vote-btn").count() == 1
    assert "You can only vote for other members' builds." in page.inner_text("#build-of-the-day")
    page.goto("/index.html#vote-how")
    assert page.locator("#vote-how").get_attribute("open") is not None, "How voting works did not open"
    page.goto("/index.html#vote-frame")
    page.locator(".vote-card").first.wait_for(timeout=10000)

    # Every entry is in the list, a few rows at a time.
    visible = page.locator(".vote-card:not([hidden])").count()
    assert visible in (8, 9), "Unexpected first page of vote cards: %d" % visible
    more = page.locator("#vote-more-btn")
    more.scroll_into_view_if_needed()
    more.click()
    assert page.locator(".vote-card:not([hidden])").count() == 12
    assert page.locator("#vote-more-wrap").is_hidden()

    # My Garage: switching entry warns that its votes will be lost.
    page.goto("/my-builds.html")
    page.locator(".mb-car-tile").first.click(timeout=10000)
    first = page.locator('.mb-photo-thumb-wrap[data-file="test-build.jpg"] input[data-flag="votable"]')
    second = page.locator('.mb-photo-thumb-wrap[data-file="test-build-2.jpg"] input[data-flag="votable"]')
    first.wait_for(timeout=5000)
    assert first.is_checked() and not second.is_checked()
    assert "your entry this week is Test Model 3 (3 votes)" in page.inner_text("#mb-vote-hint")
    assert page.locator(".mb-photo-added").first.inner_text().startswith("Added ")
    messages = []

    def answer(dialog):
        messages.append(dialog.message)
        dialog.accept()

    page.on("dialog", answer)
    second.click()
    page.wait_for_timeout(800)
    assert messages and "Test Model 3" in messages[0] and "3 votes" in messages[0], "No switch warning: " + str(messages)
    assert second.is_checked() and not first.is_checked(), "Entry did not switch" + diagnostics(page)
    assert page.errors == []


@all_devices
def test_admin_can_take_a_photo_out_of_voting(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    card = page.locator("#vote-entries .card")
    card.first.wait_for(timeout=10000)
    text = card.first.inner_text()
    assert "BRAKE DISCS" in text and "TEST MEMBER" in text and "member@example.com" in text and "2 votes" in text
    assert card.first.locator("img").get_attribute("src").endswith("/gallery/brake-discs.jpg")
    assert "OLD ENTRY" in page.inner_text("#vote-removed")

    page.on("dialog", lambda d: d.accept())
    before = len(page.api_log)
    page.click("#vote-entries .vote-remove-btn")
    page.wait_for_timeout(600)
    assert any(line.startswith("POST /admin/vote-entries") for line in page.api_log[before:]), page.api_log[before:]

    # Send subscribers email now.
    before = len(page.api_log)
    page.click("#send-digest-btn")
    page.wait_for_timeout(600)
    assert any(line.startswith("POST /admin/send-digest") for line in page.api_log[before:]), page.api_log[before:]
    assert "Sent." in page.inner_text("#send-digest-status")
    assert page.errors == []


@all_devices
def test_admin_notification_bell(device_page):
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    badge = page.locator("#bell-badge")
    badge.wait_for(state="visible", timeout=10000)
    assert badge.inner_text() == "3"

    # The bell lists a preview of each, and opening it marks them as seen.
    page.click("#bell-btn")
    panel = page.locator("#bell-panel")
    text = panel.inner_text()
    for words in ("PENDING CLAIMS (1)", "CLAIM PERSON", "REPORTED COMMENTS (1)", "Not a nice comment", "REPORTED PHOTOS (1)", "reported-photo.jpg"):
        assert words.lower() in text.lower(), words + " missing from: " + text
    assert panel.locator(".bell-thumb").count() == 3
    assert badge.is_hidden()
    assert overflow_width(page) <= 1

    # Tapping an item jumps to it.
    panel.locator(".bell-item", has_text="reported-photo.jpg").click()
    page.wait_for_timeout(600)
    assert panel.is_hidden()
    assert page.locator("#reported-photos .card").first.is_visible()

    # Seen items don't count again after a reload.
    page.reload()
    page.locator("#reported-photos .card").first.wait_for(timeout=10000)
    page.wait_for_timeout(300)
    assert badge.is_hidden()
    assert page.errors == []


def _manifest_files(flag, count):
    photos = json.loads((REPO_ROOT / "images" / "gallery" / "manifest.json").read_text())
    return [p["file"] for p in photos if p.get(flag) is not False][:count]


@all_devices
def test_my_garage_car_name_and_site_links(device_page):
    page = device_page
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.goto("/my-builds.html")

    # The car's name sits above its photo on the garage tile.
    tile = page.locator(".mb-car-tile").first
    tile.wait_for(timeout=10000)
    name_box = tile.locator(".mb-car-tile-name").bounding_box()
    photo_box = tile.locator(".mb-car-tile-thumb").bounding_box()
    assert name_box["y"] < photo_box["y"], "Car name should be above the photo"

    # Garage links go to the member's own photos.
    links = page.locator("#mb-garage-site-links")
    assert "only=test-build.jpg%2Ctest-build-2.jpg" in links.locator('[data-link="reel"]').get_attribute("href")
    assert links.locator('[data-link="vote"]').get_attribute("href") == "index.html?entry=test-build.jpg#vote-frame"

    # The car name shows as text with Edit; Edit gives an input and Save.
    tile.click()
    assert page.locator("#mb-car-name-text").inner_text() == "Test Model 3"
    assert page.locator("#mb-car-name-input").is_hidden()
    page.click("#mb-car-name-edit")
    page.fill("#mb-car-name-input", "The Colonel")
    page.click("#mb-car-name-save")
    page.wait_for_timeout(600)
    assert page.locator("#mb-car-name-input").is_hidden()
    assert page.locator("#mb-car-name-text").inner_text() == "The Colonel"
    assert any(line.startswith("PUT /my-builds/car") for line in page.api_log), page.api_log
    assert "gallery.html?only=" in page.locator('#mb-car-site-links [data-link="gallery"]').get_attribute("href")
    assert overflow_width(page) <= 1
    assert page.errors == []


@all_devices
def test_only_links_show_just_those_builds(device_page):
    page = device_page
    files = _manifest_files("reel", 2)
    page.goto("/index.html?only=" + ",".join(files) + "#build-feed")
    page.locator(".bf-slide").first.wait_for(timeout=10000)
    assert page.locator("#bf-only-note").is_visible()
    shown = page.eval_on_selector_all(".bf-cell[data-file]", "els => els.map(e => e.dataset.file)")
    assert shown and set(shown) <= set(files), shown

    files = _manifest_files("gallery", 2)
    page.goto("/gallery.html?only=" + ",".join(files))
    page.locator("#gallery-grid .gallery-slot").first.wait_for(timeout=10000)
    assert page.locator("#gallery-only-note").is_visible()
    shown = page.eval_on_selector_all("#gallery-grid .gallery-slot", "els => els.map(e => e.dataset.file)")
    assert sorted(shown) == sorted(files), shown

    # ?entry= highlights the member's entry in the vote, even past the first rows.
    page.goto("/index.html?entry=more-9.jpg#vote-frame")
    card = page.locator('.vote-card[data-file="more-9.jpg"]')
    card.wait_for(timeout=10000)
    assert card.is_visible() and "vote-card-focus" in card.get_attribute("class")
    assert page.errors == []


@all_devices
def test_admin_bell_asks_for_key(device_page):
    page = device_page
    page.goto("/admin.html")
    page.click("#bell-btn")
    prompt = page.locator("#bell-key-input")
    prompt.wait_for(state="visible", timeout=5000)
    assert "Enter the admin key" in page.inner_text("#bell-panel")
    prompt.fill("test-key")
    page.locator("#bell-key-form button").click()
    page.locator("#bell-panel .bell-item").first.wait_for(timeout=10000)
    assert "PENDING CLAIMS (1)" in page.inner_text("#bell-panel").upper()
    assert page.input_value("#admin-key") == "test-key"
    assert page.errors == []


@all_devices
def test_homepage_bell_asks_visitors_to_sign_in(device_page):
    page = device_page
    page.goto("/index.html")
    bell = page.locator("#nav-bell-btn")
    bell.wait_for(timeout=5000)
    search = page.locator("#nav-search").bounding_box()
    assert bell.bounding_box()["x"] < search["x"], "The bell should sit left of search"
    assert page.locator("#nav-bell-count").is_hidden()
    bell.click()
    panel = page.locator("#nav-bell-panel")
    assert "Sign in for notifications" in panel.inner_text()
    assert "signin.html?next=" in panel.locator(".nav-bell-cta").get_attribute("href")
    assert overflow_width(page) <= 1
    assert page.errors == []


@all_devices
def test_homepage_bell_shows_members_their_notifications(device_page):
    page = device_page
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.goto("/index.html")
    count = page.locator("#nav-bell-count")
    count.wait_for(state="visible", timeout=5000)
    assert count.inner_text() == "2"
    page.click("#nav-bell-btn")
    panel = page.locator("#nav-bell-panel")
    panel.locator(".nav-bell-item").first.wait_for(timeout=5000)
    text = panel.inner_text()
    assert "Sharad" in text and "Love the wheels!" in text
    assert "comment=c9" in panel.locator(".nav-bell-item").nth(1).get_attribute("href")
    page.wait_for_timeout(500)
    assert count.is_hidden(), "Opening the bell should mark notifications as read"
    assert overflow_width(page) <= 1
    assert page.errors == []


@all_devices
def test_notifications_can_be_cleared(device_page):
    page = device_page
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test')")
    page.goto("/index.html")
    page.locator("#nav-bell-count").wait_for(state="visible", timeout=5000)
    page.click("#nav-bell-btn")
    panel = page.locator("#nav-bell-panel")
    panel.locator(".nav-bell-row").first.wait_for(timeout=5000)
    assert panel.locator(".nav-bell-row").count() == 2

    # The x clears one without opening it.
    before = len(page.api_log)
    panel.locator('.nav-bell-row[data-id="n1"] .nav-bell-dismiss').click()
    assert panel.locator(".nav-bell-row").count() == 1
    assert page.url.endswith("/index.html")
    page.wait_for_timeout(300)
    assert any(line.startswith("POST /my-builds/notifications/clear") for line in page.api_log[before:])

    # Clear all empties the list.
    panel.locator(".nav-bell-clear-all").click()
    assert panel.locator(".nav-bell-row").count() == 0
    assert "No notifications yet" in panel.inner_text()
    assert page.errors == []


@all_devices
def test_up_chevron_returns_to_the_top(device_page):
    page = device_page
    page.emulate_media(reduced_motion="reduce")
    page.goto("/index.html")
    up = page.locator(".categories-section #hp-scroll-top")
    # It sits centred at the top of section 01.
    box = up.bounding_box()
    section = page.locator(".categories-section").bounding_box()
    assert abs((box["x"] + box["width"] / 2) - (section["x"] + section["width"] / 2)) < 4
    assert 0 <= box["y"] - section["y"] < 30
    page.evaluate("window.scrollTo(0, document.querySelector('.categories-section').offsetTop)")
    assert page.evaluate("window.scrollY") > 50
    up.click()
    page.wait_for_timeout(500)
    assert page.evaluate("window.scrollY") < 5
    assert page.errors == []


@all_devices
def test_refresh_at_the_top_stays_at_the_top(device_page):
    # Pull down to refresh after tapping a #section link shouldn't jump back
    # down to that section.
    page = device_page
    page.goto("/index.html#build-feed")
    page.wait_for_timeout(800)
    # Scroll back up to the top as a visitor would (the touch/press counts
    # as them taking over; mobile WebKit has no mouse wheel), then refresh.
    page.locator("body").dispatch_event("pointerdown")
    page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
    page.wait_for_function("window.scrollY < 5", timeout=5000)
    page.wait_for_timeout(600)
    assert page.evaluate("window.scrollY") < 5, "The page stays where the visitor put it"
    page.reload()
    page.wait_for_timeout(2000)
    assert page.evaluate("window.scrollY") < 5
    assert page.evaluate("location.hash") == ""
    assert page.errors == []


@all_devices
def test_up_chevron_clears_the_section_from_the_address(device_page):
    page = device_page
    page.emulate_media(reduced_motion="reduce")
    page.goto("/index.html#build-feed")
    page.wait_for_timeout(500)
    page.locator("#hp-scroll-top").click()
    page.wait_for_function("location.hash === ''", timeout=5000)
    page.wait_for_function("window.scrollY < 5", timeout=5000)
    assert page.errors == []
