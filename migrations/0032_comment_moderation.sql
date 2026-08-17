-- Comment moderation: member reports + admin hide.
--   watch_comment.hidden — admin-set 0/1. Hidden comments stay in the row (audit)
--     but the reveal/coview paths should drop them (wired separately). Default 0 =
--     nothing changes for existing rows.
--   comment_flag — one row per member who flags a comment for review (the red flag
--     glyph next to the like). PK(comment_id, user_email) so a member can't double-
--     count; a comment's report weight is COUNT(*) over this table. Admin Comments
--     page surfaces the count and the hide toggle.
ALTER TABLE watch_comment ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS comment_flag (
  comment_id TEXT    NOT NULL REFERENCES watch_comment(id),
  user_email TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_email)
);
CREATE INDEX IF NOT EXISTS idx_comment_flag_comment ON comment_flag(comment_id);
