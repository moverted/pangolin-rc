# Handoff — 2026-08-05

Snapshot for picking work back up after a context clear. Delete/replace when stale.

## Current state

- **Branch `endnote-one-reply-flow`** — two new commits this session on top of the
  IRL Tickets stream:
  - `cddd952` IRL Tickets: typed reflections, focal v2, poster self-heal, old-ticket
    year confirmation (client + Worker; the backend was already deployed 2026-08-05,
    this commit just brings the tree into git).
  - `28e1b1c` WATCH: watch-aware next-drop badge + ranking, fresh-watch leaf, hide
    theater-ticket movies.
- **Worker: deployed** — Version `f2740671-ad10-49e3-9c17-603a9867c1a8`.
- **Web: deployed** — Pages `0bb0dc24`, live on `remote.pangolinrc.com`
  (verified `wow-scheduler.js` line 123 = "Next <Weekday>", `cube_watch_face`
  has `isTheaterMovie`/`wowNext`).
- **iOS bundle: re-synced** — `www/` mirrored + `cap copy ios`; `ios/App/App/public`
  verified identical to `public/`. **Archive + TestFlight distribute still pending
  in Xcode** (see below).
- Web and native run the same source; `public/` is canonical → `www/` → `ios/App/App/public`.

## WATCH-face changes (this session) — what to verify on the live app

Needs the real signed-in account (the demo `SEED` doesn't include these shows):

1. **CURRENT-tab order:** Strange New Worlds → Silo → Ted Lasso → Lanterns. A show you
   are caught up on (Ted Lasso, watched today's S04E01) drops to its next-drop slot
   instead of floating to the top.
2. **Day-badge** references the next *unwatched* episode: Ted Lasso reads "Next Wednesday"
   today, "Wednesday" tomorrow (≤6d); Lanterns "Next Sunday". (`nextUp`/`sortKey`/
   `inSeason` now take an `after` = last-watched ep.)
3. **Leaf** on the playhead lights from the LIVE/FRESH air-window (episode ≤48h old, via
   `WoW.phase`) — a first fresh watch shows it before the classifier has 2 samples. Fire
   still requires the binge burst (3rd episode).
4. **No theater-ticket movie tiles** in any WATCH tab (they live in IRL/Tickets); streamed
   / physical-media movies (no `ticketAt`) still appear. `isTheaterMovie()` gates it.

## iOS Archive + Distribute (pending — do in Xcode)

Per the bundle-freshness workflow (web-only changes reuse the stale bundle on a plain Run):
1. Delete the app from the simulator/device.
2. Product → **Clean Build Folder** (⇧⌘K).
3. **Product → Archive** (build number auto-stamps via the "Stamp build number" run phase).
4. Organizer → Distribute App → App Store Connect. On Distribute, **uncheck
   "Automatically manage version and build number"** so Xcode doesn't fight the stamp.
