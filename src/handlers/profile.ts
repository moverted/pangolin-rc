import { Hono } from 'hono';
import type { Env } from '../types';
import { ensureTitleSummary, ensureReleaseDate, maybeHealTitle, ensureEpisodes } from './catalog';
import { fetchTmdbMovie } from './tmdb';

// Account + device API. SEAM:identity — email is the key, no auth in this build.
export const profileRoutes = new Hono<{ Bindings: Env }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Founder account every NEW signup is auto-friended with, so a fresh member's feed is
// never empty on first launch (and the empty-feed path that exposed a scroll crash is
// far rarer). Seeded as a mutual follow at account creation only — see /signup.
const FOUNDER_EMAIL = 'ted@pangolinrc.com';

// Robin Williams room-building easter egg. A caught reference grants one free trial month.
// EGG_ACCOUNT_CAP is the lifetime per-account limit; EGG_GLOBAL_CAP is a backstop across
// ALL accounts so a leaked trick cannot mint unlimited months once it circulates. Both are
// plain knobs, raise or lower here.
const EGG_CODE = 'robin_williams';
const EGG_ACCOUNT_CAP = 3;
const EGG_GLOBAL_CAP = 500;

// SEAM:policy — friend slots per tier. A slot is an outgoing follow (an invite or
// a confirmed friend); admin is unlimited. Following someone you already follow
// is idempotent and never counts twice.
const FRIEND_SLOTS: Record<string, number> = { admin: Infinity, elite_pro: 5, elite: 2, basic: 1 };
const slotLimit = (tier?: string | null) => FRIEND_SLOTS[tier || 'basic'] ?? 1;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
const int = (v: unknown, min = -Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.trunc(v)) : null);

// Columns safe to return to the client (never the password salt/hash).
const SAFE = 'email, username, phone, photo_url, selected_device, timezone, user_type, founding_member, hide_coviewing, created_at, updated_at';

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
  const MEMBER_CAP = 20;
  const already = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!already) {
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
    if ((countRow?.c ?? 0) >= MEMBER_CAP) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)').bind(email, now).run();
      return c.json({ status: 'waitlist' });
    }
  }

  // Usernames are unique, case-insensitive. Reject a name already held by someone
  // else (your own name is fine — re-login / re-save). Without this, two members
  // can be indistinguishable in friend search and co-view.
  if (username) {
    const taken = await c.env.DB
      .prepare('SELECT email FROM users WHERE lower(username) = lower(?) AND email <> ?')
      .bind(username, email).first();
    if (taken) return c.json({ error: 'username_taken', status: 'username_taken' }, 409);
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

  // Onboarding seed: auto-friend a brand-new member with the founder account so their
  // feed has content on first launch. NEW signups only (`!already` — captured before the
  // upsert above), never the founder themselves. Idempotent via INSERT OR IGNORE, and it
  // deliberately BYPASSES the slot cap (this is a system seed, not a user-initiated
  // follow). Best-effort: a failure here must never block the signup.
  if (!already && email !== FOUNDER_EMAIL) {
    try {
      const founder = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(FOUNDER_EMAIL).first();
      if (founder) {
        await c.env.DB.batch([
          c.env.DB.prepare('INSERT OR IGNORE INTO follows (follower_email, followee_email, created_at) VALUES (?, ?, ?)').bind(email, FOUNDER_EMAIL, now),
          c.env.DB.prepare('INSERT OR IGNORE INTO follows (follower_email, followee_email, created_at) VALUES (?, ?, ?)').bind(FOUNDER_EMAIL, email, now),
        ]);
      }
    } catch (e) { console.warn('founder-seed follow failed:', String(e).substring(0, 200)); }
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

// Redeem the Robin Williams easter egg for one free trial month. Enforces BOTH caps: the
// per-account lifetime limit and the global backstop. Returns granted:true with the month
// index, or granted:false with atCap + a reason so the client can show the right line.
profileRoutes.post('/:email/redeem-egg', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!user) return c.json({ error: 'unknown user' }, 404);
  const now = Date.now();
  const acctN = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM egg_redemption WHERE user_email = ?').bind(email).first<{ n: number }>())?.n ?? 0;
  if (acctN >= EGG_ACCOUNT_CAP) return c.json({ granted: false, atCap: true, reason: 'account_cap', count: acctN });
  const globalN = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM egg_redemption').first<{ n: number }>())?.n ?? 0;
  if (globalN >= EGG_GLOBAL_CAP) return c.json({ granted: false, atCap: true, reason: 'global_cap', count: acctN });
  const monthIndex = acctN + 1;
  try {
    await c.env.DB.prepare('INSERT INTO egg_redemption (user_email, code, month_index, created_at) VALUES (?, ?, ?, ?)')
      .bind(email, EGG_CODE, monthIndex, now).run();
  } catch (_) {
    // Unique (user_email, month_index) tripped: a concurrent double-tap already granted
    // this month. Re-read and report the real state rather than double-granting.
    const n2 = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM egg_redemption WHERE user_email = ?').bind(email).first<{ n: number }>())?.n ?? monthIndex;
    return c.json({ granted: false, atCap: n2 >= EGG_ACCOUNT_CAP, reason: 'duplicate', count: n2 });
  }
  return c.json({ granted: true, atCap: false, monthIndex, count: monthIndex });
});

// Ted replies (role='ted' turns) for a member that the app has not shown yet. `since` is
// the created_at high water the client keeps; returns newer ones oldest-first so they
// render in order. This is the delivery side of the "Get Ted" handoff.
profileRoutes.get('/:email/ted-messages', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const since = Number(c.req.query('since')) || 0;
  // Delivered to the member on next open: every Ted reply, PLUS any Pierre turn flagged
  // for delivery (ted_status='deliver') so Pierre can carry a proactive, in-character
  // message like an apology. Role rides along so the client renders each in the right voice.
  const rows = await c.env.DB.prepare(
    "SELECT id, role, content, created_at FROM pierre_chat WHERE user_email = ? AND created_at > ? AND (role = 'ted' OR (role = 'pierre' AND ted_status = 'deliver')) ORDER BY created_at ASC, seq ASC LIMIT 50",
  ).bind(email, since).all();
  const messages = (rows.results || []).map((r: any) => ({ id: r.id, role: r.role, text: r.content, created_at: r.created_at }));
  return c.json({ messages });
});

// The GET TED reply queue (flat app): one unacked Ted thread at a time. A Ted reply is
// "unacked" while its turn's grade is '' (ungraded). The member acks it by grading — 👍 great,
// 👎 bad, any other exit good — which advances to the next. Returns the OLDEST unacked thread
// as its FULL original conversation (so the member can scroll up for the context Ted answered)
// plus the count still waiting (for the mascot badge). This is the delivery model that survives
// navigation/reinstall: nothing is "seen"-consumed, it stays until graded.
profileRoutes.get('/:email/ted-thread', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const pendRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pierre_chat WHERE user_email = ? AND role = 'ted' AND COALESCE(grade,'') = ''",
  ).bind(email).first<{ n: number }>();
  const pending = pendRow?.n ?? 0;
  if (!pending) return c.json({ pending: 0, thread: null });
  const ted = await c.env.DB.prepare(
    "SELECT id, conversation_id FROM pierre_chat WHERE user_email = ? AND role = 'ted' AND COALESCE(grade,'') = '' ORDER BY created_at ASC, seq ASC LIMIT 1",
  ).bind(email).first<{ id: string; conversation_id: string }>();
  if (!ted) return c.json({ pending, thread: null });
  const rows = await c.env.DB.prepare(
    "SELECT role, content, created_at FROM pierre_chat WHERE conversation_id = ? AND role IN ('user','pierre','ted') ORDER BY seq ASC, created_at ASC",
  ).bind(ted.conversation_id).all();
  const messages = (rows.results || []).map((r: any) => ({ role: r.role, text: r.content, created_at: r.created_at }));
  return c.json({ pending, thread: { conversation_id: ted.conversation_id, ted_turn_id: ted.id, messages } });
});

// Ack a Ted thread by grading its ted turn (great | good | bad); default good for a neutral
// exit. Only the member's own still-ungraded ted turn is written. Returns the remaining count.
profileRoutes.post('/:email/ted-thread/ack', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const id = typeof body.ted_turn_id === 'string' ? body.ted_turn_id : '';
  const grade = ['great', 'good', 'bad'].includes(body.grade) ? body.grade : 'good';
  if (!id) return c.json({ error: 'ted_turn_id required' }, 400);
  await c.env.DB.prepare(
    "UPDATE pierre_chat SET grade = ? WHERE id = ? AND user_email = ? AND role = 'ted' AND COALESCE(grade,'') = ''",
  ).bind(grade, id, email).run();
  const pendRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pierre_chat WHERE user_email = ? AND role = 'ted' AND COALESCE(grade,'') = ''",
  ).bind(email).first<{ n: number }>();
  return c.json({ ok: true, pending: pendRow?.n ?? 0 });
});

