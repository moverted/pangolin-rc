import { Hono } from 'hono';
import type { Env } from '../types';

// ─── Streaming shadow ────────────────────────────────────────────────────────
// A per-user table of every title they have WATCHED, MENTIONED, or DISCUSSED with
// Pierre. Pierre auto-writes it (watch data + the [SHADOW] chat tag + the game), the
// user reshapes it (edit feel/sentiment, cut rows), and Pierre reads it back so he
// references what he already knows and the game stops re-offering known titles.
// SEAM:identity — email is the key, owner-scoped by matching user_email, no auth here.
export const shadowRoutes = new Hono<{ Bindings: Env }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODEL = 'claude-sonnet-4-6';
const SENTIMENTS = new Set(['love', 'like', 'meh', 'nope', '']);
// Four-way classification so ranking is apples-to-apples within a kind. Rank prefixes:
// S=series, M=miniseries, A=anthology, F=film. series = ongoing multi-season; miniseries =
// one self-contained limited run; anthology = each season/episode a standalone story
// (True Detective, Black Mirror, Fargo, The White Lotus); film = a movie.
const KINDS = new Set(['series', 'miniseries', 'anthology', 'film', '']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lc = (s: string) => s.trim().toLowerCase();

// Tiers are SUBJECTIVE, stored buckets — not a rank band. A member can pile 30 shows into
// "Top 10"; it's a loose way to place a show broadly, then refine its rank within. Pierre
// places a show into a tier through conversation.
const TIERS = new Set(['Top 10', 'Top 25', 'Top 50', '']);
// Parse a tier the member/Pierre named ("top 10", "10", "Top25", "Top 50") into its canonical
// label, or '' to clear / null if unrecognized.
function tierCanon(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (s === '') return '';
  const m = s.match(/(10|25|50)/);
  return m ? 'Top ' + m[1] : null;
}
// SQL ordering for tiers: Top 10 first, unset last. Shared by GET + rerank + admin.
const TIER_ORDER_SQL = "CASE tier WHEN 'Top 10' THEN 0 WHEN 'Top 25' THEN 1 WHEN 'Top 50' THEN 2 ELSE 3 END";

export type ShadowEntry = {
  title_name: string;
  title_id?: string | null;
  kind?: string;
  feel?: string;
  sentiment?: string;
  source?: string;
};

// Upsert one entry. A re-mention bumps weight and refreshes feel/sentiment only when the
// new call actually carries them; it never resurrects a row the user cut (hidden stays as
// is), and never overwrites a title_id/kind already known with a blank.
export async function upsertShadow(env: Env, email: string, e: ShadowEntry): Promise<void> {
  const name = str(e.title_name, 200);
  if (!email || !name) return;
  const sentiment = SENTIMENTS.has(lc(e.sentiment || '')) ? lc(e.sentiment || '') : '';
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO streaming_shadow
       (id, user_email, title_id, title_name, kind, feel, sentiment, source, weight, hidden, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'circle', ?, ?)
     ON CONFLICT(user_email, title_name) DO UPDATE SET
       weight     = streaming_shadow.weight + 1,
       title_id   = COALESCE(streaming_shadow.title_id, excluded.title_id),
       kind       = CASE WHEN streaming_shadow.kind = '' THEN excluded.kind ELSE streaming_shadow.kind END,
       feel       = CASE WHEN excluded.feel      <> '' THEN excluded.feel      ELSE streaming_shadow.feel      END,
       sentiment  = CASE WHEN excluded.sentiment <> '' THEN excluded.sentiment ELSE streaming_shadow.sentiment END,
       updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(), email, str(e.title_id || '', 60) || null, name,
      str(e.kind || '', 12), str(e.feel || '', 400), sentiment, str(e.source || 'chat', 12),
      now, now,
    )
    .run();
}

