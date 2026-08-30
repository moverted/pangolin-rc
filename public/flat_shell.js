// flat_shell.js — the CONVENTIONAL app: a swipe/tab pager hosting the same six
// faces as the 3D cube, minus the cube. Companion to cube_shell.js (frozen at the
// `cube-freeze` tag). It reuses cube_*_face.html verbatim and preserves the face
// protocol the cube used — cube:payload / cube:focus / cube:blur and the direct
// window.cubeRotateTo cross-face nav — so no face needs editing.
//
// WHY THIS EXISTS: the cube ran a WebGL context + composited six live iframes
// through per-frame matrix3d, which is the documented iPhone-13 crash path
// (GPU pressure / CALayer.setBounds SIGABRT). This shell renders each face flat,
// one at a time, with zero WebGL — the crash surface is gone. It also drops the
// cube's console-keyboard hack: that only existed because taps landed on the cube
// canvas, not the iframe; here a tap lands directly in the field, so the native
// iOS keyboard just works (no field is tagged inputmode="none").

// One-time login migration (edward.m.willett@gmail.com -> ted@pangolinrc.com),
// mirrored from the cube shell so both apps agree on the founder identity.
try {
  if (localStorage.getItem('pg_user') === 'edward.m.willett@gmail.com') {
    localStorage.setItem('pg_user', 'ted@pangolinrc.com');
    localStorage.setItem('pg_refresh', String(Date.now()));
  }
} catch (_) {}

// Demo mode passes through to the faces the same way the cube shell did.
const DEMO = location.hostname.split('.').includes('demo') || new URLSearchParams(location.search).has('demo');

// Routing keys map to PANEL INDEX and must point at the same faces the cube's
// cubeRotateTo() targets. FACE_INDEX is a name→panel map used everywhere for cross-face
// messaging, so reordering the strip is just remapping these values + the FACES array below
// (no hardcoded panel numbers elsewhere). The intentional label/file swap is preserved:
// 'log' = the WATCH show-list (cube_watch_face), 'episodes' = the LOG tracker (cube_log_face).
//
// NAV RESTRUCTURE: Watch and Log are one destination now. The bottom bar is
// WATCH · FEED · PIERRE · BROWSE · SET (see TAB_ORDER); LOG is no longer a tab. The stage
// order keeps the LOG detail (episodes) right after WATCH so it's a natural drill-down: a
// swipe WATCH→right lands on the Log detail (of the current/last show), and both highlight
// the WATCH tab. episodes + profile are OFF-BAR panels reached programmatically (the WATCH
// tab's state-aware route, a show tap, or the profile avatar). SET is a new tab/panel; it
// hosts the Completed list (migrated off Watch) and is the reserved future home for Shadow.
const FACE_INDEX = { log: 0, episodes: 1, feed: 2, pierre: 3, join: 4, set: 5, profile: 6 };

// FACES is indexed BY panel position (must match FACE_INDEX). src keeps the `.html`
// suffix because the iOS Capacitor bundle serves files by exact name (Pages strips it).
const FACES = [
  { label: 'WATCH',   src: '/cube_watch_face.html'   },                       // 0
  { label: 'LOG',     src: '/cube_log_face.html'     },                       // 1  (off-bar: Watch's detail)
  { label: 'FEED',    src: '/cube_feed_face.html'    },                       // 2
  { label: 'PIERRE',  src: '/cube_pierre_face.html',  icon: '/pierre-host.png' }, // 3  (hero, center)
  { label: 'BROWSE',  src: '/cube_browse_face.html'  },                       // 4
  { label: 'SET',     src: '/cube_set_face.html'     },                       // 5
  { label: 'PROFILE', src: '/cube_profile_face.html' },                       // 6  (off-bar: avatar)
];

const stage  = document.getElementById('stage');
const tabbar = document.getElementById('tabbar');
const frames = [];
let index = FACE_INDEX.log;   // open on WATCH, the cold-open face

