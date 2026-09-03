import type { Env } from '../types';

// Denormalized per-user rollup maintenance for watch_title (see migration 0055).
//
// refreshCounts recomputes the cached aggregates that GET /profile/:email/titles used to
// derive with correlated subqueries on every load — watched_count, minute_sum, and the
// last-watched position — straight from the raw watch_episode rows and writes them onto
// the watch_title row. It touches ONLY those four columns (never status / current_episode_id
// / updated_at), so callers that manage those themselves — the catalog backfill/initiate
// writers — can call it without clobbering the status they just set.
//
// This lives in its own module (not profile.ts) so both profile.ts and catalog.ts can import
// it without a circular dependency (profile.ts already imports from catalog.ts).
//
// SERIES-scoped: marathon (map) tiles re-scope live in the read path, so the cache stays
// series-truth and needs no map branch. Call this after EVERY watch_episode mutation that
// leaves the watch_title row in place, so the cache can never drift.
export async function refreshCounts(env: Env, email: string, titleId: string): Promise<void> {
  const agg = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN done=1 THEN 1 ELSE 0 END),0) AS watched,
            COALESCE(SUM(minute),0) AS minutes
       FROM watch_episode WHERE user_email=? AND title_id=?`
  ).bind(email, titleId).first<{ watched: number; minutes: number }>();
  // Highest season/number among episodes with any progress (mirrors the old subquery).
  const last = await env.DB.prepare(
    `SELECT e.season AS season, e.number AS number
       FROM episodes e JOIN watch_episode we
         ON we.episode_id=e.episode_id AND we.user_email=?
      WHERE e.title_id=? AND (we.done=1 OR we.minute>0)
      ORDER BY e.season DESC, e.number DESC LIMIT 1`
  ).bind(email, titleId).first<{ season: number; number: number }>();
  await env.DB.prepare(
    `UPDATE watch_title SET watched_count=?, minute_sum=?, last_season=?, last_number=?
      WHERE user_email=? AND title_id=?`
  ).bind(agg?.watched ?? 0, agg?.minutes ?? 0, last?.season ?? null, last?.number ?? null, email, titleId).run();
}
