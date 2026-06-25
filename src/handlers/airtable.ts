import { Hono } from 'hono';
import type { Env } from '../types';

// ─── D1 ↔ Airtable two-way sync ──────────────────────────────────────────────
//
// D1 is the source of truth. Airtable is a human-editable mirror. Each synced D1
// table maps 1:1 to an Airtable table of the same name. Sync is generic over the
// TABLES registry below.
//
//   · Outbound (D1 → Airtable): every mutation mirrors the row via waitUntil, so a
//     slow/failed Airtable call never blocks or breaks the app's own write.
//   · Inbound  (Airtable → D1): a cron poll pulls human edits back.
//
// Echo-loop break: every row carries a `sync_hash` of its syncable fields. The
// inbound poll recomputes it and skips rows whose hash still matches (our own
// echo). A mismatch = a human edited it → written into D1, then re-pushed so the
// hash resyncs. No timestamp guessing, no loops.
//
// Sensitive columns (password salt/hash) are never in a table's `cols`, so they
// never leave D1. Inert until AIRTABLE_PAT + AIRTABLE_BASE_ID are set.

export interface SyncTable {
  name: string;          // D1 table name == Airtable table name
  pk: string[];          // primary-key columns (the `key` field joins them with '|')
  cols: string[];        // synced columns, stable order (NEVER includes secrets)
  ints: Set<string>;     // columns that are numbers (Airtable number fields)
  hasUpdatedAt: boolean; // stamp updated_at=now on inbound writes
}

// Counter/flag columns that are NOT NULL in D1 — a cleared Airtable cell falls back.
const NN_DEFAULT: Record<string, number> = {
  'devices.supported': 1, 'titles.total_episodes': 0,
  'watch_episode.done': 0, 'watch_episode.minute': 0, 'watch_episode.bp': 0,
};

export const TABLES: SyncTable[] = [
  { name: 'titles', pk: ['title_id'], hasUpdatedAt: true,
    cols: ['title_id', 'source', 'name', 'kind', 'status', 'poster', 'platform',
           'total_episodes', 'premiered', 'updated_at'],
    ints: new Set(['total_episodes', 'updated_at']) },
  { name: 'episodes', pk: ['episode_id'], hasUpdatedAt: true,
    cols: ['episode_id', 'title_id', 'season', 'number', 'name', 'runtime', 'airdate',
           'next_episode_id', 'updated_at'],
    ints: new Set(['season', 'number', 'runtime', 'updated_at']) },
  { name: 'watch_title', pk: ['user_email', 'title_id'], hasUpdatedAt: true,
    cols: ['user_email', 'title_id', 'show_name', 'status', 'active_map_id', 'current_episode_id',
           'started_at', 'updated_at'],
    ints: new Set(['started_at', 'updated_at']) },
  { name: 'watch_episode', pk: ['user_email', 'episode_id'], hasUpdatedAt: true,
    cols: ['user_email', 'episode_id', 'title_id', 'show_name', 'episode_name',
           'done', 'minute', 'bp', 'sessions', 'updated_at'],
    ints: new Set(['done', 'minute', 'bp', 'updated_at']) },
  { name: 'users', pk: ['email'], hasUpdatedAt: true,
    cols: ['email', 'username', 'phone', 'photo_url', 'selected_device', 'timezone', 'created_at', 'updated_at'],
    ints: new Set(['created_at', 'updated_at']) },
  { name: 'devices', pk: ['id'], hasUpdatedAt: false,
    cols: ['id', 'user_email', 'type', 'location', 'ip', 'model', 'supported', 'created_at'],
    ints: new Set(['supported', 'created_at']) },
  { name: 'follows', pk: ['follower_email', 'followee_email'], hasUpdatedAt: false,
    cols: ['follower_email', 'followee_email', 'created_at'],
    ints: new Set(['created_at']) },
  { name: 'waitlist', pk: ['email'], hasUpdatedAt: false,
    cols: ['email', 'created_at'], ints: new Set(['created_at']) },
  // In-app bug reports. `status` is human-editable in the Airtable grid (triage),
  // so an inbound pull writes it back to D1 — that's the "field and filter" loop.
  { name: 'bug_report', pk: ['id'], hasUpdatedAt: false,
    cols: ['id', 'user_email', 'note', 'view', 'url', 'user_agent', 'viewport',
           'screenshot_url', 'status', 'created_at'],
    ints: new Set(['created_at']) },
];

