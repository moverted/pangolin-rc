import { Hono } from 'hono';
import type { Env, Submission, Upload, UploadPart } from '../types';
import { resolveActor } from '../identity';

async function enqueueProcessing(env: Env, submissionId: string, resourceId: string, r2Key: string): Promise<void> {
  await env.PROCESS_QUEUE.send({
    submission_id: submissionId,
    resource_id:   resourceId,
    r2_key:        r2Key,
    submitted_at:  Date.now(),
  });
}

export const uploadRoutes = new Hono<{ Bindings: Env }>();

// PUT /uploads/:submission_id — single-operation upload for payloads that fit in one request.
// Use multipart (POST /uploads/:id → parts → complete) for large files (parts must be ≥ 5 MiB each).
uploadRoutes.put('/:id', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const submissionId = c.req.param('id');

  const sub = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(submissionId)
    .first<Submission>();
  if (!sub) return c.json({ error: 'Not found' }, 404);
  if (actor.role === 'submitter' && sub.submitter_id !== actor.id) return c.json({ error: 'Forbidden' }, 403);
  if (sub.state !== 'pending') return c.json({ error: `Upload requires pending state (current: ${sub.state})` }, 409);

  const existing = await c.env.DB
    .prepare('SELECT completed_at FROM uploads WHERE submission_id = ?')
    .bind(submissionId)
    .first<Pick<Upload, 'completed_at'>>();
  if (existing?.completed_at) return c.json({ error: 'Upload already completed' }, 409);

  const body = c.req.raw.body;
  if (!body) return c.json({ error: 'Request body required' }, 400);

  const key = `raw/${sub.resource_id}/${submissionId}`;
  await c.env.RAW_BUCKET.put(key, body);

  const size = parseInt(c.req.header('Content-Length') ?? '0', 10);
  const now  = Date.now();

  // Use a sentinel uploadId so the record is consistent with multipart rows
  await c.env.DB
    .prepare(
      `INSERT INTO uploads (submission_id, r2_upload_id, r2_key, created_at, completed_at)
       VALUES (?, 'single-part', ?, ?, ?)
       ON CONFLICT(submission_id) DO UPDATE SET completed_at = excluded.completed_at`
    )
    .bind(submissionId, key, now, now)
    .run();

  await enqueueProcessing(c.env, submissionId, sub.resource_id, key);

  return c.json({ submission_id: submissionId, status: 'completed', size, completed_at: now });
});

// POST /uploads/:submission_id — initiate multipart upload; idempotent if already initiated
uploadRoutes.post('/:id', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const submissionId = c.req.param('id');

  const sub = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(submissionId)
    .first<Submission>();
  if (!sub) return c.json({ error: 'Not found' }, 404);

  if (actor.role === 'submitter' && sub.submitter_id !== actor.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (sub.state !== 'pending') {
    return c.json({ error: `Upload requires pending state (current: ${sub.state})` }, 409);
  }

  // Idempotent: return existing upload if already initiated
  const existing = await c.env.DB
    .prepare('SELECT * FROM uploads WHERE submission_id = ?')
    .bind(submissionId)
    .first<Upload>();

  if (existing) {
    if (existing.completed_at) return c.json({ error: 'Upload already completed' }, 409);
    return c.json({ submission_id: submissionId, r2_upload_id: existing.r2_upload_id, status: 'in_progress' });
  }

  const key        = `raw/${sub.resource_id}/${submissionId}`;
  const multipart  = await c.env.RAW_BUCKET.createMultipartUpload(key);
  const now        = Date.now();

  await c.env.DB
    .prepare('INSERT INTO uploads (submission_id, r2_upload_id, r2_key, created_at) VALUES (?, ?, ?, ?)')
    .bind(submissionId, multipart.uploadId, key, now)
    .run();

  return c.json({ submission_id: submissionId, r2_upload_id: multipart.uploadId, status: 'in_progress' }, 201);
});

// GET /uploads/:submission_id — return confirmed parts so client can resume from last known good chunk
uploadRoutes.get('/:id', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const submissionId = c.req.param('id');

  const sub = await c.env.DB
    .prepare('SELECT submitter_id FROM submissions WHERE id = ?')
    .bind(submissionId)
    .first<Pick<Submission, 'submitter_id'>>();
  if (!sub) return c.json({ error: 'Not found' }, 404);

  if (actor.role === 'submitter' && sub.submitter_id !== actor.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const upload = await c.env.DB
    .prepare('SELECT * FROM uploads WHERE submission_id = ?')
    .bind(submissionId)
    .first<Upload>();
  if (!upload) return c.json({ error: 'Upload not initiated' }, 404);

  const { results: parts } = await c.env.DB
    .prepare('SELECT part_number, etag, size, uploaded_at FROM upload_parts WHERE submission_id = ? ORDER BY part_number ASC')
    .bind(submissionId)
    .all<Pick<UploadPart, 'part_number' | 'etag' | 'size' | 'uploaded_at'>>();

  return c.json({
    submission_id: submissionId,
    status:        upload.completed_at ? 'completed' : 'in_progress',
    completed_at:  upload.completed_at,
    parts,
  });
});

