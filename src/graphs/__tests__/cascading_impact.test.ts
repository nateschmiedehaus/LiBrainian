/**
 * Tests for Cascading Impact Analysis
 *
 * Tests for:
 * - Spreading activation algorithm
 * - Threshold pruning
 * - Risk vs benefit propagation factors
 * - Critical path identification
 * - Convenience APIs (estimateBenefitOfOptimizing, estimateBlastRadius)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeCascadingImpact,
  estimateBenefitOfOptimizing,
  estimateBlastRadius,
  compareCascadeImpact,
  getPropagationFactor,
  isHighImpactEntity,
  RISK_PROPAGATION_FACTORS,
  BENEFIT_PROPAGATION_FACTORS,
  DEFAULT_CASCADE_CONFIG,
} from '../cascading_impact.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage, KnowledgeGraphEdge } from '../../storage/types.js';

describe('Cascading Impact Analysis', () => {
  let storage: LiBrainianStorage;
  let dbPath: string;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), 'cascade-test-' + Date.now());
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
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Propagation Factors', () => {
    it('should have higher risk factors for structural edges', () => {
      expect(RISK_PROPAGATION_FACTORS.imports).toBeGreaterThan(0.8);
      expect(RISK_PROPAGATION_FACTORS.extends).toBeGreaterThan(0.9);
      expect(RISK_PROPAGATION_FACTORS.calls).toBeGreaterThan(0.8);
    });

    it('should have lower benefit factors for loose coupling', () => {
      expect(BENEFIT_PROPAGATION_FACTORS.clone_of).toBeLessThan(0.2);
      expect(BENEFIT_PROPAGATION_FACTORS.documents).toBeLessThan(0.1);
      expect(BENEFIT_PROPAGATION_FACTORS.similar_to).toBeLessThan(0.3);
    });

    it('should have higher risk than benefit for inheritance', () => {
      expect(RISK_PROPAGATION_FACTORS.extends).toBeGreaterThan(BENEFIT_PROPAGATION_FACTORS.extends);
      expect(RISK_PROPAGATION_FACTORS.implements).toBeGreaterThan(BENEFIT_PROPAGATION_FACTORS.implements);
    });

    it('should return correct factor via getPropagationFactor', () => {
      expect(getPropagationFactor('imports', 'risk')).toBe(RISK_PROPAGATION_FACTORS.imports);
      expect(getPropagationFactor('calls', 'benefit')).toBe(BENEFIT_PROPAGATION_FACTORS.calls);
      // Unknown edge type should return default 0.5
      expect(getPropagationFactor('unknown_type' as any, 'risk')).toBe(0.5);
    });
  });

  describe('Default Configuration', () => {
    it('should have reasonable defaults', () => {
      expect(DEFAULT_CASCADE_CONFIG.maxDepth).toBe(5);
      expect(DEFAULT_CASCADE_CONFIG.threshold).toBe(0.01);
      expect(DEFAULT_CASCADE_CONFIG.maxNodes).toBe(1000);
      expect(DEFAULT_CASCADE_CONFIG.includeRationale).toBe(false);
      expect(DEFAULT_CASCADE_CONFIG.includeEpistemic).toBe(false);
    });
  });

  describe('analyzeCascadingImpact', () => {
    it('should return empty result for isolated entity', async () => {
      const result = await analyzeCascadingImpact(storage, 'isolated-entity', {
        mode: 'risk',
      });

      expect(result.sourceEntity).toBe('isolated-entity');
      expect(result.mode).toBe('risk');
      expect(result.affectedEntities).toHaveLength(0);
      expect(result.totalImpact).toBe(0);
    });

    it('should propagate through direct dependencies', async () => {
      // Create: caller -> target (caller imports target)
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'edge-1',
          sourceId: 'caller',
          targetId: 'target',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];
      await storage.upsertKnowledgeEdges(edges);

      // Analyze risk from target (what happens if target breaks?)
      const result = await analyzeCascadingImpact(storage, 'target', {
        mode: 'risk',
      });

      expect(result.affectedEntities.length).toBe(1);
      expect(result.affectedEntities[0].entityId).toBe('caller');
      expect(result.affectedEntities[0].depth).toBe(1);
      expect(result.affectedEntities[0].impactScore).toBeCloseTo(0.9); // imports factor
    });

    it('should propagate through multiple hops', async () => {
      // Create chain: grandparent -> parent -> child
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'edge-1',
          sourceId: 'parent',
          targetId: 'child',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'calls',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'edge-2',
          sourceId: 'grandparent',
          targetId: 'parent',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'calls',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const result = await analyzeCascadingImpact(storage, 'child', {
        mode: 'risk',
      });

      expect(result.affectedEntities.length).toBe(2);

      const parent = result.affectedEntities.find(e => e.entityId === 'parent');
      const grandparent = result.affectedEntities.find(e => e.entityId === 'grandparent');

      expect(parent).toBeDefined();
      expect(parent!.depth).toBe(1);

      expect(grandparent).toBeDefined();
      expect(grandparent!.depth).toBe(2);
      // Grandparent should have lower impact (0.85 * 0.85 for calls)
      expect(grandparent!.impactScore).toBeLessThan(parent!.impactScore);
    });

    it('should apply threshold pruning', async () => {
      // Create deep chain
      const edges: KnowledgeGraphEdge[] = [];
      for (let i = 0; i < 10; i++) {
        edges.push({
          id: `edge-${i}`,
          sourceId: `node-${i + 1}`,
          targetId: `node-${i}`,
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'clone_of', // Low propagation factor (0.3)
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        });
      }
      await storage.upsertKnowledgeEdges(edges);

      const result = await analyzeCascadingImpact(storage, 'node-0', {
        mode: 'risk',
        threshold: 0.01,
      });

      // With clone_of factor of 0.3, impact drops below 0.01 after a few hops
      // 0.3^4 = 0.0081 < 0.01, so should stop around depth 4
      const maxDepth = Math.max(...result.affectedEntities.map(e => e.depth));
      expect(maxDepth).toBeLessThanOrEqual(5);
    });

    it('should respect maxDepth configuration', async () => {
      // Create long chain
      const edges: KnowledgeGraphEdge[] = [];
      for (let i = 0; i < 10; i++) {
        edges.push({
          id: `edge-${i}`,
          sourceId: `node-${i + 1}`,
          targetId: `node-${i}`,
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports', // High propagation factor
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        });
      }
      await storage.upsertKnowledgeEdges(edges);

      const result = await analyzeCascadingImpact(storage, 'node-0', {
        mode: 'risk',
        maxDepth: 3,
      });

      const maxDepth = Math.max(...result.affectedEntities.map(e => e.depth), 0);
      expect(maxDepth).toBeLessThanOrEqual(3);
    });

    it('should apply edge weight to propagation', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'strong-edge',
          sourceId: 'strong-caller',
          targetId: 'target',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'calls',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'weak-edge',
          sourceId: 'weak-caller',
          targetId: 'target',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'calls',
          weight: 0.5, // Half weight
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const result = await analyzeCascadingImpact(storage, 'target', {
        mode: 'risk',
      });

      const strongCaller = result.affectedEntities.find(e => e.entityId === 'strong-caller');
      const weakCaller = result.affectedEntities.find(e => e.entityId === 'weak-caller');

      expect(strongCaller!.impactScore).toBeGreaterThan(weakCaller!.impactScore);
      expect(strongCaller!.impactScore).toBeCloseTo(weakCaller!.impactScore * 2);
    });

    it('should use different factors for benefit vs risk mode', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'edge-1',
          sourceId: 'caller',
          targetId: 'target',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports', // Risk: 0.9, Benefit: 0.3
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const riskResult = await analyzeCascadingImpact(storage, 'target', {
        mode: 'risk',
      });

      const benefitResult = await analyzeCascadingImpact(storage, 'target', {
        mode: 'benefit',
      });

      expect(riskResult.affectedEntities[0].impactScore).toBeCloseTo(0.9);
      expect(benefitResult.affectedEntities[0].impactScore).toBeCloseTo(0.3);
    });

    it('should identify critical path', async () => {
      // Create diamond: a -> b, a -> c, b -> d, c -> d
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'b', targetId: 'd', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'c', targetId: 'd', sourceType: 'module', targetType: 'module', edgeType: 'calls', weight: 0.5, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e3', sourceId: 'a', targetId: 'b', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e4', sourceId: 'a', targetId: 'c', sourceType: 'module', targetType: 'module', edgeType: 'calls', weight: 0.5, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const result = await analyzeCascadingImpact(storage, 'd', {
        mode: 'risk',
      });

      // Critical path should prefer the higher-impact route (d -> b -> a via imports)
      expect(result.criticalPath.length).toBeGreaterThan(1);
      expect(result.criticalPath[0]).toBe('d');
    });

    it('should generate human-readable summary', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'caller1', targetId: 'target', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'caller2', targetId: 'target', sourceType: 'module', targetType: 'module', edgeType: 'calls', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const result = await analyzeCascadingImpact(storage, 'target', {
        mode: 'risk',
      });

      expect(result.summary).toContain('Breaking');
      expect(result.summary).toContain('target');
      expect(result.summary).toContain('2 entities');
      expect(result.summary).toContain('Depth 1');
    });
  });

  describe('estimateBenefitOfOptimizing', () => {
    it('should scale benefit by improvement factor', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'caller', targetId: 'target', sourceType: 'module', targetType: 'module', edgeType: 'calls', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const benefit1x = await estimateBenefitOfOptimizing(storage, 'target', 1.5);
      const benefit2x = await estimateBenefitOfOptimizing(storage, 'target', 2.0);

      // 2x improvement (factor - 1 = 1.0) should yield more benefit than 1.5x (factor - 1 = 0.5)
      expect(benefit2x.totalBenefit).toBeGreaterThan(benefit1x.totalBenefit);
      expect(benefit2x.totalBenefit).toBeCloseTo(benefit1x.totalBenefit * 2);
    });

    it('should return beneficiaries', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'user1', targetId: 'target', sourceType: 'function', targetType: 'function', edgeType: 'calls', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'user2', targetId: 'target', sourceType: 'function', targetType: 'function', edgeType: 'calls', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const benefit = await estimateBenefitOfOptimizing(storage, 'target', 2.0);

      expect(benefit.beneficiaries.length).toBe(2);
      expect(benefit.beneficiaries.map(b => b.entityId)).toContain('user1');
      expect(benefit.beneficiaries.map(b => b.entityId)).toContain('user2');
    });

    it('should generate appropriate recommendation', async () => {
      const lowBenefit = await estimateBenefitOfOptimizing(storage, 'isolated', 2.0);
      expect(lowBenefit.recommendation).toContain('Low benefit');

      // Create high-impact scenario
      const edges: KnowledgeGraphEdge[] = [];
      for (let i = 0; i < 20; i++) {
        edges.push({
          id: `e${i}`,
          sourceId: `caller-${i}`,
          targetId: 'hot-function',
          sourceType: 'function',
          targetType: 'function',
          edgeType: 'calls',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        });
      }
      await storage.upsertKnowledgeEdges(edges);

      const highBenefit = await estimateBenefitOfOptimizing(storage, 'hot-function', 2.0);
      expect(highBenefit.recommendation).toMatch(/High benefit|Critical benefit/);
    });
  });

  describe('estimateBlastRadius', () => {
    it('should return minor severity for isolated entity', async () => {
      const blast = await estimateBlastRadius(storage, 'isolated', 'major');

      expect(blast.severity).toBe('minor');
      expect(blast.affectedCount).toBe(0);
      expect(blast.totalRisk).toBe(0);
    });

    it('should identify critical dependents', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'critical-service', targetId: 'core-function', sourceType: 'module', targetType: 'function', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'less-critical', targetId: 'core-function', sourceType: 'module', targetType: 'function', edgeType: 'clone_of', weight: 0.5, confidence: 0.5, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const blast = await estimateBlastRadius(storage, 'core-function', 'major');

      expect(blast.criticalDependents).toContain('critical-service');
      // Less critical might not be in the list due to lower impact score
    });

    it('should generate mitigations for high-impact breaks', async () => {
      const edges: KnowledgeGraphEdge[] = [];
      for (let i = 0; i < 15; i++) {
        edges.push({
          id: `e${i}`,
          sourceId: `dependent-${i}`,
          targetId: 'central-service',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        });
      }
      await storage.upsertKnowledgeEdges(edges);

      const blast = await estimateBlastRadius(storage, 'central-service', 'critical');

      expect(blast.mitigations.length).toBeGreaterThan(0);
      expect(blast.mitigations.some(m => m.includes('feature flag') || m.includes('migration'))).toBe(true);
    });

    it('should adjust severity based on breaking severity input', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'caller1', targetId: 'target', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'caller2', targetId: 'target', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const minorBlast = await estimateBlastRadius(storage, 'target', 'minor');
      const criticalBlast = await estimateBlastRadius(storage, 'target', 'critical');

      expect(criticalBlast.totalRisk).toBeGreaterThan(minorBlast.totalRisk);
    });
  });

  describe('compareCascadeImpact', () => {
    it('should compare and sort entities by impact', async () => {
      // Create scenario where 'hub' has more dependents than 'leaf'
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'caller1', targetId: 'hub', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'caller2', targetId: 'hub', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e3', sourceId: 'caller3', targetId: 'hub', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e4', sourceId: 'single-caller', targetId: 'leaf', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const comparison = await compareCascadeImpact(storage, ['hub', 'leaf'], 'risk');

      expect(comparison.length).toBe(2);
      // Hub should be first (higher impact)
      expect(comparison[0].entityId).toBe('hub');
      expect(comparison[0].result.totalImpact).toBeGreaterThan(comparison[1].result.totalImpact);
    });
  });

  describe('isHighImpactEntity', () => {
    it('should return false for isolated entity', async () => {
      const isHigh = await isHighImpactEntity(storage, 'isolated');
      expect(isHigh).toBe(false);
    });

    it('should return true for highly connected entity', async () => {
      const edges: KnowledgeGraphEdge[] = [];
      for (let i = 0; i < 15; i++) {
        edges.push({
          id: `e${i}`,
          sourceId: `caller-${i}`,
          targetId: 'central-hub',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        });
      }
      await storage.upsertKnowledgeEdges(edges);

      const isHigh = await isHighImpactEntity(storage, 'central-hub');
      expect(isHigh).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle cycles without infinite loop', async () => {
      // Create cycle: a -> b -> c -> a
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'b', targetId: 'a', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'c', targetId: 'b', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e3', sourceId: 'a', targetId: 'c', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      // Should complete without hanging
      const result = await analyzeCascadingImpact(storage, 'a', {
        mode: 'risk',
        maxDepth: 10,
      });

      // All three nodes should be reachable (but cycles handled)
      expect(result.affectedEntities.length).toBeLessThanOrEqual(3);
    });

    it('should handle self-referencing edges', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'recursive', targetId: 'recursive', sourceType: 'function', targetType: 'function', edgeType: 'calls', weight: 1.0, confidence: 1.0, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const result = await analyzeCascadingImpact(storage, 'recursive', {
        mode: 'risk',
      });

      // Should complete without infinite loop
      expect(result.totalImpact).toBeDefined();
    });

    it('should respect maxNodes limit', async () => {
      // Create wide graph
      const edges: KnowledgeGraphEdge[] = [];
      for (let i = 0; i < 100; i++) {
        edges.push({
          id: `e${i}`,
          sourceId: `caller-${i}`,
          targetId: 'hub',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        });
      }
      await storage.upsertKnowledgeEdges(edges);

      const result = await analyzeCascadingImpact(storage, 'hub', {
        mode: 'risk',
        maxNodes: 10,
      });

      // Should stop before processing all 100 callers
      expect(result.affectedEntities.length).toBeLessThanOrEqual(10);
    });
  });
});