// GET /shadow?email=&all=1 — the owner's shadow. Default hides rows they cut; all=1
// returns them too (for the craft UI, which shows a "cut" row so it can be restored).
shadowRoutes.get('/', async (c) => {
  const email = lc(c.req.query('email') || '');
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);
  const all = c.req.query('all') === '1';
  const rs = await c.env.DB.prepare(
    `SELECT id, title_id, title_name, kind, feel, note, sentiment, source, weight, hidden, rank, tier, visibility, updated_at
       FROM streaming_shadow
      WHERE user_email = ?1 ${all ? '' : 'AND hidden = 0'}
      ORDER BY kind ASC, ${TIER_ORDER_SQL} ASC, CASE WHEN rank > 0 THEN rank ELSE 999999 END ASC, weight DESC, updated_at DESC`,
  ).bind(email).all();
  return c.json({ shadow: rs.results ?? [] });
});

// POST /shadow — add/upsert a title. { email, title_name, feel?, sentiment?, kind?, source? }
// source is honored when it is one of watch/game/chat/manual (default manual) — the game uses
// 'game' to record the two titles the member names and the pick they put on.
const SOURCES = new Set(['watch', 'game', 'chat', 'manual']);
shadowRoutes.post('/', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = lc(str(body.email, 120));
  const title_name = str(body.title_name, 200);
  if (!EMAIL_RE.test(email) || !title_name) return c.json({ error: 'email and title_name required' }, 400);
  const source = SOURCES.has(lc(str(body.source, 12))) ? lc(str(body.source, 12)) : 'manual';
  await upsertShadow(c.env, email, {
    title_name, feel: str(body.feel, 400), sentiment: str(body.sentiment, 12),
    kind: str(body.kind, 12), title_id: str(body.title_id, 60), source,
  });
  return c.json({ ok: true });
});

// PUT /shadow/:id — owner edit of feel / sentiment / hidden. { email, feel?, sentiment?, hidden? }
shadowRoutes.put('/:id', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const id = c.req.param('id');
  const email = lc(str(body.email, 120));
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.feel === 'string') { sets.push('feel = ?'); vals.push(str(body.feel, 400)); }
  if (typeof body.note === 'string') { sets.push('note = ?'); vals.push(str(body.note, 1000)); }
  if (typeof body.kind === 'string') { const k = lc(body.kind); if (!KINDS.has(k)) return c.json({ error: 'bad kind' }, 400); sets.push('kind = ?'); vals.push(k); }
  if (typeof body.tier === 'string') { const t = tierCanon(body.tier); if (t === null) return c.json({ error: 'bad tier' }, 400); sets.push('tier = ?'); vals.push(t); }
  if (typeof body.sentiment === 'string') {
    const s = lc(body.sentiment);
    if (!SENTIMENTS.has(s)) return c.json({ error: 'bad sentiment' }, 400);
    sets.push('sentiment = ?'); vals.push(s);
  }
  if (body.hidden === 0 || body.hidden === 1) { sets.push('hidden = ?'); vals.push(body.hidden); }
  if (typeof body.rank === 'number' && Number.isFinite(body.rank)) { sets.push('rank = ?'); vals.push(Math.max(0, Math.trunc(body.rank))); }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  sets.push('updated_at = ?'); vals.push(Date.now());
  const res = await c.env.DB.prepare(
    `UPDATE streaming_shadow SET ${sets.join(', ')} WHERE id = ? AND user_email = ?`,
  ).bind(...vals, id, email).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// DELETE /shadow/:id?email= — owner cut. Soft delete (hidden=1) so a re-mention does not
// resurrect what they deliberately crafted out.
shadowRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const email = lc(c.req.query('email') || '');
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);
  const res = await c.env.DB.prepare(
    'UPDATE streaming_shadow SET hidden = 1, updated_at = ? WHERE id = ? AND user_email = ?',
  ).bind(Date.now(), id, email).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// One model pass: extract every show/film the member mentioned or discussed across their
