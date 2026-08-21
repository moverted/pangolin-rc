import { Hono } from 'hono';
import type { Env } from '../types';
import { fetchTmdbMovie, fetchTmdbTvRuntime, searchAll } from './tmdb';

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
    // Real theatrical release date drives the theater "freshness" badge (HOT/FRESH/CASUAL);
    // fall back to Jan 1 of the year only when TMDB has no full date.
    const relDate = m.release_date || (m.year ? `${m.year}-01-01` : null);
    titleRow = { title_id: titleId, source, name: m.title || '', kind: 'movie', status: 'Film',
      poster: m.poster || null, platform: '', total_episodes: 1, summary: cleanSummary(m.overview),
      premiered: relDate, updated_at: now };
    epInputs = [{ season: 1, number: 1, name: m.title || '', runtime: m.runtime || 120,
      airdate: relDate, summary: cleanSummary(m.overview) }];
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
    // NOTE: a title is materialized ONCE, so episodes not yet aired at ingest carry
    // whatever TVmaze had then — commonly runtime:null (and placeholder "Episode N"
    // names). Those don't self-heal; they need a per-episode backfill from TVmaze once
    // the episode airs. See BACKEND.md (Ted Lasso S4 runtime fix, 2026-08-14): E1-E3
    // were backfilled by hand; a scheduled cloud routine backfills E4/E5 as they air.
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

// Lazy backfill of a movie's real theatrical release date. Titles materialized before
// full release dates were stored carry a year-fallback (`YYYY-01-01`); when the freshness
// badge needs one (a ticketed film), re-fetch it once from TMDB and persist to both
// titles.premiered and the single episode's airdate. Best-effort; returns the date in use.
export async function ensureReleaseDate(env: Env, titleId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT source, kind, premiered FROM titles WHERE title_id = ?').bind(titleId).first<any>();
  if (!row || row.kind !== 'movie' || row.source !== 'tmdb') return row?.premiered ?? null;
  const cur: string | null = row.premiered;
  if (cur && !/-01-01$/.test(cur)) return cur;                 // already a real (non-Jan-1-fallback) date
  const i = titleId.indexOf(':');
  const ref = i >= 0 ? titleId.slice(i + 1) : titleId;
  let rel: string | null = null;
  try { const m = await fetchTmdbMovie(env, ref); rel = m?.release_date || null; } catch { return cur; }
  if (rel && rel !== cur) {
    await env.DB.batch([
      env.DB.prepare('UPDATE titles SET premiered = ? WHERE title_id = ?').bind(rel, titleId),
      env.DB.prepare('UPDATE episodes SET airdate = ? WHERE title_id = ?').bind(rel, titleId),
    ]);
    return rel;
  }
  return cur;
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

  return c.json({ title_id: ref.titleId, kind: titleRow.kind, episodes: episodes.length, current_episode_id: currentEp });
});

// File a bug into the admin review list (D1 is the source of truth).
// Used by the runtime-check below; no screenshot/email path — these are system-filed.
async function fileSystemBug(env: Env, note: string, view: string, email: string | null): Promise<void> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    id, user_email: email || null, note, view, url: null as string | null,
    user_agent: null as string | null, viewport: null as string | null,
    screenshot_url: null as string | null, status: 'new', send_to_claude: 0,
    claude_status: null as string | null, created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO bug_report (id, user_email, note, view, url, user_agent, viewport, screenshot_url, status, send_to_claude, claude_status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(row.id, row.user_email, row.note, row.view, row.url, row.user_agent, row.viewport,
         row.screenshot_url, row.status, row.send_to_claude, row.claude_status, row.created_at).run();
}

