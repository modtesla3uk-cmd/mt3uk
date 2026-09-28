#!/usr/bin/env python3
"""
Copies the shared header (menu and search) and footer into every public page.

The site is plain HTML with no build step, so each page carries its own copy
of the header and footer. This script keeps them identical:

  - partials/header.html  the header, menu and search box
  - partials/footer.html  the footer
  - css/site-header.css   the header and menu styles, linked from every page

Edit those files, then run:

    python scripts/build_layout.py          # update every page
    python scripts/build_layout.py --check  # only report pages that are out of date

For each page it also marks that page's menu link as active, and turns links
to the page's own sections into same-page links (index.html#events becomes
#events on the homepage). tests/test_layout.py fails if any page has drifted
from the shared files, so run this after any menu or footer change.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEADER = ROOT / "partials" / "header.html"
FOOTER = ROOT / "partials" / "footer.html"
STYLESHEET = '<link rel="stylesheet" href="css/site-header.css">'

# Every public page, and the menu link shown as active on it.
PAGES = {
    "index": "index.html#about",
    "gallery": "gallery.html",
    "my-builds": "my-builds.html",
    "signin": "signin.html",
    "shop": "shop.html",
    "reviews": "reviews.html",
    "contact": "contact.html",
    "track-day-on-the-day": "index.html#track-days",
    "track-day-prep": "index.html#track-days",
    "track-day-venues": "index.html#track-days",
    "blog": "blog.html",
    "blog-aaron": "blog.html",
    "blog-john": "blog.html",
    "blog-kam": "blog.html",
    "blog-yusuf": "blog.html",
    "blog-ryan": "blog.html",
    "blog-mark": "blog.html",
    "blog-myk-track-day": "blog.html",
    "blog-myk": "blog.html",
    "blog-richard": "blog.html",
    "blog-richie": "blog.html",
}


def partial(path):
    """The partial without its leading editing note."""
    text = path.read_text(encoding="utf-8")
    return re.sub(r"\A<!--.*?-->\n", "", text, flags=re.S).rstrip("\n")


def render_header(page):
    html = partial(HEADER)
    active = PAGES[page]
    html = re.sub(
        r'(<a href="' + re.escape(active) + r'" class=")([^"]*)(")',
        lambda m: m.group(1) + m.group(2) + " active" + m.group(3),
        html,
    )
    # Links to this page's own sections stay on the page.
    html = html.replace('href="' + page + '.html#', 'href="#')
    return html


def render_footer(page):
    return partial(FOOTER)


def build(page):
    """The page's HTML with the shared header, footer and stylesheet."""
    path = ROOT / (page + ".html")
    original = path.read_text(encoding="utf-8")
    html = re.sub(r"<header>.*?</header>", lambda m: render_header(page), original, count=1, flags=re.S)
    html = re.sub(r"<footer>.*?</footer>", lambda m: render_footer(page), html, count=1, flags=re.S)
    if STYLESHEET not in html:
        html = html.replace("<style>", STYLESHEET + "\n<style>", 1)
    return original, html


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    for page in PAGES:
        original, html = build(page)
        if html != original:
            stale.append(page)
            if not check:
                (ROOT / (page + ".html")).write_text(html, encoding="utf-8")
    if check:
        if stale:
            print("Out of date: " + ", ".join(stale) + ". Run: python scripts/build_layout.py")
            sys.exit(1)
        print("All %d pages match the shared header and footer." % len(PAGES))
    else:
        print("Updated %d of %d pages." % (len(stale), len(PAGES)))


if __name__ == "__main__":
    main()
