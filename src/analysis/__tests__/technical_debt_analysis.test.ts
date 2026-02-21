/**
 * Tests for Technical Debt Analysis
 *
 * Tests for:
 * - Individual debt category calculations
 * - Debt aggregation and scoring
 * - Priority determination
 * - Fix time estimation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  calculateComplexityDebt,
  aggregateDebt,
  estimateFixHours,
  COMPLEXITY_THRESHOLDS,
  DEBT_WEIGHTS,
  PRIORITY_THRESHOLDS,
  type DebtSignals,
} from '../technical_debt_analysis.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage, DebtMetrics } from '../../storage/types.js';

// Helper to create complete DebtMetrics with defaults
function createDebtMetrics(partial: Partial<DebtMetrics> & Pick<DebtMetrics, 'entityId' | 'entityType' | 'totalDebt' | 'trend'>): DebtMetrics {
  return {
    complexityDebt: 0,
    duplicationDebt: 0,
    couplingDebt: 0,
    coverageDebt: 0,
    architectureDebt: 0,
    churnDebt: 0,
    documentationDebt: 0,
    securityDebt: 0,
    trendDelta: 0,
    velocityPerDay: 0,
    estimatedFixHours: 0,
    priority: 'low',
    recommendations: [],
    confidenceAlpha: 1,
    confidenceBeta: 1,
    computedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('Technical Debt Analysis', () => {
  describe('calculateComplexityDebt', () => {
    it('should return 0 for low complexity', () => {
      // Low line count, few functions, normal complexity
      const result = calculateComplexityDebt(50, 5, 5);

      expect(result.score).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it('should flag high cyclomatic complexity', () => {
      // High cyclomatic complexity (> 20 is high threshold)
      const result = calculateComplexityDebt(100, 5, 25);

      expect(result.score).toBeGreaterThan(0);
      expect(result.details.some(d => d.toLowerCase().includes('cyclomatic'))).toBe(true);
    });

    it('should flag high average function size', () => {
      // High average lines per function (> 300 is high threshold)
      const result = calculateComplexityDebt(500, 1, 5);

      expect(result.score).toBeGreaterThan(0);
      expect(result.details.some(d => d.toLowerCase().includes('function size') || d.toLowerCase().includes('lines'))).toBe(true);
    });

    it('should flag high cognitive complexity', () => {
      // High cognitive complexity (> 30 is high threshold)
      const result = calculateComplexityDebt(100, 5, 10, '35');

      expect(result.score).toBeGreaterThan(0);
      expect(result.details.some(d => d.toLowerCase().includes('cognitive'))).toBe(true);
    });

    it('should accumulate multiple issues', () => {
      // High everything
      const result = calculateComplexityDebt(1000, 1, 60, '70');

      expect(result.details.length).toBeGreaterThan(1);
      expect(result.score).toBeGreaterThan(50);
    });

    it('should cap score at 100', () => {
      // Extreme values
      const result = calculateComplexityDebt(10000, 1, 200, '200');

      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should handle undefined complexity', () => {
      // Only line counts provided
      const result = calculateComplexityDebt(50, 5);

      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('aggregateDebt', () => {
    it('should aggregate all debt categories', () => {
      const signals: DebtSignals = {
        complexity: { score: 30, details: ['High complexity'] },
        duplication: { score: 20, details: ['Some duplication'] },
        coupling: { score: 10, details: [] },
        coverage: { score: 40, details: ['Low coverage'] },
        architecture: { score: 15, details: [] },
        churn: { score: 25, details: ['High churn'] },
        documentation: { score: 35, details: ['Missing docs'] },
        security: { score: 5, details: [] },
      };

      const result = aggregateDebt(signals);

      expect(result.totalDebt).toBeGreaterThan(0);
      expect(result.totalDebt).toBeLessThanOrEqual(100);
    });

    it('should apply category weights', () => {
      // Security debt should weigh more than documentation debt
      const securityHeavy: DebtSignals = {
        complexity: { score: 0, details: [] },
        duplication: { score: 0, details: [] },
        coupling: { score: 0, details: [] },
        coverage: { score: 0, details: [] },
        architecture: { score: 0, details: [] },
        churn: { score: 0, details: [] },
        documentation: { score: 0, details: [] },
        security: { score: 60, details: ['Security issue'] },
      };

      const docsHeavy: DebtSignals = {
        complexity: { score: 0, details: [] },
        duplication: { score: 0, details: [] },
        coupling: { score: 0, details: [] },
        coverage: { score: 0, details: [] },
        architecture: { score: 0, details: [] },
        churn: { score: 0, details: [] },
        documentation: { score: 60, details: ['Missing docs'] },
        security: { score: 0, details: [] },
      };

      const securityResult = aggregateDebt(securityHeavy);
      const docsResult = aggregateDebt(docsHeavy);

      // Security weight (0.10) > Documentation weight (0.05)
      expect(securityResult.totalDebt).toBeGreaterThan(docsResult.totalDebt);
    });

    it('should generate recommendations for high-scoring categories', () => {
      const signals: DebtSignals = {
        complexity: { score: 80, details: ['Very high complexity'] },
        duplication: { score: 0, details: [] },
        coupling: { score: 0, details: [] },
        coverage: { score: 0, details: [] },
        architecture: { score: 0, details: [] },
        churn: { score: 0, details: [] },
        documentation: { score: 0, details: [] },
        security: { score: 0, details: [] },
      };

      const result = aggregateDebt(signals);

      // Score > 50 should generate recommendation
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some(r => r.toLowerCase().includes('complexity'))).toBe(true);
    });

    it('should handle zero debt', () => {
      const emptySignals: DebtSignals = {
        complexity: { score: 0, details: [] },
        duplication: { score: 0, details: [] },
        coupling: { score: 0, details: [] },
        coverage: { score: 0, details: [] },
        architecture: { score: 0, details: [] },
        churn: { score: 0, details: [] },
        documentation: { score: 0, details: [] },
        security: { score: 0, details: [] },
      };

      const result = aggregateDebt(emptySignals);

      expect(result.totalDebt).toBe(0);
      expect(result.recommendations).toHaveLength(0);
      expect(result.priority).toBe('low');
    });

    it('should determine correct priority', () => {
      // Critical priority for debt >= 80
      const criticalSignals: DebtSignals = {
        complexity: { score: 100, details: ['Critical complexity'] },
        duplication: { score: 100, details: ['Critical duplication'] },
        coupling: { score: 100, details: ['Critical coupling'] },
        coverage: { score: 100, details: ['Critical coverage'] },
        architecture: { score: 100, details: ['Critical architecture'] },
        churn: { score: 100, details: ['Critical churn'] },
        documentation: { score: 100, details: ['Critical docs'] },
        security: { score: 100, details: ['Critical security'] },
      };

      const result = aggregateDebt(criticalSignals);
      expect(result.priority).toBe('critical');
    });
  });

  describe('estimateFixHours', () => {
    it('should return 0 for no debt', () => {
      const signals: DebtSignals = {
        complexity: { score: 0, details: [] },
        duplication: { score: 0, details: [] },
        coupling: { score: 0, details: [] },
        coverage: { score: 0, details: [] },
        architecture: { score: 0, details: [] },
        churn: { score: 0, details: [] },
        documentation: { score: 0, details: [] },
        security: { score: 0, details: [] },
      };

      const hours = estimateFixHours(signals, 0);
      expect(hours).toBe(0);
    });

    it('should estimate higher hours for more debt', () => {
      const lowDebt: DebtSignals = {
        complexity: { score: 20, details: ['Some complexity'] },
        duplication: { score: 0, details: [] },
        coupling: { score: 0, details: [] },
        coverage: { score: 0, details: [] },
        architecture: { score: 0, details: [] },
        churn: { score: 0, details: [] },
        documentation: { score: 0, details: [] },
        security: { score: 0, details: [] },
      };

      const highDebt: DebtSignals = {
        complexity: { score: 80, details: ['High complexity'] },
        duplication: { score: 60, details: ['High duplication'] },
        coupling: { score: 50, details: ['High coupling'] },
        coverage: { score: 70, details: ['Low coverage'] },
        architecture: { score: 60, details: ['Architecture issues'] },
        churn: { score: 30, details: ['High churn'] },
        documentation: { score: 50, details: ['Missing docs'] },
        security: { score: 60, details: ['Security debt'] },
      };

      const lowHours = estimateFixHours(lowDebt, 20);
      const highHours = estimateFixHours(highDebt, 80);

      expect(highHours).toBeGreaterThan(lowHours);
    });

    it('should add extra hours for architecture issues', () => {
      const withArch: DebtSignals = {
        complexity: { score: 50, details: [] },
        duplication: { score: 0, details: [] },
        coupling: { score: 0, details: [] },
        coverage: { score: 0, details: [] },
        architecture: { score: 60, details: ['Architecture issues'] },
        churn: { score: 0, details: [] },
        documentation: { score: 0, details: [] },
        security: { score: 0, details: [] },
      };

      const withoutArch: DebtSignals = {
        complexity: { score: 50, details: [] },
        duplication: { score: 0, details: [] },
        coupling: { score: 0, details: [] },
        coverage: { score: 0, details: [] },
        architecture: { score: 0, details: [] },
        churn: { score: 0, details: [] },
        documentation: { score: 0, details: [] },
        security: { score: 0, details: [] },
      };

      const archHours = estimateFixHours(withArch, 50);
      const noArchHours = estimateFixHours(withoutArch, 50);

      expect(archHours).toBeGreaterThan(noArchHours);
    });

    it('should return reasonable estimates', () => {
      const signals: DebtSignals = {
        complexity: { score: 50, details: ['Medium complexity'] },
        duplication: { score: 30, details: ['Some duplication'] },
        coupling: { score: 20, details: [] },
        coverage: { score: 40, details: ['Medium coverage'] },
        architecture: { score: 10, details: [] },
        churn: { score: 15, details: [] },
        documentation: { score: 25, details: ['Partial docs'] },
        security: { score: 5, details: [] },
      };

      const hours = estimateFixHours(signals, 40);

      // Should be reasonable (not 0, not thousands)
      expect(hours).toBeGreaterThan(0);
      expect(hours).toBeLessThan(1000);
    });
  });

  describe('Constants validation', () => {
    it('should have valid complexity thresholds', () => {
      // Check nested structure
      expect(COMPLEXITY_THRESHOLDS.cyclomatic.low).toBeGreaterThan(0);
      expect(COMPLEXITY_THRESHOLDS.cyclomatic.high).toBeGreaterThan(COMPLEXITY_THRESHOLDS.cyclomatic.low);
      expect(COMPLEXITY_THRESHOLDS.lines.low).toBeGreaterThan(0);
      expect(COMPLEXITY_THRESHOLDS.lines.high).toBeGreaterThan(COMPLEXITY_THRESHOLDS.lines.low);
    });

    it('should have debt weights that sum to ~1', () => {
      const weights = Object.values(DEBT_WEIGHTS);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 1);
    });

    it('should have valid priority thresholds', () => {
      expect(PRIORITY_THRESHOLDS.critical).toBeGreaterThan(PRIORITY_THRESHOLDS.high);
      expect(PRIORITY_THRESHOLDS.high).toBeGreaterThan(PRIORITY_THRESHOLDS.medium);
      expect(PRIORITY_THRESHOLDS.medium).toBeGreaterThan(PRIORITY_THRESHOLDS.low);
    });
  });

  describe('Integration with Storage', () => {
    let storage: LiBrainianStorage;
    let dbPath: string;
    const testDir = join(tmpdir(), 'debt-analysis-test-' + Date.now());

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
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should store and retrieve debt metrics', async () => {
      const metrics: DebtMetrics[] = [
        createDebtMetrics({
          entityId: 'func-a',
          entityType: 'function',
          totalDebt: 45,
          complexityDebt: 30,
          duplicationDebt: 15,
          trend: 'stable',
        }),
      ];

      await storage.upsertDebtMetrics(metrics);

      const retrieved = await storage.getDebtMetrics({ entityId: 'func-a' });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].totalDebt).toBe(45);
    });

    it('should get debt hotspots by threshold', async () => {
      const metrics: DebtMetrics[] = [
        createDebtMetrics({
          entityId: 'low-debt',
          entityType: 'function',
          totalDebt: 10,
          complexityDebt: 10,
          trend: 'stable',
        }),
        createDebtMetrics({
          entityId: 'high-debt',
          entityType: 'function',
          totalDebt: 80,
          complexityDebt: 50,
          duplicationDebt: 30,
          trend: 'degrading',
        }),
      ];

      await storage.upsertDebtMetrics(metrics);

      // Get hotspots with threshold of 50
      const hotspots = await storage.getDebtHotspots(50);

      // Should include at least the high-debt entry
      expect(hotspots.some(h => h.entityId === 'high-debt')).toBe(true);
      // DebtHotspot has totalDebt field
      expect(hotspots.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by trend', async () => {
      const metrics: DebtMetrics[] = [
        createDebtMetrics({
          entityId: 'improving',
          entityType: 'function',
          totalDebt: 30,
          trend: 'improving',
        }),
        createDebtMetrics({
          entityId: 'degrading',
          entityType: 'function',
          totalDebt: 50,
          trend: 'degrading',
        }),
        createDebtMetrics({
          entityId: 'stable',
          entityType: 'function',
          totalDebt: 40,
          trend: 'stable',
        }),
      ];

      await storage.upsertDebtMetrics(metrics);

      const degrading = await storage.getDebtMetrics({ trend: 'degrading' });
      expect(degrading).toHaveLength(1);
      expect(degrading[0].entityId).toBe('degrading');
    });

    it('should update existing metrics', async () => {
      const initial = createDebtMetrics({
        entityId: 'func-a',
        entityType: 'function',
        totalDebt: 50,
        trend: 'stable',
      });

      await storage.upsertDebtMetrics([initial]);

      const updated = createDebtMetrics({
        entityId: 'func-a',
        entityType: 'function',
        totalDebt: 30,
        trend: 'improving',
      });

      await storage.upsertDebtMetrics([updated]);

      const retrieved = await storage.getDebtMetrics({ entityId: 'func-a' });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].totalDebt).toBe(30);
      expect(retrieved[0].trend).toBe('improving');
    });
  });
});
