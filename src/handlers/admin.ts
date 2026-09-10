import { Hono } from 'hono';
import type { Env } from '../types';

// ─── admin.pangolinrc.com API ────────────────────────────────────────────────
// Read-only operational admin surface over the production D1 (`DB`). This is THE
// human window onto app data (Airtable mirroring was deprecated 2026-08-18). Purely read/filter/pivot
// at launch (see admin-portal-build-brief.md non-goals) — the only mutating admin
// route in the Worker is still POST /waitlist/admin/status.
//
// Gated by the SAME shared password as users.pangolinrc.com — secret
// USERS_ADMIN_PASSWORD, sent as `Authorization: Bearer <password>`. Fail-CLOSED:
// every route 503s until the secret is set, 401s on a wrong/absent password.
// (No new secret to provision — the users-admin password is reused verbatim.)

export const adminRoutes = new Hono<{ Bindings: Env }>();

// Length-independent constant-time-ish compare (same as waitlist.ts) so we don't
// leak the password length/prefix via timing.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a), bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}

// Returns null when authorized, or a Response to short-circuit with.
function adminGate(c: any): Response | null {
  const secret = c.env.USERS_ADMIN_PASSWORD;
  if (!secret) return c.json({ error: 'admin not configured' }, 503);
  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !safeEqual(token, secret)) return c.json({ error: 'unauthorized' }, 401);
  return null;
}

// ─── Resource registry ───────────────────────────────────────────────────────
// Every SQL fragment below is author-controlled (column exprs, FROM/JOINs, pivot
// SQL). Only `q`, filter values, sort direction, and pagination come from the
// request, and those are either bound params or validated against this registry —
// nothing user-supplied is ever concatenated into SQL.

type Col = { key: string; label: string; expr: string };
type Filter = { key: string; label: string; expr: string; options?: string[]; multi?: boolean };
type Pivot = { label: string; columns: { key: string; label: string }[]; sql: (from: string, where: string) => string };
// An inline-editable column: the frontend renders a <select> of `options`, and
// POST /admin/write/:resource runs `UPDATE table SET column = ? WHERE idColumn = ?`.
// table/column/idColumn are author-controlled literals (never request input); only
// the bound id + value come from the request, and value is validated against options.
// `enum` writes (default) validate value ∈ options → a dropdown. `int` writes take a
// free whole number (e.g. episode runtime) → a number input, no options.
type Write = { table: string; column: string; idColumn: string; kind?: 'enum' | 'int' | 'text' | 'bool'; options?: readonly string[] };
// A row-level delete. `table`/`idColumn` are author-controlled literals; only the bound id
// comes from the request. `cascadeDelete` removes dependent rows first (e.g. a marathon's
// steps); `cascadeNull` clears foreign references instead of deleting them (e.g. a watcher's
// active_map_id) so pointing rows aren't stranded but also aren't destroyed. Runs as one batch.
type Delete = {
  table: string; idColumn: string;
  cascadeDelete?: { table: string; column: string }[];
  cascadeNull?: { table: string; column: string }[];
};

interface Resource {
  label: string;
  group: 'core' | 'secondary';
  from: string;               // FROM + JOINs, no SELECT/WHERE
  idExpr?: string;            // stable row id (selected as _id) for row-level write actions
  cols: Col[];                // SELECT list + column metadata for the frontend
  searchExprs: string[];      // OR-LIKE'd against `q`
  filters?: Filter[];         // exact-match dropdown filters
  defaultFilters?: Record<string, string>; // filter key → value applied on open (e.g. hide Cut rows)
  sortDefault: string;        // a col key
  defaultOrder?: string;      // author-controlled ORDER BY expr used when the default sort is active
                              // (e.g. group rows by conversation, then turn order). Overrides sortDefault's single-col sort.
  groupBy?: string;           // col key the frontend visually groups on (divider when the value changes)
  groupHeaderCols?: string[]; // col keys shown once in a group-header row (and dropped from the per-row columns)
  pivots?: Record<string, Pivot>;
  writes?: Record<string, Write>; // col key → inline-edit spec
  del?: Delete;                   // row-level delete spec (renders a Delete action per row)
  reorder?: string;           // col key whose value is a 1..N rank the frontend can drag-reorder (renumbers + saves)
  reorderScope?: string;      // optional col key that sub-scopes the reorder (ranks are per this value, e.g. per kind)
  reorderCutCol?: string;     // optional bool col whose truthiness removes a row from ranking; toggling it compacts the scope
  note?: string;              // shown in the UI (caveats, read-only, etc.)
}

// Hand-managed waitlist vocab, shared by the columns, filters, and write validation
// so they can never drift. Empty test_group renders as 'Unassigned' (which is also a
// selectable value that stores the literal string).
const WAITLIST_STATUSES = ['new', 'invited', 'active', 'declined'] as const;
// Admin-managed account status (users table). Editable inline. When users.status is unset, the
// list derives a default: seed/demo/test accounts (the @pangolinrc.app testers + demo@/reviewer@)
// read as 'dummy', everyone else 'active' — so the column is meaningful before anyone touches it.
const USER_STATUSES = ['active', 'prospect', 'dummy', 'waitlist', 'inactive'] as const;
const USER_STATUS_EXPR = `COALESCE(NULLIF(users.status,''), CASE
  WHEN users.email LIKE '%@pangolinrc.app'
    OR users.email LIKE 'demo@%'
    OR users.email LIKE 'reviewer@%' THEN 'dummy'
  ELSE 'active' END)`;
const WAITLIST_GROUPS = ['Unassigned', 'Friends & Family Cohort 1', 'Internal', 'SNW Cohort', "Founder's Circle"] as const;
const GROUP_EXPR = "COALESCE(NULLIF(waitlist.test_group,''),'Unassigned')";
const LIST_TYPE_EXPR = "COALESCE(NULLIF(waitlist.list_type,''),'waitlist')";

// Outreach (creators/influencers we contact). Status/Channel are the inline-edit
// dropdowns; enums are shared across cols/filters/writes so they can't drift.
const OUTREACH_STATUSES = ['Drafted', 'Sent', 'Replied', 'Converted', 'Declined', 'Soft Decline', 'No Response'] as const;
const OUTREACH_CHANNELS = ['DM', 'Email'] as const;
const OUTREACH_PLATFORMS = ['Instagram', 'Twitter', 'TikTok', 'YouTube', 'Email', 'Other'] as const;

// Follow-up cadence timing. Each next_due_at is RE-ANCHORED on the ACTUAL send date of the
// prior step (see migration 0060), so a slow send just slides the whole schedule.
const WK1_MS = 7 * 24 * 60 * 60 * 1000;    // initial → 1-week follow-up
const MO1_MS = 30 * 24 * 60 * 60 * 1000;   // 1-week send → 1-month follow-up
const FINAL_MS = 7 * 24 * 60 * 60 * 1000;  // 1-month send → soft-decline window
// Statuses that keep the cadence live; any other status halts it.
const CADENCE_ACTIVE = ['Sent', 'No Response'];
// Statuses that terminate the cadence when set (clear next_due_at).
const CADENCE_HALT = ['Replied', 'Converted', 'Declined', 'Soft Decline'];

// A follow-up was just sent for `id`: stamp the real send time, bump the stage, and
// re-anchor next_due_at off NOW. stage 0→1 (wk1 sent) schedules the 1-month; 1→2 (mo1
// sent) schedules the final window; 2→3 closes. No-op past stage 2.
async function advanceOutreachStage(env: Env, id: string, now: number): Promise<void> {
  const row = await env.DB.prepare('SELECT follow_up_stage FROM outreach WHERE id = ?')
    .bind(id)
    .first<{ follow_up_stage: number }>();
  if (!row) return;
  const stage = row.follow_up_stage | 0;
  if (stage === 0) {
    await env.DB.prepare('UPDATE outreach SET follow_up_stage = 1, wk1_sent_at = ?, next_due_at = ? WHERE id = ?')
      .bind(now, now + MO1_MS, id).run();
  } else if (stage === 1) {
    await env.DB.prepare('UPDATE outreach SET follow_up_stage = 2, mo1_sent_at = ?, next_due_at = ? WHERE id = ?')
      .bind(now, now + FINAL_MS, id).run();
  } else {
    await env.DB.prepare('UPDATE outreach SET follow_up_stage = 3, next_due_at = NULL WHERE id = ?')
      .bind(id).run();
  }
}