// Record the outcome of the microphone permission ask (folded into room building). One
// row per member, latest outcome wins. This is only the permission event, never audio.
profileRoutes.post('/:email/mic-permission', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const granted = (body.granted === true || body.granted === 1) ? 1 : 0;
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO mic_permission (user_email, granted, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_email) DO UPDATE SET granted = excluded.granted, updated_at = excluded.updated_at`
  ).bind(email, granted, now).run();
  return c.json({ ok: true, granted: !!granted });
});

// Store how the room was seeded: the two shows the member typed or said (source 'user')
// and the guesses they accepted (source 'pierre'), plus Pierre's hidden-thread line for
// the session. Upserted by (user_email, title_id). Best-effort record, never blocks the room.
profileRoutes.post('/:email/room-seed', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const thread = typeof body.thread === 'string' ? body.thread.slice(0, 400) : null;
  const shows = Array.isArray(body.shows) ? body.shows : [];
  const now = Date.now();
  const stmts: any[] = [];
  for (const s of shows) {
    const titleId = String((s && s.title_id) || '').slice(0, 120);
    if (!titleId) continue;
    const name = typeof s.name === 'string' ? s.name.slice(0, 200) : null;
    const source = s.source === 'pierre' ? 'pierre' : 'user';
    stmts.push(c.env.DB.prepare(
      `INSERT INTO room_seed (user_email, title_id, show_name, source, thread, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_email, title_id) DO UPDATE SET show_name = excluded.show_name, source = excluded.source, thread = COALESCE(excluded.thread, room_seed.thread)`
    ).bind(email, titleId, name, source, thread, now));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true, count: stmts.length });
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
  // 'phone' (this device is the screen) and 'none' (off-phone, nothing to drive)
  // are sentinels; anything else must be a device the member owns.
  if (device !== 'phone' && device !== 'none') {
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

// ---- Watch state: per-user progress over the shared catalog ----------------
// The unit is the episode (or movie). watch_title holds the Log bucket + resume
// pointer; watch_episode holds per-episode progress. Materialization lives in
// /catalog/initiate; these endpoints read and update progress.

const MANUAL = new Set(['stopped', 'comfort']);   // buckets the auto-recompute leaves alone

// Recompute watch_title.status + resume pointer from the episode rows, unless the
// member set a manual bucket (stopped/comfort). Mirrors the client's bucketOf.
async function recomputeTitle(env: Env, email: string, titleId: string): Promise<{ status: string; current: string | null } | null> {
  const t = await env.DB.prepare('SELECT status, total_episodes FROM titles WHERE title_id = ?').bind(titleId).first<any>();
  const wt = await env.DB.prepare('SELECT status, active_map_id FROM watch_title WHERE user_email = ? AND title_id = ?').bind(email, titleId).first<any>();
  if (!t || !wt) return null;
  const mapId = (wt.active_map_id || '') as string;
  let total: number, watched: number, released: number;
  let cur: { episode_id: string } | null, last: { episode_id: string } | null;
  if (mapId) {
    // Map mode: everything is scoped to the map's steps, in map order — so status +
    // resume pointer follow the marathon, not canonical air order.
    total = (await env.DB.prepare('SELECT COUNT(*) AS c FROM map_steps WHERE map_id=?').bind(mapId).first<{ c: number }>())?.c ?? 0;
    watched = (await env.DB.prepare('SELECT COUNT(*) AS c FROM map_steps ms JOIN watch_episode we ON we.user_email=? AND we.episode_id=ms.episode_id AND we.done=1 WHERE ms.map_id=?').bind(email, mapId).first<{ c: number }>())?.c ?? 0;
    released = (await env.DB.prepare("SELECT COUNT(*) AS c FROM map_steps ms JOIN episodes e ON e.episode_id=ms.episode_id WHERE ms.map_id=? AND e.airdate IS NOT NULL AND e.airdate <= date('now')").bind(mapId).first<{ c: number }>())?.c ?? 0;
    cur = await env.DB.prepare('SELECT ms.episode_id FROM map_steps ms LEFT JOIN watch_episode we ON we.user_email=? AND we.episode_id=ms.episode_id WHERE ms.map_id=? AND COALESCE(we.done,0)=0 ORDER BY ms.position LIMIT 1').bind(email, mapId).first<{ episode_id: string }>();
    last = await env.DB.prepare('SELECT episode_id FROM map_steps WHERE map_id=? ORDER BY position DESC LIMIT 1').bind(mapId).first<{ episode_id: string }>();
  } else {
    total = t.total_episodes || 0;
    watched = (await env.DB.prepare('SELECT COUNT(*) AS c FROM watch_episode WHERE user_email=? AND title_id=? AND done=1').bind(email, titleId).first<{ c: number }>())?.c ?? 0;
    released = (await env.DB.prepare("SELECT COUNT(*) AS c FROM episodes WHERE title_id=? AND airdate IS NOT NULL AND airdate <= date('now')").bind(titleId).first<{ c: number }>())?.c ?? 0;
    // First not-done episode in air order = the resume pointer (else the finale).
    cur = await env.DB.prepare('SELECT e.episode_id FROM episodes e LEFT JOIN watch_episode we ON we.user_email=? AND we.episode_id=e.episode_id WHERE e.title_id=? AND COALESCE(we.done,0)=0 ORDER BY e.season, e.number LIMIT 1').bind(email, titleId).first<{ episode_id: string }>();
    last = await env.DB.prepare('SELECT episode_id FROM episodes WHERE title_id=? ORDER BY season DESC, number DESC LIMIT 1').bind(titleId).first<{ episode_id: string }>();
  }
  const current = cur?.episode_id ?? last?.episode_id ?? null;

  let status = wt.status as string;
  if (!MANUAL.has(status)) {
    const ended = t.status === 'Ended' || t.status === 'Canceled' || t.status === 'Film';
    if (watched >= total && total > 0) status = 'completed';
    else if (watched < released) status = 'current';
    // RETURNING was retired: a caught-up still-running show stays CURRENT (mirrors bucketOf).
    else status = ended ? 'completed' : 'current';
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
            t.premiered, t.summary, t.total_episodes AS total, wt.status, wt.active_map_id,
            wt.current_episode_id, wt.started_at, wt.updated_at,
            (SELECT COUNT(*) FROM watch_episode we WHERE we.user_email=wt.user_email AND we.title_id=wt.title_id AND we.done=1) AS watched,
            (SELECT COALESCE(SUM(we.minute),0) FROM watch_episode we WHERE we.user_email=wt.user_email AND we.title_id=wt.title_id) AS minutes,
            (SELECT e.runtime FROM episodes e WHERE e.title_id=wt.title_id ORDER BY e.season, e.number LIMIT 1) AS runtime,
            (SELECT COUNT(*) FROM episodes e WHERE e.title_id=wt.title_id AND e.airdate IS NOT NULL AND e.airdate <= date('now')) AS released,
            (SELECT e.season FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND (we.done=1 OR we.minute>0) ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_season,
            (SELECT e.number FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND (we.done=1 OR we.minute>0) ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_number,
            (SELECT wtk.created_at FROM watch_ticket wtk WHERE wtk.user_email=wt.user_email AND wtk.show_id=wt.title_id ORDER BY wtk.created_at DESC LIMIT 1) AS ticket_at,
            (SELECT wtk.ticket_date FROM watch_ticket wtk WHERE wtk.user_email=wt.user_email AND wtk.show_id=wt.title_id ORDER BY wtk.created_at DESC LIMIT 1) AS ticket_date,
            (SELECT wtk.ticket_time FROM watch_ticket wtk WHERE wtk.user_email=wt.user_email AND wtk.show_id=wt.title_id ORDER BY wtk.created_at DESC LIMIT 1) AS ticket_time
       FROM watch_title wt JOIN titles t ON t.title_id = wt.title_id
      WHERE wt.user_email = ? ORDER BY wt.updated_at DESC`).bind(email).all();
  const list = (rows.results || []) as any[];
  // Ticketed films drive the freshness badge → make sure their release date is real
  // (self-healing: year-fallback → TMDB), so HOT/FRESH/CASUAL is accurate.
  await Promise.all(list.map(async (t) => {
    if (t.kind === 'movie' && t.ticket_at && typeof t.premiered === 'string' && /-01-01$/.test(t.premiered)) {
      const rel = await ensureReleaseDate(c.env, t.title_id).catch(() => null);
      if (rel) t.premiered = rel;
    }
    // Marathon (curated map) tiles: the WATCH tile is the MARATHON QUEUE, not the whole
    // series. Re-scope total/watched/released/last-position to the map's steps (in map
    // order) and carry the marathon's name so the tile can brand itself. Without this the
    // tile counts every watch_episode row and reads as "all episodes" (see recomputeTitle,
    // which already scopes status/current the same way).
    if (t.active_map_id) {
      const mapId = t.active_map_id as string;
      const [mp, tot, wat, rel, lastDone] = await Promise.all([
        c.env.DB.prepare('SELECT name FROM maps WHERE map_id=?').bind(mapId).first<{ name: string }>(),
        c.env.DB.prepare('SELECT COUNT(*) AS c FROM map_steps WHERE map_id=?').bind(mapId).first<{ c: number }>(),
        c.env.DB.prepare('SELECT COUNT(*) AS c FROM map_steps ms JOIN watch_episode we ON we.user_email=? AND we.episode_id=ms.episode_id AND we.done=1 WHERE ms.map_id=?').bind(email, mapId).first<{ c: number }>(),
        c.env.DB.prepare("SELECT COUNT(*) AS c FROM map_steps ms JOIN episodes e ON e.episode_id=ms.episode_id WHERE ms.map_id=? AND e.airdate IS NOT NULL AND e.airdate <= date('now')").bind(mapId).first<{ c: number }>(),
        c.env.DB.prepare('SELECT e.season, e.number FROM map_steps ms JOIN episodes e ON e.episode_id=ms.episode_id JOIN watch_episode we ON we.user_email=? AND we.episode_id=ms.episode_id AND we.done=1 WHERE ms.map_id=? ORDER BY ms.position DESC LIMIT 1').bind(email, mapId).first<{ season: number; number: number }>(),
      ]);
      t.total = tot?.c ?? 0;
      t.watched = wat?.c ?? 0;
      t.released = rel?.c ?? 0;
      t.last_season = lastDone?.season ?? null;
      t.last_number = lastDone?.number ?? null;
      t.map_name = mp?.name ?? null;
    }
  }));
  return c.json({ titles: list });
});

