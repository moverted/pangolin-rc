-- coviewer: the people a user regularly watches TV with — "who's on your sofa".
-- The 1.0.2 co-watching theme (BACKLOG.md). Distinct from `follows`, which needs a
-- real account on BOTH ends: a coviewer may be accountless (name only, like Ted's
-- mother-in-law Rose), and is promotable later by filling `linked_email` once they
-- sign up. Typically the household / group-plan members.
--
-- The "default coviewing matrix" is not a separate table — it's the `is_default`
-- flag on these rows. A user with no default rows is solo (the default state).
-- Pierre reads the default set to answer loaded questions like "what are Anne and I
-- watching?" without being told who's in the room each time.
CREATE TABLE IF NOT EXISTS coviewer (
  id            TEXT    PRIMARY KEY,
  owner_email   TEXT    NOT NULL REFERENCES users(email),
  display_name  TEXT    NOT NULL,             -- "Rose Reis" (first + last, or first)
  relationship  TEXT    NOT NULL DEFAULT '',  -- free label: WIFE / DAUGHTER / SON / MOTHER IN LAW
  linked_email  TEXT,                          -- nullable → their pangolinRC account, once linked
  is_default    INTEGER NOT NULL DEFAULT 0,    -- 1 → part of the default coviewing matrix
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coviewer_owner ON coviewer(owner_email);
