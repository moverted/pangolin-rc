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
type Filter = { key: string; label: string; expr: string; options?: string[] };
type Pivot = { label: string; columns: { key: string; label: string }[]; sql: (from: string, where: string) => string };
// An inline-editable column: the frontend renders a <select> of `options`, and
// POST /admin/write/:resource runs `UPDATE table SET column = ? WHERE idColumn = ?`.
// table/column/idColumn are author-controlled literals (never request input); only
// the bound id + value come from the request, and value is validated against options.
// `enum` writes (default) validate value ∈ options → a dropdown. `int` writes take a
// free whole number (e.g. episode runtime) → a number input, no options.
type Write = { table: string; column: string; idColumn: string; kind?: 'enum' | 'int'; options?: readonly string[] };

interface Resource {
  label: string;
  group: 'core' | 'secondary';
  from: string;               // FROM + JOINs, no SELECT/WHERE
  idExpr?: string;            // stable row id (selected as _id) for row-level write actions
  cols: Col[];                // SELECT list + column metadata for the frontend
  searchExprs: string[];      // OR-LIKE'd against `q`
  filters?: Filter[];         // exact-match dropdown filters
  sortDefault: string;        // a col key
  defaultOrder?: string;      // author-controlled ORDER BY expr used when the default sort is active
                              // (e.g. group rows by conversation, then turn order). Overrides sortDefault's single-col sort.
  groupBy?: string;           // col key the frontend visually groups on (divider when the value changes)
  groupHeaderCols?: string[]; // col keys shown once in a group-header row (and dropped from the per-row columns)
  pivots?: Record<string, Pivot>;
  writes?: Record<string, Write>; // col key → inline-edit spec
  note?: string;              // shown in the UI (caveats, read-only, etc.)
}

// Hand-managed waitlist vocab, shared by the columns, filters, and write validation
// so they can never drift. Empty test_group renders as 'Unassigned' (which is also a
// selectable value that stores the literal string).
const WAITLIST_STATUSES = ['new', 'invited', 'active', 'declined'] as const;
const WAITLIST_GROUPS = ['Unassigned', 'Friends & Family Cohort 1', 'Internal', 'SNW Cohort', "Founder's Circle"] as const;
const GROUP_EXPR = "COALESCE(NULLIF(waitlist.test_group,''),'Unassigned')";
const LIST_TYPE_EXPR = "COALESCE(NULLIF(waitlist.list_type,''),'waitlist')";

// Millisecond epoch → local-ish date bucket. All created_at/updated_at are ms.
const monthOf = (col: string) => `strftime('%Y-%m', ${col}/1000, 'unixepoch')`;
const weekOf  = (col: string) => `strftime('%Y-W%W', ${col}/1000, 'unixepoch')`;

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

