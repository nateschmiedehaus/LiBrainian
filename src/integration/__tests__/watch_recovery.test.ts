import { describe, it, expect } from 'vitest';
import { createWatchRecoveryGate } from '../watch_recovery.js';
import type { WatchHealth } from '../../state/watch_health.js';

const healthyHealth: WatchHealth = {
  suspectedDead: false,
  heartbeatAgeMs: 1000,
  eventAgeMs: 500,
  reindexAgeMs: 800,
  stalenessMs: 60000,
};

const suspectedDeadHealth: WatchHealth = {
  suspectedDead: true,
  heartbeatAgeMs: 120000,
  eventAgeMs: null,
  reindexAgeMs: null,
  stalenessMs: 60000,
};

describe('watch recovery gate', () => {
  it('skips recovery when watcher is healthy or health is missing', () => {
    let now = 1_000_000;
    const gate = createWatchRecoveryGate({ cooldownMs: 10_000, now: () => now });

    const healthyDecision = gate.evaluate(healthyHealth);
    expect(healthyDecision.shouldAttempt).toBe(false);
    expect(healthyDecision.cooldownRemainingMs).toBe(0);

    const missingDecision = gate.evaluate(null);
    expect(missingDecision.shouldAttempt).toBe(false);
    expect(missingDecision.cooldownRemainingMs).toBe(0);

    now += 5000;
    const firstAttempt = gate.evaluate(suspectedDeadHealth);
    expect(firstAttempt.shouldAttempt).toBe(true);
    expect(firstAttempt.cooldownRemainingMs).toBe(0);
  });

  it('enforces cooldown between recovery attempts', () => {
    let now = 5_000_000;
    const gate = createWatchRecoveryGate({ cooldownMs: 1000, now: () => now });

    const firstAttempt = gate.evaluate(suspectedDeadHealth);
    expect(firstAttempt.shouldAttempt).toBe(true);

    now += 400;
    const blockedAttempt = gate.evaluate(suspectedDeadHealth);
    expect(blockedAttempt.shouldAttempt).toBe(false);
    expect(blockedAttempt.cooldownRemainingMs).toBeGreaterThan(0);

    now += 800;
    const secondAttempt = gate.evaluate(suspectedDeadHealth);
    expect(secondAttempt.shouldAttempt).toBe(true);
    expect(secondAttempt.cooldownRemainingMs).toBe(0);
  });
});
