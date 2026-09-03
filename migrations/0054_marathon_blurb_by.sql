-- Marathon blurbs are always attributed. A blurb starts as Pierre's draft (blurb_by =
-- 'Pierre the Pangolin') and, the moment a member edits the prose, re-attributes to that
-- member (blurb_by = their display name, e.g. 'Ted'). Stored as a separate column so the
-- editor textarea only ever holds the prose — the byline is rendered from blurb_by, never
-- typed into the text.
ALTER TABLE maps ADD COLUMN blurb_by TEXT;
