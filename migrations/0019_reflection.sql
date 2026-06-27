-- After-screening reflections: a thought shared about a viewing that lives on
-- afterward. Captured at the finale-share moment (or the viewing's share button)
-- and surfaced on the completed card. ticket_id ties it to a specific viewing
-- (one ticket = one viewing); null means film-level (shown under the most recent
-- viewing). show_id is the universal title key (tmdb:<id> / tvmaze:<id>).
CREATE TABLE reflection (
  id         TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  show_id    TEXT,
  ticket_id  TEXT,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_email) REFERENCES users(email)
);
CREATE INDEX idx_reflection_show ON reflection(user_email, show_id);
