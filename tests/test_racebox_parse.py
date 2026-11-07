"""js/racebox-parse.js: the RaceBox Bluetooth packet reader, checked against the example packet in the RaceBox BLE
protocol documentation (rev 9). The browser-free checks run in node (tests/racebox_parse_check.mjs)."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_the_racebox_packet_reader_matches_the_protocol_example():
    out = subprocess.run(["node", str(ROOT / "tests" / "racebox_parse_check.mjs")], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "all racebox parse checks passed" in out.stdout, out.stdout