// POST /catalog/backfill — log something the member ALREADY watched as COMPLETED, backdated
// to `watched_at` (ms; the client computes noon local of the day they said). Works for a film
// (title_id 'tmdb:X', its one unit) or a series ('tvmaze:Y', every aired episode marked done).
// The client resolves the title, lets the member pick the right TILE (a film and a series can
// share a name), and passes the exact title_id here, so the server logs precisely what they
// chose and returns the truth. This is the reliable core: Pierre only confirms what landed.
catalogRoutes.post('/backfill', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const titleId = (typeof body.title_id === 'string' ? body.title_id : '').trim().slice(0, 120);
  const watchedAt = Number(body.watched_at) > 0 ? Math.trunc(Number(body.watched_at)) : Date.now();
  const rating = typeof body.rating === 'string' ? body.rating.trim().slice(0, 300) : '';
  if (!email || !titleId) return c.json({ error: 'email and title_id required' }, 400);
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!user) return c.json({ error: 'unknown user' }, 404);

  const source = titleId.startsWith('tvmaze:') ? 'tvmaze' : 'tmdb';
  const ref = titleId.slice(titleId.indexOf(':') + 1);
  const mat = await materializeTitle(c.env, source, ref, titleId);
  if (!mat || !mat.episodes.length) return c.json({ ok: false, reason: 'materialize_failed' });
  const isMovie = source === 'tmdb';
  // A film is its single unit; a series is every AIRED episode (that is what "finished" means).
  const eps = isMovie ? mat.episodes.slice(0, 1) : mat.episodes.filter((e) => !e.airdate || released(e.airdate, watchedAt));
  if (!eps.length) return c.json({ ok: false, reason: 'no_episode' });
  const last = eps[eps.length - 1]!;

  const epStmts = eps.map((e) => {
    const rt = e.runtime || 0;
    const session = JSON.stringify([{ minutes: rt, finished: true, bp: false, state: 'done',
      validated: true, startTs: watchedAt - rt * 60000, lastTs: watchedAt, finishTs: watchedAt }]);
    return c.env.DB.prepare(
      `INSERT INTO watch_episode (user_email, episode_id, title_id, show_name, episode_name, done, minute, bp, sessions, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
       ON CONFLICT(user_email, episode_id) DO UPDATE SET done=1, minute=excluded.minute, bp=0, sessions=excluded.sessions, updated_at=excluded.updated_at`,
    ).bind(email, e.episode_id, titleId, mat.titleRow.name, e.name || mat.titleRow.name, rt, session, watchedAt);
  });
  // Chunk the episode writes so a long series (hundreds of episodes) stays within batch limits.
  for (let i = 0; i < epStmts.length; i += 50) await c.env.DB.batch(epStmts.slice(i, i + 50));

  const tail: any[] = [
    c.env.DB.prepare(
      `INSERT INTO watch_title (user_email, title_id, show_name, status, current_episode_id, started_at, updated_at)
       VALUES (?, ?, ?, 'completed', ?, ?, ?)
       ON CONFLICT(user_email, title_id) DO UPDATE SET status='completed', current_episode_id=excluded.current_episode_id, updated_at=excluded.updated_at`,
    ).bind(email, titleId, mat.titleRow.name, last.episode_id, watchedAt, watchedAt),
  ];
  if (rating) {
    // A film anchors the reflection on its key; a series on its finale episode code.
    const refEp = isMovie ? '🎬' : ('S' + String(last.season ?? 1).padStart(2, '0') + 'E' + String(last.number ?? 1).padStart(2, '0'));
    tail.push(c.env.DB.prepare(
      `INSERT INTO watch_comment (id, user_email, episode_id, timestamp_ms, transcription, audio_r2_key, created_at, show_id, reply_to, transcript_edited, is_reflection, private, is_endnote, spoiler, reveal_on, hidden)
       VALUES (?, ?, ?, 0, ?, NULL, ?, ?, NULL, 0, 1, 0, 0, 0, NULL, 0)`,
    ).bind(crypto.randomUUID(), email, refEp, rating, watchedAt, titleId));
  }
  await c.env.DB.batch(tail);
  return c.json({ ok: true, title_id: titleId, name: mat.titleRow.name, kind: isMovie ? 'movie' : 'show', poster: mat.titleRow.poster || null, watched_at: watchedAt, episodes: eps.length });
});

