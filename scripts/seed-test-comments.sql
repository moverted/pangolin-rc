-- Fake co-view comments for testing the co-view surfacing card. Authored by Ted's
-- mutual-follow friends so they pass the coview friendship gate. is_endnote=0 so they
-- surface mid-episode as Ted's watch position crosses each mark (reveal = mark + 30s).
-- audio_r2_key reuses REAL existing recordings so Replay plays actual audio.
-- All ids are prefixed 'seedtest-' for easy cleanup:
--   DELETE FROM watch_comment WHERE id LIKE 'seedtest-%';

-- ── The Gentlemen S02E02 (tvmaze:64992) — for tonight ──
INSERT INTO watch_comment (id, user_email, episode_id, timestamp_ms, transcription, audio_r2_key, created_at, show_id, is_reflection, private, is_endnote, spoiler, hidden) VALUES
 ('seedtest-gent-01','tressanycamille@gmail.com','S02E02',120000,'Okay Eddie in that turtleneck is doing things to me, I said what I said.','audio-comments/tvmaze:64992/S02E01/3e202401-74ce-42ca-a883-dae36581112b',(strftime('%s','now')*1000),'tvmaze:64992',0,0,0,0,0),
 ('seedtest-gent-02','audrey.arya.willett@gmail.com','S02E02',420000,'Susie Glass runs that whole operation better than anyone and I NEED her coat.','audio-comments/tvmaze:64992/S02E01/0ed37b14-20e3-4cb0-9430-6c985108d5cf',(strftime('%s','now')*1000),'tvmaze:64992',0,0,0,0,0),
 ('seedtest-gent-03','aswillett@gmail.com','S02E02',900000,'Wait did Freddy really just do that?? This family is completely unhinged lol','audio-comments/tvmaze:77427/S01E02/9d0e97ca-2242-489a-a5d0-7e4c36e98682',(strftime('%s','now')*1000),'tvmaze:64992',0,0,0,0,0),
 ('seedtest-gent-04','alex.demo@pangolinrc.app','S02E02',1500000,'The way this show makes crime look so POSH. Ritchie never misses.','audio-comments/tvmaze:77427/S01E01/13d8bb6d-2d65-43b1-a109-13d70555d2dd',(strftime('%s','now')*1000),'tvmaze:64992',0,0,0,0,0),
 ('seedtest-gent-05','aweid8@gmail.com','S02E02',2100000,'not me gasping out loud at that reveal, absolutely did not see it coming','audio-comments/tvmaze:77427/S01E01/a424ad11-667b-46d7-9738-b625518c6f3e',(strftime('%s','now')*1000),'tvmaze:64992',0,0,0,0,0);

-- ── Silo S03E08 (tvmaze:38052) — for tomorrow morning ──
INSERT INTO watch_comment (id, user_email, episode_id, timestamp_ms, transcription, audio_r2_key, created_at, show_id, is_reflection, private, is_endnote, spoiler, hidden) VALUES
 ('seedtest-silo-01','tressanycamille@gmail.com','S03E08',120000,'Juliette better make it out of this, I will not survive if they kill her off.','audio-comments/tvmaze:38052/S03E07/b5e34198-7261-40a1-a776-c36ae0657a1f',(strftime('%s','now')*1000),'tvmaze:38052',0,0,0,0,0),
 ('seedtest-silo-02','audrey.arya.willett@gmail.com','S03E08',420000,'the silence in this show is so tense I keep forgetting to breathe.','audio-comments/tvmaze:64992/S02E01/3e202401-74ce-42ca-a883-dae36581112b',(strftime('%s','now')*1000),'tvmaze:38052',0,0,0,0,0),
 ('seedtest-silo-03','aswillett@gmail.com','S03E08',900000,'okay but who actually wrote the Pact?? I need answers before the finale.','audio-comments/tvmaze:64992/S02E01/0ed37b14-20e3-4cb0-9430-6c985108d5cf',(strftime('%s','now')*1000),'tvmaze:38052',0,0,0,0,0),
 ('seedtest-silo-04','alex.demo@pangolinrc.app','S03E08',1500000,'The cinematography down in the silo is unreal every single episode.','audio-comments/tvmaze:77427/S01E02/9d0e97ca-2242-489a-a5d0-7e4c36e98682',(strftime('%s','now')*1000),'tvmaze:38052',0,0,0,0,0),
 ('seedtest-silo-05','aweid8@gmail.com','S03E08',2400000,'Finale energy and I am not ready to say goodbye to this crew','audio-comments/tvmaze:77427/S01E01/13d8bb6d-2d65-43b1-a109-13d70555d2dd',(strftime('%s','now')*1000),'tvmaze:38052',0,0,0,0,0);
