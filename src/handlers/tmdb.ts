import { Hono } from 'hono';
import type { Env } from '../types';

// TMDB proxy. The key lives server-side (secret TMDB_API_KEY) and never ships to
// the browser. TVmaze covers TV; TMDB is how the product gets FILMS — search and
// per-title detail (runtime, poster, year). Movies attach to the same `watch`
// pipeline as shows, tagged kind='movie'.
//
// Auth: a v4 "Read Access Token" (a long JWT with dots) goes in the Authorization
// header; a classic v3 key goes in the api_key query param. We detect which.
export const tmdbRoutes = new Hono<{ Bindings: Env }>();

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342'; // poster base; w342 is plenty for a card

const clean = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 200) : '');
const year = (d: unknown) => (typeof d === 'string' && d.length >= 4 ? d.slice(0, 4) : null);

// Build the fetch for a TMDB path, threading the key the right way for its format.
// Exported: Pierre's server-side tools (handlers/pierre.ts) ride the same key.
export function tmdbFetch(env: Env, path: string, params: Record<string, string> = {}) {
  const key = env.TMDB_API_KEY || '';
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key.includes('.')) headers.Authorization = `Bearer ${key}`; // v4 read token
  else url.searchParams.set('api_key', key);                      // v3 key
  return fetch(url.toString(), { headers });
}

// A trimmed movie card the client can render without knowing TMDB's shape.
const card = (m: any) => ({
  id: m.id,
  title: m.title || m.name || '',
  year: year(m.release_date),
  poster: m.poster_path ? IMG + m.poster_path : null,
  overview: typeof m.overview === 'string' ? m.overview : '',
  runtime: typeof m.runtime === 'number' ? m.runtime : null, // only present on /movie/:id
});

const CAST_MAX = 8; // top-billed only — the LOG face shows a line, not TMDB's firehose

// The base card plus credits + production, for the detail view. Requires the
// source object to carry append_to_response=credits. Compact by design: billed
// cast, above-the-line crew (director + writers), and the studios.
const detailCard = (m: any) => {
  const cr = m.credits || {};
  const castRaw: any[] = Array.isArray(cr.cast) ? cr.cast : [];
  const crewRaw: any[] = Array.isArray(cr.crew) ? cr.crew : [];
  const cast = castRaw
    .slice()
    .sort((a, b) => (a?.order ?? 999) - (b?.order ?? 999)) // TMDB billing order
    .filter((p) => p && p.name)
    .slice(0, CAST_MAX)
    .map((p) => ({ name: p.name, character: typeof p.character === 'string' ? p.character : '' }));
  const crewNames = (jobs: string[]) => {
    const out: string[] = [];
    for (const p of crewRaw) {
      if (p && p.name && jobs.includes(p.job) && !out.includes(p.name)) out.push(p.name);
    }
    return out;
  };
  const production = (Array.isArray(m.production_companies) ? m.production_companies : [])
    .map((p: any) => p && p.name)
    .filter(Boolean)
    .slice(0, 4);
  return {
    ...card(m),
    cast,
    directors: crewNames(['Director']),
    writers: crewNames(['Screenplay', 'Writer', 'Story']),
    production,
  };
};

// Run one TMDB movie search and shape the results. Returns [] on any upstream miss
// so the caller can decide whether to try a corrected query.
async function searchMovies(env: Env, query: string): Promise<any[]> {
  let res: Response;
  try {
    res = await tmdbFetch(env, '/search/movie', { query, include_adult: 'false' });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: any[] };
  return (data.results || [])
    .filter((m) => m && m.id && (m.title || m.name))
    .slice(0, 12)
    .map(card);
}

// TMDB's search is punctuation-sensitive: "WALL·E" is found by "WALL.E" but NOT by
// "WALL-E" / "WALL E" (the hyphen/space tokenise into junk like "Dawn Wall"). So for a
// query carrying punctuation, also try dot / collapsed / spaced forms. No punctuation →
// no variants (normal queries stay a single call).
function punctVariants(q: string): string[] {
  if (!/[^A-Za-z0-9\s]/.test(q)) return [];
  const out = new Set<string>([
    q.replace(/[^A-Za-z0-9\s]+/g, '.'),      // WALL-E → WALL.E  (TMDB's happy path)
    q.replace(/[^A-Za-z0-9]+/g, ''),         // WALL-E → WALLE
    q.replace(/[^A-Za-z0-9]+/g, ' ').trim(), // WALL-E → WALL E
  ]);
  out.delete(q);
  return [...out].filter(Boolean);
}

