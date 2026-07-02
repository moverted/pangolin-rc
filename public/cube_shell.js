// cube_shell.js — the off-cube layer + shell. Extracted from index.html.
// Owns face-focus state (which face is current, nav mode vs locked/active mode),
// the cube + its turn/snap transitions, the six face iframes and their projection,
// and all off-cube UI that is NOT the click wheel (captions, remote, device chip,
// bug reporter, DEMO band). Exposes a minimal CubeShell interface — getFocus /
// getActiveDoc / FACE_INDEX — imported by clickwheel.js (see the bottom of file).
// See the cube map in CLAUDE.md.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js';

await document.fonts.ready;

// ─── face definitions ──────────────────────────────────────────────────────
// BoxGeometry material order: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z(front), 5=-Z(back)
const FACES = [
  { label: 'FEED',    bg: '#22BB44', fg: '#fff',    sub: 'The latest drops'      },
  { label: 'WATCH',   bg: '#FF6B35', fg: '#fff',    sub: 'Decide what to watch'  },
  { label: 'PIERRE',  bg: '#BB00FF', fg: '#FFE600', sub: 'Your host'             },
  { label: 'PROFILE', bg: '#EE1122', fg: '#fff',    sub: "That's you"            },
  { label: 'LOG',     bg: '#FFD600', fg: '#000',    sub: 'Your viewing log'      },
  { label: 'JOIN',    bg: '#00BBEE', fg: '#000',    sub: 'Get in on it'          },
];

// Euler to bring each face directly toward camera (+Z)
const SNAP_EULER = [
  new THREE.Euler(0,           -Math.PI / 2, 0),
  new THREE.Euler(0,            Math.PI / 2, 0),
  new THREE.Euler( Math.PI / 2, 0,           0),
  new THREE.Euler(-Math.PI / 2, 0,           0),
  new THREE.Euler(0,            0,           0),
  new THREE.Euler(0,            Math.PI,     0),
];

