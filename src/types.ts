export type SubmissionState =
  | 'pending'
  | 'ready'
  | 'revealed'
  | 'unrevealed'
  | 'rejected'
  | 'purged';

export type ActorRole = 'submitter' | 'authority' | 'system' | 'consumer';

export type Action =
  | 'submit'
  | 'advance'
  | 'reject'
  | 'reveal'
  | 'revoke'
  | 'purge'
  | 'configure_policy';

export interface Actor {
  id: string;
  role: ActorRole;
}

export interface Resource {
  id: string;
  created_at: number;
}

export interface Submission {
  id: string;
  resource_id: string;
  submitter_id: string;
  state: SubmissionState;
  created_at: number;
  updated_at: number;
}

export interface Policy {
  id: string;
  resource_id: string;
  config: string; // opaque JSON blob — SEAM:policy
  created_at: number;
  updated_at: number;
}

export interface AuditEntry {
  id: string;
  resource_id: string | null;
  submission_id: string | null;
  actor_id: string;
  actor_role: ActorRole;
  action: Action;
  from_state: SubmissionState | null;
  to_state: SubmissionState | null;
  created_at: number;
  metadata: string | null; // opaque JSON blob
}

export interface Upload {
  submission_id: string;
  r2_upload_id:  string;
  r2_key:        string;
  created_at:    number;
  completed_at:  number | null;
}

export interface UploadPart {
  submission_id: string;
  part_number:   number;
  etag:          string;
  size:          number;
  uploaded_at:   number;
}

export interface ProcessingJob {
  submission_id: string;
  resource_id:   string;
  r2_key:        string;
  submitted_at:  number;
}

export interface Env {
  DB:             D1Database;
  RAW_BUCKET:     R2Bucket;
  RESOURCE_DO:    DurableObjectNamespace;
  ACCESS_KV:      KVNamespace;
  ACCESS_SECRET:  string;
  ANTHROPIC_API_KEY: string; // secret — backs the Pierre chat proxy (SEAM:processing)
  TURNSTILE_SECRET_KEY?: string; // secret — bot gate on the Pierre chat (optional until set)
  TMDB_API_KEY?: string; // secret — backs the TMDB movie search/detail proxy (optional until set)
  AIRTABLE_PAT?: string;       // secret — personal access token; enables the D1↔Airtable watch sync
  AIRTABLE_BASE_ID?: string;   // var — Airtable base id (appXXXXXXXXXXXXXX); enables the sync with the PAT
  SYNC_ADMIN_TOKEN?: string;   // secret — bearer token gating the manual /sync push-all & pull routes
  PROCESS_QUEUE:  Queue<ProcessingJob>;
  EVENTS_QUEUE:   Queue<unknown>;
}
