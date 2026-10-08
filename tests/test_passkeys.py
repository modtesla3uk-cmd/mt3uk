"""Passkeys (js/passkeys.js): sign in with Face ID, a fingerprint or the
screen lock instead of an emailed code, on Sign Up / Sign In and My
Garage, with an offer to set one up after signing in and a Passkeys
section in Profile. The browsers here use a stand-in authenticator; the
worker's signature checks are tested separately. Also the "check your
Junk folder" hint wherever a code is emailed."""
from test_devices import device_page, browsers, all_devices, overflow_width, diagnostics  # noqa: F401

# A stand-in for the phone's passkey prompt.
FAKE_AUTHENTICATOR = """
(() => {
  const buf = s => new TextEncoder().encode(s).buffer;
  window.PublicKeyCredential = window.PublicKeyCredential || function () {};
  window.PublicKeyCredential.isConditionalMediationAvailable = async () => !!localStorage.getItem('pkAutofill');
  const cancelled = () => { const e = new Error('cancelled'); e.name = 'NotAllowedError'; return e; };
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    create: async (o) => {
      window.__pkCreate = { rp: o.publicKey.rp.id, challenge: o.publicKey.challenge.byteLength };
      if (localStorage.getItem('pkCancel')) throw cancelled();
      return { id: 'cred1', rawId: buf('cred1'), type: 'public-key', response: { clientDataJSON: buf('{}'), attestationObject: buf('att') } };
    },
    get: async (o) => {
      if (o.mediation === 'conditional') {
        // Waits until the test "picks" the passkey from the keyboard bar.
        return new Promise((resolve, reject) => {
          window.__pkPick = () => resolve({ id: 'cred1', rawId: buf('cred1'), type: 'public-key', response: { clientDataJSON: buf('{}'), authenticatorData: buf('ad'), signature: buf('sig') } });
          o.signal.addEventListener('abort', () => { window.__pkAborted = true; const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
        });
      }
      window.__pkGet = { rp: o.publicKey.rpId, challenge: o.publicKey.challenge.byteLength };
      if (localStorage.getItem('pkCancel')) throw cancelled();
      return { id: 'cred1', rawId: buf('cred1'), type: 'public-key', response: { clientDataJSON: buf('{}'), authenticatorData: buf('ad'), signature: buf('sig') } };
    }
  } });
})();
"""


def signed_in(page):
    page.mock_state["signed_in"] = True
    page.add_init_script("localStorage.setItem('mt3ukMyBuildsSession', 's1.test'); localStorage.setItem('mt3ukMyBuildsEmail', 'member@example.com')")


@all_devices
def test_sign_in_with_a_passkey(device_page):
    page = device_page
    page.add_init_script(FAKE_AUTHENTICATOR + " localStorage.setItem('mt3ukPasskeyHere', '1');")
    page.goto("/signin.html")
    btn = page.locator("#si-passkey-btn")
    btn.wait_for(state="visible", timeout=5000)
    assert "No email needed" in page.locator("#si-passkey").inner_text()
    assert page.evaluate("document.getElementById('si-passkey-how').open") is False, "Passkey used here before: help stays closed"
    assert overflow_width(page) <= 0
    btn.click()
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.passkey"
    assert page.evaluate("window.__pkGet.challenge") > 0
    assert page.locator("#si-passkey-offer").is_hidden(), "Signed in with a passkey: no need to offer one"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_cancelled_passkey_points_to_the_email_code(device_page):
    page = device_page
    page.add_init_script(FAKE_AUTHENTICATOR + " localStorage.setItem('pkCancel', '1');")
    page.goto("/signin.html")
    page.click("#si-passkey-btn")
    page.wait_for_function("document.getElementById('si-passkey-status').textContent.indexOf('email code') !== -1", timeout=5000)
    assert page.locator("#si-signed-in").is_hidden()
    assert page.errors == []