// ─── canvas face textures (no baked borders — faces connect seamlessly) ──
function makeTex(face, faceIndex) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');

  if (faceIndex === 0 || faceIndex === 1 || faceIndex === 2 || faceIndex === 3 || faceIndex === 4 || faceIndex === 5) {
    // iframe delivers the real content — dark placeholder sits behind the overlay
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#1c1a16'); g.addColorStop(1, '#0c0a08');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(c);
  }

  // Solid bg
  ctx.fillStyle = face.bg;
  ctx.fillRect(0, 0, S, S);

  // Ben-Day dots
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let x = 8; x < S; x += 20)
    for (let y = 8; y < S; y += 20) {
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill();
    }

  // Halftone ring — larger dots near edges fade to hint at depth without a border
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x = 0; x < S; x += 20)
    for (let y = 0; y < S; y += 20) {
      const dx = x - S / 2, dy = y - S / 2;
      const dist = Math.sqrt(dx * dx + dy * dy) / (S / 2);
      const r = 3 + dist * 8;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

  // Label
  const sz = face.label.length > 5 ? 86 : 106;
  ctx.font = `${sz}px Bangers, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(face.label, S / 2, S / 2 - 14);
  ctx.fillStyle = face.fg;
  ctx.fillText(face.label, S / 2, S / 2 - 14);

  // Sub-label
  ctx.font = `bold 23px "Comic Neue", sans-serif`;
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.strokeText(face.sub, S / 2, S / 2 + 65);
  ctx.fillStyle = face.fg === '#fff' ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)';
  ctx.fillText(face.sub, S / 2, S / 2 + 65);

  return new THREE.CanvasTexture(c);
}

// ─── three.js ──────────────────────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const appEl    = document.getElementById('app');
const rotateMsg = document.getElementById('rotate-msg');
// Logical (portrait) viewport. Option A keeps a portrait composition and rotates
// the whole #app in place to match orientation, so VW/VH are the composition's
// dimensions (not necessarily the screen's). Pointer input is mapped back into
// this frame by toLogical().
let VW = innerWidth, VH = innerHeight, ORI = 0;
// preserveDrawingBuffer lets the bug-report screenshot read the cube back from the
// WebGL canvas (the backbuffer is otherwise cleared after compositing → blank grab).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(VW, VH);
renderer.setClearColor(0x000000, 0);
// three.js already recovers a lost GPU context internally (it preventDefaults the loss
// and reinitialises on restore). This is a belt-and-suspenders net: skip our own work
// while the context is gone, and force a clean re-layout/render the moment it returns,
// so a context blip can never leave the cube stranded black.
let contextLost = false;
canvas.addEventListener('webglcontextlost', () => { contextLost = true; }, false);
canvas.addEventListener('webglcontextrestored', () => { contextLost = false; layout(); }, false);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, VW / VH, 0.1, 500);
camera.position.set(0, 0, 13);

// Stars
{
  const n = 1800, pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * 280;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, sizeAttenuation: true, transparent: true, opacity: 0.38 })
  ));
}

// Cube — one MeshBasicMaterial per face (flat/comic, no lighting needed)
const geo  = new THREE.BoxGeometry(1.8, 1.8, 1.8);
const mats = FACES.map((f, i) => new THREE.MeshBasicMaterial({ map: makeTex(f, i) }));
const cube = new THREE.Mesh(geo, mats);
cube.quaternion.setFromEuler(SNAP_EULER[5]); // open showing the JOIN face
scene.add(cube);

// ─── interaction state ────────────────────────────────────────────────────
let locked     = false;
let activeFace = 5; // JOIN starts

// Single-pointer drag
let dragging   = false;
let lastX = 0, lastY = 0, velX = 0, velY = 0;
let dragStartX = 0, dragStartY = 0;

// Multi-pointer pinch
const ptrs = new Map(); // pointerId → {x, y}
let pinchStartDist = 0;
let pinchTriggered = false; // prevent re-trigger until fingers lift

// Snap animation
let snapping  = false;
let snapQ     = new THREE.Quaternion();

// Camera target z
let camTargetZ = 8.5;

// Reserved bottom "console" band — the open face sits in a TOP stage and this
// band below it is shared by the click wheel (normal) and the soft keyboard (when
// typing; the keyboard branch top-pins the face on its own). Capped on short
// screens so the face never collapses. Matches the wheel footprint (~258px + chrome).
const CONSOLE_H = 360;

// Double-tap detection
let lastTapTime = 0;

// UI refs
const pinchHint = document.getElementById('pinch-hint');

function showFaceInfo(fi) {
  pinchHint.classList.add('hide');
}
function hideFaceInfo() {
  pinchHint.classList.remove('hide');
  // swap hint text
  pinchHint.textContent = 'double-tap to open';
}

function nearestFace() {
  const fwd = new THREE.Vector3(0, 0, 1);
  const normals = [
    new THREE.Vector3( 1,0,0), new THREE.Vector3(-1,0,0),
    new THREE.Vector3( 0,1,0), new THREE.Vector3( 0,-1,0),
    new THREE.Vector3( 0,0,1), new THREE.Vector3( 0,0,-1),
  ];
  let best = 4, bestDot = -Infinity;
  normals.forEach((n, i) => {
    const d = n.clone().applyQuaternion(cube.quaternion).dot(fwd);
    if (d > bestDot) { bestDot = d; best = i; }
  });
  return best;
}

function snapToFace(fi) {
  activeFace = fi;
  snapQ.setFromEuler(SNAP_EULER[fi]);
  snapping = true;
  layout();   // re-evaluate rotation gating for the new face (keyboard vs not)
}

function lock() {
  if (locked) return;
  locked = true;
  const fi = nearestFace();
  snapToFace(fi);
  camTargetZ = 4.6;
  showFaceInfo(fi);
  // Exit hint only on PIERRE + PROFILE; the other (trunk) faces hide it.
  if (fi === PIERRE_FACE || fi === FACE_INDEX.profile) {
    pinchHint.textContent = 'double-tap or pinch to exit';
    pinchHint.classList.remove('hide');
  } else {
    pinchHint.classList.add('hide');
  }
  if (fi === PIERRE_FACE) focusPierre();
  bounceFromEmptyWatch(fi);
  if (window._setWheelCube) window._setWheelCube(fi !== PIERRE_FACE);   // console back-cube (not on keyboard face)
  canvas.style.opacity = '0';   // hide the cube behind the open face (no grey square in the top stage)
}

function unlock() {
  if (!locked) return;
  if (activeFace === PIERRE_FACE) focusPierreBlur();
  locked = false;
  camTargetZ = 8.5;
  if (window._setWheelCube) window._setWheelCube(false);
  canvas.style.opacity = '1';   // cube returns as the free-nav object
  hideFaceInfo();
  snapping = false; // release to free rotation
  velX = 0; velY = 0;
  layout();   // leaving a keyboard face clears the rotate prompt / restores rotation
}

// Selecting the Pierre side drops the cursor straight into the chat box and
// raises the keyboard. Must run inside the user gesture (tap/pinch/swipe) or
// iOS won't open the keyboard. Same-origin iframe → parent can focus it.
function focusPierre() {
  const cfg = FACE_OVERLAYS[PIERRE_FACE];
  if (!cfg || !cfg.frame) return;
  try {
    const inp = cfg.frame.contentWindow.document.getElementById('input');
    if (inp) inp.focus();
  } catch (_) { /* iframe not ready yet */ }
}

function focusPierreBlur() {
  const cfg = FACE_OVERLAYS[PIERRE_FACE];
  if (!cfg || !cfg.frame) return;
  try {
    const inp = cfg.frame.contentWindow.document.getElementById('input');
    if (inp) inp.blur();
  } catch (_) { /* iframe not ready yet */ }
}

// Cross-face navigation: a face asks the shell to rotate to another face
// (e.g. a Log tile tap -> Episodes). The shell owns routing; faces post a
// 'cube:rotateTo' message and this maps the face name to its cube index.
// Visible labels: face 1 (cube_watch_face, the show list) shows WATCH — "decide what
// to watch"; face 4 (cube_log_face, the tracker) shows LOG — "log your progress".
// The routing keys below still name the CONTENT (episodes/log), so the data flow
// (episode progress -> the log writer) is unchanged; only positions + labels moved.
export const FACE_INDEX = { feed: 0, log: 1, pierre: 2, profile: 3, episodes: 4, join: 5 };
let viewingStore = [];   // snapshot of the Log face's records, shared with Pierre/Episodes
let lastResume = null;        // Episodes payload for the most-recently-watched show (or null)
let logLoaded = false;        // the Log has published at least once
let episodesWantsLast = false;// the Watch face asked before the Log was ready
let episodesEmpty = false;    // the Watch face currently has no show loaded

// Hand the Watch face the last thing watched, or tell it there's nothing to resume.
function sendEpisodesLast() {
  const cfg = FACE_OVERLAYS[FACE_INDEX.episodes];
  if (!cfg || !cfg.frame || !cfg.frame.contentWindow) return;
  // The Log's resume payload is episodesPayload() → { titleId, kind, name, pattern }.
  // Accept that (titleId) as well as legacy show/movie shapes; the episodes face
  // resolves any of the three. Gating on .show alone never matched → empty screen.
  if (lastResume && (lastResume.titleId || lastResume.show || lastResume.movie)) {
    episodesEmpty = false;   // a show is on its way — don't bounce while it loads
    cfg.frame.contentWindow.postMessage({ type: 'cube:payload', face: 'episodes', payload: lastResume }, '*');
  } else {
    cfg.frame.contentWindow.postMessage({ type: 'cube:noLast' }, '*');
  }
}

// Landing on the Watch face with nothing to watch → animate over to the Log so the
// user can log a show. Delayed so the Watch face is seen first, and guarded so a
// show arriving in the meantime (episodesEmpty flips false) cancels the bounce.
function bounceFromEmptyWatch(fi) {
  if (fi !== FACE_INDEX.episodes) return;
  setTimeout(() => {
    if (locked && activeFace === FACE_INDEX.episodes && episodesEmpty)
      cubeRotateTo('log', {});
  }, 520);
}
function rotateToFace(fi) {
  if (typeof fi !== 'number' || fi < 0 || fi > 5) return;
  locked = true;
  camTargetZ = 4.6;
  snapToFace(fi);                 // sets activeFace and starts the snap
  showFaceInfo(fi);
  // Exit hint only on PIERRE + PROFILE; the other (trunk) faces hide it.
  if (fi === PIERRE_FACE || fi === FACE_INDEX.profile) {
    pinchHint.textContent = 'double-tap or pinch to exit';
    pinchHint.classList.remove('hide');
  } else {
    pinchHint.classList.add('hide');
  }
  if (fi === PIERRE_FACE) focusPierre(); else focusPierreBlur();
  bounceFromEmptyWatch(fi);
}

// Faces call this DIRECTLY (same-origin) rather than postMessage so the tap's
// user activation carries into the parent — that is what lets focusPierre open
// the soft keyboard when a face hands off to Pierre. Rotates, then forwards the
// payload into the target face.
function cubeRotateTo(face, payload) {
  const fi = FACE_INDEX[face];
  if (fi === undefined) return;
  rotateToFace(fi);
  payload = payload || {};
  // A show (or film) is being handed to the Watch face → it won't be empty; suppress the bounce.
  if (face === 'episodes' && (payload.show || payload.movie)) episodesEmpty = false;
  if (face === 'pierre' && payload.intent === 'add') payload = { ...payload, history: viewingStore };
  const cfg = FACE_OVERLAYS[fi];
  if (cfg && cfg.frame && cfg.frame.contentWindow)
    cfg.frame.contentWindow.postMessage({ type: 'cube:payload', face, payload }, '*');
  if (face === 'episodes' && payload.addToLog && payload.show) addToLogFace(payload.show, payload.pattern);
  if (face === 'episodes' && payload.addToLog && payload.movie) {
    const m = payload.movie;
    addToLogFace({ id: 'tmdb:' + String(m.id).replace(/^tmdb:/, ''), name: m.title || m.name, kind: 'movie', poster: m.poster || null }, payload.pattern);
  }
}
window.cubeRotateTo = cubeRotateTo;

function addToLogFace(show, pattern) {
  const logCfg = FACE_OVERLAYS[FACE_INDEX.log];
  if (logCfg && logCfg.frame && logCfg.frame.contentWindow)
    logCfg.frame.contentWindow.postMessage({ type: 'cube:payload', face: 'log', payload: { addShow: { id: show.id, name: show.name, kind: show.kind || 'show', poster: show.poster || null }, pattern } }, '*');
}

// ─── pointer events ───────────────────────────────────────────────────────
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = toLogical(e.clientX, e.clientY);
  ptrs.set(e.pointerId, { x: p.x, y: p.y });

  if (ptrs.size === 2) {
    // Second finger down — start pinch tracking
    const [a, b] = [...ptrs.values()];
    pinchStartDist = Math.hypot(b.x - a.x, b.y - a.y);
    pinchTriggered = false;
    dragging = false; // cancel any single-finger drag
  } else if (ptrs.size === 1) {
    dragging = true;
    lastX = dragStartX = p.x;
    lastY = dragStartY = p.y;
    velX = velY = 0;
    snapping = false;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId);
  const p = toLogical(e.clientX, e.clientY);
  ptrs.set(e.pointerId, { x: p.x, y: p.y });

  // Two fingers down: do nothing. Pinch-to-lock was removed — double-tap is the
  // single transport in/out of a face. (Native pinch-zoom is blocked separately.)
  if (ptrs.size >= 2) return;

  // Single-finger drag
  if (!dragging) return;
  const dx = p.x - prev.x;
  const dy = p.y - prev.y;
  velX = dx * 0.007;
  velY = dy * 0.007;

  if (!locked) {
    // Rotate around world axes so the direction never flips when upside-down
    const qH = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), velX);
    const qV = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), velY);
    cube.quaternion.premultiply(qH).premultiply(qV);
  }
});

canvas.addEventListener('pointerup', (e) => {
  const start = { x: dragStartX, y: dragStartY };
  const p = toLogical(e.clientX, e.clientY);
  ptrs.delete(e.pointerId);
  dragging = false;

  if (ptrs.size < 2) pinchTriggered = false;
  if (ptrs.size > 0) return;

  // Stay in the Pierre chat: ignore the casual gestures (double-tap, swipe) that
  // would otherwise navigate away or unlock while you're typing. The in-chat
  // "‹ back" button (and a deliberate pinch) remain the way out.
  const inPierreChat = locked && activeFace === PIERRE_FACE;

  // Double-tap to toggle lock/unlock
  const tapDist = Math.hypot(p.x - start.x, p.y - start.y);
  if (tapDist < 16) {
    const now = performance.now();
    if (now - lastTapTime < 340) {
      lastTapTime = 0;
      if (!inPierreChat) { if (locked) unlock(); else lock(); }
      return;
    }
    lastTapTime = now;
  }

  // Swipe navigation when locked
  if (locked && !inPierreChat) {
    const swipeDx = p.x - start.x;
    const swipeDy = p.y - start.y;
    if (Math.abs(swipeDx) > Math.abs(swipeDy) && Math.abs(swipeDx) > 38) {
      const next = swipeDx < 0
        ? (activeFace + 1) % 6
        : (activeFace + 5) % 6;
      activeFace = next;
      snapToFace(next);
      showFaceInfo(next);
      if (next === PIERRE_FACE) focusPierre();
      else focusPierreBlur();
      bounceFromEmptyWatch(next);
    }
  }
});

canvas.addEventListener('pointercancel', (e) => {
  ptrs.delete(e.pointerId);
  dragging = false;
  if (ptrs.size < 2) pinchTriggered = false;
});

// ─── face overlay system (CSS matrix3d perspective-correct tracking) ─────────
const IFRAME_SZ = 480;
const _fN = new THREE.Vector3();
const _fW = new THREE.Vector3();
const _fP = new THREE.Vector3();

function _adj3(m){return[m[4]*m[8]-m[5]*m[7],m[2]*m[7]-m[1]*m[8],m[1]*m[5]-m[2]*m[4],m[5]*m[6]-m[3]*m[8],m[0]*m[8]-m[2]*m[6],m[2]*m[3]-m[0]*m[5],m[3]*m[7]-m[4]*m[6],m[1]*m[6]-m[0]*m[7],m[0]*m[4]-m[1]*m[3]];}
function _mul3(a,b){return[a[0]*b[0]+a[1]*b[3]+a[2]*b[6],a[0]*b[1]+a[1]*b[4]+a[2]*b[7],a[0]*b[2]+a[1]*b[5]+a[2]*b[8],a[3]*b[0]+a[4]*b[3]+a[5]*b[6],a[3]*b[1]+a[4]*b[4]+a[5]*b[7],a[3]*b[2]+a[4]*b[5]+a[5]*b[8],a[6]*b[0]+a[7]*b[3]+a[8]*b[6],a[6]*b[1]+a[7]*b[4]+a[8]*b[7],a[6]*b[2]+a[7]*b[5]+a[8]*b[8]];}
function _basis(p0,p1,p2,p3){const m=[p0[0],p1[0],p2[0],p0[1],p1[1],p2[1],1,1,1];const a=_adj3(m);const lam=[a[0]*p3[0]+a[1]*p3[1]+a[2],a[3]*p3[0]+a[4]*p3[1]+a[5],a[6]*p3[0]+a[7]*p3[1]+a[8]];return[m[0]*lam[0],m[1]*lam[1],m[2]*lam[2],m[3]*lam[0],m[4]*lam[1],m[5]*lam[2],m[6]*lam[0],m[7]*lam[1],m[8]*lam[2]];}

function faceCssMatrix3d(pts) {
  const W = IFRAME_SZ, H = IFRAME_SZ;
  const src = _basis([0,0],[W,0],[W,H],[0,H]);
  const dst = _basis([pts[0].x,pts[0].y],[pts[1].x,pts[1].y],[pts[2].x,pts[2].y],[pts[3].x,pts[3].y]);
  const h = _mul3(dst, _adj3(src)); const s = h[8];
  return `matrix3d(${h[0]/s},${h[3]/s},0,${h[6]/s},${h[1]/s},${h[4]/s},0,${h[7]/s},0,0,1,0,${h[2]/s},${h[5]/s},0,1)`;
}

// Keyed by BoxGeometry material index; corners in TL→TR→BR→BL order (local cube space)
const FACE_OVERLAYS = {
  0: {                                       // +X face (side): FEED
    src: '/cube_feed_face.html',
    normal: new THREE.Vector3(1, 0, 0),
    corners: [
      new THREE.Vector3(0.9,  0.9,  0.9),   // TL
      new THREE.Vector3(0.9,  0.9, -0.9),   // TR
      new THREE.Vector3(0.9, -0.9, -0.9),   // BR
      new THREE.Vector3(0.9, -0.9,  0.9),   // BL
    ],
  },
  2: {                                       // +Y face: PIERRE
    src: '/cube_pierre_face.html',
    normal: new THREE.Vector3(0, 1, 0),
    corners: [
      new THREE.Vector3(-0.9, 0.9, -0.9),   // TL
      new THREE.Vector3( 0.9, 0.9, -0.9),   // TR
      new THREE.Vector3( 0.9, 0.9,  0.9),   // BR
      new THREE.Vector3(-0.9, 0.9,  0.9),   // BL
    ],
  },
  3: {                                       // -Y face (bottom): PROFILE
    src: '/cube_profile_face.html',
    normal: new THREE.Vector3(0, -1, 0),
    corners: [
      new THREE.Vector3(-0.9, -0.9,  0.9),  // TL
      new THREE.Vector3( 0.9, -0.9,  0.9),  // TR
      new THREE.Vector3( 0.9, -0.9, -0.9),  // BR
      new THREE.Vector3(-0.9, -0.9, -0.9),  // BL
    ],
  },
  5: {                                       // -Z face (back): JOIN
    src: '/cube_browse_face.html',
    normal: new THREE.Vector3(0, 0, -1),
    corners: [
      new THREE.Vector3( 0.9,  0.9, -0.9),  // TL
      new THREE.Vector3(-0.9,  0.9, -0.9),  // TR
      new THREE.Vector3(-0.9, -0.9, -0.9),  // BR
      new THREE.Vector3( 0.9, -0.9, -0.9),  // BL
    ],
  },
  1: {                                       // -X face (side): WATCH — the show list (cube_watch_face content)
    src: '/cube_watch_face.html',
    normal: new THREE.Vector3(-1, 0, 0),
    corners: [
      new THREE.Vector3(-0.9,  0.9, -0.9),  // TL
      new THREE.Vector3(-0.9,  0.9,  0.9),  // TR
      new THREE.Vector3(-0.9, -0.9,  0.9),  // BR
      new THREE.Vector3(-0.9, -0.9, -0.9),  // BL
    ],
  },
  4: {                                       // +Z face (side): LOG — the episode tracker (cube_log_face content)
    src: '/cube_log_face.html',
    normal: new THREE.Vector3(0, 0, 1),
    corners: [
      new THREE.Vector3(-0.9,  0.9,  0.9),  // TL
      new THREE.Vector3( 0.9,  0.9,  0.9),  // TR
      new THREE.Vector3( 0.9, -0.9,  0.9),  // BR
      new THREE.Vector3(-0.9, -0.9,  0.9),  // BL
    ],
  },
};

// Demo mode: the real demo subdomain, or a ?demo=1 preview on any host. Pass it
// down to the face iframes (their own URL doesn't inherit the shell's query).
const DEMO = location.hostname.split('.').includes('demo') || new URLSearchParams(location.search).has('demo');

for (const cfg of Object.values(FACE_OVERLAYS)) {
  const el = document.createElement('div');
  el.className = 'face-overlay';
  const frame = document.createElement('iframe');
  frame.allow = 'web-share';   // let a face (Log finale card) invoke navigator.share
  frame.src = cfg.src + (DEMO ? '?demo=1' : '');
  el.appendChild(frame);
  appEl.appendChild(el);
  cfg.el = el; cfg.frame = frame; cfg._op = 0; cfg._active = false; cfg._tx = '';
  frame.addEventListener('load', () => { attachShellBack(frame); hideFaceCube(frame); });
}

// An open face is a same-origin iframe that captures every touch, so the shell's
// own double-tap (on the cube canvas) can't see it. Attach a capture-phase tap
// watcher to each face's document so a double-tap anywhere on the side exits to
// the cube — making double-tap a symmetric in/out transport. Pinch-back already
// lives inside each face. Pierre is skipped: it owns its in-chat gestures and a
// textarea double-tap is text-selection, not "exit".
// The floating cube now lives in the console (next to the wheel), so hide each
// face's own in-content .cubeback. Same-origin style injection — no face edits.
function hideFaceCube(frame) {
  try {
    const doc = frame.contentWindow && frame.contentWindow.document;
    if (!doc || doc.getElementById('__nofacecube')) return;
    const s = doc.createElement('style');
    s.id = '__nofacecube';
    s.textContent = '.cubeback{display:none!important}';
    (doc.head || doc.documentElement).appendChild(s);
  } catch (_) {}
}

function attachShellBack(frame) {
  let doc; try { doc = frame.contentWindow && frame.contentWindow.document; } catch (_) { return; }
  if (!doc) return;
  if (FACE_OVERLAYS[PIERRE_FACE] && frame === FACE_OVERLAYS[PIERRE_FACE].frame) return;
  // Trunk-side faces have their own floating cube back-button — no double-tap-back.
  const NO_DBLTAP_BACK = [FACE_INDEX.feed, FACE_INDEX.log, FACE_INDEX.episodes, FACE_INDEX.join];
  if (NO_DBLTAP_BACK.some(fi => FACE_OVERLAYS[fi] && frame === FACE_OVERLAYS[fi].frame)) return;
  let last = 0, sx = 0, sy = 0;
  doc.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; }, { capture: true, passive: true });
  doc.addEventListener('pointerup', e => {
    if (!locked) return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 16) { last = 0; return; }  // a scroll/drag, not a tap
    const now = performance.now();
    if (now - last < 340) { last = 0; unlock(); } else last = now;
  }, { capture: true, passive: true });
}

// Tell a face whether it is the focused/locked side. Faces pause their cosmetic
// animation loops while blurred (an idle side riding the spinning cube does no work),
// which both stops the stale-looking churn and removes the per-iframe repaint cost
// that piles into the mid-spin GPU spike. The watch timer on the Log face is exempt
// (it keeps advancing while blurred) — see that face's handler.
function signalFace(cfg, active) {
  if (cfg && cfg.frame && cfg.frame.contentWindow)
    cfg.frame.contentWindow.postMessage({ type: active ? 'cube:focus' : 'cube:blur' }, '*');
}

// Pierre (+Y, material index 2) is a chat window. While its input is focused
// and the soft keyboard is open, the animation loop pins that square to the top
// of the visible viewport instead of 3D-projecting it onto the cube face — so
// the browser's keyboard pan can't slide it off the top of the screen.
const PIERRE_FACE  = 2;
const vv           = window.visualViewport;
const controlsEl   = document.getElementById('controls');
let   chatFocused  = false;  // set from cube_pierre_face.html via postMessage
let   chatMode     = false;  // chatFocused + keyboard actually open
let   _ctrlHidden  = false;  // are the media buttons currently hidden?
let   _chatPrev    = false;  // last chatMode (to re-run layout when the keyboard toggles)

// ─── animation loop ───────────────────────────────────────────────────────
let t = 0;
(function animate() {
  requestAnimationFrame(animate);
  // Keep rescheduling, but do no GPU/DOM work while the tab is hidden or the GL
  // context is briefly gone. Backgrounding is the highest-pressure window for iOS to
  // evict the tab; rendering the cube + reprojecting six iframes there buys nothing.
  if (document.hidden || contextLost) return;
  t += 0.01;

  if (snapping) {
    cube.quaternion.slerp(snapQ, 0.16);
    if (cube.quaternion.angleTo(snapQ) < 0.003) {
      cube.quaternion.copy(snapQ);
      snapping = false;
    }
  } else if (!locked && !dragging) {
    // Inertia + gentle auto-drift — same world-axis approach
    velX *= 0.94;
    velY *= 0.94;
    const qH = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), velX - 0.004);
    const qV = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), velY);
    cube.quaternion.premultiply(qH).premultiply(qV);
  }

  // Bob — settle to center when locked
  // Free cube floats in the TOP stage too (lift ≈ half the console band, converted
  // from screen px to world units at the free-mode camera distance). Locked → recenter
  // (the open face is positioned by its own top-stage pin).
  const cH = Math.min(CONSOLE_H, VH * 0.44);
  const liftY = (cH / 2) * (2 * 8.5 * 0.46631) / VH;   // px → world @ z=8.5, fov 50°
  const targetY = locked ? 0 : liftY + Math.sin(t * 0.75) * 0.12;
  cube.position.y += (targetY - cube.position.y) * 0.08;

  // Smooth camera zoom
  camera.position.z += (camTargetZ - camera.position.z) * 0.07;

  renderer.render(scene, camera);

  // Pierre chat is in "pinned" mode when its input is focused AND the keyboard
  // is actually up. Browsers signal that two different ways: some shrink the
  // visual viewport (vv.height < innerHeight), others keep the height but scroll
  // the page to lift the input above the keyboard (vv.offsetTop > 0). Either
  // counts. Programmatic focus on load (no keyboard, no pan) does not.
  const kbOpen = !!vv && (vv.offsetTop > 1 || innerHeight - vv.height > 60);
  const pierreActive = locked && activeFace === PIERRE_FACE;
  chatMode = pierreActive && chatFocused && kbOpen;
  const kbActive = locked && kbOpen;   // any locked face with the keyboard up → pin to top

  if (chatMode !== _chatPrev) { _chatPrev = chatMode; layout(); }                 // keyboard toggle → re-gate rotation

  // While the Pierre chat is selected, hide the media buttons so they sit
  // underneath the chat instead of floating on top of it. The cube canvas and
  // the unlock hint are hidden too: the iOS keyboard pans the page, which drags
  // the 3D cube (the grey box) around behind the pinned chat. With the chat
  // owning the screen, the cube serves no purpose — and exit still works via the
  // in-iframe pinch / double-tap, which posts 'pangolin-back'.
  if (pierreActive !== _ctrlHidden) {
    controlsEl.style.opacity = pierreActive ? '0' : '';
    controlsEl.style.pointerEvents = pierreActive ? 'none' : '';
    canvas.style.visibility = pierreActive ? 'hidden' : '';
    pinchHint.style.visibility = pierreActive ? 'hidden' : '';
    _ctrlHidden = pierreActive;
  }

  // Face overlays — perspective-correct matrix3d tracking. The real iframe rides
  // the cube face as it spins (looks identical in nav), but it is INERT there:
  // pointer-events stay off until the face is the locked/active one, so touches in
  // navigation mode drive the cube (drag / double-tap), never the side's content.
  for (const [fi, cfg] of Object.entries(FACE_OVERLAYS)) {
    _fN.copy(cfg.normal).applyQuaternion(cube.quaternion);
    const dot = _fN.z;
    if (dot > 0.02) {
      const active = locked && +fi === activeFace;
      // The heavy per-frame work is the corner projection + matrix3d solve + the
      // resulting iframe re-composite. Skip it for (a) the active locked face — it is
      // positioned by the pin below, not this projection — and (b) faces grazing
      // edge-on (dot ≤ 0.06), which are ≤6% opaque: a frame of stale transform there
      // is invisible. This trims the mid-spin composite spike that can crash the GPU.
      if (!active && dot > 0.06) {
        const pts = cfg.corners.map(c => {
          _fW.copy(c).applyQuaternion(cube.quaternion).add(cube.position);
          _fP.copy(_fW).project(camera);
          return { x: (_fP.x + 1) / 2 * VW, y: (1 - _fP.y) / 2 * VH };
        });
        const tx = faceCssMatrix3d(pts);
        if (cfg._tx !== tx) { cfg.frame.style.transform = tx; cfg._tx = tx; }
      }
      const opacity = active ? 1 : dot;
      if (Math.abs(cfg._op - opacity) > 0.004) {
        cfg.el.style.opacity = opacity.toFixed(3);
        cfg._op = opacity;
      }
      // Only the locked/active face is interactive — every other face stays inert
      // while it rides the spinning cube.
      if (cfg._active !== active) {
        cfg.el.style.pointerEvents = active ? 'all' : 'none';
        cfg._active = active;
        signalFace(cfg, active);   // focus the new face / blur the old → it pauses its loops
      }
    } else if (cfg._op > 0) {
      cfg.el.style.opacity = '0';
      cfg.el.style.pointerEvents = 'none';
      cfg._op = 0;
      if (cfg._active) { cfg._active = false; signalFace(cfg, false); }   // spun off-screen → blur
    }
  }

  // A locked face has exactly two positions: centered, or pinned to the top when
  // the keyboard is up. Re-applied every frame, so a browser pan / rubber-band can
  // never move the frame — vertical swipes only scroll the content inside it.
  if (locked) {
    const cfg = FACE_OVERLAYS[activeFace];
    if (cfg && cfg.frame) {
      const margin = 10;
      let size, scale, x, y;
      if (kbActive && vv) {                       // keyboard up (portrait): top of the visible band
        size  = Math.min(vv.width, vv.height) - margin * 2;
        scale = size / IFRAME_SZ;
        x = (vv.offsetLeft || 0) + (vv.width - size) / 2;
        y = vv.offsetTop + margin;
      } else if (vv && ORI === 0) {               // portrait: TOP stage; console band reserved below
        const cH = Math.min(CONSOLE_H, vv.height * 0.44);     // for the wheel (capped on short screens)
        const availH = vv.height - cH;
        size  = Math.min(vv.width, availH) - margin * 2;      // keep square; fit the top band
        scale = size / IFRAME_SZ;
        x = (vv.offsetLeft || 0) + (vv.width - size) / 2;
        y = (vv.offsetTop  || 0) + (availH - size) / 2;        // centered in the top stage
      } else {                                    // landscape / no visualViewport: logical viewport
        const cH = Math.min(CONSOLE_H, VH * 0.44);
        const availH = VH - cH;
        size  = Math.min(VW, availH) - margin * 2;
        scale = size / IFRAME_SZ;
        x = (VW - size) / 2;
        y = (availH - size) / 2;
      }
      cfg.frame.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      cfg._tx = '';                               // force projection to re-apply when unlocked
    }
  }
})();

// Option A: rotate the whole #app in place to match device orientation, keeping
// a portrait composition (the square cube fits either way). VW/VH are the logical
// portrait dims used by the renderer, camera, and face projection.
// Keyboard faces (Pierre, or any face with the soft keyboard up) don't rotate —
// typing sideways is bad UX — so they stay portrait and prompt a rotate-back.
function keyboardFace() { return locked && (activeFace === PIERRE_FACE || chatMode); }
function layout() {
  const landscape = innerWidth > innerHeight;          // reliable cross-browser signal
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  if (landscape && keyboardFace()) {
    ORI = 0; VW = innerWidth; VH = innerHeight;         // stay native; show the prompt
    rotateMsg.classList.add('show');
  } else {
    rotateMsg.classList.remove('show');
    ORI = landscape ? ((ang === 270 || ang === -90) ? 90 : -90) : 0;   // counter-rotate to stay upright
    VW = landscape ? innerHeight : innerWidth;
    VH = landscape ? innerWidth  : innerHeight;
  }
  appEl.style.width  = VW + 'px';
  appEl.style.height = VH + 'px';
  appEl.style.transform = `translate(-50%,-50%) rotate(${ORI}deg)`;
  camera.aspect = VW / VH;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(VW, VH);
}
// Map a physical screen point into the logical (un-rotated) #app frame. Identity
// in portrait (ORI 0), so portrait behavior is unchanged.
function toLogical(px, py) {
  const x = px - innerWidth / 2, y = py - innerHeight / 2;
  const rad = -ORI * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  return { x: (x * c - y * s) + VW / 2, y: (x * s + y * c) + VH / 2 };
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
// Block iOS Safari pinch-zoom (it ignores maximum-scale). Double-tap is the only
// gesture that does anything; the page itself must never zoom.
document.addEventListener('gesturestart',  e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('dblclick',      e => e.preventDefault());
if (screen.orientation && screen.orientation.addEventListener)
  screen.orientation.addEventListener('change', layout);
layout();

// ─── Fire TV remote ───────────────────────────────────────────────────────
const API = window.location.hostname === 'localhost'
  ? 'http://localhost:8787'
  : 'https://pangolin-rc.edward-m-willett.workers.dev';

async function sendKey(cmd) {
  // While a caption session is live, ff/rw also shift the caption cursor — the one
  // playback signal we observe. This runs even with no controllable device, so the
  // buttons still align captions when the member is on "No device connected".
  if (capSession) { if (cmd === 'ff') capNudge(CAP_STEP_MS); else if (cmd === 'rw') capNudge(-CAP_STEP_MS); }
  // Only an actual device gets a command. On "This Phone" / "No device" there's
  // nothing to drive, so we skip the network call entirely (remote off).
  if (!capHasDevice()) return;
  // The server routes the keypress to whatever device the member has selected on
  // the Profile face — we just hand it the session email so it can resolve the target.
  let email = '';
  try { email = localStorage.getItem('pg_user') || ''; } catch {}
  try {
    await fetch(`${API}/remote/cmd/${cmd}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch { /* ignore network errors */ }
}

