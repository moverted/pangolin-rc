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
app.post('/transcribe', async (c) => {
  try {
    const formData = await c.req.formData();
    const audio = formData.get('audio') as File;
    const episodeId = formData.get('episodeId') as string;
    const userEmail = (formData.get('userEmail') as string) || '';
    const timestampMs = parseInt(formData.get('timestampMs') as string) || 0;

    if (!audio || !episodeId) {
      return c.json({ error: 'missing audio or episodeId' }, 400);
    }

    const email = userEmail || 'anonymous';
    console.log('Transcribing for', episodeId, 'email:', email);

    const arrayBuffer = await audio.arrayBuffer();
    const response = await (c.env.AI as any).run('@cf/openai/whisper', {
      audio: Array.from(new Uint8Array(arrayBuffer)),
    });

    const transcription = response.result?.text || '';
    const commentId = crypto.randomUUID();
    const now = Date.now();

    await c.env.DB.prepare(
      `INSERT INTO watch_comment (id, user_email, episode_id, timestamp_ms, transcription, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(commentId, email, episodeId, timestampMs, transcription, now)
      .run();

    console.log('Transcription saved:', commentId);
    return c.json({ transcription, id: commentId });
  } catch (error) {
    console.error('Transcription error:', error);
    return c.json({ error: 'transcription failed', details: String(error) }, 500);
  }
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
