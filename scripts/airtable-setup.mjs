#!/usr/bin/env node
// One-shot: create the synced tables in your Airtable base with the exact schema
// the D1↔Airtable sync expects. Run once after creating an (empty) base; safe to
// re-run (existing tables return 422 and are reported, others still get created).
//
//   AIRTABLE_PAT=pat... AIRTABLE_BASE_ID=app... node scripts/airtable-setup.mjs
//
// The PAT needs scopes: schema.bases:write (to create tables) plus
// data.records:read and data.records:write (for the sync itself).

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE_ID;
if (!PAT || !BASE) {
  console.error('Set AIRTABLE_PAT and AIRTABLE_BASE_ID in the environment.');
  process.exit(1);
}

const num = (name) => ({ name, type: 'number', options: { precision: 0 } });
const text = (name) => ({ name, type: 'singleLineText' });
const KEY = text('key');                 // primary field (PK cols joined by '|')
const HASH = text('sync_hash');          // echo-loop guard — do not hand-edit

// Each table mirrors a D1 table 1:1 (must match TABLES in src/handlers/airtable.ts).
const TABLES = {
  watch: [KEY, text('user_email'), text('show_id'), text('show_name'), text('kind'),
    text('status'), num('watched'), num('last_season'), num('last_number'),
    num('last_minute'), num('started_at'), { name: 'episodes', type: 'multilineText' },
    num('updated_at'), HASH],
  users: [KEY, text('email'), text('username'), text('phone'), text('photo_url'),
    text('selected_device'), num('created_at'), num('updated_at'), HASH],
  devices: [KEY, text('id'), text('user_email'), text('type'), text('location'),
    text('ip'), text('model'), num('supported'), num('created_at'), HASH],
  follows: [KEY, text('follower_email'), text('followee_email'), num('created_at'), HASH],
  waitlist: [KEY, text('email'), num('created_at'), HASH],
};

let failed = false;
for (const [name, fields] of Object.entries(TABLES)) {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, fields }),
  });
  const body = await res.text();
  if (res.ok) console.log(`✅ Created table \`${name}\` with ${fields.length} fields.`);
  else if (res.status === 422 && /already exists|same name/i.test(body)) console.log(`↪︎  \`${name}\` already exists — skipped.`);
  else { console.error(`❌ \`${name}\` ${res.status}:`, body); failed = true; }
}
if (failed) process.exit(1);