// POST /catalog/backfill-episode — log ONE episode of an ongoing series as watched, backdated.
// This is the conversational-backfill target ("I watched the latest episode of Ted Lasso
// yesterday"): unlike /backfill (which marks a whole series COMPLETE), this marks just the
// named episode done and leaves the show IN PROGRESS at that episode. Resolves the target by
// explicit season+number, or — when omitted — the latest AIRED episode as of watched_at. The
// client shows the member a confirm chip with exactly this episode before calling, and this
// returns the resolved code so Pierre confirms only what landed.
catalogRoutes.post('/backfill-episode', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const titleId = (typeof body.title_id === 'string' ? body.title_id : '').trim().slice(0, 120);
  const watchedAt = Number(body.watched_at) > 0 ? Math.trunc(Number(body.watched_at)) : Date.now();
  const wantSeason = Number.isFinite(Number(body.season)) ? Number(body.season) : null;
  const wantNumber = Number.isFinite(Number(body.number)) ? Number(body.number) : null;
  const rating = typeof body.rating === 'string' ? body.rating.trim().slice(0, 300) : '';
  if (!email || !titleId) return c.json({ error: 'email and title_id required' }, 400);
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!user) return c.json({ error: 'unknown user' }, 404);

  const source = titleId.startsWith('tvmaze:') ? 'tvmaze' : 'tmdb';
  const ref = titleId.slice(titleId.indexOf(':') + 1);
  const mat = await materializeTitle(c.env, source, ref, titleId);
  if (!mat || !mat.episodes.length) return c.json({ ok: false, reason: 'materialize_failed' });

  // Explicit SxEy if given, else the latest episode aired as of the watch date.
  let ep = null as (typeof mat.episodes)[number] | null;
  if (wantSeason != null && wantNumber != null) {
    ep = mat.episodes.find((e) => e.season === wantSeason && e.number === wantNumber) || null;
  } else {
    const aired = mat.episodes.filter((e) => released(e.airdate, watchedAt));
    ep = aired.length ? aired[aired.length - 1]! : null;
  }
  if (!ep) return c.json({ ok: false, reason: 'no_episode' });

  const rt = ep.runtime || 0;
  const session = JSON.stringify([{ minutes: rt, finished: true, bp: false, state: 'done',
    validated: true, startTs: watchedAt - rt * 60000, lastTs: watchedAt, finishTs: watchedAt }]);
  await c.env.DB.prepare(
    `INSERT INTO watch_episode (user_email, episode_id, title_id, show_name, episode_name, done, minute, bp, sessions, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
     ON CONFLICT(user_email, episode_id) DO UPDATE SET done=1, minute=excluded.minute, bp=0, sessions=excluded.sessions, updated_at=excluded.updated_at`,
  ).bind(email, ep.episode_id, titleId, mat.titleRow.name, ep.name || mat.titleRow.name, rt, session, watchedAt).run();

  // Move the show's progress pointer to this episode and keep it in progress (NOT completed
  // — it's ongoing). On conflict we advance the pointer/timestamp but don't touch a status the
  // member (or the profile recompute) already set, so this never downgrades a finished show.
  await c.env.DB.prepare(
    `INSERT INTO watch_title (user_email, title_id, show_name, status, current_episode_id, started_at, updated_at)
     VALUES (?, ?, ?, 'current', ?, ?, ?)
     ON CONFLICT(user_email, title_id) DO UPDATE SET current_episode_id=excluded.current_episode_id, updated_at=excluded.updated_at`,
  ).bind(email, titleId, mat.titleRow.name, ep.episode_id, watchedAt, watchedAt).run();

  if (rating) {
    const refEp = 'S' + String(ep.season ?? 1).padStart(2, '0') + 'E' + String(ep.number ?? 1).padStart(2, '0');
    await c.env.DB.prepare(
      `INSERT INTO watch_comment (id, user_email, episode_id, timestamp_ms, transcription, audio_r2_key, created_at, show_id, reply_to, transcript_edited, is_reflection, private, is_endnote, spoiler, reveal_on, hidden)
       VALUES (?, ?, ?, 0, ?, NULL, ?, ?, NULL, 0, 1, 0, 0, 0, NULL, 0)`,
    ).bind(crypto.randomUUID(), email, refEp, rating, watchedAt, titleId).run();
  }

  const code = 'S' + String(ep.season ?? 1).padStart(2, '0') + 'E' + String(ep.number ?? 1).padStart(2, '0');
  return c.json({ ok: true, title_id: titleId, name: mat.titleRow.name, poster: mat.titleRow.poster || null,
    episode_id: ep.episode_id, season: ep.season, number: ep.number, code, episode_name: ep.name || null, watched_at: watchedAt });
});

