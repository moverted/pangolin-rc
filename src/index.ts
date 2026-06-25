import { Hono } from 'hono';
import { cors } from 'hono/cors';
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
import { syncRoutes, pullChanges, airtableEnabled } from './handlers/airtable';
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
