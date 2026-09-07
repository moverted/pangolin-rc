-- Outreach: creators/influencers WE contact (cold DM or email), distinct from the
-- inbound `waitlist` table (people who signed up themselves). This is the top of the
-- funnel — an outreach contact who later fills join.pangolinrc.com becomes a waitlist
-- row, then a users row. We fold the two together by matching contact_email, so the
-- admin Outreach view surfaces each contact's live funnel state (waitlist/member)
-- rather than making "Converted" a hand-maintained guess.
--
-- Column naming follows the D1 conventions in this repo: lowercase snake_case,
-- created_at as ms-epoch INTEGER. date_contacted is a hand-entered calendar day, so
-- it is stored as an ISO 'YYYY-MM-DD' TEXT (like episodes.airdate), not an epoch.
CREATE TABLE IF NOT EXISTS outreach (
  id             TEXT    PRIMARY KEY,        -- stable slug; idColumn for admin inline-edit
  name           TEXT    NOT NULL DEFAULT '',
  handle         TEXT    NOT NULL DEFAULT '',-- social handle / account name
  platform       TEXT    NOT NULL DEFAULT '',-- Instagram / Twitter / TikTok / YouTube / Email / Other
  follower_count INTEGER,                     -- optional, for sizing influence
  channel        TEXT    NOT NULL DEFAULT 'DM',   -- DM | Email
  status         TEXT    NOT NULL DEFAULT 'Drafted', -- Drafted|Sent|Replied|Converted|Declined|No Response
  angle          TEXT    NOT NULL DEFAULT '',-- the hook / personalization used
  date_contacted TEXT,                        -- ISO 'YYYY-MM-DD', hand-entered
  contact_email  TEXT    NOT NULL DEFAULT '', -- optional; the join to waitlist/users
  notes          TEXT    NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL
);

-- The funnel fold matches lower(contact_email) against waitlist.email / users.email.
CREATE INDEX IF NOT EXISTS idx_outreach_email ON outreach (contact_email);
