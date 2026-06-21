import { Hono } from 'hono';
import type { Env } from '../types';

// Crowd-sourced "where is this watched" guess. One latest value per show, kept in
// KV. Reading it gives the default best-guess for a viewer who hasn't set their own
// streamer; writing it (when a viewer SETs the wheel) updates the guess only for
// people who load the show AFTER them. Active sessions resolve the guess once at
// load and never re-poll, so a write never disturbs someone already watching.
export const streamerRoutes = new Hono<{ Bindings: Env }>();

const KEY = (id: string) => `streamer:${id}`;
const clean = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 60) : '');

// Latest crowd pick for a show (null if nobody has set one yet).
streamerRoutes.get('/:showId', async (c) => {
  const id = clean(c.req.param('showId'));
  if (!id) return c.json({ service: null });
  const raw = await c.env.ACCESS_KV.get(KEY(id));
  if (!raw) return c.json({ service: null });
  try { const v = JSON.parse(raw); return c.json({ service: v.service || null, ts: v.ts || null }); }
  catch { return c.json({ service: null }); }
});

// A viewer SETs where they watch → becomes the next viewer's default guess.
streamerRoutes.post('/:showId', async (c) => {
  const id = clean(c.req.param('showId'));
  if (!id) return c.json({ error: 'show id required' }, 400);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const service = clean(body.service);
  if (!service) return c.json({ error: 'service required' }, 400);
  await c.env.ACCESS_KV.put(KEY(id), JSON.stringify({ service, ts: Date.now() }));
  return c.json({ ok: true });
});
