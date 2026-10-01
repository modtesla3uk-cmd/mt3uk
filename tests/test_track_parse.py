"""The track session reader (js/track-parse.js) in node: a trimmed real RaceBox
file from Thruxton (tests/fixtures/thruxton-trimmed.vbo), the same data as CSV
and GPX, an unknown track, and made-up drag runs."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_track_reader():
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "track_parse_check.mjs")],
        env={"PATH": "/usr/bin:/usr/local/bin:/bin", "TZ": "UTC"},
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0 and "FAIL" not in result.stdout, result.stdout + result.stderr
    assert result.stdout.count("ok ") >= 35
