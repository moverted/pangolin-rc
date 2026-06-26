-- IRL Theater tickets: a photo/screengrab of a cinema ticket, logged when the
-- viewer watched a title in a physical theater (service = "IRL Theater"). The
-- image bytes live in R2 (tickets/<show_id>/<id>); this row is the index. One
-- row per ticket; episode_id is the human code (S01E01 / 🎬), show_id the
-- universal title key (tvmaze:<id> / tmdb:<id>).
-- ticket_date / ticket_time / theater are read off the image by Claude vision at
-- upload (best-effort; null when unreadable). theater is the real "where" — it
-- replaces the streamer label once known, so the corner shows the actual cinema.
CREATE TABLE watch_ticket (
  id            TEXT PRIMARY KEY,
  user_email    TEXT NOT NULL,
  show_id       TEXT,
  episode_id    TEXT,
  show_name     TEXT,
  ticket_r2_key TEXT NOT NULL,
  ticket_date   TEXT,
  ticket_time   TEXT,
  theater       TEXT,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (user_email) REFERENCES users(email)
);
CREATE INDEX idx_watch_ticket_user_show ON watch_ticket(user_email, show_id);
