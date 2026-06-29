import { Hono } from 'hono';
import type { Env } from '../types';
import { pushRow, pushRows } from './airtable';
import { fetchTmdbMovie } from './tmdb';

// ─── Shared catalog + server-side materialization ────────────────────────────
//
// The episode (or movie) is the unit. When a member starts a title, the server
// fetches its episode list once (TVmaze / TMDB), writes the shared catalog
// (titles + episodes, linked in canonical air order), and eagerly creates a
// per-user watch_episode row for every episode. The catalog is deduped: a title
// already present is reused, not re-fetched.

export const catalogRoutes = new Hono<{ Bindings: Env }>();

export interface EpisodeRow {
  episode_id: string; title_id: string; season: number | null; number: number | null;
  name: string | null; runtime: number | null; airdate: string | null; summary: string | null;
  next_episode_id: string | null; updated_at: number;
}

const epId = (titleId: string, season: number, number: number) => `${titleId}:s${season}e${number}`;
const released = (airdate: string | null, now: number) => !!airdate && new Date(airdate + 'T23:59:59').getTime() <= now;

// TVmaze summaries arrive as HTML (`<p>…</p>`); TMDB overviews are plain text.
// Strip tags + collapse whitespace so the same field renders cleanly everywhere.
export const cleanSummary = (s: unknown) =>
  (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '') || null;

// Normalize a request into { source, ref, titleId }. Accepts a prefixed title_id
// ('tvmaze:81110' / 'tmdb:123') or an explicit { source, ref }. Bare ids = tvmaze.
function resolveRef(body: any): { source: string; ref: string; titleId: string } | null {
  let source = typeof body.source === 'string' ? body.source : '';
  let ref = body.ref != null ? String(body.ref) : '';
  const tid = body.title_id != null ? String(body.title_id) : '';
  if (tid.includes(':')) { const i = tid.indexOf(':'); source = tid.slice(0, i); ref = tid.slice(i + 1); }
  else if (tid) { source = source || 'tvmaze'; ref = tid; }
  source = source === 'tmdb' ? 'tmdb' : 'tvmaze';
  ref = ref.replace(/^tmdb:|^tvmaze:/, '').trim();
  if (!ref) return null;
  return { source, ref, titleId: `${source}:${ref}` };
}

// Read a title's episodes from D1 in canonical (air) order.
export async function loadEpisodes(env: Env, titleId: string): Promise<EpisodeRow[]> {
  const rows = await env.DB.prepare(
    `SELECT episode_id, title_id, season, number, name, runtime, airdate, summary, next_episode_id, updated_at
       FROM episodes WHERE title_id = ? ORDER BY season, number`).bind(titleId).all<EpisodeRow>();
  return rows.results || [];
}

