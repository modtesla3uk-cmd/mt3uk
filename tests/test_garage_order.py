"""My Garage lists a car's newest photos first, so a photo just added is at
the top of its list; cars keep the order they were first added in."""
from pathlib import Path

WORKER = (Path(__file__).resolve().parent.parent / "workers" / "vote-worker.js").read_text(encoding="utf-8")


def test_new_photos_come_first_in_my_garage():
    get = WORKER[WORKER.index("async function handleMyBuildsGet"):]
    get = get[:get.index("\nasync function ")]
    assert "g.entries = rest.concat(ordered);" in get, "Photos not yet in the saved order go first"
    assert "return (b.uploadedAt || 0) - (a.uploadedAt || 0);" in get, "Newest first"
    assert "groups.sort(function (a, b) { return firstAdded(a) - firstAdded(b); });" in get, "Cars keep their order"
