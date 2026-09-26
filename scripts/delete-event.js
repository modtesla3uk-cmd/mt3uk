#!/usr/bin/env node
const { required, ukDateToIso, findByNameAndDate, loadManifest, saveManifest } = require('./event-utils');

function main() {
  const name = required('EVENT_NAME');
  const startDate = ukDateToIso(required('EVENT_START_DATE'));

  const manifest = loadManifest();
  const idx = findByNameAndDate(manifest, name, startDate);
  if (idx < 0) {
    console.error(`✗ No event found called "${name}" starting ${startDate}`);
    process.exit(1);
  }
  const [removed] = manifest.events.splice(idx, 1);
  console.log(`✓ Deleted event ${removed.id} "${removed.name}"`);

  saveManifest(manifest);
}

main();
