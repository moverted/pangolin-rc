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
// Catalog + per-user tables use plain id columns to join (title_id / episode_id /
// next_episode_id); converting those to native Airtable linked-record fields is an
// optional UI polish that doesn't change the data.
const TABLES = {
  titles: [KEY, text('title_id'), text('source'), text('name'), text('kind'),
    text('status'), text('poster'), text('platform'), num('total_episodes'),
    text('premiered'), num('updated_at'), HASH],
  episodes: [KEY, text('episode_id'), text('title_id'), num('season'), num('number'),
    text('name'), num('runtime'), text('airdate'), text('next_episode_id'),
    num('updated_at'), HASH],
  watch_title: [KEY, text('user_email'), text('title_id'), text('show_name'), text('status'),
    text('active_map_id'), text('current_episode_id'), num('started_at'),
    num('updated_at'), HASH],
  watch_episode: [KEY, text('user_email'), text('episode_id'), text('title_id'),
    text('show_name'), text('episode_name'),
    num('done'), num('minute'), num('bp'), { name: 'sessions', type: 'multilineText' },
    num('updated_at'), HASH],
  users: [KEY, text('email'), text('username'), text('phone'), text('photo_url'),
    text('selected_device'), text('timezone'), num('created_at'), num('updated_at'), HASH],
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
