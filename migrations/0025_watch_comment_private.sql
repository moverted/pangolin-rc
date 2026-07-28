-- COMMENT_CLIP_SHARE stage 2: private "Journal" reflections.
-- A recorded reflection is uploaded PRIVATE; it becomes a public co-view comment
-- (that friends hear) only when the member taps Share. Journaled ones stay private —
-- excluded from the co-view feed, but still in the member's own logs.
-- Existing comments default to public (0), so nothing changes for prior data.
ALTER TABLE watch_comment ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
