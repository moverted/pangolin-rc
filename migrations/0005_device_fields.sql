-- Devices gain a network address and a model, needed to actually control them
-- (e.g. the bridge needs the IP; the model picks the control protocol).
ALTER TABLE devices ADD COLUMN ip    TEXT;
ALTER TABLE devices ADD COLUMN model TEXT;
