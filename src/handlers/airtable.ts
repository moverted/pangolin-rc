import { Hono } from 'hono';
import type { Env } from '../types';

// ─── D1 ↔ Airtable two-way sync for the `watch` table ────────────────────────
//
// D1 is the source of truth. Airtable is a human-editable mirror:
//   · Outbound (D1 → Airtable): every watch upsert/delete pushes to Airtable
//     (fire-and-forget via waitUntil, so it never blocks or breaks the app write).
//   · Inbound  (Airtable → D1): a cron poll pulls human edits back into D1.
//
// Echo-loop break: each row carries a `sync_hash` of its syncable fields. We write
// it on every push. The inbound poll recomputes the hash from Airtable's current
// values; if it matches `sync_hash` the row is unchanged since our last push (our
// own echo) and is skipped. A mismatch means a human edited it → pull into D1 and
// re-push (which resets the hash). No timestamp guessing, no loops.
//
// The whole module is inert until AIRTABLE_PAT + AIRTABLE_BASE_ID are set.

export const AT_TABLE = 'watch';

export function airtableEnabled(env: Env): boolean {
  return !!(env.AIRTABLE_PAT && env.AIRTABLE_BASE_ID);
}

// One D1 watch row, normalized. user_email + show_id is the composite key.
export interface WatchRow {
  user_email: string;
  show_id: string;
  show_name: string | null;
  kind: string;
  status: string | null;
  watched: number;
  last_season: number | null;
  last_number: number | null;
  last_minute: number;
  started_at: number | null;
  episodes: string | null; // JSON
  updated_at: number;
}

const keyOf = (r: { user_email: string; show_id: string }) => `${r.user_email}|${r.show_id}`;

// The fields mirrored into Airtable (everything except the synthetic key + hash).
const FIELD_ORDER: (keyof WatchRow)[] = [
  'user_email', 'show_id', 'show_name', 'kind', 'status', 'watched',
  'last_season', 'last_number', 'last_minute', 'started_at', 'episodes', 'updated_at',
];

// A stable string of the syncable values, so D1 and Airtable hash identically.
function canonical(r: WatchRow): string {
  return FIELD_ORDER.map((k) => {
    const v = r[k];
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    return String(v);
  }).join('␟'); // unit separator, won't appear in titles/JSON
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Map a D1 row → Airtable fields object.
function toFields(r: WatchRow, hash: string): Record<string, unknown> {
  return {
    key: keyOf(r),
    user_email: r.user_email,
    show_id: r.show_id,
    show_name: r.show_name ?? '',
    kind: r.kind,
    status: r.status ?? '',
    watched: r.watched,
    last_season: r.last_season,
    last_number: r.last_number,
    last_minute: r.last_minute,
    started_at: r.started_at,
    episodes: r.episodes ?? '',
    updated_at: r.updated_at,
    sync_hash: hash,
  };
}

// Map Airtable fields → a normalized WatchRow (numbers coerced, '' → null).
function fromFields(f: Record<string, any>): WatchRow | null {
  const user_email = (f.user_email || '').toString().trim().toLowerCase();
  const show_id = (f.show_id || '').toString().trim();
  if (!user_email || !show_id) return null;
  const numOrNull = (v: any) => (v === '' || v == null ? null : Math.trunc(Number(v)));
  const num = (v: any) => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Math.trunc(Number(v)));
  return {
    user_email, show_id,
    show_name: f.show_name ? String(f.show_name) : null,
    kind: String(f.kind || 'show') === 'movie' ? 'movie' : 'show',
    status: f.status ? String(f.status) : null,
    watched: num(f.watched),
    last_season: numOrNull(f.last_season),
    last_number: numOrNull(f.last_number),
    last_minute: num(f.last_minute),
    started_at: numOrNull(f.started_at),
    episodes: f.episodes ? String(f.episodes) : null,
    updated_at: num(f.updated_at) || Date.now(),
  };
}

function api(env: Env, path = '') {
  return `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(AT_TABLE)}${path}`;
}
function headers(env: Env) {
  return { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' };
}

// ── Outbound: D1 → Airtable ──────────────────────────────────────────────────

// Upsert one row into Airtable, merging on `key`. Safe to call fire-and-forget.
export async function pushWatchRow(env: Env, r: WatchRow): Promise<void> {
  if (!airtableEnabled(env)) return;
  const hash = await sha256(canonical(r));
  const res = await fetch(api(env), {
    method: 'PATCH',
    headers: headers(env),
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: ['key'] },
      typecast: true,
      records: [{ fields: toFields(r, hash) }],
    }),
  });
  if (!res.ok) console.error('airtable push failed', r.show_id, res.status, await res.text().catch(() => ''));
}