@all_devices
def test_passkey_help_when_none_on_this_device(device_page):
    page = device_page
    page.add_init_script(FAKE_AUTHENTICATOR + " localStorage.setItem('pkCancel', '1');")
    page.goto("/signin.html")
    page.locator("#si-passkey-btn").wait_for(state="visible", timeout=5000)
    assert page.evaluate("document.getElementById('si-passkey-how').open") is True
    assert "Sign in with an email code first" in page.locator("#si-passkey-note").inner_text()
    assert "Add a passkey on this device" in page.locator("#si-passkey-how").inner_text()
    assert overflow_width(page) <= 0
    page.click("#si-passkey-btn")
    page.wait_for_function("document.getElementById('si-passkey-status').textContent.indexOf('No MT3UK passkey on this device yet') !== -1", timeout=5000)
    assert page.errors == [], diagnostics(page)


@all_devices
def test_new_here_comes_first_with_a_link_to_sign_in(device_page):
    page = device_page
    page.goto("/signin.html")
    page.locator("#si-signin").wait_for(timeout=5000)
    first = page.evaluate("document.querySelector('#si-forms > .si-card').id")
    assert first == "si-join", "New here? Join free comes before Already a member?"
    link = page.locator("#si-to-signin")
    assert link.inner_text() == "Sign in"
    link.click()
    page.wait_for_function("document.activeElement && document.activeElement.id === 'si-signin-email'", timeout=5000)
    assert page.errors == [], diagnostics(page)


@all_devices
def test_my_garage_passkey_help_when_none_on_this_device(device_page):
    page = device_page
    page.add_init_script(FAKE_AUTHENTICATOR + " localStorage.setItem('pkCancel', '1');")
    page.goto("/my-builds.html")
    page.locator("#mb-passkey-btn").wait_for(state="visible", timeout=5000)
    assert page.evaluate("document.getElementById('mb-passkey-how').open") is True
    page.click("#mb-passkey-btn")
    page.wait_for_function("document.getElementById('mb-passkey-status').textContent.indexOf('No MT3UK passkey on this device yet') !== -1", timeout=5000)


