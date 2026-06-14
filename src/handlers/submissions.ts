import { Hono } from 'hono';
import type { Env, Submission, Action } from '../types';
import { resolveActor } from '../identity';
import { applyTransition } from '../transitions';

export const submissionRoutes = new Hono<{ Bindings: Env }>();

// GET /submissions/:id — visibility is a pure function of state + actor role (access matrix §6)
submissionRoutes.get('/:id', async (c) => {
  const actor = resolveActor(c.req.raw);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const sub = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Submission>();
  if (!sub) return c.json({ error: 'Not found' }, 404);

  if (actor.role === 'authority' || actor.role === 'system') {
    return c.json(sub);
  }
  if (actor.role === 'submitter') {
    if (sub.submitter_id !== actor.id) return c.json({ error: 'Forbidden' }, 403);
    if (sub.state === 'purged')        return c.json({ error: 'Not found' }, 404);
    return c.json(sub);
  }
  // consumer: only revealed state is visible
  if (sub.state !== 'revealed') return c.json({ error: 'Not found' }, 404);
  return c.json(sub);
});

// State-transition command routes — each maps to one edge in the state machine
const commands: Array<[string, Action]> = [
  ['advance', 'advance'],
  ['reject',  'reject'],
  ['reveal',  'reveal'],
  ['revoke',  'revoke'],
  ['purge',   'purge'],
];

for (const [cmd] of commands) {
  submissionRoutes.post(`/:id/${cmd}`, async (c) => {
    const actor = resolveActor(c.req.raw);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const { status, body } = await applyTransition(
      c.env,
      c.req.param('id'),
      cmd,
      actor.id,
      actor.role,
    );
    return c.json(body, status as never);
  });
}
