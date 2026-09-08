#!/usr/bin/env python3
"""
Downscales and re-compresses any oversized photo in images/gallery/ and
images/track-days/ so submissions from the upload form (often full-res
phone photos, several MB each) don't bloat the repo or slow the site down.

Only touches files above MAX_DIMENSION or MAX_BYTES, so already-optimized
images pass through untouched on later runs instead of being re-encoded
(and re-degraded) every time this script runs.

Runs automatically in GitHub Actions on every push to either folder —
nobody needs to run it by hand.
"""
import io
from pathlib import Path

from PIL import Image, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent
TARGET_DIRS = [REPO_ROOT / "images" / "gallery", REPO_ROOT / "images" / "track-days"]
VALID_EXT = {".jpg", ".jpeg", ".png", ".webp"}

MAX_DIMENSION = 2000  # px, longest side
MAX_BYTES = 500_000  # only consider recompressing files above this size
JPEG_QUALITY = 82


def recompress(path: Path) -> bytes:
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

        suffix = path.suffix.lower()
        buf = io.BytesIO()
        if suffix in (".jpg", ".jpeg"):
            img.convert("RGB").save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
        elif suffix == ".png":
            img.save(buf, "PNG", optimize=True)
        elif suffix == ".webp":
            img.save(buf, "WEBP", quality=JPEG_QUALITY)
        return buf.getvalue()


def main():
    for target_dir in TARGET_DIRS:
        if not target_dir.exists():
            continue
        for path in sorted(target_dir.iterdir()):
            if not path.is_file() or path.suffix.lower() not in VALID_EXT:
                continue
            before = path.stat().st_size
            if before <= MAX_BYTES:
                continue
            data = recompress(path)
            if len(data) >= before:
                continue  # recompression didn't help, keep the original
            path.write_bytes(data)
            print(f"Compressed {path.relative_to(REPO_ROOT)}: {before:,} -> {len(data):,} bytes")


if __name__ == "__main__":
    main()
