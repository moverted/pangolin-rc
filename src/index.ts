import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { EmailMessage } from 'cloudflare:email';
import type { Env } from './types';
import { resourceRoutes }   from './handlers/resources';
import { submissionRoutes } from './handlers/submissions';
import { uploadRoutes }     from './handlers/uploads';
import { auditRoutes }      from './handlers/audit';
import { accessRoutes }     from './handlers/access';
import { eventRoutes }      from './handlers/events';
import { remoteRoutes }     from './handlers/remote';
import { captionRoutes }    from './handlers/captions';
import { pierreRoutes }     from './handlers/pierre';
import { profileRoutes }    from './handlers/profile';
import { streamerRoutes }   from './handlers/streamer';
import { tmdbRoutes }       from './handlers/tmdb';
import { catalogRoutes }    from './handlers/catalog';
import { syncRoutes, pullChanges, airtableEnabled, pushRow } from './handlers/airtable';
import { processQueue }     from './queue';

export { ResourceCoordinator } from './do/resource-coordinator';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Transcribe endpoint - direct handler to avoid routing issues
app.options('/transcribe', (c) => {
  return c.json({ ok: true });
});

app.post('/transcribe', async (c) => {
  try {
    const formData = await c.req.formData();
    const audio = formData.get('audio') as unknown as File;
    const episodeId = formData.get('episodeId') as string;
    const showId = (formData.get('showId') as string) || '';
    const userEmail = (formData.get('userEmail') as string) || '';
    const timestampMs = parseInt(formData.get('timestampMs') as string) || 0;

    if (!audio || !episodeId) {
      return c.json({ error: 'missing audio or episodeId' }, 400);
    }

    const email = userEmail.trim();
    const contentType = audio.type || 'audio/webm';
    console.log('Audio upload for', episodeId, 'email:', email, 'size:', audio.size);

    if (audio.size === 0) {
      return c.json({ error: 'audio is empty', id: crypto.randomUUID() }, 400);
    }

    // watch_comment.user_email FKs users(email); reject before storing so we
    // don't orphan an R2 object on a constraint failure.
    if (!email || email === 'anonymous') {
      return c.json({ error: 'sign in required to save audio' }, 401);
    }
    const known = await c.env.DB
      .prepare('SELECT 1 FROM users WHERE email = ?')
      .bind(email)
      .first();
    if (!known) {
      return c.json({ error: 'unknown user' }, 401);
    }

    const commentId = crypto.randomUUID();
    const r2Key = `audio-comments/${showId || 'unknown'}/${episodeId}/${commentId}`;
    const buffer = await audio.arrayBuffer();

    // Store the raw audio in R2 so it can be played back later.
    await c.env.RAW_BUCKET.put(r2Key, buffer, {
      httpMetadata: { contentType },
    });
    console.log('Audio stored in R2:', r2Key);

    // Best-effort transcription via Workers AI Whisper. A failure here must not
    // lose the audio — the row is still written with a null transcription.
    let transcription = '';
    try {
      const resp = await (c.env.AI as any).run('@cf/openai/whisper', {
        audio: Array.from(new Uint8Array(buffer)),
      });
      transcription = resp?.text || resp?.result?.text || '';
    } catch (err) {
      console.warn('Whisper transcription failed:', String(err).substring(0, 200));
    }

    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO watch_comment (id, user_email, episode_id, show_id, timestamp_ms, transcription, audio_r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(commentId, email, episodeId, showId || null, timestampMs, transcription || null, r2Key, now)
      .run();

    console.log('Audio comment saved:', commentId);
    return c.json({
      id: commentId,
      audioUrl: `${new URL(c.req.url).origin}/transcribe/audio/${commentId}`,
      transcription,
      timestamp: timestampMs,
    });
  } catch (error) {
    console.error('Audio upload error:', error);
    return c.json({
      error: 'upload failed',
      details: String(error).substring(0, 200)
    }, 500);
  }
});

// Stream a stored audio comment back from R2 (R2 bindings have no signed-URL
// method; serving through the Worker is the supported path).
app.get('/transcribe/audio/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB
    .prepare('SELECT audio_r2_key FROM watch_comment WHERE id = ?')
    .bind(id)
    .first<{ audio_r2_key: string | null }>();
  if (!row?.audio_r2_key) return c.json({ error: 'not found' }, 404);

  const object = await c.env.RAW_BUCKET.get(row.audio_r2_key);
  if (!object) return c.json({ error: 'audio not in storage' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'audio/webm');
  headers.set('Cache-Control', 'private, max-age=86400');
  return new Response(object.body, { headers });
});

// List a member's audio comments for one show, newest first, so the episode
// face can render the persisted "Transcripts" panel on load.
//
// FUTURE — co-viewing: a comment is already tied to (show_id, episode_id,
// timestamp_ms), so it knows the exact minute marker it was spoken at. Once
// friends exist, a viewer could "turn co-viewing on" and watch a show with a
// friend's comments surfaced live at each comment's minute marker (i.e. relax
// the `user_email = ?` filter to "me + the friends I'm co-viewing with", and
// have the player fire each clip when playback passes its timestamp_ms). That
// is a deliberate amount of complexity we are NOT building now — leaving this
// own-comments-only for the moment.
app.get('/transcribe/comments', async (c) => {
  const showId = c.req.query('showId') ?? '';
  const email = c.req.query('email') ?? '';
  if (!showId || !email) return c.json({ comments: [] });

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, episode_id, timestamp_ms, transcription, created_at
         FROM watch_comment
        WHERE show_id = ? AND user_email = ?
        ORDER BY created_at DESC`
    )
    .bind(showId, email)
    .all();

  const origin = new URL(c.req.url).origin;
  const comments = (results || []).map((r: any) => ({
    id: r.id,
    episodeId: r.episode_id,
    timestampMs: r.timestamp_ms,
    transcription: r.transcription || '',
    createdAt: r.created_at,
    audioUrl: `${origin}/transcribe/audio/${r.id}`,
  }));
  return c.json({ comments });
});

// Minimal HTML escape for untrusted report fields placed in the email body.
const escHtml = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Best-effort email notification for a new bug report, via the Email Routing send
// binding. No-ops cleanly until the binding exists AND the recipient is a verified
// Email Routing destination — so it never blocks or fails the report write. Built
// as a single-part text/html MIME message (ASCII-only headers; UTF-8 body) so it
// needs no extra deps. Throws are caught by the caller.
type BugRow = {
  id: string; user_email: string | null; note: string | null; view: string | null;
  url: string | null; user_agent: string | null; viewport: string | null;
  screenshot_url: string | null; created_at: number;
};
async function notifyBugEmail(env: Env, r: BugRow): Promise<void> {
  if (!env.BUG_EMAIL) return;
  const to = (env.BUG_NOTIFY_TO || 'edward.m.willett@gmail.com').trim();
  const from = (env.BUG_FROM || 'bugs@pangolinrc.com').trim();
  // Headers must be ASCII — strip non-ASCII (emoji/em-dash) from the subject only.
  const subject = `Bug report: ${r.view || 'unknown'} (${r.user_email || 'anon'})`
    .replace(/[^\x20-\x7E]/g, '');
  const shot = r.screenshot_url
    ? `<p><a href="${escHtml(r.screenshot_url)}">Open screenshot</a></p>
       <p><img src="${escHtml(r.screenshot_url)}" alt="screenshot" style="max-width:480px;border:1px solid #ddd;border-radius:8px"></p>`
    : '<p style="color:#999">(no screenshot)</p>';
  const html =
    `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#222">` +
    `<h2 style="margin:0 0 12px">🐞 New bug report</h2>` +
    `<p style="margin:0 0 12px;line-height:1.6">` +
    `<strong>View:</strong> ${escHtml(r.view || '—')}<br>` +
    `<strong>From:</strong> ${escHtml(r.user_email || '(not signed in)')}<br>` +
    `<strong>When:</strong> ${new Date(r.created_at).toISOString()}<br>` +
    `<strong>Viewport:</strong> ${escHtml(r.viewport || '—')}<br>` +
    `<strong>URL:</strong> ${escHtml(r.url || '—')}</p>` +
    `<p style="white-space:pre-wrap;border-left:3px solid #FF6B35;padding:4px 0 4px 12px;margin:0 0 16px">` +
    `${escHtml(r.note || '(no note)')}</p>` +
    shot +
    `<p style="color:#999;font-size:12px;margin-top:16px">${escHtml(r.user_agent || '')}</p>` +
    `</body></html>`;
  const raw =
    `From: pangolinRC Bugs <${from}>\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Message-ID: <${r.id}@pangolinrc.com>\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n\r\n` +
    html;
  await env.BUG_EMAIL.send(new EmailMessage(from, to, raw));
}

// ─── Bug reports ────────────────────────────────────────────────────────────
// A persistent 🐞 in the shell captures a screenshot + a note from any view and
// files it here. Anyone may report (no sign-in required); the screenshot is
// optional and best-effort. D1 is the source of truth; the row mirrors to the
// Airtable `bug_report` grid for hand triage. The author fields these manually.
app.options('/bug-reports', (c) => c.json({ ok: true }));

app.post('/bug-reports', async (c) => {
  try {
    const form = await c.req.formData();
    const note = ((form.get('note') as string) || '').trim();
    const view = ((form.get('view') as string) || '').trim();
    const url = ((form.get('url') as string) || '').trim();
    const userAgent = ((form.get('userAgent') as string) || '').trim();
    const viewport = ((form.get('viewport') as string) || '').trim();
    const email = ((form.get('email') as string) || '').trim().toLowerCase();
    const shot = form.get('screenshot') as unknown as File | null;

    // A report needs *something* — a note or a screenshot. Empty taps are dropped.
    if (!note && !(shot && shot.size > 0)) {
      return c.json({ error: 'empty report' }, 400);
    }

    const id = crypto.randomUUID();
    const origin = new URL(c.req.url).origin;
    let screenshotUrl: string | null = null;

    // Screenshot rides at a deterministic R2 key so the GET route rebuilds it from
    // the id alone. A storage failure must not lose the written report.
    if (shot && shot.size > 0) {
      try {
        await c.env.RAW_BUCKET.put(`bug-reports/${id}.png`, await shot.arrayBuffer(), {
          httpMetadata: { contentType: shot.type || 'image/png' },
        });
        screenshotUrl = `${origin}/bug-reports/${id}/screenshot`;
      } catch (err) {
        console.warn('bug-report screenshot store failed:', String(err).substring(0, 200));
      }
    }

    const now = Date.now();
    const row = {
      id,
      user_email: email || null,
      note: note || null,
      view: view || null,
      url: url || null,
      user_agent: userAgent || null,
      viewport: viewport || null,
      screenshot_url: screenshotUrl,
      status: 'new',
      created_at: now,
    };
    await c.env.DB.prepare(
      `INSERT INTO bug_report (id, user_email, note, view, url, user_agent, viewport, screenshot_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(row.id, row.user_email, row.note, row.view, row.url, row.user_agent,
            row.viewport, row.screenshot_url, row.status, row.created_at)
      .run();

    // Mirror to the Airtable triage grid and email a notification — both
    // best-effort and independent, so neither one blocks or fails the report.
    c.executionCtx.waitUntil(Promise.allSettled([
      pushRow(c.env, 'bug_report', row).catch((e) => console.warn('bug airtable mirror failed:', String(e).substring(0, 200))),
      notifyBugEmail(c.env, row).catch((e) => console.warn('bug email failed:', String(e).substring(0, 200))),
    ]));

    return c.json({ id, ok: true });
  } catch (error) {
    console.error('bug-report error:', error);
    return c.json({ error: 'report failed', details: String(error).substring(0, 200) }, 500);
  }
});

// Stream a bug report's screenshot back from R2 (R2 has no signed-URL method;
// serving through the Worker is the supported path). The key is derived from id.
app.get('/bug-reports/:id/screenshot', async (c) => {
  const id = c.req.param('id');
  const object = await c.env.RAW_BUCKET.get(`bug-reports/${id}.png`);
  if (!object) return c.json({ error: 'not found' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/png');
  headers.set('Cache-Control', 'private, max-age=86400');
  return new Response(object.body, { headers });
});

app.route('/resources',   resourceRoutes);
app.route('/submissions', submissionRoutes);
app.route('/uploads',     uploadRoutes);
app.route('/audit',       auditRoutes);
app.route('/submissions', accessRoutes);
app.route('/events',      eventRoutes);
app.route('/remote',      remoteRoutes);
app.route('/captions',    captionRoutes);
app.route('/pierre',      pierreRoutes);
app.route('/profile',     profileRoutes);
app.route('/streamer',    streamerRoutes);
app.route('/tmdb',        tmdbRoutes);
app.route('/catalog',     catalogRoutes);
app.route('/sync',        syncRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  fetch: app.fetch.bind(app),
  queue: processQueue,
  // Inbound Airtable → D1 sync: pull human edits back on a cron. No-op until the
  // Airtable secrets are set, so the trigger is harmless to register beforehand.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!airtableEnabled(env)) return;
    ctx.waitUntil(pullChanges(env).then(
      (r) => console.log('airtable pull', JSON.stringify(r)),
      (e) => console.error('airtable pull failed', e),
    ));
  },
};
