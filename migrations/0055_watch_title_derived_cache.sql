-- Denormalized per-user rollups on watch_title, so the WATCH/LOG queue can load with a
-- flat read instead of ~4 correlated subqueries PER tracked title on every open. These
-- columns are the per-user aggregates that dominated the read cost (the D1 free-tier
-- daily row-read cap was hit precisely because a 100+ title queue re-derived them live
-- on each load). They are maintained on WRITE (rare) by refreshCounts() — called from
-- recomputeTitle and from every catalog writer that touches watch_episode — so they
-- never drift from the raw watch_episode rows (which remain the source of truth).
--
-- SERIES-scoped by design. Marathon (curated-map) tiles re-scope total/watched/released/
-- last-position live in GET /profile/:email/titles, so these stay series-truth and need
-- no map branch. `released` and `runtime` are deliberately NOT cached — they are single
-- indexed lookups over the shared catalog and must stay always-fresh as episodes air
-- (no Worker cron exists to refresh a cached value), so they remain live subqueries.

ALTER TABLE watch_title ADD COLUMN watched_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch_title ADD COLUMN minute_sum    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch_title ADD COLUMN last_season   INTEGER;
ALTER TABLE watch_title ADD COLUMN last_number   INTEGER;

-- One-time backfill from the raw progress rows (mirrors the subqueries this replaces).
UPDATE watch_title SET
  watched_count = (SELECT COALESCE(SUM(CASE WHEN we.done=1 THEN 1 ELSE 0 END),0)
                     FROM watch_episode we
                    WHERE we.user_email=watch_title.user_email AND we.title_id=watch_title.title_id),
  minute_sum    = (SELECT COALESCE(SUM(we.minute),0)
                     FROM watch_episode we
                    WHERE we.user_email=watch_title.user_email AND we.title_id=watch_title.title_id);

UPDATE watch_title SET
  last_season = (SELECT e.season FROM episodes e
                   JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=watch_title.user_email
                  WHERE e.title_id=watch_title.title_id AND (we.done=1 OR we.minute>0)
                  ORDER BY e.season DESC, e.number DESC LIMIT 1),
  last_number = (SELECT e.number FROM episodes e
                   JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=watch_title.user_email
                  WHERE e.title_id=watch_title.title_id AND (we.done=1 OR we.minute>0)
                  ORDER BY e.season DESC, e.number DESC LIMIT 1);
