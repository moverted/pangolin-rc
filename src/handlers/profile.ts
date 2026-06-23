import { Hono } from 'hono';
import type { Env } from '../types';
import { pushWatchRow, deleteWatchRow } from './airtable';

// Account + device API. SEAM:identity — email is the key, no auth in this build.
export const profileRoutes = new Hono<{ Bindings: Env }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
const int = (v: unknown, min = -Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.trunc(v)) : null);

// Columns safe to return to the client (never the password salt/hash).
const SAFE = 'email, username, phone, photo_url, selected_device, created_at, updated_at';

// PBKDF2 password hashing via Web Crypto.
const _enc = new TextEncoder();
const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) || []).map(h => parseInt(h, 16)));
async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', _enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}
async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt.buffer), hash: await derive(password, salt) };
}
async function verifyPassword(password: string, saltHex: string, hashHex: string) {
  return (await derive(password, fromHex(saltHex))) === hashHex;
}

// Upsert a user (signup / login). Email is the key; provided fields overwrite.
profileRoutes.post('/signup', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = str(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);
  const username = str(body.username, 80) || null;
  const phone = str(body.phone, 40) || null;
  const photo_url = str(body.photo_url, 4096) || null;
  const now = Date.now();

  // Member cap. Existing members always get in (returning login). New people
  // beyond the cap go on the waitlist instead of becoming members.
  const MEMBER_CAP = 10;
  const already = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!already) {
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
    if ((countRow?.c ?? 0) >= MEMBER_CAP) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)').bind(email, now).run();
      return c.json({ status: 'waitlist' });
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO users (email, username, phone, photo_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       username   = COALESCE(excluded.username, users.username),
       phone      = COALESCE(excluded.phone, users.phone),
       photo_url  = COALESCE(excluded.photo_url, users.photo_url),
       updated_at = excluded.updated_at`
  ).bind(email, username, phone, photo_url, now, now).run();

  // Set a password only on first signup (never reset an existing one here).
  const password = str(body.password, 200);
  if (password) {
    const cur = await c.env.DB.prepare('SELECT pw_hash FROM users WHERE email = ?').bind(email).first<{ pw_hash: string | null }>();
    if (cur && !cur.pw_hash) {
      const { salt, hash } = await hashPassword(password);
      await c.env.DB.prepare('UPDATE users SET pw_salt = ?, pw_hash = ? WHERE email = ?').bind(salt, hash, email).run();
    }
  }

  const user = await c.env.DB.prepare(`SELECT ${SAFE} FROM users WHERE email = ?`).bind(email).first();
  return c.json({ status: 'member', user });
});

// Verify a returning member's password.
profileRoutes.post('/login', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400); }
  const email = str(body.email, 200).toLowerCase();
  const password = str(body.password, 200);
  const row = await c.env.DB.prepare('SELECT pw_salt, pw_hash FROM users WHERE email = ?').bind(email).first<{ pw_salt: string | null; pw_hash: string | null }>();
  if (!row) return c.json({ ok: false, error: 'no account' }, 404);
  // Legacy accounts with no password set are allowed in (e.g. the demo account).
  const ok = (row.pw_hash && row.pw_salt) ? await verifyPassword(password, row.pw_salt, row.pw_hash) : true;
  if (!ok) return c.json({ ok: false }, 401);
  const user = await c.env.DB.prepare(`SELECT ${SAFE} FROM users WHERE email = ?`).bind(email).first();
  return c.json({ ok: true, user });
});

// Get a user plus their devices. Only supported devices come back in the list
// (unsupported "Other" devices are collected silently to size demand).
profileRoutes.get('/:email', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const user = await c.env.DB.prepare(`SELECT ${SAFE} FROM users WHERE email = ?`).bind(email).first();
  if (!user) return c.json({ error: 'not found' }, 404);
  const devices = await c.env.DB
    .prepare('SELECT id, type, location, ip, model, created_at FROM devices WHERE user_email = ? AND supported = 1 ORDER BY created_at')
    .bind(email).all();
  return c.json({ user, devices: devices.results || [] });
});

// Add a device to a user. `supported` defaults on; Pierre passes supported:false
// for an "Other" device so we keep it on file without showing it in the picker.
profileRoutes.post('/:email/devices', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const exists = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!exists) return c.json({ error: 'unknown user' }, 404);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const type = str(body.type, 60);
  const location = str(body.location, 80);
  const ip = str(body.ip, 64) || null;
  const model = str(body.model, 80) || null;
  const supported = body.supported === false ? 0 : 1;
  if (!type) return c.json({ error: 'type required' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare('INSERT INTO devices (id, user_email, type, location, ip, model, supported, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, email, type, location, ip, model, supported, Date.now()).run();
  return c.json({ device: { id, type, location, ip, model, supported } });
});

// Edit a device: label (location), IP, or the device itself (type/model).
// Only provided fields change; omitted fields are left as-is.
profileRoutes.patch('/:email/devices/:id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const id = c.req.param('id');
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const sets: string[] = [];
  const vals: any[] = [];
  if (body.type !== undefined)     { const t = str(body.type, 60); if (!t) return c.json({ error: 'type required' }, 400); sets.push('type = ?');     vals.push(t); }
  if (body.location !== undefined) { sets.push('location = ?'); vals.push(str(body.location, 80) || null); }
  if (body.ip !== undefined)       { sets.push('ip = ?');       vals.push(str(body.ip, 64) || null); }
  if (body.model !== undefined)    { sets.push('model = ?');    vals.push(str(body.model, 80) || null); }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  vals.push(email, id);
  const res = await c.env.DB
    .prepare(`UPDATE devices SET ${sets.join(', ')} WHERE user_email = ? AND id = ?`)
    .bind(...vals).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  const device = await c.env.DB
    .prepare('SELECT id, type, location, ip, model, created_at FROM devices WHERE user_email = ? AND id = ?')
    .bind(email, id).first();
  return c.json({ device });
});

// Delete a device. If it was the selected one, fall back to This Phone.
profileRoutes.delete('/:email/devices/:id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM devices WHERE user_email = ? AND id = ?').bind(email, id).run();
  await c.env.DB.prepare("UPDATE users SET selected_device = 'phone' WHERE email = ? AND selected_device = ?").bind(email, id).run();
  return c.json({ ok: true });
});

// Point the remote at a device. `device` is a device id or the 'phone' sentinel.
profileRoutes.post('/:email/select', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const device = str(body.device, 64);
  if (!device) return c.json({ error: 'device required' }, 400);
  if (device !== 'phone') {
    const owned = await c.env.DB.prepare('SELECT id FROM devices WHERE user_email = ? AND id = ?').bind(email, device).first();
    if (!owned) return c.json({ error: 'unknown device' }, 404);
  }
  const res = await c.env.DB.prepare('UPDATE users SET selected_device = ? WHERE email = ?').bind(device, email).run();
  if (!res.meta.changes) return c.json({ error: 'unknown user' }, 404);
  return c.json({ ok: true, selected: device });
});

// List a user's (supported) devices.
profileRoutes.get('/:email/devices', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const devices = await c.env.DB
    .prepare('SELECT id, type, location, ip, model, created_at FROM devices WHERE user_email = ? AND supported = 1 ORDER BY created_at')
    .bind(email).all();
  return c.json({ devices: devices.results || [] });
});

// ---- Watch history: tracked shows + per-episode minute progress -----------
// The Log is the single client-side writer; it POSTs one show at a time and
// reads the whole list back on login to rehydrate the member's room.

// List a user's tracked shows (episodes JSON parsed for the client).
profileRoutes.get('/:email/watch', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const rows = await c.env.DB
    .prepare(`SELECT show_id, show_name, kind, status, watched, last_season, last_number,
                     last_minute, started_at, episodes, updated_at
              FROM watch WHERE user_email = ? ORDER BY updated_at DESC`)
    .bind(email).all();
  const shows = (rows.results || []).map((r: any) => ({
    ...r, episodes: r.episodes ? safeParse(r.episodes) : {},
  }));
  return c.json({ shows });
});

// Upsert one tracked show's state (resume position + per-episode detail).
profileRoutes.post('/:email/watch', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const exists = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!exists) return c.json({ error: 'unknown user' }, 404);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const show_id = str(body.show_id, 80);
  if (!show_id) return c.json({ error: 'show_id required' }, 400);
  const show_name = str(body.show_name, 200) || null;
  const kind = str(body.kind, 20) === 'movie' ? 'movie' : 'show';
  const status = str(body.status, 40) || null;
  const watched = int(body.watched, 0) ?? 0;
  const last_season = int(body.last_season);
  const last_number = int(body.last_number);
  const last_minute = int(body.last_minute, 0) ?? 0;
  const started_at = int(body.started_at);
  const episodes = body.episodes == null ? null
    : (typeof body.episodes === 'string' ? body.episodes : JSON.stringify(body.episodes)).slice(0, 100000);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO watch (user_email, show_id, show_name, kind, status, watched, last_season, last_number,
                        last_minute, started_at, episodes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_email, show_id) DO UPDATE SET
       show_name=excluded.show_name, kind=excluded.kind, status=excluded.status, watched=excluded.watched,
       last_season=excluded.last_season, last_number=excluded.last_number,
       last_minute=excluded.last_minute, started_at=excluded.started_at,
       episodes=excluded.episodes, updated_at=excluded.updated_at`
  ).bind(email, show_id, show_name, kind, status, watched, last_season, last_number,
         last_minute, started_at, episodes, now).run();
  // Mirror the write to Airtable (D1 stays source of truth). Fire-and-forget so a
  // slow/failed Airtable call never blocks or breaks the app's own write.
  c.executionCtx.waitUntil(pushWatchRow(c.env, {
    user_email: email, show_id, show_name, kind, status, watched, last_season,
    last_number, last_minute, started_at, episodes, updated_at: now,
  }).catch((e) => console.error('airtable mirror failed', e)));
  return c.json({ ok: true });
});

