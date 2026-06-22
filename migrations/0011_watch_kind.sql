-- Movies. A film is a single unit: no season/number, one runtime to sit inside.
-- It rides the same `watch` table as shows; `kind` is what tells them apart so
-- the Episode face, Log, and Feed can render a film without season/episode chrome.
--   'show'  : TVmaze series (the existing default)
--   'movie' : a TMDB film (show_id = 'tmdb:<id>', last_season/last_number stay NULL)
ALTER TABLE watch ADD COLUMN kind TEXT NOT NULL DEFAULT 'show';
