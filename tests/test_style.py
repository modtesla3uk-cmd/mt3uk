"""The shared look: soft corners, IBM Plex Sans in normal capitals and one
line icon set. Pages move onto it a batch at a time, so the pages listed in
REFRESHED must not bring back the typewriter font (IBM Plex Mono)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFRESHED = ["my-builds.html"]


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def test_shared_styles_define_the_tokens_and_classes():
    css = read("css/site-header.css")
    for token in ("--radius: 10px", "--radius-sm: 8px", "--radius-pill: 999px", ".btn-primary", ".btn-secondary", ".btn-danger", ".field", ".chip", ".icon"):
        assert token in css, token
    assert "IBM Plex Mono" not in css


def test_header_and_footer_use_icons_not_text_characters():
    header = read("partials/header.html")
    footer = read("partials/footer.html")
    for glyph in ("&#9660;", "▼", "&times;", "&#8599;"):
        assert glyph not in header, glyph
        assert glyph not in footer, glyph
    assert 'class="icon"' in header
    assert "class=\"mono\"" not in footer


def test_refreshed_pages_do_not_use_the_typewriter_font():
    for name in REFRESHED:
        html = read(name)
        assert "IBM Plex Mono" not in html, name
        assert "IBM+Plex+Mono" not in html, name
        for glyph in ("&#9662;", "&lsaquo;", "&rsaquo;", "&larr;"):
            assert glyph not in html, (name, glyph)
