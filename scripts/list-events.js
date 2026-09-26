#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'events-data', 'events-manifest.json');

function toUkDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  console.log('## Current events\n');
  console.log('Use the **ID** column below as the **Event ID** in the Add or Update Event workflow to edit an event, or the **name** and **start date** columns for the Delete Event workflow.\n');
  console.log('| ID | Name | Start date | Location | Facebook URL |');
  console.log('| --- | --- | --- | --- | --- |');

  manifest.events
    .slice()
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .forEach((ev) => {
      const startDate = toUkDate(ev.startTime.slice(0, 10));
      console.log(`| ${ev.id} | ${ev.name} | ${startDate} | ${ev.location.name} | ${ev.facebookUrl} |`);
    });
}

main();