// ─── build panels + tab bar ─────────────────────────────────────────────────
FACES.forEach((f) => {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const fr = document.createElement('iframe');
  fr.allow = 'web-share; microphone';                 // Log finale share + comfort mic
  // app=1 tells a face it is embedded in THIS conventional shell (not the 3D cube),
  // so it can surface chrome the cube keeps in its own console band — e.g. Pierre's
  // in-composer CHAT PICKER / thumbs / GET TED row, which must ride the keyboard here.
  fr.src = f.src + '?app=1' + (DEMO ? '&demo=1' : '');
  panel.appendChild(fr);
  stage.appendChild(panel);
  frames.push(fr);
});

// Bottom-bar order (panel indices): WATCH · FEED · PIERRE(hero) · BROWSE · SET.
// The two most-tapped surfaces (WATCH, SET) sit on the corners; PIERRE is dead-center as the
// hero (bigger, bumped up) and hides itself while it's the open face. LOG left the bar (merged
// into WATCH); PROFILE leaves the bar too (reached from the profile avatar). FACE_INDEX is the
// only source of truth for panel positions, so this strip is just a reorder + filter.
const TAB_ORDER = [
  FACE_INDEX.log,       // WATCH  (cube_watch_face = the show list; also the entry to the Log detail)
  FACE_INDEX.feed,      // FEED
  FACE_INDEX.pierre,    // PIERRE (hero, center of 5)
  FACE_INDEX.join,      // BROWSE
  FACE_INDEX.set,       // SET    (Completed today; future Shadow home)
];
TAB_ORDER.forEach((fi) => {
  const f = FACES[fi];
  const b = document.createElement('button');
  b.className = 'tab' + (fi === FACE_INDEX.pierre ? ' hero' : '');
  b.type = 'button';
  b.dataset.panel = String(fi);
  const ic = f.icon ? `<img class="tab-ic" src="${f.icon}" alt="">` : '';
  // PIERRE (hero) carries the "Ted is waiting" badge: a small blue count over the remote in
  // Pierre's hands, driven by pierre:ted-waiting from the Pierre face. Nothing dire — just a
  // count of answered Get-Ted threads waiting to be read.
  const badge = fi === FACE_INDEX.pierre ? `<span class="ted-badge" id="tedBadge" hidden></span>` : '';
  b.innerHTML = ic + badge + `<span class="lbl">${f.label}</span>`;
  // WATCH is state-aware post Watch/Log merge (see goWatch); every other tab is a plain goTo.
  b.addEventListener('click', () => { if (fi === FACE_INDEX.log) goWatch(); else goTo(fi, true); });
  tabbar.appendChild(b);
});

// The WATCH tab merges the old Watch + Log destinations: with a show in progress it opens that
// show's Log detail (the "Log face"); with nothing in progress it rests on the Watch list (whose
// resting sub-tab is QUEUE). lastResume / sendEpisodesLast are the shell's existing active-show
// plumbing (populated from the Watch face's log:data). Falls back to the list until that arrives.
// "You have a current watch to get back to" — an in-progress show/movie the Log can resume (live
// OR paused, e.g. a film paused at 117m). This is the SAME signal the WATCH tab routes on and the
// same signal that reveals the Watch list's ‹ CURRENT button, so the two always agree.
function hasActiveWatch() { return !!(lastResume && (lastResume.titleId || lastResume.show || lastResume.movie)); }
// The Watch list's ‹ CURRENT button: VISIBLE whenever there's an in-progress watch to return to
// (paused or live), but its marquee only ANIMATES while the timer is actually live (_watching).
// Post BOTH message types (watch:active + watch:state) so a phone that cached the shell or the Watch
// face independently can't end up with a type its listener ignores — CURRENT was getting stuck hidden
// on that mismatch. Payload carries {active, live}; old listeners just read {active}.
function pushCurrent() {
  try {
    const p = { active: hasActiveWatch(), live: !!_watching };
    post(FACE_INDEX.log, { type: 'watch:active', ...p });
    post(FACE_INDEX.log, { type: 'watch:state', ...p });
  } catch (_) {}
}
function goWatch() {
  // Timer LIVE → jump straight to the running watch (Log). Not live → the show list (QUEUE).
  if (_watching) { goTo(FACE_INDEX.episodes, true); sendEpisodesLast(); }
  else goTo(FACE_INDEX.log, true);
}