// Unattended transition: any row whose final (post-1-month) window has lapsed with no reply
// becomes 'Soft Decline'. Run lazily at the top of the follow-up/app-status reads (fires
// whenever an admin foregrounds the app) — cheaper than a cron and only matters when surfaced.
async function sweepOutreachSoftDecline(env: Env, now: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE outreach SET status = 'Soft Decline', follow_up_stage = 3, next_due_at = NULL
       WHERE follow_up_stage = 2 AND next_due_at IS NOT NULL AND next_due_at <= ?
         AND status IN ('Sent', 'No Response')`,
  ).bind(now).run();
}
// Funnel fold: match outreach.contact_email against the inbound tables so the view
// shows live funnel state (member / waitlist status) instead of a hand-kept guess.
// `o`/`ow`/`ou` are the aliases used in the outreach resource's FROM.
const OUTREACH_FUNNEL_EXPR = `CASE
  WHEN COALESCE(o.contact_email,'') = '' THEN '—'
  WHEN ou.email IS NOT NULL THEN 'Member'
  WHEN ow.email IS NOT NULL THEN 'Waitlist: ' || COALESCE(NULLIF(ow.status,''),'new')
  ELSE 'not in funnel' END`;

// Follow-up cadence, human-readable: which stage is next and how close it is (or "DUE").
// stage 0→wk1, 1→mo1, 2→final(soft-decline) window, 3/closed → em dash.
const OUTREACH_CADENCE_EXPR = `CASE
  WHEN o.follow_up_stage >= 3 OR o.next_due_at IS NULL THEN '—'
  WHEN o.next_due_at <= strftime('%s','now')*1000 THEN
    (CASE o.follow_up_stage WHEN 0 THEN 'wk1 DUE' WHEN 1 THEN 'mo1 DUE' ELSE 'final DUE' END)
  ELSE (CASE o.follow_up_stage WHEN 0 THEN 'wk1' WHEN 1 THEN 'mo1' ELSE 'final' END)
       || ' in ' || CAST((o.next_due_at - strftime('%s','now')*1000)/86400000 AS INT) || 'd' END`;

// Millisecond epoch → local-ish date bucket. All created_at/updated_at are ms.
const monthOf = (col: string) => `strftime('%Y-%m', ${col}/1000, 'unixepoch')`;
const weekOf  = (col: string) => `strftime('%Y-W%W', ${col}/1000, 'unixepoch')`;

// Streaming-shadow tier is now a STORED subjective bucket (Top 10/25/50), not a rank band.
// Display/filter fall back to '—' when unset; TIER_ORDER sorts Top 10 first, unset last.
const SHADOW_TIER_DISP = "COALESCE(NULLIF(ss.tier,''),'—')";
const SHADOW_TIER_ORDER = "CASE ss.tier WHEN 'Top 10' THEN 0 WHEN 'Top 25' THEN 1 WHEN 'Top 50' THEN 2 ELSE 3 END";

// watch_comment derived dimensions (shared between the list columns, filters, and
// pivots so they always agree).
const KIND_EXPR = `CASE
  WHEN watch_comment.reply_to IS NOT NULL AND watch_comment.reply_to <> '' THEN 'reply'
  WHEN watch_comment.is_endnote = 1 THEN 'endnote'
  WHEN watch_comment.is_reflection = 1 THEN 'reflection'
  ELSE 'episode' END`;
// SPLR/NOSP only carries meaning for reflections/endnotes (episode comments never
// set it); show '—' elsewhere so the column isn't misleading.
const SPOILER_EXPR = `CASE
  WHEN watch_comment.is_reflection = 1 OR watch_comment.is_endnote = 1
    THEN CASE WHEN watch_comment.spoiler = 1 THEN 'SPLR' ELSE 'NOSP' END
  ELSE '—' END`;
// For a reflection, private=0 means it was published to the co-view feed (shared);
// private=1 means journaled (kept out of the feed). Not applicable to plain comments.
const SHARED_EXPR = `CASE
  WHEN watch_comment.is_reflection = 1 OR watch_comment.is_endnote = 1
    THEN CASE WHEN watch_comment.private = 1 THEN 'journaled' ELSE 'shared' END
  ELSE '—' END`;

// Episode Feed: ONE ROW PER COMMENTER PER EPISODE — each user gets their own record. The
// grouping key is (show, episode, author); a record covers one person's ORIGINAL comments
// (reply_to IS NULL) on that episode. Replies aren't their own record — they thread under
// the comment they answer, inside the parent author's record (built in TS below). The
// serialized transcript text is filled by the list handler's post-process, not here.
const EPISODE_COMMENTS_FROM = `(
  SELECT wc.show_id AS show_id, wc.episode_id AS episode_id, wc.user_email AS user_email,
         COUNT(*) AS comments, MAX(wc.created_at) AS last_at
    FROM watch_comment wc
   WHERE COALESCE(wc.hidden, 0) = 0 AND COALESCE(wc.transcription, '') <> '' AND wc.reply_to IS NULL
   GROUP BY wc.show_id, wc.episode_id, wc.user_email
) AS ec
  LEFT JOIN titles ON titles.title_id = ec.show_id
  LEFT JOIN users cu ON cu.email = ec.user_email`;

// ── Per-commenter transcript helpers (episode_comments) ──────────────────────
const _TXT_HEAD = 'To listen along join.pangolinrc.com';
function _cmMark(r: any): string {
  if (r.is_reflection || r.is_endnote) return r.spoiler ? 'SPLR' : 'NOSP';
  const s = Math.max(0, Math.floor((r.timestamp_ms || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function _cmName(r: any): string {
  return (r.username && String(r.username).trim()) || String(r.user_email || '').split('@')[0] || 'friend';
}

// Simple GROUP BY bucket → count pivot.
function countPivot(label: string, groupExpr: string, bucketLabel = 'Value'): Pivot {
  return {
    label,
    columns: [{ key: 'bucket', label: bucketLabel }, { key: 'n', label: 'Count' }],
    sql: (from, where) =>
      `SELECT ${groupExpr} AS bucket, COUNT(*) AS n FROM ${from} ${where}
       GROUP BY bucket ORDER BY n DESC, bucket ASC LIMIT 200`,
  };
}

const RESOURCES: Record<string, Resource> = {
  users: {
    label: 'Users',
    group: 'core',
    from: 'users',
    idExpr: 'users.email',
    cols: [
      { key: 'email',      label: 'Email',    expr: 'users.email' },
      { key: 'username',   label: 'Username', expr: 'users.username' },
      { key: 'status',     label: 'Status',   expr: USER_STATUS_EXPR },
      { key: 'phone',      label: 'Phone',    expr: 'users.phone' },
      { key: 'timezone',   label: 'Timezone', expr: 'users.timezone' },
      { key: 'devices',    label: 'Devices',  expr: '(SELECT COUNT(*) FROM devices d WHERE d.user_email = users.email)' },
      { key: 'follows',    label: 'Connections', expr: '(SELECT COUNT(*) FROM follows f WHERE f.follower_email = users.email OR f.followee_email = users.email)' },
      { key: 'created_at', label: 'Joined',   expr: 'users.created_at' },
    ],
    searchExprs: ['users.email', 'users.username'],
    filters: [{ key: 'status', label: 'Status', expr: USER_STATUS_EXPR, options: [...USER_STATUSES], multi: true }],
    // Open on the "real people" slice: everything except dummy (seed/test) and inactive.
    // Uncheck/recheck any status in the Status dropdown to change it.
    defaultFilters: { status: 'active,prospect,waitlist' },
    sortDefault: 'created_at',
    writes: {
      status: { table: 'users', column: 'status', idColumn: 'email', options: USER_STATUSES },
    },
    pivots: {
      status:       countPivot('By status', USER_STATUS_EXPR, 'Status'),
      signup_month: countPivot('Signups by month', monthOf('users.created_at'), 'Month'),
      signup_week:  countPivot('Signups by week',  weekOf('users.created_at'),  'Week'),
      timezone:     countPivot('By timezone', "COALESCE(NULLIF(users.timezone,''),'—')", 'Timezone'),
      has_devices:  countPivot('Has devices?', "CASE WHEN (SELECT COUNT(*) FROM devices d WHERE d.user_email=users.email)>0 THEN 'has ≥1 device' ELSE 'no devices' END", 'Bucket'),
      has_connections: countPivot('Has connections?', "CASE WHEN (SELECT COUNT(*) FROM follows f WHERE f.follower_email=users.email OR f.followee_email=users.email)>0 THEN 'connected' ELSE 'none' END", 'Bucket'),
    },
    note: 'Status is editable inline — active (real member), prospect (pre-provisioned, not yet claimed), dummy (seed/demo/test account), waitlist, or inactive. Unset rows default to dummy for seed accounts (@pangolinrc.app, demo@, reviewer@) and active for everyone else until you override. The Status filter is multi-select and opens hiding dummy + inactive — check them to see those rows. (inactive is never set automatically — only by a manual edit here.)',
  },

  devices: {
    label: 'Devices',
    group: 'core',
    from: 'devices',
    cols: [
      { key: 'id',         label: 'Device ID',  expr: 'devices.id' },
      { key: 'user_email', label: 'User',       expr: 'devices.user_email' },
      { key: 'type',       label: 'Type',       expr: 'devices.type' },
      { key: 'location',   label: 'Location',   expr: 'devices.location' },
      { key: 'created_at', label: 'Created',    expr: 'devices.created_at' },
    ],
    searchExprs: ['devices.user_email', 'devices.id'],
    filters: [{ key: 'type', label: 'Type', expr: 'devices.type' }],
    sortDefault: 'created_at',
    note: 'No IP/geo is stored, so there is no country/region pivot; `location` is the free-text value captured at pairing.',
    pivots: {
      type:     countPivot('By device type', "COALESCE(NULLIF(devices.type,''),'—')", 'Type'),
      location: countPivot('By location', "COALESCE(NULLIF(devices.location,''),'—')", 'Location'),
      cohort:   countPivot('Created by month', monthOf('devices.created_at'), 'Month'),
    },
  },

  coviewer: {
    label: 'Coviewers',
    group: 'core',
    from: 'coviewer',
    cols: [
      { key: 'owner_email',  label: 'Owner',        expr: 'coviewer.owner_email' },
      { key: 'display_name', label: 'Name',         expr: 'coviewer.display_name' },
      { key: 'relationship', label: 'Relationship', expr: "COALESCE(NULLIF(coviewer.relationship,''),'—')" },
      { key: 'linked',       label: 'Account',      expr: "CASE WHEN coviewer.linked_email IS NOT NULL AND coviewer.linked_email <> '' THEN 'linked' ELSE 'name-only' END" },
      { key: 'is_default',   label: 'Default',      expr: "CASE WHEN coviewer.is_default = 1 THEN 'default' ELSE '—' END" },
      { key: 'created_at',   label: 'Added',        expr: 'coviewer.created_at' },
    ],
    searchExprs: ['coviewer.owner_email', 'coviewer.display_name', 'coviewer.linked_email'],
    filters: [
      { key: 'relationship', label: 'Relationship', expr: "COALESCE(NULLIF(coviewer.relationship,''),'—')" },
      { key: 'linked',       label: 'Account',      expr: "CASE WHEN coviewer.linked_email IS NOT NULL AND coviewer.linked_email <> '' THEN 'linked' ELSE 'name-only' END", options: ['linked', 'name-only'] },
    ],
    sortDefault: 'created_at',
    note: "Who each user watches TV with. name-only coviewers have no pangolinRC account (promotable later via linked_email). `default` rows are that user's default coviewing matrix — what Pierre assumes when the room isn't named.",
    pivots: {
      relationship: countPivot('By relationship', "COALESCE(NULLIF(coviewer.relationship,''),'—')", 'Relationship'),
      linked:       countPivot('Linked vs name-only', "CASE WHEN coviewer.linked_email IS NOT NULL AND coviewer.linked_email <> '' THEN 'linked' ELSE 'name-only' END", 'Account'),
      top_owners:   countPivot('Roster size by user', 'coviewer.owner_email', 'Owner'),
    },
  },

  streaming_shadow: {
    label: 'Streaming shadows',
    group: 'secondary',
    from: 'streaming_shadow ss',
    idExpr: 'ss.id',
    cols: [
      { key: 'user_email',  label: 'User',        expr: 'ss.user_email' },
      { key: 'rank',        label: 'Rank',        expr: 'ss.rank' },                 // 1..N PER KIND; drag rows or type a number
      { key: 'hidden',      label: 'Cut',         expr: 'ss.hidden' },               // 2nd column: raw 0/1 for the checkbox editor
      { key: 'title_name',  label: 'Title',       expr: 'ss.title_name' },
      { key: 'kind',        label: 'Kind',        expr: 'ss.kind' },                 // editable enum (series/miniseries/anthology/film)
      { key: 'tier',        label: 'Tier',        expr: 'ss.tier' },                  // subjective bucket, editable enum
      { key: 'sentiment',   label: 'Sentiment',   expr: 'ss.sentiment' },            // raw so the editor reflects the true value ('' = unset)
      { key: 'feel',        label: 'Pierre Feel', expr: 'ss.feel' },                 // LLM-written from their comments, read-only
      { key: 'note',        label: 'User Feel',   expr: 'ss.note' },                 // free-text, editable
      { key: 'source',      label: 'Source',      expr: 'ss.source' },               // editable enum
      { key: 'weight',      label: 'Weight',      expr: 'ss.weight' },
      { key: 'updated_at',  label: 'Updated',     expr: 'ss.updated_at' },
    ],
    searchExprs: ['ss.user_email', 'ss.title_name', 'ss.feel', 'ss.note'],
    filters: [
      { key: 'kind',      label: 'Kind',      expr: "COALESCE(NULLIF(ss.kind,''),'—')", options: ['series', 'miniseries', 'anthology', 'film', '—'] },
      { key: 'tier',      label: 'Tier',      expr: SHADOW_TIER_DISP, options: ['Top 10', 'Top 25', 'Top 50', '—'] },
      { key: 'sentiment', label: 'Sentiment', expr: "COALESCE(NULLIF(ss.sentiment,''),'—')", options: ['love', 'like', 'meh', 'nope', '—'] },
      { key: 'source',    label: 'Source',    expr: 'ss.source', options: ['watch', 'game', 'chat', 'manual'] },
      { key: 'hidden',    label: 'Cut?',      expr: "CASE WHEN ss.hidden = 1 THEN 'cut' ELSE 'kept' END", options: ['cut', 'kept'] },
    ],
    sortDefault: 'rank',
    // Cluster by user, then kind, then tier (Top 10 first), then rank within.
    defaultOrder: `ss.user_email ASC, ss.kind ASC, ${SHADOW_TIER_ORDER} ASC, CASE WHEN ss.rank > 0 THEN ss.rank ELSE 999999 END ASC, ss.weight DESC, ss.updated_at DESC`,
    defaultFilters: { kind: 'series', hidden: 'kept' },   // open on Series, uncut only; change the filters to see the rest
    groupBy: 'user_email',
    groupHeaderCols: ['user_email'],   // one header row per user; email drops off the per-row columns
    reorder: 'rank',                   // drag a row to reposition → renumbers + saves
    reorderScope: 'kind',              // ranks are per-kind: drag/renumber only within the same category
    reorderCutCol: 'hidden',           // ticking Cut removes a row from ranking → compact the kind (close the gap, shift up)
    writes: {
      // All inline-editable (autosave on change; Save all flushes any stragglers).
      rank:      { table: 'streaming_shadow', column: 'rank',      idColumn: 'id', kind: 'int' },
      kind:      { table: 'streaming_shadow', column: 'kind',      idColumn: 'id', options: ['series', 'miniseries', 'anthology', 'film', ''] },
      tier:      { table: 'streaming_shadow', column: 'tier',      idColumn: 'id', options: ['Top 10', 'Top 25', 'Top 50', ''] },
      sentiment: { table: 'streaming_shadow', column: 'sentiment', idColumn: 'id', options: ['love', 'like', 'meh', 'nope', ''] },
      note:      { table: 'streaming_shadow', column: 'note',      idColumn: 'id', kind: 'text' },
      source:    { table: 'streaming_shadow', column: 'source',    idColumn: 'id', options: ['watch', 'game', 'chat', 'manual'] },
      hidden:    { table: 'streaming_shadow', column: 'hidden',    idColumn: 'id', kind: 'bool' },
    },
    note: "Each user's streaming shadow — every title they have watched, mentioned, or reacted to with Pierre. Opens on Series (change the Kind filter for the rest). `Kind` (series / mini-series / anthology / film) is auto-classified (best-guess LLM; editable). `Tier` (Top 10 / Top 25 / Top 50) is a SUBJECTIVE bucket, not a count — a Top 10 can hold 30 shows; Pierre places titles into a tier through conversation, editable here. `Rank` is the fine 1..N order within a kind (drag a row by its ⠿ handle, or type a number); rows sort by kind, then tier, then rank. `Pierre Feel` is LLM-written from their comments (read-only); `User Feel` is free text you can edit; `Sentiment`, `Source`, `Cut` are editable inline. `Weight` = how often a title has come up. `Cut` (hidden) rows are kept for context but not shown to the member.",
    pivots: {
      kind:      countPivot('By kind', "COALESCE(NULLIF(ss.kind,''),'—')", 'Kind'),
      tier:      countPivot('By tier', SHADOW_TIER_DISP, 'Tier'),
      sentiment: countPivot('By sentiment', "COALESCE(NULLIF(ss.sentiment,''),'—')", 'Sentiment'),
      source:    countPivot('By source', 'ss.source', 'Source'),
      top_titles: countPivot('Most-shadowed titles', 'ss.title_name', 'Title'),
      by_user:   countPivot('Shadow size by user', 'ss.user_email', 'User'),
    },
  },

  watch_title: {
    label: 'Watch · Title',
    group: 'core',
    from: 'watch_title LEFT JOIN titles ON titles.title_id = watch_title.title_id',
    cols: [
      { key: 'user_email', label: 'User',       expr: 'watch_title.user_email' },
      { key: 'show_name',  label: 'Show',       expr: 'COALESCE(titles.name, watch_title.title_id)' },
      { key: 'title_id',   label: 'Title ID',   expr: 'watch_title.title_id' },
      { key: 'status',     label: 'Status',     expr: 'watch_title.status' },
      { key: 'started_at', label: 'Started',    expr: 'watch_title.started_at' },
      { key: 'updated_at', label: 'Updated',    expr: 'watch_title.updated_at' },
    ],
    searchExprs: ['watch_title.user_email', 'titles.name', 'watch_title.title_id'],
    filters: [{ key: 'status', label: 'Status', expr: 'watch_title.status' }],
    sortDefault: 'updated_at',
    note: 'Real status values are current / returning / comfort / completed / stopped (not the watching/completed/dropped the brief assumed).',
    pivots: {
      status:    countPivot('By status', "COALESCE(NULLIF(watch_title.status,''),'—')", 'Status'),
      top_shows: countPivot('Most-watched shows', 'COALESCE(titles.name, watch_title.title_id)', 'Show'),
      cohort:    countPivot('Started by month', monthOf('watch_title.started_at'), 'Month'),
    },
  },

  watch_episode: {
    label: 'Watch · Episode',
    group: 'core',
    from: 'watch_episode LEFT JOIN episodes ON episodes.episode_id = watch_episode.episode_id LEFT JOIN titles ON titles.title_id = watch_episode.title_id',
    cols: [
      { key: 'user_email',   label: 'User',      expr: 'watch_episode.user_email' },
      { key: 'show_name',    label: 'Show',      expr: 'COALESCE(titles.name, watch_episode.title_id)' },
      { key: 'episode_name', label: 'Episode',   expr: 'episodes.name' },
      { key: 'episode_id',   label: 'Episode ID',expr: 'watch_episode.episode_id' },
      { key: 'done',         label: 'Done',      expr: 'watch_episode.done' },
      { key: 'minute',       label: 'Minute',    expr: 'watch_episode.minute' },
      { key: 'updated_at',   label: 'Updated',   expr: 'watch_episode.updated_at' },
    ],
    searchExprs: ['watch_episode.user_email', 'titles.name', 'episodes.name'],
    sortDefault: 'updated_at',
    pivots: {
      done:      countPivot('Done vs in-progress', "CASE WHEN watch_episode.done=1 THEN 'done' ELSE 'in-progress' END", 'Bucket'),
      top_shows: countPivot('Rows by show', 'COALESCE(titles.name, watch_episode.title_id)', 'Show'),
      completion: {
        label: 'Completion rate by episode (drop-off)',
        columns: [
          { key: 'show', label: 'Show' }, { key: 'episode', label: 'Episode' },
          { key: 'starters', label: 'Starters' }, { key: 'finished', label: 'Finished' }, { key: 'pct', label: '% finished' },
        ],
        sql: (from, where) =>
          `SELECT COALESCE(titles.name, watch_episode.title_id) AS show, episodes.name AS episode,
                  COUNT(*) AS starters, SUM(watch_episode.done) AS finished,
                  ROUND(100.0*SUM(watch_episode.done)/COUNT(*),1) AS pct
             FROM ${from} ${where}
             GROUP BY watch_episode.episode_id
             HAVING COUNT(*) >= 3
             ORDER BY starters DESC, pct ASC LIMIT 200`,
      },
    },
  },

  follows: {
    label: 'Connections (follows)',
    group: 'core',
    from: 'follows',
    cols: [
      { key: 'follower_email', label: 'From (follower)', expr: 'follows.follower_email' },
      { key: 'followee_email', label: 'To (followee)',   expr: 'follows.followee_email' },
      { key: 'mutual',         label: 'Mutual',          expr: "CASE WHEN EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_email=follows.followee_email AND f2.followee_email=follows.follower_email) THEN 'yes' ELSE 'no' END" },
      { key: 'created_at',     label: 'Created',         expr: 'follows.created_at' },
    ],
    searchExprs: ['follows.follower_email', 'follows.followee_email'],
    sortDefault: 'created_at',
    note: 'The unified follow/friend connections model (type/status, 5-friend cap) is not built yet — this is the real directed `follows` table. Mutual = both directions exist; those are the friend candidates to watch once the split lands.',
    pivots: {
      mutual:    countPivot('Mutual vs one-way', "CASE WHEN EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_email=follows.followee_email AND f2.followee_email=follows.follower_email) THEN 'mutual' ELSE 'one-way' END", 'Bucket'),
      most_followed: countPivot('Most-followed users', 'follows.followee_email', 'User'),
      most_active:   countPivot('Most-following users', 'follows.follower_email', 'User'),
      cohort:    countPivot('Created by month', monthOf('follows.created_at'), 'Month'),
    },
  },

  watch_comment: {
    label: 'Comments',
    group: 'core',
    // episode_id is the human code (S01E01 / 🎬 for movies), NOT the global
    // episodes.episode_id key — so we DON'T join episodes; show_id is the real
    // title key, joined to titles for the show name.
    from: 'watch_comment LEFT JOIN titles ON titles.title_id = watch_comment.show_id',
    idExpr: 'watch_comment.id',
    cols: [
      { key: 'hidden',     label: 'Hide',    expr: 'watch_comment.hidden' },
      { key: 'flags',      label: 'Reports', expr: "(SELECT COUNT(*) FROM comment_flag cf WHERE cf.comment_id = watch_comment.id AND COALESCE(cf.source,'member') = 'member')" },
      { key: 'flaggers',   label: 'Flagged by', expr: "(SELECT GROUP_CONCAT(cf.user_email || CASE WHEN COALESCE(cf.source,'member') <> 'member' THEN ' (' || cf.source || ')' ELSE '' END, ', ') FROM comment_flag cf WHERE cf.comment_id = watch_comment.id)" },
      { key: 'kind',       label: 'Kind',    expr: KIND_EXPR },
      { key: 'user_email', label: 'User',    expr: 'watch_comment.user_email' },
      { key: 'show_name',  label: 'Show',    expr: 'COALESCE(titles.name, watch_comment.show_id)' },
      { key: 'episode_id', label: 'Episode', expr: 'watch_comment.episode_id' },
      { key: 'timecode',   label: 'At',      expr: 'watch_comment.timestamp_ms' },
      { key: 'spoiler',    label: 'Spoiler', expr: SPOILER_EXPR },
      { key: 'shared',     label: 'Shared',  expr: SHARED_EXPR },
      { key: 'transcription', label: 'Transcript', expr: 'watch_comment.transcription' },
      { key: 'audio',      label: 'Audio',   expr: "CASE WHEN watch_comment.audio_r2_key IS NOT NULL AND watch_comment.audio_r2_key<>'' THEN watch_comment.id ELSE '' END" },
      { key: 'shares',     label: 'Shares',  expr: '(SELECT COUNT(*) FROM comment_share cs WHERE cs.comment_id = watch_comment.id)' },
      { key: 'share_dest', label: 'Shared to', expr: "(SELECT cs.platform || ' · ' || cs.method FROM comment_share cs WHERE cs.comment_id = watch_comment.id ORDER BY cs.shared_at DESC LIMIT 1)" },
      { key: 'last_shared',label: 'Last shared', expr: '(SELECT MAX(cs.shared_at) FROM comment_share cs WHERE cs.comment_id = watch_comment.id)' },
      { key: 'created_at', label: 'Created', expr: 'watch_comment.created_at' },
    ],
    searchExprs: ['watch_comment.user_email', 'watch_comment.transcription', 'titles.name', 'watch_comment.episode_id'],
    filters: [
      { key: 'kind',     label: 'Kind',     expr: KIND_EXPR,    options: ['episode', 'reflection', 'endnote', 'reply'] },
      { key: 'spoiler',  label: 'Spoiler',  expr: SPOILER_EXPR, options: ['SPLR', 'NOSP', '—'] },
      { key: 'shared',   label: 'Shared',   expr: SHARED_EXPR,  options: ['shared', 'journaled', '—'] },
      { key: 'reported', label: 'Reported', expr: "CASE WHEN (SELECT COUNT(*) FROM comment_flag cf WHERE cf.comment_id=watch_comment.id AND COALESCE(cf.source,'member')='member')>0 THEN 'yes' ELSE 'no' END", options: ['yes', 'no'] },
      { key: 'hidden',   label: 'Hidden',   expr: "CASE WHEN watch_comment.hidden=1 THEN 'yes' ELSE 'no' END", options: ['yes', 'no'] },
    ],
    sortDefault: 'created_at',
    note: 'Kinds: episode = timestamped co-view comment; reflection = end-of-viewing thought (episode/season/series/movie); endnote = end-of-episode reflection with a persisted SPLR/NOSP + reveal-on-finish; reply = text-only response (no audio). "Shared" = reflection published to the co-view feed (public) vs journaled (private). "Shares"/"Shared to"/"Last shared" = EXTERNAL native shares of the clip (comment_share log): count, latest platform·method (from the iOS share target + file kind — best-effort), and time. Audio plays inline for moderation. Movies use 🎬 as the episode code.',
    pivots: {
      kind:      countPivot('By kind', KIND_EXPR, 'Kind'),
      top_shows: countPivot('Reaction volume by show', 'COALESCE(titles.name, watch_comment.show_id)', 'Show'),
      spoiler:   countPivot('By spoiler flag', SPOILER_EXPR, 'Spoiler'),
      shared_platform: {
        label: 'External shares by platform',
        columns: [{ key: 'bucket', label: 'Platform' }, { key: 'n', label: 'Shares' }],
        // Counts comment_share rows (one per external share), honoring the current
        // search/filter via the shared watch_comment WHERE clause.
        sql: (from, where) =>
          `SELECT COALESCE(NULLIF(cs.platform,''),'unknown') AS bucket, COUNT(*) AS n
             FROM comment_share cs
             JOIN watch_comment ON watch_comment.id = cs.comment_id
             LEFT JOIN titles ON titles.title_id = watch_comment.show_id
             ${where}
             GROUP BY bucket ORDER BY n DESC`,
      },
    },
  },

  episode_comments: {
    label: 'Episode Feed',
    group: 'core',
    from: EPISODE_COMMENTS_FROM,
    idExpr: "ec.show_id || '|' || ec.episode_id || '|' || ec.user_email",
    cols: [
      { key: 'show_name',    label: 'Show',         expr: 'COALESCE(titles.name, ec.show_id)' },
      { key: 'episode_id',   label: 'Episode',      expr: 'ec.episode_id' },
      { key: 'commenter',    label: 'Commenter',    expr: 'COALESCE(cu.username, ec.user_email)' },
      { key: 'comments',     label: '#',            expr: 'ec.comments' },
      { key: 'all_comments', label: 'Comments',     expr: "''" },
      { key: 'last_at',      label: 'Last',         expr: 'ec.last_at' },
    ],
    searchExprs: ['titles.name', 'ec.episode_id', 'ec.user_email', 'cu.username'],
    sortDefault: 'last_at',
    note: 'One record PER COMMENTER per episode — each user gets their own row of the comments they left on that episode ("mm:ss text" timed, "SPLR/NOSP text" reflections/end-notes), opening with the call-to-action "To listen along join.pangolinrc.com". Replies are not their own record: they thread (↳ replier) under the comment they answer, inside that comment author\'s record. Hidden comments excluded. The Comments text + the ⧉ Copy payload are identical. Search/sort on Commenter to isolate your own seed/test rows. Read-only.',
  },

  waitlist: {
    label: 'Waitlist',
    group: 'secondary',
    from: 'waitlist',
    idExpr: 'waitlist.email',
    cols: [
      { key: 'list_type',   label: 'List',    expr: LIST_TYPE_EXPR },
      { key: 'email',       label: 'Email',   expr: 'waitlist.email' },
      { key: 'first_name',  label: 'First',   expr: 'waitlist.first_name' },
      { key: 'last_name',   label: 'Last',    expr: 'waitlist.last_name' },
      { key: 'phone',       label: 'Phone',   expr: 'waitlist.phone' },
      { key: 'company',     label: 'Company', expr: 'waitlist.company' },
      { key: 'fav_show',    label: 'Fav show',expr: 'waitlist.fav_show' },
      { key: 'buddy_email', label: 'Buddy',   expr: 'waitlist.buddy_email' },
      { key: 'source',      label: 'Source',  expr: 'waitlist.source' },
      { key: 'test_group',  label: 'Group',   expr: GROUP_EXPR },
      { key: 'status',      label: 'Status',  expr: 'waitlist.status' },
      { key: 'created_at',  label: 'Joined',  expr: 'waitlist.created_at' },
    ],
    searchExprs: ['waitlist.email', 'waitlist.first_name', 'waitlist.last_name', 'waitlist.company', 'waitlist.phone'],
    filters: [
      { key: 'list_type',  label: 'List',   expr: LIST_TYPE_EXPR,    options: ['waitlist', 'investor'] },
      { key: 'status',     label: 'Status', expr: 'waitlist.status', options: [...WAITLIST_STATUSES] },
      { key: 'test_group', label: 'Group',  expr: GROUP_EXPR,        options: [...WAITLIST_GROUPS] },
    ],
    sortDefault: 'created_at',
    writes: {
      status:     { table: 'waitlist', column: 'status',     idColumn: 'email', options: WAITLIST_STATUSES },
      test_group: { table: 'waitlist', column: 'test_group', idColumn: 'email', options: WAITLIST_GROUPS },
    },
    pivots: {
      list_type: countPivot('By list', LIST_TYPE_EXPR, 'List'),
      status:    countPivot('By status', "COALESCE(NULLIF(waitlist.status,''),'—')", 'Status'),
      group:     countPivot('By group', GROUP_EXPR, 'Group'),
      cohort:    countPivot('Signups by month', monthOf('waitlist.created_at'), 'Month'),
    },
    note: 'One contact list: List = waitlist (join.pangolinrc.com) or investor (invest.pangolinrc.com "Request the deck"). Status and Group (TestFlight cohort) are editable inline — pick from the dropdowns. Company is investor-only.',
  },

  outreach: {
    label: 'Outreach',
    group: 'secondary',
    // Fold into the funnel by email: LEFT JOIN the inbound tables so the Funnel
    // column reflects a contact's live waitlist/member state (see OUTREACH_FUNNEL_EXPR).
    from: `outreach o
      LEFT JOIN waitlist ow ON lower(ow.email) = lower(o.contact_email) AND o.contact_email <> ''
      LEFT JOIN users    ou ON lower(ou.email) = lower(o.contact_email) AND o.contact_email <> ''`,
    idExpr: 'o.id',
    cols: [
      { key: 'name',           label: 'Name',      expr: 'o.name' },
      { key: 'handle',         label: 'Handle',    expr: 'o.handle' },
      { key: 'platform',       label: 'Platform',  expr: 'o.platform' },
      { key: 'follower_count', label: 'Followers', expr: 'o.follower_count' },
      { key: 'channel',        label: 'Channel',   expr: 'o.channel' },
      { key: 'status',         label: 'Status',    expr: 'o.status' },
      { key: 'cadence',        label: 'Cadence',   expr: OUTREACH_CADENCE_EXPR },
      { key: 'funnel',         label: 'Funnel',    expr: OUTREACH_FUNNEL_EXPR },
      { key: 'angle',          label: 'Angle',     expr: 'o.angle' },
      { key: 'date_contacted', label: 'Contacted', expr: 'o.date_contacted' },
      { key: 'contact_email',  label: 'Email',     expr: 'o.contact_email' },
      { key: 'notes',          label: 'Notes',     expr: 'o.notes' },
      { key: 'initial_draft',  label: 'Initial Draft', expr: 'o.initial_draft' },
      { key: 'one_week_draft', label: 'Wk1 Draft',     expr: 'o.one_week_draft' },
      { key: 'one_month_draft',label: 'Mo1 Draft',     expr: 'o.one_month_draft' },
    ],
    searchExprs: ['o.name', 'o.handle', 'o.contact_email', 'o.angle', 'o.notes'],
    filters: [
      { key: 'status',   label: 'Status',   expr: 'o.status',   options: [...OUTREACH_STATUSES] },
      { key: 'channel',  label: 'Channel',  expr: 'o.channel',  options: [...OUTREACH_CHANNELS] },
      { key: 'platform', label: 'Platform', expr: 'o.platform', options: [...OUTREACH_PLATFORMS] },
    ],
    sortDefault: 'date_contacted',
    writes: {
      status:   { table: 'outreach', column: 'status',   idColumn: 'id', options: OUTREACH_STATUSES },
      channel:  { table: 'outreach', column: 'channel',  idColumn: 'id', options: OUTREACH_CHANNELS },
      platform: { table: 'outreach', column: 'platform', idColumn: 'id', options: OUTREACH_PLATFORMS },
      angle:    { table: 'outreach', column: 'angle',    idColumn: 'id', kind: 'text' },
      notes:    { table: 'outreach', column: 'notes',    idColumn: 'id', kind: 'text' },
    },
    pivots: {
      status:   countPivot('By status', "COALESCE(NULLIF(o.status,''),'—')", 'Status'),
      channel:  countPivot('By channel', 'o.channel', 'Channel'),
      platform: countPivot('By platform', "COALESCE(NULLIF(o.platform,''),'—')", 'Platform'),
      funnel:   countPivot('By funnel state', OUTREACH_FUNNEL_EXPR, 'Funnel'),
    },
    note: 'Creators/influencers WE reach out to (cold DM or email) — the top of the funnel, distinct from the inbound Waitlist. Status, Channel, Platform, Angle and Notes are editable inline. The Funnel column is derived, not typed: it matches this contact\'s Email against the Waitlist/Users tables and shows "Member", "Waitlist: <status>", "not in funnel", or "—" (no email on file) — so once someone fills join.pangolinrc.com you see it here without re-typing "Converted". Set Status = Converted when they take the action you asked for; the Funnel column confirms whether they actually landed in the funnel.',
  },

  marathons: {
    label: 'Marathons',
    group: 'secondary',
    from: 'maps LEFT JOIN titles ON titles.title_id = maps.title_id',
    idExpr: 'maps.map_id',
    cols: [
      { key: 'map_id',     label: 'Map ID',   expr: 'maps.map_id' },
      { key: 'name',       label: 'Name',     expr: 'maps.name' },
      { key: 'show_name',  label: 'Show',     expr: "COALESCE(titles.name, maps.title_id, 'cross-title')" },
      { key: 'title_id',   label: 'Title ID', expr: "COALESCE(maps.title_id,'')" },
      { key: 'kind',       label: 'Kind',     expr: 'maps.kind' },
      { key: 'owner_email',label: 'Owner',    expr: "COALESCE(NULLIF(maps.owner_email,''),'global')" },
      { key: 'steps',      label: 'Steps',    expr: '(SELECT COUNT(*) FROM map_steps ms WHERE ms.map_id = maps.map_id)' },
      { key: 'order',      label: 'Order',    expr: "(SELECT GROUP_CONCAT(episode_id, ' → ') FROM (SELECT episode_id FROM map_steps WHERE map_id = maps.map_id ORDER BY position))" },
      { key: 'blurb',      label: 'Blurb',    expr: "COALESCE(maps.blurb,'')" },
      { key: 'blurb_by',   label: 'Blurb by', expr: "COALESCE(maps.blurb_by,'')" },
      { key: 'created_at', label: 'Created',  expr: 'maps.created_at' },
      { key: 'updated_at', label: 'Updated',  expr: 'maps.updated_at' },
    ],
    searchExprs: ['maps.map_id', 'maps.name', 'maps.blurb', 'titles.name'],
    filters: [
      { key: 'kind',  label: 'Kind',  expr: 'maps.kind', options: ['air_order', 'curated', 'user'] },
      { key: 'owner', label: 'Owner', expr: "CASE WHEN maps.owner_email IS NULL OR maps.owner_email = '' THEN 'global' ELSE 'user' END", options: ['global', 'user'] },
    ],
    sortDefault: 'created_at',
    writes: {
      // Fully editable inline (Ted's call). map_id is the stable key and is not itself editable.
      name:        { table: 'maps', column: 'name',        idColumn: 'map_id', kind: 'text' },
      title_id:    { table: 'maps', column: 'title_id',    idColumn: 'map_id', kind: 'text' },
      kind:        { table: 'maps', column: 'kind',        idColumn: 'map_id', options: ['air_order', 'curated', 'user'] },
      owner_email: { table: 'maps', column: 'owner_email', idColumn: 'map_id', kind: 'text' },
      blurb:       { table: 'maps', column: 'blurb',       idColumn: 'map_id', kind: 'text' },
      blurb_by:    { table: 'maps', column: 'blurb_by',    idColumn: 'map_id', kind: 'text' },
    },
    pivots: {
      kind:  countPivot('By kind', 'maps.kind', 'Kind'),
      owner: countPivot('Global vs user-built', "CASE WHEN maps.owner_email IS NULL OR maps.owner_email = '' THEN 'global' ELSE 'user' END", 'Owner'),
      show:  countPivot('By show', "COALESCE(titles.name, maps.title_id, 'cross-title')", 'Show'),
    },
    del: {
      // Delete a marathon: drop its steps, un-point any watcher currently on it (clear
      // active_map_id, don't delete the watch_title row), then remove the map itself.
      table: 'maps', idColumn: 'map_id',
      cascadeDelete: [{ table: 'map_steps', column: 'map_id' }],
      cascadeNull: [{ table: 'watch_title', column: 'active_map_id' }],
    },
    note: 'Marathons = curated "maps": a member (or global) viewing order that overrides canonical air order when a watcher\'s active_map_id points at it. kind is air_order / curated (global, owner blank) / user (member-built). Name, Show (Title ID), Kind, Owner, Blurb and Blurb by are all editable inline — map_id is the fixed key and is not editable. The Order column previews the episode sequence; edit the actual steps on the Marathon steps tab. Delete (the ✕ at the end of each row) removes the marathon and its steps and un-points any watcher currently on it — it does NOT delete their viewing progress. This is consumer-facing in effect: a member watching that marathon falls back to canonical air order.',
  },

  marathon_steps: {
    label: 'Marathon steps',
    group: 'secondary',
    from: 'map_steps ms JOIN maps ON maps.map_id = ms.map_id LEFT JOIN episodes e ON e.episode_id = ms.episode_id',
    // map_steps has a composite PK (map_id, position) with no single-column id, so use the
    // implicit rowid as the stable key for inline edits.
    idExpr: 'ms.rowid',
    cols: [
      { key: 'marathon',        label: 'Marathon',   expr: 'maps.name' },
      { key: 'map_id',          label: 'Map ID',     expr: 'ms.map_id' },
      { key: 'position',        label: 'Pos',        expr: 'ms.position' },
      { key: 'episode_name',    label: 'Episode',    expr: "COALESCE(e.name, '—')" },
      { key: 'episode_id',      label: 'Episode ID', expr: 'ms.episode_id' },
      { key: 'next_episode_id', label: 'Next ID',    expr: "COALESCE(ms.next_episode_id,'')" },
    ],
    searchExprs: ['maps.name', 'ms.map_id', 'ms.episode_id'],
    filters: [{ key: 'map_id', label: 'Marathon', expr: 'ms.map_id' }],
    sortDefault: 'position',
    // Cluster by marathon, then walk positions in order.
    defaultOrder: 'maps.name ASC, ms.map_id ASC, ms.position ASC',
    groupBy: 'marathon',
    groupHeaderCols: ['marathon', 'map_id'],
    writes: {
      // Episode wiring is editable inline (keyed by rowid). Position is display-only:
      // it's half the primary key, so renumbering would risk a UNIQUE collision — edit
      // ordering by rewriting the episode_id/next_episode_id at each step instead.
      episode_id:      { table: 'map_steps', column: 'episode_id',      idColumn: 'rowid', kind: 'text' },
      next_episode_id: { table: 'map_steps', column: 'next_episode_id', idColumn: 'rowid', kind: 'text' },
    },
    note: 'The ordered episode steps inside each marathon (from the Marathons tab). Filter or search to one marathon, then read down by Pos. Episode ID and Next ID are editable inline; Pos is the fixed step key and is not editable here.',
  },

  bug_report: {
    label: 'Bug Reports',
    group: 'secondary',
    from: 'bug_report',
    cols: [
      { key: 'id',             label: 'ID',         expr: 'bug_report.id' },
      { key: 'user_email',     label: 'User',       expr: 'bug_report.user_email' },
      { key: 'note',           label: 'Note',       expr: 'bug_report.note' },
      { key: 'view',           label: 'View',       expr: 'bug_report.view' },
      { key: 'status',         label: 'Status',     expr: 'bug_report.status' },
      { key: 'screenshot_url', label: 'Screenshot', expr: 'bug_report.screenshot_url' },
      { key: 'created_at',     label: 'Created',    expr: 'bug_report.created_at' },
    ],
    searchExprs: ['bug_report.user_email', 'bug_report.note', 'bug_report.view'],
    filters: [{ key: 'status', label: 'Status', expr: 'bug_report.status' }],
    sortDefault: 'created_at',
  },

  flagged_request: {
    label: 'Flagged Requests',
    group: 'secondary',
    from: 'flagged_request',
    cols: [
      { key: 'user_email', label: 'User',     expr: 'flagged_request.user_email' },
      { key: 'category',   label: 'Category',  expr: 'flagged_request.category' },
      { key: 'excerpt',    label: 'Message',   expr: 'flagged_request.excerpt' },
      { key: 'created_at', label: 'When',      expr: 'flagged_request.created_at' },
    ],
    searchExprs: ['flagged_request.user_email', 'flagged_request.excerpt'],
    filters: [{ key: 'category', label: 'Category', expr: 'flagged_request.category', options: ['S12', 'S3', 'S4'] }],
    sortDefault: 'created_at',
    note: 'Pierre porn/explicit requests auto-flagged by Llama Guard (S12 sexual content; S3/S4 sexual crimes). Pierre declines these in-chat — this is the trail of who asked. Fail-open: a classifier error records nothing.',
  },

  titles: {
    label: 'Titles',
    group: 'secondary',
    from: 'titles',
    cols: [
      { key: 'title_id',       label: 'Title ID',  expr: 'titles.title_id' },
      { key: 'name',           label: 'Name',      expr: 'titles.name' },
      { key: 'kind',           label: 'Kind',      expr: 'titles.kind' },
      { key: 'status',         label: 'Status',    expr: 'titles.status' },
      { key: 'platform',       label: 'Platform',  expr: 'titles.platform' },
      { key: 'total_episodes', label: 'Episodes',  expr: 'titles.total_episodes' },
      { key: 'premiered',      label: 'Premiered', expr: 'titles.premiered' },
      { key: 'updated_at',     label: 'Updated',   expr: 'titles.updated_at' },
    ],
    searchExprs: ['titles.name', 'titles.title_id'],
    filters: [{ key: 'kind', label: 'Kind', expr: 'titles.kind' }],
    sortDefault: 'name',
    note: 'Read-only reference — sourced from TVMaze/TMDB, not hand-edited.',
  },

  episodes: {
    label: 'Episodes',
    group: 'secondary',
    from: 'episodes LEFT JOIN titles ON titles.title_id = episodes.title_id',
    idExpr: 'episodes.episode_id',
    cols: [
      { key: 'episode_id', label: 'Episode ID', expr: 'episodes.episode_id' },
      { key: 'show_name',  label: 'Show',       expr: 'COALESCE(titles.name, episodes.title_id)' },
      { key: 'season',     label: 'S',          expr: 'episodes.season' },
      { key: 'number',     label: 'E',          expr: 'episodes.number' },
      { key: 'name',       label: 'Name',       expr: 'episodes.name' },
      { key: 'airdate',    label: 'Airdate',    expr: 'episodes.airdate' },
      { key: 'runtime',    label: 'Runtime',    expr: 'episodes.runtime' },
    ],
    searchExprs: ['episodes.name', 'episodes.episode_id', 'titles.name'],
    sortDefault: 'airdate',
    writes: {
      // Global catalog runtime is admin-editable inline: correct it when a real
      // observed runtime differs from the TVMaze/TMDB value (e.g. a 12 Monkeys
      // episode that actually runs ~42 min, not the listed 60).
      runtime: { table: 'episodes', column: 'runtime', idColumn: 'episode_id', kind: 'int' },
    },
    note: 'Sourced from TVMaze/TMDB. Runtime is editable inline (whole minutes) — fix it when a viewer observes a real runtime the catalog got wrong.',
  },

  pierre_chat: {
    label: 'Pierre chats',
    group: 'secondary',
    from: 'pierre_chat pc',
    idExpr: 'pc.id',
    cols: [
      { key: 'conversation_id', label: 'Session', expr: 'substr(pc.conversation_id,1,8)' },
      { key: 'user_email',      label: 'User',    expr: "COALESCE(NULLIF(pc.user_email,''),'anon')" },
      // Session Type: "Game Session" if any turn in the conversation is a game turn.
      { key: 'type',            label: 'Type',    expr: "CASE WHEN EXISTS(SELECT 1 FROM pierre_chat pk WHERE pk.conversation_id=pc.conversation_id AND pk.kind='game') THEN 'Game Session' ELSE 'Chat' END" },
      // Session Grade: 👍 if graded good/great with no poor/bad, 👎 if any poor/bad, else —.
      { key: 'sgrade',          label: 'Grade',   expr: "CASE WHEN EXISTS(SELECT 1 FROM pierre_chat pgg WHERE pgg.conversation_id=pc.conversation_id AND pgg.grade IN ('great','good')) AND NOT EXISTS(SELECT 1 FROM pierre_chat pbb WHERE pbb.conversation_id=pc.conversation_id AND pbb.grade IN ('poor','bad')) THEN '👍' WHEN EXISTS(SELECT 1 FROM pierre_chat pb2 WHERE pb2.conversation_id=pc.conversation_id AND pb2.grade IN ('poor','bad')) THEN '👎' ELSE '—' END" },
      { key: 'seq',             label: '#',       expr: 'pc.seq' },
      { key: 'role',            label: 'Who',     expr: 'pc.role' },
      { key: 'content',         label: 'Message', expr: 'pc.content' },
      { key: 'needs_reply',     label: 'Ted?',    expr: "CASE WHEN pc.needs_ted=1 AND COALESCE(pc.ted_status,'')<>'handled' THEN 1 ELSE 0 END" },
      { key: 'grade',           label: 'Turn grade', expr: "COALESCE(NULLIF(pc.grade,''),'ungraded')" },
      { key: 'created_at',      label: 'When',    expr: 'pc.created_at' },
    ],
    searchExprs: ['pc.user_email', 'pc.content', 'pc.conversation_id'],
    filters: [
      { key: 'role',  label: 'Who',   expr: 'pc.role', options: ['user', 'pierre'] },
      { key: 'type',  label: 'Type',  expr: "CASE WHEN EXISTS(SELECT 1 FROM pierre_chat pk2 WHERE pk2.conversation_id=pc.conversation_id AND pk2.kind='game') THEN 'Game Session' ELSE 'Chat' END", options: ['Game Session', 'Chat'] },
      { key: 'grade', label: 'Grade', expr: "COALESCE(NULLIF(pc.grade,''),'ungraded')", options: ['ungraded', 'great', 'good', 'poor', 'bad'] },
    ],
    sortDefault: 'created_at',
    // Group by conversation: newest session first (by its first turn), turns in order.
    defaultOrder: '(SELECT MIN(p2.created_at) FROM pierre_chat p2 WHERE p2.conversation_id = pc.conversation_id) DESC, pc.conversation_id ASC, pc.seq ASC',
    groupBy: 'conversation_id',
    groupHeaderCols: ['conversation_id', 'user_email', 'type', 'sgrade'],   // Session · User · Type · Grade → group header
    writes: {
      // Grade Pierre’s turns inline. 'ungraded' clears it back.
      grade: { table: 'pierre_chat', column: 'grade', idColumn: 'id', options: ['ungraded', 'great', 'good', 'poor', 'bad'] },
    },
    pivots: {
      grade: countPivot('By grade', "COALESCE(NULLIF(pc.grade,''),'ungraded')", 'Grade'),
      users: countPivot('By user', "COALESCE(NULLIF(pc.user_email,''),'anon')", 'User'),
    },
    note: 'Full Pierre chat transcripts, one row per turn, saved every turn. Search or filter to a Session, then sort by # to read the conversation in order. Grade Pierre’s turns inline to trail response quality.',
  },

  get_ted: {
    label: 'Get Ted',
    group: 'core',
    // Full sessions that still need Ted: every turn of any conversation with an open
    // [GETTED] escalation, so the thread reads exactly like Pierre chats (not a bare row).
    from: "(SELECT * FROM pierre_chat WHERE conversation_id IN (SELECT conversation_id FROM pierre_chat WHERE needs_ted = 1 AND COALESCE(ted_status,'') <> 'handled')) pc",
    idExpr: 'pc.id',
    cols: [
      { key: 'conversation_id', label: 'Session', expr: 'substr(pc.conversation_id,1,8)' },
      { key: 'user_email',      label: 'User',    expr: "COALESCE(NULLIF(pc.user_email,''),'anon')" },
      { key: 'role',            label: 'Who',     expr: 'pc.role' },
      { key: 'content',         label: 'Message', expr: 'pc.content' },
      { key: 'needs_reply',     label: 'Ted?',    expr: "CASE WHEN pc.needs_ted=1 AND COALESCE(pc.ted_status,'')<>'handled' THEN 1 ELSE 0 END" },
      { key: 'created_at',      label: 'When',    expr: 'pc.created_at' },
    ],
    searchExprs: ['pc.user_email', 'pc.content', 'pc.conversation_id'],
    sortDefault: 'created_at',
    // Group by conversation, newest session first (by its first turn), turns in order.
    defaultOrder: '(SELECT MIN(p2.created_at) FROM pierre_chat p2 WHERE p2.conversation_id = pc.conversation_id) DESC, pc.conversation_id ASC, pc.seq ASC',
    groupBy: 'conversation_id',
    groupHeaderCols: ['conversation_id', 'user_email'],
    note: 'Sessions waiting on Ted, read like Pierre chats. Read the thread, then write one reply in the box under the conversation. It lands in the user’s app as a blue TED message and clears the session.',
  },

  feedback: {
    label: 'Feedback',
    group: 'core',
    from: 'feedback f',
    cols: [
      { key: 'kind',       label: 'Kind',  expr: 'f.kind' },
      { key: 'user_email', label: 'User',  expr: "COALESCE(NULLIF(f.user_email,''),'anon')" },
      { key: 'face',       label: 'Face',  expr: "COALESCE(f.face,'')" },
      { key: 'note',       label: 'Note',  expr: "COALESCE(f.note,'')" },
      { key: 'created_at', label: 'When',  expr: 'f.created_at' },
    ],
    searchExprs: ['f.user_email', 'f.face', 'f.note'],
    filters: [
      { key: 'kind', label: 'Kind', expr: 'f.kind', options: ['up', 'down', 'get_ted'] },
    ],
    sortDefault: 'created_at',
    pivots: {
      kind:  countPivot('By kind', 'f.kind', 'Kind'),
      users: countPivot('By user', "COALESCE(NULLIF(f.user_email,''),'anon')", 'User'),
    },
    note: 'Quick thumbs (and Get Ted taps) from the console band, for your manual review. A Get Ted tap also opens a session in the Get Ted queue.',
  },

  runtime_report: {
    label: 'Runtime reports',
    group: 'secondary',
    from: 'runtime_report rr LEFT JOIN episodes e ON e.episode_id = rr.episode_id LEFT JOIN titles t ON t.title_id = e.title_id',
    cols: [
      { key: 'show_name',  label: 'Show',     expr: 'COALESCE(t.name, e.title_id, rr.episode_id)' },
      { key: 'episode',    label: 'Ep',       expr: "'S'||COALESCE(e.season,'?')||'E'||COALESCE(e.number,'?')" },
      { key: 'observed',   label: 'Observed', expr: 'rr.observed_runtime' },
      { key: 'current',    label: 'Catalog',  expr: 'e.runtime' },
      { key: 'agree',      label: 'Agree',    expr: '(SELECT COUNT(DISTINCT r2.user_email) FROM runtime_report r2 WHERE r2.episode_id = rr.episode_id AND r2.observed_runtime = rr.observed_runtime)' },
      { key: 'user_email', label: 'User',     expr: 'rr.user_email' },
      { key: 'status',     label: 'Status',   expr: 'rr.status' },
      { key: 'created_at', label: 'Reported', expr: 'rr.created_at' },
    ],
    searchExprs: ['rr.user_email', 't.name', 'rr.episode_id'],
    filters: [{ key: 'status', label: 'Status', expr: 'rr.status', options: ['pending', 'applied', 'dismissed'] }],
    sortDefault: 'created_at',
    pivots: {
      status: countPivot('By status', "COALESCE(NULLIF(rr.status,''),'pending')", 'Status'),
    },
    note: 'User-observed episode runtimes (Pierre’s "real runtime?" prompt). 2+ distinct users agreeing on the same value auto-applies to the catalog (status → applied). To apply a single report by hand, edit that episode’s Runtime on the Episodes tab.',
  },

  watch_title_coviewer: {
    label: 'Co-viewing',
    group: 'secondary',
    from: 'watch_title_coviewer wtc JOIN coviewer cv ON cv.id = wtc.coviewer_id LEFT JOIN titles t ON t.title_id = wtc.title_id',
    cols: [
      { key: 'user_email',   label: 'User',     expr: 'wtc.user_email' },
      { key: 'show_name',    label: 'Title',    expr: 'COALESCE(t.name, wtc.title_id)' },
      { key: 'coviewer',     label: 'Coviewer', expr: 'cv.display_name' },
      { key: 'relationship', label: 'Rel',      expr: "COALESCE(NULLIF(cv.relationship,''),'—')" },
      { key: 'created_at',   label: 'Added',    expr: 'wtc.created_at' },
    ],
    searchExprs: ['wtc.user_email', 't.name', 'cv.display_name'],
    filters: [{ key: 'relationship', label: 'Rel', expr: "COALESCE(NULLIF(cv.relationship,''),'—')" }],
    sortDefault: 'created_at',
    pivots: {
      by_coviewer: countPivot('By coviewer', 'cv.display_name', 'Coviewer'),
      by_user:     countPivot('By user', 'wtc.user_email', 'User'),
    },
    note: 'Who watches which title WITH whom (per-title co-viewing). Set in Pierre’s add flow and editable on WATCH/LOG.',
  },
};

// Columns that hold a ms-epoch timestamp, so the frontend renders them as dates.
const DATE_KEYS = new Set(['created_at', 'updated_at', 'started_at', 'last_shared', 'last_at']);

// ─── Routes ──────────────────────────────────────────────────────────────────

// Metadata for the whole portal — drives the generic frontend (nav + columns +
// filter/pivot options). No data, but still gated (it enumerates the schema).
adminRoutes.get('/meta', async (c) => {
  const denied = adminGate(c); if (denied) return denied;
  // Nav badges: unattended-work counters — one per tab so the number the app icon paints
  // always resolves to a place in this nav. The app-icon badge is waitlistNew + getTedOpen
  // + outreachDue (see POST /app-status); these three MUST use the SAME queries so a "1" on
  // the phone lights up exactly one tab here. Cheap enough to compute on each meta load.
  const badges: Record<string, number> = {};
  const nowTs = Date.now();
  await sweepOutreachSoftDecline(c.env, nowTs);  // match /app-status: retire lapsed rows before counting

  const wlNew = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE status = 'new'").first<{ n: number }>();
  if (wlNew?.n) badges.waitlist = wlNew.n;

  // Sessions waiting on Ted: distinct conversations with an open, unhandled escalation.
  const gt = await c.env.DB
    .prepare("SELECT COUNT(DISTINCT conversation_id) AS n FROM pierre_chat WHERE needs_ted = 1 AND COALESCE(ted_status,'') <> 'handled'")
    .first<{ n: number }>();
  if (gt?.n) badges.get_ted = gt.n;

  // Outreach follow-ups due (stage 0/1 whose next_due_at has passed and still active).
  const od = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM outreach
        WHERE next_due_at IS NOT NULL AND next_due_at <= ? AND follow_up_stage < 2
          AND status IN ('Sent', 'No Response')`,
    )
    .bind(nowTs)
    .first<{ n: number }>();
  if (od?.n) badges.outreach = od.n;

  const resources = Object.entries(RESOURCES).map(([key, r]) => ({
    key,
    label: r.label,
    group: r.group,
    note: r.note ?? null,
    badge: badges[key] ?? null,
    columns: r.cols.map((col) => {
      const w = r.writes?.[col.key];
      const edit = w ? { kind: w.kind ?? 'enum', options: w.options ? [...w.options] : null } : null;
      return { key: col.key, label: col.label, date: DATE_KEYS.has(col.key), edit };
    }),
    search: r.searchExprs.length > 0,
    sortDefault: r.sortDefault,
    groupBy: r.groupBy ?? null,
    groupHeaderCols: r.groupHeaderCols ?? null,
    reorder: r.reorder ?? null,
    reorderScope: r.reorder ? (r.reorderScope ?? null) : null,
    reorderCutCol: r.reorder ? (r.reorderCutCol ?? null) : null,
    deletable: !!r.del,
    filters: (r.filters ?? []).map((f) => ({ key: f.key, label: f.label, options: f.options ?? null, multi: !!f.multi })),
    defaultFilters: r.defaultFilters ?? null,
    pivots: r.pivots ? Object.entries(r.pivots).map(([pk, p]) => ({ key: pk, label: p.label })) : [],
  }));
  return c.json({ ok: true, resources });
});

