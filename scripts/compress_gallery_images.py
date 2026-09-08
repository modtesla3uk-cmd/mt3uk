#!/usr/bin/env python3
"""
Downscales and re-compresses any oversized photo in images/gallery/ and
images/track-days/ so submissions from the upload form (often full-res
phone photos, several MB each) don't bloat the repo or slow the site down.
Photographic PNGs (no real transparency) are converted to JPEG, since PNG's
lossless compression barely shrinks a photo.

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


def has_transparency(img: Image.Image) -> bool:
    if img.mode not in ("RGBA", "LA", "P"):
        return False
    rgba = img.convert("RGBA")
    return rgba.getchannel("A").getextrema()[0] < 255


def recompress(path: Path):
    """Returns (new_suffix, bytes) for the recompressed image."""
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

        suffix = path.suffix.lower()
        if suffix == ".png" and not has_transparency(img):
            suffix = ".jpg"

        buf = io.BytesIO()
        if suffix in (".jpg", ".jpeg"):
            img.convert("RGB").save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
        elif suffix == ".png":
            img.save(buf, "PNG", optimize=True)
        elif suffix == ".webp":
            img.save(buf, "WEBP", quality=JPEG_QUALITY)
        return suffix, buf.getvalue()


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
            new_suffix, data = recompress(path)
            if new_suffix == path.suffix.lower() and len(data) >= before:
                continue  # recompression didn't help, keep the original

            new_path = path.with_suffix(new_suffix)
            new_path.write_bytes(data)
            if new_path != path:
                path.unlink()
            print(f"Compressed {path.relative_to(REPO_ROOT)}: {before:,} -> {len(data):,} bytes"
                  + (f" (renamed to {new_path.name})" if new_path != path else ""))


if __name__ == "__main__":
    main()
