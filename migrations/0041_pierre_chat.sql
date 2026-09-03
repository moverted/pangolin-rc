-- Pierre chat transcripts, one row per TURN, grouped by conversation_id (a whole
-- session on the Pierre face). Saved every turn by POST /pierre/chat. Gradeable: an
-- admin sets `grade` on Pierre's turns to trail response quality over time. Distinct
-- from watch_comment (episode reflections) — this is the free chat, its own admin tab.
CREATE TABLE IF NOT EXISTS pierre_chat (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL,
  user_email      TEXT,
  seq             INTEGER NOT NULL,
  role            TEXT    NOT NULL,           -- 'user' | 'pierre'
  content         TEXT    NOT NULL,
  grade           TEXT    NOT NULL DEFAULT '', -- admin grade on pierre turns
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pierre_chat_convo ON pierre_chat(conversation_id, seq);
