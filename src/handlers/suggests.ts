import { Hono } from 'hono';
import type { Env } from '../types';

// ─── Pierre Suggests ─────────────────────────────────────────────────────────
// The "want to watch, not started" home that the nav restructure lost (SHELF -> STACK
// = owned media, QUEUE = currently watching). A title lands here ONLY when the member
// saves Pierre's game pick with "Save for later"; from here they Watch now (-> QUEUE)
// or Dismiss. Every game outcome (saved / started / dismissed / seen) also drops a
// derived signal into pierre_suggest_events so the saved-to-started hit rate is a
// single-table read. SEAM:identity — email is the key, owner-scoped, no auth here.
export const suggestRoutes = new Hono<{ Bindings: Env }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lc = (s: string) => s.trim().toLowerCase();
// A pick's home platform, inferred from its resolved id ('tvmaze:123' | 'tmdb:456').
const sourceOf = (titleId: string) =>
  titleId.startsWith('tvmaze:') ? 'tvmaze' : titleId.startsWith('tmdb:') ? 'tmdb' : '';

// Append one derived signal. Never stores raw chat — only the shape of the outcome.
async function logEvent(
  env: Env,
  email: string,
  kind: 'saved' | 'started' | 'dismissed' | 'seen',
  f: {
    title_id?: string | null;
    title_name?: string;
    title_source?: string;
    seed_a?: string;
    seed_b?: string;
    dismiss_source?: string;
    time_since_saved_ms?: number | null;
    pre_app?: boolean;
    rank?: number | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pierre_suggest_events
       (id, user_email, kind, title_id, title_name, title_source, seed_a, seed_b,
        dismiss_source, time_since_saved_ms, pre_app, rank, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(), email, kind, f.title_id || null, str(f.title_name || '', 200),
      str(f.title_source || '', 12), str(f.seed_a || '', 200), str(f.seed_b || '', 200),
      str(f.dismiss_source || '', 12),
      typeof f.time_since_saved_ms === 'number' ? Math.max(0, Math.trunc(f.time_since_saved_ms)) : null,
      f.pre_app ? 1 : 0,
      typeof f.rank === 'number' && Number.isFinite(f.rank) ? Math.min(10, Math.max(0, Math.trunc(f.rank))) : null,
      Date.now(),
    )
    .run();
}

// GET /suggests/:email — the saved picks, newest first. Powers the Pierre Suggests list.
suggestRoutes.get('/:email', async (c) => {
  const email = lc(c.req.param('email'));
  if (!EMAIL_RE.test(email)) return c.json({ error: 'bad email' }, 400);
  const rows = await c.env.DB.prepare(
    `SELECT id, title_id, title_name, poster, title_source, seed_a, seed_b, created_at
       FROM pierre_suggests WHERE user_email = ? ORDER BY created_at DESC`,
  ).bind(email).all();
  return c.json({ suggests: rows.results || [] });
});

// POST /suggests — save a game pick for later. { email, title_id?, title_name, poster?,
// seed_a?, seed_b? }. Upserts on (user, title) so a re-save never duplicates a row, and
// records the "suggestion saved" signal.
suggestRoutes.post('/', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad json' }, 400); }
  const email = lc(str(body.email, 120));
  const title_name = str(body.title_name, 200);
  if (!EMAIL_RE.test(email) || !title_name) return c.json({ error: 'email and title_name required' }, 400);
  const title_id = str(body.title_id, 60) || null;
  const source = title_id ? sourceOf(title_id) : '';
  const seed_a = str(body.seed_a, 200), seed_b = str(body.seed_b, 200);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO pierre_suggests
       (id, user_email, title_id, title_name, poster, title_source, seed_a, seed_b, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_email, title_name) DO UPDATE SET
       title_id     = COALESCE(excluded.title_id, pierre_suggests.title_id),
       poster       = CASE WHEN excluded.poster <> '' THEN excluded.poster ELSE pierre_suggests.poster END,
       title_source = CASE WHEN excluded.title_source <> '' THEN excluded.title_source ELSE pierre_suggests.title_source END,
       created_at   = excluded.created_at`,
  ).bind(crypto.randomUUID(), email, title_id, title_name, str(body.poster, 400), source, seed_a, seed_b, now).run();
  await logEvent(c.env, email, 'saved', { title_id, title_name, title_source: source, seed_a, seed_b });
  return c.json({ ok: true });
});

// POST /suggests/:id/start — a saved pick moved to QUEUE (currently watching). The client
// hands the title into the normal put-on flow; this removes the Suggests row and records
// the "suggestion started" signal (with time since it was saved — that gap IS Pierre's
// hit rate). :id may be the row id or the title_id, so the client need not carry both.
suggestRoutes.post('/:email/:id/start', async (c) => {
  const email = lc(c.req.param('email'));
  const id = c.req.param('id');
  if (!EMAIL_RE.test(email)) return c.json({ error: 'bad email' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT id, title_id, title_name, title_source, seed_a, seed_b, created_at
       FROM pierre_suggests WHERE user_email = ? AND (id = ? OR title_id = ?)`,
  ).bind(email, id, id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('DELETE FROM pierre_suggests WHERE id = ?').bind(row.id).run();
  await logEvent(c.env, email, 'started', {
    title_id: row.title_id, title_name: row.title_name, title_source: row.title_source,
    seed_a: row.seed_a, seed_b: row.seed_b, time_since_saved_ms: Date.now() - row.created_at,
  });
  return c.json({ ok: true });
});

