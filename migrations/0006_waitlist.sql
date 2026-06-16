-- Waitlist: people who tried to sign up after the member cap was reached.
-- Captures eagerness (who asked in) even though they are not members yet.
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL
);
