-- A personal statement on a shadow entry, distinct from `feel` (which Pierre writes from
-- the LLM pass over the member's comments). `note` is the human's own words about the title,
-- edited in the admin (and, later, in-app). Never auto-written.
ALTER TABLE streaming_shadow ADD COLUMN note TEXT NOT NULL DEFAULT '';
