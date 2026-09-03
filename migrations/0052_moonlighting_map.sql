-- The Ultimate Moonlighting Rewatch — a curated map (reserved maps/map_steps from 0012).
-- When a member's watch_title.active_map_id points here, the app's Current/Next follows this
-- order instead of canonical air order. Global (owner_email NULL). Idempotent.
-- (Moonlighting = tvmaze:1487 must be materialized in the catalog for the episode_ids to exist.)
INSERT OR REPLACE INTO maps (map_id, title_id, name, kind, owner_email, created_at)
VALUES ('map:moonlighting-ultimate', 'tvmaze:1487', 'The Ultimate Moonlighting Rewatch', 'curated', NULL, 1756000000000);

DELETE FROM map_steps WHERE map_id = 'map:moonlighting-ultimate';
INSERT INTO map_steps (map_id, position, episode_id, next_episode_id) VALUES
  ('map:moonlighting-ultimate', 1, 'tvmaze:1487:s1e1',  'tvmaze:1487:s2e2'),
  ('map:moonlighting-ultimate', 2, 'tvmaze:1487:s2e2',  'tvmaze:1487:s2e4'),
  ('map:moonlighting-ultimate', 3, 'tvmaze:1487:s2e4',  'tvmaze:1487:s3e6'),
  ('map:moonlighting-ultimate', 4, 'tvmaze:1487:s3e6',  'tvmaze:1487:s3e7'),
  ('map:moonlighting-ultimate', 5, 'tvmaze:1487:s3e7',  'tvmaze:1487:s3e8'),
  ('map:moonlighting-ultimate', 6, 'tvmaze:1487:s3e8',  'tvmaze:1487:s4e13'),
  ('map:moonlighting-ultimate', 7, 'tvmaze:1487:s4e13', NULL);
