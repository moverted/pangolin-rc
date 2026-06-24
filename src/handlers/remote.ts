import { Hono } from 'hono';
import type { Env } from '../types';

const CMDS = ['rw', 'play', 'ff', 'back'] as const;
type Cmd = typeof CMDS[number];

export const remoteRoutes = new Hono<{ Bindings: Env }>();

// Frontend → POST /remote/cmd/:code  { email }
// The command follows the member's *selected device*. We resolve the target
// server-side from `users.selected_device` (never trust the client for where a
// keypress lands) into the ip + model the bridge needs to drive it. The 'phone'
// sentinel — or a signed-out / deleted device — has no remote to point at, so
// nothing is queued and the caller is told why.
remoteRoutes.post('/cmd/:code', async (c) => {
  const code = c.req.param('code') as Cmd;
  if (!(CMDS as readonly string[]).includes(code))
    return c.json({ error: 'unknown command' }, 400);

  let body: any = {};
  try { body = await c.req.json(); } catch { /* body optional */ }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return c.json({ ok: false, reason: 'no-session' }, 409);

  const user = await c.env.DB
    .prepare('SELECT selected_device FROM users WHERE email = ?')
    .bind(email).first<{ selected_device: string | null }>();
  const sel = user?.selected_device;
  // 'phone' = the phone is the screen; 'none' = watching elsewhere on a screen we
  // can't drive. Both have nothing for the remote to command.
  if (!sel || sel === 'phone' || sel === 'none')
    return c.json({ ok: false, reason: sel === 'none' ? 'none' : 'phone' }, 409);

  const dev = await c.env.DB
    .prepare('SELECT id, ip, model, type FROM devices WHERE user_email = ? AND id = ?')
    .bind(email, sel).first<{ id: string; ip: string | null; model: string | null; type: string | null }>();
  if (!dev) return c.json({ ok: false, reason: 'no-device' }, 409);
  if (!dev.ip) return c.json({ ok: false, reason: 'no-ip' }, 409);

  const entry = {
    cmd: code,
    id: crypto.randomUUID(),
    t: Date.now(),
    deviceId: dev.id,
    ip: dev.ip,
    model: dev.model,
    type: dev.type,
  };
  // KV requires expirationTtl >= 60s. The bridge dedupes by id, so a lingering
  // entry never re-fires; it just self-cleans after a minute.
  await c.env.ACCESS_KV.put('remote:pending', JSON.stringify(entry), { expirationTtl: 60 });
  return c.json({ ok: true, id: entry.id, ip: entry.ip });
});

// Bridge → GET /remote/cmd (polls; returns null cmd when queue empty).
// Payload now carries the target {ip, model, type} so the bridge routes by the
// member's current selection instead of a single hardcoded address.
remoteRoutes.get('/cmd', async (c) => {
  const raw = await c.env.ACCESS_KV.get('remote:pending');
  if (!raw) return c.json({ cmd: null });
  return c.json(JSON.parse(raw));
});
