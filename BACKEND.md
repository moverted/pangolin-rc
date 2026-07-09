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

## 2026-07-08 — DELETE `/transcribe/:id` (delete own audio comment)
- **Worker code change (`src/index.ts`), NOT yet deployed.** New
  `app.delete('/transcribe/:id')`: body `{email}`, own-comments-only
  (user_email must match). Drops the `watch_comment` row + its R2 audio, and
  cascades to any replies threaded under it (`reply_to = id`) incl. their R2
  audio. `DELETE` already in the CORS `allowMethods` list — no CORS change.
- Frontend (`public/cube_log_face.html`, LOG face Comments panel): the old
  single ✎ pencil is now a 3-icon toolbar — pencil toggle opens cancel / edit
  (one-time transcription fix, disabled once spent) / delete. Delete confirms,
  calls the new route, optimistically drops the row from `transcripts`.
- **Frontend deployed to PREVIEW ONLY** (`streamer-logo-grid.pangolin-rc.pages.dev`,
  deployment `c9a3f1fd`) — includes the toolbar + the inline-audio play fix
  (primeAudio one-shot + playClip retry instead of `window.open` blank-tab
  fallback). NOT prod.
- **Worker DEPLOYED to prod** (Version `82cdc216-4dee-43de-a96e-30fa3f11bbad`).
  Deploy message: "Add DELETE /transcribe/:id — delete own audio comment (row +
  R2 audio + threaded replies), own-comments-only". `DELETE /transcribe/:id` is
  now live; the preview frontend's delete button is fully functional.
  (Uses the same `env.DB` + `watch_comment` table the existing comment
  INSERT/PATCH/GET routes already use — the live comments DB, not the legacy one.)
- **Frontend DEPLOYED to PROD** (`remote.pangolinrc.com`, Pages `--branch main`,
  deployment `a7b25aba`). Pre-deploy check: live prod was `a5ddbb5b` / source
  `e7ee6e0`, which == current git HEAD, so this added the uncommitted polish on
  top with nothing to clobber. Toolbar + inline-audio fix now live on prod.

## 2026-07-08 — Pierre context switcher ([SWITCH]/[ASK] tags)
- **Worker change** (`src/handlers/pierre.ts`): appended a "SWITCHING WHERE THEY
  ARE" block to the `PIERRE` persona so Pierre can emit `[SWITCH: add|account|device|chat]`
  (move the user into a lane) or `[ASK: a | b | c]` (unsure → offer lanes as taps),
  mirroring the existing `[ROUTE:]` tag convention. No new endpoint/persona.
  Deployed: Version `5d18f9a9-df5c-46d5-8ac6-7b86ec0e1410`.
- **Frontend** (`public/cube_pierre_face.html`): a context-switcher pill above the
  composer (tap → switch lane or Clear chat), `parseSwitch`/`parseAsk` wired into
  `addPierre`, `switchTo`/`clearChat`/`setCtxIndicator`. Flows no longer wipe
  `history`/log on entry (only Clear chat does); each `enter*Flow` sets the pill.
  Fixed a latent leak: `submit()` echoed typed passwords as plaintext bubbles —
  now masked (`••••••`) during `.secret` steps.
- NOTE: the Worker + prod frontend must move together — the persona now emits
  `[SWITCH]` tags that only the new frontend parses (old frontend would show them
  as raw text). Both deployed same session.

