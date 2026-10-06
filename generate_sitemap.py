#!/usr/bin/env python3
"""
Generate sitemap.xml for MT3UK
Scans images directory and creates a sitemap with all images and pages
Run this before pushing to git: python generate_sitemap.py
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from r2_client import PUBLIC_BASE_URL, get_client, list_objects

# Configuration
DOMAIN = "https://mt3uk.com"
OUTPUT_FILE = "sitemap.xml"
LOCAL_IMAGE_DIRS = ["images/site"]
# R2 images sit on another host, and a sitemap <loc> must be on the site's own
# host ("URL not allowed" in Search Console). So they are listed as
# <image:image> entries under the page that shows them instead.
R2_PREFIXES = {"gallery/": "gallery.html", "track-days/": "track-day-prep.html"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
PAGES = ["index.html", "shop.html", "reviews.html", "contact.html", "signin.html", "privacy.html", "track-day-prep.html", "gallery.html", "blog.html", "blog-richard.html", "blog-john.html", "blog-kam.html", "blog-yusuf.html", "blog-ryan.html", "blog-sharad.html", "blog-romil.html", "blog-unicorn.html", "blog-john-track-day.html", "blog-sue.html", "blog-james.html"]

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
    """Scan the local site-image directory and the R2 bucket. Returns
    (local image URLs, {page: [R2 image URLs]})."""
    images = []
    page_images = {}

    for img_dir in LOCAL_IMAGE_DIRS:
        if not os.path.exists(img_dir):
            continue

        for root, dirs, files in os.walk(img_dir):
            for file in files:
                if Path(file).suffix.lower() in ALLOWED_EXTENSIONS:
                    # Create URL path
                    file_path = os.path.join(root, file)
                    url_path = quote(file_path.replace("\\", "/"))  # Windows compatibility + URL-encode
                    images.append(f"{DOMAIN}/{url_path}")

    client = get_client()
    hidden = hidden_gallery_files()
    for prefix, page in R2_PREFIXES.items():
        for obj in list_objects(client, prefix):
            key = obj["Key"]
            if prefix == "gallery/" and key[len(prefix):] in hidden:
                continue
            if Path(key).suffix.lower() in ALLOWED_EXTENSIONS:
                page_images.setdefault(page, []).append(f"{PUBLIC_BASE_URL}/{quote(key)}")

    return sorted(images), {k: sorted(v) for k, v in page_images.items()}

def generate_sitemap():
    """Generate sitemap.xml with homepage and all images"""
    
    images, page_images = get_all_images()
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
    for page in PAGES:
        if page == "index.html":
            continue
        xml_lines.extend([
            '  <url>',
            f'    <loc>{DOMAIN}/{page}</loc>',
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
    
    # Add each image
    for img_url in images:
        xml_lines.extend([
            '  <url>',
            f'    <loc>{img_url}</loc>',
            f'    <lastmod>{current_date}</lastmod>',
            '    <changefreq>monthly</changefreq>',
            '    <priority>0.7</priority>',
            '    <image:image>',
            f'      <image:loc>{img_url}</image:loc>',
            '    </image:image>',
            '  </url>',
        ])
    
    # Close XML
    xml_lines.append('</urlset>')
    
    # Write to file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(xml_lines))
    
    print(f"Sitemap generated: {OUTPUT_FILE}")
    print(f"   Pages: {len(PAGES)} entries")
    print(f"   Images: {len(images)} entries")
    print(f"   Gallery images on pages: {sum(len(v) for v in page_images.values())}")
    print(f"   Total URLs: {len(images) + len(PAGES)}")

if __name__ == "__main__":
    generate_laps_sitemap()
    generate_sitemap()