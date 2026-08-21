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
// cubeRotateTo() targets. Panels now follow the flat display order below (PIERRE,
// WATCH, LOG, FEED, BROWSE, PROFILE), so the indices are remapped to match — the
// intentional label/file swap is preserved: 'log' = the WATCH show-list
// (cube_watch_face), 'episodes' = the LOG tracker (cube_log_face).
const FACE_INDEX = { pierre: 0, log: 1, episodes: 2, feed: 3, join: 4, profile: 5 };

// Display order = swipe/tab order = panel order. src keeps the `.html` suffix because
// the iOS Capacitor bundle serves files by exact name (Pages strips it on the web).
const FACES = [
  { label: 'PIERRE',  src: '/cube_pierre_face.html',  icon: '/pierre-host.png' }, // 0
  { label: 'WATCH',   src: '/cube_watch_face.html'   },                      // 1
  { label: 'LOG',     src: '/cube_log_face.html'     },                      // 2
  { label: 'FEED',    src: '/cube_feed_face.html'    },                      // 3
  { label: 'BROWSE',  src: '/cube_browse_face.html'  },                      // 4
  { label: 'PROFILE', src: '/cube_profile_face.html' },                      // 5
];

const stage  = document.getElementById('stage');
const tabbar = document.getElementById('tabbar');
const frames = [];
let index = 1;   // open on WATCH, the cube's cold-open face

// ─── build panels + tab bar ─────────────────────────────────────────────────
FACES.forEach((f) => {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const fr = document.createElement('iframe');
  fr.allow = 'web-share; microphone';                 // Log finale share + comfort mic
  fr.src = f.src + (DEMO ? '?demo=1' : '');
  panel.appendChild(fr);
  stage.appendChild(panel);
  frames.push(fr);
});

FACES.forEach((f, i) => {
  const b = document.createElement('button');
  b.className = 'tab';
  b.type = 'button';
  // PIERRE wears a tiny portrait; the other tabs carry just their label, vertically centered.
  const ic = f.icon ? `<img class="tab-ic" src="${f.icon}" alt="">` : '';
  b.innerHTML = ic + `<span class="lbl">${f.label}</span>`;
  b.addEventListener('click', () => goTo(i, true));
  tabbar.appendChild(b);
});

function setActiveTab() {
  [...tabbar.children].forEach((b, i) => b.classList.toggle('on', i === index));
}

// ─── focus / blur ───────────────────────────────────────────────────────────
// Same contract the cube used via signalFace: only the centered face is live;
// every other face pauses its cosmetic loops (the Log watch-timer keeps running
// on its own, exactly as before).
function signal() {
  frames.forEach((fr, i) => {
    try { fr.contentWindow.postMessage({ type: i === index ? 'cube:focus' : 'cube:blur' }, '*'); } catch (_) {}
  });
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
  index = i;
  stage.scrollTo({ left: i * stage.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  onIndexChanged();
}

// Native scroll-snap paging → derive the current index when the swipe settles.
let scrollT = 0;
stage.addEventListener('scroll', () => {
  clearTimeout(scrollT);
  scrollT = setTimeout(() => {
    const i = Math.round(stage.scrollLeft / stage.clientWidth);
    if (i !== index) { index = i; onIndexChanged(); }
  }, 90);
}, { passive: true });

window.addEventListener('resize', () => { stage.scrollTo({ left: index * stage.clientWidth }); });
window.addEventListener('orientationchange', () => {
  setTimeout(() => stage.scrollTo({ left: index * stage.clientWidth }), 120);
});

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
  else { stage.style.bottom = ''; document.body.classList.remove('kb'); }
  window.scrollTo(0, 0);   // undo any residual webview pan
}
if(vv){ vv.addEventListener('resize', fitViewport); vv.addEventListener('scroll', fitViewport); }

// ─── cross-face broker (essentials ported from cube_shell.js) ────────────────
let viewingStore = [];
let lastResume = null;
let logLoaded = false;
let episodesWantsLast = false;
let episodesEmpty = false;

function post(i, msg) { const w = frames[i] && frames[i].contentWindow; if (w) w.postMessage(msg, '*'); }

function sendEpisodesLast() {
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
  if (face === 'episodes' && (payload.show || payload.movie)) episodesEmpty = false;
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
  }
  // The Watch face asked for the last thing watched.
  if (d.type === 'episode:requestLast') {
    if (logLoaded) sendEpisodesLast(); else episodesWantsLast = true;
  }
  // A face asked to navigate (postMessage fallback for window.cubeRotateTo).
  if (d.type === 'cube:rotateTo') cubeRotateTo(d.face, d.payload);
  // The Watch face reports the show it has loaded (empty → nothing to resume).
  if (d.type === 'episode:current') { episodesEmpty = !d.show; }
  // Watch loaded a show → make sure the Log tracks it (Log dedupes).
  if (d.type === 'episode:track' && d.tvmazeId)
    addToLogFace({ id: d.tvmazeId, name: d.name, kind: d.kind || 'show', poster: d.poster || null });
  // In-episode progress → forward to the Log (the single writer to the account).
  if (d.type === 'episode:progress')
    post(FACE_INDEX.log, { type: 'cube:payload', face: 'log', payload: { progress: d } });
  // Finale tap → swing to the Log and finish the matching show.
  if (d.type === 'episode:finishedFinale') {
    goTo(FACE_INDEX.log, true);
    post(FACE_INDEX.log, { type: 'cube:payload', face: 'log', payload: { finishShow: { tvmazeId: d.tvmazeId } } });
  }
  // Pierre's intake populates the Log with named shows.
  if (d.type === 'pierre:addToLog' && Array.isArray(d.shows))
    d.shows.forEach(s => addToLogFace({ id: s.id, name: s.name }, s.pattern));
});

// ─── init ───────────────────────────────────────────────────────────────────
// Focus each face once it loads (and re-assert the current face's focus), so a
// face that only renders while focused comes up populated.
frames.forEach((fr) => fr.addEventListener('load', () => setTimeout(signal, 30)));
goTo(index, false);
