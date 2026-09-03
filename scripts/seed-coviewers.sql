-- LOCAL-ONLY seed of Ted's real coviewer roster, for 1.0.2 collaboration on
-- localhost. Not a migration — never apply to --remote. Idempotent: clears Ted's
-- rows first. Owner = ted@pangolinrc.com (a real local user).
--
--   Anne          WIFE          has account  DEFAULT (the default coviewing matrix)
--   Audrey Willett DAUGHTER      name-only
--   Bryce Willett  SON           name-only
--   Rose Reis      MOTHER IN LAW name-only
--
-- Anne "has account" — link her to a local anne user so the admin shows the
-- linked state. Swap linked_email to her real address when known.
INSERT OR IGNORE INTO users (email, username, created_at, updated_at)
  VALUES ('anne@local.test', 'Anne', CAST(strftime('%s','now') AS INTEGER)*1000, CAST(strftime('%s','now') AS INTEGER)*1000);

DELETE FROM coviewer WHERE owner_email = 'ted@pangolinrc.com';

INSERT INTO coviewer (id, owner_email, display_name, relationship, linked_email, is_default, created_at) VALUES
  (lower(hex(randomblob(16))), 'ted@pangolinrc.com', 'Anne',           'WIFE',          'anne@local.test', 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  (lower(hex(randomblob(16))), 'ted@pangolinrc.com', 'Audrey Willett', 'DAUGHTER',      NULL,              0, CAST(strftime('%s','now') AS INTEGER)*1000),
  (lower(hex(randomblob(16))), 'ted@pangolinrc.com', 'Bryce Willett',  'SON',           NULL,              0, CAST(strftime('%s','now') AS INTEGER)*1000),
  (lower(hex(randomblob(16))), 'ted@pangolinrc.com', 'Rose Reis',      'MOTHER IN LAW', NULL,              0, CAST(strftime('%s','now') AS INTEGER)*1000);