// Ensure titles + episodes exist for a title (shared, deduped). Returns the ordered
// episode rows and whether the catalog was freshly created (→ mirror it).
async function materializeTitle(env: Env, source: string, ref: string, titleId: string):
  Promise<{ episodes: EpisodeRow[]; titleRow: any; created: boolean } | null> {
  const existing = await env.DB.prepare('SELECT * FROM titles WHERE title_id = ?').bind(titleId).first<any>();
  if (existing) return { episodes: await loadEpisodes(env, titleId), titleRow: existing, created: false };

  const now = Date.now();
  let titleRow: any;
  let epInputs: { season: number; number: number; name: string; runtime: number | null; airdate: string | null; summary: string | null }[] = [];

  if (source === 'tmdb') {
    const m = await fetchTmdbMovie(env, ref);
    if (!m) return null;
    titleRow = { title_id: titleId, source, name: m.title || '', kind: 'movie', status: 'Film',
      poster: m.poster || null, platform: '', total_episodes: 1, summary: cleanSummary(m.overview),
      premiered: m.year ? `${m.year}-01-01` : null, updated_at: now };
    epInputs = [{ season: 1, number: 1, name: m.title || '', runtime: m.runtime || 120,
      airdate: m.year ? `${m.year}-01-01` : null, summary: cleanSummary(m.overview) }];
  } else {
    let show: any;
    try {
      const r = await fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(ref)}?embed=episodes`);
      if (!r.ok) return null;
      show = await r.json();
    } catch { return null; }
    const eps = ((show._embedded && show._embedded.episodes) || [])
      .filter((e: any) => e.season >= 1)
      .sort((a: any, b: any) => a.season - b.season || a.number - b.number);
    titleRow = { title_id: titleId, source, name: show.name || '', kind: 'show', status: show.status || 'Unknown',
      poster: (show.image && (show.image.original || show.image.medium)) || null,
      platform: (show.webChannel && show.webChannel.name) || (show.network && show.network.name) || '',
      total_episodes: eps.length, summary: cleanSummary(show.summary), premiered: show.premiered || null, updated_at: now };
    epInputs = eps.map((e: any) => ({ season: e.season, number: e.number, name: e.name || '',
      runtime: e.runtime || null, airdate: e.airdate || null, summary: cleanSummary(e.summary) }));
  }

  // Build episode rows with canonical next_episode_id links (NULL on the finale).
  const episodes: EpisodeRow[] = epInputs.map((e, i) => {
    const nxt = epInputs[i + 1];
    return {
      episode_id: epId(titleId, e.season, e.number), title_id: titleId,
      season: e.season, number: e.number, name: e.name, runtime: e.runtime, airdate: e.airdate, summary: e.summary,
      next_episode_id: nxt ? epId(titleId, nxt.season, nxt.number) : null,
      updated_at: now,
    };
  });

  const stmts = [
    env.DB.prepare(`INSERT OR REPLACE INTO titles
      (title_id, source, name, kind, status, poster, platform, total_episodes, summary, premiered, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(titleRow.title_id, titleRow.source, titleRow.name, titleRow.kind,
        titleRow.status, titleRow.poster, titleRow.platform, titleRow.total_episodes, titleRow.summary, titleRow.premiered, titleRow.updated_at),
    ...episodes.map((e) => env.DB.prepare(`INSERT OR REPLACE INTO episodes
      (episode_id, title_id, season, number, name, runtime, airdate, summary, next_episode_id, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(e.episode_id, e.title_id, e.season, e.number, e.name, e.runtime,
        e.airdate, e.summary, e.next_episode_id, e.updated_at)),
  ];
  await env.DB.batch(stmts);
  return { episodes, titleRow, created: true };
}

// Lazy backfill: titles materialized before the `summary` column existed have a
// NULL summary. On the next detail read we fetch it once from the source and
// persist it, so old shows pick up a synopsis without a bulk migration. Best
// effort — returns the (possibly still-null) summary; never throws.
export async function ensureTitleSummary(env: Env, titleId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT source, summary FROM titles WHERE title_id = ?').bind(titleId).first<any>();
  if (!row) return null;
  if (row.summary != null) return row.summary;          // already filled (incl. '' if upstream had none)
  const i = titleId.indexOf(':');
  const ref = i >= 0 ? titleId.slice(i + 1) : titleId;
  let summary: string | null = null;
  try {
    if (row.source === 'tmdb') {
      const m = await fetchTmdbMovie(env, ref);
      summary = cleanSummary(m?.overview);
    } else {
      const r = await fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(ref)}`);
      if (r.ok) summary = cleanSummary(((await r.json()) as any).summary);
    }
  } catch { return row.summary; }
  // Persist even an empty string so we don't re-fetch a title that genuinely has
  // no synopsis. Skip the write only if the lookup itself failed (summary null).
  if (summary != null) {
    await env.DB.prepare('UPDATE titles SET summary = ? WHERE title_id = ?').bind(summary, titleId).run();
  }
  return summary;
}

// POST /catalog/initiate — materialize a title for a member at a watch pattern.
catalogRoutes.post('/initiate', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  if (!email) return c.json({ error: 'email required' }, 400);
  const exists = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!exists) return c.json({ error: 'unknown user' }, 404);
  const ref = resolveRef(body);
  if (!ref) return c.json({ error: 'title_id or source+ref required' }, 400);
  const pattern = body.pattern || { kind: 'beginning' };

  const mat = await materializeTitle(c.env, ref.source, ref.ref, ref.titleId);
  if (!mat || !mat.episodes.length) return c.json({ error: 'could not load title' }, 502);
  const { episodes, titleRow } = mat;
  const now = Date.now();

  // Seed initial done state from the pattern.
  let doneThru = -1;                                  // index up to which episodes count as done
  let bpThru = -1;                                    // ...of which, how many count as BP (Before Pierre)
  let currentIdx = 0;
  if (pattern.kind === 'live') {
    episodes.forEach((e, i) => { if (released(e.airdate, now)) doneThru = i; });
    currentIdx = Math.min(doneThru + 1, episodes.length - 1);
  } else if (pattern.kind === 'resume' && pattern.season) {
    // Resume = pick up where you left off: the earlier episodes were watched on Pierre.
    const idx = episodes.findIndex((e) => e.season === pattern.season && e.number === pattern.number);
    if (idx >= 0) { doneThru = idx - 1; currentIdx = idx; }
  } else if (pattern.kind === 'at' && pattern.season) {
    // "Watch from this episode": dropping into the middle. Every earlier season and
    // episode is recorded individually as BP (Before Pierre) — done, but not a watch
    // Pierre tracked — and we begin at the requested one.
    const idx = episodes.findIndex((e) => e.season === pattern.season && e.number === pattern.number);
    if (idx >= 0) { doneThru = idx - 1; bpThru = idx - 1; currentIdx = idx; }
  } // 'beginning' / default: nothing done, current = first

  const wtStatus = 'current';
  const curEp = episodes[currentIdx];
  const currentEp = curEp ? curEp.episode_id : null;

  const weRows = episodes.map((e, i) => ({
    user_email: email, episode_id: e.episode_id, title_id: ref.titleId,
    show_name: titleRow.name, episode_name: e.name,
    done: i <= doneThru ? 1 : 0, minute: i <= doneThru ? (e.runtime || 0) : 0,
    bp: i <= bpThru ? 1 : 0,
    sessions: null as string | null, updated_at: now,
  }));

  const stmts = [
    // First initiate inserts; a re-initiate of an already-tracked title leaves the
    // member's existing bucket/progress untouched (DO NOTHING).
    c.env.DB.prepare(`INSERT INTO watch_title
      (user_email, title_id, show_name, status, active_map_id, current_episode_id, started_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(user_email, title_id) DO NOTHING`)
      .bind(email, ref.titleId, titleRow.name, wtStatus, null, currentEp, now, now),
    ...weRows.map((w) => c.env.DB.prepare(`INSERT INTO watch_episode
      (user_email, episode_id, title_id, show_name, episode_name, done, minute, bp, sessions, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_email, episode_id) DO NOTHING`)   // never clobber existing progress on re-initiate
      .bind(w.user_email, w.episode_id, w.title_id, w.show_name, w.episode_name, w.done, w.minute, w.bp, w.sessions, w.updated_at)),
  ];
  await c.env.DB.batch(stmts);

  // Mirror to Airtable (fire-and-forget): the catalog only when freshly created.
  const wtRow = { user_email: email, title_id: ref.titleId, show_name: titleRow.name, status: wtStatus,
    active_map_id: null, current_episode_id: currentEp, started_at: now, updated_at: now };
  c.executionCtx.waitUntil((async () => {
    if (mat.created) { await pushRow(c.env, 'titles', titleRow); await pushRows(c.env, 'episodes', episodes); }
    await pushRow(c.env, 'watch_title', wtRow);
    await pushRows(c.env, 'watch_episode', weRows);
  })().catch((e) => console.error('airtable initiate mirror', e)));

  return c.json({ title_id: ref.titleId, kind: titleRow.kind, episodes: episodes.length, current_episode_id: currentEp });
});

// GET /catalog/titles/:title_id/episodes — canonical episode list (no user state).
catalogRoutes.get('/titles/:title_id/episodes', async (c) => {
  const titleId = c.req.param('title_id');
  const title = await c.env.DB.prepare('SELECT * FROM titles WHERE title_id = ?').bind(titleId).first();
  if (!title) return c.json({ error: 'not found' }, 404);
  return c.json({ title, episodes: await loadEpisodes(c.env, titleId) });
});
