# D1 ↔ Airtable two-way sync

D1 stays the **source of truth**. Airtable is a human-editable mirror so you can
view and fix data in a friendly grid (exactly what had to be done by hand when
"I Will Find You" got stuck in COMPLETED).

**Synced tables** (each maps 1:1 to an Airtable table of the same name, defined by
`TABLES` in `src/handlers/airtable.ts`):

| Table | Key | Notes |
|---|---|---|
| `watch` | `user_email\|show_id` | tracked shows + per-episode detail |
| `users` | `email` | **password salt/hash are never synced** — only email, username, phone, photo_url, selected_device, timestamps |
| `devices` | `id` | a member's devices |
| `follows` | `follower_email\|followee_email` | social graph |
| `waitlist` | `email` | signups past the member cap |

The RC-mechanical tables (`resources`, `submissions`, `uploads`, `upload_parts`,
`audit_entries`, `events`, `policies`) are intentionally **not** synced — they're
the content-free spine, and `audit_entries` is append-only. Add a row to `TABLES`
(and a table block to `scripts/airtable-setup.mjs`) if you ever want one.

## How it works

- **Outbound (D1 → Airtable).** Every mutation in `src/handlers/profile.ts`
  (watch upsert/delete, signup, waitlist, device add/edit/delete, device select,
  follow/unfollow) mirrors the row via `waitUntil` — a slow or failed Airtable
  call never blocks or breaks the app write. Code: `src/handlers/airtable.ts` →
  `pushRow` / `deleteRow`, called through the `mirror` / `unmirror` helpers.
- **Inbound (Airtable → D1).** A cron (`*/2 * * * *`, `src/index.ts` →
  `scheduled`) pulls human edits back. Each row carries a `sync_hash` of its
  fields; the poll recomputes it and **skips rows whose hash still matches** (our
  own echo). A mismatch = a human edited it in Airtable → written into D1 with a
  fresh `updated_at`, then re-pushed so the hash resyncs. No timestamp guessing,
  no echo loops.
- **Conflict rule.** Last write wins. The app writing a row and a human editing
  the same row between polls: whichever lands in its store later is what the next
  sync propagates.

Everything is **inert until `AIRTABLE_PAT` + `AIRTABLE_BASE_ID` are set** — the
cron returns immediately and the mirror is a no-op.

## One-time setup

1. **Create an Airtable base** (empty). Copy its base id from the URL
   (`airtable.com/appXXXXXXXXXXXXXX/…`) → that's `app...`.

2. **Create a Personal Access Token** (Airtable → Builder hub → Personal access
   tokens) with these scopes, granted on that base:
   - `schema.bases:write` (only needed to auto-create the table in step 3)
   - `data.records:read`
   - `data.records:write`

3. **Create the `watch` table** with the exact schema (one command):
   ```sh
   AIRTABLE_PAT=pat... AIRTABLE_BASE_ID=app... node scripts/airtable-setup.mjs
   ```
   (Or build it by hand: a table named `watch` with fields `key` [primary, single
   line text], `user_email`, `show_id`, `show_name`, `kind`, `status` [text];
   `watched`, `last_season`, `last_number`, `last_minute`, `started_at`,
   `updated_at` [number, precision 0]; `episodes` [long text]; `sync_hash` [text].)

4. **Give the Worker the credentials:**
   ```sh
   wrangler secret put AIRTABLE_PAT          # paste the pat...
   wrangler secret put AIRTABLE_BASE_ID      # paste the app...
   wrangler secret put SYNC_ADMIN_TOKEN      # any random string; gates the manual routes
   ```

5. **Deploy** the Worker so the cron + mirror go live:
   ```sh
   wrangler deploy
   ```

6. **Seed Airtable** with the existing D1 rows (one time):
   ```sh
   curl -X POST https://pangolin-rc.edward-m-willett.workers.dev/sync/push-all \
        -H "Authorization: Bearer <SYNC_ADMIN_TOKEN>"
   ```

## Manual controls (admin, bearer-gated by `SYNC_ADMIN_TOKEN`)

- `GET  /sync/status` — is Airtable configured? (open, no token)
- `POST /sync/push-all` — re-push every D1 watch row into Airtable.
- `POST /sync/pull` — run the inbound Airtable → D1 pull immediately.

## Notes & limits

- The inbound poll lists the whole `watch` table each run (fine at this scale — a
  10-member cap). If the table grows large, switch the poll to a
  `filterByFormula` on a `Last Modified` field to scan only recently-touched rows.
- Don't hand-edit `key` or `sync_hash` in Airtable. Editing `key` orphans the row;
  editing `sync_hash` just forces one redundant pull.
- New rows created **in Airtable** sync into D1 only if `user_email` matches an
  existing member (the `watch.user_email` foreign key); otherwise they're skipped.
