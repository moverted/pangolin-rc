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
