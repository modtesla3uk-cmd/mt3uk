"""The worker's event page routes (workers/vote-worker.js): saving and cleaning
an event, publish state changes, the admin-only preview links and image
uploads. The real handlers run in node against a fake KV store, image bucket
and GitHub, because the browser tests use a mock of the worker."""
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_event_page_worker_routes():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        # The email module only exists on Cloudflare.
        module.write_text(source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage {}", 1), encoding="utf-8")
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "event_worker_check.mjs")],
            env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin"},
            capture_output=True, text=True, timeout=60,
        )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 25
