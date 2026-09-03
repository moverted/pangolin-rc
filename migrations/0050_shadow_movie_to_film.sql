-- Rename the shadow kind 'movie' → 'film' so the rank prefix F- (film) is distinct from
-- M- (mini-series). Data-only; the catalog `titles.kind` movie/show taxonomy is untouched.
UPDATE streaming_shadow SET kind = 'film' WHERE kind = 'movie';
