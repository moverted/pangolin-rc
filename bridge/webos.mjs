/**
 * pangolinRC → LG webOS (SSAP) adapter
 *
 * The Fire path drives the TV with ADB keyevents; LG webOS TVs speak SSAP, a
 * JSON protocol over a WebSocket on :3000. This module mirrors firetv.mjs's
 * shape — a per-ip cached connection plus a `sendWebos(ip, cmd)` entry point —
 * so the bridge can route to either kind of device from the same command queue.
 *
 * Pairing: the first connection to a TV pops an "accept" prompt on screen; the
 * TV then returns a client-key we persist (bridge/.webos-keys.json, gitignored)
 * and replay on every later connect, so you're prompted exactly once per TV.
 *
 * Buttons go through the pointer input socket — the same path the physical
 * remote uses — which (unlike ssap://media.controls) can also send BACK.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KEY_STORE = join(dirname(fileURLToPath(import.meta.url)), '.webos-keys.json');

// Our four commands → pointer-socket button names. webOS has no play/pause
// *toggle*, so `play` sends PLAY; a dedicated pause would be a separate button
// if the lower-third grows one.
const BUTTONS = { rw: 'REWIND', ff: 'FASTFORWARD', back: 'BACK', play: 'PLAY' };

const REGISTER_TIMEOUT_MS = 60_000;   // long enough to walk over and accept the prompt
const REQUEST_TIMEOUT_MS  = 8_000;

// Minimal SSAP registration manifest. forcePairing:false + a stored client-key
// makes reconnects silent; the first connect (no key) raises the on-screen prompt.
const MANIFEST = {
  manifestVersion: 1,
  permissions: [
    'CONTROL_INPUT_MEDIA_PLAYBACK',
    'CONTROL_INPUT_TV',
    'CONTROL_INPUT_JOYSTICK',
    'CONTROL_POWER',
    'READ_INSTALLED_APPS',
    'CONTROL_DISPLAY',
    'CONTROL_AUDIO',
  ],
};

async function loadKeys() {
  try { return JSON.parse(await readFile(KEY_STORE, 'utf8')); } catch { return {}; }
}
async function saveKey(ip, key) {
  const keys = await loadKeys();
  keys[ip] = key;
  await writeFile(KEY_STORE, JSON.stringify(keys, null, 2));
}

// One in-flight/established connection per ip. Dropped from the map on close or
// error so the next keypress reconnects cleanly.
const conns = new Map();

function connect(ip) {
  const p = (async () => {
    const stored = (await loadKeys())[ip];
    const ws = new WebSocket(`ws://${ip}:3000`);
    const pending = new Map();   // request id → { resolve, reject }
    let msgId = 0;

    const fail = (err) => {
      for (const { reject } of pending.values()) reject(err);
      pending.clear();
      conns.delete(ip);
      try { ws.close(); } catch {}
    };
    ws.addEventListener('close', () => fail(new Error('webos socket closed')));
    ws.addEventListener('error', () => fail(new Error('webos socket error')));

    const request = (uri, payload) => {
      const id = `req_${++msgId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`webos request timeout: ${uri}`)); }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        ws.send(JSON.stringify({ type: 'request', id, uri, ...(payload ? { payload } : {}) }));
      });
    };

    // Open + register (resolves once the TV says we're paired).
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('webos registration timeout — was the on-screen prompt accepted?')), REGISTER_TIMEOUT_MS);
      ws.addEventListener('open', () => {
        const payload = { forcePairing: false, pairingType: 'PROMPT', manifest: MANIFEST };
        if (stored) payload['client-key'] = stored;
        ws.send(JSON.stringify({ type: 'register', id: 'register_0', payload }));
      });
      ws.addEventListener('message', async (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        // Correlated request responses.
        if (msg.id && pending.has(msg.id)) {
          const { resolve: res, reject: rej } = pending.get(msg.id);
          pending.delete(msg.id);
          msg.type === 'error' ? rej(new Error(msg.error || 'webos error')) : res(msg.payload || {});
          return;
        }
        if (msg.id === 'register_0') {
          if (msg.type === 'registered') {
            const key = msg.payload && msg.payload['client-key'];
            if (key && key !== stored) { try { await saveKey(ip, key); } catch {} }
            clearTimeout(timer); resolve();
          } else if (msg.type === 'response' && msg.payload && msg.payload.pairingType === 'PROMPT') {
            console.log(`[webos] ${ip}: accept the pairing prompt on the TV…`);   // first connect only
          } else if (msg.type === 'error') {
            clearTimeout(timer); reject(new Error(msg.error || 'webos registration error'));
          }
        }
      });
    });

    // Open the pointer input socket — buttons are sent as plain `key:value` lines.
    const { socketPath } = await request('ssap://com.webos.service.networkinput/getPointerInputSocket');
    if (!socketPath) throw new Error('webos: no pointer socketPath');
    const pointer = new WebSocket(socketPath);
    pointer.addEventListener('close', () => fail(new Error('webos pointer closed')));
    pointer.addEventListener('error', () => fail(new Error('webos pointer error')));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('webos pointer timeout')), REQUEST_TIMEOUT_MS);
      pointer.addEventListener('open', () => { clearTimeout(timer); resolve(); });
    });

    const sendButton = (name) => pointer.send(`type:button\nname:${name}\n\n`);
    return { ws, pointer, sendButton };
  })();

  conns.set(ip, p);
  p.catch(() => conns.delete(ip));   // don't cache a rejected connect
  return p;
}

function getConn(ip) {
  return conns.get(ip) ?? connect(ip);
}

// Drive an LG webOS TV. Throws on connect/pairing/transport failure so the bridge
// can log it; the connection is cached and reused across presses.
export async function sendWebos(ip, cmd) {
  const button = BUTTONS[cmd];
  if (!button) throw new Error(`webos: unmapped command ${cmd}`);
  const conn = await getConn(ip);
  conn.sendButton(button);
}
