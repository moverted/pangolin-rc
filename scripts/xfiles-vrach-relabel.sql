-- Add the confirmed Aug-14 Hulu/Disney+ director's cut as its own manual catalog
-- title (TMDB has not listed the retitle yet), then swap it into Ted's queue in
-- place of the 2008 film row. Reuses the 2008 TMDB poster until real key art lands.

-- 1) Manual catalog title (does not touch the shared tmdb:8836 row).
INSERT INTO titles (title_id, source, name, kind, status, poster, platform, total_episodes, premiered, updated_at, summary)
VALUES (
  'manual:xfiles-vrach-frankenshteyn', 'manual',
  'The X-Files: I Want to Believe – Vrach Frankenshteyn', 'movie', 'Released',
  'https://image.tmdb.org/t/p/w342/3zQMhutUMJP6lK49x7i2YfsOHL9.jpg',
  'Disney+ / Hulu', 1, '2026-08-14', strftime('%s','now')*1000,
  'When a group of women is mysteriously abducted, it becomes a case right out of The X-Files. Years after walking away from the FBI, Fox Mulder and Dr. Dana Scully are pulled back from the shadows when a federal agent vanishes without a trace. In a case you''d never see on TV, their only lead is a disgraced, defrocked priest claiming to have horrific psychic visions of the crime. Forced to confront the ghosts of their past, the partners must navigate a chilling winter landscape and an even darker human monstrosity. The truth of these crimes is out there somewhere … and it will take Mulder and Scully to find it.'
)
ON CONFLICT(title_id) DO UPDATE SET
  name=excluded.name, poster=excluded.poster, platform=excluded.platform,
  premiered=excluded.premiered, summary=excluded.summary, updated_at=excluded.updated_at;

-- 2) Its single movie unit.
INSERT INTO episodes (episode_id, title_id, season, number, name, runtime, airdate, updated_at, summary)
VALUES (
  'manual:xfiles-vrach-frankenshteyn:s1e1', 'manual:xfiles-vrach-frankenshteyn',
  1, 1, 'The X-Files: I Want to Believe – Vrach Frankenshteyn', 104, '2026-08-14',
  strftime('%s','now')*1000,
  'R-rated director''s cut of the 2008 film — Chris Carter''s darker, original vision.'
)
ON CONFLICT(episode_id) DO UPDATE SET
  name=excluded.name, airdate=excluded.airdate, updated_at=excluded.updated_at;

-- 3) Put it in Ted's queue.
INSERT INTO watch_title (user_email, title_id, show_name, status, active_map_id, current_episode_id, started_at, updated_at)
VALUES (
  'ted@pangolinrc.com', 'manual:xfiles-vrach-frankenshteyn',
  'The X-Files: I Want to Believe – Vrach Frankenshteyn', 'current', NULL,
  'manual:xfiles-vrach-frankenshteyn:s1e1', strftime('%s','now')*1000, strftime('%s','now')*1000
)
ON CONFLICT(user_email, title_id) DO NOTHING;

INSERT INTO watch_episode (user_email, episode_id, title_id, show_name, episode_name, done, minute, bp, sessions, updated_at)
VALUES (
  'ted@pangolinrc.com', 'manual:xfiles-vrach-frankenshteyn:s1e1',
  'manual:xfiles-vrach-frankenshteyn',
  'The X-Files: I Want to Believe – Vrach Frankenshteyn',
  'The X-Files: I Want to Believe – Vrach Frankenshteyn', 0, 0, 0, NULL, strftime('%s','now')*1000
)
ON CONFLICT(user_email, episode_id) DO NOTHING;

-- 4) Remove the 2008 placeholder from Ted's queue (leaves the shared catalog row intact).
DELETE FROM watch_episode WHERE user_email='ted@pangolinrc.com' AND title_id='tmdb:8836';
DELETE FROM watch_title   WHERE user_email='ted@pangolinrc.com' AND title_id='tmdb:8836';
