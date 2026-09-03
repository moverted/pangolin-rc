-- Rename the founder app account from edward.m.willett@gmail.com to ted@pangolinrc.com
-- across every email-bearing column in the app DB (pangolin-rc). Idempotent: each
-- statement is a no-op once the old value is gone, so it is safe to re-run. No collision:
-- ted@pangolinrc.com did not exist before this ran. Does NOT touch Cloudflare SSO.
-- Defer FK checks to commit so the users PK and every child reference can move together
-- (the whole file runs in one D1 transaction).
PRAGMA defer_foreign_keys = ON;
UPDATE users                SET email          = 'ted@pangolinrc.com' WHERE email          = 'edward.m.willett@gmail.com';
UPDATE devices              SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE watch_title          SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE watch_episode        SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE watch_ticket         SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE watch_comment        SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE watch_pass           SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE watch_title_coviewer SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE reflection           SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE runtime_report       SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE pierre_chat          SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE room_seed            SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE egg_redemption       SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE mic_permission       SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE comment_flag         SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE comment_share        SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE flagged_request      SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE bug_report           SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE likes                SET user_email     = 'ted@pangolinrc.com' WHERE user_email     = 'edward.m.willett@gmail.com';
UPDATE likes                SET subject_email  = 'ted@pangolinrc.com' WHERE subject_email  = 'edward.m.willett@gmail.com';
UPDATE follows              SET follower_email = 'ted@pangolinrc.com' WHERE follower_email = 'edward.m.willett@gmail.com';
UPDATE follows              SET followee_email = 'ted@pangolinrc.com' WHERE followee_email = 'edward.m.willett@gmail.com';
UPDATE coviewer             SET owner_email    = 'ted@pangolinrc.com' WHERE owner_email    = 'edward.m.willett@gmail.com';
UPDATE coviewer             SET linked_email   = 'ted@pangolinrc.com' WHERE linked_email   = 'edward.m.willett@gmail.com';
UPDATE maps                 SET owner_email    = 'ted@pangolinrc.com' WHERE owner_email    = 'edward.m.willett@gmail.com';
UPDATE shares               SET from_email     = 'ted@pangolinrc.com' WHERE from_email     = 'edward.m.willett@gmail.com';
UPDATE shares               SET to_email       = 'ted@pangolinrc.com' WHERE to_email       = 'edward.m.willett@gmail.com';
UPDATE waitlist             SET email          = 'ted@pangolinrc.com' WHERE email          = 'edward.m.willett@gmail.com';
UPDATE waitlist             SET buddy_email    = 'ted@pangolinrc.com' WHERE buddy_email    = 'edward.m.willett@gmail.com';
