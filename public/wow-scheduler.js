// wow-scheduler.js — WoW in-season scheduler, the shared service the faces read.
// NOT a face. Spec v1.0. Attaches window.WoW. Loaded by any face that needs it
// (WATCH chip + TAG, LOG countdown, Pierre nudge, Profile default). Pure derivation
// client-side from TVMaze airstamps; the only stored state is choices/counters/flags
// in the scheduler DB (via /scheduler/*), never the phase/countdown/mode/TAG.
//
// Copy strings are LOCKED (spec v1.0): mode names LIVE/FRESH/CASUAL/MORE!, the kill
// message verbatim, no em-dashes. Phase boundaries in CFG are the tunable surface.
(function () {
  'use strict';
  const API = (location.protocol === 'http:' && location.hostname === 'localhost')
    ? 'http://localhost:8787'
    : 'https://pangolin-rc.edward-m-willett.workers.dev';
  const H = 3600 * 1000, DAY = 864e5;

  // Phase boundaries (spec v1.0). Tunable surface.
  const CFG = { LIVE_H: 3, FRESH_H: 48, RAMP_H: 72, PRESHOW_H: 2, INSEASON_D: 14, WRAP_D: 7 };
  const MODES = ['LIVE', 'FRESH', 'CASUAL', 'MORE!'];
  const KILL_MSG = "You can turn this back on in your profile, but Pierre won't guess your watch habits anymore.";

  // ── phase engine: airWindow x timeNow (ported from the prototype) ──────────────
  function phase(eps, now) {
    now = now || Date.now();
    const aired = eps.filter(e => e.airstamp && new Date(e.airstamp).getTime() <= now);
    const future = eps.filter(e => e.airstamp && new Date(e.airstamp).getTime() > now);
    const prev = aired[aired.length - 1] || null;
    const next = future[0] || null;
    if (!prev && !next) return { name: 'DORMANT', prev, next };
    if (prev) {
      const dt = now - new Date(prev.airstamp).getTime();
      if (dt < CFG.LIVE_H * H) return { name: 'LIVE', prev, next };
      if (dt < CFG.FRESH_H * H) return { name: 'FRESH', prev, next };
    }
    if (next) {
      const tt = new Date(next.airstamp).getTime() - now;
      if (tt > CFG.INSEASON_D * DAY) return { name: 'DORMANT', prev, next };
      if (tt < CFG.PRESHOW_H * H) return { name: 'PRE-SHOW', prev, next };
      if (tt < CFG.RAMP_H * H) return { name: 'RAMP', prev, next };
      return { name: 'SETTLED', prev, next };
    }
    const sinceFinale = now - new Date(prev.airstamp).getTime();
    return { name: sinceFinale < CFG.WRAP_D * DAY ? 'SEASON WRAP' : 'DORMANT', prev, next };
  }

  // ── watchMode classifier (per user AND show; ported from the prototype) ────────
  // watchLog: [{ epNum, ts }] for THIS show. opts: { manual, killed }.
  function classify(watchLog, eps, opts) {
    opts = opts || {};
    if (opts.killed) return { mode: 'DECLINED', src: 'off' };
    if (opts.manual) return { mode: opts.manual, src: 'set' };
    if (!watchLog || watchLog.length < 2) return { mode: 'UNSAMPLED', src: 'derived' };
    const deltas = watchLog.map(w => {
      const ep = eps.find(e => e.number === w.epNum);
      return ep && ep.airstamp ? (w.ts - new Date(ep.airstamp).getTime()) / H : null;
    }).filter(v => v !== null);
    const sorted = watchLog.map(w => w.ts).sort((a, b) => a - b);
    let burst = 0;
    for (let i = 2; i < sorted.length; i++) if (sorted[i] - sorted[i - 2] < 24 * H) burst++;
    if (burst > 0) return { mode: 'MORE!', src: 'derived' };
    if (!deltas.length) return { mode: 'UNSAMPLED', src: 'derived' };
    const med = deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
    if (med < CFG.LIVE_H) return { mode: 'LIVE', src: 'derived' };
    if (med < CFG.FRESH_H) return { mode: 'FRESH', src: 'derived' };
    return { mode: 'CASUAL', src: 'derived' };
  }

  // Classify from precomputed watch deltas (hours from air) + the raw watch timestamps.
  // Lets a caller feed cross-season watches (matched by season+number) without the
  // prototype's epNum collision. Same law: burst -> MORE!, else median delta.
  function classifyDeltas(deltaHours, timestamps, opts) {
    opts = opts || {};
    if (opts.killed) return { mode: 'DECLINED', src: 'off' };
    if (opts.manual) return { mode: opts.manual, src: 'set' };
    if (!deltaHours || deltaHours.length < 2) return { mode: 'UNSAMPLED', src: 'derived' };
    const sorted = (timestamps || []).slice().sort((a, b) => a - b);
    let burst = 0;
    for (let i = 2; i < sorted.length; i++) if (sorted[i] - sorted[i - 2] < 24 * H) burst++;
    if (burst > 0) return { mode: 'MORE!', src: 'derived' };
    const med = deltaHours.slice().sort((a, b) => a - b)[Math.floor(deltaHours.length / 2)];
    if (med < CFG.LIVE_H) return { mode: 'LIVE', src: 'derived' };
    if (med < CFG.FRESH_H) return { mode: 'FRESH', src: 'derived' };
    return { mode: 'CASUAL', src: 'derived' };
  }

  // ── nudge law (five rules, one place; ported from the prototype) ───────────────
  function nudge(ph, mode, watchLog, eps, now, seasonNum) {
    now = now || Date.now();
    const S = seasonNum || (eps[0] && eps[0].season) || 1;
    const watched = new Set((watchLog || []).map(w => w.epNum));
    const airedEps = eps.filter(e => e.airstamp && new Date(e.airstamp).getTime() <= now);
    const behind = airedEps.filter(e => !watched.has(e.number));
    if (mode.src === 'off') return { silent: true, why: 'classifier off (two-strike)' };
    if (ph.name === 'SEASON WRAP' && mode.mode === 'MORE!')
      return { silent: false, text: `MORE! is ready. All ${eps.length} episodes.` };
    if (mode.mode === 'UNSAMPLED' || mode.mode === 'DECLINED') return { silent: true, why: `mode ${mode.mode}: silence is default` };
    if (mode.mode === 'MORE!') return { silent: true, why: 'MORE!: silent all season, one message at wrap' };
    if (ph.name !== 'RAMP') return { silent: true, why: `nudges fire only during RAMP (now: ${ph.name})` };
    if (behind.length === 0) {
      const next = ph.next, d = Math.ceil((new Date(next.airstamp).getTime() - now) / DAY);
      return { silent: false, text: `S${S}E${next.number} "${next.name}" ${d <= 1 ? 'drops tonight' : 'in ' + d + ' days'}. You're caught up.` };
    }
    const gap = behind[behind.length - 1], next = ph.next;
    const tt = new Date(next.airstamp).getTime() - now;
    if (mode.mode === 'LIVE' || mode.mode === 'FRESH') {
      if (tt < 24 * H) return { silent: false, text: `You have tonight to watch S${S}E${gap.number} before S${S}E${next.number} drops!` };
      return { silent: false, text: `S${S}E${next.number} drops ${fmtDay(next.airstamp)}. That's your spoiler deadline for S${S}E${gap.number}.` };
    }
    return { silent: false, text: `Heads up: S${S}E${next.number} arrives ${fmtDay(next.airstamp)}. E${gap.number} is waiting whenever you are.` };
  }

  // ── TAG: the airdate relative to today, in local time ──────────────────────────
  // "Today" / "Tomorrow" / weekday ("Sunday") / "Next Week" / "in two weeks" / date.
  const WEEKS = ['', '', 'in two weeks', 'in three weeks', 'in four weeks', 'in five weeks', 'in six weeks'];
  function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function tag(airstamp, now) {
    if (!airstamp) return '';
    now = now || Date.now();
    const days = Math.round((startOfDay(new Date(airstamp).getTime()) - startOfDay(now)) / DAY);
    if (days < 0) return '';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days <= 6) return new Date(airstamp).toLocaleDateString('en-US', { weekday: 'long' });
    if (days <= 13) return 'Next Week';
    if (days <= 41) return WEEKS[Math.floor(days / 7)] || ('in ' + Math.floor(days / 7) + ' weeks');
    return new Date(airstamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // The next episode "coming up": soonest airstamp that is today or later. Drives the
  // TAG and the timely sort. Returns null when nothing is upcoming (dormant/wrapped).
  function nextUp(eps, now) {
    now = now || Date.now();
    const floor = startOfDay(now);
    const up = eps.filter(e => e.airstamp && new Date(e.airstamp).getTime() >= floor)
      .sort((a, b) => new Date(a.airstamp) - new Date(b.airstamp));
    return up[0] || null;
  }
  // Sort key for the WATCH face: soonest upcoming airstamp first; no-upcoming sorts last.
  function sortKey(eps, now) { const n = nextUp(eps, now); return n ? new Date(n.airstamp).getTime() : Infinity; }
  function inSeason(eps, now) { const n = nextUp(eps, now); return !!n && (new Date(n.airstamp).getTime() - (now || Date.now())) <= CFG.INSEASON_D * DAY; }

  function fmtDay(iso) { return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }

  // ── TVMaze airstamps (client-side, CORS-open, no key), cached per session ──────
  const _epCache = new Map();      // tvmazeId -> Promise<episodes[]>
  const _epResolved = new Map();   // tvmazeId -> episodes[] (sync, for render-time reads)
  function tvmazeId(showId) { const m = /(?:^|:)?(?:tvmaze:)?(\d+)$/.exec(String(showId || '')); return (String(showId).indexOf('tmdb:') === 0) ? null : (m ? m[1] : null); }
  function episodes(showId) {
    const id = tvmazeId(showId);
    if (!id) return Promise.resolve([]);   // movies / non-tvmaze have no weekly cycle
    if (_epCache.has(id)) return _epCache.get(id);
    const p = fetch(`https://api.tvmaze.com/shows/${id}?embed=episodes`)
      .then(r => r.ok ? r.json() : null)
      .then(d => (d && d._embedded && d._embedded.episodes) ? d._embedded.episodes.filter(e => e.airstamp) : [])
      .catch(() => [])
      .then(eps => { _epResolved.set(id, eps); return eps; });
    _epCache.set(id, p);
    return p;
  }
  // Synchronous read of already-fetched episodes (render-time). [] until prefetched.
  function epsCached(showId) { const id = tvmazeId(showId); return (id && _epResolved.get(id)) || []; }
  // Fetch episodes for a batch (account shows carry no episode list). Resolves once
  // all are cached, so the caller can re-render with airstamps available.
  function prefetch(showIds) { return Promise.all((showIds || []).map(episodes)); }

  // ── state client (scheduler DB via /scheduler/*, localStorage mirror) ──────────
  // The DB is authoritative once the Worker ships; localStorage keeps the branch
  // preview working meanwhile and caches for instant render.
  const LS = 'pg_sched_state';
  function lsGet() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_) { return {}; } }
  function lsSet(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (_) {} }
  let _state = null;   // { user:{declinedCount,positiveInteraction,globalKill,defaultMode}, modes:{showId:mode} }

  async function load(email) {
    if (_state) return _state;
    const cached = lsGet();
    _state = cached.user ? cached : { user: { declinedCount: 0, positiveInteraction: false, globalKill: false, defaultMode: null }, modes: {} };
    if (email) {
      try {
        const r = await fetch(`${API}/scheduler/state?email=${encodeURIComponent(email)}`);
        if (r.ok) { _state = await r.json(); lsSet(_state); }
      } catch (_) { /* keep the cached/local state */ }
    }
    return _state;
  }
  async function setMode(email, showId, mode) {
    await load(email);
    if (mode == null) delete _state.modes[showId]; else _state.modes[showId] = mode;
    // local two-strike mirror so the kill shows instantly even offline of the Worker
    if (mode === 'DECLINED') { if (!_state.user.positiveInteraction && !_state.user.globalKill) { _state.user.declinedCount++; if (_state.user.declinedCount >= 2) _state.user.globalKill = true; } }
    else if (mode != null) _state.user.positiveInteraction = true;
    lsSet(_state);
    try { const r = await fetch(`${API}/scheduler/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, showId, mode }) });
      if (r.ok) { const d = await r.json(); _state.user = d.user; lsSet(_state); } } catch (_) {}
    return _state;
  }
  async function setDefault(email, mode) { await load(email); _state.user.defaultMode = mode; if (mode != null) _state.user.positiveInteraction = true; lsSet(_state);
    try { await fetch(`${API}/scheduler/default`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mode }) }); } catch (_) {} return _state; }
  async function reenable(email) { await load(email); _state.user.globalKill = false; _state.user.declinedCount = 0; lsSet(_state);
    try { await fetch(`${API}/scheduler/reenable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); } catch (_) {} return _state; }
  async function notify(email, showId, episodeId) { await load(email); _state.user.positiveInteraction = true; lsSet(_state);
    try { await fetch(`${API}/scheduler/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, showId, episodeId }) }); } catch (_) {} return _state; }
  function stateNow() { return _state; }

  // Cycle order for the chip: auto -> LIVE -> FRESH -> CASUAL -> MORE! -> DECLINED -> auto
  function nextInCycle(current) { const order = [null, ...MODES, 'DECLINED']; return order[(order.indexOf(current || null) + 1) % order.length]; }

  // ── tz-safe calendar-day math ─────────────────────────────────────────────────
  // Whole calendar days from local-today to a drop date, computed from the airdate's
  // Y-M-D components as a LOCAL midnight. This deliberately does NOT parse the full
  // ISO string: `new Date('2026-07-30')` is UTC midnight, which reads back as a
  // different calendar day west of Greenwich and is exactly what flipped Today/
  // Tomorrow across zones. Both endpoints here are local midnights, so the diff is a
  // clean integer day count no matter the viewer's zone or the drop's time of day.
  function daysUntil(airdate, now) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(airdate || '')); if (!m) return null;
    const drop = new Date(+m[1], +m[2] - 1, +m[3]).getTime();       // local midnight of the air date
    const n = now ? new Date(now) : new Date();
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    return Math.round((drop - today) / DAY);
  }
  // Weekday name ("Monday") for an airdate, read at that date's LOCAL midnight.
  function weekday(airdate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(airdate || '')); if (!m) return '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'long' });
  }

  window.WoW = {
    CFG, MODES, KILL_MSG,
    phase, classify, classifyDeltas, nudge, tag, nextUp, sortKey, inSeason, episodes, epsCached, prefetch,
    daysUntil, weekday,
    store: { load, setMode, setDefault, reenable, notify, stateNow },
    nextInCycle, fmtDay,
  };
})();
