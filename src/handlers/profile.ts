import { Hono } from 'hono';
import type { Env } from '../types';
import { pushRow, pushRows, deleteRow } from './airtable';

// Account + device API. SEAM:identity — email is the key, no auth in this build.
export const profileRoutes = new Hono<{ Bindings: Env }>();

// Mirror a D1 write to Airtable, fire-and-forget — never blocks the app's write.
const mirror = (c: any, table: string, row: Record<string, any>) =>
  c.executionCtx.waitUntil(pushRow(c.env, table, row).catch((e: unknown) => console.error('airtable mirror', table, e)));
const unmirror = (c: any, table: string, key: string) =>
  c.executionCtx.waitUntil(deleteRow(c.env, table, key).catch((e: unknown) => console.error('airtable unmirror', table, e)));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
const int = (v: unknown, min = -Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.trunc(v)) : null);

// Columns safe to return to the client (never the password salt/hash).
const SAFE = 'email, username, phone, photo_url, selected_device, timezone, user_type, founding_member, created_at, updated_at';

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
  const timezone = str(body.timezone, 64) || null;   // IANA tz from the browser
  const now = Date.now();

  // Member cap. Existing members always get in (returning login). New people
  // beyond the cap go on the waitlist instead of becoming members.
  const MEMBER_CAP = 10;
  const already = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!already) {
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
    if ((countRow?.c ?? 0) >= MEMBER_CAP) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)').bind(email, now).run();
      mirror(c, 'waitlist', { email, created_at: now });
      return c.json({ status: 'waitlist' });
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO users (email, username, phone, photo_url, timezone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       username   = COALESCE(excluded.username, users.username),
       phone      = COALESCE(excluded.phone, users.phone),
       photo_url  = COALESCE(excluded.photo_url, users.photo_url),
       timezone   = COALESCE(excluded.timezone, users.timezone),
       updated_at = excluded.updated_at`
  ).bind(email, username, phone, photo_url, timezone, now, now).run();

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
  if (user) mirror(c, 'users', user as Record<string, any>);   // SAFE == the synced users cols (no salt/hash)
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
  const now = Date.now();
  await c.env.DB
    .prepare('INSERT INTO devices (id, user_email, type, location, ip, model, supported, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, email, type, location, ip, model, supported, now).run();
  mirror(c, 'devices', { id, user_email: email, type, location, ip, model, supported, created_at: now });
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
    .prepare('SELECT id, user_email, type, location, ip, model, supported, created_at FROM devices WHERE user_email = ? AND id = ?')
    .bind(email, id).first();
  if (device) mirror(c, 'devices', device as Record<string, any>);
  return c.json({ device });
});

// Delete a device. If it was the selected one, fall back to This Phone.
profileRoutes.delete('/:email/devices/:id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM devices WHERE user_email = ? AND id = ?').bind(email, id).run();
  await c.env.DB.prepare("UPDATE users SET selected_device = 'phone' WHERE email = ? AND selected_device = ?").bind(email, id).run();
  unmirror(c, 'devices', id);
  const user = await c.env.DB.prepare(`SELECT ${SAFE} FROM users WHERE email = ?`).bind(email).first();
  if (user) mirror(c, 'users', user as Record<string, any>);   // selected_device may have reset to 'phone'
  return c.json({ ok: true });
});

// Point the remote at a device. `device` is a device id or the 'phone' sentinel.
profileRoutes.post('/:email/select', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const device = str(body.device, 64);
  if (!device) return c.json({ error: 'device required' }, 400);
  // 'phone' (this device is the screen) and 'none' (off-phone, nothing to drive)
  // are sentinels; anything else must be a device the member owns.
  if (device !== 'phone' && device !== 'none') {
    const owned = await c.env.DB.prepare('SELECT id FROM devices WHERE user_email = ? AND id = ?').bind(email, device).first();
    if (!owned) return c.json({ error: 'unknown device' }, 404);
  }
  const res = await c.env.DB.prepare('UPDATE users SET selected_device = ? WHERE email = ?').bind(device, email).run();
  if (!res.meta.changes) return c.json({ error: 'unknown user' }, 404);
  const user = await c.env.DB.prepare(`SELECT ${SAFE} FROM users WHERE email = ?`).bind(email).first();
  if (user) mirror(c, 'users', user as Record<string, any>);
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

// ---- Watch state: per-user progress over the shared catalog ----------------
// The unit is the episode (or movie). watch_title holds the Log bucket + resume
// pointer; watch_episode holds per-episode progress. Materialization lives in
// /catalog/initiate; these endpoints read and update progress.

const MANUAL = new Set(['stopped', 'comfort']);   // buckets the auto-recompute leaves alone

// Recompute watch_title.status + resume pointer from the episode rows, unless the
// member set a manual bucket (stopped/comfort). Mirrors the client's bucketOf.
async function recomputeTitle(env: Env, email: string, titleId: string): Promise<{ status: string; current: string | null } | null> {
  const t = await env.DB.prepare('SELECT status, total_episodes FROM titles WHERE title_id = ?').bind(titleId).first<any>();
  const wt = await env.DB.prepare('SELECT status FROM watch_title WHERE user_email = ? AND title_id = ?').bind(email, titleId).first<any>();
  if (!t || !wt) return null;
  const total = t.total_episodes || 0;
  const watched = (await env.DB.prepare('SELECT COUNT(*) AS c FROM watch_episode WHERE user_email=? AND title_id=? AND done=1').bind(email, titleId).first<{ c: number }>())?.c ?? 0;
  const released = (await env.DB.prepare("SELECT COUNT(*) AS c FROM episodes WHERE title_id=? AND airdate IS NOT NULL AND airdate <= date('now')").bind(titleId).first<{ c: number }>())?.c ?? 0;
  // First not-done episode in air order = the resume pointer (else the finale).
  const cur = await env.DB.prepare('SELECT e.episode_id FROM episodes e LEFT JOIN watch_episode we ON we.user_email=? AND we.episode_id=e.episode_id WHERE e.title_id=? AND COALESCE(we.done,0)=0 ORDER BY e.season, e.number LIMIT 1').bind(email, titleId).first<{ episode_id: string }>();
  const last = await env.DB.prepare('SELECT episode_id FROM episodes WHERE title_id=? ORDER BY season DESC, number DESC LIMIT 1').bind(titleId).first<{ episode_id: string }>();
  const current = cur?.episode_id ?? last?.episode_id ?? null;

  let status = wt.status as string;
  if (!MANUAL.has(status)) {
    const ended = t.status === 'Ended' || t.status === 'Canceled' || t.status === 'Film';
    if (watched >= total && total > 0) status = 'completed';
    else if (watched < released) status = 'current';
    else status = ended ? 'completed' : 'returning';
  }
  const now = Date.now();
  await env.DB.prepare('UPDATE watch_title SET status=?, current_episode_id=?, updated_at=? WHERE user_email=? AND title_id=?')
    .bind(status, current, now, email, titleId).run();
  return { status, current };
}

// List a member's tracked titles for the Log, with derived counts.
profileRoutes.get('/:email/titles', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const rows = await c.env.DB.prepare(
    `SELECT wt.title_id, t.name, t.kind, t.status AS title_status, t.poster, t.platform,
            t.premiered, t.total_episodes AS total, wt.status, wt.active_map_id,
            wt.current_episode_id, wt.started_at, wt.updated_at,
            (SELECT COUNT(*) FROM watch_episode we WHERE we.user_email=wt.user_email AND we.title_id=wt.title_id AND we.done=1) AS watched,
            (SELECT COUNT(*) FROM episodes e WHERE e.title_id=wt.title_id AND e.airdate IS NOT NULL AND e.airdate <= date('now')) AS released,
            (SELECT e.season FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND we.done=1 ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_season,
            (SELECT e.number FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND we.done=1 ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_number
       FROM watch_title wt JOIN titles t ON t.title_id = wt.title_id
      WHERE wt.user_email = ? ORDER BY wt.updated_at DESC`).bind(email).all();
  return c.json({ titles: rows.results || [] });
});

// One title's full detail for the episode face: catalog episodes merged with the
// member's per-episode progress.
profileRoutes.get('/:email/titles/:title_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  const title = await c.env.DB.prepare('SELECT * FROM titles WHERE title_id = ?').bind(titleId).first();
  if (!title) return c.json({ error: 'not found' }, 404);
  const watch_title = await c.env.DB.prepare('SELECT * FROM watch_title WHERE user_email=? AND title_id=?').bind(email, titleId).first();
  const eps = await c.env.DB.prepare(
    `SELECT e.episode_id, e.season, e.number, e.name, e.runtime, e.airdate, e.next_episode_id,
            COALESCE(we.done,0) AS done, COALESCE(we.minute,0) AS minute, COALESCE(we.bp,0) AS bp, we.sessions
       FROM episodes e LEFT JOIN watch_episode we ON we.user_email=? AND we.episode_id=e.episode_id
      WHERE e.title_id=? ORDER BY e.season, e.number`).bind(email, titleId).all();
  const episodes = (eps.results || []).map((r: any) => ({ ...r, sessions: r.sessions ? safeParse(r.sessions) : [] }));
  return c.json({ title, watch_title, episodes });
});

// The member's emergent PATH through a title: watched episodes in the order they
// were actually finished (latest session finishTs), not air order.
profileRoutes.get('/:email/titles/:title_id/path', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  const rows = await c.env.DB.prepare(
    `SELECT e.episode_id, e.season, e.number, e.name, we.sessions, we.updated_at
       FROM watch_episode we JOIN episodes e ON e.episode_id = we.episode_id
      WHERE we.user_email=? AND we.title_id=? AND we.done=1`).bind(email, titleId).all();
  const lastFinish = (s: string | null, fallback: number) => {
    const arr = s ? safeParse(s) : [];
    let m = 0; if (Array.isArray(arr)) for (const v of arr) if (v && typeof v.finishTs === 'number' && v.finishTs > m) m = v.finishTs;
    return m || fallback;
  };
  const path = (rows.results || [])
    .map((r: any) => ({ episode_id: r.episode_id, season: r.season, number: r.number, name: r.name, at: lastFinish(r.sessions, r.updated_at) }))
    .sort((a, b) => a.at - b.at);
  return c.json({ path });
});

// Upsert one episode's progress, then recompute the title's bucket + resume pointer.
profileRoutes.post('/:email/episodes/:episode_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const episode_id = c.req.param('episode_id');
  const exists = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!exists) return c.json({ error: 'unknown user' }, 404);
  const ep = await c.env.DB.prepare(
    `SELECT e.title_id, e.name AS episode_name, t.name AS show_name
       FROM episodes e JOIN titles t ON t.title_id = e.title_id WHERE e.episode_id = ?`
  ).bind(episode_id).first<{ title_id: string; episode_name: string | null; show_name: string | null }>();
  if (!ep) return c.json({ error: 'unknown episode' }, 404);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const done = body.done ? 1 : 0;
  const minute = int(body.minute, 0) ?? 0;
  const bp = body.bp ? 1 : 0;
  const sessions = body.sessions == null ? null
    : (typeof body.sessions === 'string' ? body.sessions : JSON.stringify(body.sessions)).slice(0, 100000);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO watch_episode (user_email, episode_id, title_id, show_name, episode_name, done, minute, bp, sessions, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_email, episode_id) DO UPDATE SET
       done=excluded.done, minute=excluded.minute, bp=excluded.bp, sessions=excluded.sessions, updated_at=excluded.updated_at,
       show_name=excluded.show_name, episode_name=excluded.episode_name`
  ).bind(email, episode_id, ep.title_id, ep.show_name, ep.episode_name, done, minute, bp, sessions, now).run();
  const recomputed = await recomputeTitle(c.env, email, ep.title_id);
  mirror(c, 'watch_episode', { user_email: email, episode_id, title_id: ep.title_id,
    show_name: ep.show_name, episode_name: ep.episode_name, done, minute, bp, sessions, updated_at: now });
  if (recomputed) mirror(c, 'watch_title', { user_email: email, title_id: ep.title_id, show_name: ep.show_name,
    status: recomputed.status, active_map_id: null, current_episode_id: recomputed.current, started_at: null, updated_at: now });
  return c.json({ ok: true, status: recomputed?.status, current_episode_id: recomputed?.current });
});

