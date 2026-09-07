-- Outreach follow-up cadence. Turns the passive `outreach` tracker (migration 0059)
-- into an active follow-up engine: after the initial send, a 1-week and then a 1-month
-- follow-up come due, each RE-ANCHORED on the ACTUAL send date of the prior step (not a
-- fixed offset from day 0 — Ted may take a couple days to send each one). A week after
-- the 1-month send with no reply, the row auto-transitions to 'Soft Decline'.
--
-- follow_up_stage: 0 = initial sent, awaiting the 1-week follow-up
--                  1 = 1-week sent, awaiting the 1-month follow-up
--                  2 = 1-month sent, awaiting the final (soft-decline) window
--                  3 = closed (soft-declined, or cadence halted by a status change)
--
-- next_due_at (ms epoch): when the next action is due; NULL when the cadence is halted
-- or closed. Stored (not derived) so the in-app follow-up queue + badge are cheap reads.
-- The *_sent_at columns are the real send timestamps that each next_due_at is anchored to.
ALTER TABLE outreach ADD COLUMN initial_draft   TEXT    NOT NULL DEFAULT '';
ALTER TABLE outreach ADD COLUMN one_week_draft  TEXT    NOT NULL DEFAULT '';
ALTER TABLE outreach ADD COLUMN one_month_draft TEXT    NOT NULL DEFAULT '';
ALTER TABLE outreach ADD COLUMN follow_up_stage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outreach ADD COLUMN initial_sent_at INTEGER;
ALTER TABLE outreach ADD COLUMN wk1_sent_at     INTEGER;
ALTER TABLE outreach ADD COLUMN mo1_sent_at     INTEGER;
ALTER TABLE outreach ADD COLUMN next_due_at     INTEGER;

-- The follow-up queue + soft-decline sweep both filter on next_due_at.
CREATE INDEX IF NOT EXISTS idx_outreach_next_due ON outreach (next_due_at);
