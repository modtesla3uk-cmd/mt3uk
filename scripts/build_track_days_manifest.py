#!/usr/bin/env python3
"""
Scans images/track-days/ and writes images/track-days/manifest.json listing
every photo found there, with a caption auto-generated from the filename.

Photos are ordered most-recently-added first, using each file's earliest
git commit date (the commit that added it) as the "added" timestamp. Files
added in the same commit are tie-broken by an optional numeric filename
prefix, then alphabetically:
  01-snetterton-track.jpg
  ^^ optional numeric prefix controls tie-break order (lowest first).
  the rest of the filename becomes the caption, e.g.
  "snetterton-track" -> "SNETTERTON TRACK" (hyphens/underscores become
  spaces).

This runs automatically in GitHub Actions on every push — nobody needs to
run it by hand. Requires full git history (fetch-depth: 0) to correctly
date files; falls back to treating undated files as oldest.
"""
import json
import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TRACK_DAYS_DIR = REPO_ROOT / "images" / "track-days"
MANIFEST_PATH = TRACK_DAYS_DIR / "manifest.json"
VALID_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def caption_from_filename(stem: str) -> str:
    stem = re.sub(r"^\d+[-_]", "", stem)
    # strip a trailing long digit run (a uniqueness timestamp), without
    # touching short numbers that are part of a real caption.
    stem = re.sub(r"[-_]\d{8,}$", "", stem)
    words = re.split(r"[-_]+", stem)
    return " ".join(w.upper() for w in words if w)


def manual_order_key(path: Path):
    m = re.match(r"^(\d+)[-_]", path.stem)
    if m:
        return (0, int(m.group(1)), path.name.lower())
    return (1, 0, path.name.lower())


def added_timestamp(path: Path) -> int:
    rel = path.relative_to(REPO_ROOT).as_posix()
    try:
        result = subprocess.run(
            ["git", "log", "--diff-filter=A", "--follow", "--format=%ct", "--", rel],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        )
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        if lines:
            return int(lines[-1])
    except (subprocess.CalledProcessError, ValueError):
        pass
    return 0


def main():
    TRACK_DAYS_DIR.mkdir(parents=True, exist_ok=True)
    photos = [
        p for p in TRACK_DAYS_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in VALID_EXT
    ]

    entries = [
        {
            "path": p,
            "added_ts": added_timestamp(p),
            "manual_key": manual_order_key(p),
        }
        for p in photos
    ]
    entries.sort(key=lambda e: (-e["added_ts"], e["manual_key"]))

    manifest = [
        {
            "file": e["path"].name,
            "caption": caption_from_filename(e["path"].stem),
        }
        for e in entries
    ]

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {MANIFEST_PATH} with {len(manifest)} photo(s).")


if __name__ == "__main__":
    main()
