-- Likes on FEED activity. A "like" is one member reacting to another member's
-- activity card, identified by (subject member + title + kind). One row per
-- (liker, subject, title, kind); liking is idempotent, unliking deletes the row.
-- Kept deliberately generic (no FK to a single activity table) because a feed
-- item is a projection over watch_title / watch_ticket, not one physical row.
CREATE TABLE likes (
  user_email    TEXT    NOT NULL,   -- the liker
  subject_email TEXT    NOT NULL,   -- whose activity is being liked
  title_id      TEXT    NOT NULL,   -- the show / film key
  kind          TEXT    NOT NULL,   -- 'show' | 'movie' | 'ticket'
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_email, subject_email, title_id, kind),
  FOREIGN KEY (user_email) REFERENCES users(email)
);
-- Count lookups are always by the liked activity (subject + title + kind).
CREATE INDEX idx_likes_subject ON likes(subject_email, title_id, kind);
