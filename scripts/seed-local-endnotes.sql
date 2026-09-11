-- LOCAL-ONLY seed to demo the end-of-episode "friends' end notes" interstitial.
-- Authors are ted@local.test's mutual-follow friends (Alex + Sam). is_endnote=1 +
-- reveal_on='finish' → they reveal only once Ted marks the episode finished. Target:
-- Hard Knocks (tvmaze:891) S21E01 — Ted's current show. episode_id uses the client
-- epCode format (S21E01), show_id is the title id. All ids prefixed 'localdemo-'.
--   Cleanup: DELETE FROM watch_comment WHERE id LIKE 'localdemo-%';

-- Complete the mutual follow so Sam passes the co-view gate (Alex↔Ted already mutual).
INSERT OR IGNORE INTO follows (follower_email, followee_email, created_at) VALUES
  ('ted@local.test','sam@local.test',(strftime('%s','now')*1000));

DELETE FROM watch_comment WHERE id LIKE 'localdemo-%';

INSERT INTO watch_comment (id, user_email, episode_id, timestamp_ms, transcription, audio_r2_key, created_at, show_id, is_reflection, private, is_endnote, spoiler, reveal_on, hidden) VALUES
 ('localdemo-en-01','alex@local.test','S21E01',3300000,'What an opener for the season — the whole locker-room arc had me hooked. No spoilers but stick around for the last five minutes.',NULL,(strftime('%s','now')*1000),'tvmaze:891',0,0,1,0,'finish',0),
 ('localdemo-en-02','sam@local.test','S21E01',3300000,'Okay that final cut to the coach after the injury reveal — did NOT see that coming. Absolutely broke me.',NULL,(strftime('%s','now')*1000),'tvmaze:891',0,0,1,1,'finish',0);
