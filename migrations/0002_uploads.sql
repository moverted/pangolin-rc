-- Track in-progress and completed R2 multipart uploads.
-- One upload record per submission; initiated before the first part is sent.
CREATE TABLE IF NOT EXISTS uploads (
  submission_id TEXT    PRIMARY KEY REFERENCES submissions(id),
  r2_upload_id  TEXT    NOT NULL,
  r2_key        TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER           -- null until complete
);

-- Track confirmed uploaded parts so the client can resume from the last confirmed chunk.
-- ON CONFLICT allows idempotent re-upload of any part.
CREATE TABLE IF NOT EXISTS upload_parts (
  submission_id TEXT    NOT NULL REFERENCES uploads(submission_id),
  part_number   INTEGER NOT NULL,
  etag          TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  uploaded_at   INTEGER NOT NULL,
  PRIMARY KEY(submission_id, part_number)
);

CREATE INDEX IF NOT EXISTS idx_upload_parts_submission ON upload_parts(submission_id);