// searchMovies for the query PLUS its punctuation variants, merged & de-duped, so a
// title like "WALL·E" surfaces even when the user typed "WALL-E".
async function searchAll(env: Env, q: string): Promise<any[]> {
  const out = await searchMovies(env, q);
  const seen = new Set(out.map((m) => m.id));
  for (const v of punctVariants(q)) {
    for (const m of await searchMovies(env, v)) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  }
  return out;
}

// ── Fuzzy matching (no LLM) ──────────────────────────────────────────────────
// TMDB's keyword index has no spell/semantic tolerance, so the raw top hit can be
// zero, or a literal-but-wrong title (e.g. "The Odessey" → a Zombies live album).
// These let us judge "is the top hit actually what they asked for" and, when not,
// rank TMDB's LIVE catalogue against the full query — which rescues brand-new
// franchise films the LLM can't recall ("Brave New Day" → "Brand New Day").
const nrm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const toks = (s: string) => nrm(s).split(' ').filter(Boolean);

// Levenshtein edit distance (small strings; iterative two-row DP).
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

// Blend of token F1 (precision + recall of shared words) and whole-string edit
// similarity. 0..1; higher = closer to what the user typed. F1 (not just recall) so a
// padded title ("Pixar Remix: WALL·E in 16-Bit") can't beat the concise exact one
// ("WALL·E") just by containing every word the user typed.
function simScore(q: string, title: string): number {
  const a = nrm(q), b = nrm(title);
  if (!a || !b) return 0;
  const qset = new Set(toks(q)), tset = new Set(toks(title));
  let inter = 0;
  for (const t of qset) if (tset.has(t)) inter++;
  const recall = qset.size ? inter / qset.size : 0;      // query words found in the title
  const precision = tset.size ? inter / tset.size : 0;   // title words that are query words
  const f1 = (recall + precision) ? (2 * recall * precision) / (recall + precision) : 0;
  const editSim = 1 - lev(a, b) / Math.max(a.length, b.length);
  return 0.6 * f1 + 0.4 * editSim;
}

// A confident hit = most query words present AND the title isn't padded with a pile
// of unrelated words (which is how "The Odessey" wrongly matches the Zombies album).
function confident(q: string, title: string): boolean {
  const qt = toks(q), tt = new Set(toks(title));
  if (!qt.length) return false;
  let hit = 0;
  for (const t of qt) if (tt.has(t)) hit++;
  return hit / qt.length >= 0.8 && tt.size <= qt.length + 3;
}

// Broaden a missed query by dropping trailing words to pull the franchise/anchor
// (e.g. "Spider-Man Brave New Day" → "Spider-Man"), accumulating real TMDB rows to
// fuzzy-rank against the full query. No LLM. Seeded with the raw results.
async function broadenSearch(env: Env, q: string, seed: any[]): Promise<any[]> {
  const pool = [...seed];
  const seen = new Set(pool.map((m) => m.id));
  // Split on whitespace only — keep punctuation inside a word so "wall-e" stays intact
  // for searchAll's dot-variant (dropping to nrm tokens would lose it).
  const words = q.trim().split(/\s+/);
  const subs = new Set<string>();
  // Drop trailing words → the franchise anchor ("Spider-Man Brave New Day" → "Spider-Man").
  for (let cut = words.length - 1; cut >= 1; cut--) subs.add(words.slice(0, cut).join(' '));
  // Drop leading words → strip a descriptor prefix ("pixar wall-e" → "wall-e").
  for (let start = 1; start < words.length; start++) subs.add(words.slice(start).join(' '));
  // Search every sub-query (both directions get a fair shot — no early cap that lets a
  // broad term like "pixar" starve the one that isolates the title). Bounded by word count.
  let n = 0;
  for (const sub of subs) {
    if (n++ >= 10) break;
    if (sub.replace(/[^A-Za-z0-9]/g, '').length < 2) continue;
    for (const m of await searchAll(env, sub)) if (!seen.has(m.id)) { seen.add(m.id); pool.push(m); }
  }
  return pool;
}

