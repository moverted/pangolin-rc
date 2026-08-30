# BACKEND.md — Worker / D1 / deploy log

Append-only log. Any session that touches the Worker, D1, or deploy
configuration adds an entry here before the session ends (see CLAUDE.md,
"Backend and deploy rules").

## 2026-08-29 — SET = Shadow page + Watch/Log tab-start logic (DEPLOYED, frontend-only)

No Worker/D1 change (reuses the already-deployed `/shadow` + `/marathons` endpoints). App Pages
(`pangolin-rc`, main). iOS NOT rebuilt.

- **`public/cube_set_face.html`** — SET now opens on a new **SHADOW** sub-tab (the fused taste
  profile) with COMPLETED as the second tab. Renders `GET /shadow?email=&all=1` grouped by tier
  (Top 10/25/50/rest); per row: sentiment dot + title/kind + editable note (PUT) + sentiment select
  + cut/restore (DELETE); filter, + Add (POST), ⟳ Rebuild (POST /shadow/rebuild). Classes namespaced
  `shd-` to avoid the share dialog's `sh-` classes.
- **`public/flat_shell.js` + `cube_watch_face.html` + `cube_log_face.html`** — Watch/Log tab-start
  logic. `goWatch`: WATCH tab lands on the LOG detail when the timer is LIVE, else the QUEUE list
  (was always LOG). The Watch list's ‹ CURRENT button now takes a `{active, live}` state
  (`watch:state`): VISIBLE whenever there's an in-progress watch (paused or live), marquee ANIMATES
  only while live. Shell probes the Log face (`watch:probe` → `_reportWatchState`) for the true live
  state on focus. Top-right corner shares CURRENT (active) vs the savings stat (idle) so a phone-width
  header doesn't overflow and clip CURRENT. Verified on a live Moonlighting-marathon watch.

## 2026-08-29 — Nav restructure to PROD + COLLECT marathons endpoint/seed (DEPLOYED)

The flat-app navigation restructure (branch `nav-restructure`) shipped to production. Bottom bar is
now WATCH · FEED · PIERRE · BROWSE · SET (Log merged into Watch); Watch sub-tabs QUEUE/TICKETS/STACK
(Tickets + physical-media Stack ported in from Browse, incl. the ZXing barcode scanner; SHELF→STACK
with `MEDIA_KEY`→`pg_stack` back-compat migration); Browse → SUGGEST/COLLECT; new SET tab = Completed.
DEPLOYED: Worker version `0e6a82a4-00d2-4b2d-ae41-558fb98cf515` + app Pages (`pangolin-rc`, main) +
D1 data seed (no migration). iOS bundle NOT rebuilt (web only).

- **`src/handlers/profile.ts`** — new `GET /:email/marathons`: the COLLECT view. Returns the `maps`
  table split `{ yours, community }` by `owner_email` (a map reads as YOURS to its owner, COMMUNITY
  to everyone else incl. NULL=global), each row with name/kind/step-count (join `map_steps`) + poster
  (join `titles`). Additive, read-only; reuses the existing map/`active_map_id` plumbing. Verified on
  prod: as ted → yours=[Moonlighting], community=[Psych]; as another email → yours=[], community=both.
- **D1 seed (watch DB, no schema change):** `maps.owner_email` set to `ted@pangolinrc.com` for
  `map:moonlighting-ultimate` (was NULL/global). Added `map:psych-psycho` — "Tressany's PSYCH-O
  Marathon", `owner_email` NULL (community-for-all), title_id `tvmaze:517`, + a `titles` row for Psych
  (poster) and 12 `map_steps` (the @tressandthecity curated list). NOTE: Psych's episodes are NOT
  materialized in the catalog, so activating this map falls back to air order until it is (follow-up).

### Deferred (tracked, not shipped)
- The theater-ticket audio-reflection recorder (`openTicketFull`) stayed a Browse-only subsystem;
  the ported Watch TICKETS tab lists stubs and opens the film on tap. Browse still carries the now-
  unreachable ticket/media render code (safe dead code) pending cleanup.

## 2026-08-28 — WATCH FRESH/leaf classifier + pager tab-drift hardening + Lanterns E2 data fix (DEPLOYED)

