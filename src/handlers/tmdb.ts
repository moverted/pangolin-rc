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
function tmdbFetch(env: Env, path: string, params: Record<string, string> = {}) {
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

// GET /tmdb/movie/:id  → { movie: card-with-runtime }
tmdbRoutes.get('/movie/:id', async (c) => {
  if (!c.env.TMDB_API_KEY) return c.json({ error: 'movies not configured' }, 503);
  const id = clean(c.req.param('id'));
  if (!/^\d+$/.test(id)) return c.json({ error: 'numeric id required' }, 400);
  let res: Response;
  try {
    res = await tmdbFetch(c.env, `/movie/${id}`);
  } catch {
    return c.json({ error: 'upstream unreachable' }, 502);
  }
  if (res.status === 404) return c.json({ error: 'not found' }, 404);
  if (!res.ok) return c.json({ error: 'upstream error' }, 502);
  const movie = card(await res.json());
  return c.json({ movie });
});