// DELETE /suggests/:email/:id — drop a saved pick. source 'suggests' = interest faded after
// saving (time_since_saved set). Removes the row and records the "suggestion dismissed" signal.
suggestRoutes.delete('/:email/:id', async (c) => {
  const email = lc(c.req.param('email'));
  const id = c.req.param('id');
  if (!EMAIL_RE.test(email)) return c.json({ error: 'bad email' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT id, title_id, title_name, title_source, seed_a, seed_b, created_at
       FROM pierre_suggests WHERE user_email = ? AND (id = ? OR title_id = ?)`,
  ).bind(email, id, id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('DELETE FROM pierre_suggests WHERE id = ?').bind(row.id).run();
  await logEvent(c.env, email, 'dismissed', {
    title_id: row.title_id, title_name: row.title_name, title_source: row.title_source,
    seed_a: row.seed_a, seed_b: row.seed_b, dismiss_source: 'suggests',
    time_since_saved_ms: Date.now() - row.created_at,
  });
  return c.json({ ok: true });
});

// POST /suggests/event — a game outcome that does NOT create a Suggests row: "Not for me"
// (dismissed on the spot, source 'game', no time-since-saved) or "Seen it" (pre_app watch,
// optional 0..10 rank). { email, kind: 'dismissed'|'seen', title_id?, title_name, seed_a?,
// seed_b?, rank? }. Save ("saved") goes through POST /suggests, start through /:id/start.
suggestRoutes.post('/event', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad json' }, 400); }
  const email = lc(str(body.email, 120));
  const kind = str(body.kind, 12);
  const title_name = str(body.title_name, 200);
  if (!EMAIL_RE.test(email) || !title_name) return c.json({ error: 'email and title_name required' }, 400);
  if (kind !== 'dismissed' && kind !== 'seen') return c.json({ error: 'kind must be dismissed or seen' }, 400);
  const title_id = str(body.title_id, 60) || null;
  const source = title_id ? sourceOf(title_id) : '';
  const common = {
    title_id, title_name, title_source: source,
    seed_a: str(body.seed_a, 200), seed_b: str(body.seed_b, 200),
  };
  if (kind === 'dismissed') {
    // source 'game' = Pierre missed on the spot; no time-since-saved (it was never saved).
    await logEvent(c.env, email, 'dismissed', { ...common, dismiss_source: 'game' });
  } else {
    const rank = typeof body.rank === 'number' ? body.rank : null;
    await logEvent(c.env, email, 'seen', { ...common, pre_app: true, rank });
  }
  return c.json({ ok: true });
});
