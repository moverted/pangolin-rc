#!/usr/bin/env node
// One-shot: create the `watch` table in your Airtable base with the exact schema
// the D1↔Airtable sync expects. Run once after creating an (empty) base.
//
//   AIRTABLE_PAT=pat... AIRTABLE_BASE_ID=app... node scripts/airtable-setup.mjs
//
// The PAT needs scopes: schema.bases:write (to create the table) plus
// data.records:read and data.records:write (for the sync itself). Re-running is
// safe — if the table already exists Airtable returns 422 and we report it.

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE_ID;
if (!PAT || !BASE) {
  console.error('Set AIRTABLE_PAT and AIRTABLE_BASE_ID in the environment.');
  process.exit(1);
}

const num = (name) => ({ name, type: 'number', options: { precision: 0 } });
const text = (name) => ({ name, type: 'singleLineText' });

const fields = [
  text('key'),            // primary field: "<user_email>|<show_id>" — the merge key
  text('user_email'),
  text('show_id'),
  text('show_name'),
  text('kind'),
  text('status'),
  num('watched'),
  num('last_season'),
  num('last_number'),
  num('last_minute'),
  num('started_at'),
  { name: 'episodes', type: 'multilineText' },   // per-episode detail JSON
  num('updated_at'),                             // D1's authoritative ms timestamp
  text('sync_hash'),                             // echo-loop guard (do not edit by hand)
];

const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'watch', fields }),
});

const body = await res.text();
if (res.ok) {
  console.log('✅ Created table `watch` with', fields.length, 'fields.');
} else {
  console.error(`❌ ${res.status}:`, body);
  if (res.status === 422 && /already exists/i.test(body))
    console.error('   (The table already exists — field names must match the list above exactly.)');
  process.exit(1);
}