// Pierre transcripts, each with a one-line feel and a sentiment. Soft grounding (name
// only); returns [] on any failure so rebuild still lands the watch-data rows.
async function extractDiscussed(
  env: Env, transcript: string,
): Promise<Array<{ title: string; feel: string; sentiment: string }>> {
  if (!env.ANTHROPIC_API_KEY || !transcript.trim()) return [];
  const prompt =
    'Below is a transcript between a member and Pierre, a TV concierge. List every real TV show or film the member MENTIONED or DISCUSSED — ones they have seen, are curious about, love, or hate. ' +
    'For each, give a one-line "feel" in the member\'s own register (what they think of it or why it came up) and a sentiment from exactly: love, like, meh, nope (use "" if genuinely unclear). ' +
    'Skip titles Pierre merely suggested that the member did not react to. Do not invent titles.\n' +
    'Return only minified JSON, no prose, no code fence: {"titles":[{"title":"Name","feel":"one line","sentiment":"love|like|meh|nope|"}]}\n\nTRANSCRIPT:\n' +
    transcript.slice(0, 24000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]) as { titles?: unknown };
    if (!Array.isArray(parsed.titles)) return [];
    return parsed.titles
      .filter((t: any) => t && typeof t.title === 'string' && t.title.trim())
      .map((t: any) => ({
        title: String(t.title).trim().slice(0, 200),
        feel: (typeof t.feel === 'string' ? t.feel.trim() : '').slice(0, 400),
        sentiment: SENTIMENTS.has(lc(t.sentiment || '')) ? lc(t.sentiment || '') : '',
      }));
  } catch {
    return [];
  }
}

// Assign rank 1..N PER KIND (apples-to-apples), best-effort: within each kind, sentiment
// first (love > like > meh > nope > unset), then weight desc, then most-recent. So each of
// series / miniseries / anthology / movie gets its own 1..N. Hidden rows stay rank 0.
async function rerankShadow(env: Env, email: string): Promise<number> {
  const rs = await env.DB.prepare(
    `SELECT id, kind FROM streaming_shadow
      WHERE user_email = ?1 AND hidden = 0
      ORDER BY kind ASC, ${TIER_ORDER_SQL} ASC,
               CASE sentiment WHEN 'love' THEN 0 WHEN 'like' THEN 1 WHEN 'meh' THEN 2 WHEN 'nope' THEN 3 ELSE 4 END ASC,
               weight DESC, updated_at DESC`,
  ).bind(email).all<{ id: string; kind: string }>();
  const rows = rs.results ?? [];
  if (!rows.length) return 0;
  const now = Date.now();
  const perKind: Record<string, number> = {};
  const stmts = rows.map((r) => {
    const k = r.kind || '';
    perKind[k] = (perKind[k] || 0) + 1;
    return env.DB.prepare('UPDATE streaming_shadow SET rank = ?, updated_at = ? WHERE id = ?').bind(perKind[k], now, r.id);
  });
  await env.DB.batch(stmts);
  return rows.length;
}

// One model pass to classify a user's titles into series / miniseries / anthology / movie.
// tmdb: title_ids are films regardless. Best-effort; returns count updated.
async function classifyShadow(env: Env, email: string): Promise<number> {
  const rs = await env.DB.prepare(
    'SELECT id, title_name, title_id, kind FROM streaming_shadow WHERE user_email = ?1 AND hidden = 0',
  ).bind(email).all<{ id: string; title_name: string; title_id: string | null; kind: string }>();
  const rows = rs.results ?? [];
  if (!rows.length) return 0;
  const now = Date.now();
  const stmts: any[] = [];
  const setK = (id: string, k: string) => stmts.push(
    env.DB.prepare('UPDATE streaming_shadow SET kind = ?, updated_at = ? WHERE id = ?').bind(k, now, id),
  );
  // LLM classification, keyed by lowercased title. Films from tmdb: ids are forced to movie.
  let map: Record<string, string> = {};
  if (env.ANTHROPIC_API_KEY) map = await llmClassify(env, rows.map((r) => r.title_name));
  for (const r of rows) {
    // Idempotent + edit-safe: once a row has one of the four real kinds (LLM- or human-set),
    // leave it. Only (re)classify the unclassified ('') and legacy ('show') rows. This keeps
    // a rebuild/re-run from reshuffling the LLM's earlier guesses or clobbering manual edits.
    if (r.kind && KINDS.has(r.kind)) continue;
    let k = '';
    if (String(r.title_id || '').startsWith('tmdb:')) k = 'film';
    else { const g = map[lc(r.title_name)]; if (g && KINDS.has(g)) k = g; }
    // Legacy watch-fold tokens: 'show' → series, 'movie' → film, if nothing better was found.
    if (!k && r.kind === 'show') k = 'series';
    if (!k && r.kind === 'movie') k = 'film';
    if (k && k !== r.kind) setK(r.id, k);
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

async function llmClassify(env: Env, titles: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, 200);
  if (!uniq.length) return {};
  const prompt =
    'Classify each TV/film title into EXACTLY one kind:\n' +
    '- series = an ongoing, multi-season scripted show\n' +
    '- miniseries = a single self-contained limited run (one season, made to end)\n' +
    '- anthology = each season or episode is a standalone story with new characters/setting (True Detective, Black Mirror, Fargo, The White Lotus, American Horror Story)\n' +
    '- film = a movie\n' +
    'Use your best judgment; when a show is borderline series-vs-miniseries, prefer series if it got multiple seasons. Do not invent titles.\n' +
    'Return only minified JSON, no prose: {"items":[{"title":"Exact Title","kind":"series|miniseries|anthology|film"}]}\n\nTITLES:\n' +
    uniq.map((t) => '- ' + t).join('\n');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return {};
    const parsed = JSON.parse(m[0]) as { items?: unknown };
    const out: Record<string, string> = {};
    if (Array.isArray(parsed.items)) for (const it of parsed.items as any[]) {
      if (it && typeof it.title === 'string' && typeof it.kind === 'string') { const k = lc(it.kind); if (KINDS.has(k) && k) out[lc(it.title)] = k; }
    }
    return out;
  } catch {
    return {};
  }
}