// Serialized "All comments" feeder: one row per episode that has visible comments,
// with every comment concatenated in order — "mm:ss text" for timed comments, "SPLR
// text" for spoilers (matching the LOG/feed rendering). Hidden comments are excluded.
// The inner ORDER BY runs before GROUP_CONCAT so the lines come out in play order.
const EPISODE_COMMENTS_FROM = `(
  SELECT wc.show_id AS show_id, wc.episode_id AS episode_id,
         COUNT(*) AS comments, MAX(wc.created_at) AS last_at,
         (SELECT GROUP_CONCAT(line, char(10)) FROM (
            SELECT CASE
                     WHEN w2.is_reflection = 1 OR w2.is_endnote = 1
                       THEN CASE WHEN w2.spoiler = 1 THEN 'SPLR ' ELSE 'NOSP ' END
                     ELSE printf('%02d:%02d ', w2.timestamp_ms/3600000, (w2.timestamp_ms/60000)%60)
                   END || COALESCE(w2.transcription, '') AS line
              FROM watch_comment w2
             WHERE w2.show_id = wc.show_id AND w2.episode_id = wc.episode_id
               AND COALESCE(w2.hidden, 0) = 0 AND COALESCE(w2.transcription, '') <> ''
             ORDER BY (CASE WHEN w2.is_reflection = 1 OR w2.is_endnote = 1 THEN 1 ELSE 0 END) ASC,
                      w2.timestamp_ms ASC, w2.created_at ASC
         )) AS all_comments
    FROM watch_comment wc
   WHERE COALESCE(wc.hidden, 0) = 0 AND COALESCE(wc.transcription, '') <> ''
   GROUP BY wc.show_id, wc.episode_id
) AS ec LEFT JOIN titles ON titles.title_id = ec.show_id`;

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
    cols: [
      { key: 'email',      label: 'Email',    expr: 'users.email' },
      { key: 'username',   label: 'Username', expr: 'users.username' },
      { key: 'phone',      label: 'Phone',    expr: 'users.phone' },
      { key: 'timezone',   label: 'Timezone', expr: 'users.timezone' },
      { key: 'devices',    label: 'Devices',  expr: '(SELECT COUNT(*) FROM devices d WHERE d.user_email = users.email)' },
      { key: 'follows',    label: 'Connections', expr: '(SELECT COUNT(*) FROM follows f WHERE f.follower_email = users.email OR f.followee_email = users.email)' },
      { key: 'created_at', label: 'Joined',   expr: 'users.created_at' },
    ],
    searchExprs: ['users.email', 'users.username'],
    sortDefault: 'created_at',
    pivots: {
      signup_month: countPivot('Signups by month', monthOf('users.created_at'), 'Month'),
      signup_week:  countPivot('Signups by week',  weekOf('users.created_at'),  'Week'),
      timezone:     countPivot('By timezone', "COALESCE(NULLIF(users.timezone,''),'—')", 'Timezone'),
      has_devices:  countPivot('Has devices?', "CASE WHEN (SELECT COUNT(*) FROM devices d WHERE d.user_email=users.email)>0 THEN 'has ≥1 device' ELSE 'no devices' END", 'Bucket'),
      has_connections: countPivot('Has connections?', "CASE WHEN (SELECT COUNT(*) FROM follows f WHERE f.follower_email=users.email OR f.followee_email=users.email)>0 THEN 'connected' ELSE 'none' END", 'Bucket'),
    },
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
    cols: [
      { key: 'show_name',    label: 'Show',         expr: 'COALESCE(titles.name, ec.show_id)' },
      { key: 'episode_id',   label: 'Episode',      expr: 'ec.episode_id' },
      { key: 'comments',     label: '#',            expr: 'ec.comments' },
      { key: 'all_comments', label: 'All comments', expr: 'ec.all_comments' },
      { key: 'last_at',      label: 'Last',         expr: 'ec.last_at' },
    ],
    searchExprs: ['titles.name', 'ec.episode_id', 'ec.all_comments'],
    sortDefault: 'last_at',
    note: 'Serialized feeder: every episode with visible comments, all of them concatenated in play order — "mm:ss text" for timed comments, "SPLR text" for spoilers. Hidden comments are excluded. Read-only.',
  },

  waitlist: {
    label: 'Contact',
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
      { key: 'seq',             label: '#',       expr: 'pc.seq' },
      { key: 'role',            label: 'Who',     expr: 'pc.role' },
      { key: 'content',         label: 'Message', expr: 'pc.content' },
      { key: 'needs_reply',     label: 'Ted?',    expr: "CASE WHEN pc.needs_ted=1 AND COALESCE(pc.ted_status,'')<>'handled' THEN 1 ELSE 0 END" },
      { key: 'grade',           label: 'Grade',   expr: "COALESCE(NULLIF(pc.grade,''),'ungraded')" },
      { key: 'created_at',      label: 'When',    expr: 'pc.created_at' },
    ],
    searchExprs: ['pc.user_email', 'pc.content', 'pc.conversation_id'],
    filters: [
      { key: 'role',  label: 'Who',   expr: 'pc.role', options: ['user', 'pierre'] },
      { key: 'grade', label: 'Grade', expr: "COALESCE(NULLIF(pc.grade,''),'ungraded')", options: ['ungraded', 'great', 'good', 'poor', 'bad'] },
    ],
    sortDefault: 'created_at',
    // Group by conversation: newest session first (by its first turn), turns in order.
    defaultOrder: '(SELECT MIN(p2.created_at) FROM pierre_chat p2 WHERE p2.conversation_id = pc.conversation_id) DESC, pc.conversation_id ASC, pc.seq ASC',
    groupBy: 'conversation_id',
    groupHeaderCols: ['conversation_id', 'user_email'],   // Session + User → group header, not per-row columns
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
  // Nav badges: unattended-work counters. Waitlist shows how many rows are still
  // status='new' (untriaged signups). Cheap enough to compute on each meta load.
  const badges: Record<string, number> = {};
  const wlNew = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE status = 'new'").first<{ n: number }>();
  if (wlNew?.n) badges.waitlist = wlNew.n;

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
    filters: (r.filters ?? []).map((f) => ({ key: f.key, label: f.label, options: f.options ?? null })),
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
    if (v != null && v !== '') { parts.push(`${f.expr} = ?`); binds.push(v); }
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

  return c.json({
    ok: true,
    total: countRes?.n ?? 0,
    limit, offset,
    sort: sortCol.key, dir: dir.toLowerCase(),
    rows: rowsRes.results ?? [],
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
  return c.json({ isAdmin: true, waitlistNew: wl?.n ?? 0, getTedOpen, adminUrl: 'https://admin.pangolinrc.com' });
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
  if ((w.kind ?? 'enum') === 'int') {
    const n = Math.trunc(Number(value));
    if (value.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100000)
      return c.json({ error: 'must be a whole number of minutes (0–100000)' }, 400);
    bound = n;
  } else if (!w.options || !w.options.includes(value)) {
    return c.json({ error: 'invalid value', allowed: w.options ?? [] }, 400);
  }
  const res = await c.env.DB.prepare(`UPDATE ${w.table} SET ${w.column} = ? WHERE ${w.idColumn} = ?`).bind(bound, id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, id, key, value });
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
