-- Synopsis on the shared catalog. TVmaze ships `show.summary` (HTML) and TMDB
-- ships `movie.overview` (plain text); both are captured at materialization,
-- stripped to plain text, and surfaced on the Log card + the episode face.
-- Existing rows fill lazily on the next title-detail read.
ALTER TABLE titles ADD COLUMN summary TEXT;

-- Per-episode synopsis too: TVmaze ships `episode.summary` in the same embed we
-- already fetch, so capturing it is free. The episode face prefers this; it falls
-- back to the title summary for movies / titles materialized before this column.
ALTER TABLE episodes ADD COLUMN summary TEXT;