function setActiveTab() {
  // The Log detail (episodes) is off-bar but belongs to WATCH, so it lights the WATCH tab.
  const activePanel = (index === FACE_INDEX.episodes) ? FACE_INDEX.log : index;
  [...tabbar.children].forEach((b) => b.classList.toggle('on', Number(b.dataset.panel) === activePanel));
  document.body.classList.toggle('pierre-open', index === FACE_INDEX.pierre);     // hide the hero tab
  document.body.classList.toggle('profile-open', index === FACE_INDEX.profile);   // avatar is redundant on Profile
}

// ─── focus / blur ───────────────────────────────────────────────────────────
// Same contract the cube used via signalFace: only the centered face is live;
// every other face pauses its cosmetic loops (the Log watch-timer keeps running
// on its own, exactly as before).
function signal() {
  frames.forEach((fr, i) => {
    try { fr.contentWindow.postMessage({ type: i === index ? 'cube:focus' : 'cube:blur' }, '*'); } catch (_) {}
  });
  // When the Watch list becomes visible, sync its ‹ CURRENT button: probe the Log for the current
  // live-timer state (refreshes _watching for the animation + goWatch), and push visibility now.
  if (index === FACE_INDEX.log) { post(FACE_INDEX.episodes, { type: 'watch:probe' }); pushCurrent(); }
}

let settleT = 0;
function onIndexChanged() {
  setActiveTab();
  clearTimeout(settleT);
  settleT = setTimeout(signal, 60);   // let the scroll settle before focusing
}

