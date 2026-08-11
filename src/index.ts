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
import { schedulerRoutes }  from './handlers/scheduler';
import { catalogRoutes }    from './handlers/catalog';
import { syncRoutes, pullChanges, airtableEnabled, pushRow } from './handlers/airtable';
import { processQueue }     from './queue';

export { ResourceCoordinator } from './do/resource-coordinator';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Co-view reveal delay: a friend's comment surfaces to the second viewer 30
// seconds AFTER the mark it was spoken at (an 8:00 comment plays at 8:30). This
// gives the second viewer a beat past the moment before the reaction lands, and
// it's the same offset the live player uses to fire the audio. Server-enforced so
// no text/audio/phone for a comment crosses the wire before mark + this.
const COVIEW_REVEAL_OFFSET_MS = 30_000;

// A member may leave at most this many ORIGINAL (non-reply) comments per episode.
// Replies don't count against the cap. Enforced server-side in POST /transcribe;
// the LOG face mirrors it in the "X of 5" counter and disarms the new-comment mic.
const COVIEW_MAX_COMMENTS_PER_EPISODE = 5;

// A member may leave at most this many END-NOTES (end-of-episode reflections) per
// episode. Separate from the 5-comment cap above and counted independently
// (is_endnote = 1). See COMMENT_CLIP_SHARE.md "Revision — 2026-07-29".
const ENDNOTE_MAX_PER_EPISODE = 1;

// Transcribe endpoint - direct handler to avoid routing issues
app.options('/transcribe', (c) => {
  return c.json({ ok: true });
});

