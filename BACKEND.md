# BACKEND.md — Worker / D1 / deploy log

Append-only log. Any session that touches the Worker, D1, or deploy
configuration adds an entry here before the session ends (see CLAUDE.md,
"Backend and deploy rules").

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
