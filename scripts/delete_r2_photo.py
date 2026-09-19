#!/usr/bin/env python3
"""
Deletes a single photo (and its optional '<file>.json' sidecar) from the
mt3uk-gallery R2 bucket, for use by the "Delete Photo" GitHub Actions
workflow. The manifest rebuild step that runs after this in that workflow
picks up the deletion automatically, since the manifest builders always
regenerate from a fresh R2 listing.

Requires R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env vars, plus
PHOTO_PREFIX ("gallery/" or "track-days/") and PHOTO_FILENAME.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from r2_client import BUCKET, get_client


def main():
    prefix = os.environ["PHOTO_PREFIX"]
    filename = os.environ["PHOTO_FILENAME"].strip()
    if not filename or "/" in filename:
        print(f"Invalid filename: {filename!r}", file=sys.stderr)
        sys.exit(1)

    key = prefix + filename
    client = get_client()

    try:
        client.head_object(Bucket=BUCKET, Key=key)
    except client.exceptions.ClientError:
        print(f"No such object: {key}", file=sys.stderr)
        sys.exit(1)

    client.delete_object(Bucket=BUCKET, Key=key)
    print(f"Deleted {key}")

    sidecar_key = key + ".json"
    try:
        client.head_object(Bucket=BUCKET, Key=sidecar_key)
    except client.exceptions.ClientError:
        return
    client.delete_object(Bucket=BUCKET, Key=sidecar_key)
    print(f"Deleted {sidecar_key}")


if __name__ == "__main__":
    main()
