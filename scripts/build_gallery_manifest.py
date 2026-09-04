#!/usr/bin/env python3
"""
Scans images/gallery/ and writes images/gallery/manifest.json listing every
photo found there, with a caption auto-generated from the filename.

Naming convention for photos dropped into images/gallery/:
  01-model-3-widebody.jpg
  ^^ optional numeric prefix controls display order (lowest first).
     Files without a numeric prefix are sorted alphabetically after
     any numbered ones.
  the rest of the filename becomes the caption, e.g.
  "model-3-widebody" -> "MODEL 3 · WIDEBODY" (first hyphen-group swap is
  cosmetic; every hyphen becomes a space, dots are treated as separators)

This runs automatically in GitHub Actions on every push — nobody needs to
run it by hand.
"""
import json
import re
from pathlib import Path

GALLERY_DIR = Path(__file__).resolve().parent.parent / "images" / "gallery"
MANIFEST_PATH = GALLERY_DIR / "manifest.json"
VALID_EXT = {".jpg", ".jpeg", ".png", ".webp"}

def caption_from_filename(stem: str) -> str:
    # strip a leading "NN-" or "NN_" ordering prefix
    stem = re.sub(r"^\d+[-_]", "", stem)
    # split on hyphens/underscores, uppercase each word
    words = re.split(r"[-_]+", stem)
    return " ".join(w.upper() for w in words if w)

def sort_key(path: Path):
    m = re.match(r"^(\d+)[-_]", path.stem)
    if m:
        return (0, int(m.group(1)), path.name.lower())
    return (1, 0, path.name.lower())

def main():
    GALLERY_DIR.mkdir(parents=True, exist_ok=True)
    photos = [
        p for p in GALLERY_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in VALID_EXT
    ]
    photos.sort(key=sort_key)

    manifest = [
        {
            "file": p.name,
            "caption": caption_from_filename(p.stem),
        }
        for p in photos
    ]

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {MANIFEST_PATH} with {len(manifest)} photo(s).")

if __name__ == "__main__":
    main()