app.post('/transcribe', async (c) => {
  try {
    const formData = await c.req.formData();
    const audio = formData.get('audio') as unknown as File;
    let   episodeId = formData.get('episodeId') as string;
    let   showId = (formData.get('showId') as string) || '';
    const userEmail = (formData.get('userEmail') as string) || '';
    let   timestampMs = parseInt(formData.get('timestampMs') as string) || 0;
    // Optional: this audio is a REPLY to a friend's comment (the OTT reply path —
    // the second viewer's phone is free to record while the show is on the TV).
    const replyTo = ((formData.get('replyTo') as string) || '').trim();
    // An END-NOTE is the end-of-episode reflection from the Pierre finish flow: it
    // carries an explicit SPLR/NOSP label, reveals only when a friend FINISHES the
    // episode, is capped at 1 per episode, and can't be replied to. An end-note is
    // also a reflection (exempt from the 5-comment cap), so isEndnote implies it.
    const isEndnote = ((formData.get('endnote') as string) || '') === '1';
    const isSpoiler = ((formData.get('spoiler') as string) || '') === '1';
    // A finished-episode reflection is a co-view comment that is EXEMPT from the
    // per-episode cap — it neither gets rejected by it nor counts toward it.
    const isReflection = isEndnote || ((formData.get('reflection') as string) || '') === '1';
    // Private (journal) reflection: stored + transcribed but kept OUT of the co-view feed
    // until the member taps Share (which flips it public via /publish). Reflections only.
    const isPrivate = ((formData.get('private') as string) || '') === '1';

    const email = userEmail.trim();
    // Typed reflection (no audio): store the typed text as the comment's transcription so
    // it behaves like a recorded reflection everywhere (editable, trashable, on the ticket).
    const typedText = ((formData.get('text') as string) || '').trim().slice(0, 2000);
    if (!audio && typedText && episodeId) {
      if (!email || email === 'anonymous') return c.json({ error: 'sign in required' }, 401);
      const known = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
      if (!known) return c.json({ error: 'unknown user' }, 401);
      const id = crypto.randomUUID(); const now = Date.now();
      await c.env.DB.prepare(
        `INSERT INTO watch_comment (id, user_email, episode_id, show_id, timestamp_ms, transcription, audio_r2_key, reply_to, is_reflection, is_endnote, spoiler, reveal_on, private, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, email, episodeId, showId || null, 0, typedText, null, null, isReflection ? 1 : 0, 0, 0, null, isPrivate ? 1 : 0, now).run();
      return c.json({ id, transcription: typedText, audioUrl: null });
    }

    if (!audio || !episodeId) {
      return c.json({ error: 'missing audio or episodeId' }, 400);
    }

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

    // Audio reply: thread it under the parent and anchor it at the parent's mark
    // (so it surfaces with the original), but only if the replier is a mutual
    // follow of the parent's author — same authorization as a text reply.
    let replyParent: string | null = null;
    if (replyTo) {
      const parent: any = await c.env.DB
        .prepare('SELECT id, user_email, episode_id, show_id, timestamp_ms, is_endnote FROM watch_comment WHERE id = ?')
        .bind(replyTo)
        .first();
      if (!parent) return c.json({ error: 'parent comment not found' }, 404);
      // End-notes are terminal — react with your own end-note, never a reply.
      if (parent.is_endnote) return c.json({ error: 'end-notes can\'t be replied to' }, 409);
      const mutual = await c.env.DB
        .prepare(
          `SELECT 1 FROM follows a
             JOIN follows b ON b.follower_email = a.followee_email
                           AND b.followee_email = a.follower_email
            WHERE a.follower_email = ? AND a.followee_email = ?`
        )
        .bind(email, parent.user_email)
        .first();
      if (!mutual) return c.json({ error: 'not permitted to reply' }, 403);
      // One reply per comment, first-come-locked. The UNIQUE(reply_to) index is the
      // race-safe guard (caught on INSERT below); this pre-check avoids uploading audio
      // to R2 for a reply that would be rejected anyway.
      const answered = await c.env.DB
        .prepare('SELECT 1 FROM watch_comment WHERE reply_to = ?')
        .bind(parent.id)
        .first();
      if (answered) return c.json({ error: 'already answered', code: 'reply_locked' }, 409);
      replyParent = parent.id;
      episodeId = parent.episode_id;
      showId = parent.show_id || showId;
      timestampMs = parent.timestamp_ms;   // anchor at the parent's mark, not the device clock
    } else if (isEndnote && showId) {
      // End-note cap: at most ENDNOTE_MAX_PER_EPISODE per member per (show, episode),
      // counted independently of the 5-comment cap (is_endnote = 1).
      const existing = await c.env.DB
        .prepare(
          `SELECT COUNT(*) AS n FROM watch_comment
            WHERE user_email = ? AND episode_id = ? AND show_id IS ? AND is_endnote = 1`
        )
        .bind(email, episodeId, showId || null)
        .first<{ n: number }>();
      if ((existing?.n ?? 0) >= ENDNOTE_MAX_PER_EPISODE) {
        return c.json(
          { error: 'You already left an end-of-episode note here.', code: 'endnote_capped' },
          409
        );
      }
    } else if (showId && !isReflection) {
      // Original co-view comment (not a reply, not a reflection): cap at
      // COVIEW_MAX_COMMENTS_PER_EPISODE per member per (show, episode). Count this
      // member's existing originals for the episode and reject the one that would
      // exceed the cap. Same watch_comment table the insert below writes to. Replies
      // and reflections are exempt; reflections also don't COUNT (is_reflection = 0
      // filter). Uploads with NO showId — Pierre-notes (episodeId 'pierre-note') use
      // /transcribe purely to get a transcription — are NOT co-view comments and skip
      // the cap, or they'd all pile into one show_id-NULL bucket and jam after five.
      const existing = await c.env.DB
        .prepare(
          `SELECT COUNT(*) AS n FROM watch_comment
            WHERE user_email = ? AND episode_id = ? AND show_id IS ? AND reply_to IS NULL AND is_reflection = 0`
        )
        .bind(email, episodeId, showId || null)
        .first<{ n: number }>();
      if ((existing?.n ?? 0) >= COVIEW_MAX_COMMENTS_PER_EPISODE) {
        return c.json(
          { error: `You've left the most comments possible on this episode (${COVIEW_MAX_COMMENTS_PER_EPISODE}). Replies still work.` },
          409
        );
      }
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
    // End-notes reveal on the friend's finish (not a minute); in-episode comments keep
    // the mark-anchored reveal (reveal_on = NULL).
    const revealOn = isEndnote ? 'finish' : null;
    try {
      await c.env.DB.prepare(
        `INSERT INTO watch_comment (id, user_email, episode_id, show_id, timestamp_ms, transcription, audio_r2_key, reply_to, is_reflection, is_endnote, spoiler, reveal_on, private, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(commentId, email, episodeId, showId || null, timestampMs, transcription || null, r2Key, replyParent, isReflection ? 1 : 0, isEndnote ? 1 : 0, isSpoiler ? 1 : 0, revealOn, isPrivate ? 1 : 0, now)
        .run();
    } catch (err) {
      // UNIQUE(reply_to) — a racing reply beat this one to the parent. Purge the audio
      // we just stored so it isn't orphaned, and report the lock.
      if (replyParent && /UNIQUE/i.test(String(err))) {
        await c.env.RAW_BUCKET.delete(r2Key).catch(() => {});
        return c.json({ error: 'already answered', code: 'reply_locked' }, 409);
      }
      throw err;
    }

    console.log(replyParent ? 'Audio reply saved:' : 'Audio comment saved:', commentId);
    return c.json({
      id: commentId,
      audioUrl: `${new URL(c.req.url).origin}/transcribe/audio/${commentId}`,
      transcription,
      timestamp: timestampMs,
      replyTo: replyParent,
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

  // Range support: media elements (esp. MP4/m4a, whose moov atom may sit at the end)
  // request `Range: bytes=…` and expect a 206 with Content-Range. Without it the
  // browser can stall on load / can't seek. Honor it; fall back to a full 200.
  const head = await c.env.RAW_BUCKET.head(row.audio_r2_key);
  if (!head) return c.json({ error: 'audio not in storage' }, 404);
  const total = head.size;
  const rangeHeader = c.req.header('range') || '';
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  const headers = new Headers();
  head.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'audio/webm');
  headers.set('Cache-Control', 'private, max-age=86400');
  headers.set('Accept-Ranges', 'bytes');

  if (m && (m[1] || m[2])) {
    const g1 = m[1] || '', g2 = m[2] || '';
    const start = g1 ? parseInt(g1, 10) : Math.max(0, total - parseInt(g2, 10));
    const end = g1 ? (g2 ? Math.min(parseInt(g2, 10), total - 1) : total - 1) : total - 1;
    if (Number.isNaN(start) || start > end || start >= total) {
      headers.set('Content-Range', `bytes */${total}`);
      return new Response(null, { status: 416, headers });
    }
    const object = await c.env.RAW_BUCKET.get(row.audio_r2_key, { range: { offset: start, length: end - start + 1 } });
    if (!object) return c.json({ error: 'audio not in storage' }, 404);
    headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  const object = await c.env.RAW_BUCKET.get(row.audio_r2_key);
  if (!object) return c.json({ error: 'audio not in storage' }, 404);
  headers.set('Content-Length', String(total));
  return new Response(object.body, { headers });
});

// One-time transcription fix. The author corrects Whisper's text once; after
// that transcript_edited is set and further edits are refused (409). Author-only.
app.patch('/transcribe/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const email = (body.email || '').trim();
  const text = (body.text || '').trim();
  if (!email || !text) return c.json({ error: 'email and text are required' }, 400);
  if (text.length > 2000) return c.json({ error: 'transcription too long' }, 400);

  const row: any = await c.env.DB
    .prepare('SELECT user_email, transcript_edited, COALESCE(private,0) AS private FROM watch_comment WHERE id = ?')
    .bind(id)
    .first();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.user_email !== email) return c.json({ error: 'not your comment' }, 403);
  // The one-time-edit limit only guards SHARED co-view comments (so a transcript can't be
  // gamed after others have seen it). A private journal reflection is the member's own —
  // freely editable.
  if (row.transcript_edited && !row.private) return c.json({ error: 'already corrected once' }, 409);

  const now = Date.now();
  await c.env.DB
    .prepare('UPDATE watch_comment SET transcription = ?, transcript_edited = ? WHERE id = ?')
    .bind(text, now, id)
    .run();
  return c.json({ id, transcription: text, edited: true });
});

// Delete one of your own audio comments: drop the row + its R2 audio, and clean
// up any replies threaded under it (and their audio) so nothing is orphaned.
// Own-comments only — the caller must match user_email.
app.delete('/transcribe/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const email = (body.email || '').trim();
  if (!email) return c.json({ error: 'email is required' }, 400);

  const row: any = await c.env.DB
    .prepare('SELECT user_email, audio_r2_key FROM watch_comment WHERE id = ?')
    .bind(id)
    .first();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.user_email !== email) return c.json({ error: 'not your comment' }, 403);

  // Gather replies threaded under this comment so we can purge their audio too.
  const { results: replies } = await c.env.DB
    .prepare('SELECT id, audio_r2_key FROM watch_comment WHERE reply_to = ?')
    .bind(id)
    .all();

  const r2Keys = [row.audio_r2_key, ...(replies || []).map((r: any) => r.audio_r2_key)]
    .filter(Boolean);
  await Promise.all(r2Keys.map((k: string) => c.env.RAW_BUCKET.delete(k).catch(() => {})));

  await c.env.DB.prepare('DELETE FROM watch_comment WHERE id = ? OR reply_to = ?')
    .bind(id, id)
    .run();

  return c.json({ id, deleted: true });
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
      `SELECT id, episode_id, timestamp_ms, transcription, transcript_edited, reply_to,
              is_endnote, spoiler, reveal_on, created_at
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
    edited: !!r.transcript_edited,   // true → the one correction is spent, lock the pencil
    replyTo: r.reply_to || null,     // non-null → a reply; excluded from the per-episode cap count
    endNote: !!r.is_endnote,         // true → render the SPLR/NOSP episode label, not a timecode
    spoiler: !!r.spoiler,            // the SPLR/NOSP choice (only meaningful when endNote)
    revealOn: r.reveal_on || null,   // 'finish' for end-notes
    createdAt: r.created_at,
    audioUrl: `${origin}/transcribe/audio/${r.id}`,
  }));
  return c.json({ comments });
});

