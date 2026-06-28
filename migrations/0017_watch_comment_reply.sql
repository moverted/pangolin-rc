-- Co-view replies: a reply is a watch_comment authored by the second viewer in
-- response to a friend's comment. reply_to points at the parent comment id; the
-- reply inherits the parent's timestamp_ms so it threads at the same minute mark.
-- Replies carry text only (no audio_r2_key) — the audio side is the original.
ALTER TABLE watch_comment ADD COLUMN reply_to TEXT;
CREATE INDEX idx_watch_comment_reply ON watch_comment(reply_to);
