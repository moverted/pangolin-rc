-- Streaming shadow: a per-user table of every title they have WATCHED, MENTIONED, or
-- DISCUSSED with Pierre — the "shape of them Pierre can draw from the slivers of taste
-- they hand him". Pierre auto-writes it (from watch data, chat mentions, and the game),
-- the user reshapes it (edit the feel/sentiment, cut rows out), and Pierre reads it back
-- so he references what he already knows and the game stops re-offering the same titles.
-- One row per (user, title). A re-mention upserts (bumps weight, refreshes feel/sentiment).
CREATE TABLE IF NOT EXISTS streaming_shadow (
  id          TEXT    PRIMARY KEY,
  user_email  TEXT    NOT NULL,
  title_id    TEXT,                            -- tvmaze:/tmdb: when resolved, else NULL
  title_name  TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT '',     -- show | movie | ''
  feel        TEXT    NOT NULL DEFAULT '',     -- one-line take, in the user's register
  sentiment   TEXT    NOT NULL DEFAULT '',     -- love | like | meh | nope | ''
  source      TEXT    NOT NULL DEFAULT 'chat', -- watch | game | chat | manual
  weight      INTEGER NOT NULL DEFAULT 1,      -- how often it has come up
  hidden      INTEGER NOT NULL DEFAULT 0,      -- user crafted it out (soft delete)
  visibility  TEXT    NOT NULL DEFAULT 'circle', -- circle | private (read path = later phase)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shadow_user_title ON streaming_shadow(user_email, title_name);
CREATE INDEX IF NOT EXISTS idx_shadow_user ON streaming_shadow(user_email);