// Delete a row from Airtable by composite key (find then delete).
export async function deleteWatchRow(env: Env, user_email: string, show_id: string): Promise<void> {
  if (!airtableEnabled(env)) return;
  const key = `${user_email}|${show_id}`;
  const formula = `{key}='${key.replace(/'/g, "\\'")}'`;
  const find = await fetch(api(env, `?filterByFormula=${encodeURIComponent(formula)}&pageSize=1`), { headers: headers(env) });
  if (!find.ok) return;
  const data = await find.json<{ records?: { id: string }[] }>();
  const id = data.records?.[0]?.id;
  if (!id) return;
  await fetch(api(env, `?records[]=${id}`), { method: 'DELETE', headers: headers(env) });
}

// ── Inbound: Airtable → D1 ───────────────────────────────────────────────────

interface AtRecord { id: string; fields: Record<string, any> }

async function listAll(env: Env): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  do {
    const url = api(env, `?pageSize=100${offset ? `&offset=${offset}` : ''}`);
    const res = await fetch(url, { headers: headers(env) });
    if (!res.ok) { console.error('airtable list failed', res.status); break; }
    const data = await res.json<{ records: AtRecord[]; offset?: string }>();
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

// Write a row pulled from Airtable into D1, stamping a fresh updated_at so the row
// wins as the newest write. Skips unknown users (FK on watch.user_email).
async function writeToD1(env: Env, r: WatchRow): Promise<boolean> {
  const exists = await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(r.user_email).first();
  if (!exists) return false;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO watch (user_email, show_id, show_name, kind, status, watched, last_season, last_number,
                        last_minute, started_at, episodes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_email, show_id) DO UPDATE SET
       show_name=excluded.show_name, kind=excluded.kind, status=excluded.status, watched=excluded.watched,
       last_season=excluded.last_season, last_number=excluded.last_number,
       last_minute=excluded.last_minute, started_at=excluded.started_at,
       episodes=excluded.episodes, updated_at=excluded.updated_at`
  ).bind(r.user_email, r.show_id, r.show_name, r.kind, r.status, r.watched, r.last_season,
         r.last_number, r.last_minute, r.started_at, r.episodes, now).run();
  return true;
}

// Pull human edits from Airtable into D1. A record whose recomputed hash differs
// from its stored sync_hash was edited in Airtable since our last push → pull it,
// then re-push so its hash + updated_at resync. Returns a small summary.
export async function pullChanges(env: Env): Promise<{ scanned: number; pulled: number; skipped: number }> {
  if (!airtableEnabled(env)) return { scanned: 0, pulled: 0, skipped: 0 };
  const records = await listAll(env);
  let pulled = 0, skipped = 0;
  for (const rec of records) {
    const row = fromFields(rec.fields);
    if (!row) { skipped++; continue; }
    const liveHash = await sha256(canonical(row));
    const storedHash = (rec.fields.sync_hash || '').toString();
    if (liveHash === storedHash) { skipped++; continue; }   // our own echo — unchanged since last push
    const wrote = await writeToD1(env, row);                 // human edit → into D1 (with fresh updated_at)
    if (wrote) { await pushWatchRow(env, { ...row, updated_at: Date.now() }); pulled++; }
    else skipped++;
  }
  return { scanned: records.length, pulled, skipped };
}

// Backfill every D1 watch row into Airtable (initial seed / manual reconcile).
export async function pushAll(env: Env): Promise<{ pushed: number }> {
  if (!airtableEnabled(env)) return { pushed: 0 };
  const rows = await env.DB.prepare(
    `SELECT user_email, show_id, show_name, kind, status, watched, last_season, last_number,
            last_minute, started_at, episodes, updated_at FROM watch`).all<WatchRow>();
  let pushed = 0;
  for (const r of rows.results || []) { await pushWatchRow(env, r); pushed++; }
  return { pushed };
}

// ── Manual control routes (admin) ────────────────────────────────────────────
// Guarded by SYNC_ADMIN_TOKEN so they aren't open to the world.

export const syncRoutes = new Hono<{ Bindings: Env }>();

function authed(c: any): boolean {
  const t = c.env.SYNC_ADMIN_TOKEN;
  if (!t) return false;                                  // no token configured → locked
  const h = c.req.header('authorization') || '';
  return h === `Bearer ${t}`;
}

syncRoutes.get('/status', (c) =>
  c.json({ airtable: airtableEnabled(c.env), table: AT_TABLE, base: c.env.AIRTABLE_BASE_ID ? 'set' : 'unset' }));

syncRoutes.post('/push-all', async (c) => {
  if (!authed(c)) return c.json({ error: 'unauthorized' }, 401);
  if (!airtableEnabled(c.env)) return c.json({ error: 'airtable not configured' }, 503);
  return c.json(await pushAll(c.env));
});

syncRoutes.post('/pull', async (c) => {
  if (!authed(c)) return c.json({ error: 'unauthorized' }, 401);
  if (!airtableEnabled(c.env)) return c.json({ error: 'airtable not configured' }, 503);
  return c.json(await pullChanges(c.env));
});