function buildWhere(r: Resource, c: any): { clause: string; binds: unknown[] } {
  const binds: unknown[] = [];
  const parts: string[] = [];
  const q = (c.req.query('q') || '').trim();
  if (q && r.searchExprs.length) {
    parts.push('(' + r.searchExprs.map((e) => `${e} LIKE ?`).join(' OR ') + ')');
    for (const _ of r.searchExprs) binds.push(`%${q}%`);
  }
  for (const f of r.filters ?? []) {
    const v = c.req.query(`f_${f.key}`);
    if (v == null || v === '') continue;
    if (f.multi) {
      // Multiselect: f_<key> is a comma-separated list → expr IN (?,?,…). Values are bound
      // params (never interpolated), so an unknown value just matches nothing. Empty → skip
      // (no constraint), so "nothing checked" reads as "no filter", not "no rows".
      const vals = v.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (!vals.length) continue;
      parts.push(`${f.expr} IN (${vals.map(() => '?').join(',')})`);
      for (const val of vals) binds.push(val);
    } else {
      parts.push(`${f.expr} = ?`); binds.push(v);
    }
  }
  return { clause: parts.length ? 'WHERE ' + parts.join(' AND ') : '', binds };
}

// GET /admin/list/:resource?q=&f_<key>=&sort=&dir=&limit=&offset=
adminRoutes.get('/list/:resource', async (c) => {
  const denied = adminGate(c); if (denied) return denied;
  const r = RESOURCES[c.req.param('resource')];
  if (!r) return c.json({ error: 'unknown resource' }, 404);

  const { clause, binds } = buildWhere(r, c);

  const sortKey = c.req.query('sort') || r.sortDefault;
  const sortCol = r.cols.find((col) => col.key === sortKey) ?? r.cols.find((col) => col.key === r.sortDefault)!;
  const dir = (c.req.query('dir') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

  const select = r.cols.map((col) => `${col.expr} AS "${col.key}"`).join(', ')
    + (r.idExpr ? `, ${r.idExpr} AS "_id"` : '');
  // When the default sort is active and the resource defines a grouping order, use it
  // (e.g. Pierre chats group by conversation). Any explicit column sort overrides it.
  const orderBy = (r.defaultOrder && sortKey === r.sortDefault) ? r.defaultOrder : `${sortCol.expr} ${dir}`;
  const rowsSql = `SELECT ${select} FROM ${r.from} ${clause}
                   ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS n FROM ${r.from} ${clause}`;

  const [rowsRes, countRes] = await Promise.all([
    c.env.DB.prepare(rowsSql).bind(...binds, limit, offset).all(),
    c.env.DB.prepare(countSql).bind(...binds).first<{ n: number }>(),
  ]);

  const rows = rowsRes.results ?? [];

  // Episode Feed: one record per commenter. Build that commenter's transcript — their own
  // ORIGINAL comments (in play order), each followed by any replies (threaded + attributed
  // to the replier). Filled here because the nesting/attribution can't be done in SQL.
  // `all_comments` = on-screen, `copy_text` = clipboard; identical.
  if (c.req.param('resource') === 'episode_comments' && rows.length) {
    await Promise.all(rows.map(async (row: any) => {
      const [show, ep, author] = String(row._id || '').split('|');
      if (!show || !ep || !author) return;
      const { results: origs } = await c.env.DB.prepare(
        `SELECT c.id, c.timestamp_ms, c.transcription, c.is_reflection, c.is_endnote, c.spoiler
           FROM watch_comment c
          WHERE c.show_id = ? AND c.episode_id = ? AND c.user_email = ? AND c.reply_to IS NULL
            AND COALESCE(c.hidden, 0) = 0 AND COALESCE(c.transcription, '') <> ''
          ORDER BY (CASE WHEN c.is_reflection = 1 OR c.is_endnote = 1 THEN 1 ELSE 0 END) ASC,
                   c.timestamp_ms ASC, c.created_at ASC`
      ).bind(show, ep, author).all();
      const ids = (origs ?? []).map((o: any) => o.id);
      const repliesOf = new Map<string, any[]>();
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        const { results: reps } = await c.env.DB.prepare(
          `SELECT c.reply_to, c.transcription, c.user_email, u.username
             FROM watch_comment c LEFT JOIN users u ON u.email = c.user_email
            WHERE c.reply_to IN (${ph})
              AND COALESCE(c.hidden, 0) = 0 AND COALESCE(c.transcription, '') <> ''
            ORDER BY c.created_at ASC`
        ).bind(...ids).all();
        for (const rp of (reps ?? []) as any[]) {
          (repliesOf.get(rp.reply_to) ?? repliesOf.set(rp.reply_to, []).get(rp.reply_to)!).push(rp);
        }
      }
      const lines: string[] = [];
      for (const o of (origs ?? []) as any[]) {
        lines.push(`${_cmMark(o)} ${(o.transcription || '').trim()}`);
        for (const rp of repliesOf.get(o.id) ?? []) lines.push(`    ↳ ${_cmName(rp)}: ${(rp.transcription || '').trim()}`);
      }
      const text = `${_TXT_HEAD}\n\n— ${row.commenter || author} —\n${lines.join('\n')}`;
      row.all_comments = text;
      row.copy_text = text;
    }));
  }

  return c.json({
    ok: true,
    total: countRes?.n ?? 0,
    limit, offset,
    sort: sortCol.key, dir: dir.toLowerCase(),
    rows,
  });
});