@all_devices
def test_offer_to_set_up_a_passkey_after_signing_in(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script(FAKE_AUTHENTICATOR)
    page.goto("/signin.html")
    offer = page.locator("#si-passkey-offer")
    offer.wait_for(state="visible", timeout=5000)
    assert "Face ID" in offer.inner_text()
    assert overflow_width(page) <= 0
    page.click("#si-passkey-add")
    page.wait_for_function("document.getElementById('si-passkey-add-status').textContent.indexOf('Done') !== -1", timeout=5000)
    assert "/passkey/register/verify" in page.mock_state["passkey_calls"]
    assert page.evaluate("localStorage.getItem('mt3ukPasskeyHere')") == "1"
    page.reload()
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    assert offer.is_hidden(), "Not offered again on this device"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_not_now_hides_the_passkey_offer(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script(FAKE_AUTHENTICATOR)
    page.goto("/signin.html")
    page.locator("#si-passkey-offer").wait_for(state="visible", timeout=5000)
    page.click("#si-passkey-later")
    assert page.locator("#si-passkey-offer").is_hidden()
    page.reload()
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    assert page.locator("#si-passkey-offer").is_hidden()


@all_devices
def test_no_passkey_button_without_browser_support(device_page):
    page = device_page
    page.add_init_script("delete window.PublicKeyCredential; window.PublicKeyCredential = undefined;")
    page.goto("/signin.html")
    page.locator("#si-signin-btn").wait_for(timeout=5000)
    assert page.locator("#si-passkey").is_hidden()


@all_devices
def test_my_garage_passkey_sign_in(device_page):
    page = device_page
    page.add_init_script(FAKE_AUTHENTICATOR)
    page.goto("/my-builds.html")
    btn = page.locator("#mb-passkey-btn")
    btn.wait_for(state="visible", timeout=5000)
    btn.click()
    page.locator("#mb-app-view").wait_for(state="visible", timeout=5000)
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.passkey"
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


@all_devices
def test_profile_lists_adds_and_removes_passkeys(device_page):
    page = device_page
    signed_in(page)
    page.add_init_script(FAKE_AUTHENTICATOR)
    page.goto("/profile.html#passkeys")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    card = page.locator("#passkeys")
    page.wait_for_function("document.getElementById('pf-passkeys').textContent.indexOf('No passkeys yet') !== -1", timeout=5000)
    page.click("#pf-passkey-add")
    page.wait_for_function("document.getElementById('pf-passkey-status').textContent.indexOf('Passkey added') !== -1", timeout=5000)
    assert card.locator(".pf-passkey-remove").count() == 1
    assert overflow_width(page) <= 0
    page.once("dialog", lambda d: d.accept())
    card.locator(".pf-passkey-remove").click()
    page.wait_for_function("document.getElementById('pf-passkey-status').textContent === 'Passkey removed.'", timeout=5000)
    assert "No passkeys yet" in page.locator("#pf-passkeys").inner_text()
    assert page.errors == [], diagnostics(page)


@all_devices
def test_set_up_a_passkey_card_beside_your_details(device_page):
    """Profile has a Set up a passkey card beside Your details (above the app
    card). Its button adds a passkey; once the member has one the card says
    so and links to the Passkeys list under Security."""
    page = device_page
    signed_in(page)
    page.add_init_script(FAKE_AUTHENTICATOR)
    page.goto("/profile.html")
    page.locator("#pf-app").wait_for(state="visible", timeout=5000)
    card = page.locator("#passkey-setup")
    card.wait_for(state="visible", timeout=5000)
    assert page.evaluate("[...document.querySelectorAll('.pf-side > .pf-card')].map(e => e.id)") == ["passkey-setup", "app"]
    assert page.evaluate("document.querySelector('.pf-grid > .pf-card').id") == "details"
    page.wait_for_function("document.getElementById('pf-passkeys').textContent.indexOf('No passkeys yet') !== -1", timeout=5000)
    assert card.locator("h2").inner_text() == "Set up a passkey"
    assert card.locator("#pf-pk-manage").is_hidden()
    assert overflow_width(page) <= 0
    page.click("#pf-pk-setup")
    page.wait_for_function("document.getElementById('pf-pk-status').textContent.indexOf('Passkey added') !== -1", timeout=5000)
    assert card.locator("h2").inner_text() == "Passkey set up"
    assert card.locator("#pf-pk-manage").is_visible() and card.locator("#pf-pk-manage").get_attribute("href") == "#passkeys"
    assert "Add a passkey on this device" in card.locator("#pf-pk-setup").inner_text()
    assert page.locator("#passkeys .pf-passkey-remove").count() == 1, "The Security list shows it too"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_admin_reminds_members_without_a_passkey(device_page):
    """The Passkey reminders panel on admin.html counts the members without
    a passkey, then sends each a reminder, a batch at a time."""
    page = device_page
    page.add_init_script("sessionStorage.setItem('mt3ukAdminKey', 'test-key')")
    page.goto("/admin.html")
    page.locator("#passkey-nudge-wrap > summary").click()
    page.click("#pk-nudge-check")
    page.wait_for_function("document.getElementById('pk-nudge-note').textContent.indexOf('3 members without a passkey would be reminded') !== -1", timeout=5000)
    assert "6 members already have a passkey, 1 reminded before" in page.locator("#pk-nudge-note").inner_text()
    assert "(3 without)" in page.locator("#pk-nudge-count").inner_text()
    calls = page.mock_state["nudge_calls"]
    assert [c["dry"] for c in calls] == [True, True] and calls[1]["cursor"] == "more", "Counts through every batch, sending nothing"
    page.check("#pk-nudge-email")
    page.once("dialog", lambda d: d.accept())
    page.click("#pk-nudge-send")
    page.wait_for_function("document.getElementById('pk-nudge-note').textContent.indexOf('Reminded 3 members, 3 by email') !== -1", timeout=5000)
    assert [(c["dry"], c["email"]) for c in page.mock_state["nudge_calls"][2:]] == [(False, True), (False, True)]
    assert overflow_width(page) <= 0
    assert page.errors == [], diagnostics(page)


def test_the_worker_reminds_each_member_without_a_passkey_once():
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path
    if shutil.which("node") is None:
        import pytest
        pytest.skip("node is not installed here")
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (root / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(
            ["node", str(root / "tests" / "passkey_nudge_check.mjs")],
            env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
            capture_output=True, text=True, timeout=120,
        )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 8


def test_code_emails_come_with_a_check_junk_hint():
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    for name in ("signin.html", "my-builds.html", "js/interview-gate.js"):
        source = (root / name).read_text(encoding="utf-8")
        assert "<strong>Junk</strong>" in source and "Not junk" in source, name + " should say to check the Junk folder"



@all_devices
def test_passkey_offered_from_the_email_box(device_page):
    """Tapping the sign-in email box offers the passkey (the iPhone keyboard's
    Passwords key); picking it signs the member in."""
    page = device_page
    page.add_init_script(FAKE_AUTHENTICATOR + " localStorage.setItem('pkAutofill', '1');")
    page.goto("/signin.html")
    assert page.locator("#si-signin-email").get_attribute("autocomplete") == "username webauthn"
    page.wait_for_function("typeof window.__pkPick === 'function'", timeout=5000)
    page.evaluate("window.__pkPick()")
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    assert page.evaluate("localStorage.getItem('mt3ukMyBuildsSession')") == "s1.passkey"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_passkey_button_still_works_alongside_the_email_box_offer(device_page):
    page = device_page
    page.add_init_script(FAKE_AUTHENTICATOR + " localStorage.setItem('pkAutofill', '1');")
    page.goto("/signin.html")
    page.wait_for_function("typeof window.__pkPick === 'function'", timeout=5000)
    page.click("#si-passkey-btn")
    page.locator("#si-signed-in").wait_for(state="visible", timeout=5000)
    assert page.evaluate("window.__pkAborted") is True, "The background request is cancelled first"
    assert page.errors == [], diagnostics(page)


@all_devices
def test_my_garage_offers_the_passkey_from_the_email_box(device_page):
    page = device_page
    page.add_init_script(FAKE_AUTHENTICATOR + " localStorage.setItem('pkAutofill', '1');")
    page.goto("/my-builds.html")
    page.wait_for_function("typeof window.__pkPick === 'function'", timeout=5000)
    page.evaluate("window.__pkPick()")
    page.locator("#mb-app-view").wait_for(state="visible", timeout=5000)
    assert page.errors == [], diagnostics(page)


def test_iphone_keyboard_hints_on_email_and_nickname_boxes():
    """Nickname boxes don't invite address autofill (autocomplete="nickname"
    made iPhones offer Home and Work addresses); sign-in email boxes offer
    passkeys; the join boxes stay plain email."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    sources = {name: (root / name).read_text(encoding="utf-8") for name in ("signin.html", "my-builds.html", "profile.html", "js/account-bar.js")}
    everything = "".join(sources.values())
    assert 'autocomplete="nickname"' not in everything
    for nick_id in ("pf-nickname", "mt3uk-nick-input"):
        tag = re.search(r'<input[^>]*id="%s"[^>]*>' % nick_id, everything).group(0)
        assert 'autocomplete="off"' in tag and 'autocorrect="off"' in tag, nick_id
    for email_id in ("si-signin-email", "si-code-email", "mb-email"):
        tag = re.search(r'<input[^>]*id="%s"[^>]*>' % email_id, everything).group(0)
        assert 'autocomplete="username webauthn"' in tag, email_id
    for email_id in ("si-join-email", "mb-submit-email"):
        tag = re.search(r'<input[^>]*id="%s"[^>]*>' % email_id, everything).group(0)
        assert 'autocomplete="email"' in tag, email_id
