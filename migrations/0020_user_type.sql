-- Membership tier + founding-member flag on users.
--   user_type:  admin | basic | elite | elite_pro  (default 'basic')
--   founding_member: 0/1 checkbox — set by hand for the early cohort.
-- SEAM:policy — what each tier unlocks is decided by the instance; this migration
-- only adds the columns the policy layer reads. The admin tier also gates the
-- in-app bug-review surface (GET /bug-reports).
ALTER TABLE users ADD COLUMN user_type       TEXT    NOT NULL DEFAULT 'basic';
ALTER TABLE users ADD COLUMN founding_member  INTEGER NOT NULL DEFAULT 0;

-- The author's account is the admin. Harmless if the row does not exist yet
-- (it is created on first sign-in; promote-on-sign-in is handled server-side too).
UPDATE users SET user_type = 'admin' WHERE email = 'edward.m.willett@gmail.com';
