#!/usr/bin/env python3
"""
Downscales and re-compresses any oversized photo in the gallery/ and
track-days/ prefixes of the mt3uk-gallery R2 bucket, so submissions from
the upload form (often full-res phone photos, several MB each) don't
bloat storage or slow the site down. Photographic PNGs (no real
transparency) are converted to JPEG, since PNG's lossless compression
barely shrinks a photo.

Only touches objects above MAX_DIMENSION or MAX_BYTES, so already-
optimized images pass through untouched on later runs instead of being
re-encoded (and re-degraded) every time this script runs.

Runs automatically in GitHub Actions whenever a new photo is submitted
(triggered by the vote worker's repository_dispatch). Requires
R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env vars.
"""
import io
import sys
from pathlib import Path

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
from r2_client import BUCKET, get_client, list_objects

PREFIXES = ["gallery/", "track-days/"]
VALID_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_DIMENSION = 2000  # px, longest side
MAX_BYTES = 500_000  # only consider recompressing objects above this size
JPEG_QUALITY = 82

CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def has_transparency(img: Image.Image) -> bool:
    if img.mode not in ("RGBA", "LA", "P"):
        return False
    rgba = img.convert("RGBA")
    return rgba.getchannel("A").getextrema()[0] < 255


def recompress(data: bytes, suffix: str):
    """Returns (new_suffix, bytes) for the recompressed image."""
    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

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
    client = get_client()
    for prefix in PREFIXES:
        for obj in list_objects(client, prefix):
            key = obj["Key"]
            path = Path(key)
            if path.suffix.lower() not in VALID_EXT:
                continue
            before = obj["Size"]
            if before <= MAX_BYTES:
                continue

            body = client.get_object(Bucket=BUCKET, Key=key)["Body"].read()
            new_suffix, data = recompress(body, path.suffix.lower())
            # skip if the format didn't change and the saving is marginal,
            # so an already-optimized image (e.g. one already at the
            # dimension cap) doesn't get generationally re-encoded on
            # every future run for a handful of bytes
            if new_suffix == path.suffix.lower() and len(data) >= before * 0.95:
                continue

            new_key = key if new_suffix == path.suffix.lower() else str(path.with_suffix(new_suffix)).replace("\\", "/")
            client.put_object(Bucket=BUCKET, Key=new_key, Body=data, ContentType=CONTENT_TYPES[new_suffix])
            if new_key != key:
                client.delete_object(Bucket=BUCKET, Key=key)
                sidecar_key = key + ".json"
                try:
                    sidecar = client.get_object(Bucket=BUCKET, Key=sidecar_key)["Body"].read()
                    client.put_object(Bucket=BUCKET, Key=new_key + ".json", Body=sidecar, ContentType="application/json")
                    client.delete_object(Bucket=BUCKET, Key=sidecar_key)
                except client.exceptions.NoSuchKey:
                    pass

            print(f"Compressed {key}: {before:,} -> {len(data):,} bytes"
                  + (f" (renamed to {new_key})" if new_key != key else ""))


if __name__ == "__main__":
    main()