// Remove a tracked show (withdraw).
profileRoutes.delete('/:email/watch/:show_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const show_id = c.req.param('show_id');
  await c.env.DB.prepare('DELETE FROM watch WHERE user_email = ? AND show_id = ?').bind(email, show_id).run();
  c.executionCtx.waitUntil(deleteWatchRow(c.env, email, show_id).catch((e) => console.error('airtable delete failed', e)));
  return c.json({ ok: true });
});

// ─── Social graph: follows (a mutual pair = a "friend") ──────────────────────

// Who I follow, each flagged friend = they follow me back.
profileRoutes.get('/:email/follows', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const following = await c.env.DB.prepare(
    `SELECT f.followee_email AS email, u.username
       FROM follows f LEFT JOIN users u ON u.email = f.followee_email
      WHERE f.follower_email = ? ORDER BY f.created_at DESC`).bind(email).all();
  const followers = await c.env.DB
    .prepare('SELECT follower_email AS email FROM follows WHERE followee_email = ?').bind(email).all();
  const back = new Set((followers.results || []).map((r: any) => r.email));
  const out = (following.results || []).map((r: any) => ({
    email: r.email, username: r.username || null, friend: back.has(r.email),
  }));
  return c.json({ following: out, friends: out.filter((x: any) => x.friend) });
});