// Set a title's bucket directly, or bulk finish/reset its episodes. Covers the Log's
// stop / comfort / finish ("watched it all") / try-again actions.
profileRoutes.patch('/:email/titles/:title_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  const wt = await c.env.DB.prepare('SELECT title_id FROM watch_title WHERE user_email=? AND title_id=?').bind(email, titleId).first();
  if (!wt) return c.json({ error: 'not found' }, 404);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const op = str(body.op, 20);   // 'finish' | 'reset' | ''
  const now = Date.now();
  if (op === 'finish') await c.env.DB.prepare('UPDATE watch_episode SET done=1, updated_at=? WHERE user_email=? AND title_id=?').bind(now, email, titleId).run();
  else if (op === 'reset') await c.env.DB.prepare('UPDATE watch_episode SET done=0, minute=0, bp=0, sessions=NULL, updated_at=? WHERE user_email=? AND title_id=?').bind(now, email, titleId).run();

  let status = str(body.status, 40);
  if (op === 'finish') status = 'completed';
  if (op === 'reset') status = 'current';
  if (status) await c.env.DB.prepare('UPDATE watch_title SET status=?, updated_at=? WHERE user_email=? AND title_id=?').bind(status, now, email, titleId).run();
  const recomputed = await recomputeTitle(c.env, email, titleId);   // fixes resume pointer; respects manual buckets

  // Re-mirror the affected rows (bulk op touched many episodes).
  c.executionCtx.waitUntil((async () => {
    const eps = await c.env.DB.prepare('SELECT user_email, episode_id, title_id, show_name, episode_name, done, minute, bp, sessions, updated_at FROM watch_episode WHERE user_email=? AND title_id=?').bind(email, titleId).all();
    await pushRows(c.env, 'watch_episode', (eps.results || []) as any[]);
    const row = await c.env.DB.prepare('SELECT user_email, title_id, show_name, status, active_map_id, current_episode_id, started_at, updated_at FROM watch_title WHERE user_email=? AND title_id=?').bind(email, titleId).first();
    if (row) await pushRow(c.env, 'watch_title', row as any);
  })().catch((e) => console.error('airtable patch mirror', e)));
  return c.json({ ok: true, status: recomputed?.status });
});