// The LLM logic gate: for a pure misspelling that returns nothing AND can't be
// rescued from the catalogue ("Gladeator" → "Gladiator"), ask Haiku for the single
// most likely canonical title and let the caller re-run the search. Best-effort —
// any failure returns null so search degrades to plain TMDB. Same key as the ticket
// OCR / Pierre (SEAM:processing).
// Token-burn guard: cap LLM corrections per client to LLM_GATE_MAX in a rolling
// hourly window so a bored user can't spray obscure gibberish and rack up Haiku
// calls. Keyed by client IP in ACCESS_KV. Fail-open (KV hiccup → allow) — the gate
// is a courtesy, not a security boundary; TMDB itself is still the hard path.
const LLM_GATE_MAX = 5;
async function gateAllows(env: Env, ip: string): Promise<boolean> {
  if (!ip) return true;
  const key = `llmgate:${ip}:${Math.floor(Date.now() / 3_600_000)}`; // per-hour bucket
  try {
    const n = parseInt((await env.ACCESS_KV.get(key)) || '0', 10);
    if (n >= LLM_GATE_MAX) return false;
    await env.ACCESS_KV.put(key, String(n + 1), { expirationTtl: 3600 });
    return true;
  } catch {
    return true;
  }
}

// Ask Haiku what mainstream film the user most likely meant. Handles both a pure
// miss (topTitle empty → "Gladeator" → "Gladiator") and the trap where TMDB's only
// hit is an obscure real title that isn't what they meant ("The Odessey" → the
// only hit is a 1968 Zombies album, but they meant "The Odyssey"). Returns null if
// it can't improve on what we have (reply "NONE"), so we don't invent corrections.
async function llmSuggestTitle(env: Env, query: string, topTitle: string): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const content = topTitle
    ? `A user searched a movie database for "${query}". The only close match was "${topTitle}", ` +
      `which may be an obscure title that is NOT what they meant. What well-known movie did they ` +
      `most likely actually want? Reply with ONLY that movie's title — no quotes, year, or ` +
      `explanation. If "${topTitle}" is almost certainly what they wanted, reply exactly: NONE`
    : `A user searched a movie database for "${query}" and got no results — likely a misspelling ` +
      `or a slightly mis-remembered title. Reply with ONLY the single most likely real movie ` +
      `title they meant — no quotes, year, or explanation. If you truly cannot guess, reply exactly: NONE`;
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
        max_tokens: 60,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
    const title = text.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 200);
    if (!title || nrm(title) === 'none') return null;
    return title;
  } catch {
    return null;
  }
}

// Merge candidate lists, corrected/alternative first, de-duped by TMDB id.
function mergeById(primary: any[], secondary: any[]): any[] {
  const out = [...primary];
  const seen = new Set(out.map((m) => m.id));
  for (const m of secondary) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  return out;
}

// GET /tmdb/search?q=...  → { results: [movie card], corrected?, uncertain? }
// `corrected` = the canonical title we rescued to; `uncertain` = the raw hit was weak,
// so the client should NOT auto-pick a lone result — show the lineup and let the user
// choose (this is what stops an obscure album loading itself before they can react).
tmdbRoutes.get('/search', async (c) => {
  if (!c.env.TMDB_API_KEY) return c.json({ error: 'movies not configured', results: [] }, 503);
  const q = clean(c.req.query('q'));
  if (!q) return c.json({ results: [] });

  const raw = await searchAll(c.env, q);
  // A confident top hit is the common case — return immediately, no rescue cost.
  if (raw.length && confident(q, raw[0].title)) return c.json({ results: raw });

  // Stage 1 (no LLM): rescue from TMDB's LIVE catalogue. Broaden to the anchor and
  // fuzzy-rank real candidates against the full query. Fixes new franchise films the
  // LLM can't recall ("Spider-Man Brave New Day" → "Spider-Man: Brand New Day").
  const pool = await broadenSearch(c.env, q, raw);
  if (pool.length) {
    const ranked = pool.map((m) => ({ m, s: simScore(q, m.title) })).sort((a, b) => b.s - a.s);
    const best = ranked[0];
    const rawTop = raw[0] ? nrm(raw[0].title) : '';
    // Only claim a correction when we genuinely improved on the raw top hit.
    if (best && best.s >= 0.6 && nrm(best.m.title) !== rawTop) {
      return c.json({ results: ranked.slice(0, 12).map((r) => r.m), corrected: best.m.title });
    }
  }

  // Stage 2 (LLM, rate-limited): either a pure typo ("Gladeator" → "Gladiator"), or the
  // only hit is an obscure real title that isn't what they meant ("The Odessey" → a 1968
  // album, but they meant "The Odyssey"). Ask what they most likely meant; when it lands,
  // put BOTH the suggestion and the raw hit in the lineup so the user picks.
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
  if (await gateAllows(c.env, ip)) {
    const top = raw[0]?.title || '';
    const suggest = await llmSuggestTitle(c.env, q, top);
    if (suggest && nrm(suggest) !== nrm(q) && nrm(suggest) !== nrm(top)) {
      const alt = await searchAll(c.env, suggest);   // variants too: "WALL-E" suggestion → finds WALL·E
      if (alt.length > 0) {
        const merged = mergeById(alt, raw).slice(0, 12);
        // If we also kept an obscure raw hit alongside the suggestion, it's a genuine
        // choice → uncertain, so the client shows both instead of auto-picking.
        return c.json({ results: merged, corrected: suggest, uncertain: merged.length > 1 });
      }
    }
  }
  // Nothing better. If the lone raw hit is a weak match, flag it so the client makes the
  // user tap rather than silently committing it.
  return c.json({ results: raw, uncertain: raw.length > 0 && !confident(q, raw[0].title) });
});

