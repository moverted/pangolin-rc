import { Hono } from 'hono';
import type { Env } from '../types';
import { pushRow } from './airtable';

export const waitlistRoutes = new Hono<{ Bindings: Env }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Cloudflare Turnstile bot check — same pattern as the Pierre chat gate
// (browser → this Worker → siteverify, never the browser directly).
async function verifyTurnstile(secret: string, token: string, ip?: string): Promise<boolean> {
  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const d = (await r.json()) as { success?: boolean };
    return d.success === true;
  } catch {
    return false;
  }
}

// Notify the team of a new signup via SendGrid v3 (domain is SendGrid-authenticated
// on pangolinrc.com). Best-effort: no-ops until SENDGRID_API_KEY is set, and never
// throws into the request path (called via waitUntil). reply_to is the signup's own
// address, so hitting Reply in the inbox writes straight back to the new person.
async function notifySignup(env: Env, s: { email: string; first_name: string; last_name: string; fav_show: string | null; buddy_email: string | null }): Promise<void> {
  if (!env.SENDGRID_API_KEY) return;
  const to = (env.WAITLIST_NOTIFY_TO || 'waitlist@pangolinrc.com').trim();
  const from = (env.WAITLIST_NOTIFY_FROM || 'waitlist@pangolinrc.com').trim();
  const name = `${s.first_name} ${s.last_name}`.trim();
  const lines = [
    `New PangolinRC waitlist signup:`,
    ``,
    `Name:   ${name}`,
    `Email:  ${s.email}`,
    `Show:   ${s.fav_show || '—'}`,
    `Buddy:  ${s.buddy_email || '—'}`,
    ``,
    `Source: join.pangolinrc.com`,
  ];
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: 'PangolinRC Waitlist' },
      reply_to: { email: s.email, name: name || undefined },
      subject: `New waitlist signup: ${name || s.email}`,
      content: [{ type: 'text/plain', value: lines.join('\n') }],
    }),
  });
  if (!r.ok) throw new Error(`sendgrid ${r.status}: ${await r.text().catch(() => '')}`.slice(0, 300));
}

// Public waitlist signup from join.pangolinrc.com. No auth (SEAM:identity) — the
// Turnstile gate is the only bot defense. email is the PK, so a re-submit updates
// the captured details rather than erroring.
waitlistRoutes.post('/', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  // Bot gate first. Fails open only while the secret is unset (mirrors /pierre),
  // so the form keeps working during rollout until TURNSTILE_SECRET_KEY is set.
  if (c.env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
    const ip = c.req.header('CF-Connecting-IP') || undefined;
    if (!token || !(await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, token, ip)))
      return c.json({ error: 'failed bot check' }, 403);
  }

  const email = str(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);
  const first_name = str(body.first_name, 80);
  const last_name  = str(body.last_name, 80);
  if (!first_name || !last_name) return c.json({ error: 'first and last name required' }, 400);
  const fav_show   = str(body.fav_show, 200) || null;
  // A malformed buddy address is dropped, not rejected — never fail a real signup
  // over an optional field.
  let buddy_email  = str(body.buddy_email, 200).toLowerCase() || null;
  if (buddy_email && !EMAIL_RE.test(buddy_email)) buddy_email = null;
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO waitlist (email, first_name, last_name, fav_show, buddy_email, source, created_at)
     VALUES (?, ?, ?, ?, ?, 'join_form', ?)
     ON CONFLICT(email) DO UPDATE SET
       first_name  = excluded.first_name,
       last_name   = excluded.last_name,
       fav_show    = COALESCE(excluded.fav_show, waitlist.fav_show),
       buddy_email = COALESCE(excluded.buddy_email, waitlist.buddy_email),
       source      = excluded.source`
  ).bind(email, first_name, last_name, fav_show, buddy_email, now).run();

  // Fire-and-forget mirror to Airtable (email is the only mapped column today).
  c.executionCtx.waitUntil(
    pushRow(c.env, 'waitlist', { email, created_at: now }).catch((e: unknown) => console.error('airtable waitlist mirror', e))
  );

  // Fire-and-forget signup notification email (SendGrid). Best-effort; never blocks
  // or fails the signup.
  c.executionCtx.waitUntil(
    notifySignup(c.env, { email, first_name, last_name, fav_show, buddy_email }).catch((e: unknown) => console.error('sendgrid signup notify', e))
  );

  return c.json({ status: 'waitlist', ok: true });
});
