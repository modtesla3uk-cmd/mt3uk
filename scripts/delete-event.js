#!/usr/bin/env node
const { required, ukDateToIso, eventId, loadManifest, saveManifest } = require('./event-utils');

function main() {
  const name = required('EVENT_NAME');
  const startDate = ukDateToIso(required('EVENT_START_DATE'));
  const id = eventId(name, startDate);

  const manifest = loadManifest();
  const idx = manifest.events.findIndex((ev) => ev.id === id);
  if (idx < 0) {
    console.error(`✗ No event found with id "${id}"`);
    process.exit(1);
  }
  manifest.events.splice(idx, 1);
  console.log(`✓ Deleted event "${id}"`);

  saveManifest(manifest);
}

main();
