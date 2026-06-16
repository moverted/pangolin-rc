-- Returning-user passwords. Stored as a PBKDF2 salt + hash, never plaintext.
-- Existing rows (created before this) have null hashes and log in without a
-- password until one is set.
ALTER TABLE users ADD COLUMN pw_salt TEXT;
ALTER TABLE users ADD COLUMN pw_hash TEXT;
