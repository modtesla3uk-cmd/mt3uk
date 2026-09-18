#!/usr/bin/env python3
"""
Lists the gallery/ prefix in the mt3uk-gallery R2 bucket and writes
images/gallery/manifest.json listing every photo found there, with a
caption auto-generated from the filename.

Photos are ordered most-recently-uploaded first, using each object's R2
upload timestamp. Files uploaded in the same batch (e.g. a migration) are
tie-broken by an optional numeric filename prefix, then alphabetically:
  01-model-3-widebody.jpg
  ^^ optional numeric prefix controls tie-break order (lowest first).
  the rest of the filename becomes the caption, e.g.
  "model-3-widebody" -> "MODEL 3 WIDEBODY" (hyphens/underscores become
  spaces).

This runs automatically in GitHub Actions on every push — nobody needs to
run it by hand. Requires R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env vars.
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from r2_client import BUCKET, PUBLIC_BASE_URL, get_client, list_objects

UK_TZ = ZoneInfo("Europe/London")

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "images" / "gallery" / "manifest.json"
PREFIX = "gallery/"
VALID_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def caption_from_filename(stem: str) -> str:
    stem = re.sub(r"^\d+[-_]", "", stem)
    # strip a trailing long digit run (the uniqueness timestamp the
    # submission form appends), without touching short numbers that are
    # part of a real caption, e.g. "model-3" or "911-killer".
    stem = re.sub(r"[-_]\d{8,}$", "", stem)
    words = re.split(r"[-_]+", stem)
    # a submitter who left the caption blank ends up with a filename that's
    # nothing but a long digit run (e.g. a camera/phone timestamp) once the
    # prefix/suffix above are stripped; that's not a real caption either.
    if all(not w or (w.isdigit() and len(w) >= 8) for w in words):
        return ""
    return " ".join(w.upper() for w in words if w)


NAME_SUFFIX_RE = re.compile(r"--by-([a-z0-9-]+)$")


def split_submitter_name(stem: str):
    """Pulls the '--by-<name-slug>' suffix the submission worker appends
    when a submitter gives their name, returning (remaining_stem, name)."""
    m = NAME_SUFFIX_RE.search(stem)
    if not m:
        return stem, None
    name_slug = m.group(1)
    # a filename collision suffix (e.g. "-2") lands after the name slug;
    # strip it so it doesn't leak into the displayed name.
    name_slug = re.sub(r"-\d+$", "", name_slug)
    words = re.split(r"[-_]+", name_slug)
    name = " ".join(w.upper() for w in words if w)
    return stem[: m.start()], name or None


def manual_order_key(name: str):
    m = re.match(r"^(\d+)[-_]", name)
    if m:
        return (0, int(m.group(1)), name.lower())
    return (1, 0, name.lower())


def mods_from_sidecar(client, key: str, sidecar_keys: set):
    """Reads the optional '<key>.json' sidecar the submission worker
    uploads alongside a photo when a submitter lists mods, since the
    manifest itself is rebuilt from scratch from the bucket listing on
    every run."""
    sidecar_key = key + ".json"
    if sidecar_key not in sidecar_keys:
        return []
    try:
        obj = client.get_object(Bucket=BUCKET, Key=sidecar_key)
        data = json.loads(obj["Body"].read())
    except Exception:
        return []
    mods = data.get("mods")
    if not isinstance(mods, list):
        return []
    return [str(m).strip() for m in mods if str(m).strip()][:50]


def main():
    client = get_client()
    all_objects = list(list_objects(client, PREFIX))
    sidecar_keys = {obj["Key"] for obj in all_objects if obj["Key"].endswith(".json")}
    photos = [
        obj for obj in all_objects
        if Path(obj["Key"]).suffix.lower() in VALID_EXT
    ]
    photos.sort(key=lambda o: (-o["LastModified"].timestamp(), manual_order_key(Path(o["Key"]).name)))

    manifest = []
    for obj in photos:
        key = obj["Key"]
        filename = Path(key).name
        stem, name = split_submitter_name(Path(key).stem)
        entry = {"file": filename}
        caption = caption_from_filename(stem)
        if caption:
            entry["caption"] = caption
        if name:
            entry["name"] = name
        mods = mods_from_sidecar(client, key, sidecar_keys)
        if mods:
            entry["mods"] = mods
        # UK-local date the photo was added, used by the site to feature
        # the latest upload and only swap it at UK midnight.
        entry["added"] = obj["LastModified"].astimezone(UK_TZ).date().isoformat()
        manifest.append(entry)

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {MANIFEST_PATH} with {len(manifest)} photo(s), served from {PUBLIC_BASE_URL}/{PREFIX}")


if __name__ == "__main__":
    main()
