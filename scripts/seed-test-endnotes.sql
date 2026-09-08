-- Fake END-NOTES (whole-episode reactions) for testing the new "friends' end-notes"
-- interstitial. is_endnote=1 + reveal_on='finish' → they reveal only once Ted marks the
-- episode finished (not on a timed mark). audio_r2_key reuses real recordings so Replay
-- plays real audio. ids prefixed 'seedtest-' for cleanup with the rest.

INSERT INTO watch_comment (id, user_email, episode_id, timestamp_ms, transcription, audio_r2_key, created_at, show_id, is_reflection, private, is_endnote, spoiler, reveal_on, hidden) VALUES
 -- The Gentlemen S02E02 (tvmaze:64992)
 ('seedtest-gent-en-01','aswillett@gmail.com','S02E02',3300000,'Whole episode was chaos in the best way. That ending though, did NOT expect Susie to play it like that.','audio-comments/tvmaze:64992/S02E01/3e202401-74ce-42ca-a883-dae36581112b',(strftime('%s','now')*1000),'tvmaze:64992',0,0,1,1,'finish',0),
 ('seedtest-gent-en-02','alex.demo@pangolinrc.app','S02E02',3300000,'Season 2 is cooking. Eddie is in way too deep now and I am completely here for it.','audio-comments/tvmaze:64992/S02E01/0ed37b14-20e3-4cb0-9430-6c985108d5cf',(strftime('%s','now')*1000),'tvmaze:64992',0,0,1,0,'finish',0),
 -- Silo S03E08 (tvmaze:38052)
 ('seedtest-silo-en-01','audrey.arya.willett@gmail.com','S03E08',3300000,'If that is how they leave Juliette going into the finale I am going to lose my mind.','audio-comments/tvmaze:38052/S03E07/b5e34198-7261-40a1-a776-c36ae0657a1f',(strftime('%s','now')*1000),'tvmaze:38052',0,0,1,1,'finish',0),
 ('seedtest-silo-en-02','tressanycamille@gmail.com','S03E08',3300000,'This episode broke me a little. The reveal about the Pact changes everything.','audio-comments/tvmaze:77427/S01E02/9d0e97ca-2242-489a-a5d0-7e4c36e98682',(strftime('%s','now')*1000),'tvmaze:38052',0,0,1,1,'finish',0);
