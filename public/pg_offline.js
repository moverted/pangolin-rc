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

  // ── connectivity ────────────────────────────────────────────────────────────
  function isOffline() { return typeof navigator !== 'undefined' && navigator.onLine === false; }
  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](isOffline()); } catch (e) {} } }
  function onChange(cb) { if (typeof cb === 'function') { listeners.push(cb); try { cb(isOffline()); } catch (e) {} } }

  window.addEventListener('offline', emit);
  window.addEventListener('online', function () { emit(); flush(); });

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
    return fetch(op.url, { method: op.method, headers: headers, body: op.body, keepalive: true })
      .then(function (r) {
        // 2xx = done. 4xx = permanent (bad request/duplicate) — drop so we don't loop forever.
        // 5xx / network = keep for retry.
        return r.ok || (r.status >= 400 && r.status < 500);
      })
      .catch(function () { return false; });   // offline / network error → keep
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

  window.pgNet = {
    isOffline: isOffline,
    onChange: onChange,
    queueWrite: queueWrite,
    flush: flush,
    pendingCount: pendingCount,
    onPending: onPending,
    cacheGet: cacheGet,
    cacheSet: cacheSet
  };
})();
