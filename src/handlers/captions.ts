import { Hono } from 'hono';
import type { Env } from '../types';

// Second-screen captions. SEAM:captions — the real provider (subtitle DB fetch +
// R2/KV/D1 cache) and the mic-Whisper fallback land in later phases. This is the
// PHASE-1 STUB: it returns a fixed, seeded cue track for any episode id so the
// phone-side renderer + wall-clock sync engine can be exercised end-to-end on a
// real TV with zero external dependencies.
export const captionRoutes = new Hono<{ Bindings: Env }>();

// A short demo track: {start, end} in seconds from playback zero, plus text.
// Spread over the first few minutes so the cursor visibly advances and ff/rw
// nudges land on different lines.
const SEED_CUES = [
  { start: 2,   end: 6,   text: '[ caption sync — phase 1 stub ]' },
  { start: 6,   end: 11,  text: "If you can read this, the top-quarter renderer is live." },
  { start: 11,  end: 16,  text: 'The cursor is wall-clock: time since you pressed play.' },
  { start: 18,  end: 23,  text: 'Tap fast-forward — this line should jump ahead.' },
  { start: 23,  end: 28,  text: 'Tap rewind — and it should fall back.' },
  { start: 30,  end: 36,  text: 'Drift is expected; drag “align” to re-anchor.' },
  { start: 40,  end: 46,  text: 'Each cue shows only inside its own time window.' },
  { start: 60,  end: 66,  text: 'One minute in. Still tracking.' },
  { start: 90,  end: 96,  text: 'Ninety seconds. The offset persists per episode.' },
  { start: 120, end: 126, text: 'Two minutes. Phase 2 swaps this for a real subtitle file.' },
  { start: 150, end: 157, text: 'When no file exists, phase 3 falls back to mic-Whisper.' },
  { start: 180, end: 186, text: 'End of the seeded demo track.' },
];

// GET /captions/:episodeId → { mode:'file', cues } or { mode:'mic' }.
// Phase 1 always returns the seeded file track. The episodeId is accepted and
// echoed so the client can key its persisted alignment offset.
captionRoutes.get('/:episodeId', (c) => {
  const episodeId = c.req.param('episodeId');
  return c.json({ mode: 'file', episodeId, lang: 'en', cues: SEED_CUES });
});
