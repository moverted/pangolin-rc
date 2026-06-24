// Idempotent: add any fields that exist in the desired schema below but are missing
// from the live Airtable tables. Unlike airtable-setup.mjs (which only CREATES whole
// tables and skips ones that already exist), this reconciles columns on tables that
// are already there — e.g. after adding show_name / episode_name / timezone.
//
//   AIRTABLE_PAT=pat... AIRTABLE_BASE_ID=app... node scripts/airtable-add-fields.mjs
//
// PAT scopes: schema.bases:read + schema.bases:write. Safe to run repeatedly.

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE_ID;
if (!PAT || !BASE) {
  console.error('Set AIRTABLE_PAT and AIRTABLE_BASE_ID in the environment.');
  process.exit(1);
}

const num = (name) => ({ name, type: 'number', options: { precision: 0 } });
const text = (name) => ({ name, type: 'singleLineText' });
const KEY = text('key');
const HASH = text('sync_hash');

// Must match TABLES in src/handlers/airtable.ts (kept in sync with airtable-setup.mjs).
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

const auth = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };

// Live schema: table name -> { id, fieldNames:Set }.
const schemaRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, { headers: auth });
if (!schemaRes.ok) { console.error('❌ schema read', schemaRes.status, await schemaRes.text()); process.exit(1); }
const live = {};
for (const t of (await schemaRes.json()).tables || [])
  live[t.name] = { id: t.id, fields: new Set((t.fields || []).map((f) => f.name)) };

let added = 0, failed = false;
for (const [name, fields] of Object.entries(TABLES)) {
  const tbl = live[name];
  if (!tbl) { console.log(`↪︎  \`${name}\` not in base — run airtable-setup.mjs first; skipping.`); continue; }
  for (const field of fields) {
    if (field === KEY || tbl.fields.has(field.name)) continue;   // primary + existing fields stay put
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tbl.id}/fields`, {
      method: 'POST', headers: auth, body: JSON.stringify(field),
    });
    if (res.ok) { console.log(`✅ ${name}.${field.name} added.`); added++; }
    else { console.error(`❌ ${name}.${field.name} ${res.status}:`, await res.text()); failed = true; }
  }
}
console.log(added ? `\nAdded ${added} field(s).` : '\nNothing to add — all fields already present.');
if (failed) process.exit(1);