function goTo(i, smooth) {
  const n = FACES.length;
  i = (i % n + n) % n;                 // wrap → the tab bar loops around
  // Landing on the LOG tab un-pins the episodes face so resume-last works again; an explicit
  // handoff (cubeRotateTo) re-pins right after this call, so its show still wins.
  if (i === FACE_INDEX.episodes) episodesPinned = false;
  index = i;
  stage.scrollTo({ left: i * stage.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  onIndexChanged();
}

// Native scroll-snap paging → derive the current index when the swipe settles. But ONLY a
// scroll the member actually drove is navigation. iOS/WKWebView produces involuntary
// horizontal scrolls all the time — restoring position on resume, panning for a focused
// field, reflowing a face iframe — and any of those can land #stage.scrollLeft closer to a
// neighbouring panel. The old code accepted every settle unconditionally, so those noise
// scrolls silently re-indexed the pager: "returned and LOG/PIERRE/FEED/BROWSE are thrown off."
// Fix: the tracked `index` is authoritative. A settle only MOVES it when a real touch landed
// on the pager within TOUCH_WINDOW; otherwise the scroll was involuntary → snap back to index.
const TOUCH_WINDOW = 1200;   // ms after the last pointer on #stage that a scroll counts as a swipe
let lastTouchTs = 0;
// pointerdown = swipe start, pointerup = end (+ momentum/snap tail); both refresh the window so
// the post-release scroll-snap still counts as user-driven. Passive: we never preventDefault.
stage.addEventListener('pointerdown', () => { lastTouchTs = Date.now(); }, { passive: true });
stage.addEventListener('pointerup',   () => { lastTouchTs = Date.now(); }, { passive: true });
let scrollT = 0;
stage.addEventListener('scroll', () => {
  // Soft keyboard up: iOS resets scrollLeft to reveal the focused field and the tab bar is
  // hidden (body.kb), so this can't be a swipe — ignore; keyboardWillHide re-pins.
  if (document.body.classList.contains('kb')) return;
  clearTimeout(scrollT);
  scrollT = setTimeout(() => {
    const w = stage.clientWidth;
    if (!w) return;                    // zero-width (hidden/mid-layout) → don't derive a bogus index
    const i = Math.round(stage.scrollLeft / w);
    if (i === index) return;           // already where we think we are
    if (Date.now() - lastTouchTs < TOUCH_WINDOW) { index = i; onIndexChanged(); }  // real swipe → follow it
    else pinToIndex();                 // involuntary scroll (resume/reflow/field-pan) → snap back
  }, 90);
}, { passive: true });

window.addEventListener('resize', () => { stage.scrollTo({ left: index * stage.clientWidth }); });
window.addEventListener('orientationchange', () => {
  setTimeout(() => stage.scrollTo({ left: index * stage.clientWidth }), 120);
});

// Tab-indicator drift on return: iOS often resets #stage.scrollLeft (toward 0 = WATCH)
// when the app comes back from the background, leaving the view on one face while the
// indicator still points at another (e.g. "in Pierre, WATCH highlighted"). On return,
// re-assert the scroll to the tracked index so view + indicator agree again.
function pinToIndex() {
  if (stage.clientWidth) stage.scrollTo({ left: index * stage.clientWidth });
  setActiveTab();
}
function reassertFace() {
  // A lingering soft keyboard from before backgrounding comes back up on resume (e.g. a
  // Log "Note to Pierre" that had focus) — dismiss it, blur any focused field, and clear
  // the keyboard layout state so the face isn't left shrunken/scrolled.
  try {
    const KB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
    if (KB && KB.hide) KB.hide();
  } catch (_) {}
  try { const fr = frames[index]; const ae = fr && fr.contentWindow && fr.contentWindow.document.activeElement;
        if (ae && ae.blur) ae.blur(); } catch (_) {}
  stage.style.bottom = ''; document.body.classList.remove('kb');
  // iOS/WKWebView can reset #stage.scrollLeft AFTER this handler runs — restoring scroll on
  // resume, or panning a re-focused field into view — so a single re-pin lands early and leaves
  // the view on one face while the indicator points at another ("in Pierre, WATCH highlighted").
  // Re-assert across the settle window so a late reset is corrected instead of stranding the mix-up.
  pinToIndex();
  [120, 300, 600].forEach((ms) => setTimeout(pinToIndex, ms));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(reassertFace, 60); });
window.addEventListener('pageshow', () => setTimeout(reassertFace, 60));

// Profile avatar (top corner) — Profile's entry point now that it has left the tab bar.
(function wireProfileAvatar(){
  const av = document.getElementById('profile-av');
  if (av) av.addEventListener('click', () => goTo(FACE_INDEX.profile, true));
})();

// Soft-keyboard fit. Without this, iOS pans the whole fixed webview up to reveal a focused
// field (the Pierre composer), dragging the chat log off the top with no way to scroll it
// back — the "no scroll, can't see what Pierre said" bug. Instead we shrink the stage to the
// visible viewport when the keyboard opens: the active face's OWN scroller (the .log) stays
// in charge and the composer sits just above the keyboard.
const vv = window.visualViewport;
function fitViewport(){
  if(!vv) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
  if(kb > 80){ stage.style.bottom = kb + 'px'; document.body.classList.add('kb'); }
  else if (document.body.classList.contains('kb')) {   // keyboard just closed → re-pin the pager to the tracked face
    stage.style.bottom = ''; document.body.classList.remove('kb');
    stage.scrollTo({ left: index * stage.clientWidth });
  }
  window.scrollTo(0, 0);   // undo any residual webview pan
}
if(vv){ vv.addEventListener('resize', fitViewport); vv.addEventListener('scroll', fitViewport); }

// On iOS (Capacitor/WKWebView) visualViewport does NOT report the soft keyboard, so
// fitViewport above never fires there and the composer stays buried behind the keyboard.
// The @capacitor/keyboard plugin's keyboardWillShow/Hide DO fire reliably and carry the
// keyboard height — drive the same #stage shrink from them. (resize:'none' in
// capacitor.config keeps the native webview un-resized so this is the single source of
// truth; no double-shrink with fitViewport, which stays a no-op on device.)
(function wireNativeKeyboard(){
  const KB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
  if (!KB || !KB.addListener) return;
  KB.addListener('keyboardWillShow', (info) => {
    const kb = Math.round((info && info.keyboardHeight) || 0);
    if (kb > 0) { stage.style.bottom = kb + 'px'; document.body.classList.add('kb'); }
  });
  KB.addListener('keyboardWillHide', () => {
    stage.style.bottom = ''; document.body.classList.remove('kb');
    // Re-pin the pager to the tracked face: iOS may have shifted #stage.scrollLeft while
    // the keyboard owned the view, so without this you land back on the wrong tab.
    requestAnimationFrame(() => stage.scrollTo({ left: index * stage.clientWidth }));
  });
})();

// ── Native share bridge (ported from cube_shell.js) ──────────────────────────
// A face iframe can't reliably present the native share: Capacitor's bridge + a real
// file:// live on THIS top window, and web-share loses the file inside WKWebView (apps
// get a capacitor:// URL → Instagram "Can't send link"). So faces post 'pg:shareFile'
// here and the shell runs it via the Share plugin. Accepts a base64 Blob (written to
// CACHE) or a pre-written file URI (e.g. the CardVideo mp4). Without this the flat app's
// Log-finale / ticket / reflection-clip shares silently do nothing.
const API = (window.location.protocol === 'http:' && window.location.hostname === 'localhost')
  ? 'http://localhost:8787'
  : 'https://pangolin-rc.edward-m-willett.workers.dev';
(function initShareBridge() {
  async function shareFile(dataB64, name, caption, fileUri, source) {
    const Cap = window.Capacitor;
    try {
      if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Cap.Plugins && Cap.Plugins.Share) {
        let uri = fileUri || null;
        if (!uri && dataB64 && Cap.Plugins.Filesystem) {
          await Cap.Plugins.Filesystem.writeFile({ path: name, data: dataB64, directory: 'CACHE' });
          uri = (await Cap.Plugins.Filesystem.getUri({ path: name, directory: 'CACHE' })).uri;
        }
        if (uri) {
          // files ONLY (no text) → Instagram/Stories gets the media, never a "link".
          const res = await Cap.Plugins.Share.share({ files: [uri] });
          const activityType = (res && res.activityType) || '';
          try { if (source) source.postMessage({ type: 'pg:shareDone', activityType }, '*'); } catch (_) {}
          try { logCommentShare(name, activityType); } catch (_) {}
          // Returning from the iOS share sheet, land back on Pierre with a fresh prompt
          // instead of the leftover share chips. Pierre shows the "where to next?" line
          // off pg:shareDone; post it to the Pierre frame too when the share came from
          // elsewhere (guard on source so Pierre never gets it twice).
          try {
            const pierreWin = frames[FACE_INDEX.pierre] && frames[FACE_INDEX.pierre].contentWindow;
            if (pierreWin && pierreWin !== source) pierreWin.postMessage({ type: 'pg:shareDone', activityType }, '*');
            goTo(FACE_INDEX.pierre, true);
          } catch (_) {}
        }
      }
      // No web navigator.share() fallback on purpose (blob: URL → "Can't send link").
    } catch (e) { /* cancelled or unsupported */ }
  }
  // Best-effort moderation trail: only comment/reflection clips carry __pgReflectCommentId.
  function logCommentShare(name, activityType) {
    const commentId = window.__pgReflectCommentId;
    if (!commentId) return;
    const at = String(activityType || '').toLowerCase();
    const platform =
        at.includes('instagram')                               ? 'instagram'
      : (at.includes('cameraroll') || at.includes('saveto'))   ? 'photos'
      : (at.includes('message') || at.includes('imessage'))    ? 'messages'
      : at.includes('whatsapp')                                ? 'whatsapp'
      : at                                                     ? 'other'
      :                                                          'unknown';
    const n = String(name || '').toLowerCase();
    const method = /\.(mp4|mov|webm|m4v)$/.test(n) ? 'reel'
                 : /\.(png|jpe?g|gif)$/.test(n)    ? 'story'
                 :                                   'file';
    try {
      fetch(`${API}/transcribe/share`, {
        method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, platform, method, activityType: activityType || '' }),
      }).catch(() => {});
    } catch (_) {}
    try { window.__pgReflectCommentId = null; } catch (_) {}
  }
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'pg:shareFile') {
      shareFile(e.data.dataB64, e.data.name, e.data.caption, e.data.fileUri, e.source);
    }
  });
})();

