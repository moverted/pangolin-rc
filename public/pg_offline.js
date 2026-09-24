/* pg_offline.js — shared offline backbone for pangolinRC (classic script, window.pgNet).
 *
 * Purpose: let the app keep working with the network off. Two jobs:
 *   1) Connectivity truth + events, so any face/shell can react (plane over Pierre,
 *      the first-open explainer, disabling the mic).
 *   2) A durable write OUTBOX: writes that can't reach the Worker are persisted locally
 *      (IndexedDB, with a localStorage fallback) and replayed, in order, when we reconnect.
 *
 * Same-origin note: every face is an iframe on the same origin as the shell, so they all
 * share ONE IndexedDB. Any online context may flush; the server is expected to dedupe by the
 * per-op client id (sent as the `X-PG-Op-Id` header), so a double-send is harmless.
 *
 * This file is intentionally dependency-free and build-step-free, matching the rest of public/.
 */
(function () {
  'use strict';
  if (window.pgNet) return;   // singleton per document

  var DB_NAME = 'pg_offline';
  var STORE = 'outbox';
  var CACHE_PREFIX = 'pgcache_';
  var listeners = [];
  var flushing = false;

  // ── connectivity (reachability-based, not navigator.onLine) ───────────────────
  // navigator.onLine reports "connected" on airline WiFi even when it's throttled to death or
  // behind a captive portal — which is exactly when the app would hang trying to reach the
  // server (the "Disney+ won't show my downloads on the plane" problem). So the source of truth
  // is a fast PROBE of our own /ping: if it doesn't answer with our marker inside the timeout,
  // we treat the app as OFFLINE (airplane mode), regardless of what the WiFi switch says.
  function apiBase() {
    return (typeof location !== 'undefined' && location.protocol === 'http:' && location.hostname === 'localhost')
      ? 'http://localhost:8787'
      : 'https://pangolin-rc.edward-m-willett.workers.dev';
  }
  var PROBE_URL = apiBase() + '/ping';
  var PROBE_TIMEOUT = 2500;      // a throttled plane WiFi must not stall us longer than this
  var PROBE_EVERY = 20000;       // re-check cadence while the app is visible
  var _reachable = null;         // null = not yet probed
  var _probing = false;
  // Effective offline = the OS says offline, OR our server isn't actually reachable.
  var _eff = (typeof navigator !== 'undefined' && navigator.onLine === false);
  var _dispatching = false;

  function isOffline() { return _eff; }
  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](_eff); } catch (e) {} } }
  function onChange(cb) { if (typeof cb === 'function') { listeners.push(cb); try { cb(_eff); } catch (e) {} } }

  function computeEff() { return (typeof navigator !== 'undefined' && navigator.onLine === false) || _reachable === false; }
  function applyEff() {
    var eff = computeEff();
    if (eff === _eff) return;
    _eff = eff;
    // Drive the same window online/offline events the faces/shell already listen to, so all the
    // airplane UI (plane, explainer, tab gating, mic, cached reads) reacts. Guarded so our own
    // dispatch doesn't recurse into the probe listeners below.
    _dispatching = true;
    try { window.dispatchEvent(new Event(eff ? 'offline' : 'online')); } catch (e) {}
    _dispatching = false;
    emit();
    if (!eff) flush();           // genuinely back online → replay the outbox
  }
  function probe() {
    if (_probing) return Promise.resolve();
    _probing = true;
    var done = function (ok) { _reachable = ok; _probing = false; applyEff(); };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { done(false); return Promise.resolve(); }
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, PROBE_TIMEOUT);
    return fetch(PROBE_URL, { method: 'GET', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { clearTimeout(to); done(!!(j && j.pg === 1)); })   // marker present → truly reachable
      .catch(function () { clearTimeout(to); done(false); });                // timeout / error / captive portal
  }

  // Re-probe on the OS hints, on resume, and on a gentle interval while visible.
  window.addEventListener('offline', function () { if (!_dispatching) applyEff(); });   // OS offline ⇒ definitely offline
  window.addEventListener('online', function () { if (!_dispatching) probe(); });        // OS online ⇒ verify it's real
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') probe(); });
  }
  setInterval(function () { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') probe(); }, PROBE_EVERY);
  probe();   // initial reachability check

  // ── tiny read cache (last-good server reads, so faces render offline) ─────────
  function cacheSet(key, val) { try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(val)); } catch (e) {} }
  function cacheGet(key, dflt) {
    try { var v = localStorage.getItem(CACHE_PREFIX + key); return v == null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  }

  // ── durable queue (IndexedDB, localStorage fallback) ──────────────────────────
  var idb = null, idbReady = null;
  function openDB() {
    if (idbReady) return idbReady;
    idbReady = new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { idb = req.result; resolve(idb); };
      req.onerror = function () { resolve(null); };   // fall back to localStorage
    });
    return idbReady;
  }

  var LS_KEY = 'pg_outbox_fallback';
  function lsAll() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } }
  function lsWrite(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) {} }

  function putOp(op) {
    return openDB().then(function (db) {
      if (!db) { var l = lsAll(); l.push(op); lsWrite(l); return; }
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(op);
        tx.oncomplete = res; tx.onerror = res;
      });
    });
  }
  function delOp(id) {
    return openDB().then(function (db) {
      if (!db) { lsWrite(lsAll().filter(function (o) { return o.id !== id; })); return; }
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id);
        tx.oncomplete = res; tx.onerror = res;
      });
    });
  }
  function allOps() {
    return openDB().then(function (db) {
      if (!db) return lsAll();
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readonly'); var rq = tx.objectStore(STORE).getAll();
        rq.onsuccess = function () { res(rq.result || []); }; rq.onerror = function () { res([]); };
      });
    });
  }
  function pendingCount() { return allOps().then(function (o) { return o.length; }); }

  function uuid() {
    return (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  // ── the write path ────────────────────────────────────────────────────────────
  // queueWrite(url, { method, body(object|string), headers, kind }): try to send now;
  // if offline or the send fails at the network layer, persist and replay later. Returns
  // { id, queued }. `kind` is a free tag for optimistic-UI/debugging. Callers should update
  // their local/cached state optimistically regardless of queued vs. sent.
  function queueWrite(url, opts) {
    opts = opts || {};
    var op = {
      id: uuid(),
      url: url,
      method: (opts.method || 'POST').toUpperCase(),
      headers: opts.headers || { 'Content-Type': 'application/json' },
      body: typeof opts.body === 'string' ? opts.body : (opts.body != null ? JSON.stringify(opts.body) : undefined),
      kind: opts.kind || '',
      ts: Date.now(),
      tries: 0
    };
    if (isOffline()) return putOp(op).then(function () { emitPending(); return { id: op.id, queued: true }; });
    // Online: attempt immediately; on a network failure, fall back to the queue.
    return sendOp(op).then(function (ok) {
      if (ok) return { id: op.id, queued: false };
      return putOp(op).then(function () { emitPending(); return { id: op.id, queued: true }; });
    });
  }

  function sendOp(op) {
    var headers = Object.assign({}, op.headers, { 'X-PG-Op-Id': op.id });
    // Bound the send so throttled WiFi can't leave a replay hanging; a timeout just means "keep".
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, 8000);
    return fetch(op.url, { method: op.method, headers: headers, body: op.body, keepalive: true, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        // 2xx = done. 4xx = permanent (bad request/duplicate) — drop so we don't loop forever.
        // 5xx / network = keep for retry.
        return r.ok || (r.status >= 400 && r.status < 500);
      })
      .catch(function () { return false; })     // offline / network error / timeout → keep
      .then(function (v) { clearTimeout(to); return v; });
  }

  var pendingListeners = [];
  function onPending(cb) { if (typeof cb === 'function') { pendingListeners.push(cb); pendingCount().then(function (n) { try { cb(n); } catch (e) {} }); } }
  function emitPending() { pendingCount().then(function (n) { for (var i = 0; i < pendingListeners.length; i++) { try { pendingListeners[i](n); } catch (e) {} } }); }

  // Replay the queue oldest-first. Idempotent per op id server-side, so safe to run from any
  // context and safe to run twice. Stops at the first still-failing op to preserve order.
  function flush() {
    if (flushing || isOffline()) return Promise.resolve();
    flushing = true;
    return allOps().then(function (ops) {
      ops.sort(function (a, b) { return a.ts - b.ts; });
      var i = 0;
      function step() {
        if (i >= ops.length) return Promise.resolve();
        var op = ops[i++];
        return sendOp(op).then(function (ok) {
          if (ok) return delOp(op.id).then(step);
          return Promise.resolve();   // still failing: keep it (and its successors) for next time
        });
      }
      return step();
    }).then(function () { flushing = false; emitPending(); }, function () { flushing = false; });
  }

  // Kick a flush on load in case ops were left from a previous session.
  if (!isOffline()) setTimeout(flush, 1500);

  // Timeout-bounded fetch so a face's read can never hang the screen on throttled WiFi — it
  // rejects after `ms` and the caller falls back to cache. Default 7s.
  function fetchTimed(url, opts, ms) {
    opts = opts || {};
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (ctrl) opts.signal = ctrl.signal;
    var to = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, ms || 7000);
    return fetch(url, opts).then(
      function (r) { clearTimeout(to); return r; },
      function (e) { clearTimeout(to); throw e; }
    );
  }

  window.pgNet = {
    isOffline: isOffline,
    probe: probe,
    onChange: onChange,
    queueWrite: queueWrite,
    flush: flush,
    fetchTimed: fetchTimed,
    pendingCount: pendingCount,
    onPending: onPending,
    cacheGet: cacheGet,
    cacheSet: cacheSet
  };
})();
