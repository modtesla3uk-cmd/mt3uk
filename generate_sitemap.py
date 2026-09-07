#!/usr/bin/env python3
"""
Generate sitemap.xml for MT3UK
Scans images directory and creates a sitemap with all images and pages
Run this before pushing to git: python generate_sitemap.py
"""

import os
from datetime import datetime
from pathlib import Path

# Configuration
DOMAIN = "https://mt3uk.com"
OUTPUT_FILE = "sitemap.xml"
IMAGE_DIRS = ["images/gallery", "images/track-days", "images/site"]
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

def get_all_images():
    """Scan image directories and return list of image URLs"""
    images = []
    
    for img_dir in IMAGE_DIRS:
        if not os.path.exists(img_dir):
            continue
            
        for root, dirs, files in os.walk(img_dir):
            for file in files:
                if Path(file).suffix.lower() in ALLOWED_EXTENSIONS:
                    # Create URL path
                    file_path = os.path.join(root, file)
                    url_path = file_path.replace("\\", "/")  # Windows compatibility
                    images.append(f"{DOMAIN}/{url_path}")
    
    return sorted(images)

def generate_sitemap():
    """Generate sitemap.xml with homepage and all images"""
    
    images = get_all_images()
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
    
    print(f"✅ Sitemap generated: {OUTPUT_FILE}")
    print(f"   Homepage: 1 entry")
    print(f"   Images: {len(images)} entries")
    print(f"   Total URLs: {len(images) + 1}")

if __name__ == "__main__":
    generate_sitemap()