// ─── "go dark but stay open" ambient mode ────────────────────────────────────
// While a watch timer is running (the LOG face posts pg:watch) and the member has Screen =
// Always On (default; toggled on Profile → pg_screen), keep the screen awake and, after 5s of
// no touch, fade a black overlay over the whole app so it darkens without closing. Any tap
// wakes it. The watch timer is timestamp-based, so this is pure UX + keeping the web session
// alive across an episode — nothing tracks worse when it's off ('sleep').
const DIM_IDLE_MS = 20000;   // idle before it darkens
let _watching = false, _dimIdleT = 0, _dimEl = null, _wakeLock = null;
function screenAlwaysOn() { try { return (localStorage.getItem('pg_screen') || 'on') !== 'sleep'; } catch (_) { return true; } }

function dimEl() {
  if (_dimEl) return _dimEl;
  const d = document.createElement('div');
  d.id = 'screen-dim';
  d.innerHTML = '<span class="dim-hint">tap to wake</span>';
  // The wake tap is consumed here (not passed to a face) so it only brightens, never also acts.
  d.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); wakeScreen(); }, { passive: false });
  document.body.appendChild(d);
  _dimEl = d; return d;
}
function goDark() {
  if (!_watching || !screenAlwaysOn()) return;
  // Never dim while the soft keyboard is up — you're typing a note/comment. Re-arm so it can
  // dim once you dismiss it. (Keystrokes also count as activity via the face-forwarded keydown.)
  if (document.body.classList.contains('kb')) { armDimIdle(); return; }
  dimEl().classList.add('on'); statusBarHidden(true);
}
function wakeScreen(holdMs) { if (_dimEl) _dimEl.classList.remove('on'); statusBarHidden(false); armDimIdle(holdMs); }
// Hide the native iOS status bar (clock/battery/signal) while dark — a DOM overlay can't cover
// it, since iOS composites the status bar above the webview. Needs @capacitor/status-bar (in a
// build); no-op on web, where the browser owns that strip.
async function statusBarHidden(hidden) {
  try {
    const SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
    if (SB) { if (hidden) await SB.hide(); else await SB.show(); }
  } catch (_) {}
}
function armDimIdle(holdMs) { clearTimeout(_dimIdleT); if (_watching && screenAlwaysOn()) _dimIdleT = setTimeout(goDark, holdMs || DIM_IDLE_MS); }
// Any interaction resets the countdown; if already dark, the first touch just wakes.
function noteActivity() { if (_dimEl && _dimEl.classList.contains('on')) wakeScreen(); else armDimIdle(); }

