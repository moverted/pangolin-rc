-- Quick feedback from the console band (thumbs up / down / Get Ted). Ted reviews the
-- thumbs by hand; a 'get_ted' also opens a real escalation (see the /feedback handler).
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT    NOT NULL,
  kind       TEXT    NOT NULL,            -- 'up' | 'down' | 'get_ted'
  face       TEXT,                        -- which face they were on
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
