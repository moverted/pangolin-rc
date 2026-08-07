# Handoff — 2026-08-07

Snapshot for picking work back up after a context clear. Delete/replace when stale.

## Current state

- **Branch `endnote-one-reply-flow`** — pushed to origin (`ff97b0a`), tracking set.
  This session's commits, newest last:
  - `6fe9710` VIEWING LOG BP-demotion fix.
  - `b65d712` Tickets: `+ Stubs` badge + stub self-heal.
  - `ff97b0a` Reel-safe 9:16 share card + reflection notification → ticket.
- **Web: deployed** — Pages `956ae89c` (latest), live on `remote.pangolinrc.com`.
- **iOS: bundle synced + verified, NOT yet archived.** `public/ → www/ → cap copy ios`
  done and byte-verified; Xcode is open. Ted still owes the manual delete-app →
  Clean Build Folder (⇧⌘K) → Archive → Distribute (uncheck auto-manage version).
  One archive ships all three commits above.
- `BACKEND.md` current (three 2026-08-07 entries: the fixes/deploys + the D1 queue add).

## What shipped this session

1. **VIEWING LOG BP-demotion fix.** A repeat `finishEpisode` (double-tap / away-timer +
   manual confirm / autoFinish relaunch) re-ran the back-date branch, clamped `startedAt`
   to the finish logged seconds earlier, computed ~0 room, and demoted a real watch to
   `bp=1` — which the CURRENT-tab archive hides (`e.done && !e.bp`), so the watch + comment
   vanished. Fix: `finishEpisode` bails early if the episode already has a real non-BP
   finished session (`cube_log_face.html`); `renderEpisodeArchive` also shows any episode
   with a real non-BP session even if the `bp` flag was clobbered (`hasRealWatch`,
   `cube_watch_face.html`) — recovers already-broken rows with no migration.
2. **Tickets `+ Stubs` + self-heal.** IRL Tickets tab badge "THE STUBS" → "+ Stubs". A
   just-captured stub's row (and its healed poster) can lag the immediate read; the capture
   now passes the ticket id when swinging to Tickets, and `renderTickets` re-fetches up to
   5× (1s apart) until the stub lands with its poster — no manual out-and-back.
3. **Reel-safe 9:16 share card.** `buildTicketCard` now renders true 9:16 (1080×1920) so
   Reels/Stories fill edge-to-edge, no side crop; all copy sits in a reel title-safe box
   (left inset PAD=96, text column TW=724 clearing the right rail, bottom anchor B=1560
   above the caption zone). Video paths (native CardVideo + web `buildTicketVideo`, already
   9:16) now match. Post (4:5) center-crops the 9:16 by design — one shared asset, accepted.
4. **Reflection notification → ticket.** The nudge + local notification carry `ticketId`;
   tapping opens the Tickets tab and that stub's detail (comment/reflection composer) via
   `openTicketId`. A note without a ticket still falls back to LOG reflection. **Native-only
   — only testable from a fresh TestFlight build.**
5. **X-Files queue add.** Added the confirmed Aug-14 Hulu/Disney+ *Vrach Frankenshteyn*
   director's cut as a manual catalog title `manual:xfiles-vrach-frankenshteyn` (TMDB has
   no entry yet — Pierre's `search_title` correctly returned no match, not a worker bug) and
   swapped it into Ted's queue in place of the 2008 `tmdb:8836` row. Script:
   `scripts/xfiles-vrach-relabel.sql`.

## Open / deferred

- **X-Files manual title uses placeholders:** 2008 TMDB poster + runtime 104. Swap in the
  real key art (from the DET "Download Key Art" link) and the cut's runtime when known —
  update `titles.poster` / `episodes.runtime` for `manual:xfiles-vrach-frankenshteyn`.
- **Post (4:5) share** center-crops the 9:16 card (trims perf/tear on that surface only).
  Ted chose one shared asset; a dedicated 4:5 Post variant is the only fix if he changes
  his mind.
- **No PR opened** for `endnote-one-reply-flow` (pushed branch only).
- Carried over from before: `return_date` is still demo/SEED-only (wire from TMDB
  `/tv/{id}` → `titles.return_date`); `recordFromTitle` hardcodes `returnDate:null`.

## On-device testing checklist (next TestFlight build)

(1) Just-watched episode stays in the CURRENT VIEWING LOG (don't need Completed tab).
(2) Tickets tab badge reads "+ Stubs" (freshness check — old bundle shows "THE STUBS").
(3) Capture a theater ticket → Tickets tab: the stub fills in poster + date without an
    out-and-back. (4) Share a stub → Reel: fills 9:16, no side crop, copy inside safe box.
(5) Tap a reflection notification → opens straight to that ticket's detail with the composer.

## iOS bundle rebuild reminder

Web-only changes reuse the stale bundle on a plain Run. To ship native: mirror changed
`public/ → www/`, `npx cap copy ios`, verify markers landed / byte-match in
`ios/App/App/public`, then delete app → Clean Build Folder (⇧⌘K) → Archive → Distribute
(uncheck "Automatically manage version and build number"; build number auto-stamps).
This Capacitor setup uses SPM → open `ios/App/App.xcodeproj` (no `.xcworkspace`).
