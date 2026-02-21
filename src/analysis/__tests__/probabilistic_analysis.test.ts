/**
 * Tests for Probabilistic Analysis Module
 *
 * TDD tests for:
 * - Bayesian confidence calculations
 * - Confidence propagation
 * - Stability metrics
 * - Uncertainty quantification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  betaMean,
  betaVariance,
  betaCredibleInterval,
  computeConfidenceEstimate,
  createInitialConfidence,
  updateConfidence,
  propagateConfidence,
  aggregateConfidence,
  computeStabilityFromHistory,
  generateUncertaintyReport,
  runProbabilisticAnalysis,
} from '../probabilistic_analysis.js';
import type { ModuleGraph } from '../../knowledge/module_graph.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage, BayesianConfidence } from '../../storage/types.js';

describe('Probabilistic Analysis', () => {
  let storage: LiBrainianStorage;
  let dbPath: string;
  const testDir = join(tmpdir(), 'probabilistic-analysis-test-' + Date.now());

  beforeEach(async () => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    dbPath = join(testDir, `test-${Date.now()}.db`);
    storage = createSqliteStorage(dbPath, testDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
        unlinkSync(dbPath + '-wal');
        unlinkSync(dbPath + '-shm');
        unlinkSync(dbPath + '.lock');
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Beta Distribution Calculations', () => {
    it('should compute beta mean correctly', () => {
      // Uniform prior: Beta(1, 1)
      expect(betaMean(1, 1)).toBe(0.5);

      // 9 successes, 1 failure: Beta(10, 2)
      expect(betaMean(10, 2)).toBeCloseTo(0.833, 2);

      // 1 success, 9 failures: Beta(2, 10)
      expect(betaMean(2, 10)).toBeCloseTo(0.167, 2);
    });

    it('should compute beta variance correctly', () => {
      // Uniform prior: Beta(1, 1)
      expect(betaVariance(1, 1)).toBeCloseTo(0.083, 2);

      // Concentrated at 0.5: Beta(100, 100)
      const variance = betaVariance(100, 100);
      expect(variance).toBeLessThan(0.01);
    });

    it('should compute credible intervals correctly', () => {
      // Wide interval for uninformative prior
      const uninformative = betaCredibleInterval(1, 1);
      expect(uninformative.upper - uninformative.lower).toBeGreaterThan(0.5);

      // Narrow interval for concentrated posterior
      const concentrated = betaCredibleInterval(100, 100);
      expect(concentrated.upper - concentrated.lower).toBeLessThan(0.2);
    });

    it('should clamp intervals to [0, 1]', () => {
      const interval = betaCredibleInterval(1, 1);
      expect(interval.lower).toBeGreaterThanOrEqual(0);
      expect(interval.upper).toBeLessThanOrEqual(1);
    });
  });

  describe('Bayesian Confidence Updates', () => {
    it('should create initial confidence with Jeffrey prior', () => {
      const conf = createInitialConfidence('test-func', 'function');

      expect(conf.entityId).toBe('test-func');
      expect(conf.entityType).toBe('function');
      expect(conf.priorAlpha).toBe(0.5);
      expect(conf.priorBeta).toBe(0.5);
      expect(conf.observationCount).toBe(0);
    });

    it('should update confidence on success', () => {
      const initial = createInitialConfidence('test-func', 'function');
      const updated = updateConfidence(initial, true);

      expect(updated.posteriorAlpha).toBe(initial.posteriorAlpha + 1);
      expect(updated.posteriorBeta).toBe(initial.posteriorBeta);
      expect(updated.observationCount).toBe(1);
    });

    it('should update confidence on failure', () => {
      const initial = createInitialConfidence('test-func', 'function');
      const updated = updateConfidence(initial, false);

      expect(updated.posteriorAlpha).toBe(initial.posteriorAlpha);
      expect(updated.posteriorBeta).toBe(initial.posteriorBeta + 1);
      expect(updated.observationCount).toBe(1);
    });

    it('should accumulate multiple updates correctly', () => {
      let conf = createInitialConfidence('test-func', 'function');

      // 8 successes, 2 failures
      for (let i = 0; i < 8; i++) {
        conf = updateConfidence(conf, true);
      }
      for (let i = 0; i < 2; i++) {
        conf = updateConfidence(conf, false);
      }

      expect(conf.posteriorAlpha).toBeCloseTo(8.5, 1); // 0.5 + 8
      expect(conf.posteriorBeta).toBeCloseTo(2.5, 1); // 0.5 + 2
      expect(conf.observationCount).toBe(10);

      const estimate = computeConfidenceEstimate(conf);
      expect(estimate.mean).toBeCloseTo(0.77, 1); // 8.5 / 11
    });
  });

  describe('Confidence Propagation', () => {
    it('should propagate confidence through dependencies', async () => {
      // Create a simple dependency graph: A -> B -> C
      const graph: ModuleGraph = new Map([
        ['moduleA', new Set(['moduleB'])],
        ['moduleB', new Set(['moduleC'])],
        ['moduleC', new Set()],
      ]);

      // Set up initial confidences for all modules
      const now = new Date().toISOString();
      await storage.upsertBayesianConfidence({
        entityId: 'moduleC',
        entityType: 'module',
        priorAlpha: 0.5,
        priorBeta: 0.5,
        posteriorAlpha: 10,
        posteriorBeta: 2,
        observationCount: 10,
        computedAt: now,
      });
      await storage.upsertBayesianConfidence({
        entityId: 'moduleB',
        entityType: 'module',
        priorAlpha: 0.5,
        priorBeta: 0.5,
        posteriorAlpha: 8,
        posteriorBeta: 4,
        observationCount: 10,
        computedAt: now,
      });

      const results = await propagateConfidence(storage, graph, 0.7);

      // Module A should be influenced by B's confidence (1 self + 1 dep = 2)
      const resultA = results.find(r => r.entityId === 'moduleA');
      expect(resultA).toBeDefined();
      expect(resultA!.contributingSources).toBeGreaterThanOrEqual(2);
    });

    it('should use self-weight correctly', async () => {
      const graph: ModuleGraph = new Map([
        ['moduleA', new Set(['moduleB'])],
        ['moduleB', new Set()],
      ]);

      // High confidence for A, low for B
      await storage.upsertBayesianConfidence({
        entityId: 'moduleA',
        entityType: 'module',
        priorAlpha: 0.5,
        priorBeta: 0.5,
        posteriorAlpha: 10,
        posteriorBeta: 2,
        observationCount: 10,
        computedAt: new Date().toISOString(),
      });

      await storage.upsertBayesianConfidence({
        entityId: 'moduleB',
        entityType: 'module',
        priorAlpha: 0.5,
        priorBeta: 0.5,
        posteriorAlpha: 2,
        posteriorBeta: 10,
        observationCount: 10,
        computedAt: new Date().toISOString(),
      });

      const results = await propagateConfidence(storage, graph, 0.9);
      const resultA = results.find(r => r.entityId === 'moduleA');

      // With high self-weight (0.9), propagated should be close to original
      expect(Math.abs(resultA!.propagatedConfidence - resultA!.originalConfidence)).toBeLessThan(0.1);
    });
  });

  describe('Confidence Aggregation', () => {
    it('should aggregate multiple confidence estimates', () => {
      const estimates = [
        { mean: 0.9, variance: 0.01, lowerBound: 0.85, upperBound: 0.95, observations: 50 },
        { mean: 0.8, variance: 0.02, lowerBound: 0.75, upperBound: 0.85, observations: 30 },
        { mean: 0.7, variance: 0.03, lowerBound: 0.65, upperBound: 0.75, observations: 20 },
      ];

      const aggregated = aggregateConfidence(estimates);

      // Geometric mean is more conservative than arithmetic
      expect(aggregated.mean).toBeLessThan((0.9 + 0.8 + 0.7) / 3);
      expect(aggregated.observations).toBe(100);
    });

    it('should handle empty input', () => {
      const aggregated = aggregateConfidence([]);

      expect(aggregated.mean).toBe(0.5);
      expect(aggregated.variance).toBe(0.25);
    });

    it('should respect weights', () => {
      const estimates = [
        { mean: 0.9, variance: 0.01, lowerBound: 0.85, upperBound: 0.95, observations: 10 },
        { mean: 0.3, variance: 0.02, lowerBound: 0.25, upperBound: 0.35, observations: 10 },
      ];

      // Heavy weight on first estimate
      const weighted = aggregateConfidence(estimates, [0.9, 0.1]);

      expect(weighted.mean).toBeGreaterThan(0.6);
    });
  });

  describe('Stability Metrics', () => {
    it('should compute zero volatility for constant values', () => {
      const values = [0.5, 0.5, 0.5, 0.5, 0.5];
      const timestamps = values.map((_, i) => new Date(i * 1000).toISOString());

      const stability = computeStabilityFromHistory(values, timestamps);

      expect(stability.volatility).toBe(0);
      expect(stability.trend).toBe(0);
    });

    it('should detect positive trend', () => {
      const values = [0.1, 0.2, 0.3, 0.4, 0.5];
      const timestamps = values.map((_, i) => new Date(i * 1000).toISOString());

      const stability = computeStabilityFromHistory(values, timestamps);

      expect(stability.trend).toBeGreaterThan(0);
    });

    it('should detect negative trend', () => {
      const values = [0.5, 0.4, 0.3, 0.2, 0.1];
      const timestamps = values.map((_, i) => new Date(i * 1000).toISOString());

      const stability = computeStabilityFromHistory(values, timestamps);

      expect(stability.trend).toBeLessThan(0);
    });

    it('should compute volatility for varying values', () => {
      const values = [0.5, 0.7, 0.3, 0.8, 0.4];
      const timestamps = values.map((_, i) => new Date(i * 1000).toISOString());

      const stability = computeStabilityFromHistory(values, timestamps);

      expect(stability.volatility).toBeGreaterThan(0);
    });

    it('should handle single value', () => {
      const values = [0.5];
      const timestamps = [new Date().toISOString()];

      const stability = computeStabilityFromHistory(values, timestamps);

      expect(stability.volatility).toBe(0);
      expect(stability.trend).toBe(0);
    });

    it('should handle empty input', () => {
      const stability = computeStabilityFromHistory([], []);

      expect(stability.volatility).toBe(0);
      expect(stability.trend).toBe(0);
    });
  });

  describe('Uncertainty Reports', () => {
    it('should classify low uncertainty correctly', () => {
      const estimate = {
        mean: 0.9,
        variance: 0.001,
        lowerBound: 0.87,
        upperBound: 0.93,
        observations: 100,
      };

      const report = generateUncertaintyReport('test-entity', estimate);

      expect(report.uncertaintyLevel).toBe('low');
      expect(report.dataQuality).toBe('sufficient');
    });

    it('should classify high uncertainty correctly', () => {
      const estimate = {
        mean: 0.5,
        variance: 0.1,
        lowerBound: 0.2,
        upperBound: 0.8,
        observations: 5,
      };

      const report = generateUncertaintyReport('test-entity', estimate);

      expect(report.uncertaintyLevel).toBe('very_high');
      expect(report.dataQuality).toBe('minimal');
    });

    it('should provide appropriate recommendations', () => {
      const lowConfidence = {
        mean: 0.3,
        variance: 0.02,
        lowerBound: 0.25,
        upperBound: 0.35,
        observations: 50,
      };

      const report = generateUncertaintyReport('test-entity', lowConfidence);

      expect(report.recommendation).toContain('quality');
    });
  });

  describe('Full Probabilistic Analysis', () => {
    it('should run complete analysis on entity set', async () => {
      const entityIds = ['mod-a', 'mod-b', 'mod-c'];

      // Set up some confidence data
      for (const id of entityIds) {
        await storage.upsertBayesianConfidence({
          entityId: id,
          entityType: 'module',
          priorAlpha: 0.5,
          priorBeta: 0.5,
          posteriorAlpha: 5,
          posteriorBeta: 2,
          observationCount: 5,
          computedAt: new Date().toISOString(),
        });
      }

      const result = await runProbabilisticAnalysis(
        storage,
        entityIds,
        'module'
      );

      expect(result.confidenceEstimates.size).toBe(3);
      expect(result.uncertaintyReports.length).toBe(3);
      expect(result.healthScore).toBeGreaterThan(0);
      expect(result.healthScore).toBeLessThan(1);
    });

    it('should handle entities without prior data', async () => {
      const result = await runProbabilisticAnalysis(
        storage,
        ['new-entity'],
        'function'
      );

      expect(result.confidenceEstimates.size).toBe(1);

      const estimate = result.confidenceEstimates.get('new-entity');
      expect(estimate?.mean).toBeCloseTo(0.5, 1); // Jeffrey's prior mean
    });
  });
});
