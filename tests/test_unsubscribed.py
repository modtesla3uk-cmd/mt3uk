"""A member who is unsubscribed (removed by MT3UK, or who leaves) is signed out and emailed a link to subscribe
again, as MT3UK or as Laps by MT3UK. The worker runs in node (tests/unsubscribed_check.mjs)."""
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_an_unsubscribed_member_is_signed_out_and_emailed_a_way_back():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        source += "\nexport { createSession };\n"
        module.write_text(source, encoding="utf-8")
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "unsubscribed_check.mjs")],
            env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
            capture_output=True, text=True, timeout=120,
        )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 10
