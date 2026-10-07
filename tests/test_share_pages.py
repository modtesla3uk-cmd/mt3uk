"""The photo share pages (scripts/build_share_pages.py): each Gallery photo's page carries the car's best shared
time on Laps in its description and body, when the sync workflow could read it from the worker."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_share_pages as builder  # noqa: E402

PHOTO = {"file": "09-model-3-trackday.jpg", "caption": "model 3 trackday", "name": "richardhc", "mods": ["KW V3", "Pagid RSL29"]}


def meta(html, prop):
    return re.search(r'<meta (?:property|name)="%s" content="([^"]*)"' % re.escape(prop), html).group(1)


def test_a_page_with_no_laps_times_is_as_before():
    html = builder.page_html(PHOTO, None)
    assert meta(html, "og:description") == "Mods: KW V3, Pagid RSL29"
    assert "laps.mt3uk.com" not in html


def test_the_fastest_lap_leads_the_description_and_links_to_the_session():
    bests = [
        {"type": "track", "venue": "Thruxton", "layout": "Thruxton", "id": "s1", "bestTime": 81.42},
        {"type": "track", "venue": "Donington", "layout": "GP", "id": "s2", "bestTime": 79.9},
        {"type": "sprint", "venue": "Lydden Hill", "layout": "B19", "id": "s3", "bestTime": 52.07},
        {"type": "drag", "venue": "Santa Pod", "id": "s4", "quarter": 11.84},
    ]
    html = builder.page_html(PHOTO, bests)
    # The quickest lap, whichever track, then the mods.
    assert meta(html, "og:description") == "Fastest lap at Donington: 1:19.90 (Laps by MT3UK). Mods: KW V3, Pagid RSL29"
    assert meta(html, "description") == meta(html, "og:description")
    assert '<a href="https://laps.mt3uk.com/track.html?s=s2">Fastest lap at Donington: 1:19.90 on Laps by MT3UK</a>' in html


def test_a_run_or_a_quarter_mile_when_there_is_no_lap():
    assert builder.best_line([{"type": "sprint", "venue": "Lydden Hill", "layout": "B19", "id": "s3", "bestTime": 52.07}]) == ("Best run at Lydden Hill, B19: 52.07 s", "s3")
    assert builder.best_line([{"type": "drag", "venue": "Santa Pod", "id": "s4", "quarter": 11.84}]) == ("Quarter mile at Santa Pod: 11.84 s", "s4")
    assert builder.best_line([]) == ("", "")


def test_text_in_the_time_line_is_escaped():
    html = builder.page_html(PHOTO, [{"type": "track", "venue": "Bob's <Track>", "id": "s<1>", "bestTime": 100}])
    assert "Bob&#x27;s &lt;Track&gt;" in html and "s%3C1%3E" not in html and "<Track>" not in html