export const tableByName = (n: string) => TABLES.find((t) => t.name === n);

export function airtableEnabled(env: Env): boolean {
  return !!(env.AIRTABLE_PAT && env.AIRTABLE_BASE_ID);
}

type Row = Record<string, any>;

const keyOf = (t: SyncTable, row: Row) => t.pk.map((c) => String(row[c] ?? '')).join('|');

// Stable string of the syncable values, so D1 and Airtable hash identically.
const canonical = (t: SyncTable, row: Row) =>
  t.cols.map((c) => { const v = row[c]; return v == null ? '' : String(v); }).join('␟');

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// D1 row → Airtable fields. Text cols send '' for null; number cols send null.
function toFields(t: SyncTable, row: Row, hash: string): Record<string, unknown> {
  const f: Record<string, unknown> = { key: keyOf(t, row), sync_hash: hash };
  for (const c of t.cols) {
    const v = row[c];
    f[c] = t.ints.has(c) ? (v == null ? null : v) : (v == null ? '' : String(v));
  }
  return f;
}

// Airtable fields → normalized D1 row ('' → null, numbers coerced, emails lowered).
// Returns null if any PK column is missing.
function fromFields(t: SyncTable, f: Record<string, any>): Row | null {
  const row: Row = {};
  for (const c of t.cols) {
    const v = f[c];
    if (t.ints.has(c)) row[c] = (v === '' || v == null || !Number.isFinite(Number(v))) ? null : Math.trunc(Number(v));
    else row[c] = (v === '' || v == null) ? null : String(v);
    if (c.endsWith('email') && typeof row[c] === 'string') row[c] = row[c].toLowerCase();
  }
  for (const k of t.pk) if (row[k] == null || row[k] === '') return null;
  return row;
}

const api = (env: Env, table: string, suffix = '') =>
  `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}${suffix}`;
const headers = (env: Env) => ({ Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' });

// ── Outbound: D1 → Airtable ──────────────────────────────────────────────────

// Upsert one row into Airtable, merging on `key`. Safe to call fire-and-forget.
export async function pushRow(env: Env, table: string, row: Row): Promise<void> {
  const t = tableByName(table);
  if (!airtableEnabled(env) || !t) return;
  const hash = await sha256(canonical(t, row));
  const res = await fetch(api(env, table), {
    method: 'PATCH',
    headers: headers(env),
    body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ['key'] }, typecast: true,
      records: [{ fields: toFields(t, row, hash) }] }),
  });
  if (!res.ok) console.error('airtable push failed', table, res.status, await res.text().catch(() => ''));
}

// Upsert many rows at once (chunks of 10 per Airtable PATCH). Used by the catalog
// materialization, which writes a whole show's episodes in one go.
export async function pushRows(env: Env, table: string, rows: Row[]): Promise<void> {
  const t = tableByName(table);
  if (!airtableEnabled(env) || !t || !rows.length) return;
  const records: { fields: Record<string, unknown> }[] = [];
  for (const r of rows) records.push({ fields: toFields(t, r, await sha256(canonical(t, r))) });
  for (let i = 0; i < records.length; i += 10) {
    const res = await fetch(api(env, table), {
      method: 'PATCH', headers: headers(env),
      body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ['key'] }, typecast: true, records: records.slice(i, i + 10) }),
    });
    if (!res.ok) console.error('airtable pushRows failed', table, res.status, await res.text().catch(() => ''));
  }
}

// Delete a row from Airtable by composite key (find then delete).
export async function deleteRow(env: Env, table: string, key: string): Promise<void> {
  const t = tableByName(table);
  if (!airtableEnabled(env) || !t) return;
  const formula = `{key}='${key.replace(/'/g, "\\'")}'`;
  const find = await fetch(api(env, table, `?filterByFormula=${encodeURIComponent(formula)}&pageSize=1`), { headers: headers(env) });
  if (!find.ok) return;
  const data = await find.json<{ records?: { id: string }[] }>();
  const id = data.records?.[0]?.id;
  if (!id) return;
  await fetch(api(env, table, `?records[]=${id}`), { method: 'DELETE', headers: headers(env) });
}

// Build the composite key from a row's PK values (for delete callers).
export const rowKey = (table: string, row: Row) => {
  const t = tableByName(table);
  return t ? keyOf(t, row) : '';
};

