-- Shares: a member recommends a tracked title to one or more friends. The share
-- lands on each recipient's BROWSE "From friends" rail until they open or dismiss
-- it. Distinct from the activity feed (passive) — a share is a deliberate push to
-- specific friends. Only confirmed friends (mutual follows) can be shared with.
--
-- show_name/poster are denormalized at share time so the rail still renders if the
-- title row is ever absent; the GET joins `titles` for the fresh copy when present.
CREATE TABLE IF NOT EXISTS shares (
  id           TEXT    PRIMARY KEY,
  from_email   TEXT    NOT NULL REFERENCES users(email),
  to_email     TEXT    NOT NULL,
  title_id     TEXT    NOT NULL,               -- 'tvmaze:…' | 'tmdb:…'
  show_name    TEXT,
  poster       TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL,
  dismissed_at INTEGER                          -- NULL = still on the recipient's rail
);
CREATE INDEX IF NOT EXISTS idx_shares_to ON shares(to_email);
CREATE INDEX IF NOT EXISTS idx_shares_from ON shares(from_email);