function bindRemote(id, cmd) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    sendKey(cmd);
    btn.classList.add('sent');
    setTimeout(() => btn.classList.remove('sent'), 180);
  });
}

bindRemote('btn-rw',   'rw');
bindRemote('btn-ff',   'ff');
bindRemote('btn-back', 'back');

// ── The play button launches whatever the Episode face has loaded, on its own
// streamer. The Episode reports the show's service (from TVMaze's web channel /
// network); we open a deep search for the show on that service. Without a
// per-show title-id map this search is as deep as we can go generically — refine
// per service in live testing. We also mark a start time for the minute-bar guess.
function serviceLink(service, q){
  const s = (service||'').toLowerCase(), enc = encodeURIComponent(q);
  if (s.includes('netflix'))                  return 'https://www.netflix.com/search?q=' + enc;
  if (s.includes('hulu'))                     return 'https://www.hulu.com/search?q=' + enc;
  if (s.includes('max') || s.includes('hbo')) return 'https://play.max.com/search?q=' + enc;
  if (s.includes('disney'))                   return 'https://www.disneyplus.com/search?q=' + enc;
  if (s.includes('prime') || s.includes('amazon')) return 'https://www.primevideo.com/search/ref=atv_nb_sug?phrase=' + enc;
  if (s.includes('apple'))                    return 'https://tv.apple.com/search?term=' + enc;
  // NBC broadcast / NBCUniversal cable (USA, Bravo, Syfy, CNBC…) all stream on Peacock.
  // Peacock's search page takes no query param, so we can only land on it — no title prefill.
  if (s.includes('peacock') || s.includes('nbc')) return 'https://www.peacocktv.com/watch/search';
  if (s.includes('paramount'))                return 'https://www.paramountplus.com/search/?query=' + enc;
  return '';   // unknown streamer → no launch
}
let currentEpisode = null;   // {tvmazeId, name, season, number, runtime, service} from the Episode face

