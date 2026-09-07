-- Provisioned accounts (the founder's circle). We can pre-create a member row — email +
-- first-name username, no password — before that person ever logs in. `pw_required = 1`
-- marks such a row: on their first login the app FORCES them to set a password (rather than
-- the legacy no-password auto-allow that the demo account relies on). The flag is cleared the
-- moment a password is set (signup upsert), so it is a one-time gate, not a permanent state.
--   NULL / 0 = normal account (legacy no-password auto-allow, or a real hashed password)
--   1        = provisioned, must set a password on first login
ALTER TABLE users ADD COLUMN pw_required INTEGER;
