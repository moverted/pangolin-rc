-- "Send to Claude" flag on a bug report. Admins tick this in the reporter to queue
-- the bug for an automated Claude Code pass. The flag is just a queue marker — a
-- consumer (local session, scheduled cloud agent, or GitHub Action) does the work.
--   send_to_claude: 0/1 — admin asked for an automated fix.
--   claude_status:  queued | working | done | skipped (NULL until picked up).
ALTER TABLE bug_report ADD COLUMN send_to_claude INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bug_report ADD COLUMN claude_status  TEXT;
CREATE INDEX IF NOT EXISTS idx_bug_report_claude ON bug_report(send_to_claude, claude_status);
