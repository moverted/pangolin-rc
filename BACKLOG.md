# BACKLOG — parked work

Items deferred until after the tester round / on a more stable base, per the
freeze rule (CLAUDE.md — since 2026-07-20: bug fixes + copy only until the tester
round concludes). Each entry says where the work lives and why it waits, so it's
resumable without re-deriving it.

---

## Device control — native LG webOS (SSAP) over the LAN
Parked 2026-07-25.

- **Status:** spike complete — the SSAP control path is *proven end-to-end against
  a real TV* (secure pairing, persistent key, commands accepted). The in-app native
  port is written but **not yet built/verified in Xcode**.
- **Lives on:** branch `spike/webos-native` (not merged to main). Full build + test
  guide is `WEBOS-NATIVE.md` on that branch.
- **Done:**
  - `bridge/webos-spike.mjs` — runnable SSAP test (secure `wss://:3001`, pairing,
    pointer socket, nav/media commands).
  - `bridge/webos-pairing.json` / `public/webos-pairing.json` — LG's canonical
    signed manifest (grants `CONTROL_MOUSE_AND_KEYBOARD` → nav/BACK).
  - `ios/App/App/WebosLanPlugin.swift` — native WebSocket transport that trusts the
    TV's self-signed LAN cert (on disk in the untracked iOS project).
  - `public/webos-client.js` — SSAP protocol in JS over that transport.
  - `cube_shell.js` `sendKey` hook (native-direct when `window.__webosDirectIp` set,
    cloud fallback otherwise) + `Info.plist` local-network permission.
- **Left (stage 3, post-test):**
  - Xcode build: add `WebosLanPlugin.swift` to the App target, run on device, test.
  - Read the selected device's IP from the profile; go native only when the phone
    is on that LAN, else cloud/bridge (away-from-home).
  - Device discovery via **SSDP/mDNS** (drop the "type your IP" step).
  - Fix `bridge/webos.mjs` (cloud bridge) to use `wss://:3001` — the dead `:3000`
    fails on newer webOS.
  - Fire TV / other protocols remain on the cloud/ADB bridge.
- **Why parked:** new native surface area; resume after the test or on a stable base.

---

## 1.0.2 — Group / co-watching ("who's in the room")
Parked 2026-08-17. **This is the big 1.0.2 theme** — the feature that only came into
focus once Pierre was live. Bump the version to 1.0.2 when this batch starts (a version
change is just changelog discipline; TestFlight still runs its beta review either way,
and full App Store review only happens at public release).

- **The problem.** Watching is rarely solo. Real rooms (Ted's own): Ludwig with Anne;
  Ted Lasso with Anne + Audrey (sometimes Bryce); Strange New Worlds with Anne + Rose;
  the rest solo. So "What shows am I watching right now?" is a *loaded* question — the
  honest answer depends on who else is on the couch, and the co-viewers may have no
  usable account:
  - **Rose** — no account, never will.
  - **Anne, Audrey** — have accounts, but haven't been reliably added to the cohort
    (cohort/TestFlight onboarding friction).
  - **Bryce** — has access but has never logged in.
- **What to design (not built yet):** a way to attach *other people in the room* to a
  watch / episode / title — accountless "room members" (name-only, like Rose) that can
  be promoted to a real linked account later. Pierre should be able to ask/read "who did
  you watch this with" and factor it into answers. Think: a room roster per title/session,
  distinct from the follow-graph.
- **Why parked:** genuinely new surface area (data model + Pierre context + onboarding);
  Ted wants to design it deliberately. Explore *after* the context clear.

---

## 1.0.2 — Comment KIND: `pierre_chat` (full thread, gradeable)
Parked 2026-08-17. Surfaced when Ted asked Pierre "What shows am I watching right now?"
and the resulting admin comment (CREATED 2026-08-17 16:43) was mis-labeled **KIND:
episode**.

- **The problem.** Pierre-chat turns land in the same comment stream as episode
  reflections and read as `KIND: episode`, polluting the episode/reflection data.
- **What to do (not built yet):**
  - Add a distinct comment **kind = `pierre_chat`**. Comment tables:
    `migrations/0015_watch_comment.sql` (base) + `0026_watch_comment_endnote.sql`
    (endnote kind marker). Admin renders `kind` as a pill (`admin/index.html`,
    `PILL_COLS`). Pierre handler is `src/handlers/pierre.ts` (route `/pierre` wired at
    `src/index.ts:1243`) — today it *reads* `watch_comment`/reflections for context; it's
    where chat persistence would hang.
  - For `pierre_chat`, **store the whole back-and-forth thread** (user + Pierre turns, in
    order) — NOT one transcription row — so Ted can **grade and trail Pierre's responses**
    from the admin. Needs a thread/turn structure.
  - Admin: render `pierre_chat` as a readable thread + let Ted rate each.
- **Why parked:** needs schema + admin work; pairs naturally with the co-watching theme
  since both change how Pierre reads room context.

---
