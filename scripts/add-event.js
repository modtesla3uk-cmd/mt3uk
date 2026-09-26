#!/usr/bin/env node
const { required, toIsoWithOffset, ukDateToIso, findByNameAndDate, formatId, nextId, loadManifest, saveManifest } = require('./event-utils');

function input(name) {
  return (process.env[name] || '').trim();
}

// Edit mode: every field except the id is optional, and a blank field keeps
// the event's current value, so an edit only needs the fields that change.
function editById() {
  const id = formatId(process.env.EVENT_ID);

  const manifest = loadManifest();
  const idx = manifest.events.findIndex((ev) => ev.id === id);
  if (idx < 0) {
    console.error(`✗ No event found with id "${id}". Run the List Events workflow to see the current ids.`);
    process.exit(1);
  }
  const current = manifest.events[idx];

  // startTime/endTime are stored as YYYY-MM-DDTHH:MM:00+0000
  const curStartDate = current.startTime.slice(0, 10);
  const curStartTime = current.startTime.slice(11, 16);
  const curEndDate = current.endTime.slice(0, 10);
  const curEndTime = current.endTime.slice(11, 16);

  const name = input('EVENT_NAME') || current.name;
  const startDate = input('EVENT_START_DATE') ? ukDateToIso(input('EVENT_START_DATE')) : curStartDate;
  const startTime = input('EVENT_START_TIME') || curStartTime;
  const endDate = input('EVENT_END_DATE') ? ukDateToIso(input('EVENT_END_DATE')) : curEndDate;
  const endTime = input('EVENT_END_TIME') || curEndTime;

  // The id stays the same, but no two events may share a name and start date
  // or a later add by name and date would not know which one to update.
  const clash = findByNameAndDate(manifest, name, startDate, idx);
  if (clash >= 0) {
    console.error(`✗ Event ${manifest.events[clash].id} already has that name and start date`);
    process.exit(1);
  }

  const updated = {
    id,
    name,
    description: input('EVENT_DESCRIPTION') || current.description,
    startTime: toIsoWithOffset(startDate, startTime),
    endTime: toIsoWithOffset(endDate, endTime),
    location: { name: input('EVENT_LOCATION') || current.location.name },
    facebookUrl: input('EVENT_FACEBOOK_URL') || current.facebookUrl,
    attendingCount: input('EVENT_ATTENDING_COUNT') ? Number(input('EVENT_ATTENDING_COUNT')) : current.attendingCount,
    interestedCount: input('EVENT_INTERESTED_COUNT') ? Number(input('EVENT_INTERESTED_COUNT')) : current.interestedCount,
  };

  manifest.events[idx] = updated;
  console.log(`✓ Updated event ${id} "${name}"`);

  saveManifest(manifest);
}

function main() {
  // With an event id this edits that event, otherwise it adds or updates by
  // name and start date.
  if ((process.env.EVENT_ID || '').trim()) {
    editById();
    return;
  }

  const name = required('EVENT_NAME');
  const startDate = ukDateToIso(required('EVENT_START_DATE'));

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
  // Re-running the workflow with the same name and date updates that event in
  // place, keeping its id, instead of creating a duplicate.
  const idx = findByNameAndDate(manifest, name, startDate);
  const id = idx >= 0 ? manifest.events[idx].id : nextId(manifest);
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
    console.log(`✓ Updated existing event ${id} "${name}"`);
  } else {
    manifest.events.push(newEvent);
    console.log(`✓ Added new event ${id} "${name}"`);
  }

  saveManifest(manifest);
}

main();
