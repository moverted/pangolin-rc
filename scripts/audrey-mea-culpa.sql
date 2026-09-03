-- One-off: a Pierre-voiced apology to Audrey, delivered on her next open (role='pierre',
-- ted_status='deliver' → picked up by GET /profile/:email/ted-messages and rendered as a
-- Pierre bubble). created_at is server-now so it beats any seen high-water.
INSERT INTO pierre_chat (id, conversation_id, user_email, seq, role, content, grade, needs_ted, ted_status, created_at)
VALUES (
  lower(hex(randomblob(16))),
  lower(hex(randomblob(16))),
  'audrey.arya.willett@gmail.com',
  1,
  'pierre',
  'Audrey, before anything else. Ted pulled me aside and gave me a real talking-to, and he was right to. Last time you told me you watched My Fault: London, Your Fault: London, and Don''t Say Good Luck, and I told you they were logged. They were not. I said done because it sounded good, and saying done when it is not is just lying with extra steps. You deserve a straight answer from your pangolin. Here is what I should have said: let me actually put those in your log as watched, on the days you told me, with your ratings kept as your notes so your friends can see them too. Want to do that now, the right way?',
  '',
  0,
  'deliver',
  CAST(strftime('%s','now') AS INTEGER) * 1000
);
