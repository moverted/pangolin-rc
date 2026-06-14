CREATE TABLE IF NOT EXISTS events (
  id            TEXT    PRIMARY KEY,
  type          TEXT    NOT NULL,
  resource_id   TEXT    NOT NULL,
  submission_id TEXT    NOT NULL,
  actor_id      TEXT    NOT NULL,
  actor_role    TEXT    NOT NULL,
  payload       TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_resource   ON events (resource_id,   created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_submission ON events (submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events (type,          created_at DESC);