// One title's full detail for the episode face: catalog episodes merged with the
// member's per-episode progress.
profileRoutes.get('/:email/titles/:title_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  let title = await c.env.DB.prepare('SELECT * FROM titles WHERE title_id = ?').bind(titleId).first<any>();
  if (!title) return c.json({ error: 'not found' }, 404);
  // Auto-heal a catalog left stale by "materialize ONCE" (aired episode still carrying an
  // ingest-time placeholder name/runtime): re-pull from TVmaze in-band so the LOG face shows
  // real episode data on this open. TTL-gated inside maybeHealTitle; no-op for movies/fresh.
  const healed = await maybeHealTitle(c.env, title);
  if (healed) title = healed;
  // Fill a missing synopsis once (titles tracked before the summary column existed).
  if (title.summary == null) title.summary = await ensureTitleSummary(c.env, titleId);
  const watch_title = await c.env.DB.prepare('SELECT * FROM watch_title WHERE user_email=? AND title_id=?').bind(email, titleId).first<any>();
  // Map mode: when this title is in a curated marathon, return its episodes in MAP order with
  // the map's next-links, so the LOG face follows the marathon. Else canonical air order.
  const mapId = (watch_title && watch_title.active_map_id) || null;
  let mapMeta: { id: string; name: string } | null = null;
  let eps;
  if (mapId) {
    const mp = await c.env.DB.prepare('SELECT map_id, name FROM maps WHERE map_id=?').bind(mapId).first<{ map_id: string; name: string }>();
    if (mp) mapMeta = { id: mp.map_id, name: mp.name };
    eps = await c.env.DB.prepare(
      `SELECT e.episode_id, e.season, e.number, e.name, e.runtime, e.airdate, e.summary, ms.next_episode_id AS next_episode_id,
              COALESCE(we.done,0) AS done, COALESCE(we.minute,0) AS minute, COALESCE(we.bp,0) AS bp, we.sessions
         FROM map_steps ms JOIN episodes e ON e.episode_id=ms.episode_id
              LEFT JOIN watch_episode we ON we.user_email=? AND we.episode_id=e.episode_id
        WHERE ms.map_id=? ORDER BY ms.position`).bind(email, mapId).all();
  } else {
    eps = await c.env.DB.prepare(
      `SELECT e.episode_id, e.season, e.number, e.name, e.runtime, e.airdate, e.summary, e.next_episode_id,
              COALESCE(we.done,0) AS done, COALESCE(we.minute,0) AS minute, COALESCE(we.bp,0) AS bp, we.sessions
         FROM episodes e LEFT JOIN watch_episode we ON we.user_email=? AND we.episode_id=e.episode_id
        WHERE e.title_id=? ORDER BY e.season, e.number`).bind(email, titleId).all();
  }
  const episodes = (eps.results || []).map((r: any) => ({ ...r, sessions: r.sessions ? safeParse(r.sessions) : [] }));
  return c.json({ title, watch_title, episodes, map: mapMeta });
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

// ── Rewatch passes ───────────────────────────────────────────────────────────
// Archive one SEASON's watch-through as a pass, then reset its live rows so a fresh
// pass starts from the beginning. The original completion + viewing history are never
// clobbered — they live on in watch_pass. `ordinal` = 1-based view number for the season
// (a partial restart is 'highlights' and still consumes its number). Returns the pass.
async function archiveAndResetSeason(env: Env, email: string, titleId: string, season: number, now: number) {
  const seasonEps = ((await env.DB.prepare(
    'SELECT episode_id FROM episodes WHERE title_id=? AND season=? ORDER BY number'
  ).bind(titleId, season).all()).results || []) as any[];
  const seasonCt = seasonEps.length;
  if (!seasonCt) return null;                                   // unknown season
  const ids = seasonEps.map((e) => e.episode_id);
  const ph = ids.map(() => '?').join(',');
  const prog = ((await env.DB.prepare(
    `SELECT episode_id, done, minute, bp, sessions FROM watch_episode
      WHERE user_email=? AND title_id=? AND episode_id IN (${ph})`
  ).bind(email, titleId, ...ids).all()).results || []) as any[];
  if (!prog.length) return null;                               // nothing watched to archive
  const watchedCt = prog.filter((r) => r.done).length;
  const kind = watchedCt >= seasonCt ? 'complete' : 'highlights';
  let startedAt: number | null = null;
  const snap: Record<string, any> = {};
  for (const r of prog) {
    const sessions = r.sessions ? safeParse(r.sessions) : [];
    snap[r.episode_id] = { done: !!r.done, minute: r.minute || 0, bp: !!r.bp, sessions };
    if (Array.isArray(sessions)) for (const s of sessions) {
      const t = s && typeof s.startTs === 'number' ? s.startTs : (s && typeof s.finishTs === 'number' ? s.finishTs : 0);
      if (t && (startedAt === null || t < startedAt)) startedAt = t;
    }
  }
  const modeRow = await env.SCHED_DB.prepare(
    'SELECT mode FROM sched_mode_choice WHERE user_email=? AND show_id=?'
  ).bind(email, titleId).first<{ mode: string | null }>().catch(() => null);
  const pattern = modeRow?.mode ?? null;
  const ord = ((await env.DB.prepare(
    'SELECT COALESCE(MAX(ordinal),0) AS m FROM watch_pass WHERE user_email=? AND title_id=? AND season=?'
  ).bind(email, titleId, season).first<{ m: number }>())?.m ?? 0) + 1;
  const passId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO watch_pass (pass_id, user_email, title_id, season, ordinal, kind, pattern, episodes, watched_ct, season_ct, started_at, archived_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(passId, email, titleId, season, ord, kind, pattern, JSON.stringify(snap), watchedCt, seasonCt, startedAt, now).run();
  await env.DB.prepare(
    `DELETE FROM watch_episode WHERE user_email=? AND title_id=? AND episode_id IN (${ph})`
  ).bind(email, titleId, ...ids).run();
  return { pass_id: passId, season, ordinal: ord, kind, pattern, watched_ct: watchedCt, season_ct: seasonCt, started_at: startedAt, archived_at: now };
}

// season != null → that one season; null → every season with progress (whole-series restart).
async function doRewatch(c: any, seasonParam: number | null) {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  const exists = await c.env.DB.prepare('SELECT email FROM users WHERE email=?').bind(email).first();
  if (!exists) return c.json({ error: 'unknown user' }, 404);
  const now = Date.now();
  let seasons: number[];
  if (seasonParam != null && !Number.isNaN(seasonParam)) seasons = [seasonParam];
  else {
    const rows = ((await c.env.DB.prepare(
      `SELECT DISTINCT e.season AS season FROM episodes e
         JOIN watch_episode we ON we.episode_id=e.episode_id
        WHERE we.user_email=? AND we.title_id=? AND (we.done=1 OR we.minute>0)
        ORDER BY e.season`).bind(email, titleId).all()).results || []) as any[];
    seasons = rows.map((r) => r.season).filter((s) => s != null);
  }
  const passes: any[] = [];
  for (const s of seasons) { const p = await archiveAndResetSeason(c.env, email, titleId, s, now); if (p) passes.push(p); }
  // Reset the manual watch pattern so it re-derives from the fresh (empty) log.
  await c.env.SCHED_DB.prepare('DELETE FROM sched_mode_choice WHERE user_email=? AND show_id=?').bind(email, titleId).run().catch(() => {});
  await recomputeTitle(c.env, email, titleId).catch(() => null);
  return c.json({ ok: true, passes });
}
profileRoutes.post('/:email/titles/:title_id/seasons/:season/rewatch', (c) => doRewatch(c, parseInt(c.req.param('season'), 10)));
profileRoutes.post('/:email/titles/:title_id/rewatch', (c) => doRewatch(c, null));

// Archived passes for one title (season, then newest ordinal first).
profileRoutes.get('/:email/titles/:title_id/passes', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  const rows = (await c.env.DB.prepare(
    `SELECT pass_id, season, ordinal, kind, pattern, watched_ct, season_ct, started_at, archived_at
       FROM watch_pass WHERE user_email=? AND title_id=? ORDER BY season, ordinal DESC`
  ).bind(email, titleId).all()).results || [];
  return c.json({ passes: rows });
});

// Every archived pass joined to its title — feeds the WATCH Completed tab.
profileRoutes.get('/:email/passes', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const rows = (await c.env.DB.prepare(
    `SELECT p.pass_id, p.title_id, t.name, t.poster, t.kind AS title_kind, p.season, p.ordinal,
            p.kind AS pass_kind, p.pattern, p.watched_ct, p.season_ct, p.started_at, p.archived_at
       FROM watch_pass p JOIN titles t ON t.title_id=p.title_id
      WHERE p.user_email=? ORDER BY p.archived_at DESC`
  ).bind(email).all()).results || [];
  return c.json({ passes: rows });
});