## ⚡ START HERE — current state (as of 2026-07-08, next session read this first)
- **Prod (`remote.pangolinrc.com`) live build = deployment `dae4b439`** (Pierre
  context switcher — see the 2026-07-08 entry just above; Worker Version
  `5d18f9a9`). Prior: `7dd8abae` — Pierre
  face: new voice mic in the composer (records ~10s, REC indicator + 10-segment
  ring matching the LOG/reflection mics, POSTs to `/transcribe` with `pg_user`
  email + episodeId `pierre-note`, drops the text into the box). Composer `<input>`
  is now an auto-growing `<textarea>`; the join/login password steps that used
  `input.type='password'` now toggle a `.secret` class (`-webkit-text-security:disc`)
  via `inputSecret()`. Enter sends, Shift+Enter = newline. Prior: `ea674624` — comment
  pencil toggle floats to the right end of the text (`display:contents` wrap +
  `float:right`); the cancel/edit/delete bar drops full-width below on open.
  Prior: `2e86ae21` — the
  transcription edit now opens a branded multi-line `<textarea>` dialog
  (`txEditDialog`) showing the full text, replacing native `prompt()` which
  truncated to one line. Prior: `e6e4243f` — comment
  cancel/edit/delete now share one full-width row (flex:1 each) instead of the
  fixed-104px buttons that wrapped to two lines. Prior: `0215a106` — LOG
  in-show mic now also shows a blinking "REC" (no seconds; ring is the countdown),
  matching the wheel-centre reflection; comment cancel/edit/delete buttons are 4×
  wider (104px, wrap-enabled) so they're hard to mistap. Prior: `fd3394a9`
  (wheel-centre reflection blinking REC, no seconds), `1bd638f2` = git
  `e7ee6e0` (`streamer-logo-grid` HEAD) + uncommitted polish. Deployed via Pages
  `--branch main`. Polish now on prod: comment 3-icon toolbar + delete, inline-
  audio play fix, SVG pause icon + circular playback progress ring, and the
  recording countdown restyle (red "● REC" + seconds + segmented ring, one arc
  per second). Two rec contexts: LOG-face in-show mic = 7 segments; wheel-centre
  end-of-show reflection (comfort face → shell `__comfortMicCount`) = 10 segments.
  Fixed a CSS-specificity bug where `.mic-center svg{width:28px}` shrank the ring
  to the corner (now scoped `.mic-center .rec-ring`).
  Prior prod deploys: `97e41ec7` → `4706b169` → `a7b25aba` → `a5ddbb5b` → `b3262a7b`.
- **Pages prod is deployed straight from branches, NOT from git `main`.** Before
  ANY `wrangler pages deploy ... --branch main`, run `wrangler pages deployment
  list --project-name pangolin-rc` and check the live Source commit — do not
  assume prod == `main`. (Assuming that once wiped the weekend build; see the
  REGRESSION+RECOVERY note below. Also memory `pages-prod-deploy-drift`.)
- **`main` = `71acd7e`** (clean, pre-comfort). Comfort lives on the
  `streamer-logo-grid` line + `comfort-on-weekend`, never on `main`.
- **Working tree** = `streamer-logo-grid` + uncommitted weekend WIP + comfort
  edits (all intentionally uncommitted). Don't commit it without asking.
- Next up: bug fixes + branch pruning.

## 2026-07-07 — Front-door deep-link `?open=comfort-psycho` (PREVIEW ONLY, no prod)
- **Frontend only. NO Worker / D1 / binding / wrangler.toml changes.** Logged
  here because it's a Pages deploy (preview alias `streamer-logo-grid`, NOT prod).
- `public/cube_shell.js`: a `frontDoor()` IIFE reads `?open` on boot. For
  `comfort-psycho` it waits ~1s (the normal cube reveal), then
  `cubeRotateTo('log', { openMarathon:'psycho' })` — the shell's focus+open path
  (rotate/lock the WATCH face, then hand it the intent over the standard
  `cube:payload` channel). It gates on the WATCH frame being `complete` (else
  waits for its `load`) so the intent never posts into the void. Any other value
  / no param → returns immediately, boot byte-for-byte unchanged.
- `public/cube_watch_face.html`: its existing `cube:payload` (face `log`) handler
  gains `if(p.openMarathon){ switchTab('comfort'); openMarathon(MARATHONS[id]) }`
  — shell→face intent, not a face-to-face call. Marathon's own back button
  returns cleanly to the COMFORT tab.
- WATCH face = `FACE_INDEX.log` (index 1) per the label swap; marathon id `psycho`.
- Add-to-Home-Screen: no web-app manifest / `start_url` exists, so iOS captures
  the current URL incl. `?open=comfort-psycho` — the query is preserved, no code
  needed. Verify on device.
- Deploy message: "Front-door deep-link ?open=comfort-psycho (preview)".
- Branch: `streamer-logo-grid`. **Do NOT merge to main / promote to prod** (per task).

## 2026-07-07 — Comfort tab: curated marathons (SHIPPED TO PRODUCTION)
- **Frontend only. NO Worker / D1 / binding / wrangler.toml changes.** Logged
  here because it's a Pages production deploy.
