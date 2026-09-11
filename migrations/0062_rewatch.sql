-- 0062_rewatch.sql
-- Rewatches of an ALREADY-COMPLETED show/movie are recorded here, separate from
-- watch_episode (which holds one row per episode and can't represent a second viewing).
-- They surface as REWATCH rows in the COMPLETED tab and can grow into ad-hoc marathons
-- (reusing the maps/map_steps builder). The original ✅ completion is never touched.
--
-- A session groups the episodes of one rewatch run for one title.
--   state: pending  — new/undecided (shows `?`); may still grow or be asked about
--          solo     — finalized single-episode rewatch (shows `✅`)
--          marathon — built into a map:u:* marathon (auto in-order, or Pierre YES)
--          listed   — out-of-order episodes the member declined to marathon (just listed)
CREATE TABLE IF NOT EXISTS rewatch_session (
  session_id  TEXT    PRIMARY KEY,
  user_email  TEXT    NOT NULL REFERENCES users(email),
  title_id    TEXT    NOT NULL REFERENCES titles(title_id),
  state       TEXT    NOT NULL DEFAULT 'pending',
  map_id      TEXT,                                 -- set once built into a marathon
  asked       INTEGER NOT NULL DEFAULT 0,           -- Pierre already asked the marathon question
  opened_at   INTEGER NOT NULL,                     -- first event (drives the 14-day window)
  last_at     INTEGER NOT NULL,                     -- latest event
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rewatch_session_user ON rewatch_session(user_email, title_id);

-- One row per re-viewed episode (for movies: the single s1e1), attached to a session.
CREATE TABLE IF NOT EXISTS rewatch_event (
  event_id    TEXT    PRIMARY KEY,
  session_id  TEXT    NOT NULL REFERENCES rewatch_session(session_id),
  user_email  TEXT    NOT NULL,
  title_id    TEXT    NOT NULL,
  episode_id  TEXT    NOT NULL,
  season      INTEGER,
  number      INTEGER,
  watched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rewatch_event_session ON rewatch_event(session_id);
CREATE INDEX IF NOT EXISTS idx_rewatch_event_user_title ON rewatch_event(user_email, title_id);
