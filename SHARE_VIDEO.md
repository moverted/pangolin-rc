# SHARE_VIDEO.md — share card as a video with the audio reflection (#4)

> Branch: `feat/share-card-video`. Goal: when a reflection has an **audio** clip, the
> shared "card" becomes a short **video** (the card image held for the clip's duration
> with the audio playing) so it posts to Instagram Stories as a video, not a still.

## What we have to work with
- **The card image**: `buildReflectionCard(...)` already returns a 1080×1080 PNG `Blob`.
- **The audio clip**: during a finished-episode / season / series reflection, the shell
  mic (`cube_shell.js`) records the voice comment and posts it as a co-view comment
  (audio → R2, served at `/transcribe/audio/:id`). So the reflection's audio is the clip
  we want. Today `doShareCard` only gets the PNG + typed text; the audio isn't handed to it.

## The core problem
A share needs a single **video file** (IG Stories wants `.mp4`/`.mov`, ~9:16 or 1:1,
H.264 + AAC). We must combine `image (still) + audio → mp4`. Two viable paths:

### Path A — Native (primary, ships in the app)
A tiny Capacitor plugin (`CardVideo`) using **AVFoundation**:
- `AVAssetWriter` writes a video track: the card image as a single still, duration = audio
  length (pad ±0.3s), 1080×1080 (or letterbox to 1080×1920 for Stories), 30fps CFR by
  repeating the frame, H.264.
- Mux the AAC audio via `AVAssetExportSession` / `AVMutableComposition` (image video track
  + the audio asset) → `mp4` in CACHE.
- Return the file URI → hand to the existing native `Share.share({files:[uri]})` (already
  added in build 6). IG Stories takes it as a video.
- **Input to the plugin**: PNG bytes (base64) + audio file URI (or bytes) + target size.

Why native: WKWebView can't reliably encode mp4; AVFoundation is the only path that yields
an IG-acceptable video on-device. Needs a **new build** (7).

### Path B — Web/PWA fallback (no build)
`canvas.captureStream(0)` + draw the card once + `AudioContext`→`MediaStreamTrack`, feed
both into `MediaRecorder` → `webm`. Works in desktop/Android Chrome. **iOS Safari/WKWebView
MediaRecorder is unreliable and outputs webm (IG won't take it)** — so this is a
best-effort fallback for web only; iOS relies on Path A.

## Plan
1. **Plumb the audio to the share.** Capture the reflection audio `Blob`/URL at record time
   and stash it on `noteCtx` (e.g. `noteCtx.audioUrl` / `audioBlob`) so `noteTurn` can pass
   it alongside the card. If none (typed-only reflection), fall back to the image share.
2. **Offer choice.** After the card, if audio exists, the Share offer gets two options:
   "Share card" (image, today) and "Share as video" (new).
3. **`buildShareVideo(pngBlob, audioBlobOrUrl, {size})`**:
   - Native present → call `CardVideo.compose({image, audio, size})` → mp4 URI → Share.
   - Else → Path B MediaRecorder → webm Blob → web-share (where supported).
4. **`CardVideo` Capacitor plugin** (`ios/` Swift, AVFoundation) — the native compositor.
5. **Stories framing**: option to render a 1080×1920 variant (card centered on the card's
   gradient bg) so it fills a Story. Keep 1:1 as default; add 9:16 as a flag.

## Decisions (Ted)
- **Aspect = 9:16 (1080×1920)** with the **1:1 card anchored at the TOP** on the card
  gradient; lower third left clear so the user adds copy in Stories. `buildStoryFrame`
  draws the card at y=96 (spans 96–1176) + a small `pangolinRC` hint; bottom stays empty.
- Video uses the spoken reflection audio (stashed by the shell mic as
  `window.__pgReflectAudioUrl`); the still-image "Share card" stays available alongside.

## Status
- [x] Plumb reflection audio — shell stashes `window.__pgReflectAudioUrl`; Pierre reads
      `window.top.__pgReflectAudioUrl`.
- [x] `buildStoryFrame` (9:16, card top-anchored) — **verified visually** in the mockup.
- [x] Two-option Share offer: "Share card" always; "Share as video" when audio + MediaRecorder.
- [x] `shareBlob(blob,name,caption)` — shares any file (image/video) natively (build 6 path).
- [~] `buildShareVideo` (MediaRecorder) — coded, graceful fallback to the still card.
      **Could not verify headless** (MediaRecorder returned null — a headless/WKWebView
      limitation, not a code bug). Works where MediaRecorder is real (desktop/Android web);
      output webm (mp4 if the platform supports it).
- [x] `CardVideo` native plugin (AVFoundation) — **built** as a local Capacitor plugin
      `capacitor-card-video/` (mirrors @capacitor/share's SPM structure; `cap sync` found
      3 plugins). `compose({image,audio,audioExt}) -> {uri}`: writes the audio to a temp
      file, renders the still image as a video of the audio's duration (AVAssetWriter +
      pixel-buffer adaptor), muxes video+audio (AVMutableComposition + AVAssetExportSession)
      → mp4 URI → shared via the Share plugin. `doShareVideo` calls it on the native
      platform, else the MediaRecorder web path, else the still card.
      **UNVERIFIED — this Swift was written without a compiler.** Build 7 will surface any
      fixups (API signatures, threading, deprecations). The web fallback means the app
      never breaks if the plugin fails to build/register.

## Notes for the build-7 compile
- Audio format: iOS WKWebView MediaRecorder records `audio/mp4` (AAC), which AVFoundation
  reads (ext `m4a`). Non-iOS (webm/opus) never hits the native path.
- If `compose` rejects (e.g. duration read / export), JS falls back to the still card.
- Likely fixup spots if it doesn't compile first try: `AVURLAsset.duration` async loading
  on iOS 16+, `CMTime.isNumeric`, pixel-buffer bitmapInfo, export-session optional.
