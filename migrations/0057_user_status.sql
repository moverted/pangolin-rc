-- Admin-managed account status for the Users table in the admin portal. A free classification
-- the founder sets inline: 'active' (a real, live member), 'prospect' (pre-provisioned, not yet
-- claimed), 'dummy' (a seed/demo/test account), 'waitlist' (parked), or 'inactive' (a real
-- account gone quiet). Left NULL here; the admin list
-- derives a sensible default (seed accounts → dummy, everyone else → active) until overridden, so
-- existing rows read correctly without a backfill.
ALTER TABLE users ADD COLUMN status TEXT;
