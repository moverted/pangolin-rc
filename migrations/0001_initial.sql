-- Resources: the logical slot submissions attach to.
-- Identified by server-assigned UUIDs, never device clocks.
CREATE TABLE IF NOT EXISTS resources (
  id         TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Submissions: one submitter's payload slot attached to a Resource.
-- State drives all visibility and access decisions.
CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT    PRIMARY KEY,
  resource_id  TEXT    NOT NULL REFERENCES resources(id),
  submitter_id TEXT    NOT NULL,
  state        TEXT    NOT NULL DEFAULT 'pending'
                       CHECK(state IN ('pending','ready','revealed','unrevealed','rejected','purged')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Policies: per-resource config blob (SEAM:policy — opaque JSON for now).
CREATE TABLE IF NOT EXISTS policies (
  id          TEXT    PRIMARY KEY,
  resource_id TEXT    NOT NULL UNIQUE REFERENCES resources(id),
  config      TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- AuditEntries: append-only log of every state transition and authority action.
CREATE TABLE IF NOT EXISTS audit_entries (
  id            TEXT    PRIMARY KEY,
  resource_id   TEXT,
  submission_id TEXT,
  actor_id      TEXT    NOT NULL,
  actor_role    TEXT    NOT NULL,
  action        TEXT    NOT NULL,
  from_state    TEXT,
  to_state      TEXT,
  created_at    INTEGER NOT NULL,
  metadata      TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_resource   ON submissions(resource_id);
CREATE INDEX IF NOT EXISTS idx_submissions_submitter  ON submissions(submitter_id);
CREATE INDEX IF NOT EXISTS idx_audit_submission       ON audit_entries(submission_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource         ON audit_entries(resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_created          ON audit_entries(created_at);
