import { Hono } from 'hono';
import type { Env } from '../types';

const CMDS = ['rw', 'play', 'ff', 'back'] as const;
type Cmd = typeof CMDS[number];

export const remoteRoutes = new Hono<{ Bindings: Env }>();

// Frontend → POST /remote/cmd/:code
remoteRoutes.post('/cmd/:code', async (c) => {
  const code = c.req.param('code') as Cmd;
  if (!(CMDS as readonly string[]).includes(code))
    return c.json({ error: 'unknown command' }, 400);

  const entry = { cmd: code, id: crypto.randomUUID(), t: Date.now() };
  // KV requires expirationTtl >= 60s. The bridge dedupes by id, so a lingering
  // entry never re-fires; it just self-cleans after a minute.
  await c.env.ACCESS_KV.put('remote:pending', JSON.stringify(entry), { expirationTtl: 60 });
  return c.json({ ok: true, id: entry.id });
});

// Bridge → GET /remote/cmd (polls; returns null cmd when queue empty)
remoteRoutes.get('/cmd', async (c) => {
  const raw = await c.env.ACCESS_KV.get('remote:pending');
  if (!raw) return c.json({ cmd: null });
  return c.json(JSON.parse(raw));
});
