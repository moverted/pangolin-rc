-- Episode-as-unit data model. The unit of a record becomes an episode (or a movie),
-- materialized server-side as real linked rows instead of a per-show JSON blob.
--
--   Shared catalog (deduped across users):
--     titles    — one row per show/movie
--     episodes  — one row per episode, linked to its title and to the next episode in
--                 canonical air order (the default global "map"). next_episode_id NULL
--                 on the finale.
--   Per-user progress:
--     watch_title    — show-level bucket + resume pointer
--     watch_episode  — per-episode progress; the user's actual PATH is these rows
--                      ordered by the latest sessions[].finishTs.
--   Reserved (curated-maps phase, created empty so the bones don't move later):
--     maps, map_steps
--
-- Replaces the single per-show `watch` table (big-bang: existing rows are dropped).

DROP TABLE IF EXISTS watch;

CREATE TABLE IF NOT EXISTS titles (
  title_id        TEXT    PRIMARY KEY,            -- 'tvmaze:81110' | 'tmdb:123'
  source          TEXT    NOT NULL,               -- 'tvmaze' | 'tmdb'
  name            TEXT,
  kind            TEXT    NOT NULL DEFAULT 'show', -- 'show' | 'movie'
  status          TEXT,                            -- Ended / Running / Canceled / Film
  poster          TEXT,
  platform        TEXT,
  total_episodes  INTEGER NOT NULL DEFAULT 0,
  premiered       TEXT,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  episode_id      TEXT    PRIMARY KEY,            -- 'tvmaze:81110:s1e1'
  title_id        TEXT    NOT NULL REFERENCES titles(title_id),
  season          INTEGER,
  number          INTEGER,
  name            TEXT,
  runtime         INTEGER,
  airdate         TEXT,
  next_episode_id TEXT,                            -- canonical air order; NULL on finale
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_title ON episodes(title_id);

CREATE TABLE IF NOT EXISTS watch_title (
  user_email         TEXT    NOT NULL REFERENCES users(email),
  title_id           TEXT    NOT NULL REFERENCES titles(title_id),
  status             TEXT,                          -- current/returning/comfort/completed/stopped
  active_map_id      TEXT,                          -- NULL = canonical air order (reserved)
  current_episode_id TEXT,                          -- resume pointer
  started_at         INTEGER,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (user_email, title_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_title_user ON watch_title(user_email);

CREATE TABLE IF NOT EXISTS watch_episode (
  user_email  TEXT    NOT NULL REFERENCES users(email),
  episode_id  TEXT    NOT NULL REFERENCES episodes(episode_id),
  title_id    TEXT    NOT NULL,                     -- denormalized for per-show queries
  done        INTEGER NOT NULL DEFAULT 0,
  minute      INTEGER NOT NULL DEFAULT 0,
  bp          INTEGER NOT NULL DEFAULT 0,           -- "Before PangolinRC" / force-advanced
  sessions    TEXT,                                 -- JSON viewing log
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_email, episode_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_episode_user_title ON watch_episode(user_email, title_id);

-- Reserved for the curated-maps phase (e.g. "Gilmore Girls, Logan episodes"). Empty now.
CREATE TABLE IF NOT EXISTS maps (
  map_id      TEXT    PRIMARY KEY,
  title_id    TEXT,                                 -- NULL = cross-title
  name        TEXT,
  kind        TEXT    NOT NULL DEFAULT 'curated',    -- air_order | curated | user
  owner_email TEXT,                                  -- NULL = global
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS map_steps (
  map_id          TEXT    NOT NULL REFERENCES maps(map_id),
  position        INTEGER NOT NULL,
  episode_id      TEXT    NOT NULL,
  next_episode_id TEXT,
  PRIMARY KEY (map_id, position)
);
