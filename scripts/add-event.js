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

function main() {
  const isDelete = (process.env.EVENT_DELETE || '').toLowerCase() === 'true';
  const name = required('EVENT_NAME');
  const startDate = ukDateToIso(required('EVENT_START_DATE'));

  // id is derived from the name and start date rather than entered by hand, so
  // re-running the workflow with the same name and date updates that event in
  // place instead of creating a duplicate.
  const id = `${slugify(name)}-${startDate}`;

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const idx = manifest.events.findIndex((ev) => ev.id === id);

  if (isDelete) {
    if (idx < 0) {
      console.error(`✗ No event found with id "${id}"`);
      process.exit(1);
    }
    manifest.events.splice(idx, 1);
    console.log(`✓ Deleted event "${id}"`);
  } else {
    const description = process.env.EVENT_DESCRIPTION || '';
    const startTimeStr = required('EVENT_START_TIME');
    const startTime = toIsoWithOffset(startDate, startTimeStr);
    // end time defaults to start time (and end date to start date) so a
    // single-moment event doesn't need them filled in.
    const endDate = process.env.EVENT_END_DATE ? ukDateToIso(process.env.EVENT_END_DATE) : startDate;
    const endTime = toIsoWithOffset(endDate, process.env.EVENT_END_TIME || startTimeStr);
    const locationName = required('EVENT_LOCATION');
    const facebookUrl = required('EVENT_FACEBOOK_URL');
    const attendingCount = Number(process.env.EVENT_ATTENDING_COUNT || 0);
    const interestedCount = Number(process.env.EVENT_INTERESTED_COUNT || 0);

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

    if (idx >= 0) {
      manifest.events[idx] = newEvent;
      console.log(`✓ Updated existing event "${id}"`);
    } else {
      manifest.events.push(newEvent);
      console.log(`✓ Added new event "${id}"`);
    }
  }

  manifest.totalEvents = manifest.events.length;
  manifest.generated = new Date().toISOString();

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log('✓ Saved events-manifest.json');
}

main();
