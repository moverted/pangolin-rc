-- Make comment_flag a proper "flagged comment" record that tracks WHO/WHAT marked
-- a comment, not just a member tally. source distinguishes the origin of each mark:
--   'member' — a member tapped the red flag glyph (the default; existing rows)
--   'admin'  — an admin ticked the Hide checkbox in the panel
--   'auto'   — the content filter auto-flagged it (e.g. explicit/porn)
-- The Reports count on the admin Comments page counts source='member' only; the
-- flagged-object record keeps every mark with its author for the review trail.
ALTER TABLE comment_flag ADD COLUMN source TEXT NOT NULL DEFAULT 'member';
