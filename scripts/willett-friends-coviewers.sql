-- Ted / Audrey / Abby: all three mutual friends (see each other's FEED). Coviewers only
-- Ted<->Audrey and Audrey<->Abby; Ted and Abby are friends but NOT coviewers.

-- Missing follow directions (Audrey->Abby already exists; Ted<->Abby already mutual).
INSERT OR IGNORE INTO follows (follower_email, followee_email, created_at) VALUES
  ('ted@pangolinrc.com',           'audrey.arya.willett@gmail.com', CAST(strftime('%s','now') AS INTEGER)*1000),
  ('audrey.arya.willett@gmail.com','ted@pangolinrc.com',            CAST(strftime('%s','now') AS INTEGER)*1000),
  ('aweid8@gmail.com',             'audrey.arya.willett@gmail.com', CAST(strftime('%s','now') AS INTEGER)*1000);

-- Audrey's coviewer roster gains Ted and Abby, linked to their real accounts.
-- (Ted already has Audrey linked; leave it.)
INSERT INTO coviewer (id, owner_email, display_name, relationship, linked_email, is_default, created_at) VALUES
  (lower(hex(randomblob(16))), 'audrey.arya.willett@gmail.com', 'Ted',  'DAD',    'ted@pangolinrc.com', 0, CAST(strftime('%s','now') AS INTEGER)*1000),
  (lower(hex(randomblob(16))), 'audrey.arya.willett@gmail.com', 'Abby', 'FRIEND', 'aweid8@gmail.com',   0, CAST(strftime('%s','now') AS INTEGER)*1000);

-- Link Abby's existing name-only 'Audrey' coviewer to Audrey's account.
UPDATE coviewer SET linked_email = 'audrey.arya.willett@gmail.com'
 WHERE owner_email = 'aweid8@gmail.com' AND display_name = 'Audrey' AND linked_email IS NULL;
