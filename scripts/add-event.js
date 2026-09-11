#!/usr/bin/env node
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

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function main() {
  const name = required('EVENT_NAME');
  const description = process.env.EVENT_DESCRIPTION || '';
  const startTime = toIsoWithOffset(required('EVENT_START_DATE'), required('EVENT_START_TIME'));
  const endTime = toIsoWithOffset(
    process.env.EVENT_END_DATE || process.env.EVENT_START_DATE,
    required('EVENT_END_TIME')
  );
  const locationName = required('EVENT_LOCATION');
  const facebookUrl = required('EVENT_FACEBOOK_URL');
  const attendingCount = Number(process.env.EVENT_ATTENDING_COUNT || 0);
  const interestedCount = Number(process.env.EVENT_INTERESTED_COUNT || 0);

  // id is derived from the name and start date rather than entered by hand, so
  // re-running the workflow with the same name and date updates that event in
  // place instead of creating a duplicate.
  const id = `${slugify(name)}-${process.env.EVENT_START_DATE}`;

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  const newEvent = {
    id,
    name,
    description,
    startTime,
    endTime,
    location: { name: locationName },
    facebookUrl,
    attendingCount,
    interestedCount,
  };

  const idx = manifest.events.findIndex((ev) => ev.id === id);
  if (idx >= 0) {
    manifest.events[idx] = newEvent;
    console.log(`✓ Updated existing event "${id}"`);
  } else {
    manifest.events.push(newEvent);
    console.log(`✓ Added new event "${id}"`);
  }

  manifest.totalEvents = manifest.events.length;
  manifest.generated = new Date().toISOString();

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log('✓ Saved events-manifest.json');
}

main();
