# Handoff — 2026-08-18 (evening)

Snapshot for picking work back up after a context clear. Delete/replace when stale.

## Current state — everything shipped to web; iOS 1.0.1 bundle pending archive

- **Branch `endnote-one-reply-flow`**, pushed to origin. Big multi-feature session.
- **Web: all deployed + verified.** Latest Worker version this session `37d59967`.
  Remote D1 migrations through **`0042`** applied. Pages: app (`pangolin-rc` →
  remote.pangolinrc.com), admin (`pangolinrc-admin`), invest (`pangolinrc-invest` →
  invest.pangolinrc.com, live). NB: curl app faces with `-L` (the `_redirects` 308s
  `.html`); the custom domains edge-cache `.js`/`.html`, so verify via the fresh
  `*.pages.dev` deploy URL.
- **iOS: kept at 1.0.1** (do NOT bump). Bundle = mirror changed `public/ → www/`,
  `npx cap copy ios`, byte-verify `ios/App/App/public`, then in Xcode: delete app →
  Clean Build Folder (⇧⌘K) → Archive → Distribute (uncheck "Automatically manage
  version and build number"). If Distribute doesn't auto-pop, `open` the newest
  `.xcarchive` under `~/Library/Developer/Xcode/Archives/`.

## What shipped this session (all live on web)

1. **Co-viewing ("who's on your sofa") — full stack.** `coviewer` roster + default
   matrix (PROFILE face), per-title `watch_title_coviewer` (`GET`/`PUT /profile/:email/
   titles/:titleId/coviewers`, `use_default`), Pierre add-flow **chip set 3**, inline
   **"Watching with"** editors on WATCH + LOG, Pierre `tasteBlock` room context, admin
   **Co-viewing** tab. **Feed:** cards show ", with <first names>" (first-name only,
   friend-scoped); **PROFILE "Hide my coviewing from the feed"** opt-out toggle
   (`users.hide_coviewing`, migration 0042, `POST /profile/:email/hide-coviewing`).
2. **Runtime correction.** `runtime_report` + `POST /catalog/runtime-report` (2+ users
   agreeing auto-applies to global `episodes.runtime`); admin **Runtime reports** queue;
   LOG-face Pierre "real runtime?" prompt (only when TMDB `/runtime-check` didn't fix
   it); `episodes.runtime` admin-inline-editable (write path extended to `kind:'int'`).
3. **Pierre chat transcripts.** `pierre_chat` (one row/turn, grouped by conversation_id,
   saved every turn). Admin **Pierre chats** tab: grouped by session (Session+User as a
   **group-header** row, `groupHeaderCols`), wrapped message rows, inline **grade**.
4. **Pierre tweaks.** `temperature: 1.0` pinned; **brevity** VOICE rule; non-TV asks
   deflect **sheepishly**; **greeting uses device-local time** (`tod()`, was hardcoded
   "Evening"). Drop-reminder **de-dupe**: `/scheduler/state` returns already-notified
   drops so the "Notify me" nudge doesn't re-ask (was `sched_sent`, unread).
5. **Investor page** invest.pangolinrc.com (Pages `pangolinrc-invest`): deck-request form
   → `POST /waitlist/invest` → **Contact** admin list; cell phone (optional) on both the
   invest + join forms. Splash has an **Invest** button.
6. **Airtable DEPRECATED + removed** (commit `fa539af`, deployed): handler, all mirrors,
   inbound cron, `/sync` route, Env fields, and the 3 prod secrets all gone. Admin portal
   is the sole source of truth — do NOT add new mirrors.

## State / gotchas

- **Ted's roster is set in PROD** now: Anne (WIFE, linked aswillett@gmail.com, DEFAULT),
  Audrey Willett / Bryce Willett / Rose Reis (name-only). Audrey has a prod account
  (audrey.arya.willett@gmail.com) but Ted chose to keep her name-only.
- Pierre chat save-every-turn: verify on prod (local `.dev.vars` has no ANTHROPIC_API_KEY).
- Co-viewing feed default is **shown** (opt-out). Flip to opt-in = one-liner if wanted.
- Dev: Worker `wrangler dev --port 8787 --local`; faces `python3 -m http.server 8788
  --directory public`; admin expects the Worker on `:8788` (its localhost API_BASE).

## Parked / next

- WATCH-flow chip set 3 currently fires only on the "new to you" add path (not resumes).
- Older drop-reminder flags stored with an inconsistent episode-id format may re-ask once.
