import { Hono } from 'hono';
import type { Env, Submission } from '../types';
import { resolveActor } from '../identity';
import { writeAudit } from '../audit';
import { emitEvent } from '../events';

export const resourceRoutes = new Hono<{ Bindings: Env }>();

// POST /resources — authority creates a resource slot
resourceRoutes.post('/', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  if (actor.role !== 'authority') return c.json({ error: 'Forbidden' }, 403);

  const id  = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB
    .prepare('INSERT INTO resources (id, created_at) VALUES (?, ?)')
    .bind(id, now)
    .run();

  await writeAudit(c.env.DB, actor, 'configure_policy', { resource_id: id });

  return c.json({ id, created_at: now }, 201);
});

// GET /resources/:id — role-gated: authority/system see all submissions; submitter sees own; consumer sees revealed only
resourceRoutes.get('/:id', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const resource = await c.env.DB
    .prepare('SELECT * FROM resources WHERE id = ?')
    .bind(c.req.param('id'))
    .first();
  if (!resource) return c.json({ error: 'Not found' }, 404);

  let stmt: D1PreparedStatement;
  if (actor.role === 'authority' || actor.role === 'system') {
    stmt = c.env.DB
      .prepare('SELECT * FROM submissions WHERE resource_id = ? ORDER BY created_at ASC')
      .bind(resource.id);
  } else if (actor.role === 'submitter') {
    stmt = c.env.DB
      .prepare('SELECT * FROM submissions WHERE resource_id = ? AND submitter_id = ? ORDER BY created_at ASC')
      .bind(resource.id, actor.id);
  } else {
    stmt = c.env.DB
      .prepare("SELECT * FROM submissions WHERE resource_id = ? AND state = 'revealed' ORDER BY created_at ASC")
      .bind(resource.id);
  }

  const { results } = await stmt.all<Submission>();
  return c.json({ resource, submissions: results });
});

// POST /resources/:id/submissions — idempotent submit routed through the Resource DO.
// The DO serializes concurrent submitters and maintains the grouping cache.
resourceRoutes.post('/:id/submissions', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  if (actor.role !== 'submitter' && actor.role !== 'authority') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const resource = await c.env.DB
    .prepare('SELECT id FROM resources WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string }>();
  if (!resource) return c.json({ error: 'Resource not found' }, 404);

  const body = await c.req.json<{ submission_id?: string }>().catch((): { submission_id?: string } => ({}));

  const doStub = c.env.RESOURCE_DO.get(c.env.RESOURCE_DO.idFromName(resource.id));
  const doRes  = await doStub.fetch('https://do-internal/attach', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      resource_id:          resource.id,
      actor_id:             actor.id,
      actor_role:           actor.role,
      client_submission_id: body.submission_id,
    }),
  });

  if (!doRes.ok) {
    const err = await doRes.json<{ error: string }>();
    return c.json(err, doRes.status as never);
  }

  const isNew     = doRes.status === 201;
  const submission = await doRes.json<Submission>();

  if (isNew) {
    await emitEvent(c.env, {
      type:          'submission.pending',
      resource_id:   submission.resource_id,
      submission_id: submission.id,
      actor_id:      actor.id,
      actor_role:    actor.role,
      payload:       { to_state: 'pending' },
    });
  }

  return c.json(
    { ...submission, upload_targets: uploadTargets(submission.id) },
    doRes.status as never,
  );
});

// GET /resources/:id/do-status — authority: fast DO grouping view (no D1 scan)
resourceRoutes.get('/:id/do-status', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  if (actor.role !== 'authority') return c.json({ error: 'Forbidden' }, 403);

  const resource = await c.env.DB
    .prepare('SELECT id FROM resources WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string }>();
  if (!resource) return c.json({ error: 'Not found' }, 404);

  const doStub = c.env.RESOURCE_DO.get(c.env.RESOURCE_DO.idFromName(resource.id));
  const doRes  = await doStub.fetch('https://do-internal/status');
  return c.json(await doRes.json());
});

function uploadTargets(submissionId: string) {
  return {
    single_part: `PUT    /uploads/${submissionId}`,
    initiate:    `POST   /uploads/${submissionId}`,
    part:        `PUT    /uploads/${submissionId}/parts/:part_number`,
    complete:    `POST   /uploads/${submissionId}/complete`,
    abort:       `DELETE /uploads/${submissionId}`,
    status:      `GET    /uploads/${submissionId}`,
  };
}

// POST /resources/:id/policy — authority upserts policy config (SEAM:policy)
resourceRoutes.post('/:id/policy', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  if (actor.role !== 'authority') return c.json({ error: 'Forbidden' }, 403);

  const resource = await c.env.DB
    .prepare('SELECT id FROM resources WHERE id = ?')
    .bind(c.req.param('id'))
    .first();
  if (!resource) return c.json({ error: 'Resource not found' }, 404);

  const body   = await c.req.json<Record<string, unknown>>();
  const config = JSON.stringify(body);
  const now    = Date.now();

  await c.env.DB
    .prepare(
      `INSERT INTO policies (id, resource_id, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(resource_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`
    )
    .bind(crypto.randomUUID(), resource.id, config, now, now)
    .run();

  await writeAudit(c.env.DB, actor, 'configure_policy', {
    resource_id: resource.id as string,
    metadata:    { config: body },
  });

  return c.json({ resource_id: resource.id, config: body, updated_at: now });
});