// Every theater ticket a member has logged, newest first — feeds the IRL Tickets tab.
// Poster comes from the linked title when it exists; `ticketUrl` is the stored stub image.
profileRoutes.get('/:email/tickets', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const origin = new URL(c.req.url).origin;
  // Each ticket also carries its latest reflection for that title (the mic take, matched
  // on show_id since a ticket's episode is often null), so the card can show it as a clip.
  const rows = (await c.env.DB.prepare(
    `SELECT wt.id, wt.show_id, wt.episode_id, wt.show_name, wt.theater, wt.ticket_date, wt.ticket_time, wt.created_at, t.poster,
            (SELECT wc.id FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id
               AND wc.is_reflection=1 AND wc.reply_to IS NULL AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC LIMIT 1) AS refl_id,
            (SELECT wc.transcription FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id
               AND wc.is_reflection=1 AND wc.reply_to IS NULL AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC LIMIT 1) AS refl_text
       FROM watch_ticket wt LEFT JOIN titles t ON t.title_id = wt.show_id
      WHERE wt.user_email = ? ORDER BY wt.created_at DESC`
  ).bind(email).all()).results || [];
  const tickets = (rows as any[]).map((r) => ({
    id: r.id, film: r.show_name, theater: r.theater, date: r.ticket_date, time: r.ticket_time,
    showId: r.show_id || null, episodeId: r.episode_id || null,
    poster: r.poster || null, ticketUrl: `${origin}/ticket/${r.id}/image`, createdAt: r.created_at,
    reflection: r.refl_id ? { id: r.refl_id, text: r.refl_text || '', audioUrl: `${origin}/transcribe/audio/${r.refl_id}` } : null,
  }));
  // Self-heal: a linked TMDB title whose catalog row was created without a poster (a transient
  // TMDB miss, or a lighter creation path — materializeTitle never refetches an existing row) →
  // fetch the poster now and backfill titles.poster so it sticks for every future read.
  const heal = tickets.filter((t) => !t.poster && typeof t.showId === 'string' && /^tmdb:\d+$/.test(t.showId));
  if (heal.length) {
    const seen = new Map<string, string | null>();
    await Promise.all(heal.map(async (t) => {
      const tmdbId = String(t.showId).slice(5);
      if (!seen.has(tmdbId)) {
        let poster: string | null = null;
        try { const m = await fetchTmdbMovie(c.env, tmdbId); poster = (m && m.poster) || null; } catch { /* fail-soft */ }
        seen.set(tmdbId, poster);
        if (poster) {
          try { await c.env.DB.prepare(`UPDATE titles SET poster = ? WHERE title_id = ? AND (poster IS NULL OR poster = '')`).bind(poster, t.showId).run(); } catch { /* best effort */ }
        }
      }
      const p = seen.get(tmdbId); if (p) t.poster = p;
    }));
  }
  return c.json({ tickets });
});

// Upsert one episode's progress, then recompute the title's bucket + resume pointer.
profileRoutes.post('/:email/episodes/:episode_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const episode_id = c.req.param('episode_id');
  const exists = await c.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!exists) return c.json({ error: 'unknown user' }, 404);
  const ep = await c.env.DB.prepare(
    `SELECT e.title_id, e.season, e.number, e.name AS episode_name, t.name AS show_name
       FROM episodes e JOIN titles t ON t.title_id = e.title_id WHERE e.episode_id = ?`
  ).bind(episode_id).first<{ title_id: string; season: number; number: number; episode_name: string | null; show_name: string | null }>();
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
  // Backfill: watching/starting an episode implies you've seen everything before it.
  // Mark every EARLIER episode (air order) with no record yet as BP (Before Pierre) —
  // done=1, bp=1 — so the resume pointer skips the ones you never logged (e.g. you
  // jumped straight into S2E5). BP rows are hidden/greyed in the Log but still count.
  if ((done || minute > 0) && ep.season != null && ep.number != null) {
    // Earlier episodes that are neither done nor in-progress (no row, or an empty
    // done=0/minute=0 row) → mark BP-done so the resume pointer skips them.
    const earlier = await c.env.DB.prepare(
      `SELECT e.episode_id, e.name FROM episodes e
         LEFT JOIN watch_episode we ON we.user_email = ? AND we.episode_id = e.episode_id
        WHERE e.title_id = ? AND (e.season < ? OR (e.season = ? AND e.number < ?))
          AND COALESCE(we.done, 0) = 0 AND COALESCE(we.minute, 0) = 0`
    ).bind(email, ep.title_id, ep.season, ep.season, ep.number).all<{ episode_id: string; name: string | null }>();
    const rows = earlier.results || [];
    if (rows.length) {
      const up = c.env.DB.prepare(
        `INSERT INTO watch_episode
           (user_email, episode_id, title_id, show_name, episode_name, done, minute, bp, sessions, updated_at)
         VALUES (?,?,?,?,?,1,0,1,NULL,?)
         ON CONFLICT(user_email, episode_id) DO UPDATE SET done=1, bp=1, updated_at=excluded.updated_at`);
      await c.env.DB.batch(rows.map((r) => up.bind(email, r.episode_id, ep.title_id, ep.show_name, r.name, now)));
    }
  }
  const recomputed = await recomputeTitle(c.env, email, ep.title_id);
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
  return c.json({ ok: true, status: recomputed?.status });
});

// POST /:email/titles/:title_id/map { map_id | null } — put this title into a curated map
// (a comfort marathon) or clear it back to canonical air order. Setting a map re-points the
// resume pointer to the first not-done map step (via recomputeTitle). Materializes the title
// first so a not-yet-tracked show can be dropped straight into a marathon.
profileRoutes.post('/:email/titles/:title_id/map', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const mapId = body.map_id == null || body.map_id === '' ? null : str(body.map_id, 120);
  if (mapId) {
    const mp = await c.env.DB.prepare('SELECT map_id FROM maps WHERE map_id = ? AND (title_id = ? OR title_id IS NULL)').bind(mapId, titleId).first();
    if (!mp) return c.json({ error: 'unknown map for this title' }, 404);
  }
  const now = Date.now();
  const t = await c.env.DB.prepare('SELECT name FROM titles WHERE title_id = ?').bind(titleId).first<{ name: string }>();
  await c.env.DB.prepare(
    `INSERT INTO watch_title (user_email, title_id, show_name, status, active_map_id, updated_at)
     VALUES (?, ?, ?, 'current', ?, ?)
     ON CONFLICT(user_email, title_id) DO UPDATE SET active_map_id=excluded.active_map_id, updated_at=excluded.updated_at`,
  ).bind(email, titleId, t?.name || '', mapId, now).run();
  const recomputed = await recomputeTitle(c.env, email, titleId);
  return c.json({ ok: true, active_map_id: mapId, status: recomputed?.status, current_episode_id: recomputed?.current });
});

// GET /:email/marathons — the COLLECT view (Browse tab). Curated marathons (the `maps` table)
// split into the ones this member OWNS (YOUR MARATHONS) and everyone else's / global ones
// (COMMUNITY MARATHONS). Ownership: a map whose owner_email matches the member is "yours"; any
// other owner — including NULL = global (a community-seeded marathon like Psych) — is "community".
// So the SAME map (e.g. Moonlighting owned by Ted) reads as YOURS to its owner and COMMUNITY to
// everyone else. Each entry carries name / kind / step count / a poster (from its title when the
// map is single-title) for the COLLECT tile.
profileRoutes.get('/:email/marathons', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const rows = await c.env.DB.prepare(
    `SELECT m.map_id, m.name, m.kind, m.title_id, m.owner_email, t.poster AS poster, t.name AS title_name,
            (SELECT COUNT(*) FROM map_steps ms WHERE ms.map_id = m.map_id) AS steps
       FROM maps m LEFT JOIN titles t ON t.title_id = m.title_id
      ORDER BY m.created_at DESC`).all<any>();
  const all = rows.results || [];
  const mine = (r: any) => !!r.owner_email && String(r.owner_email).toLowerCase() === email;
  const shape = (r: any) => ({ map_id: r.map_id, name: r.name, kind: r.kind, title_id: r.title_id || null,
    poster: r.poster || null, title_name: r.title_name || null, steps: r.steps || 0 });
  return c.json({
    yours: all.filter(mine).map(shape),
    community: all.filter((r: any) => !mine(r)).map(shape),
  });
});

