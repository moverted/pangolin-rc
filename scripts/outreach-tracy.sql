-- Add Tracy Swedlow (TVOT founder) to the Outreach tracker (migration 0059/0060).
-- Idempotent: stable slug id + INSERT OR IGNORE. Apply with --file (not --command) so the
-- doubled-apostrophe escaping survives; see the wrangler --param gotcha in CLAUDE notes.
--   npx wrangler d1 execute pangolin-rc --remote --file scripts/outreach-tracy.sql
--
-- Reconciled against the LIVE schema, not the handoff doc: single `outreach` table in the
-- `pangolin-rc` DB (the "off-limits" note on that ID is stale — see CLAUDE.md), no
-- contacts/touches tables, no Airtable (retired 2026-08-18). Rich handoff context (org,
-- role, touch history, bespoke professional cadence) is folded into angle + notes, the only
-- free-text homes the real schema has. Cadence columns are left at defaults (stage 0,
-- next_due_at NULL) and status='Replied' (a cadence-halting status) so the generic 1wk/1mo
-- auto-follow-up engine does NOT nag on a professional contact — the bespoke cadence in
-- `notes` is Ted-managed. contact_email left blank (Ted has it; not shown in the thread).
INSERT OR IGNORE INTO outreach
  (id, name, handle, platform, follower_count, channel, status, angle, date_contacted, contact_email, notes, created_at)
VALUES
  ('tracy-swedlow', 'Tracy Swedlow', '', 'Other', NULL, 'Email', 'Replied',
   'TVOT (TV of Tomorrow Show) founder; TV-industry practitioner. Ask is a practitioner''s read on the Marathon-making tool, not a "try my app". Prefers text first, email second.',
   '2026-08-13', 'tracyswedlow@gmail.com',
   'TVOT (TV of Tomorrow Show) founder/organizer. Segment: professional (industry practitioner), NOT a creator - bespoke cadence, do NOT put on the generic 1wk/1mo auto follow-up. Owner ted@pangolinrc.com; SNW Cohort / Founder''s Circle. TestFlight: invite sent 2026-08-21; install status TBD - check App Store Connect (Testers). Contact: text-first (415 number on file with Ted), email second; contact_email TBD. Touches: 2026-08-13 email intro after a call; 2026-08-17 Tracy replied, interested in beta; 2026-08-18 Ted holding invite for bug fixes; 2026-08-20 Tracy "That works fine. No problem!"; 2026-08-21 Ted sent TestFlight invite link (Founder''s Circle); 2026-08-29 Ted offered a 15-min walkthrough/screen-share (LA), pending; 2026-09-08 text - Marathon Making build live (tell Pierre an idea, he names it and lays a course, you overrule him; "curious what a real programmer does with it"), pending. Cadence (professional; one unanswered ask, then give-not-ask): no touch through 2026-09-14 (78th Primetime Emmys week); 2026-09-16 check App Store Connect invited->installed (reminder, not a due task); Branch A installed + no reply -> 2026-09-21+ send a give (finished Ted-built marathon relevant to her, course visible, no ask); Branch B not installed -> no resend/re-explain, next touch 2026-10-05+ anchored to TVOT SF; Branch C she replies -> stop cadence, follow her lead. Anchors: 2026-11-05 Future of Television (LA); 2026-12-02..03 TVOT SF (in person, the real objective). Stop rule: after 2 consecutive unanswered touches -> dormant, quarterly value-only; do not escalate after silence.',
   strftime('%s','now')*1000);
