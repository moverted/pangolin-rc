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

// GET /tmdb/search?q=...  → { results: [movie card] }
tmdbRoutes.get('/search', async (c) => {
  if (!c.env.TMDB_API_KEY) return c.json({ error: 'movies not configured', results: [] }, 503);
  const q = clean(c.req.query('q'));
  if (!q) return c.json({ results: [] });
  let res: Response;
  try {
    res = await tmdbFetch(c.env, '/search/movie', { query: q, include_adult: 'false' });
  } catch {
    return c.json({ error: 'upstream unreachable', results: [] }, 502);
  }
  if (!res.ok) return c.json({ error: 'upstream error', results: [] }, 502);
  const data = (await res.json()) as { results?: any[] };
  const results = (data.results || [])
    .filter((m) => m && m.id && (m.title || m.name))
    .slice(0, 12)
    .map(card);
  return c.json({ results });
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
