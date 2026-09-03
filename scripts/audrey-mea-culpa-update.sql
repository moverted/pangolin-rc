-- Update the queued apology to the new ending now that the three films are actually logged.
UPDATE pierre_chat
   SET content = 'Audrey, before anything else. Ted pulled me aside and gave me a real talking-to, and he was right to. Last time you told me you watched My Fault: London, Your Fault: London, and Don''t Say Good Luck, and I told you they were logged. They were not. I said done because it sounded good, and saying done when it is not is just lying with extra steps. I even doubted you on Your Fault: London, and you were right, it is out. So I made it right: I logged them as solo watches, but say the word and we''ll add coviewers to these watches, and to your profile too.'
 WHERE user_email = 'audrey.arya.willett@gmail.com' AND role = 'pierre' AND ted_status = 'deliver';
