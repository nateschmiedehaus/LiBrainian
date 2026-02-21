/**
 * Tests for Hybrid Analysis Module
 *
 * TDD tests for:
 * - Feedback loop detection
 * - Control stability metrics
 * - System health assessment
 * - Risk propagation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectFeedbackLoops,
  storeFeedbackLoops,
  computeControlStability,
  generateSystemHealthReport,
  propagateRisk,
  runHybridAnalysis,
} from '../hybrid_analysis.js';
import type { ModuleGraph } from '../../knowledge/module_graph.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../../storage/types.js';

describe('Hybrid Analysis', () => {
  let storage: LiBrainianStorage;
  let dbPath: string;
  const testDir = join(tmpdir(), 'hybrid-analysis-test-' + Date.now());

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

  describe('Feedback Loop Detection', () => {
    it('should detect simple mutual dependency', async () => {
      const graph: ModuleGraph = new Map([
        ['moduleA', new Set(['moduleB'])],
        ['moduleB', new Set(['moduleA'])],
      ]);

      const loops = await detectFeedbackLoops(storage, graph);

      expect(loops.length).toBe(1);
      expect(loops[0].loopType).toBe('mutual_recursion');
      expect(loops[0].entities).toHaveLength(2);
      expect(loops[0].cycleLength).toBe(2);
    });

    it('should detect circular chain', async () => {
      const graph: ModuleGraph = new Map([
        ['moduleA', new Set(['moduleB'])],
        ['moduleB', new Set(['moduleC'])],
        ['moduleC', new Set(['moduleA'])],
      ]);

      const loops = await detectFeedbackLoops(storage, graph);

      expect(loops.length).toBe(1);
      expect(loops[0].loopType).toBe('circular_import');
      expect(loops[0].entities).toHaveLength(3);
      expect(loops[0].cycleLength).toBe(3);
    });

    it('should detect complex cycles', async () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['a', 'c'])],
        ['c', new Set(['a', 'b'])],
      ]);

      const loops = await detectFeedbackLoops(storage, graph);

      expect(loops.length).toBe(1);
      expect(loops[0].loopType).toBe('state_cycle');
    });

    it('should return empty for DAG', async () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['d'])],
        ['c', new Set(['d'])],
        ['d', new Set()],
      ]);

      const loops = await detectFeedbackLoops(storage, graph);

      expect(loops.length).toBe(0);
    });

    it('should determine severity based on size and confidence', async () => {
      // Large cycle
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set(['d'])],
        ['d', new Set(['e'])],
        ['e', new Set(['a'])],
      ]);

      const loops = await detectFeedbackLoops(storage, graph);

      expect(loops[0].severity).toBe('critical');
    });

    it('should store detected loops', async () => {
      const graph: ModuleGraph = new Map([
        ['moduleA', new Set(['moduleB'])],
        ['moduleB', new Set(['moduleA'])],
      ]);

      const loops = await detectFeedbackLoops(storage, graph);
      await storeFeedbackLoops(storage, loops);

      const stored = await storage.getFeedbackLoops({ unresolvedOnly: true });
      expect(stored.length).toBe(1);
    });
  });

  describe('Control Stability', () => {
    it('should compute stability for healthy graph', async () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['d'])],
        ['c', new Set(['d'])],
        ['d', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set()],
        ['b', new Set(['a'])],
        ['c', new Set(['a'])],
        ['d', new Set(['b', 'c'])],
      ]);

      const stability = await computeControlStability(storage, graph, reverse);

      expect(stability.overallStability).toBeGreaterThan(0);
      expect(stability.overallStability).toBeLessThanOrEqual(1);
      expect(stability.feedbackLoopRisk).toBe(0);
    });

    it('should detect feedback loop risk', async () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['a'])],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['a'])],
      ]);

      const stability = await computeControlStability(storage, graph, reverse);

      expect(stability.feedbackLoopRisk).toBe(1); // All entities in loop
    });

    it('should identify volatile entities', async () => {
      const graph: ModuleGraph = new Map([
        ['volatile-mod', new Set()],
        ['stable-mod', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['volatile-mod', new Set()],
        ['stable-mod', new Set()],
      ]);

      // Set up stability metrics
      await storage.upsertStabilityMetrics({
        entityId: 'volatile-mod',
        entityType: 'module',
        volatility: 0.5,
        trend: 0.1,
        meanReversionRate: 0.2,
        halfLifeDays: 5,
        windowDays: 30,
        computedAt: new Date().toISOString(),
      });
      await storage.upsertStabilityMetrics({
        entityId: 'stable-mod',
        entityType: 'module',
        volatility: 0.05,
        trend: 0,
        meanReversionRate: 0.8,
        halfLifeDays: 1,
        windowDays: 30,
        computedAt: new Date().toISOString(),
      });

      const stability = await computeControlStability(storage, graph, reverse);

      expect(stability.volatileEntities).toContain('volatile-mod');
      expect(stability.stableEntities).toContain('stable-mod');
    });
  });

  describe('System Health Report', () => {
    it('should generate health report with grades', async () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set()],
        ['b', new Set(['a'])],
        ['c', new Set(['b'])],
      ]);

      const report = await generateSystemHealthReport(storage, graph, reverse);

      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
      expect(['A', 'B', 'C', 'D', 'F']).toContain(report.grade);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should identify critical issues for problematic graph', async () => {
      // Create a highly coupled graph with cycles
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c', 'd', 'e'])],
        ['b', new Set(['a', 'c', 'd', 'e'])],
        ['c', new Set(['a', 'b', 'd', 'e'])],
        ['d', new Set(['a', 'b', 'c', 'e'])],
        ['e', new Set(['a', 'b', 'c', 'd'])],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set(['b', 'c', 'd', 'e'])],
        ['b', new Set(['a', 'c', 'd', 'e'])],
        ['c', new Set(['a', 'b', 'd', 'e'])],
        ['d', new Set(['a', 'b', 'c', 'e'])],
        ['e', new Set(['a', 'b', 'c', 'd'])],
      ]);

      const report = await generateSystemHealthReport(storage, graph, reverse);

      expect(report.criticalIssues.length).toBeGreaterThan(0);
      expect(report.grade).not.toBe('A');
    });

    it('should compute component scores', async () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set()],
        ['b', new Set(['a'])],
      ]);

      const report = await generateSystemHealthReport(storage, graph, reverse);

      expect(report.components.structuralHealth).toBeGreaterThanOrEqual(0);
      expect(report.components.structuralHealth).toBeLessThanOrEqual(100);
      expect(report.components.confidenceHealth).toBeGreaterThanOrEqual(0);
      expect(report.components.stabilityHealth).toBeGreaterThanOrEqual(0);
      expect(report.components.couplingHealth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Risk Propagation', () => {
    it('should compute direct risk from confidence', async () => {
      const graph: ModuleGraph = new Map([
        ['risky', new Set()],
        ['safe', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['risky', new Set()],
        ['safe', new Set()],
      ]);

      // Set up confidence
      await storage.upsertBayesianConfidence({
        entityId: 'risky',
        entityType: 'module',
        priorAlpha: 0.5,
        priorBeta: 0.5,
        posteriorAlpha: 2,
        posteriorBeta: 10, // Low confidence
        observationCount: 10,
        computedAt: new Date().toISOString(),
      });
      await storage.upsertBayesianConfidence({
        entityId: 'safe',
        entityType: 'module',
        priorAlpha: 0.5,
        priorBeta: 0.5,
        posteriorAlpha: 10,
        posteriorBeta: 2, // High confidence
        observationCount: 10,
        computedAt: new Date().toISOString(),
      });

      const results = await propagateRisk(storage, graph, reverse);

      const riskyResult = results.find(r => r.entityId === 'risky');
      const safeResult = results.find(r => r.entityId === 'safe');

      expect(riskyResult!.directRisk).toBeGreaterThan(safeResult!.directRisk);
    });

    it('should propagate risk through dependencies', async () => {
      const graph: ModuleGraph = new Map([
        ['consumer', new Set(['risky-dep'])],
        ['risky-dep', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['consumer', new Set()],
        ['risky-dep', new Set(['consumer'])],
      ]);

      // Risky dependency has low confidence
      await storage.upsertBayesianConfidence({
        entityId: 'risky-dep',
        entityType: 'module',
        priorAlpha: 0.5,
        priorBeta: 0.5,
        posteriorAlpha: 1,
        posteriorBeta: 10,
        observationCount: 10,
        computedAt: new Date().toISOString(),
      });

      const results = await propagateRisk(storage, graph, reverse);

      const consumerResult = results.find(r => r.entityId === 'consumer');
      expect(consumerResult!.riskSources).toContain('risky-dep');
      expect(consumerResult!.propagatedRisk).toBeGreaterThan(consumerResult!.directRisk);
    });
  });

  describe('Full Hybrid Analysis', () => {
    it('should run complete hybrid analysis', async () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set(['a'])], // Creates cycle
        ['d', new Set(['b'])],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set(['c'])],
        ['b', new Set(['a', 'd'])],
        ['c', new Set(['b'])],
        ['d', new Set()],
      ]);

      const result = await runHybridAnalysis(storage, graph, reverse);

      expect(result.feedbackLoops.length).toBe(1);
      expect(result.controlStability).toBeDefined();
      expect(result.systemHealth).toBeDefined();
      expect(result.riskPropagation.length).toBe(4);
    });

    it('should store results during analysis', async () => {
      const graph: ModuleGraph = new Map([
        ['x', new Set(['y'])],
        ['y', new Set(['x'])],
      ]);
      const reverse: ModuleGraph = new Map([
        ['x', new Set(['y'])],
        ['y', new Set(['x'])],
      ]);

      await runHybridAnalysis(storage, graph, reverse);

      const storedLoops = await storage.getFeedbackLoops({});
      expect(storedLoops.length).toBeGreaterThan(0);
    });
  });
});