// Server-side movie detail (card with runtime), for the catalog materializer. Returns
// null on any failure so the caller can fail soft. id must be the bare TMDB numeric id.
export async function fetchTmdbMovie(env: Env, id: string) {
  if (!env.TMDB_API_KEY || !/^\d+$/.test(id)) return null;
  let res: Response;
  try { res = await tmdbFetch(env, `/movie/${id}`); } catch { return null; }
  if (!res.ok) return null;
  return card(await res.json());
}

// TMDB as a SECOND OPINION on a TVmaze episode's runtime. TVmaze is the TV source,
// but its per-episode runtime is sometimes a rounded slot (e.g. "Ghosts" at 30 when
// episodes run ~22). Given a TVmaze show's external ids we resolve the matching TMDB
// tv id (via /find), then read the episode-level runtime — falling back to the show's
// episode_run_time average. Returns minutes, or null on any miss (fail-soft, no throw).
export async function fetchTmdbTvRuntime(
  env: Env,
  ext: { imdb?: string | null; tvdb?: string | null },
  season: number,
  number: number,
): Promise<number | null> {
  if (!env.TMDB_API_KEY) return null;
  // 1) Map an external id → TMDB tv id. IMDB first (most reliable), then TheTVDB.
  const find = async (id: string, source: string): Promise<number | null> => {
    try {
      const res = await tmdbFetch(env, `/find/${encodeURIComponent(id)}`, { external_source: source });
      if (!res.ok) return null;
      const d = (await res.json()) as { tv_results?: any[] };
      const hit = (d.tv_results || [])[0];
      return hit && typeof hit.id === 'number' ? hit.id : null;
    } catch { return null; }
  };
  let tvId: number | null = null;
  if (ext.imdb) tvId = await find(ext.imdb, 'imdb_id');
  if (tvId == null && ext.tvdb) tvId = await find(ext.tvdb, 'tvdb_id');
  if (tvId == null) return null;

  // 2) Episode-level runtime, the precise signal.
  if (Number.isFinite(season) && Number.isFinite(number)) {
    try {
      const res = await tmdbFetch(env, `/tv/${tvId}/season/${season}/episode/${number}`);
      if (res.ok) {
        const e = (await res.json()) as { runtime?: number };
        if (typeof e.runtime === 'number' && e.runtime > 0) return e.runtime;
      }
    } catch { /* fall through to the show average */ }
  }

  // 3) Fallback: the show's typical episode runtime. Multiple values can be listed
  //    (specials etc.); the smallest is the regular-episode length most often.
  try {
    const res = await tmdbFetch(env, `/tv/${tvId}`);
    if (res.ok) {
      const s = (await res.json()) as { episode_run_time?: number[] };
      const rts = (s.episode_run_time || []).filter((n) => typeof n === 'number' && n > 0);
      if (rts.length) return Math.min(...rts);
    }
  } catch { /* nothing more to try */ }
  return null;
}

// GET /tmdb/movie/:id  → { movie: detail card (runtime + cast/crew/production) }
tmdbRoutes.get('/movie/:id', async (c) => {
  if (!c.env.TMDB_API_KEY) return c.json({ error: 'movies not configured' }, 503);
  const id = clean(c.req.param('id'));
  if (!/^\d+$/.test(id)) return c.json({ error: 'numeric id required' }, 400);
  let res: Response;
  try {
    res = await tmdbFetch(c.env, `/movie/${id}`, { append_to_response: 'credits' });
  } catch {
    return c.json({ error: 'upstream unreachable' }, 502);
  }
  if (res.status === 404) return c.json({ error: 'not found' }, 404);
  if (!res.ok) return c.json({ error: 'upstream error' }, 502);
  const movie = detailCard(await res.json());
  return c.json({ movie });
});
