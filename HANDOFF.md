# Handoff — 2026-08-06

Snapshot for picking work back up after a context clear. Delete/replace when stale.

## Current state

- **Branch `endnote-one-reply-flow`** (pushed). Session commit stack, newest last:
  - `cddd952` IRL Tickets: typed reflections, focal v2, poster self-heal, old-ticket
    year confirmation (client + Worker; backend was already live, commit just synced git).
  - `28e1b1c` WATCH: watch-aware next-drop badge + ranking, fresh-watch leaf, hide
    theater-ticket movies.
  - `21c7b3a` docs.
  - `35df8fa` WATCH: fresh-now override lights the FRESH text badge when catching the newest drop.
  - `941f8c5` Tabs: WATCH → 3 pill tabs on top (CURRENT/COMFORT/COMPLETED), retire
    RETURNING; Browse tabs bold + counts.
  - `07562de` Retire RETURNING bucket (backend); add return-month badge + Yellowjackets SEED.
- **Worker: deployed** — Version `5ab7c0e7` (latest). **Web: deployed** — Pages
  `f7b890c5`, live on `remote.pangolinrc.com`.
- **iOS: archived + distributed to TestFlight this session.** Bundle synced via
  `cap copy ios` and byte-verified against `public/` before archiving.
- Web and native run the same source; `public/` is canonical → `www/` → `ios/App/App/public`.
- `BACKEND.md` is current (entries dated 2026-08-05 and 2026-08-06).

## What shipped this session (WATCH + Browse)

1. **Watch-aware next drop.** `WoW.nextUp/sortKey/inSeason` take an optional `after`
   (last-watched ep) so a caught-up show references its NEXT unwatched drop for the
   day-badge and the CURRENT ranking. Day-badge reads "Next <Weekday>" at 7-13d.
2. **Leaf / fire.** Playhead leaf lights from the LIVE/FRESH air-window (ep ≤48h, via
   `WoW.phase`); fire needs the binge burst. **FRESH text badge** now honors the same
   fresh-now signal (`wowFreshNow`) so it doesn't read CASUAL after a fresh watch.
3. **Theater-ticket movies hidden** from WATCH (`isTheaterMovie` = movie + `ticketAt`);
   streamed/physical movies stay.
4. **Tabs restyled.** WATCH = 3 Browse-style pill tabs on TOP (CURRENT / 🍿 COMFORT /
   COMPLETED), bold, counts kept. **RETURNING retired** front + back: `recomputeTitle`
   (`profile.ts`) now returns `current` not `returning`, and a caught-up on-hiatus show
   folds into CURRENT with its return-countdown tile. Browse tabs bold; TICKETS + SHELF
   gained counts (`refreshIrlCounts`). Loaded 700 mono weight on both faces.
5. **Return-month badge.** `returnTag(s)`: caught-up show returning >30d out shows the
   month ("OCTOBER") or month+year ("MARCH 2027"); ≤30d falls through to the weekly tag.

## Open / deferred

- **`return_date` is demo/SEED-only.** Accounts hardcode `returnDate:null`
  (`recordFromTitle`), so Yellowjackets + its OCTOBER badge show only in demo mode
  (`?demo` / demo domain), NOT on a real device account. **Deferred follow-up:** wire it
  from TMDB `/tv/{id}` (`status:"Returning Series"` + `next_episode_to_air.air_date`)
  into a new `titles.return_date` column → `/titles` → `recordFromTitle`. We already have
  `TMDB_API_KEY` + `tmdbFetch('/tv/{id}')` (`src/handlers/tmdb.ts`), so it's a small
  migration + read; the `returnTag` badge lights up automatically once a real date flows.

## On-device testing checklist (TestFlight build)

Real account: (1) 3 pill tabs on top, no RETURNING, caught-up shows in CURRENT;
(2) Ted Lasso = Wednesday badge + FRESH badge + leaf (give the face a beat/tab-switch —
the mode badge settles after the classifier prefetch); (3) order SNW → Silo → Ted Lasso →
Lanterns; (4) no theater-ticket movie tiles; (5) Browse tabs bold with TICKETS/SHELF counts.
Yellowjackets/OCTOBER is demo-only — verify it via `?demo`, not the account.

## iOS bundle rebuild reminder

Web-only changes reuse the stale bundle on a plain Run. To ship native: mirror changed
files `public/ → www/`, `npx cap copy ios`, verify the marker landed in
`ios/App/App/public`, then delete app → Clean Build Folder (⇧⌘K) → Archive → Distribute
(uncheck "Automatically manage version and build number"). Build number auto-stamps.
