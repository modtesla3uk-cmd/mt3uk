const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'events-data', 'events-manifest.json');

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ ${name} is required`);
    process.exit(1);
  }
  return value;
}

function toIsoWithOffset(dateStr, timeStr) {
  // dateStr: YYYY-MM-DD, timeStr: HH:MM (24h), both interpreted as UK clock time (+0000)
  return `${dateStr}T${timeStr}:00+0000`;
}

function ukDateToIso(ukDate) {
  // ukDate: D-M-YY, DD-MM-YYYY, or any mix of those, as entered in the workflow form
  const match = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/.exec(ukDate);
  if (!match) {
    console.error(`✗ "${ukDate}" is not a valid date, use DD-MM-YYYY`);
    process.exit(1);
  }
  const [, day, month, yearPart] = match;
  const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Events are matched by name and start date when adding or deleting, so
// re-running Add or Update with the same name and date updates that event.
function findByNameAndDate(manifest, name, isoStartDate, exceptIndex = -1) {
  return manifest.events.findIndex((ev, i) => i !== exceptIndex
    && slugify(ev.name) === slugify(name)
    && ev.startTime.slice(0, 10) === isoStartDate);
}

// Ids are sequential numbers padded to 3 digits (001, 002, ...). They never
// change and are never reused, even after the highest one is deleted.
function formatId(value) {
  const n = parseInt(String(value).trim(), 10);
  return Number.isInteger(n) && n > 0 ? String(n).padStart(3, '0') : String(value).trim();
}

function nextId(manifest) {
  const max = Math.max(
    manifest.lastId || 0,
    ...manifest.events.map((ev) => parseInt(ev.id, 10) || 0),
  );
  manifest.lastId = max + 1;
  return formatId(max + 1);
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function saveManifest(manifest) {
  manifest.totalEvents = manifest.events.length;
  manifest.generated = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log('✓ Saved events-manifest.json');
}

module.exports = {
  required,
  toIsoWithOffset,
  ukDateToIso,
  slugify,
  findByNameAndDate,
  formatId,
  nextId,
  loadManifest,
  saveManifest,
};
