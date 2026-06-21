-- Social graph: one-directional follows. A mutual pair (A→B and B→A) is a "friend".
-- No request/accept step — following is immediate. Friends are derived, not stored.
CREATE TABLE IF NOT EXISTS follows (
  follower_email TEXT    NOT NULL REFERENCES users(email),
  followee_email TEXT    NOT NULL REFERENCES users(email),
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (follower_email, followee_email)
);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_email);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_email);
