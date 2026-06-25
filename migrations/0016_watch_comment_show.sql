-- Tie each audio comment to its show/movie so the episode face can load a
-- title's comments without colliding on bare episode codes (S01E01 repeats
-- across shows). episode_id stays the human code (S01E01 / 🎬); show_id is the
-- universal title key (tvmaze:<id> / tmdb:<id>).
ALTER TABLE watch_comment ADD COLUMN show_id TEXT;
CREATE INDEX idx_watch_comment_show ON watch_comment(show_id, user_email);