// Publish a private (journaled) reflection → flip it to a public co-view comment when the
// member taps Share. Scoped to the member's own comment (id + user_email).
app.post('/transcribe/comments/:id/publish', async (c) => {
  const id = c.req.param('id');
  let email = '';
  try { const b: any = await c.req.json(); email = ((b && b.email) || '').trim(); } catch {}
  if (!email) email = (c.req.query('email') || '').trim();
  if (!id || !email) return c.json({ error: 'id and email required' }, 400);
  await c.env.DB
    .prepare('UPDATE watch_comment SET private = 0 WHERE id = ? AND user_email = ?')
    .bind(id, email)
    .run();
  return c.json({ ok: true });
});

// Finalize a RECORDED end-note. The shell mic uploads the clip the instant recording
// stops (private=1) — before the member picks SPLR/NOSP and Share/Journal — so this
// stamps the choice afterward: mark it an end-note (is_endnote + reveal_on='finish'),
// persist the spoiler flag, and (on Share) flip it public. Journal leaves private=1.
// Own-comment only. Named /finalize (not /endnote) so its static tail doesn't collide
// with the standalone POST /transcribe/endnote in Hono's RegExpRouter. See
// COMMENT_CLIP_SHARE.md "Revision — 2026-07-29".
app.post('/transcribe/comments/:id/finalize', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const email = (body.email || '').trim();
  const isSpoiler = body.spoiler === true || body.spoiler === 1 || body.spoiler === '1';
  const publish = body.publish === true || body.publish === 1 || body.publish === '1';
  if (!id || !email) return c.json({ error: 'id and email required' }, 400);
  await c.env.DB
    .prepare(
      `UPDATE watch_comment
          SET is_endnote = 1, is_reflection = 1, reveal_on = 'finish',
              spoiler = ?, private = CASE WHEN ? THEN 0 ELSE private END
        WHERE id = ? AND user_email = ?`
    )
    .bind(isSpoiler ? 1 : 0, publish ? 1 : 0, id, email)
    .run();
  return c.json({ ok: true, endNote: true, spoiler: isSpoiler, published: publish });
});