// GET /admin/pivot/:resource/:dim?q=&f_<key>=  — group-by counts, respects the
// current search/filter so a pivot reflects the filtered slice.
adminRoutes.get('/pivot/:resource/:dim', async (c) => {
  const denied = adminGate(c); if (denied) return denied;
  const r = RESOURCES[c.req.param('resource')];
  if (!r) return c.json({ error: 'unknown resource' }, 404);
  const pivot = r.pivots?.[c.req.param('dim')];
  if (!pivot) return c.json({ error: 'unknown pivot' }, 404);

  const { clause, binds } = buildWhere(r, c);
  const res = await c.env.DB.prepare(pivot.sql(r.from, clause)).bind(...binds).all();
  return c.json({ ok: true, columns: pivot.columns, rows: res.results ?? [] });
});

// POST /admin/app-status — lets the native app decide whether to show its in-app
// Admin Panel entry and what number to paint on the app icon badge. NOT gated by the
// panel password (the app doesn't have it); gated by the shared native app secret
// (same APP_NATIVE_SECRET the Pierre native path uses) proving this is the real app,
// then a server-side user_type='admin' check on the asserted email. No token / not
// admin → isAdmin:false, count 0 (always 200 so the app can call it unconditionally).
adminRoutes.post('/app-status', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const appToken = typeof body.appToken === 'string' ? body.appToken : '';

  const nativeOk = !!c.env.APP_NATIVE_SECRET && appToken.length > 0 && safeEqual(appToken, c.env.APP_NATIVE_SECRET);
  if (!nativeOk || !email) return c.json({ isAdmin: false, waitlistNew: 0 });

  const u = await c.env.DB.prepare('SELECT user_type FROM users WHERE email = ?').bind(email).first<{ user_type: string | null }>();
  if (u?.user_type !== 'admin') return c.json({ isAdmin: false, waitlistNew: 0 });

  const wl = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE status = 'new'").first<{ n: number }>();
  // Chats waiting on Ted: distinct conversations with an open escalation (needs_ted, not
  // yet handled). Counted per conversation, not per turn, so one chat is one badge unit.
  const gt = await c.env.DB
    .prepare("SELECT COUNT(DISTINCT conversation_id) AS n FROM pierre_chat WHERE needs_ted = 1 AND COALESCE(ted_status,'') <> 'handled'")
    .first<{ n: number }>();
  const getTedOpen = gt?.n ?? 0;
  // Outreach follow-ups due: sweep any lapsed soft-declines first, then count the open tasks
  // (stage 0/1 whose next_due_at has passed) so the app badge reflects work waiting on Ted.
  const nowTs = Date.now();
  await sweepOutreachSoftDecline(c.env, nowTs);
  const od = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM outreach
        WHERE next_due_at IS NOT NULL AND next_due_at <= ? AND follow_up_stage < 2
          AND status IN ('Sent', 'No Response')`,
    )
    .bind(nowTs)
    .first<{ n: number }>();
  const outreachDue = od?.n ?? 0;
  return c.json({ isAdmin: true, waitlistNew: wl?.n ?? 0, getTedOpen, outreachDue, adminUrl: 'https://admin.pangolinrc.com' });
});

// POST /admin/outreach — create ONE outreach-tracker row from the in-app admin skill
// (Pierre's Outreach draft). Distinct from the portal's password gate: this is called
// inside the app by an admin user, so it's authed like /app-status (native app secret +
// user_type='admin'), NOT USERS_ADMIN_PASSWORD. Mirrors scripts/outreach-seed.sql.
function slugify(s: string): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return base || 'contact-' + Math.random().toString(36).slice(2, 8);
}

adminRoutes.post('/outreach', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const appToken = typeof body.appToken === 'string' ? body.appToken : '';

  // Same gate as /app-status: prove it's the real app AND an admin account.
  const nativeOk = !!c.env.APP_NATIVE_SECRET && appToken.length > 0 && safeEqual(appToken, c.env.APP_NATIVE_SECRET);
  if (!nativeOk) return c.json({ error: 'unauthorized' }, 401);
  const u = email
    ? await c.env.DB.prepare('SELECT user_type FROM users WHERE email = ?').bind(email).first<{ user_type: string | null }>()
    : null;
  if (u?.user_type !== 'admin') return c.json({ error: 'unauthorized' }, 401);

  const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
  const name = str(body.name, 200).trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  const id = slugify(typeof body.id === 'string' && body.id.trim() ? body.id : name);
  const channel = (OUTREACH_CHANNELS as readonly string[]).includes(body.channel) ? body.channel : 'DM';
  const status = (OUTREACH_STATUSES as readonly string[]).includes(body.status) ? body.status : 'Drafted';
  const platform = (OUTREACH_PLATFORMS as readonly string[]).includes(body.platform) ? body.platform : str(body.platform, 40);
  const fc = Number(body.follower_count);
  const followers = Number.isFinite(fc) && fc >= 0 ? Math.trunc(fc) : null;
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Cadence init: if the contact is created already Sent, start the clock now — real send
  // time + the 1-week follow-up due. Created as Drafted → cadence stays dormant until a
  // later status change to Sent (handled in /outreach/update).
  const sentNow = status === 'Sent';
  const res = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO outreach
       (id, name, handle, platform, follower_count, channel, status, angle, date_contacted, contact_email, notes,
        initial_draft, initial_sent_at, next_due_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, name, str(body.handle, 120), platform, followers, channel, status,
      str(body.angle, 2000), today, str(body.contact_email, 200).trim().toLowerCase(),
      str(body.notes, 2000), str(body.initial_draft, 4000),
      sentNow ? now : null, sentNow ? now + WK1_MS : null, now,
    )
    .run();

  // INSERT OR IGNORE: no change means the slug already exists (dupe contact).
  return c.json({ ok: true, id, existed: !res.meta.changes });
});

// Shared in-app admin gate for the outreach endpoints: the same check as /app-status
// (native app secret + user_type='admin'), NOT the portal password. Returns true if OK.
async function appAdminOk(env: Env, email: string, appToken: string): Promise<boolean> {
  const nativeOk = !!env.APP_NATIVE_SECRET && appToken.length > 0 && safeEqual(appToken, env.APP_NATIVE_SECRET);
  if (!nativeOk || !email) return false;
  const u = await env.DB.prepare('SELECT user_type FROM users WHERE email = ?')
    .bind(email)
    .first<{ user_type: string | null }>();
  return u?.user_type === 'admin';
}

// POST /admin/outreach/followups — the in-app follow-up queue. Sweeps soft-declines first,
// then returns the DUE tasks (a 1-week or 1-month follow-up to send). stage 2 rows are not
// tasks (they auto-soft-decline via the sweep), so the queue is stage 0/1 only.
adminRoutes.post('/outreach/followups', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const appToken = typeof body.appToken === 'string' ? body.appToken : '';
  if (!(await appAdminOk(c.env, email, appToken))) return c.json({ error: 'unauthorized' }, 401);

  const now = Date.now();
  await sweepOutreachSoftDecline(c.env, now);
  const rs = await c.env.DB.prepare(
    `SELECT id, name, handle, platform, channel, angle, contact_email, follow_up_stage,
            initial_draft, one_week_draft, one_month_draft, initial_sent_at, wk1_sent_at, next_due_at
       FROM outreach
      WHERE next_due_at IS NOT NULL AND next_due_at <= ? AND follow_up_stage < 2
        AND status IN ('Sent', 'No Response')
      ORDER BY next_due_at ASC`,
  ).bind(now).all();
  const due = (rs.results || []).map((r: any) => ({
    id: r.id, name: r.name, handle: r.handle, platform: r.platform, channel: r.channel,
    angle: r.angle, contact_email: r.contact_email,
    stage: r.follow_up_stage | 0,                          // 0 → wk1 due, 1 → mo1 due
    kind: (r.follow_up_stage | 0) === 0 ? 'week' : 'month',
    initial_draft: r.initial_draft || '', one_week_draft: r.one_week_draft || '', one_month_draft: r.one_month_draft || '',
  }));
  return c.json({ ok: true, due });
});

// POST /admin/outreach/update — { id, status?, note?, draft? }. Status change may halt the
// cadence (clears next_due_at) or START it (Drafted→Sent inits stage 0). draft {stage,text}
// stores a generated draft into the right column. Used by Pierre status-report + draft-store.
adminRoutes.post('/outreach/update', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const appToken = typeof body.appToken === 'string' ? body.appToken : '';
  if (!(await appAdminOk(c.env, email, appToken))) return c.json({ error: 'unauthorized' }, 401);
  // Resolve the row by explicit id, or by a fuzzy query (name/@handle/email) when Ted
  // reports back via Pierre and only names the person.
  let id = typeof body.id === 'string' ? body.id : '';
  if (!id && typeof body.query === 'string' && body.query.trim()) {
    const q = body.query.trim().replace(/^@+/, '');
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const hit = await c.env.DB.prepare(
      'SELECT id FROM outreach WHERE name LIKE ? OR handle LIKE ? OR contact_email LIKE ? ORDER BY created_at DESC LIMIT 1',
    ).bind(like, like, like).first<{ id: string }>();
    if (hit) id = hit.id;
  }
  if (!id) return c.json({ error: 'id required' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT status, initial_sent_at, follow_up_stage FROM outreach WHERE id = ?',
  ).bind(id).first<{ status: string; initial_sent_at: number | null; follow_up_stage: number }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const now = Date.now();

  // Draft store: write the generated stage draft into the matching column.
  if (body.draft && typeof body.draft === 'object') {
    const stage = Number(body.draft.stage);
    const col = stage === 1 ? 'one_week_draft' : stage === 2 ? 'one_month_draft' : 'initial_draft';
    const text = typeof body.draft.text === 'string' ? body.draft.text.slice(0, 4000) : '';
    await c.env.DB.prepare(`UPDATE outreach SET ${col} = ? WHERE id = ?`).bind(text, id).run();
  }

  // Note: append (don't clobber) so the history builds up.
  if (typeof body.note === 'string' && body.note.trim()) {
    const note = body.note.trim().slice(0, 1000);
    await c.env.DB.prepare(
      "UPDATE outreach SET notes = CASE WHEN notes = '' THEN ? ELSE notes || char(10) || ? END WHERE id = ?",
    ).bind(note, note, id).run();
  }

  // Status: validate, then reconcile the cadence.
  if (typeof body.status === 'string' && (OUTREACH_STATUSES as readonly string[]).includes(body.status)) {
    const status = body.status;
    if (status === 'Sent' && row.initial_sent_at == null) {
      // First send → start the clock (stage 0, 1-week follow-up due).
      await c.env.DB.prepare(
        'UPDATE outreach SET status = ?, initial_sent_at = ?, next_due_at = ?, follow_up_stage = 0 WHERE id = ?',
      ).bind(status, now, now + WK1_MS, id).run();
    } else if (CADENCE_HALT.includes(status)) {
      // Reply/convert/decline halts the cadence.
      await c.env.DB.prepare('UPDATE outreach SET status = ?, next_due_at = NULL WHERE id = ?').bind(status, id).run();
    } else {
      await c.env.DB.prepare('UPDATE outreach SET status = ? WHERE id = ?').bind(status, id).run();
    }
  }
  return c.json({ ok: true, id });
});

// POST /admin/outreach/followup-sent — { id }. A follow-up was just sent; advance the stage
// and re-anchor the next due date off NOW (the actual send).
adminRoutes.post('/outreach/followup-sent', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const appToken = typeof body.appToken === 'string' ? body.appToken : '';
  if (!(await appAdminOk(c.env, email, appToken))) return c.json({ error: 'unauthorized' }, 401);
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return c.json({ error: 'id required' }, 400);
  await advanceOutreachStage(c.env, id, Date.now());
  return c.json({ ok: true, id });
});

// POST /admin/write/:resource — { id, key, value } → inline-edit one column of one
// row, for columns declared editable in the resource's `writes` map. table/column/
// idColumn are author-controlled registry literals; id + value are bound params and
// value must be one of the column's allowed options. Powers the waitlist Status/Group
// dropdowns (and any future editable column).
adminRoutes.post('/write/:resource', async (c) => {
  const denied = adminGate(c); if (denied) return denied;
  const r = RESOURCES[c.req.param('resource')];
  if (!r || !r.writes) return c.json({ error: 'resource is not writable' }, 404);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const key = typeof body.key === 'string' ? body.key : '';
  const w = r.writes[key];
  if (!w) return c.json({ error: 'field not writable', writable: Object.keys(r.writes) }, 400);
  const id = typeof body.id === 'string' ? body.id : '';
  const value = typeof body.value === 'string' ? body.value : '';
  if (!id) return c.json({ error: 'id required' }, 400);
  let bound: string | number = value;
  const kind = w.kind ?? 'enum';
  if (kind === 'int') {
    const n = Math.trunc(Number(value));
    if (value.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100000)
      return c.json({ error: 'must be a whole number of minutes (0–100000)' }, 400);
    bound = n;
  } else if (kind === 'bool') {
    bound = value === '1' || value === 'true' ? 1 : 0;   // checkbox → 0/1 into an INTEGER column
  } else if (kind === 'text') {
    bound = value.slice(0, 2000);                         // free text (e.g. a personal note)
  } else if (!w.options || !w.options.includes(value)) {
    return c.json({ error: 'invalid value', allowed: w.options ?? [] }, 400);
  }
  const res = await c.env.DB.prepare(`UPDATE ${w.table} SET ${w.column} = ? WHERE ${w.idColumn} = ?`).bind(bound, id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, id, key, value });
});

// POST /admin/delete/:resource — { id } → delete one row of a resource that declares a
// `del` spec (currently Marathons). table/idColumn/cascade targets are author-controlled
// registry literals; only the bound id comes from the request. Cascades run first (drop
// dependent rows, null out foreign references) then the row itself, all in one batch.
adminRoutes.post('/delete/:resource', async (c) => {
  const denied = adminGate(c); if (denied) return denied;
  const r = RESOURCES[c.req.param('resource')];
  if (!r || !r.del) return c.json({ error: 'resource is not deletable' }, 404);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return c.json({ error: 'id required' }, 400);

  const d = r.del;
  const stmts = [
    ...(d.cascadeNull ?? []).map((t) =>
      c.env.DB.prepare(`UPDATE ${t.table} SET ${t.column} = NULL WHERE ${t.column} = ?`).bind(id)),
    ...(d.cascadeDelete ?? []).map((t) =>
      c.env.DB.prepare(`DELETE FROM ${t.table} WHERE ${t.column} = ?`).bind(id)),
    c.env.DB.prepare(`DELETE FROM ${d.table} WHERE ${d.idColumn} = ?`).bind(id),
  ];
  const res = await c.env.DB.batch(stmts);
  const deleted = res[res.length - 1]?.meta?.changes ?? 0;
  if (!deleted) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, id, deleted });
});

// POST /admin/comments/hide — { id, hidden } → set a comment's moderation hide flag.
// The one WRITE action in the portal; password-gated like the rest of /admin/*.
adminRoutes.post('/comments/hide', async (c) => {
  const denied = adminGate(c); if (denied) return denied;
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const id = typeof body.id === 'string' ? body.id : '';
  const hidden = body.hidden ? 1 : 0;
  if (!id) return c.json({ error: 'id required' }, 400);
  const res = await c.env.DB.prepare('UPDATE watch_comment SET hidden = ? WHERE id = ?').bind(hidden, id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  // Hiding creates a record in the flagged-comment object (source='admin') so the
  // review trail shows an admin marked it, distinct from member reports.
  if (hidden) {
    await c.env.DB.prepare(
      "INSERT INTO comment_flag (comment_id, user_email, created_at, source) VALUES (?, 'admin', ?, 'admin') ON CONFLICT(comment_id, user_email) DO NOTHING"
    ).bind(id, Date.now()).run();
  }
  return c.json({ ok: true, id, hidden });
});

// POST /admin/ted-reply — { id, text } → Ted answers an escalation. Looks up the flagged
// pierre_chat turn, appends a role='ted' turn to that same conversation for the member to
// see (the app pulls it in on next open), and marks the escalation handled. Gated like
// the rest of /admin/*.
adminRoutes.post('/ted-reply', async (c) => {
  const denied = adminGate(c); if (denied) return denied;
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const id = typeof body.id === 'string' ? body.id : '';
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  if (!id || !text) return c.json({ error: 'id and text required' }, 400);
  const row = await c.env.DB
    .prepare('SELECT conversation_id, user_email FROM pierre_chat WHERE id = ?')
    .bind(id).first<{ conversation_id: string; user_email: string | null }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const seqRow = await c.env.DB
    .prepare('SELECT COALESCE(MAX(seq),0) AS m FROM pierre_chat WHERE conversation_id = ?')
    .bind(row.conversation_id).first<{ m: number }>();
  const seq = (seqRow?.m || 0) + 1;
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO pierre_chat (id, conversation_id, user_email, seq, role, content, grade, needs_ted, ted_status, created_at) VALUES (?, ?, ?, ?, 'ted', ?, '', 0, '', ?)",
    ).bind(crypto.randomUUID(), row.conversation_id, row.user_email, seq, text, now),
    // One reply closes the whole session: mark EVERY open escalation turn in it handled,
    // not just the one replied from (a session can carry more than one [GETTED] turn).
    c.env.DB.prepare("UPDATE pierre_chat SET ted_status = 'handled' WHERE conversation_id = ? AND needs_ted = 1").bind(row.conversation_id),
  ]);
  return c.json({ ok: true, id, delivered: !!row.user_email });
});
