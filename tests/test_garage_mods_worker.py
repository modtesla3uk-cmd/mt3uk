"""The worker's mods list (workers/vote-worker.js): cleanSpecs keeps only the
known areas and answers, and specsToMods makes the public list without the
owner-only fitted dates, fitter or cost. Runs the real functions in node."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

SCRIPT = r"""
const m = await import(process.env.WORKER_MODULE);
const specs = m.cleanSpecs({
  wheels: { status: 'up', fields: { make: 'Vossen', model: 'HF-2', sizeFront: '20in', sizeRear: '20in', offset: 'ET35', evil: '<b>x</b>' },
    spacers: { on: true, make: 'H&R', front: '15mm', rear: '20mm', hub: true },
    fitted: { month: 3, year: 2025, by: 'Tyre Tec', cost: '2400' } },
  suspension: { status: 'up', fields: { type: 'Coilovers', make: 'KW', model: 'V3', drop: '35mm', notes: 'Damping 6' }, fitted: { month: 13, year: 1800 } },
  brakes: { status: 'stock', fields: { pads: 'ignored' } },
  bodywork: { status: 'up', kinds: { ppf: { make: 'XPEL', model: 'Ultimate Plus', coverage: 'Front end' }, tint: { front: '35%', rear: '20%' }, rockets: { what: 'no' } } },
  interior: { status: 'up', picks: ['Seats', 'Jetpack'], fields: { makeModel: 'Recaro' } },
  other: { status: 'up', items: ['Wheels', '', 'x'.repeat(400)] },
  tyres: { status: 'maybe' },
  hacks: { status: 'up' }
});
const mods = m.specsToMods(specs);
const extraSpecs = m.cleanSpecs({ suspension: { status: 'up', items: ['KW v3 Coilovers', 'MPP arms'] }, brakes: { status: 'up', fields: { pads: 'Pagid' }, items: ['AP Racing rear discs'] } });
const extraMods = m.specsToMods(extraSpecs);
const fullSpecs = m.cleanSpecs({
  suspension: { status: 'up', fields: { type: 'Coilovers', make: 'KW', model: 'V3', roadReboundFront: '8 clicks', trackCompressionRear: '3 clicks', notes: 'secret' },
    more: [{ type: 'Control arms', make: 'MPP', model: 'Front upper' }, {}, { evil: 'x' }] },
  brakes: { status: 'up', fields: { frontCalipers: 'AP Racing CP9660', frontDiscs: '372x32', rearDiscs: '355x24', fluid: 'Motul RBF 660' },
    more: [{ part: 'Cooling ducts', makeModel: 'Maxton', fitted: { year: 2024, by: 'Tyre Tec' } }] },
  bodywork: { status: 'up', kinds: { wrap: { make: 'Avery', colour: 'Gloss Hidden Forest', fitted: { month: 5, year: 2023, cost: '3000' } } }, more: [{ part: 'Front bumper', makeModel: 'Robot Crypton' }] }
});
const fullMods = m.specsToMods(fullSpecs);
const ownerView = m.specsToView(fullSpecs, true);
const visitorView = m.specsToView(m.cleanSpecs({ bodywork: { status: 'up', kinds: { lights: {}, wrap: { make: 'Avery' } } } }), false);
const ownerEmpty = m.specsToView(m.cleanSpecs({ bodywork: { status: 'up', kinds: { lights: {} } } }), true);
const flatView = m.specsToView(null, false, ['KW v3 Coilovers']);
const model = m.cleanCarModel({ model: 'Model 3', version: 'Performance', year: '2021' });
const badModel = m.cleanCarModel({ model: 'Model Q', year: '1900' });
const plans = m.cleanPlans([{ area: 'Brakes', what: 'Big brake kit', when: 'Spring 2027' }, { what: '' }, 'junk']);
console.log(JSON.stringify({ specs, mods, model, badModel, plans, extraSpecs, extraMods, fullSpecs, fullMods, ownerView, visitorView, ownerEmpty, flatView }));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_specs_are_cleaned_and_the_public_list_has_no_private_details():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        source += "\nexport { cleanSpecs, specsToMods, cleanCarModel, cleanPlans, specsToView };\n"
        module.write_text(source, encoding="utf-8")
        check = Path(tmp) / "check.mjs"
        check.write_text(SCRIPT, encoding="utf-8")
        result = subprocess.run(["node", str(check)], env={"WORKER_MODULE": module.as_uri(), "PATH": "/usr/bin:/usr/local/bin:/bin"},
                                capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout.strip().splitlines()[-1])
    specs, mods = out["specs"], out["mods"]

    assert set(specs) == {"wheels", "suspension", "brakes", "bodywork", "interior", "other"}
    assert "evil" not in specs["wheels"]["fields"]
    assert specs["brakes"] == {"status": "stock"}
    assert specs["suspension"].get("fitted") is None, "Bad month and year are dropped"
    assert set(specs["bodywork"]["kinds"]) == {"ppf", "tint"}
    assert specs["interior"]["picks"] == ["Seats"]
    assert specs["other"]["items"][0] == "Wheels" and len(specs["other"]["items"]) == 2
    assert len(specs["other"]["items"][1]) == 150

    assert mods[:3] == [
        "Wheels: Vossen HF-2, 20in, ET35",
        "Spacers: H&R, 15mm front, 20mm rear, hub-centric",
        "Suspension: KW V3 coilovers, 35mm drop",
    ]
    assert "PPF: XPEL Ultimate Plus, front end" in mods
    assert "Tint: 35% front, 20% rear" in mods
    assert "Interior: Seats, Recaro" in mods
    text = " ".join(mods)
    for private in ("2025", "Tyre Tec", "2400", "Damping", "March"):
        assert private not in text, private

    assert out["model"] == {"model": "Model 3", "version": "Performance", "year": 2021}
    assert out["badModel"] == {}
    assert out["plans"] == [{"what": "Big brake kit", "area": "Brakes", "when": "Spring 2027"}]
    # Extra parts in any area: kept, and listed as written, with no bare
    # "Suspension" line when only extras were given.
    assert out["extraSpecs"]["suspension"]["items"] == ["KW v3 Coilovers", "MPP arms"]
    assert out["extraMods"] == ["KW v3 Coilovers", "MPP arms", "Brakes: Pagid pads", "AP Racing rear discs"]

    # Front and rear brakes, "More" parts, and coilover settings kept but
    # never shown publicly.
    full = out["fullSpecs"]
    assert full["suspension"]["fields"]["roadReboundFront"] == "8 clicks"
    assert full["suspension"]["more"] == [{"type": "Control arms", "make": "MPP", "model": "Front upper"}]
    assert out["fullMods"] == [
        "Suspension: KW V3 coilovers",
        "Coilover settings (road): rebound 8 clicks front",
        "Coilover settings (track): compression 3 clicks rear",
        "Suspension: MPP Front upper control arms",
        "Front brakes: AP Racing CP9660 calipers, 372x32 discs",
        "Rear brakes: 355x24 discs",
        "Brake fluid and lines: Motul RBF 660",
        "Brakes: Cooling ducts, Maxton",
        "Wrap: Avery Gloss Hidden Forest",
        "Bodywork: Front bumper, Robot Crypton",
    ]
    assert "secret" not in " ".join(out["fullMods"])
    # Each bodywork job and each "More" part has its own when and where,
    # which never shows publicly.
    assert full["bodywork"]["kinds"]["wrap"]["fitted"] == {"month": 5, "year": 2023, "cost": "3000"}
    assert full["brakes"]["more"][0]["fitted"] == {"year": 2024, "by": "Tyre Tec"}
    assert not any(x in " ".join(out["fullMods"]) for x in ("2023", "2024", "3000", "Tyre Tec"))

    # The view for My Garage and the Gallery's Full mods list.
    ov = {a["id"]: a for a in out["ownerView"]}
    assert [p["what"] for p in ov["suspension"]["parts"]] == ["KW V3 coilovers", "MPP Front upper control arms"]
    assert ov["suspension"]["parts"][0]["settings"] == {"road": {"reboundFront": "8 clicks"}, "track": {"compressionRear": "3 clicks"}}
    assert ov["brakes"]["parts"][-1] == {"what": "Cooling ducts, Maxton", "meta": "Fitted 2024 \u00b7 Tyre Tec"}
    assert ov["bodywork"]["parts"][0] == {"kind": "Wrap", "what": "Avery Gloss Hidden Forest", "meta": "Fitted May 2023 \u00b7 \u00a33000"}
    assert ov["interior"]["status"] == "todo"
    vv = {a["id"]: a for a in out["visitorView"]}
    assert vv["bodywork"]["parts"] == [{"kind": "Wrap", "what": "Avery"}], "Empty jobs hidden from visitors"
    assert {a["id"]: a for a in out["ownerEmpty"]}["bodywork"]["parts"] == [{"kind": "Lights", "what": "", "empty": True}]
    assert out["flatView"] == [{"id": "mods", "label": "Mods", "status": "up", "parts": [{"what": "KW v3 Coilovers"}]}]