// ── Member-built marathons (the COLLECT creator/editor) ──────────────────────
// A member marathon is a `maps` row with kind='user' + owner_email=<member>, backed by
// ordered `map_steps`. The steps live inside one title (single-title v1), so once activated
// on that title (POST /titles/:id/map) the existing active_map_id play path drives Watch/Log.

// The catalog episode-id format, mirrored from catalog.ts's private epId.
const marEpId = (titleId: string, season: number, number: number) => `${titleId}:s${season}e${number}`;

// Materialize the title, then map an ordered [{season,number}] list to the episode_ids that
// actually exist in the catalog — preserving order, echoing back any that don't resolve (a bad
// SxEy) so the caller can surface them instead of the builder silently fabricating a step.
async function resolveSteps(env: Env, titleId: string, episodes: any[]):
  Promise<{ steps: string[]; missing: string[] }> {
  const eps = await ensureEpisodes(env, titleId);
  const have = new Set(eps.map((e) => e.episode_id));
  const steps: string[] = [], missing: string[] = [];
  for (const raw of Array.isArray(episodes) ? episodes : []) {
    const s = Number(raw?.season), n = Number(raw?.number);
    if (!Number.isFinite(s) || !Number.isFinite(n)) continue;
    const id = marEpId(titleId, s, n);
    if (have.has(id) && !steps.includes(id)) steps.push(id);   // dedupe: a step can appear once
    else if (!have.has(id)) missing.push(`S${s}E${n}`);
  }
  return { steps, missing };
}

// Write the ordered map_steps for a map (position + forward next_episode_id link, NULL on the
// last). Replaces any existing steps. Caller owns the map row + validation.
async function writeSteps(env: Env, mapId: string, steps: string[]): Promise<void> {
  const stmts = [env.DB.prepare('DELETE FROM map_steps WHERE map_id = ?').bind(mapId)];
  steps.forEach((epId, i) => {
    stmts.push(env.DB.prepare(
      'INSERT INTO map_steps (map_id, position, episode_id, next_episode_id) VALUES (?,?,?,?)')
      .bind(mapId, i + 1, epId, steps[i + 1] || null));
  });
  await env.DB.batch(stmts);
}

// POST /:email/marathons { title_id, name, blurb?, episodes:[{season,number}] } — Pierre's
// build target. Materializes the title, resolves the ordered episode list, and creates a
// member-owned marathon. Single-title only for v1.
profileRoutes.post('/:email/marathons', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const titleId = str(body.title_id, 120);
  const name = str(body.name, 120);
  const blurb = str(body.blurb, 500);
  // The build path is always Pierre → a blurb here is Pierre's draft. Accept an override for
  // completeness, but default the byline to Pierre whenever a blurb is present.
  const blurbBy = blurb ? (str(body.blurb_by, 60) || 'Pierre the Pangolin') : null;
  if (!titleId || !name) return c.json({ error: 'title_id and name required' }, 400);
  const { steps, missing } = await resolveSteps(c.env, titleId, body.episodes);
  if (!steps.length) return c.json({ error: 'no valid episodes resolved', missing }, 422);
  const mapId = 'map:u:' + crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO maps (map_id, title_id, name, kind, owner_email, blurb, blurb_by, created_at, updated_at)
     VALUES (?,?,?,'user',?,?,?,?,?)`).bind(mapId, titleId, name, email, blurb || null, blurbBy, now, now).run();
  await writeSteps(c.env, mapId, steps);
  return c.json({ ok: true, map_id: mapId, title_id: titleId, steps: steps.length, missing });
});

// GET /:email/marathons/:map_id — the detail: header (name/blurb/poster/title), the SERIES
// synopsis (the show's own summary, shown behind the MARATHON/SERIES blurb toggle — read-only,
// never the marathon blurb), plus the ordered steps joined to episode metadata. is_owner gates
// edit vs fork on the client.
profileRoutes.get('/:email/marathons/:map_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const mapId = c.req.param('map_id');
  const m = await c.env.DB.prepare(
    `SELECT m.map_id, m.name, m.blurb, m.blurb_by, m.kind, m.title_id, m.owner_email, t.poster AS poster, t.name AS title_name, t.summary AS series_blurb
       FROM maps m LEFT JOIN titles t ON t.title_id = m.title_id WHERE m.map_id = ?`).bind(mapId).first<any>();
  if (!m) return c.json({ error: 'not found' }, 404);
  // Lazy-fill the series synopsis for titles materialized before summaries were stored, so the
  // SERIES blurb tab isn't empty on older shows.
  let seriesBlurb = m.series_blurb;
  if (m.title_id && seriesBlurb == null) { try { seriesBlurb = await ensureTitleSummary(c.env, m.title_id); } catch { /* leave null */ } }
  const rows = await c.env.DB.prepare(
    `SELECT ms.position, ms.episode_id, e.season, e.number, e.name AS ep_name
       FROM map_steps ms LEFT JOIN episodes e ON e.episode_id = ms.episode_id
      WHERE ms.map_id = ? ORDER BY ms.position`).bind(mapId).all<any>();
  return c.json({
    map_id: m.map_id, name: m.name, blurb: m.blurb || '', blurb_by: m.blurb_by || null, kind: m.kind,
    title_id: m.title_id || null, title_name: m.title_name || null, poster: m.poster || null,
    series_blurb: seriesBlurb || '',
    owner_email: m.owner_email || null,
    is_owner: !!m.owner_email && String(m.owner_email).toLowerCase() === email,
    steps: (rows.results || []).map((r: any) => ({
      episode_id: r.episode_id, season: r.season, number: r.number, ep_name: r.ep_name || null })),
  });
});

// PUT /:email/marathons/:map_id { name?, blurb?, episodes?:[{season,number}] } — owner-only edit.
// A non-owner must fork first (the "manual edit" path clones a community marathon into theirs).
profileRoutes.put('/:email/marathons/:map_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const mapId = c.req.param('map_id');
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const m = await c.env.DB.prepare('SELECT owner_email, title_id FROM maps WHERE map_id = ?').bind(mapId).first<any>();
  if (!m) return c.json({ error: 'not found' }, 404);
  if (!m.owner_email || String(m.owner_email).toLowerCase() !== email) return c.json({ error: 'not your marathon' }, 403);
  let missing: string[] = [];
  if (Array.isArray(body.episodes)) {
    const r = await resolveSteps(c.env, m.title_id, body.episodes);
    if (!r.steps.length) return c.json({ error: 'no valid episodes resolved', missing: r.missing }, 422);
    missing = r.missing;
    await writeSteps(c.env, mapId, r.steps);
  }
  const sets: string[] = ['updated_at = ?']; const binds: any[] = [Date.now()];
  if (typeof body.name === 'string')  { sets.push('name = ?');  binds.push(str(body.name, 120)); }
  if (typeof body.blurb === 'string') {
    // The client sends blurb_by alongside a blurb: itself when the member changed the prose,
    // or the existing author when they didn't (so a title-only edit keeps Pierre's byline).
    sets.push('blurb = ?');    binds.push(str(body.blurb, 500) || null);
    sets.push('blurb_by = ?'); binds.push(str(body.blurb_by, 60) || null);
  }
  binds.push(mapId);
  await c.env.DB.prepare(`UPDATE maps SET ${sets.join(', ')} WHERE map_id = ?`).bind(...binds).run();
  return c.json({ ok: true, map_id: mapId, missing });
});

// POST /:email/marathons/:map_id/fork — clone any marathon into YOURS (the community "manual
// edit" path: you never mutate a shared run, you edit your own copy). Owner becomes the caller.
profileRoutes.post('/:email/marathons/:map_id/fork', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const srcId = c.req.param('map_id');
  const src = await c.env.DB.prepare('SELECT title_id, name, blurb, blurb_by FROM maps WHERE map_id = ?').bind(srcId).first<any>();
  if (!src) return c.json({ error: 'not found' }, 404);
  const steps = await c.env.DB.prepare('SELECT episode_id FROM map_steps WHERE map_id = ? ORDER BY position').bind(srcId).all<{ episode_id: string }>();
  const newId = 'map:u:' + crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO maps (map_id, title_id, name, kind, owner_email, blurb, blurb_by, created_at, updated_at)
     VALUES (?,?,?,'user',?,?,?,?,?)`).bind(newId, src.title_id || null, `${src.name} (your copy)`, email, src.blurb || null, src.blurb_by || null, now, now).run();
  await writeSteps(c.env, newId, (steps.results || []).map((r) => r.episode_id));
  return c.json({ ok: true, map_id: newId });
});

// DELETE /:email/marathons/:map_id — owner-only delete of a member marathon (steps + row). Any
// member with it active is defended by the map POST's existence check; a stale active_map_id just
// falls back to air order on the next recompute.
profileRoutes.delete('/:email/marathons/:map_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const mapId = c.req.param('map_id');
  const m = await c.env.DB.prepare('SELECT owner_email FROM maps WHERE map_id = ?').bind(mapId).first<any>();
  if (!m) return c.json({ error: 'not found' }, 404);
  if (!m.owner_email || String(m.owner_email).toLowerCase() !== email) return c.json({ error: 'not your marathon' }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM map_steps WHERE map_id = ?').bind(mapId),
    c.env.DB.prepare('DELETE FROM maps WHERE map_id = ?').bind(mapId),
  ]);
  return c.json({ ok: true });
});

