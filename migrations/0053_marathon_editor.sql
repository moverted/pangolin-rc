-- Marathon creator/editor: members can now build their own marathons (curated maps)
-- by talking to Pierre and edit them under BROWSE > COLLECT. A member-built marathon is
-- a `maps` row with kind='user' and owner_email=<member> (owner_email already exists from
-- 0012; NULL there = global/community). Two new columns:
--   blurb      — the one-line description shown/edited in the COLLECT editor
--   updated_at — last edit time (created_at already exists)
-- Idempotency: SQLite has no "ADD COLUMN IF NOT EXISTS"; the migrations runner records
-- which files ran, so these fire exactly once.
ALTER TABLE maps ADD COLUMN blurb TEXT;
ALTER TABLE maps ADD COLUMN updated_at INTEGER;