async function keepAwake(on) {
  // Native @capacitor-community/keep-awake in the app (needs a build); Screen Wake Lock on web.
  try {
    const KA = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KeepAwake;
    if (KA) { if (on) await KA.keepAwake(); else await KA.allowSleep(); return; }
  } catch (_) {}
  try {
    if (on) { if (!_wakeLock && navigator.wakeLock) _wakeLock = await navigator.wakeLock.request('screen'); }
    else if (_wakeLock) { await _wakeLock.release(); _wakeLock = null; }
  } catch (_) {}
}

function setWatching(on) {
  _watching = !!on;
  if (_watching && screenAlwaysOn()) { keepAwake(true); armDimIdle(); }
  else { keepAwake(false); clearTimeout(_dimIdleT); if (_dimEl) _dimEl.classList.remove('on'); statusBarHidden(false); }
}
// Shell-level taps (chrome, tab bar) reset idle; taps INSIDE the faces are forwarded from
// injectFaceChrome. A wake lock drops when the app is backgrounded — re-take it on return.
document.addEventListener('pointerdown', noteActivity, { passive: true });
document.addEventListener('keydown', noteActivity, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && _watching && screenAlwaysOn()) keepAwake(true); });

// ─── cross-face broker (essentials ported from cube_shell.js) ────────────────
let viewingStore = [];
let lastResume = null;
let logLoaded = false;
let episodesWantsLast = false;
let episodesEmpty = false;
// When a handoff loads a SPECIFIC show into the LOG face (Pierre "put it on" / pick-an-episode),
// pin it so a late/async resume-last (which would post the last-watched show) can't clobber it —
// that was loading the wrong show (e.g. back to Lanterns) after tapping an episode chip. Cleared
// when the member taps the LOG tab manually (then resume-last is what they want).
let episodesPinned = false;

