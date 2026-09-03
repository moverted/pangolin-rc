-- Fold the invest.pangolinrc.com "Request the deck" form into the waitlist table as
-- a second kind of contact, so the admin portal has ONE contact list. `list_type`
-- distinguishes the join-form waitlist from investor deck requests; existing rows
-- default to 'waitlist'. `company` is captured on the investor form only.
ALTER TABLE waitlist ADD COLUMN company   TEXT;
ALTER TABLE waitlist ADD COLUMN list_type TEXT NOT NULL DEFAULT 'waitlist';
