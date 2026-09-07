-- Seed the Outreach table (migration 0059). Idempotent: stable slug ids + INSERT OR
-- IGNORE, so re-running never duplicates. Apply with --file (not --command) so the
-- doubled-apostrophe escaping survives; see the wrangler --param gotcha in CLAUDE notes.
--   npx wrangler d1 execute pangolin-rc --remote --file scripts/outreach-seed.sql
--
-- contact_email is set for the two contacts already downstream in the funnel
-- (Melanie: invited waitlist + prospect user; Tressany: prospect user) so the admin
-- Funnel column lights up "Member" automatically instead of us hand-typing Converted.
INSERT OR IGNORE INTO outreach
  (id, name, handle, platform, follower_count, channel, status, angle, date_contacted, contact_email, notes, created_at)
VALUES
  ('jenni-cullen', 'Jenni Cullen', 'jennicullen.tv', 'Instagram', 7600, 'DM', 'Sent',
   'Referenced her TV recommendation reels; introduced Marathon Maker.',
   '2026-09-06', '',
   'Writer, co-host of @dbltakepod. 7.6K followers.',
   strftime('%s','now')*1000),

  ('ceethree-carpenter', 'Ceethree Carpenter', 'theceethree', 'Instagram', 499, 'DM', 'Sent',
   'Star Trek episode-riches angle for Marathon Maker.',
   '2026-09-06', '',
   'Star Trek / Marvel / Star Wars mega-fan; podcast host.',
   strftime('%s','now')*1000),

  ('melanie-greenwald', 'Melanie Greenwald', 'centralparkbookmark', 'Instagram', NULL, 'DM', 'Converted',
   'Weekly watchlist format tie-in; sent join.pangolinrc.com funnel link.',
   '2026-09-04', 'centralparkbookmark1@gmail.com',
   'Filled out the join form (fav show: My So Called Life). TestFlight: No Builds Available as of last check; out of town until next week. Already invited on the waitlist + a prospect user.',
   strftime('%s','now')*1000),

  ('tressany-camille', 'Tressany Camille', 'tressandthecity', 'Instagram', NULL, 'Email', 'Sent',
   'Warm follow-up referencing the personalized Psych marathon page built for her in July; explained Pierre mechanics.',
   '2026-09-06', 'tressanycamille@gmail.com',
   'Existing warm relationship; doesn''t check DMs, pointed to email. Screenshots attached: marathon detail page w/ Pierre blurb, completions tracking. Already provisioned as a Founder''s Circle prospect.',
   strftime('%s','now')*1000),

  ('marjorene11', 'Marjorene11', 'marjorene11', 'Instagram', 91400, 'Email', 'Sent',
   'Gen X TV dysfunction angle; daughter / Cybill Shepherd - Bruce Willis anecdote; Moonlighting marathon attached.',
   '2026-09-06', '',
   '91.4K followers, verified, Detroit-based Gen X nostalgia creator. Subject line: Do bees, bee? do bears, bear?',
   strftime('%s','now')*1000),

  ('stephanie-m', 'Stephanie M', 'talkswithatvwriter', 'Instagram', 92500, 'Email', 'Drafted',
   'Referenced her Widow''s Bay and Furious content; working-TV-writer angle.',
   '2026-09-06', '',
   '92.5K followers, LA-based TV writer. Subject: POV: you get early access to Marathon Maker.',
   strftime('%s','now')*1000);
