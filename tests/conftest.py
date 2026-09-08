import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
PORT = 8123
BASE_URL = f"http://localhost:{PORT}"


@pytest.fixture(scope="session", autouse=True)
def static_server():
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=REPO_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_server()
        yield
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def _wait_for_server(timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{BASE_URL}/index.html", timeout=1)
            return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("Local static server did not start in time")
