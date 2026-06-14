import { Hono } from 'hono';
import type { Env } from '../types';
import { resolveActor } from '../identity';

export const auditRoutes = new Hono<{ Bindings: Env }>();

// GET /audit — authority only; filter by resource_id or submission_id
auditRoutes.get('/', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  if (actor.role !== 'authority') return c.json({ error: 'Forbidden' }, 403);

  const resource_id   = c.req.query('resource_id');
  const submission_id = c.req.query('submission_id');

  const conditions: string[] = [];
  const params:     unknown[] = [];

  if (resource_id) {
    conditions.push('resource_id = ?');
    params.push(resource_id);
  }
  if (submission_id) {
    conditions.push('submission_id = ?');
    params.push(submission_id);
  }

  const where  = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM audit_entries ${where} ORDER BY created_at DESC LIMIT 200`)
    .bind(...params)
    .all();

  return c.json({ entries: results });
});
