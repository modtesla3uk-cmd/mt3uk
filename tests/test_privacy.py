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
    assert "await listUnsubscribeHeaders(env, toEmail)" in worker
