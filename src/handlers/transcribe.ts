import { Hono } from 'hono';
import type { Env } from '../types';

export const transcribeRoutes = new Hono<{ Bindings: Env }>();

// POST /transcribe - receive audio, transcribe via Workers AI Whisper, save to watch_comment
transcribeRoutes.post('/', async (c) => {
  const formData = await c.req.formData();
  const audio = formData.get('audio') as File;
  const episodeId = formData.get('episodeId') as string;
  const timestampMs = parseInt(formData.get('timestampMs') as string) || 0;

  if (!audio || !episodeId) {
    return c.json({ error: 'missing audio or episodeId' }, 400);
  }

  // Get user email from auth context (assumes auth middleware sets this)
  const email = c.req.header('x-user-email') || '';
  if (!email) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  try {
    // Transcribe audio using Workers AI Whisper
    const arrayBuffer = await audio.arrayBuffer();
    const response = await (c.env.AI as any).run('@cf/openai/whisper', {
      audio: Array.from(new Uint8Array(arrayBuffer)),
    });

    const transcription = response.result?.text || '';

    // Save to watch_comment table
    const commentId = crypto.randomUUID();
    const now = Date.now();

    await c.env.DB.prepare(
      `INSERT INTO watch_comment (id, user_email, episode_id, timestamp_ms, transcription, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(commentId, email, episodeId, timestampMs, transcription, now)
      .run();

    return c.json({ transcription, id: commentId });
  } catch (error) {
    console.error('Transcription error:', error);
    return c.json(
      { error: 'transcription failed', details: String(error) },
      500
    );
  }
});
