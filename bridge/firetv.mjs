#!/usr/bin/env node
/**
 * pangolinRC → Fire TV bridge
 *
 * Polls the Cloudflare Worker for remote commands and sends them
 * to the Fire TV Cube via ADB over WiFi.
 *
 * The bridge no longer targets a single hardcoded address. Each polled command
 * carries the ip + model of the member's *selected device* (resolved server-side),
 * so one running bridge follows the device picker. We connect to each ip on demand
 * and pick the control protocol from the model. Fire TV (ADB keyevents) is wired
 * here; other models (e.g. LG webOS / SSAP) are recognised but skipped until their
 * adapter lands.
 *
 * Setup:
 *   1. Fire TV: Settings → My Fire TV → Developer Options → turn ON
 *              "ADB Debugging" and "Network Debugging (ADB over Network)"
 *   2. Fire TV: Settings → My Fire TV → About → Network → note the IP address
 *      (enter it on the Profile face so the server can route to it)
 *   3. Mac: install Android Platform Tools:  brew install android-platform-tools
 *   4. Run this bridge:
 *        node bridge/firetv.mjs
 *      (FIRE_TV_IP is now optional — only a fallback for a command with no ip.)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { sendWebos } from './webos.mjs';

const run = promisify(exec);

const WORKER     = process.env.WORKER_URL  ?? 'https://pangolin-rc.edward-m-willett.workers.dev';
const FALLBACK_IP = process.env.FIRE_TV_IP;   // optional: used only when a command carries no ip
const POLL_MS    = Number(process.env.POLL_MS ?? 150);

// ADB key event codes for Fire TV
const KEYCODES = {
  rw:   89,   // KEYCODE_MEDIA_REWIND
  play: 85,   // KEYCODE_MEDIA_PLAY_PAUSE
  ff:   90,   // KEYCODE_MEDIA_FAST_FORWARD
  back: 4,    // KEYCODE_BACK
};

// Which protocol drives a given device, from its model/type string. Fire TV speaks
// ADB; LG webOS speaks SSAP (a separate adapter, not yet wired). Default to ADB so
// an unlabelled Fire Cube still works.
function protocolFor(model, type) {
  const s = `${model || ''} ${type || ''}`.toLowerCase();
  if (s.includes('lg') || s.includes('webos')) return 'webos';
  if (s.includes('fire') || s.includes('amazon') || s.includes('adb') || !s.trim()) return 'adb';
  return 'adb';
}

async function adb(ip, args) {
  const { stdout } = await run(`adb -s ${ip}:5555 ${args}`);
  return stdout.trim();
}

// Connect to an ip once and remember it, so repeated keypresses don't re-handshake.
// NOTE: `adb connect` exits 0 even when it fails ("failed to connect…" goes to
// stdout) — so success is judged by the output text, never the exit code. A
// failed ip is NOT cached: every later keypress retries and reports, instead of
// dying silently against a connection that never existed.
const connected = new Set();
async function ensureConnected(ip) {
  if (connected.has(ip)) return true;
  try {
    const { stdout } = await run(`adb connect ${ip}:5555`);
    const out = stdout.trim();
    console.log(`[adb] ${out}`);
    if (/failed|refused|unable|cannot/i.test(out)) {
      console.error('      ADB said no — on the device: Settings → My Fire TV → Developer Options → ADB Debugging ON, then accept the debugging prompt on screen.');
      return false;
    }
    connected.add(ip);
    return true;
  } catch (e) {
    console.error(`[adb] connect ${ip} failed: ${e.message}`);
    return false;
  }
}

let lastId = null;

async function poll() {
  try {
    const res  = await fetch(`${WORKER}/remote/cmd`);
    const data = await res.json();
    if (!data.cmd || data.id === lastId) return;
    lastId = data.id;

    const ip = data.ip || FALLBACK_IP;
    if (!ip) { console.warn(`[remote] ${data.cmd}: no ip on command and no FIRE_TV_IP fallback — skipped`); return; }

    const proto = protocolFor(data.model, data.type);

    if (proto === 'webos') {
      try {
        await sendWebos(ip, data.cmd);
        console.log(`[remote] ${data.cmd} → ${ip} (webos) ${data.cmd}`);
      } catch (e) {
        console.error(`[remote] ${data.cmd} → ${ip} (webos) failed: ${e.message}`);
      }
      return;
    }

    const keycode = KEYCODES[data.cmd];
    if (keycode === undefined) return;
    if (!(await ensureConnected(ip))) return;
    try {
      await adb(ip, `shell input keyevent ${keycode}`);
      console.log(`[remote] ${data.cmd} → ${ip} (adb) keyevent ${keycode}`);
    } catch (e) {
      connected.delete(ip);   // stale handshake (reboot, sleep) — retry on the next press
      console.error(`[remote] ${data.cmd} → ${ip} (adb) failed: ${String(e.message).split('\n')[0]}`);
    }
  } catch {
    // network hiccup — next tick retries (and re-handshakes if adb dropped)
  }
}

console.log(`pangolinRC remote bridge`);
console.log(`  Worker  : ${WORKER}`);
console.log(`  Target  : follows the selected device (ip per command)${FALLBACK_IP ? `, fallback ${FALLBACK_IP}` : ''}`);
console.log(`  Poll    : every ${POLL_MS}ms`);
console.log('');

setInterval(poll, POLL_MS);
