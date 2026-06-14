import type { Env, Submission } from '../types';

interface AttachRequest {
  resource_id:           string;
  actor_id:              string;
  actor_role:            string;
  client_submission_id?: string;
}

// One DO instance per Resource, keyed by resource_id.
//
// Responsibilities:
//   1. Single-writer serialization — the DO's JS event loop processes one
//      fetch() at a time; INSERT OR IGNORE catches the rare concurrent-retry
//      race at the D1 level as an additional safety net.
//   2. Grouping cache — DO storage tracks submission_ids so the authority
//      can query which submissions belong to a resource without a D1 scan.
//   3. Future policy gate — SEAM:policy enforcement (caps, affiliation checks)
//      slots in here before the INSERT.
export class ResourceCoordinator implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (`${request.method} ${url.pathname}`) {
      case 'POST /attach': return this.attach(request);
      case 'GET /status':  return this.status();
      default:             return Response.json({ error: 'Not found' }, { status: 404 });
    }
  }

  // Attach a submission to this resource.  All writes for this resource flow
  // through here, serialized by the DO runtime.
  private async attach(request: Request): Promise<Response> {
    const { resource_id, actor_id, actor_role, client_submission_id } =
      await request.json<AttachRequest>();

    const id  = client_submission_id ?? crypto.randomUUID();
    const now = Date.now();

    // Fast idempotency check: DO cache hit avoids a D1 round-trip
    const cached = await this.state.storage.get<boolean>(`sub:${id}`);
    if (cached) {
      const existing = await this.env.DB
        .prepare('SELECT * FROM submissions WHERE id = ?')
        .bind(id)
        .first<Submission>();
      if (existing) return Response.json(existing);
      // Cache stale — fall through to insert
    }

    // INSERT OR IGNORE is the safety net for the narrow concurrent-retry
    // window between await points in the DO's event loop.
    const { meta } = await this.env.DB
      .prepare(
        `INSERT OR IGNORE INTO submissions
           (id, resource_id, submitter_id, state, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      )
      .bind(id, resource_id, actor_id, now, now)
      .run();

    if (meta.changes === 0) {
      // A concurrent request created this submission — return the existing row
      await this.state.storage.put(`sub:${id}`, true);
      const existing = await this.env.DB
        .prepare('SELECT * FROM submissions WHERE id = ?')
        .bind(id)
        .first<Submission>();
      return Response.json(existing);
    }

    // New submission — write audit entry and prime the DO cache
    await this.env.DB
      .prepare(
        `INSERT INTO audit_entries
           (id, resource_id, submission_id, actor_id, actor_role, action,
            from_state, to_state, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, 'submit', null, 'pending', ?, null)`
      )
      .bind(crypto.randomUUID(), resource_id, id, actor_id, actor_role, now)
      .run();

    await this.state.storage.put(`sub:${id}`, true);

    return Response.json(
      { id, resource_id, submitter_id: actor_id, state: 'pending', created_at: now, updated_at: now },
      { status: 201 },
    );
  }

  // Return all submission IDs known to this DO — fast, no D1 needed.
  // Useful for the authority to see the grouped slot without a full D1 scan.
  private async status(): Promise<Response> {
    const entries = await this.state.storage.list<boolean>({ prefix: 'sub:' });
    const ids     = [...entries.keys()].map((k) => k.slice(4)); // strip 'sub:' prefix
    return Response.json({ submission_count: ids.length, submission_ids: ids });
  }
}
