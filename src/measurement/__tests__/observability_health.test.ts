import { describe, it, expect } from 'vitest';
import type { CodeGraphHealth, IndexFreshness, ConfidenceState, QueryPerformance } from '../observability.js';
import { assessHealth } from '../observability.js';

describe('assessHealth', () => {
  it('treats stale index as degraded, not unhealthy (no query latency signal)', () => {
    const codeGraphHealth: CodeGraphHealth = {
      entityCount: 10,
      relationCount: 10,
      coverageRatio: 1,
      orphanEntities: 0,
      cycleCount: 0,
      entityCountByType: {},
    };

    const indexFreshness: IndexFreshness = {
      lastIndexTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      stalenessMs: 2 * 24 * 60 * 60 * 1000,
      pendingChanges: 0,
      indexVersion: '1.0.0',
      isFresh: false,
    };

    const confidenceState: ConfidenceState = {
      meanConfidence: 0.9,
      geometricMeanConfidence: 0.9,
      lowConfidenceCount: 0,
      defeaterCount: 0,
      defeatersByType: {},
      calibrationError: null,
    };

    const queryPerformance: QueryPerformance = {
      queryLatencyP50: 0,
      queryLatencyP99: 0,
      cacheHitRate: 0,
      retrievalRecall: null,
      queryCount: 0,
    };

    // The health assessor trusts `indexFreshness.isFresh`; staleness computations are
    // handled by the collector. With no pending changes, stale-by-age should not
    // mark the system unhealthy.
    const health = assessHealth(codeGraphHealth, indexFreshness, confidenceState, queryPerformance);
    expect(health.status).toBe('degraded');
    expect(health.checks.indexFresh).toBe(false);
  });
});
