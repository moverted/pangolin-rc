-- Finished-episode reflections post as co-view comments (audio + transcription)
-- but are EXEMPT from the per-episode comment cap: they neither get rejected by
-- it nor count toward it. Flag them so POST /transcribe can do both.
ALTER TABLE watch_comment ADD COLUMN is_reflection INTEGER NOT NULL DEFAULT 0;
