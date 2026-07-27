-- WoW in-season scheduler state. Own database (pangolinrc-scheduler), additive-only.
-- Stores the MINIMUM per the spec: choices, counters, sent-flags, badges. Everything
-- else (phase, countdown, derived watchMode, TAG, geometry) is computed, never stored.

-- Per user + show: the manual mode choice. mode in LIVE|FRESH|CASUAL|MORE!|DECLINED.
-- Absence of a row (or NULL mode) means "auto" (classifier drives).
CREATE TABLE sched_mode_choice (
  user_email TEXT NOT NULL,
  show_id    TEXT NOT NULL,
  mode       TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, show_id)
);

-- Per user: consent + profile default. The two-strike kill and its exception.
CREATE TABLE sched_user (
  user_email           TEXT PRIMARY KEY,
  declined_count       INTEGER NOT NULL DEFAULT 0,
  positive_interaction INTEGER NOT NULL DEFAULT 0,
  global_kill          INTEGER NOT NULL DEFAULT 0,
  default_mode         TEXT,                 -- profile default chip (NULL = none)
  updated_at           INTEGER NOT NULL
);

-- Per user + show + season: badges. Computed at SEASON WRAP; keep compiling through a kill.
CREATE TABLE sched_badge (
  user_email TEXT NOT NULL,
  show_id    TEXT NOT NULL,
  season     INTEGER NOT NULL,
  badge      TEXT NOT NULL,                  -- LIVEwatcher | BINGEwatcher
  awarded_at INTEGER NOT NULL,
  shared     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_email, show_id, season, badge)
);

-- Per user + show: sent-state for the one-per-cycle nudge and one-per-state Sentry.
-- key = weekly-cycle key (nudge) or state-change key (sentry).
CREATE TABLE sched_sent (
  user_email TEXT NOT NULL,
  show_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,                  -- 'nudge' | 'sentry'
  key        TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (user_email, show_id, kind, key)
);
