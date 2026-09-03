-- Flagged Pierre requests: when a member asks Pierre for porn/explicit content,
-- Llama Guard flags the message and we log a record here for admin review (who asked,
-- what category, an excerpt, when). Pierre still declines conversationally in-chat;
-- this is the moderation trail. Not a comment, so it lives in its own object (the
-- comment_flag table is comment-scoped). Best-effort + fail-open: a classifier error
-- writes nothing and never blocks the chat.
CREATE TABLE IF NOT EXISTS flagged_request (
  id         TEXT    PRIMARY KEY,
  user_email TEXT,
  category   TEXT,                -- Llama Guard category, e.g. 'S12' (Sexual Content)
  excerpt    TEXT,                -- the triggering user message (truncated)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flagged_request_time ON flagged_request(created_at);
