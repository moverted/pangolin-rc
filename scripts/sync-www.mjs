#!/usr/bin/env node
// sync-www — copy the deployed static site (public/) into www/ for Capacitor.
// Per capacitor-integration-spec.md: the "build step" is a file copy, nothing more.
// The web codebase stays native ES modules; no bundler, ever.
//
// Usage: node scripts/sync-www.mjs
//
// Excluded from the app bundle:
//   _redirects  — Cloudflare Pages routing config, meaningless inside the app.

import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'public');
const dest = path.join(root, 'www');

const EXCLUDE = new Set(['_redirects']);

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

let copied = 0;
for (const entry of await readdir(src)) {
  if (EXCLUDE.has(entry)) continue;
  await cp(path.join(src, entry), path.join(dest, entry), { recursive: true });
  copied++;
}

// sanity: the files the cube cannot boot without
const required = [
  'index.html', 'cube_shell.js', 'clickwheel.js',
  'cube_feed_face.html', 'cube_watch_face.html', 'cube_pierre_face.html',
  'cube_profile_face.html', 'cube_log_face.html', 'cube_browse_face.html',
];
const missing = [];
for (const f of required) {
  try { await stat(path.join(dest, f)); } catch { missing.push(f); }
}
if (missing.length) {
  console.error(`sync-www: MISSING required files in www/: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`sync-www: copied ${copied} entries from public/ to www/ — all ${required.length} required files present.`);
