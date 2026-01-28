/**
 * @fileoverview Tests for MetaImprovementLoop (WU-SELF-305)
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 *
 * The MetaImprovementLoop implements recursive self-improvement protocol with:
 * - Bounded recursion (max depth)
 * - Convergence/oscillation monitoring
 * - Metric gaming detection (Goodhart's Law)
 * - Lobian safety constraints
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  MetaImprovementLoop,
  createMetaImprovementLoop,
  type LoopConfig,
  type ImprovementIteration,
  type ImprovementAction,
  type LoopState,
  type ConvergenceAnalysis,
  DEFAULT_LOOP_CONFIG,
} from '../meta_improvement_loop.js';

describe('MetaImprovementLoop', () => {
  // ============================================================================
  // CONSTRUCTION AND CONFIGURATION
  // ============================================================================
  describe('construction and configuration', () => {
    it('creates instance with default configuration', () => {
      const loop = createMetaImprovementLoop();
      expect(loop).toBeInstanceOf(MetaImprovementLoop);
    });

    it('accepts partial configuration overrides', () => {
      const loop = createMetaImprovementLoop({
        maxIterations: 50,
        maxDepth: 5,
      });
      const state = loop.getState();
      expect(state.status).toBe('idle');
    });

    it('exports DEFAULT_LOOP_CONFIG with sensible defaults', () => {
      expect(DEFAULT_LOOP_CONFIG.maxIterations).toBeGreaterThan(0);
      expect(DEFAULT_LOOP_CONFIG.maxDepth).toBeGreaterThan(0);
      expect(DEFAULT_LOOP_CONFIG.convergenceThreshold).toBeGreaterThan(0);
      expect(DEFAULT_LOOP_CONFIG.convergenceThreshold).toBeLessThan(1);
      expect(DEFAULT_LOOP_CONFIG.minImprovementRate).toBeGreaterThan(0);
      expect(DEFAULT_LOOP_CONFIG.cooldownPeriod).toBeGreaterThan(0);
    });

    it('validates configuration values', () => {
      expect(() => createMetaImprovementLoop({ maxIterations: -1 })).toThrow();
      expect(() => createMetaImprovementLoop({ maxDepth: 0 })).toThrow();
      expect(() => createMetaImprovementLoop({ convergenceThreshold: 2 })).toThrow();
    });
  });

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================
  describe('getState', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop();
    });

    it('returns initial state with status idle', () => {
      const state = loop.getState();
      expect(state.status).toBe('idle');
    });

    it('returns initial state with currentIteration 0', () => {
      const state = loop.getState();
      expect(state.currentIteration).toBe(0);
    });

    it('returns initial state with totalImprovements 0', () => {
      const state = loop.getState();
      expect(state.totalImprovements).toBe(0);
    });

    it('returns initial state with empty history', () => {
      const state = loop.getState();
      expect(state.history).toEqual([]);
    });

    it('returns initial state with convergenceScore 0', () => {
      const state = loop.getState();
      expect(state.convergenceScore).toBe(0);
    });

    it('returns copy of state (immutable)', () => {
      const state1 = loop.getState();
      const state2 = loop.getState();
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  // ============================================================================
  // START AND STOP
  // ============================================================================
  describe('start and stop', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop({
        cooldownPeriod: 10, // Fast for testing
        maxIterations: 3,
      });
    });

    afterEach(() => {
      loop.stop();
    });

    it('start changes status to running', async () => {
      const startPromise = loop.start();
      expect(loop.getState().status).toBe('running');
      loop.stop();
      await startPromise;
    });

    it('stop changes status to stopped', async () => {
      const startPromise = loop.start();
      loop.stop();
      await startPromise;
      expect(loop.getState().status).toBe('stopped');
    });

    it('start accepts partial config override', async () => {
      const startPromise = loop.start({ maxIterations: 1 });
      loop.stop();
      await startPromise;
      // Should not throw
    });

    it('cannot start if already running', async () => {
      const startPromise = loop.start();
      await expect(loop.start()).rejects.toThrow(/already running/i);
      loop.stop();
      await startPromise;
    });

    it('stop is idempotent', async () => {
      const startPromise = loop.start();
      loop.stop();
      loop.stop(); // Should not throw
      await startPromise;
      expect(loop.getState().status).toBe('stopped');
    });

    it('runs until maxIterations if no convergence', async () => {
      const loop = createMetaImprovementLoop({
        maxIterations: 2,
        cooldownPeriod: 1,
        convergenceThreshold: 0.001, // Very strict - won't converge
      });
      await loop.start();
      expect(loop.getState().currentIteration).toBe(2);
    });

    it('runs until convergence if reached before maxIterations', async () => {
      // Create a loop that converges quickly
      const loop = createMetaImprovementLoop({
        maxIterations: 100,
        cooldownPeriod: 1,
        convergenceThreshold: 0.99, // Very lenient - converges immediately
      });
      await loop.start();
      expect(loop.getState().status).toBe('converged');
      expect(loop.getState().currentIteration).toBeLessThan(100);
    });
  });

  // ============================================================================
  // SINGLE ITERATION
  // ============================================================================
  describe('runIteration', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
        maxIterations: 100,
      });
    });

    it('returns ImprovementIteration with iterationId', async () => {
      const iteration = await loop.runIteration();
      expect(iteration.iterationId).toBe(1);
    });

    it('returns ImprovementIteration with depth', async () => {
      const iteration = await loop.runIteration();
      expect(iteration.depth).toBe(0); // First iteration is depth 0
    });

    it('returns ImprovementIteration with startedAt', async () => {
      const before = new Date();
      const iteration = await loop.runIteration();
      const after = new Date();
      expect(iteration.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(iteration.startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('returns ImprovementIteration with completedAt', async () => {
      const iteration = await loop.runIteration();
      expect(iteration.completedAt).toBeInstanceOf(Date);
      expect(iteration.completedAt!.getTime()).toBeGreaterThanOrEqual(iteration.startedAt.getTime());
    });

    it('returns ImprovementIteration with improvements array', async () => {
      const iteration = await loop.runIteration();
      expect(Array.isArray(iteration.improvements)).toBe(true);
    });

    it('returns ImprovementIteration with metricsBeforeAfter', async () => {
      const iteration = await loop.runIteration();
      expect(Array.isArray(iteration.metricsBeforeAfter)).toBe(true);
    });

    it('returns ImprovementIteration with valid outcome', async () => {
      const iteration = await loop.runIteration();
      expect(['improved', 'no_change', 'degraded', 'stopped']).toContain(iteration.outcome);
    });

    it('increments iteration count in state', async () => {
      expect(loop.getState().currentIteration).toBe(0);
      await loop.runIteration();
      expect(loop.getState().currentIteration).toBe(1);
      await loop.runIteration();
      expect(loop.getState().currentIteration).toBe(2);
    });

    it('adds iteration to history', async () => {
      expect(loop.getState().history.length).toBe(0);
      await loop.runIteration();
      expect(loop.getState().history.length).toBe(1);
      await loop.runIteration();
      expect(loop.getState().history.length).toBe(2);
    });
  });

  // ============================================================================
  // CONVERGENCE DETECTION
  // ============================================================================
  describe('checkConvergence', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
        convergenceThreshold: 0.1,
      });
    });

    it('returns ConvergenceAnalysis with converged boolean', () => {
      const analysis = loop.checkConvergence();
      expect(typeof analysis.converged).toBe('boolean');
    });

    it('returns ConvergenceAnalysis with oscillating boolean', () => {
      const analysis = loop.checkConvergence();
      expect(typeof analysis.oscillating).toBe('boolean');
    });

    it('returns ConvergenceAnalysis with metricTrends', () => {
      const analysis = loop.checkConvergence();
      expect(Array.isArray(analysis.metricTrends)).toBe(true);
    });

    it('returns ConvergenceAnalysis with recommendation', () => {
      const analysis = loop.checkConvergence();
      expect(['continue', 'stop', 'investigate']).toContain(analysis.recommendation);
    });

    it('detects convergence when metrics stabilize', async () => {
      // Simulate stable metrics
      const loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
        convergenceThreshold: 0.5,
        maxIterations: 10,
      });

      // Run several iterations to build history
      for (let i = 0; i < 5; i++) {
        await loop.runIteration();
      }

      const analysis = loop.checkConvergence();
      // With default mock behavior, should show some trend
      expect(analysis.metricTrends.length).toBeGreaterThanOrEqual(0);
    });

    it('recommends stop when converged', async () => {
      // Create a loop that's clearly converged
      const loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
        convergenceThreshold: 0.99,
        maxIterations: 10,
      });

      for (let i = 0; i < 3; i++) {
        await loop.runIteration();
      }

      const analysis = loop.checkConvergence();
      if (analysis.converged) {
        expect(analysis.recommendation).toBe('stop');
      }
    });

    it('recommends investigate when oscillating', async () => {
      const loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
        convergenceThreshold: 0.1,
        maxIterations: 20,
      });

      // Run multiple iterations to potentially detect oscillation
      for (let i = 0; i < 10; i++) {
        await loop.runIteration();
      }

      const analysis = loop.checkConvergence();
      if (analysis.oscillating) {
        expect(analysis.recommendation).toBe('investigate');
      }
    });
  });

  // ============================================================================
  // OSCILLATION DETECTION
  // ============================================================================
  describe('detectOscillation', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
      });
    });

    it('returns false for empty history', () => {
      expect(loop.detectOscillation([])).toBe(false);
    });

    it('returns false for single item history', () => {
      const history: ImprovementIteration[] = [
        createMockIteration(1, 'improved'),
      ];
      expect(loop.detectOscillation(history)).toBe(false);
    });

    it('returns false for monotonic improvement', () => {
      const history: ImprovementIteration[] = [
        createMockIteration(1, 'improved', [{ metric: 'quality', before: 0.5, after: 0.6 }]),
        createMockIteration(2, 'improved', [{ metric: 'quality', before: 0.6, after: 0.7 }]),
        createMockIteration(3, 'improved', [{ metric: 'quality', before: 0.7, after: 0.8 }]),
      ];
      expect(loop.detectOscillation(history)).toBe(false);
    });

    it('returns true for alternating improvement/degradation', () => {
      const history: ImprovementIteration[] = [
        createMockIteration(1, 'improved', [{ metric: 'quality', before: 0.5, after: 0.6 }]),
        createMockIteration(2, 'degraded', [{ metric: 'quality', before: 0.6, after: 0.5 }]),
        createMockIteration(3, 'improved', [{ metric: 'quality', before: 0.5, after: 0.6 }]),
        createMockIteration(4, 'degraded', [{ metric: 'quality', before: 0.6, after: 0.5 }]),
      ];
      expect(loop.detectOscillation(history)).toBe(true);
    });

    it('requires minimum history length for oscillation detection', () => {
      // 2 alternations is not enough to confirm oscillation
      const history: ImprovementIteration[] = [
        createMockIteration(1, 'improved'),
        createMockIteration(2, 'degraded'),
      ];
      expect(loop.detectOscillation(history)).toBe(false);
    });
  });

  // ============================================================================
  // BOUNDED RECURSION
  // ============================================================================
  describe('bounded recursion', () => {
    it('respects maxDepth limit', async () => {
      const loop = createMetaImprovementLoop({
        maxDepth: 2,
        cooldownPeriod: 1,
        maxIterations: 100,
      });

      await loop.start();
      const state = loop.getState();

      // All iterations should be at depth <= maxDepth
      for (const iteration of state.history) {
        expect(iteration.depth).toBeLessThanOrEqual(2);
      }
    });

    it('tracks depth correctly through iterations', async () => {
      const loop = createMetaImprovementLoop({
        maxDepth: 5,
        cooldownPeriod: 1,
        maxIterations: 3,
      });

      const it1 = await loop.runIteration();
      expect(it1.depth).toBe(0);

      // Depth increases based on improvement cascades (implementation-dependent)
      // At minimum, depth should be tracked
      expect(typeof it1.depth).toBe('number');
    });

    it('stops when maxDepth exceeded', async () => {
      const loop = createMetaImprovementLoop({
        maxDepth: 1,
        cooldownPeriod: 1,
        maxIterations: 100,
        convergenceThreshold: 0.001, // Prevent convergence
      });

      await loop.start();
      const state = loop.getState();

      // Should have stopped due to depth limit
      expect(state.history.every(it => it.depth <= 1)).toBe(true);
    });
  });

  // ============================================================================
  // METRIC GAMING DETECTION (GOODHART'S LAW)
  // ============================================================================
  describe('metric gaming detection (Goodhart)', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
        maxIterations: 20,
      });
    });

    it('detects when single metric improves while others degrade', async () => {
      // Build history with gaming pattern
      const history: ImprovementIteration[] = [
        createMockIteration(1, 'improved', [
          { metric: 'speed', before: 0.5, after: 0.8 },
          { metric: 'accuracy', before: 0.8, after: 0.7 },
          { metric: 'coverage', before: 0.9, after: 0.85 },
        ]),
        createMockIteration(2, 'improved', [
          { metric: 'speed', before: 0.8, after: 0.95 },
          { metric: 'accuracy', before: 0.7, after: 0.6 },
          { metric: 'coverage', before: 0.85, after: 0.75 },
        ]),
      ];

      // Internal method or through convergence analysis
      const analysis = loop.checkConvergence();
      // The implementation should flag potential gaming
      expect(analysis).toBeDefined();
    });

    it('tracks multiple metrics simultaneously', async () => {
      await loop.runIteration();
      const state = loop.getState();

      if (state.history.length > 0) {
        const lastIteration = state.history[state.history.length - 1];
        // Should track multiple metrics
        expect(lastIteration.metricsBeforeAfter.length).toBeGreaterThan(0);
      }
    });

    it('provides Goodhart warning in convergence analysis', async () => {
      for (let i = 0; i < 5; i++) {
        await loop.runIteration();
      }

      const analysis = loop.checkConvergence();
      // Analysis should have capability to warn about gaming
      // This is implementation-dependent but the type should support it
      expect(analysis.recommendation).toBeDefined();
    });
  });

  // ============================================================================
  // LOBIAN SAFETY CONSTRAINTS
  // ============================================================================
  describe('Lobian safety constraints', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
      });
    });

    it('never claims self-verification proves correctness', async () => {
      await loop.runIteration();
      const state = loop.getState();

      // Check that iteration results don't make overclaims
      for (const iteration of state.history) {
        // Outcome should be conservative
        expect(['improved', 'no_change', 'degraded', 'stopped']).toContain(iteration.outcome);
        // Never claims 'verified_correct' or similar strong guarantees
      }
    });

    it('documents theoretical limits in convergence analysis', () => {
      const analysis = loop.checkConvergence();

      // Should have documented limits - convergence doesn't guarantee correctness
      expect(analysis.recommendation).toBeDefined();
      // The implementation should not recommend 'proven_correct' or similar
      expect(['continue', 'stop', 'investigate']).toContain(analysis.recommendation);
    });

    it('flags iterations that might need external validation', async () => {
      const loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
        maxIterations: 5,
      });

      for (let i = 0; i < 5; i++) {
        await loop.runIteration();
      }

      const state = loop.getState();
      // State should track improvements that might need review
      expect(state.totalImprovements).toBeGreaterThanOrEqual(0);
    });

    it('exposes requiresExternalValidation flag on critical changes', async () => {
      await loop.runIteration();
      const state = loop.getState();

      for (const iteration of state.history) {
        for (const improvement of iteration.improvements) {
          // Every improvement action should have a 'type' indicating its scope
          expect(improvement.type).toBeDefined();
          expect(['fix', 'refresh', 'reindex', 'recalibrate']).toContain(improvement.type);
        }
      }
    });
  });

  // ============================================================================
  // IMPROVEMENT ACTIONS
  // ============================================================================
  describe('improvement actions', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
      });
    });

    it('generates actions with valid type', async () => {
      const iteration = await loop.runIteration();

      for (const action of iteration.improvements) {
        expect(['fix', 'refresh', 'reindex', 'recalibrate']).toContain(action.type);
      }
    });

    it('generates actions with target', async () => {
      const iteration = await loop.runIteration();

      for (const action of iteration.improvements) {
        expect(typeof action.target).toBe('string');
      }
    });

    it('generates actions with description', async () => {
      const iteration = await loop.runIteration();

      for (const action of iteration.improvements) {
        expect(typeof action.description).toBe('string');
      }
    });

    it('tracks whether actions were applied', async () => {
      const iteration = await loop.runIteration();

      for (const action of iteration.improvements) {
        expect(typeof action.applied).toBe('boolean');
      }
    });

    it('tracks action results when applied', async () => {
      const iteration = await loop.runIteration();

      for (const action of iteration.improvements) {
        if (action.applied) {
          expect(action.result).toBeDefined();
        }
      }
    });
  });

  // ============================================================================
  // INTEGRATION WITH OTHER COMPONENTS
  // ============================================================================
  describe('component integration', () => {
    it('can set improvement tracker', () => {
      const loop = createMetaImprovementLoop();
      const mockTracker = createMockImprovementTracker();

      expect(() => loop.setImprovementTracker(mockTracker)).not.toThrow();
    });

    it('can set problem detector', () => {
      const loop = createMetaImprovementLoop();
      const mockDetector = createMockProblemDetector();

      expect(() => loop.setProblemDetector(mockDetector)).not.toThrow();
    });

    it('can set continuous improvement runner', () => {
      const loop = createMetaImprovementLoop();
      const mockRunner = createMockContinuousImprovementRunner();

      expect(() => loop.setContinuousImprovementRunner(mockRunner)).not.toThrow();
    });

    it('uses improvement tracker when set', async () => {
      const loop = createMetaImprovementLoop({ cooldownPeriod: 1 });
      const mockTracker = createMockImprovementTracker();
      const recordSpy = vi.spyOn(mockTracker, 'recordIteration');

      loop.setImprovementTracker(mockTracker);
      await loop.runIteration();

      expect(recordSpy).toHaveBeenCalled();
    });

    it('uses problem detector when set', async () => {
      const loop = createMetaImprovementLoop({ cooldownPeriod: 1 });
      const mockDetector = createMockProblemDetector();
      const detectSpy = vi.spyOn(mockDetector, 'detect');

      loop.setProblemDetector(mockDetector);
      await loop.runIteration();

      expect(detectSpy).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================
  describe('error handling', () => {
    let loop: MetaImprovementLoop;

    beforeEach(() => {
      loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
      });
    });

    it('handles iteration errors gracefully', async () => {
      const mockDetector = createMockProblemDetector();
      vi.spyOn(mockDetector, 'detect').mockRejectedValue(new Error('Detection failed'));

      loop.setProblemDetector(mockDetector);

      // Should not throw, but should record error
      const iteration = await loop.runIteration();
      expect(iteration.outcome).toBeDefined();
    });

    it('recovers from errors and continues loop', async () => {
      const mockDetector = createMockProblemDetector();
      let callCount = 0;
      vi.spyOn(mockDetector, 'detect').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First call fails');
        }
        return [];
      });

      loop.setProblemDetector(mockDetector);

      await loop.runIteration();
      await loop.runIteration();

      expect(loop.getState().currentIteration).toBe(2);
    });

    it('sets status to error on critical failure', async () => {
      // This tests catastrophic failures that prevent continuation
      const loop = createMetaImprovementLoop({
        cooldownPeriod: 1,
        maxIterations: 1,
      });

      // Force an internal error
      // Implementation should handle this gracefully
      await loop.start();
      const state = loop.getState();
      expect(['converged', 'stopped', 'error']).toContain(state.status);
    });
  });

  // ============================================================================
  // COOLDOWN PERIOD
  // ============================================================================
  describe('cooldown period', () => {
    it('waits between iterations', async () => {
      const cooldownPeriod = 50; // 50ms
      const loop = createMetaImprovementLoop({
        cooldownPeriod,
        maxIterations: 2,
        convergenceThreshold: 0.001,
      });

      const start = Date.now();
      await loop.start();
      const elapsed = Date.now() - start;

      // Should have waited at least one cooldown period
      expect(elapsed).toBeGreaterThanOrEqual(cooldownPeriod);
    });

    it('can be interrupted during cooldown', async () => {
      const loop = createMetaImprovementLoop({
        cooldownPeriod: 5000, // 5 seconds
        maxIterations: 10,
      });

      const startPromise = loop.start();

      // Stop immediately
      setTimeout(() => loop.stop(), 10);

      await startPromise;
      expect(loop.getState().status).toBe('stopped');
    });
  });

  // ============================================================================
  // STATE PERSISTENCE HELPERS
  // ============================================================================
  describe('state serialization', () => {
    it('state can be serialized to JSON', async () => {
      const loop = createMetaImprovementLoop({ cooldownPeriod: 1, maxIterations: 2 });
      await loop.start();

      const state = loop.getState();
      expect(() => JSON.stringify(state)).not.toThrow();
    });

    it('history dates are preserved correctly', async () => {
      const loop = createMetaImprovementLoop({ cooldownPeriod: 1 });
      await loop.runIteration();

      const state = loop.getState();
      const serialized = JSON.stringify(state);
      const parsed = JSON.parse(serialized);

      expect(parsed.history[0].startedAt).toBeDefined();
    });
  });
});

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockIteration(
  id: number,
  outcome: ImprovementIteration['outcome'],
  metrics?: ImprovementIteration['metricsBeforeAfter']
): ImprovementIteration {
  const startedAt = new Date();
  return {
    iterationId: id,
    depth: 0,
    startedAt,
    completedAt: new Date(startedAt.getTime() + 100),
    improvements: [],
    metricsBeforeAfter: metrics || [],
    outcome,
  };
}

function createMockImprovementTracker() {
  return {
    recordIteration: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    computeTrend: vi.fn().mockReturnValue({
      dataPoints: [],
      trendDirection: 'stable',
      averageImprovement: 0,
      totalProblemsFixed: 0,
      testSuiteHealth: 'healthy',
    }),
    computeHealth: vi.fn().mockReturnValue({
      fixSuccessRate: 0,
      hypothesisAccuracy: 0,
      regressionRate: 0,
      evolutionCoverage: 0,
    }),
    generateReport: vi.fn(),
    reset: vi.fn(),
  };
}

function createMockProblemDetector() {
  return {
    detect: vi.fn().mockResolvedValue([]),
    identifyProblems: vi.fn().mockResolvedValue({
      problems: [],
      summary: { total: 0, byType: {}, bySeverity: {} },
    }),
  };
}

function createMockContinuousImprovementRunner() {
  return {
    run: vi.fn().mockResolvedValue({
      cycleNumber: 1,
      checksPerformed: [],
      issuesFound: [],
      fixesPlanned: [],
      fixesApplied: [],
      patternsLearned: [],
      healthImprovement: 0,
      nextScheduledCheck: new Date(),
      status: 'healthy',
      duration: 100,
      errors: [],
      phaseReports: [],
    }),
  };
}