// POST /catalog/runtime-check — a member completed an episode after a live watch that
// ran short of the stored runtime. TVmaze (TV) runtimes are sometimes a rounded slot,
// so we ask TMDB for a second opinion: if TMDB's runtime sits closer to what the member
// actually logged, we trust the two corroborating signals and CORRECT the episode's
// runtime, then file an info bug. If TMDB can't confirm, we file a plain mismatch for
// manual review. Movies (source 'tmdb') already come from TMDB and are skipped.
catalogRoutes.post('/runtime-check', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase() || null;
  const titleId = String(body.title_id || '');
  const season = Number(body.season);
  const number = Number(body.number);
  const watched = Number(body.watched_min);
  if (!titleId || !Number.isFinite(season) || !Number.isFinite(number) || !(watched > 0)) {
    return c.json({ error: 'title_id, season, number, watched_min required' }, 400);
  }
  const episodeId = epId(titleId, season, number);

  const ep = await c.env.DB.prepare('SELECT runtime FROM episodes WHERE episode_id = ?').bind(episodeId).first<{ runtime: number | null }>();
  if (!ep) return c.json({ checked: false, reason: 'unknown episode' });
  const stored = Number(ep.runtime) || 0;

  const title = await c.env.DB.prepare('SELECT source, name FROM titles WHERE title_id = ?').bind(titleId).first<{ source: string; name: string }>();
  if (!title) return c.json({ checked: false, reason: 'unknown title' });
  if (title.source !== 'tvmaze') return c.json({ checked: false, reason: 'not a tvmaze title' });

  // Guard: only act on a real mismatch (≥5 min). Within tolerance → nothing to do.
  const storedGap = Math.abs(stored - watched);
  if (!(stored > 0) || storedGap < 5) return c.json({ checked: false, reason: 'within tolerance' });

  // Resolve the TVmaze show's external ids for the TMDB cross-reference.
  const ref = titleId.slice(titleId.indexOf(':') + 1);
  let ext: { imdb?: string | null; tvdb?: string | null } = {};
  try {
    const r = await fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(ref)}`);
    if (r.ok) {
      const s: any = await r.json();
      ext = { imdb: s?.externals?.imdb || null, tvdb: s?.externals?.thetvdb != null ? String(s.externals.thetvdb) : null };
    }
  } catch { /* fail soft — TMDB lookup just won't resolve */ }
  const tmdb = await fetchTmdbTvRuntime(c.env, ext, season, number);
  const tmdbRt = tmdb?.minutes ?? null;

  // TMDB "confirms" the member when it lands closer to the logged time than the stored
  // value did, and differs from stored by a meaningful margin (≥3 min). Only a PRECISE
  // episode-level runtime may auto-correct: the show-wide nominal fallback (e.g. Ted
  // Lasso's marketed 30 min) can sit numerically "closer" to a short live watch than a
  // too-long slot did, and would overshoot the true length — so we never overwrite from it.
  const tmdbCloser = tmdb != null && tmdb.precise &&
    Math.abs(tmdb.minutes - watched) < storedGap && Math.abs(tmdb.minutes - stored) >= 3;

  let corrected = false;
  if (tmdbCloser && tmdbRt != null) {
    await c.env.DB.prepare('UPDATE episodes SET runtime = ?, updated_at = ? WHERE episode_id = ?')
      .bind(tmdbRt, Date.now(), episodeId).run();
    corrected = true;
  }

  // One bug per still-open episode finding: an auto-correction shrinks the gap for the
  // next viewer (→ "within tolerance", no re-file), so only the un-confirmed case can
  // recur — dedupe it against the open list by the episode id embedded in the note.
  const dupe = await c.env.DB.prepare(
    `SELECT 1 FROM bug_report
       WHERE note LIKE ? AND LOWER(COALESCE(status, '')) NOT IN ('fixed','wontfix','closed','resolved','done','duplicate')
       LIMIT 1`
  ).bind(`%(${episodeId})%`).first();
  if (!dupe) {
    const w = Math.round(watched);
    const note = corrected
      ? `Runtime auto-corrected via TMDB (${episodeId}): "${title.name}" S${season}E${number} — TVmaze had ${stored} min, member logged ~${w} min, TMDB says ${tmdbRt} min. Episode runtime updated to ${tmdbRt}. Review whether the rest of the title needs the same fix.`
      : `Runtime mismatch (${episodeId}): "${title.name}" S${season}E${number} — TVmaze ${stored} min vs member-logged ~${w} min` +
        (tmdbRt == null ? `; TMDB lookup failed.`
          : tmdb!.precise ? `; TMDB ${tmdbRt} min (not closer — no auto-correction).`
          : `; TMDB has no per-episode runtime yet — only the show's nominal ${tmdbRt} min slot (ignored, would overshoot).`) + ' Manual review.';
    c.executionCtx.waitUntil(fileSystemBug(c.env, note, 'episodes · runtime-check', email).catch((e) => console.warn('runtime bug file failed:', String(e).substring(0, 200))));
  }

  return c.json({ checked: true, stored, watched: Math.round(watched), tmdbRuntime: tmdbRt, corrected });
});