// ── Inbound: Airtable → D1 ───────────────────────────────────────────────────

interface AtRecord { id: string; fields: Record<string, any> }

async function listAll(env: Env, table: string): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  do {
    const res = await fetch(api(env, table, `?pageSize=100${offset ? `&offset=${offset}` : ''}`), { headers: headers(env) });
    if (!res.ok) { console.error('airtable list failed', table, res.status); break; }
    const data = await res.json<{ records: AtRecord[]; offset?: string }>();
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

// Write a pulled row into D1. created_at is insert-only (never clobbered); other
// NOT NULL columns fall back; updated_at (if any) is stamped now so the row wins
// as the newest write. FK violations (unknown user_email) are caught and skipped.
// Returns the effective row (for re-push) or null if skipped.
async function writeToD1(env: Env, t: SyncTable, row: Row): Promise<Row | null> {
  const eff: Row = { ...row };
  if (t.hasUpdatedAt) eff.updated_at = Date.now();
  for (const c of t.cols) {
    if (eff[c] != null) continue;
    if (c === 'created_at') eff[c] = Date.now();
    else if (`${t.name}.${c}` in NN_DEFAULT) eff[c] = NN_DEFAULT[`${t.name}.${c}`];
  }
  const setCols = t.cols.filter((c) => !t.pk.includes(c) && c !== 'created_at'); // created_at: insert-only
  const sql = `INSERT INTO ${t.name} (${t.cols.join(',')}) VALUES (${t.cols.map(() => '?').join(',')})
     ON CONFLICT(${t.pk.join(',')}) DO UPDATE SET ${setCols.map((c) => `${c}=excluded.${c}`).join(', ')}`;
  try {
    await env.DB.prepare(sql).bind(...t.cols.map((c) => eff[c] ?? null)).run();
    return eff;
  } catch (e) { console.error('d1 write failed', t.name, keyOf(t, row), e); return null; }
}

// Pull human edits from Airtable into D1 across every synced table.
export async function pullChanges(env: Env): Promise<Record<string, { scanned: number; pulled: number; skipped: number }>> {
  const summary: Record<string, { scanned: number; pulled: number; skipped: number }> = {};
  if (!airtableEnabled(env)) return summary;
  for (const t of TABLES) {
    let pulled = 0, skipped = 0;
    const records = await listAll(env, t.name);
    for (const rec of records) {
      const row = fromFields(t, rec.fields);
      if (!row) { skipped++; continue; }
      const liveHash = await sha256(canonical(t, row));
      if (liveHash === (rec.fields.sync_hash || '').toString()) { skipped++; continue; } // our echo
      const eff = await writeToD1(env, t, row);                                          // human edit → D1
      if (eff) { await pushRow(env, t.name, eff); pulled++; } else skipped++;            // re-push resyncs hash
    }
    summary[t.name] = { scanned: records.length, pulled, skipped };
  }
  return summary;
}

// Backfill every D1 row of every synced table into Airtable (initial seed / reconcile).
export async function pushAll(env: Env): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!airtableEnabled(env)) return out;
  for (const t of TABLES) {
    try {
      const rows = await env.DB.prepare(`SELECT ${t.cols.join(', ')} FROM ${t.name}`).all<Row>();
      const list = rows.results || [];
      // Batched (10 rows / Airtable request) so a full backfill stays well under the
      // Worker subrequest cap — per-row pushRow blew past it (one request per row).
      await pushRows(env, t.name, list);
      out[t.name] = list.length;
    } catch (e) {
      console.error('pushAll table failed', t.name, e);
      out[t.name] = -1;   // surfaced in the response so a partial run is visible
    }
  }
  return out;
}

// ── Manual control routes (admin) ────────────────────────────────────────────
// Guarded by SYNC_ADMIN_TOKEN so they aren't open to the world.

export const syncRoutes = new Hono<{ Bindings: Env }>();

const authed = (c: any): boolean => {
  const t = c.env.SYNC_ADMIN_TOKEN;
  return !!t && (c.req.header('authorization') || '') === `Bearer ${t}`;
};

syncRoutes.get('/status', (c) =>
  c.json({ airtable: airtableEnabled(c.env), tables: TABLES.map((t) => t.name), base: c.env.AIRTABLE_BASE_ID ? 'set' : 'unset' }));

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
