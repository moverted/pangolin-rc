# WRAPPER.md — iOS wrapper build log

Frontend/wrapper work log (the counterpart to BACKEND.md, per
capacitor-integration-spec.md: wrapper sessions add a WRAPPER note here,
same-session rule).

---

## 2026-07-27 — TestFlight build 6 (1.0.1) — native share (IG Stories fix) + season/series cards [PREPPED, archive+upload pending Ted]

- **Build 6, marketing 1.0.1.** Bumped `CURRENT_PROJECT_VERSION` 5→6 (both Debug +
  Release). **Supersedes build 5** (never uploaded) — build 6 carries everything build 5
  had PLUS the season/series reflection cards and the native-share fix.
- **NEW native plugins:** `@capacitor/share@8.0.1` + `@capacitor/filesystem@8.1.2`
  (`npm install`). `cap sync ios` wrote them into `ios/App/CapApp-SPM/Package.swift`
  (local `node_modules` SPM paths) — Found 2 plugins for ios. **node_modules must be
  present at archive time** for SPM to resolve.
- **Fixes IG Stories share** (`doShareCard` in `cube_pierre_face.html`): web-share can't
  attach a file inside WKWebView, so it degraded to text and IG rejected it ("Can't send
  link"). Now, on the native platform, the card PNG is written to CACHE via Filesystem and
  shared through the native OS sheet (`Share.share({files:[uri]})`) — the IMAGE reaches IG.
  Web/PWA still uses `navigator.share`. Capacitor bridge is read from the TOP window
  (`window.top.Capacitor`) since the share runs inside the Pierre face iframe.
- **Also bundles** (all live on web since this session): share-card redesign + season/
  series/episode reflection cards + finish-flow wiring (season wrap / series end).
- **Archive + upload = Ted's step** (Xcode Organizer or `xcodebuild -scheme App
  -configuration Release archive`, automatic signing, team `289R5P7B76`), then Distribute
  → App Store Connect → Upload → Beta App Review. **Watch the build** — this is the first
  build to add native plugins via SPM; if it fails to resolve, it's a `node_modules`/SPM
  issue, not signing. On-device check per BUILD-SHEET §6: finish an episode → SHARE →
  Instagram → **Stories** should now take the image.
- **Known bug NOT fixed here:** episode finishes for S02E07/E08 didn't log (list stops at
  S02E06); flagged for a separate look.

## 2026-07-27 — TestFlight build 5 (1.0.1) — share/reflection card redesign [PREPPED, archive+upload pending Ted]

- **Build 5, marketing 1.0.1.** Bumped `CURRENT_PROJECT_VERSION` 4→5 in
  `App.xcodeproj/project.pbxproj` (both Debug + Release). `MARKETING_VERSION` stays
  `1.0.1`.
- **`cap sync ios` ran clean** after `sync-www` — copied the updated `www/` into
  `ios/App/App/public/`. Verified the bundle now carries the new card code
  (`_cutout`, "watch with pangolinRC to hear", "Comments hidden at", "see the comment
  in pangolinRC"); `ios/App/App/public/` is gitignored (mirror of `www/`).
- **Bundles the finished-episode share/reflection card redesign** (already live on the
  web/PWA at `remote.pangolinrc.com`, Pages deploy `31ad1aeb`; web commit `6d6d294`,
  PR #28): username→email→"Someone" name fallback, live hidden-comment-times teaser
  list + "hear them in real time" CTA (generic co-watch CTA when none), poster-hugging
  copy, red cocked BINGE/FRESH stamp, cut-out Pierre on the green box, SPOILER-FREE/
  SPOILER label over his head, 4-line quote with ellipsis overrun, new spoiler copy.
- **Archive + upload NOT done here** — the archive is Ted's step (Xcode Organizer or
  `xcodebuild -scheme App -configuration Release archive`, automatic signing, team
  `289R5P7B76`), then Distribute App → App Store Connect → Upload, then Beta App
  Review / cohort in App Store Connect. On-device checks per BUILD-SHEET §6 (share
  card → Instagram Stories) before/after.
- **Note:** build 4 (1.0.1) archive's upload was still pending Ted as of the last
  entry — confirm whether 4 was ever uploaded; if not, 5 supersedes it.

## 2026-07-26 — TestFlight build 4 (1.0.1) — WoW in-season scheduler [ARCHIVED, upload pending Ted]

- **Build 4, marketing 1.0.1.** Bumped `CURRENT_PROJECT_VERSION` 3→4 and
  `MARKETING_VERSION` 1.0→1.0.1 in `App.xcodeproj/project.pbxproj` (both Debug +
  Release). `cap sync ios` ran clean (no bundle diff — `www/` already synced).
- **Archived from CLI** (`xcodebuild -scheme App -configuration Release archive`,
  automatic signing, team `289R5P7B76`): **ARCHIVE SUCCEEDED**, validated-for-store,
  `CFBundleShortVersionString 1.0.1 / CFBundleVersion 4 / com.PangolinRC.remote`.
  Copied into `~/Library/Developer/Xcode/Archives/2026-07-26/` so it shows in Xcode
  Organizer.
- **Upload NOT done here** — TestFlight distribution needs App Store Connect
  authentication + is an outward-facing publish, so it's Ted's step: Xcode Organizer
  → the "PangolinRC 1.0.1 (4)" archive → Distribute App → App Store Connect → Upload,
  then Beta App Review / cohort assignment in App Store Connect. Tag `tf-4` marks the
  source (web commit `3bbf49b`).
- **Bundles the WoW in-season scheduler v1.0.1** (already live on the web/PWA at
  `remote.pangolinrc.com`, merged to `main` `f7a50d0`): shared `wow-scheduler.js`
  service, Worker `/scheduler/*` on the `pangolinrc-scheduler` D1, WATCH on/off
  pattern stamp, LOG 2-week drop label, proactive Pierre RAMP nudge, share-card
  watch-state stamp (MORE!→BINGE), Profile default + re-enable. Movies excluded.

## 2026-07-26 — TestFlight build 3 (1.0) — prelaunch fixes + share card + reflection comments

- **Build 3, marketing 1.0.** Archived + uploaded to Apple (Organizer: "Uploaded
  to Apple"). Bumped CURRENT_PROJECT_VERSION 2→3 (build 2 was already used twice —
  reuse would've been a duplicate rejection). Tagged `tf-3` on web commit `90e430d`.
- **Bundles this session's shipped work** (all live on `remote.pangolinrc.com`):
  reopen→LOG-face fix, binge marker across reloads, wheel-on-reopen fix, feed show
  posters, Skip chip, Pierre-note transcription fix, share card + spoiler toggle,
  reflection→co-view comment (audio+text), reflection cap-exemption (D1 0024).
- **Build failure fixed mid-archive:** the icon compile failed because
  `ios/App/App/Assets.xcassets` had been deleted from disk (committed on a feature
  branch, not `main`, so a `git checkout main` removed it). Restored from git
  (`git restore --source=6304252`) and left **untracked** so a branch switch can't
  delete it again. Icon validated: 1024², sRGB, no alpha.
- **On-device checks (BUILD-SHEET §6):** sleep mid-timer → reopen lands on LOG with
  a working wheel; reflection recording → appears in the comment list; share card
  → Instagram Stories.
- **Not done here:** Beta App Review / SNW Cohort assignment happens in App Store
  Connect (Ted).

## 2026-07-03 — Pre-scaffold web prep (ahead of Sunday July 5)

- **sync-www script** added: `scripts/sync-www.mjs`. Copies `public/` → `www/`
  (excludes `_redirects`), verifies all 9 boot-critical files. Tested, passing.
  `www/` added to .gitignore.
- **Viewport:** `viewport-fit=cover` added to the shell (`index.html`) and the
  four faces that lacked it (log, pierre, profile, watch). browse/feed already
  had it.
- **Safe areas (shell chrome only, faces untouched):** `#controls` bottom
  padding now `max(80px, safe-area-inset-bottom + 56px)`; `#caption` and
  `#demoband` top padding now add `safe-area-inset-top`. `#bug-btn` already
  handled insets.
- **WKWebView gesture hardening:** `overscroll-behavior: none` + `position:
  fixed` on body (no rubber-band); `-webkit-touch-callout: none` on `#canvas`
  and `#wheel` (no long-press callout). `touch-action: none` was already on
  both drag surfaces.
- **Absolute-URL audit:** clean. All API calls go through `API`/`API_BASE`
  constants (workers.dev, cross-origin — fine under `capacitor://localhost`).
  Face iframe srcs and module script srcs are root-absolute (`/…`), which
  Capacitor serves correctly from `www/`. `_redirects` holds only legacy-path
  301s; nothing in the codebase references the old paths.
- **Not done (needs Ted's Mac):** npm install of Capacitor, `cap init/add ios`,
  Xcode signing, Simulator/device passes — the Sunday sequence steps 1–2, 4–9.
- **Flag for Tuesday's events Worker:** CORS allowlist must include
  `capacitor://localhost` (spec requirement).
