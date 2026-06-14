import type { Actor, Action, SubmissionState } from './types';

interface AuditOpts {
  resource_id?:   string;
  submission_id?: string;
  from_state?:    SubmissionState;
  to_state?:      SubmissionState;
  metadata?:      Record<string, unknown>;
}

export async function writeAudit(
  db: D1Database,
  actor: Actor,
  action: Action,
  opts: AuditOpts = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_entries
         (id, resource_id, submission_id, actor_id, actor_role, action, from_state, to_state, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      opts.resource_id   ?? null,
      opts.submission_id ?? null,
      actor.id,
      actor.role,
      action,
      opts.from_state ?? null,
      opts.to_state   ?? null,
      Date.now(),
      opts.metadata ? JSON.stringify(opts.metadata) : null,
    )
    .run();
}