// Compact ranks to a clean 1..N per kind while PRESERVING the current order — fixes dup
// ranks (from manual number edits) and gaps (from kind changes) without the heuristic resort
// that rerank does, so a member's hand-ordering survives.
async function compactRanks(env: Env, email: string): Promise<number> {
  const rs = await env.DB.prepare(
    `SELECT id, kind FROM streaming_shadow WHERE user_email = ?1 AND hidden = 0
      ORDER BY kind ASC, ${TIER_ORDER_SQL} ASC, CASE WHEN rank > 0 THEN rank ELSE 999999 END ASC, weight DESC, updated_at DESC`,
  ).bind(email).all<{ id: string; kind: string }>();
  const rows = rs.results ?? [];
  if (!rows.length) return 0;
  const now = Date.now();
  const perKind: Record<string, number> = {};
  await env.DB.batch(rows.map((r) => {
    const k = r.kind || '';
    perKind[k] = (perKind[k] || 0) + 1;
    return env.DB.prepare('UPDATE streaming_shadow SET rank = ?, updated_at = ? WHERE id = ?').bind(perKind[k], now, r.id);
  }));
  return rows.length;
}

// POST /shadow/compact { email } — normalize ranks to 1..N per kind, keeping current order.
shadowRoutes.post('/compact', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = lc(str(body.email, 120));
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);
  const n = await compactRanks(c.env, email);
  return c.json({ ok: true, compacted: n });
});

// POST /shadow/rerank { email } — recompute the per-kind auto-ranking.
shadowRoutes.post('/rerank', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = lc(str(body.email, 120));
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);
  const n = await rerankShadow(c.env, email);
  return c.json({ ok: true, ranked: n });
});

// POST /shadow/place { email, title_name, tier, kind?, feel?, sentiment? } — Pierre (or the
// admin) places a title into a SUBJECTIVE tier bucket (Top 10 / Top 25 / Top 50). Upserts the
// title, resolves the kind (given → existing → LLM → series), and sets its tier — that's the
// broad placement; fine ordering within the tier is the rank, adjusted separately. Returns
// kind + tier.
shadowRoutes.post('/place', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = lc(str(body.email, 120));
  const title_name = str(body.title_name, 200);
  const tier = tierCanon(body.tier);
  if (!EMAIL_RE.test(email) || !title_name) return c.json({ error: 'email and title_name required' }, 400);
  if (!tier) return c.json({ error: 'tier must be Top 10, Top 25, or Top 50' }, 400);
  let kind = lc(str(body.kind, 12)); if (!KINDS.has(kind)) kind = '';
  await upsertShadow(c.env, email, { title_name, kind, feel: str(body.feel, 400), sentiment: str(body.sentiment, 12), source: 'chat' });
  const row = await c.env.DB.prepare(
    'SELECT id, kind FROM streaming_shadow WHERE user_email = ?1 AND title_name = ?2',
  ).bind(email, title_name).first<{ id: string; kind: string }>();
  if (!row) return c.json({ error: 'could not place' }, 500);
  let effKind = kind || row.kind;
  if (!effKind || !KINDS.has(effKind)) {
    const g = c.env.ANTHROPIC_API_KEY ? await llmClassify(c.env, [title_name]) : {};
    const guess = g[lc(title_name)];
    effKind = guess && KINDS.has(guess) && guess !== '' ? guess : 'series';
  }
  await c.env.DB.prepare('UPDATE streaming_shadow SET kind = ?, tier = ?, updated_at = ? WHERE id = ?')
    .bind(effKind, tier, Date.now(), row.id).run();
  return c.json({ ok: true, kind: effKind, tier });
});

