// Run by tests/test_racebox_stage.py: a RaceBox drive written as a VBO file (js/racebox-stage.js) is read back by the
// Laps track reader (js/track-parse.js) with the same positions, speeds, g and times.
import { createRequire } from 'module';
import fs from 'fs';
import vm from 'vm';
const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const T = require(ROOT + 'js/track-parse.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + 'js/racebox-stage.js', 'utf8'), sandbox);
const S = sandbox.window.MT3UKStage;
ok(S && typeof S.toVbo === 'function', 'the staging module loads');

// Ten seconds at 36 km/h, 25 readings a second, heading north-east, with a little across and along g.
const started = Date.UTC(2026, 10, 7, 19, 31, 0);
const rows = [];
for (let i = 0; i < 250; i++) {
  const utc = started + i * 40;
  rows.push([utc, 51.5 + i * 0.000005, -0.9 - i * 0.000003, 36, 45, 0.25, -0.12, 0.97, 0.5, -1.2, 3.4, 1, 12, 0.9, 61.5, 3, 1.1, 88, 0.05, 2.5]);
}
const text = S.toVbo(rows, started, 'Test drive');
ok(text.includes('[column names]') && text.includes('[data]'), 'the file has its column names and data');
ok(text.includes('UTC date started : 07/11/2026'), 'the file has the UTC start date the reader uses');

const r = T.read(text, 'Test_drive.vbo');
ok(r.format === 'VBO', 'the track reader takes the file as a VBO');
ok(r.points.length === rows.length, 'every reading comes back (' + r.points.length + ' of ' + rows.length + ')');
const p0 = r.points[0], pN = r.points[r.points.length - 1];
ok(near(p0.lat, 51.5, 1e-6) && near(p0.lng, -0.9, 1e-6), 'the first position comes back');
ok(near(pN.lat, 51.5 + 249 * 0.000005, 1e-6) && near(pN.lng, -0.9 - 249 * 0.000003, 1e-6), 'the last position comes back');
ok(near(p0.v, 36, 0.01), 'the speed comes back in km/h');
ok(near(p0.la, -0.25, 0.001), 'the across g comes back, as -x (the sign the other loggers have it)');
ok(near(p0.lo, 0.12, 0.001), 'the along g comes back, as -y');
const header = text.split('\r\n').find((l) => l.startsWith('time ')) || '';
ok(['heading', 'height', 'fix', 'pdop', 'batt', 'gyrox', 'gyroy', 'gyroz', 'hacc', 'sacc', 'hdgacc', 'vertacc'].every((c) => header.split(' ').includes(c)), 'every RaceBox figure has a column in the file');
const first = text.split('\r\n').find((l) => /^\d{6}\.\d{2} /.test(l)) || '';
ok(first.split(' ').length === header.split(' ').length, 'each row has a value for every column');
ok(first.split(' ')[7] === '61.50', 'the height is written');
const older = S.toVbo([[started, 51.5, -0.9, 30, 10, 0.1, 0.2, 1, 0, 0, 0, 1, 9, 1]], started, 'Older drive');
const olderRow = older.split('\r\n').find((l) => /^\d{6}\.\d{2} /.test(l)) || '';
ok(olderRow.split(' ').length === header.split(' ').length && olderRow.split(' ')[7] === '0.00', 'a drive recorded before the altitude was kept still writes, with 0 for what was not recorded');
ok(near(pN.t, 249 * 0.04, 0.01), 'the times come back, 0.04 s apart');
ok(r.startedAt && near(r.startedAt, started, 1000), 'the start time comes back');
