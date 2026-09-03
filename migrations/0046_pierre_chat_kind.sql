-- Chat "type" per turn so game sessions are distinguishable from free chat in the admin.
-- Set to 'game' while the Pierre "Do you want to play a game?" lane is active, else 'chat'.
-- The admin derives a session's Type as "Game Session" if ANY turn in the conversation is
-- 'game', so Ted can see how the streaming-shadow game is used and how it performs.
ALTER TABLE pierre_chat ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
CREATE INDEX IF NOT EXISTS idx_pierre_chat_kind ON pierre_chat(conversation_id, kind);