function post(i, msg) { const w = frames[i] && frames[i].contentWindow; if (w) w.postMessage(msg, '*'); }

function sendEpisodesLast() {
  if (episodesPinned) return;   // an explicit handoff owns the LOG face; don't override with last-watched
  if (lastResume && (lastResume.titleId || lastResume.show || lastResume.movie)) {
    episodesEmpty = false;
    post(FACE_INDEX.episodes, { type: 'cube:payload', face: 'episodes', payload: lastResume });
  } else {
    post(FACE_INDEX.episodes, { type: 'cube:noLast' });
  }
}

function addToLogFace(show, pattern) {
  post(FACE_INDEX.log, { type: 'cube:payload', face: 'log',
    payload: { addShow: { id: show.id, name: show.name, kind: show.kind || 'show', poster: show.poster || null }, pattern } });
}

// Faces call this DIRECTLY (same-origin) so the tap's user activation carries in,
// or fall back to a 'cube:rotateTo' postMessage. Rotates, then forwards the payload.
function cubeRotateTo(face, payload) {
  const fi = FACE_INDEX[face];
  if (fi === undefined) return;
  goTo(fi, true);
  payload = payload || {};
  if (face === 'episodes' && (payload.show || payload.movie || payload.titleId)) { episodesEmpty = false; episodesPinned = true; episodesWantsLast = false; }
  if (face === 'pierre' && payload.intent === 'add') payload = { ...payload, history: viewingStore };
  post(fi, { type: 'cube:payload', face, payload });
  if (face === 'episodes' && payload.addToLog && payload.show) addToLogFace(payload.show, payload.pattern);
  if (face === 'episodes' && payload.addToLog && payload.movie) {
    const m = payload.movie;
    addToLogFace({ id: 'tmdb:' + String(m.id).replace(/^tmdb:/, ''), name: m.title || m.name, kind: 'movie', poster: m.poster || null }, payload.pattern);
  }
}
window.cubeRotateTo = cubeRotateTo;

