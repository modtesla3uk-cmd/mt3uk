"""The privacy notice (privacy.html) and the links to it. Also checks the
worker masks emails in GitHub issues, as the repo is public."""
import re
import sys
from pathlib import Path

from test_devices import device_page, browsers, all_devices, overflow_width  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_layout  # noqa: E402


@all_devices
def test_privacy_page_covers_the_essentials(device_page):
    page = device_page
    page.goto("/privacy.html")
    text = page.locator("#privacy-notice").inner_text()
    for needed in ["run by Richard", "modtesla3uk@gmail.com", "18 and over", "Your rights",
                   "ico.org.uk", "How long we keep it", "Who else handles your data", "Cookies"]:
        assert needed in text, f"The privacy notice should mention {needed!r}"
    assert overflow_width(page) <= 0
    assert page.errors == []


def test_every_page_footer_links_to_privacy():
    for name in build_layout.PAGES:
        source = (ROOT / (name + ".html")).read_text(encoding="utf-8")
        footer = source[source.rfind("\n<footer>"):]
        assert 'href="privacy.html"' in footer, f"{name}.html footer has no Privacy link"


def test_join_forms_mention_age_and_privacy():
    for path in ["signin.html", "my-builds.html", "js/interview-gate.js"]:
        source = (ROOT / path).read_text(encoding="utf-8")
        assert "18 or over" in source and "privacy.html" in source, f"{path} should say 18 or over and link to Privacy"


def test_github_issues_never_carry_a_full_email():
    worker = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    bodies = re.findall(r"api\.github\.com/repos/' \+ OWNER \+ '/' \+ REPO \+ '/issues'.*?\}\)\s*\}", worker, re.S)
    assert len(bodies) >= 2
    for body in bodies:
        assert "subscriberLabel(" not in body and "publicLabel(" in body, "GitHub issues are public: use publicLabel (masked email)"


def test_member_emails_have_one_click_unsubscribe():
    """Gmail and Outlook expect RFC 8058 one-click unsubscribe on emails
    members can turn off, and trust mail more when it's there."""
    worker = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    assert "List-Unsubscribe-Post: List-Unsubscribe=One-Click" in worker
    assert "url.pathname === '/email/unsubscribe'" in worker
    # Opening the link only asks; the POST unsubscribes (link scanners).
    handler = worker.split("async function handleEmailUnsubscribe", 1)[1].split("\nasync function ", 1)[0]
    assert "request.method === 'POST'" in handler and "emailsOff = true" in handler
    # Member emails go without the headers for now: Outlook junked the
    # same text with them and delivered it without them.
    assert "var UNSUBSCRIBE_HEADERS = false;" in worker
    assert "await memberEmailHeaders(env, toEmail)" in worker


def test_emails_have_no_reply_to_on_another_domain():
    """Outlook flags a Reply-To on a different domain from the sender (the
    MT3UK Gmail) as a phishing sign, so emails don't set one."""
    worker = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    raw_email = worker.split("function rawEmail(", 1)[1].split("\n}\n", 1)[0]
    assert "Reply-To" not in raw_email


def test_member_emails_look_like_the_ones_outlook_lets_through():
    """Outlook put member emails in Junk while the same text sent plain (no
    footer links, no "MT3UK:" subject prefix) reached the inbox."""
    worker = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    footer = worker.split("var EMAIL_FOOTER = ", 1)[1].split(";\n", 1)[0]
    assert "http" not in footer and "_URL" not in footer, "No links in the footer"
    broadcast = worker.split("function broadcastEmailText(msg) {", 1)[1].split("\n}", 1)[0]
    assert "_URL" not in broadcast, "No extra link under messages"
    assert "'MT3UK: ' + msg.title" not in worker, "Subjects are just the title"


def test_emails_come_from_an_address_that_receives_mail():
    """hello@mt3uk.com forwards to the MT3UK Gmail (Cloudflare Email
    Routing), so replies arrive and mail filters see a real sender."""
    worker = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    assert "const MY_BUILDS_FROM_EMAIL = 'hello@mt3uk.com';" in worker
    assert "noreply@" not in worker


def test_votes_and_comments_need_a_sign_in():
    """Votes and comments come from the member's sign-in, never from an
    email the page sends, the same as likes."""
    worker = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    vote = worker[worker.index("async function handleVotePost"):worker.index("async function getLikesAggregate")]
    assert "if (!sessionEmail) return signInRequired('Sign in to vote.');" in vote
    assert "voter-ip:" not in vote, "One vote per member, not per IP address"
    comments = worker[worker.index("async function handleCommentsPost"):worker.index("async function handleCommentReport")]
    assert "var email = await resolveSession(request, env);" in comments
    assert "body.email" not in comments


def test_message_photos_stay_private():
    """Photos in messages live under dm/ (never gallery/), are only served
    through the worker to the two people in the conversation, and stop
    being shown after 90 days."""
    worker = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
    assert "return 'dm/' + ids[0] + '-' + ids[1] + '/';" in worker
    photo = worker[worker.index("async function handleProfileMessagePhoto"):worker.index("async function servePrivatePhoto")]
    assert "var email = await resolveSession(request, env);" in photo
    assert "dmThreadKey(email, other)" in photo, "Only from the member's own conversation"
    assert "dmPhotoExpired(msg)" in photo
    assert "var DM_PHOTO_DAYS = 90;" in worker
    thread = worker[worker.index("async function handleProfileThread"):worker.index("async function handleProfileMessagePhoto")]
    assert "out.photo = true" in thread and "m.photo;" not in thread, "The R2 key is never sent to the page"
    assert "await deleteDmPhotos(env, email, index[k].email);" in worker, "Leaving deletes the photos"
