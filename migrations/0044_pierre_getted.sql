-- Pierre escalations ("Get Ted"). When Pierre hands a member off to Ted he ends the
-- reply with a hidden [GETTED] tag; the Worker strips it, stores the clean text, and sets
-- needs_ted=1 on that turn so the admin has a queue of moments that need a human.
-- ted_status lets Ted clear an item once handled ('' = open, 'handled').
ALTER TABLE pierre_chat ADD COLUMN needs_ted  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pierre_chat ADD COLUMN ted_status TEXT    NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_pierre_chat_needs_ted ON pierre_chat(needs_ted);

-- Backfill escalations that happened before the tag existed, by phrase, so the queue is
-- not empty on day one (catches session 22c4a1e3, the Utopia handoff).
UPDATE pierre_chat SET needs_ted = 1
 WHERE role = 'pierre'
   AND ( lower(content) LIKE '%get ted%'
      OR lower(content) LIKE '%ted''s got you%'
      OR lower(content) LIKE '%getted%' );
