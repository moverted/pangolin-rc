-- Archived rewatch passes, per user + title + SEASON. Each completed OR restarted
-- watch-through of a season is snapshotted here BEFORE the live watch_episode rows are
-- reset for the next pass, so the original completion and viewing history are never
-- clobbered.
--
-- `ordinal` is the 1-based view number for that season (view 1, 2, 3…). A partial
-- season that is restarted from the beginning ("highlights") still consumes its ordinal,
-- applied to the whole season, and the new live pass takes the next number.
--
-- `kind` = 'complete'  (the season was fully watched before this pass was archived)
--        | 'highlights' (a partial pass, restarted from the beginning)
CREATE TABLE IF NOT EXISTS watch_pass (
  pass_id      TEXT    PRIMARY KEY,               -- uuid
  user_email   TEXT    NOT NULL REFERENCES users(email),
  title_id     TEXT    NOT NULL,
  season       INTEGER NOT NULL,
  ordinal      INTEGER NOT NULL,                  -- 1-based view number for this season
  kind         TEXT    NOT NULL,                  -- 'complete' | 'highlights'
  pattern      TEXT,                              -- locked watch mode (LIVE|FRESH|CASUAL|MORE!|NULL=auto)
  episodes     TEXT,                              -- JSON snapshot {episode_id:{done,minute,bp,sessions}}
  watched_ct   INTEGER NOT NULL DEFAULT 0,        -- episodes watched-through in this pass
  season_ct    INTEGER NOT NULL DEFAULT 0,        -- episodes in the season (for "7 of 13")
  started_at   INTEGER,                           -- earliest session ts in the pass, if known
  archived_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_pass_user_title ON watch_pass(user_email, title_id);
CREATE INDEX IF NOT EXISTS idx_watch_pass_user_title_season ON watch_pass(user_email, title_id, season);
