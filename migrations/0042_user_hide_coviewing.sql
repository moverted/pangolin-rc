-- Feed privacy toggle for co-viewing. When 1, this user's per-title co-viewers are
-- NOT surfaced on the social feed. Co-viewing names third parties who never consented
-- (accountless family, e.g. a mother-in-law), so this is the opt-out. Default 0 =
-- shown, but only ever as FIRST NAMES and only to the user's connections (the feed is
-- already friend-scoped).
ALTER TABLE users ADD COLUMN hide_coviewing INTEGER NOT NULL DEFAULT 0;
