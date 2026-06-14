import { Hono } from 'hono';
import type { Env } from '../types';
import { resolveActor } from '../identity';
import { CONSUMER_VISIBLE_TYPES, type EventType } from '../events';

export const eventRoutes = new Hono<{ Bindings: Env }>();

// GET /events — read-only integration surface for the emitted event log.
// Consumers (integration) receive only revealed/unrevealed events (no raw payload access).
// Authority and system receive all events.
eventRoutes.get('/', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const resourceId   = c.req.query('resource_id');
  const submissionId = c.req.query('submission_id');
  const typeParam    = c.req.query('type') as EventType | undefined;
  const since        = parseInt(c.req.query('since') ?? '0', 10) || 0;
  const limit        = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);

  // Integration/consumer role: restrict to publicly visible event types only
  const isRestricted = actor.role === 'consumer' || actor.role === 'submitter';
  if (isRestricted && typeParam && !CONSUMER_VISIBLE_TYPES.includes(typeParam)) {
    return c.json({ events: [] });
  }

  // Build a parameterised query — all user input goes through bind() placeholders
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (resourceId)   { conditions.push('resource_id = ?');   params.push(resourceId); }
  if (submissionId) { conditions.push('submission_id = ?'); params.push(submissionId); }
  if (since)        { conditions.push('created_at > ?');    params.push(since); }

  if (isRestricted) {
    // Inline the allowed types — these are string literals, not user input
    const placeholders = CONSUMER_VISIBLE_TYPES.map(() => '?').join(', ');
    conditions.push(`type IN (${placeholders})`);
    params.push(...CONSUMER_VISIBLE_TYPES);
  } else if (typeParam) {
    conditions.push('type = ?');
    params.push(typeParam);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql   = `SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ events: results });
});
