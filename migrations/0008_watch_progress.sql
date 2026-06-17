-- Per-episode minute progress for the Episode face. `watched` stays the
-- flattened count the Log buckets on; these add where you are inside the
-- current episode and the per-episode detail (logged minutes, done, BP).
ALTER TABLE watch ADD COLUMN last_minute INTEGER NOT NULL DEFAULT 0; -- minute position in the current episode
ALTER TABLE watch ADD COLUMN started_at  INTEGER;                    -- current episode start timestamp (device)
ALTER TABLE watch ADD COLUMN episodes    TEXT;                       -- JSON: {"<season>-<number>":{"min":int,"done":bool,"bp":bool}}