// POST /catalog/runtime-report — a user's confirmed real runtime for an episode, from
// Pierre's "was that the real end?" prompt (fired only when runtime-check did NOT
// auto-correct via TMDB). Upserts the user's observation; when 2+ distinct users agree
// on the SAME runtime it auto-applies to the global catalog. Every report stays queued
// (runtime_report) for the admin regardless.
const RUNTIME_CONSENSUS = 2;   // distinct users agreeing → auto-apply
catalogRoutes.post('/runtime-report', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const titleId = String(body.title_id || '');
  const season = Number(body.season);
  const number = Number(body.number);
  const observed = Math.trunc(Number(body.observed_runtime));
  if (!email || !titleId || !Number.isFinite(season) || !Number.isFinite(number) || !(observed > 0) || observed > 100000)
    return c.json({ error: 'email, title_id, season, number, observed_runtime required' }, 400);
  const episodeId = epId(titleId, season, number);
  const ep = await c.env.DB.prepare('SELECT runtime FROM episodes WHERE episode_id = ?').bind(episodeId).first<{ runtime: number | null }>();
  if (!ep) return c.json({ error: 'unknown episode' }, 404);

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO runtime_report (episode_id, user_email, observed_runtime, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(episode_id, user_email) DO UPDATE SET
       observed_runtime = excluded.observed_runtime, status = 'pending', created_at = excluded.created_at`
  ).bind(episodeId, email, observed, now).run();

  // Consensus: N distinct users on the SAME observed runtime → auto-apply globally.
  const agree = await c.env.DB.prepare(
    'SELECT COUNT(DISTINCT user_email) AS n FROM runtime_report WHERE episode_id = ? AND observed_runtime = ?'
  ).bind(episodeId, observed).first<{ n: number }>();
  const n = agree?.n || 1;
  let applied = false;
  if (n >= RUNTIME_CONSENSUS) {
    await c.env.DB.prepare('UPDATE episodes SET runtime = ?, updated_at = ? WHERE episode_id = ?')
      .bind(observed, now, episodeId).run();
    await c.env.DB.prepare("UPDATE runtime_report SET status = 'applied' WHERE episode_id = ? AND observed_runtime = ?")
      .bind(episodeId, observed).run();
    applied = true;
  }
  return c.json({ ok: true, applied, agree: n });
});

// GET /catalog/titles/:title_id/episodes — canonical episode list (no user state).
catalogRoutes.get('/titles/:title_id/episodes', async (c) => {
  const titleId = c.req.param('title_id');
  const title = await c.env.DB.prepare('SELECT * FROM titles WHERE title_id = ?').bind(titleId).first();
  if (!title) return c.json({ error: 'not found' }, 404);
  return c.json({ title, episodes: await loadEpisodes(c.env, titleId) });
});
