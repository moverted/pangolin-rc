-- Tier becomes a STORED, subjective bucket (Top 10 / Top 25 / Top 50) rather than a band
-- derived from rank — a loose way to place a show broadly (a "top 10" tier may hold 30 shows).
-- Rank stays the fine order within a kind. Seed each ranked row from its current band as a
-- starting point the member/Pierre then adjusts.
ALTER TABLE streaming_shadow ADD COLUMN tier TEXT NOT NULL DEFAULT '';
UPDATE streaming_shadow SET tier = CASE
  WHEN rank <= 0 THEN ''
  WHEN rank <= 10 THEN 'Top 10'
  WHEN rank <= 25 THEN 'Top 25'
  ELSE 'Top 50' END
 WHERE hidden = 0;
