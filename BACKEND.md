# BACKEND.md — Worker / D1 / deploy log

Append-only log. Any session that touches the Worker, D1, or deploy
configuration adds an entry here before the session ends (see CLAUDE.md,
"Backend and deploy rules").

Entry format:

## YYYY-MM-DD — short title
- What changed (Worker code, D1 schema/data, wrangler.toml, bindings, etc.)
- Deploy message used (if deployed)
- Anything the next session needs to know

---

## 2026-07-05 — Remote grows a nav set (D-pad / OK / home)
- `src/handlers/remote.ts`: CMDS expanded from the four transport commands to
  add `up, down, left, right, select, home`. No route changes, no schema
  changes — same POST /remote/cmd/:code validation, same KV queue.
- Client (Pages, same session): the wheel is now a full TV remote while a
  real device is selected — ring = D-pad (axis toggle ↕/↔ in the wheel's
  lower-left corner, persisted as pg_wheel_axis), SELECT tap = OK,
  long-press = home, HOME button lower-right; transport buttons at the
  cardinal points landed earlier today, play/pause mirrored into the Log
  face's START/LOG PARTIAL/CONTINUE.
- `bridge/firetv.mjs`: keycodes for the nav set (19/20/21/22/23/3); adb
  connect failures are now detected from output text (exit code lies) and
  never cached, keyevent errors reported + connection evicted for retry.
  `bridge/webos.mjs`: UP/DOWN/LEFT/RIGHT/ENTER/HOME button names added.
  **Bridge must be restarted** to pick up new keycodes.
- Deploys needed: Worker (`wrangler deploy`) for the new CMDS — old Worker
  409s the nav commands — plus a Pages deploy for the wheel.
- `npx tsc --noEmit` clean. Not deployed from this session; Ted deploys
  with a message per rules.

## 2026-07-04 — Pierre tasteBlock: films get recency + progress
- Bug: "recall did not pull up the current movie" — the data was fine
  (verified via `/profile/:email/titles`: all films present, titles join
  intact), but tasteBlock flattened every film to "(film, started|watched)".
  With six films sitting in `started`, Pierre couldn't tell tonight's watch
  from one parked weeks ago.
- `src/handlers/pierre.ts` tasteBlock: query now also selects
  `wt.updated_at` and summed `watch_episode.minute`; film lines render
  watched / "mid-watch, ~N min in" / started / on-the-list, and every line
  (shows too) gets a coarse recency suffix (today / yesterday / Nd / Nw).
  Block header tells Pierre a fresh started/mid-watch film is live NOW.
- Read-only queries on existing tables; no schema change, no new routes.
- `npx tsc --noEmit` clean. Not deployed from this session (no wrangler auth
  in sandbox) — Ted deploys with a message per rules.
- Same session, client side: `cube_pierre_face.html` journalContext() now
  drops pg_journal notes older than 45 days (needs a Pages deploy to go
  live; committed as 517f0f6 on `streamer-logo-grid`).

## 2026-07-03 — Pierre: TMDB tools + genre fluency
- `src/handlers/pierre.ts`: the chat handler is now an agentic loop (max 3
  tool round-trips). Three model-invoked tools, server-side only, no new
  public routes: `search_title` (TMDB /search/multi), `franchise_films`
  (movie → collection, release order), `where_to_watch` (watch-providers /
  JustWatch, US region: streaming/rent/buy). Tools ride the existing
  `TMDB_API_KEY` via `tmdbFetch` (now exported from handlers/tmdb.ts); when
  the key is unset the handler degrades to the old single-shot call.
- Persona additions: FETCHING lane (always look up availability/franchise
  order, never from memory; keep answers small; US-only caveat) and GENRE
  FLUENCY (sci-fi show depth, Trek-literate for the SNW test round; never
  bluff episode-level specifics).
- `npx tsc --noEmit` clean. Not deployed; deploy with a message per rules.
- **Real watch history added (same session):** chat body now carries the
  signed-in email (`pg_user`) from cube_pierre_face.html; handler validates it
  and reads up to 25 recent rows from the existing `watch` table (titles,
  kind, status, eps-in, S/E position — no comments/transcripts) via the bound
  DB, replacing the demo SEED_TASTE. Prompt block instructs: recommend from
  it, never recite it, never spoil past logged position. Anonymous or empty
  log falls back to SEED_TASTE. Read-only query on an existing table; no
  schema change, no new routes. Ted explicitly requested the history read.
- **Narrative signal + thin-log frankness (same session):** tasteBlock now
  also reads `reflection` (8 most recent) and `watch_comment` transcripts
  (10 most recent, >15 chars) — the user's own words, trimmed, with show
  names resolved from `watch`. Empty log → Pierre says plainly he's guessing
  and asks one taste question; <5 rows → one warm log-more nudge per
  conversation, never twice. Ted explicitly approved sending the user's own
  comment transcripts to the model (show audio/captions still never sent).
  All reads on existing tables, read-only.
- **Reflection mode (same session):** `/pierre/chat` accepts optional
  `mode:'reflection'` + `context:{show,ep}` — adds a system addendum for the
  end-of-episode moment (short replies, no spoilers past this episode, two
  back-and-forths max then steer to the Pierre face, offer-to-share protocol
  via a `[PANEL: Share]` tag the Log face consumes). No new routes; no D1
  writes from this path. Client side lives in cube_log_face.html (reflection
  overlay) + clickwheel.js (SELECT becomes the mic while the overlay is up).
- **BUG FIX (post-deploy):** tasteBlock originally read the old `watch`
  table — replaced big-bang by migration 0012 but still present (with stale
  rows) in the production DB, so Pierre recited last year's shows (Suits,
  Lost, Reggie Dinkins) and missed current ones (Silo, Hacks, The Agency).
  Now reads `watch_title` JOIN `titles` (position parsed from the
  current_episode_id resume pointer, eps-in counted from `watch_episode`),
  and resolves comment/reflection show names from titles. The stale `watch`
  table in prod is untouched — worth a manual DROP some day, Ted's call.
- **KNOWN GAP:** the Log face calls `/pierre/chat` without a Turnstile token.
  Harmless while TURNSTILE_SECRET_KEY is unset (gate fails open); the day
  Turnstile is enforced, the reflection chat 403s — either render a widget on
  the Log face or exempt reflection mode. Decide before enabling Turnstile.

## 2026-07-03 — Log created
- Created BACKEND.md and added "Backend and deploy rules" section to CLAUDE.md.
- No Worker, D1, or deploy-config changes this session.