// A TYPED end-note (the finish flow's "type it" path). Unlike a recorded end-note
// (POST /transcribe with endnote=1), there is no audio, so it lands here as a text-only
// co-view comment. Same rules: is_endnote + reveal_on='finish', explicit SPLR/NOSP,
// capped at 1 per episode, private until Share (Journal keeps private=1). See
// COMMENT_CLIP_SHARE.md "Revision — 2026-07-29".
app.post('/transcribe/endnote', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const email = (body.email || '').trim();
  const showId = (body.showId || '').trim();
  const episodeId = (body.episodeId || '').trim();
  const text = (body.text || '').trim();
  const isSpoiler = body.spoiler === true || body.spoiler === 1 || body.spoiler === '1';
  const isPrivate = body.private === true || body.private === 1 || body.private === '1';
  if (!email || !showId || !episodeId || !text) {
    return c.json({ error: 'email, showId, episodeId and text are required' }, 400);
  }
  if (text.length > 2000) return c.json({ error: 'end-note too long' }, 400);

  const known = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (!known) return c.json({ error: 'unknown user' }, 401);

  // End-note cap: 1 per member per (show, episode), counted independently (is_endnote = 1).
  const existing = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM watch_comment
        WHERE user_email = ? AND episode_id = ? AND show_id IS ? AND is_endnote = 1`
    )
    .bind(email, episodeId, showId)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) >= ENDNOTE_MAX_PER_EPISODE) {
    return c.json({ error: 'You already left an end-of-episode note here.', code: 'endnote_capped' }, 409);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO watch_comment (id, user_email, episode_id, show_id, timestamp_ms, transcription, audio_r2_key, reply_to, is_reflection, is_endnote, spoiler, reveal_on, private, created_at)
       VALUES (?, ?, ?, ?, 0, ?, NULL, NULL, 1, 1, ?, 'finish', ?, ?)`
    )
    .bind(id, email, episodeId, showId, text, isSpoiler ? 1 : 0, isPrivate ? 1 : 0, now)
    .run();

  return c.json({ id, endNote: true, spoiler: isSpoiler, private: isPrivate, createdAt: now });
});

// Same-origin image proxy for CDNs that send no CORS header (image.tmdb.org movie posters),
// so the share-card canvas can loadImg them crossOrigin and still toBlob() to share. TVmaze
// (series) posters already send CORS and don't need this. Host-whitelisted; cached at the edge.
app.get('/img', async (c) => {
  const u = c.req.query('u') || '';
  let url: URL;
  try { url = new URL(u); } catch { return c.json({ error: 'bad url' }, 400); }
  if (url.hostname !== 'image.tmdb.org') return c.json({ error: 'host not allowed' }, 403);
  const upstream = await fetch(url.toString(), { cf: { cacheTtl: 86400, cacheEverything: true } } as any);
  if (!upstream.ok) return c.json({ error: 'upstream ' + upstream.status }, 502);
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') || 'image/jpeg',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400',
    },
  });
});

// GET /img/focal?u=<image.tmdb.org poster> → { x, y } in 0..1 for the focal point of the
// poster's main subject (face/eyes, or the single most iconic element), so a wide banner
// crop centers on the hero (Spider-Man's eye, Odysseus's head). Vision call cached in KV.
app.get('/img/focal', async (c) => {
  const u = c.req.query('u') || '';
  let url: URL;
  try { url = new URL(u); } catch { return c.json({ error: 'bad url' }, 400); }
  if (url.hostname !== 'image.tmdb.org') return c.json({ error: 'host not allowed' }, 403);
  const CORS = { 'access-control-allow-origin': '*' };
  const fallback = { x: 0.5, y: 0.45 };
  const key = 'focal2:' + url.pathname;                 // v2 prompt — invalidates old cached points
  const cached = await c.env.ACCESS_KV.get(key).catch(() => null);
  if (cached) { try { return c.json(JSON.parse(cached), 200, CORS); } catch { /* re-derive */ } }
  if (!c.env.ANTHROPIC_API_KEY) return c.json(fallback, 200, CORS);
  try {
    const up = await fetch(url.toString(), { cf: { cacheTtl: 86400, cacheEverything: true } } as any);
    if (!up.ok) return c.json(fallback, 200, CORS);
    const mtRaw = up.headers.get('content-type') || 'image/jpeg';
    const mt = /^image\/(jpeg|png|gif|webp)$/.test(mtRaw) ? mtRaw : 'image/jpeg';
    const bytes = new Uint8Array(await up.arrayBuffer());
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': c.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 60,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
          { type: 'text', text:
            'This is a movie poster. Find the main human face(s), or the single most iconic subject if no ' +
            'face. IMPORTANT: posters often place the people in the LOWER half of the frame, below the title ' +
            'text and empty sky/background — report where the face/subject ACTUALLY is, even if it sits low ' +
            'in the frame. Ignore title text and logos. Return ONLY compact JSON {"x":0.NN,"y":0.NN} for the ' +
            'center of that face/subject, as fractions 0..1 from the top-left (y near 0 = top, y near 1 = ' +
            'bottom). No prose.' },
        ] }],
      }),
    });
    if (!res.ok) return c.json(fallback, 200, CORS);
    const d: any = await res.json();
    const txt = (d?.content?.[0]?.text || '').trim();
    const m = txt.match(/\{[^}]*\}/);
    let pt = fallback;
    if (m) { try { const j = JSON.parse(m[0]); if (typeof j.x === 'number' && typeof j.y === 'number')
      pt = { x: Math.min(1, Math.max(0, j.x)), y: Math.min(1, Math.max(0, j.y)) }; } catch { /* keep fallback */ } }
    await c.env.ACCESS_KV.put(key, JSON.stringify(pt), { expirationTtl: 60 * 60 * 24 * 90 }).catch(() => {});
    return c.json(pt, 200, CORS);
  } catch { return c.json(fallback, 200, CORS); }
});