// PUT /uploads/:submission_id/parts/:part_number — upload one chunk; idempotent (re-upload overwrites)
uploadRoutes.put('/:id/parts/:part_number', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const submissionId = c.req.param('id');
  const partNumber   = parseInt(c.req.param('part_number'), 10);

  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    return c.json({ error: 'part_number must be an integer between 1 and 10000' }, 400);
  }

  const [sub, upload] = await Promise.all([
    c.env.DB.prepare('SELECT submitter_id FROM submissions WHERE id = ?').bind(submissionId).first<Pick<Submission, 'submitter_id'>>(),
    c.env.DB.prepare('SELECT * FROM uploads WHERE submission_id = ?').bind(submissionId).first<Upload>(),
  ]);

  if (!sub)    return c.json({ error: 'Not found' }, 404);
  if (actor.role === 'submitter' && sub.submitter_id !== actor.id) return c.json({ error: 'Forbidden' }, 403);
  if (!upload) return c.json({ error: 'Upload not initiated — POST /uploads/:id first' }, 404);
  if (upload.completed_at) return c.json({ error: 'Upload already completed' }, 409);

  const body = c.req.raw.body;
  if (!body) return c.json({ error: 'Request body required' }, 400);

  const multipart = c.env.RAW_BUCKET.resumeMultipartUpload(upload.r2_key, upload.r2_upload_id);
  const uploaded  = await multipart.uploadPart(partNumber, body);

  const size = parseInt(c.req.header('Content-Length') ?? '0', 10);
  const now  = Date.now();

  // ON CONFLICT allows idempotent retry of any part
  await c.env.DB
    .prepare(
      `INSERT INTO upload_parts (submission_id, part_number, etag, size, uploaded_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(submission_id, part_number)
       DO UPDATE SET etag = excluded.etag, size = excluded.size, uploaded_at = excluded.uploaded_at`
    )
    .bind(submissionId, partNumber, uploaded.etag, size, now)
    .run();

  return c.json({ part_number: partNumber, etag: uploaded.etag });
});

// POST /uploads/:submission_id/complete — assemble all parts into the final R2 object
uploadRoutes.post('/:id/complete', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const submissionId = c.req.param('id');

  const [sub, upload] = await Promise.all([
    c.env.DB.prepare('SELECT submitter_id, resource_id FROM submissions WHERE id = ?').bind(submissionId).first<Pick<Submission, 'submitter_id' | 'resource_id'>>(),
    c.env.DB.prepare('SELECT * FROM uploads WHERE submission_id = ?').bind(submissionId).first<Upload>(),
  ]);

  if (!sub)    return c.json({ error: 'Not found' }, 404);
  if (actor.role === 'submitter' && sub.submitter_id !== actor.id) return c.json({ error: 'Forbidden' }, 403);
  if (!upload) return c.json({ error: 'Upload not initiated' }, 404);
  if (upload.completed_at) return c.json({ error: 'Upload already completed' }, 409);

  const { results: parts } = await c.env.DB
    .prepare('SELECT part_number, etag FROM upload_parts WHERE submission_id = ? ORDER BY part_number ASC')
    .bind(submissionId)
    .all<Pick<UploadPart, 'part_number' | 'etag'>>();

  if (parts.length === 0) return c.json({ error: 'No parts uploaded' }, 400);

  const multipart = c.env.RAW_BUCKET.resumeMultipartUpload(upload.r2_key, upload.r2_upload_id);
  await multipart.complete(parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })));

  const now = Date.now();
  await c.env.DB
    .prepare('UPDATE uploads SET completed_at = ? WHERE submission_id = ?')
    .bind(now, submissionId)
    .run();

  await enqueueProcessing(c.env, submissionId, sub.resource_id, upload.r2_key);

  return c.json({ submission_id: submissionId, status: 'completed', completed_at: now });
});

// DELETE /uploads/:submission_id — abort and clean up; submitter or authority
uploadRoutes.delete('/:id', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const submissionId = c.req.param('id');

  const [sub, upload] = await Promise.all([
    c.env.DB.prepare('SELECT submitter_id FROM submissions WHERE id = ?').bind(submissionId).first<Pick<Submission, 'submitter_id'>>(),
    c.env.DB.prepare('SELECT * FROM uploads WHERE submission_id = ?').bind(submissionId).first<Upload>(),
  ]);

  if (!sub)    return c.json({ error: 'Not found' }, 404);
  if (actor.role !== 'authority' && sub.submitter_id !== actor.id) return c.json({ error: 'Forbidden' }, 403);
  if (!upload) return c.json({ error: 'Upload not initiated' }, 404);
  if (upload.completed_at) return c.json({ error: 'Cannot abort a completed upload' }, 409);

  const multipart = c.env.RAW_BUCKET.resumeMultipartUpload(upload.r2_key, upload.r2_upload_id);
  await multipart.abort();

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM upload_parts WHERE submission_id = ?').bind(submissionId),
    c.env.DB.prepare('DELETE FROM uploads WHERE submission_id = ?').bind(submissionId),
  ]);

  return c.json({ submission_id: submissionId, status: 'aborted' });
});