// Follow a member by email (idempotent). Target must be an existing member.
profileRoutes.post('/:email/follow', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const target = String(body.target || '').toLowerCase().trim();
  if (!EMAIL_RE.test(target)) return c.json({ error: 'valid target email required' }, 400);
  if (target === email) return c.json({ error: "can't follow yourself" }, 400);
  const exists = await c.env.DB.prepare('SELECT email, username FROM users WHERE email = ?').bind(target).first<any>();
  if (!exists) return c.json({ error: 'no such member' }, 404);
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO follows (follower_email, followee_email, created_at) VALUES (?, ?, ?)')
    .bind(email, target, Date.now()).run();
  const reciprocal = await c.env.DB
    .prepare('SELECT 1 FROM follows WHERE follower_email = ? AND followee_email = ?').bind(target, email).first();
  return c.json({ ok: true, target, username: exists.username || null, friend: !!reciprocal });
});

// Unfollow.
profileRoutes.delete('/:email/follow/:target', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const target = c.req.param('target').toLowerCase();
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_email = ? AND followee_email = ?')
    .bind(email, target).run();
  return c.json({ ok: true });
});

// Aggregated activity feed: the member's own activity + everyone they follow,
// newest first, each row tagged actor + relationship (self / friend / following).
profileRoutes.get('/:email/feed', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const following = await c.env.DB
    .prepare('SELECT followee_email AS e FROM follows WHERE follower_email = ?').bind(email).all();
  const followers = await c.env.DB
    .prepare('SELECT follower_email AS e FROM follows WHERE followee_email = ?').bind(email).all();
  const followees = (following.results || []).map((r: any) => r.e);
  const back = new Set((followers.results || []).map((r: any) => r.e));
  const actors = [email, ...followees];
  const placeholders = actors.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(
    `SELECT w.user_email, w.show_id, w.show_name, w.kind, w.status, w.last_season, w.last_number, w.updated_at, u.username
       FROM watch w LEFT JOIN users u ON u.email = w.user_email
      WHERE w.user_email IN (${placeholders})
      ORDER BY w.updated_at DESC LIMIT 40`).bind(...actors).all();
  const feed = (rows.results || []).map((r: any) => ({
    actor_email: r.user_email,
    actor: r.username || null,
    relationship: r.user_email === email ? 'self' : (back.has(r.user_email) ? 'friend' : 'following'),
    show_id: r.show_id, show_name: r.show_name, kind: r.kind || 'show', status: r.status,
    last_season: r.last_season, last_number: r.last_number, updated_at: r.updated_at,
  }));
  return c.json({ feed });
});
