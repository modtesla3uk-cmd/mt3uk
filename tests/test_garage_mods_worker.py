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
const model = m.cleanCarModel({ model: 'Model 3', version: 'Performance', year: '2021' });
const badModel = m.cleanCarModel({ model: 'Model Q', year: '1900' });
const plans = m.cleanPlans([{ area: 'Brakes', what: 'Big brake kit', when: 'Spring 2027' }, { what: '' }, 'junk']);
console.log(JSON.stringify({ specs, mods, model, badModel, plans }));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed here")
def test_specs_are_cleaned_and_the_public_list_has_no_private_details():
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "worker.mjs"
        source = (ROOT / "workers" / "vote-worker.js").read_text(encoding="utf-8")
        source = source.replace("import { EmailMessage } from 'cloudflare:email';", "class EmailMessage { constructor(f, t, raw) { this.raw = raw; } }", 1)
        source += "\nexport { cleanSpecs, specsToMods, cleanCarModel, cleanPlans };\n"
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