// Co-viewing: friends' audio comments for a show (or one episode), ordered by
// timestamp_ms so the caption player can fire each clip as the wall-clock cursor
// passes it, and the Episode face can render a spoiler-gated timeline. This is
// the relaxed-filter sibling of /transcribe/comments described in the note above
// — own-comments stays its own fast path; this one widens the scope to "the
// friends I'm co-viewing with" and is the only place that authorizes it.
//
// `with` is the viewer's opt-in co-view set; it is treated as a *preference*,
// never as authorization. Every entry is intersected with the viewer's real
// friends (a mutual follow), re-derived from `follows` server-side here.
//
// SPOILER GATE: we return author + timestamp_ms (who + when) for every comment,
// but only include `transcription`/`audioUrl` (the "what") for clips the caller
// has already passed — `seenMs` is the caller's furthest-watched position. The
// reveal is enforced server-side so an unrevealed comment's text never crosses
// the wire early. `episodeId` optional: present → one episode; absent → show-wide.
app.get('/transcribe/coview', async (c) => {
  const showId = c.req.query('showId') ?? '';
  const episodeId = c.req.query('episodeId') ?? '';
  const email = c.req.query('email') ?? '';
  const seenMs = parseInt(c.req.query('seenMs') ?? '', 10);   // NaN → reveal nothing
  const want = (c.req.query('with') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  // Episodes the CALLER has marked finished. End-notes (reveal_on = 'finish') reveal only
  // once the viewer finishes the episode — runtimes drift, so we never trust a minute here.
  const finishedEps = new Set(
    (c.req.query('finishedEps') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  );
  if (!showId || !email || !want.length) return c.json({ comments: [] });

  // Friends = mutual follow (A→B and B→A). Derive, then intersect with `want`.
  const { results: fr } = await c.env.DB
    .prepare(
      `SELECT a.followee_email AS email
         FROM follows a
         JOIN follows b ON b.follower_email = a.followee_email
                       AND b.followee_email = a.follower_email
        WHERE a.follower_email = ?`
    )
    .bind(email)
    .all();
  const friends = new Set((fr || []).map((r: any) => r.email));
  const allowed = want.filter((e) => friends.has(e));
  if (!allowed.length) return c.json({ comments: [] });

  // Friends' comments AND the caller's OWN replies. The own-replies clause is what
  // makes a reply visible: a reply you send threads back under the friend's comment,
  // and a friend's reply to YOUR comment already arrives via the friend clause — the
  // client threads those under your own (non-coview) comment rows.
  const ph = allowed.map(() => '?').join(',');
  // c.private = 0 → journaled (private) reflections never reach a friend's co-view feed.
  const where = ['c.show_id = ?', 'c.private = 0', `(c.user_email IN (${ph}) OR (c.user_email = ? AND c.reply_to IS NOT NULL))`];
  const binds: any[] = [showId, ...allowed, email];
  if (episodeId) { where.push('c.episode_id = ?'); binds.push(episodeId); }
  const { results } = await c.env.DB
    .prepare(
      `SELECT c.id, c.user_email, c.episode_id, c.timestamp_ms, c.transcription,
              c.audio_r2_key, c.reply_to, c.is_endnote, c.spoiler, c.reveal_on,
              c.created_at, u.username, u.phone
         FROM watch_comment c
         LEFT JOIN users u ON u.email = c.user_email
        WHERE ${where.join(' AND ')}
        ORDER BY c.timestamp_ms ASC, c.created_at ASC`
    )
    .bind(...binds)
    .all();

  const origin = new URL(c.req.url).origin;
  const comments = (results || []).map((r: any) => {
    // who + when are always returned; the what — text, audio, AND the author's
    // phone for the reply hand-off — is gated on the reveal rule for this comment.
    // End-notes reveal once the viewer FINISHES the episode (both SPLR and NOSP —
    // identical in-app gate; the spoiler flag only shapes the external card). Every
    // other comment keeps the mark + offset gate.
    const isEndnote = !!r.is_endnote;
    const revealed = isEndnote
      ? finishedEps.has(r.episode_id)
      : Number.isFinite(seenMs) && seenMs >= r.timestamp_ms + COVIEW_REVEAL_OFFSET_MS;
    return {
      id: r.id,
      author: r.username || r.user_email,
      authorEmail: r.user_email,
      episodeId: r.episode_id,
      timestampMs: r.timestamp_ms,
      // When the viewer may see this. End-notes have no minute — they gate on finish.
      revealMs: isEndnote ? null : r.timestamp_ms + COVIEW_REVEAL_OFFSET_MS,
      endNote: isEndnote,           // render the SPLR/NOSP label; not repliable
      spoiler: !!r.spoiler,         // shapes the external card only
      revealOn: r.reveal_on || null,
      createdAt: r.created_at,
      replyTo: r.reply_to || null,
      revealed,
      transcription: revealed ? (r.transcription || '') : null,
      // A reply is text-only (no audio_r2_key); don't hand back a dead audio URL.
      audioUrl: revealed && r.audio_r2_key ? `${origin}/transcribe/audio/${r.id}` : null,
      // Phone powers the sms: reply draft; withheld until revealed so it never
      // leaks ahead of the mark. May be null if the author never set one.
      phone: revealed ? (r.phone || null) : null,
    };
  });
  return c.json({ comments });
});

// ─── Co-view replies ─────────────────────────────────────────────────────────
// The second viewer replies to a friend's comment. The reply is recorded in-app
// as a watch_comment authored by the replier, threaded under the parent via
// reply_to and inheriting the parent's timestamp_ms so it sits at the same mark.
// (The sms: hand-off is the client's job — this is the durable in-app record so
// the original commenter sees the reply next time they co-view with the replier.)
//
// Authorization mirrors /transcribe/coview: the replier must be a mutual follow
// of the parent's author. The client can't forge a reply to a stranger.
app.post('/transcribe/reply', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const email = (body.email || '').trim();
  const replyTo = (body.replyTo || '').trim();
  const text = (body.text || '').trim();
  if (!email || !replyTo || !text) {
    return c.json({ error: 'email, replyTo and text are required' }, 400);
  }
  if (text.length > 2000) return c.json({ error: 'reply too long' }, 400);

  const known = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (!known) return c.json({ error: 'unknown user' }, 401);

  const parent: any = await c.env.DB
    .prepare('SELECT id, user_email, episode_id, show_id, timestamp_ms, is_endnote FROM watch_comment WHERE id = ?')
    .bind(replyTo)
    .first();
  if (!parent) return c.json({ error: 'parent comment not found' }, 404);
  // End-notes are terminal — react with your own end-note, never a reply.
  if (parent.is_endnote) return c.json({ error: 'end-notes can\'t be replied to' }, 409);

  // Mutual follow between replier and the parent's author (A→B and B→A).
  const mutual = await c.env.DB
    .prepare(
      `SELECT 1 FROM follows a
         JOIN follows b ON b.follower_email = a.followee_email
                       AND b.followee_email = a.follower_email
        WHERE a.follower_email = ? AND a.followee_email = ?`
    )
    .bind(email, parent.user_email)
    .first();
  if (!mutual) return c.json({ error: 'not permitted to reply' }, 403);

  // One reply per comment, first-come-locked. The UNIQUE(reply_to) index is the
  // race-safe guard (caught below); this pre-check gives a clean answer first.
  const answered = await c.env.DB
    .prepare('SELECT 1 FROM watch_comment WHERE reply_to = ?')
    .bind(parent.id)
    .first();
  if (answered) return c.json({ error: 'already answered', code: 'reply_locked' }, 409);

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO watch_comment (id, user_email, episode_id, show_id, timestamp_ms, transcription, audio_r2_key, reply_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .bind(id, email, parent.episode_id, parent.show_id || null, parent.timestamp_ms, text, replyTo, now)
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return c.json({ error: 'already answered', code: 'reply_locked' }, 409);
    throw err;
  }

  return c.json({ id, replyTo, timestampMs: parent.timestamp_ms, createdAt: now });
});

// ─── IRL Theater tickets ─────────────────────────────────────────────────────
// Read a cinema ticket image with Claude vision: date, showtime, theater name.
// Reuses the same Anthropic key as Pierre. Best-effort — any failure returns all
// nulls so the ticket still saves. Haiku is plenty for this little OCR job.
type TicketInfo = { title: string | null; date: string | null; time: string | null; theater: string | null };
async function readTicket(env: Env, buffer: ArrayBuffer, mediaType: string): Promise<TicketInfo> {
  const empty: TicketInfo = { title: null, date: null, time: null, theater: null };
  if (!env.ANTHROPIC_API_KEY) return empty;
  // Anthropic vision accepts jpeg/png/gif/webp; fall back to jpeg for anything else.
  const mt = /^image\/(jpeg|png|gif|webp)$/.test(mediaType) ? mediaType : 'image/jpeg';
  let b64 = '';
  try {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (const byte of bytes) bin += String.fromCharCode(byte);
    b64 = btoa(bin);
  } catch { return empty; }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
            { type: 'text', text:
              'This is a photo or screenshot of a movie theater ticket or screening confirmation. ' +
              'Transcribe four fields EXACTLY as printed, reading carefully — do not infer or normalize: ' +
              '"title" = the movie title (e.g. "Spider-Man: Brand New Day" or "The Odyssey"); drop any ' +
              'trailing "(2026)" year in parentheses. ' +
              '"date" = the screening date as shown, verbatim, including the weekday if present (e.g. ' +
              '"Wed, Jun 24", "Saturday, June 20", or "Aug 6"). It may sit after a label like "STARTS" or ' +
              'inside a highlighted circle/badge — read the actual month + day there. ONLY return null if the ' +
              'sole date is a purely relative phrase ("Next Thursday", "Tomorrow"). Never add or guess a year. ' +
              '"time" = the showtime as printed (e.g. "5:30 PM"). ' +
              '"theater" = the cinema/theater name (e.g. "AMC Burbank 16"). ' +
              'Return ONLY minified JSON with exactly these keys: title, date, time, theater. ' +
              'Use null for any field not present. No prose, no code fence.' },
          ],
        }],
      }),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return empty;
    const parsed = JSON.parse(m[0]) as Partial<TicketInfo>;
    const clean = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);
    return { title: clean(parsed.title), date: clean(parsed.date), time: clean(parsed.time), theater: clean(parsed.theater) };
  } catch {
    return empty;
  }
}

