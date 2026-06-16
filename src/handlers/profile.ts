import { Hono } from 'hono';
import type { Env } from '../types';

// Account + device API. SEAM:identity — email is the key, no auth in this build.
export const profileRoutes = new Hono<{ Bindings: Env }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

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
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  return c.json({ status: 'member', user });
});

// Get a user plus their devices.
profileRoutes.get('/:email', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
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
