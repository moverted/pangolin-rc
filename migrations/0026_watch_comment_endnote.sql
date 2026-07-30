-- COMMENT_CLIP_SHARE revision (2026-07-29): end-notes + the one-reply lock.
-- See COMMENT_CLIP_SHARE.md "Revision — 2026-07-29" for the full spec.
--
-- Three new columns + one unique index. All existing rows default to the prior
-- behavior (is_endnote=0, spoiler=0, reveal_on=NULL), so nothing changes for data
-- already in the table — old recorded reflections keep their timecode rendering and
-- are NOT retroactively re-labeled as safe/spoiler.

-- The end-of-episode reflection kind. Distinct from is_reflection (which only marks
-- cap-exemption): is_endnote drives the SPLR/NOSP episode-level label, the 1-per-episode
-- cap, non-repliability, and reveal-on-finish. An end-note is both a reflection and an
-- end-note, so it sets is_reflection=1 AND is_endnote=1.
ALTER TABLE watch_comment ADD COLUMN is_endnote INTEGER NOT NULL DEFAULT 0;

-- The explicit Spoiler / No-spoiler choice from the finish flow. Until now the spoiler
-- toggle was client-only and unsaved; end-notes persist it so the label survives reload
-- and shows correctly to friends. 1 = SPLR (hides the quote on the share card), 0 = NOSP.
ALTER TABLE watch_comment ADD COLUMN spoiler INTEGER NOT NULL DEFAULT 0;

-- When a comment reveals to a friend. 'finish' = only once they mark the episode finished
-- (episode runtimes drift, so an end-note never trusts a computed minute). NULL/'mark' =
-- the existing minute-anchored reveal for in-episode comments. Stored as an explicit
-- marker so a later pass can change reveal semantics per-kind without a migration.
ALTER TABLE watch_comment ADD COLUMN reveal_on TEXT;

-- One reply per comment, enforced at the DB. A partial unique index over reply_to means
-- the second reply to the same parent is rejected atomically (first write wins; the client
-- turns the failure into "already answered"). NULL and '' are treated as "no parent" and
-- excluded, so originals are unaffected. Verified 2026-07-29: 5 replies / 5 distinct
-- parents / 0 empty-string reply_to, so this creates cleanly with no dedupe.
CREATE UNIQUE INDEX idx_watch_comment_reply_unique
  ON watch_comment(reply_to)
  WHERE reply_to IS NOT NULL AND reply_to <> '';