// Withdraw a title: drop the member's title + episode progress (catalog stays shared).
profileRoutes.delete('/:email/titles/:title_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  const eps = await c.env.DB.prepare('SELECT episode_id FROM watch_episode WHERE user_email=? AND title_id=?').bind(email, titleId).all<{ episode_id: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM watch_episode WHERE user_email=? AND title_id=?').bind(email, titleId),
    c.env.DB.prepare('DELETE FROM watch_title WHERE user_email=? AND title_id=?').bind(email, titleId),
  ]);
  unmirror(c, 'watch_title', `${email}|${titleId}`);
  for (const r of eps.results || []) unmirror(c, 'watch_episode', `${email}|${r.episode_id}`);
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
  const followers = await c.env.DB.prepare(
    `SELECT f.follower_email AS email, u.username
       FROM follows f LEFT JOIN users u ON u.email = f.follower_email
      WHERE f.followee_email = ? ORDER BY f.created_at DESC`).bind(email).all();
  const back = new Set((followers.results || []).map((r: any) => r.email));
  const out = (following.results || []).map((r: any) => ({
    email: r.email, username: r.username || null, friend: back.has(r.email),
  }));
  const followingSet = new Set(out.map((x: any) => x.email));
  // Incoming = people who follow you that you don't follow back. Following one
  // back completes the mutual pair (= friend), which is what co-viewing keys on.
  const incoming = (followers.results || [])
    .filter((r: any) => !followingSet.has(r.email))
    .map((r: any) => ({ email: r.email, username: r.username || null }));
  return c.json({ following: out, friends: out.filter((x: any) => x.friend), incoming });
});

