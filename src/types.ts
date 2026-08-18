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
  SCHED_DB:       D1Database; // WoW in-season scheduler state (separate DB; additive, never touches legacy pangolin-rc)
  RAW_BUCKET:     R2Bucket;
  RESOURCE_DO:    DurableObjectNamespace;
  ACCESS_KV:      KVNamespace;
  AI:             any; // Workers AI for Whisper transcription
  ACCESS_SECRET:  string;
  ANTHROPIC_API_KEY: string; // secret — backs the Pierre chat proxy (SEAM:processing)
  TURNSTILE_SECRET_KEY?: string; // secret — bot gate on the Pierre chat (optional until set)
  APP_NATIVE_SECRET?: string;    // secret — shared token the native iOS app sends instead of a Turnstile token (Turnstile can't run in the WKWebview); matched by /pierre/chat
  TMDB_API_KEY?: string; // secret — backs the TMDB movie search/detail proxy (optional until set)
  PROCESS_QUEUE:  Queue<ProcessingJob>;
  EVENTS_QUEUE:   Queue<unknown>;
  BUG_EMAIL?:     SendEmail;  // Email Routing send binding — bug-report notifications (best-effort)
  BUG_NOTIFY_TO?: string;     // var — recipient for bug emails (default edward.m.willett@gmail.com)
  BUG_FROM?:      string;     // var — from address on pangolinrc.com (default bugs@pangolinrc.com)
  SENDGRID_API_KEY?: string;  // secret — enables the waitlist-signup notification email (optional until set)
  WAITLIST_NOTIFY_TO?: string;   // var — recipient for signup notifications (default waitlist@pangolinrc.com)
  WAITLIST_NOTIFY_FROM?: string; // var — from address, must be on the SendGrid-authenticated pangolinrc.com domain (default waitlist@pangolinrc.com)
  USERS_ADMIN_PASSWORD?: string;  // secret — gates the users.pangolinrc.com admin page (list + status update). Fail-closed: admin routes 503 until set.
}
