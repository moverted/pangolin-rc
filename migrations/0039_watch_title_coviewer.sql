-- Per-title co-viewers: who a user watches a given title WITH. Rows reference the
-- coviewer roster (0036_coviewer). Solo = no rows for that title. Set in the Pierre
-- add flow ("who's watching this with you?") and editable on the WATCH/LOG faces.
-- Distinct from the default matrix (coviewer.is_default), which is only the fallback
-- Pierre assumes when a title has no explicit rows here.
CREATE TABLE IF NOT EXISTS watch_title_coviewer (
  user_email  TEXT    NOT NULL REFERENCES users(email),
  title_id    TEXT    NOT NULL,
  coviewer_id TEXT    NOT NULL REFERENCES coviewer(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_email, title_id, coviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_wtcov_user_title ON watch_title_coviewer(user_email, title_id);
