-- Divergent-pair room building (Pierre onboarding). Three additions:
--
-- room_seed: how the five room shows were filled. Two rows tagged source 'user'
-- (the pair the member typed or said) plus up to three tagged 'pierre' (guesses the
-- member accepted). thread is Pierre's one-line hidden connection for the session,
-- kept for later qualitative review, not required for the room to work.
CREATE TABLE IF NOT EXISTS room_seed (
  user_email  TEXT    NOT NULL,
  title_id    TEXT    NOT NULL,
  show_name   TEXT,
  source      TEXT    NOT NULL,            -- 'user' (typed the pair) or 'pierre' (accepted guess)
  thread      TEXT,                        -- session hidden-thread line (optional)
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_email, title_id)
);
CREATE INDEX IF NOT EXISTS idx_room_seed_user ON room_seed(user_email);

-- egg_redemption: the Robin Williams free-trial-month grants. Each row is one granted
-- month. Per-account cap is three lifetime (count rows per user_email); a global cap
-- backstop counts rows across all users. month_index is which of the member's three
-- months this grant filled (1, 2, or 3).
CREATE TABLE IF NOT EXISTS egg_redemption (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT    NOT NULL,
  code        TEXT    NOT NULL DEFAULT 'robin_williams',
  month_index INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_egg_redemption_user ON egg_redemption(user_email);
-- One row per (member, month slot): a concurrent double-tap cannot grant the same month twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_egg_redemption_month ON egg_redemption(user_email, month_index);

-- mic_permission: the outcome of the OS microphone permission ask (folded into room
-- building). One row per member, upserted. This is only the permission event itself,
-- kept apart from any per-comment audio.
CREATE TABLE IF NOT EXISTS mic_permission (
  user_email TEXT    NOT NULL PRIMARY KEY,
  granted    INTEGER NOT NULL,             -- 1 granted, 0 denied
  updated_at INTEGER NOT NULL
);
