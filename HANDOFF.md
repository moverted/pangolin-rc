# Handoff — 2026-08-17

Snapshot for picking work back up after a context clear. Delete/replace when stale.

## Current state (1.0.1 space — buttoned up)

- **Branch `endnote-one-reply-flow`** — pushed to origin. This session's commit:
  - `d54dd25` Wheel: armed LOG playhead wins over stale selectMode + discoverable disengage.
- **Web: deployed + verified live** on `remote.pangolinrc.com` (Pages, latest upload
  confirmed "0 new files" on re-deploy → web == `public/`). New `clickwheel.js` +
  `index.html` serving in prod.
- **iOS: bundled, in TestFlight, submitted.** `public/ → www/ → cap copy ios` done and
  byte-verified; Ted archived + distributed. Build **1.0.1 (202608170718)** is in App
  Store Connect, "What to Test" filled (cohort welcome copy), submitted for beta review.
  Attached to external group **Founder's Circle** (SNW Cohort also exists).
- **Uncommitted WIP in the tree (NOT mine, leave alone):** `public/cube_log_face.html`
  (~51 lines) + `src/types.ts` (1 line) are pre-existing `endnote-one-reply-flow` WIP,
  unrelated to the scrubber fix. Did not commit them.

## What shipped this session

1. **Scrubber ↔ click-wheel bug fix (the `>-<` / ▶-◀ playhead).** On the LOG face the
   armed playhead wasn't getting the ring: the pointermove ladder in `clickwheel.js` hit
   the `selectMode` rung *before* `logTuneActive()`, so a lingering SELECT-highlight
   stepped the highlight instead of tuning the minute. **Fix:** moved the `logTuneActive()`
   branch above `selectMode` — an armed playhead now owns the ring even with a stale
   highlight up. (LOG face = `cube_log_face.html`, `FACE_INDEX.episodes`; the bridge is
   `window.__logTune.{active,step}` read across the iframe by the wheel.)
2. **Discoverable selectMode disengage.** Chosen direction: **long-hold SELECT** (the
   exit already existed at `exitSelect`), made discoverable with a new `#select-hint`
   ("Hold SELECT to disengage") that sits between the wheel and the cube while the
   highlight is up. Every `selectMode` write now routes through `setSelectMode(on)` in
   `clickwheel.js`, which toggles the hint's `.show`. Hint markup + CSS in `index.html`.

## Founder's Circle cohort — live now

- Build 1.0.1 out to Founder's Circle. Cohort welcome / "What to Test" copy = plain ASCII
  ONLY (App Store Connect rejects emoji/special chars — a 🎉 blocked the submit).
- Onboarding steps testers get: PROFILE face → set password (no requirements) → follow
  edward.m.willett@gmail.com by email → WATCH → pick a show → call/text Ted 310-922-1109.
- **Versioning discipline:** stay on **1.0.1** builds for bug fixes to the live cohort
  (build number auto-stamps; subsequent beta builds usually clear review fast). Bump to
  **1.0.2** for the next feature batch. NB: a version bump does NOT trigger full App Store
  review — that's only at public release; TestFlight always runs beta review.

## Next up — 1.0.2 (parked in BACKLOG.md, do NOT start before the intended clear/explore)

Two new entries added to `BACKLOG.md` this session — both surfaced from Pierre going live:

1. **Group / co-watching ("who's in the room")** — the big 1.0.2 theme. "What am I
   watching right now?" is loaded because co-viewers may have no account (Rose: none ever;
   Anne/Audrey: accounts but cohort-onboarding friction; Bryce: never logged in). Needs a
   room-roster concept (accountless name-only members, promotable later) + Pierre context.
2. **Comment KIND `pierre_chat` (full thread, gradeable)** — Pierre chats currently log as
   `KIND: episode` (e.g. the CREATED 2026-08-17 16:43 row). Give them their own kind and
   store the whole back-and-forth so Ted can grade/trail Pierre from admin. Anchors:
   `migrations/0015_watch_comment.sql`, `src/handlers/pierre.ts`, `admin/index.html`
   (`PILL_COLS`).

## iOS bundle rebuild reminder

Web-only changes reuse the stale bundle on a plain Run. To ship native: mirror changed
`public/ → www/`, `npx cap copy ios`, verify markers landed / byte-match in
`ios/App/App/public`, then delete app → Clean Build Folder (⇧⌘K) → Archive → Distribute
(uncheck "Automatically manage version and build number"; build number auto-stamps).
This Capacitor setup uses SPM → open `ios/App/App.xcodeproj` (no `.xcworkspace`).
