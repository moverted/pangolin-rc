-- One-time transcription correction. Whisper isn't perfect, so the author may
-- fix the words once; transcript_edited holds the instant they did, and a
-- non-NULL value locks further edits (the pencil disappears). "Editable, but not
-- forever" — exactly one correction.
ALTER TABLE watch_comment ADD COLUMN transcript_edited INTEGER;
