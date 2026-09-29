"""The enlarged photo in the weekly vote (homepage lightbox) fits short
screens: the photo shrinks so the caption, a long mods list and the Vote
button all stay on screen without overlapping."""
import pytest
from test_devices import device_page, browsers, all_devices, diagnostics  # noqa: F401

LONG_MODS = "Mods: " + " · ".join([
    "KW V3 coilovers", "Hidden Forest wrap", "BC forged wheels", "Carbon lip", "Tinted windows", "Ceramic coat",
    "Unplugged spoiler", "Ambient lights", "Brake upgrade", "Front splitter", "Side skirts", "Rear diffuser"])


@pytest.mark.parametrize("size", [(360, 640), (390, 844), (740, 360), (1280, 800)], ids=["small-phone", "phone", "landscape", "desktop"])
@all_devices
def test_vote_button_clear_of_mods_on_every_screen(device_page, size):
    page = device_page
    page.set_viewport_size({"width": size[0], "height": size[1]})
    page.add_init_script("sessionStorage.setItem('mt3ukIntroSeen', '1')")
    page.goto("/index.html")
    media = page.locator(".vote-media").first
    media.wait_for(timeout=8000)
    media.scroll_into_view_if_needed()
    media.click()
    page.locator(".lightbox.open").wait_for(timeout=5000)
    # A real photo (the test can't reach the photo store) and a long mods list.
    page.evaluate("""t => { const m = document.querySelector('.lightbox-mods'); m.textContent = t; m.classList.add('has-mods');
      document.querySelector('.lightbox-img').src = '/images/blog/owner-interviews/aaron/front-splitter.jpg'; }""", LONG_MODS)
    page.wait_for_function("document.querySelector('.lightbox-img').naturalWidth > 0", timeout=5000)
    page.wait_for_timeout(200)
    r = page.evaluate("""() => { const b = s => document.querySelector(s).getBoundingClientRect();
      const m = b('.lightbox-mods'), v = b('.lightbox-vote-btn'), i = b('.lightbox-img'), c = b('.lightbox-close');
      return { modsBottom: m.bottom, voteTop: v.top, voteBottom: v.bottom, imgTop: i.top, imgBottom: i.bottom, closeBottom: c.bottom, vh: innerHeight }; }""")
    assert r["modsBottom"] <= r["voteTop"], r
    assert r["voteBottom"] <= r["vh"], ("Vote button on screen", r)
    assert r["imgTop"] >= 0 and r["imgTop"] >= r["closeBottom"] - 1, ("Photo below the close button", r)
    assert r["imgBottom"] - r["imgTop"] > 80, ("Photo still a decent size", r)
    assert page.errors == [], diagnostics(page)
