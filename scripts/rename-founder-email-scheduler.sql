-- Same founder rename for the separate scheduler DB (pangolinrc-scheduler). Idempotent.
UPDATE sched_user        SET user_email = 'ted@pangolinrc.com' WHERE user_email = 'edward.m.willett@gmail.com';
UPDATE sched_mode_choice SET user_email = 'ted@pangolinrc.com' WHERE user_email = 'edward.m.willett@gmail.com';
UPDATE sched_badge       SET user_email = 'ted@pangolinrc.com' WHERE user_email = 'edward.m.willett@gmail.com';
UPDATE sched_sent        SET user_email = 'ted@pangolinrc.com' WHERE user_email = 'edward.m.willett@gmail.com';
