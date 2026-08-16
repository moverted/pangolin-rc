-- External-share log for co-view comment clips (COMMENT_CLIP_SHARE). One row per
-- completed native share of a comment/reflection clip, captured by the shell's
-- share bridge AFTER Capacitor's Share sheet resolves. Purpose: moderation — see
-- which clips left the app, where they went, and when (so a flagged clip can be
-- traced). Best-effort by nature: the OS share sheet only tells us the chosen
-- target via `activity_type` (iOS UIActivity id), so platform/method are derived
-- from that + the file kind, and a cancelled share writes nothing.
CREATE TABLE IF NOT EXISTS comment_share (
  id            TEXT    PRIMARY KEY,
  comment_id    TEXT    NOT NULL REFERENCES watch_comment(id),
  user_email    TEXT,                    -- author of the shared comment (server-derived)
  platform      TEXT,                    -- derived: instagram | photos | messages | whatsapp | other | unknown
  method        TEXT,                    -- derived from the clip kind: reel | story | file
  activity_type TEXT,                    -- raw iOS UIActivity type / target bundle id (source of truth)
  shared_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comment_share_comment ON comment_share(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_share_time    ON comment_share(shared_at);
