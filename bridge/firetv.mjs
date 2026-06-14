#!/usr/bin/env node
/**
 * pangolinRC → Fire TV bridge
 *
 * Polls the Cloudflare Worker for remote commands and sends them
 * to the Fire TV Cube via ADB over WiFi.
 *
 * Setup:
 *   1. Fire TV: Settings → My Fire TV → Developer Options → turn ON
 *              "ADB Debugging" and "Network Debugging (ADB over Network)"
 *   2. Fire TV: Settings → My Fire TV → About → Network → note the IP address
 *   3. Mac: install Android Platform Tools:  brew install android-platform-tools
 *   4. Connect once:  adb connect <IP>:5555   (accept the prompt on TV)
 *   5. Run this bridge:
 *        FIRE_TV_IP=192.168.x.x node bridge/firetv.mjs
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(exec);

const WORKER   = process.env.WORKER_URL  ?? 'https://pangolin-rc.edward-m-willett.workers.dev';
const TV_IP    = process.env.FIRE_TV_IP;
const POLL_MS  = Number(process.env.POLL_MS ?? 150);

if (!TV_IP) {
  console.error('Set FIRE_TV_IP=<your-fire-cube-ip>  e.g.  FIRE_TV_IP=192.168.1.42 node bridge/firetv.mjs');
  process.exit(1);
}

// ADB key event codes for Fire TV
const KEYCODES = {
  rw:   89,   // KEYCODE_MEDIA_REWIND
  play: 85,   // KEYCODE_MEDIA_PLAY_PAUSE
  ff:   90,   // KEYCODE_MEDIA_FAST_FORWARD
  back: 4,    // KEYCODE_BACK
};

async function adb(args) {
  const { stdout } = await run(`adb -s ${TV_IP}:5555 ${args}`);
  return stdout.trim();
}

async function connect() {
  try {
    const out = await run(`adb connect ${TV_IP}:5555`);
    console.log(`[adb] ${out.stdout.trim()}`);
  } catch (e) {
    console.error(`[adb] connect failed: ${e.message}`);
    console.error('      Make sure ADB debugging is on and the Fire TV accepted the connection prompt.');
  }
}

let lastId = null;

async function poll() {
  try {
    const res  = await fetch(`${WORKER}/remote/cmd`);
    const data = await res.json();

    if (data.cmd && data.id !== lastId) {
      lastId = data.id;
      const keycode = KEYCODES[data.cmd];
      if (keycode !== undefined) {
        await adb(`shell input keyevent ${keycode}`);
        console.log(`[remote] ${data.cmd} → keyevent ${keycode}`);
      }
    }
  } catch {
    // network hiccup — try reconnecting adb on next tick
  }
}

console.log(`pangolinRC Fire TV bridge`);
console.log(`  Worker : ${WORKER}`);
console.log(`  Fire TV: ${TV_IP}:5555`);
console.log(`  Poll   : every ${POLL_MS}ms`);
console.log('');

await connect();
setInterval(poll, POLL_MS);