- New face `public/cube_watch_comfort_face.html` (Ted-supplied, unmodified):
  self-contained square, localStorage-only, TVMaze show 517 live fetch with a
  baked fallback. Tressany's PSYCH-O Marathon (12 eps), finish→next flow, 10s
  post-watch reflection, positional rank of the 12.
- `public/cube_watch_face.html`: COMFORT tab gains a 🍿 and now renders a
  data-driven marathon LIST (`MARATHONS[]`, one real entry, PRE-BETA banner)
  instead of "under construction"; tapping a marathon opens it as an in-face
  overlay iframe (`#marov`) with a back-to-list button. RETURNING tab still
  under construction. No cube face added (would be a 7th side / shell change).
- `public/clickwheel.js`: one selector (`.mrow`) added to the WATCH SELECT
  group so the wheel can highlight/open a marathon from the list.
- **Built off `main`, NOT this branch.** Because `streamer-logo-grid` carried
  ~200 lines of unrelated uncommitted WIP, the comfort work was re-applied in a
  clean git worktree checked out at `origin/main` (71acd7e) and committed as
  `b264491` on branch `comfort-tab`. Diff = exactly the 3 files above
  (new file + 81/−3 in the watch face + 1 in clickwheel), zero other faces.
- git: `comfort-tab` pushed; **`origin/main` fast-forwarded 71acd7e → b264491**
  (local `main` matches). Production Pages now reproducible from `main`.
- Earlier this session a `--branch comfort-tab` PREVIEW was also deployed
  (alias https://comfort-tab.pangolin-rc.pages.dev) for review; superseded by
  the production deploy below.
- **Production deploy:** `wrangler pages deploy public --project-name
  pangolin-rc --branch main`, message "Comfort tab: curated-marathon list in
  WATCH + Tressany's PSYCH-O Marathon face (first comfort build, pre-beta)".
  Live at https://remote.pangolinrc.com (hard-refresh if cached).
- **FOLLOW-UP — scroll fix (same day, deployed to prod, Ted confirmed):** the
  comfort face was built for a full-height phone viewport (`aspect-ratio:1/1`,
  `max-height:100vh`, pinned hero), but the shell mounts faces in a short square
  top-stage where the pinned now-watching hero + footer exceed the height and
  squeeze the checklist to zero — it couldn't scroll. Fix = embedded-only wrapper
  adaptation in `cube_watch_comfort_face.html` (`if(window.parent!==window)`):
  the whole face scrolls as one column and the reflection overlay pins to the
  viewport. Standalone layout untouched; no logic/state/copy change. Commit
  `733e6a3` (branch `comfort-scroll-fix`, pushed); **`origin/main` FF b264491 →
  733e6a3**. Prod deploy verified live (served file carries the adaptation).
- **REGRESSION + RECOVERY (same day, Ted confirmed each step):** MISTAKE — I
  built comfort off `main` (71acd7e) and deployed to `--branch main`, assuming
  prod tracked `main`. It did NOT: prod was deployed straight from the
  `streamer-logo-grid` branch (weekend deploy `90840cc7` = `eaaa11b` + its
  uncommitted WIP). So my two off-main prod deploys (`48aeff41`/b264491,
  `79f304e7`/733e6a3) OVERWROTE the weekend build — "all the weekend changes
  gone" from the live site. No code lost (weekend work safe on
  `streamer-logo-grid` + working-tree WIP). RECOVERY: rebuilt the weekend prod
  state + comfort as branch `comfort-on-weekend` (`da160ab`) — the 5 untouched
  faces verified byte-identical to `90840cc7`; deployed it to prod
  (`--branch main`, deployment `b3262a7b`), verified live = weekend features
  (clickwheel axisMode) + comfort (renderComfort/.mrow, no buildFinaleCard).
  Then **reset `main` back to `71acd7e`** (force-with-lease `733e6a3 →
  71acd7e`, local + origin) — comfort now lives on the `streamer-logo-grid`
  line, not `main`. LESSON: Pages production can be deployed straight from a
  branch and drift from git `main`; check `wrangler pages deployment list`
  before deploying `--branch main`. Orphan branches `comfort-tab` (b264491) +
  `comfort-scroll-fix` (733e6a3) can be deleted.
- NOTE: `main` still lacks BACKEND.md + the CLAUDE.md deploy rules — those live
  only on the `streamer-logo-grid` line, so this log entry is on that branch,
  not on `main`/`comfort-tab`.

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
