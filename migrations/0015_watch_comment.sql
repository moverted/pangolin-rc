-- Audio comment transcripts: one per recording event
CREATE TABLE watch_comment (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  transcription TEXT,
  audio_r2_key TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_email) REFERENCES users(email)
);
CREATE INDEX idx_watch_comment_episode ON watch_comment(episode_id);
CREATE INDEX idx_watch_comment_user_ep ON watch_comment(user_email, episode_id);
