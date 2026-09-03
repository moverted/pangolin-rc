-- User-observed episode runtimes. Pierre asks "was that the real end?" when a finish
-- runs short of the catalog runtime AND TMDB didn't already auto-correct it (see the
-- /catalog/runtime-check flow). Each row is one user's observation for one episode.
-- When 2+ DISTINCT users report the SAME runtime for an episode it auto-applies to the
-- global episodes.runtime; every report stays here as the admin review queue either way.
CREATE TABLE IF NOT EXISTS runtime_report (
  episode_id       TEXT    NOT NULL,
  user_email       TEXT    NOT NULL,
  observed_runtime INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending',  -- pending | applied | dismissed
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (episode_id, user_email)
);
CREATE INDEX IF NOT EXISTS idx_runtime_report_ep ON runtime_report(episode_id);