// Withdraw a title: a FULL delete of this member's copy — title + episode progress,
// plus any tickets (and their R2 images) and reflections filed against it. The shared
// catalog row stays. Scoped to the caller's own email, so a member can only delete
// their own. show_id is the title key on tickets/reflections (tmdb:/tvmaze:<id>).
profileRoutes.delete('/:email/titles/:title_id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('title_id');
  // Ticket images live in R2 (tickets/<show_id>/<id>); grab keys before dropping rows.
  const tks = await c.env.DB.prepare('SELECT ticket_r2_key FROM watch_ticket WHERE user_email=? AND show_id=?').bind(email, titleId).all<{ ticket_r2_key: string | null }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM watch_episode WHERE user_email=? AND title_id=?').bind(email, titleId),
    c.env.DB.prepare('DELETE FROM watch_title WHERE user_email=? AND title_id=?').bind(email, titleId),
    c.env.DB.prepare('DELETE FROM watch_ticket WHERE user_email=? AND show_id=?').bind(email, titleId),
    c.env.DB.prepare('DELETE FROM reflection WHERE user_email=? AND show_id=?').bind(email, titleId),
  ]);
  // Best-effort purge of the ticket images; a miss here just leaves an orphan blob.
  await Promise.all((tks.results || [])
    .map((t) => t.ticket_r2_key)
    .filter((k): k is string => !!k)
    .map((k) => c.env.RAW_BUCKET.delete(k).catch(() => {})));
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
  // A slot is consumed only by a confirmed friend (mutual). Pending one-way
  // follows you've sent are free and shown separately.
  const friends = out.filter((x: any) => x.friend);
  const pending = out.filter((x: any) => !x.friend);
  const me = await c.env.DB.prepare('SELECT user_type FROM users WHERE email = ?').bind(email).first<any>();
  const limit = slotLimit(me?.user_type);
  const slots = { tier: me?.user_type || 'basic', limit: Number.isFinite(limit) ? limit : null, used: friends.length };
  return c.json({ following: out, friends, pending, incoming, slots });
});

// Count a member's confirmed friends (mutual follows).
async function friendCount(c: any, email: string): Promise<number> {
  const r = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS c FROM follows a
         JOIN follows b ON b.follower_email = a.followee_email
                       AND b.followee_email = a.follower_email
        WHERE a.follower_email = ?`
    )
    .bind(email)
    .first();
  return (r as any)?.c ?? 0;
}

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

// Is this address already a pangolinRC member? Powers "invite detects an existing
// member and follows them in-app instead of emailing a join link."
profileRoutes.get('/:email/member', async (c) => {
  const addr = (c.req.query('addr') || '').toLowerCase().trim();
  if (!EMAIL_RE.test(addr)) return c.json({ member: false });
  const u = await c.env.DB.prepare('SELECT username FROM users WHERE email = ?').bind(addr).first<any>();
  return c.json({ member: !!u, username: u?.username || null });
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
  // Slot cap (SEAM:policy): a slot is spent only when a follow COMPLETES a mutual
  // friendship. A pending one-way follow is free. When it would complete a pair,
  // neither party may exceed their tier's friend limit. Re-following is idempotent.
  const already = await c.env.DB
    .prepare('SELECT 1 FROM follows WHERE follower_email = ? AND followee_email = ?').bind(email, target).first();
  if (!already) {
    const reciprocal = await c.env.DB
      .prepare('SELECT 1 FROM follows WHERE follower_email = ? AND followee_email = ?').bind(target, email).first();
    if (reciprocal) {
      // This follow makes (email, target) mutual — both gain a friend. Guard both.
      for (const who of [email, target]) {
        const t = await c.env.DB.prepare('SELECT user_type FROM users WHERE email = ?').bind(who).first<any>();
        const lim = slotLimit(t?.user_type);
        if (Number.isFinite(lim) && (await friendCount(c, who)) >= lim) {
          return c.json({ error: 'slot_limit', limit: lim, who }, 403);
        }
      }
    }
  }
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO follows (follower_email, followee_email, created_at) VALUES (?, ?, ?)')
    .bind(email, target, now).run();
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

// ── Coviewers ─────────────────────────────────────────────────────────────────
// "Who's on your sofa" — the people a user regularly watches with (see
// migrations/0036_coviewer.sql). Accountless by default; `linked_email` ties one to
// a real member. `is_default` marks the default coviewing matrix Pierre assumes when
// no one names the room. All CRUD is owner-scoped by the :email path param.
const coviewerRow = (r: any) => ({
  id: r.id,
  display_name: r.display_name,
  relationship: r.relationship || '',
  linked_email: r.linked_email || null,
  is_default: !!r.is_default,
  created_at: r.created_at,
});

// List a user's roster, defaults first, then alphabetical.
profileRoutes.get('/:email/coviewers', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const rows = await c.env.DB
    .prepare('SELECT * FROM coviewer WHERE owner_email = ? ORDER BY is_default DESC, display_name COLLATE NOCASE')
    .bind(email).all();
  return c.json({ coviewers: (rows.results || []).map(coviewerRow) });
});

// Add a coviewer. `linked_email`, if given, must be a real member (else stored null
// and reported back as unlinked — name-only is a first-class state, not an error).
profileRoutes.post('/:email/coviewers', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const display_name = str(body.display_name, 80);
  if (!display_name) return c.json({ error: 'display_name required' }, 400);
  const relationship = str(body.relationship, 40);
  let linked: string | null = null;
  const wants = String(body.linked_email || '').toLowerCase().trim();
  if (wants && EMAIL_RE.test(wants)) {
    const m = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(wants).first();
    if (m) linked = wants;              // only link to an address that is actually a member
  }
  const is_default = body.is_default ? 1 : 0;
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO coviewer (id, owner_email, display_name, relationship, linked_email, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, email, display_name, relationship, linked, is_default, now).run();
  const row = { id, owner_email: email, display_name, relationship, linked_email: linked, is_default, created_at: now };
  return c.json({ coviewer: coviewerRow(row) });
});

// Edit a coviewer: name, relationship, link/unlink an account, or toggle default.
// Only the fields present in the body change. Owner-scoped by the WHERE.
profileRoutes.patch('/:email/coviewers/:id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const id = c.req.param('id');
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const sets: string[] = [];
  const vals: any[] = [];
  if (typeof body.display_name === 'string') { sets.push('display_name = ?'); vals.push(str(body.display_name, 80)); }
  if (typeof body.relationship === 'string') { sets.push('relationship = ?'); vals.push(str(body.relationship, 40)); }
  if ('is_default' in body) { sets.push('is_default = ?'); vals.push(body.is_default ? 1 : 0); }
  if ('linked_email' in body) {
    let linked: string | null = null;
    const wants = String(body.linked_email || '').toLowerCase().trim();
    if (wants && EMAIL_RE.test(wants)) {
      const m = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(wants).first();
      if (m) linked = wants;
    }
    sets.push('linked_email = ?'); vals.push(linked);
  }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  await c.env.DB.prepare(`UPDATE coviewer SET ${sets.join(', ')} WHERE id = ? AND owner_email = ?`)
    .bind(...vals, id, email).run();
  const row = await c.env.DB.prepare('SELECT * FROM coviewer WHERE id = ? AND owner_email = ?').bind(id, email).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ coviewer: coviewerRow(row) });
});

// Remove a coviewer from the roster.
profileRoutes.delete('/:email/coviewers/:id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM coviewer WHERE id = ? AND owner_email = ?').bind(id, email).run();
  return c.json({ ok: true });
});

// Feed privacy: hide this user's co-viewing from the social feed (opt-out).
profileRoutes.post('/:email/hide-coviewing', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const hide = (body.hide === true || body.hide === 1 || body.hide === '1') ? 1 : 0;
  await c.env.DB.prepare('UPDATE users SET hide_coviewing = ? WHERE email = ?').bind(hide, email).run();
  return c.json({ ok: true, hide_coviewing: hide });
});

// ── Per-title coviewers ─────────────────────────────────────────────────────────
// Who you watch a given title WITH (see migrations/0039_watch_title_coviewer.sql).
// Set in the Pierre add flow and editable on WATCH/LOG. Solo = empty set.
profileRoutes.get('/:email/titles/:titleId/coviewers', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('titleId');
  const rows = await c.env.DB.prepare(
    `SELECT cv.* FROM watch_title_coviewer wtc
       JOIN coviewer cv ON cv.id = wtc.coviewer_id
      WHERE wtc.user_email = ? AND wtc.title_id = ?
      ORDER BY cv.display_name COLLATE NOCASE`).bind(email, titleId).all();
  return c.json({ coviewers: (rows.results || []).map(coviewerRow) });
});

// Replace the whole set for a title (idempotent). Body: { coviewer_ids: [...] } or
// { use_default: true } to copy the owner's default matrix (is_default roster). Only
// ids belonging to this owner's roster are accepted.
profileRoutes.put('/:email/titles/:titleId/coviewers', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const titleId = c.req.param('titleId');
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  let valid: string[] = [];
  if (body.use_default === true) {
    const rs = await c.env.DB.prepare(
      'SELECT id FROM coviewer WHERE owner_email = ? AND is_default = 1').bind(email).all<{ id: string }>();
    valid = (rs.results || []).map(r => r.id);
  } else {
    const ids = Array.isArray(body.coviewer_ids) ? body.coviewer_ids.map((x: any) => String(x)).slice(0, 20) : [];
    if (ids.length) {
      const rs = await c.env.DB.prepare(
        `SELECT id FROM coviewer WHERE owner_email = ? AND id IN (${ids.map(() => '?').join(',')})`)
        .bind(email, ...ids).all<{ id: string }>();
      valid = (rs.results || []).map(r => r.id);
    }
  }
  const now = Date.now();
  const stmts: any[] = [
    c.env.DB.prepare('DELETE FROM watch_title_coviewer WHERE user_email = ? AND title_id = ?').bind(email, titleId),
  ];
  for (const id of valid) stmts.push(
    c.env.DB.prepare(
      'INSERT INTO watch_title_coviewer (user_email, title_id, coviewer_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(email, titleId, id, now));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, coviewer_ids: valid });
});

// ─── Likes: react to a member's activity card ────────────────────────────────
// Set (not toggle) the caller's like on one activity, identified by (subject
// member + title + kind). Idempotent: liking twice is one row, unliking removes
// it. Returns the fresh total so the card can update its counter in place.
profileRoutes.post('/:email/like', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const subject = String(body.subject || '').toLowerCase().trim();
  const titleId = String(body.title_id || '').trim();
  const kind = String(body.kind || 'show').trim() || 'show';
  const liked = body.liked === true || body.liked === 1 || body.liked === '1';
  if (!subject || !titleId) return c.json({ error: 'subject and title_id required' }, 400);
  if (liked) {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO likes (user_email, subject_email, title_id, kind, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(email, subject, titleId, kind, Date.now()).run();
  } else {
    await c.env.DB.prepare(
      'DELETE FROM likes WHERE user_email = ? AND subject_email = ? AND title_id = ? AND kind = ?')
      .bind(email, subject, titleId, kind).run();
  }
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS c FROM likes WHERE subject_email = ? AND title_id = ? AND kind = ?')
    .bind(subject, titleId, kind).first<any>();
  return c.json({ ok: true, liked, count: Number(row?.c) || 0 });
});

// ─── Shares: a member pushes a title to specific friends ─────────────────────
// Distinct from the passive feed — a share is a deliberate recommendation that
// lands on each recipient's BROWSE "From friends" rail until they open/dismiss it.
// Only confirmed friends (mutual follows) are valid recipients, enforced here.

// The caller's confirmed friends (mutual follow A→B and B→A).
async function friendEmails(c: any, email: string): Promise<Set<string>> {
  const { results } = await c.env.DB.prepare(
    `SELECT a.followee_email AS email FROM follows a
       JOIN follows b ON b.follower_email = a.followee_email
                     AND b.followee_email = a.follower_email
      WHERE a.follower_email = ?`).bind(email).all();
  return new Set((results || []).map((r: any) => r.email));
}

// POST /:email/share — body { title_id, to:[emails], note?, show_name?, poster? }.
// Inserts one share row per friend recipient, skipping any who already have an
// open (undismissed) share of this title from this sender. Returns how many landed.
profileRoutes.post('/:email/share', async (c) => {
  const email = c.req.param('email').toLowerCase();
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const titleId = String(body.title_id || '').trim();
  const note = (String(body.note || '').trim().slice(0, 280)) || null;
  const to: string[] = Array.isArray(body.to) ? body.to.map((e: any) => String(e).toLowerCase().trim()).filter(Boolean) : [];
  if (!titleId || !to.length) return c.json({ error: 'title_id and to[] required' }, 400);
  const me = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (!me) return c.json({ error: 'unknown user' }, 401);

  const friends = await friendEmails(c, email);
  let recipients: string[] = [...new Set<string>(to)].filter((e) => friends.has(e) && e !== email);
  if (!recipients.length) return c.json({ shared: 0 });

  // Skip friends who already have this title open on their rail (no duplicate cards).
  const ph = recipients.map(() => '?').join(',');
  const { results: dup } = await c.env.DB.prepare(
    `SELECT to_email FROM shares
      WHERE from_email = ? AND title_id = ? AND dismissed_at IS NULL AND to_email IN (${ph})`)
    .bind(email, titleId, ...recipients).all();
  const have = new Set((dup || []).map((r: any) => r.to_email));
  recipients = recipients.filter((e) => !have.has(e));
  if (!recipients.length) return c.json({ shared: 0 });

  const t = await c.env.DB.prepare('SELECT name, poster FROM titles WHERE title_id = ?').bind(titleId).first<any>();
  const showName = t?.name || (body.show_name ? String(body.show_name).slice(0, 200) : null);
  const poster = t?.poster || (body.poster ? String(body.poster).slice(0, 500) : null);
  const now = Date.now();
  await c.env.DB.batch(recipients.map((rcpt) => c.env.DB.prepare(
    `INSERT INTO shares (id, from_email, to_email, title_id, show_name, poster, note, created_at)
     VALUES (?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), email, rcpt, titleId, showName, poster, note, now)));
  return c.json({ shared: recipients.length });
});

