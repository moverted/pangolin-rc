-- In-app bug reports: a persistent 🐞 in the shell lets anyone (logged in or not)
-- file a report with an optional screenshot. The author fields/triages these by
-- hand for now, so `status` is a free triage column (new → triaged → fixed/wontfix)
-- editable from the Airtable mirror and pulled back into D1.
--
-- No FK on user_email: not-signed-in users can still report, so the column is a
-- best-effort attribution, not a constraint. Screenshot lives in R2 at the
-- deterministic key bug-reports/<id>.png (no column needed to serve it);
-- screenshot_url is the served URL, carried for quick triage + Airtable display.
CREATE TABLE bug_report (
  id            TEXT PRIMARY KEY,
  user_email    TEXT,
  note          TEXT,
  view          TEXT,
  url           TEXT,
  user_agent    TEXT,
  viewport      TEXT,
  screenshot_url TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_bug_report_created ON bug_report(created_at);
CREATE INDEX idx_bug_report_status ON bug_report(status);