// Grey the play button when the current show's streamer can't be deep-linked,
// and tell the Episode face whether its lit streamer name should act as a button.
function updatePlayState() {
  const ok = !!(currentEpisode && currentEpisode.name && serviceLink(currentEpisode.service, currentEpisode.name));
  document.getElementById('btn-play').classList.toggle('dimmed', !ok);
  const cfg = FACE_OVERLAYS[FACE_INDEX.episodes];
  if (cfg && cfg.frame && cfg.frame.contentWindow)
    cfg.frame.contentWindow.postMessage({ type: 'cube:launchable', ok }, '*');
  updateDeviceChip();
}

// ── Device + streamer chip ────────────────────────────────────────────────
// Friendly streamer name for the chip (serviceLink does the linking; this just
// labels). Falls back to the raw service string from TVMaze.
function streamerLabel(service) {
  const s = (service || '').toLowerCase();
  if (s.includes('netflix'))                  return 'Netflix';
  if (s.includes('hulu'))                     return 'Hulu';
  if (s.includes('max') || s.includes('hbo')) return 'Max';
  if (s.includes('disney'))                   return 'Disney+';
  if (s.includes('prime') || s.includes('amazon')) return 'Prime Video';
  if (s.includes('apple'))                    return 'Apple TV';
  if (s.includes('peacock') || s.includes('nbc')) return 'Peacock';
  if (s.includes('paramount'))                return 'Paramount+';
  return service || '';
}
// The device the remote is pointed at, cached by the Profile face. Default phone.
function selectedDeviceLabel() {
  try { const d = localStorage.getItem('pg_device'); if (d) return d; } catch {}
  return 'This Phone';
}
function updateDeviceChip() {
  const chip = document.getElementById('device-chip');
  if (!chip) return;
  const esc = (x) => String(x).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const dev = selectedDeviceLabel();
  const svc = currentEpisode ? streamerLabel(currentEpisode.service) : '';
  const launchable = !!(currentEpisode && currentEpisode.name && serviceLink(currentEpisode.service, currentEpisode.name));
  const kind = selectedDeviceKind();
  // No device → plain "NO DEVICE" (no 🚫). Otherwise icon + device, streamer stacked under.
  const devRow = kind === 'none'
    ? '<span class="dc-dev">NO DEVICE</span>'
    : '<span class="dc-ic">' + (kind === 'phone' ? '📱' : '📺') + '</span><span class="dc-dev">' + esc(dev) + '</span>';
  chip.innerHTML = '<span class="dc-row">' + devRow + '</span>' +
    (launchable && svc ? '<span class="dc-svc">' + esc(svc) + '</span>' : '');
  chip.classList.toggle('dimmed', !(launchable && svc));
  chip.classList.add('show');
}
document.getElementById('device-chip').addEventListener('click', () => cubeRotateTo('profile'));