window.addEventListener('message', (e) => {
  const d = e.data; if (!d || !d.type) return;

  // The Log published its records → snapshot for the others + resume payload.
  if (d.type === 'log:data') {
    viewingStore = d.shows || [];
    lastResume = d.resume || null;
    logLoaded = true;
    if (episodesWantsLast) { episodesWantsLast = false; sendEpisodesLast(); }
    post(FACE_INDEX.feed, { type: 'feed:refresh' });
    pushCurrent();   // resume target changed → refresh the Watch list's ‹ CURRENT button
  }
  // A face asks the shell whether there's a current watch (Watch list, on focus) → probe live + push.
  if (d.type === 'watch:query') { post(FACE_INDEX.episodes, { type: 'watch:probe' }); pushCurrent(); }
  // The Watch face asked for the last thing watched.
  if (d.type === 'episode:requestLast') {
    if (logLoaded) sendEpisodesLast(); else episodesWantsLast = true;
  }
  // A face asked to navigate (postMessage fallback for window.cubeRotateTo).
  if (d.type === 'cube:rotateTo') cubeRotateTo(d.face, d.payload);
  // Pierre reports how many answered Get-Ted threads are waiting → badge on the hero tab.
  if (d.type === 'pierre:ted-waiting') {
    const el = document.getElementById('tedBadge');
    if (el) { const n = d.count | 0; el.textContent = n > 9 ? '9+' : String(n); el.hidden = n <= 0; }
  }
  // The Watch face reports the show it has loaded (empty → nothing to resume).
  if (d.type === 'episode:current') { episodesEmpty = !d.show; }
  // Watch loaded a show → make sure the Log tracks it (Log dedupes).
  if (d.type === 'episode:track' && d.tvmazeId)
    addToLogFace({ id: d.tvmazeId, name: d.name, kind: d.kind || 'show', poster: d.poster || null });
  // In-episode progress → forward to the Log (the single writer to the account).
  if (d.type === 'episode:progress')
    post(FACE_INDEX.log, { type: 'cube:payload', face: 'log', payload: { progress: d } });
  // Pierre applied a runtime correction ([TRT]) → forward to the LOG face so an open (possibly
  // mid-watch) episode updates its cached runtime + running total without a quit/reopen. LOG =
  // cube_log_face (the tracker), which is FACE_INDEX.episodes here (label/file swap).
  if (d.type === 'pg:runtimeApplied')
    post(FACE_INDEX.episodes, { type: 'cube:payload', face: 'episodes',
      payload: { runtimeApplied: { titleId: d.titleId, season: d.season, number: d.number, minutes: d.minutes } } });
  // Finale tap → swing to the Log and finish the matching show.
  if (d.type === 'episode:finishedFinale') {
    goTo(FACE_INDEX.log, true);
    post(FACE_INDEX.log, { type: 'cube:payload', face: 'log', payload: { finishShow: { tvmazeId: d.tvmazeId } } });
  }
  // Pierre's intake populates the Log with named shows.
  if (d.type === 'pierre:addToLog' && Array.isArray(d.shows))
    d.shows.forEach(s => addToLogFace({ id: s.id, name: s.name }, s.pattern));
  // Ambient screen mode: the LOG face reports whether a watch timer is live; the Profile toggle
  // reports a Screen pref change (re-evaluate under the new pref, mid-watch).
  if (d.type === 'pg:watch') { setWatching(!!d.active); pushCurrent(); }   // ambient mode + refresh ‹ CURRENT live-state
  if (d.type === 'pg:screenmode') setWatching(_watching);
  // A friend's comment landed on the LOG face → wake the dark screen so it's seen, and hold it
  // awake ~20s (the co-view surface window) before it's allowed to dim again.
  if (d.type === 'pg:wake') wakeScreen(20000);
});

// The top-left face labels (WATCH / LOG / FEED / Pierre wordmark) are redundant now that
// the tab bar always shows where you are — hide them so the profile avatar owns that
// corner. Injected same-origin, flat-app only; visibility:hidden keeps each header's
// right-side controls (savings, +Show, device toggle) exactly where they were.
function injectFaceChrome(fr) {
  let doc; try { doc = fr.contentWindow && fr.contentWindow.document; } catch (_) { return; }
  if (!doc || doc.__chromeInjected) return; doc.__chromeInjected = true;
  try {
    const s = doc.createElement('style');
    s.textContent = '.head > .label,.topbar .facelabel,header > .wordmark,header > .dot{visibility:hidden !important;}';
    (doc.head || doc.documentElement).appendChild(s);
  } catch (_) {}
  // Forward taps AND keystrokes inside the face to the shell's idle detector, so interacting
  // with any face — including typing in the Pierre composer / Note-to-Pierre — keeps the screen
  // awake and resets the go-dark countdown.
  try {
    const act = () => { try { noteActivity(); } catch (_) {} };
    doc.addEventListener('pointerdown', act, { passive: true, capture: true });
    doc.addEventListener('keydown', act, { passive: true, capture: true });
  } catch (_) {}
}

// ─── init ───────────────────────────────────────────────────────────────────
// Focus each face once it loads (and re-assert the current face's focus), so a
// face that only renders while focused comes up populated.
frames.forEach((fr) => {
  fr.addEventListener('load', () => { injectFaceChrome(fr); setTimeout(signal, 30); });
  try { if (fr.contentWindow && fr.contentWindow.document.readyState === 'complete') injectFaceChrome(fr); } catch (_) {}
});
goTo(index, false);
