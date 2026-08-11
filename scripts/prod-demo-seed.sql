-- PRODUCTION demo cards (ADDITIVE, non-destructive). Two clearly-labeled demo
-- accounts so edward's feed shows a friend (Alex, watching Hacks S05E09) and a
-- follow-back (Sam, saw The Flash) alongside his real data. Idempotent (safe re-run).

-- Clean prior runs of these demo accounts + my earlier like smoke-test artifact.
DELETE FROM watch_comment WHERE user_email IN ('alex.demo@pangolinrc.app','sam.demo@pangolinrc.app');
DELETE FROM watch_episode WHERE user_email IN ('alex.demo@pangolinrc.app','sam.demo@pangolinrc.app');
DELETE FROM watch_title   WHERE user_email IN ('alex.demo@pangolinrc.app','sam.demo@pangolinrc.app');
DELETE FROM follows WHERE follower_email IN ('alex.demo@pangolinrc.app','sam.demo@pangolinrc.app') OR followee_email IN ('alex.demo@pangolinrc.app','sam.demo@pangolinrc.app');
DELETE FROM likes WHERE title_id = '__smoketest__';

INSERT OR IGNORE INTO users (email, username, created_at, updated_at) VALUES
  ('alex.demo@pangolinrc.app','Alex',1786492800000,1786492800000),
  ('sam.demo@pangolinrc.app','Sam',1786492800000,1786492800000);

-- Friend-slot headroom so tapping Sam's FOLLOW BACK completes the pair → friend.
-- (User-authorized 2026-08-11.)
UPDATE users SET user_type='elite_pro' WHERE email='edward.m.willett@gmail.com';

INSERT OR IGNORE INTO titles (title_id, source, name, kind, poster, premiered, updated_at) VALUES
  ('tvmaze:54914','tvmaze','Hacks','show','https://static.tvmaze.com/uploads/images/medium_portrait/621/1552621.jpg','2021-05-13',1786492800000),
  ('tmdb:298618','tmdb','The Flash','movie','https://image.tmdb.org/t/p/w342/rktDFPbfHfUbArZ6OOOKsXcv0Bm.jpg','2023-06-13',1786492800000);

INSERT OR IGNORE INTO episodes (episode_id, title_id, season, number, name, updated_at) VALUES
  ('tvmaze:54914:s5e9','tvmaze:54914',5,9,NULL,1786492800000);

-- Alex <-> edward mutual (friend); Sam -> edward one-way (FOLLOW BACK).
INSERT OR IGNORE INTO follows (follower_email, followee_email, created_at) VALUES
  ('alex.demo@pangolinrc.app','edward.m.willett@gmail.com',1786492800000),
  ('edward.m.willett@gmail.com','alex.demo@pangolinrc.app',1786492800000),
  ('sam.demo@pangolinrc.app','edward.m.willett@gmail.com',1786492800000);

INSERT OR REPLACE INTO watch_episode (user_email, episode_id, title_id, done, minute, updated_at) VALUES
  ('alex.demo@pangolinrc.app','tvmaze:54914:s5e9','tvmaze:54914',0,3,1786492800000);

INSERT OR REPLACE INTO watch_title (user_email, title_id, status, show_name, updated_at) VALUES
  ('alex.demo@pangolinrc.app','tvmaze:54914','current','Hacks',1786492800000),
  ('sam.demo@pangolinrc.app','tmdb:298618','completed','The Flash',1786492700000);

-- Alex's co-view comment in the first 5 minutes of Hacks S05E09 (3:00 → 180000 ms).
INSERT OR REPLACE INTO watch_comment (id, user_email, episode_id, show_id, timestamp_ms, transcription, is_reflection, private, is_endnote, spoiler, created_at) VALUES
  ('demo_alex_hacks','alex.demo@pangolinrc.app','S05E09','tvmaze:54914',180000,'The cold open had me on the floor.',0,0,0,0,1786492800000);