// Console floating cube → back to cube nav. Shown only while a face is open.
(function initWheelCube(){
  const wc = document.getElementById('wheel-cube');
  if(!wc) return;
  wc.addEventListener('click', () => { if(locked) unlock(); });
  // Track lock state each frame is overkill; piggyback on the existing lock/unlock
  // by observing `locked` on a light interval is unnecessary — toggle from lock/unlock.
  window._setWheelCube = (on) => wc.classList.toggle('show', !!on);
})();
// The Profile face writes pg_device in its own iframe; the top window hears it as
// a storage event. Re-read so the chip reflects a device change immediately.
window.addEventListener('storage', (e) => { if (e.key === 'pg_device') updateDeviceChip(); });

// Episode-end nudge: when a live watch starts (play), set a timer for the
// episode runtime; at the end fire an OS notification calling the user back to
// rank it. Browser ceiling: the timer only runs while the browser is alive —
// closing it kills the timer. We derive runtime from TVMaze each time, store nothing.
let _epEndTimer = null;
let _armNextOnReturn = false;   // set when "Watch Next" wants the next episode's timer re-armed
function scheduleEpisodeEnd(ep) {
  if (!ep || !ep.runtime || !('Notification' in window)) return;
  const startedAt = ep.startedAt || Date.now();   // stamp the watch start for the partial guess
  clearTimeout(_epEndTimer);
  _epEndTimer = setTimeout(() => {
    if (Notification.permission !== 'granted') return;
    const n = new Notification('Your episode finished. Come rank it.', {
      body: ep.name + ' · EP ' + ep.number,
      tag: 'pangolin-episode-end'
    });
    n.onclick = () => {                                  // call the member back to Pierre's "did you finish?" prompt
      window.focus();
      routeEpisodeFinish({ tvmazeId: ep.tvmazeId, name: ep.name, season: ep.season,
                           number: ep.number, runtime: ep.runtime, startedAt });
    };
  }, ep.runtime * 60 * 1000);
}
// Send the member to Pierre's "Did you finish …?" prompt for a launched episode.
// Used by both the on-return check and the (best-effort) end-of-episode notification.
function routeEpisodeFinish(L) {
  if (!L || !L.tvmazeId) return;
  rotateToFace(FACE_INDEX.pierre);
  const cfg = FACE_OVERLAYS[FACE_INDEX.pierre];
  if (cfg && cfg.frame && cfg.frame.contentWindow)
    cfg.frame.contentWindow.postMessage({ type: 'cube:payload', face: 'pierre',
      payload: { intent: 'episode-finish', launch: L } }, '*');
}
// Launch the current show on its streamer + start the episode-end timer. Driven
// by the play button and by tapping the lit streamer name on the Episode face.
async function launchCurrent() {
  if (!currentEpisode || !currentEpisode.name) return;   // nothing loaded
  const url = serviceLink(currentEpisode.service, currentEpisode.name);
  if (!url) return;                                      // no known streamer → nothing to launch
  const btn = document.getElementById('btn-play');
  btn.classList.add('sent');
  setTimeout(() => btn.classList.remove('sent'), 180);
  // Off-phone: the show is on the TV, so the phone stays put and captions it
  // instead of opening the streamer here. The play button drives the TV's own
  // play/pause (keycode 85 / webOS PLAY) and keeps the caption cursor in lockstep:
  // the first press starts the session anchored to this instant; later presses
  // toggle pause, freezing the cursor with the TV. The align drag absorbs any
  // residual offset. (Note: Fire's play is a true toggle; on webOS PLAY isn't,
  // so pause may diverge there until its adapter gains a real toggle.)
  if (capOffPhone()) {
    if (capHasDevice()) sendKey('play');                 // drive the TV's play/pause (skipped on "No device")
    if (capSession) capTogglePause();                    // mirror it on the caption cursor
    else capStart({ ...currentEpisode, startedAt: Date.now() });
    return;
  }
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  scheduleEpisodeEnd(currentEpisode);                    // live-watch session begins
  try { localStorage.setItem('pg_launch', JSON.stringify({ ...currentEpisode, startedAt: Date.now() })); } catch {}
  // When the streamer's search page can't carry the title in the URL (e.g. Peacock),
  // copy it to the clipboard so the user can just paste into the search box. Await so
  // the write lands before navigation unloads the page.
  if (!url.includes(encodeURIComponent(currentEpisode.name))) {
    try { await navigator.clipboard.writeText(currentEpisode.name); } catch {}
  }
  window.location.href = url;
}
document.getElementById('btn-play').addEventListener('click', launchCurrent);
updatePlayState();   // start dimmed until a launchable show is loaded

