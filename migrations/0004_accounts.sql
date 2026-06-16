-- User accounts. SEAM:identity — email is the key for now; no password in this
-- build. Real auth (OTP / Access / Turnstile) is a later layer.
CREATE TABLE IF NOT EXISTS users (
  email      TEXT    PRIMARY KEY,
  username   TEXT,
  phone      TEXT,
  photo_url  TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Devices a user has connected (e.g. LG TV, Amazon Fire Cube), with a location.
CREATE TABLE IF NOT EXISTS devices (
  id         TEXT    PRIMARY KEY,
  user_email TEXT    NOT NULL REFERENCES users(email),
  type       TEXT    NOT NULL,
  location   TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_email);

-- Watch history: the shows a user tracks and where they are within them
-- (location within a show = last season/number + flattened watched count).
CREATE TABLE IF NOT EXISTS watch (
  user_email  TEXT    NOT NULL REFERENCES users(email),
  show_id     TEXT    NOT NULL,            -- TVMaze id or catalog id
  show_name   TEXT,
  status      TEXT,                        -- bucket: current/returning/comfort/completed/stopped
  watched     INTEGER NOT NULL DEFAULT 0,  -- episodes watched (flattened across released)
  last_season INTEGER,
  last_number INTEGER,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_email, show_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_user ON watch(user_email);