Frontend-only (no Worker/D1 config change). DEPLOYED: app Pages (`pangolin-rc`, `445950ab`) +
iOS bundle synced (Xcode opened for Ted's archive/distribute). Plus a one-off D1 **data**
correction to Ted's account (no schema change).

- **`public/cube_watch_face.html`** — two watch-mode fixes. (1) `wowFreshNow` broadened: a show
  reads FRESH when you're caught up AND it's actively in-season — phase in
  `LIVE/FRESH/PRE-SHOW/RAMP/SETTLED` (new `WOW_INSEASON_PHASES`), not just inside the old <=48h
  post-air window. A caught-up weekly now stays FRESH between drops instead of decaying to CASUAL
  (the "Lanterns should be FRESH not CASUAL" report). (2) `playheadMarkerHTML` leaf glyph now
  keys off the SAME effective mode as the text badge (`wowStampFor`→`wowEffMode`) instead of raw
  air-phase, so a show you're BEHIND on shows CASUAL text and NO leaf — they can't disagree (the
  "Silo is CASUAL but has a leaf" report; Ted is 24/29 on Silo).
- **`public/flat_shell.js`** — pager tab-drift hardening. The scroll-settle handler used to accept
  EVERY derived index unconditionally, so any involuntary iOS/WKWebView horizontal scroll (resume
  position-restore, focused-field pan, face-iframe reflow) that landed near a neighbouring panel
  silently re-indexed the pager ("returned and LOG/PIERRE/FEED/BROWSE thrown off"). Now the tracked
  `index` is authoritative: a settle only moves it when a real pointer landed on `#stage` within
  `TOUCH_WINDOW` (1200ms); otherwise it snaps back via `pinToIndex()`. Complements last build's
  `reassertFace` re-pin (0/120/300/600ms on resume), which alone was insufficient.
- **D1 data fix (watch_episode):** Ted's Lanterns (`tvmaze:44776`) **S1E2** was a "Before Pierre"
  backfill (`bp=1`, done session `bp:true`) so it rendered as a greyed pre-app mark with no date
  and its reflection comment didn't surface. Cleared `bp` on the episode row and the finished
  session, keeping the real finishTs (Sun 2026-08-23 22:53) → now a proper dated Sunday-night watch
  with its comment. Comment data untouched (the one S1E2 reflection was already correctly attached;
  the "Hacks" comments under `tvmaze:54914` were an unrelated bare-`S01E02` code collision).

## 2026-08-27 — Catalog auto-heal on read + Pierre/LOG/shell bug fixes (DEPLOYED)

Five reported bugs. The one backend change is catalog **auto-heal on read**: a title is
materialized ONCE, so episodes not yet aired at ingest kept TVmaze placeholders (null runtime,
`"Episode N"` names, null summary) forever — the "Silo / Ted Lasso have no episode
title/synopsis/runtime" report, which also forced the LOG synopsis to fall back to the series
blurb. DEPLOYED: Worker version `d56acc00-57c8-4329-9645-c6372f43548d` + app Pages
(`pangolin-rc`, `78302b5c`). **No migration** — read-path healing only.

- **`src/handlers/catalog.ts`** — extracted `/refresh`'s TVmaze re-pull into a reusable
  `refreshTitleEpisodes(env, titleId)` (upserts the full episode list + corrects
  names/runtimes/airdates/next-links + title total/status/poster, bumps `titles.updated_at`);
  `/refresh` now just calls it. New `maybeHealTitle(env, title)`: on a title read, if
  `titles.updated_at` is older than `HEAL_TTL_MS` (6h) AND a cheap `STALE_EP_SQL` existence
  check finds an **aired** episode still carrying a placeholder (`runtime IS NULL` /
  `name GLOB 'Episode [0-9]*'` / blank / `TBA%`), it re-pulls from TVmaze in-band and returns
  the refreshed title row. TTL-gated so an aired-but-still-incomplete-upstream episode can't make
  every open hammer TVmaze; summary-null is deliberately NOT a staleness signal (many aired eps
  legitimately have no synopsis → would re-fetch forever). Wired into both read paths:
  `GET /catalog/titles/:id/episodes` and (via import) `profile.ts`
  `GET /:email/titles/:title_id`. Movies/fresh titles are a no-op.
- **`src/handlers/profile.ts`** — imports `maybeHealTitle`; the title-detail endpoint heals
  before loading episodes (so the LOG face shows real episode data on open).

Frontend-only fixes in the same Pages deploy (no Worker/D1 impact, logged here for the deploy
trail): **cube_pierre_face.html** — a debounced dead-end guard (`ensureExit`/`scheduleExitCheck`,
fired after each message/reply/chip tap and on `cube:focus`) restores the composer when a flow
branch leaves it hidden with no enabled button to tap (the "stranded, must hard-quit" bug); and
`applyTRT` now posts `pg:runtimeApplied` when a `[TRT]` runtime correction applies. **flat_shell.js**
— forwards `pg:runtimeApplied` to the LOG face, and `reassertFace()` re-pins the pager across a
0/120/300/600ms window (was a single 60ms) so iOS's post-resume `scrollLeft` reset can't leave
LOG/PIERRE view-vs-indicator out of sync. **cube_log_face.html** — `applyRuntimeUpdate()` patches
the cached episode + repaints so a running watch's total/remaining update live from a `[TRT]` fix
(no quit/reopen). iOS bundle NOT yet rebuilt (web only).

## 2026-08-26 — Admin Episode Feed call-to-action top line (DEPLOYED)

The admin Episode Feed's serialized `all_comments` column now opens with a
call-to-action line before the timed comments. DEPLOYED: Worker version
`de6eba15-e291-461a-a3a3-a9d8dbb3e1cc`. No migration.

- **`src/handlers/admin.ts`** — in `EPISODE_COMMENTS_FROM`, prepended
  `'To listen along join.pangolinrc.com' || char(10) ||` to the per-episode
  `GROUP_CONCAT`, so each episode's feed reads:
  `To listen along join.pangolinrc.com` / `00:XX comment` / … Updated the
  `episode_comments` resource `note` to document the CTA line. Read-only view;
  no schema change. Follow-up (Worker `dee678d6-a602-4416-8020-43bbf16ddc22`):
  added a blank line (`char(10) || char(10)`) between the CTA and the first
  comment.

## 2026-08-24 — GET TED reply queue (one-at-a-time, ack-via-grade) + fixes (DEPLOYED)

The flat app now surfaces Ted's answers to Get-Ted escalations as a proper queue instead of
splicing a lone TED bubble into whatever chat is on screen. DEPLOYED: Worker version
`dd35b491-4625-4142-aaa9-8cd2ecb5ad32` + app Pages (`pangolin-rc`, `6e2e33b1`) + iOS bundle
synced. No migration — reuses `pierre_chat.grade`. Verified locally: `/ted-thread` returns the
oldest unacked thread as its full transcript with a pending count; `/ted-thread/ack` writes the
grade and advances; FIFO across multiple pending threads (oldest served first, next loads on ack).

- **Model:** a Ted reply (`role='ted'` turn on the original conversation) is "unacked" while its
  `grade` is '' (ungraded). The member acks by grading — 👍→`great`, 👎→`bad`, any other chat exit
  (General TV Chat / Share / Clear / tap composer)→`good`. Grading advances to the next unacked
  thread. Ungraded = still waiting, so it survives navigation/reinstall and reloads every return.
- **`src/handlers/profile.ts`** (new, member-scoped): `GET /:email/ted-thread` → `{ pending, thread }`
  where `pending` = count of ungraded ted turns and `thread` = the OLDEST unacked ted turn's FULL
  conversation transcript (all user/pierre/ted turns in seq order) + `ted_turn_id`. `POST
  /:email/ted-thread/ack { ted_turn_id, grade }` sets great|good|bad (default good) on the member's
  own still-ungraded ted turn, returns remaining `pending`. The old batch `ted-messages` endpoint
  stays for the frozen cube (which keeps inline delivery); the flat app uses the queue.
- **Frontend (app Pages):** `cube_pierre_face.html` — flat-app-only Ted-thread takeover: loads the
  oldest unacked thread as the full read-only conversation on boot / `cube:focus` (tab switch) /
  visibility-return; thumbs grade+advance, General TV Chat/Share/Clear ack `good`+advance, detours
  (add series/movie/ticket, game) leave it ungraded so it waits; GET TED greyed while a thread is
  open; picker "Your streaming shadow" → disabled "Shadow (future)". `flat_shell.js` + `app.html`
  — a blue (`#5fd6e0`, the TED-reply glow, never red) count badge over the remote in the PIERRE
  hero tab, driven by `pierre:ted-waiting`. `cube_watch_face.html` — COMFORT tab count now =
  marathon count (was 0 until you opened the tab, reading as a bug).

## 2026-08-24 — Curated maps: wire marathons into real Current/Next (DEPLOYED)

Ties the reserved `maps` / `map_steps` / `watch_title.active_map_id` system (migration 0012) into
the live watch engine so watching from a comfort marathon drives the app's real Current/Next in the
curated order. First map: The Ultimate Moonlighting Rewatch (7 cross-season episodes). TEST-ONLY —
NOT in tester "What to Test"; fine if a tester stumbles on it. DEPLOYED: Worker version
`14a2665f-23d8-4284-b9d1-428f22c4df9a` + D1 remote migration `0052` + app Pages (`pangolin-rc`,
`2776cd10`) + iOS bundle synced (Xcode opened for Ted's archive/distribute). Verified on prod:
`GET /catalog/titles/tvmaze:1487/episodes?map=map:moonlighting-ultimate` returns the 7 steps in
curated order (1e1, 2e2, 2e4, 3e6, 3e7, 3e8, 4e13); no-map/no-email request still returns the full
67-ep air-order list with no map flag (regression clean).

- **D1 `0052_moonlighting_map.sql`:** one `maps` row (`map:moonlighting-ultimate`, title
  `tvmaze:1487`, kind `curated`, owner NULL = global) + 7 `map_steps` (position + episode_id +
  next_episode_id chaining s1e1→s2e2→s2e4→s3e6→s3e7→s3e8→s4e13→NULL). `INSERT OR REPLACE`,
  idempotent. Applied LOCAL + REMOTE. NOTE: the referenced title must be materialized in the
  catalog for the JOIN to resolve — did `POST /catalog/initiate {tvmaze:1487}` on prod post-migrate.
- **`src/handlers/catalog.ts`:** `GET /catalog/titles/:id/episodes` now accepts `?map=<map_id>`,
  or auto-detects the member's `active_map_id` via `?email=`. When a map applies, returns episodes
  JOINed through `map_steps` in position order with the map's next-links + a `map:{id,name}` flag.
  No map → the prior response, byte-identical.
- **`src/handlers/profile.ts`:** `recomputeTitle` is map-aware (when `active_map_id` set, total/
  watched/released/cur/last computed against `map_steps` in position order); `GET /:email/titles/
  :title_id` returns map-ordered episodes + `map` flag when active; new `POST /:email/titles/
  :title_id/map { map_id|null }` sets/clears `active_map_id` (validates the map, upserts watch_title,
  recomputes) → `{ ok, active_map_id, status, current_episode_id }`.
- **Frontend (app Pages):** `cube_log_face.html` gains a gated **map mode** (`mapMode` set only
  when the episodes response carries a `map` flag; when on, `boot`/`applyPattern` skip the season
  slice and treat the map as one flat ordered sequence, `hasLaterSeason`/`loadNextSeason` no-op) —
  non-map watching is unchanged. `cube_watch_comfort_face.html` gains a "watch in the app" button
  on the now-watching card (gated on `CFG.map`) that postMessages `comfort:watch` to the parent.
  `cube_watch_face.html` listens for `comfort:watch` → `POST …/map {map_id}` → `cube.rotateTo
  ('episodes', {titleId, pattern, addToLog})`. `flat_shell.js` pins the episodes handoff on
  `payload.titleId` too (prevents resume-last clobbering the marathon handoff).

## 2026-08-22 — Streaming shadow (table + API + admin + panel) & Pierre intent fixes (DEPLOYED 2026-08-23)

Built on branch `endnote-one-reply-flow`. DEPLOYED 2026-08-23: Worker version
`40946167-3b4b-42e0-b23e-8f08a4dbbee2` + D1 remote migration `0047` + app Pages (`pangolin-rc`,
`2984d940`) + admin Pages (`pangolinrc-admin`, `cd443b30`) + iOS bundle synced (Xcode opened for
Ted's archive/distribute). Verified on prod: `/shadow` live; `POST /shadow/rebuild` for
ted@pangolinrc.com folded in 97 watch rows + extracted 23 titles from his pierre_chat transcripts
(13 net-new chat rows after upsert overlap), with real narrative feel/sentiment (e.g. The Leftovers
love, Dark nope, Mr. Robot love). App panel string present on remote.pangolinrc.com.

- **D1 `0047_streaming_shadow.sql`:** new `streaming_shadow` table (id, user_email, title_id,
  title_name, kind, feel, sentiment, source, weight, hidden, visibility, created/updated_at),
  unique `(user_email, title_name)` so a re-mention upserts. Applied LOCAL only.
- **`src/handlers/shadow.ts`** (new, mounted `/shadow` in index.ts): `upsertShadow` helper;
  `GET /shadow?email=&all=1`, `POST /shadow` (manual add), `PUT /shadow/:id` (feel/sentiment/
  hidden, owner-scoped), `DELETE /shadow/:id` (soft-cut hidden=1), `POST /shadow/rebuild`
  (folds watch_title rows + one LLM pass over the user's pierre_chat → upserts everything
  mentioned/discussed). Exports `shadowTitleNames` for the game avoid.
- **`pierre.ts`:** new `[SHADOW: title | feel | sentiment]` prompt tag (silent auto-write);
  `shadowBlock` folds the top-weighted shadow into the chat system context; `/pierre/room-guess`
  + `/room-guess/one` now merge the caller's shadow titles into `avoid` (kills the repeated-
  Severance game bug). Also tightened the BACKFILL/WATCHED/put-on rules so future desire
  ("I'd like to watch X") routes to a put-on (Current) and partial progress ("saw ep 1, want
  the rest") uses [WATCHED] (in-progress) — never [BACKFILL]/Completed.
- **`admin.ts`:** new `streaming_shadow` resource (list/filter/pivot; inline-editable
  sentiment). `admin/index.html` wraps the `feel` column.
- **Client (`cube_pierre_face.html`):** `parseShadow` fires the `[SHADOW]` writes silently;
  `askWatchedWith` "Just me" chip no longer a no-op; new "Your streaming shadow" context-menu
  item opens an in-face panel to view/edit (feel + sentiment), cut, restore, and add titles.
- **Follow-up (Worker `68431e4a`):** admin `streaming_shadow` now groups rows by user —
  added `groupHeaderCols: ['user_email']` so each user gets one header row (email drops off the
  per-row columns). Worker-only redeploy; admin frontend already supported group headers.

## 2026-08-23 — Streaming shadow admin: rank/reorder, Pierre vs User Feel, editable source/cut (DEPLOYED)

Worker `37d4c1fb` + D1 remote migrations `0048`+`0049` + admin Pages (`pangolinrc-admin` `135cef82`)
+ app Pages (`pangolin-rc` `c468a067`). iOS bundle NOT synced yet (in-app panel improvements ride
the next build, bundled with the Maul watch-timer fix). Prod `POST /shadow/rerank` ranked ted's 110 rows.

- **D1:** `0048_streaming_shadow_note.sql` (`note` = User Feel free text), `0049_streaming_shadow_rank.sql`
  (`rank` INTEGER + index). Both additive, applied local + remote.
- **`shadow.ts`:** GET returns `note`+`rank`, ordered by rank (unranked last); PUT accepts `note`,`rank`;
  new `rerankShadow` helper (sentiment love>like>meh>nope>unset, then weight, then recency → 1..N over
  non-hidden rows) + `POST /shadow/rerank`; rebuild now reranks at the end and returns `ranked`.
- **`admin.ts`:** streaming_shadow cols relabeled (`feel`→"Pierre Feel" read-only, `note`→"User Feel"),
  added `rank` col; new write kinds `text` (note) + `bool` (hidden/Cut checkbox) in the `/write/:resource`
  handler; `source` + `rank` now writable; `reorder:'rank'` flag + exposed in `/admin/meta`; defaultOrder
  by rank. `Write` type gained `text`|`bool`.
- **`admin/index.html`:** renders text/bool editors + autosave; **Save all** button; **resizable columns**
  (colgroup + grips, persisted per-resource in localStorage); **drag-to-reorder rows** (⠿ handle → renumber
  group's ranks + save). Verified end-to-end locally + prod (rerank, editable source/cut/note, drag persist).
- **`cube_pierre_face.html` (in web deploy, reaches iOS on next build):** shadow panel is now full-screen
  `position:fixed` + scrollable, with a filter/add row, read-only "Pierre:" feel + editable User Feel note.

## 2026-08-23 — Shadow: 4-way kind classification + per-kind ranking (Worker `46636e3e` + admin Pages `0409dd67`)

No migration (reused existing `kind`/`rank` cols). Classify titles into series / miniseries / anthology /
movie so ranking is apples-to-apples within a kind.
- **`shadow.ts`:** `KINDS` set; `classifyShadow` = one LLM pass (`llmClassify`, best-guess) + tmdb:→movie +
  legacy show→series fallback; **idempotent + edit-safe** (skips rows already holding one of the four kinds,
  so re-runs/rebuilds never reshuffle or clobber manual edits). `rerankShadow` now ranks 1..N PER KIND.
  `POST /shadow/classify` (classify+rerank); rebuild runs classify before rerank. GET orders by kind, rank.
  PUT accepts `kind` (validated).
- **`admin.ts`:** `kind` now an editable enum + a Kind filter; `reorderScope:'kind'` (exposed in /meta) so
  drag-reorder + renumber happen WITHIN a category. defaultOrder clusters user → kind → per-kind rank.
- **`admin/index.html`:** rows carry `data-rk` (the reorder sub-key); `scopeRows` limits drag/renumber to
  same group + same kind. (No new write kinds; kind uses the existing enum path.)
- Prod: classified ted's shadow → series 31 / miniseries 9 / movie 68 / anthology 0 (LLM was conservative
  on anthology; all editable). Verified per-kind rerank + idempotent re-run (classified:0) + PUT validation.
- **Follow-up (Worker `1865ae12` + admin Pages `24552966` + D1 `0050`):** renamed kind `movie`→`film`
  (migration `0050_shadow_movie_to_film.sql` UPDATE; KINDS/classify/options all use `film` now — so the
  rank prefix F=film is distinct from M=mini-series). Rank cell now shows a **kind prefix** (S-/M-/A-/F-)
  before the editable number, derived from `reorderScope` (`RANK_PREFIX` map). Smaller `Cut` header
  (`th[data-key="hidden"]` font 0.6rem, nowrap) so it doesn't wrap. Reorder col min bumped to 120 (grip +
  prefix + input). Prod re-ranked (per-kind, no dup ranks); the earlier "both S-3" was the missing prefix
  (Bad Monkey S-3 vs a different-kind title). Maul still auto-tagged F-1 — Ted to flip to series.
- **Earlier follow-up (Worker `6629f24f` + admin Pages `a9733508`):** moved `Cut` to the 2nd column; added
  `defaultFilters:{hidden:'kept'}` (exposed in /meta) so the shadow opens uncut-only and ticking Cut drops
  the row out (still reachable via the Cut? filter — the frontend reloads after editing a filtered column).
  Column resize now soft-wraps text cells (`table.fixedcols` white-space:normal) and clamps control columns
  to a usable min width (`colMinWidth`: enum 130 / int 80 / bool 44 / text 48).

## 2026-08-23 — Fix FINISHED? leaking across shows (app `b95d7ec9`)

Regression from the watch-timer durable-finish work: `finishPrompt` was a sticky global (the 30s callout
stopped clearing it), so after one show staged FINISHED?, the next show/episode that loaded inherited the
green FINISHED? at 0 min (reported on The Neighbors + Lanterns). Fix: `paint()` now DERIVES finishPrompt from
the focused episode's own pending marker — `finishPrompt = !isTheater() && hasPendingFin(focus) &&
!epDone[focus] && !watchingLive[focus]` — so it can't leak to a show without a marker. Verified in-browser:
staged show → FINISHED?, fresh show → FINISH. (Frontend-only; iOS bundle synced.) NOTE: separately, Lanterns
appears wrongly marked complete (pre-existing, likely the old auto-complete before the always-stage fix or a
leaked-FINISHED tap) — that's why it left Current, Pierre offered REWATCH, and next-up reads S1E02 (done+1,
which loads E1 since there's no E2). Reset the episode to clear.

## 2026-08-24 — Comfort marathons data-driven + Moonlighting Rewatch (app `9a0d0a7c`, frontend only)

`cube_watch_comfort_face.html` was a Psych-only self-contained prototype. Made it data-driven: a `CONFIGS`
registry keyed by `?m=<id>` (store key, TVmaze show id, emoji, title, subline, foot, and the curated
`episodes` list); header text set from the config at runtime. Added `moonlighting` (TVmaze 1487, 7 curated
eps: S1E1, S2E2, S2E4, S3E6, S3E7, S3E8, S4E13) + a MARATHONS row in `cube_watch_face.html`
(`?m=moonlighting`). Next-up follows the curated order (verified: after S1E1 → "next up S2E02"). NOTE: this
is the self-contained comfort marathon (its own next-up + localStorage progress, like Psych) — NOT yet wired
into the main watch engine's global next via the reserved `maps`/`active_map_id` tables. That deeper
integration is a follow-up if the marathon should drive the real Current/Next everywhere.

## 2026-08-24 — Shadow tiers become SUBJECTIVE stored buckets + admin opens on Series (Worker `5fdcd7d2` + admin `51865c5f` + app `05e76c4f` + D1 `0051`)

Ted: tiers should be loose subjective buckets (a "Top 10" can hold 30 shows), a way to place a title broadly
via conversation then refine — NOT a rank band. Migration `0051` adds a stored `tier` column (seeded from the
old rank bands: 1-10→Top 10, 11-25→Top 25, 26+→Top 50). `shadow.ts`: `TIERS`/`tierCanon`/`TIER_ORDER_SQL`
replace the derived `tierLabel`/`TIER_CAPS`; GET returns stored tier and sorts kind→tier→rank; PUT accepts
`tier`; `/shadow/place` now SETS the tier bucket (dropped the rank-band insert `placeAtTier`); rerank/compact
order kind→tier→rank. `pierre.ts`: `shadowBlock` shows each title's [tier]; `[SHADOW]` prompt reframed —
place broad (Top 10/25/50), refine through discussion. Client `hasTier` regex drops 100. `admin.ts`: Tier is
now a stored editable enum (Top 10/25/50) + filter + By-tier pivot; `defaultFilters:{kind:'series',hidden:'kept'}`
(opens on Series); order kind→tier→rank. Prod seed: series Top 10=10 / Top 25=15 / Top 50=8 (Mork & Mindy #1).

## 2026-08-23 — catalog/refresh: heal stale one-episode catalog entries (Worker `23451364`)

Real root of the Lanterns saga: `materializeTitle` ingests a title ONCE and never re-fetches, so a show added
before its episodes populated keeps a stale list. Lanterns (tvmaze:44776) had 1 placeholder episode ("TBA")
in the catalog while TVmaze now has 8 (S1E1 Pilot, S1E2 Trust Fall, S1E3-8 TBA). Pierre reads TVmaze live (so
it offered "S1E02 Trust Fall") but the LOG face reads the catalog → E2 didn't exist → fell back to E1/"TBA".
New `POST /catalog/refresh {title_id}` re-pulls a TVmaze show's full episode list (INSERT OR REPLACE episodes +
next-episode links, updates titles.total_episodes/status/name/poster). Series only; idempotent. Ran it for
Lanterns on prod → 8 episodes, names corrected. NOTE: the member's watch_title may still read 'completed' (set
when total was 1) until they reset E1 or log an episode; catalog refresh doesn't touch member progress.

## 2026-08-23 — Fix Pierre episode-chip handoff loading the wrong show (app `397397ab`)

Report: tapping a Pierre episode chip ("S1E02 Trust Fall") loaded S1E01 of the WRONG show (Lanterns/TBA).
Cause in `flat_shell.js`: `cubeRotateTo` posts the picked show to the LOG face, but an async `sendEpisodesLast()`
(deferred `episodesWantsLast` on `log:data`, or the WATCH face's `episode:requestLast`) then re-posted
`lastResume` (the last-watched show, Lanterns) and clobbered it — Lanterns has 1 episode so `kind:'at' number:2`
fell back to E1/TBA. Fix: `episodesPinned` — set when a handoff loads a specific show into episodes (and
cancels a pending wantsLast); `sendEpisodesLast()` returns early when pinned; `goTo(episodes)` clears the pin
(a manual LOG-tab tap resumes last as before, and cubeRotateTo re-pins right after its goTo). Verified by
syntax + reasoning (full flat-app race needs the live multi-face app to reproduce).

## 2026-08-23 — Game titles now feed the shadow (Worker `b35d0d59` + app `58ff4d3f`)

Before: only the member's REACTION to Pierre's pick reached the shadow (via [SHADOW]); the two titles they
named in the game weren't recorded. Now `POST /shadow` honors an optional `source` (watch/game/chat/manual;
default manual), and the game client (`submitGame`) records the two named titles + the put-on pick as
`source:'game'` (silent upsert; kind/sentiment fill in later via classify). iOS bundle re-synced.

## 2026-08-23 — Fix: big shadow was starving the game + room-build (Worker `b6fb22c3`)

Report: "shows added but not the slots" (onboarding room-build) + "the game is failing." Root cause: both
`/pierre/room-guess` and `/room-guess/one` merged up to 80 of the signed-in member's shadow titles into the
LLM's `avoid` list. Once a member's shadow got large (Ted's ~110 after rebuild/classify), nearly every
groundable pick was excluded → 0 picks → room slots empty / game "slipped." Fix: split avoid into HARD (the
pair + accepted/seen picks — never repeat) vs SOFT (shadow, capped 30). Two passes: pass 0 honors the soft
shadow avoid, pass 1 drops it — so a big shadow can't starve the picks; worst case it re-offers a known title
rather than failing. (Could not reproduce locally — room-guess needs the Turnstile/native gate + ANTHROPIC
key; fix is logic-only + strictly more lenient.)

## 2026-08-23 — Shadow tiers (Top 10/25/50/100) + Pierre place + compact (Worker `b1162dc4` + admin `5f61b34e` + app `55db7276`)

No migration (tier derived from per-kind rank). Bands: Top 10 = ranks 1-10, Top 25 = 11-25, Top 50 = 26-50,
Top 100 = 51-100, else Beyond 100.
- **`shadow.ts`:** `tierLabel`/`tierCap`; GET now returns a derived `tier` per row. `POST /shadow/place
  {email,title_name,tier,kind?,feel?,sentiment?}` — upserts + resolves kind (given→existing→LLM→series) +
  inserts at that Top-N band within the kind (`placeAtTier`: position N, shift down, compact). `POST /shadow/
  compact` — normalizes ranks to 1..N PER KIND preserving current order (fixes dup ranks from manual number
  edits + gaps from kind changes, WITHOUT rerank's heuristic resort). Ran compact on prod (105 rows) → film
  1..67, miniseries 1..6, series 1..32, no dups.
- **`pierre.ts`:** `shadowBlock` now groups the shadow by kind + shows per-kind rank so Pierre can reference
  tiers ("your top 10 films"); `[SHADOW]` tag extended to an optional `| kind | tier` (5-field) form for
  ranking a title into a tier — prompt rule added.
- **`cube_pierre_face.html`:** `parseShadow` reads the 5-field tag; `recordShadow` routes tier placements to
  `/shadow/place`, plain reactions to `/shadow`. (In app Pages; reaches iOS on the next archive — bundle
  re-synced.)
- **`admin.ts`:** derived `Tier` column + Tier filter + By-kind/By-tier pivots (shared `SHADOW_TIER_EXPR`).
- **Follow-up (admin Pages `fe8f2f22`):** editing a rank NUMBER now reorders — `onEditCell` routes the
  reorder column to `reorderByNumber`, which moves the row to the typed position within its kind and calls
  `renumberScope` (same path as drag) → clean 1..N, no dups/gaps. Removes the manual-number-edit dup caveat.
- **Follow-up (Worker `7deb5064` + admin Pages `a01a2176`):** cutting a row now compacts its kind. Resource
  declares `reorderCutCol:'hidden'` (in /meta); `onEditCell` on that col: on CUT, blanks the row's own rank
  (0) then runs `compactScope` (renumber the scope's not-cut rows 1..N by order) → gap closes by shifting
  rows below UP (top-down). Rank cell renders blank + no prefix when rank is 0. On RESTORE it does NOT
  renumber — the row returns unranked (blank) so you place it (avoids a dup with siblings not loaded in the
  cut-only view). VERIFIED in-browser against a stubbed backend: cutting Andor (S-3) → writes hidden=1,
  rank=0 (Andor), rank=3 (Psych, was 4); visible became S-1 Bear / S-2 Severance / S-3 Psych; cut view shows
  Andor with a blank rank and no prefix.

## 2026-08-23 — Watch-timer FINISHED fix (app Pages `50f5423b`; iOS bundle synced/Xcode opened)

Frontend-only (`public/cube_log_face.html`); no Worker/D1. Fixes the Maul E6 report: (A) pausing near the
end no longer silently auto-completes + jumps to the next episode, and (B) the staged FINISHED? now
survives sleep/reload.
- `tickWatch` at runtime now ALWAYS `stageReturnFinish` (deliberate FINISHED? tap, focus stays) instead of
  `completeWatch` (silent auto-complete + advanceFocus). The app can't see an external pause, so it never
  auto-advances on a wall-clock overrun. `completeWatch` is now unused (kept for reference).
- Durable staged finish: `stageReturnFinish` sets a `pg_pendingfin:<titleId>:<epcode>` localStorage marker +
  `emitProgress(minute=rt, done=false)`; `restorePendingFinish` re-surfaces FINISHED? on visibilitychange/
  pageshow/cube:focus/load. The 30s callout now only drops the pulse (keeps the green FINISHED? state).
  Marker cleared by finish/log/re-start/scrub/forceAdvance. Streamer deep-link promptFinish routed through
  `stageReturnFinish` too. Verified in-browser: end→stage (no advance), sleep/wake restore, reload restore,
  commit clears marker. This build also carries the in-app shadow panel scroll fix.

## 2026-08-21 — Pierre chat-type (game) tracking + admin session Type/Grade (DEPLOYED)

Worker `3d3849f5` + D1 remote migration `0046` + app/admin Pages deployed, iOS bundle synced.
Lets Ted see how the "Do you want to play a game?" streaming-shadow game is used/performing.

- **D1 `0046_pierre_chat_kind.sql`:** `ALTER TABLE pierre_chat ADD COLUMN kind TEXT NOT NULL
  DEFAULT 'chat'` (+ index). Applied local + remote. (Numbered 0046 to dodge the existing
  `0045_feedback.sql`.)
- **`pierre.ts`:** `POST /pierre/chat` now reads `body.kind` (`'game'` else `'chat'`) and
  `persistChatTurns(..., kind)` stores it on each turn.
- **Client (`cube_pierre_face.html`):** the chat POST sends `kind: currentCtx==='game'?'game':'chat'`,
  so game-lane turns are tagged. (Game lane = the new `enterGameFlow`/`switchTo('game')`.)
- **`admin.ts` pierre_chat resource:** session header is now **Session · User · Type · Grade**.
  `type` = "Game Session" if any turn in the conversation is `kind='game'`; `sgrade` = 👍 (any
  great/good, no poor/bad) / 👎 (any poor/bad) / — . Added a **Type** filter (Game Session / Chat).
  Existing per-turn inline grading kept (relabeled "Turn grade").

## 2026-08-20 — Pierre movie backfill flow + honest self-escalate (DEPLOYED)

Worker `7fea88a4` (then copy/migration Pages) + app Pages deployed, iOS bundle synced.
Kills the "Pierre says logged but nothing happened" bug for everyone.

- **`catalog/backfill-movie`** (new): {email, name, watched_at ms, rating} → resolves the
  film on TMDB (`searchAll`, now exported from tmdb.ts), materializes it, writes watch_title
  completed + watch_episode done + a done session backdated to `watched_at`, and stores the
  rating as a shared reflection. Server does the real work and returns the truth. Tested
  live (The Matrix, backdated, rating) + cleaned up.
- **Client (`cube_pierre_face.html`):** `[BACKFILL: title | day | rating]` tag →
  `parseBackfill` → `runBackfill` resolves the day to noon LOCAL (`dayToNoonMs`, device tz),
  calls the endpoint, and confirms ONLY what landed, then `askWatchedWith` (coviewer roster).
  On a dead end it does NOT fake it: `selfEscalate` posts /feedback get_ted with context and
  starts the Ted-reply poll, and Pierre says the honest "still in training, calling my
  manager" line.
- **`/feedback`:** the Get Ted escalation content now uses the posted `note` (so a backfill
  dead end shows its context in the queue). Verified.
- **Prompt (`pierre.ts`):** new BACKFILL section (gather title/day/rating, emit the tag,
  never say "done", warm emotional follow-ups like "gentle little cry or big ugly one",
  never scold a rating) + honesty rule ("still in training, call my manager Ted" then
  [GETTED]).
- **Console band relaid out** to [CHAT picker | 👍 GET TED 👎 | cube]: CHAT picker moved to
  the left (freed device-chip slot) with its popup left-aligned, so it no longer collides
  with the centered feedback band. Feedback band also stays up during Pierre chat.
- **One-time login migration** in `cube_shell.js`: a device still holding
  edward.m.willett@gmail.com in pg_user is rewritten to ted@pangolinrc.com before anything
  reads it (runs before the face iframes), so the renamed founder account is not a ghost on
  the next build.

## 2026-08-20 — Willett family friend + coviewer graph (D1 data only)

`scripts/willett-friends-coviewers.sql`. Ted (ted@pangolinrc.com), Audrey
(audrey.arya.willett@gmail.com), Abby (aweid8@gmail.com) all made mutual friends (added
Ted<->Audrey both ways + Abby->Audrey; Ted<->Abby was already mutual) so all three see each
other's FEED. Coviewers made bidirectional+linked for Ted<->Audrey and Audrey<->Abby only
(Audrey's roster gained Ted/Abby linked; Abby's existing name-only Audrey linked to her
account). Ted and Abby are friends but deliberately NOT coviewers. Verified.

## 2026-08-20 — Feedback band during Pierre + Audrey movie backfill (DEPLOYED)

App Pages deployed + bundle synced. D1 data ops (no schema change).

- **Feedback band stays up during Pierre chat:** removed the
  `#controls:has(#console-kb.show) #feedback-band{display:none}` hide-on-keyboard rule in
  index.html, so 👍/GET TED/👎 stay visible while a member is talking to Pierre (fast
  iterate signal, "Pierre drives everything" voice path).
- **Audrey used voice, not typing:** no mic_permission row (that logging postdates her
  session), but the transcript is full of ASR errors ("Qsack"=Cusack, "suday"=Sunday,
  "wherr"). Recorded here as the reason the transcription needs work.
- **Backfilled Audrey's three films for real** (`scripts/audrey-log-movies.sql`): resolved
  all three on TMDB (My Fault: London 1294203, Your Fault: London 1477317 — a real 2026
  title, she was right, Don't Say Good Luck 1504358), `/catalog/initiate` to materialize,
  then set watch_title completed + watch_episode done + a done session, backdated to NOON
  America/Los_Angeles of the day she said (Sun Aug 16 / Mon Aug 17), and her ratings stored
  as shared reflections (is_reflection=1, private=0): 5/5, 5/5, "4/5, and I cried like a
  baby". Now in her Completed tab + the FEED time-slotted so friends see them.
- **Mea culpa updated** to the new (now truthful) ending: logged as solo watches, offer to
  add coviewers to the watches and profile.

## 2026-08-19 — Proactive Pierre delivery + Audrey mea culpa (DEPLOYED)

Worker `e1a5b3bd` + app Pages deployed, bundle synced. No schema change.

- **`ted-messages` delivery now carries role + a Pierre channel:** query also returns
  `role='pierre' AND ted_status='deliver'` turns (and the `role` field). Client
  `fetchTedMessages` renders a delivered Pierre turn via `addPierre` (his voice, chat stays
  open) and a Ted turn via `addTed` (closes the session). Lets Pierre send a proactive,
  in-character message on next open.
- **Queued Audrey's apology** (`scripts/audrey-mea-culpa.sql`): one `role='pierre'`,
  `ted_status='deliver'` turn for audrey.arya.willett@gmail.com, owning the fake "logged"
  claim and offering to log the three films properly with her ratings as notes. Shows on her
  next open once she is on a build with the role-aware fetch. Editable/removable until seen.

## 2026-08-19 — Device picker hidden + console feedback band (DEPLOYED)

Migration `0045_feedback` applied REMOTE. Worker `d02a60ec` + app Pages deployed, iOS
bundle synced. Two of a larger batch (Pierre movie-backfill flow still pending).

- **Device picker hidden everywhere** (half-built, not working). `index.html`
  `#device-chip.show{display:none}`. `cube_profile_face.html`: the Your Devices section
  moved from the top to the very BOTTOM of the profile scroll and `display:none`, so
  friends/coviewing get the top real estate. Ids kept so the JS still binds; flip the
  display to bring it back at the bottom.
- **Console feedback band** (`#feedback-band` in index.html, wired in `initWheelCube`):
  thumbs up / GET TED / thumbs down, glyphs not emoji, centered in the console row left of
  the floating cube, shown with it (any open face). `POST /feedback {email,kind,face}` →
  `feedback` table (migration 0045). Get Ted also opens a one-turn `pierre_chat` escalation
  (needs_ted=1) so it rides the SAME admin Get Ted queue + reply-delivery loop and bumps
  the badge. New admin **Feedback** resource (kind/user/face/note + by-kind/by-user
  pivots). Verified live: up + get_ted recorded, escalation created, cleaned up.

## 2026-08-19 — Get Ted polish: badge, session view, mobile reply, poll (DEPLOYED)

Worker `99c2c348` + admin Pages + app Pages deployed, iOS bundle synced. Follow-ups on the
Ted reply loop.

- **App-icon badge now includes Get Ted:** `/admin/app-status` returns `getTedOpen` =
  COUNT(DISTINCT conversation_id) of open escalations; `cube_shell.js` badge = waitlistNew +
  getTedOpen.
- **App:** the closed-session composer now reads **"Start new chat"** (was Clear chat).
  Added a 30s poll for Ted's reply that runs ONLY while the current session is waiting on
  him (`_awaitingTed`, set when Pierre emits [GETTED]); it stops the moment a reply lands.
- **Admin Get Ted reworked to a session view:** `from` now pulls every turn of any
  conversation with an OPEN escalation, grouped by conversation like Pierre chats
  (groupBy + groupHeaderCols + the same defaultOrder). Handled sessions drop out.
- **Mobile reply box:** replaced the cramped per-row reply cell with a full-width reply
  ROW injected under each needy session (`tr.reply-row`, textarea + blue Send), with
  `position:sticky; left` so it stays in the viewport on a phone (the reason a reply could
  not be written on mobile before). Targets that session's escalation turn.
- **`/admin/ted-reply`** now marks EVERY open escalation turn in the conversation handled
  (not just the replied-from id), so one reply closes the whole session (22c4a1e3 had two
  [GETTED] turns). Verified: 22c4a1e3 resolved, turn 11 = the delivered TED reply, 0 open.

## 2026-08-19 — Ted reply loop + admin session UX (DEPLOYED)

Worker `25ae9767` + admin Pages (`pangolinrc-admin`) + app Pages deployed, iOS bundle
synced. Closes the escalation loop: Ted answers from the admin, the reply reaches the
user's app as a blue TED message. No schema change (reuses pierre_chat role='ted').

- **`admin.ts` `POST /admin/ted-reply`** (adminGate): given a flagged turn id + text, appends
  a role='ted' turn to that conversation (next seq) and sets the escalation ted_status
  'handled'. **`GET /profile/:email/ted-messages?since=`** returns role='ted' turns newer
  than the client high water, oldest-first. Verified end-to-end (insert → fetch → cleanup).
- **`cube_pierre_face.html`:** `.msg.ted` renders in the palette's cold blue (`--screen`
  #5fd6e0) with a TED label; `addTed()` renderer; `fetchTedMessages()` pulls unseen replies
  on chat open + on visibilitychange, tracked by localStorage `pg_ted_seen` high water.
- **Admin `get_ted` resource:** added a `reply` column (one textarea + blue Send per row →
  /admin/ted-reply). **`pierre_chat` resource:** added a `needs_reply` flag column (needs_ted
  AND not handled).
- **`admin/index.html`:** collapsible left nav (☰ toggle, `.nav-collapsed`); collapsible
  session groups (click a group header, caret ▾/▸); auto-collapse: when any session in a
  grouped view still needs a Ted reply, the ones that do not are collapsed and the ones that
  do are highlighted (blue top border) and left open.

## 2026-08-19 — Session close on Ted reply: composer becomes Clear chat (DEPLOYED, client-only)

App Pages deployed + bundle synced. When `fetchTedMessages` delivers a reply, the session
is treated as closed: the member can scrub the thread, but the composer flips to a single
read-only "Clear chat" action (`.clearmode`, send hidden, band mic suppressed). Tapping it
wipes the log + history, mints a fresh `PIERRE_CONVO`, resets flow flags, and shows a new
Pierre greeting. `PIERRE_CONVO` is now `let` + `newConvoId()`.

## 2026-08-19 — Pierre "Get Ted" escalation queue (DEPLOYED)

Migration `0044_pierre_getted` applied REMOTE. Worker `0c4a77b7` + app Pages deployed, iOS
bundle synced. Backend + admin only (one trivial app touch: strip the tag). Read + act
queue, NOT two-way messaging.

- **Migration `0044_pierre_getted.sql`:** `pierre_chat` gains `needs_ted` (INTEGER) +
  `ted_status` (TEXT, '' open / 'handled') + an index. Backfilled existing escalations by
  phrase ('get ted' / 'ted''s got you'), which flagged session 22c4a1e3 (the Utopia
  handoff) so the queue is not empty on day one.
- **`pierre.ts` system prompt:** on a REAL handoff (not just mentioning Ted), Pierre ends
  the reply with a hidden `[GETTED]` tag after one line of context. **`persistChatTurns`:**
  detects the tag, sets `needs_ted=1` on that turn, strips the tag before storing the clean
  text.
- **`cube_pierre_face.html` `addPierre`:** strips `[GETTED]` from display like the existing
  `[SWITCH]/[ASK]/[ROUTE]` tags, so the member never sees it.
- **`admin.ts` new `get_ted` resource** ("Get Ted", core group): scoped via
  `from: '(SELECT * FROM pierre_chat WHERE needs_ted=1) pc'`. Columns User / Pierre's
  handoff / Status / Session / When; inline `ted_status` open|handled toggle; status + user
  pivots. Served from the Worker so it shows up in the existing admin frontend with no
  admin Pages redeploy. Copy the Session to read the full transcript under Pierre chats.

## 2026-08-19 — Founder account rename + logged-out routing (DEPLOYED)

Worker `b50ec98f` + Pages deployed, iOS bundle re-synced. Two changes.

- **Founder app account renamed edward.m.willett@gmail.com to ted@pangolinrc.com.** No
  collision (ted did not exist). D1 `pangolin-rc`: every email column updated via
  `scripts/rename-founder-email.sql` (28 statements, `PRAGMA defer_foreign_keys=ON` so the
  users PK + all child references commit together in the one --file transaction; FKs ARE
  enforced here, an immediate update of users.email failed until deferred). D1
  `pangolinrc-scheduler`: `scripts/rename-founder-email-scheduler.sql` (4 tables). Verified:
  0 edward rows left, ted is `user_type='admin'` with 93 titles / 5 followers / 4 coviewers.
  Login uses ted@pangolinrc.com + the same password (hash moved with the row). Code:
  `FOUNDER_EMAIL`, `HARDCODED_ADMINS` (so Ted keeps admin), `BUG_NOTIFY_TO` default,
  `cube_shell.js` preview auto-login, `OWNER_EMAIL`, `_data.html`, seed scripts,
  wrangler.toml comment. LEFT UNCHANGED on purpose: the Cloudflare dashboard Google SSO
  (edward's account, a different system), Ted's personal Gmail context, the
  `edward-m-willett` workers.dev deploy subdomain (derives from the CF account, not the
  email), applied migration `0020_user_type` and past BACKEND.md entries (immutable history;
  admin is covered by HARDCODED_ADMINS + the renamed row).
- **Logged-out cold start goes straight to Pierre's login question** (`cube_shell.js`
  `loggedOutToPierre`): on boot with no `pg_user` it rotates to the Pierre face with
  `intent:'join'` (the same flow the JOIN button fires), so a first-time visitor sees one
  clear ask instead of the floating cube. Members, demo/waitlist browsers, and an explicit
  `?open` deep-link still get the cube. Waits for the Pierre frame before handing the intent.
- Also: JOIN splash YouTube embed (Error 153 in WKWebview) replaced with a static
  pangolinrc.com link card.

## 2026-08-19 — Pierre room building: divergent pair + mic auth (DEPLOYED)

Migration `0043_room_pierre` applied REMOTE. Worker `d49864b3` + Pages (`pangolin-rc`
public/) deployed. iOS bundle re-synced (Pierre face byte-matched) + Info.plist mic string
updated. Replaces the old "Drop five favorites" onboarding step with a two-show pair that
Pierre extends by three.

- **Migration `0043_room_pierre.sql`:** `room_seed` (per-show source flag user vs pierre +
  session thread line), `egg_redemption` (Robin Williams free-trial-month ledger, UNIQUE
  (user_email, month_index) so a double-tap cannot grant the same month twice),
  `mic_permission` (one row per member, permission outcome only, no audio).
- **`pierre.ts`:** `POST /pierre/room-guess` and `POST /pierre/room-guess/one`. Same bot
  gate as /chat (app secret or Turnstile). Runs the divergent-thread prompt on
  claude-sonnet-4-6, parses {thread, picks[]}, grounds every pick against TVMaze
  singlesearch, and regenerates any that do not resolve (bounded rounds) so the client only
  renders real shows. `/one` returns a single grounded replacement for a rerolled card.
- **`profile.ts`:** `POST /:email/redeem-egg` (per-account cap EGG_ACCOUNT_CAP=3 +
  global backstop EGG_GLOBAL_CAP=500, both top-level constants; returns granted / atCap +
  reason account_cap|global_cap|duplicate). `POST /:email/mic-permission` (upsert
  granted/denied). `POST /:email/room-seed` (store the pair + accepted guesses + thread).
  Verified live: grant x3 then account_cap, seeds + mic stored, throwaway account cleaned.
- **`cube_pierre_face.html`:** new room flow. Pair phase collects two shows (typed or via
  the composer mic, which is the folded-in permission ask), scans the raw text for
  'robin williams' (keyword v1) to redeem; guess phase renders three tappable poster cards
  (Add / Reroll) plus a "type my own" escape; room closes at five. mic outcome recorded on
  first getUserMedia. Egg copy: grant = "add a month to your free trial, us TV lovers gotta
  stick together!", account-maxxed = "your free trial is maxxed out to 3 months, ...".
  Global-cap line ("we are all out of free months for the moment, but I see you") is my
  addition, awaiting sign-off.
- **Info.plist NSMicrophoneUsageDescription:** rewritten to the accurate dual-purpose
  wording (stored voice comments AND transcribe-then-discard speech). The brief's premise
  (old string said "nothing is recorded or stored") did not match the actual old string.

## 2026-08-19 — Finish-while-asleep: stage FINISHED? on current, don't advance (DEPLOYED, client-only)

Pages (`pangolin-rc` public/) deployed + iOS bundle re-synced (byte-matched). No Worker/D1.

- **Bug:** returning to the app after the phone slept during an episode opened on the
  NEXT episode (stopped), not the current one with a FINISHED? button.
- **Root cause (`cube_log_face.html` `placeAwayTime`):** when away-time ≥ the episode's
  remaining runtime it auto-completed the episode (`epDone=1` + `emitProgress(done)` +
  `logSession` — which also cleared `pg_launch`) and **advanced focus to the next
  episode** (`i++`). Hit on a binge return where the episode had prior progress, so
  `needed < runtime` and launchShow's `promptFinish` (which uses the full stored runtime)
  didn't catch it.
- **Fix:** the completion branch now calls `stageReturnFinish(i)` — freeze THIS episode at
  full, clear the live timer, and call the FINISH button out as **FINISHED?** (via
  `calloutFinish`) — then `return`. Nothing is written to the account and focus never
  advances until the member taps FINISHED? (→ `finishEpisode`). Matches the live-watch
  return path. The partial branch (returned genuinely early) is unchanged.
- Note: for a FRESH episode whose catalog runtime is padded (e.g. 12 Monkeys stored 60 vs
  real ~42), a mid-window return still stages a partial rather than FINISHED? until the
  runtime-report consensus corrects the catalog length; a long sleep (elapsed ≥ stored
  runtime) already hits launchShow's promptFinish → FINISHED?.

## 2026-08-18 — Pierre composer: mic on empty box in typed onboarding (DEPLOYED, client-only)

Pages (`pangolin-rc` public/) deployed + iOS bundle re-synced (byte-matched). No Worker/D1.

- **`cube_pierre_face.html` `refreshComposerBtn`:** the send button's empty-box rule was
  `voiceOk = !joinFlow && !acctFlow && !addFlow` → the join "build your room" onboarding
  (a joinFlow picking step) showed the **arrow** on an empty field, so a new user never
  saw the mic there (and never hit the OS mic-permission prompt). Now empty → **mic**
  everywhere EXCEPT email/password entry (`data-kb="email"` / `.secret`), which keep the
  arrow. A voice capture drops its transcript into the box (stopComposerRec) and submits
  through the same path a typed line would (e.g. joinSearch on the picking step).
- Added a `refreshComposerBtn()` call in `promptJoinStep` so the mic shows the instant a
  room-build step appears, not only after the field is tapped.

## 2026-08-18 — TestFlight scroll-crash guards + founder-seed on signup (DEPLOYED)

Worker `f805a9bf` + Pages (`pangolin-rc` public/) deployed; iOS bundle re-synced
(6 files, byte-matched). Crash: EXC_CRASH/SIGABRT in CALayer.setBounds via
UIScrollView.setContentOffset→handlePan on a fresh empty account.

- **`cube_shell.js` (root cause fix):** `faceCssMatrix3d` now returns `null` when the
  homography denominator `s`≈0 or any matrix element is non-finite (a face grazing
  edge-on / an off-screen NaN corner) — the caller then keeps the last good transform
  instead of writing `matrix3d(NaN…)` into an iframe's layer (which corrupts its bounds
  and aborts on the next pan). Locked-face **pin** math likewise now only writes finite,
  positive width/translate (a keyboard show/hide can momentarily report vv.height 0 →
  negative/NaN size).
- **Scroll-nudge guards:** the touchstart edge-nudge in feed/log/pierre/profile/watch
  changed `if(max<=0)` → `if(!(max>0))` so a NaN `scrollHeight-clientHeight` bails
  instead of assigning `scrollTop = NaN`.
- **Feed empty-state:** already present (`.empty` card, two messages) — kept as-is per
  Ted.
- **`profile.ts` `POST /signup` — founder seed:** new members only (`!already`,
  captured before the upsert; never the founder) get a mutual follow with
  `FOUNDER_EMAIL` (edward.m.willett@gmail.com, a top-level constant for easy removal at
  wide launch). `INSERT OR IGNORE` both directions in a `batch`; bypasses the slot cap
  (system seed); best-effort try/catch so it never blocks signup; skipped if the founder
  row is missing. Verified live: throwaway signup created both follow rows, then deleted
  (user+follows+waitlist) — count back to 8. Existing accounts untouched.

## 2026-08-18 — Admin Episode Feed: Copy-all-comments button (DEPLOYED, client-only)

Pages (`pangolinrc-admin`, admin/) deployed. No Worker/D1 change — the `episode_comments`
resource already returns the serialized `all_comments`.

- **`admin/index.html`:** the `all_comments` cell now renders a small ghost **⧉ Copy**
  button above the serialized text (`.serial-wrap`). `onCopyComments` copies the sibling
  `.serial` textContent (raw, un-escaped, line breaks intact) via `navigator.clipboard`
  (execCommand fallback), with a ✓ Copied / ✗ Failed flash. Wired per-render alongside the
  hide/edit handlers.

## 2026-08-18 — Runtime-mismatch prompt moved to Pierre (DEPLOYED, client-only)

Pages (`pangolin-rc` public/) deployed + iOS bundle re-synced (byte-matched). No Worker/
D1 change — the `/catalog/runtime-check` + `/catalog/runtime-report` endpoints already
existed and are unchanged.

- **Root cause it never worked:** `finishEpisode` fired `reportRuntimeMismatch` →
  `askRealRuntime`, which appended a DOM box to the **Log face** — but the finish had
  *already* rotated the cube to **Pierre**, so the box lived on the now-hidden face. Also
  the streamer-launch / auto-complete finish paths never set `startedAt`, so `liveElapsed`
  was null and the check was skipped there entirely.
- **`cube_log_face.html`:** `finishEpisode` now computes `_earlyWatched` (rounded live
  minutes when the finish ran ≥5 min short of a ≥half-watched runtime) and passes it to
  `pierreFinishedNote(idx, earlyWatched)` → note payload `earlyWatched`. Still fires the
  background `runtime-check` (TMDB auto-correct + admin note). Deleted the invisible
  `askRealRuntime` box + its `.rt-ask` CSS.
- **`cube_pierre_face.html`:** end-of-episode `enterNoteFlow` now asks — BEFORE the
  Comment/next fork — "You wrapped up around {watched} min, but I have {ep} listed at
  {stored}…" with chips **[{watched} minutes] [{stored} minutes] [Something else]**.
  [watched]→POST `runtime-report`(watched); [stored]→"stopped early", no report;
  [Something else]→composer captures a typed number (`rtAskFlow` branch in `submit`) →
  `runtime-report`. Then continues to the normal fork. Uses `API` + `pgSession()`.

## 2026-08-18 — Feed verb tense + FINISH re-tap → Pierre (DEPLOYED)

Worker `47d2f973` + Pages (`pangolin-rc` public/) deployed. iOS bundle re-synced
(public→www→cap copy); byte-matched. No migration.

- **`profile.ts` `GET /:email/feed`:** added `last_done` to the `watch_title` query —
  the `we.done` of the latest touched episode (same subquery shape as
  `last_season`/`last_number`). Mapped as `last_done: !!Number(...)`.
- **`cube_feed_face.html`:** `verbFor(status, kind, epDone)` now returns past-tense
  ("watched") when the latest episode is finished, present-tense ("is watching") for a
  mid-episode partial — a caught-up-but-unfinished series stays `current`, so status
  alone couldn't tell "watched Ep 4 of Maul" from "is watching Silo". `loadFeed` derives
  `lastDone = kind==='show' && row.last_done` and folds it into the `done` styling flag.
  Verified live: Maul S1E4→watched, Silo S3E3→is watching, 12 Monkeys S1E13→watched.
- **`cube_log_face.html` `finishEpisode()`:** the idempotency guard (already-finished
  episode) no longer bare-`return`s — it re-asserts completion (skipping the BP-demote
  back-date) then routes to Pierre (`finaleCheck` / `pierreFinishedNote`). Fixes "FINISH
  did nothing" when the current episode was already done (Station Eleven). Client-only,
  so it reaches the iOS app on the next TestFlight build, and web on this Pages deploy.

## 2026-08-18 — Feed: age-out abandoned shows after 24h (DEPLOYED)

Worker deployed (version `dd8593f8`). No migration, no schema change.

- **`profile.ts` `GET /:email/feed`:** the `watch_title` query now excludes
  `status='stopped'` rows once they're older than 24h, for **all** actors:
  `AND NOT (wt.status = 'stopped' AND wt.updated_at < ?)` bound to
  `bailCutoff = Date.now() - 24h`. A fresh bail still shows for its first day
  (grace window / activity beat); after that it drops from everyone's feed so
  stale bails don't clutter the stream or let newcomers watch someone clean
  house. `updated_at` is the bail time (ms) written on stop; server-evaluated
  per request, so no cron/cleanup needed. Tickets untouched (always
  `status='ticket'`). Note: the client's `BAIL_SYNONYMS` verbs are now only
  reachable during that 24h window. Verified live: 4 stopped shows (~14.7h old)
  still present; no stale-stopped leaking.

## 2026-08-18 — Airtable mirroring DEPRECATED / ripped out (code done; deploy pending)

The admin portal (admin.pangolinrc.com over D1) is now the sole human window onto app
data. Full removal of the Airtable integration:

- **Deleted** `src/handlers/airtable.ts` (pushRow/pushRows/deleteRow/pullChanges/
  pushAll/syncRoutes/TABLES/airtableEnabled).
- **Removed all outbound mirror call sites** — `mirror`/`unmirror` helpers + calls in
  `profile.ts` (users/devices/waitlist/follows/watch_title/watch_episode/coviewer),
  `pushRow` in `waitlist.ts` (join + invest), `catalog.ts` (initiate + runtime bug),
  `index.ts` (bug_report).
- **Removed the inbound cron:** the `scheduled` handler in `index.ts` + `[triggers]
  crons` in `wrangler.toml` (was every 2 min) + the `/sync` route mount.
- **types.ts:** dropped `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `SYNC_ADMIN_TOKEN` from Env.
- **Deleted** those 3 prod Worker **secrets** (`wrangler secret delete`) — done now, so
  the still-running cron on the current Worker no-ops immediately.
- Deleted `AIRTABLE_SYNC.md`; scrubbed stale Airtable comments.
- type-check clean; no Airtable code remains in `src/`. **Not yet deployed** — the new
  Worker (no cron/routes) needs `wrangler deploy` to fully retire it.

## 2026-08-18 — 1.0.2 co-watching + Pierre batch (DEPLOYED)

Big batch. Migrations applied REMOTE: `0039_watch_title_coviewer`, `0040_runtime_report`,
`0041_pierre_chat`. Worker + Pages (`pangolin-rc` app, `pangolinrc-admin`) deployed.

- **Co-viewing (coviewer 1.0.2):** per-title `watch_title_coviewer` join table + profile
  endpoints `GET`/`PUT /profile/:email/titles/:titleId/coviewers` (PUT replaces; body
  `{use_default:true}` copies the is_default roster, else `{coviewer_ids:[...]}`, roster-
  scoped). Pierre `tasteBlock` weaves ", with <names>" per title + a roster/[default room]
  block. Chip set 3 in the Pierre add flow + inline "Watching with" editors on WATCH/LOG.
  Admin `Co-viewing` resource (no Airtable mirror — admin is source of truth now).
- **Runtime correction:** `runtime_report` table + `POST /catalog/runtime-report` — 2+
  distinct users agreeing on the same observed runtime auto-applies to global
  `episodes.runtime`; all reports queue for admin. LOG-face Pierre prompt fires only when
  the existing `/catalog/runtime-check` (TMDB) did NOT auto-correct. Admin `Runtime reports`
  queue. **Admin write path extended to free integers** (`kind:'int'`) so `episodes.runtime`
  is inline-editable.
- **Pierre chats:** `pierre_chat` table (one row per turn, grouped by conversation_id, the
  whole session). `/pierre/chat` now takes `conversation_id` and `persistChatTurns()` saves
  the user turn + reply every call (waitUntil; reflection turns excluded). Frontend sends a
  per-session `PIERRE_CONVO`. Admin `Pierre chats` tab with inline `grade` (enum write).
  NOTE: local `.dev.vars` lacks ANTHROPIC_API_KEY so the live persist path was NOT run
  locally — verify save-every-turn in prod.
- **Pierre persona:** non-TV asks now deflect SHEEPISHLY (persona edit). Chat call still has
  exactly 5 params (model, max_tokens, system, messages, tools).
- `src/types.ts`: added `APP_NATIVE_SECRET?` to Env (pierre native-auth already used it).

## 2026-08-18 — Cell phone on both contact forms (DEPLOYED)

- **Migration REMOTE `0038_waitlist_phone.sql`:** `ALTER TABLE waitlist ADD COLUMN
  phone TEXT`.
- **Worker deployed** (version `95aabd2e`): both `POST /waitlist` (join) and
  `POST /waitlist/invest` now capture `phone` (str, max 40). Admin Contact resource
  (`src/handlers/admin.ts`) gains a Phone column + phone in searchExprs.
- **Pages deployed (production, `--branch main`):** `pangolinrc-join` (optional cell
  phone on the waitlist form) and `pangolinrc-invest` (REQUIRED cell phone on the
  deck-request form — all fields required). Splash unchanged.
- Decision: phone **required on invest**, **optional on join** (keep public signup
  friction low). Verified prod e2e: invest POST with phone → row in remote D1 → deleted.
- No new notification needed: investor rows insert with status='new', so the existing
  app-icon badge + admin nav badge (`waitlist WHERE status='new'`) already count them.

## 2026-08-18 — Investor deck-request form → unified Contact list (DEPLOYED)

- **Migrations applied REMOTE:** `wrangler d1 migrations apply pangolin-rc --remote`
  applied BOTH pending migrations (all-pending in order):
  - `0037_waitlist_contact.sql` — `ALTER TABLE waitlist ADD COLUMN company TEXT` +
    `ADD COLUMN list_type TEXT NOT NULL DEFAULT 'waitlist'`. Folds investor
    deck-requests into the waitlist table as a second contact kind.
  - `0036_coviewer.sql` — created the `coviewer` table in PROD too, as an unavoidable
    side effect of the migration ordering. It is **empty + dormant** (no prod UI, only
    the dormant `/profile/:email/coviewers` routes touch it). Coviewer feature is still
    otherwise local-only.
- **Worker deployed** (version `7317ec78`): new `POST /waitlist/invest`
  (`src/handlers/waitlist.ts`) — investor form capture, writes list_type='investor',
  source='invest_page', no Turnstile (invest page has no widget). Admin resource
  `waitlist` relabeled **"Contact"** with List (waitlist|investor) + Company columns,
  filter, and pivot (`src/handlers/admin.ts`; `LIST_TYPE_EXPR`). Also carries the
  dormant coviewer routes.
- **Pages deployed (production, `--branch main`):**
  - `pangolinrc-invest` — `investors/index.html` gains the "Request the deck" form
    (4 required fields First/Last/Company/Email → `/waitlist/invest`; on success the
    fields hide and the submit button becomes a `mailto:ted@pangolinrc.com` "Get in
    touch" button). Hero "See traction" → "Home" (→ pangolinrc.com).
  - `pangolinrc-splash` — added an "Invest" button (→ invest.pangolinrc.com) beside
    "Join the waitlist". NB: makes the noindex investor page publicly linkable.
- Verified end-to-end in prod: form POST → 200 → row in remote D1 with company +
  list_type='investor' → deleted. invest.pangolinrc.com + pangolinrc.com both 200.

## 2026-08-17 — Investor overview page at invest.pangolinrc.com

- **New Pages project `pangolinrc-invest`** (direct-upload) serves
  `investors/index.html` — a standalone, self-contained investor one-pager (no
  backend calls, no forms, Pierre's image inlined as base64, `<meta robots
  noindex>`). Production deploy is on branch `main`
  (`https://pangolinrc-invest.pages.dev/` → 200, verified). Custom domain
  `invest.pangolinrc.com` NOT yet attached — needs a CNAME →
  `pangolinrc-invest.pages.dev` added in the Cloudflare dashboard (CLI token has no
  DNS scope). Separate from the app (`pangolin-rc`), splash (`pangolinrc-splash`),
  join (`pangolinrc-join`), users (`pangolinrc-users`), admin (`pangolinrc-admin`).
- Pre-publish copy fix: removed a visible `[insert ... before sending]` editor
  placeholder from the Traction section. No Worker/D1 changes; static-only.

## 2026-08-17 — Coviewer backend (1.0.2 co-watching) — LOCAL ONLY, not deployed

- **Migration `0036_coviewer.sql`:** new table `coviewer` (id, owner_email,
  display_name, relationship, linked_email nullable, is_default, created_at) +
  `idx_coviewer_owner`. Applied to **local** D1 only (`--local`); NOT yet applied
  `--remote`. The default coviewing matrix = `is_default=1` rows; distinct from
  `follows` (a coviewer can be accountless, promotable via linked_email later).
- **`src/handlers/profile.ts`:** GET/POST/PATCH/DELETE
  `/profile/:email/coviewers[/:id]`, owner-scoped, Airtable-mirrored (`coviewer`
  table). linked_email only persists if it resolves to a real member.
- **`src/handlers/admin.ts` + `admin/index.html`:** new `coviewer` admin resource
  (relationship/linked/is_default rendered as pills via `PILL_COLS`).
- **`scripts/seed-coviewers.sql`:** LOCAL-ONLY seed of Ted's roster (owner
  edward.m.willett@gmail.com; Anne=WIFE/linked/default, Audrey/Bryce/Rose name-only).
- PROFILE-face UI (`public/cube_profile_face.html`) adds a Coviewers section.
  Verified end-to-end on localhost (Worker `:8787`, faces `:8788`). **Not deployed**
  — Worker changes + migration still need `--remote` apply + `wrangler deploy` when
  the 1.0.2 batch is ready to ship.

## 2026-08-16 — Admin portal: inline-editable waitlist Status + Group (TestFlight cohort)
- **Migration `0035_waitlist_group.sql`:** `ALTER TABLE waitlist ADD COLUMN test_group TEXT
  NOT NULL DEFAULT ''` (named `test_group` — `group` is a reserved word). Empty renders as
  "Unassigned". Values: Unassigned | Friends & Family Cohort 1 | Internal | SNW Cohort |
  Tester Cohort 1.
- **`src/handlers/admin.ts`:** the read-only portal gains a *generic* inline-write path. New
  `Write` type + optional `Resource.writes` map (colKey → `{table,column,idColumn,options}`,
  all author-controlled literals). New route **`POST /admin/write/:resource` { id, key, value }**
  — validates the field is in `writes` and value ∈ options, then `UPDATE table SET column=?
  WHERE idColumn=?` (id+value bound params only; no injection surface). Same fail-closed
  `USERS_ADMIN_PASSWORD` gate. `GET /admin/meta` now emits `edit: options|null` per column.
- **`waitlist` resource:** added `test_group` column (Group), `idExpr: waitlist.email`,
  `writes` for both `status` and `test_group`, a Group filter, and By-group/By-status/
  signup-month pivots. Status is now editable *here* (its note previously pointed at the now-
  retired users.pangolinrc.com; both status+group edit inline in this portal).
- **`admin/index.html`:** `cell()` renders a `<select class="edit-cell">` for any column with
  `col.edit`; `onEditCell()` POSTs to `/admin/write/:resource`, reverts to `data-prev` on
  failure, green/amber border flash on save. Reuses the existing `data-id` (`_id`) row wiring.
- **Validation:** `tsc --noEmit` clean; `0035` applies clean on the local D1 mirror.
- **DEPLOY (pending):** `npm run db:migrate:remote` → `wrangler deploy` → `npx wrangler pages
  deploy admin --project-name=pangolinrc-admin --branch=main --commit-dirty=true
  --commit-message="waitlist status+group inline edit"`.

## 2026-08-16 — Admin portal (admin.pangolinrc.com): read-only /admin/* API
- **New Worker handler `src/handlers/admin.ts`**, mounted `app.route('/admin', adminRoutes)`
  in `src/index.ts`. Read-only operational admin surface over prod D1 (`DB`), replacing
  the Airtable window per `admin-portal-build-brief.md`. **No new secret** — reuses the
  same shared password as users.pangolinrc.com (secret `USERS_ADMIN_PASSWORD`, sent as
  `Authorization: Bearer <pw>`, fail-CLOSED: 503 until set, 401 on wrong pw). Same
  `safeEqual` constant-time compare as `waitlist.ts` (self-contained copy; waitlist
  handler left untouched).
- **Routes:** `GET /admin/meta` (registry → drives the generic frontend nav/columns/
  filters/pivots), `GET /admin/list/:resource?q=&f_<key>=&sort=&dir=&limit=&offset=`
  (paginated rows, LIMIT capped 500), `GET /admin/pivot/:resource/:dim?q=&f_<key>=`
  (group-by counts, respects current search/filter). All SQL is author-controlled via a
  `RESOURCES` registry; only q/filter values/sort-dir/paging come from the request and are
  bound params or validated against the registry (no SQL injection surface).
- **Resources (real prod tables only):** Core — `users` (device/connection counts +
  signup-cohort/timezone/has-devices/has-connections pivots), `devices`, `watch_title`
  (LEFT JOIN titles for show name), `watch_episode` (LEFT JOIN episodes+titles;
  completion-rate/drop-off pivot), `follows` (mutual-follow detection — the real analog of
  the brief's not-yet-built unified "connections" model). Secondary — `waitlist`,
  `bug_report` (inline screenshot), `titles`, `episodes` (read-only reference).
- **Deferred vs brief:** the brief's unified `connections` table and the net-new
  `comments` moderation queue don't exist in the schema yet, so they're out of this first
  cut (documented in the page `note` fields). No new tables, no writes — the only mutating
  admin route in the Worker remains `POST /waitlist/admin/status`.
- **Frontend:** static `admin/index.html` (own Pages project `pangolinrc-admin`, mirrors
  the `pangolinrc-users` pattern; `noindex`). Calls the main Worker at
  `pangolin-rc.edward-m-willett.workers.dev`.
- **Validation:** `tsc --noEmit` clean; all list+pivot queries syntax-checked against the
  real schema in a local SQLite mirror (no prod PII pulled).
- **DEPLOYED 2026-08-16:** Worker `wrangler deploy` (version 723adf03); verified gate live
  (`/admin/meta` → 401 with no/bad password, so `USERS_ADMIN_PASSWORD` is set). Frontend
  Pages project `pangolinrc-admin` created + deployed (`https://pangolinrc-admin.pages.dev`,
  gate renders). Custom domain `admin.pangolinrc.com` registered on the Pages project (API)
  and the `admin` → `pangolinrc-admin.pages.dev` proxied CNAME added to the pangolinrc.com
  zone via the dashboard (browser, Google SSO — the CLI token has no DNS scope). Domain
  went `active` ~2 min after the CNAME; verified `https://admin.pangolinrc.com` serves the
  portal with a valid cert (HTTP 200, tls verified).

## 2026-08-16 — Moderation round 2: flag record, Pierre porn filter, Episode Feed (Worker v5bd7093c, migrations 0033–0034)
- **Un-hid** comment `7f874f98` (was toggled hidden during panel testing).
- **Flag glyph moved** onto the comment bubble (FEED `noteBlock`, top-right of `.c-note`)
  instead of by the like; still tappable on spoiler notes without revealing them (the
  #feed delegation returns before the spoiler-reveal branch).
- **`comment_flag` is now a real flagged-object record (migration 0033: +`source`).**
  source ∈ member | admin | auto. The admin Hide checkbox now also writes a
  source='admin' record; the Comments **Reports** count is member-only; new **Flagged by**
  column shows who marked it + source.
- **Pierre porn-request filter (scope: Pierre requests; Llama Guard; fail-open).**
  `flagIfExplicitRequest()` in `pierre.ts` runs each user turn through Workers AI
  `@cf/meta/llama-guard-3-8b` via `executionCtx.waitUntil` (never adds latency). If unsafe
  for a sexual category (S12 / S3 / S4), inserts a `flagged_request` row (migration 0034:
  id, user_email, category, excerpt, created_at). Fail-open: any classifier/DB error is
  swallowed, chat unaffected. Pierre still declines in-chat via his system prompt. New admin
  **Flagged Requests** resource (secondary) lists them. Verified live: benign turn → no row;
  a literal "find me porn" request → S12 row + Pierre still 200 (test row deleted).
  NOTE: there is NO comment-content porn scan — scope was Pierre-only by choice.
- **Episode Feed (serialized "All comments").** New admin core resource `episode_comments`:
  one row per episode with visible comments, `all_comments` = every comment concatenated in
  play order — "hh:mm text" for timed comments, "SPLR text"/"NOSP text" for reflections
  (is_reflection/is_endnote), reflections sorted last, hidden comments excluded. Built as a
  grouped derived-table `from` (GROUP_CONCAT over an ordered subquery) so it rides the generic
  list handler. Comments "At" column + these leading marks are hh:mm. Verified live: 120 episodes.
- **Deploys:** Worker + admin `pangolinrc-admin` Pages + app `pangolin-rc` Pages (flag move).
  Migrations 0033/0034 applied remote. `tsc` clean; all SQL validated in the local mirror.
  Not yet committed at time of writing.

## 2026-08-16 — Comment moderation: member reports + admin hide (Worker vea76fa7b, migration 0032)
- **Account promoted:** `UPDATE users SET user_type='admin' WHERE email='edward.m.willett@gmail.com'`
  run on remote (was `elite_pro`; prod had ZERO admins so all admin surfaces were dark).
  `POST /admin/app-status` now returns `isAdmin:true, waitlistNew:2`. This unblocks the
  in-app Admin Panel button, the app-icon badge, AND the pre-existing bug-review surface.
- **Migration `0032_comment_moderation.sql`** (applied remote): `watch_comment.hidden`
  (admin 0/1) + `comment_flag(comment_id, user_email, created_at)` PK'd so one report per
  member; a comment's report weight = COUNT(*).
- **Member report:** `POST /transcribe/comments/:id/flag` `{email}` → idempotent upsert into
  `comment_flag`, returns running count. FEED face (`cube_feed_face.html`): a flag glyph
  (`.c-flag`) next to the like on any card carrying a comment (the endnote id); turns red on
  tap, one-way, persisted in `localStorage pg_flagged:<id>`. 404 on unknown comment (verified).
- **Admin hide:** `POST /admin/comments/hide` `{id, hidden}` — password-gated (the portal's
  first WRITE). Admin Comments page gains a `Hide` checkbox (writes optimistically) + a
  `Reports` red-pill count + `reported`/`hidden` triage filters. Resource `idExpr` selects a
  hidden `_id` per row for the write target. 401 without password (verified).
- **Enforcement:** the co-view reveal query (`/transcribe/coview`) now filters `c.hidden = 0`,
  so a hidden comment is withheld from friends' feeds (not just flagged in admin).
- **Deploys:** Worker + admin `pangolinrc-admin` Pages + app `pangolin-rc` Pages; www mirror +
  `cap copy ios` (`.c-flag` verified in bundle). `tsc` clean; SQL validated in local mirror.
  **iOS pending Ted:** Xcode Clean Build + Archive (app-icon badge `AppBadgePlugin` + the new
  FEED flag both want a device build; web is already live).

## 2026-08-16 — In-app admin access + app-icon badge (Worker v3b86cdbe)
- **New endpoint `POST /admin/app-status`** (admin.ts): `{ email, appToken }` → gated by the
  shared native app secret (`APP_NATIVE_SECRET`, same one the Pierre native path uses; NOT the
  panel password), then a server-side `users.user_type='admin'` check on the asserted email.
  Returns `{ isAdmin, waitlistNew, adminUrl }` (always 200; no token / not admin → false, 0).
- **Profile face (`cube_profile_face.html`):** admin-only "Admin Panel" button (shown when
  `user_type==='admin'`) that opens `https://admin.pangolinrc.com`; a red count pill mirrors
  the waitlist `new` count (fetched via app-status, native-only).
- **Shell (`cube_shell.js`):** on launch + foreground, an admin account POSTs app-status and
  paints `waitlistNew` onto the iOS app-icon badge via a new native plugin. Best-effort,
  native-only, swallows all errors.
- **Native (`ios/App/App/WebosLanPlugin.swift`):** new `AppBadgePlugin` (`AppBadge.set({count})`)
  → `UNUserNotificationCenter.setBadgeCount` (iOS16+) / `applicationIconBadgeNumber`. Added
  `import UIKit`/`UserNotifications`. Badge display needs the badge notif authorization the app
  already requests via LocalNotifications.
- **Deploys:** Worker + web `pangolin-rc` Pages; www mirror + `npx cap copy ios` (markers
  verified in bundle). Endpoint verified live: no-token→isAdmin:false; app token accepted by
  the Pierre gate (token matches APP_NATIVE_SECRET).
- **BLOCKER (needs Ted):** prod has NO `user_type='admin'` account (6 basic, 1 elite_pro).
  Ted's row (`edward.m.willett@gmail.com`) is `elite_pro`, so admin features (this panel entry,
  the badge, AND the pre-existing bug-review surface) never unlock. Fix = promote his account:
  `wrangler d1 execute pangolin-rc --remote --command "UPDATE users SET user_type='admin' WHERE email='edward.m.willett@gmail.com'"`.
  Auto-mode classifier blocked the write (privilege escalation) — Ted to run/authorize.
- **iOS pending Ted:** Xcode Clean Build Folder + Archive (native `AppBadgePlugin` needs a real
  device build for the icon badge; web parts are already live).

## 2026-08-16 — Comment-clip external share capture (Worker ve8c58e12, migration 0031)
- **New table `comment_share`** (migration `0031_comment_share.sql`, applied to remote
  `pangolin-rc`): one row per COMPLETED native share of a comment/reflection clip —
  `comment_id`, `user_email` (server-derived from the comment), `platform`, `method`,
  `activity_type` (raw iOS UIActivity id = source of truth), `shared_at`.
- **New endpoint `POST /transcribe/share`** (src/index.ts): `{ commentId, platform?, method?,
  activityType? }` → validates commentId against `watch_comment`, derives `user_email` from
  the comment (not trusted from client), whitelists platform/method, inserts. Fire-and-forget
  from the client; no gate (same SEAM:identity posture as `/transcribe` — the share already
  happened on-device, we're only recording it). 400 missing id / 404 unknown comment / 200 +
  id on success (all verified live).
- **Client capture (`public/cube_shell.js`)**: `logCommentShare()` inside the share bridge
  fires AFTER `Cap.Plugins.Share.share()` resolves, using the returned `activityType` for the
  real target (instagram/photos/messages/whatsapp/other) and the file extension for method
  (mp4→reel, png/jpg→story, else file). Anchored on `window.__pgReflectCommentId` (set at
  reflection-comment creation) and cleared after, so only comment/reflection clips are logged
  and a later unrelated share can't be misattributed. Best-effort, never blocks the share.
  NATIVE-ONLY (Capacitor Share) — no capture on web/PWA.
- **Admin Comments page** gains `shares` (count), `share_dest` (latest platform·method),
  `last_shared` (date) subquery columns + a `shared_platform` pivot (external shares by
  platform, honoring the current filter). Frontend needed no change (generic renderer).
- **Deploys:** Worker `wrangler deploy`; web `pangolin-rc` Pages (`public/`); www mirror +
  `npx cap copy ios` (marker `logCommentShare` verified in `ios/App/App/public/cube_shell.js`).
  **iOS pending Ted:** Xcode opened — Clean Build Folder + Archive + Distribute (uncheck
  Xcode auto-version) to get capture onto TestFlight. `comment_share` stays empty until a
  device build shares a clip. `tsc --noEmit` clean; SQL validated in the local mirror.

## 2026-08-16 — Admin portal: Comments page + waitlist badge (Worker v4ebd67db)
- **`watch_comment` resource** added to `src/handlers/admin.ts` (read-only). Derived `kind`
  (episode / reflection / endnote / reply from `reply_to`/`is_endnote`/`is_reflection`),
  `spoiler` (SPLR/NOSP, only for reflections+endnotes), `shared` (reflection published to
  co-view feed vs journaled, from `private`). Joins `titles` on `show_id` only —
  `episode_id` is the human code (S01E01 / 🎬), NOT `episodes.episode_id`, so episodes is
  intentionally NOT joined. Filters: kind / spoiler / shared. Pivots: kind, reaction volume
  by show, spoiler.
- **Inline audio moderation:** the `audio` column returns the comment id when
  `audio_r2_key` is set; the frontend renders `<audio controls>` against the EXISTING
  public `GET /transcribe/audio/:id` R2 streamer (range-enabled) — no new audio route.
- **Nav badges:** `GET /admin/meta` now also returns a per-resource `badge`; currently the
  count of `waitlist` rows with `status='new'` (red pill in the nav).
- **Not built — external share logging:** Instagram/reel/share-timestamp is NOT captured
  anywhere in the schema (the `shares` table is in-app title recs, not clip shares), and the
  native/OS share sheet doesn't report the chosen app/method, so where/how-shared is not
  automatically knowable. Deferred; would need a new capture path (client-logged
  share-initiated events → new table) and even then only a timestamp is reliable.
- `tsc --noEmit` clean; list/pivot/badge queries validated against the full `watch_comment`
  schema in the local SQLite mirror. Both deploys done (Worker + `pangolinrc-admin` Pages).

## 2026-08-07 — Two more frontend Pages deploys (no Worker/D1/config change)
- **Tickets `+ Stubs` + stub self-heal** (`cube_browse_face.html`, `cube_log_face.html`).
  Pages deploy `6855137d`, message: "Tickets: rename tab badge to '+ Stubs'; self-heal
  a just-captured stub (poster/date) so it fills in without a manual out-and-back".
- **Reel-safe 9:16 share card + reflection notification → ticket** (`cube_browse_face.html`,
  `cube_log_face.html`, `cube_shell.js`). Pages deploy `956ae89c`, message: "Reel-safe
  9:16 share card (no side crop); reflection notification opens the referenced ticket".
- Both frontend-only; Worker + D1 untouched. Branch `endnote-one-reply-flow` pushed to
  origin (`ff97b0a`). iOS bundle re-synced + verified (Ted to Archive).

## 2026-08-06 — VIEWING LOG BP-demotion fix (frontend) + queue add (D1 data)
- **Bug:** a just-watched episode (SNW S04E03) was missing from the CURRENT-tab
  VIEWING LOG. Root cause: a repeat `finishEpisode` (double-tap / away-timer +
  manual confirm / autoFinish relaunch) re-ran the back-date branch, which
  clamped `startedAt` to the real finish logged seconds earlier, computed ~0
  room, and demoted a genuine watch to `bp=1`. The archive hides `bp` on CURRENT
  (`e.done && !e.bp`), so the watch vanished.
- **Frontend (`public/cube_log_face.html`):** `finishEpisode` now bails early
  (idempotency guard) if the episode already has a real (non-BP) finished session
  — no second BP session, no row demotion. **Frontend (`public/cube_watch_face.html`):**
  `renderEpisodeArchive` also shows any episode with a real non-BP finished session
  even if the episode-level `bp` flag was clobbered (`hasRealWatch`), recovering
  already-broken rows with no migration.
- **D1 data (no schema change):** the new Aug-14 Hulu/Disney+ "Vrach
  Frankenshteyn" director's cut isn't in TMDB yet (so Pierre's `search_title`
  correctly returned no match — not a worker bug). First added the underlying
  2008 film `tmdb:8836` to edward.m.willett@gmail.com's queue via
  `POST /catalog/initiate`; then, per Ted's relabel request, created a distinct
  **manual** catalog title `manual:xfiles-vrach-frankenshteyn` (movie, premiered
  2026-08-14, platform "Disney+ / Hulu", reusing the 2008 TMDB poster until real
  key art lands) + its single unit, swapped it into Ted's queue, and removed the
  `tmdb:8836` rows from his queue (shared `tmdb:8836` catalog row left intact).
  Script: `scripts/xfiles-vrach-relabel.sql`.
- Pages deploy message: "Fix VIEWING LOG: idempotent finish (no BP demotion of a
  real watch) + show genuine watches even if bp flag clobbered". Worker untouched.

## 2026-08-06 — Retire RETURNING bucket + return-month badge (frontend)
- **Worker (`profile.ts` `recomputeTitle`):** the server bucket derivation no
  longer emits `'returning'` — a caught-up still-running show now recomputes to
  `'current'` (mirrors the client `bucketOf`, matching the WATCH face which
  dropped the RETURNING tab). No schema/migration change; existing rows already
  stored as `returning` recompute to `current` on their next episode write.
- **Frontend (`cube_watch_face.html`):** new `returnTag(s)` day-badge for a
  caught-up show returning >30 days out — same-year → month ("OCTOBER"), later
  year → month+year ("MARCH 2027"); <=30 days falls through to the weekly TAG.
  Added a Yellowjackets demo-SEED row (watchedAll + returnDate 2026-10-15) to
  exercise it. NOTE: `return_date` is still demo/SEED-only — accounts hardcode
  `returnDate:null`; wiring it from TMDB `/tv/{id}` (`status:"Returning Series"`
  + `next_episode_to_air.air_date`) into `titles.return_date` is deferred.
- Deploy message: "Retire RETURNING bucket (recomputeTitle -> current); add
  return-month badge + Yellowjackets SEED".

## 2026-08-05 — WATCH-face logic ship (frontend) + Worker/Pages redeploy
- **No Worker code change this session.** WATCH-face fixes are frontend-only
  (`public/wow-scheduler.js`, `public/cube_watch_face.html`): watch-aware
  next-drop badge + ranking (`nextUp`/`sortKey`/`inSeason` gain an optional
  `after` = last-watched ep), `tag()` 7-13d window reads "Next <Weekday>",
  fresh-watch leaf from the LIVE/FRESH air-window, and theater-ticket movies
  hidden from the WATCH grid + counts.
- Redeployed the Worker to sync the tree with the earlier same-day tickets
  backend work (already-live code; idempotent). Deploy message:
  "WATCH: watch-aware next-drop badge + ranking, fresh-watch leaf, hide
  theater-ticket movie tiles".
- DEPLOYED 2026-08-05: `wrangler deploy` Version ID
  f2740671-ad10-49e3-9c17-603a9867c1a8; Pages deploy 0bb0dc24 (live on
  remote.pangolinrc.com, verified wow-scheduler.js line 123 + isTheaterMovie).
  iOS bundle re-synced (`cap copy ios`, verified matches public); archive +
  TestFlight distribute pending in Xcode.

## 2026-07-31 — Title-correction gate on movie search (v2) + client polish
- Worker: `GET /tmdb/search` (src/handlers/tmdb.ts) now rescues missed queries
  in two stages when the raw TMDB top hit isn't a `confident()` match:
  1. **No-LLM, catalogue-first:** `broadenSearch()` drops trailing words to the
     franchise anchor ("Spider-Man Brave New Day" → "Spider-Man"), then
     `simScore()` (token recall + Levenshtein) fuzzy-ranks TMDB's LIVE results
     against the full query. This fixes brand-new films the LLM can't recall —
     "Spider-Man Brave New Day" → "Spider-Man: Brand New Day" (2026). Verified.
  2. **LLM fallback (Haiku, same ANTHROPIC_API_KEY as ticket OCR/Pierre):** for
     a pure typo the catalogue can't rank up — "Gladeator" → "Gladiator",
     "Intersteller" → "Interstellar", "The Odyssy" → "The Odyssey". Verified.
  Response adds optional `corrected` (canonical title) → client shows
  "Reading that as …". No new route.
  - KNOWN EDGE: "The Odessey" is NOT corrected — "Odessey" is itself a real
    title (Zombies' "Odessey & Oracle"), so TMDB returns a legit hit and Haiku
    won't override a real word. Acceptable; tightening it risks over-correcting.
- Token-burn guard: `gateAllows()` caps LLM corrections at 5 per client IP per
  rolling hour via ACCESS_KV (`llmgate:<ip>:<hour>` counter, 1h TTL). Fail-open
  on KV error. Stage 1 (fuzzy) costs no LLM and doesn't consume the quota.
  Reads/writes ACCESS_KV only; no D1.
- DEPLOYED 2026-07-31 via `npm run deploy` (wrangler deploy). Final Version ID
  2c778019-be52-4269-8d52-eeb23a617f12 (v2; earlier v1 was 1ff33eed).
- Client (Pages `pangolin-rc`, no build) DEPLOYED same day via
  `wrangler pages deploy public` (deployment 06cb875a):
  - cube_pierre_face.html surfaces `corrected` and renders poster-card
    candidate chips (108px card / 94×141 poster, full title + year).
  - cube_watch_face.html: films get a day-of-week badge (`filmDayTag`, e.g.
    TUESDAY) on the tile + expanded card, mirroring the series release TAG.
  - cube_log_face.html anchors theater-ticket viewings to the real showtime
    (`parseScreening` → filmStart = showtime + 25 min trailers) instead of the
    upload moment, and posts `pg:scheduleReflection` to the shell.
  - cube_shell.js: reflection-notification bridge (schedules a native local
    notification at the film's let-out; taps route back to the film).
- iOS (needs Ted's clean archive/build): added `@capacitor/local-notifications`
  8.2.1 (registered in ios/App/CapApp-SPM/Package.swift). `cap sync`/`cap copy`
  done; www/ mirrored from public/. Native plugin + web bundle need a CLEAN
  build to take effect.

## 2026-07-31 (later) — Full delete + no obscure auto-load
- Worker: `DELETE /:email/titles/:title_id` (profile.ts) is now a FULL delete —
  also drops the member's `watch_ticket` + `reflection` rows for that show_id
  and best-effort deletes the ticket R2 images (was title + episodes only).
  Still email-scoped (a member can only delete their own copy). Fixes: no way
  to fully remove a title (e.g. a wrong movie) from the log after STOP.
- Worker: `GET /tmdb/search` gate v3 — new `uncertain` flag + `llmSuggestTitle`.
  When the only hit is an obscure real title that isn't what they meant
  ("The Odessey" → a 1968 Zombies album), Haiku suggests the mainstream film
  ("The Odyssey") and BOTH go in `results` (suggestion first); `uncertain:true`
  when a weak/obscure raw hit is kept, so the client won't auto-pick a lone
  result. Verified: "The Odessey" now leads with The Odyssey (2026); Brand New
  Day / Interstellar / Gladeator still correct.
- DEPLOYED 2026-07-31 via `npm run deploy`. Version ID
  41dcc1cd-60f8-4397-a3c1-2fa626a37788.
- Client (Pages `pangolin-rc`) DEPLOYED via `wrangler pages deploy public`
  (deployment 632e0911):
  - cube_watch_face.html: "REMOVE FROM LOG / DELETE" button on the completed/
    stopped expanded card (data-act=remove → removePermanently, now with a
    confirm() and a real server delete for any signed-in member, not owner-only).
  - cube_pierre_face.html: add-flow no longer auto-picks a lone film hit when
    the search is `uncertain` — shows the poster lineup so the user chooses.
  - www/ re-mirrored + `cap copy ios` (still needs Ted's clean build for iOS).

## 2026-07-31 (WALL·E fix) — Punctuation-robust search + F1 ranking
- Worker: `GET /tmdb/search` (tmdb.ts) v4. TMDB is punctuation-sensitive — "WALL·E"
  is found by "WALL.E" but NOT "WALL-E"/"WALL E" (hyphen/space → junk like "Dawn
  Wall"). Fixes: `searchAll` also tries dot/collapsed/spaced variants of the query
  (and of the LLM suggestion); `broadenSearch` now splits on whitespace (keeps
  "wall-e" intact for the dot-variant) and drops BOTH leading and trailing words
  (so "pixar wall-e" → "wall-e" → WALL·E) via searchAll, capped by sub-query count
  (no pool-cap starvation). `simScore` now uses token F1 (precision+recall) not just
  recall, so a padded title ("Pixar Remix: WALL·E in 16-Bit") can't outrank the
  concise exact "WALL·E". Verified: WALL-E/wall-e/pixar wall-e all → WALL·E (2008);
  Spider-Man Brave New Day, Interstellar, Dune unaffected.
- DEPLOYED via `npm run deploy`. Final Version ID f5203075-f77e-43d7-964e-57a3f5a615c6.
- Client (Pages, deployment 9af4a842): pierre add-flow poster picker now hides the
  composer + band mic while choosing (the input box was overlapping the posters) via
  the existing flowChrome, adds a "↻ type another" escape, and reveals the lineup with
  a BOUNCE scroll (snap to bottom, then glide up to the top pick once posters load).
  Composer restored on pick / add-flow entry / non-note rotate-in. www + cap copy synced.

## 2026-08-01 — Log tickets via Pierre; don't mark watched on upload
- Uploading a ticket is now a Pierre flow (add → "🎟 Ticket"): pick an image, the
  server OCRs the TITLE + date/time/theater, Pierre fuzzy-matches the film, adds it,
  and attaches the ticket — WITHOUT marking it watched. A future screening stays
  "upcoming"; only a past screening finishes as watched (anchored to showtime). The
  old LOG-face TICKET button got the same watched-vs-upcoming guard.
- Worker: `readTicket` (index.ts) now also OCRs `title` and returns null for relative
  date phrases ("Next Thursday"). `POST /ticket` returns `title` and accepts NO showId
  (stores show_id=NULL for a Pierre upload). New `PATCH /ticket/:id/attach {showId}`
  binds the ticket to the film once resolved. DEPLOYED — Version 9086c246-cab0-472a-9ed9-1747c6747aa0.
- Client (Pages 9795ad0d): cube_pierre_face.html add-flow ticket option + upload +
  OCR-title→fuzzy→handoff; cube_log_face.html logTicketedFilm (materialize + attach +
  finish only if screening past). www + cap copy synced.

## 2026-08-01 — Theater ticket freshness badge (HOT/FRESH/CASUAL)
- Films watched at a theater (a `watch_ticket` on file) get a torn-ticket stub badge
  on the WATCH tile: weekday you went + a freshness class from the delta between the
  film's theatrical release and the ticket. HOT ≤7 days, FRESH 7–14, CASUAL after.
- Worker: `card()` (tmdb.ts) now carries full `release_date`; catalog materializer
  (catalog.ts) stores it as the movie's `premiered`/episode `airdate` (was `YYYY-01-01`
  year-fallback). `ensureReleaseDate()` self-heals older titles: when the titles
  endpoint returns a *ticketed* film with a `-01-01` fallback, it re-fetches the real
  date from TMDB once and persists it. `GET /:email/titles` (profile.ts) now also
  returns `ticket_at` (latest ticket created_at) and back-fills release dates for
  ticketed films before responding. Reads/writes titles+episodes only; no schema change.
- DEPLOYED via `npm run deploy`. Version ID 71f7b083-300e-41ef-88b6-b0423221d654.
  Verified: The Odyssey → premiered 2026-07-15, ticket 2026-08-01 → 16d → CASUAL.
- Client (Pages, deployment 0e139549): cube_watch_face.html renders the stub badge
  (tbPath = straight top/bottom, right notch, seeded irregular torn left edge — the
  shape approved on localhost) with --hot/--fresh/--casual colors; only films with a
  ticket + release date show it, others keep the plain filmDayTag. www + cap copy
  synced for the next iOS build.

## 2026-07-31 (clickwheel picker) — Wheel-driven poster selection
- Client only (Pages, deployment d720f950). Extends the existing wheel dialog-scrub
  (clickwheel.js `activeDialog`) with a case for Pierre's add-flow poster picker: a
  `.chips.pk-active` row (marked by presentPicker) is scrubbed by the ring — the
  highlight steps chip→chip starting on the top pick (`.cur`), SELECT clicks the
  highlighted candidate, and the trailing "↻ type another" chip is itself an item
  (SELECT it, or long-press to cancel, and the composer/keyboard returns). Picking by
  tap or wheel clears the mark. Works because Pierre is a `locked` face during chat.
  No Worker/API change. www + cap copy synced for the iOS build.

## 2026-07-31 (later still) — Service picker options
- Client only (Pages `pangolin-rc`, no Worker/D1 change). cube_log_face.html
  SERVICES: renamed "IRL Theater" → "Theaters" (THEATER_LABEL + a legacy remap
  in svcByLabel/isTheater so old 'IRL Theater' pins still count), added
  "Physical Media" and "Not Set". "Not Set" (`_clear`) unpins back to no service;
  all three are `_local` so they never POST to the crowd streamer guess.
  Barcode-reader idea for Physical Media noted as a TODO(collector) in-code,
  deferred (needs a camera-scan plugin + UPC→title lookup; TMDB has no barcode).
  DEPLOYED via `wrangler pages deploy public` (deployment 81fadc6f); www/ +
  `cap copy ios` synced for the next iOS build. No API change.

Entry format:

## YYYY-MM-DD — short title
- What changed (Worker code, D1 schema/data, wrangler.toml, bindings, etc.)
- Deploy message used (if deployed)
- Anything the next session needs to know

---

## 2026-07-30 — End-note Comment step: in-composer morphing mic + finish-fork scroll fix (Ted live-testing)
- **Frontend only (Pages), no Worker/D1 change.** `cube_pierre_face.html` (+ `www/` mirror).
- Fixes from Ted's device screenshots: (1) arriving at the finish fork wasn't scrolled to bottom — chips clipped behind the console band → added `scrollLogBottom()` (double-rAF) in `enterNoteFlow`/`beginComment`. (2) Step-2 composer showed a blinking cursor + auto-keyboard and the mic sat in the console band → rebuilt: the composer send button now morphs `send`(arrow)↔`mic`(rest)↔`rec`(REC+10 ticks)↔`busy`(…). `beginComment` shows text box + mic BOTH at rest, no focus/keyboard; tap box → keyboard + mic→arrow; tap mic → record→transcribe→arrow. In-composer recording ported into the face (getUserMedia/MediaRecorder), uploads `/transcribe` with `endnote=1`. Band mic stays suppressed for the whole step. **Scoped to the end-note Comment step only** (Ted's call) — normal Pierre chat + the band mic are untouched.
- Deployed: `wrangler pages deploy public --project-name pangolin-rc --branch main` → `066f1518`, verified live on `remote.pangolinrc.com` (custom-domain alias took ~10s to propagate).
- **Follow-up fixes (Pages), from Ted's live testing:**
  - Recorded end-note uploaded `endnote=1` → created an `is_endnote` row + tripped the 1-per-ep cap on every re-record → 409 → transcript never returned ("goes nowhere"). Fixed: uploads `reflection=1` (cap-exempt); finalize stamps endnote at Share/Journal. Failed saves now surface a message. (deploy `7fb35758`)
  - "Share audio" produced audio-over-blank-video: `buildShareVideo` captured a STATIC canvas (drawn once) → iOS records a frozen/black frame. Fixed: repaint the canvas every rAF during capture (+ `rec.start(100)` timeslice). (deploy `265b3d35`)
- **Native `CardVideo` compositor — FIXED (needs a native rebuild to verify).** Web MediaRecorder video is unreliable on iOS (WKWebView limit per `SHARE_VIDEO.md`); the reliable path is the native AVFoundation plugin, so Ted chose to go native for video. Two fixes in `capacitor-card-video/ios/Sources/CardVideoPlugin/CardVideoPlugin.swift`: (1) `writeStillVideo` now calls `writer.endSession(atSourceTime: duration)` + a run-once guard — a lone `.zero` sample collapsed the still track to ~0 length → blank video; (2) `pixelBuffer(from:)` flips the CGContext for orientation. **Swift NOT compiled here — verified iteratively on device.** `npx cap sync ios` done (web bundle copied, plugin `capacitor-card-video@0.0.1` picked up). Rebuild loop: `ios/App/App.xcodeproj` → Clean Build Folder (⇧⌘K) → archive/Run. Clean build required (Swift recompile + the known "old bundle keeps running" trap).
  - **endSession fix confirmed:** build 15 rendered the card + audio (no longer blank) — the still track holds now.
  - **Orientation, resolved across 3 builds:** b15 vertical flip → upside-down; b16 horizontal flip → mirrored. Each showed ONLY the applied transform → the CVPixelBuffer/AVAssetWriter pipeline adds NO orientation of its own. b17 draws straight (**no flip**) → correct. Lesson: the blank video was 100% the missing `endSession`; the flips were never needed. iOS build **17**.
- **Still deferred (last end-note item):** the edit popup on the No-spoiler branch (playback/delete/re-record).

## 2026-07-29 — Migration 0026: end-notes + one-reply lock on watch_comment (Ted's "go, start with the 0026 migration")
- **D1 schema change (`pangolin-rc` D1, normally off-limits — authorized this session for the watch_comment work, same precedent as 0024/0025).** Migration `0026_watch_comment_endnote.sql`:
  - `ALTER TABLE watch_comment ADD COLUMN is_endnote INTEGER NOT NULL DEFAULT 0` — the end-of-episode reflection kind (drives the SPLR/NOSP episode-level label, the 1-per-episode cap, non-repliability, reveal-on-finish). Distinct from `is_reflection` (which only marks 5-cap exemption); an end-note sets both.
  - `ALTER TABLE watch_comment ADD COLUMN spoiler INTEGER NOT NULL DEFAULT 0` — persists the explicit Spoiler(1)/No-spoiler(0) choice (was client-only/unsaved before).
  - `ALTER TABLE watch_comment ADD COLUMN reveal_on TEXT` — `'finish'` = reveal only when the friend marks the episode finished (end-notes; runtimes drift so no computed minute). NULL/`'mark'` = existing minute-anchored reveal. Explicit marker so a later pass can change reveal semantics per-kind without a migration.
  - `CREATE UNIQUE INDEX idx_watch_comment_reply_unique ON watch_comment(reply_to) WHERE reply_to IS NOT NULL AND reply_to <> ''` — enforces **one reply per comment** atomically (first write wins; second reply → SQLITE_CONSTRAINT_UNIQUE, client shows "already answered"). NULL/'' originals excluded, unaffected.
- **Pre-flight reads (read-only SELECTs on prod):** dupe-reply check = **5 replies / 5 distinct parents, 0 empty-string reply_to** → unique index created directly, no dedupe step needed.
- **Applied:** `wrangler d1 migrations apply pangolin-rc --remote` (non-interactive fallback=yes) → 0026 ✅. Verified remote: 3 columns present with correct types/defaults + index present. Also validated locally on a fresh chain (reset `.wrangler/state/v3/d1`): dup reply rejected, NULL/'' originals allowed.
- **Worker code (`src/index.ts`) — written + locally verified, NOT deployed yet:**
  - `POST /transcribe` (recorded): accepts `endnote=1` + `spoiler=1`; an end-note implies `is_reflection` (5-cap exempt); enforces the **1-per-episode end-note cap** (`ENDNOTE_MAX_PER_EPISODE`); INSERT now writes `is_endnote`, `spoiler`, `reveal_on` (`'finish'` for end-notes); the reply branch rejects replying to an end-note, pre-checks the one-reply lock before the R2 upload, and catches `UNIQUE(reply_to)` on INSERT (purging the just-stored audio) → 409 `reply_locked`.
  - `POST /transcribe/reply` (text): rejects end-note parents; pre-check + `UNIQUE` catch → 409 `reply_locked`.
  - `POST /transcribe/endnote` (**new**): typed end-note → text-only co-view comment with `is_endnote=1, is_reflection=1, reveal_on='finish'`, spoiler, private(Journal); 1-cap enforced.
  - `GET /transcribe/comments`: returns `endNote`, `spoiler`, `revealOn`.
  - `GET /transcribe/coview`: new `finishedEps` query param (caller's finished episode_ids); end-notes reveal iff the viewer finished that episode (SPLR and NOSP identical in-app gate); in-episode comments keep the mark+offset gate. Returns `endNote`, `spoiler`, `revealMs=null` for end-notes.
  - `tsc --noEmit` clean. Local integration test (fresh local D1, alice/bob mutual follow): end-note insert + 1-cap 409; reply lock (2nd reply 409 `reply_locked`); reply-to-endnote 409; comments fields present; coview reveal-on-finish (hidden w/o `finishedEps`, revealed with); in-episode mark+offset reveal regression OK.
- **Deployed to production** — `wrangler deploy --message "end-notes + one-reply lock: …"` → Worker `pangolin-rc`, Version `d3490f4f-ce1b-474a-bf94-3c9512005a81`, `https://pangolin-rc.edward-m-willett.workers.dev`. No Pages deploy (no frontend change yet).
- **Remote smoke test (non-writing only, to avoid junk on prod D1):** `OPTIONS /transcribe` 204; `GET /transcribe/comments` (unknown user) **200 `{comments:[]}` — exercises the new is_endnote/spoiler/reveal_on SELECT against the live schema, confirming migration↔worker consistency on prod**; `GET /transcribe/coview` with `finishedEps` 200; `POST /transcribe/endnote` missing-fields 400, unknown-user 401; `POST /transcribe/reply` unknown-user 401. All guards fire before any write. Full write-cycle (insert/lock/delete) NOT run on prod — verified locally against the identical migration.
- **Follow-up Worker endpoint — `POST /transcribe/comments/:id/finalize`** (DEPLOYED). Finalizes a RECORDED end-note: the shell mic uploads the clip (private=1) before the member picks SPLR/NOSP + Share/Journal, so this stamps the choice afterward — sets `is_endnote=1, is_reflection=1, reveal_on='finish'`, persists `spoiler`, and flips `private=0` on Share (Journal keeps private). Own-comment only. **Named `/finalize`, NOT `/endnote`:** a `.../:id/endnote` tail collides with the standalone `POST /transcribe/endnote` in Hono's RegExpRouter and 404s (found on prod smoke-test; `publish` worked only because there's no `/transcribe/publish`). Worker redeployed: `c5dffbc7` (endnote-tail, broken) → **`44c3a188` (finalize, verified 400/200 on prod)**.
- Frontend (Pages) — DEPLOYED. `cube_log_face.html`, `cube_pierre_face.html`, `cube_shell.js`, mirrored to `www/`:
  - **Log face:** SPLR/NOSP label (`commentStamp`); reveal-on-finish (`finishedEps` param, end-notes off the minute watermark, "reveals when you finish"); reply-lock UI (end-notes non-repliable, answered comments skipped, `✓ answered`, 409 handling on text+audio reply paths).
  - **Pierre flow:** no LLM riff for end-notes; local-heuristic spoiler guess + neutral fallback; hide input/mic/arrow at fork·spoiler·share (composer hidden + shell `pg:micSuppress`); `Share`/`Journal` copy; end-note commit (typed → `/transcribe/endnote`, recorded → `/transcribe/comments/:id/endnote`) with spoiler persistence; post-share/journal nav.
  - **Shell:** `pg:micSuppress` suppresses mic + chat-picker mid-flow (`pierreMicSuppressed`).
  - **Deferred (coupled to the in-face recorder, next step):** physical mic relocation into the composer, the blink-jump fix, and the edit popup (playback/delete/re-record).
- **Pages deploy:** `wrangler pages deploy public --project-name pangolin-rc --branch main` → `24b22b35`, Production (`remote.pangolinrc.com`). Verified live: log/pierre/shell markers present (via `curl -sL --compressed` on the extensionless paths — the `.html` 308→extensionless gotcha makes a plain curl read 0 bytes).
- **Still unverified end-to-end:** the full end-note flow in a real signed-in session (record/type → guess → Share/Journal → commit → co-view reveal-on-finish). Deployed but not yet click-tested. Next: live walk-through, then the mic-relocation step (mic into composer + blink-jump + edit popup).

## 2026-07-27 — Reflection double-save fix + prod D1 de-dupe + Stage 3 share-from-logs (Ted's "bug fix first, then build it, and de-dupe")
- **D1 data change (no schema):** de-duped the `reflection` table on **REMOTE**. Root cause:
  a RECORDED reflection was saved twice — once as a `watch_comment` (audio) and again as a
  `/reflection` row — so it doubled in the logs; and delete only removes the comment, so the
  orphan reflection persisted. Ran two `wrangler d1 execute pangolin-rc --remote` DELETEs:
  (1) reflection rows whose text matches an `is_reflection=1` comment (3 rows); (2) remaining
  identical reflection dupes keep-earliest (1 row). Result: 44 → **40 rows, 0 dupes**.
- **Frontend fix (Pages, pending deploy):** `noteTurn` only POSTs `/reflection` for TYPED
  reflections now (recorded ones live as their `watch_comment`), so no future doubles.
- **Stage 3 (frontend only):** WATCH-face archive rows (own reflections + audio comments)
  get a `.rf-share` button → `reshareFromLog` → Pierre `intent:'reshare'` → `enterReshareFlow`
  rebuilds the card + runs spoiler → Share/Journal; `publishReflection` publishes a journaled
  one (no-op if public). No Worker/D1 schema change.
- **Files:** `public/cube_pierre_face.html`, `public/cube_watch_face.html` (+ `cube_pierre_face`
  watch-next `nav('episodes')` fix — FACE_INDEX keys are swapped vs labels; 'episodes' =
  cube_log_face = the LOG tracker).
- **DEPLOYED** (Pages `08e8eef3`, source `2076214` + nav fix) — the D1 de-dupe was already
  applied. Verified live: `enterReshareFlow`, `nav('episodes', {})`, `reshareFromLog`.
- Rollback: the de-dupe is a hard delete (no undo, but only removed confirmed dupes); Pages
  redeploy `ba50a5ef` reverts the frontend.

## 2026-07-28 — Movie card fixes: scope + poster proxy — Worker + Pages DEPLOYED to production
- Two linked bugs: a finished MOVIE rendered the SERIES card ("2 comments on 1 episode / 1
  season / watched 1 day") with a blank poster.
- **Scope (frontend):** `finaleCheck` lacked an `isMovie` guard, so a movie (total=1,
  watched=1, no later season) fell into `forceSeriesNote()` → scope:'series'. Added
  `if(isMovie) return;` so a movie routes via `pierreFinishedNote` (scope:'movie') → the
  movie card (no episode/season/days lines).
- **Poster (Worker + frontend):** `image.tmdb.org` sends NO CORS header, so the crossOrigin
  card canvas couldn't load movie posters (works for TVmaze/series which do send CORS). Added
  **`GET /img?u=<url>`** — a host-allowlisted (`image.tmdb.org` only) same-origin image proxy
  that adds `access-control-allow-origin: *` + 1-day cache; `metaFetch` now routes movie
  posters through it. Verified: proxy returns image+CORS, non-tmdb host → 403.
- **Files:** `src/index.ts` (/img), `public/cube_log_face.html` (finaleCheck),
  `public/cube_pierre_face.html` (metaFetch).
- **Deployed:** Worker `d1293fc0`, Pages `e1d9d68d`. Branch `fix/movie-scope-poster` (PR).
- Rollback: Worker `wrangler rollback`; Pages redeploy `e1d9d68d`'s predecessor `9514758b`.

## 2026-07-28 — Card name username→"I" DEPLOYED to production (Ted's "deploy the card fix to web")
- **Frontend only.** `buildReflectionCard` name line now `o.username || 'I'` (dropped the
  `o.email` fallback that surfaced "edward.m.willett@gmail.com just watched"); the no-comment
  CTA uses `o.username ? username : 'me'` ("watch along with me on pangolinRC").
- **Files:** `public/cube_pierre_face.html`. **Git:** `feat/card-name-build8` (PR #30).
- **Pages deploy** `wrangler pages deploy public --project-name pangolin-rc --branch main`
  -> deployment `9514758b`, **Production**. Verified: served `who` line = `o.username||'I'`,
  no `o.email` in the file.
- Also bundled into **iOS build 8** (prepped, pending Ted's archive).
- Rollback: redeploy prior Pages `08e8eef3`.

## 2026-07-27 — Movie scope for the reflection flow DEPLOYED to production (Ted's "deploy it to production web")
- **Frontend only** (no Worker / D1 change). A finished film now flows as `scope:'movie'`
  instead of falling through to episode with an empty key. Card: "just watched ‹Movie›" +
  "N comments on this movie" + hidden-times list, no BINGE stamp. `pierreFinishedNote` sends
  `scope:'movie'` + `ep:'🎬'` (the movie comment key) so the count + recorded reflection line
  up; `noteTurn` filters the single-unit key for episode AND movie. Next-action = Done;
  `TODO(sequels)` marked for a later franchise "next".
- **Files:** `public/cube_pierre_face.html`, `public/cube_log_face.html`.
- **Git:** `feat/share-card-video` (`ff435c5`). **Pages deploy** `wrangler pages deploy public
  --project-name pangolin-rc --branch main` -> deployment `ba50a5ef`, **Production**.
- **Verified live:** `scope==='movie'` (pierre), `scope:isMovie` (log) on `remote.pangolinrc.com`.
- Rollback: redeploy prior Pages `9034b87f` (source stage-2 commit).

## 2026-07-27 — COMMENT_CLIP_SHARE stage 2: private Journal — D1 MIGRATION + Worker + Pages (Ted authorized the migration)
- **First backend change this session.** Ted explicitly authorized migrating the
  `pangolin-rc` D1 (normally off-limits) via the "Private flag (migrate the DB)" choice.
- **D1 migration `0025_watch_comment_private.sql`** — `ALTER TABLE watch_comment ADD COLUMN
  private INTEGER NOT NULL DEFAULT 0`. Additive; existing rows default public (0), so no
  behavior change for prior data. **Applied to REMOTE** (`wrangler d1 migrations apply
  pangolin-rc --remote`, non-interactive fallback = yes). ✅.
- **Worker (`src/index.ts`)**: `/transcribe` reads a `private` form field and stores it
  (reflections now send `private=1`); new **`POST /transcribe/comments/:id/publish`** flips
  a comment public (`UPDATE … SET private=0 WHERE id=? AND user_email=?`, own-comment
  scoped); `/transcribe/coview` WHERE gains `c.private = 0` so journaled reflections never
  reach a friend's feed. `/transcribe/comments` (own) unchanged → private ones still show in
  the member's own logs. **Deployed** — Worker Version `59dc9887`.
- **Frontend (Pages `9034b87f`)**: shell mic sends `private=1` for reflections + stashes
  `window.__pgReflectCommentId`; Pierre `publishReflection()` flips it on any Share option;
  Journal leaves it private (message "Kept in your journal — private…").
- **Deploy order (important):** migration → Worker → Pages (the Worker INSERT references the
  new column). Verified: `/publish` routed (400 w/o email), comments/coview 200, frontend
  markers live on `remote.pangolinrc.com`.
- **Net behavior:** recorded reflections are private until Share; Journal keeps them private
  but in the member's logs. Typed reflections never created a co-view comment, so unaffected.
- **Freeze note:** new endpoint + column = surface area past the July-20 freeze; Ted directed it.
- Rollback: redeploy prior Pages `6a39dabb` + Worker `wrangler rollback`; the column is
  additive/backward-compatible so it can stay.

## 2026-07-27 — COMMENT_CLIP_SHARE stage 1 (chip flow) DEPLOYED to production (Ted's "deploy it to production web")
- **Frontend only**, from `feat/share-card-video`. Restructures the finish→reflection flow
  (episode/season/series) into the spec's chip flow: Step 1 Comment/next-action fork
  (Watch next episode / Next episode <day> / Next season / Done, computed in
  `cube_log_face.html pierreFinishedNote` → `nextAction/nextEp/nextWhen`); Step 2 Comment
  cues the chat box (`.cue` blink) + mic (`pg:blinkMic` → shell Web-Animations pulse);
  Step 3 explicit Spoiler / No spoiler; Step 4 typed → Share/Journal, recorded → Share
  text / Share audio (dropped if spoiler) / Journal. Replaces the spoiler-toggle-during-
  input and the two-step share offer. **Journal is a keep-it stub** — the private store +
  share-from-logs are stages 2–3 (COMMENT_CLIP_SHARE.md).
- **Files:** `public/cube_pierre_face.html`, `public/cube_log_face.html`, `public/cube_shell.js`.
- **Git:** `feat/share-card-video`. **Production Pages deploy** `wrangler pages deploy public
  --project-name pangolin-rc --branch main` -> deployment `6a39dabb`, **Production**.
- **Verified live:** `nextActionChip`, `askSpoilerThenShare`, `pg:blinkMic` (pierre/shell),
  `nextAction` (log) on `remote.pangolinrc.com`.
- **Behavior change** for all web/PWA users (the core reflection flow). iOS unchanged
  (build 7 still pending; stage 1 would ride a later build).
- Rollback: redeploy prior Pages deployment `27130d00` (source `f4f4092`).

## 2026-07-27 — Share-as-video (#4 web path) + two-step share offer DEPLOYED to production (Ted's "deploy the web side")
- **Frontend only** (no Worker / D1 change), from branch `feat/share-card-video`. Adds the
  #4 share-as-video web path (`buildStoryFrame` 9:16 top-anchored frame + `buildShareVideo`
  MediaRecorder encoder, best-effort webm, still-card fallback), the two-step share offer
  (Share/Skip → Still/Audio clip), and the native share bridge (Pierre face posts
  `pg:shareFile` to the shell, which owns Capacitor + a real file://). On web the native
  branch is skipped (not `isNativePlatform`), so web sharing = `navigator.share` in-face,
  unchanged; the bridge is inert on web. The reliable mp4 path is native (CardVideo, build 7).
- **Files:** `public/cube_pierre_face.html`, `public/cube_shell.js`.
- **Git:** branch `feat/share-card-video` (`f4f4092`). Not merged to `main`.
- **Production Pages deploy:** `wrangler pages deploy public --project-name pangolin-rc
  --branch main` -> deployment `27130d00`, Environment **Production**.
- **Verified live:** `buildStoryFrame`, `doShareVideo`, "Audio clip", `pg:shareFile` present
  on `remote.pangolinrc.com`.
- **iOS:** unchanged — build 7 (native CardVideo + share routing + Photos fix) still pending
  Ted's archive; this deploy is web/PWA only.
- Rollback: redeploy prior Pages deployment `0a70bae9` (source `6bb4697`).

## 2026-07-27 — Season & series reflection cards + wiring DEPLOYED to production (Ted's "commit and deploy")
- **Frontend only** (no Worker / D1 / wrangler.toml change). Extends the share card to
  three scopes (episode / season / series) and wires the finishes that trigger them:
  season wrap and series end now run the FULL reflection (spoiler toggle + audio co-view
  comment anchored to the finale ep + scoped share card), replacing the old journal-only
  season note and the dead `episode:finishedFinale` handoff. Season/series digest
  (comments across episodes, in-season days with hiatus excluded, season count, years
  span premiere→finale) computed in `cube_log_face.html reflectionDigest()`; the season
  digest is computed BEFORE the season switch so the just-finished ep counts.
- **Files:** `public/cube_pierre_face.html`, `public/cube_log_face.html`. `www/` synced
  locally. NOTE: iOS bundle NOT re-synced — build 5 predates this (season/series reaches
  iOS only in a future build 6 via `cap sync` + bump).
- **Git:** committed `19a2a61` on branch `feat/share-card-reflection` (with PR #28). Not
  fast-forwarded to `main` (harness blocks direct main push); deploy was from local files.
- **Production Pages deploy:** `wrangler pages deploy public --project-name pangolin-rc
  --branch main` -> deployment `3534f580`, Environment **Production**. Serves
  `pangolin-rc.pages.dev`, `remote.pangolinrc.com`.
- **Verified live** on `3534f580.pangolin-rc.pages.dev` and `remote.pangolinrc.com`
  (`scope==='series'`, hero CTA, `reflectionDigest`, `forceSeriesNote` present). The
  face HTML serves `cf-cache-status: DYNAMIC, max-age=0` so no purge needed.
- **Needs in-app testing** (can't be auto-driven): finish a season finale → season card;
  finish the final season's finale → series card. `daysWatched` only counts episodes with
  in-app session finish timestamps (restored/pre-app history contributes 0, line drops).
- Rollback if needed: redeploy prior Pages deployment `31ad1aeb` (source `6d6d294`).

## 2026-07-27 — Share/reflection card redesign DEPLOYED to production (Ted's "ship it")
- **Frontend only** (no Worker / D1 / wrangler.toml change). Rebuild of the finished-
  episode share card (`buildReflectionCard` in `public/cube_pierre_face.html`): name
  line falls back username → email → "Someone"; live-fetch of this episode's own
  co-view comments (`GET /transcribe/comments`, filtered `episodeId === ctx.ep`) drives
  a hidden-times teaser list ("Comments hidden at 12m, 17m, …", eliding extras with "…"
  so the count reconciles) + "watch with pangolinRC to hear them in real time" CTA, with
  a generic co-watch CTA when there are none. Layout: wordmark dropped, action block
  top-aligned, title/copy float-wrapped tight around the poster, red cocked BINGE/FRESH
  stamp moved into the poster→box gap, Pierre cut out (edge flood-fill de-halo, eye
  preserved) seated on the green box with the SPOILER-FREE/SPOILER label over his head,
  quote up to 4 lines with ellipsis overrun, updated spoiler copy.
- **Files:** `public/cube_pierre_face.html`. `www/` mirror synced locally (iOS wrapper).
- **Git:** committed `6d6d294` on branch `feat/share-card-reflection`. NOTE: not yet
  fast-forwarded/pushed to `main` — the direct push to `main` was blocked by the harness
  (PR-review policy); awaiting Ted's call on merge vs PR. Deploy was from local files.
- **Production Pages deploy:** `wrangler pages deploy public --project-name pangolin-rc
  --branch main --commit-message "…"` -> deployment `31ad1aeb`, Environment
  **Production**. Serves `pangolin-rc.pages.dev`, `remote.pangolinrc.com`.
- **Verified live** on `31ad1aeb.pangolin-rc.pages.dev` and `remote.pangolinrc.com`
  (cache-busted, following the clean-URL 308 that drops `.html`): `_cutout`,
  "watch with pangolinRC to hear", "Comments hidden at", "see the comment in pangolinRC"
  all present. Static assets carry `max-age=14400`, so returning testers may see prior
  JS/HTML for up to ~4h absent a purge.
- **iOS:** web/PWA production only; Capacitor app not re-synced/archived this session.
- Rollback if needed: redeploy prior Pages deployment `08cd6423` (source `d2666a0`).

## 2026-07-27 — Episode-finish logging fix DEPLOYED to production (Ted's OK)
- **Frontend only** (no Worker / D1 / wrangler.toml change). Fixes a lost episode
  finish: when the episode-end timer had already elapsed on return, the shell jumped
  straight to Pierre's "Did you finish …?" prompt and never wrote the completion —
  if a share/crash intervened, the finish was lost while the co-view comment (own
  path) survived (repro: Hacks S2E7). Now both return paths (on-return check +
  end-of-episode notification) land on the LOG face at the launched episode via a
  shared `openLaunchOnLog(L, promptFinish)`; when the timer ran out, FINISH is called
  out (green glow-pulse) so the finish is a one-tap, account-writing act BEFORE any
  Pierre/share step. Removed the now-dead Pierre "Did you finish …?" flow
  (`enterEpisodeFinishFlow`/`chooseFinish`/`commitFinish`/`epCodeOf`/`saveJournalNote`,
  `episode-finish` intent, `episodeFinish:commit` listener, `_armNextOnReturn`).
- **Files:** `public/cube_shell.js`, `public/cube_log_face.html`,
  `public/cube_pierre_face.html`. `www/` mirrors synced locally for the iOS wrapper.
- **Git:** branch `fix-episode-finish-logging` (`d2666a0`), fast-forwarded to `main`
  and pushed (`ac75866..d2666a0`). Branch also pushed to origin.
- **Production Pages deploy:** `wrangler pages deploy public --project-name pangolin-rc
  --branch main --commit-message "…"` -> deployment `08cd6423`, Environment
  **Production**, source `d2666a0`. Serves `pangolin-rc.pages.dev`,
  `remote.pangolinrc.com`, `remote.demo.pangolinrc.com`.
- **Verified live** on `remote.pangolinrc.com` (cache-busted, following the Pages
  clean-URL 308 that drops `.html`): `openLaunchOnLog`/`finishCallout`/`promptFinish`
  present; `routeEpisodeFinish`/`episodeFinish:commit`/`enterEpisodeFinishFlow` gone.
  Note: static assets carry `cache-control: max-age=14400, must-revalidate`, so the
  edge may serve the prior JS/HTML to returning testers for up to ~4h absent a purge.
- **iOS:** web/PWA production only; Capacitor app not re-synced/archived this session.
- Rollback if needed: redeploy prior Pages deployment `20f1b085` (source `f7a50d0`).

## 2026-07-26 — WoW scheduler v1.0.1 MERGED to main + PRODUCTION (Ted's explicit OK)
- **Merged** `feat/wow-inseason-scheduler` -> `main` (merge commit `f7a50d0`, `--no-ff`),
  pushed to `origin` (`3c974f6..f7a50d0`). Branch was 21 ahead / 0 behind (clean).
- **Production Pages deploy:** `wrangler pages deploy public --branch main`
  (main = the project's production branch) -> deployment `20f1b085`, Environment
  **Production**, source `f7a50d0`. Serves `pangolin-rc.pages.dev`,
  `remote.pangolinrc.com`, `remote.demo.pangolinrc.com`.
- **Worker** already at prod version `a5c211cb` from the earlier same-day deploy; main
  now matches it, no re-deploy needed. `SCHED_DB` (pangolinrc-scheduler) live.
- **Verified live:** prod `wow-scheduler.js` 200, custom domain 200, `/scheduler/state`
  200. Legacy `pangolin-rc` DB never migrated/rebound; scheduler state in its own D1.
- **iOS:** this deploy is web/PWA production only. The Capacitor app was subsequently
  synced + archived as **build 4 (1.0.1)** to carry the scheduler on device (last
  shipped was build 3, not 4 — the handoff's "build 4" was forward-looking). Archive
  staged in Xcode Organizer; TestFlight upload is Ted's step. See WRAPPER.md.
- Rollback if needed: `wrangler rollback` (Worker) / redeploy a prior Pages deployment.

## 2026-07-26 — WoW scheduler Worker routes DEPLOYED to production (Ted's explicit OK)
- **`wrangler deploy`** pushed `/scheduler/state|mode|default|notify|reenable` + the
  `SCHED_DB` binding to the prod Worker `pangolin-rc.edward-m-willett.workers.dev`.
  Version `a5c211cb-23fb-4406-8293-85b7757b52fa`. Preflight before push: diff vs main
  purely additive (188 ins, 0 del), branch a superset of main (0 missing commits,
  includes the reflection cap-exempt work), `tsc --noEmit` clean, dry-run resolved all
  bindings, SCHED_DB migration confirmed (4 tables). Existing routes/bindings unchanged;
  legacy `pangolin-rc` DB only read for users/episodes validation, never written by
  these routes. Reversible via `wrangler rollback`.
- **Smoke-tested live end to end** (state/default/mode/notify/reenable all persist +
  read back). Note: workers.dev served mixed old/new versions for ~30s during global
  colo propagation (intermittent "Not found"), then settled to 12/12 consistent.
- **Data note:** restored Ted's declared `tvmaze:48090` (SNW) = `FRESH` server-side.
  It had lived only in localStorage while the Worker was down; now that `store.load`
  treats the server as authoritative and overwrites the local cache, the declaration
  had to exist in `sched_mode_choice` or it would have been lost on next load.
- Still branch-only on the frontend: no merge to `main`, no prod Pages/app deploy.

## 2026-07-26 — WoW in-season scheduler: Core (new D1 + Worker routes, NOT deployed)
- **New D1 database `pangolinrc-scheduler`** (id `3759f1e2-6779-4a31-8cb6-b8e18492cedc`,
  WNAM) created via `wrangler d1 create`. Its OWN database — the legacy `pangolin-rc`
  (`4bd25737`) is NOT touched, migrated, or rebound. Schema `migrations-scheduler/0001_init.sql`
  applied remote: `sched_mode_choice`, `sched_user`, `sched_badge`, `sched_sent`.
- **wrangler.toml**: added `SCHED_DB` binding (+ `Env.SCHED_DB` in types.ts).
- **Worker (`src/handlers/scheduler.ts`), NOT deployed.** Routes `/scheduler/state|mode|default|reenable`
  on `SCHED_DB` only. Two-strike consent logic is server-authoritative here. `npx tsc
  --noEmit` clean. On branch `feat/wow-inseason-scheduler`; no prod Worker deploy without Ted's OK.
- **Frontend (branch only):** `public/wow-scheduler.js` (shared service: phase engine,
  classifier, five-rule nudge, TAG formatter, timely sort key, TVMaze airstamp fetch,
  state client) + WATCH-face TAG on both tiles and timely sort. Deployed to the branch
  preview only. Chip / LOG countdown / Pierre nudge / Profile default are the next increment.
- Storage choice B (per Ted): scheduler state in the new D1, additive.
- **UAT increment (branch preview, frontend only):** WATCH-face watch-pattern
  "stamp" (derived cross-season via `classifyDeltas`, matched by season+number;
  tappable to cycle; a dashed `SET PATTERN` stamp appears on the expanded card
  when a show is claimable — 2+ watched — but not yet classified, so a pattern
  can always be declared). LOG face: big TAG badge + greyed `DROPS {TAG}` START
  that swings to Pierre. Pierre `enterNotifyFlow`/`offerNotify` (`[Notify me]` /
  `[I'll check back]`, both pop back to the spinning cube via `pangolin-back`).
  Preview auto-login gated to `*.pangolin-rc.pages.dev` subdomains. Still no prod
  Worker deploy; `/scheduler/*` persistence runs off the localStorage fallback on
  the preview. Deployed to `wow-scheduler.pangolin-rc.pages.dev`.
- **UAT increment 2 (branch preview):** WATCH stamp moved under the season
  selector on the expanded card. LOG **RAMP countdown** — the big TAG becomes a
  live second-ticking `DROPS IN …` clock once the next drop is <=72h out (CFG
  `RAMP_H`); precise airstamp fetched from TVMaze via `WoW.episodes`, airdate-at-
  noon coarse fallback, 1s ticker self-clears at drop. No spec threshold change.
- **Legacy DB (`pangolin-rc`) data writes this session — via the app's own
  endpoints, at Ted's explicit request, no schema/config touch:** (1) corrected
  Ted's real SNW S4E1 watch session to a 9:00–9:59 PM PT premiere-night finishTs
  (`POST /profile/{email}/episodes/tvmaze:48090:s4e1`); prior session value saved
  in the transcript for reversibility. (2) Added three shows to his account at
  pattern `live` (caught-up): Ted Lasso `tvmaze:44458`, Lanterns `tvmaze:44776`,
  Yellowjackets `tvmaze:36672` (`POST /catalog/initiate`). No migration/rebind.
- **UAT increment 3 (branch preview):** LOG countdown redesigned per Ted to a
  2-week (INSEASON_D) day-granularity progression: `SX NEXT {DOW}` -> `SX STARTS
  {DOW}` -> `SX STARTS TOMORROW` -> `SX STARTS TODAY` (season prefix; warm glow on
  today/tomorrow). RAMP second-ticker removed. **Timezone hardening** (last year's
  Today/Tomorrow slip): new `WoW.daysUntil` / `WoW.weekday` compute on LOCAL
  calendar dates parsed from the airdate Y-M-D components, never `new Date(isoString)`
  (UTC midnight). `wowNextUnaired` now scans all seasons (premiere of a not-yet-
  started season shows). **Proactive Pierre nudge:** on Pierre open, a tracked show
  in RAMP triggers the mode-aware `WoW.nudge` line + `[Notify me]`/`[Got it]` chip;
  RAMP-gated per the law, mode from manual override or `classifyDeltas`, scoped to
  the drop's season to dodge the epNum collision. `?wownudge=1` (read off parent
  URL, same-origin) forces a synthetic RAMP for UAT. All frontend; no Worker deploy.
- **UAT increment 4 (branch preview):** shared reflection cards (`buildReflectionCard`
  in Pierre) now ink the member's watchPattern; public label maps `MORE! -> BINGE`,
  LIVE/FRESH/CASUAL carry through, silent for UNSAMPLED/DECLINED/kill. **Profile
  Watch-patterns section** (`cube_profile_face.html`, now loads `/wow-scheduler.js`):
  default-pattern chip (AUTO/LIVE/FRESH/CASUAL/MORE! -> `WoW.store.setDefault`) and a
  classifier ON/OFF badge exposing the re-enable switch after a two-strike kill
  (`WoW.store.reenable`; kill copy verbatim). No new API/route added (re-enable rides
  the existing `/scheduler/reenable`; off remains the decline path). All frontend.
- **UAT increment 5 (branch preview), per Ted — the two surfaces now behave
  differently on purpose:** WATCH stamp = plain ON/OFF toggle for that show only
  (clear <-> DECLINED), no type cycling; type comes from the classifier or the
  Profile default; off renders greyed+struck and stays tappable; a declined show with
  no derivable pattern shows a generic recoverable OFF; MORE! displays as BINGE; the
  old SET PATTERN type-cycling affordance removed. Profile default = single cycling
  chip NONE->LIVE->FRESH->CASUAL->BINGE (the general aspiration, feeds unclassified
  shows via `wowEffMode` fallback). All frontend; no Worker/D1 change.
- **UAT increment 6:** watch-pattern stamp suppressed on movies (`wowStampFor` returns
  null for `kind==movie` / `tmdb:` ids) so the FRESH default stops stamping films.
  Cards + LOG drop-label were already movie-safe. Frontend only.
- **FUTURE (Ted, deferred by design):** repeated-movie viewing is a distinct watch
  pattern (rewatch cadence / comfort loops) and does NOT belong in the WoW in-season
  (weekly episodic) scheduler. If pursued, build it as a SEPARATE scheduler; do not
  retrofit `MODES`/`classify`/`nudge` in `wow-scheduler.js` to cover films.

## 2026-07-26 — Exempt reflections from the comment cap (D1 migration + Worker DEPLOYED)
- **D1 SCHEMA CHANGE + Worker, DEPLOYED to PROD.** Migration `0024_watch_comment_reflection.sql`
  applied to `pangolin-rc` (Ted ran `wrangler d1 migrations apply pangolin-rc --remote`):
  `ALTER TABLE watch_comment ADD COLUMN is_reflection INTEGER NOT NULL DEFAULT 0`.
  Additive, non-destructive (existing rows default 0).
- Worker (`src/index.ts`) DEPLOYED: `wrangler deploy` version
  `51ebf472-af08-425c-8c49-d00564a1cc45`. Finished-episode reflections (voice notes
  posted with `reflection=1`) skip the per-episode cap AND are excluded from its
  count (`is_reflection = 0` filter). Regular comments still capped at 5; replies
  still exempt. Frontend (`cube_shell.js` mic) tags reflection uploads.
- NOTE: this touched the `pangolin-rc` D1 (the CLAUDE.md "off-limits legacy" DB).
  It is in fact the live app DB — `watch_comment` lives there, migrations 0015–0024.
  Ted ran the migration himself. The CLAUDE.md legacy-DB note is stale/misleading and
  should be reconciled (it's the app's real database).

## 2026-07-25 — Fix: comment cap wrongly blocked Pierre-notes (Worker DEPLOYED)
- **Worker code change (`src/index.ts`), DEPLOYED to PROD** at Ted's request.
  `wrangler deploy --message "transcribe: exempt Pierre-notes (no showId) from the
  per-episode comment cap"`. Version `54b007bd-5f32-4e04-997c-f4ce7c517379`.
  Frontend fixes on preview `prelaunch-fixes.pangolin-rc.pages.dev` (not yet prod).
- Regression from 2026-07-19's per-episode comment cap. The Pierre voice-note mic
  posts to `POST /transcribe` with `episodeId='pierre-note'` and NO `showId` purely
  to get a transcription. The cap counted those in one `show_id IS NULL` bucket, so
  after 5 notes the 6th (and every later one) got a 409 → transcription silently
  failed. Fix: gate the cap on `showId` present (`else if (showId)`), so non-co-view
  uploads (Pierre-notes) skip it. Real comments always send `showId`, so the cap is
  unchanged for them.
- No D1/schema change. `npx tsc --noEmit` clean.
- **Deploy when confirmed:** `wrangler deploy --message "transcribe: exempt Pierre-notes (no showId) from the per-episode comment cap"`.

## 2026-07-21 — Movie credits on the LOG face (Worker DEPLOYED)
- **Worker code change (`src/handlers/tmdb.ts`), DEPLOYED to PROD** with Ted's
  confirmation. `wrangler deploy --message "tmdb: movie detail returns
  cast/crew/production (LOG face credits)"`. Version
  `ac9b651a-9610-4ed4-9bf9-db9abeac13df`. Verified live: `/tmdb/movie/603`
  returns 8 cast + directors + writers + production. Frontend promoted to prod
  Pages (`remote.pangolinrc.com`, deployment `71b2084b`).
- `GET /tmdb/movie/:id` now fetches with `append_to_response=credits` and returns
  an extended detail card: `cast` (top ~8, billing order, `{name,character}`),
  `directors`, `writers` (Screenplay/Writer/Story), and `production` (≤4 studios),
  in addition to the existing base fields. Base `card()` (search + catalog
  materializer path via `fetchTmdbMovie`) is unchanged — no credits bloat there.
- No D1/R2/KV/binding/schema change. `npx tsc --noEmit` clean; detailCard
  transform unit-tested (cast cap/order, crew dedupe, empty-credits safety).
- **Movies only** for now (TMDB). Series credits (TVmaze) are thin and were left
  out by design.
- Frontend (`public/cube_log_face.html`) renders a `#credits` block under the
  meta line, lazy-fetched from this endpoint; films only, hidden for series.

## 2026-07-19 — Co-view: 30s reveal + 5-comment/episode cap (Worker DEPLOYED)
- **Worker code change (`src/index.ts`), DEPLOYED to PROD** with Ted's explicit
  confirmation. `wrangler deploy --message "coview: 30s reveal offset + 5
  non-reply comments/episode cap (409)"`. Version `d0f3f79b-8cfe-478d-8ac7-3362e8e4bdc1`
  (`pangolin-rc.edward-m-willett.workers.dev`).
- `COVIEW_REVEAL_OFFSET_MS` 60_000 → **30_000** (a friend's comment reveals 30s
  after its mark, not 60s). Mirrored on the frontend in `public/cube_shell.js`
  (`COVIEW_REVEAL_OFFSET_MS = 30000`) and the `public/cube_log_face.html` reveal
  fallback (`+30000`). Frontend prefers the server's `revealMs`, so reveal timing
  only fully changes once the Worker ships.
- **New per-episode comment cap.** `COVIEW_MAX_COMMENTS_PER_EPISODE = 5`. In
  `POST /transcribe`, an original (no `replyTo`) upload now counts the member's
  existing non-reply `watch_comment` rows for `(user_email, show_id, episode_id)`
  and returns **409** on the 6th. Replies are exempt. `GET /transcribe/comments`
  now also returns `reply_to` (as `replyTo`) so the LOG face can count originals.
  Reads/writes the same `watch_comment` table (migrations 0015–0018) via the
  existing `DB` binding — no new DB surface, legacy tables untouched.
- No D1 schema/migration change (cap is a runtime COUNT; no new columns).
- `npx tsc --noEmit` clean.
- Frontend on preview `coview-tweaks.pangolin-rc.pages.dev`; not yet promoted to
  prod Pages (`remote.pangolinrc.com`) — awaiting Ted's confirmation. Once the
  frontend ships, reveal timing fully reflects 30s (frontend prefers server
  `revealMs`, which is now 30s post-deploy).

## 2026-07-17 — Keyboard toggle fix + email mode (frontend only)
- **No Worker/D1/config change.** `public/cube_shell.js` (console keyboard),
  `public/index.html` (caps + quick-bar CSS), `public/cube_pierre_face.html`
  and `public/cube_browse_face.html` (opt into email mode).
- Console keyboard: shift/caps/symbol toggles no longer reset — `_kbShow` was
  wiping `shift`/`sym` on every `focusin`, and every keypress re-focuses the
  field (re-firing `focusin` on browsers that blur the iframe field), so the
  toggle never held. `_kbShow` now only resets on a *new* target; layout is
  re-derived live in `render()`. Added one-shot shift, double-tap caps lock
  (`⇪`), and email mode driven by `data-kb="email"` (@/. on the primary row,
  no space, domain quick-bar @gmail/@icloud/@yahoo/@outlook, `@`-aware replace).
  New `window._kbRefresh()` lets a face flip `data-kb` while focused (Pierre's
  async join/login email steps call it via `refreshKb()`).
- **DEPLOYED to PROD** (`remote.pangolinrc.com`, Pages `--branch main`,
  deployment `5f9b9e68`). Deploy message: "keyboard: hold shift/caps/symbol
  toggles + email mode (data-kb) with domain quick-bar; incl. inert-in-prod
  api-base http: guard (f558ba3)". Prior live Source `ba29d9c`.
- Delta vs prior live prod: the keyboard commit (`6e809c6`) PLUS `f558ba3`
  (api-base `http:` guard, 9 faces) which had not shipped yet. `f558ba3` is a
  **no-op in prod** — it only narrows the dev API base to `http://localhost`,
  and prod host isn't localhost. The two commits sit on branch
  `feat/keyboard-toggle-fix-email-mode` (cut from `fix/api-base-protocol-guard`);
  git `main` remains stale (usual prod drift). Deployed via Direct Upload from
  disk, so uncommitted iOS/Capacitor working-tree changes were NOT included.
- Preview also live at `kb-email-mode.pangolin-rc.pages.dev` (branch deploy,
  tested on-device before the prod promotion).

## 2026-07-10 — Pierre transcript labels member turns with username (frontend only)
- **No Worker/D1 change.** `public/cube_pierre_face.html` `buildTranscript()`
  now labels the member's lines with `localStorage['pg_username']` (fallback
  "You"); Pierre's stay "Pierre".
- **DEPLOYED to PROD** (`remote.pangolinrc.com`, Pages `--branch main`,
  deployment `62e4eb43`, Source `ba29d9c`). Prior live Source `4678b90` =
  parent, clean delta (1 file).

## 2026-07-10 — Pierre share moved into the band context picker (frontend only)
- **No Worker/D1 change.** `public/index.html` (picker markup + `.pc-share`
  css), `public/cube_shell.js` (`sharePierreChat`), `public/cube_pierre_face.html`
  (dropped the header button; exposes `window.__pierreTranscript()`).
- "Share this chat" now lives in the off-cube context picker next to Clear chat
  (`data-ctx="__share"`). The share runs from the TOP window (shell), not the
  iframe, because `navigator.share` needs the picker tap's user-activation and a
  cross-iframe call wouldn't carry the face's own activation. `mailto` fallback.
- **DEPLOYED to PROD** (`remote.pangolinrc.com`, Pages `--branch main`,
  deployment `c5366e90`, Source `4678b90`). Pre-deploy check: prior live Source
  `4515958` = parent, clean delta (3 files).
- NOTE: right after the alias repoint the CF edge served stale index.html +
  cube_pierre_face.html on the bare custom-domain URL for a short window (despite
  `max-age=0, must-revalidate`); a `?cb=` query hit fresh origin. Brief
  post-deploy propagation lag, self-resolves — not a config problem.

## 2026-07-10 — Pierre resume fix + share-the-chat (frontend only)
- **No Worker/D1 change.** Only `public/cube_pierre_face.html`.
- Resume bug: Pierre's "put on <show>" jumped a full episode when paused
  mid-episode — it built the resume pattern from `last_season`/`last_number`
  (furthest touched) with no `on` flag, so `applyPattern` read it as "last
  finished → next" and started the next episode at 0:00. Fix: `rememberLogRow`
  now carries the server `current_episode_id` (first not-done) as `current`,
  and `resolveShow` hands off `{kind:'resume', season, number, on:true}` so it
  lands ON the in-progress episode (minute restored), matching the WATCH face.
  Falls back to the legacy pattern when there's no current pointer.
- New Share button in Pierre's header → `navigator.share` (native sheet) with
  `mailto:` fallback via `window.top`; transcript built from rendered bubbles.
  Iframe already had `allow="web-share"` (cube_shell.js) — no shell change.
- **Frontend DEPLOYED to PROD** (`remote.pangolinrc.com`, Pages
  `--branch main`, deployment `d31d000c`, Source `4515958`). Pre-deploy
  `deployment list` check passed: prior live Source `543dffd` = this commit's
  parent, so the deploy is that tree + one file. Commit lives on branch
  `streamer-logo-grid` (git `main` remains stale — the usual prod drift).

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

## ⚡ START HERE — current state (as of 2026-07-09, next session read this first)
- **Prod (`remote.pangolinrc.com`) live build = deployment `d9b23678`** (= git
  `543dffd`) — Pierre
  mic + context picker moved OUT of the Pierre iframe and INTO the shell's off-cube
  band (Device · Mic · Chat-picker · Cube, evenly spaced, shown only while Pierre is
  open). The composer mic I'd added earlier was a DUPLICATE of the pre-existing shell
  `#pierre-mic`; removed it. Shell mic restyled to red/blinking-REC + 10-segment ring.
  Picker (`#pierre-ctx` in index.html + `initPierreCtx` in cube_shell.js) drives the
  face same-origin via `window.__pierreSwitch/__pierreClear/__pierreGetCtx`; the face
  reports its lane back via `window.parent._pierreCtx`. Frontend-only; no Worker change.
  Committed + pushed on `streamer-logo-grid`. Prior prod: `dae4b439` (Pierre
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

## 2026-07-30 — Movie runtime in titles list
- Worker: `GET /:email/titles` (src/handlers/profile.ts) now also selects
  `runtime` via subquery `(SELECT e.runtime FROM episodes e WHERE
  e.title_id=wt.title_id ORDER BY e.season, e.number LIMIT 1)`. Movies are one
  unit whose length lives on the single episode row; the WATCH face needs it to
  show "X min left" instead of episode counts. Read-only, additive column; no
  D1 schema change, no new route.
- Requires a Worker deploy (`npm run deploy`) for the movie progress display to
  work — until then `runtime` is undefined and movies fall back to
  "not started"/"in progress".
- Deploy message to use: "titles list: add movie runtime for min-left display".
- MEMBER_CAP raised 10 → 20 (profile.ts join handler) in the same change.
- DEPLOYED 2026-07-30 via `npm run deploy` (wrangler deploy). Version ID
  cd8ab320-4977-4f72-9964-fcf0b3de2624. Live: movie runtime field + cap=20.

## 2026-08-03 — Rewatch passes (watch_pass table + endpoints)

- **New table** `watch_pass` (migration `migrations/0027_watch_pass.sql`) on the
  `DB` binding (pangolin-rc, 4bd25737 — the ACTIVE app DB; the old "legacy
  off-limits" note in CLAUDE.md was stale and was corrected). Additive only.
  Columns: pass_id, user_email, title_id, season, ordinal (1-based view #),
  kind ('complete'|'highlights'), pattern (locked WoW mode), episodes (JSON
  snapshot), watched_ct, season_ct, started_at, archived_at.
- **New endpoints** (profile.ts):
  - `POST /profile/:email/titles/:id/seasons/:n/rewatch` — archive that season's
    watch-through as a pass, then reset its watch_episode rows (fresh pass from 0).
  - `POST /profile/:email/titles/:id/rewatch` — same for every season with progress.
  - `GET /profile/:email/titles/:id/passes` and `GET /profile/:email/passes`.
  - Reset also clears the show's `sched_mode_choice` (SCHED_DB) so the pattern
    re-derives, and recomputes watch_title bucket + resume pointer.
- Client: LOG face WATCH AGAIN button → rewatch endpoint + reload; WATCH
  Completed tab renders passes (locked-pattern stamp / highlighter marker).
- Deploy message used: "rewatch passes: /rewatch + /passes endpoints (watch_pass)".
- DEPLOYED 2026-08-03: remote migration applied; `wrangler deploy` Version ID
  54fbec11-8f6a-4f78-b3ce-219872471202; Pages deploy 54833579. Live.

## 2026-08-05 — IRL tickets: typed reflections + focal v2

- **`/transcribe` (POST)** now accepts a **typed, audio-less reflection**: when
  `text` is present and there's no `audio`, it inserts a `watch_comment` row
  (transcription = the text, audio_url NULL, is_reflection/private per flags)
  and returns `{id, transcription, audioUrl:null}`. Powers "type your reflection"
  in the IRL ticket composer. Additive; the audio path is unchanged.
- **`/img/focal` v2 prompt.** Rewrote the vision prompt to hunt for the main
  face/subject and explicitly account for posters placing people in the LOWER
  half (ignore title text/logos). Bumped the KV cache key `focal:` → `focal2:`
  so old weak points re-derive; fallback moved to `{x:0.5,y:0.45}`. Verified:
  Ford v Ferrari went `y:0.35` (sky) → `y:0.75` (car/drivers).
- No schema/migration changes. Deploy message: "transcribe: accept typed
  text-only reflections (no audio); img/focal v2 prompt targets subjects in
  lower half of posters + cache re-derive (focal2 key)".
- DEPLOYED 2026-08-05: `wrangler deploy` Version ID
  288ab5b6-efbd-447f-9a24-f5de9913e61f; Pages deploy 0428ddad. Live on
  remote.pangolinrc.com. iOS bundle re-synced (`cap copy ios`).

## 2026-08-05 — Tickets: self-heal NULL catalog posters

- **Bug:** an uploaded theater ticket linked to a real TMDB title (e.g. The
  Favourite → tmdb:375262) rendered the raw Wallet screenshot instead of the
  poster. Cause: the `titles` catalog row existed with `poster = NULL`
  (transient TMDB miss / lighter creation path), and `materializeTitle`
  (catalog.ts) returns early for an existing row so it never refetches — the
  NULL stuck. The IRL tickets card then fell back to `poster || ticketUrl`.
- **Fix (profile.ts `GET /:email/tickets`):** after building the ticket list,
  any row with a null poster and a `tmdb:<id>` show_id → `fetchTmdbMovie` the
  poster, `UPDATE titles SET poster` (backfill so it sticks), and return it.
  Deduped per title, fail-soft, best-effort write. Self-heals on the next read.
- No schema change. Deploy message: "tickets: self-heal a linked TMDB title
  with a NULL catalog poster — fetch + backfill titles.poster on read …".
- DEPLOYED 2026-08-05: `wrangler deploy` Version ID
  f4e67d20-b669-430c-ac89-1c65b995d842. Verified: The Favourite now returns
  .../cwBq0onfmeilU5xgqNNjJAMPfpw.jpg and renders in the IRL Tickets card.

## 2026-08-05 — Old-ticket year confirmation

- **Client (Pierre):** after a ticket's film resolves, if the OCR date has a
  month+day, Pierre infers the year by finding years where that weekday+day
  land ON/AFTER the film's release date (closest first), and offers them as
  chips ("2018 · likely"). The weekday match usually pins a single year (e.g.
  The Favourite: "Tue, Dec 11" + release 2018-11-23 → only 2018). Picking a
  chip PATCHes the ticket with a full ISO date.
- **Worker (`PATCH /ticket/:id/attach`):** now accepts an optional
  `ticketDate` (validated `YYYY-MM-DD`) and `COALESCE`s it into
  `watch_ticket.ticket_date` — only overwrites when provided/valid.
- **Client (browse face):** `ticketDateBits` now captures a year (ISO,
  "DEC 11, 2018", "12/11/2018"); `ticketDateValue` uses an explicit year
  directly (no createdAt inference); the meta shows ", YYYY" when the year
  isn't the current one. Year-less OCR dates behave exactly as before.
- No schema change. Deploy: worker Version ID
  26dadccd-4569-402f-84b6-c82ae5d6b39f; Pages 849b10f4.

## 2026-08-07 — FEED: tickets + notes in the stream, and movie-ticket perf edge

- **Worker (`GET /profile/:email/feed`):** the feed now merges `watch_ticket`
  rows (theater visits — previously dropped, since the query only read
  `watch_title`) into the activity stream, tagged `kind:'ticket'` with the
  theater as the "where". Every card (watch + ticket) also carries `poster`,
  the actor's public `comment_ct`, and their latest end-note (`endnote_text` +
  `endnote_spoiler`). Both sub-queries are `private=0` only. No schema change.
- **Worker (`GET /tmdb/movie/:id`):** now edge-cached via `caches.default`
  (24h, `Cache-Control: public, max-age=86400`, keyed by bare numeric id).
  This is the endpoint every FEED movie-ticket poster falls back to; without a
  cache each feed open re-hit TMDB. Local dev confirmed: cold 92ms → warm 2ms.
  CORS still applied by the global `app.use('*', cors())` on both fresh and
  cache-hit responses. Fail-soft (cache miss just re-fetches).
- **Client (feed face):** big poster-backed cards; comment-count + ticket
  pills; spoiler end-notes gated behind tap-to-reveal, non-spoiler shown
  inline. Feed now SKIPS the `/tmdb/movie` (showMeta) round-trip for movie
  tickets/films that already have a poster + where from the API. Dev-only
  `?user=&name=` URL override (localhost only) for testing.
- Deployed 2026-08-07: Worker Version ID
  76d82c44-b72a-4782-8188-879bb78f52fb; Pages deployment 642b5423 (branch
  main). Prod-verified: `/profile/:email/feed` returns 200 with `kind:'ticket'`
  rows + the new fields; `/tmdb/movie/:id` sends `Cache-Control: public,
  max-age=86400`; feed face live on remote.pangolinrc.com. (Note:
  remote.demo.pangolinrc.com currently does not resolve in DNS — pre-existing,
  unrelated to this deploy.)

## 2026-08-10 — FEED redesign v2 (sentence/blurry-block cards) + audio Range

- **Worker (`GET /profile/:email/feed`):** added `last_name` (last-watched
  episode title, for the "<ep>" episode of SHOW phrasing) and `premiered`
  (titles.premiered, for the film PREMIERES block) to both watch + ticket rows.
  Earlier same-day additions (synced_ct, endnote_id/text/spoiler/audio,
  follower relationship + followers included in the actor set) also live.
  No schema change — all from existing columns.
- **Worker (`GET /transcribe/audio/:id`):** now honors HTTP `Range` (206 +
  Accept-Ranges/Content-Range, 416 on unsatisfiable) via R2 head()+ranged get();
  full 200 fallback. Needed for reliable media seeking/streaming in-app.
- **Client (feed face):** 1×1 poster-fill cards; centered top sentence block
  (LINE1 activity sentence + LINE2 chip/episode/date); small blurry bottom block
  (comment pips + WATCH + heart like) with the episode note + audio inside;
  SVG glyph controls (speaker/play/pause/heart/comment, no emoji); follow chip
  states FRIEND / FOLLOWING / FOLLOW BACK / FOLLOW+ with in-place transitions;
  film "bought a ticket for" + PREMIERES block, no future personal dates.
  Heart "like" is client-side (localStorage) — no likes backend yet.
- **Deployed:** Worker Version 33ba1897-f08f-49bb-b069-faacea3b0717; Pages
  deployment 6bfdaab1 (branch main); live on remote.pangolinrc.com. Prod feed
  verified returning last_name + premiered.
- **iOS:** synced public/ → www/ (sync-www) + `cap copy ios`; bundle confirmed
  to contain the new build; opened Xcode for archive/distribute (build number
  auto-stamped — leave Xcode auto-increment off).

## 2026-08-10 (later) — Likes backend + follow structure + feed copy fixes

- **D1 migration 0027... → 0028_likes.sql (NEW):** `likes(user_email,
  subject_email, title_id, kind, created_at)` PK(all four) + idx on
  (subject_email,title_id,kind). Applied LOCAL only so far — NOT yet applied to
  remote D1. Must run `wrangler d1 migrations apply pangolin-rc --remote`
  BEFORE deploying the Worker (the feed's like subqueries reference this table).
- **Worker (`GET /profile/:email/feed`):** each row now returns `like_ct`
  (total likes on that activity) + `liked` (viewer's own), for watch (kind from
  titles) and ticket (kind='ticket') rows. Bind order changed to (email,
  ...actors) for the viewer subquery. `synced_ct` is now EPISODE-scoped: it
  matches watch_comment.episode_id to the current episode's code
  ('S'||printf('%02d',season)||'E'||printf('%02d',number)) so a show-level pile
  of comments no longer reads "92 of 5". Also returns `ticket_date`.
- **Worker (`POST /profile/:email/like`):** body {subject, title_id, kind,
  liked} → INSERT OR IGNORE / DELETE; returns {liked, count}. Follow/unfollow
  endpoints unchanged (feed chips now drive both).
- **Client (feed face):** SVG kind glyphs (TV/film/DVD/ticket) below the
  sentence; film activity drops the "…episode of" phrasing; self reads "You are
  watching"; weighted-random "bailed on/gave up on/abandoned/quit" rotation;
  past tickets read "saw … at THEATER on <Mon D, YYYY>", upcoming stay "bought a
  ticket for" + PREMIERES; heart is now server-backed with a live count; all
  four follow chips are a two-way follow/unfollow toggle; WATCH → shell
  cubeRotateTo('episodes') deep-link (loads the title in the LOG face),
  "WATCH WITH COMMENTS" when the actor left synced comments.
- **Deployed 2026-08-10 (web):** remote migration 0028_likes applied FIRST,
  then Worker Version c7157551-db8c-4f9d-a961-6d80f3b89530; Pages deployment
  37cb5130 (branch main); live on remote.pangolinrc.com. Prod-verified: feed
  returns like_ct/liked (no 500), POST /like returns {ok,liked,count}. iOS not
  rebuilt this round.
- Known open items: WATCH episode-scroll + auto-open comments (show-level
  works); a corrected transcription not propagating to a finalized end-note;
  feed date = server record time, not the action's local date.

## 2026-08-11 — Binge cycler + note episode-stamp (feed)

- **Worker (`GET /profile/:email/feed`):** each show row now returns `endnote_ep`
  (the episode the end-note is from, so the card can stamp "EPISODE NOTE · S03E10")
  and an `episodes` array — one grouped pass over watch_comment
  (GROUP BY user_email, show_id, episode_id; HAVING synced>0 OR has-endnote) giving
  {ep, synced, endnote_id/text/spoiler/audio} per content-bearing episode, ordered by
  code. Powers the binge cycler. Query-only additions — NO schema change.
- **Client (feed face):** binge cycler — a card for a binged show shows a ◀ EP ▶
  stepper that walks each consecutively-watched episode, swapping its synced pips,
  end-note, and WATCH target in place (prev/next disable at the ends; defaults to the
  newest episode that has a note). Kind glyphs now 32px + borderless; ticket line-2
  "at THEATER on <date>" fits one line; end-note stamped with its episode.
- **NOT deployed** (build/feedback turn). No new migration needed to ship (likes
  table already remote). Deploy = wrangler deploy + pages deploy when ready.

## 2026-08-11 (later) — deploy binge/glyph/deeplink; WATCH episode focus; demo-seed handoff

- **Deployed:** Worker Version cccaae4c-ac62-4ed0-a488-22503906b29d; Pages 734f3dcd
  (branch main); live on remote.pangolinrc.com. Ships last round's endnote_ep +
  episodes[] (binge cycler) backend — no schema change, no migration.
- **Client:** WATCH "…WITH COMMENTS" now deep-links the LOG face to the exact episode
  (cube_log_face `focusEpisode(code)` switches season, sets focus, reloads co-view
  comments; wired in the cube:payload handler). Follow-back now surfaces "slots full"
  instead of silently reverting when the friend-slot cap (basic=1) blocks completing
  the pair. Kind glyphs 2× + borderless; ticket meta one line; note episode-stamp.
- **iOS:** sync-www + cap copy done; Xcode opened for archive.
- **Prod demo cards (APPLIED 2026-08-11, user-authorized):**
  scripts/prod-demo-seed.sql — two ADDITIVE demo accounts: Alex
  (alex.demo@pangolinrc.app, friend, watching Hacks S05E09 + a co-view comment
  @3:00) and Sam (sam.demo@pangolinrc.app, follower → FOLLOW BACK, saw The
  Flash) — plus removal of the earlier `__smoketest__` like and a user-approved
  tier bump edward.m.willett@gmail.com → elite_pro (friend-slot headroom so the
  Sam FOLLOW BACK completes → friend). Edward's real data left intact. Verified
  in prod feed.

## 2026-08-12 — Ted Lasso S4 runtime fix + TMDB nominal-fallback guard

- **Bug:** `fetchTmdbTvRuntime` (src/handlers/tmdb.ts) fell back to a show's global
  `episode_run_time` slot (Ted Lasso's nominal 30 min) when TMDB had no per-episode
  runtime yet — the normal case for a just-aired season. `POST /catalog/runtime-check`
  treated that nominal as a valid second opinion and could auto-correct an episode's
  stored runtime down to it (30 sits "closer" to a ~43-min live watch than a too-long
  slot did), overshooting the true length.
- **Code fix (NOT deployed — no Worker deploy this session):**
  - `fetchTmdbTvRuntime` now returns `{ minutes, precise }`; `precise:true` only for a
    specific episode-level runtime, `precise:false` for the show-wide nominal fallback.
  - `runtime-check` auto-corrects ONLY on `precise` values; the nominal fallback can no
    longer overwrite an episode. Mismatch bug note distinguishes "no per-episode runtime
    yet — nominal slot ignored (would overshoot)".
- **D1 data fix (APPLIED, remote pangolin-rc):** Ted Lasso (title tvmaze:44458) S4
  episodes were materialized with `runtime=null` (future eps had no TVmaze runtime at
  ingest), so the frontend fell back to the show avg derived from S1E1=31 → displayed
  ~30. TVmaze now has real runtimes; backfilled S4E1=42, S4E2=47, S4E3=46
  (updated_at bumped). Remaining S4 eps still null upstream — will need the same
  backfill as they air.
- **D1 name refresh (APPLIED 2026-08-14, remote pangolin-rc):** S4E1-E5 names were
  stale "Episode N" placeholders (ingested before TVmaze titled them); updated to the
  real titles — E1 "Home", E2 "Curiouser and Curiouser!", E3 "Richmond's Got Talent",
  E4 "Greyhound's Day Off", E5 "Riches of Embarrassment" (via --file; wrangler d1
  execute has no --param). E6-E10 still placeholders upstream; E4/E5 runtimes still
  null (unaired) — both need the same backfill as episodes air.

## 2026-08-14 (later) — deploy runtime-check TMDB precise-only fix

- **Deployed:** Worker Version 23c8dc38-ed64-4403-a176-63e2581c6061 (wrangler 4.100.0),
  --message "runtime-check: only auto-correct on precise TMDB episode-level runtime;
  nominal show-average fallback no longer overwrites (Ted Lasso S4 30-min bug)". Ships
  the tmdb.ts `{minutes,precise}` change + catalog.ts runtime-check precise-only guard
  from the 2026-08-12 entry (previously "NOT deployed"). No schema change, no migration.
- **Pages:** not redeployed — change is Worker-only.

## 2026-08-14 (later still) — public waitlist form at join.pangolinrc.com

- **Migration (APPLIED, remote pangolin-rc):** `0029_waitlist_fields.sql` widens the
  `waitlist` table (was `email, created_at` from 0006) with `first_name, last_name,
  fav_show, buddy_email, source` (all additive `ADD COLUMN`, nullable). email stays PK.
- **Worker (DEPLOYED, Version a4cda0df-cfdf-4768-ab58-a68ffd04a475):** new
  `POST /waitlist` (`src/handlers/waitlist.ts`, mounted `/waitlist` in index.ts).
  Turnstile-gated (reuses the Pierre sitekey `0x4AAAAAADk1FhcGAkmQohVa` +
  `TURNSTILE_SECRET_KEY`; fails open only while secret unset), validates first/last/
  valid-email (400), drops malformed buddy email rather than rejecting, upserts on
  email conflict, mirrors `{email, created_at}` to Airtable `waitlist`. Returns
  `{status:'waitlist', ok:true}`. Live prod returns 403 to tokenless curl (bot gate
  working as intended).
- **New Pages project `pangolinrc-join`** (direct-upload) serves `join/index.html` —
  a standalone form (First/Last/Email required; Favorite show + TV-buddy email
  optional) POSTing to the Worker. Custom domain `join.pangolinrc.com` attached (new
  CNAME → pangolinrc-join.pages.dev; nothing replaced). Separate from the app
  (`pangolin-rc`) and the splash (`pangolinrc-splash`).
- **Turnstile:** added `join.pangolinrc.com` to the `pangolin-rc Pierre (Spin)` widget's
  allowed hostnames (now 4/10) so the invisible widget mints tokens on the join page.

## 2026-08-14 (later) — SendGrid signup-notification email

- **Worker (DEPLOYED, Version 0173e1f3-1f74-43b2-9b01-54149a541d73):** `/waitlist`
  (`src/handlers/waitlist.ts`) now fires a best-effort SendGrid v3 email on each
  signup via `notifySignup()` — `c.executionCtx.waitUntil`, never blocks/fails the
  signup. To `WAITLIST_NOTIFY_TO` (default `waitlist@pangolinrc.com`), from
  `WAITLIST_NOTIFY_FROM` (default `waitlist@pangolinrc.com`, on the SendGrid-
  authenticated domain), `reply_to` = the signup's own email. **No-ops until the
  secret `SENDGRID_API_KEY` is set** (fails open, like the Turnstile gate).
- **Env (`src/types.ts`):** added `SENDGRID_API_KEY?` (secret), `WAITLIST_NOTIFY_TO?`,
  `WAITLIST_NOTIFY_FROM?` (vars).
- **Manual step outstanding:** set `SENDGRID_API_KEY` (Mail Send scope) as a Worker
  secret — not yet configured at time of this deploy.

## 2026-08-14 (later) — waitlist admin page (users.pangolinrc.com)

- **Migration (APPLIED, remote pangolin-rc):** `0030_waitlist_status.sql` — additive
  `ALTER TABLE waitlist ADD COLUMN status TEXT NOT NULL DEFAULT 'new'`. Existing rows → 'new'.
- **Worker (DEPLOYED, Version 41bc4636-23d8-4592-baa6-debf49a318db):** two new
  password-gated routes in `src/handlers/waitlist.ts` — `GET /waitlist/admin/list`
  and `POST /waitlist/admin/status` ({email,status}). Shared-password gate
  (`adminGate`, constant-time compare) against secret `USERS_ADMIN_PASSWORD`.
  **Fail-CLOSED: 503 until the secret is set**, 401 on wrong/no password. Status
  values validated against new|invited|active|declined. Verified live: both routes
  503 while the secret is unset.
- **New Pages project `pangolinrc-users`** serves `users/index.html` (password gate →
  waitlist table → per-row status dropdown; `noindex`). Custom domain
  `users.pangolinrc.com` attached (new CNAME → pangolinrc-users.pages.dev; nothing
  replaced). API base = the Worker on workers.dev; CORS is `*`.
- **Env (`src/types.ts`):** added `USERS_ADMIN_PASSWORD?` (secret).
- **Manual step outstanding:** set `USERS_ADMIN_PASSWORD` as a Worker secret — until
  then the page shows "Admin isn't configured yet" and the endpoints return 503.

## 2026-08-15 — Pierre chat: native app secret bypasses Turnstile

- **Why:** Turnstile can't run inside the iOS Capacitor WKWebview, so every
  native `/pierre/chat` send arrived with an empty token and 403'd at the bot
  gate ("The signal dropped" in Pierre's chat). Web (`remote.pangolinrc.com`,
  an allowlisted https host) was unaffected.
- **Worker (DEPLOYED, Version 4a1e5c00-80ed-418b-a25a-d64e0108ad59):**
  `src/handlers/pierre.ts` bot gate now accepts a valid `appToken` (constant-time
  `safeEqual` vs `APP_NATIVE_SECRET`) as an alternative to a Turnstile token.
  Web still must clear Turnstile; native clears via the app secret. Fails the
  same closed 403 on a bad/missing token.
- **Env (`src/types.ts`):** added `APP_NATIVE_SECRET?` (secret).
- **Secret SET:** `APP_NATIVE_SECRET` uploaded via `wrangler secret put`.
  Must equal the value baked into the native app (see below).
- **Verified live:** valid appToken → 200 `{"reply":"CONNECTED"}`; wrong appToken
  + no Turnstile → 403.
- **Client (`public/cube_pierre_face.html`):** on native (Capacitor
  `isNativePlatform()`), fetches the secret from the `AppAuth` plugin and sends
  it as `appToken`, skipping Turnstile; web path unchanged. Mirrored to `www/`
  and `cap copy`'d into the iOS bundle (byte-identical).
- **Native (`ios/App/App/WebosLanPlugin.swift`):** appended an `AppAuthPlugin`
  (jsName `AppAuth`, method `token()`) returning the shared secret. Lives in the
  compiled binary only — deliberately NOT in the web bundle, which is served
  publicly. **Rotate = change this constant AND the Worker secret together.**
  **CORRECTION (2026-08-17):** the original claim that being in the same file as
  WebosLan meant "no project.pbxproj change; Capacitor auto-discovers it" was
  WRONG — `WebosLanPlugin.swift` was never a member of the App build target, so
  the whole file (WebosLan, AppBadge, AppAuth) never compiled and `AppAuth` was
  absent at runtime. See the 2026-08-17 entry below.
- **Web (Pages):** `cube_pierre_face.html` change is a behavioral no-op on web
  (still Turnstile); deployed to keep public/ and live in sync.

## 2026-08-17 — Fix: AppAuth (and WebosLan/AppBadge) native plugins never compiled

- **Why:** Pierre chat still failed in the iOS app; on-screen DIAG showed
  `err=no AppAuth plugin` with the plugin list containing only Capacitor
  built-ins. Root cause: `ios/App/App/WebosLanPlugin.swift` — which holds
  `WebosLanPlugin`, `AppAuthPlugin`, and `AppBadgePlugin` — was never added to
  the App target in `App.xcodeproj/project.pbxproj` (only `AppDelegate.swift`
  was in the Sources build phase). So none of the three custom plugins existed
  in the binary. The earlier "Capacitor auto-discovers it" assumption was false.
- **Fix 1 (native project):** added `WebosLanPlugin.swift` to the App target via
  four pbxproj entries (PBXBuildFile, PBXFileReference, App PBXGroup child,
  Sources build phase). `plutil -lint` OK. **This was necessary but NOT sufficient
  — see the 2026-08-17 (later) entry below: compiled ≠ registered.**

## 2026-08-17 (later) — REAL fix: register the app-embedded plugins with the bridge

- **Why the first fix wasn't enough:** After the plugins compiled, Ted shipped a
  TestFlight build and Pierre STILL failed. Verified in the iOS simulator (built,
  installed, read the WKWebView console via Capacitor's Console plugin → os_log):
  `PGPROBE native=true reg=false … token=EMPTY`. Two facts surfaced:
  1. `window.Capacitor.registerPlugin` is **undefined everywhere** (even the top
     frame) — this app is plain HTML/JS with **no `@capacitor/core` import**, so
     `Capacitor` is only the native-injected bridge. Custom plugins must be reached
     via `Capacitor.Plugins.<jsName>`, not `registerPlugin()`.
  2. `Capacitor.Plugins.AppAuth` was **undefined** because Capacitor only registers
     its 5 built-ins (Http/Console/WebView/Cookies/SystemBars — exactly the DIAG
     list) plus `packageClassList` from `capacitor.config.json` (Filesystem,
     LocalNotifications, Share, CardVideo). App-target plugins are in neither list
     → compiled but **never registered** (`CapacitorBridge.registerPlugins()`).
- **Fix 2 (the real one):** new **`ios/App/App/MainViewController.swift`** —
  `class MainViewController: CAPBridgeViewController` overriding `capacitorDidLoad()`
  to call `bridge?.registerPluginInstance(...)` for `WebosLanPlugin`, `AppAuthPlugin`,
  `AppBadgePlugin`. (`registerPluginInstance` works even with `autoRegisterPlugins`
  on; `registerPluginType` would no-op.) `Main.storyboard` initial VC customClass
  `CAPBridgeViewController`→`MainViewController` (customModule `App`). Added the
  file to the App target (4 pbxproj entries).
- **Fix 3 (web, defensive):** `public/cube_pierre_face.html` — the Pierre face runs
  in an iframe whose Capacitor is even more partial; it now (a) prefers a shell
  helper `window.top.pgAppNativeToken()` and (b) scans frames for a usable
  Capacitor. `public/cube_shell.js` — exposes `window.pgAppNativeToken()` (top-frame
  getter). Mirrored to `www/`, `cap copy`'d to the iOS bundle. Also enriched the
  on-screen DIAG (per-frame reg/plugin counts + shellFn).
- **VERIFIED in simulator (not a guess):** after Fix 2+3, re-probe returned
  `PGPROBE token=ed53bbc5..len64` (the exact `APP_NATIVE_SECRET` from the Swift
  constant) with `To Native -> AppAuth token` firing; `AppBadge` registered too.
  Clean `xcodebuild` succeeds and the app **launches without crashing** (confirms
  the storyboard customModule=`App` wiring). Backend half already confirmed live
  (valid appToken → 200 `{"reply":"PONG"}`).
- **Still requires** a clean Xcode build + new TestFlight build on a real device
  to reach Ted's phone (web UI is served from the local bundle; no `server.url`).
- **Waitlist admin vocab rename (DEPLOYED, Version e557f2cf-95aa-4668-be57-bbe5dd0fde63):**
  `src/handlers/admin.ts` `WAITLIST_GROUPS` — renamed `'Tester Cohort 1'` →
  `"Founder's Circle"` (drives admin group column, filters, write validation).
  Checked live D1 first: no waitlist rows used the old value (2 rows, both empty
  group), so no data migration needed.

## 2026-08-18 — Pierre backfill tiles + band fixes + no-lie
- POST /catalog/backfill (replaces /catalog/backfill-movie): title_id-based, handles FILM and SERIES. Movie=1 ep; show=all aired eps done, watch_title completed, reflection episode_id='🎬'|'S..E..'. Client (cube_pierre_face runBackfill) now searches TMDB movies + TVmaze shows and shows tiles (presentPicker); doBackfill posts the picked title_id. Fixes The Leftovers logging as a movie.
- POST /pierre/escalate {email, conversation_id, note?}: inserts needs_ted=1 turn into the CURRENT conversation so GET TED closes out the real session (not a synthetic one). Band GET TED + selfEscalate use it.
- Feedback band: Pierre-face only (pierreMicSync→_setFeedbackBand), ready-gated (thumbs/GET TED inactive until Pierre has replied; pierre:fb-ready). Thumbs post /feedback then clearChat() (ends+resets chat). Consolidated duplicate clearChat into one full reset.
- Prompt: hardened no-lie rule — only the [BACKFILL] tag logs; falsely saying "done" is the worst thing Pierre can do (fixes session 4c10d75d).

## 2026-08-21 — Conversational episode backfill + Audrey rename + deploys
- **Worker DEPLOYED (Version 9569797e-3dc3-46c7-9f07-72e2c281f1d4).**
- POST /catalog/backfill-episode (new, src/handlers/catalog.ts): logs ONE episode of an
  ongoing series as watched+backdated (vs /catalog/backfill which completes a whole title).
  Body {email, title_id, watched_at, season?, number?, rating?}; resolves explicit SxEy or
  the latest AIRED episode via materializeTitle; writes one watch_episode (done) + advances
  watch_title current_episode (status 'current', ON CONFLICT never downgrades a finished show).
  Drives the Pierre [WATCHED] confirm-chip flow (cube_pierre_face.html parseWatched/runWatched).
- Pierre prompt (src/handlers/pierre.ts): new "[WATCHED] tag" section — conversational single-
  episode backfill, forward-looking, passes member's words (app resolves episode/date/who).
- **D1 (pangolin-rc, remote):** UPDATE users SET username='Audrey' WHERE
  email='audrey.arya.willett@gmail.com' (was 'audrey.arya.willett'; 'Audrey' was free). 1 row.
- **Pages DEPLOYED** (wrangler pages deploy public → https://f7c1dfc6.pangolin-rc.pages.dev,
  main→remote.pangolinrc.com): flat-app safe-area top inset, Nunito tab font, Profile Cube|Flat
  toggle + pg_mode persistence + launch router, bug reporter hidden app-wide, Pierre keyboard/
  scroll fit (flat), tab-bar redesign (order PIERRE·WATCH·LOG·FEED·BROWSE·PROFILE, no dots,
  tiny pierre.png on PIERRE, JOIN→BROWSE), and the [WATCHED] confirm-chip face.

## 2026-08-25 — Pierre [TRT] runtime-correction skill (DEPLOYED)
- **Worker DEPLOYED** (Version 07efb2d1-0589-49cf-8bbe-9c80c9a322dc). **Pages DEPLOYED**
  to production (deployment 2bcd15a8, `--branch main` → remote.pangolinrc.com); this Pages
  deploy also shipped the flat-view keyboard/tab-drift fix (public/flat_shell.js). NOTE: a
  first `pages deploy` with no --branch landed on the git-branch alias
  (endnote-one-reply-flow.pangolin-rc.pages.dev), NOT production — must pass `--branch main`.
- **Reuses POST /catalog/runtime-report** (no new route). Added a hybrid authority path
  in `src/handlers/catalog.ts`: after the report upsert it looks up the reporter's
  `users.user_type`; if `'admin'`, applies the observed runtime to the global `episodes`
  catalog IMMEDIATELY (no consensus wait) and marks matching reports `applied`. Non-admins
  still feed the existing 2-distinct-user consensus. Response now carries `byAuthority`.
- Pierre prompt (`src/handlers/pierre.ts`): new "[TRT] tag" section — member states a real
  running time for an episode ("that ep was 42 min") or film ("Sinners runs 2h 17m"); Pierre
  emits `[TRT: title | episode | minutes]` (episode blank for a film), forward-looking, no
  past-tense claim without the tag.
- Client (`public/cube_pierre_face.html`, mirrored to `www/`): parseTRT + parseMinutes
  ("1h 30m"→90) + runTRT/proposeTRT/applyTRT — resolves title (TMDB film / TVmaze series) and
  episode (explicit SxEy or latest aired), hands back ONE confirm chip; only the tap POSTs to
  /catalog/runtime-report. Confirms per response: admin→"set in the catalog now"; consensus
  hit→"now X min for everyone"; otherwise "noted, needs one more / Ted"; 404→"not in catalog yet".
- **Web is live** (Worker + Pages above). iOS/TestFlight still needs a bundle rebuild
  (cap copy + Xcode) to carry the [TRT] face + tab fix into the app.

## 2026-08-25 — TRT any-title + LOG force-start unaired (DEPLOYED)
- **Worker DEPLOYED** (Version bfb7560d-16f5-421a-896d-f9ae4e8a4751). **Pages DEPLOYED**
  (deployment 0f96b45d, --branch main → remote.pangolinrc.com).
- `src/handlers/catalog.ts` /catalog/runtime-report: when the episode isn't in `episodes`,
  now `materializeTitle` on demand (splitTitleId → tvmaze:/tmdb:) then re-check, so [TRT]
  works for ANY show/film, not only ones already in the member's log. Ingests future episodes
  too (runtime null), so a not-yet-aired drop can be set. 404 only when truly unresolvable.
  Client (cube_pierre_face applyTRT) 404 copy softened to "double-check the title and episode".
- LOG face (public/cube_log_face.html): long-press (~0.6s) the greyed START ('notify' action)
  FORCES an unaired episode through for members with early access — sets wowForced[focus] so the
  paint state machine stops treating it as unaired and startEpisode() runs. Short tap still
  swings to Pierre notify. Pierre's offerNotify message now tells the member about the long-press.

## 2026-08-25 — Ambient "go dark but stay open" + story-export fix (web DEPLOYED; iOS pending build)
- **Pages DEPLOYED** (deployment db214c9e, --branch main → remote.pangolinrc.com). Client-only,
  no Worker/D1 change.
- New dep `@capacitor-community/keep-awake@8.0.1` (native keep-awake; web uses Screen Wake Lock).
  Requires an iOS build to take effect natively — `cap sync ios` done, Xcode opened.
- Flat app: Profile "Screen while watching" toggle (pg_screen: on|sleep, default on); flat_shell
  keeps the screen awake + fades a black #screen-dim overlay after 5s idle WHILE a watch timer
  runs; tap wakes. LOG face posts pg:watch (500ms change-detector off watchingLive) + pg:wake on
  a fresh friend co-view comment (shell holds awake ~20s). Cube app: toggle inert (frozen).
- Also in this iOS build (compiled from capacitor-card-video/): story-export fix — CardVideo now
  writes a 30fps CFR still instead of 2 frames, so IG Stories stop playing it "super fast".

## 2026-08-26 — Poster-forward share card + edited-transcript persistence (web DEPLOYED; iOS pending build)
- **Pages DEPLOYED** (deployment 182b5668, --branch main → remote.pangolinrc.com). Client-only,
  **no Worker/D1 change** — the transcript fix reuses the existing `PATCH /transcribe/:id`.
- Share cards: new shared renderer `public/pg_share_card.js` (+ `public/pg_share_qr.js`, a
  baked-in QR matrix for https://pangolinrc.com drawn as rects so the card canvas stays
  exportable). Both the IRL ticket (`buildTicketCard`, cube_browse_face) and the TV-show
  reflection (`buildReflectionCard`, cube_pierre_face) now delegate to it: full-bleed poster,
  big title, avatar+name, quote, meta, and a bottom band of Pierre · pangolinrc.com/scan · QR.
  Pierre-face video path (buildStoryFrame/buildShareVideo) now paints the already-9:16 card
  full-frame.
- Bug fix (recorded reflections): `commitEndnote` now PATCHes `/transcribe/:id` with the member's
  edited text before `/finalize`, so a corrected transcript persists to the shared comment
  (previously finalize only stamped endnote/spoiler and kept Whisper's raw text).

## 2026-08-26 — Default everyone to flat view (web DEPLOYED; iOS pending build)
- **Pages DEPLOYED** (deployment 133883d6, --branch main → remote.pangolinrc.com). Client-only,
  no Worker/D1 change.
- Launch router (`index.html`): flat is now the default surface — redirects to `/app.html`
  unless `pg_mode==='cube'`. Profile App-style toggle (`cube_profile_face.html`) reads unset as
  flat. Flat header "Back to the cube" button now sets `pg_mode='cube'` before navigating so the
  cube stays reachable for a deliberate opt-in (otherwise the new redirect bounces it back).
