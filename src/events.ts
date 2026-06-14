import type { Env, ActorRole, SubmissionState } from './types';

export type EventType =
  | 'submission.pending'
  | 'submission.ready'
  | 'submission.revealed'
  | 'submission.unrevealed'
  | 'submission.rejected'
  | 'submission.purged';

export interface EventMessage {
  id:            string;
  type:          EventType;
  resource_id:   string;
  submission_id: string;
  actor_id:      string;
  actor_role:    ActorRole;
  payload:       Record<string, unknown>;
  created_at:    number;
}

// Maps each terminal state to its event type
export const STATE_TO_EVENT: Partial<Record<SubmissionState, EventType>> = {
  pending:    'submission.pending',
  ready:      'submission.ready',
  revealed:   'submission.revealed',
  unrevealed: 'submission.unrevealed',
  rejected:   'submission.rejected',
  purged:     'submission.purged',
};

// Event types visible to integration consumers per the access matrix (§6)
export const CONSUMER_VISIBLE_TYPES: EventType[] = [
  'submission.revealed',
  'submission.unrevealed',
];

interface EmitOpts {
  type:          EventType;
  resource_id:   string;
  submission_id: string;
  actor_id:      string;
  actor_role:    ActorRole;
  payload?:      Record<string, unknown>;
}

export async function emitEvent(env: Env, opts: EmitOpts): Promise<void> {
  const id      = crypto.randomUUID();
  const now     = Date.now();
  const payload = opts.payload ?? {};

  const message: EventMessage = {
    id,
    type:          opts.type,
    resource_id:   opts.resource_id,
    submission_id: opts.submission_id,
    actor_id:      opts.actor_id,
    actor_role:    opts.actor_role,
    payload,
    created_at:    now,
  };

  // Write to D1 for the integration read endpoint, then forward to the outbound queue.
  // SEAM:events — instances plug their delivery handler into EVENTS_QUEUE as a consumer.
  await Promise.all([
    env.DB
      .prepare(
        `INSERT INTO events (id, type, resource_id, submission_id, actor_id, actor_role, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, opts.type, opts.resource_id, opts.submission_id, opts.actor_id, opts.actor_role,
            JSON.stringify(payload), now)
      .run(),
    env.EVENTS_QUEUE.send(message),
  ]);
}
