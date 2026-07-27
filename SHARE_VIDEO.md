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

## Open decisions (ask Ted)
- Aspect: keep 1:1, or make a 9:16 Stories-filling variant (recommended for Stories)?
- Include the **typed** quote as on-card text only (current), or also caption?
- If a reflection has BOTH typed + audio, video uses the audio; image share stays available.

## Status
- [ ] Plumb reflection audio to `doShareCard`
- [ ] Web `buildShareVideo` (MediaRecorder) prototype — verifiable in the mockup harness
- [ ] `CardVideo` native plugin (AVFoundation) — needs build 7 + device test
- [ ] Two-option Share offer (card / video)