// POST /shadow/classify { email } — (re)classify the user's titles into the four kinds,
// then re-rank per kind so ranks stay apples-to-apples.
shadowRoutes.post('/classify', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = lc(str(body.email, 120));
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);
  const classified = await classifyShadow(c.env, email);
  const ranked = await rerankShadow(c.env, email);
  return c.json({ ok: true, classified, ranked });
});

// POST /shadow/rebuild { email } — backfill the shadow from what already exists:
//   (1) their watch_title rows (real watch data), and
//   (2) an LLM pass over their Pierre transcripts (everything mentioned/discussed).
// Idempotent: every write is an upsert keyed on (user_email, title_name).
shadowRoutes.post('/rebuild', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = lc(str(body.email, 120));
  if (!EMAIL_RE.test(email)) return c.json({ error: 'valid email required' }, 400);

  let watchCount = 0;
  let chatCount = 0;

  // (1) Watch data → source 'watch'. Kind from titles; feel/sentiment left for the user.
  try {
    const rs = await c.env.DB.prepare(
      `SELECT t.name AS name, t.kind AS kind, wt.title_id AS title_id
         FROM watch_title wt JOIN titles t ON t.title_id = wt.title_id
        WHERE wt.user_email = ?1 AND t.name IS NOT NULL`,
    ).bind(email).all<{ name: string; kind: string; title_id: string }>();
    for (const r of rs.results ?? []) {
      await upsertShadow(c.env, email, { title_name: r.name, kind: r.kind || '', title_id: r.title_id, source: 'watch' });
      watchCount++;
    }
  } catch (e) { console.error('shadow rebuild watch', e); }

  // (2) Everything mentioned/discussed across their Pierre transcripts → source 'chat'.
  try {
    const rs = await c.env.DB.prepare(
      `SELECT role, content FROM pierre_chat WHERE user_email = ?1 ORDER BY created_at ASC, seq ASC LIMIT 400`,
    ).bind(email).all<{ role: string; content: string }>();
    const transcript = (rs.results ?? [])
      .map((r) => (r.role === 'user' ? 'Member: ' : 'Pierre: ') + r.content)
      .join('\n');
    const found = await extractDiscussed(c.env, transcript);
    for (const f of found) {
      await upsertShadow(c.env, email, { title_name: f.title, feel: f.feel, sentiment: f.sentiment, source: 'chat' });
      chatCount++;
    }
  } catch (e) { console.error('shadow rebuild chat', e); }

  let classified = 0, ranked = 0;
  try { classified = await classifyShadow(c.env, email); } catch (e) { console.error('shadow rebuild classify', e); }
  try { ranked = await rerankShadow(c.env, email); } catch (e) { console.error('shadow rebuild rerank', e); }

  return c.json({ ok: true, watch: watchCount, chat: chatCount, classified, ranked });
});

// Titles a user already has in their shadow — fed into the game's `avoid` so Pierre does
// not re-offer what they already know, and (top-weighted) into his chat context.
export async function shadowTitleNames(env: Env, email: string, limit = 200): Promise<string[]> {
  if (!EMAIL_RE.test(email)) return [];
  try {
    const rs = await env.DB.prepare(
      'SELECT title_name FROM streaming_shadow WHERE user_email = ?1 AND hidden = 0 ORDER BY weight DESC LIMIT ?2',
    ).bind(email, limit).all<{ title_name: string }>();
    return (rs.results ?? []).map((r) => r.title_name).filter(Boolean);
  } catch {
    return [];
  }
}
