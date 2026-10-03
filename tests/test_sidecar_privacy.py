"""Owner emails stay out of the public photo bucket (workers/vote-worker.js).
Each photo's sidecar (gallery/<photo>.json) and each car record is served
publicly, so the worker keeps the email in KV and the sidecar holds only the
one-way owner key. Runs the real functions in node with a fake bucket and KV,
plus a check that no sidecar is written any other way."""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WORKER = ROOT / "workers" / "vote-worker.js"

SCRIPT = r"""
const m = await import(process.env.WORKER_MODULE);
globalThis.fetch = async () => ({ ok: true, status: 204, json: async () => ({}) });
const bucket = new Map(), kv = new Map();
const env = {
  GALLERY_BUCKET: {
    async get(k) { return bucket.has(k) ? { json: async () => JSON.parse(bucket.get(k)) } : null; },
    async put(k, v) { bucket.set(k, typeof v === 'string' ? v : 'binary'); },
    async delete(k) { bucket.delete(k); },
    async list({ prefix, cursor, limit }) {
      const keys = [...bucket.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? parseInt(cursor, 10) : 0, end = start + (limit || 1000);
      return { objects: keys.slice(start, end).map(key => ({ key })), truncated: end < keys.length, cursor: String(end) };
    }
  },
  VOTES: {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); }
  }
};
const out = {};

// A new upload's sidecar.
await m.putSidecar(env, 'gallery/new.jpg.json', { email: 'New@Example.com', mods: ['Wheels'] });
out.newSidecar = JSON.parse(bucket.get('gallery/new.jpg.json'));
out.newKv = kv.get('photo-owner:new.jpg');
out.newOwnerKey = await m.ownerKey('new@example.com');
out.newOwnerEmail = await m.sidecarOwnerEmail(env, 'new.jpg', out.newSidecar);

// Older files still carrying emails, in more than one batch.
bucket.set('gallery/old.jpg', 'binary');
bucket.set('gallery/old.jpg.json', JSON.stringify({ email: 'old@example.com', carId: 'c1' }));
bucket.set('gallery/cars/c1.json', JSON.stringify({ id: 'c1', email: 'old@example.com', name: 'Old car', photos: ['old.jpg'] }));
for (let i = 0; i < 250; i++) bucket.set('gallery/pad' + String(i).padStart(3, '0') + '.jpg', 'binary');
out.legacyOwnerBefore = await m.sidecarOwnerEmail(env, 'old.jpg', JSON.parse(bucket.get('gallery/old.jpg.json')));
const runs = [];
for (let i = 0; i < 10; i++) { const r = await m.moveSidecarEmails(env); runs.push(r); if (r.done) break; }
out.runs = runs;
out.oldSidecar = JSON.parse(bucket.get('gallery/old.jpg.json'));
out.oldCar = JSON.parse(bucket.get('gallery/cars/c1.json'));
out.oldKv = kv.get('photo-owner:old.jpg');
out.legacyOwnerAfter = await m.sidecarOwnerEmail(env, 'old.jpg', out.oldSidecar);
out.again = await m.moveSidecarEmails(env);

// A new car record never keeps an email.
await m.saveCarRecord(env, { id: 'c2', email: 'x@example.com', name: 'New car' });
out.newCar = JSON.parse(bucket.get('gallery/cars/c2.json'));

// Unassigning clears the owner.
const sc = JSON.parse(bucket.get('gallery/new.jpg.json'));
await m.clearPhotoOwner(env, 'new.jpg', sc);
await m.putSidecar(env, 'gallery/new.jpg.json', sc);
out.cleared = JSON.parse(bucket.get('gallery/new.jpg.json'));
out.clearedKv = kv.has('photo-owner:new.jpg');
out.anyEmailInBucket = [...bucket.values()].some(v => v.includes('@example.com'));
console.log(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_emails_are_kept_out_of_the_photo_bucket():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = WORKER.read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        source += "\nexport { putSidecar, sidecarOwnerEmail, clearPhotoOwner, moveSidecarEmails, saveCarRecord, ownerKey };\n"
        module.write_text(source, encoding="utf-8")
        check = Path(tmp) / "check.mjs"
        check.write_text(SCRIPT, encoding="utf-8")
        result = subprocess.run(["node", str(check)], env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin"},
                                capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout.strip().splitlines()[-1])

    assert "email" not in out["newSidecar"]
    assert out["newSidecar"]["owner"] == out["newOwnerKey"]
    assert out["newKv"] == "new@example.com"
    assert out["newOwnerEmail"] == "new@example.com"

    assert out["legacyOwnerBefore"] == "old@example.com"
    assert len(out["runs"]) > 1 and out["runs"][-1]["done"] is True, out["runs"]
    assert sum(r["moved"] for r in out["runs"]) == 2
    assert "email" not in out["oldSidecar"] and out["oldSidecar"]["carId"] == "c1"
    assert "email" not in out["oldCar"] and out["oldCar"]["name"] == "Old car"
    assert out["oldKv"] == "old@example.com"
    assert out["legacyOwnerAfter"] == "old@example.com"
    assert out["again"] == {"done": True, "moved": 0}

    assert "email" not in out["newCar"]
    assert "owner" not in out["cleared"] and out["clearedKv"] is False
    assert out["anyEmailInBucket"] is False


def test_sidecars_are_only_written_through_put_sidecar():
    worker = WORKER.read_text(encoding="utf-8")
    body = worker.split("async function putSidecar", 1)[1].split("\n}\n", 1)[0]
    rest = worker.replace(body, "")
    writes = re.findall(r"GALLERY_BUCKET\.put\(([^,]+),", rest)
    # shareKey is a link preview picture under share/<slot>/, never a sidecar.
    allowed = {"msg.photo", "name", "carRecordKey(car.id)", "'gallery/' + filename", "shareKey"}
    assert set(w.strip() for w in writes) <= allowed, writes
    # The manifest builder groups by the owner key, never the email.
    script = (ROOT / "scripts" / "build_gallery_manifest.py").read_text(encoding="utf-8")
    assert '"e:" + email' not in script
