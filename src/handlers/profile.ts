import { Hono } from 'hono';
import type { Env } from '../types';

// Account + device API. SEAM:identity — email is the key, no auth in this build.
export const profileRoutes = new Hono<{ Bindings: Env }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
const int = (v: unknown, min = -Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.trunc(v)) : null);

// Columns safe to return to the client (never the password salt/hash).
const SAFE = 'email, username, phone, photo_url, created_at, updated_at';

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

// Get a user plus their devices.
profileRoutes.get('/:email', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const user = await c.env.DB.prepare(`SELECT ${SAFE} FROM users WHERE email = ?`).bind(email).first();
  if (!user) return c.json({ error: 'not found' }, 404);
  const devices = await c.env.DB
    .prepare('SELECT id, type, location, ip, model, created_at FROM devices WHERE user_email = ? ORDER BY created_at')
    .bind(email).all();
  return c.json({ user, devices: devices.results || [] });
});

// Add a device to a user.
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
  if (!type) return c.json({ error: 'type required' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare('INSERT INTO devices (id, user_email, type, location, ip, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, email, type, location, ip, model, Date.now()).run();
  return c.json({ device: { id, type, location, ip, model } });
});

// List a user's devices.
profileRoutes.get('/:email/devices', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const devices = await c.env.DB
    .prepare('SELECT id, type, location, ip, model, created_at FROM devices WHERE user_email = ? ORDER BY created_at')
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
    .prepare(`SELECT show_id, show_name, status, watched, last_season, last_number,
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
    `INSERT INTO watch (user_email, show_id, show_name, status, watched, last_season, last_number,
                        last_minute, started_at, episodes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_email, show_id) DO UPDATE SET
       show_name=excluded.show_name, status=excluded.status, watched=excluded.watched,
       last_season=excluded.last_season, last_number=excluded.last_number,
       last_minute=excluded.last_minute, started_at=excluded.started_at,
       episodes=excluded.episodes, updated_at=excluded.updated_at`
  ).bind(email, show_id, show_name, status, watched, last_season, last_number,
         last_minute, started_at, episodes, now).run();
  return c.json({ ok: true });
});

// Remove a tracked show (withdraw).
profileRoutes.delete('/:email/watch/:show_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const show_id = c.req.param('show_id');
  await c.env.DB.prepare('DELETE FROM watch WHERE user_email = ? AND show_id = ?').bind(email, show_id).run();
  return c.json({ ok: true });
});
