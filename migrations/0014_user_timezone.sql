-- The member's IANA time zone (e.g. 'America/Regina'), captured from the browser.
-- Lets the server render dates/times in the member's local time instead of guessing
-- from device clocks (which the spine never trusts).

ALTER TABLE users ADD COLUMN timezone TEXT;
