#!/usr/bin/env python3
"""
Generate sitemap.xml for MT3UK
Lists the pages (with the gallery and track day photos as image entries under their page)
Run this before pushing to git: python generate_sitemap.py
"""

import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from r2_client import PUBLIC_BASE_URL, get_client, list_objects

# Configuration
DOMAIN = "https://mt3uk.com"
OUTPUT_FILE = "sitemap.xml"
# R2 images sit on another host, and a sitemap <loc> must be on the site's own
# host ("URL not allowed" in Search Console). So they are listed as
# <image:image> entries under the page that shows them instead.
R2_PREFIXES = {"gallery/": "gallery.html", "track-days/": "track-day-prep.html"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
PAGES = ["index.html", "shop.html", "reviews.html", "contact.html", "privacy.html", "track-day-venues.html", "track-day-prep.html", "track-day-on-the-day.html", "gallery.html", "blog.html"]
# Sign in is left out (it carries noindex). Owner Interviews and event pages are added from their
# data files once their publish date (UK time) has come: before then they show only a gate card.
UK = ZoneInfo("Europe/London")

# The Laps pages (track sessions and the leaderboards) belong to laps.mt3uk.com, where their canonical
# address is, so they get their own sitemap there (robots.txt names both). Both addresses serve the same files.
LAPS_DOMAIN = "https://laps.mt3uk.com"
LAPS_OUTPUT_FILE = "sitemap-laps.xml"
LAPS_PAGES = ["laps.html", "track.html", "leaderboards.html"]


def generate_laps_sitemap():
    """Write sitemap-laps.xml: the Laps pages on laps.mt3uk.com, the front page first."""
    current_date = datetime.now().strftime("%Y-%m-%d")
    xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for i, page in enumerate(LAPS_PAGES):
        xml_lines.extend([
            '  <url>',
            f'    <loc>{LAPS_DOMAIN}/{page}</loc>',
            f'    <lastmod>{current_date}</lastmod>',
            '    <changefreq>daily</changefreq>',
            f'    <priority>{"1.0" if i == 0 else "0.9"}</priority>',
            '  </url>',
        ])
    xml_lines.append('</urlset>')
    with open(LAPS_OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(xml_lines))
    print(f"Sitemap generated: {LAPS_OUTPUT_FILE} ({len(LAPS_PAGES)} pages)")


def published_pages():
    """Owner Interviews and event pages whose publish date (UK time) has come. An interview is its own
    blog-<slug>.html page; every event is event.html?e=<slug> (drafts and unscheduled ones left out)."""
    today = datetime.now(UK).strftime("%Y-%m-%d")
    pages = []
    try:
        data = json.loads(Path("data/interviews.json").read_text(encoding="utf-8"))
        for e in data.get("interviews", []) if isinstance(data, dict) else data:
            url, publish = e.get("url") or "", e.get("publish") or ""
            if url.startswith("blog-") and url.endswith(".html") and publish and publish <= today and Path(url).exists():
                pages.append(url)
    except (OSError, ValueError):
        pass
    try:
        data = json.loads(Path("data/event-pages.json").read_text(encoding="utf-8"))
        for e in data.get("events", []) if isinstance(data, dict) else data:
            slug, publish = e.get("slug") or "", (e.get("publish") or "")[:10]
            if slug and not e.get("draft") and publish and publish <= today:
                pages.append("event.html?e=" + quote(slug))
    except (OSError, ValueError):
        pass
    return pages


def hidden_gallery_files():
    """Photos kept out of the Gallery (a car of another make kept in a member's garage, or a
    photo its owner or MT3UK switched off) are not listed for search engines. The manifest
    (scripts/build_gallery_manifest.py, run just before this in the sync workflow) has the flags."""
    try:
        photos = json.loads(Path("images/gallery/manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return {p.get("file") for p in photos if isinstance(p, dict) and p.get("gallery") is False}


def get_all_images():
    """Scan the R2 bucket. Returns {page: [R2 image URLs]}. Site images (logos, icons, shop
    pictures) are not listed: a sitemap is for pages, and Google finds them on the pages."""
    page_images = {}

    client = get_client()
    hidden = hidden_gallery_files()
    for prefix, page in R2_PREFIXES.items():
        for obj in list_objects(client, prefix):
            key = obj["Key"]
            if prefix == "gallery/" and key[len(prefix):] in hidden:
                continue
            if Path(key).suffix.lower() in ALLOWED_EXTENSIONS:
                page_images.setdefault(page, []).append(f"{PUBLIC_BASE_URL}/{quote(key)}")

    return {k: sorted(v) for k, v in page_images.items()}

def generate_sitemap():
    """Generate sitemap.xml: the homepage, the pages, and the published interviews and events"""

    page_images = get_all_images()
    pages = PAGES + published_pages()
    current_date = datetime.now().strftime("%Y-%m-%d")
    
    # Start XML
    xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
        '         xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ]
    
    # Add homepage (highest priority)
    xml_lines.extend([
        '  <url>',
        f'    <loc>{DOMAIN}/</loc>',
        f'    <lastmod>{current_date}</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>1.0</priority>',
        '  </url>',
    ])

    # Add other pages
    for page in pages:
        if page == "index.html":
            continue
        xml_lines.extend([
            '  <url>',
            f'    <loc>{DOMAIN}/{escape(page)}</loc>',
            f'    <lastmod>{current_date}</lastmod>',
            '    <changefreq>weekly</changefreq>',
            '    <priority>0.8</priority>',
        ])
        for img_url in page_images.get(page, []):
            xml_lines.extend([
                '    <image:image>',
                f'      <image:loc>{img_url}</image:loc>',
                '    </image:image>',
            ])
        xml_lines.append('  </url>')
    
    # Close XML
    xml_lines.append('</urlset>')
    
    # Write to file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(xml_lines))
    
    print(f"Sitemap generated: {OUTPUT_FILE}")
    print(f"   Pages: {len(pages)} entries")
    print(f"   Gallery images on pages: {sum(len(v) for v in page_images.values())}")

if __name__ == "__main__":
    generate_laps_sitemap()
    generate_sitemap()