-- Admin-editable status for waitlist entries, managed from the users.pangolinrc.com
-- page. Additive; existing rows default to 'new'. Values used by the UI:
-- new | invited | active | declined.
ALTER TABLE waitlist ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
