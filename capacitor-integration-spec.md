# Capacitor Integration Spec — PangolinRC iOS Wrapper

*Handoff document for Claude Code. Scaffold date: Sunday July 5, 2026. Read fully before touching anything. Per CLAUDE.md: all of this is branch work; nothing merges to main without Ted's explicit confirmation.*

## Intent

Wrap the existing PangolinRC web app (the cube) in Capacitor to produce a real iOS app for TestFlight distribution to the July 23 tester round. This is a wrapper, not a rewrite. The web codebase stays the single source of truth and keeps deploying to Cloudflare Pages unchanged.

## Identity decisions (locked, do not improvise)

- **Bundle ID:** `com.pangolinrc.remote`
- **Display name:** PangolinRC
- **Version scheme:** MARKETING_VERSION starts at `0.1.0`, bumps by 0.0.x for tester-round fixes. CURRENT_PROJECT_VERSION (build number) is an integer starting at `1`, incremented on every TestFlight upload, never reused, never reset.
- **Deployment target:** iOS 16.0 minimum.
- **Orientation:** portrait only for the tester round. The cube is designed square-in-portrait; do not add landscape.

## Architecture rules

1. **Bundled assets, not a remote shell.** Copy the same static files that deploy to Pages into the Capacitor `www` directory. Do NOT set `server.url` to point at remote.pangolinrc.com. Reasons: App Review treats thin remote shells poorly, offline behavior is sane, and the app is testable without the network.
2. **No build tooling enters the web codebase.** The project is native ES modules by design. The "build step" is a file copy (a small `sync-www` script: copy index.html, cube_shell.js, clickwheel.js, all six cube_*_face.html files, assets, fonts config). If Capacitor tooling suggests bundlers, decline.
3. **Faces never call each other; all coordination through CubeShell.** Unchanged inside the wrapper. Nothing about Capacitor alters the contract.
4. **Origin fact to carry everywhere:** inside the app the origin is `capacitor://localhost`. Consequences:
   - localStorage (`pangolin_events_v2`) is a fresh store per install; nothing carries over from Safari. Acceptable for the tester round.
   - The events Worker CORS allowlist MUST include `capacitor://localhost` alongside `https://remote.pangolinrc.com`. This goes into Tuesday's Worker generation as a requirement, and into any interim fetch testing.
   - Any absolute URLs assuming the Pages origin must be found and made relative or explicit.

## capacitor.config (JSON) essentials

- appId: `com.pangolinrc.remote`
- appName: `PangolinRC`
- webDir: `www`
- No `server.url`. `server.androidScheme` irrelevant (iOS only).
- Splash/status bar: dark background matching the warm dark base token; status bar style light-content.

## WKWebView and UI notes (the fiddly part)

- **Viewport:** ensure `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. The `viewport-fit=cover` is required for safe-area insets to exist at all.
- **Safe areas:** the cube shell must respect `env(safe-area-inset-top/bottom/left/right)`. Pad the shell chrome, not the faces; faces stay square. Verify nothing hides under the Dynamic Island or the home indicator.
- **Clickwheel and cube touch handling in WKWebView:**
  - Add `touch-action: none` on the clickwheel and cube drag surfaces so WKWebView doesn't hijack gestures for scrolling.
  - Disable rubber-band overscroll on the body (fixed positioning or `overscroll-behavior: none`) so wheel drags don't bounce the whole viewport.
  - Kill double-tap zoom and long-press callouts on interactive surfaces (`touch-action` handles most; add `-webkit-touch-callout: none` and `user-select: none` on controls only, never on text content).
  - Faces that scroll internally keep `-webkit-overflow-scrolling: touch` behavior; only the shell is locked.
- **Fonts:** Google Fonts links work in WKWebView but require network. For the tester round the link is acceptable; note as a later hardening item to self-host Space Grotesk / Inter / mono in `www/fonts`.
- **Audio/mic:** out of scope. Sync is cut from round one. Do not add mic permissions or plugins; an unused NSMicrophoneUsageDescription invites App Review questions.

## Scaffold sequence (Sunday)

1. `npm init -y` at repo root if no package.json (wrapper deps only; web code stays module-plain)
2. `npm install @capacitor/core @capacitor/cli @capacitor/ios`
3. Create `sync-www` copy script; run it; confirm `www/` mirrors the deployed site
4. `npx cap init PangolinRC com.pangolinrc.remote --web-dir www`
5. `npx cap add ios`
6. `npx cap open ios`; set team (free provisioning until enrollment clears), deployment target 16.0, portrait lock
7. Run in Simulator: full six-face pass
8. Build to Ted's iPhone via cable: six-face pass on device
9. Report findings as a list: works / broken / cosmetic. Fix only navigation blockers. Log the rest.

## Out of scope (do not do)

- No push notifications, no notification plugins (deliberately deferred; group text is the notification layer)
- No mic, no whisper-sync wiring
- No App Store Connect work (that is the July 13 block)
- No changes to the event spine or storage keys
- No landscape, no iPad idiom

## Definition of done for the scaffold

The app runs on Ted's physical iPhone, all six faces reachable via clickwheel and cube rotation, faces render inside safe areas, internal scrolling works, and the repo contains the sync-www script plus this spec checked in. BACKEND.md is not touched (this is frontend/wrapper work); add a WRAPPER note to the build log section of the repo instead, same-session rule applies.
