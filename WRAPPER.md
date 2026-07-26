# WRAPPER.md — iOS wrapper build log

Frontend/wrapper work log (the counterpart to BACKEND.md, per
capacitor-integration-spec.md: wrapper sessions add a WRAPPER note here,
same-session rule).

---

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
