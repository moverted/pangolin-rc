-- Which TestFlight cohort a waitlist entry was assigned to, set by hand from the
-- admin.pangolinrc.com portal alongside status. Additive; existing rows default to
-- '' (rendered as "Unassigned" in the UI). Named test_group because `group` is a
-- reserved SQL word. Values used by the UI:
-- Unassigned | Friends & Family Cohort 1 | Internal | SNW Cohort | Tester Cohort 1.
ALTER TABLE waitlist ADD COLUMN test_group TEXT NOT NULL DEFAULT '';
