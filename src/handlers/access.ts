import { Hono } from 'hono';
import type { Env, Submission, Upload } from '../types';
import { resolveActor } from '../identity';
import { getAccessRecord, isRevoked, TOKEN_TTL_MS } from '../kv';
import { hmacSign, hmacVerify } from '../crypto';

export const accessRoutes = new Hono<{ Bindings: Env }>();

// Token payload: "{submission_id}:{key_version}:{expires_at}"
function tokenMessage(submissionId: string, keyVersion: string, expiresAt: number): string {
  return `${submissionId}:${keyVersion}:${expiresAt}`;
}

// GET /submissions/:id/access — consumer (or authority) mints a short-lived signed token
accessRoutes.get('/:id/access', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const submissionId = c.req.param('id');

  const sub = await c.env.DB
    .prepare('SELECT state FROM submissions WHERE id = ?')
    .bind(submissionId)
    .first<Pick<Submission, 'state'>>();
  if (!sub) return c.json({ error: 'Not found' }, 404);
  if (sub.state !== 'revealed') return c.json({ error: 'Submission is not revealed' }, 403);

  const record = await getAccessRecord(c.env.ACCESS_KV, submissionId);
  if (!record) return c.json({ error: 'Access record missing — submission may have been revoked' }, 403);

  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const token = await hmacSign(
    c.env.ACCESS_SECRET,
    tokenMessage(submissionId, record.key_version, expiresAt),
  );

  return c.json({
    submission_id: submissionId,
    key_version:   record.key_version,
    expires_at:    expiresAt,
    token,
    payload_url:   `/submissions/${submissionId}/payload?kv=${record.key_version}&exp=${expiresAt}&token=${token}`,
  });
});

// GET /submissions/:id/payload — redeem a signed token; streams the R2 object
accessRoutes.get('/:id/payload', async (c) => {
  const submissionId = c.req.param('id');
  const keyVersion   = c.req.query('kv')    ?? '';
  const expiresParam = c.req.query('exp')   ?? '';
  const token        = c.req.query('token') ?? '';

  if (!keyVersion || !expiresParam || !token) {
    return c.json({ error: 'Missing token parameters' }, 400);
  }

  const expiresAt = parseInt(expiresParam, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return c.json({ error: 'Token expired' }, 403);
  }

  const valid = await hmacVerify(
    c.env.ACCESS_SECRET,
    tokenMessage(submissionId, keyVersion, expiresAt),
    token,
  );
  if (!valid) return c.json({ error: 'Invalid token' }, 403);

  // Revocation checks — order matters: tombstone first (belt), then access record (suspenders)
  if (await isRevoked(c.env.ACCESS_KV, submissionId)) {
    return c.json({ error: 'Access revoked' }, 403);
  }

  const record = await getAccessRecord(c.env.ACCESS_KV, submissionId);
  if (!record || record.key_version !== keyVersion) {
    return c.json({ error: 'Access revoked or key rotated' }, 403);
  }

  const upload = await c.env.DB
    .prepare('SELECT r2_key, completed_at FROM uploads WHERE submission_id = ?')
    .bind(submissionId)
    .first<Pick<Upload, 'r2_key' | 'completed_at'>>();

  if (!upload?.completed_at) return c.json({ error: 'Payload not available' }, 404);

  const object = await c.env.RAW_BUCKET.get(upload.r2_key);
  if (!object) return c.json({ error: 'Payload not found in storage' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, no-store');

  return new Response(object.body, { headers });
});