// On return from the launched app, surface the minute guess: rotate to the
// Episode face and hand it the launch. Runs on pageshow + visibility so it works
// even when the browser restores the page from cache (no script re-run).
function resumeLaunch() {
  let L = null;
  try { L = JSON.parse(localStorage.getItem('pg_launch') || 'null'); } catch {}
  if (!L || !L.tvmazeId) return;
  if (Date.now() - (L.startedAt || 0) > 6 * 3600 * 1000) return;   // stale (>6h) — ignore
  // If the episode would already have ended, call the member back to Pierre's
  // "Did you finish …?" prompt. Otherwise fall through to the Watch-face scrubber.
  const elapsedMin = (Date.now() - (L.startedAt || 0)) / 60000;
  if (L.runtime && elapsedMin >= L.runtime) { routeEpisodeFinish(L); return; }
  const cfg = FACE_OVERLAYS[FACE_INDEX.episodes];
  if (cfg && cfg.frame && cfg.frame.contentWindow)
    cfg.frame.contentWindow.postMessage({ type: 'cube:launch', launch: L }, '*');
  episodesEmpty = false;   // a launched show is loading — don't bounce to the Log
  rotateToFace(FACE_INDEX.episodes);
}
window.addEventListener('pageshow', () => { resumeLaunch(); updateDeviceChip(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { resumeLaunch(); updateDeviceChip(); } });

// ─── Second-screen captions ("whisper sync") ───────────────────────────────
// When the show plays on another device (not the phone), the top quarter shows
// the subtitles, synced by a wall-clock cursor counted from when play was pressed.
// The TV reports no position, so the cursor is an estimate: elapsed time, shifted
// by the ff/rw we send (the one signal we see) and by a manual align drag,
// persisted per episode. Phase 1 pulls a seeded cue track from /captions/:id;
// later phases swap in a real subtitle file, then a mic-Whisper fallback.
const CAP_STEP_MS = 10000;   // ff/rw nudge per press — tune against a real device
let capSession = null;       // { episodeId, cues, mode, startedAt, nudgeMs, paused, pausedAt, pausedAccum }
const _capEl    = document.getElementById('caption');
const _capText  = document.getElementById('caption-text');
const _capSrc   = document.getElementById('cap-src');
const _capAlign = document.getElementById('cap-align');
const _capLbl   = document.getElementById('cap-align-lbl');
const _capCoEl  = document.getElementById('cap-coview');
const _capCoWho = _capCoEl.querySelector('.cv-who');
const _capCoTxt = _capCoEl.querySelector('.cv-text');
let _capTick    = null;

// The Profile picker caches the selection KIND: 'phone' (this is the screen),
// 'none' (off-phone, nothing to drive), or 'device' (a real TV we can command).
function selectedDeviceKind() { try { return localStorage.getItem('pg_device_kind') || 'phone'; } catch { return 'phone'; } }
function capOffPhone()  { return selectedDeviceKind() !== 'phone'; }   // none + device → caption the second screen
function capHasDevice() { return selectedDeviceKind() === 'device'; }  // only a real device takes remote commands
function capEpisodeId(ep) {
  // Stable key matching the catalog: tvmaze:{id}:s{season}e{number}.
  if (!ep || !ep.tvmazeId) return null;
  const ref = String(ep.tvmazeId).replace(/^tvmaze:/, '');
  return 'tvmaze:' + ref + ':s' + (ep.season || 0) + 'e' + (ep.number || 0);
}
// Comments key on (show_id, episode_id) — the universal title key + the human
// episode code (S01E01 / 🎬), matching how the Episode face stores them. The
// caption cue track keys differently (capEpisodeId), so this is its own builder.
function capShowId(ep) { return ep && ep.tvmazeId ? String(ep.tvmazeId) : null; }
function capEpCode(ep) {
  if (!ep) return null;
  if (ep.kind === 'movie') return '🎬';
  return 'S' + String(ep.season || 1).padStart(2, '0') + 'E' + String(ep.number || 0).padStart(2, '0');
}
function capEmail() { try { return localStorage.getItem('pg_user') || ''; } catch { return ''; } }
// Opt-in co-view set, per show, written by the Episode face's friend list.
// Empty (the default) → co-viewing off, and the fetch + firing are skipped.
function capCoViewers(showId) {
  if (!showId) return [];
  try { return JSON.parse(localStorage.getItem('pg_coview:' + showId) || '[]'); } catch { return []; }
}
function capSavedNudge(id) { try { const v = localStorage.getItem('pg_capalign:' + id); return v ? parseFloat(v) || 0 : 0; } catch { return 0; } }
function capSaveNudge(id, ms) { try { localStorage.setItem('pg_capalign:' + id, String(ms)); } catch {} }
function capUpdateAlignLbl() {
  const s = capSession ? capSession.nudgeMs / 1000 : 0;
  _capLbl.textContent = Math.abs(s) < 0.25 ? 'in sync' : (s > 0 ? '+' + s.toFixed(1) + 's' : s.toFixed(1) + 's');
}
function capReflectSlider() { _capAlign.value = String(Math.max(-30, Math.min(30, (capSession ? capSession.nudgeMs : 0) / 1000))); }

async function capStart(ep) {
  const id = capEpisodeId(ep);
  if (!id) return;
  capStop();
  const nudgeMs = capSavedNudge(id);
  capSession = { episodeId: id, cues: [], mode: 'file', startedAt: Date.now(), nudgeMs, paused: false, pausedAt: 0, pausedAccum: 0,
                 coview: [], coIdx: 0, coPlaying: false, coAudio: null };
  capReflectSlider(); capUpdateAlignLbl();
  _capText.textContent = ''; _capText.classList.add('gap');
  capHideCoview();
  _capEl.classList.add('show');
  try {
    const r = await fetch(API + '/captions/' + encodeURIComponent(id));
    const d = await r.json();
    if (!capSession || capSession.episodeId !== id) return;   // superseded while fetching
    capSession.mode = d.mode || 'file';
    capSession.cues = Array.isArray(d.cues) ? d.cues : [];
    _capSrc.textContent = capSession.mode === 'mic' ? 'MIC' : 'CC';
    _capSrc.classList.toggle('mic', capSession.mode === 'mic');
  } catch { /* no cues — the align bar still works, text stays blank */ }
  // Co-viewing (best-effort, opt-in): pull friends' comments for this episode,
  // sorted by marker, so capRender can fire each as the cursor passes it. The
  // server re-checks friendship; an empty/forbidden set just yields no clips.
  const showId = capShowId(ep), epCode = capEpCode(ep), mates = capCoViewers(showId);
  if (showId && epCode && mates.length && capEmail()) {
    try {
      const u = new URL(API + '/transcribe/coview');
      // Live co-view self-gates at the cursor: capFireCoview only reveals/plays a
      // clip once the wall-clock passes its mark, and it needs each audioUrl ahead
      // to instantiate the Audio at fire time. So request full reveal here — the
      // spoiler gate (seenMs) is for the Episode face's browsable timeline.
      u.search = new URLSearchParams({ showId, episodeId: epCode, email: capEmail(),
        with: mates.join(','), seenMs: String(Number.MAX_SAFE_INTEGER) }).toString();
      const cv = await (await fetch(u)).json();
      if (capSession && capSession.episodeId === id)   // not superseded while fetching
        capSession.coview = (cv.comments || []).slice().sort((a, b) => capFireAt(a) - capFireAt(b));
    } catch { /* co-view is optional; captions run fine without it */ }
  }
  if (_capTick) clearInterval(_capTick);
  _capTick = setInterval(capRender, 250);
  capRender();
}
function capStop() {
  if (capSession && capSession.coAudio) { try { capSession.coAudio.pause(); } catch {} }
  capSession = null;
  if (_capTick) { clearInterval(_capTick); _capTick = null; }
  capHideCoview();
  _capEl.classList.remove('show');
}
function capPosMs() {
  if (!capSession) return 0;
  const base = capSession.paused ? capSession.pausedAt : Date.now();
  return (base - capSession.startedAt) - capSession.pausedAccum + capSession.nudgeMs;
}
function capRender() {
  if (!capSession) return;
  const t = capPosMs() / 1000;
  let cue = null;
  for (const c of capSession.cues) { if (t >= c.start && t < c.end) { cue = c; break; } }
  if (cue) { _capText.textContent = cue.text; _capText.classList.remove('gap'); }
  else { _capText.classList.add('gap'); }
  capFireCoview(capPosMs());
}
// Fire each friend's clip once, as the wall-clock cursor first passes its marker.
// Tolerant of the same jumps the cursor takes: a rewind reopens the firing window,
// a fast-forward marks skipped clips played-silently so a +2min jump doesn't dump
// five overlapping voices at once. coPlaying serializes — two clips at the same
// minute don't talk over each other; the later one retries on the next tick.
// Friends' audio fires one minute AFTER the mark it was spoken at (matches the
// server's COVIEW_REVEAL_OFFSET_MS): an 8:00 comment plays at 9:00. Prefer the
// server's revealMs; fall back for older payloads. A reply shares its parent's
// mark, so it gets an extra beat (COVIEW_REPLY_BEAT_MS) to land just after the
// original rather than on top of it.
const COVIEW_REVEAL_OFFSET_MS = 60000;
const COVIEW_REPLY_BEAT_MS = 5000;
function capFireAt(clip) {
  const base = (clip.revealMs != null) ? clip.revealMs : (clip.timestampMs + COVIEW_REVEAL_OFFSET_MS);
  return base + (clip.replyTo ? COVIEW_REPLY_BEAT_MS : 0);
}
function capFireCoview(posMs) {
  if (!capSession) return;
  const cv = capSession.coview;
  if (!cv.length) return;
  // Rewound behind an already-fired clip → step the cursor back so it re-fires.
  while (capSession.coIdx > 0 && capFireAt(cv[capSession.coIdx - 1]) > posMs + 1500)
    capSession.coIdx--;
  while (capSession.coIdx < cv.length && capFireAt(cv[capSession.coIdx]) <= posMs) {
    const clip = cv[capSession.coIdx];
    const late = posMs - capFireAt(clip);
    capSession.coIdx++;
    if (!clip.audioUrl) continue;                           // text reply — nothing to play here
    if (late > 8000) continue;                              // jumped past it — don't play
    if (capSession.coPlaying) { capSession.coIdx--; break; } // busy — retry next tick
    capPlayCoview(clip);
  }
}
function capPlayCoview(clip) {
  if (!capSession) return;
  capSession.coPlaying = true;
  _capCoWho.textContent = clip.author || 'friend';
  _capCoTxt.textContent = clip.transcription || '🔊';
  _capCoEl.classList.add('show');
  const a = new Audio(clip.audioUrl);
  capSession.coAudio = a;
  const done = () => {
    if (capSession) { capSession.coPlaying = false; capSession.coAudio = null; }
    capHideCoview();
  };
  a.onended = done; a.onerror = done;
  a.play().catch(() => { if (capSession) capSession.coPlaying = false; });
}
function capHideCoview() {
  _capCoEl.classList.remove('show');
  _capCoWho.textContent = ''; _capCoTxt.textContent = '';
}
function capNudge(deltaMs) {
  if (!capSession) return;
  capSession.nudgeMs += deltaMs;
  capSaveNudge(capSession.episodeId, capSession.nudgeMs);
  capReflectSlider(); capUpdateAlignLbl(); capRender();
}
function capTogglePause() {
  if (!capSession) return;
  if (capSession.paused) { capSession.pausedAccum += Date.now() - capSession.pausedAt; capSession.paused = false; }
  else { capSession.pausedAt = Date.now(); capSession.paused = true; }
}
// Manual align: dragging sets the offset directly (absolute), persisted per episode.
_capAlign.addEventListener('input', () => {
  if (!capSession) return;
  capSession.nudgeMs = parseFloat(_capAlign.value) * 1000;
  capSaveNudge(capSession.episodeId, capSession.nudgeMs);
  capUpdateAlignLbl(); capRender();
});
// Switching the remote back to This Phone ends any caption session (phone is the screen now).
window.addEventListener('storage', (e) => { if (e.key === 'pg_device' && !capOffPhone()) capStop(); });

// any face iframe can send pangolin-back to unlock the cube
window.addEventListener('message', (e) => {
  if (e.data?.type === 'pangolin-back') unlock();
  // Pierre chat reports input focus so we can pin it above the keyboard.
  if (e.data?.type === 'pierre-chat-focus') chatFocused = !!e.data.focused;
  // The Log face published its current records; keep a snapshot for the others,
  // plus a ready-to-load payload for the most-recently-watched show.
  if (e.data?.type === 'log:data') {
    viewingStore = e.data.shows || [];
    lastResume = e.data.resume || null;
    logLoaded = true;
    if (episodesWantsLast) { episodesWantsLast = false; sendEpisodesLast(); }
    // Nudge FEED to re-pull the member's real activity now that the log changed.
    const feedCfg = FACE_OVERLAYS[FACE_INDEX.feed];
    if (feedCfg && feedCfg.frame && feedCfg.frame.contentWindow)
      feedCfg.frame.contentWindow.postMessage({ type: 'feed:refresh' }, '*');
  }
  // The Watch face opened and is asking for the last thing watched.
  if (e.data?.type === 'episode:requestLast') {
    if (logLoaded) sendEpisodesLast();
    else episodesWantsLast = true;   // answer once the Log publishes
  }
  // postMessage fallback for a face asking to rotate (no keyboard activation).
  if (e.data?.type === 'cube:rotateTo') cubeRotateTo(e.data.face, e.data.payload);
  // Episode face reports the show/episode it currently has loaded (drives the play button).
  // No show loaded → the Watch face is empty; if we're sitting on it, swing to the Log.
  if (e.data?.type === 'episode:current') {
    currentEpisode = e.data.show || null;
    episodesEmpty = !e.data.show;
    updatePlayState();
    if (episodesEmpty) bounceFromEmptyWatch(FACE_INDEX.episodes);
    // "Watch Next": the Watch face just advanced to the next episode — re-arm the
    // episode-end timer for it (the member is off watching it on their device).
    if (_armNextOnReturn && currentEpisode) {
      _armNextOnReturn = false;
      scheduleEpisodeEnd({ ...currentEpisode, startedAt: Date.now() });
    }
  }
  // Episode loaded a show → make sure the Log is tracking it too (Log dedupes).
  if (e.data?.type === 'episode:track' && e.data.tvmazeId)
    addToLogFace({ id: e.data.tvmazeId, name: e.data.name, kind: e.data.kind || 'show', poster: e.data.poster || null });
  // Tapping the lit streamer name on the Episode face launches it (same as play).
  if (e.data?.type === 'episode:launch') launchCurrent();
  // Episode reported in-episode progress (minutes / done / BP): forward to the
  // Log, which is the single writer to the member's account.
  if (e.data?.type === 'episode:progress') {
    const logCfg = FACE_OVERLAYS[FACE_INDEX.log];
    if (logCfg && logCfg.frame && logCfg.frame.contentWindow)
      logCfg.frame.contentWindow.postMessage({ type: 'cube:payload', face: 'log',
        payload: { progress: e.data } }, '*');
  }
  // Episode finale tap (MVP): swing to the Log and finish the matching show.
  if (e.data?.type === 'episode:finishedFinale') {
    rotateToFace(FACE_INDEX.log);
    const logCfg = FACE_OVERLAYS[FACE_INDEX.log];
    if (logCfg && logCfg.frame && logCfg.frame.contentWindow)
      logCfg.frame.contentWindow.postMessage({ type: 'cube:payload', face: 'log',
        payload: { finishShow: { tvmazeId: e.data.tvmazeId } } }, '*');
  }
  // Pierre's "Did you finish …?" choice: log the episode + navigate. The Watch
  // face owns the logging (via cube:launch); the shell rotates to the right face.
  if (e.data?.type === 'episodeFinish:commit') {
    const L = e.data.launch || {};
    const epCfg = FACE_OVERLAYS[FACE_INDEX.episodes];
    const post = (launch) => { if (epCfg && epCfg.frame && epCfg.frame.contentWindow)
      epCfg.frame.contentWindow.postMessage({ type: 'cube:launch', launch }, '*'); };
    episodesEmpty = false;   // a show is loading on the Watch face — don't bounce to the Log
    try { localStorage.removeItem('pg_launch'); } catch {}   // consumed — don't re-prompt on next return
    if (e.data.choice === 'partial') {
      post({ ...L, partial: true });             // load at the episode + stage the scrubber guess
      rotateToFace(FACE_INDEX.episodes);
    } else if (e.data.choice === 'browse') {
      post({ ...L, autoFinish: true });          // full-finish the episode
      rotateToFace(FACE_INDEX.join);             // BROWSE lives on the join face
    } else if (e.data.choice === 'next') {
      _armNextOnReturn = true;                   // re-arm the timer when the Watch face reports the next episode
      post({ ...L, autoFinish: true });          // full-finish + advance to the next episode
      rotateToFace(FACE_INDEX.log);
    }
  }
  // Pierre's join intake populates the Log with the named shows.
  if (e.data?.type === 'pierre:addToLog' && Array.isArray(e.data.shows))
    e.data.shows.forEach(s => addToLogFace({ id: s.id, name: s.name }, s.pattern));
  // A visitor signed up past the cap -> show the waitlist DEMO band.
  if (e.data?.type === 'pg-demo') showDemo();
});

// ─── DEMO band (waitlisted visitors) ───────────────────────────────────────
// Pierre posts 'pg-demo' when someone signs up past the member cap. The band
// then persists and offers a direct text to the team.
const TEAM_PHONE = '+13109221109';
const _demoband = document.getElementById('demoband');
function showDemo() { _demoband.classList.add('show'); try { localStorage.setItem('pg_demo', '1'); } catch {} }
try { if (localStorage.getItem('pg_demo') === '1') _demoband.classList.add('show'); } catch {}
document.getElementById('textteam').addEventListener('click', () => {
  window.location.href = 'sms:' + TEAM_PHONE + '?&body=' + encodeURIComponent("I want in on pangolinRC");
});

// ─── bug reporter ───────────────────────────────────────────────────────────
// The 🐞 grabs a screenshot of the current view, opens a note, and files it to
// POST /bug-reports (screenshot → R2, row → D1 → Airtable triage grid). Anyone
// may report; the screenshot is best-effort and never blocks sending the note.
(() => {
  const btn      = document.getElementById('bug-btn');
  const modal    = document.getElementById('bug-modal');
  const shotImg  = document.getElementById('bug-shot');
  const shotNote = document.getElementById('bug-shot-note');
  const noteEl   = document.getElementById('bug-note');
  const whereEl  = document.getElementById('bug-where');
  const sendBtn  = document.getElementById('bug-send');
  const cancelBtn= document.getElementById('bug-cancel');
  const claudeRow= document.getElementById('bug-claude-row');
  const claudeBox= document.getElementById('bug-claude');

  // Show the "Send to Claude" toggle only to admins. Checked once per session and
  // cached; the server re-verifies admin on submit so the box can't be forged.
  let isAdminCached = null;
  async function ensureAdmin() {
    if (isAdminCached !== null) return isAdminCached;
    let email = ''; try { email = localStorage.getItem('pg_user') || ''; } catch (_) {}
    if (!email) return (isAdminCached = false);
    try {
      const r = await fetch(`${API}/profile/${encodeURIComponent(email)}`);
      isAdminCached = r.ok && (await r.json())?.user?.user_type === 'admin';
    } catch (_) { isAdminCached = false; }
    return isAdminCached;
  }
  let shotBlob = null, h2cPromise = null;

  // Lazy-load html2canvas only the first time the 🐞 is opened (off the critical path).
  const loadH2C = () => (h2cPromise ||=
    import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm').then(m => m.default || m));

  const currentView = () => (locked && FACES[activeFace]) ? FACES[activeFace].label : 'cube';

  async function capture() {
    shotBlob = null;
    shotImg.style.display = 'none';
    shotNote.style.display = 'none';
    try {
      const h2c = await loadH2C();
      // An open face fills the screen via matrix3d — html2canvas can't follow that
      // 3D transform, so grab the face iframe's own flat document (exactly what's
      // read). On the bare cube, grab the shell body (the WebGL canvas reads back
      // thanks to preserveDrawingBuffer).
      let target = document.body, win = window;
      if (locked && FACE_OVERLAYS[activeFace] && FACE_OVERLAYS[activeFace].frame) {
        try {
          const cw = FACE_OVERLAYS[activeFace].frame.contentWindow;
          if (cw && cw.document && cw.document.body) { target = cw.document.body; win = cw; }
        } catch (_) { /* same-origin expected; fall back to shell body */ }
      }
      const canvas = await h2c(target, {
        backgroundColor: '#000', useCORS: true, logging: false,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        width: win.innerWidth, height: win.innerHeight,
        windowWidth: win.innerWidth, windowHeight: win.innerHeight,
      });
      shotBlob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.85));
      if (shotBlob) { shotImg.src = URL.createObjectURL(shotBlob); shotImg.style.display = 'block'; }
      else shotNote.style.display = 'block';
    } catch (err) {
      console.warn('bug screenshot failed', err);
      shotNote.style.display = 'block';
    }
  }

  function openModal() {
    whereEl.textContent = 'On: ' + currentView();
    noteEl.value = '';
    sendBtn.disabled = false; sendBtn.textContent = 'Send';
    claudeBox.checked = false; claudeRow.style.display = 'none';
    ensureAdmin().then(ok => { if (ok) claudeRow.style.display = 'flex'; });
    modal.classList.add('show');
    capture();  // async — preview fills in when ready
  }
  function closeModal() {
    modal.classList.remove('show');
    if (shotImg.src.startsWith('blob:')) URL.revokeObjectURL(shotImg.src);
    shotImg.src = ''; shotBlob = null;
  }

  async function send() {
    const text = noteEl.value.trim();
    if (!text && !shotBlob) { closeModal(); return; }
    sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
    try {
      const fd = new FormData();
      fd.append('note', text);
      fd.append('view', currentView());
      fd.append('url', location.href);
      fd.append('userAgent', navigator.userAgent);
      fd.append('viewport', innerWidth + 'x' + innerHeight);
      try { fd.append('email', localStorage.getItem('pg_user') || ''); } catch (_) {}
      fd.append('sendToClaude', (claudeRow.style.display !== 'none' && claudeBox.checked) ? '1' : '0');
      if (shotBlob) fd.append('screenshot', shotBlob, 'screenshot.png');
      const res = await fetch(`${API}/bug-reports`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('http ' + res.status);
      sendBtn.textContent = 'Thanks! 🐞';
      setTimeout(closeModal, 900);
    } catch (err) {
      console.warn('bug send failed', err);
      sendBtn.disabled = false; sendBtn.textContent = 'Retry';
    }
  }

  btn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  sendBtn.addEventListener('click', send);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
})();

// ─── CubeShell interface ────────────────────────────────────────────────────
// The minimal, explicit contract the off-cube wheel (clickwheel.js) consumes.
// Kept to exactly what the wheel calls today — the chosen wheel scope scrolls the
// OPEN face + drives its SELECT highlight, so it only needs to READ focus and reach
// the active face's document; it never changes focus or mutates the cube. Anything
// not exported here stays private to the shell by construction.
//   getFocus()     → { locked, face } — is a face open, and which one (cube index)
//   getActiveDoc() → the open face's Document (or null); FACE_OVERLAYS stays private
//   FACE_INDEX     → canonical face-name → cube-index map (exported above)
export function getFocus() { return { locked, face: activeFace }; }
export function getActiveDoc() {
  const cfg = FACE_OVERLAYS[activeFace];
  if (!cfg || !cfg.frame || !cfg.frame.contentWindow) return null;
  try { return cfg.frame.contentWindow.document; } catch (_) { return null; }
}
