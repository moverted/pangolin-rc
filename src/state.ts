import type { SubmissionState, ActorRole } from './types';

interface TransitionRule {
  from: SubmissionState[];
  to: SubmissionState;
  roles: ActorRole[];
}

// Encode the state machine from CLAUDE.md §3.
// 'reveal' covers both initial reveal (from ready) and re-reveal (from unrevealed).
const TRANSITIONS: Record<string, TransitionRule> = {
  advance: { from: ['pending'],              to: 'ready',      roles: ['system', 'authority'] },
  reject:  { from: ['pending', 'ready'],     to: 'rejected',   roles: ['authority', 'system'] },
  reveal:  { from: ['ready', 'unrevealed'],  to: 'revealed',   roles: ['authority'] },
  revoke:  { from: ['revealed'],             to: 'unrevealed', roles: ['authority'] },
  purge:   { from: ['unrevealed', 'rejected'], to: 'purged',   roles: ['authority'] },
};

type TransitionOk  = { ok: true; next: SubmissionState };
type TransitionErr = { ok: false; status: number; error: string };

export function transition(
  action: string,
  currentState: SubmissionState,
  actorRole: ActorRole,
): TransitionOk | TransitionErr {
  const rule = TRANSITIONS[action];
  if (!rule) {
    return { ok: false, status: 400, error: `Unknown action: ${action}` };
  }
  if (!rule.from.includes(currentState)) {
    return {
      ok: false,
      status: 409,
      error: `'${action}' cannot be applied to state '${currentState}'. Valid from: ${rule.from.join(', ')}`,
    };
  }
  if (!rule.roles.includes(actorRole)) {
    return {
      ok: false,
      status: 403,
      error: `Role '${actorRole}' cannot perform '${action}'`,
    };
  }
  return { ok: true, next: rule.to };
}
