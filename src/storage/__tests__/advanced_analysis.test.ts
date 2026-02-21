/**
 * @fileoverview TDD Tests for Advanced Analysis Storage Layer
 *
 * Tests cover:
 * - SCC (Strongly Connected Components) storage
 * - CFG (Control Flow Graph) edges storage
 * - Bayesian confidence tracking
 * - Stability metrics storage
 * - Feedback loop detection storage
 * - Graph analysis cache
 *
 * These tests are written BEFORE implementation (TDD approach).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqliteStorage } from '../sqlite_storage.js';
import type {
  LiBrainianStorage,
  SCCEntry,
  CFGEdge,
  BayesianConfidence,
  StabilityMetrics,
  FeedbackLoop,
  GraphCacheEntry,
} from '../types.js';

describe('Advanced Analysis Storage', () => {
  let storage: LiBrainianStorage;
  let dbPath: string;
  const testDir = join(tmpdir(), 'librainian-advanced-test-' + Date.now());

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

  // ========================================================================
  // SCC (Strongly Connected Components) Tests
  // ========================================================================

  describe('SCC Storage', () => {
    const createTestSCC = (componentId: number, entityId: string): SCCEntry => ({
      componentId,
      entityId,
      entityType: 'function',
      isRoot: componentId === 0,
      componentSize: 3,
      computedAt: new Date().toISOString(),
    });

    it('should store and retrieve SCC entries', async () => {
      const entries: SCCEntry[] = [
        createTestSCC(1, 'func-a'),
        createTestSCC(1, 'func-b'),
        createTestSCC(1, 'func-c'),
        createTestSCC(2, 'func-d'),
      ];

      await storage.upsertSCCEntries(entries);

      const retrieved = await storage.getSCCEntries({ componentId: 1 });
      expect(retrieved).toHaveLength(3);
      expect(retrieved.map(e => e.entityId).sort()).toEqual(['func-a', 'func-b', 'func-c']);
    });

    it('should retrieve SCC by entity', async () => {
      const entry = createTestSCC(1, 'func-a');
      await storage.upsertSCCEntries([entry]);

      const retrieved = await storage.getSCCByEntity('func-a', 'function');
      expect(retrieved).toBeTruthy();
      expect(retrieved?.componentId).toBe(1);
    });

    it('should filter SCC by minimum size', async () => {
      const entries: SCCEntry[] = [
        { ...createTestSCC(1, 'func-a'), componentSize: 5 },
        { ...createTestSCC(1, 'func-b'), componentSize: 5 },
        { ...createTestSCC(2, 'func-c'), componentSize: 1 },
      ];

      await storage.upsertSCCEntries(entries);

      const retrieved = await storage.getSCCEntries({ minSize: 3 });
      expect(retrieved).toHaveLength(2);
    });

    it('should delete all SCC entries', async () => {
      await storage.upsertSCCEntries([createTestSCC(1, 'func-a')]);
      await storage.deleteSCCEntries();

      const retrieved = await storage.getSCCEntries({});
      expect(retrieved).toHaveLength(0);
    });
  });

  // ========================================================================
  // CFG (Control Flow Graph) Tests
  // ========================================================================

  describe('CFG Storage', () => {
    const createTestCFGEdge = (functionId: string, fromBlock: number, toBlock: number): CFGEdge => ({
      functionId,
      fromBlock,
      toBlock,
      edgeType: 'sequential',
      confidence: 1.0,
    });

    it('should store and retrieve CFG edges', async () => {
      const edges: CFGEdge[] = [
        createTestCFGEdge('func-1', 0, 1),
        createTestCFGEdge('func-1', 1, 2),
        createTestCFGEdge('func-1', 2, 3),
      ];

      await storage.upsertCFGEdges(edges);

      const retrieved = await storage.getCFGForFunction('func-1');
      expect(retrieved).toHaveLength(3);
    });

    it('should filter CFG edges by type', async () => {
      const edges: CFGEdge[] = [
        { ...createTestCFGEdge('func-1', 0, 1), edgeType: 'sequential' },
        { ...createTestCFGEdge('func-1', 1, 2), edgeType: 'branch_true' },
        { ...createTestCFGEdge('func-1', 1, 3), edgeType: 'branch_false' },
      ];

      await storage.upsertCFGEdges(edges);

      const retrieved = await storage.getCFGEdges({ edgeType: 'branch_true' });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].toBlock).toBe(2);
    });

    it('should delete CFG edges for a function', async () => {
      await storage.upsertCFGEdges([createTestCFGEdge('func-1', 0, 1)]);
      await storage.upsertCFGEdges([createTestCFGEdge('func-2', 0, 1)]);

      await storage.deleteCFGEdgesForFunction('func-1');

      const func1Edges = await storage.getCFGForFunction('func-1');
      const func2Edges = await storage.getCFGForFunction('func-2');

      expect(func1Edges).toHaveLength(0);
      expect(func2Edges).toHaveLength(1);
    });
  });

  // ========================================================================
  // Bayesian Confidence Tests
  // ========================================================================

  describe('Bayesian Confidence Storage', () => {
    const createTestBayesian = (entityId: string): BayesianConfidence => ({
      entityId,
      entityType: 'function',
      priorAlpha: 1.0,
      priorBeta: 1.0,
      posteriorAlpha: 1.0,
      posteriorBeta: 1.0,
      observationCount: 0,
      computedAt: new Date().toISOString(),
    });

    it('should store and retrieve Bayesian confidence', async () => {
      const entry = createTestBayesian('func-1');
      await storage.upsertBayesianConfidence(entry);

      const retrieved = await storage.getBayesianConfidence('func-1', 'function');
      expect(retrieved).toBeTruthy();
      expect(retrieved?.entityId).toBe('func-1');
      expect(retrieved?.priorAlpha).toBe(1.0);
    });

    it('should update Bayesian confidence on success', async () => {
      const entry = createTestBayesian('func-1');
      await storage.upsertBayesianConfidence(entry);

      // Simulate success observation
      await storage.updateBayesianConfidence('func-1', 'function', true);

      const retrieved = await storage.getBayesianConfidence('func-1', 'function');
      expect(retrieved?.posteriorAlpha).toBe(2.0); // alpha + 1
      expect(retrieved?.posteriorBeta).toBe(1.0);  // beta unchanged
      expect(retrieved?.observationCount).toBe(1);
    });

    it('should update Bayesian confidence on failure', async () => {
      const entry = createTestBayesian('func-1');
      await storage.upsertBayesianConfidence(entry);

      // Simulate failure observation
      await storage.updateBayesianConfidence('func-1', 'function', false);

      const retrieved = await storage.getBayesianConfidence('func-1', 'function');
      expect(retrieved?.posteriorAlpha).toBe(1.0); // alpha unchanged
      expect(retrieved?.posteriorBeta).toBe(2.0);  // beta + 1
      expect(retrieved?.observationCount).toBe(1);
    });

    it('should compute correct Bayesian mean', async () => {
      // After 8 successes and 2 failures, mean should be ~0.8
      const entry: BayesianConfidence = {
        ...createTestBayesian('func-1'),
        posteriorAlpha: 9.0,  // 8 successes + 1 prior
        posteriorBeta: 3.0,   // 2 failures + 1 prior
        observationCount: 10,
      };
      await storage.upsertBayesianConfidence(entry);

      const retrieved = await storage.getBayesianConfidence('func-1', 'function');
      // Mean = alpha / (alpha + beta) = 9 / 12 = 0.75
      const mean = retrieved!.posteriorAlpha / (retrieved!.posteriorAlpha + retrieved!.posteriorBeta);
      expect(mean).toBeCloseTo(0.75, 2);
    });

    it('should list Bayesian confidences with minimum observations', async () => {
      await storage.upsertBayesianConfidence({
        ...createTestBayesian('func-1'),
        observationCount: 5,
      });
      await storage.upsertBayesianConfidence({
        ...createTestBayesian('func-2'),
        observationCount: 15,
      });
      await storage.upsertBayesianConfidence({
        ...createTestBayesian('func-3'),
        observationCount: 2,
      });

      const retrieved = await storage.getBayesianConfidences({ minObservations: 5 });
      expect(retrieved).toHaveLength(2);
    });
  });

  // ========================================================================
  // Stability Metrics Tests
  // ========================================================================

  describe('Stability Metrics Storage', () => {
    const createTestStability = (entityId: string): StabilityMetrics => ({
      entityId,
      entityType: 'function',
      volatility: 0.1,
      trend: 0.02,
      meanReversionRate: 0.5,
      halfLifeDays: 14,
      computedAt: new Date().toISOString(),
      windowDays: 30,
    });

    it('should store and retrieve stability metrics', async () => {
      const metrics = createTestStability('func-1');
      await storage.upsertStabilityMetrics(metrics);

      const retrieved = await storage.getStabilityMetrics('func-1', 'function');
      expect(retrieved).toBeTruthy();
      expect(retrieved?.volatility).toBe(0.1);
      expect(retrieved?.trend).toBe(0.02);
    });

    it('should filter by volatility range', async () => {
      await storage.upsertStabilityMetrics({ ...createTestStability('func-1'), volatility: 0.05 });
      await storage.upsertStabilityMetrics({ ...createTestStability('func-2'), volatility: 0.15 });
      await storage.upsertStabilityMetrics({ ...createTestStability('func-3'), volatility: 0.25 });

      const retrieved = await storage.getStabilityMetricsList({
        minVolatility: 0.1,
        maxVolatility: 0.2,
      });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].entityId).toBe('func-2');
    });

    it('should filter by trend direction', async () => {
      await storage.upsertStabilityMetrics({ ...createTestStability('func-1'), trend: 0.05 });  // increasing
      await storage.upsertStabilityMetrics({ ...createTestStability('func-2'), trend: -0.03 }); // decreasing
      await storage.upsertStabilityMetrics({ ...createTestStability('func-3'), trend: 0.001 }); // stable

      const increasing = await storage.getStabilityMetricsList({ trendDirection: 'increasing' });
      expect(increasing).toHaveLength(1);
      expect(increasing[0].entityId).toBe('func-1');
    });
  });

  // ========================================================================
  // Feedback Loop Tests
  // ========================================================================

  describe('Feedback Loop Storage', () => {
    const createTestLoop = (loopId: string): FeedbackLoop => ({
      loopId,
      loopType: 'circular_import',
      entities: ['mod-a', 'mod-b', 'mod-c'],
      severity: 'medium',
      isStable: true,
      cycleLength: 3,
      detectedAt: new Date().toISOString(),
    });

    it('should store and retrieve feedback loops', async () => {
      const loop = createTestLoop('loop-1');
      await storage.upsertFeedbackLoop(loop);

      const retrieved = await storage.getFeedbackLoop('loop-1');
      expect(retrieved).toBeTruthy();
      expect(retrieved?.entities).toEqual(['mod-a', 'mod-b', 'mod-c']);
    });

    it('should filter by loop type', async () => {
      await storage.upsertFeedbackLoop({ ...createTestLoop('loop-1'), loopType: 'circular_import' });
      await storage.upsertFeedbackLoop({ ...createTestLoop('loop-2'), loopType: 'mutual_recursion' });

      const retrieved = await storage.getFeedbackLoops({ loopType: 'circular_import' });
      expect(retrieved).toHaveLength(1);
    });

    it('should filter by severity', async () => {
      await storage.upsertFeedbackLoop({ ...createTestLoop('loop-1'), severity: 'low' });
      await storage.upsertFeedbackLoop({ ...createTestLoop('loop-2'), severity: 'high' });
      await storage.upsertFeedbackLoop({ ...createTestLoop('loop-3'), severity: 'critical' });

      const retrieved = await storage.getFeedbackLoops({ severity: 'high' });
      expect(retrieved).toHaveLength(1);
    });

    it('should resolve feedback loop', async () => {
      await storage.upsertFeedbackLoop(createTestLoop('loop-1'));
      await storage.resolveFeedbackLoop('loop-1', 'refactored to break cycle');

      const retrieved = await storage.getFeedbackLoop('loop-1');
      expect(retrieved?.resolvedAt).toBeTruthy();
      expect(retrieved?.resolutionMethod).toBe('refactored to break cycle');
    });

    it('should filter unresolved loops', async () => {
      await storage.upsertFeedbackLoop(createTestLoop('loop-1'));
      await storage.upsertFeedbackLoop(createTestLoop('loop-2'));
      await storage.resolveFeedbackLoop('loop-1', 'fixed');

      const unresolved = await storage.getFeedbackLoops({ unresolvedOnly: true });
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].loopId).toBe('loop-2');
    });
  });

  // ========================================================================
  // Graph Cache Tests
  // ========================================================================

  describe('Graph Cache Storage', () => {
    const createTestCacheEntry = (key: string): GraphCacheEntry => ({
      cacheKey: key,
      analysisType: 'pagerank',
      result: JSON.stringify({ scores: { 'node-1': 0.5 } }),
      nodeCount: 100,
      edgeCount: 500,
      computationMs: 1234,
      computedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // +1 hour
    });

    it('should store and retrieve cache entries', async () => {
      const entry = createTestCacheEntry('pagerank-v1');
      await storage.upsertGraphCacheEntry(entry);

      const retrieved = await storage.getGraphCacheEntry('pagerank-v1');
      expect(retrieved).toBeTruthy();
      expect(retrieved?.analysisType).toBe('pagerank');
      expect(JSON.parse(retrieved!.result)).toEqual({ scores: { 'node-1': 0.5 } });
    });

    it('should prune expired cache entries', async () => {
      // Add an expired entry
      const expired: GraphCacheEntry = {
        ...createTestCacheEntry('old-entry'),
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
      };
      await storage.upsertGraphCacheEntry(expired);

      // Add a valid entry
      await storage.upsertGraphCacheEntry(createTestCacheEntry('new-entry'));

      const prunedCount = await storage.pruneExpiredGraphCache();
      expect(prunedCount).toBe(1);

      const oldEntry = await storage.getGraphCacheEntry('old-entry');
      const newEntry = await storage.getGraphCacheEntry('new-entry');

      expect(oldEntry).toBeNull();
      expect(newEntry).toBeTruthy();
    });
  });

  // ========================================================================
  // Mathematical Consistency Tests
  // ========================================================================

  describe('Mathematical Consistency', () => {
    it('should enforce confidence bounds [0, 1]', async () => {
      // CFG edge with out-of-bounds confidence should be clamped or rejected
      const edge: CFGEdge = {
        functionId: 'func-1',
        fromBlock: 0,
        toBlock: 1,
        edgeType: 'sequential',
        confidence: 1.5, // Out of bounds
      };

      await storage.upsertCFGEdges([edge]);
      const retrieved = await storage.getCFGForFunction('func-1');

      // Implementation should clamp to [0, 1]
      expect(retrieved[0].confidence).toBeLessThanOrEqual(1.0);
      expect(retrieved[0].confidence).toBeGreaterThanOrEqual(0.0);
    });

    it('should maintain Bayesian prior/posterior consistency', async () => {
      const entry: BayesianConfidence = {
        entityId: 'func-1',
        entityType: 'function',
        priorAlpha: 1.0,
        priorBeta: 1.0,
        posteriorAlpha: 1.0,
        posteriorBeta: 1.0,
        observationCount: 0,
        computedAt: new Date().toISOString(),
      };

      await storage.upsertBayesianConfidence(entry);

      // 5 successes
      for (let i = 0; i < 5; i++) {
        await storage.updateBayesianConfidence('func-1', 'function', true);
      }

      // 2 failures
      for (let i = 0; i < 2; i++) {
        await storage.updateBayesianConfidence('func-1', 'function', false);
      }

      const retrieved = await storage.getBayesianConfidence('func-1', 'function');

      // posterior_alpha = prior_alpha + successes = 1 + 5 = 6
      // posterior_beta = prior_beta + failures = 1 + 2 = 3
      expect(retrieved?.posteriorAlpha).toBe(6.0);
      expect(retrieved?.posteriorBeta).toBe(3.0);
      expect(retrieved?.observationCount).toBe(7);
    });

    it('should compute variance correctly', async () => {
      // For Beta(6, 3): variance = ab / ((a+b)^2 * (a+b+1))
      // = 6*3 / (81 * 10) = 18 / 810 = 0.0222...
      const entry: BayesianConfidence = {
        entityId: 'func-1',
        entityType: 'function',
        priorAlpha: 1.0,
        priorBeta: 1.0,
        posteriorAlpha: 6.0,
        posteriorBeta: 3.0,
        observationCount: 7,
        computedAt: new Date().toISOString(),
      };

      await storage.upsertBayesianConfidence(entry);
      const retrieved = await storage.getBayesianConfidence('func-1', 'function');

      const a = retrieved!.posteriorAlpha;
      const b = retrieved!.posteriorBeta;
      const variance = (a * b) / (Math.pow(a + b, 2) * (a + b + 1));

      expect(variance).toBeCloseTo(0.0222, 3);
    });
  });

  // ========================================================================
  // Edge Cases and Error Handling
  // ========================================================================

  describe('Edge Cases', () => {
    it('should return null for non-existent SCC', async () => {
      const result = await storage.getSCCByEntity('non-existent', 'function');
      expect(result).toBeNull();
    });

    it('should return null for non-existent Bayesian confidence', async () => {
      const result = await storage.getBayesianConfidence('non-existent', 'function');
      expect(result).toBeNull();
    });

    it('should return null for non-existent feedback loop', async () => {
      const result = await storage.getFeedbackLoop('non-existent');
      expect(result).toBeNull();
    });

    it('should handle empty entity arrays in feedback loops', async () => {
      const loop: FeedbackLoop = {
        loopId: 'empty-loop',
        loopType: 'circular_import',
        entities: [],
        severity: 'low',
        isStable: true,
        cycleLength: 0,
        detectedAt: new Date().toISOString(),
      };

      await storage.upsertFeedbackLoop(loop);
      const retrieved = await storage.getFeedbackLoop('empty-loop');

      expect(retrieved).toBeTruthy();
      expect(retrieved?.entities).toEqual([]);
    });

    it('should handle upsert (update existing)', async () => {
      const entry = {
        entityId: 'func-1',
        entityType: 'function' as const,
        priorAlpha: 1.0,
        priorBeta: 1.0,
        posteriorAlpha: 1.0,
        posteriorBeta: 1.0,
        observationCount: 0,
        computedAt: new Date().toISOString(),
      };

      await storage.upsertBayesianConfidence(entry);
      await storage.upsertBayesianConfidence({
        ...entry,
        posteriorAlpha: 5.0,
        observationCount: 4,
      });

      const retrieved = await storage.getBayesianConfidence('func-1', 'function');
      expect(retrieved?.posteriorAlpha).toBe(5.0);
      expect(retrieved?.observationCount).toBe(4);
    });
  });
});
