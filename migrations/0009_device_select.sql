-- Device picker upgrades for the Profile face.
--   supported : 1 = a device we can actually drive today (LG TV, Amazon Fire
--               Cube) and show in the list; 0 = collected-but-unsupported
--               ("Other"), stored against the profile to size demand but kept
--               out of the visible picker until we add support and reach out.
--   selected_device : which device the member's remote is pointed at. Holds a
--               device id, or the sentinel 'phone' for the always-present
--               "This Phone". One selection at a time; NULL means This Phone.
ALTER TABLE devices ADD COLUMN supported INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users   ADD COLUMN selected_device TEXT;
