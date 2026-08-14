-- Widen the waitlist for the public join.pangolinrc.com form. The original table
-- (0006) held only (email, created_at) from the in-app cap overflow. The join
-- form also captures who they are, the show that hooked them, and a friend to
-- pull in. email stays the PK, so a re-submit updates the same row.
ALTER TABLE waitlist ADD COLUMN first_name  TEXT;
ALTER TABLE waitlist ADD COLUMN last_name   TEXT;
ALTER TABLE waitlist ADD COLUMN fav_show    TEXT;
ALTER TABLE waitlist ADD COLUMN buddy_email TEXT;
ALTER TABLE waitlist ADD COLUMN source      TEXT;