// GET /:email/shares — the open shares on this member's BROWSE rail, newest first,
// joined with the live title (name/poster/kind) and the sender's username.
profileRoutes.get('/:email/shares', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.title_id, s.note, s.created_at, s.from_email,
            COALESCE(t.name, s.show_name) AS show_name,
            COALESCE(t.poster, s.poster) AS poster, t.kind, u.username AS from_name
       FROM shares s
       LEFT JOIN titles t ON t.title_id = s.title_id
       LEFT JOIN users  u ON u.email = s.from_email
      WHERE s.to_email = ? AND s.dismissed_at IS NULL
      ORDER BY s.created_at DESC`).bind(email).all();
  const shares = (results || []).map((r: any) => ({
    id: r.id, titleId: r.title_id, showName: r.show_name || '', poster: r.poster || null,
    kind: r.kind || 'show', note: r.note || '', from: r.from_name || r.from_email,
    fromEmail: r.from_email, createdAt: r.created_at,
  }));
  return c.json({ shares });
});

// DELETE /:email/shares/:id — recipient clears a share off their rail (soft delete).
profileRoutes.delete('/:email/shares/:id', async (c) => {
  const email = c.req.param('email').toLowerCase();
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE shares SET dismissed_at = ? WHERE id = ? AND to_email = ?')
    .bind(Date.now(), id, email).run();
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
  const iFollow = new Set((following.results || []).map((r: any) => r.e));
  const followsMe = new Set((followers.results || []).map((r: any) => r.e));
  // Feed = me + everyone I follow + everyone who follows me. Including inbound
  // followers I haven't reciprocated is what surfaces a "Follow +" card (mutual
  // pair = friend, one-way outbound = following, one-way inbound = follower).
  const actors = [email, ...new Set([...iFollow, ...followsMe])];
  const placeholders = actors.map(() => '?').join(',');
  const rel = (who: string) => {
    if (who === email) return 'self';
    const out = iFollow.has(who), inc = followsMe.has(who);
    if (out && inc) return 'friend';
    if (out) return 'following';
    return 'follower';           // they follow me, I don't follow back → Follow +
  };
  // Abandoned shows (status='stopped') get a 24h grace window in the feed, then drop
  // out for everyone: a fresh bail is still a real activity beat, but a stale one just
  // clutters the stream without adding anything, and newcomers shouldn't watch a
  // member quietly clean house. updated_at is bumped to the stop-time (ms) on bail.
  const bailCutoff = Date.now() - 24 * 60 * 60 * 1000;
  // A card is more than "who watched what": it carries the poster (for the big
  // background art), the actor's public comment count on that title, and their
  // latest end-of-episode note + its spoiler flag so the card can show or gate it.
  const rows = await c.env.DB.prepare(
    `SELECT wt.user_email, wt.title_id AS show_id, t.name AS show_name, t.kind, t.poster, t.premiered, wt.status, wt.updated_at, u.username,
            (SELECT e.season FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND (we.done=1 OR we.minute>0) ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_season,
            (SELECT e.number FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND (we.done=1 OR we.minute>0) ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_number,
            (SELECT e.name FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND (we.done=1 OR we.minute>0) ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_name,
            (SELECT we.done FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND (we.done=1 OR we.minute>0) ORDER BY e.season DESC, e.number DESC LIMIT 1) AS last_done,
            (SELECT COUNT(*) FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.title_id AND wc.reply_to IS NULL AND wc.private=0 AND COALESCE(wc.transcription,'')<>'') AS comment_ct,
            (SELECT COUNT(*) FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.title_id AND wc.reply_to IS NULL AND wc.is_endnote=0 AND wc.is_reflection=0 AND wc.private=0 AND COALESCE(wc.transcription,'')<>''
               AND wc.episode_id = (SELECT 'S'||printf('%02d',e.season)||'E'||printf('%02d',e.number) FROM episodes e JOIN watch_episode we ON we.episode_id=e.episode_id AND we.user_email=wt.user_email WHERE e.title_id=wt.title_id AND (we.done=1 OR we.minute>0) ORDER BY e.season DESC, e.number DESC LIMIT 1)) AS synced_ct,
            (SELECT wc.id FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.title_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_id,
            (SELECT wc.episode_id FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.title_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_ep,
            (SELECT wc.transcription FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.title_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_text,
            (SELECT wc.spoiler FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.title_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_spoiler,
            (SELECT CASE WHEN wc.audio_r2_key IS NOT NULL AND wc.audio_r2_key<>'' THEN 1 ELSE 0 END FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.title_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_audio,
            (SELECT COUNT(*) FROM likes lk WHERE lk.subject_email=wt.user_email AND lk.title_id=wt.title_id AND lk.kind=COALESCE(t.kind,'show')) AS like_ct,
            (SELECT COUNT(*) FROM likes lk WHERE lk.user_email=? AND lk.subject_email=wt.user_email AND lk.title_id=wt.title_id AND lk.kind=COALESCE(t.kind,'show')) AS liked
       FROM watch_title wt
       JOIN titles t ON t.title_id = wt.title_id
       LEFT JOIN users u ON u.email = wt.user_email
      WHERE wt.user_email IN (${placeholders})
        AND NOT (wt.status = 'stopped' AND wt.updated_at < ?)
      ORDER BY wt.updated_at DESC LIMIT 40`).bind(email, ...actors, bailCutoff).all();
  const watchFeed = (rows.results || []).map((r: any) => ({
    actor_email: r.user_email,
    actor: r.username || null,
    relationship: rel(r.user_email),
    show_id: r.show_id, show_name: r.show_name, kind: r.kind || 'show', status: r.status,
    poster: r.poster || null, premiered: r.premiered || null,
    comment_ct: Number(r.comment_ct) || 0, synced_ct: Number(r.synced_ct) || 0,
    like_ct: Number(r.like_ct) || 0, liked: !!Number(r.liked),
    endnote_id: r.endnote_id || null, endnote_ep: r.endnote_ep || null, endnote_text: r.endnote_text || null,
    endnote_spoiler: !!r.endnote_spoiler, endnote_audio: !!r.endnote_audio,
    last_season: r.last_season, last_number: r.last_number, last_name: r.last_name || null,
    last_done: !!Number(r.last_done),   // is the latest touched episode finished (→ past-tense verb) or a mid-episode partial
    episodes: [] as any[],   // per-episode content for the binge cycler (filled below)
    coviewers: undefined as string[] | undefined,   // first-name co-viewers (filled below)
    updated_at: r.updated_at,
  }));
  // Theater tickets are real activity too — a night out at the cinema — but they
  // live in watch_ticket, never watch_title, so the old query dropped them. Pull
  // them, tag kind='ticket' (theater is the "where"), and merge into the stream.
  const tick = await c.env.DB.prepare(
    `SELECT wt.user_email, wt.show_id, wt.show_name, wt.theater, wt.ticket_date, wt.created_at, t.poster, t.premiered, u.username,
            (SELECT COUNT(*) FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id AND wc.reply_to IS NULL AND wc.private=0 AND COALESCE(wc.transcription,'')<>'') AS comment_ct,
            (SELECT COUNT(*) FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id AND wc.reply_to IS NULL AND wc.is_endnote=0 AND wc.is_reflection=0 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'') AS synced_ct,
            (SELECT wc.id FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_id,
            (SELECT wc.episode_id FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_ep,
            (SELECT wc.transcription FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_text,
            (SELECT wc.spoiler FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_spoiler,
            (SELECT CASE WHEN wc.audio_r2_key IS NOT NULL AND wc.audio_r2_key<>'' THEN 1 ELSE 0 END FROM watch_comment wc WHERE wc.user_email=wt.user_email AND wc.show_id=wt.show_id AND wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' ORDER BY wc.created_at DESC, wc.id DESC LIMIT 1) AS endnote_audio,
            (SELECT COUNT(*) FROM likes lk WHERE lk.subject_email=wt.user_email AND lk.title_id=wt.show_id AND lk.kind='ticket') AS like_ct,
            (SELECT COUNT(*) FROM likes lk WHERE lk.user_email=? AND lk.subject_email=wt.user_email AND lk.title_id=wt.show_id AND lk.kind='ticket') AS liked
       FROM watch_ticket wt
       LEFT JOIN titles t ON t.title_id = wt.show_id
       LEFT JOIN users u ON u.email = wt.user_email
      WHERE wt.user_email IN (${placeholders})
      ORDER BY wt.created_at DESC LIMIT 40`).bind(email, ...actors).all();
  const ticketFeed = (tick.results || []).map((r: any) => ({
    actor_email: r.user_email,
    actor: r.username || null,
    relationship: rel(r.user_email),
    show_id: r.show_id, show_name: r.show_name, kind: 'ticket', status: 'ticket',
    theater: r.theater || null, poster: r.poster || null, premiered: r.premiered || null,
    ticket_date: r.ticket_date || null,
    comment_ct: Number(r.comment_ct) || 0, synced_ct: Number(r.synced_ct) || 0,
    like_ct: Number(r.like_ct) || 0, liked: !!Number(r.liked),
    endnote_id: r.endnote_id || null, endnote_ep: r.endnote_ep || null, endnote_text: r.endnote_text || null,
    endnote_spoiler: !!r.endnote_spoiler, endnote_audio: !!r.endnote_audio,
    last_season: null, last_number: null, last_name: null, updated_at: r.created_at,
  }));
  // Per-episode content for the BINGE CYCLER: every episode (of every actor's shows)
  // that carries synced comments or an end-note, so a card that binged a run can step
  // through each consecutively-watched episode's notes/comments. One grouped pass.
  const epRows = await c.env.DB.prepare(
    `SELECT wc.user_email, wc.show_id, wc.episode_id,
            SUM(CASE WHEN wc.reply_to IS NULL AND wc.is_endnote=0 AND wc.is_reflection=0 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' THEN 1 ELSE 0 END) AS synced,
            MAX(CASE WHEN wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' THEN wc.id END) AS endnote_id,
            MAX(CASE WHEN wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' THEN wc.transcription END) AS endnote_text,
            MAX(CASE WHEN wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' THEN wc.spoiler END) AS endnote_spoiler,
            MAX(CASE WHEN wc.is_endnote=1 AND wc.private=0 AND COALESCE(wc.transcription,'')<>'' AND wc.audio_r2_key IS NOT NULL AND wc.audio_r2_key<>'' THEN 1 ELSE 0 END) AS endnote_audio
       FROM watch_comment wc
      WHERE wc.user_email IN (${placeholders}) AND wc.show_id IS NOT NULL AND wc.episode_id <> '🎬'
      GROUP BY wc.user_email, wc.show_id, wc.episode_id
      HAVING synced > 0 OR endnote_id IS NOT NULL
      ORDER BY wc.episode_id ASC`).bind(...actors).all();
  const epByKey: Record<string, any[]> = {};
  for (const r of (epRows.results || []) as any[]) {
    const k = r.user_email + '|' + r.show_id;
    (epByKey[k] = epByKey[k] || []).push({
      ep: r.episode_id, synced: Number(r.synced) || 0,
      endnote_id: r.endnote_id || null, endnote_text: r.endnote_text || null,
      endnote_spoiler: !!r.endnote_spoiler, endnote_audio: !!r.endnote_audio,
    });
  }
  for (const row of watchFeed) {
    const arr = epByKey[row.actor_email + '|' + row.show_id];
    if (arr && arr.length) row.episodes = arr;
  }
  // Co-viewers on the card — FIRST NAMES ONLY, and only for actors who haven't opted
  // out via hide_coviewing. The feed is friend-scoped, but co-viewing names third
  // parties, so we never expose a full name or a coviewer's account here.
  const cov = await c.env.DB.prepare(
    `SELECT wtc.user_email, wtc.title_id, cv.display_name
       FROM watch_title_coviewer wtc
       JOIN coviewer cv ON cv.id = wtc.coviewer_id
       JOIN users u ON u.email = wtc.user_email
      WHERE wtc.user_email IN (${placeholders}) AND COALESCE(u.hide_coviewing, 0) = 0`).bind(...actors).all();
  const covByKey: Record<string, string[]> = {};
  for (const r of (cov.results || []) as any[]) {
    const first = String(r.display_name || '').trim().split(/\s+/)[0];   // first name only
    if (first) {
      const k = r.user_email + '|' + r.title_id;
      (covByKey[k] = covByKey[k] || []).push(first);
    }
  }
  for (const row of watchFeed) {
    const names = covByKey[row.actor_email + '|' + row.show_id];
    if (names && names.length) row.coviewers = names;
  }
  const feed = [...watchFeed, ...ticketFeed]
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 40);
  return c.json({ feed });
});