// When a title is watched in a physical theater (service = "IRL Theater"), the
// log button uploads a photo/screengrab of the ticket instead of tracking
// minutes. Mirrors the audio-comment family: image → R2, index row → D1, served
// back through the Worker. Marking the title watched is the client's job.
app.post('/ticket', async (c) => {
  try {
    const form = await c.req.formData();
    const image = form.get('image') as unknown as File | null;
    const showId = (form.get('showId') as string) || '';
    const episodeId = (form.get('episodeId') as string) || '';
    const showName = (form.get('showName') as string) || '';
    const email = ((form.get('userEmail') as string) || '').trim();

    if (!image || image.size === 0) return c.json({ error: 'missing ticket image' }, 400);

    // FK user_email → users(email): reject before storing so we don't orphan an
    // R2 object on a constraint failure (same guard as audio comments).
    if (!email || email === 'anonymous') return c.json({ error: 'sign in required to save a ticket' }, 401);
    const known = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (!known) return c.json({ error: 'unknown user' }, 401);

    const id = crypto.randomUUID();
    const r2Key = `tickets/${showId || 'unknown'}/${id}`;
    const buffer = await image.arrayBuffer();
    const mediaType = image.type || 'image/jpeg';
    await c.env.RAW_BUCKET.put(r2Key, buffer, { httpMetadata: { contentType: mediaType } });

    // Read the stub: pull the date, the showtime, and the theater off the image so
    // the theater can stand in for the streamer ("where is really where"). Best
    // effort — a failure here must never lose the ticket (row is still written).
    const info = await readTicket(c.env, buffer, mediaType);

    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO watch_ticket (id, user_email, show_id, episode_id, show_name, ticket_r2_key, ticket_date, ticket_time, theater, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, email, showId || null, episodeId || null, showName || null, r2Key,
           info.date, info.time, info.theater, now).run();

    return c.json({
      id, episodeId, ticketUrl: `${new URL(c.req.url).origin}/ticket/${id}/image`,
      title: info.title, date: info.date, time: info.time, theater: info.theater, createdAt: now,
    });
  } catch (error) {
    console.error('Ticket upload error:', error);
    return c.json({ error: 'upload failed', details: String(error).substring(0, 200) }, 500);
  }
});

