#!/usr/bin/env python3
"""
Lists the track-days/ prefix in the mt3uk-gallery R2 bucket and writes
images/track-days/manifest.json listing every photo found there, with a
caption auto-generated from the filename.

Photos are ordered most-recently-uploaded first, using each object's R2
upload timestamp. Files uploaded in the same batch are tie-broken by an
optional numeric filename prefix, then alphabetically:
  01-snetterton-track.jpg
  ^^ optional numeric prefix controls tie-break order (lowest first).
  the rest of the filename becomes the caption, e.g.
  "snetterton-track" -> "SNETTERTON TRACK" (hyphens/underscores become
  spaces).

This runs automatically in GitHub Actions on every push — nobody needs to
run it by hand. Requires R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env vars.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from r2_client import PUBLIC_BASE_URL, get_client, list_objects

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "images" / "track-days" / "manifest.json"
PREFIX = "track-days/"
VALID_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def caption_from_filename(stem: str) -> str:
    stem = re.sub(r"^\d+[-_]", "", stem)
    # strip a trailing long digit run (a uniqueness timestamp), without
    # touching short numbers that are part of a real caption.
    stem = re.sub(r"[-_]\d{8,}$", "", stem)
    words = re.split(r"[-_]+", stem)
    return " ".join(w.upper() for w in words if w)


def manual_order_key(name: str):
    m = re.match(r"^(\d+)[-_]", name)
    if m:
        return (0, int(m.group(1)), name.lower())
    return (1, 0, name.lower())


def main():
    client = get_client()
    objects = [
        obj for obj in list_objects(client, PREFIX)
        if Path(obj["Key"]).suffix.lower() in VALID_EXT
    ]
    objects.sort(key=lambda o: (-o["LastModified"].timestamp(), manual_order_key(Path(o["Key"]).name)))

    manifest = [
        {
            "file": Path(obj["Key"]).name,
            "caption": caption_from_filename(Path(obj["Key"]).stem),
        }
        for obj in objects
    ]

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {MANIFEST_PATH} with {len(manifest)} photo(s), served from {PUBLIC_BASE_URL}/{PREFIX}")


if __name__ == "__main__":
    main()
