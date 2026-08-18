import { Hono } from 'hono';
import type { Env } from '../types';

// WoW in-season scheduler state (Spec v1.0). Reads/writes ONLY the scheduler DB
// (SCHED_DB / pangolinrc-scheduler); the legacy pangolin-rc DB is never touched here.
// Stores the minimum: manual mode choices, the two-strike consent counters, the
// profile default, and (later) badges + sent-flags. Phase, countdown, derived
// watchMode, and the TAG are all computed client-side from TVMaze airstamps.
export const schedulerRoutes = new Hono<{ Bindings: Env }>();

const MODES = ['LIVE', 'FRESH', 'CASUAL', 'MORE!'];   // DECLINED handled separately; null = auto

type UserRow = {
  user_email: string; declined_count: number; positive_interaction: number;
  global_kill: number; default_mode: string | null; updated_at: number;
};

async function loadUser(env: Env, email: string): Promise<UserRow> {
  const row = await env.SCHED_DB
    .prepare('SELECT * FROM sched_user WHERE user_email = ?').bind(email).first<UserRow>();
  return row ?? { user_email: email, declined_count: 0, positive_interaction: 0, global_kill: 0, default_mode: null, updated_at: 0 };
}
async function saveUser(env: Env, u: UserRow) {
  await env.SCHED_DB.prepare(
    `INSERT INTO sched_user (user_email, declined_count, positive_interaction, global_kill, default_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_email) DO UPDATE SET declined_count=excluded.declined_count,
       positive_interaction=excluded.positive_interaction, global_kill=excluded.global_kill,
       default_mode=excluded.default_mode, updated_at=excluded.updated_at`
  ).bind(u.user_email, u.declined_count, u.positive_interaction, u.global_kill, u.default_mode, Date.now()).run();
}

// GET /scheduler/state?email=  → everything the client needs to render chips.
schedulerRoutes.get('/state', async (c) => {
  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!email) return c.json({ error: 'email required' }, 400);
  const u = await loadUser(c.env, email);
  const { results } = await c.env.SCHED_DB
    .prepare('SELECT show_id, mode FROM sched_mode_choice WHERE user_email = ? AND mode IS NOT NULL')
    .bind(email).all<{ show_id: string; mode: string }>();
  const modes: Record<string, string> = {};
  for (const r of results || []) modes[r.show_id] = r.mode;
  // Drops the member has already asked to be notified about, so Pierre doesn't
  // re-offer "Notify me" for a flag they already set. Key = `${show_id}|${episodeId}`.
  const sent = await c.env.SCHED_DB
    .prepare("SELECT show_id, key FROM sched_sent WHERE user_email = ? AND kind = 'notify'")
    .bind(email).all<{ show_id: string; key: string }>();
  const notified = (sent.results || []).map((r) => `${r.show_id}|${r.key}`);
  return c.json({
    user: { declinedCount: u.declined_count, positiveInteraction: !!u.positive_interaction,
            globalKill: !!u.global_kill, defaultMode: u.default_mode },
    modes,
    notified,
  });
});

// POST /scheduler/mode  { email, showId, mode }  mode in LIVE|FRESH|CASUAL|MORE!|DECLINED|null.
// Applies the two-strike consent rule (server-authoritative).
schedulerRoutes.post('/mode', async (c) => {
  const b = await c.req.json().catch(() => ({} as any));
  const email = (b.email || '').trim().toLowerCase();
  const showId = (b.showId || '').trim();
  const mode: string | null = b.mode == null ? null : String(b.mode);
  if (!email || !showId) return c.json({ error: 'email and showId required' }, 400);
  if (mode !== null && mode !== 'DECLINED' && !MODES.includes(mode)) return c.json({ error: 'bad mode' }, 400);

  const u = await loadUser(c.env, email);

  if (mode === null) {
    // cleared back to auto — remove the row
    await c.env.SCHED_DB.prepare('DELETE FROM sched_mode_choice WHERE user_email = ? AND show_id = ?').bind(email, showId).run();
  } else {
    await c.env.SCHED_DB.prepare(
      `INSERT INTO sched_mode_choice (user_email, show_id, mode, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_email, show_id) DO UPDATE SET mode=excluded.mode, updated_at=excluded.updated_at`
    ).bind(email, showId, mode, Date.now()).run();
  }

  if (mode === 'DECLINED') {
    // Two-strike: a DECLINED only counts toward the GLOBAL kill when the user has no
    // positive interactions on file; otherwise it's a per-show preference.
    if (!u.positive_interaction && !u.global_kill) {
      u.declined_count += 1;
      if (u.declined_count >= 2) u.global_kill = 1;
    }
  } else if (mode !== null) {
    u.positive_interaction = 1;   // manually claiming a mode is positive engagement
  }
  await saveUser(c.env, u);
  return c.json({
    user: { declinedCount: u.declined_count, positiveInteraction: !!u.positive_interaction,
            globalKill: !!u.global_kill, defaultMode: u.default_mode },
    showId, mode,
  });
});

// POST /scheduler/default  { email, mode }  — the profile default chip (mode|null).
schedulerRoutes.post('/default', async (c) => {
  const b = await c.req.json().catch(() => ({} as any));
  const email = (b.email || '').trim().toLowerCase();
  const mode: string | null = b.mode == null ? null : String(b.mode);
  if (!email) return c.json({ error: 'email required' }, 400);
  if (mode !== null && !MODES.includes(mode)) return c.json({ error: 'bad mode' }, 400);
  const u = await loadUser(c.env, email);
  u.default_mode = mode;
  if (mode !== null) u.positive_interaction = 1;
  await saveUser(c.env, u);
  return c.json({ defaultMode: u.default_mode });
});

// POST /scheduler/notify  { email, showId, episodeId }  — "flag it when it's out".
// Stores the intent (surfaced in-app now via the RAMP nudge / Sentry; real APNs push
// in v1.1 reads the same rows). Counts as a positive interaction (two-strike exception).
schedulerRoutes.post('/notify', async (c) => {
  const b = await c.req.json().catch(() => ({} as any));
  const email = (b.email || '').trim().toLowerCase();
  const showId = (b.showId || '').trim();
  const episodeId = ((b.episodeId || '') + '').trim() || 'next';
  if (!email || !showId) return c.json({ error: 'email and showId required' }, 400);
  await c.env.SCHED_DB.prepare(
    `INSERT INTO sched_sent (user_email, show_id, kind, key, sent_at) VALUES (?, ?, 'notify', ?, ?)
     ON CONFLICT(user_email, show_id, kind, key) DO UPDATE SET sent_at=excluded.sent_at`
  ).bind(email, showId, episodeId, Date.now()).run();
  const u = await loadUser(c.env, email); u.positive_interaction = 1; await saveUser(c.env, u);
  return c.json({ ok: true });
});

// POST /scheduler/reenable  { email }  — turn the classifier back on (from profile).
// Clears the global kill and the decline counter; watch logging never stopped, so
// accurate modes return immediately from the classifier.
schedulerRoutes.post('/reenable', async (c) => {
  const b = await c.req.json().catch(() => ({} as any));
  const email = (b.email || '').trim().toLowerCase();
  if (!email) return c.json({ error: 'email required' }, 400);
  const u = await loadUser(c.env, email);
  u.global_kill = 0; u.declined_count = 0;
  await saveUser(c.env, u);
  return c.json({ ok: true });
});
