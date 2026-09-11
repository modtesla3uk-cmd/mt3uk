#!/usr/bin/env node
const { required, toIsoWithOffset, ukDateToIso, eventId, loadManifest, saveManifest } = require('./event-utils');

function main() {
  const name = required('EVENT_NAME');
  const startDate = ukDateToIso(required('EVENT_START_DATE'));

  // id is derived from the name and start date rather than entered by hand, so
  // re-running the workflow with the same name and date updates that event in
  // place instead of creating a duplicate.
  const id = eventId(name, startDate);

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

  const manifest = loadManifest();
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

  saveManifest(manifest);
}

main();
