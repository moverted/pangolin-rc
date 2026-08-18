# Handoff — 2026-08-18

Snapshot for picking work back up after a context clear. Delete/replace when stale.

## Current state — 1.0.2 co-watching + Pierre batch SHIPPED

- **Branch `endnote-one-reply-flow`** — commit **`f51d7bc`** pushed to origin. (Prior
  this-session commit `0f75f0a` = coviewer backend + invest page; also pushed.)
- **Web: deployed + verified live.** Worker (version `bc9ae7ff`), remote migrations
  `0039`/`0040`/`0041`, app Pages (`pangolin-rc` → remote.pangolinrc.com), admin Pages
  (`pangolinrc-admin` → admin.pangolinrc.com). All 200; new D1 tables confirmed in prod.
  NB curl the app faces with `-L` (the `_redirects` 308s `.html`).
- **iOS: bundled + distributed at 1.0.1.** `public/ → www/` mirrored, `cap copy ios`,
  byte-verified in `ios/App/App/public`. Ted archived (build `202608180925`) and
  distributed to TestFlight. Version deliberately kept **1.0.1** (not bumped).

## What shipped this session

1. **Co-viewing ("who's on your sofa") — full stack.** Roster + default matrix on the
   PROFILE face (`coviewer` table, is_default = default room). Per-title co-viewers
   (`watch_title_coviewer`) via `GET`/`PUT /profile/:email/titles/:titleId/coviewers`
   (`use_default` shortcut). Pierre add-flow **chip set 3** (With <room> / Just me /
   Someone else → roster toggle picker) in `cube_pierre_face.html` `resolveShow()`.
   Inline **"Watching with" editors** on WATCH + LOG faces. Pierre `tasteBlock` weaves
   ", with <names>" per title + a roster/[default room] block. Admin **Co-viewing** tab.
2. **Runtime correction.** `runtime_report` + `POST /catalog/runtime-report`: 2+ distinct
   users agreeing on the same observed runtime auto-applies to global `episodes.runtime`;
   all reports queue in the admin **Runtime reports** tab. LOG-face Pierre prompt fires
   only when the existing `/catalog/runtime-check` (TMDB) did NOT auto-correct. Episode
   runtime is now **admin-inline-editable** (admin write path extended to free ints,
   `kind:'int'`).
3. **Pierre chat transcripts.** `pierre_chat` table (one row per turn, grouped by
   `conversation_id` = whole session, saved every turn via `persistChatTurns` in
   `/pierre/chat`). Frontend sends `PIERRE_CONVO`. Admin **Pierre chats** tab with inline
   **grade** (great/good/poor/bad). Reflection-mode turns are excluded.
4. **Pierre persona:** non-TV asks now deflect **sheepishly**. Chat call has exactly 5
   params (model, max_tokens, system, messages, tools) — no temperature.
5. **Airtable:** deprecated — mirroring fully removed in code (see the 2026-08-18
   deprecation entry in BACKEND.md); admin portal is the sole source of truth.

## Verify on device (couldn't prove locally)

- Add a show through Pierre → the **"Who's watching <show> with you?"** chip appears
  (needs a roster; Ted's is seeded LOCAL only — set one up in prod PROFILE to test).
- Have a Pierre chat → the **Pierre chats** admin tab fills in. Prod has ANTHROPIC_API_KEY
  so this is the real save-every-turn test (local `.dev.vars` had no key).

## Parked / next

- **Airtable deprecation — DONE in code (2026-08-18), deploy pending.** Ripped out
  `airtable.ts`, all mirror call sites, the inbound cron + `/sync` route, Env fields,
  and the 3 prod secrets (already deleted). type-check clean. Needs `wrangler deploy`
  to fully retire the cron on the live Worker.
- **Pierre `temperature`** — add as a 6th chat param if wanted (currently API default).
- Ted's roster (Anne/Audrey/Bryce/Rose) is seeded in LOCAL D1 only (`scripts/seed-coviewers.sql`),
  not prod.

## iOS bundle reminder

Web-only changes reuse the stale bundle on a plain Run. To ship native: mirror changed
`public/ → www/`, `npx cap copy ios`, byte-verify `ios/App/App/public`, then delete app →
Clean Build Folder (⇧⌘K) → Archive → Distribute (uncheck "Automatically manage version and
build number"; build number auto-stamps). SPM setup → open `ios/App/App.xcodeproj`. If the
Distribute dialog doesn't auto-pop after Archive, `open` the newest `.xcarchive` under
`~/Library/Developer/Xcode/Archives/` to bring up the Organizer.
