import type { WatchHealth } from '../state/watch_health.js';

export const DEFAULT_WATCH_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

export interface WatchRecoveryDecision {
  shouldAttempt: boolean;
  cooldownRemainingMs: number;
  reason: 'healthy' | 'cooldown' | 'suspected_dead';
}

export interface WatchRecoveryGate {
  evaluate(health: WatchHealth | null): WatchRecoveryDecision;
  lastAttemptAt(): number | null;
}

export function createWatchRecoveryGate(options?: {
  cooldownMs?: number;
  now?: () => number;
}): WatchRecoveryGate {
  const cooldownMs = Math.max(0, options?.cooldownMs ?? DEFAULT_WATCH_RECOVERY_COOLDOWN_MS);
  const now = options?.now ?? (() => Date.now());
  let lastAttemptAt: number | null = null;

  const evaluate = (health: WatchHealth | null): WatchRecoveryDecision => {
    if (!health?.suspectedDead) {
      return { shouldAttempt: false, cooldownRemainingMs: 0, reason: 'healthy' };
    }

    const current = now();
    if (lastAttemptAt !== null) {
      const elapsed = Math.max(0, current - lastAttemptAt);
      if (elapsed < cooldownMs) {
        return {
          shouldAttempt: false,
          cooldownRemainingMs: Math.max(0, cooldownMs - elapsed),
          reason: 'cooldown',
        };
      }
    }

    lastAttemptAt = current;
    return { shouldAttempt: true, cooldownRemainingMs: 0, reason: 'suspected_dead' };
  };

  return {
    evaluate,
    lastAttemptAt: () => lastAttemptAt,
  };
}
