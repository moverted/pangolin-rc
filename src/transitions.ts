import type { Env, Submission, Action, ActorRole } from './types';
import { transition } from './state';
import { writeAudit } from './audit';
import { writeAccessRecord, revokeAccessRecord } from './kv';
import { emitEvent, STATE_TO_EVENT } from './events';

type SideEffect = (env: Env, sub: Submission) => Promise<void>;

// KV side effects that fire after a successful state transition
const sideEffects: Partial<Record<Action, SideEffect>> = {
  reveal: async (env, sub) => {
    await writeAccessRecord(env.ACCESS_KV, sub.id, crypto.randomUUID());
  },
  revoke: async (env, sub) => {
    await revokeAccessRecord(env.ACCESS_KV, sub.id);
  },
};

export async function applyTransition(
  env: Env,
  submissionId: string,
  action: string,
  actorId: string,
  actorRole: string,
): Promise<{ status: number; body: unknown }> {
  const sub = await env.DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(submissionId)
    .first<Submission>();
  if (!sub) return { status: 404, body: { error: 'Not found' } };

  const result = transition(action, sub.state, actorRole as never);
  if (!result.ok) return { status: result.status, body: { error: result.error } };

  const now = Date.now();
  await env.DB
    .prepare('UPDATE submissions SET state = ?, updated_at = ? WHERE id = ?')
    .bind(result.next, now, sub.id)
    .run();

  await writeAudit(env.DB, { id: actorId, role: actorRole as never }, action as Action, {
    resource_id:   sub.resource_id,
    submission_id: sub.id,
    from_state:    sub.state,
    to_state:      result.next,
  });

  const effect = sideEffects[action as Action];
  if (effect) await effect(env, sub);

  const eventType = STATE_TO_EVENT[result.next];
  if (eventType) {
    await emitEvent(env, {
      type:          eventType,
      resource_id:   sub.resource_id,
      submission_id: sub.id,
      actor_id:      actorId,
      actor_role:    actorRole as ActorRole,
      payload:       { from_state: sub.state, to_state: result.next },
    });
  }

  return { status: 200, body: { ...sub, state: result.next, updated_at: now } };
}
