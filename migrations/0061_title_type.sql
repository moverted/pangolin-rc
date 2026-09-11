-- 0061_title_type.sql
-- The COMPLETED résumé needs to tell a LIMITED SERIES (TVmaze type "Miniseries")
-- apart from a regular SERIES. titles previously stored only `status`
-- (Ended/Running/Film), not the show's structural type. Add it, capture it at
-- materialize/refresh (src/handlers/catalog.ts), and seed the obvious cases here.
-- Existing show rows self-heal to their real TVmaze type on the next refresh.
ALTER TABLE titles ADD COLUMN type TEXT;

-- Movies are unambiguous — seed them now so the résumé reads FILM immediately.
UPDATE titles SET type = 'Film' WHERE kind = 'movie';