// PATCH /ticket/:id/attach — bind a Pierre-uploaded ticket (show_id was null at read
// time) to the film the client resolved from the OCR'd title. Idempotent.
app.patch('/ticket/:id/attach', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const id = c.req.param('id');
  const showId = ((body.showId as string) || '').trim();
  const showName = ((body.showName as string) || '').trim() || null;
  const episodeId = ((body.episodeId as string) || '').trim() || null;
  // Optional full ISO date (YYYY-MM-DD) — the year-confirmed date for an old ticket, so it
  // sorts and reads correctly instead of the year-less OCR string. Ignored if malformed.
  const rawDate = ((body.ticketDate as string) || '').trim();
  const ticketDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  if (!showId) return c.json({ error: 'showId required' }, 400);
  const res = await c.env.DB
    .prepare('UPDATE watch_ticket SET show_id = ?, show_name = COALESCE(?, show_name), episode_id = COALESCE(?, episode_id), ticket_date = COALESCE(?, ticket_date) WHERE id = ?')
    .bind(showId, showName, episodeId, ticketDate, id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, id, showId });
});

// Stream a stored ticket image back from R2 (R2 has no signed-URL method).
app.get('/ticket/:id/image', async (c) => {
  const row = await c.env.DB
    .prepare('SELECT ticket_r2_key FROM watch_ticket WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ ticket_r2_key: string | null }>();
  if (!row?.ticket_r2_key) return c.json({ error: 'not found' }, 404);
  const object = await c.env.RAW_BUCKET.get(row.ticket_r2_key);
  if (!object) return c.json({ error: 'ticket not in storage' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'private, max-age=86400');
  return new Response(object.body, { headers });
});

// List a member's tickets for one show, newest first, so the Episode face can
// render them on the matching watched rows.
app.get('/tickets', async (c) => {
  const showId = c.req.query('showId') ?? '';
  const email = c.req.query('email') ?? '';
  if (!showId || !email) return c.json({ tickets: [] });
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, episode_id, ticket_date, ticket_time, theater, created_at FROM watch_ticket
        WHERE show_id = ? AND user_email = ? ORDER BY created_at DESC`
    )
    .bind(showId, email)
    .all();
  const origin = new URL(c.req.url).origin;
  const tickets = (results || []).map((r: any) => ({
    id: r.id, episodeId: r.episode_id, createdAt: r.created_at,
    date: r.ticket_date, time: r.ticket_time, theater: r.theater,
    ticketUrl: `${origin}/ticket/${r.id}/image`,
  }));
  return c.json({ tickets });
});

// ─── After-screening reflections ─────────────────────────────────────────────
// A thought shared about a viewing that lives on afterward (vs. a timestamped
// in-playback comment). Saved at the finale-share moment or the viewing's share
// button; surfaced on the completed card. ticket_id ties it to one viewing.
app.post('/reflection', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = ((body.userEmail as string) || '').trim();
  const showId = (body.showId as string) || '';
  const ticketId = (body.ticketId as string) || null;
  const text = ((body.text as string) || '').trim().slice(0, 2000);
  if (!text) return c.json({ error: 'empty reflection' }, 400);
  if (!email || email === 'anonymous') return c.json({ error: 'sign in required' }, 401);
  const known = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (!known) return c.json({ error: 'unknown user' }, 401);

  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO reflection (id, user_email, show_id, ticket_id, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, email, showId || null, ticketId, text, now).run();
  return c.json({ id, showId, ticketId, text, createdAt: now });
});

// Delete one of the caller's own reflections (share-a-thought). Scoped to the email in
// the body so a member can only remove their own. 404 if nothing matched.
app.delete('/reflection/:id', async (c) => {
  const id = c.req.param('id');
  let body: any = {};
  try { body = await c.req.json(); } catch { /* email may also come as a query */ }
  const email = ((body.email as string) || c.req.query('email') || '').trim();
  if (!email) return c.json({ error: 'email required' }, 400);
  const res = await c.env.DB.prepare('DELETE FROM reflection WHERE id = ? AND user_email = ?').bind(id, email).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ id, deleted: true });
});

// List a member's reflections for one show, newest first.
app.get('/reflections', async (c) => {
  const showId = c.req.query('showId') ?? '';
  const email = c.req.query('email') ?? '';
  if (!showId || !email) return c.json({ reflections: [] });
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, ticket_id, text, created_at FROM reflection
        WHERE show_id = ? AND user_email = ? ORDER BY created_at DESC`
    )
    .bind(showId, email)
    .all();
  const reflections = (results || []).map((r: any) => ({
    id: r.id, ticketId: r.ticket_id, text: r.text, createdAt: r.created_at,
  }));
  return c.json({ reflections });
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

// Admin-only bug review surface (powers the 🐞 badge + list on the profile face).
// Gate: the caller must pass ?email= of a user whose user_type is 'admin'. The
// author's address is also accepted as a hardcoded fallback so the surface keeps
// working even if the row is reset — "bulletproof" per the brief. Returns the open
// (not fixed/wontfix) reports plus an open count for the badge.
const HARDCODED_ADMINS = new Set(['edward.m.willett@gmail.com']);
async function isAdmin(env: Env, email: string): Promise<boolean> {
  if (!email) return false;
  if (HARDCODED_ADMINS.has(email)) return true;
  const row = await env.DB.prepare('SELECT user_type FROM users WHERE email = ?').bind(email).first<{ user_type?: string }>();
  return row?.user_type === 'admin';
}
app.get('/bug-reports', async (c) => {
  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!(await isAdmin(c.env, email))) return c.json({ error: 'forbidden' }, 403);
  // Active = anything not in a resolved-type status. status is free-text hand
  // triage, so match case-insensitively and blocklist (not allowlist) the
  // terminal words — an unexpected/typo'd status still surfaces rather than
  // silently hiding a live bug. Newest first; capped for a tappable list.
  const rows = await c.env.DB.prepare(
    `SELECT id, user_email, note, view, url, screenshot_url, status, send_to_claude, claude_status, created_at
       FROM bug_report
      WHERE LOWER(COALESCE(status, '')) NOT IN ('fixed', 'wontfix', 'closed', 'resolved', 'done', 'duplicate')
      ORDER BY created_at DESC
      LIMIT 100`
  ).all();
  const bugs = rows.results || [];
  return c.json({ bugs, open: bugs.length });
});

// The Claude work queue: bugs an admin flagged for an automated pass that no
// consumer has finished yet. A local session, scheduled cloud agent, or GitHub
// Action pulls this, works each one, then PATCHes claude_status to 'done'.
// Admin-gated the same way as the list above.
app.get('/bug-reports/claude-queue', async (c) => {
  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!(await isAdmin(c.env, email))) return c.json({ error: 'forbidden' }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT id, user_email, note, view, url, screenshot_url, status, claude_status, created_at
       FROM bug_report
      WHERE send_to_claude = 1 AND COALESCE(claude_status, 'queued') NOT IN ('done', 'skipped')
      ORDER BY created_at ASC
      LIMIT 50`
  ).all();
  const bugs = rows.results || [];
  return c.json({ bugs, queued: bugs.length });
});

// A consumer marks a queued bug as worked (or skipped). Admin-gated.
app.patch('/bug-reports/:id/claude', async (c) => {
  const id = c.req.param('id');
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (body.email || '').trim().toLowerCase();
  if (!(await isAdmin(c.env, email))) return c.json({ error: 'forbidden' }, 403);
  const status = String(body.claude_status || '');
  if (!['queued', 'working', 'done', 'skipped'].includes(status)) return c.json({ error: 'bad status' }, 400);
  const res = await c.env.DB.prepare('UPDATE bug_report SET claude_status = ? WHERE id = ?').bind(status, id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, id, claude_status: status });
});

// Admin flips the "send to Claude" flag straight from the review panel. Turning
// it on (re)queues the bug (claude_status='queued'); turning it off pulls it from
// the work queue. Admin-gated like the rest.
app.patch('/bug-reports/:id/send-to-claude', async (c) => {
  const id = c.req.param('id');
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (body.email || '').trim().toLowerCase();
  if (!(await isAdmin(c.env, email))) return c.json({ error: 'forbidden' }, 403);
  const on = !!body.send_to_claude;
  const res = on
    ? await c.env.DB.prepare("UPDATE bug_report SET send_to_claude = 1, claude_status = 'queued' WHERE id = ?").bind(id).run()
    : await c.env.DB.prepare('UPDATE bug_report SET send_to_claude = 0 WHERE id = ?').bind(id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, id, send_to_claude: on ? 1 : 0, claude_status: on ? 'queued' : undefined });
});

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
    // "Send to Claude" is admin-only — the form only shows the box to admins, but
    // re-verify server-side so a forged field can't queue work. Queued bugs get
    // claude_status='queued' for a consumer (agent/Action) to pick up.
    const wantsClaude = ((form.get('sendToClaude') as string) || '') === '1';
    const sendToClaude = wantsClaude && (await isAdmin(c.env, email)) ? 1 : 0;

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
      send_to_claude: sendToClaude,
      claude_status: sendToClaude ? 'queued' : null,
      created_at: now,
    };
    await c.env.DB.prepare(
      `INSERT INTO bug_report (id, user_email, note, view, url, user_agent, viewport, screenshot_url, status, send_to_claude, claude_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(row.id, row.user_email, row.note, row.view, row.url, row.user_agent,
            row.viewport, row.screenshot_url, row.status, row.send_to_claude, row.claude_status, row.created_at)
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
app.route('/scheduler',   schedulerRoutes);
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
