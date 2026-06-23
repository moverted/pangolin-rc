-- Human-readable name fields on the per-user watch rows.
--
-- titles.name (the show) and episodes.name (the episode) already carry these in the
-- shared catalog, but the Airtable mirror can't join — its watch_title / watch_episode
-- grids showed only opaque ids ('tvmaze:81110:s3e5'). Denormalize the names onto the
-- per-user rows so the human-editable grid is legible. Written on every watch upsert.

ALTER TABLE watch_title   ADD COLUMN show_name    TEXT;
ALTER TABLE watch_episode ADD COLUMN show_name    TEXT;
ALTER TABLE watch_episode ADD COLUMN episode_name TEXT;

-- Backfill existing rows from the catalog.
UPDATE watch_title
   SET show_name = (SELECT t.name FROM titles t WHERE t.title_id = watch_title.title_id);

UPDATE watch_episode
   SET show_name    = (SELECT t.name FROM titles    t WHERE t.title_id   = watch_episode.title_id),
       episode_name = (SELECT e.name FROM episodes  e WHERE e.episode_id = watch_episode.episode_id);
