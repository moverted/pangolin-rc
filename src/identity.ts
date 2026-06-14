import type { Actor, ActorRole } from './types';

const VALID_ROLES: ActorRole[] = ['submitter', 'authority', 'system', 'consumer'];

// SEAM:identity — replace with real auth (Cloudflare Access JWT, Turnstile, etc.).
// Instance supplies identity resolution; this header-based stub is for development only.
export function resolveActor(request: Request): Actor | null {
  const id   = request.headers.get('X-Actor-Id');
  const role = request.headers.get('X-Actor-Role') as ActorRole | null;
  if (!id || !role || !VALID_ROLES.includes(role)) return null;
  return { id, role };
}
