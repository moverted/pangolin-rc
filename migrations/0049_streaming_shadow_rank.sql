-- A per-user ordering of the shadow. 0 = unranked (sorts last). `POST /shadow/rerank`
-- assigns 1..N to the best of our ability (sentiment love>like>meh>nope>unset, then weight,
-- then recency); the admin refines it by dragging rows or typing a rank number.
ALTER TABLE streaming_shadow ADD COLUMN rank INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_shadow_rank ON streaming_shadow(user_email, rank);