// Find members to add, by username or email fragment (excludes yourself). Each
// result is annotated with your edge to them so the UI can show Follow / Follow
// back / Friend without a second round-trip. This is the discovery the add-friend
// flow needs — you no longer have to know someone's exact email to follow them.
profileRoutes.get('/:email/find', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const q = (c.req.query('q') || '').trim().toLowerCase();
  if (q.length < 2) return c.json({ results: [] });
  const like = `%${q.replace(/[%_\\]/g, '')}%`;   // strip LIKE wildcards from user input
  const found = await c.env.DB.prepare(
    `SELECT email, username FROM users
      WHERE email <> ? AND (lower(email) LIKE ? OR lower(username) LIKE ?)
      ORDER BY (username IS NULL), username LIMIT 8`).bind(email, like, like).all();
  const fromMe = await c.env.DB
    .prepare('SELECT followee_email AS e FROM follows WHERE follower_email = ?').bind(email).all();
  const toMe = await c.env.DB
    .prepare('SELECT follower_email AS e FROM follows WHERE followee_email = ?').bind(email).all();
  const iFollow = new Set((fromMe.results || []).map((r: any) => r.e));
  const followsMe = new Set((toMe.results || []).map((r: any) => r.e));
  const results = (found.results || []).map((r: any) => ({
    email: r.email,
    username: r.username || null,
    following: iFollow.has(r.email),
    follows_me: followsMe.has(r.email),
    friend: iFollow.has(r.email) && followsMe.has(r.email),
  }));
  return c.json({ results });
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
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO follows (follower_email, followee_email, created_at) VALUES (?, ?, ?)')
    .bind(email, target, now).run();
  mirror(c, 'follows', { follower_email: email, followee_email: target, created_at: now });
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
  unmirror(c, 'follows', `${email}|${target}`);
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
    `SELECT wt.user_email, wt.title_id AS show_id, t.name AS show_name, t.kind, wt.status, wt.updated_at, u.username,
            (SELECT e.season FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND we.done=1 ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_season,
            (SELECT e.number FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND we.done=1 ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_number
       FROM watch_title wt
       JOIN titles t ON t.title_id = wt.title_id
       LEFT JOIN users u ON u.email = wt.user_email
      WHERE wt.user_email IN (${placeholders})
      ORDER BY wt.updated_at DESC LIMIT 40`).bind(...actors).all();
  const feed = (rows.results || []).map((r: any) => ({
    actor_email: r.user_email,
    actor: r.username || null,
    relationship: r.user_email === email ? 'self' : (back.has(r.user_email) ? 'friend' : 'following'),
    show_id: r.show_id, show_name: r.show_name, kind: r.kind || 'show', status: r.status,
    last_season: r.last_season, last_number: r.last_number, updated_at: r.updated_at,
  }));
  return c.json({ feed });
});
