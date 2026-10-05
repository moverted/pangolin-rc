-- Pierre Suggests: the "want to watch, not started" home that the nav restructure
-- lost (SHELF -> STACK = owned media, QUEUE = currently watching). A title lands here
-- ONLY when the member saves Pierre's game pick with "Save for later"; from here they
-- either start it (-> QUEUE) or dismiss it. One row per (user, title).
CREATE TABLE IF NOT EXISTS pierre_suggests (
  id           TEXT    PRIMARY KEY,
  user_email   TEXT    NOT NULL,
  title_id     TEXT,                         -- tvmaze:/tmdb: when resolved, else NULL
  title_name   TEXT    NOT NULL,
  poster       TEXT    NOT NULL DEFAULT '',
  title_source TEXT    NOT NULL DEFAULT '',  -- tvmaze | tmdb (where the pick was resolved)
  seed_a       TEXT    NOT NULL DEFAULT '',  -- the two titles the member fed the game
  seed_b       TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suggests_user_title ON pierre_suggests(user_email, title_name);
CREATE INDEX IF NOT EXISTS idx_suggests_user ON pierre_suggests(user_email, created_at DESC);

-- Append-only derived signals from the game + Suggests (the local "events spine" for this
-- flow; lives in pangolin-rc so the saved-to-started hit rate computes with no cross-DB
-- join). Never stores raw chat transcript. kind is one of:
--   saved     - member kept Pierre's pick (-> Pierre Suggests)
--   started   - a saved pick moved to QUEUE (currently watching); time_since_saved_ms set
--   dismissed - dropped. dismiss_source: 'game' (missed on the spot, time_since_saved_ms NULL)
--               or 'suggests' (interest faded later, time_since_saved_ms set)
--   seen      - member had already seen the pick; pre_app=1, optional rank 0..10
CREATE TABLE IF NOT EXISTS pierre_suggest_events (
  id                   TEXT    PRIMARY KEY,
  user_email           TEXT    NOT NULL,
  kind                 TEXT    NOT NULL,      -- saved | started | dismissed | seen
  title_id             TEXT,
  title_name           TEXT    NOT NULL DEFAULT '',
  title_source         TEXT    NOT NULL DEFAULT '',  -- tvmaze | tmdb
  seed_a               TEXT    NOT NULL DEFAULT '',
  seed_b               TEXT    NOT NULL DEFAULT '',
  dismiss_source       TEXT    NOT NULL DEFAULT '',   -- game | suggests (dismissed only)
  time_since_saved_ms  INTEGER,                        -- started + dismissed(suggests); NULL otherwise
  pre_app              INTEGER NOT NULL DEFAULT 0,      -- seen only: always 1 (never fires the binge flame)
  rank                 INTEGER,                         -- seen only: optional 0..10
  created_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggest_events_user ON pierre_suggest_events(user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggest_events_kind ON pierre_suggest_events(user_email, kind);
