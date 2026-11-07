// Checks js/racebox-parse.js against the example packet in RaceBox BLE Protocol Documentation rev 9 (page 8).
// Run through tests/test_racebox_parse.py, or directly: node tests/racebox_parse_check.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'js', 'racebox-parse.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const RB = sandbox.MT3UKRaceBox;

const EXAMPLE_HEX = `
B5 62 FF 01 50 00 A0 E7 0C 07 E6 07 01 0A 08 33
08 37 19 00 00 00 2A AD 4D 0E 03 01 EA 0B C6 93
E1 0D 3B 37 6F 19 61 8C 09 00 0F 01 09 00 9C 03
00 00 2C 07 00 00 23 00 00 00 00 00 00 00 D0 00
00 00 88 A9 DD 00 2C 01 00 59 FD FF 71 00 CE 03
2F FF 56 00 FC FF 06 DB`;
const example = Uint8Array.from(EXAMPLE_HEX.trim().split(/\s+/).map((h) => parseInt(h, 16)));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('ok   ' + name);
  else { failures++; console.log('FAIL ' + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= eps; }

check('example packet is 88 bytes (6 header, 80 payload, 2 checksum)', example.length === 88, example.length);

// Checksum: the packet's own two check bytes must match.
const ck = RB.checksum(example);
check('checksum matches the document (06 DB)', ck[0] === 0x06 && ck[1] === 0xDB, ck);

// Parsing the whole packet in one notification.
const p = RB.parser();
const msgs = p.push(example);
check('one message from one notification', msgs.length === 1, msgs.length);
const m = msgs[0] || { cls: -1, id: -1, payload: new Uint8Array(0) };
check('class 0xFF, id 0x01 (RaceBox data message)', m.cls === 0xFF && m.id === 0x01, [m.cls, m.id]);
check('payload is 80 bytes', m.payload.length === 80, m.payload.length);

const d = RB.decodeLive(m.payload);
check('UTC date 2022-01-10 08:51:08', new Date(d.utc).toISOString().startsWith('2022-01-10T08:51:08'), new Date(d.utc).toISOString());
check('time valid, fix 3D, fix OK', d.timeValid && d.fixStatus === 3 && d.fixOk, { t: d.timeValid, f: d.fixStatus, ok: d.fixOk });
check('11 satellites', d.satellites === 11, d.satellites);
check('longitude 23.2887238', near(d.lon, 23.2887238, 1e-7), d.lon);
check('latitude 42.6719035', near(d.lat, 42.6719035, 1e-7), d.lat);
check('MSL altitude 590.095 m', near(d.altitudeMsl, 590.095, 1e-3), d.altitudeMsl);
check('horizontal accuracy 0.924 m', near(d.horizontalAccuracy, 0.924, 1e-3), d.horizontalAccuracy);
check('speed 35 mm/s is 0.035 m/s', near(d.speedMs, 0.035, 1e-6), d.speedMs);
check('speed 0.126 km/h', near(d.speedKph, 0.126, 1e-3), d.speedKph);
check('heading 0 degrees', d.heading === 0, d.heading);
check('heading accuracy 145.26856 degrees', near(d.headingAccuracy, 145.26856, 1e-5), d.headingAccuracy);
check('PDOP 3', d.pdop === 3, d.pdop);
check('coordinates valid', d.coordinatesValid === true, d.coordinatesValid);
check('battery 89 percent, not charging', d.batteryPercent === 89 && d.charging === false, [d.batteryPercent, d.charging]);
check('g-force X -0.003', near(d.gForce.x, -0.003, 1e-6), d.gForce.x);
check('g-force Y 0.113', near(d.gForce.y, 0.113, 1e-6), d.gForce.y);
check('g-force Z 0.974', near(d.gForce.z, 0.974, 1e-6), d.gForce.z);
check('rotation X -2.09 deg/s', near(d.rotation.x, -2.09, 1e-6), d.rotation.x);
check('rotation Y 0.86 deg/s', near(d.rotation.y, 0.86, 1e-6), d.rotation.y);
check('rotation Z -0.04 deg/s', near(d.rotation.z, -0.04, 1e-6), d.rotation.z);

// A packet split across three notifications, as a phone often receives them.
const split = new RB.parser();
let got = [];
got = got.concat(split.push(example.slice(0, 10)));
got = got.concat(split.push(example.slice(10, 50)));
got = got.concat(split.push(example.slice(50)));
check('a packet split over three notifications is rebuilt', got.length === 1 && got[0].payload.length === 80, got.length);

// Two packets in one notification, with junk before them.
const two = new Uint8Array(3 + 88 + 88);
two.set([0x00, 0x13, 0xB5], 0);       // junk, then the start of a header byte that is not followed by 0x62
two.set(example, 3);
two.set(example, 3 + 88);
const pair = new RB.parser().push(two);
check('two packets after junk are both found', pair.length === 2, pair.length);

// A packet with a corrupted byte is dropped, and the next good one is still found.
const bad = Uint8Array.from(example);
bad[30] = (bad[30] + 1) & 0xFF;
const after = new RB.parser().push(Uint8Array.from([...bad, ...example]));
check('a bad checksum is dropped, the good packet after it is kept', after.length === 1, after.length);

// The Micro reports input voltage, not a battery: 0x79 is 12.1 volts.
const micro = Uint8Array.from(example.slice(6, 88 - 2));
micro[67] = 0x79;
const dm = RB.decodeLive(micro);
check('Micro input voltage 0x79 is 12.1 V', near(dm.inputVolts, 12.1, 1e-9), dm.inputVolts);

if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all racebox parse checks passed');
